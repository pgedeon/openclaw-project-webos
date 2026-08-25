/**
 * Command Palette (P1) — Ctrl+K / Cmd+K global search
 * Searches tasks, projects, agents, workflows, memory, spaces
 * and navigates to the relevant view with deep-link params.
 *
 * NL mode (Phase 2 "Natural-language command bar", docs/briefs/nl-command-bar.md):
 * Tab toggles an explicit Ask mode inside the same overlay. Utterances parse
 * through lib/nl-parse.js (deterministic grammar — no LLM in the frontend),
 * resolve against existing read endpoints, and render a mandatory
 * interpretation card BEFORE anything executes. Confirmed hand-offs go through
 * executeAction() so registry severity tiers (NONE / PREVIEW_MODAL /
 * HOLD_CONFIRM), idempotency, receipts, and the amber budget banner apply
 * verbatim — this file composes envelopes and consumes receipts; it never
 * implements its own confirmation semantics. Query intents answer inline from
 * reads only and structurally carry no kind field. Unmatched input degrades to
 * normal search results.
 */

import { executeAction, catalogFor } from './action-client.mjs';

const CSS = `
  .cmd-palette-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,.4); backdrop-filter: blur(4px);
    display: flex; justify-content: center; padding-top: 15vh;
  }
  .cmd-palette {
    width: 560px; max-height: 420px;
    background: var(--win11-surface-solid, #fff);
    border: 1px solid var(--win11-border, #e0e0e0);
    border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.25);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .cmd-palette-input {
    width: 100%; padding: 14px 18px; font-size: 1rem;
    border: none; border-bottom: 1px solid var(--win11-border, #e0e0e0);
    background: transparent; color: var(--win11-text, #1a1a1a);
    outline: none;
  }
  .cmd-palette-input::placeholder { color: var(--win11-text-tertiary, #999); }
  .cmd-palette-results {
    flex: 1; overflow-y: auto; padding: 4px;
  }
  .cmd-palette-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 8px; cursor: pointer;
    transition: background 0.1s;
  }
  .cmd-palette-item:hover, .cmd-palette-item.active {
    background: var(--win11-surface-hover, rgba(0,120,212,.08));
  }
  .cmd-palette-icon { font-size: 1.1rem; flex-shrink: 0; width: 24px; text-align: center; }
  .cmd-palette-text { flex: 1; min-width: 0; }
  .cmd-palette-title { font-size: 0.88rem; color: var(--win11-text, #1a1a1a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cmd-palette-subtitle { font-size: 0.73rem; color: var(--win11-text-tertiary, #999); margin-top: 1px; }
  .cmd-palette-type { font-size: 0.68rem; color: var(--win11-accent, #0078d4); background: rgba(0,120,212,.08); padding: 2px 7px; border-radius: 4px; flex-shrink: 0; }
  .cmd-palette-empty { padding: 24px; text-align: center; color: var(--win11-text-tertiary, #999); font-size: 0.85rem; }
  .cmd-palette-hint { padding: 8px 14px; border-top: 1px solid var(--win11-border, #e0e0e0); font-size: 0.72rem; color: var(--win11-text-tertiary, #999); display: flex; align-items: center; gap: 8px; }
  /* ── NL Ask mode (docs/briefs/nl-command-bar.md §2) ── */
  .cmd-palette-mode-chip {
    font-size: 0.66rem; font-weight: 600; letter-spacing: 0.03em;
    padding: 2px 9px; border-radius: 10px; flex-shrink: 0;
    background: rgba(0,120,212,.10); color: var(--win11-accent, #0078d4);
  }
  .cmd-palette-mode-chip[data-mode="ask"] { background: rgba(34,197,94,.14); color: #16a34a; }
  .cmd-palette-card {
    margin: 6px 8px; padding: 11px 14px; border-radius: 10px;
    border: 1px solid var(--win11-border, #e0e0e0);
    background: var(--win11-surface, rgba(0,120,212,.04));
  }
  .cmd-palette-card.action { border-left: 3px solid var(--win11-accent, #0078d4); }
  .cmd-palette-card.refusal { border-left: 3px solid #eab308; }
  .cmd-palette-card.query { border-left: 3px solid #22c55e; }
  .cmd-palette-card-title { font-size: 0.86rem; font-weight: 600; color: var(--win11-text, #1a1a1a); margin-bottom: 5px; overflow-wrap: anywhere; }
  .cmd-palette-card-line { font-size: 0.78rem; color: var(--win11-text-secondary, #555); margin: 2px 0; overflow-wrap: anywhere; }
  .cmd-palette-card code {
    font-family: 'SF Mono','Consolas',monospace; font-size: 0.74rem;
    background: rgba(0,120,212,.08); padding: 1px 5px; border-radius: 4px;
  }
  .cmd-palette-rollback { margin-top: 6px; font-size: 0.72rem; color: var(--win11-text-tertiary, #999); }
  .cmd-palette-warn { margin-top: 6px; font-size: 0.75rem; color: #b45309; }
  .cmd-palette-chipbtn {
    display: inline-block; margin: 4px 6px 0 0; padding: 3px 10px;
    font-size: 0.72rem; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--win11-border, #e0e0e0); background: transparent;
    color: var(--win11-text, #1a1a1a);
  }
  .cmd-palette-chipbtn:hover { background: var(--win11-surface-hover, rgba(0,120,212,.08)); }
  .cmd-palette-meta { font-size: 0.68rem; color: var(--win11-text-tertiary, #999); margin-top: 7px; }
`;

