import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderArtifactsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let artifacts = [];
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .arv-table { width:100%;border-collapse:collapse;font-size:0.82rem; }
    .arv-table th { text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--win11-text-tertiary);border-bottom:1px solid var(--win11-border);background:var(--win11-surface);position:sticky;top:0; }
    .arv-table td { padding:8px 10px;border-bottom:1px solid var(--win11-border);vertical-align:top; }
    .arv-table tr:hover td { background:rgba(96,205,255,0.04); }
    .arv-btn { font-size:0.75rem;padding:3px 8px;border-radius:4px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .arv-btn:hover { background:var(--win11-surface-active); }
    .arv-select { padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;outline:none; }
    .arv-select:focus { border-color:var(--win11-accent); }
    .arv-status { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .arv-status--generated { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .arv-status--approved { background:rgba(34,197,94,0.15);color:#22c55e; }
    .arv-status--attached { background:rgba(234,179,8,0.15);color:#eab308; }
    .arv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .arv-notice.is-visible { display:block; }
    .arv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .arv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">📦 Artifacts</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Outputs produced by workflow runs.</p>
        </div>
        <button id="arvRefresh" class="arv-btn" style="padding:5px 12px;">↻ Refresh</button>
      </div>
      <div id="arvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <select id="arvFilterWorkflow" class="arv-select" style="width:auto;min-width:130px;"><option value="">All workflows</option></select>
        <select id="arvFilterType" class="arv-select" style="width:auto;min-width:130px;"><option value="">All types</option></select>
        <select id="arvFilterStatus" class="arv-select" style="width:auto;min-width:130px;"><option value="">All statuses</option></select>
        <select id="arvFilterAgent" class="arv-select" style="width:auto;min-width:130px;"><option value="">All agents</option></select>
      </div>
    </div>
    <div id="arvGrid" style="flex:1;overflow:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading artifacts...</div>
    </div>
    <div id="arvNotice" class="arv-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#arvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `arv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'arv-notice'; }, 4000);
  }

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric' }); } catch { return d; } }

  function renderOptions(select, values, allLabel) {
    const items = [{ value:'', label:allLabel }].concat(
      [...new Set(values.filter(Boolean))].sort().map(v => ({ value:v, label:v }))
    );
    select.innerHTML = items.map(i => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</option>`).join('');
  }

  function statusClass(s) {
    if (s === 'generated') return 'arv-status--generated';
    if (s === 'approved') return 'arv-status--approved';
    if (s === 'attached') return 'arv-status--attached';
    return '';
  }

  function getFiltered() {
    return artifacts.filter(a => {
      if (root.querySelector('#arvFilterWorkflow')?.value && a.workflowType !== root.querySelector('#arvFilterWorkflow').value) return false;
      if (root.querySelector('#arvFilterType')?.value && a.artifactType !== root.querySelector('#arvFilterType').value) return false;
      if (root.querySelector('#arvFilterStatus')?.value && a.status !== root.querySelector('#arvFilterStatus').value) return false;
      if (root.querySelector('#arvFilterAgent')?.value && (a.createdBy || a.ownerAgentId) !== root.querySelector('#arvFilterAgent').value) return false;
      return true;
    });
  }

  function renderStats() {
    const items = getFiltered();
    root.querySelector('#arvStats').innerHTML = [
      createStatCard({ label:'Artifacts', value:formatCount(items.length) }),
      createStatCard({ label:'Generated', value:formatCount(items.filter(a => a.status === 'generated').length) }),
      createStatCard({ label:'Approved', value:formatCount(items.filter(a => a.status === 'approved').length) }),
      createStatCard({ label:'Attached', value:formatCount(items.filter(a => a.status === 'attached').length) }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#arvGrid');
    const items = getFiltered();
    renderStats();

    if (!items.length) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No artifacts match filters.</div>';
      return;
    }

    grid.innerHTML = `<table class="arv-table">
      <thead><tr>
        <th>Artifact</th><th>Workflow</th><th>Agent</th><th>Status</th><th>Created</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${items.map(a => `<tr>
          <td>
            <div style="font-weight:600;color:var(--win11-text);">${escapeHtml(a.label || 'Untitled')}</div>
            <div style="font-size:0.75rem;color:var(--win11-text-secondary);">${escapeHtml(a.artifactType || 'output')}</div>
            ${a.uri ? `<div style="font-size:0.72rem;margin-top:2px;"><a href="${escapeHtml(a.uri)}" target="_blank" style="color:var(--win11-accent);word-break:break-all;">${escapeHtml(a.uri.length > 60 ? a.uri.substring(0,60)+'...' : a.uri)}</a></div>` : ''}
          </td>
          <td style="color:var(--win11-text-secondary);">${escapeHtml(a.workflowType || '—')}</td>
          <td style="color:var(--win11-text-secondary);">${escapeHtml(a.createdBy || a.ownerAgentId || '—')}</td>
          <td><span class="arv-status ${statusClass(a.status)}">${escapeHtml((a.status || '').replace(/_/g,' '))}</span></td>
          <td style="color:var(--win11-text-secondary);white-space:nowrap;">${fmtDate(a.createdAt)}</td>
          <td>${a.workflowRunId ? `<button class="arv-btn arv-open-run" data-run="${escapeHtml(a.workflowRunId)}">Run ↗</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  async function loadArtifacts() {
    try {
      const res = await api.artifacts.list({ limit: 250 });
      artifacts = Array.isArray(res?.artifacts) ? res.artifacts : [];
      renderOptions(root.querySelector('#arvFilterWorkflow'), artifacts.map(a => a.workflowType), 'All workflows');
      renderOptions(root.querySelector('#arvFilterType'), artifacts.map(a => a.artifactType), 'All types');
      renderOptions(root.querySelector('#arvFilterStatus'), artifacts.map(a => a.status), 'All statuses');
      renderOptions(root.querySelector('#arvFilterAgent'), artifacts.map(a => a.createdBy || a.ownerAgentId), 'All agents');
      renderGrid();
    } catch (e) {
      root.querySelector('#arvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelector('#arvFilterWorkflow')?.addEventListener('change', renderGrid);
  root.querySelector('#arvFilterType')?.addEventListener('change', renderGrid);
  root.querySelector('#arvFilterStatus')?.addEventListener('change', renderGrid);
  root.querySelector('#arvFilterAgent')?.addEventListener('change', renderGrid);
  root.querySelector('#arvRefresh')?.addEventListener('click', () => loadArtifacts().then(() => showNotice('Refreshed.', 'success')));

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadArtifacts());
  }

  await loadArtifacts();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderArtifactsView;
