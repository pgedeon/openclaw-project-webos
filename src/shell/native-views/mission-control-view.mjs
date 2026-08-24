import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

// ── Poll tunables (brief §3 data contracts) ─────────────────────
const FLEET_POLL_MS = 30000;
const RUNS_POLL_MS = 20000;   // aligned with realtime-sync.mjs SYNC_INTERVAL_MS
const CRON_POLL_MS = 60000;
const COST_POLL_MS = 120000;
const FETCH_TIMEOUT_MS = 5000; // R1 mitigation: CLI-backed endpoints have no SLA
const MAX_CRON_DETAIL_LOOKUPS = 3;

// ── Anomaly thresholds (brief §4) ───────────────────────────────
// Named + exported so unit tests can pin behavior exactly at each boundary
// and operators can tune a knob without touching flag logic. Each constant
// carries its justification; changing a value here changes the operator
// contract, so bump the views-reference thresholds note in the same commit.
export const STALE_RUN_MINUTES = 15;
// 15 min: a healthy run refreshes its heartbeat at least once per 20 s runs
// poll cycle; 15 min ≈ dozens of missed beats. Long enough to ride out a slow
// CLI sweep or transient stall, short enough to surface a hung run within one
// operator work block.
export const ZERO_TOKEN_MINUTES = 10;
// 10 min: recursive AgentOps-style loops burn wall-clock without reporting
// usage and show symptoms within minutes. Below 10 min legitimate runs often
// simply have not completed their first model call yet, so a lower value
// false-positives on ordinary cold starts.
export const CRASH_LOOP_CONSECUTIVE_FAILURES = 2;
// 2 consecutive failures: one failure is noise (transient CLI/network blip);
// two in a row on a scheduled job predicts the next run failing too. Earliest
// signal worth attention without paging on every hiccup. Also gates the
// diagnostics classification path (crash/pipeline_failed recurring).
export const COST_SPIKE_MULTIPLIER = 2;
// 2× trailing mean (today excluded): brief §4 flag 4, matching the market-scan
// "top steal" heuristic. Spend half again above normal is routine variance;
// doubling is when someone should look. Strictly greater-than: exactly 2× is
// NOT a spike.
export const COST_SPIKE_MIN_HISTORY_DAYS = 3;
// ≥3 trailing days of history: with fewer days the mean is dominated by
// migration-022 startup noise (R2 — expect the flag silent during week one).
export const BUDGET_WARN_FRACTION = 0.75;
// 75% of cap: budget bars turn amber here (bar color only — no flag). Early-
// warning zone BEFORE the breach boundary so a cap can be raised before
// dispatch holds start; below 75% routine burn noise dominates and the bar
// stays green.
export const BUDGET_BREACH_FRACTION = 1;
// 100% of cap: bar turns red AND the budget_breach anomaly flag fires.
// Exactly-at-cap IS a breach (>= boundary), matching decisionFor() in
// lib/budget-eval.js and brief §2.4's derived-breach semantics.
export const MAX_ANOMALY_FLAGS = 25;
// Render cap: a pathological payload (e.g. 50 simultaneously stale runs) must
// not flood the flags panel; types remain a fixed set of 6 by construction.