let palette = null;
let activeIndex = 0;
let results = [];

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightMatch(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.substring(0, idx)) + '<mark style="background:rgba(0,120,212,.2);color:inherit;border-radius:2px;padding:0 1px;">' + esc(text.substring(idx, idx + query.length)) + '</mark>' + esc(text.substring(idx + query.length));
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 18 ? `${s.slice(0, 14)}…` : s;
}

async function searchAll(api, query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const items = [];

  // Search apps/views first (instant)
  const apps = globalThis.__OPENCLAW_WIN11_SHELL__?.windowManager?.appMap;
  if (apps) {
    for (const [id, app] of apps) {
      const label = (app.label || app.id || '').toLowerCase();
      if (label.includes(q) || id.includes(q)) {
        items.push({ type: 'app', icon: app.icon || '📱', title: app.label || id, subtitle: 'Open view', viewId: id, params: {}, score: 10 });
      }
    }
  }

  // Search tasks
  try {
    const res = await api.tasks.list({ limit: 20, sort: 'updated_at', order: 'desc' });
    const tasks = Array.isArray(res) ? res : [];
    for (const t of tasks) {
      const title = (t.title || t.text || '').toLowerCase();
      if (title.includes(q)) {
        items.push({ type: 'task', icon: '✅', title: t.title || t.text || 'Untitled', subtitle: t.project_name || t.status || '', viewId: 'tasks', params: { taskId: t.id }, score: 5 });
      }
    }
  } catch {}

  // Search projects
  try {
    const res = await api.projects.list();
    const projects = Array.isArray(res) ? res : (res?.projects || []);
    for (const p of projects) {
      if ((p.name || '').toLowerCase().includes(q)) {
        items.push({ type: 'project', icon: '📁', title: p.name, subtitle: `${p.active_task_count || 0} tasks`, viewId: 'board', params: { projectId: p.id }, score: 4 });
      }
    }
  } catch {}

  // Search agents
  try {
    const res = await api.org.agents.list();
    const agents = Array.isArray(res) ? res : (res?.agents || []);
    for (const a of agents) {
      const name = (a.displayName || a.name || '').toLowerCase();
      if (name.includes(q)) {
        items.push({ type: 'agent', icon: '🤖', title: a.displayName || a.name, subtitle: a.status || '', viewId: 'agents', params: { agentName: a.name }, score: 3 });
      }
    }
  } catch {}

  // Sort by score then alphabetically
  items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return items.slice(0, 25);
}

