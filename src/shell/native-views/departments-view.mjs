import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderDepartmentsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let departments = [];
  let selectedId = null;
  let deptView = null;
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .dpv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:12px 14px;cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s; }
    .dpv-card:hover { border-color:var(--win11-accent);box-shadow:0 0 0 1px var(--win11-accent); }
    .dpv-card.selected { border-color:var(--win11-accent);box-shadow:0 0 0 2px var(--win11-accent); }
    .dpv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .dpv-btn:hover { background:var(--win11-surface-active); }
    .dpv-select { padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;outline:none;width:100%; }
    .dpv-select:focus { border-color:var(--win11-accent); }
    .dpv-sub { background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:8px;padding:10px; }
    .dpv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .dpv-notice.is-visible { display:block; }
    .dpv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">🏢 Departments</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Department operations: staffing, queue health, services.</p>
        </div>
        <button id="dpvRefresh" class="dpv-btn">↻ Refresh</button>
      </div>
      <div id="dpvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
    </div>
    <div style="flex:1;display:flex;overflow:hidden;">
      <div id="dpvList" style="width:260px;border-right:1px solid var(--win11-border);overflow-y:auto;padding:8px;flex-shrink:0;">
        <div style="padding:24px;text-align:center;color:var(--win11-text-tertiary);font-size:0.85rem;">Loading...</div>
      </div>
      <div id="dpvDetail" style="flex:1;overflow-y:auto;padding:16px;">
        <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Select a department to view operations.</div>
      </div>
    </div>
    <div id="dpvNotice" class="dpv-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#dpvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `dpv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'dpv-notice'; }, 4000);
  }

  function renderStats() {
    root.querySelector('#dpvStats').innerHTML = [
      createStatCard({ label:'Departments', value:formatCount(departments.length) }),
      createStatCard({ label:'Total Agents', value:formatCount(departments.reduce((s, d) => s + (d.agentCount || 0), 0)) }),
    ].map(c => c.outerHTML).join('');
  }

  function renderList() {
    const list = root.querySelector('#dpvList');
    renderStats();

    if (!departments.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--win11-text-tertiary);">No departments found.</div>';
      return;
    }

    list.innerHTML = departments.map(d => {
      const isSelected = d.id === selectedId;
      const agentCount = d.agentCount || 0;
      const color = d.color || 'var(--win11-accent)';
      return `<div class="dpv-card${isSelected ? ' selected' : ''}" data-dept-id="${escapeHtml(d.id)}" style="margin-bottom:6px;border-left:3px solid ${color};">
        <div style="font-weight:600;font-size:0.85rem;color:var(--win11-text);">${escapeHtml(d.name || d.slug || 'Department')}</div>
        <div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;">${agentCount} agent${agentCount !== 1 ? 's' : ''}${d.description ? ' · ' + escapeHtml(d.description.substring(0,40)) + (d.description.length > 40 ? '...' : '') : ''}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('.dpv-card').forEach(card => {
      const h = () => { selectedId = card.dataset.deptId; renderList(); loadDeptView(); };
      card.addEventListener('click', h);
      cleanupFns.push(() => card.removeEventListener('click', h));
    });
  }

  async function loadDeptView() {
    const detail = root.querySelector('#dpvDetail');
    const dept = departments.find(d => d.id === selectedId);
    if (!dept) { detail.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Select a department.</div>'; return; }

    detail.innerHTML = '<div style="padding:24px;text-align:center;color:var(--win11-text-tertiary);">Loading department view...</div>';
    try {
      deptView = await api.org.departments.operatingView(selectedId);
      renderDeptView(dept, deptView);
    } catch (e) {
      detail.innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderDeptView(dept, view) {
    const detail = root.querySelector('#dpvDetail');
    const overview = view?.overview || {};
    const staffed = Array.isArray(overview.staffedAgents) ? overview.staffedAgents : [];
    const services = Array.isArray(overview.serviceLines) ? overview.serviceLines : [];
    const queue = overview.queueHealth || {};

    detail.innerHTML = `
      <div style="margin-bottom:16px;">
        <h3 style="margin:0 0 4px;color:var(--win11-text);font-size:1.1rem;font-weight:700;">${escapeHtml(dept.name)}</h3>
        ${dept.description ? `<p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">${escapeHtml(dept.description)}</p>` : ''}
        <div style="font-size:0.75rem;color:var(--win11-text-tertiary);margin-top:4px;">Lead: ${escapeHtml(overview.lead?.name || 'Unassigned')}</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:16px;">
        ${[
          { label:'Agents', value:formatCount(staffed.length) },
          { label:'Services', value:formatCount(services.length) },
          { label:'Queue', value:queue.depth ?? '—', sub:'depth' },
          { label:'Avg Wait', value:queue.avgWaitHours ?? '—', sub:'hours' },
        ].map(c => `<div class="dpv-sub"><div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;">${c.label}${c.sub ? ` (${c.sub})` : ''}</div><div style="font-size:1.1rem;font-weight:700;color:var(--win11-text);margin-top:3px;">${c.value}</div></div>`).join('')}
      </div>

      ${staffed.length ? `<div style="margin-bottom:16px;">
        <h4 style="margin:0 0 8px;color:var(--win11-text);font-size:0.9rem;font-weight:600;">Agents</h4>
        <div style="display:grid;gap:6px;">
          ${staffed.map(a => {
            const presence = a.presence || 'offline';
            const pColor = presence === 'working' ? '#22c55e' : presence === 'queued' ? '#eab308' : 'var(--win11-text-tertiary)';
            return `<div class="dpv-sub" style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:600;font-size:0.83rem;color:var(--win11-text);">${escapeHtml(a.name || a.id)}</div>
                <div style="font-size:0.72rem;color:var(--win11-text-secondary);">${escapeHtml(a.role || a.id)}</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${pColor};"></span>
                <span style="font-size:0.72rem;color:var(--win11-text-secondary);">${escapeHtml(presence)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      ${services.length ? `<div>
        <h4 style="margin:0 0 8px;color:var(--win11-text);font-size:0.9rem;font-weight:600;">Services</h4>
        <div style="display:grid;gap:6px;">
          ${services.map(s => `<div class="dpv-sub">
            <div style="font-weight:600;font-size:0.83rem;color:var(--win11-text);">${escapeHtml(s.name || s.slug)}</div>
            ${s.description ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;">${escapeHtml(s.description)}</div>` : ''}
            <div style="font-size:0.72rem;color:var(--win11-text-tertiary);margin-top:2px;">${formatCount(s.requestCount || 0)} requests</div>
          </div>`).join('')}
        </div>
      </div>` : ''}
    `;
  }

  async function loadDepartments() {
    try {
      const res = await api.org.departments.list();
      departments = Array.isArray(res) ? res : [];
      if (!selectedId && departments.length) selectedId = departments[0].id;
      renderList();
      if (selectedId) loadDeptView();
    } catch (e) {
      root.querySelector('#dpvList').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelector('#dpvRefresh')?.addEventListener('click', () => loadDepartments());

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadDepartments());
  }

  await loadDepartments();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderDepartmentsView;
