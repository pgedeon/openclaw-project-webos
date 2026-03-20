/**
 * Native Lead Handoffs / Activity Feed View for WebOS Dashboard
 *
 * Shows task ownership changes, claims, releases, status moves, and
 * other task lifecycle events with full task/project context.
 *
 * Data comes from the existing audit_log table joined with tasks + projects.
 * No new tables needed — the infrastructure already exists.
 */

import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

// ── Action config ────────────────────────────────────────────────────
const ACTION_META = {
  create:   { icon: '➕', color: '#22c55e', label: 'Created' },
  update:   { icon: '✏️', color: '#3b82f6', label: 'Updated' },
  move:     { icon: '→',  color: '#a855f7', label: 'Moved' },
  claim:    { icon: '🎯', color: '#f59e0b', label: 'Claimed' },
  release:  { icon: '🔓', color: '#6b7280', label: 'Released' },
  archive:  { icon: '📦', color: '#9ca3af', label: 'Archived' },
  delete:   { icon: '🗑️', color: '#ef4444', label: 'Deleted' },
  retry:    { icon: '🔄', color: '#8b5cf6', label: 'Retried' },
};

const PRI_COLORS = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#16a34a' };

// ── Helpers ──────────────────────────────────────────────────────────
const trunc = (s, n = 50) => (!s ? '' : s.length > n ? s.slice(0, n) + '…' : s);
const relativeTime = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
};
const getActionMeta = (action) => ACTION_META[action] || { icon: '•', color: '#6b7280', label: action };

// ── CSS ──────────────────────────────────────────────────────────────
const CSS_ID = 'ho-styles';
function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = `
    .ho{display:flex;flex-direction:column;height:100%;background:var(--win11-surface-solid);font-family:'Segoe UI',system-ui,-apple-system,sans-serif}
    .ho-tb{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--win11-border);flex-shrink:0;flex-wrap:wrap;background:var(--win11-surface-solid);position:sticky;top:0;z-index:4}
    .ho-tb__title{font-size:1rem;font-weight:600;color:var(--win11-text);margin-right:auto;white-space:nowrap}
    .ho-ctl,.ho-inp{padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none}
    .ho-inp{width:160px}
    .ho-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text-tertiary);font-size:.75rem;cursor:pointer;user-select:none;transition:background .15s,border-color .15s}
    .ho-chip:hover{background:var(--win11-surface-hover)}
    .ho-chip.on{background:var(--win11-accent-light);border-color:var(--win11-accent);color:var(--win11-accent)}

    .ho-body{flex:1;overflow-y:auto;overflow-x:hidden}
    .ho-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;padding:14px 16px 10px;flex-shrink:0}

    /* Feed */
    .ho-feed{padding:0 16px 16px}
    .ho-event{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--win11-border);position:relative;transition:background .15s}
    .ho-event:hover{background:var(--win11-surface-hover);margin:0 -16px;padding:10px 16px}
    .ho-event:last-child{border-bottom:none}
    .ho-event__dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px}
    .ho-event__content{flex:1;min-width:0}
    .ho-event__header{display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap}
    .ho-event__action{font-size:.72rem;font-weight:600;padding:1px 6px;border-radius:4px}
    .ho-event__actor{font-size:.78rem;font-weight:600;color:var(--win11-text)}
    .ho-event__time{font-size:.72rem;color:var(--win11-text-tertiary);margin-left:auto;white-space:nowrap}
    .ho-event__task{font-size:.85rem;color:var(--win11-text);font-weight:500;margin-bottom:2px;word-break:break-word}
    .ho-event__task:hover{color:var(--win11-accent);cursor:pointer}
    .ho-event__detail{font-size:.78rem;color:var(--win11-text-tertiary);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .ho-event__arrow{color:var(--win11-text-tertiary);font-size:.8rem}
    .ho-event__badge{font-size:.7rem;padding:1px 6px;border-radius:4px;background:rgba(0,0,0,.04);color:var(--win11-text-tertiary)}

    /* Owner change highlight */
    .ho-event--handoff{background:rgba(245,158,11,0.04)}
    .ho-event--handoff:hover{background:rgba(245,158,11,0.08)}

    /* Loading / Empty */
    .ho-loading{display:flex;align-items:center;justify-content:center;flex:1;color:var(--win11-text-tertiary);font-size:.9rem}
    .ho-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:60px 20px;color:var(--win11-text-tertiary);text-align:center;gap:12px}
    .ho-empty__icon{font-size:2.5rem;opacity:.5}

    /* Detail panel */
    .ho-det{position:absolute;bottom:0;left:0;right:0;background:var(--win11-surface-solid);border-top:1px solid var(--win11-border);z-index:10;box-shadow:0 -4px 16px rgba(0,0,0,.1);max-height:55%;overflow-y:auto;transition:transform .25s ease;transform:translateY(0)}
    .ho-det.hide{transform:translateY(100%)}
    .ho-det-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--win11-border)}
    .ho-det-title{font-size:.92rem;font-weight:600;color:var(--win11-text);flex:1}
    .ho-det-x{background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:4px}
    .ho-det-x:hover{background:var(--win11-surface-active)}
    .ho-det-bd{padding:12px 16px}
    .ho-det-r{display:flex;gap:12px;margin-bottom:8px;font-size:.82rem}
    .ho-det-l{color:var(--win11-text-tertiary);min-width:80px;flex-shrink:0}
    .ho-det-v{color:var(--win11-text);word-break:break-word}
    .ho-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}

    /* Scrollbar */
    .ho-body::-webkit-scrollbar{width:6px}
    .ho-body::-webkit-scrollbar-thumb{background:var(--win11-border-strong);border-radius:3px}
  `;
  document.head.appendChild(s);
}