function renderResults(items, query) {
  const container = palette.querySelector('.cmd-palette-results');
  if (!items.length) {
    container.innerHTML = '<div class="cmd-palette-empty">No results found. Try a different search.</div>';
    return;
  }
  container.innerHTML = items.map((item, i) => `
    <div class="cmd-palette-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
      <div class="cmd-palette-icon">${item.icon}</div>
      <div class="cmd-palette-text">
        <div class="cmd-palette-title">${highlightMatch(item.title, query)}</div>
        ${item.subtitle ? `<div class="cmd-palette-subtitle">${esc(item.subtitle)}</div>` : ''}
      </div>
      <div class="cmd-palette-type">${esc(item.type)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.cmd-palette-item').forEach(el => {
    el.addEventListener('click', () => selectItem(items[parseInt(el.dataset.index)]));
    el.addEventListener('mouseenter', () => {
      activeIndex = parseInt(el.dataset.index);
      container.querySelectorAll('.cmd-palette-item').forEach((e, j) => e.classList.toggle('active', j === activeIndex));
    });
  });
}

function selectItem(item) {
  if (!item) return;
  const wm = globalThis.__OPENCLAW_WIN11_SHELL__?.windowManager;
  if (wm) wm.openWindow(item.viewId, { params: item.params });
  close();
}

// ════════════════════════════════════════════════════════════════
// NL Ask mode — target resolution + interpretation model
// (docs/briefs/nl-command-bar.md §5 slot-resolution rules, §6 safety)
// ════════════════════════════════════════════════════════════════

/** Run statuses the ⛔ cancel button guards allow (workflows-view parity). */
const CANCELABLE_RUN_STATUSES = new Set([
  'queued', 'dispatched', 'claimed', 'running',
  'waiting_for_approval', 'blocked', 'retrying',
]);

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['runs', 'rows', 'items', 'tasks', 'approvals', 'agents', 'templates', 'budgets']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function titleOf(t) { return String(t?.title || t?.text || t?.subject || t?.name || ''); }

/** Task candidates: `#<id prefix>` or unique title substring across open tasks. */
function taskCandidates(tasks, slots) {
  if (slots.targetId) {
    const pref = String(slots.targetId).toLowerCase();
    return tasks.filter((t) => String(t.id).toLowerCase().startsWith(pref));
  }
  const q = String(slots.taskRef || '').toLowerCase();
  if (!q) return [];
  return tasks.filter((t) => titleOf(t).toLowerCase().includes(q));
}

/** Run candidates by run_<id>/UUID/short-id or prose match on type/title. */
function runCandidates(rows, slots) {
  const tid = slots.targetId ? String(slots.targetId).toLowerCase() : null;
  const ref = String(slots.runRef || '').toLowerCase();
  return rows.filter((r) => {
    const id = String(r.id || '').toLowerCase();
    if (tid) return id === tid || id === `run_${tid}` || id.startsWith(tid) || id.endsWith(tid);
    if (!ref) return false;
    return id.includes(ref)
      || String(r.workflow_type || r.template || '').toLowerCase().includes(ref)
      || titleOf(r).toLowerCase().includes(ref);
  });
}

/** Approval candidates among pending approvals by subject/title/id prefix. */
function approvalCandidates(rows, slots) {
  const tid = slots.targetId ? String(slots.targetId).toLowerCase() : null;
  const ref = String(slots.approvalRef || '').toLowerCase();
  return rows.filter((a) => {
    const id = String(a.id || '').toLowerCase();
    if (tid) return id.startsWith(tid);
    if (!ref) return false;
    return id.includes(ref) || titleOf(a).toLowerCase().includes(ref);
  });
}

/** Exact display-name match first, then UNIQUE substring — else unknown. */
function pickAgent(agents, name) {
  const needle = String(name || '').toLowerCase();
  if (!needle) return null;
  const exact = agents.find((a) => String(a.displayName || a.name || '').toLowerCase() === needle);
  if (exact) return exact;
  const partial = agents.filter((a) => String(a.displayName || a.name || '').toLowerCase().includes(needle));
  return partial.length === 1 ? partial[0] : null;
}

/** Exact template name match first, then UNIQUE substring — else null. */
function pickTemplate(templates, name) {
  const needle = String(name || '').toLowerCase();
  if (!needle) return null;
  const nm = (t) => String(t?.name || t?.display_name || t || '').toLowerCase();
  const exact = templates.find((t) => nm(t) === needle);
  if (exact) return exact;
  const partial = templates.filter((t) => nm(t).includes(needle));
  return partial.length === 1 ? partial[0] : templates.find((t) => nm(t) === needle) || null;
}

/**
 * Target resolution fan-out (brief §5/§6.5): ≤4 read endpoints per parse,
 * status-guarded exactly like the buttons' own row filters (cancel offers
 * running/queued/waiting rows only; redispatch failed rows only).
 *
 * Exported as a factory so DB-free tests can drive it with stub apis and
 * pin AC-G5 (resolution discipline + stale-sequence guard).
 */
export function createNlResolver(api) {
  let latestSeq = 0;

  async function resolveInner(parse) {
    const kind = parse.kind;
    const slots = parse.slots || {};

    if (kind === 'task.assign') {
      const [tasksRes, agentsRes] = await Promise.allSettled([
        api.tasks.list({ limit: 200 }),
        api.org.agents.list(),
      ]);
      if (tasksRes.status !== 'fulfilled') return { status: 'error', reason: 'tasks_unreachable' };
      if (agentsRes.status !== 'fulfilled') return { status: 'unmatched', reason: 'unknown_agent', agentName: slots.agentName };
      const agent = pickAgent(rowsOf(agentsRes.value), slots.agentName);
      if (!agent) return { status: 'unmatched', reason: 'unknown_agent', agentName: slots.agentName };
      const hits = taskCandidates(rowsOf(tasksRes.value), slots);
      if (hits.length === 0) return { status: 'not_found', noun: 'task' };
      if (hits.length > 1) return { status: 'ambiguous', noun: 'task', candidates: hits.map((t) => ({ id: t.id, label: titleOf(t), subtitle: t.status })) };
      const owner = String(agent.displayName || agent.name);
      return { status: 'resolved', target: hits[0], params: { owner } };
    }

    if (kind === 'run.dispatch') {
      const [tasksRes, tplRes] = await Promise.allSettled([
        api.tasks.list({ limit: 200 }),
        api.workflows.templates(),
      ]);
      if (tasksRes.status !== 'fulfilled') return { status: 'error', reason: 'tasks_unreachable' };
      if (tplRes.status !== 'fulfilled') return { status: 'unmatched', reason: 'unknown_template', templateName: slots.templateName };
      const templates = rowsOf(tplRes.value);
      const tpl = pickTemplate(templates, slots.templateName);
      if (!tpl) {
        return {
          status: 'unmatched', reason: 'unknown_template', templateName: slots.templateName,
          closeMatches: templates.slice(0, 3).map((t) => String(t?.name || t?.display_name || t)),
        };
      }
      const hits = taskCandidates(rowsOf(tasksRes.value), slots);
      if (hits.length === 0) return { status: 'not_found', noun: 'task' };
      if (hits.length > 1) return { status: 'ambiguous', noun: 'task', candidates: hits.map((t) => ({ id: t.id, label: titleOf(t), subtitle: t.status })) };
      const template = String(tpl.name || tpl.display_name || tpl);
      // Display-only headroom lines (§6.4): authoritative probe stays
      // server-side pre-execution; failure here degrades silently.
      let headroom = [];
      try {
        const budgets = rowsOf(await api.request('/budgets'));
        headroom = budgets
          .filter((b) => (typeof b.pct_of_cap === 'number' && b.pct_of_cap >= 75) || b.status === 'breached')
          .slice(0, 3)
          .map((b) => `⚠ Budget '${b.name}' at ${Math.round(b.pct_of_cap)}% of ${b.period_key || b.period || 'current'} cap`);
      } catch { /* budgets read optional */ }
      return { status: 'resolved', target: hits[0], params: { template }, previewLines: headroom };
    }

    if (kind === 'approval.decide') {
      const pend = await api.approvals.pending();
      const hits = approvalCandidates(rowsOf(pend), slots);
      if (hits.length === 0) return { status: 'not_found', noun: 'approval' };
      if (hits.length > 1) return { status: 'ambiguous', noun: 'approval', candidates: hits.map((a) => ({ id: a.id, label: titleOf(a), subtitle: a.status })) };
      return { status: 'resolved', target: hits[0], params: parse.params || {} };
    }

    if (kind === 'run.cancel') {
      const [activeRes, queuedRes] = await Promise.allSettled([
        api.workflows.active(),
        api.workflows.runs({ status: 'queued' }),
      ]);
      const rows = [
        ...(activeRes.status === 'fulfilled' ? rowsOf(activeRes.value) : []),
        ...(queuedRes.status === 'fulfilled' ? rowsOf(queuedRes.value) : []),
      ].filter((r) => CANCELABLE_RUN_STATUSES.has(String(r.status || '').toLowerCase()));
      const hits = runCandidates(rows, slots);
      if (hits.length === 0) return { status: 'not_found', noun: 'run' };
      if (hits.length > 1) return { status: 'ambiguous', noun: 'run', candidates: hits.map((r) => ({ id: r.id, label: titleOf(r) || r.workflow_type, subtitle: r.status })) };
      return { status: 'resolved', target: hits[0], params: {} };
    }

    if (kind === 'run.redispatch') {
      const failed = await api.workflows.runs({ status: 'failed' });
      const hits = runCandidates(rowsOf(failed), slots);
      if (hits.length === 0) return { status: 'not_found', noun: 'run' };
      if (hits.length > 1) return { status: 'ambiguous', noun: 'run', candidates: hits.map((r) => ({ id: r.id, label: titleOf(r) || r.workflow_type, subtitle: r.status })) };
      return { status: 'resolved', target: hits[0], params: {} };
    }

    if (kind === 'task.create') {
      // Creation resolves the PROJECT the task lands in (registry targetType
      // 'project'), not an existing row. Default project mirrors the storage
      // layer's own createTask fallback; the title comes from the grammar —
      // never invented here.
      if (!slots.title) return { status: 'unmatched', reason: 'missing_slot' };
      let projRes;
      try {
        projRes = await api.projects.getDefault();
      } catch {
        return { status: 'not_found', noun: 'project' };
      }
      const rows = rowsOf(projRes);
      const project = rows.length ? rows[0]
        : (projRes && typeof projRes === 'object' ? projRes : null);
      if (!project?.id) return { status: 'not_found', noun: 'project' };
      return { status: 'resolved', target: project, params: { title: slots.title } };
    }

    return { status: 'unmatched', reason: 'unknown_verb' };
  }

  return {
    /** Resolve one parse; results carry stale:true when superseded. */
    async resolve(parse) {
      const seq = ++latestSeq;
      let out;
      try {
        out = await resolveInner(parse);
      } catch (err) {
        out = { status: 'error', reason: 'resolution_failed', detail: String(err?.message || err) };
      }
      return { ...out, stale: seq !== latestSeq };
    },
  };
}

/**
 * Pure render model for the interpretation card (§3): show-not-execute.
 * Refusal/ambiguous models deliberately omit envelope-shaped fields —
 * a ready model is the ONLY shape carrying kind+targetId+params together.
 */
export function buildInterpretation(parse, resolution) {
  if (resolution.stale) return { status: 'stale' };

  if (resolution.status === 'unmatched') {
    return { status: 'refusal', reason: resolution.reason, agentName: resolution.agentName, templateName: resolution.templateName, closeMatches: resolution.closeMatches };
  }
  if (resolution.status === 'not_found') {
    return { status: 'refusal', reason: 'target_not_found', noun: resolution.noun };
  }
  if (resolution.status === 'ambiguous') {
    // No targetId/params while ambiguous — Enter does nothing until resolved.
    return { status: 'ambiguous', kind: parse.kind, noun: resolution.noun, candidates: resolution.candidates };
  }
  if (resolution.status === 'error') {
    return { status: 'refusal', reason: 'resolution_failed', detail: resolution.detail };
  }

  const cat = catalogFor(parse.kind);
  if (!cat || !resolution.target?.id) {
    return { status: 'refusal', reason: "couldn't verify target" };
  }
  const target = resolution.target;
  const params = resolution.params || {};
  const model = {
    status: 'ready',
    kind: parse.kind,
    targetId: String(target.id),
    params,
    confirmMode: cat.confirmMode,
    rollbackHint: cat.rollbackHint,
    previewLines: resolution.previewLines || [],
    headline: '',
    sub: '',
    warning: '',
  };
  const label = titleOf(target) || target.workflow_type || shortId(target.id);
  switch (parse.kind) {
    case 'task.assign':
      model.headline = `Will assign “${label}” to ${params.owner}`;
      break;
    case 'run.dispatch':
      model.headline = `Will dispatch “${params.template}” on “${label}”`;
      break;
    case 'approval.decide':
      model.headline = `Will ${params.decision} “${label}”`;
      break;
    case 'run.cancel':
      model.headline = `Will cancel run ${shortId(target.id)} — “${label}” (${target.status || 'running'})`;
      model.warning = 'Cancelling destroys paid in-flight work.';
      break;
    case 'run.redispatch':
      model.headline = `Will re-dispatch run ${shortId(target.id)} — “${label}”`;
      break;
    case 'task.create':
      model.headline = `Will create “${params.title}” in ${label}`;
      break;
    default:
      model.headline = `${cat.label} → ${shortId(target.id)}`;
  }
  return model;
}

/** Human copy per grammar refusal reason (§6.6 + flagship scoping). */
export function refusalCopy(reason, detail = {}) {
  switch (reason) {
    case 'batch_not_supported':
      return ['Batch actions aren’t supported.', 'One action, one target — select a single run/task instead.'];
    case 'temporal_not_supported':
      return ['Scheduling isn’t available here.', 'Recurring schedules live in the Cron view.'];
    case 'unknown_agent':
      return [`No agent named “${detail.agentName || ''}”.`, 'Check the spelling against the Agents view.'];
    case 'unknown_template':
      return [`No workflow template named “${detail.templateName || ''}”.`,
        detail.closeMatches?.length ? `Close matches: ${detail.closeMatches.join(', ')}` : 'See Workflows for available templates.'];
    case 'target_not_found':
      return [`Couldn't verify ${detail.noun || 'target'} — nothing proposed.`, 'Never proposing an unresolved id.'];
    case 'resolution_failed':
      return ['Couldn\'t verify target (lookup failed).', String(detail.detail || '')];
    case 'empty':
      return ['Type an intent.', ''];
    default:
      return ['Couldn\'t map that to an action.', 'Try different wording — or search below.'];
  }
}

// ── NL rendering helpers (DOM-touching; called only with palette open) ──

function bindDeepLinks(container, onClose) {
  container.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', () => {
      const wm = globalThis.__OPENCLAW_WIN11_SHELL__?.windowManager;
      let params = {};
      try { params = JSON.parse(el.dataset.params || '{}'); } catch { /* malformed */ }
      if (wm) wm.openWindow(el.dataset.view, { params });
      onClose();
    });
  });
}

