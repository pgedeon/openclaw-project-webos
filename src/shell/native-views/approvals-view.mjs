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
  const openPanels = new Set();
  const panelCache = {};

  const style = document.createElement('style');
  style.textContent = `
    .apv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px;transition:border-color 0.15s; }
    .apv-card:hover { border-color:var(--win11-accent); }
    .apv-btn { font-size:0.78rem;padding:5px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .apv-btn:hover { background:var(--win11-surface-active); }
    .apv-btn:disabled { opacity:0.5;cursor:default; }
    .apv-btn.primary { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .apv-btn.primary:hover { filter:brightness(1.1); }
    .apv-btn.danger { background:#ef4444;color:#fff;border-color:transparent; }
    .apv-btn.danger:hover { background:#dc2626; }
    .apv-btn.success { background:#22c55e;color:#fff;border-color:transparent; }
    .apv-btn.success:hover { background:#16a34a; }
    .apv-btn.ghost { background:transparent;color:var(--win11-text-tertiary);border-color:transparent;font-size:0.75rem;padding:3px 8px; }
    .apv-btn.ghost:hover { color:#ef4444;background:rgba(239,68,68,0.1); }
    .apv-select { padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none; }
    .apv-select:focus { border-color:var(--win11-accent); }
    .apv-textarea { width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none;resize:vertical;font-family:inherit;box-sizing:border-box; }
    .apv-textarea:focus { border-color:var(--win11-accent); }
    .apv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;display:none;margin-top:8px; }
    .apv-notice.is-visible { display:block; }
    .apv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2); }
    .apv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2); }
    .apv-badge { display:inline-flex;align-items:center;gap:3px;font-size:0.68rem;padding:2px 7px;border-radius:4px;font-weight:600;line-height:1; }
    .apv-priority--high { background:rgba(239,68,68,0.15);color:#ef4444; }
    .apv-priority--medium { background:rgba(234,179,8,0.15);color:#eab308; }
    .apv-priority--low { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .apv-status { font-size:0.75rem;color:var(--win11-text-tertiary);display:flex;align-items:center;gap:5px; }
    .apv-divider { border:none;border-top:1px solid var(--win11-border);margin:10px 0; }
    .apv-details { margin-top:10px;background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:8px;padding:12px;max-height:350px;overflow-y:auto; }
    .apv-followup { margin-top:10px;display:flex;gap:6px;align-items:flex-end; }
    .apv-followup textarea { flex:1; }
    .apv-result { margin-top:6px;font-size:0.8rem;white-space:pre-wrap;padding:8px;border-radius:6px;display:none; }
    .apv-result.is-error { background:rgba(239,68,68,0.08);color:#ef4444; }
    .apv-result.is-info { background:rgba(96,205,255,0.08);color:var(--win11-text); }
    .apv-confirm-bar { display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(239,68,68,0.08);border-radius:6px;margin-top:6px;font-size:0.8rem;color:#ef4444; }
    .apv-confirm-bar button { font-size:0.78rem;padding:3px 10px;border-radius:4px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .apv-confirm-bar button.confirm-yes { background:#ef4444;color:#fff;border-color:transparent; }
  `;
  root.appendChild(style);

  function showNotice(msg, type) {
    const el = root.querySelector('#apvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = 'apv-notice is-visible' + (type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : '');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => el.className = 'apv-notice', 4000);
  }

  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  }

  function esc(s) { return escapeHtml(s || ''); }

  function getAgentStatus(a) {
    if (a.runFinishedAt) return { icon: '\u2705', label: 'Completed', cls: '' };
    if (a.runSessionActive && a.runLastHeartbeat) {
      const m = Math.round((Date.now() - new Date(a.runLastHeartbeat).getTime()) / 60000);
      if (m < 5) return { icon: '\ud83d\udfe2', label: 'Working now', cls: '' };
      if (m < 30) return { icon: '\ud83d\udfe1', label: m + 'm ago', cls: '' };
      return { icon: '\ud83d\udd34', label: m + 'm ago', cls: 'is-error' };
    }
    if (a.runSessionActive) return { icon: '\ud83d\udfe1', label: 'Session started', cls: '' };
    if (a.runStatus === 'failed') return { icon: '\u274c', label: 'Failed', cls: 'is-error' };
    if (a.status === 'approved') return { icon: '\u23f3', label: 'Waiting for agent', cls: '' };
    if (a.status === 'rejected') return { icon: '\ud83d\udeab', label: 'Rejected', cls: '' };
    return { icon: '\u23f8', label: 'Pending review', cls: '' };
  }

  function priorityBadge(p) {
    if (!p) return '';
    return '<span class="apv-badge apv-priority--' + p + '">' + esc(p) + '</span>';
  }

  function categoryBadge(c) {
    if (!c) return '';
    return '<span class="apv-badge" style="background:var(--win11-surface);color:var(--win11-text-tertiary);border:1px solid var(--win11-border);">' + esc(c.replace(/_/g, ' ')) + '</span>';
  }

  function getFiltered() {
    const statusFilter = root.querySelector('#apvFilter')?.value || 'active';
    return approvals.filter(a => {
      if (statusFilter === 'active') {
        if (a.status === 'pending') return true;
        if (a.status === 'approved' && !a.runFinishedAt && a.runStatus !== 'completed') return true;
        return false;
      }
      return true;
    });
  }

  function renderStats() {
    const items = getFiltered();
    const pending = items.filter(a => a.status === 'pending').length;
    const inProgress = items.filter(a => a.status === 'approved' && !a.runFinishedAt && a.runStatus !== 'completed').length;
    const completed = items.filter(a => a.runStatus === 'completed').length;
    const rejected = items.filter(a => a.status === 'rejected').length;
    root.querySelector('#apvStats').innerHTML = [
      createStatCard({ label: 'Needs Action', value: formatCount(pending), tone: pending > 0 ? 'info' : 'default' }),
      createStatCard({ label: 'In Progress', value: formatCount(inProgress), tone: inProgress > 0 ? 'info' : 'default' }),
      createStatCard({ label: 'Completed', value: formatCount(completed), tone: 'default' }),
      createStatCard({ label: 'Rejected', value: formatCount(rejected), tone: rejected > 0 ? 'danger' : 'default' }),
    ].map(c => c.outerHTML).join('');
  }

  function renderGrid() {
    const grid = root.querySelector('#apvGrid');
    const items = getFiltered();
    renderStats();

    if (!items.length) {
      const filter = root.querySelector('#apvFilter')?.value || 'active';
      grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--win11-text-tertiary);">' +
        (filter === 'active' ? 'All clear. No pending approvals.' : 'No approvals match your filter.') + '</div>';
      return;
    }

    grid.innerHTML = items.map(a => renderCard(a)).join('');

    openPanels.forEach(runId => {
      const panel = grid.querySelector('[data-panel="' + runId + '"]');
      if (panel) {
        panel.style.display = 'block';
        if (panelCache[runId]) panel.innerHTML = panelCache[runId];
      }
    });

    attachListeners(grid);
  }

  function renderCard(a) {
    const isPending = a.status === 'pending';
    const isApproved = a.status === 'approved' && !a.runFinishedAt && a.runStatus !== 'completed';
    const isCompleted = a.runStatus === 'completed';
    const isRejected = a.status === 'rejected';
    const st = getAgentStatus(a);
    const prompt = a.metadata?.action_prompt || a.metadata?.description || '';
    const source = a.ownerAgentId || a.requestedBy || 'system';
    const time = fmtDate(a.created_at);
    const runId = a.workflowRunId;

    let h = '<div class="apv-card" data-run-id="' + esc(runId) + '">';

    // Header
    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">';
    h += '<div style="flex:1;min-width:0;">';
    h += '<div style="font-weight:600;font-size:0.9rem;color:var(--win11-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(a.stepName || a.approvalType || 'Approval') + '</div>';
    h += '<div style="font-size:0.75rem;color:var(--win11-text-tertiary);margin-top:2px;">by ' + esc(source) + (time ? ' \u00b7 ' + time : '') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">';
    h += priorityBadge(a.metadata?.priority);
    h += categoryBadge(a.metadata?.category || a.approvalType);
    h += '</div></div>';

    // Description
    if (prompt) {
      h += '<div style="margin-top:8px;font-size:0.82rem;color:var(--win11-text);line-height:1.45;white-space:pre-wrap;max-height:4.5em;overflow:hidden;">' + esc(prompt) + '</div>';
    }

    // Agent status
    h += '<div style="margin-top:8px;" class="apv-status">' + st.icon + ' ' + esc(st.label) + '</div>';

    // ── Pending: note + Dismiss / Reject / Approve ──
    if (isPending) {
      h += '<hr class="apv-divider">';
      h += '<textarea class="apv-textarea apv-note" data-id="' + esc(a.id) + '" rows="1" placeholder="Add a note (optional)..."></textarea>';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">';
      h += '<button class="apv-btn ghost apv-delete-trigger" data-run-id="' + esc(runId) + '">Dismiss</button>';
      h += '<div style="display:flex;gap:6px;">';
      h += '<button class="apv-btn apv-reject" data-id="' + esc(a.id) + '">Reject</button>';
      h += '<button class="apv-btn success apv-approve" data-id="' + esc(a.id) + '">Approve</button>';
      h += '</div></div>';
    }

    // ── Approved: Cancel / Execute ──
    if (isApproved && !a.runSessionActive) {
      h += '<hr class="apv-divider">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<button class="apv-btn ghost apv-delete-trigger" data-run-id="' + esc(runId) + '">Cancel</button>';
      h += '<button class="apv-btn primary apv-execute" data-run-id="' + esc(runId) + '">\u25b6 Execute</button>';
      h += '</div>';
    }

    // ── Completed: Delete / Details / Follow-up ──
    if (isCompleted) {
      h += '<hr class="apv-divider">';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      h += '<button class="apv-btn ghost apv-delete-trigger" data-run-id="' + esc(runId) + '">Delete</button>';
      h += '<button class="apv-btn apv-details-toggle" data-run-id="' + esc(runId) + '">\u25b6 Details</button>';
      h += '</div>';
      h += '<div class="apv-details" data-panel="' + esc(runId) + '" style="display:none;"><div style="font-size:0.75rem;color:var(--win11-text-tertiary);">Loading...</div></div>';
      h += '<div class="apv-followup" data-run-id="' + esc(runId) + '">';
      h += '<textarea class="apv-textarea apv-followup-input" rows="1" placeholder="Follow-up..."></textarea>';
      h += '<button class="apv-btn primary apv-followup-send" style="align-self:flex-end;">Send</button>';
      h += '</div>';
      h += '<div class="apv-result" data-result="' + esc(runId) + '"></div>';
    }

    // ── Rejected: note + Delete ──
    if (isRejected) {
      h += '<hr class="apv-divider">';
      if (a.decision || a.notes) {
        h += '<div style="font-size:0.8rem;color:var(--win11-text-tertiary);font-style:italic;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(a.decision || a.notes) + '</div>';
      }
      h += '<button class="apv-btn ghost apv-delete-trigger" data-run-id="' + esc(runId) + '">Delete</button>';
    }

    h += '</div>';
    return h;
  }

  async function loadDetails(panel, runId) {
    if (panelCache[runId]) { panel.innerHTML = panelCache[runId]; return; }
    panel.innerHTML = '<div style="font-size:0.75rem;color:var(--win11-text-tertiary);">Loading...</div>';
    try {
      const resp = await fetch('/api/workflow-runs/' + runId);
      const run = await resp.json();
      const output = run.outputSummary || run.output_summary || {};
      const finished = run.finished_at || run.finishedAt || '';
      const duration = run.started_at ? Math.round((new Date(finished) - new Date(run.started_at)) / 60000) : '?';
      let html = '<div style="display:flex;gap:16px;margin-bottom:10px;font-size:0.8rem;color:var(--win11-text-tertiary);">';
      html += '<span>Finished: ' + (finished ? new Date(finished).toLocaleString() : '--') + '</span>';
      html += '<span>Duration: ~' + duration + ' min</span></div>';
      const entries = Object.entries(output).filter(([k, v]) => v && k !== 'status');
      if (entries.length) {
        for (const [key, val] of entries) {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          html += '<div style="margin-bottom:8px;"><div style="font-weight:600;font-size:0.82rem;color:var(--win11-text);">' + esc(label) + '</div>';
          html += '<div style="font-size:0.8rem;color:var(--win11-text-secondary);white-space:pre-wrap;margin-top:2px;">' + esc(typeof val === 'string' ? val : JSON.stringify(val, null, 2)) + '</div></div>';
        }
      } else {
        html += '<div style="font-size:0.8rem;color:var(--win11-text-tertiary);">No output recorded</div>';
      }
      panelCache[runId] = html;
      panel.innerHTML = html;
    } catch (err) {
      panel.innerHTML = '<div style="font-size:0.8rem;color:#ef4444;">Failed: ' + esc(err.message) + '</div>';
    }
  }

  function attachListeners(grid) {
    grid.querySelectorAll('.apv-approve').forEach(btn => {
      const handler = async () => {
        const id = btn.dataset.id;
        const note = grid.querySelector('.apv-note[data-id="' + id + '"]')?.value?.trim() || 'Approved';
        btn.disabled = true;
        try {
          await api.approvals.act(id, '', { decision: 'approved', notes: note, decided_by: 'dashboard-operator' });
          showNotice('Approved.', 'success');
          await loadApprovals();
        } catch (e) { showNotice(e.message || 'Failed.', 'error'); btn.disabled = false; }
      };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    grid.querySelectorAll('.apv-reject').forEach(btn => {
      const handler = async () => {
        const id = btn.dataset.id;
        const note = grid.querySelector('.apv-note[data-id="' + id + '"]')?.value?.trim() || 'Rejected';
        btn.disabled = true;
        try {
          await api.approvals.act(id, '', { decision: 'rejected', notes: note, decided_by: 'dashboard-operator' });
          showNotice('Rejected.', 'success');
          await loadApprovals();
        } catch (e) { showNotice(e.message || 'Failed.', 'error'); btn.disabled = false; }
      };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });
  }

  root.querySelector('#apvGrid')?.addEventListener('click', async (e) => {
    // Delete trigger — show confirmation bar
    const delBtn = e.target.closest('.apv-delete-trigger');
    if (delBtn) {
      const card = delBtn.closest('.apv-card');
      const runId = delBtn.dataset.runId;
      // Remove any existing confirm bars
      card?.querySelectorAll('.apv-confirm-bar').forEach(el => el.remove());
      // Insert confirm bar after the button
      const confirmBar = document.createElement('div');
      confirmBar.className = 'apv-confirm-bar';
      confirmBar.innerHTML = '<span>Delete this run?</span><button class="confirm-no">No</button><button class="confirm-yes" data-run-id="' + esc(runId) + '">Yes, delete</button>';
      delBtn.parentNode?.insertBefore(confirmBar, delBtn.nextSibling);
      delBtn.style.display = 'none';
      return;
    }

    // Confirm yes — delete
    const confirmYes = e.target.closest('.confirm-yes');
    if (confirmYes) {
      const runId = confirmYes.dataset.runId;
      confirmYes.disabled = true;
      confirmYes.textContent = 'Deleting...';
      try {
        const resp = await fetch('/api/workflow-runs/' + runId, { method: 'DELETE' });
        if (resp.ok) {
          showNotice('Deleted.', 'success');
          await loadApprovals();
        } else {
          showNotice('Failed to delete.', 'error');
        }
      } catch (err) {
        showNotice('Failed: ' + err.message, 'error');
      }
      return;
    }

    // Confirm no — restore
    const confirmNo = e.target.closest('.confirm-no');
    if (confirmNo) {
      const card = confirmNo.closest('.apv-card');
      card?.querySelectorAll('.apv-confirm-bar').forEach(el => el.remove());
      card?.querySelectorAll('.apv-delete-trigger').forEach(el => el.style.display = '');
      return;
    }

    // Details toggle
    const detailsBtn = e.target.closest('.apv-details-toggle');
    if (detailsBtn) {
      const runId = detailsBtn.dataset.runId;
      const panel = root.querySelector('[data-panel="' + runId + '"]');
      if (!panel) return;
      const isOpen = panel.style.display !== 'none';
      if (isOpen) { panel.style.display = 'none'; openPanels.delete(runId); }
      else { panel.style.display = 'block'; openPanels.add(runId); loadDetails(panel, runId); }
      detailsBtn.textContent = isOpen ? '\u25b6 Details' : '\u25bc Details';
      return;
    }

    // Follow-up send
    const followupBtn = e.target.closest('.apv-followup-send');
    if (followupBtn) {
      const runId = followupBtn.dataset.runId;
      const container = followupBtn.closest('.apv-followup');
      const input = container?.querySelector('.apv-followup-input');
      const resultEl = root.querySelector('[data-result="' + runId + '"]');
      const prompt = (input?.value || '').trim();
      if (!prompt) return;
      followupBtn.disabled = true;
      followupBtn.textContent = '\u23f3';
      if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = 'Sending...'; resultEl.className = 'apv-result is-info'; }
      try {
        const resp = await fetch('/api/system-scan/followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, prompt })
        });
        const data = await resp.json();
        if (resultEl) {
          if (data.error) { resultEl.textContent = data.error; resultEl.className = 'apv-result is-error'; }
          else { resultEl.textContent = data.message || 'Follow-up sent.'; resultEl.className = 'apv-result is-info'; if (input) input.value = ''; }
        }
      } catch (err) { if (resultEl) { resultEl.textContent = 'Failed: ' + err.message; resultEl.className = 'apv-result is-error'; } }
      followupBtn.disabled = false;
      followupBtn.textContent = 'Send';
      return;
    }

    // Execute
    const execBtn = e.target.closest('.apv-execute');
    if (execBtn) {
      const runId = execBtn.dataset.runId;
      if (!runId) return;
      execBtn.disabled = true;
      execBtn.textContent = '\u23f3 Starting...';
      try {
        await fetch('/api/workflow-runs/' + runId + '/start', { method: 'POST' });
        showNotice('Run started.', 'success');
        setTimeout(() => loadApprovals(), 2000);
      } catch (err) { showNotice('Failed: ' + err.message, 'error'); execBtn.disabled = false; execBtn.textContent = '\u25b6 Execute'; }
      return;
    }
  });

  function saveNotes() {
    const notes = {};
    root.querySelectorAll('.apv-note').forEach(ta => { if (ta.value.trim()) notes[ta.dataset.id] = ta.value; });
    return notes;
  }
  function restoreNotes(notes) {
    for (const [id, val] of Object.entries(notes)) {
      const ta = root.querySelector('.apv-note[data-id="' + id + '"]');
      if (ta) ta.value = val;
    }
  }

  async function loadApprovals() {
    try {
      const savedNotes = saveNotes();
      const res = await api.approvals.list({ limit: 100 });
      approvals = Array.isArray(res?.approvals) ? res.approvals : [];
      renderGrid();
      restoreNotes(savedNotes);
    } catch (e) {
      root.querySelector('#apvGrid').innerHTML = '<div style="padding:24px;color:#ef4444;">Failed: ' + esc(e.message) + '</div>';
    }
  }

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 2px;color:var(--win11-text);font-size:1.15rem;font-weight:700;">Approvals</h2>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.82rem;">Review and act on pending items.</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="apvFilter" class="apv-select" style="width:auto;">
            <option value="active">Active</option>
            <option value="all">All</option>
          </select>
          <button id="apvRefresh" class="apv-btn">\u21bb</button>
        </div>
      </div>
      <div id="apvStats" style="display:flex;gap:10px;flex-wrap:wrap;"></div>
    </div>
    <div id="apvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:40px;text-align:center;color:var(--win11-text-tertiary);">Loading...</div>
    </div>
    <div id="apvNotice" class="apv-notice"></div>
  `;
  mountNode.appendChild(root);

  root.querySelector('#apvFilter')?.addEventListener('change', renderGrid);
  root.querySelector('#apvRefresh')?.addEventListener('click', () => loadApprovals().then(() => showNotice('Refreshed.', 'success')));

  if (sync) syncUnsubscribe = sync.subscribe(() => loadApprovals());

  await loadApprovals();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderApprovalsView;