// ── Main render ──────────────────────────────────────────────────────
export async function renderHandoffsView({ mountNode, api, adapter, stateStore }) {
  ensureNativeRoot(mountNode, 'handoffs-view');
  injectCSS();

  let destroyed = false;
  let events = [];
  let stats = null;
  let total = 0;
  let page = 0;
  const pageSize = 50;

  // Active action filters
  const activeFilters = new Set(['claim', 'release', 'update', 'create', 'move']);
  let filterActor = '';
  let filterProject = '';

  // ── HTML shell ─────────────────────────────────────────────────────
  mountNode.innerHTML = `
    <div class="ho" style="position:relative">
      <div class="ho-tb">
        <span class="ho-tb__title">🤝 Activity Feed</span>
        <input class="ho-inp" id="hoQ" type="text" placeholder="Search actor…">
        <select class="ho-ctl" id="hoProj"><option value="">All Projects</option></select>
        <span class="ho-chip" id="hoOwner" title="Show only ownership changes">👤 Owner</span>
        <span class="ho-chip" id="hoMoves" title="Show only status moves">→ Status</span>
        <span class="ho-chip on" id="hoAll" title="Show all activity">● All</span>
        <button class="ho-ctl" id="hoRefresh" style="cursor:pointer;padding:5px 10px">↻</button>
      </div>
      <div class="ho-stats" id="hoStats"></div>
      <div class="ho-body" id="hoBody">
        <div class="ho-loading">Loading activity…</div>
      </div>
      <div class="ho-det hide" id="hoDet"></div>
    </div>
  `;

  const $ = (s) => mountNode.querySelector(s);
  const statsEl = $('#hoStats');
  const body = $('#hoBody');
  const det = $('#hoDet');
  const inpQ = $('#hoQ');
  const projSel = $('#hoProj');
  const chipOwner = $('#hoOwner');
  const chipMoves = $('#hoMoves');
  const chipAll = $('#hoAll');
  const btnRefresh = $('#hoRefresh');

  // ── Load projects ──────────────────────────────────────────────────
  try {
    const r = await fetch('/api/projects');
    if (r.ok) {
      const data = await r.json();
      const projs = Array.isArray(data) ? data : (data.projects || data.data || []);
      projs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      projs.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name;
        projSel.appendChild(o);
      });
    }
  } catch (_) { /* non-critical */ }

  // ── Load data ──────────────────────────────────────────────────────
  async function load() {
    if (destroyed) return;
    body.innerHTML = '<div class="ho-loading">Loading activity…</div>';

    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      });

      if (activeFilters.size < 7) {
        params.set('action', [...activeFilters].join(','));
      }
      if (filterActor) params.set('actor', filterActor);
      if (filterProject) params.set('project_id', filterProject);

      const r = await fetch(`/api/lead-handoffs?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      events = data.events || [];
      stats = data.stats || {};
      total = data.total || 0;
      draw();
    } catch (e) {
      body.innerHTML = `<div class="ho-empty"><div class="ho-empty__icon">⚠️</div><p>Failed to load activity feed.</p><p style="font-size:.8rem">${escapeHtml(e.message)}</p></div>`;
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────
  function draw() {
    if (destroyed) return;

    // Stats
    if (stats) {
      statsEl.innerHTML = `
        ${createStatCard({ label: 'Owner Changes', value: String(stats.handoffs || 0), tone: 'info' }).outerHTML}
        ${createStatCard({ label: 'Status Moves', value: String(stats.updated || 0), tone: 'default' }).outerHTML}
        ${createStatCard({ label: 'Created', value: String(stats.created || 0), tone: 'success' }).outerHTML}
        ${createStatCard({ label: 'Archived', value: String(stats.archived || 0), tone: 'default' }).outerHTML}
        ${createStatCard({ label: 'Participants', value: String(stats.actors || 0), tone: 'default' }).outerHTML}
      `;
    }

    if (events.length === 0) {
      body.innerHTML = `
        <div class="ho-empty">
          <div class="ho-empty__icon">🤝</div>
          <p>No activity events found.</p>
          <p style="font-size:.8rem;color:var(--win11-text-tertiary)">Adjust filters or wait for new events.</p>
        </div>
      `;
      return;
    }

    const feed = document.createElement('div');
    feed.className = 'ho-feed';

    events.forEach(evt => {
      const meta = getActionMeta(evt.action);
      const isHandoff = evt.isOwnerChange || evt.action === 'claim' || evt.action === 'release';
      const el = document.createElement('div');
      el.className = 'ho-event' + (isHandoff ? ' ho-event--handoff' : '');

      // Build description based on action type
      let description = '';
      if (evt.action === 'claim') {
        description = `${escapeHtml(evt.actor)} claimed`;
      } else if (evt.action === 'release') {
        description = `${escapeHtml(evt.actor)} released`;
      } else if (evt.isOwnerChange && evt.oldOwner !== evt.newOwner) {
        const from = evt.oldOwner || 'unassigned';
        const to = evt.newOwner || 'unassigned';
        description = `Owner: ${escapeHtml(from)} → ${escapeHtml(to)}`;
      } else if (evt.oldStatus && evt.newStatus && evt.oldStatus !== evt.newStatus) {
        description = `Status: ${escapeHtml(evt.oldStatus)} → ${escapeHtml(evt.newStatus)}`;
      } else if (evt.action === 'create') {
        description = `Created by ${escapeHtml(evt.actor)}`;
      } else if (evt.action === 'archive') {
        description = `Archived by ${escapeHtml(evt.actor)}`;
      } else if (evt.action === 'delete') {
        description = `Deleted by ${escapeHtml(evt.actor)}`;
      } else {
        description = `Updated by ${escapeHtml(evt.actor)}`;
      }

      const taskName = evt.taskTitle || 'Untitled';

      el.innerHTML = `
        <div class="ho-event__dot" style="background:${meta.color}"></div>
        <div class="ho-event__content">
          <div class="ho-event__header">
            <span class="ho-event__action" style="background:${meta.color}18;color:${meta.color}">${meta.icon} ${meta.label}</span>
            <span class="ho-event__time">${relativeTime(evt.timestamp)}</span>
          </div>
          <div class="ho-event__task" data-task-id="${evt.taskId}" title="${escapeHtml(taskName)}">${escapeHtml(trunc(taskName))}</div>
          <div class="ho-event__detail">
            <span>${description}</span>
            <span class="ho-event__badge">${escapeHtml(evt.projectName || '—')}</span>
            ${evt.taskPriority ? `<span class="ho-event__badge" style="color:${PRI_COLORS[evt.taskPriority] || '#6b7280'}">${evt.taskPriority}</span>` : ''}
          </div>
        </div>
      `;

      // Click task name to inspect
      el.querySelector('.ho-event__task').addEventListener('click', () => inspect(evt));

      feed.appendChild(el);
    });

    // Load more button
    if (total > (page + 1) * pageSize) {
      const more = document.createElement('div');
      more.style.cssText = 'text-align:center;padding:16px;';
      more.innerHTML = `<button class="ho-ctl" style="cursor:pointer;padding:8px 20px">Load more (${total - (page + 1) * pageSize} remaining)</button>`;
      more.querySelector('button').addEventListener('click', () => {
        page++;
        loadMore();
      });
      feed.appendChild(more);
    }

    body.innerHTML = '';
    body.appendChild(feed);
  }

  async function loadMore() {
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (activeFilters.size < 7) params.set('action', [...activeFilters].join(','));
      if (filterActor) params.set('actor', filterActor);
      if (filterProject) params.set('project_id', filterProject);

      const r = await fetch(`/api/lead-handoffs?${params}`);
      if (!r.ok) return;
      const data = await r.json();
      events = data.events || [];
      // Remove the "Load more" button and re-render
      draw();
    } catch (e) {
      console.error('[HandoffsView] loadMore failed:', e);
    }
  }

  // ── Inspect event ──────────────────────────────────────────────────
  function inspect(evt) {
    const meta = getActionMeta(evt.action);
    const created = new Date(evt.timestamp);
    det.classList.remove('hide');
    det.innerHTML = `
      <div class="ho-det-hd">
        <span class="ho-det-title">${escapeHtml(trunc(evt.taskTitle, 80))}</span>
        <button class="ho-det-x" id="hoDetX">✕</button>
      </div>
      <div class="ho-det-bd">
        <div class="ho-det-r"><span class="ho-det-l">Action</span><span><span class="ho-badge" style="background:${meta.color}18;color:${meta.color}">${meta.icon} ${meta.label}</span></span></div>
        <div class="ho-det-r"><span class="ho-det-l">Actor</span><span class="ho-det-v">${escapeHtml(evt.actor || '—')}</span></div>
        <div class="ho-det-r"><span class="ho-det-l">Project</span><span class="ho-det-v">${escapeHtml(evt.projectName || '—')}</span></div>
        <div class="ho-det-r"><span class="ho-det-l">Time</span><span class="ho-det-v">${created.toLocaleString()} (${relativeTime(evt.timestamp)})</span></div>
        <div class="ho-det-r"><span class="ho-det-l">Task Status</span><span class="ho-det-v">${escapeHtml(evt.taskStatus || '—')}</span></div>
        <div class="ho-det-r"><span class="ho-det-l">Task Owner</span><span class="ho-det-v">${escapeHtml(evt.taskOwner || 'unassigned')}</span></div>
        <div class="ho-det-r"><span class="ho-det-l">Priority</span><span class="ho-det-v">${escapeHtml(evt.taskPriority || '—')}</span></div>
        ${evt.oldOwner !== evt.newOwner && evt.newOwner !== undefined ? `<div class="ho-det-r"><span class="ho-det-l">Owner</span><span class="ho-det-v">${escapeHtml(evt.oldOwner || 'unassigned')} → ${escapeHtml(evt.newOwner || 'unassigned')}</span></div>` : ''}
        ${evt.oldStatus && evt.newStatus ? `<div class="ho-det-r"><span class="ho-det-l">Status</span><span class="ho-det-v">${escapeHtml(evt.oldStatus)} → ${escapeHtml(evt.newStatus)}</span></div>` : ''}
      </div>
    `;

    det.querySelector('#hoDetX').addEventListener('click', () => det.classList.add('hide'));
  }

  // ── Event bindings ─────────────────────────────────────────────────
  inpQ.addEventListener('input', () => {
    filterActor = inpQ.value.trim();
    page = 0;
    load();
  });

  projSel.addEventListener('change', () => {
    filterProject = projSel.value;
    page = 0;
    load();
  });

  chipOwner.addEventListener('click', () => {
    activeFilters.clear();
    activeFilters.add('claim');
    activeFilters.add('release');
    activeFilters.add('update');
    chipOwner.classList.add('on');
    chipMoves.classList.remove('on');
    chipAll.classList.remove('on');
    page = 0;
    load();
  });

  chipMoves.addEventListener('click', () => {
    activeFilters.clear();
    activeFilters.add('update');
    activeFilters.add('move');
    chipMoves.classList.add('on');
    chipOwner.classList.remove('on');
    chipAll.classList.remove('on');
    page = 0;
    load();
  });

  chipAll.addEventListener('click', () => {
    activeFilters.clear();
    // Default: all except delete (clutter)
    ['claim', 'release', 'update', 'create', 'move', 'archive'].forEach(a => activeFilters.add(a));
    chipAll.classList.add('on');
    chipOwner.classList.remove('on');
    chipMoves.classList.remove('on');
    page = 0;
    load();
  });

  btnRefresh.addEventListener('click', () => { page = 0; load(); });

  const onKey = (e) => { if (e.key === 'Escape') det.classList.add('hide'); };
  mountNode.addEventListener('keydown', onKey);

  // ── Initial load ───────────────────────────────────────────────────
  await load();

  // ── Cleanup ───────────────────────────────────────────────────────
  return () => {
    destroyed = true;
    mountNode.removeEventListener('keydown', onKey);
    mountNode.innerHTML = '';
  };
}

export default renderHandoffsView;
