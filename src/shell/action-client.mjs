/**
 * Action client — one-click actions slice 2 (docs/briefs/one-click-actions.md §3).
 *
 * Shared client helper between every catalog button and POST /api/actions/execute:
 *   1. Confirmation gate derived from the registry severity (brief §3.2):
 *      NONE → fire immediately; PREVIEW_MODAL → typed preview card; HOLD_CONFIRM
 *      → press-and-hold ≥1.2 s overlay with keyboard parity (hold Enter on the
 *      focused button drives the same threshold — AC11).
 *   2. Envelope minting: actionId is minted ONCE per confirmed intent (§3.3
 *      layer 1) — retries reuse it, a deliberate repeat mints a fresh one.
 *   3. Outcome surfacing: toast per outcome tone + receipt pushed into the
 *      Recent-actions tray state; budget-blocked refusals render a distinct
 *      amber banner naming budget + period (never a plain error toast).
 *
 * The server registry (lib/action-registry.js) is AUTHORITATIVE for kind
 * metadata; ACTION_CATALOG below mirrors only the fields the UI derives
 * behavior from. Parity is pinned DB-free in tests/test-action-client.js.
 *
 * This module must stay importable without a DOM (tests import it under
 * plain node) — all document access lives inside functions.
 */

// ── Client mirror of the action catalog (lib/action-registry.js) ──

export const ACTION_CATALOG = Object.freeze({
  'task.assign': Object.freeze({
    label: 'Assign task',
    severity: 'LOW',
    confirmMode: 'NONE',
    targetType: 'task',
    rollbackHint: 'Re-assign to <previous owner>',
  }),
  'run.dispatch': Object.freeze({
    label: 'Dispatch workflow run',
    severity: 'MEDIUM',
    confirmMode: 'PREVIEW_MODAL',
    targetType: 'task',
    rollbackHint: 'Cancel run {new_run_id} if unwanted',
  }),
  'approval.decide': Object.freeze({
    label: 'Decide approval',
    severity: 'MEDIUM-HIGH',
    confirmMode: 'PREVIEW_MODAL',
    targetType: 'approval',
    rollbackHint: 'Rejection path: escalate_approval or re-create approval',
  }),
  'run.cancel': Object.freeze({
    label: 'Cancel run',
    severity: 'HIGH',
    confirmMode: 'HOLD_CONFIRM',
    targetType: 'run',
    rollbackHint: 'Re-dispatch via run.redispatch',
  }),
  'run.redispatch': Object.freeze({
    label: 'Re-dispatch run',
    severity: 'MEDIUM',
    confirmMode: 'PREVIEW_MODAL',
    targetType: 'run',
    rollbackHint: 'Cancel again via run.cancel',
  }),
});

/** Hold-to-confirm threshold in ms (brief §3.2: ≥1.2 s). */
export const HOLD_CONFIRM_MS = 1200;

/** Mint a UUID-shaped actionId (crypto.randomUUID with v4 fallback). */
export function mintActionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/** Registry metadata for one kind (null when unknown). */
export function catalogFor(kind) {
  return ACTION_CATALOG[kind] || null;
}

/** Confirmation mode for one kind (null when unknown). */
export function confirmModeFor(kind) {
  return ACTION_CATALOG[kind]?.confirmMode ?? null;
}

/**
 * Build an ActionEnvelope body (actionId minted here — call once per
 * confirmed intent). Throws on unknown kind so a wiring bug surfaces loudly
 * instead of POSTing garbage the server would refuse anyway.
 */
export function buildEnvelope({ kind, targetId, params = {} }) {
  if (!ACTION_CATALOG[kind]) {
    throw new Error(`unknown_kind: '${kind}' is not in the action catalog`);
  }
  if (!targetId || /\s/.test(String(targetId))) {
    throw new Error(`invalid targetId for ${kind}`);
  }
  return { actionId: mintActionId(), kind, targetId: String(targetId), params };
}

// ── Outcome description (pure; covered DB-free) ────────────────

const PERIOD_LABELS = {
  daily: 'daily', weekly: 'weekly', monthly: 'monthly',
};

