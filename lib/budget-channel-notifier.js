/**
 * Budget breach channel notifier (budget-ledger slice 5).
 *
 * Consumes the latched breach rows that slice-3 surfacing already fans out as
 * SSE frames (gateway-workflow-dispatcher-v2.emitBudgetBreachFrames) and pages
 * the operator on a chat channel over the task-server's EXISTING authenticated
 * gateway WebSocket (lib/gateway-client.js `sendDelivery` → gateway `send`
 * RPC). Design brief: docs/briefs/budget-channel-alerts.md.
 *
 * Contracts (mirroring emitBudgetBreachFrames):
 * - Never throws into the dispatch path. Every failure degrades: config
 *   off/unset ⇒ silent skip; send failures log once per 10-minute window.
 * - Dedupe is inherited from the DB latch (collectBreachEventRows returns
 *   inserted-only rows) plus an in-memory seen-set belt-and-braces against
 *   double invocation within/across ticks.
 * - Alert text is verbatim/deterministic — pure formatter, no LLM turn.
 *
 * Configuration (env, default OFF = zero behavior change):
 * - BUDGET_ALERT_CHANNEL            zulip | whatsapp | off        (default off)
 * - BUDGET_ALERT_TARGET             channel recipient per gateway semantics
 * - BUDGET_ALERT_DASHBOARD_URL_BASE staging URL base for the dashboard link;
 *                                   empty ⇒ Dashboard line omitted entirely
 */

const DEFAULT_EVENT_KINDS = ['paused', 'hard_stopped'];

const KIND_LABELS = {
  paused: '⏸ PAUSED',
  hard_stopped: '🛑 HARD STOP',
  warned: '⚠️ WARNED',
};

const ACTION_CLAUSES = {
  pause_new_runs: 'new runs queue until cap raised or period rolls',
  hard_stop: 'in-flight runs cancelled and new runs blocked until cap raised or period rolls',
  warn: 'no enforcement — advisory only',
};

const LOG_SUPPRESS_WINDOW_MS = 10 * 60 * 1000;

