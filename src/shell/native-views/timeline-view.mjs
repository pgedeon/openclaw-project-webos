/**
 * Gantt-Style Timeline View for WebOS Dashboard
 *
 * Horizontal time-axis Gantt chart with:
 * - Status-coded horizontal bars (created → completed, or created → now for active tasks)
 * - Day / Week / Month zoom levels
 * - Click-to-inspect inline detail panel
 * - Status, priority, and project filters
 * - Scroll-synced sidebar with task names
 */

import { ensureNativeRoot, escapeHtml, normalizeCollection } from './helpers.mjs';

// ── Constants ────────────────────────────────────────────────────────
const STATUS_COLORS = {
  backlog:      { bar: '#8b8b8b', bg: 'rgba(139,139,139,0.15)', label: 'Backlog' },
  ready:        { bar: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: 'Ready' },
  in_progress:  { bar: '#3b82f6', bg: 'rgba(59,130,246,0.15)', label: 'In Progress' },
  review:       { bar: '#a855f7', bg: 'rgba(168,85,247,0.15)', label: 'Review' },
  completed:    { bar: '#22c55e', bg: 'rgba(34,197,94,0.15)',  label: 'Completed' },
  archived:     { bar: '#6b7280', bg: 'rgba(107,114,128,0.1)',  label: 'Archived' },
};

const PRIORITY_SYMBOLS = { high: '●', medium: '○', low: '◌' };

const ZOOM_LEVELS = [
  { id: 'day',   pixelsPerDay: 44, tickDays: 1 },
  { id: 'week',  pixelsPerDay: 10, tickDays: 7 },
  { id: 'month', pixelsPerDay: 3,  tickDays: 30 },
];

// ── Utility helpers ──────────────────────────────────────────────────
const parseDate = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const statusOf = (s) => STATUS_COLORS[s] || STATUS_COLORS.backlog;
const trunc = (s, n = 38) => (!s ? '' : s.length > n ? s.slice(0, n) + '…' : s);
const isTestTask = (t) => { const title = t.title || ''; return title.startsWith('BOARD_TEST') || title.startsWith('TEST_WORKFLOW') || title.startsWith('TEST_GRAPH'); };