function bindChips(container, onUtterance) {
  container.querySelectorAll('[data-utterance]').forEach((el) => {
    el.addEventListener('click', () => onUtterance(el.dataset.utterance));
  });
}

function renderCardHTML(model, extra = '') {
  const cls = model.status === 'ready' ? 'action'
    : (model.status === 'refusal' || model.status === 'ambiguous') ? 'refusal' : 'query';
  let body = '';
  if (model.status === 'ready') {
    const confirmNote = {
      NONE: 'Fires immediately on confirm (low severity).',
      PREVIEW_MODAL: 'Confirm opens the typed preview modal next.',
      HOLD_CONFIRM: 'Confirm opens hold-to-confirm (1.2 s) next.',
    }[model.confirmMode] || '';
    body = `
      <div class="cmd-palette-card-title">${esc(model.headline)}</div>
      ${model.sub ? `<div class="cmd-palette-card-line">${model.sub}</div>` : ''}
      ${Object.entries(model.params).map(([k, v]) => `<div class="cmd-palette-card-line">${esc(k)}: <code>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</code></div>`).join('')}
      ${model.previewLines.map((l) => `<div class="cmd-palette-card-line">${esc(l)}</div>`).join('')}
      ${model.warning ? `<div class="cmd-palette-warn">⚠ ${esc(model.warning)}</div>` : ''}
      <div class="cmd-palette-rollback">Recovery: ${esc(model.rollbackHint)} · ${esc(confirmNote)}</div>`;
  } else if (model.status === 'refusal') {
    const [head, tail] = refusalCopy(model.reason, model);
    body = `
      <div class="cmd-palette-card-title">${esc(head)}</div>
      ${tail ? `<div class="cmd-palette-card-line">${esc(tail)}</div>` : ''}`;
  } else if (model.status === 'ambiguous') {
    body = `
      <div class="cmd-palette-card-title">${model.candidates.length} ${esc(model.noun)}s match — pick one:</div>
      ${model.candidates.slice(0, 8).map((c, i) => `
        <div class="cmd-palette-item" data-pick="${i}">
          <div class="cmd-palette-icon">•</div>
          <div class="cmd-palette-text">
            <div class="cmd-palette-title">${esc(c.label || c.id)}</div>
            ${c.subtitle ? `<div class="cmd-palette-subtitle">${esc(c.subtitle)}</div>` : ''}
          </div>
          <code>${esc(shortId(c.id))}</code>
        </div>`).join('')}
      <div class="cmd-palette-meta">Enter does nothing until one is selected.</div>`;
  }
  return `<div class="cmd-palette-card ${cls}">${body}</div>${extra}`;
}