// ── Anomaly engine (pure, exported for unit tests) ──────────────
// Inputs (all optional; missing inputs skip their flags silently):
//   fleet = { agents: [{name, status}], queueTasks: [{assignee, status}] }
//   runs  = { running: [runRow] }
//   cron  = { jobs: [{id, name, status, consecutiveFailures}],
//             failures: [{id, name, failureType, failureCount}] }
//   cost  = { available: true, today: {cost}, days: [{date, cost}] }
// Output: Flag[] where Flag = {type, severity, subject, detail, since}
export function computeAnomalies({ fleet = null, runs = null, cron = null, cost = null, budgets = null, now = Date.now() } = {}) {
  const flags = [];

  // Flag 1 — Stale run: running with no heartbeat/updated_at for > STALE_RUN_MINUTES
  if (runs && Array.isArray(runs.running)) {
    for (const run of runs.running) {
      const freshAt = run.last_heartbeat_at || run.updated_at || run.started_at;
      if (!freshAt) continue;
      const ageMs = now - new Date(freshAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > STALE_RUN_MINUTES * 60000) {
        flags.push({
          type: 'stale_run',
          severity: 'warn',
          subject: run.workflow_type || run.id,
          detail: `no heartbeat for ${Math.round(ageMs / 60000)}m`,
          since: freshAt,
        });
      }
    }

    // Flag 2 — Zero-token loop: running > ZERO_TOKEN_MINUTES while reporting no usage
    for (const run of runs.running) {
      if (!run.started_at) continue;
      const elapsedMs = now - new Date(run.started_at).getTime();
      if (!Number.isFinite(elapsedMs) || elapsedMs <= ZERO_TOKEN_MINUTES * 60000) continue;
      const reported = run.reported_at != null;
      const tokens = Number(run.input_tokens || 0) + Number(run.output_tokens || 0);
      if (!reported || tokens === 0) {
        flags.push({
          type: 'zero_token_loop',
          severity: 'warn',
          subject: run.workflow_type || run.id,
          detail: `running ${Math.round(elapsedMs / 60000)}m with ${reported ? 'zero token usage' : 'no usage report'}`,
          since: run.started_at,
        });
      }
    }
  }

  // Flag 3 — Crash-looping cron: ≥2 consecutive failed runs, or recurring
  // crash/pipeline_failed classification in diagnostics job health.
  const seenCronSubjects = new Set();
  if (cron && Array.isArray(cron.jobs)) {
    for (const job of cron.jobs) {
      if (job.status !== 'failed') continue;
      const consecutive = Number(job.consecutiveFailures || 0);
      if (consecutive >= CRASH_LOOP_CONSECUTIVE_FAILURES) {
        seenCronSubjects.add(job.id);
        flags.push({
          type: 'crash_loop_cron',
          severity: 'error',
          subject: job.name || job.id,
          detail: `failed ${consecutive}x consecutively`,
          since: job.lastRun || null,
        });
      }
    }
  }
  if (cron && Array.isArray(cron.failures)) {
    for (const failure of cron.failures) {
      const classification = failure.failureType || failure.classification;
      if (classification !== 'crash' && classification !== 'pipeline_failed') continue;
      if (Number(failure.failureCount || 0) < CRASH_LOOP_CONSECUTIVE_FAILURES) continue;
      if (seenCronSubjects.has(failure.id)) continue;
      seenCronSubjects.add(failure.id);
      flags.push({
        type: 'crash_loop_cron',
        severity: 'error',
        subject: failure.name || failure.id,
        detail: `${classification} recurring (${failure.failureCount}x)`,
        since: failure.lastRun || failure.firstSeen || null,
      });
    }
  }

  // Flag 4 — Cost burn spike: today > 2× mean of trailing days (today excluded),
  // requires ≥3 days of history.
  if (cost && cost.available && cost.today && Array.isArray(cost.days)) {
    const todayKey = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const history = cost.days.filter(d => d.date !== todayKey && Number(d.cost || 0) >= 0);
    if (history.length >= COST_SPIKE_MIN_HISTORY_DAYS) {
      const mean = history.reduce((sum, d) => sum + Number(d.cost || 0), 0) / history.length;
      const todayCost = Number(cost.today.cost || 0);
      if (mean > 0 && todayCost > COST_SPIKE_MULTIPLIER * mean) {
        flags.push({
          type: 'cost_spike',
          severity: 'error',
          subject: 'cost',
          detail: `today $${todayCost.toFixed(2)} is ${(todayCost / mean).toFixed(1)}× the ${history.length}-day mean $${mean.toFixed(2)}`,
          since: todayKey,
        });
      }
    }
  }

  // Flag 5 — Idle agent, non-empty queue
  if (fleet && Array.isArray(fleet.agents) && Array.isArray(fleet.queueTasks)) {
    const queuedByAgent = new Map();
    for (const task of fleet.queueTasks) {
      const status = String(task.status || '').toLowerCase();
      if (status !== 'queued' && status !== 'pending') continue;
      const assignee = task.assignee;
      if (!assignee) continue;
      queuedByAgent.set(assignee, (queuedByAgent.get(assignee) || 0) + 1);
    }
    if (queuedByAgent.size > 0) {
      for (const agent of fleet.agents) {
        const name = agent.name || agent.agent_name || agent.id;
        if (!name) continue;
        const state = String(agent.status || agent.state || '').toLowerCase();
        if (state !== 'idle' && state !== 'offline') continue;
        const queued = queuedByAgent.get(name);
        if (queued >= 1) {
          flags.push({
            type: 'idle_agent_queue',
            severity: 'warn',
            subject: name,
            detail: `${state} with ${queued} queued task${queued === 1 ? '' : 's'}`,
            since: agent.last_seen_at || null,
          });
        }
      }
    }
  }

  // Flag 6 — Budget breach: active budget at/over cap. Primary signal is the
  // derived `status: 'breached'` from GET /api/budgets; the pct_of_cap >=
  // BUDGET_BREACH_FRACTION×100 check is the payload fallback so a lagging or
  // missing status string cannot hide an at-cap budget. severity error,
  // subject = budget name, detail carries spend/cap/action (brief §3.7).
  if (budgets && Array.isArray(budgets)) {
    for (const budget of budgets) {
      const pct = Number(budget.pct_of_cap);
      const atCap = Number.isFinite(pct) && pct >= BUDGET_BREACH_FRACTION * 100;
      if (budget.status !== 'breached' && !atCap) continue;
      flags.push({
        type: 'budget_breach',
        severity: 'error',
        subject: budget.name || budget.id,
        detail: `${describeBudgetSpend(budget)} · ${budget.action_on_exceed || 'action unset'}`,
        since: budget.period_key || null,
      });
    }
  }

  return flags.slice(0, MAX_ANOMALY_FLAGS); // hard cap; types are a fixed set of 6 by construction
}

