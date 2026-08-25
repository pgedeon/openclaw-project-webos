import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

/**
 * Budgets management view (budget-ledger brief §6 slice 4, roadmap review #3
 * candidate 3): dedicated CRUD window over the shipped GET/POST/PATCH
 * /api/budgets + GET /api/budgets/:id/ledger routes. Mission Control stays
 * read-only; this view is where operators define, tune, and retire budgets.
 *
 * Zero-throw degradation contract (brief §5): every fetch is wrapped,
 * `{available:false}` payloads render a named unavailable panel state, and no
 * code path above reaches into the DOM before mountNode exists.
 *
 * Bar/tone semantics reuse Mission Control's budget bars exactly:
 * amber above BUDGET_WARN_FRACTION, red at/over BUDGET_BREACH_FRACTION
 * (exactly-at-cap IS a breach, matching lib/budget-eval.js decisionFor >=).
 */

// Kept in lockstep with src/shell/native-views/mission-control-view.mjs —
// changing one without the other splits the operator color contract.
export const BUDGET_WARN_FRACTION = 0.75;
export const BUDGET_BREACH_FRACTION = 1;

// Mirrors routes/budget-routes.js enums verbatim (single source would cross
// the CJS/ESM boundary; the test suite pins the two tables to each other).
export const BUDGET_SCOPES = ['agent', 'department', 'project', 'fleet'];
export const BUDGET_PERIODS = ['daily', 'weekly', 'monthly'];
export const BUDGET_ACTIONS = ['warn', 'pause_new_runs', 'hard_stop'];

const POLL_MS = 60000;
const FETCH_TIMEOUT_MS = 8000;

// ── Pure helpers (exported for DB-free tests) ───────────────────

/**
 * Client-side mirror of routes/budget-routes.js validateCreatePayload(),
 * fed from the create-form shape instead of the raw API body:
 *   form = { name, scope, scope_id, period, cap_unit:'usd'|'tokens',
 *            cap_value, action_on_exceed }
 * Returns { ok:true, payload } ready for POST /api/budgets, or
 * { ok:false, errors } whose messages carry the API's own wording so the
 * operator never sees a client rule the server does not enforce (and vice
 * versa: the XOR rule is surfaced as "exactly one cap" via the unit toggle).
 */
export function validateBudgetForm(form = {}) {
  const errors = [];
  const name = typeof form.name === 'string' ? form.name.trim() : '';
  if (!name) errors.push('name is required');

  if (!BUDGET_SCOPES.includes(form.scope)) {
    errors.push(`scope must be one of: ${BUDGET_SCOPES.join(', ')}`);
  }
  if (!BUDGET_PERIODS.includes(form.period)) {
    errors.push(`period must be one of: ${BUDGET_PERIODS.join(', ')}`);
  }
  if (!BUDGET_ACTIONS.includes(form.action_on_exceed)) {
    errors.push(`action_on_exceed must be one of: ${BUDGET_ACTIONS.join(', ')}`);
  }

  // fleet ⇒ scope_id NULL; every other scope requires a target id.
  let scopeId = typeof form.scope_id === 'string' ? form.scope_id.trim() : '';
  if (form.scope === 'fleet') {
    scopeId = null;
  } else if (BUDGET_SCOPES.includes(form.scope) && !scopeId) {
    errors.push('scope_id is required for non-fleet scopes');
  }

  // Cap XOR via unit toggle: empty value = neither cap (rejected), and the
  // value must satisfy the chosen unit's server rule (usd: finite > 0;
  // tokens: positive integer).
  const raw = form.cap_value;
  const hasCap = raw !== undefined && raw !== null && String(raw).trim() !== '';
  if (!hasCap) {
    errors.push('exactly one of cap_usd / cap_tokens is required (XOR)');
  }
  let capUsd = null;
  let capTokens = null;
  if (hasCap && form.cap_unit === 'tokens') {
    capTokens = Number(raw);
    if (!Number.isInteger(capTokens) || capTokens <= 0) errors.push('cap_tokens must be a positive integer');
  } else if (hasCap) {
    capUsd = Number(raw);
    if (!Number.isFinite(capUsd) || capUsd <= 0) errors.push('cap_usd must be a positive number');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      name,
      scope: form.scope,
      scope_id: scopeId,
      period: form.period,
      cap_usd: capUsd,
      cap_tokens: capTokens,
      action_on_exceed: form.action_on_exceed,
    },
  };
}

