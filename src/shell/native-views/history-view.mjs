/**
 * History / Time-Travel View
 *
 * Displays audit log entries and state snapshots with tabbed UI.
 */

const CSS = `
  .hist-container { padding: 0; display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 0.85rem; }
  .hist-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .hist-title { font-size: 1.1rem; font-weight: 600; }
  .hist-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .hist-tab { padding: 8px 16px; cursor: pointer; font-size: 0.82rem; color: var(--win11-text-secondary); border-bottom: 2px solid transparent; transition: all .15s; }
  .hist-tab.active { color: var(--win11-accent); border-bottom-color: var(--win11-accent); }
  .hist-tab:hover { background: var(--win11-surface-hover); }
  .hist-filter { display: flex; gap: 8px; align-items: center; padding: 8px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .hist-filter input, .hist-filter select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--win11-border); background: var(--win11-surface-solid); color: var(--win11-text-primary); font-size: 0.82rem; }
  .hist-list { flex: 1; overflow-y: auto; padding: 8px 16px; display: flex; flex-direction: column; gap: 4px; }
  .hist-entry { display: flex; gap: 12px; padding: 10px 14px; border-radius: 8px; background: var(--win11-surface-solid); border: 1px solid var(--win11-border); cursor: pointer; transition: background .15s; }
  .hist-entry:hover { background: var(--win11-surface-hover); }
  .hist-entry.expanded { border-color: var(--win11-accent); }
  .hist-time { font-size: 0.75rem; color: var(--win11-text-secondary); white-space: nowrap; min-width: 130px; }
  .hist-actor { font-size: 0.78rem; color: var(--win11-accent); font-weight: 500; min-width: 80px; }
  .hist-action { font-size: 0.78rem; }
  .hist-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 500; }
  .hist-badge-create { background: #22c55e20; color: #22c55e; }
  .hist-badge-move { background: #3b82f620; color: #3b82f6; }
  .hist-badge-update { background: #f59e0b20; color: #f59e0b; }
  .hist-badge-delete { background: #ef444420; color: #ef4444; }
  .hist-badge-revert { background: #f59e0b20; color: #f59e0b; }
  .hist-badge-claim { background: #8b5cf620; color: #8b5cf6; }
  .hist-detail { padding: 12px 16px; background: var(--win11-bg); border-radius: 8px; margin-top: 8px; font-size: 0.82rem; }
  .hist-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .hist-diff-label { font-size: 0.72rem; color: var(--win11-text-secondary); margin-bottom: 4px; font-weight: 500; }
  .hist-diff-val { padding: 8px; border-radius: 6px; background: var(--win11-surface-solid); font-family: 'SF Mono','Consolas',monospace; font-size: 0.78rem; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
  .hist-empty { text-align: center; padding: 40px; color: var(--win11-text-tertiary); }
  .hist-loading { text-align: center; padding: 40px; color: var(--win11-text-tertiary); }
  .hist-snap-row { display: flex; gap: 12px; padding: 10px 14px; border-radius: 8px; background: var(--win11-surface-solid); border: 1px solid var(--win11-border); align-items: center; }
  .hist-snap-row:hover { background: var(--win11-surface-hover); }
  .hist-revert-btn { padding: 4px 12px; border-radius: 4px; border: 1px solid #f59e0b; background: #f59e0b20; color: #f59e0b; cursor: pointer; font-size: 0.75rem; }
  .hist-revert-btn:hover { background: #f59e0b40; }
`;

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(action) {
  const cls = `hist-badge-${action || 'update'}`;
  return `<span class="hist-badge ${cls}">${esc(action)}</span>`;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return String(ts); }
}

