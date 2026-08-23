import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

// ── Tunables (brief §4) ─────────────────────────────────────────
export const STALE_RUN_MINUTES = 15;
export const ZERO_TOKEN_MINUTES = 10;
const FLEET_POLL_MS = 30000;
const RUNS_POLL_MS = 20000;   // aligned with realtime-sync.mjs SYNC_INTERVAL_MS
const CRON_POLL_MS = 60000;
const COST_POLL_MS = 120000;
const FETCH_TIMEOUT_MS = 5000; // R1 mitigation: CLI-backed endpoints have no SLA
const MAX_CRON_DETAIL_LOOKUPS = 3;

// ── Anomaly engine (pure, exported for unit tests) ──────────────
// Inputs (all optional; missing inputs skip their flags silently):
//   fleet = { agents: [{name, status}], queueTasks: [{assignee, status}] }
//   runs  = { running: [runRow] }
//   cron  = { jobs: [{id, name, status, consecutiveFailures}],
//             failures: [{id, name, failureType, failureCount}] }
//   cost  = { available: true, today: {cost}, days: [{date, cost}] }
// Output: Flag[] where Flag = {type, severity, subject, detail, since}
export function computeAnomalies({ fleet = null, runs = null, cron = null, cost = null, now = Date.now() } = {}) {
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
      if (consecutive >= 2) {
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
      if (Number(failure.failureCount || 0) < 2) continue;
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
    if (history.length >= 3) {
      const mean = history.reduce((sum, d) => sum + Number(d.cost || 0), 0) / history.length;
      const todayCost = Number(cost.today.cost || 0);
      if (mean > 0 && todayCost > 2 * mean) {
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

  return flags.slice(0, 25); // hard cap; types are fixed at 5 by construction
}

export const ANOMALY_FLAG_TYPES = Object.freeze([
  'stale_run',
  'zero_token_loop',
  'crash_loop_cron',
  'cost_spike',
  'idle_agent_queue',
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
    .mc-grid { flex:1;overflow-y:auto;padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px;align-content:start; }
    .mc-panel { border:1px solid var(--win11-border);border-radius:10px;background:var(--win11-surface-solid);padding:12px;min-height:150px;display:flex;flex-direction:column;gap:8px;overflow:hidden; }
    .mc-panel-wide { grid-column:1 / span 1; }
    .mc-panel h3 { margin:0;font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--win11-text-secondary);display:flex;justify-content:space-between;align-items:center; }
    .mc-row { display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;padding:3px 0; }
    .mc-label { color:var(--win11-text-secondary); }
    .mc-value { font-weight:600; }
    .mc-badge { font-size:0.72rem;padding:2px 8px;border-radius:4px;font-weight:600;white-space:nowrap; }
    .mc-badge.ok { background:rgba(34,197,94,0.15);color:#22c55e; }
    .mc-badge.warn { background:rgba(234,179,8,0.15);color:#eab308; }
    .mc-badge.error { background:rgba(239,68,68,0.15);color:#ef4444; }
    .mc-badge.neutral { background:rgba(148,163,184,0.15);color:var(--win11-text-secondary); }
    .mc-unavailable { font-size:0.82rem;color:var(--win11-text-tertiary);font-style:italic;padding:8px 0; }
    .mc-flag { display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:6px;border:1px solid var(--win11-border);margin-bottom:6px;font-size:0.8rem; }
    .mc-flag-warn { border-left:3px solid #eab308; }
    .mc-flag-error { border-left:3px solid #ef4444; }
    .mc-flag-subject { font-weight:600; }
    .mc-flag-detail { color:var(--win11-text-secondary); }
    .mc-links { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
    .mc-link-btn { padding:8px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-active);color:var(--win11-text);cursor:pointer;font-size:0.82rem;text-align:center; }
    .mc-link-btn:hover { border-color:var(--win11-accent,#60a5fa); }
    .mc-footer { padding:8px 16px;border-top:1px solid var(--win11-border);font-size:0.75rem;color:var(--win11-text-tertiary);text-align:center;flex-shrink:0; }
    @media (max-width: 900px) { .mc-grid { grid-template-columns:1fr; } }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'mc-header';
  header.innerHTML = `
    <div class="mc-title">🛰 Mission Control <span class="mc-poll-dot" title="polling"></span></div>
    <button id="mc-refresh" class="mc-link-btn" style="width:auto;" aria-label="Refresh all panels">↻ Refresh</button>
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
    body.innerHTML = '<div class="mc-unavailable">Loading…</div>';
    panel.appendChild(heading);
    panel.appendChild(body);
    grid.appendChild(panel);
    panels[key] = { el: panel, heading, body };
  }

  function setPanelStatus(key, text, tone = 'neutral') {
    const el = panels[key].heading.querySelector('[data-status]');
    if (el) el.innerHTML = text ? `<span class="mc-badge ${tone}">${escapeHtml(text)}</span>` : '';
  }

  function setPanelUnavailable(key, reason) {
    panels[key].body.innerHTML = `<div class="mc-unavailable">${escapeHtml(reason)}</div>`;
  }

  // ── Shared polled state ──
  const state = {
    destroyed: false,
    fleet: null,
    runs: null,
    cron: null,
    cost: null,
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
    if (!f) { setPanelUnavailable('fleet', 'Fleet unavailable'); return; }
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
      setPanelUnavailable('runs', 'Runs unavailable — no database');
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
    if (!r) { setPanelUnavailable('runs', 'Runs unavailable — no database'); return; }
    const runningList = Array.isArray(r.running) ? r.running : [];
    const failedList = Array.isArray(r.failed24h) ? r.failed24h : [];
    const blockedCount = Array.isArray(r.stuck)
      ? r.stuck.filter(x => x.status === 'blocked').length
      : Number(r.blockersSummary?.blocked ?? r.blockersSummary?.counts?.blocked ?? 0);

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
    setPanelStatus('runs', 'live', 'ok');
  }

  // ── Panel C: Cron Health (60s) ──
  async function pollCron() {
    const jobsRes = await fetchJSON('/api/cron/jobs');
    if (state.destroyed) return;
    if (!jobsRes.ok) {
      state.cron = null;
      setPanelUnavailable('cron', 'Cron unavailable — CLI not reachable');
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
    if (!c) { setPanelUnavailable('cron', 'Cron unavailable'); return; }
    const jobs = c.jobs || [];
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
    setPanelStatus('cron', 'live', 'ok');
  }

  // ── Panel D: Cost Today / 7d (120s) ──
  async function pollCost() {
    const res = await fetchJSON('/api/costs/summary?days=7');
    if (state.destroyed) return;
    if (!res.ok) {
      state.cost = null;
      setPanelUnavailable('cost', 'Cost unavailable — no database');
      recomputeAnomalies();
      return;
    }
    if (res.data && res.data.available === false) {
      state.cost = null;
      setPanelUnavailable('cost', 'Cost unavailable — no database');
      recomputeAnomalies();
      return;
    }
    state.cost = res.data;
    renderCost();
    recomputeAnomalies();
  }

  function renderCost() {
    const c = state.cost;
    if (!c) { setPanelUnavailable('cost', 'Cost unavailable — no database'); return; }
    const fmt = n => `$${Number(n || 0).toFixed(2)}`;
    const historyDays = (c.days || []).filter(d => d.date !== currentLocalTodayKey());
    const spikeRatio = (() => {
      if (historyDays.length < 3) return null;
      const mean = historyDays.reduce((s, d) => s + Number(d.cost || 0), 0) / historyDays.length;
      if (!(mean > 0)) return null;
      return Number(c.today?.cost || 0) / mean;
    })();

    const parts = [];
    parts.push(`<div class="mc-row"><span class="mc-label">Today</span><span class="mc-value">${escapeHtml(fmt(c.today?.cost))}${spikeRatio && spikeRatio > 2 ? ` <span class="mc-badge error">▲ spike ${spikeRatio.toFixed(1)}×</span>` : ''}</span></div>`);
    parts.push(`<div class="mc-row"><span class="mc-label">7-day total</span><span class="mc-value">${escapeHtml(fmt(c.total_window))}</span></div>`);
    parts.push(`<div class="mc-row"><span class="mc-label">7-day avg/day</span><span class="mc-value">${escapeHtml(fmt(c.avg_daily_7d))}</span></div>`);
    if (c.top_run) {
      parts.push(`<div class="mc-row"><span class="mc-label">Top run</span><span class="mc-value">${escapeHtml(c.top_run.workflow_type)} ${escapeHtml(fmt(c.top_run.cost))}</span></div>`);
    }
    panels.cost.body.innerHTML = parts.join('');
    setPanelStatus('cost', 'live', 'ok');
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
    });
    renderAnomalies();
  }

  function renderAnomalies() {
    const inputsDown = !state.fleet && !state.runs && !state.cron && !state.cost;
    setPanelStatus('anomalies', `${state.anomalies.length} active`, state.anomalies.length ? 'warn' : 'ok');
    if (inputsDown) {
      setPanelUnavailable('anomalies', 'No anomalies detectable (inputs unavailable)');
      return;
    }
    if (!state.anomalies.length) {
      panels.anomalies.body.innerHTML = '<div class="mc-unavailable">No anomalies detected.</div>';
      return;
    }
    const parts = state.anomalies.map(flag => `
      <div class="mc-flag mc-flag-${flag.severity}">
        <span class="mc-flag-subject">${escapeHtml(flag.type)} · ${escapeHtml(String(flag.subject))}</span>
        <span class="mc-flag-detail">${escapeHtml(flag.detail)}</span>
      </div>
    `);
    panels.anomalies.body.innerHTML = parts.join('');
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