/**
 * Percent of cap used, mirroring lib/budget-eval.js pctOfCap() over the
 * list payload's derived current_spend block. Null when no cap is set.
 */
export function spendPercent(budget) {
  const spend = budget && budget.current_spend ? budget.current_spend : {};
  const capUsd = budget == null ? null : (budget.cap_usd == null ? null : Number(budget.cap_usd));
  const capTokens = budget == null ? null : (budget.cap_tokens == null ? null : Number(budget.cap_tokens));
  if (capUsd != null && capUsd > 0) {
    return Math.round(((Number(spend.usd || 0)) / capUsd) * 10000) / 100;
  }
  if (capTokens != null && capTokens > 0) {
    return Math.round(((Number(spend.tokens || 0)) / capTokens) * 10000) / 100;
  }
  return null;
}

/**
 * Bar tone from pct + derived status — same boundary semantics as Mission
 * Control's renderBudgetBars(): 'error' when breached (status or pct >= 100%),
 * 'warn' strictly above 75%, else 'ok'. Non-finite pct renders green ('ok')
 * because an uncapped budget cannot breach.
 */
export function budgetTone(pct, status) {
  const p = Number(pct);
  if (status === 'breached' || (Number.isFinite(p) && p >= BUDGET_BREACH_FRACTION * 100)) return 'error';
  if (Number.isFinite(p) && p > BUDGET_WARN_FRACTION * 100) return 'warn';
  return 'ok';
}

/** Human spend-vs-cap fragment ("$12.50 of $10.00 cap" / token counts). */
export function describeSpend(budget) {
  const spend = (budget && budget.current_spend) || {};
  if (budget && budget.cap_usd != null) {
    return `$${Number(spend.usd || 0).toFixed(2)} of $${Number(budget.cap_usd).toFixed(2)} cap`;
  }
  if (budget && budget.cap_tokens != null) {
    return `${Number(spend.tokens || 0).toLocaleString('en-US')} of ${Number(budget.cap_tokens).toLocaleString('en-US')} tokens`;
  }
  return `spend $${Number(spend.usd || 0).toFixed(2)}`;
}

// ── Fetch helper: never throws, bearer-authed, timeout-guarded ──
function authHeaders(extra = {}) {
  return { 'Authorization': `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__ || ''}`, ...extra };
}