/**
 * Human line for one breached budget: name + period + pct (work order:
 * amber banner w/ budget name + period).
 */
function budgetLine(b) {
  const period = b.period_key || PERIOD_LABELS[b.period?.toLowerCase?.()] || b.period || 'current period';
  const pct = typeof b.pct_of_cap === 'number' ? `${Math.round(b.pct_of_cap * 10) / 10}%` : '?';
  return `${b.name || 'budget'} at ${pct} of ${period} cap`;
}

/**
 * Amber-banner text for a structured budget_blocked refusal payload
 * ({error:'budget_blocked', action, budgets:[…]}).
 */
export function formatBudgetBanner(verdict = {}) {
  const budgets = Array.isArray(verdict.budgets) ? verdict.budgets : [];
  const lines = budgets.map(budgetLine);
  if (verdict.action === 'hard_stop') {
    lines.push('In-flight runs in scope were cancelled by the dispatcher.');
  } else if (verdict.action === 'pause_new_runs') {
    lines.push('Queue drains automatically at rollover, cap raise, or deactivation.');
  }
  return lines.join(' ');
}

/**
 * Map an execute response to a UI outcome descriptor.
 * Pure — no DOM, no fetch; table pinned by tests.
 *
 * @returns {{tone:'success'|'info'|'warn'|'error'|'blocked'|'unavailable',
 *            title:string, message:string, duplicate?:boolean,
 *            verdict?:object, receipt?:object}}
 */
export function describeOutcome({ status, payload } = {}) {
  const error = payload?.error ?? null;

  if (payload && payload.available === false) {
    return {
      tone: 'unavailable',
      title: 'Actions unavailable',
      message: String(payload.reason || 'unavailable'),
    };
  }
  if (status === 200) {
    if (payload?.duplicate) {
      return {
        tone: 'info',
        title: 'Already executed',
        message: 'Receipt replayed for this actionId — no side effect performed.',
        duplicate: true,
        receipt: payload.receipt,
      };
    }
    return { tone: 'success', title: 'Executed', message: 'Action executed; receipt recorded.', receipt: payload?.receipt };
  }
  if (error === 'budget_blocked') {
    return {
      tone: 'blocked',
      title: 'Blocked by budget',
      message: formatBudgetBanner(payload),
      verdict: payload,
    };
  }
  if (error === 'rejected_governance') {
    return {
      tone: 'error',
      title: 'Rejected by governance',
      message: String(payload.reason || 'governance denied this action'),
      receipt: payload.receipt,
    };
  }
  if (error === 'stale_retry') {
    return {
      tone: 'warn',
      title: 'Stale retry',
      message: 'This actionId was already used with different params — reopen the dialog to try again.',
    };
  }
  if (error === 'invalid_action') {
    const details = Array.isArray(payload.details) ? payload.details.join('; ') : '';
    return { tone: 'error', title: 'Invalid action', message: details || 'envelope rejected' };
  }
  if (error === 'execution_failed') {
    return {
      tone: 'error',
      title: 'Failed',
      message: String(payload.message || 'execution failed'),
      receipt: payload.receipt,
    };
  }
  return { tone: 'error', title: 'Failed', message: `HTTP ${status ?? '?'}` };
}

// ── Receipt state shared with the Recent-actions tray ──────────

const MAX_RECEIPTS = 50;
const recentReceipts = [];
const receiptSubscribers = new Set();

/** Prepend a receipt to the shared tray state (newest first, capped at 50). */
export function recordReceipt(receipt) {
  if (!receipt || !receipt.action_id) return;
  if (recentReceipts.some((r) => r.action_id === receipt.action_id)) return;
  recentReceipts.unshift(receipt);
  if (recentReceipts.length > MAX_RECEIPTS) recentReceipts.length = MAX_RECEIPTS;
  receiptSubscribers.forEach((cb) => {
    try { cb(receipt); } catch { /* subscriber errors never break recording */ }
  });
}

/** Subscribe to live receipts (tray ingest). Returns unsubscribe. */
export function subscribeReceipts(cb) {
  receiptSubscribers.add(cb);
  return () => receiptSubscribers.delete(cb);
}