function fmtAge(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/**
 * Inline query answers (§5 query table): reads only, deep-link rows,
 * hint chips that compose utterances (never fire directly).
 */
async function answerQuery(api, parse, text, seq, ctx) {
  const { container, isCurrent } = ctx;
  const type = parse.queryOnly.type;
  const fetchedAt = Date.now();
  let html = '';
  const read = async (p) => { try { return await p; } catch { return null; } };

  if (type === 'fleet_status') {
    const [runs, agents] = await Promise.all([read(api.workflows.active()), read(api.agents.status())]);
    if (!isCurrent(seq)) return;
    const runRows = rowsOf(runs);
    const agentRows = rowsOf(agents);
    const busy = agentRows.filter((a) => String(a.status || '').toLowerCase() === 'busy').length;
    html = `<div class="cmd-palette-card query">
      <div class="cmd-palette-card-title">${runRows.length} running runs · ${busy}/${agentRows.length} agents busy</div>
      ${runRows.slice(0, 5).map((r) => `<div class="cmd-palette-item" data-view="workflows" data-params='${esc(JSON.stringify({ runId: r.id }))}'>
        <div class="cmd-palette-icon">🏃</div><div class="cmd-palette-text">
        <div class="cmd-palette-title">${esc(titleOf(r) || r.workflow_type || r.id)}</div></div>
        <span class="cmd-palette-type">${esc(r.status || '')}</span></div>`).join('')}
      <div class="cmd-palette-meta">fetched ${esc(fmtAge(fetchedAt))}</div>
    </div>`;
  } else if (type === 'failed_runs') {
    const runs = await read(api.workflows.runs({ status: 'failed' }));
    if (!isCurrent(seq)) return;
    const runRows = rowsOf(runs);
    html = `<div class="cmd-palette-card query">
      <div class="cmd-palette-card-title">${runRows.length} failed runs</div>
      ${runRows.slice(0, 5).map((r) => `<div class="cmd-palette-item" data-view="workflows" data-params='${esc(JSON.stringify({ runId: r.id }))}'>
        <div class="cmd-palette-icon">❌</div><div class="cmd-palette-text">
        <div class="cmd-palette-title">${esc(titleOf(r) || r.workflow_type || r.id)}</div></div>
        <span class="cmd-palette-type">${esc(r.status || 'failed')}</span></div>`).join('')}
      ${runRows.length ? `<div>${runRows.slice(0, 3).map((r) => `<button type="button" class="cmd-palette-chipbtn" data-utterance="${esc(`re-dispatch run ${r.id}`)}">↻ re-dispatch run ${esc(shortId(r.id))}</button>`).join('')}</div>` : ''}
      <div class="cmd-palette-meta">chips open the gated flow — they never fire directly · fetched ${esc(fmtAge(fetchedAt))}</div>
    </div>`;
  } else if (type === 'pending_approvals') {
    const pend = await read(api.approvals.pending());
    if (!isCurrent(seq)) return;
    const rows = rowsOf(pend);
    html = `<div class="cmd-palette-card query">
      <div class="cmd-palette-card-title">${rows.length} pending approvals</div>
      ${rows.slice(0, 5).map((a) => `<div class="cmd-palette-item" data-view="approvals" data-params='{}'>
        <div class="cmd-palette-icon">🙋</div><div class="cmd-palette-text">
        <div class="cmd-palette-title">${esc(titleOf(a) || a.id)}</div></div></div>`).join('')}
      ${rows.length ? `<div>${rows.slice(0, 3).map((a) => `<button type="button" class="cmd-palette-chipbtn" data-utterance="${esc(`approve ${titleOf(a) || a.id}`)}">✓ approve ${esc(shortId(titleOf(a) || a.id))}</button>`).join('')}</div>` : ''}
      <div class="cmd-palette-meta">chips land on the interpretation card first · fetched ${esc(fmtAge(fetchedAt))}</div>
    </div>`;
  } else if (type === 'budget_status') {
    const res = await read(api.request('/budgets'));
    if (!isCurrent(seq)) return;
    const budgets = rowsOf(res);
    const hot = budgets.filter((b) => b.status === 'breached' || (typeof b.pct_of_cap === 'number' && b.pct_of_cap >= 75));
    html = `<div class="cmd-palette-card query">
      <div class="cmd-palette-card-title">${hot.length ? 'Budgets at or past amber:' : 'No breached or amber budgets.'}</div>
      ${hot.slice(0, 5).map((b) => `<div class="cmd-palette-card-line">• ${esc(b.name)} — ${esc(String(Math.round(b.pct_of_cap)))}% of ${esc(b.period_key || b.period || 'current')} cap (${esc(b.status || 'amber')})</div>`).join('')}
      <div class="cmd-palette-meta">display only — caps are managed in Mission Control · fetched ${esc(fmtAge(fetchedAt))}</div>
    </div>`;
  } else {
    // find — degrade into the normal search pipeline for the query text.
    const q = (parse.queryText || text).trim();
    const items = await searchAll(api, q);
    if (!isCurrent(seq)) return;
    activeIndex = 0;
    results = items;
    container.innerHTML = `<div class="cmd-palette-card query">
      <div class="cmd-palette-card-title">Search results for “${esc(q)}”</div>
    </div>`;
    const listHost = document.createElement('div');
    container.appendChild(listHost);
    renderResultsInto(listHost, items, q);
    bindDeepLinks(container, ctx.onClose);
    return;
  }

  container.innerHTML = html;
  bindDeepLinks(container, ctx.onClose);
  bindChips(container, ctx.onUtterance);
}

/** Render search-style items into an arbitrary host (query/find reuse). */
function renderResultsInto(host, items, query) {
  host.innerHTML = items.map((item, i) => `
    <div class="cmd-palette-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
      <div class="cmd-palette-icon">${item.icon}</div>
      <div class="cmd-palette-text">
        <div class="cmd-palette-title">${highlightMatch(item.title, query)}</div>
        ${item.subtitle ? `<div class="cmd-palette-subtitle">${esc(item.subtitle)}</div>` : ''}
      </div>
      <div class="cmd-palette-type">${esc(item.type)}</div>
    </div>
  `).join('');
  host.querySelectorAll('.cmd-palette-item').forEach((el) => {
    el.addEventListener('click', () => selectItem(items[parseInt(el.dataset.index)]));
  });
}

export function initCommandPalette(api) {
  let searchSeq = 0;
  let nlSeq = 0;          // stale-sequence guard for NL resolutions (Fix 14 pattern)
  let nlTimer = null;     // 250 ms Ask debounce
  let askMode = false;
  let interpretation = null; // current NL render model
  let nlParseFn = null;   // lazy-loaded grammar (lib/nl-parse.js)

  const resolver = createNlResolver(api);

  function loadGrammar() {
    if (nlParseFn) return Promise.resolve(nlParseFn);
    if (globalThis.NLParse?.parseIntent) {
      nlParseFn = globalThis.NLParse.parseIntent;
      return Promise.resolve(nlParseFn);
    }
    // Served at /lib/nl-parse.js (UMD fallback sets globalThis.NLParse).
    return import('/lib/nl-parse.js')
      .then(() => { nlParseFn = globalThis.NLParse?.parseIntent || null; return nlParseFn; })
      .catch(() => null);
  }

  function resetNlState() {
    if (nlTimer) { clearTimeout(nlTimer); nlTimer = null; }
    nlSeq += 1; // invalidate any in-flight resolution renders
    interpretation = null;
  }

  function setAskMode(on) {
    askMode = on;
    resetNlState();
    results = [];
    activeIndex = 0;
    const chip = palette.querySelector('.cmd-palette-mode-chip');
    const input = palette.querySelector('.cmd-palette-input');
    const hint = palette.querySelector('.cmd-palette-hint-text');
    const container = palette.querySelector('.cmd-palette-results');
    if (chip) { chip.textContent = on ? 'Ask' : 'Search'; chip.dataset.mode = on ? 'ask' : 'search'; }
    if (input) input.placeholder = on
      ? 'Ask: “cancel run 4f2a” · “assign checkout bug to kaya” · “what’s running”'
      : 'Search tasks, projects, agents, views...';
    if (hint) hint.textContent = on
      ? 'Tab Search · Enter confirm · Esc close'
      : '↑↓ navigate · Enter select · Esc close · Tab Ask';
    if (container) container.innerHTML = `<div class="cmd-palette-empty">${on ? 'Type an intent — Tab switches back to Search.' : 'Start typing to search...'}</div>`;
    if (input) input.focus();
  }

  /**
   * Ask pipeline: parse → (query | unmatched | resolve) → interpretation card.
   * Zero envelopes exist anywhere in this path — execution happens only in the
   * Enter hand-off through executeAction()'s own gates (two-gate invariant).
   */
  async function runAsk(rawText, seq) {
    const text = String(rawText || '').trim();
    const container = palette.querySelector('.cmd-palette-results');
    const ctx = {
      container,
      isCurrent: (s) => !!palette && s === nlSeq,
      onClose: () => { resetNlState(); close(); },
      onUtterance: (utt) => {
        const input = palette.querySelector('.cmd-palette-input');
        if (input) input.value = utt;
        const s = ++nlSeq;
        runAsk(utt, s);
      },
    };
    if (!text) { // empty utterance: no parse, no resolution calls
      interpretation = null;
      container.innerHTML = '<div class="cmd-palette-empty">Type an intent — Tab switches back to Search.</div>';
      return;
    }
    if (!nlParseFn) {
      const loaded = await loadGrammar();
      if (!isCurrentCtx(seq)) return;
      if (!loaded) {
        interpretation = { status: 'refusal', reason: 'grammar_unavailable' };
        container.innerHTML = '<div class="cmd-palette-card refusal"><div class="cmd-palette-card-title">NL grammar failed to load — staying in Search.</div></div>';
        return;
      }
    }

    const parse = nlParseFn(text);

    if (parse.unmatched) {
      interpretation = buildInterpretation(parse, { status: 'unmatched', reason: parse.reason });
      const cardHtml = renderCardHTML(interpretation);
      container.innerHTML = cardHtml;
      // Degradation path: unmatched ALWAYS falls back to useful search.
      const items = await searchAll(api, text);
      if (!isCurrentCtx(seq)) return;
      if (items.length) {
        const listHost = document.createElement('div');
        container.appendChild(listHost);
        activeIndex = 0;
        results = items;
        renderResultsInto(listHost, items, text);
      }
      bindChips(container, ctx.onUtterance);
      return;
    }

    if (parse.queryOnly) {
      interpretation = { status: 'query', qtype: parse.queryOnly.type };
      await answerQuery(api, parse, text, seq, ctx);
      return;
    }

    // Mutating candidate: resolve targets, then interpret (show-not-execute).
    container.innerHTML = '<div class="cmd-palette-card action"><div class="cmd-palette-card-line">Looking up targets…</div></div>';
    const resolution = await resolver.resolve(parse);
    if (!isCurrentCtx(seq)) return;
    const model = buildInterpretation(parse, resolution);
    interpretation = model;
    if (model.status === 'stale') return;
    container.innerHTML = renderCardHTML(model);
    if (model.status === 'ambiguous') {
      container.querySelectorAll('[data-pick]').forEach((el) => {
        el.addEventListener('click', () => {
          const cand = model.candidates[parseInt(el.dataset.pick)];
          if (!cand) return;
          const s = ++nlSeq;
          reResolveWithPick(parse, cand, s, ctx);
        });
      });
    }
  }

  /** Ambiguity selection re-runs resolution scoped to the picked target. */
  async function reResolveWithPick(parse, cand, seq, ctx) {
    const narrowed = { ...parse, slots: { ...(parse.slots || {}), targetId: String(cand.id) } };
    ctx.container.innerHTML = '<div class="cmd-palette-card action"><div class="cmd-palette-card-line">Looking up targets…</div></div>';
    const resolution = await resolver.resolve(narrowed);
    if (!ctx.isCurrent(seq)) return;
    const model = buildInterpretation(narrowed, resolution);
    interpretation = model;
    if (model.status === 'stale') return;
    ctx.container.innerHTML = renderCardHTML(model);
  }

  function isCurrentCtx(seq) { return !!palette && seq === nlSeq; }

  function confirmReadyModel() {
    const m = interpretation;
    if (!m || m.status !== 'ready') return;
    resetNlState();
    close(); // confirm overlays are body-level and survive palette closure
    executeAction({
      kind: m.kind,
      targetId: m.targetId,
      params: m.params,
      api,
      previewLines: m.previewLines,
    });
  }

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (palette) { close(); return; }

      palette = document.createElement('div');
      palette.className = 'cmd-palette-overlay';
      palette.innerHTML = `
        <style>${CSS}</style>
        <div class="cmd-palette">
          <input class="cmd-palette-input" placeholder="Search tasks, projects, agents, views..." autofocus />
          <div class="cmd-palette-results"><div class="cmd-palette-empty">Start typing to search...</div></div>
          <div class="cmd-palette-hint"><span class="cmd-palette-mode-chip" data-mode="search">Search</span><span class="cmd-palette-hint-text">↑↓ navigate · Enter select · Esc close · Tab Ask</span></div>
        </div>
      `;
      document.body.appendChild(palette);

      const input = palette.querySelector('.cmd-palette-input');
      let debounce = null;

      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          if (askMode) {
            const seq = ++nlSeq;
            await runAsk(input.value, seq);
            return;
          }
          const seq = ++searchSeq;
          const q = input.value.trim();
          if (!q) { results = []; renderResults([], q); return; }
          const next = await searchAll(api, q);
          // Fix 14: guard against stale results after close
          if (!palette || seq !== searchSeq) return;
          results = next;
          activeIndex = 0;
          renderResults(results, q);
        }, askMode ? 250 : 200);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { resetNlState(); close(); return; }
        if (e.key === 'Tab') { e.preventDefault(); setAskMode(!askMode); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, Math.max(results.length - 1, 0)); if (!askMode) renderResults(results, input.value.trim()); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); if (!askMode) renderResults(results, input.value.trim()); return; }
        if (e.key === 'Enter') {
          if (askMode) {
            // Two-gate invariant: Enter on a READY interpretation card is the
            // single confirmed hand-off into executeAction(); ambiguous /
            // refusal / query states never fire (AC-I1, brief §2.5). The one
            // exception: an unmatched utterance's degraded search results stay
            // selectable — navigation, not execution.
            e.preventDefault();
            if (interpretation?.status === 'ready') confirmReadyModel();
            else if (!interpretation || ['query', 'refusal', 'ambiguous'].includes(interpretation.status)) {
              if (results[activeIndex]) selectItem(results[activeIndex]);
            }
          } else if (results[activeIndex]) {
            selectItem(results[activeIndex]);
          }
        }
      });

      // Close on backdrop click
      palette.addEventListener('click', (e) => { if (e.target === palette) { resetNlState(); close(); } });

      input.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Fix 14: return cleanup for shell.destroy()
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    resetNlState();
    close();
  };
}

function close() {
  if (palette) { palette.remove(); palette = null; }
  activeIndex = 0;
  results = [];
}

export default initCommandPalette;