/**
 * Human spend-vs-cap fragment for budget flags/bars: "$12.50 of $10.00 cap"
 * for USD caps, "120,000 of 100,000 tokens" for token caps. Pure.
 */
function describeBudgetSpend(budget) {
  const spend = budget.current_spend || {};
  if (budget.cap_usd != null) {
    return `$${Number(spend.usd || 0).toFixed(2)} of $${Number(budget.cap_usd).toFixed(2)} cap`;
  }
  if (budget.cap_tokens != null) {
    return `${Number(spend.tokens || 0).toLocaleString('en-US')} of ${Number(budget.cap_tokens).toLocaleString('en-US')} tokens`;
  }
  return `spend $${Number(spend.usd || 0).toFixed(2)}`;
}

export const ANOMALY_FLAG_TYPES = Object.freeze([
  'stale_run',
  'zero_token_loop',
  'crash_loop_cron',
  'cost_spike',
  'idle_agent_queue',
  'budget_breach',
]);

// ── Fetch helper: never throws, GET-only, timeout-guarded ───────
function authHeaders() {
  return { 'Authorization': `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__ || ''}` };
}

async function fetchJSON(path, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(path, { method: 'GET', headers: authHeaders(), ...(ctrl ? { signal: ctrl.signal } : {}) });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !res.ok) {
      return { ok: false, status: res ? res.status : 0, data: null };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, status: res.status, data };
  } catch (_) {
    return { ok: false, status: 0, data: null };
  }
}