/** Snapshot of the in-memory receipts (newest first). */
export function getRecentReceipts() {
  return [...recentReceipts];
}

/**
 * Fetch receipts from GET /api/actions/recent (tray feed). Prefers an api
 * client exposing actions.recent(); falls back to raw fetch with the shell
 * auth header. Degrades to {available:false, reason} per the house contract.
 */
export async function loadRecentReceipts(api = null, limit = 10) {
  try {
    if (api?.actions?.recent) {
      const payload = await api.actions.recent({ limit });
      return normalizeRecentPayload(payload);
    }
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__;
    const res = await fetch(`/api/actions/recent?limit=${encodeURIComponent(limit)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const payload = await res.json().catch(() => null);
    return normalizeRecentPayload(payload);
  } catch (err) {
    return { available: false, reason: 'query_failed', receipts: [], details: err?.message };
  }
}

function normalizeRecentPayload(payload) {
  if (!payload || payload.available === false) {
    return { available: false, reason: payload?.reason || 'no_database', receipts: [] };
  }
  return {
    available: true,
    reason: null,
    receipts: Array.isArray(payload.receipts) ? payload.receipts : [],
  };
}

// ── Transport ──────────────────────────────────────────────────

async function postExecute(envelope, api) {
  if (api?.actions?.execute) {
    try {
      const payload = await api.actions.execute(envelope);
      return { status: 200, payload };
    } catch (err) {
      // APIClientError carries .status and (since slice 2) .payload.
      return { status: err?.status ?? 500, payload: err?.payload ?? { error: 'network_error', message: err?.message } };
    }
  }
  const token = globalThis.__DASHBOARD_AUTH_TOKEN__;
  let res;
  try {
    res = await fetch('/api/actions/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    return { status: 0, payload: { error: 'network_error', message: err?.message } };
  }
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, payload };
}

// ── DOM helpers (all lazy — module stays DOM-free at import) ───

const OVERLAY_Z = 10020; // above view modals (1000) and agent guard modal (10000)

function ensureHost() {
  return document.body;
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.45)',
    `z-index:${OVERLAY_Z}`, 'display:flex', 'align-items:center', 'justify-content:center',
  ].join(';');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  return overlay;
}

function buildCard(width = 420) {
  const card = document.createElement('div');
  card.style.cssText = [
    `width:min(${width}px, 92vw)`, 'background:var(--win11-surface-solid,#1f1f1f)',
    'border:1px solid var(--win11-border,#3d3d3d)', 'border-radius:12px',
    'padding:18px', 'box-shadow:0 8px 32px rgba(0,0,0,0.35)',
    'color:var(--win11-text,#fff)', 'font-size:0.85rem', 'line-height:1.45',
  ].join(';');
  return card;
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 14 ? `${s.slice(0, 8)}…` : s;
}

/** Lightweight outcome toast (bottom-right stack, auto-dismiss). */
export function showToast(message, tone = 'info', ms = 5200) {
  if (typeof document === 'undefined') return;
  const colors = {
    success: '#22c55e', error: '#ef4444', warn: '#eab308',
    info: 'var(--win11-accent,#60cdff)', blocked: '#f59e0b',
  };
  const host = ensureHost();
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:56px', `z-index:${OVERLAY_Z + 10}`,
    'max-width:360px', 'padding:10px 14px', 'border-radius:8px',
    'background:var(--win11-surface-solid,#1f1f1f)',
    'border:1px solid var(--win11-border,#3d3d3d)',
    `border-left:3px solid ${colors[tone] || colors.info}`,
    'color:var(--win11-text,#fff)', 'font-size:0.82rem', 'line-height:1.4',
    'box-shadow:0 6px 18px rgba(0,0,0,0.3)', 'white-space:pre-wrap',
  ].join(';');
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), ms);
}

/**
 * Distinct amber banner for budget-blocked refusals (work order: NOT a plain
 * error toast). Fixed top-center, dismissable, lists budget name + period.
 */
export function showBudgetBlockedBanner(verdict) {
  if (typeof document === 'undefined') return;
  const host = ensureHost();
  const banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position:fixed', 'top:56px', 'left:50%', 'transform:translateX(-50%)',
    `z-index:${OVERLAY_Z + 10}`, 'max-width:560px', 'width:92vw',
    'padding:12px 16px', 'border-radius:8px',
    'background:rgba(245,158,11,0.12)', 'border:1px solid rgba(245,158,11,0.45)',
    'color:#fbbf24', 'font-size:0.83rem', 'line-height:1.45',
    'box-shadow:0 6px 18px rgba(0,0,0,0.35)',
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:4px;';
  title.textContent = `⚠ Blocked by budget${verdict?.action === 'hard_stop' ? ' (hard stop)' : ''}`;
  const body = document.createElement('div');
  body.textContent = formatBudgetBanner(verdict);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Dismiss budget notice');
  close.style.cssText = [
    'position:absolute', 'top:6px', 'right:8px', 'background:none', 'border:none',
    'color:#fbbf24', 'cursor:pointer', 'font-size:0.9rem',
  ].join(';');
  close.addEventListener('click', () => banner.remove());
  banner.style.position = 'fixed';
  banner.appendChild(close);
  banner.appendChild(title);
  banner.appendChild(body);
  host.appendChild(banner);
  setTimeout(() => banner.remove(), 12000);
}

/**
 * Typed preview modal (LoopX pattern): exactly what will happen, on which
 * target, with which params + the rollback hint BEFORE confirming.
 * Resolves {confirmed:true} | {confirmed:false}.
 */
export function openPreviewModal({ kind, targetId, params = {}, extraLines = [] } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve({ confirmed: false }); return; }
    const entry = ACTION_CATALOG[kind];
    if (!entry) { resolve({ confirmed: false }); return; }

    const overlay = buildOverlay();
    const card = buildCard();
    card.innerHTML = '';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 10px;font-size:1rem;font-weight:600;';
    title.textContent = entry.label;

    const rows = document.createElement('div');
    rows.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:12px;';
    const addRow = (label, value, mono = true) => {
      const row = document.createElement('div');
      const l = document.createElement('span');
      l.style.cssText = 'color:var(--win11-text-tertiary,#9a9a9a);margin-right:6px;';
      l.textContent = label;
      const v = document.createElement('span');
      if (mono) v.style.cssText = "font-family:'SF Mono','Consolas',monospace;font-size:0.78rem;";
      v.textContent = value;
      row.appendChild(l); row.appendChild(v);
      rows.appendChild(row);
    };
    addRow('Action:', kind);
    addRow(`Target (${entry.targetType}):`, shortId(targetId), true);
    title.title = targetId ? String(targetId) : '';
    const paramEntries = Object.entries(params || {});
    if (paramEntries.length) {
      for (const [k, v] of paramEntries) {
        const rendered = typeof v === 'string' ? v : JSON.stringify(v);
        addRow(`${k}:`, rendered.length > 160 ? `${rendered.slice(0, 160)}…` : rendered);
      }
    }
    for (const line of extraLines) addRow('', line, false);

    const hint = document.createElement('div');
    hint.style.cssText = [
      'margin-bottom:14px;padding:8px 10px;border-radius:6px;font-size:0.78rem;',
      'background:var(--win11-surface,#141414);border:1px solid var(--win11-border,#3d3d3d);',
      'color:var(--win11-text-secondary,#c8c8c8);',
    ].join(';');
    hint.textContent = `Recovery: ${entry.rollbackHint}`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid var(--win11-border,#3d3d3d);background:transparent;color:inherit;cursor:pointer;';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = 'padding:6px 18px;border-radius:6px;border:none;background:var(--win11-accent,#60cdff);color:#111;font-weight:600;cursor:pointer;';

    const done = (confirmed) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve({ confirmed });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
    };
    cancelBtn.addEventListener('click', () => done(false));
    confirmBtn.addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.addEventListener('keydown', onKey);

    btnRow.append(cancelBtn, confirmBtn);
    card.append(title, rows, hint, btnRow);
    overlay.appendChild(card);
    ensureHost().appendChild(overlay);
    confirmBtn.focus();
  });
}

/**
 * Hold-to-confirm overlay (HIGH severity): press-and-hold ≥1.2 s with a
 * progress ring; release early fires nothing. Keyboard parity (AC11):
 * focus lands on the hold button — pressing and holding Enter drives the
 * identical keydown→keyup timing; Escape cancels.
 * Resolves {confirmed:true} | {confirmed:false}.
 */
export function openHoldConfirm({ kind, targetId, ms = HOLD_CONFIRM_MS } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve({ confirmed: false }); return; }
    const entry = ACTION_CATALOG[kind];
    if (!entry) { resolve({ confirmed: false }); return; }

    const overlay = buildOverlay();
    const card = buildCard(380);
    card.style.textAlign = 'center';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0 0 6px;font-size:1rem;font-weight:600;';
    title.textContent = entry.label;
    const sub = document.createElement('div');
    sub.style.cssText = 'color:var(--win11-text-secondary,#c8c8c8);font-size:0.8rem;margin-bottom:14px;';
    sub.textContent = `Run ${shortId(targetId)} — cancelling destroys paid in-flight work.`;

    const ring = document.createElement('button');
    ring.type = 'button';
    ring.setAttribute('aria-label', `Hold to confirm ${entry.label}`);
    ring.style.cssText = [
      'position:relative', 'width:96px', 'height:96px', 'border-radius:50%',
      'border:none', 'cursor:pointer', 'margin:0 auto', 'display:block',
      'background:',
      'conic-gradient(var(--win11-accent,#60cdff) 0deg, var(--win11-border,#3d3d3d) 0deg)',
      'color:var(--win11-text,#fff)', 'font-weight:600', 'font-size:0.78rem',
      'user-select:none', '-webkit-user-select:none', 'touch-action:none',
      'outline-offset:4px',
    ].join(';');
    const ringLabel = document.createElement('span');
    ringLabel.style.cssText = [
      'position:absolute', 'inset:7px', 'border-radius:50%',
      'background:var(--win11-surface-solid,#1f1f1f)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    ringLabel.textContent = 'HOLD';
    ring.appendChild(ringLabel);

    const hintEl = document.createElement('div');
    hintEl.style.cssText = 'margin-top:12px;font-size:0.75rem;color:var(--win11-text-tertiary,#9a9a9a);';
    hintEl.textContent = `Hold the button (or hold Enter on it) for ${(ms / 1000).toFixed(1)} s — releasing early cancels nothing.`;

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'margin-top:12px', 'padding:6px 14px', 'border-radius:6px',
      'border:1px solid var(--win11-border,#3d3d3d)', 'background:transparent',
      'color:inherit', 'cursor:pointer',
    ].join(';');

    const done = (confirmed) => {
      cancelHold();
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve({ confirmed });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    };

    // Hold engine — pointer and keyboard drive the same start/cancel/complete
    // path so timing semantics are identical (AC11).
    let raf = null;
    let startTs = 0;
    let holding = false;
    const paint = () => {
      const pct = Math.min(1, (performance.now() - startTs) / ms);
      const deg = Math.round(pct * 360);
      ring.style.background =
        `conic-gradient(var(--win11-accent,#60cdff) ${deg}deg, var(--win11-border,#3d3d3d) ${deg}deg)`;
      ringLabel.textContent = pct >= 1 ? '✓' : `${Math.round(pct * 100)}%`;
      if (pct >= 1) { done(true); return; }
      if (holding) raf = requestAnimationFrame(paint);
    };
    const startHold = () => {
      if (holding) return;
      holding = true;
      startTs = performance.now();
      raf = requestAnimationFrame(paint);
    };
    const cancelHold = () => {
      if (!holding) return;
      holding = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ring.style.background =
        'conic-gradient(var(--win11-accent,#60cdff) 0deg, var(--win11-border,#3d3d3d) 0deg)';
      ringLabel.textContent = 'HOLD';
    };

    ring.addEventListener('pointerdown', (e) => { e.preventDefault(); ring.focus(); startHold(); });
    ring.addEventListener('pointerup', cancelHold);
    ring.addEventListener('pointerleave', cancelHold);
    ring.addEventListener('pointercancel', cancelHold);
    // Keyboard parity: Enter keydown starts, keyup cancels early / completes
    // through the same paint loop. Guard against OS key-repeat re-entry.
    ring.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); startHold(); }
    });
    ring.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cancelHold(); }
    });

    cancelBtn.addEventListener('click', () => done(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    document.addEventListener('keydown', onKey);

    card.append(title, sub, ring, hintEl, cancelBtn);
    overlay.appendChild(card);
    ensureHost().appendChild(overlay);
    ring.focus();
  });
}

