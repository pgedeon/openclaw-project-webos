/**
 * Native Kanban Board View for WebOS Dashboard
 *
 * Design principles:
 * - Board is project-scoped (workflows differ per project) with a project selector
 * - Completed column hidden by default (toggle to show) — most tasks are completed
 * - Drag-and-drop to move tasks between status columns
 * - Inline task detail panel on click
 * - Include child projects toggle
 * - Compact, scannable card design
 */

import { ensureNativeRoot, escapeHtml, normalizeCollection } from './helpers.mjs';

// ── Status config ────────────────────────────────────────────────────
const STATUS_META = {
  backlog:     { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', icon: '☐' },
  ready:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: '◐' },
  in_progress: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  icon: '◑' },
  blocked:     { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   icon: '⛔' },
  review:      { color: '#a855f7', bg: 'rgba(168,85,247,0.12)',  icon: '👁' },
  completed:   { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   icon: '✓' },
  archived:    { color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', icon: '📁' },
};

const PRI_COLORS = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#16a34a' };

// ── CSS (injected once) ──────────────────────────────────────────────
const CSS_ID = 'kb-styles';
function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = `
    .kb{display:flex;flex-direction:column;height:100%;background:var(--win11-surface-solid);font-family:'Segoe UI',system-ui,-apple-system,sans-serif}

    /* Toolbar */
    .kb-tb{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--win11-border);flex-shrink:0;flex-wrap:wrap;background:var(--win11-surface-solid);position:sticky;top:0;z-index:4}
    .kb-tb__title{font-size:1rem;font-weight:600;color:var(--win11-text);margin-right:auto;white-space:nowrap}
    .kb-ctl,.kb-inp{padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none}
    .kb-inp{width:170px}
    .kb-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text-tertiary);font-size:.78rem;cursor:pointer;user-select:none;transition:background .15s,border-color .15s}
    .kb-chip:hover{background:var(--win11-surface-hover)}
    .kb-chip.on{background:var(--win11-accent-light);border-color:var(--win11-accent);color:var(--win11-accent)}
    .kb-chip__dot{width:6px;height:6px;border-radius:50%;background:currentColor}

    /* Board body */
    .kb-body{display:flex;flex:1;overflow-x:auto;overflow-y:hidden;gap:0;padding:0 0 0 0}

    /* Column */
    .kb-col{flex:0 0 290px;display:flex;flex-direction:column;max-height:100%;border-right:1px solid var(--win11-border)}
    .kb-col:last-child{border-right:none}
    .kb-col-hd{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;flex-shrink:0;position:sticky;top:0;z-index:2;background:var(--win11-surface-solid)}
    .kb-col-hd__dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .kb-col-hd__name{font-size:.82rem;font-weight:600;color:var(--win11-text);flex:1;text-transform:capitalize}
    .kb-col-hd__cnt{font-size:.72rem;font-weight:600;padding:1px 7px;border-radius:999px;min-width:22px;text-align:center;color:#fff}
    .kb-col-hd__add{background:none;border:none;cursor:pointer;font-size:1rem;color:var(--win11-text-tertiary);padding:2px 6px;border-radius:4px;line-height:1}
    .kb-col-hd__add:hover{background:var(--win11-surface-active);color:var(--win11-text)}
    .kb-col-body{flex:1;overflow-y:auto;padding:0 10px 10px;display:flex;flex-direction:column;gap:8px;min-height:60px}
    .kb-col.drag-over .kb-col-body{background:rgba(59,130,246,0.04);border-radius:8px;outline:2px dashed rgba(59,130,246,0.3);outline-offset:-2px}
    .kb-col-empty{display:flex;align-items:center;justify-content:center;padding:20px;color:var(--win11-text-tertiary);font-size:.78rem;opacity:.5}

    /* Card */
    .kb-card{background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:8px;padding:10px 11px;cursor:grab;transition:transform .15s,box-shadow .15s,border-color .15s;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    .kb-card:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1);border-color:var(--win11-border-strong)}
    .kb-card.dragging{opacity:.4;transform:rotate(2deg)}
    .kb-card__title{font-size:.83rem;font-weight:500;color:var(--win11-text);line-height:1.35;margin-bottom:6px;word-break:break-word}
    .kb-card__meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .kb-card__pri{font-size:.68rem;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:4px}
    .kb-card__proj{font-size:.68rem;color:var(--win11-text-tertiary);background:rgba(0,0,0,.04);padding:1px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
    .kb-card__age{font-size:.68rem;color:var(--win11-text-tertiary);margin-left:auto;white-space:nowrap}
    .kb-card__labels{display:flex;gap:3px;flex-wrap:wrap;margin-top:6px}
    .kb-card__lbl{font-size:.65rem;padding:1px 5px;border-radius:999px;background:var(--win11-accent-light);color:var(--win11-accent);font-weight:500}

    /* Drag ghost */
    .kb-drop-ghost{height:3px;border-radius:2px;background:var(--win11-accent);margin:2px 0;transition:opacity .15s}

    /* Detail panel */
    .kb-det{position:absolute;bottom:0;left:0;right:0;background:var(--win11-surface-solid);border-top:1px solid var(--win11-border);z-index:10;box-shadow:0 -4px 16px rgba(0,0,0,.1);max-height:55%;overflow-y:auto;transition:transform .25s ease;transform:translateY(0)}
    .kb-det.hide{transform:translateY(100%)}
    .kb-det-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--win11-border)}
    .kb-det-title{font-size:.92rem;font-weight:600;color:var(--win11-text);flex:1}
    .kb-det-x{background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:4px}
    .kb-det-x:hover{background:var(--win11-surface-active)}
    .kb-det-bd{padding:12px 16px}
    .kb-det-r{display:flex;gap:12px;margin-bottom:8px;font-size:.82rem}
    .kb-det-l{color:var(--win11-text-tertiary);min-width:80px;flex-shrink:0}
    .kb-det-v{color:var(--win11-text);word-break:break-word}
    .kb-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}

    /* Toast */
    .kb-toast{position:absolute;top:60px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:8px;font-size:.82rem;z-index:20;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s,transform .3s;pointer-events:none}
    .kb-toast.err{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .kb-toast.ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}

    /* Empty state */
    .kb-empty{display:flex;align-items:center;justify-content:center;flex:1;padding:60px 20px;color:var(--win11-text-tertiary);font-size:.9rem;text-align:center;flex-direction:column;gap:12px}

    /* Scrollbar */
    .kb-body::-webkit-scrollbar,.kb-col-body::-webkit-scrollbar{width:6px;height:6px}
    .kb-body::-webkit-scrollbar-thumb,.kb-col-body::-webkit-scrollbar-thumb{background:var(--win11-border-strong);border-radius:3px}
    .kb-col-body::-webkit-scrollbar-thumb{width:5px}

    /* Quick add form */
    .kb-quick-add{padding:6px 10px 10px}
    .kb-quick-add input{width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none;box-sizing:border-box}
    .kb-quick-add input:focus{border-color:var(--win11-accent)}
    .kb-quick-add input::placeholder{color:var(--win11-text-tertiary)}
  `;
  document.head.appendChild(s);
}

