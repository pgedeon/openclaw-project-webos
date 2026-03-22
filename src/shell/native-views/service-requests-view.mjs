import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderServiceRequestsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let requests = [];
  let services = [];
  let departments = [];
  let agents = [];
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .srv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px;transition:border-color 0.15s; }
    .srv-card:hover { border-color:var(--win11-accent); }
    .srv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .srv-btn:hover { background:var(--win11-surface-active); }
    .srv-btn.primary { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .srv-btn.primary:hover { opacity:0.9; }
    .srv-btn.danger:hover { border-color:#ef4444;color:#ef4444; }
    .srv-input,.srv-select,.srv-textarea {
      width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);
      background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none;box-sizing:border-box;
    }
    .srv-input:focus,.srv-select:focus,.srv-textarea:focus { border-color:var(--win11-accent); }
    .srv-textarea { resize:vertical;font-family:inherit; }
    .srv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .srv-notice.is-visible { display:block; }
    .srv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .srv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }
    .srv-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .srv-badge--open { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .srv-badge--in_progress { background:rgba(234,179,8,0.15);color:#eab308; }
    .srv-badge--completed { background:rgba(34,197,94,0.15);color:#22c55e; }
    .srv-badge--failed { background:rgba(239,68,68,0.15);color:#ef4444; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">🧾 Service Requests</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Create, route, and track structured requests.</p>
        </div>
        <button id="srvRefresh" class="srv-btn">↻ Refresh</button>
      </div>
      <div id="srvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
    </div>
    <div style="flex:1;display:flex;overflow:hidden;">
      <div id="srvFormPanel" style="width:320px;border-right:1px solid var(--win11-border);overflow-y:auto;padding:12px;flex-shrink:0;">
        <h3 style="margin:0 0 12px;color:var(--win11-text);font-size:0.95rem;font-weight:600;">New Request</h3>
        <form id="srvForm" style="display:grid;gap:8px;">
          <div>
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Service *</label>
            <select class="srv-select" id="srvService" required><option value="">Select...</option></select>
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Title *</label>
            <input class="srv-input" id="srvTitle" type="text" required placeholder="What needs to happen?">
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Description</label>
            <textarea class="srv-textarea" id="srvDesc" rows="3" placeholder="Context, outcome, constraints..."></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Priority</label>
              <select class="srv-select" id="srvPriority">
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Department</label>
              <select class="srv-select" id="srvDept"><option value="">Auto</option></select>
            </div>
          </div>
          <div>
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Assign to agent</label>
            <select class="srv-select" id="srvAgent"><option value="">Auto</option></select>
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px;">
            <button type="reset" class="srv-btn">Reset</button>
            <button type="submit" class="srv-btn primary">Create</button>
          </div>
        </form>
      </div>
      <div id="srvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
        <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading...</div>
      </div>
    </div>
    <div id="srvNotice" class="srv-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#srvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `srv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'srv-notice'; }, 4000);
  }

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

  function statusBadge(s) {
    const cls = s === 'open' ? 'open' : s === 'in_progress' ? 'in_progress' : s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'open';
    return `<span class="srv-badge srv-badge--${cls}">${escapeHtml((s || 'open').replace(/_/g,' '))}</span>`;
  }

  function renderStats() {
    root.querySelector('#srvStats').innerHTML = [
      createStatCard({ label:'Total', value:formatCount(requests.length) }),
      createStatCard({ label:'Open', value:formatCount(requests.filter(r => r.status === 'open').length), tone:'info' }),
      createStatCard({ label:'In Progress', value:formatCount(requests.filter(r => r.status === 'in_progress').length), tone:'warning' }),
      createStatCard({ label:'Completed', value:formatCount(requests.filter(r => r.status === 'completed').length), tone:'success' }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#srvGrid');
    renderStats();

    if (!requests.length) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No service requests yet. Create one on the left.</div>';
      return;
    }

    grid.innerHTML = `<div style="display:grid;gap:8px;">
      ${requests.map(r => `<div class="srv-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:0.88rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(r.title || 'Untitled')}</div>
            <div style="font-size:0.75rem;color:var(--win11-text-secondary);margin-top:2px;">
              ${escapeHtml(r.serviceName || r.serviceSlug || '—')} · ${escapeHtml(r.requestedBy || '—')} · ${fmtDate(r.createdAt)}
            </div>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            ${statusBadge(r.status)}
            ${r.priority ? `<span style="font-size:0.68rem;color:var(--win11-text-tertiary);">${escapeHtml(r.priority)}</span>` : ''}
          </div>
        </div>
        ${r.description ? `<div style="font-size:0.8rem;color:var(--win11-text-secondary);margin-bottom:6px;line-height:1.3;">${escapeHtml(r.description.length > 150 ? r.description.substring(0,150)+'...' : r.description)}</div>` : ''}
        ${r.targetDepartment || r.targetAgent ? `<div style="font-size:0.72rem;color:var(--win11-text-tertiary);">
          → ${escapeHtml(r.targetDepartment || 'auto-dept')} / ${escapeHtml(r.targetAgent || 'auto-agent')}
          ${r.workflowRunId ? ` · Run: ${escapeHtml(r.workflowRunId)}` : ''}
        </div>` : ''}
      </div>`).join('')}
    </div>`;
  }

  async function loadRequests() {
    try {
      const res = await api.services.requests({ limit: 100 });
      requests = Array.isArray(res?.serviceRequests) ? res.serviceRequests : [];
      renderGrid();
    } catch (e) {
      root.querySelector('#srvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadMeta() {
    try { services = Array.isArray(await api.services.list()) ? (await api.services.list()).services || await api.services.list() : []; } catch { services = []; }
    try { const d = await api.departments.list(); departments = Array.isArray(d) ? d : []; } catch { departments = []; }
    try { const a = await api.org.agents.list(); agents = Array.isArray(a) ? a : []; } catch { agents = []; }

    root.querySelector('#srvService').innerHTML = '<option value="">Select...</option>' +
      services.map(s => `<option value="${escapeHtml(s.id)}" data-dept="${escapeHtml(s.departmentId || '')}" data-agent="${escapeHtml(s.defaultAgentId || '')}">${escapeHtml(s.name)}</option>`).join('');
    root.querySelector('#srvDept').innerHTML = '<option value="">Auto</option>' +
      departments.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
    root.querySelector('#srvAgent').innerHTML = '<option value="">Auto</option>' +
      agents.slice(0, 30).map(a => `<option value="${escapeHtml(a.name || a.id)}">${escapeHtml(a.displayName || a.name || a.id)}</option>`).join('');
  }

  root.querySelector('#srvService')?.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt) {
      if (opt.dataset.dept) root.querySelector('#srvDept').value = opt.dataset.dept;
      if (opt.dataset.agent) root.querySelector('#srvAgent').value = opt.dataset.agent;
    }
  });

  root.querySelector('#srvForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const serviceId = root.querySelector('#srvService')?.value;
    const title = root.querySelector('#srvTitle')?.value?.trim();
    if (!serviceId || !title) { showNotice('Service and title required.', 'error'); return; }

    try {
      await api.services.createRequest({
        service_id: serviceId,
        title,
        description: root.querySelector('#srvDesc')?.value?.trim() || '',
        requested_by: 'dashboard-operator',
        priority: root.querySelector('#srvPriority')?.value || 'medium',
        target_department_id: root.querySelector('#srvDept')?.value || null,
        target_agent_id: root.querySelector('#srvAgent')?.value || null,
      });
      showNotice('Request created.', 'success');
      root.querySelector('#srvForm').reset();
      await loadRequests();
    } catch (err) {
      showNotice(`Failed: ${err.message}`, 'error');
    }
  });

  root.querySelector('#srvRefresh')?.addEventListener('click', () => loadRequests());

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadRequests());
  }

  await Promise.all([loadMeta(), loadRequests()]);

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderServiceRequestsView;
