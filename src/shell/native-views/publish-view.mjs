import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderPublishView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let tasks = [];
  let cleanupFns = [];
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .puv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px;transition:border-color 0.15s; }
    .puv-card:hover { border-color:var(--win11-accent); }
    .puv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .puv-btn:hover { background:var(--win11-surface-active); }
    .puv-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .puv-badge--active { background:rgba(34,197,94,0.15);color:#22c55e;animation:pulse 2s infinite; }
    .puv-badge--pending { background:rgba(234,179,8,0.15);color:#eab308; }
    .puv-badge--done { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
    .puv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .puv-notice.is-visible { display:block; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">📢 Publish Center</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Tasks with active workflow runs ready for publishing.</p>
        </div>
        <button id="puvRefresh" class="puv-btn">↻ Refresh</button>
      </div>
      <div id="puvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
    </div>
    <div id="puvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading publish candidates...</div>
    </div>
    <div id="puvNotice" class="puv-notice"></div>
  `;
  mountNode.appendChild(root);

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

  function renderStats() {
    root.querySelector('#puvStats').innerHTML = [
      createStatCard({ label:'Publish Candidates', value:formatCount(tasks.length), tone: tasks.length > 0 ? 'info' : 'default' }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#puvGrid');
    renderStats();

    if (!tasks.length) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No tasks with active workflow runs.</div>';
      return;
    }

    grid.innerHTML = `<div style="display:grid;gap:8px;">
      ${tasks.map(t => `<div class="puv-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:0.88rem;color:var(--win11-text);">${escapeHtml(t.title || t.text || 'Untitled')}</div>
            ${t.description ? `<div style="font-size:0.8rem;color:var(--win11-text-secondary);margin-top:3px;line-height:1.3;">${escapeHtml(t.description.length > 150 ? t.description.substring(0,150)+'...' : t.description)}</div>` : ''}
          </div>
          <span class="puv-badge puv-badge--active">Active</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;font-size:0.75rem;color:var(--win11-text-secondary);">
          <span>Status: <strong style="color:var(--win11-text);">${escapeHtml((t.status || '').replace(/_/g,' '))}</strong></span>
          <span>Priority: ${escapeHtml(t.priority || '—')}</span>
          <span>Owner: ${escapeHtml(t.owner || '—')}</span>
          <span>Created: ${fmtDate(t.created_at)}</span>
        </div>
        ${t.active_workflow_run_id ? `<div style="font-size:0.72rem;color:var(--win11-text-tertiary);margin-top:4px;">Run: <span style="font-family:monospace;">${escapeHtml(t.active_workflow_run_id.substring(0,12))}</span></div>` : ''}
      </div>`).join('')}
    </div>`;
  }

  async function loadPublishCandidates() {
    try {
      const allTasks = await api.tasks.list({});
      const taskArr = Array.isArray(allTasks) ? allTasks : (allTasks?.tasks || []);
      tasks = taskArr.filter(t => t?.active_workflow_run_id);
      renderGrid();
    } catch (e) {
      root.querySelector('#puvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelector('#puvRefresh')?.addEventListener('click', loadPublishCandidates);

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadPublishCandidates());
  }

  await loadPublishCandidates();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderPublishView;