export async function renderHistoryView({ mountNode, api, params = {}, navigateToView}) {
  mountNode.innerHTML = `<style>${CSS}</style><div class="hist-container"><div class="hist-loading">Loading history...</div></div>`;
  const container = mountNode.querySelector('.hist-container');

  let entries = [];
  let snapshots = [];
  let expanded = null;
  let activeTab = 'audit';

  async function loadData(queryParams = {}) {
    container.innerHTML = '<div class="hist-loading">Loading...</div>';
    try {
      const data = await api.history.list(queryParams);
      entries = data.entries || [];
      render();
    } catch (err) {
      container.innerHTML = `<div class="hist-empty">Error: ${esc(err.message)}</div>`;
    }
  }

  // Deep-link: auto-load from params (P2/P9 + Fix 7)
  const initialQuery = {};
  if (params.taskId) initialQuery.task_id = params.taskId;
  if (params.actor) initialQuery.actor = params.actor;
  if (params.action) initialQuery.action = params.action;
  loadData(initialQuery);

  async function loadSnapshots() {
    container.innerHTML = '<div class="hist-loading">Loading snapshots...</div>';
    try {
      const data = await api.snapshots.listAll({ limit: 50 });
      snapshots = data.snapshots || [];
      render();
    } catch (err) {
      container.innerHTML = `<div class="hist-empty">Error loading snapshots: ${esc(err.message)}</div>`;
    }
  }

  function render() {
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'hist-header';
    header.innerHTML = `<div class="hist-title">📜 Change History</div>`;
    container.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'hist-tabs';
    tabs.innerHTML = `
      <div class="hist-tab ${activeTab === 'audit' ? 'active' : ''}" data-tab="audit">Audit Log</div>
      <div class="hist-tab ${activeTab === 'snapshots' ? 'active' : ''}" data-tab="snapshots">State Snapshots</div>
    `;
    tabs.querySelectorAll('.hist-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        if (activeTab === 'snapshots' && snapshots.length === 0) {
          loadSnapshots();
        } else {
          render();
        }
      });
    });
    container.appendChild(tabs);

    if (activeTab === 'audit') {
      renderAuditTab();
    } else {
      renderSnapshotsTab();
    }
  }

  function renderAuditTab() {
    // Filter bar
    const filter = document.createElement('div');
    filter.className = 'hist-filter';
    filter.innerHTML = `
      <input id="hist-actor-filter" placeholder="Filter by actor..." style="width:140px">
      <select id="hist-action-filter">
        <option value="">All actions</option>
        <option value="create">Create</option>
        <option value="move">Move</option>
        <option value="update">Update</option>
        <option value="delete">Delete</option>
        <option value="revert">Revert</option>
        <option value="import">Import</option>
      </select>
      <button id="hist-refresh" style="padding:6px 12px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);cursor:pointer;font-size:0.82rem;">🔄 Refresh</button>
    `;
    container.appendChild(filter);

    // Entry list
    const list = document.createElement('div');
    list.className = 'hist-list';

    if (entries.length === 0) {
      list.innerHTML = '<div class="hist-empty">No history entries found</div>';
    } else {
      entries.forEach((entry, idx) => {
        const el = document.createElement('div');
        el.className = `hist-entry${expanded === idx ? ' expanded' : ''}`;
        el.innerHTML = `
          <div class="hist-time">${fmtTime(entry.timestamp)}</div>
          <div class="hist-actor">${esc(entry.actor)}</div>
          <div class="hist-action">${badge(entry.action)} <span style="color:var(--win11-text-secondary);margin-left:6px">${esc(entry.task_title || (entry.task_id || '').substring(0, 8) || '')}</span></div>
        `;

        if (expanded === idx) {
          const detail = document.createElement('div');
          detail.className = 'hist-detail';
          const oldVal = entry.old_value || entry.oldValue;
          const newVal = entry.new_value || entry.newValue;

          if (oldVal || newVal) {
            detail.innerHTML = `
              <div class="hist-diff">
                <div><div class="hist-diff-label">Before</div><div class="hist-diff-val">${esc(JSON.stringify(oldVal || {}, null, 2))}</div></div>
                <div><div class="hist-diff-label">After</div><div class="hist-diff-val">${esc(JSON.stringify(newVal || {}, null, 2))}</div></div>
              </div>`;
          } else {
            detail.innerHTML = '<div style="color:var(--win11-text-secondary)">No state change recorded</div>';
          }
          el.appendChild(detail);
        }

        el.addEventListener('click', () => {
          expanded = expanded === idx ? null : idx;
          render();
        });
        list.appendChild(el);
      });
    }

    container.appendChild(list);

    // Wire filter events
    filter.querySelector('#hist-refresh').addEventListener('click', () => {
      const actor = filter.querySelector('#hist-actor-filter').value.trim();
      const action = filter.querySelector('#hist-action-filter').value;
      const params = {};
      if (actor) params.actor = actor;
      if (action) params.action = action;
      loadData(params);
    });
    filter.querySelector('#hist-actor-filter').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') filter.querySelector('#hist-refresh').click();
    });
  }

  function renderSnapshotsTab() {
    const list = document.createElement('div');
    list.className = 'hist-list';

    if (snapshots.length === 0) {
      list.innerHTML = '<div class="hist-empty">No state snapshots recorded yet. Create or modify tasks to generate snapshots.</div>';
    } else {
      snapshots.forEach(snap => {
        const row = document.createElement('div');
        row.className = 'hist-snap-row';
        row.innerHTML = `
          <div class="hist-time">${fmtTime(snap.created_at)}</div>
          <div class="hist-actor">${esc(snap.actor)}</div>
          <div class="hist-action">${badge(snap.action)}</div>
          <div style="margin-left:auto;display:flex;gap:6px;">
            <button class="hist-revert-btn" data-snap-id="${snap.id}" title="Preview revert">👁 Preview</button>
          </div>
        `;
        list.appendChild(row);
      });
    }

    container.appendChild(list);
  }

  // Initial load already called above with params
}

export default renderHistoryView;