// ── Helpers ──────────────────────────────────────────────────────────
const trunc = (s, n = 60) => (!s ? '' : s.length > n ? s.slice(0, n) + '…' : s);
const parseDate = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
const relativeAge = (dateStr) => {
  const d = parseDate(dateStr);
  if (!d) return '';
  const diff = Date.now() - d;
  const days = Math.floor(diff / 864e5);
  if (days < 1) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

// ── Main render ──────────────────────────────────────────────────────
export async function renderBoardView({ mountNode, api, adapter, stateStore }) {
  ensureNativeRoot(mountNode, 'kanban-board');
  injectCSS();

  let destroyed = false;
  let projects = [];
  let currentProjectId = '';
  let boardData = null;
  let selectedTask = null;
  let showCompleted = false;
  let includeChildren = false;
  let searchQuery = '';
  let draggedTask = null;

  // ── HTML shell ─────────────────────────────────────────────────────
  mountNode.innerHTML = `
    <div class="kb" style="position:relative">
      <div class="kb-tb">
        <span class="kb-tb__title">📋 Board</span>
        <select class="kb-ctl" id="kbProj"><option value="">Loading projects…</option></select>
        <input class="kb-inp" id="kbQ" type="text" placeholder="Filter cards…">
        <span class="kb-chip" id="kbComp"><span class="kb-chip__dot"></span>Completed</span>
        <span class="kb-chip" id="kbChild"><span class="kb-chip__dot"></span>Sub-projects</span>
      </div>
      <div class="kb-body" id="kbBody"></div>
      <div class="kb-det hide" id="kbDet"></div>
    </div>
  `;

  const $ = (s) => mountNode.querySelector(s);
  const projSel = $('#kbProj');
  const inpQ = $('#kbQ');
  const chipComp = $('#kbComp');
  const chipChild = $('#kbChild');
  const body = $('#kbBody');
  const det = $('#kbDet');

  // ── Load projects ──────────────────────────────────────────────────
  try {
    const r = await fetch('/api/projects');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    projects = normalizeCollection(data, ['projects', 'data']);
  } catch (e) {
    body.innerHTML = `<div class="kb-empty"><p>Failed to load projects.</p><p style="font-size:.8rem">${escapeHtml(e.message)}</p></div>`;
    return () => {};
  }
  if (destroyed) return () => {};

  // Populate project dropdown — prefer projects with active tasks
  projects.sort((a, b) => {
    const aActive = (a.active_task_count || 0) - (a.completed_task_count || 0);
    const bActive = (b.active_task_count || 0) - (b.completed_task_count || 0);
    return bActive - aActive;
  });

  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    // Indicate child count
    if (Number(p.child_count || 0) > 0) {
      o.textContent += ` (${p.child_count} children)`;
    }
    projSel.appendChild(o);
  });

  // Auto-select first project or default
  if (projects.length > 0) {
    currentProjectId = projects[0].id;
    projSel.value = currentProjectId;
  }

  // ── Load board data ────────────────────────────────────────────────
  async function loadBoard() {
    if (destroyed || !currentProjectId) return;
    try {
      const params = new URLSearchParams({ project_id: currentProjectId });
      if (includeChildren) params.set('include_child_projects', 'true');
      const r = await fetch(`/api/views/board?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      boardData = await r.json();
      draw();
    } catch (e) {
      showToast(`Failed to load board: ${e.message}`, true);
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────
  function draw() {
    if (destroyed || !boardData) return;

    const { columns, workflow, project } = boardData;
    const q = searchQuery.toLowerCase();

    body.innerHTML = '';

    // Build visible columns
    const visibleStates = showCompleted
      ? workflow
      : workflow.filter(s => s !== 'completed' && s !== 'archived');

    if (visibleStates.length === 0) {
      body.innerHTML = '<div class="kb-empty"><p>No columns to display.</p></div>';
      return;
    }

    visibleStates.forEach(status => {
      const meta = STATUS_META[status] || STATUS_META.backlog;
      let tasks = (columns[status] || []).filter(t => {
        if (!q) return true;
        const title = (t.text || t.title || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const proj = (t.project_name || '').toLowerCase();
        return title.includes(q) || desc.includes(q) || proj.includes(q);
      });

      // Column
      const col = document.createElement('div');
      col.className = 'kb-col';
      col.dataset.status = status;

      // Column header
      col.innerHTML = `
        <div class="kb-col-hd">
          <span class="kb-col-hd__dot" style="background:${meta.color}"></span>
          <span class="kb-col-hd__name">${escapeHtml(status.replace(/_/g, ' '))}</span>
          <span class="kb-col-hd__cnt" style="background:${meta.color}">${tasks.length}</span>
          <button class="kb-col-hd__add" data-status="${status}" title="Add task">+</button>
        </div>
      `;

      // Column body (drop zone)
      const colBody = document.createElement('div');
      colBody.className = 'kb-col-body';

      if (tasks.length === 0) {
        colBody.innerHTML = '<div class="kb-col-empty">Drop here</div>';
      } else {
        tasks.forEach(task => {
          const card = createCard(task, status);
          colBody.appendChild(card);
        });
      }

      // Drag events on column body
      colBody.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      colBody.addEventListener('dragleave', (e) => {
        if (!colBody.contains(e.relatedTarget)) {
          col.classList.remove('drag-over');
        }
      });
      colBody.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        await handleDrop(e, status);
      });

      col.appendChild(colBody);
      body.appendChild(col);
    });

    // Add button handlers
    body.querySelectorAll('.kb-col-hd__add').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        const colBody = btn.closest('.kb-col').querySelector('.kb-col-body');
        showQuickAdd(colBody, status);
      });
    });
  }

  // ── Create card ────────────────────────────────────────────────────
  function createCard(task, status) {
    const meta = STATUS_META[status] || STATUS_META.backlog;
    const pri = task.priority || 'none';
    const priColor = PRI_COLORS[pri] || '#6b7280';
    const name = task.text || task.title || 'Untitled';
    const proj = task.project_name || '';
    const isChild = boardData?.project?.aggregated && task.project_id !== currentProjectId;

    const card = document.createElement('div');
    card.className = 'kb-card';
    card.draggable = true;
    card.dataset.taskId = task.id;

    let labelsHtml = '';
    if (task.labels?.length) {
      labelsHtml = `<div class="kb-card__labels">${task.labels.slice(0, 3).map(l => `<span class="kb-card__lbl">${escapeHtml(l)}</span>`).join('')}${task.labels.length > 3 ? `<span class="kb-card__lbl">+${task.labels.length - 3}</span>` : ''}</div>`;
    }

    card.innerHTML = `
      <div class="kb-card__title">${escapeHtml(trunc(name, 80))}</div>
      <div class="kb-card__meta">
        <span class="kb-card__pri" style="color:${priColor};background:${priColor}15">${pri}</span>
        ${isChild ? `<span class="kb-card__proj" title="${escapeHtml(proj)}">${escapeHtml(trunc(proj, 16))}</span>` : ''}
        ${task.owner && task.owner !== 'None' ? `<span class="kb-card__proj">${escapeHtml(trunc(task.owner, 12))}</span>` : ''}
        <span class="kb-card__age">${relativeAge(task.created_at)}</span>
      </div>
      ${labelsHtml}
    `;

    // Left border accent
    card.style.borderLeftWidth = '3px';
    card.style.borderLeftColor = meta.color;

    // Click to inspect
    card.addEventListener('click', () => inspect(task));

    // Drag
    card.addEventListener('dragstart', (e) => {
      draggedTask = task;
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedTask = null;
      body.querySelectorAll('.kb-col').forEach(c => c.classList.remove('drag-over'));
    });

    return card;
  }

  // ── Handle drop ────────────────────────────────────────────────────
  async function handleDrop(event, newStatus) {
    const taskId = event.dataTransfer.getData('text/plain');
    if (!taskId || !draggedTask) return;

    const oldStatus = draggedTask.status;
    if (oldStatus === newStatus) return;

    // Optimistic update in local data
    const oldCol = boardData.columns[oldStatus];
    if (oldCol) {
      boardData.columns[oldStatus] = oldCol.filter(t => t.id !== taskId);
    }
    if (!boardData.columns[newStatus]) boardData.columns[newStatus] = [];
    draggedTask.status = newStatus;
    boardData.columns[newStatus].push(draggedTask);

    draw();

    // Persist
    try {
      const r = await fetch(`/api/tasks/${taskId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!r.ok) throw new Error(await r.text());
      showToast(`Moved to ${newStatus.replace(/_/g, ' ')}`, false);
    } catch (e) {
      showToast(`Move failed: ${e.message}`, true);
      // Reload to revert
      await loadBoard();
    }
  }

  // ── Quick add ──────────────────────────────────────────────────────
  function showQuickAdd(colBody, status) {
    // Don't add if form already present
    if (colBody.querySelector('.kb-quick-add')) return;

    // Remove any empty placeholder
    const empty = colBody.querySelector('.kb-col-empty');
    if (empty) empty.remove();

    const form = document.createElement('div');
    form.className = 'kb-quick-add';
    form.innerHTML = `<input type="text" placeholder="Task title… press Enter" />`;
    colBody.prepend(form);

    const input = form.querySelector('input');
    input.focus();

    const submit = async () => {
      const title = input.value.trim();
      if (!title) { form.remove(); return; }

      input.disabled = true;
      input.placeholder = 'Creating…';

      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            project_id: currentProjectId,
            status,
            priority: 'medium',
          })
        });
        if (!r.ok) throw new Error(await r.text());
        const task = await r.json();
        boardData.columns[status] = boardData.columns[status] || [];
        boardData.columns[status].unshift(task);
        draw();
        showToast('Task created', false);
      } catch (e) {
        showToast(`Create failed: ${e.message}`, true);
        input.disabled = false;
        input.placeholder = 'Task title… press Enter';
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') form.remove();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => form.remove(), 200);
    });
  }

  // ── Inspect task ───────────────────────────────────────────────────
  function inspect(task) {
    selectedTask = task;
    const status = task.status || 'backlog';
    const meta = STATUS_META[status] || STATUS_META.backlog;
    const name = task.text || task.title || 'Untitled';
    const created = parseDate(task.created_at);
    const completed = parseDate(task.completed_at);
    const updated = parseDate(task.updated_at);

    det.classList.remove('hide');
    det.innerHTML = `
      <div class="kb-det-hd">
        <span class="kb-det-title">${escapeHtml(trunc(name, 80))}</span>
        <button class="kb-det-x" id="kbDetX">✕</button>
      </div>
      <div class="kb-det-bd">
        <div class="kb-det-r"><span class="kb-det-l">Status</span><span><span class="kb-badge" style="background:${meta.bg};color:${meta.color}">${meta.icon} ${status.replace(/_/g, ' ')}</span></span></div>
        <div class="kb-det-r"><span class="kb-det-l">Priority</span><span class="kb-det-v">${(task.priority || 'none')[0].toUpperCase()}${(task.priority || 'none').slice(1)}</span></div>
        <div class="kb-det-r"><span class="kb-det-l">Project</span><span class="kb-det-v">${escapeHtml(task.project_name || '—')}</span></div>
        ${task.owner && task.owner !== 'None' ? `<div class="kb-det-r"><span class="kb-det-l">Owner</span><span class="kb-det-v">${escapeHtml(task.owner)}</span></div>` : ''}
        ${created ? `<div class="kb-det-r"><span class="kb-det-l">Created</span><span class="kb-det-v">${created.toLocaleString()}</span></div>` : ''}
        ${completed ? `<div class="kb-det-r"><span class="kb-det-l">Completed</span><span class="kb-det-v">${completed.toLocaleString()}</span></div>` : ''}
        ${updated ? `<div class="kb-det-r"><span class="kb-det-l">Updated</span><span class="kb-det-v">${updated.toLocaleString()}</span></div>` : ''}
        ${task.description ? `<div class="kb-det-r" style="flex-direction:column"><span class="kb-det-l">Description</span><span class="kb-det-v" style="margin-top:4px">${escapeHtml(task.description)}</span></div>` : ''}
        ${task.labels?.length ? `<div class="kb-det-r"><span class="kb-det-l">Labels</span><span class="kb-det-v">${task.labels.map(l => `<span class="kb-badge" style="background:var(--win11-accent-light);color:var(--win11-accent)">${escapeHtml(l)}</span>`).join(' ')}</span></div>` : ''}
        <div class="kb-det-r" style="margin-top:8px;gap:8px">
          <button class="kb-ctl" id="kbMoveMenu" style="padding:5px 12px;cursor:pointer">Move to →</button>
        </div>
      </div>
    `;

    det.querySelector('#kbDetX').addEventListener('click', closeDetail);

    // Move-to dropdown
    const moveBtn = det.querySelector('#kbMoveMenu');
    const allStates = boardData?.workflow || ['backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed', 'archived'];
    const otherStates = allStates.filter(s => s !== status);

    moveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove existing menu
      const old = det.querySelector('.kb-move-menu');
      if (old) { old.remove(); return; }

      const menu = document.createElement('div');
      menu.className = 'kb-move-menu';
      menu.style.cssText = 'position:absolute;bottom:100%;right:16px;background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;box-shadow:0 -4px 16px rgba(0,0,0,.1);overflow:hidden;z-index:15;min-width:160px';
      otherStates.forEach(s => {
        const sm = STATUS_META[s] || STATUS_META.backlog;
        const item = document.createElement('button');
        item.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:.82rem;color:var(--win11-text);text-align:left;transition:background .1s`;
        item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${sm.color};flex-shrink:0"></span><span style="text-transform:capitalize">${s.replace(/_/g, ' ')}</span>`;
        item.addEventListener('mouseenter', () => item.style.background = 'var(--win11-surface-hover)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', async () => {
          menu.remove();
          await moveTask(task.id, s);
        });
        menu.appendChild(item);
      });
      det.appendChild(menu);

      // Close on outside click
      const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
      setTimeout(() => document.addEventListener('click', closeMenu), 0);
    });
  }

  async function moveTask(taskId, newStatus) {
    // Optimistic
    const task = findTask(taskId);
    if (!task) return;
    const oldStatus = task.status;
    if (boardData.columns[oldStatus]) {
      boardData.columns[oldStatus] = boardData.columns[oldStatus].filter(t => t.id !== taskId);
    }
    if (!boardData.columns[newStatus]) boardData.columns[newStatus] = [];
    task.status = newStatus;
    boardData.columns[newStatus].push(task);
    closeDetail();
    draw();

    try {
      const r = await fetch(`/api/tasks/${taskId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!r.ok) throw new Error(await r.text());
      showToast(`Moved to ${newStatus.replace(/_/g, ' ')}`, false);
    } catch (e) {
      showToast(`Move failed: ${e.message}`, true);
      await loadBoard();
    }
  }

  function findTask(id) {
    for (const tasks of Object.values(boardData?.columns || {})) {
      const found = tasks.find(t => t.id === id);
      if (found) return found;
    }
    return null;
  }

  function closeDetail() {
    det.classList.add('hide');
    selectedTask = null;
  }

  // ── Toast ──────────────────────────────────────────────────────────
  function showToast(msg, isError) {
    const existing = mountNode.querySelector('.kb-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `kb-toast ${isError ? 'err' : 'ok'}`;
    toast.textContent = msg;
    mountNode.querySelector('.kb').appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(-10px)'; setTimeout(() => toast.remove(), 300); }, 2500);
  }

  // ── Event bindings ─────────────────────────────────────────────────
  projSel.addEventListener('change', () => {
    currentProjectId = projSel.value;
    closeDetail();
    loadBoard();
  });

  inpQ.addEventListener('input', () => {
    searchQuery = inpQ.value;
    draw();
  });

  chipComp.addEventListener('click', () => {
    showCompleted = !showCompleted;
    chipComp.classList.toggle('on', showCompleted);
    draw();
  });

  chipChild.addEventListener('click', () => {
    includeChildren = !includeChildren;
    chipChild.classList.toggle('on', includeChildren);
    loadBoard();
  });

  const onKey = (e) => { if (e.key === 'Escape') closeDetail(); };
  mountNode.addEventListener('keydown', onKey);

  // ── Initial load ───────────────────────────────────────────────────
  await loadBoard();

  // ── Cleanup ───────────────────────────────────────────────────────
  return () => {
    destroyed = true;
    mountNode.removeEventListener('keydown', onKey);
    mountNode.innerHTML = '';
  };
}

export default renderBoardView;