async function fetchJSON(path, { method = 'GET', body = null, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: authHeaders(body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(body != null ? { body: JSON.stringify(body) } : {}),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (_) {
    return { ok: false, status: 0, data: null };
  }
}

// ── View ────────────────────────────────────────────────────────
export async function renderBudgetsView({ mountNode }) {
  ensureNativeRoot(mountNode, 'budgets-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const style = document.createElement('style');
  style.textContent = `
    .bgv-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap; }
    .bgv-title { font-size:1.15rem;font-weight:600;display:flex;align-items:center;gap:8px;min-width:0; }
    .bgv-btn { padding:6px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.82rem;flex-shrink:0; }
    .bgv-btn:hover { background:var(--win11-surface-active); }
    .bgv-btn.primary { border-color:var(--win11-accent,#60a5fa);background:var(--win11-accent-light); }
    .bgv-btn.danger { color:#ef4444;border-color:rgba(239,68,68,0.4); }
    .bgv-btn:disabled { opacity:0.5;cursor:not-allowed; }
    .bgv-content { flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;min-height:0; }
    /* Named panel states — same three-look discipline as mission-control */
    .bgv-state { display:flex;flex-direction:column;gap:6px;align-items:center;justify-content:center;font-size:0.85rem;padding:28px;border-radius:8px;text-align:center;min-width:0;overflow-wrap:anywhere; }
    .bgv-state-loading { color:var(--win11-text-secondary);animation:bgv-pulse 1.6s ease-in-out infinite; }
    .bgv-state-empty { color:var(--win11-text-tertiary);font-style:italic;background:var(--win11-surface-active); }
    .bgv-state-error { color:#ef4444;background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;font-weight:500;font-style:normal; }
    @keyframes bgv-pulse { 0%,100% { opacity:1; } 50% { opacity:0.45; } }
    .bgv-badge { font-size:0.72rem;padding:2px 8px;border-radius:4px;font-weight:600;white-space:nowrap;flex-shrink:0; }
    .bgv-badge.ok { background:rgba(34,197,94,0.15);color:#22c55e; }
    .bgv-badge.warn { background:rgba(234,179,8,0.15);color:#eab308; }
    .bgv-badge.error { background:rgba(239,68,68,0.15);color:#ef4444; }
    .bgv-badge.neutral { background:rgba(148,163,184,0.15);color:var(--win11-text-secondary); }
    .bgv-card { border:1px solid var(--win11-border);border-radius:10px;background:var(--win11-surface-solid);padding:12px;display:flex;flex-direction:column;gap:6px;min-width:0; }
    .bgv-card.inactive { opacity:0.65; }
    .bgv-card-head { display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;min-width:0; }
    .bgv-name { font-weight:600;font-size:0.92rem;overflow-wrap:anywhere;min-width:0; }
    .bgv-meta { display:flex;gap:8px;flex-wrap:wrap;font-size:0.75rem;color:var(--win11-text-secondary);min-width:0;overflow-wrap:anywhere; }
    .bgv-track { height:6px;border-radius:3px;background:var(--win11-surface-active);overflow:hidden; }
    .bgv-fill { height:100%;border-radius:3px; }
    .bgv-fill.ok { background:#22c55e; }
    .bgv-fill.warn { background:#eab308; }
    .bgv-fill.error { background:#ef4444; }
    .bgv-sub { display:flex;justify-content:space-between;gap:8px;font-size:0.75rem;color:var(--win11-text-secondary);min-width:0;overflow-wrap:anywhere; }
    .bgv-actions { display:flex;gap:6px;flex-wrap:wrap;margin-top:2px; }
    .bgv-form { border:1px solid var(--win11-accent,#60a5fa);border-radius:10px;background:var(--win11-surface-solid);padding:14px;display:flex;flex-direction:column;gap:10px; }
    .bgv-form-grid { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px; }
    .bgv-field { display:flex;flex-direction:column;gap:4px;min-width:0; }
    .bgv-field label { font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--win11-text-secondary); }
    .bgv-field input, .bgv-field select { padding:7px 9px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.85rem;outline:none;width:100%;box-sizing:border-box; }
    .bgv-field input:focus, .bgv-field select:focus { border-color:var(--win11-accent,#60a5fa); }
    .bgv-field input:disabled, .bgv-field select:disabled { opacity:0.5; }
    .bgv-errors { display:flex;flex-direction:column;gap:4px;font-size:0.8rem;color:#ef4444;background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;padding:8px 10px;border-radius:5px; }
    .bgv-hint { font-size:0.72rem;color:var(--win11-text-tertiary);overflow-wrap:anywhere; }
    .bgv-ledger { border-top:1px dashed var(--win11-border);margin-top:4px;padding-top:8px;display:flex;flex-direction:column;gap:6px;min-width:0; }
    .bgv-event { display:flex;gap:8px;align-items:baseline;font-size:0.78rem;min-width:0;overflow-wrap:anywhere; }
    .bgv-event-time { color:var(--win11-text-tertiary);white-space:nowrap;flex-shrink:0; }
    .bgv-event-detail { color:var(--win11-text-secondary);overflow-wrap:anywhere;min-width:0; }
    .bgv-footer { padding:8px 16px;border-top:1px solid var(--win11-border);font-size:0.75rem;color:var(--win11-text-tertiary);text-align:center;flex-shrink:0; }
    @media (max-width: 760px) { .bgv-form-grid { grid-template-columns:minmax(0,1fr); } }
    @media (prefers-reduced-motion: reduce) { .bgv-state-loading { animation:none; } }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'bgv-header';
  header.innerHTML = `
    <div class="bgv-title">💰 Budgets <span id="bgvStatus"></span></div>
    <div style="display:flex;gap:8px;">
      <button id="bgvRefresh" class="bgv-btn" aria-label="Refresh budgets">↻ Refresh</button>
      <button id="bgvNew" class="bgv-btn primary">＋ New Budget</button>
    </div>
  `;
  root.appendChild(header);

  const content = document.createElement('div');
  content.className = 'bgv-content';
  content.innerHTML = '<div class="bgv-state bgv-state-loading">Loading budgets…</div>';
  root.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'bgv-footer';
  footer.textContent = 'Spend derives live from workflow_runs (migration-022 columns); enforcement runs at dispatch time.';
  root.appendChild(footer);

  mountNode.appendChild(root);

  const state = {
    destroyed: false,
    budgets: null,        // array | null (unavailable)
    unavailableReason: null,
    stale: false,
    editingId: null,      // null = closed, 'new' = create, uuid = edit
    ledgerOpen: new Set(),
    ledgerCache: new Map(), // id -> {events, fetchedAt}
    agents: null,         // [{name}] for the scope_id datalist
  };

  function setStatus(text, tone = 'neutral') {
    const el = root.querySelector('#bgvStatus');
    if (el) el.innerHTML = text ? `<span class="bgv-badge ${tone}">${escapeHtml(text)}</span>` : '';
  }

  function setContentState(kind, messageHtml) {
    content.innerHTML = `<div class="bgv-state bgv-state-${kind}">${messageHtml}</div>`;
  }

  // ── Data loading ──────────────────────────────────────────────
  async function loadBudgets() {
    const res = await fetchJSON('/api/budgets');
    if (state.destroyed) return;
    if (!res.ok || !res.data || res.data.available !== true || !Array.isArray(res.data.budgets)) {
      // Keep last-good list visible and flag it stale instead of blanking;
      // a first load with nothing good shows the named unavailable state.
      const reason = res.data && res.data.reason ? res.data.reason : (res.status === 0 ? 'unreachable' : `http_${res.status}`);
      state.unavailableReason = reason;
      if (!state.budgets) {
        setContentState('error',
          `<strong>Budgets unavailable</strong><span>reason: ${escapeHtml(reason)} — budget rules need PostgreSQL (json_snapshot mode has no database).</span>`);
        setStatus('down', 'error');
      } else {
        state.stale = true;
        setStatus('stale', 'warn');
      }
      return;
    }
    state.budgets = res.data.budgets;
    state.stale = false;
    renderList();
    setStatus(`${state.budgets.length} defined`, state.budgets.length ? 'ok' : 'neutral');
  }

  async function loadAgents() {
    // Best-effort roster for the scope_id datalist (agent scope). Any failure
    // leaves free-text entry working — the picker is a convenience, not a gate.
    const res = await fetchJSON('/api/openclaw/agents');
    if (state.destroyed) return;
    state.agents = res.ok && Array.isArray(res.data?.agents)
      ? res.data.agents.map(a => a.name || a.agent_name || a.id).filter(Boolean)
      : null;
    const dl = root.querySelector('#bgvAgentList');
    if (dl) dl.innerHTML = (state.agents || []).map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  }

  // ── List rendering ────────────────────────────────────────────
  function scopeLabel(b) {
    if (b.scope === 'fleet') return 'fleet · all agents';
    if (b.scope === 'project') return `workflow type: ${b.scope_id}`; // R5 honest naming
    return `${b.scope}: ${b.scope_id}`;
  }

  function renderList() {
    const budgets = state.budgets || [];
    if (!budgets.length) {
      setContentState('empty',
        'No budgets defined yet.<span style="font-style:normal;">Create one with ＋ New Budget — the feature is inert until the first rule exists.</span>');
      return;
    }
    content.innerHTML = '';
    if (state.editingId) content.appendChild(buildForm());

    for (const b of budgets) {
      content.appendChild(buildCard(b));
    }
  }

  function buildCard(b) {
    const pct = spendPercent(b);
    const tone = budgetTone(pct, b.status);
    const width = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    const pctLabel = Number.isFinite(pct) ? `${Math.round(pct)}%` : '—';
    const activeBadge = b.active
      ? '<span class="bgv-badge ok">● active</span>'
      : '<span class="bgv-badge neutral">○ inactive</span>';
    const statusBadge = b.status === 'breached'
      ? '<span class="bgv-badge error">breached</span>'
      : b.status === 'warned'
        ? '<span class="bgv-badge warn">warned</span>'
        : '';

    const card = document.createElement('div');
    card.className = 'bgv-card' + (b.active ? '' : ' inactive');
    card.dataset.budgetId = b.id;
    card.innerHTML = `
      <div class="bgv-card-head">
        <span class="bgv-name">${escapeHtml(b.name || b.id)}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap;">${activeBadge}${statusBadge}
          ${b.action_on_exceed && b.action_on_exceed !== 'warn' ? `<span class="bgv-badge ${tone === 'error' ? 'error' : 'neutral'}">${escapeHtml(b.action_on_exceed)}</span>` : ''}
        </span>
      </div>
      <div class="bgv-meta">
        <span>${escapeHtml(scopeLabel(b))}</span>
        <span>·</span>
        <span>${escapeHtml(b.period || '')}${b.period_key ? ` (${escapeHtml(b.period_key)})` : ''}</span>
      </div>
      <div class="bgv-track"><div class="bgv-fill ${tone}" style="width:${width}%"></div></div>
      <div class="bgv-sub">
        <span>${escapeHtml(describeSpend(b))}${b.current_spend ? ` · ${Number(b.current_spend.runs || 0)} runs` : ''}</span>
        <span>${escapeHtml(pctLabel)} of cap</span>
      </div>
      <div class="bgv-actions">
        <button class="bgv-btn" data-act="ledger">☰ Ledger</button>
        <button class="bgv-btn" data-act="edit">✎ Edit</button>
        <button class="bgv-btn ${b.active ? 'danger' : ''}" data-act="toggle">${b.active ? '⏸ Deactivate' : '▶ Activate'}</button>
      </div>
      <div data-ledger></div>
    `;

    card.querySelector('[data-act="ledger"]').addEventListener('click', () => toggleLedger(b.id));
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openForm(b));
    card.querySelector('[data-act="toggle"]').addEventListener('click', () => toggleActive(b));
    return card;
  }

  // ── Ledger drawer ─────────────────────────────────────────────
  async function toggleLedger(id) {
    if (state.ledgerOpen.has(id)) {
      state.ledgerOpen.delete(id);
      const holder = content.querySelector(`.bgv-card[data-budget-id="${CSS.escape(id)}"] [data-ledger]`);
      if (holder) holder.innerHTML = '';
      return;
    }
    state.ledgerOpen.add(id);
    await renderLedger(id);
  }

  async function renderLedger(id) {
    const holder = content.querySelector(`.bgv-card[data-budget-id="${CSS.escape(id)}"] [data-ledger]`);
    if (!holder || !state.ledgerOpen.has(id)) return;
    const cached = state.ledgerCache.get(id);
    if (cached) {
      holder.innerHTML = ledgerHtml(cached.payload, cached.error);
      return;
    }
    holder.innerHTML = '<div class="bgv-hint">Loading ledger…</div>';
    const res = await fetchJSON(`/api/budgets/${encodeURIComponent(id)}/ledger`);
    if (state.destroyed) return;
    if (!res.ok || !res.data || res.data.available !== true) {
      const reason = res.data && res.data.reason ? res.data.reason : 'unavailable';
      state.ledgerCache.set(id, { payload: null, error: reason });
      holder.innerHTML = ledgerHtml(null, reason);
      return;
    }
    state.ledgerCache.set(id, { payload: res.data, error: null });
    holder.innerHTML = ledgerHtml(res.data, null);
  }

  function ledgerHtml(payload, error) {
    if (error) {
      return `<div class="bgv-ledger"><div class="bgv-state bgv-state-error" style="padding:10px;">Ledger unavailable — ${escapeHtml(error)}</div></div>`;
    }
    const events = Array.isArray(payload.events) ? payload.events : [];
    const kindTone = k => (k === 'hard_stopped' || k === 'paused' ? 'error' : k === 'warned' ? 'warn' : 'neutral');
    const rows = events.length
      ? events.map(ev => {
          const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : '—';
          const detail = ev.detail && Object.keys(ev.detail).length
            ? escapeHtml(JSON.stringify(ev.detail).slice(0, 160))
            : '';
          return `<div class="bgv-event">
            <span class="bgv-event-time">${escapeHtml(when)}</span>
            <span class="bgv-badge ${kindTone(ev.event_kind)}">${escapeHtml(ev.event_kind || '?')}</span>
            <span class="bgv-event-detail">${escapeHtml(ev.period_key || '')} ${detail}</span>
          </div>`;
        }).join('')
      : '<div class="bgv-hint">No enforcement events recorded for this budget yet.</div>';
    return `<div class="bgv-ledger">
      <div class="bgv-meta"><strong style="font-size:0.78rem;color:var(--win11-text);">Enforcement ledger</strong>
        <span>· window ${escapeHtml(payload.window_start ? new Date(payload.window_start).toLocaleString() : '—')} → now</span></div>
      ${rows}
    </div>`;
  }

  // ── Create / Edit form ────────────────────────────────────────
  function openForm(budget = null) {
    state.editingId = budget ? budget.id : 'new';
    state.ledgerCache.delete(state.editingId);
    renderList();
    const nameInput = content.querySelector('#bgfName');
    if (nameInput) nameInput.focus();
  }

  function closeForm() {
    state.editingId = null;
    renderList();
  }

  function editingBudget() {
    return state.editingId && state.editingId !== 'new'
      ? (state.budgets || []).find(b => b.id === state.editingId) || null
      : null;
  }

  function buildForm() {
    const editing = editingBudget();
    const form = document.createElement('div');
    form.className = 'bgv-form';
    form.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong style="font-size:0.92rem;">${editing ? `✎ Edit budget` : '＋ New budget'}</strong>
        <button type="button" id="bgfCancel" class="bgv-btn">✕ Close</button>
      </div>
      <div class="bgv-form-grid">
        <div class="bgv-field" style="grid-column:1 / -1;">
          <label for="bgfName">Name</label>
          <input id="bgfName" type="text" placeholder="affiliate-editorial monthly cap" value="${editing ? escapeHtml(editing.name || '') : ''}">
        </div>
        <div class="bgv-field">
          <label for="bgfScope">Scope</label>
          <select id="bgfScope" ${editing ? 'disabled' : ''}>
            <option value="agent">Agent</option>
            <option value="department">Department</option>
            <option value="project">Project (workflow type)</option>
            <option value="fleet">Fleet (all agents)</option>
          </select>
          ${editing ? '<span class="bgv-hint">Scope &amp; period are fixed after creation (they key the active-budget unique index).</span>' : ''}
        </div>
        <div class="bgv-field">
          <label for="bgfScopeId">Scope ID</label>
          <input id="bgfScopeId" type="text" list="bgvAgentList" placeholder="coder" value="${editing && editing.scope_id != null ? escapeHtml(editing.scope_id) : ''}" ${editing ? 'disabled' : ''}>
          <datalist id="bgvAgentList"></datalist>
          <span class="bgv-hint">Agent name/id — free text; fleet budgets leave this empty.</span>
        </div>
        <div class="bgv-field">
          <label for="bgfPeriod">Period</label>
          <select id="bgfPeriod" ${editing ? 'disabled' : ''}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="bgv-field">
          <label for="bgfAction">On exceed</label>
          <select id="bgfAction">
            <option value="warn">Warn (notify only)</option>
            <option value="pause_new_runs">Pause new runs (queue holds)</option>
            <option value="hard_stop">Hard stop (cancel in-flight)</option>
          </select>
        </div>
        <div class="bgv-field">
          <label for="bgfCapValue">Cap</label>
          <div style="display:flex;gap:6px;">
            <input id="bgfCapValue" type="number" min="0" step="any" placeholder="50" value="${editing ? (editing.cap_usd != null ? escapeHtml(String(editing.cap_usd)) : editing.cap_tokens != null ? escapeHtml(String(editing.cap_tokens)) : '') : ''}" style="flex:1;min-width:0;">
            <select id="bgfCapUnit" style="width:110px;flex-shrink:0;">
              <option value="usd">USD</option>
              <option value="tokens">Tokens</option>
            </select>
          </div>
          <span class="bgv-hint">Exactly one cap per budget (XOR) — switching the unit replaces the sibling cap.</span>
        </div>
      </div>
      <div id="bgfErrors" style="display:none;"></div>
      <div style="display:flex;gap:8px;">
        <button type="button" id="bgfSubmit" class="bgv-btn primary">${editing ? 'Save changes (PATCH)' : 'Create budget (POST)'}</button>
      </div>
    `;
    if (editing) {
      form.querySelector('#bgfScope').value = editing.scope || 'agent';
      form.querySelector('#bgfPeriod').value = editing.period || 'monthly';
      form.querySelector('#bgfCapUnit').value = editing.cap_tokens != null ? 'tokens' : 'usd';
    }
    form.querySelector('#bgfAction').value = editing ? (editing.action_on_exceed || 'warn') : 'warn';

    form.querySelector('#bgfCancel').addEventListener('click', closeForm);
    form.querySelector('#bgfSubmit').addEventListener('click', () => submitForm(form));
    return form;
  }

  function readForm(form) {
    return {
      name: form.querySelector('#bgfName').value,
      scope: form.querySelector('#bgfScope').value,
      scope_id: form.querySelector('#bgfScopeId').value,
      period: form.querySelector('#bgfPeriod').value,
      cap_unit: form.querySelector('#bgfCapUnit').value,
      cap_value: form.querySelector('#bgfCapValue').value,
      action_on_exceed: form.querySelector('#bgfAction').value,
    };
  }

  function showFormErrors(form, errors) {
    const box = form.querySelector('#bgfErrors');
    box.style.display = 'flex';
    box.className = 'bgv-errors';
    box.innerHTML = errors.map(e => `<span>• ${escapeHtml(e)}</span>`).join('');
  }

  async function submitForm(form) {
    const editing = editingBudget();
    const values = readForm(form);
    const btn = form.querySelector('#bgfSubmit');
    btn.disabled = true;

    if (!editing) {
      const validated = validateBudgetForm(values);
      if (!validated.ok) {
        btn.disabled = false;
        showFormErrors(form, validated.errors);
        return;
      }
      const res = await fetchJSON('/api/budgets', { method: 'POST', body: validated.payload });
      if (state.destroyed) return;
      btn.disabled = false;
      if (!res.ok || !res.data || res.data.available !== true) {
        showFormErrors(form, apiFailureMessages(res));
        return;
      }
      state.editingId = null;
      state.ledgerCache.clear();
      await loadBudgets();
      setStatus('created', 'ok');
      return;
    }

    // Edit: PATCH caps/action/name only (scope/period immutable server-side).
    const patch = { name: values.name.trim(), action_on_exceed: values.action_on_exceed };
    const patchErrors = [];
    if (!patch.name) patchErrors.push('name must be a non-empty string');
    if (!BUDGET_ACTIONS.includes(patch.action_on_exceed)) patchErrors.push(`action_on_exceed must be one of: ${BUDGET_ACTIONS.join(', ')}`);
    const raw = values.cap_value;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      patchErrors.push('provide the replacement cap (caps cannot be nulled directly)');
    } else if (values.cap_unit === 'tokens') {
      const t = Number(raw);
      if (!Number.isInteger(t) || t <= 0) patchErrors.push('cap_tokens must be a positive integer');
      else patch.cap_tokens = t;
    } else {
      const u = Number(raw);
      if (!Number.isFinite(u) || u <= 0) patchErrors.push('cap_usd must be a positive number');
      else patch.cap_usd = u;
    }
    if (patchErrors.length) {
      btn.disabled = false;
      showFormErrors(form, patchErrors);
      return;
    }
    const res = await fetchJSON(`/api/budgets/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: patch });
    if (state.destroyed) return;
    btn.disabled = false;
    if (!res.ok || !res.data || res.data.available !== true) {
      showFormErrors(form, apiFailureMessages(res));
      return;
    }
    state.editingId = null;
    state.ledgerCache.clear();
    await loadBudgets();
    setStatus('saved', 'ok');
  }

  /** Map non-2xx / degraded API responses to inline form error lines. */
  function apiFailureMessages(res) {
    if (res.data && Array.isArray(res.data.details) && res.data.details.length) return res.data.details;
    if (res.data && res.data.available === false && res.data.reason === 'no_database') {
      return ['No database — budget rules require PostgreSQL (json_snapshot mode cannot store them).'];
    }
    if (res.data && res.data.available === false && res.data.reason === 'query_failed') {
      return [`Query failed: ${res.data.details || 'database error'}`];
    }
    if (res.status === 404) return ['Budget no longer exists (deleted or unknown id).'];
    if (res.status === 401 || res.status === 403) return ['Not authorized — check the dashboard bearer token.'];
    if (res.status === 0) return ['Gateway unreachable — request never left the view.'];
    return [`Request failed (HTTP ${res.status}).`];
  }

  // ── Activate / deactivate (soft — history preserved) ──────────
  async function toggleActive(b) {
    const deactivating = Boolean(b.active);
    // Deactivate removes a live guardrail — confirm; activate is safe.
    if (deactivating && !window.confirm(`Deactivate "${b.name || b.id}"? The rule stops enforcing immediately; history and the ledger are preserved, and you can re-activate anytime.`)) return;
    setStatus('saving…', 'neutral');
    const res = await fetchJSON(`/api/budgets/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { active: !deactivating } });
    if (state.destroyed) return;
    if (!res.ok || !res.data || res.data.available !== true) {
      setContentState('error', `<strong>${deactivating ? 'Deactivate' : 'Activate'} failed</strong><span>${escapeHtml(apiFailureMessages(res)[0])}</span>`);
      setStatus('error', 'error');
      await loadBudgets();
      return;
    }
    state.ledgerCache.clear();
    await loadBudgets();
    setStatus(deactivating ? 'deactivated' : 'activated', 'ok');
  }

  // ── Wiring ────────────────────────────────────────────────────
  root.querySelector('#bgvRefresh').addEventListener('click', () => {
    state.ledgerCache.clear();
    loadBudgets();
  });
  root.querySelector('#bgvNew').addEventListener('click', () => openForm(null));

  const timer = setInterval(() => {
    if (!state.destroyed && !state.editingId) loadBudgets(); // no mid-edit clobber
  }, POLL_MS);

  loadAgents();
  await loadBudgets();

  // Teardown: stop polling, drop caches (no post-close fetches).
  return () => {
    state.destroyed = true;
    clearInterval(timer);
    state.ledgerOpen.clear();
    state.ledgerCache.clear();
  };
}

export default renderBudgetsView;
