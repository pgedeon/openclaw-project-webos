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
  let openMenuId = null; // Track which row's menu is open

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
    .arv-status--rejected { background:rgba(239,68,68,0.15);color:#ef4444; }
    .arv-status--archived { background:rgba(156,163,175,0.15);color:#9ca3af; }
    .arv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .arv-notice.is-visible { display:block; }
    .arv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .arv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }

    /* Action menu */
    .arv-menu-wrap { position:relative;display:inline-block; }
    .arv-menu-btn {
      font-size:1rem;padding:2px 6px;border-radius:4px;border:1px solid var(--win11-border);
      background:var(--win11-surface-solid);color:var(--win11-text-secondary);cursor:pointer;
      line-height:1;
    }
    .arv-menu-btn:hover { background:var(--win11-surface-active);color:var(--win11-text); }
    .arv-dropdown {
      position:absolute;right:0;top:100%;margin-top:2px;z-index:1000;min-width:140px;
      background:var(--win11-surface-solid);border:1px solid var(--win11-border);
      border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.25);overflow:hidden;
      display:none;
    }
    .arv-dropdown.is-open { display:block; }
    .arv-dropdown-item {
      display:flex;align-items:center;gap:8px;width:100%;padding:7px 12px;
      border:none;background:none;color:var(--win11-text);font-size:0.78rem;cursor:pointer;
      text-align:left;
    }
    .arv-dropdown-item:hover { background:var(--win11-surface-active); }
    .arv-dropdown-item.is-danger { color:#ef4444; }
    .arv-dropdown-item.is-danger:hover { background:rgba(239,68,68,0.08); }
    .arv-dropdown-sep { height:1px;background:var(--win11-border);margin:2px 0; }

    /* Edit modal */
    .arv-modal-overlay {
      position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;
      display:flex;align-items:center;justify-content:center;
    }
    .arv-modal {
      background:var(--win11-surface-solid);border:1px solid var(--win11-border);
      border-radius:8px;padding:20px;width:380px;max-width:90vw;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
    }
    .arv-modal h3 { margin:0 0 14px;color:var(--win11-text);font-size:1rem; }
    .arv-modal label {
      display:block;font-size:0.75rem;color:var(--win11-text-secondary);margin-bottom:3px;
    }
    .arv-modal input, .arv-modal select {
      width:100%;padding:6px 8px;border-radius:4px;border:1px solid var(--win11-border);
      background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;
      margin-bottom:10px;outline:none;box-sizing:border-box;
    }
    .arv-modal input:focus, .arv-modal select:focus { border-color:var(--win11-accent); }
    .arv-modal-actions { display:flex;gap:8px;justify-content:flex-end;margin-top:14px; }
    .arv-modal-actions .arv-btn { padding:5px 14px; }
    .arv-btn--primary {
      background:var(--win11-accent);color:#fff;border-color:var(--win11-accent);
    }
    .arv-btn--primary:hover { opacity:0.9; }
    .arv-btn--danger { color:#ef4444;border-color:rgba(239,68,68,0.3); }
    .arv-btn--danger:hover { background:rgba(239,68,68,0.08); }
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
    if (s === 'rejected') return 'arv-status--rejected';
    if (s === 'archived') return 'arv-status--archived';
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

  function closeAllMenus() {
    openMenuId = null;
    root.querySelectorAll('.arv-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
  }

  function toggleMenu(artifactId) {
    if (openMenuId === artifactId) {
      closeAllMenus();
      return;
    }
    closeAllMenus();
    openMenuId = artifactId;
    const dropdown = root.querySelector(`.arv-dropdown[data-id="${artifactId}"]`);
    if (dropdown) dropdown.classList.add('is-open');
  }

  function showEditModal(artifact) {
    closeAllMenus();
    const overlay = document.createElement('div');
    overlay.className = 'arv-modal-overlay';
    const validStatuses = ['generated', 'approved', 'attached', 'rejected', 'archived'];
    overlay.innerHTML = `
      <div class="arv-modal">
        <h3>Edit Artifact</h3>
        <label>Label</label>
        <input id="arvEditLabel" value="${escapeHtml(artifact.label || '')}" />
        <label>Type</label>
        <input id="arvEditType" value="${escapeHtml(artifact.artifactType || '')}" />
        <label>URI</label>
        <input id="arvEditUri" value="${escapeHtml(artifact.uri || '')}" />
        <label>Status</label>
        <select id="arvEditStatus">
          ${validStatuses.map(s => `<option value="${s}"${s === artifact.status ? ' selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
        <div class="arv-modal-actions">
          <button class="arv-btn" id="arvEditCancel">Cancel</button>
          <button class="arv-btn arv-btn--primary" id="arvEditSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#arvEditCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#arvEditSave').onclick = async () => {
      const label = overlay.querySelector('#arvEditLabel').value.trim();
      const artifactType = overlay.querySelector('#arvEditType').value.trim();
      const uri = overlay.querySelector('#arvEditUri').value.trim();
      const status = overlay.querySelector('#arvEditStatus').value;
      if (!label) { showNotice('Label is required.', 'error'); return; }
      try {
        overlay.querySelector('#arvEditSave').disabled = true;
        overlay.querySelector('#arvEditSave').textContent = 'Saving…';
        await api.artifacts.update(artifact.id, { label, artifact_type: artifactType, uri, status });
        overlay.remove();
        showNotice('Artifact updated.', 'success');
        await loadArtifacts();
      } catch (err) {
        showNotice(`Failed: ${err.message}`, 'error');
        overlay.querySelector('#arvEditSave').disabled = false;
        overlay.querySelector('#arvEditSave').textContent = 'Save';
      }
    };
  }

  async function confirmDelete(artifact) {
    closeAllMenus();
    const overlay = document.createElement('div');
    overlay.className = 'arv-modal-overlay';
    overlay.innerHTML = `
      <div class="arv-modal">
        <h3>Delete Artifact</h3>
        <p style="margin:0 0 4px;color:var(--win11-text-secondary);font-size:0.85rem;">
          Are you sure you want to delete this artifact?
        </p>
        <p style="margin:0 0 14px;color:var(--win11-text);font-weight:600;font-size:0.9rem;">
          ${escapeHtml(artifact.label || 'Untitled')}
          ${artifact.uri ? `<br><span style="font-weight:400;font-size:0.78rem;color:var(--win11-text-secondary);word-break:break-all;">${escapeHtml(artifact.uri)}</span>` : ''}
        </p>
        <div class="arv-modal-actions">
          <button class="arv-btn" id="arvDelCancel">Cancel</button>
          <button class="arv-btn arv-btn--danger" id="arvDelConfirm">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#arvDelCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#arvDelConfirm').onclick = async () => {
      try {
        overlay.querySelector('#arvDelConfirm').disabled = true;
        overlay.querySelector('#arvDelConfirm').textContent = 'Deleting…';
        await api.artifacts.delete(artifact.id);
        overlay.remove();
        showNotice('Artifact deleted.', 'success');
        await loadArtifacts();
      } catch (err) {
        showNotice(`Failed: ${err.message}`, 'error');
        overlay.querySelector('#arvDelConfirm').disabled = false;
        overlay.querySelector('#arvDelConfirm').textContent = 'Delete';
      }
    };
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
        <th>Artifact</th><th>Workflow</th><th>Agent</th><th>Status</th><th>Created</th><th style="width:40px;"></th>
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
          <td>
            <div class="arv-menu-wrap">
              <button class="arv-menu-btn" data-menu="${escapeHtml(a.id)}" title="Actions">⋯</button>
              <div class="arv-dropdown" data-id="${escapeHtml(a.id)}">
${a.uri ? `<button class="arv-dropdown-item" data-action="open-uri" data-uri="${escapeHtml(a.uri)}">🔗 Open Link</button>` : ''}
                <div class="arv-dropdown-sep"></div>
                <button class="arv-dropdown-item" data-action="edit">✏️ Edit</button>
                <div class="arv-dropdown-sep"></div>
                <button class="arv-dropdown-item is-danger" data-action="delete">🗑 Delete</button>
              </div>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;

    // Wire up menu buttons via event delegation
    grid.onclick = (e) => {
      const menuBtn = e.target.closest('.arv-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        toggleMenu(menuBtn.dataset.menu);
        return;
      }

      const menuItem = e.target.closest('.arv-dropdown-item');
      if (menuItem) {
        e.stopPropagation();
        const action = menuItem.dataset.action;
        const artifactId = menuItem.closest('.arv-dropdown').dataset.id;
        const artifact = artifacts.find(a => a.id === artifactId);
        if (!artifact) return;

        if (action === 'edit') showEditModal(artifact);
        else if (action === 'delete') confirmDelete(artifact);
else if (action === 'open-uri' && menuItem.dataset.uri) {
          window.open(menuItem.dataset.uri, '_blank');
        }
        closeAllMenus();
        return;
      }
    };
  }

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.arv-menu-wrap')) closeAllMenus();
  });

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
