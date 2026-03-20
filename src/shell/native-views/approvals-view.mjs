import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderApprovalsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let approvals = [];
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .apv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px;transition:border-color 0.15s; }
    .apv-card:hover { border-color:var(--win11-accent); }
    .apv-btn { font-size:0.78rem;padding:5px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .apv-btn:hover { background:var(--win11-surface-active); }
    .apv-btn.approve { background:#22c55e;color:#fff;border-color:transparent; }
    .apv-btn.approve:hover { background:#16a34a; }
    .apv-btn.reject { background:#ef4444;color:#fff;border-color:transparent; }
    .apv-btn.reject:hover { background:#dc2626; }
    .apv-input,.apv-textarea,.apv-select {
      width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);
      background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none;box-sizing:border-box;
    }
    .apv-input:focus,.apv-select:focus,.apv-textarea:focus { border-color:var(--win11-accent); }
    .apv-textarea { resize:vertical;font-family:inherit; }
    .apv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .apv-notice.is-visible { display:block; }
    .apv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .apv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }
    .apv-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .apv-badge--overdue { background:rgba(239,68,68,0.15);color:#ef4444; }
    .apv-badge--escalated { background:rgba(234,179,8,0.15);color:#eab308; }
    .apv-badge--pending { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .apv-badge--approved { background:rgba(34,197,94,0.15);color:#22c55e; }
    .apv-badge--rejected { background:rgba(239,68,68,0.15);color:#ef4444; }
    .apv-sub { background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:8px;padding:10px; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">✅ Approvals</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Review pending approvals, approve, reject, or escalate with notes.</p>
        </div>
        <button id="apvRefresh" class="apv-btn">↻ Refresh</button>
      </div>
      <div id="apvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <select id="apvFilterApprover" class="apv-select" style="width:auto;min-width:130px;"><option value="">All approvers</option></select>
        <select id="apvFilterWorkflow" class="apv-select" style="width:auto;min-width:130px;"><option value="">All workflows</option></select>
        <select id="apvFilterType" class="apv-select" style="width:auto;min-width:130px;"><option value="">All types</option></select>
        <select id="apvFilterDue" class="apv-select" style="width:auto;min-width:130px;">
          <option value="">All</option>
          <option value="overdue">Overdue</option>
          <option value="due_today">Due today</option>
          <option value="unscheduled">No due date</option>
        </select>
      </div>
    </div>
    <div id="apvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading approvals...</div>
    </div>
    <div id="apvNotice" class="apv-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#apvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `apv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'apv-notice'; }, 4000);
  }

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

  function renderOptions(select, values, allLabel) {
    const items = [{ value:'', label:allLabel }].concat(
      [...new Set(values.filter(Boolean))].sort().map(v => ({ value:v, label:v }))
    );
    select.innerHTML = items.map(i => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</option>`).join('');
  }

  function getFiltered() {
    const dueVal = root.querySelector('#apvFilterDue')?.value || '';
    return approvals.filter(a => {
      if (root.querySelector('#apvFilterApprover')?.value && a.approverId !== root.querySelector('#apvFilterApprover').value) return false;
      if (root.querySelector('#apvFilterWorkflow')?.value && a.workflowType !== root.querySelector('#apvFilterWorkflow').value) return false;
      if (root.querySelector('#apvFilterType')?.value && a.approvalType !== root.querySelector('#apvFilterType').value) return false;
      if (dueVal === 'overdue' && !a.overdue) return false;
      if (dueVal === 'unscheduled' && a.dueAt) return false;
      if (dueVal === 'due_today') {
        if (!a.dueAt) return false;
        const due = new Date(a.dueAt);
        if (due.toDateString() !== new Date().toDateString()) return false;
      }
      return true;
    });
  }

  function renderStats() {
    const items = getFiltered();
    const overdue = items.filter(a => a.overdue).length;
    const escalated = items.filter(a => a.escalatedAt || a.escalatedTo).length;
    root.querySelector('#apvStats').innerHTML = [
      createStatCard({ label:'Pending', value:formatCount(items.length), tone: items.length > 0 ? 'info' : 'default' }),
      createStatCard({ label:'Overdue', value:formatCount(overdue), tone: overdue > 0 ? 'danger' : 'default' }),
      createStatCard({ label:'Escalated', value:formatCount(escalated), tone: escalated > 0 ? 'warning' : 'default' }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#apvGrid');
    const items = getFiltered();
    renderStats();

    if (!items.length) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No pending approvals match filters.</div>';
      return;
    }

    grid.innerHTML = `<div style="display:grid;gap:10px;">
      ${items.map(a => {
        const badges = [];
        if (a.overdue) badges.push('<span class="apv-badge apv-badge--overdue">Overdue</span>');
        if (a.escalatedAt || a.escalatedTo) badges.push('<span class="apv-badge apv-badge--escalated">Escalated</span>');
        badges.push(`<span class="apv-badge apv-badge--pending">${escapeHtml(a.statusInfo?.label || 'Pending')}</span>`);
        return `<div class="apv-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
            <div>
              <div style="font-weight:600;font-size:0.9rem;color:var(--win11-text);">${escapeHtml(a.stepName || a.approvalType || 'Approval')}</div>
              <div style="font-size:0.8rem;color:var(--win11-text-secondary);margin-top:2px;">${escapeHtml(a.workflowType || 'Unknown workflow')} · by ${escapeHtml(a.ownerAgentId || a.requestedBy || 'system')}</div>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">${badges.join('')}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
            <div class="apv-sub">
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;">Run</div>
              <div style="font-weight:600;font-size:0.82rem;margin-top:3px;">${escapeHtml(a.workflowRunId || '—')}</div>
              <div style="font-size:0.75rem;color:var(--win11-text-secondary);">Task: ${escapeHtml(a.taskTitle || a.taskId || '—')}</div>
            </div>
            <div class="apv-sub">
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;">Ownership</div>
              <div style="font-weight:600;font-size:0.82rem;margin-top:3px;">${escapeHtml(a.approverId || 'unassigned')}</div>
              <div style="font-size:0.75rem;color:var(--win11-text-secondary);">Type: ${escapeHtml((a.approvalType || '').replace(/_/g,' '))}</div>
            </div>
            <div class="apv-sub">
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;">Due</div>
              <div style="font-weight:600;font-size:0.82rem;margin-top:3px;">${escapeHtml(a.dueAt ? fmtDate(a.dueAt) : 'No due date')}</div>
              ${a.artifact ? `<div style="font-size:0.75rem;color:var(--win11-text-secondary);margin-top:3px;word-break:break-all;"><a href="${escapeHtml(a.artifact.uri || '#')}" target="_blank" style="color:var(--win11-accent);">${escapeHtml(a.artifact.label || 'Open artifact')}</a></div>` : ''}
            </div>
          </div>
          <div style="margin-bottom:10px;">
            <textarea class="apv-textarea apv-note" data-id="${escapeHtml(a.id)}" rows="2" placeholder="Decision note (required)..." style="font-size:0.8rem;"></textarea>
          </div>
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="apv-btn apv-escalate" data-id="${escapeHtml(a.id)}">Escalate</button>
            <button class="apv-btn apv-reject" data-id="${escapeHtml(a.id)}">Reject</button>
            <button class="apv-btn approve" data-id="${escapeHtml(a.id)}">Approve</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

    grid.querySelectorAll('.approve').forEach(btn => {
      const h = async () => {
        const id = btn.dataset.id;
        const note = grid.querySelector(`.apv-note[data-id="${id}"]`)?.value?.trim();
        if (!note) { showNotice('Decision note is required.', 'error'); return; }
        btn.disabled = true;
        try {
          await api.approvals.decide(id, 'approved', { notes: note, decided_by: 'dashboard-operator' });
          showNotice('Approved.', 'success');
          await loadApprovals();
        } catch (e) { showNotice(e.message || 'Failed to approve.', 'error'); }
        finally { btn.disabled = false; }
      };
      btn.addEventListener('click', h);
      cleanupFns.push(() => btn.removeEventListener('click', h));
    });

    grid.querySelectorAll('.apv-reject').forEach(btn => {
      const h = async () => {
        const id = btn.dataset.id;
        const note = grid.querySelector(`.apv-note[data-id="${id}"]`)?.value?.trim();
        if (!note) { showNotice('Decision note is required.', 'error'); return; }
        btn.disabled = true;
        try {
          await api.approvals.decide(id, 'rejected', { notes: note, decided_by: 'dashboard-operator' });
          showNotice('Rejected.', 'success');
          await loadApprovals();
        } catch (e) { showNotice(e.message || 'Failed to reject.', 'error'); }
        finally { btn.disabled = false; }
      };
      btn.addEventListener('click', h);
      cleanupFns.push(() => btn.removeEventListener('click', h));
    });

    grid.querySelectorAll('.apv-escalate').forEach(btn => {
      const h = async () => {
        const id = btn.dataset.id;
        const note = grid.querySelector(`.apv-note[data-id="${id}"]`)?.value?.trim();
        if (!note) { showNotice('Escalation note required.', 'error'); return; }
        btn.disabled = true;
        try {
          await api.approvals.decide(id, 'escalate', { notes: note, actor: 'dashboard-operator' });
          showNotice('Escalated.', 'success');
          await loadApprovals();
        } catch (e) { showNotice(e.message || 'Escalation failed.', 'error'); }
        finally { btn.disabled = false; }
      };
      btn.addEventListener('click', h);
      cleanupFns.push(() => btn.removeEventListener('click', h));
    });
  }

  async function loadApprovals() {
    try {
      const res = await api.approvals.pending();
      approvals = Array.isArray(res?.approvals) ? res.approvals : [];
      renderOptions(root.querySelector('#apvFilterApprover'), approvals.map(a => a.approverId), 'All approvers');
      renderOptions(root.querySelector('#apvFilterWorkflow'), approvals.map(a => a.workflowType), 'All workflows');
      renderOptions(root.querySelector('#apvFilterType'), approvals.map(a => a.approvalType), 'All types');
      renderGrid();
    } catch (e) {
      root.querySelector('#apvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelector('#apvFilterApprover')?.addEventListener('change', renderGrid);
  root.querySelector('#apvFilterWorkflow')?.addEventListener('change', renderGrid);
  root.querySelector('#apvFilterType')?.addEventListener('change', renderGrid);
  root.querySelector('#apvFilterDue')?.addEventListener('change', renderGrid);
  root.querySelector('#apvRefresh')?.addEventListener('click', () => loadApprovals().then(() => showNotice('Refreshed.', 'success')));

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadApprovals());
  }

  await loadApprovals();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderApprovalsView;