// ── Main entry ─────────────────────────────────────────────────

/**
 * Execute one catalog action behind its confirmation gate.
 *
 * @param {object} opts
 * @param {string} opts.kind       Catalog kind (registry-checked)
 * @param {string} opts.targetId   task | approval | run id
 * @param {object} [opts.params]   Kind-specific params
 * @param {object} [opts.api]      APIClient (uses api.actions.execute); raw fetch fallback
 * @param {Array<string>} [opts.previewLines] Extra PREVIEW_MODAL lines
 * @returns {{ok:boolean, cancelled?:boolean, duplicate?:boolean,
 *          receipt?:object, outcome?:object}}
 *         Outcome toasts/banners are surfaced here; callers refresh their view
 *         when ok:true and stay silent otherwise (toast already shown).
 */
export async function executeAction({
  kind,
  targetId,
  params = {},
  api = null,
  previewLines = [],
} = {}) {
  const entry = catalogFor(kind);
  if (!entry) {
    showToast(`Unknown action kind '${kind}'.`, 'error');
    return { ok: false, outcome: { tone: 'error', title: 'Unknown action', message: kind } };
  }

  // 1. Confirmation gate — actionId is minted only AFTER confirmed intent,
  //    so a dismissed dialog leaves nothing to replay (§3.3 layer 1).
  if (entry.confirmMode === 'PREVIEW_MODAL') {
    const { confirmed } = await openPreviewModal({ kind, targetId, params, extraLines: previewLines });
    if (!confirmed) return { ok: false, cancelled: true };
  } else if (entry.confirmMode === 'HOLD_CONFIRM') {
    const { confirmed } = await openHoldConfirm({ kind, targetId });
    if (!confirmed) return { ok: false, cancelled: true };
  }

  // 2. Execute (envelope minted now).
  let envelope;
  try {
    envelope = buildEnvelope({ kind, targetId, params });
  } catch (err) {
    showToast(err.message, 'error');
    return { ok: false, outcome: { tone: 'error', title: 'Invalid action', message: err.message } };
  }

  const { status, payload } = await postExecute(envelope, api);
  const outcome = describeOutcome({ status, payload });

  // 3. Surface + record. Server-written receipts (executed/duplicate/
  //    rejected_governance/failed) land in the tray state; a budget block
  //    writes NO receipt server-side and renders the amber banner instead.
  switch (outcome.tone) {
    case 'success':
      showToast(`${entry.label} ✓${outcome.receipt?.rollback_hint ? `\nRecovery: ${outcome.receipt.rollback_hint}` : ''}`, 'success');
      break;
    case 'info':
      showToast(`${entry.label} — already executed (receipt replayed, no side effect).`, 'info');
      break;
    case 'blocked':
      showBudgetBlockedBanner(outcome.verdict);
      break;
    case 'unavailable':
      showToast(`Actions unavailable (${outcome.message}).`, 'error');
      break;
    default:
      showToast(`${outcome.title}: ${outcome.message}`, outcome.tone === 'warn' ? 'warn' : 'error');
  }
  if (outcome.receipt) recordReceipt(outcome.receipt);

  return {
    ok: outcome.tone === 'success' || outcome.tone === 'info',
    duplicate: outcome.duplicate || undefined,
    receipt: outcome.receipt,
    outcome,
  };
}