// ── View ────────────────────────────────────────────────────────
export async function renderMissionControlView({ mountNode, api, sync, navigateToView }) {
  ensureNativeRoot(mountNode, 'mission-control-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const style = document.createElement('style');
  style.textContent = `
    .mc-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:12px; }
    .mc-title { font-size:1.15rem;font-weight:600;display:flex;align-items:center;gap:8px; }
    .mc-poll-dot { width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block; }
    .mc-btn { padding:6px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.82rem;flex-shrink:0; }
    .mc-btn:hover { background:var(--win11-surface-active); }
    /* minmax(0,1fr) columns + min-width:0 panels: content can never widen a
       track, so the grid never hscrolls at the default 1180×780 window size */
    .mc-grid { flex:1;overflow-y:auto;overflow-x:hidden;padding:14px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-content:start; }
    .mc-panel { border:1px solid var(--win11-border);border-radius:10px;background:var(--win11-surface-solid);padding:12px;min-height:150px;min-width:0;display:flex;flex-direction:column;gap:8px;overflow:hidden; }
    .mc-panel-wide { grid-column:1 / span 1; }
    .mc-panel h3 { margin:0;font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--win11-text-secondary);display:flex;justify-content:space-between;align-items:center;gap:8px; }
    .mc-row { display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:0.85rem;padding:3px 0;min-width:0; }
    .mc-label { color:var(--win11-text-secondary);min-width:0;overflow-wrap:anywhere; }
    .mc-value { font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere; }
    /* Badge tones shared with health-view.mjs (.hv-status-badge) semantics:
       ok=green, warn=amber, error=red, neutral=muted — same rgba pairs. */
    .mc-badge { font-size:0.72rem;padding:2px 8px;border-radius:4px;font-weight:600;white-space:nowrap;flex-shrink:0; }
    .mc-badge.ok { background:rgba(34,197,94,0.15);color:#22c55e; }
    .mc-badge.warn { background:rgba(234,179,8,0.15);color:#eab308; }
    .mc-badge.error { background:rgba(239,68,68,0.15);color:#ef4444; }
    .mc-badge.neutral { background:rgba(148,163,184,0.15);color:var(--win11-text-secondary); }
    /* Distinct per-panel states: loading (pulsing), empty (muted italic),
       error (red-tinted) — never reuse one look for two meanings. */
    .mc-state { display:flex;align-items:center;gap:8px;font-size:0.82rem;padding:10px;border-radius:6px;min-width:0;overflow-wrap:anywhere; }
    .mc-state-loading { color:var(--win11-text-secondary);animation:mc-pulse 1.6s ease-in-out infinite; }
    .mc-state-empty { color:var(--win11-text-tertiary);font-style:italic;background:var(--win11-surface-active); }
    .mc-state-error { color:#ef4444;background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;font-weight:500; }
    @keyframes mc-pulse { 0%,100% { opacity:1; } 50% { opacity:0.45; } }
    .mc-flag { display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--win11-border);margin-bottom:6px;font-size:0.8rem;min-width:0; }
    .mc-flag-warn { border-left:3px solid #eab308; }
    .mc-flag-error { border-left:3px solid #ef4444; }
    .mc-flag-subject { font-weight:600;overflow-wrap:anywhere; }
    .mc-flag-detail { color:var(--win11-text-secondary);overflow-wrap:anywhere; }
    /* Budget bars (slice 3): track + fill with ok/warn/error tones matching
       .mc-badge semantics; head row keeps name + action badge on one line. */
    .mc-budget { display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid var(--win11-border);border-radius:6px;margin-top:6px;min-width:0; }
    .mc-budget-head { display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:0.8rem;min-width:0; }
    .mc-budget-name { font-weight:600;overflow-wrap:anywhere;min-width:0; }
    .mc-budget-track { height:6px;border-radius:3px;background:var(--win11-surface-active);overflow:hidden; }
    .mc-budget-fill { height:100%;border-radius:3px; }
    .mc-budget-fill.ok { background:#22c55e; }
    .mc-budget-fill.warn { background:#eab308; }
    .mc-budget-fill.error { background:#ef4444; }
    .mc-budget-sub { display:flex;justify-content:space-between;gap:8px;font-size:0.72rem;color:var(--win11-text-secondary);min-width:0;overflow-wrap:anywhere; }
    .mc-links { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px; }
    .mc-link-btn { padding:8px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-active);color:var(--win11-text);cursor:pointer;font-size:0.82rem;text-align:center;min-width:0; }
    .mc-link-btn:hover { border-color:var(--win11-accent,#60a5fa);background:var(--win11-accent-light); }
    .mc-footer { padding:8px 16px;border-top:1px solid var(--win11-border);font-size:0.75rem;color:var(--win11-text-tertiary);text-align:center;flex-shrink:0; }
    @media (max-width: 900px) { .mc-grid { grid-template-columns:minmax(0,1fr); } }
    @media (prefers-reduced-motion: reduce) { .mc-state-loading { animation:none; } }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'mc-header';
  header.innerHTML = `
    <div class="mc-title">🛰 Mission Control <span class="mc-poll-dot" title="polling"></span></div>
    <button id="mc-refresh" class="mc-btn" aria-label="Refresh all panels">↻ Refresh</button>
  `;
  root.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'mc-grid';
  root.appendChild(grid);

  const footer = document.createElement('div');
  footer.className = 'mc-footer';
  footer.textContent = 'Loading…';
  root.appendChild(footer);

  mountNode.appendChild(root);

  // Panel containers (independent modules — one failing never blanks others)
  const panels = {};
  for (const [key, title, wide] of [
    ['fleet', 'Fleet Status', false],
    ['anomalies', 'Anomaly Flags', false],
    ['runs', 'Blocked / Stale Runs', false],
    ['cost', 'Cost', false],
    ['cron', 'Cron Health', true],
    ['links', 'Quick Links', false],
  ]) {
    const panel = document.createElement('div');
    panel.className = 'mc-panel' + (wide ? ' mc-panel-wide' : '');
    panel.dataset.panel = key;
    const heading = document.createElement('h3');
    heading.innerHTML = `<span>${escapeHtml(title)}</span><span class="mc-panel-status" data-status></span>`;
    const body = document.createElement('div');
    body.className = 'mc-panel-body';
    body.innerHTML = '<div class="mc-state mc-state-loading">Loading…</div>';
    panel.appendChild(heading);
    panel.appendChild(body);
    grid.appendChild(panel);
    panels[key] = { el: panel, heading, body, hasData: false };
  }

  function setPanelStatus(key, text, tone = 'neutral') {
    const el = panels[key].heading.querySelector('[data-status]');
    if (el) el.innerHTML = text ? `<span class="mc-badge ${tone}">${escapeHtml(text)}</span>` : '';
  }

  // Distinct named states per panel (brief AC3/AC4): loading pulses, empty is
  // muted italic, error is red-tinted. One meaning = one look.
  function setPanelState(key, kind, message) {
    panels[key].hasData = false;
    panels[key].body.innerHTML = `<div class="mc-state mc-state-${kind}">${escapeHtml(message)}</div>`;
  }

  // R1 mitigation companion: when a poll fails but the panel still shows
  // last-good data, keep the data and flag it stale instead of blanking.
  function handlePanelFailure(key, message) {
    if (panels[key].hasData) {
      setPanelStatus(key, 'stale', 'warn');
    } else {
      setPanelState(key, 'error', message);
      setPanelStatus(key, 'down', 'error');
    }
  }

  // ── Shared polled state ──
  const state = {
    destroyed: false,
    fleet: null,
    runs: null,
    cron: null,
    cost: null,
    budgets: null,
    anomalies: [],
    lastSweep: null,
  };

  // ── Panel A: Fleet Status (30s) ──
  async function pollFleet() {
    const results = await Promise.allSettled([
      fetchJSON('/api/health-status'),
      fetchJSON('/api/openclaw/agents'),
      fetchJSON('/api/agents/status'),
      fetchJSON('/api/tasks?status=queued&limit=200'),
    ]);
    if (state.destroyed) return;
    const health = results[0].status === 'fulfilled' ? results[0].value : { ok: false };
    const cliAgents = results[1].status === 'fulfilled' ? results[1].value : { ok: false };
    const orgAgents = results[2].status === 'fulfilled' ? results[2].value : { ok: false };
    const queue = results[3].status === 'fulfilled' ? results[3].value : { ok: false };

    const dbAvailable = orgAgents.ok && queue.ok;
    if (!health.ok && !cliAgents.ok) {
      // Every fleet input down: named error state (AC4 — only this panel blanks).
      state.fleet = null;
      handlePanelFailure('fleet', 'Fleet unavailable — gateway not reachable');
      recomputeAnomalies();
      return;
    }
    state.fleet = {
      health: health.ok ? health.data : null,
      agents: cliAgents.ok && cliAgents.data?.agents ? cliAgents.data.agents : null,
      orgAgents: orgAgents.ok && orgAgents.data?.agents ? orgAgents.data.agents : null,
      queueTasks: queue.ok && queue.data?.tasks ? queue.data.tasks : null,
      dbAvailable,
    };
    renderFleet();
  }

  function classifyAgentState(agent) {
    const raw = String(agent.status || agent.state || 'offline').toLowerCase();
    if (raw === 'online' || raw === 'active' || raw === 'running') return 'active';
    if (raw === 'idle' || raw === 'recent') return 'idle';
    return 'offline';
  }

  function renderFleet() {
    const f = state.fleet;
    if (!f) { setPanelState('fleet', 'error', 'Fleet unavailable — gateway not reachable'); return; }
    const overall = f.health?.status || 'unknown';
    const overallTone = overall === 'healthy' || overall === 'ok' ? 'ok' : overall === 'degraded' ? 'warn' : 'error';
    const gatewayStatus = f.health?.gateway?.status || '—';
    const dbStatus = f.health?.database?.status || (f.dbAvailable ? 'ok' : 'unavailable');

    const cliAgents = f.agents || [];
    const active = cliAgents.filter(a => classifyAgentState(a) === 'active').length;
    const idle = cliAgents.filter(a => classifyAgentState(a) === 'idle').length;
    const offline = cliAgents.filter(a => classifyAgentState(a) === 'offline').length;
    const queueDepth = f.queueTasks ? f.queueTasks.length : null;

    panels.fleet.body.innerHTML = '';
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:6px;';
    stats.appendChild(createStatCard({ label: 'Overall', value: String(overall), tone: overallTone === 'ok' ? 'good' : overallTone === 'warn' ? 'neutral' : 'bad' }));
    stats.appendChild(createStatCard({ label: 'Gateway', value: String(gatewayStatus), tone: gatewayStatus === 'running' ? 'good' : 'neutral' }));
    stats.appendChild(createStatCard({ label: 'Database', value: String(dbStatus), tone: dbStatus === 'ok' ? 'good' : 'neutral' }));
    panels.fleet.body.appendChild(stats);

    const rows = [
      ['Agents', `${cliAgents.length} total · ${active} active`],
      ['Breakdown', cliAgents.length ? `▇ active:${active} idle:${idle} offline:${offline}` : 'gateway list unavailable'],
      ['Queue', queueDepth === null ? '—' : `${queueDepth} pending`],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'mc-row';
      row.innerHTML = `<span class="mc-label">${escapeHtml(label)}</span><span class="mc-value">${escapeHtml(value)}</span>`;
      panels.fleet.body.appendChild(row);
    }
    panels.fleet.hasData = true;
    setPanelStatus('fleet', f.dbAvailable ? 'live' : 'partial (no DB)', f.dbAvailable ? 'ok' : 'warn');
  }

  // ── Panel B: Blocked & Stale Runs (20s) ──
  async function pollRuns() {
    const results = await Promise.allSettled([
      fetchJSON('/api/workflow-runs?status=running&limit=50'),
      fetchJSON('/api/workflow-runs/stuck'),
      fetchJSON('/api/blockers/summary'),
      fetchJSON('/api/workflow-runs?status=failed&limit=10'),
    ]);
    if (state.destroyed) return;
    const running = results[0].status === 'fulfilled' ? results[0].value : { ok: false };
    const stuck = results[1].status === 'fulfilled' ? results[1].value : { ok: false };

    if (!running.ok) {
      state.runs = null;
      handlePanelFailure('runs', 'Runs unavailable — no database');
      recomputeAnomalies();
      return;
    }
    state.runs = {
      running: running.data?.runs || running.data || [],
      stuck: stuck.ok ? (stuck.data?.runs || stuck.data || []) : null,
      failed24h: results[3].status === 'fulfilled' && results[3].value.ok ? (results[3].value.data?.runs || []) : null,
      blockersSummary: results[2].status === 'fulfilled' && results[2].value.ok ? results[2].value.data : null,
    };
    renderRuns();
    recomputeAnomalies();
  }

  function renderRuns() {
    const r = state.runs;
    if (!r) { setPanelState('runs', 'error', 'Runs unavailable — no database'); return; }
    const runningList = Array.isArray(r.running) ? r.running : [];
    const failedList = Array.isArray(r.failed24h) ? r.failed24h : [];
    const blockedCount = Array.isArray(r.stuck)
      ? r.stuck.filter(x => x.status === 'blocked').length
      : Number(r.blockersSummary?.blocked ?? r.blockersSummary?.counts?.blocked ?? 0);

    // Distinct empty state: endpoint answered but there is genuinely nothing
    // running, blocked, or recently failed.
    if (!runningList.length && !blockedCount && !failedList.length) {
      setPanelState('runs', 'empty', 'No active or blocked runs.');
      setPanelStatus('runs', 'live', 'ok');
      return;
    }

    const now = Date.now();
    const parts = [];
    parts.push(`<div class="mc-row"><span class="mc-label">Running</span><span class="mc-value">${runningList.length}</span></div>`);
    parts.push(`<div class="mc-row"><span class="mc-label">Blocked</span><span class="mc-value">${escapeHtml(String(blockedCount))}</span></div>`);
    if (failedList.length) {
      parts.push(`<div class="mc-row"><span class="mc-label">Failed 24h</span><span class="mc-value">${failedList.length}</span></div>`);
    }
    for (const run of runningList.slice(0, 5)) {
      const startedMs = run.started_at ? now - new Date(run.started_at).getTime() : 0;
      const mins = Math.round(startedMs / 60000);
      const stale = mins >= STALE_RUN_MINUTES;
      parts.push(`<div class="mc-row"><span class="mc-label">• ${escapeHtml(run.workflow_type || run.id)}</span><span class="mc-badge ${stale ? 'warn' : 'neutral'}">${escapeHtml(`${run.status} ${mins}m${stale ? '⚠' : ''}`)}</span></div>`);
    }
    panels.runs.body.innerHTML = parts.join('');
    panels.runs.hasData = true;
    setPanelStatus('runs', 'live', 'ok');
  }

  // ── Panel C: Cron Health (60s) ──
  async function pollCron() {
    const jobsRes = await fetchJSON('/api/cron/jobs');
    if (state.destroyed) return;
    if (!jobsRes.ok) {
      state.cron = null;
      handlePanelFailure('cron', 'Cron unavailable — openclaw CLI not reachable');
      return;
    }
    const jobs = jobsRes.data?.jobs || [];

    // Lazy detail: consecutive-failure counting only for already-failed jobs,
    // capped at MAX_CRON_DETAIL_LOOKUPS lookups per sweep.
    const failedJobs = jobs.filter(j => j.status === 'failed').slice(0, MAX_CRON_DETAIL_LOOKUPS);
    await Promise.allSettled(failedJobs.map(async job => {
      const detail = await fetchJSON(`/api/cron/jobs/${encodeURIComponent(job.id)}/runs`);
      if (state.destroyed || !detail.ok) return;
      const runs = detail.data?.runs || [];
      let consecutive = 0;
      for (const run of runs) {
        const status = String(run.status || '').toLowerCase();
        if (status === 'failed') consecutive++;
        else break;
      }
      job.consecutiveFailures = Math.max(consecutive, 1);
    }));

    const diagSummary = await fetchJSON('/api/diagnostics/summary');
    if (state.destroyed) return;
    const diagFailures = await fetchJSON('/api/diagnostics/failures');
    if (state.destroyed) return;

    state.cron = {
      jobs,
      summary: diagSummary.ok ? diagSummary.data : null,
      failures: diagFailures.ok ? (diagFailures.data?.failures || []) : null,
    };
    renderCron();
    recomputeAnomalies();
  }

  function renderCron() {
    const c = state.cron;
    if (!c) { setPanelState('cron', 'error', 'Cron unavailable — openclaw CLI not reachable'); return; }
    const jobs = c.jobs || [];
    if (!jobs.length) {
      setPanelState('cron', 'empty', 'No cron jobs configured.');
      setPanelStatus('cron', 'live', 'ok');
      return;
    }
    const enabled = jobs.filter(j => j.enabled !== false).length;
    const failingJobs = jobs.filter(j => j.status === 'failed');
    const summary = c.summary || {};
    const nextJob = jobs
      .filter(j => j.enabled !== false && j.nextRun)
      .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun))[0];
    const nextIn = nextJob ? Math.max(0, Math.round((new Date(nextJob.nextRun).getTime() - Date.now()) / 60000)) : null;

    const parts = [];
    parts.push(`<div class="mc-row"><span class="mc-label">Jobs</span><span class="mc-value">${enabled} enabled · ${failingJobs.length} failing</span></div>`);
    if (nextJob) {
      parts.push(`<div class="mc-row"><span class="mc-label">Next</span><span class="mc-value">${escapeHtml(nextJob.name)} in ${nextIn}m</span></div>`);
    }
    for (const job of failingJobs.slice(0, 3)) {
      parts.push(`<div class="mc-row"><span class="mc-label">⚠ ${escapeHtml(job.name || job.id)}</span><span class="mc-badge error">failed${job.consecutiveFailures ? ` ${job.consecutiveFailures}x` : ''}</span></div>`);
    }
    parts.push(`<div class="mc-row"><span class="mc-label">File-based health</span><span class="mc-value">${escapeHtml(`healthy:${summary.healthy ?? '—'} failing:${summary.failing ?? '—'} stale:${summary.stale ?? '—'} silenced:${summary.silenced ?? '—'}`)}</span></div>`);
    panels.cron.body.innerHTML = parts.join('');
    panels.cron.hasData = true;
    setPanelStatus('cron', 'live', 'ok');
  }

  // ── Panel D: Cost Today / 7d (120s) + budget bars (slice 3) ──
  async function pollCost() {
    // Budgets ride the same poll: one extra GET, degraded independently —
    // a budgets failure never blanks the cost rows (AC10).
    const [costSettled, budgetsSettled] = await Promise.allSettled([
      fetchJSON('/api/costs/summary?days=7'),
      fetchJSON('/api/budgets'),
    ]);
    if (state.destroyed) return;
    const res = costSettled.status === 'fulfilled' ? costSettled.value : { ok: false };
    if (!res.ok) {
      state.cost = null;
      state.budgets = null;
      handlePanelFailure('cost', 'Cost unavailable — no database');
      recomputeAnomalies();
      return;
    }
    if (res.data && res.data.available === false) {
      state.cost = null;
      state.budgets = null;
      handlePanelFailure('cost', 'Cost unavailable — no database');
      recomputeAnomalies();
      return;
    }
    state.cost = res.data;
    const budgetsRes = budgetsSettled.status === 'fulfilled' ? budgetsSettled.value : { ok: false };
    state.budgets = budgetsRes.ok && budgetsRes.data && budgetsRes.data.available === true
      && Array.isArray(budgetsRes.data.budgets)
      ? budgetsRes.data.budgets
      : null; // absent / unavailable → no section, panel keeps its own states
    renderCost();
    recomputeAnomalies();
  }

  function renderCost() {
    const c = state.cost;
    if (!c) { setPanelState('cost', 'error', 'Cost unavailable — no database'); return; }

    // Three-way distinction: error above (endpoint/DB down), empty here
    // (endpoint healthy, migration-022 history simply not accumulated yet),
    // real rows below. "No data" must never read as an outage.
    const hasSpend = Number(c.today?.cost || 0) > 0
      || (c.days || []).some(d => Number(d.cost || 0) !== 0)
      || Boolean(c.top_run);
    if (!hasSpend) {
      // Empty cost ≠ absent budgets: token-capped budgets can breach with
      // zero cost_estimate, so bars still render under the empty-state line.
      panels.cost.body.innerHTML = '<div class="mc-state mc-state-empty">No cost data recorded yet.</div>'
        + renderBudgetBars(state.budgets);
      setPanelStatus('cost', 'live', 'ok');
      return;
    }

    const fmt = n => `$${Number(n || 0).toFixed(2)}`;
    const historyDays = (c.days || []).filter(d => d.date !== currentLocalTodayKey());
    const spikeRatio = (() => {
      if (historyDays.length < COST_SPIKE_MIN_HISTORY_DAYS) return null;
      const mean = historyDays.reduce((s, d) => s + Number(d.cost || 0), 0) / historyDays.length;
      if (!(mean > 0)) return null;
      return Number(c.today?.cost || 0) / mean;
    })();

    const parts = [];
    parts.push(`<div class="mc-row"><span class="mc-label">Today</span><span class="mc-value">${escapeHtml(fmt(c.today?.cost))}${spikeRatio && spikeRatio > COST_SPIKE_MULTIPLIER ? ` <span class="mc-badge error">▲ spike ${spikeRatio.toFixed(1)}×</span>` : ''}</span></div>`);
    parts.push(`<div class="mc-row"><span class="mc-label">7-day total</span><span class="mc-value">${escapeHtml(fmt(c.total_window))}</span></div>`);
    parts.push(`<div class="mc-row"><span class="mc-label">7-day avg/day</span><span class="mc-value">${escapeHtml(fmt(c.avg_daily_7d))}</span></div>`);
    if (c.top_run) {
      parts.push(`<div class="mc-row"><span class="mc-label">Top run</span><span class="mc-value">${escapeHtml(c.top_run.workflow_type)} ${escapeHtml(fmt(c.top_run.cost))}</span></div>`);
    }
    panels.cost.body.innerHTML = parts.join('') + renderBudgetBars(state.budgets);
    panels.cost.hasData = true;
    setPanelStatus('cost', 'live', 'ok');
  }

  /**
   * Budget bars under the today/7d block (brief §3.7): burn vs cap with
   * green/amber/red tones — amber above BUDGET_WARN_FRACTION, red at breach
   * (status 'breached' or pct >= BUDGET_BREACH_FRACTION×100). Absent or
   * unavailable payloads render NO section (AC10); zero defined budgets are
   * equally silent (feature inert until first POST).
   */
  function renderBudgetBars(budgets) {
    if (!budgets || !budgets.length) return '';
    return budgets.map((b) => {
      const pct = Number(b.pct_of_cap);
      const breached = b.status === 'breached' || (Number.isFinite(pct) && pct >= BUDGET_BREACH_FRACTION * 100);
      const amber = !breached && Number.isFinite(pct) && pct > BUDGET_WARN_FRACTION * 100;
      const tone = breached ? 'error' : amber ? 'warn' : 'ok';
      const width = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
      const pctLabel = Number.isFinite(pct) ? `${Math.round(pct)}%` : '—';
      const badge = b.action_on_exceed && b.action_on_exceed !== 'warn'
        ? `<span class="mc-badge ${breached ? 'error' : 'neutral'}">${escapeHtml(b.action_on_exceed)}</span>`
        : '';
      return `
        <div class="mc-budget">
          <div class="mc-budget-head">
            <span class="mc-budget-name">${escapeHtml(b.name || b.id)}</span>
            ${badge}
          </div>
          <div class="mc-budget-track"><div class="mc-budget-fill ${tone}" style="width:${width}%"></div></div>
          <div class="mc-budget-sub">
            <span>${escapeHtml(describeBudgetSpend(b))}</span>
            <span>${escapeHtml(pctLabel)} · ${escapeHtml(b.period_key || b.period || '')}</span>
          </div>
        </div>`;
    }).join('');
  }

  function currentLocalTodayKey() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  // ── Panel E: Anomaly Flags (recomputed on each runs poll) ──
  function recomputeAnomalies() {
    state.anomalies = computeAnomalies({
      fleet: state.fleet ? { agents: state.fleet.orgAgents || [], queueTasks: state.fleet.queueTasks || [] } : null,
      runs: state.runs ? { running: state.runs.running || [] } : null,
      cron: state.cron ? { jobs: state.cron.jobs || [], failures: state.cron.failures || [] } : null,
      cost: state.cost,
      budgets: state.budgets,
    });
    renderAnomalies();
  }

  function renderAnomalies() {
    const inputsDown = !state.fleet && !state.runs && !state.cron && !state.cost;
    setPanelStatus('anomalies', `${state.anomalies.length} active`, state.anomalies.length ? 'warn' : 'ok');
    if (inputsDown) {
      // All inputs down is a degraded condition, so it uses the error look —
      // distinct from the calm "no anomalies detected" empty state.
      setPanelState('anomalies', 'error', 'No anomalies detectable (inputs unavailable)');
      return;
    }
    if (!state.anomalies.length) {
      setPanelState('anomalies', 'empty', 'No anomalies detected.');
      return;
    }
    const parts = state.anomalies.map(flag => `
      <div class="mc-flag mc-flag-${flag.severity}">
        <span class="mc-flag-subject">${escapeHtml(flag.type)} · ${escapeHtml(String(flag.subject))}</span>
        <span class="mc-flag-detail">${escapeHtml(flag.detail)}</span>
      </div>
    `);
    panels.anomalies.body.innerHTML = parts.join('');
    panels.anomalies.hasData = true;
  }

  // ── Panel F: Quick Links (static) ──
  const QUICK_LINK_TARGETS = [
    ['health', 'Health'],
    ['diagnostics', 'Diagnostics'],
    ['cron', 'Cron'],
    ['workflows', 'Workflows'],
    ['agents', 'Agents'],
    ['sessions', 'Sessions'],
    ['approvals', 'Approvals'],
    ['audit', 'Audit'],
  ];
  function renderLinks() {
    const wrap = document.createElement('div');
    wrap.className = 'mc-links';
    for (const [viewId, label] of QUICK_LINK_TARGETS) {
      const btn = document.createElement('button');
      btn.className = 'mc-link-btn';
      btn.dataset.targetView = viewId;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        navigateToView?.(viewId);
      });
      wrap.appendChild(btn);
    }
    panels.links.body.innerHTML = '';
    panels.links.body.appendChild(wrap);
    setPanelStatus('links', '', 'neutral');
  }

  function updateFooter() {
    const t = state.lastSweep ? new Date(state.lastSweep).toLocaleTimeString() : '—';
    footer.textContent = `Last full sweep ${t} · all panels degrade independently`;
  }

  // ── Poll scheduling ──
  const timers = [];
  function schedule(fn, intervalMs) {
    const tick = async () => {
      try {
        await fn();
      } catch (err) {
        console.error('[MissionControl] panel poll failed:', err);
      }
      if (!state.destroyed) updateFooter();
    };
    tick();
    timers.push(setInterval(tick, intervalMs));
  }

  schedule(pollFleet, FLEET_POLL_MS);
  schedule(pollRuns, RUNS_POLL_MS);
  schedule(pollCron, CRON_POLL_MS);
  schedule(pollCost, COST_POLL_MS);
  renderLinks();

  root.querySelector('#mc-refresh').addEventListener('click', async () => {
    await Promise.allSettled([pollFleet(), pollRuns(), pollCron(), pollCost()]);
    updateFooter();
  });

  updateFooter();

  // Teardown: clear every poll timer (AC6 — no post-close fetches)
  return () => {
    state.destroyed = true;
    for (const timer of timers) clearInterval(timer);
    timers.length = 0;
  };
}

export default renderMissionControlView;