// ── CSS (injected once) ──────────────────────────────────────────────
const STYLE_ID = 'tg-gantt-styles';
function injectStyles(root) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tg{display:flex;flex-direction:column;height:100%;background:var(--win11-surface-solid);font-family:'Segoe UI',system-ui,-apple-system,sans-serif}
    .tg-bar{position:absolute;height:20px;border-radius:10px;cursor:pointer;display:flex;align-items:center;padding:0 8px;min-width:4px;transition:transform .15s,box-shadow .15s;font-size:.72rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 2px rgba(0,0,0,.12)}
    .tg-bar:hover{transform:scaleY(1.25);box-shadow:0 2px 8px rgba(0,0,0,.22);z-index:5}
    .tg-bar--dot{border-radius:50%;width:12px;height:12px;min-width:12px;padding:0}
    .tg-bar--live{animation:tgPulse 2s ease-in-out infinite}
    @keyframes tgPulse{0%,100%{opacity:1}50%{opacity:.7}}
    .tg-now-dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,.3);top:50%;transform:translate(-50%,-50%)}
    .tg-row{height:38px;position:relative;border-bottom:1px solid var(--win11-border)}
    .tg-row-side{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;transition:background .15s;height:38px;box-sizing:border-box;border-bottom:1px solid var(--win11-border)}
    .tg-row-side:hover{background:var(--win11-surface-hover)}
    .tg-row-side.sel{background:var(--win11-accent-light)}
    .tg-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .tg-pri{font-size:.7rem;color:var(--win11-text-tertiary);width:12px;text-align:center;flex-shrink:0}
    .tg-name{font-size:.82rem;color:var(--win11-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
    .tg-proj{font-size:.7rem;color:var(--win11-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px}
    .tg-today{position:absolute;top:0;bottom:0;width:2px;background:var(--win11-accent);z-index:1;opacity:.55}
    .tg-today-label{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:.62rem;font-weight:700;color:var(--win11-accent);background:var(--win11-accent-light);padding:2px 6px;border-radius:4px;white-space:nowrap}
    .tg-gridline{position:absolute;top:0;bottom:0;width:1px;background:var(--win11-border);opacity:.35;transform:translateX(-50%)}
    .tg-empty{display:flex;align-items:center;justify-content:center;padding:60px 20px;color:var(--win11-text-tertiary);font-size:.9rem;text-align:center}
    .tg-detail{position:absolute;bottom:0;left:0;right:0;background:var(--win11-surface-solid);border-top:1px solid var(--win11-border);z-index:10;box-shadow:0 -4px 16px rgba(0,0,0,.1);max-height:50%;overflow-y:auto;transition:transform .25s ease;transform:translateY(0)}
    .tg-detail.hide{transform:translateY(100%)}
    .tg-detail-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--win11-border)}
    .tg-detail-title{font-size:.95rem;font-weight:600;color:var(--win11-text);flex:1}
    .tg-detail-x{background:0 0;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:4px}
    .tg-detail-x:hover{background:var(--win11-surface-active)}
    .tg-detail-bd{padding:12px 16px}
    .tg-detail-r{display:flex;gap:12px;margin-bottom:8px;font-size:.82rem}
    .tg-detail-l{color:var(--win11-text-tertiary);min-width:80px;flex-shrink:0}
    .tg-detail-v{color:var(--win11-text);word-break:break-word}
    .tg-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.72rem;font-weight:600}
    .tg-sel,.tg-inp{padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none}
    .tg-inp{width:180px}
    .tg-btn{padding:5px 12px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;cursor:pointer;display:inline-flex;align-items:center;gap:4px}
    .tg-btn:hover{background:var(--win11-surface-hover)}
    .tg-btn.on{background:var(--win11-accent-light);border-color:var(--win11-accent);color:var(--win11-accent)}
    .tg-side::-webkit-scrollbar,.tg-chart::-webkit-scrollbar{width:6px;height:6px}
    .tg-side::-webkit-scrollbar-thumb,.tg-chart::-webkit-scrollbar-thumb{background:var(--win11-border-strong);border-radius:3px}
  `;
  document.head.appendChild(style);
}

// ── Main render ──────────────────────────────────────────────────────
export async function renderTimelineView({ mountNode, api, adapter, stateStore }) {
  ensureNativeRoot(mountNode, 'timeline-gantt');
  injectStyles(mountNode);

  let destroyed = false;
  let allTasks = [];
  let tasks = [];        // filtered & sorted
  let selected = null;   // currently inspected task
  let zoomIdx = 0;
  let hScroll = 0;       // remembered horizontal scroll

  // ── HTML shell ─────────────────────────────────────────────────────
  mountNode.innerHTML = `
    <div class="tg">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;flex-wrap:wrap">
        <span style="font-size:1rem;font-weight:600;color:var(--win11-text);margin-right:auto">📅 Timeline</span>
        <input class="tg-inp" id="tQ" type="text" placeholder="Search tasks…">
        <select class="tg-sel" id="tS"><option value="all">All Statuses</option><option value="backlog">Backlog</option><option value="ready">Ready</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="completed">Completed</option><option value="archived">Archived</option></select>
        <select class="tg-sel" id="tP"><option value="all">All Priorities</option><option value="high">High</option><option value="medium">Medium</option></select>
        <select class="tg-sel" id="tPr"><option value="all">All Projects</option></select>
        <select class="tg-sel" id="tO"><option value="created_at:-1">Newest First</option><option value="created_at:1">Oldest First</option><option value="completed_at:-1">Completed ↓</option><option value="status:1">Status A→Z</option><option value="priority:-1">Priority ↓</option></select>
        <span style="display:flex;gap:2px"><button class="tg-btn on" data-z="0">Day</button><button class="tg-btn" data-z="1">Week</button><button class="tg-btn" data-z="2">Month</button></span>
        <span id="tC" style="font-size:.78rem;color:var(--win11-text-tertiary)"></span>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;position:relative">
        <div class="tg-side" id="tSide" style="width:300px;min-width:220px;flex-shrink:0;overflow-y:auto;overflow-x:hidden;border-right:1px solid var(--win11-border);background:var(--win11-surface-solid);z-index:2">
          <div style="position:sticky;top:0;z-index:3;background:var(--win11-surface-solid);border-bottom:1px solid var(--win11-border);font-size:.75rem;font-weight:600;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:.5px;padding:8px 12px;display:flex;gap:8px">
            <span style="flex:1">Task</span><span style="width:80px">Project</span>
          </div>
          <div id="tRows"></div>
        </div>
        <div class="tg-chart" id="tChart" style="flex:1;overflow:auto;position:relative">
          <div id="tInner" style="position:relative;min-height:100%">
            <div id="tHead" style="position:sticky;top:0;z-index:3;background:var(--win11-surface-solid);border-bottom:1px solid var(--win11-border);height:42px"></div>
            <div id="tOver" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none"></div>
            <div id="tBars" style="position:relative;padding-top:42px"></div>
          </div>
        </div>
      </div>
      <div class="tg-detail hide" id="tDet"></div>
    </div>
  `;

  // ── DOM handles ────────────────────────────────────────────────────
  const $ = (s) => mountNode.querySelector(s);
  const $$ = (s) => mountNode.querySelectorAll(s);
  const sideRows  = $('#tRows');
  const chart     = $('#tChart');
  const inner     = $('#tInner');
  const head      = $('#tHead');
  const over      = $('#tOver');
  const bars      = $('#tBars');
  const det       = $('#tDet');
  const cnt       = $('#tC');
  const inpQ      = $('#tQ');
  const selS      = $('#tS');
  const selP      = $('#tP');
  const selPr     = $('#tPr');
  const selO      = $('#tO');
  const zBtns     = $$('[data-z]');

  // ── Fetch ──────────────────────────────────────────────────────────
  try {
    const r = await fetch('/api/tasks/all');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    allTasks = normalizeCollection(await r.json(), ['tasks', 'data']);
  } catch (e) {
    mountNode.innerHTML = `<div class="tg-empty"><p>Failed to load tasks.</p><p style="font-size:.8rem;margin-top:8px">${escapeHtml(e.message)}</p></div>`;
    return () => {};
  }
  if (destroyed) return () => {};

  // Fill project dropdown
  [...new Set(allTasks.map(t => t.project_name).filter(Boolean))].sort().forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = trunc(p, 30);
    selPr.appendChild(o);
  });

  // ── Filter + sort pipeline ─────────────────────────────────────────
  function refresh() {
    if (destroyed) return;
    const q = inpQ.value.trim().toLowerCase();

    let list = allTasks.filter(t => !isTestTask(t));

    if (selS.value !== 'all') list = list.filter(t => t.status === selS.value);
    if (selP.value !== 'all') list = list.filter(t => t.priority === selP.value);
    if (selPr.value !== 'all') list = list.filter(t => t.project_name === selPr.value);
    if (q) list = list.filter(t => {
      const h = [(t.text || t.title || ''), (t.description || ''), (t.project_name || '')].join(' ').toLowerCase();
      return h.includes(q);
    });

    // Sort
    const [field, dir] = selO.value.split(':');
    const d = parseInt(dir, 10);
    list.sort((a, b) => {
      let va = a[field], vb = b[field];
      if (field === 'priority') { const m = { high: 3, medium: 2, low: 1 }; va = m[va] || 0; vb = m[vb] || 0; }
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      if (va < vb) return -1 * d;
      if (va > vb) return 1 * d;
      return 0;
    });

    tasks = list;
    cnt.textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
    draw();
  }

  inpQ.addEventListener('input', refresh);
  selS.addEventListener('change', refresh);
  selP.addEventListener('change', refresh);
  selPr.addEventListener('change', refresh);
  selO.addEventListener('change', refresh);
  zBtns.forEach(b => b.addEventListener('click', () => {
    zoomIdx = parseInt(b.dataset.z, 10);
    zBtns.forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    refresh();
  }));

  // ── Scroll sync (vertical only) ────────────────────────────────────
  let sync = false;
  chart.addEventListener('scroll', () => { if (!sync) { sync = true; $$('.tg-side')[0].scrollTop = chart.scrollTop; requestAnimationFrame(() => sync = false); } hScroll = chart.scrollLeft; }, { passive: true });
  $$('.tg-side')[0].addEventListener('scroll', () => { if (!sync) { sync = true; chart.scrollTop = $$('.tg-side')[0].scrollTop; requestAnimationFrame(() => sync = false); } }, { passive: true });

  // ── Draw Gantt chart ───────────────────────────────────────────────
  function draw() {
    if (destroyed) return;
    const zoom = ZOOM_LEVELS[zoomIdx];

    // Date range
    let tMin = Infinity, tMax = -Infinity;
    tasks.forEach(t => {
      const c = parseDate(t.created_at), u = parseDate(t.updated_at), d = parseDate(t.completed_at);
      if (c && c < tMin) tMin = c;
      if (u && u > tMax) tMax = u;
      if (d && d > tMax) tMax = d;
    });
    const now = new Date();
    if (now > tMax || !isFinite(tMax)) tMax = now;
    const pad = zoomIdx === 0 ? 3 : zoomIdx === 1 ? 7 : 15;
    const rangeMin = new Date(tMin - pad * 864e5);
    const rangeMax = new Date(tMax + pad * 864e5);
    const rangeDays = Math.max(1, daysBetween(rangeMin, rangeMax));
    const totalW = rangeDays * zoom.pixelsPerDay;
    const nowX = daysBetween(rangeMin, now) * zoom.pixelsPerDay;

    inner.style.width = `${Math.max(totalW, chart.clientWidth)}px`;
    bars.style.height = `${tasks.length * 38}px`;

    // ── Header ticks ─────────────────────────────────────────────────
    head.innerHTML = '';
    head.style.width = `${totalW}px`;
    const tickDays = zoom.tickDays;

    for (let d = 0; d <= rangeDays; d += tickDays) {
      const date = new Date(rangeMin.getTime() + d * 864e5);
      const x = d * zoom.pixelsPerDay;

      // Vertical line
      const line = document.createElement('div');
      line.style.cssText = `position:absolute;top:0;bottom:0;width:1px;background:var(--win11-border);left:${x}px;transform:translateX(-50%)`;
      head.appendChild(line);

      // Label
      const lbl = document.createElement('div');
      lbl.style.cssText = `position:absolute;bottom:6px;left:${x}px;transform:translateX(-50%);font-size:.7rem;color:var(--win11-text-tertiary);white-space:nowrap`;
      const isMajor = zoomIdx === 2 ? date.getMonth() === 0 : zoomIdx === 1 ? date.getDate() <= 7 : date.getDay() === 1;
      if (isMajor) lbl.style.cssText += ';font-weight:600;color:var(--win11-text-secondary)';
      lbl.textContent = zoomIdx === 2
        ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      head.appendChild(lbl);
    }

    // ── Overlays: today + gridlines ─────────────────────────────────
    over.innerHTML = '';
    if (nowX > 0 && nowX < totalW) {
      over.innerHTML += `<div class="tg-today" style="left:${nowX}px"><div class="tg-today-label">Today</div></div>`;
    }
    for (let d = 0; d <= rangeDays; d += tickDays) {
      over.innerHTML += `<div class="tg-gridline" style="left:${d * zoom.pixelsPerDay}px"></div>`;
    }

    // ── Sidebar rows + bars ──────────────────────────────────────────
    sideRows.innerHTML = '';
    bars.innerHTML = '';

    if (tasks.length === 0) {
      sideRows.innerHTML = '<div class="tg-empty" style="padding:40px 16px">No tasks match filters.</div>';
      return;
    }

    tasks.forEach(task => {
      const sm = statusOf(task.status);
      const name = task.text || task.title || 'Untitled';
      const proj = task.project_name || '';
      const created = parseDate(task.created_at);
      const completed = parseDate(task.completed_at);
      const isActive = ['backlog', 'ready', 'in_progress'].includes(task.status);

      // Sidebar row
      const row = document.createElement('div');
      row.className = 'tg-row-side' + (selected?.id === task.id ? ' sel' : '');
      row.innerHTML = `<span class="tg-dot" style="background:${sm.bar}"></span><span class="tg-pri">${PRIORITY_SYMBOLS[task.priority] || ''}</span><span class="tg-name" title="${escapeHtml(name)}">${escapeHtml(trunc(name))}</span><span class="tg-proj" title="${escapeHtml(proj)}">${escapeHtml(trunc(proj, 12))}</span>`;
      row.addEventListener('click', () => inspect(task));
      sideRows.appendChild(row);

      // Bar row
      const barRow = document.createElement('div');
      barRow.className = 'tg-row';

      if (!created) { bars.appendChild(barRow); return; }

      const startX = daysBetween(rangeMin, created) * zoom.pixelsPerDay;

      if (isActive && !completed) {
        // Active: bar from created → now with pulsing live indicator
        const endX = Math.max(startX + 8, nowX);
        const w = endX - startX;
        const bar = document.createElement('div');
        bar.className = 'tg-bar tg-bar--live';
        bar.style.cssText = `left:${startX}px;top:9px;width:${w}px;background:${sm.bar};opacity:.85`;
        bar.title = name;
        bar.textContent = zoomIdx <= 1 && w > 60 ? trunc(name, Math.floor(w / 7)) : '';
        bar.addEventListener('click', () => inspect(task));
        barRow.appendChild(bar);

        // White "now" dot at bar end
        const dot = document.createElement('div');
        dot.className = 'tg-now-dot';
        dot.style.left = `${endX}px`;
        barRow.appendChild(dot);
      } else if (completed) {
        // Completed: solid bar from created → completed
        const endX = daysBetween(rangeMin, completed) * zoom.pixelsPerDay;
        const w = Math.max(4, endX - startX);
        const bar = document.createElement('div');
        bar.className = 'tg-bar';
        bar.style.cssText = `left:${startX}px;top:9px;width:${w}px;background:${sm.bar};opacity:.8`;
        bar.title = `${name}\n${created.toLocaleDateString()} → ${completed.toLocaleDateString()}`;
        bar.textContent = zoomIdx <= 1 && w > 60 ? trunc(name, Math.floor(w / 7)) : '';
        bar.addEventListener('click', () => inspect(task));
        barRow.appendChild(bar);
      } else {
        // Archived / no end date: dot marker at creation date
        const bar = document.createElement('div');
        bar.className = 'tg-bar tg-bar--dot';
        bar.style.cssText = `left:${startX}px;top:13px;background:${sm.bar};opacity:.6`;
        bar.title = name;
        bar.addEventListener('click', () => inspect(task));
        barRow.appendChild(bar);
      }

      bars.appendChild(barRow);
    });

    // Restore horizontal scroll
    chart.scrollLeft = hScroll;
  }

  // ── Inspect task ───────────────────────────────────────────────────
  function inspect(task) {
    selected = task;
    const sm = statusOf(task.status);
    const created = parseDate(task.created_at);
    const completed = parseDate(task.completed_at);
    const updated = parseDate(task.updated_at);
    const name = task.text || task.title || 'Untitled';

    det.classList.remove('hide');
    det.innerHTML = `
      <div class="tg-detail-hd">
        <span class="tg-detail-title">${escapeHtml(name)}</span>
        <button class="tg-detail-x" id="tDetX">✕</button>
      </div>
      <div class="tg-detail-bd">
        <div class="tg-detail-r"><span class="tg-detail-l">Status</span><span><span class="tg-badge" style="background:${sm.bg};color:${sm.bar}">${sm.label}</span></span></div>
        <div class="tg-detail-r"><span class="tg-detail-l">Priority</span><span class="tg-detail-v">${(task.priority || 'none')[0].toUpperCase()}${(task.priority || 'none').slice(1)}</span></div>
        <div class="tg-detail-r"><span class="tg-detail-l">Project</span><span class="tg-detail-v">${escapeHtml(task.project_name || '—')}</span></div>
        ${created ? `<div class="tg-detail-r"><span class="tg-detail-l">Created</span><span class="tg-detail-v">${created.toLocaleString()}</span></div>` : ''}
        ${completed ? `<div class="tg-detail-r"><span class="tg-detail-l">Completed</span><span class="tg-detail-v">${completed.toLocaleString()}</span></div>` : ''}
        ${updated ? `<div class="tg-detail-r"><span class="tg-detail-l">Updated</span><span class="tg-detail-v">${updated.toLocaleString()}</span></div>` : ''}
        ${task.description ? `<div class="tg-detail-r" style="flex-direction:column"><span class="tg-detail-l">Description</span><span class="tg-detail-v" style="margin-top:4px">${escapeHtml(task.description)}</span></div>` : ''}
        ${task.owner ? `<div class="tg-detail-r"><span class="tg-detail-l">Owner</span><span class="tg-detail-v">${escapeHtml(task.owner)}</span></div>` : ''}
        ${task.labels?.length ? `<div class="tg-detail-r"><span class="tg-detail-l">Labels</span><span class="tg-detail-v">${task.labels.map(l => `<span class="tg-badge" style="background:var(--win11-accent-light);color:var(--win11-accent)">${escapeHtml(l)}</span>`).join(' ')}</span></div>` : ''}
      </div>
    `;

    det.querySelector('#tDetX').addEventListener('click', closeDetail);

    // Highlight sidebar
    sideRows.querySelectorAll('.tg-row-side').forEach((r, i) => {
      r.classList.toggle('sel', tasks[i]?.id === task.id);
    });
  }

  function closeDetail() {
    det.classList.add('hide');
    selected = null;
    sideRows.querySelectorAll('.tg-row-side').forEach(r => r.classList.remove('sel'));
  }

  // ── Keyboard ───────────────────────────────────────────────────────
  const onKey = (e) => { if (e.key === 'Escape' && selected) closeDetail(); };
  mountNode.addEventListener('keydown', onKey);

  // ── Initial render ─────────────────────────────────────────────────
  refresh();

  // ── Cleanup ───────────────────────────────────────────────────────
  return () => {
    destroyed = true;
    mountNode.removeEventListener('keydown', onKey);
    mountNode.innerHTML = '';
  };
}

export default renderTimelineView;