/** Strip control chars/newlines and truncate — prevents skeleton injection. */
function sanitizeBudgetName(raw) {
  const cleaned = String(raw == null ? '' : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function scopeLabel(frame) {
  if (!frame.scope || frame.scope === 'fleet') return 'fleet';
  return frame.scope_id ? `${frame.scope}/${frame.scope_id}` : String(frame.scope);
}

function spendLabel(spend, cap) {
  const usdMode = cap.usd != null;
  if (usdMode) {
    const pct = cap.usd > 0 ? Math.round((spend.usd / cap.usd) * 100) : 0;
    return `$${spend.usd.toFixed(2)} of $${cap.usd.toFixed(2)} cap (${pct}%)`;
  }
  if (cap.tokens != null) {
    const pct = cap.tokens > 0 ? Math.round((spend.tokens / cap.tokens) * 100) : 0;
    return `${spend.tokens.toLocaleString('en-US')} of ${cap.tokens.toLocaleString('en-US')} tokens cap (${pct}%)`;
  }
  // Defensive: the latch implies a cap existed at evaluation time.
  const spent = usdMode ? '' : spend.tokens.toLocaleString('en-US');
  return `${spent} of unlimited cap`.replace(/^\s+/, '');
}

function dashboardLink(urlBase) {
  const base = String(urlBase || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/?view=budgets`;
}

/**
 * Pure formatter — one compact plain-text message per breach frame.
 * Whitelist content only: name, scope, period, spend/cap, action, link.
 */
function formatBudgetAlertMessage(frame, cfg = {}) {
  if (!frame || !frame.event_kind) return null;
  const name = sanitizeBudgetName(frame.budget_name);
  const kindLabel = KIND_LABELS[frame.event_kind] || String(frame.event_kind);
  const action = frame.action || String(frame.event_kind);
  const clause = ACTION_CLAUSES[action] || 'budget guardrail enforced';
  const lines = [
    `${kindLabel} — Budget "${name}"`,
    `Scope: ${scopeLabel(frame)} · Period: ${frame.period} (${frame.period_key})`,
    `Spend: ${spendLabel(
      { usd: Number(frame.spend_usd) || 0, tokens: Number(frame.spend_tokens) || 0 },
      { usd: frame.cap_usd == null ? null : Number(frame.cap_usd), tokens: frame.cap_tokens == null ? null : Number(frame.cap_tokens) }
    )}`,
    `Action: ${action} — ${clause}`,
  ];
  const link = dashboardLink(cfg.dashboardUrlBase);
  if (link) lines.push(`Dashboard: ${link}`);
  return lines.join('\n');
}

function defaultConfigSource() {
  return {
    channel: String(process.env.BUDGET_ALERT_CHANNEL || 'off').trim().toLowerCase(),
    target: String(process.env.BUDGET_ALERT_TARGET || '').trim() || null,
    eventKinds: String(process.env.BUDGET_ALERT_EVENT_KINDS || DEFAULT_EVENT_KINDS.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean),
    mutedBudgets: String(process.env.BUDGET_ALERT_MUTED_BUDGETS || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    dashboardUrlBase: String(process.env.BUDGET_ALERT_DASHBOARD_URL_BASE || '').trim() || null,
  };
}

function normalizeChannels(channelCfg) {
  // Single-channel v1 per work order; whitespace/comma tolerant.
  return String(channelCfg || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((c) => c === 'zulip' || c === 'whatsapp');
}

/**
 * Factory: createBudgetChannelNotifier({ getClient, configSource, log, now })
 * - getClient: () => GatewayClient-like instance (or null) — resolved lazily so
 *   the dispatcher can be constructed before task-server creates its client.
 * - configSource: () => {channel,target,eventKinds,mutedBudgets,dashboardUrlBase}
 *   (defaults to env; injectable for tests).
 */
function createBudgetChannelNotifier(opts = {}) {
  const getClient = typeof opts.getClient === 'function' ? opts.getClient : null;
  const staticClient = opts.gatewayClient || null;
  const configSource = typeof opts.configSource === 'function' ? opts.configSource : defaultConfigSource;
  const log = opts.log || console;
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now();

  const seen = new Set(); // `${budget_id}:${period_key}:${event_kind}`
  const failureState = { lastErrorAt: 0, lastErrorMessage: null };

  function resolveClient() {
    if (getClient) {
      try { return getClient() || null; } catch (_) { return null; }
    }
    return staticClient;
  }

  async function sendVia(client, channel, target, message) {
    if (typeof client.sendDelivery === 'function') {
      return client.sendDelivery({ channel, to: target, message });
    }
    // Test/legacy doubles without the wrapper: pin the RPC contract here.
    return client._request('send', { channel, to: target, message, idempotencyKey: require('crypto').randomUUID() });
  }

  /**
   * Deliver one breach frame. Resolves {sent, skipped?, reason?} — NEVER throws.
   */
  async function deliverFrame(frame) {
    try {
      const cfg = configSource() || {};
      const channels = normalizeChannels(cfg.channel);
      if (!channels.length || !cfg.target) {
        return { sent: false, skipped: true, reason: 'disabled' }; // off/unset ⇒ zero behavior, zero logs
      }
      const kinds = Array.isArray(cfg.eventKinds) && cfg.eventKinds.length ? cfg.eventKinds : DEFAULT_EVENT_KINDS;
      if (!frame || !kinds.includes(frame.event_kind)) {
        return { sent: false, skipped: true, reason: 'kind_filtered' };
      }
      const muteKey = String(frame.budget_id == null ? '' : frame.budget_id).toLowerCase();
      const muteName = String(frame.budget_name == null ? '' : frame.budget_name).toLowerCase();
      if ((cfg.mutedBudgets || []).some((m) => m && (m === muteKey || m === muteName))) {
        return { sent: false, skipped: true, reason: 'muted' };
      }
      const dedupeKey = `${frame.budget_id}:${frame.period_key}:${frame.event_kind}`;
      if (seen.has(dedupeKey)) {
        return { sent: false, skipped: true, reason: 'duplicate' }; // belt-and-braces vs the DB latch
      }
      seen.add(dedupeKey);

      const message = formatBudgetAlertMessage(frame, cfg);
      if (!message) return { sent: false, skipped: true, reason: 'unformattable' };

      const client = resolveClient();
      if (!client) {
        noteFailure('gateway client unavailable');
        return { sent: false, skipped: true, reason: 'no_client' };
      }

      let delivered = false;
      let lastError = null;
      for (const channel of channels) {
        try {
          await sendVia(client, channel, cfg.target, message);
          delivered = true;
        } catch (err) {
          lastError = err;
        }
      }
      if (delivered) {
        failureState.lastErrorAt = 0;
        failureState.lastErrorMessage = null;
        return { sent: true };
      }
      noteFailure(lastError ? lastError.message : 'send failed');
      return { sent: false, reason: 'send_failed' };
    } catch (err) {
      try { noteFailure(err && err.message); } catch (_) { /* never throw */ }
      return { sent: false, reason: 'error' };
    }
  }

  /** Log once per suppression window; a successful send resets suppression. */
  function noteFailure(message) {
    const t = nowFn();
    if (t - failureState.lastErrorAt < LOG_SUPPRESS_WINDOW_MS && failureState.lastErrorMessage === message) return;
    failureState.lastErrorAt = t;
    failureState.lastErrorMessage = message;
    try {
      log.error('[budget-notifier] channel alert send failed (suppressed 10m):', message);
    } catch (_) { /* logger broken — still never throw */ }
  }

  return { deliverFrame, formatBudgetAlertMessage, seen };
}

module.exports = {
  DEFAULT_EVENT_KINDS,
  KIND_LABELS,
  ACTION_CLAUSES,
  sanitizeBudgetName,
  scopeLabel,
  spendLabel,
  dashboardLink,
  formatBudgetAlertMessage,
  createBudgetChannelNotifier,
};
