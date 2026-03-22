import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderAuditView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let logs = [];
  let totalLogs = 0;
  let cleanupFns = [];
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .auv-table { width:100%;border-collapse:collapse;font-size:0.8rem; }
    .auv-table th { text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--win11-text-tertiary);border-bottom:1px solid var(--win11-border);background:var(--win11-surface);position:sticky;top:0;z-index:1; }
    .auv-table td { padding:7px 10px;border-bottom:1px solid var(--win11-border);vertical-align:top; }
    .auv-table tr:hover td { background:rgba(96,205,255,0.04); }
    .auv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .auv-btn:hover { background:var(--win11-surface-active); }
    .auv-select { padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;outline:none; }
    .auv-select:focus { border-color:var(--win11-accent); }
    .auv-action { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600;text-transform:uppercase; }
    .auv-action--create { background:rgba(34,197,94,0.15);color:#22c55e; }
    .auv-action--update { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .auv-action--delete { background:rgba(239,68,68,0.15);color:#ef4444; }
    .auv-action--move { background:rgba(168,85,247,0.15);color:#a855f7; }
    .auv-action--status { background:rgba(234,179,8,0.15);color:#eab308; }
    .auv-detail { max-height:0;overflow:hidden;transition:max-height 0.2s;font-size:0.75rem;color:var(--win11-text-secondary); }
    .auv-detail.open { max-height:300px;overflow-y:auto;padding:8px 10px;background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:6px;margin-top:4px; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">📜 Audit Log</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Track all changes to tasks, workflows, and system state.</p>
        </div>
        <button id="auvRefresh" class="auv-btn">↻ Refresh</button>
      </div>
      <div id="auvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <select id="auvFilterAction" class="auv-select" style="width:auto;min-width:120px;">
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="move">Move</option>
          <option value="status">Status Change</option>
        </select>
        <select id="auvFilterActor" class="auv-select" style="width:auto;min-width:120px;"><option value="">All actors</option></select>
        <input id="auvSearch" type="text" placeholder="Search..." class="auv-select" style="width:auto;min-width:140px;">
      </div>
    </div>
    <div id="auvGrid" style="flex:1;overflow:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading audit log...</div>
    </div>
  `;
  mountNode.appendChild(root);

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }); } catch { return d; } }

  function actionClass(a) {
    if (a === 'create') return 'auv-action--create';
    if (a === 'delete') return 'auv-action--delete';
    if (a === 'move' || a === 'status') return 'auv-action--' + a;
    return 'auv-action--update';
  }

  function getFiltered() {
    const action = root.querySelector('#auvFilterAction')?.value || '';
    const actor = root.querySelector('#auvFilterActor')?.value || '';
    const q = (root.querySelector('#auvSearch')?.value || '').trim().toLowerCase();
    return logs.filter(l => {
      if (action && l.action !== action) return false;
      if (actor && l.actor !== actor) return false;
      if (q) {
        const searchable = `${l.action} ${l.actor} ${l.task_id || ''} ${l.details || ''} ${l.old_value ? JSON.stringify(l.old_value) : ''} ${l.new_value ? JSON.stringify(l.new_value) : ''}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }

  function renderStats() {
    const items = getFiltered();
    const actions = {};
    items.forEach(l => { actions[l.action] = (actions[l.action] || 0) + 1; });
    root.querySelector('#auvStats').innerHTML = [
      createStatCard({ label:'Entries', value:formatCount(items.length), sub:`of ${formatCount(totalLogs)} total` }),
      createStatCard({ label:'Create', value:formatCount(actions.create || 0), tone:'success' }),
      createStatCard({ label:'Update', value:formatCount(actions.update || 0), tone:'info' }),
      createStatCard({ label:'Delete', value:formatCount(actions.delete || 0), tone:'danger' }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#auvGrid');
    const items = getFiltered();
    renderStats();

    if (!items.length) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No log entries match filters.</div>';
      return;
    }

    grid.innerHTML = `<table class="auv-table">
      <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Task</th><th>Details</th><th></th></tr></thead>
      <tbody>
        ${items.map((l, i) => `<tr>
          <td style="white-space:nowrap;color:var(--win11-text-secondary);font-size:0.75rem;">${fmtDate(l.created_at || l.timestamp)}</td>
          <td><span class="auv-action ${actionClass(l.action)}">${escapeHtml(l.action || 'unknown')}</span></td>
          <td style="font-size:0.8rem;">${escapeHtml(l.actor || '—')}</td>
          <td style="font-size:0.75rem;color:var(--win11-text-secondary);font-family:monospace;">${escapeHtml((l.task_id || '—').substring(0,8))}</td>
          <td style="font-size:0.78rem;color:var(--win11-text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(l.details || '')}</td>
          <td><button class="auv-btn auv-toggle" data-idx="${i}" style="font-size:0.7rem;padding:2px 6px;">⋮</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;

    grid.querySelectorAll('.auv-toggle').forEach(btn => {
      const h = () => {
        const idx = parseInt(btn.dataset.idx);
        const l = items[idx];
        if (!l) return;
        const row = btn.closest('tr');
        let nextRow = row.nextElementSibling;
        if (nextRow?.classList.contains('auv-detail-row')) {
          nextRow.remove();
          return;
        }
        const detailRow = document.createElement('tr');
        detailRow.className = 'auv-detail-row';
        detailRow.innerHTML = `<td colspan="6" style="padding:4px 10px;"><div class="auv-detail open"><pre style="margin:0;font-size:0.72rem;white-space:pre-wrap;word-break:break-all;">${escapeHtml(JSON.stringify({ new_value: l.new_value, old_value: l.old_value }, null, 2))}</pre></div></td>`;
        row.after(detailRow);
      };
      btn.addEventListener('click', h);
      cleanupFns.push(() => btn.removeEventListener('click', h));
    });
  }

  async function loadLogs() {
    try {
      const res = await api.audit.list({ limit: 100 });
      logs = Array.isArray(res?.logs) ? res.logs : [];
      totalLogs = res?.total || logs.length;
      root.querySelector('#auvFilterActor').innerHTML = '<option value="">All actors</option>' +
        [...new Set(logs.map(l => l.actor).filter(Boolean))].sort().map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
      renderGrid();
    } catch (e) {
      root.querySelector('#auvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  let searchTimer = null;
  root.querySelector('#auvFilterAction')?.addEventListener('change', renderGrid);
  root.querySelector('#auvFilterActor')?.addEventListener('change', renderGrid);
  root.querySelector('#auvSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 200);
  });
  root.querySelector('#auvRefresh')?.addEventListener('click', loadLogs);

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadLogs());
  }

  await loadLogs();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderAuditView;
