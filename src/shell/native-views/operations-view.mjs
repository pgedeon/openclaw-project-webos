import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

const CRON_ADMIN_BASE = 'http://127.0.0.1:3878/api/cron-admin';

async function cronFetch(path, options = {}) {
  const res = await fetch(`${CRON_ADMIN_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function renderOperationsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'operations-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let cleanupFns = [];
  let syncUnsubscribe = null;
  let activeTab = 'overview';
  let cronJobs = [];
  let agents = [];
  let health = {};
  let editingJob = null;
  let noticeTimer = null;
  let refreshInterval = null;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    .ops-tabs { display:flex;gap:2px;padding:0 16px;background:var(--win11-surface);border-bottom:1px solid var(--win11-border); }
    .ops-tab { padding:8px 16px;cursor:pointer;font-size:0.85rem;color:var(--win11-text-secondary);border:none;background:none;border-bottom:2px solid transparent;transition:all 0.15s; }
    .ops-tab:hover { color:var(--win11-text);background:var(--win11-surface-hover); }
    .ops-tab.active { color:var(--win11-text);border-bottom-color:var(--win11-accent);font-weight:600; }
    .ops-panel { flex:1;overflow-y:auto;padding:16px; }
    .ops-stat-grid { display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px; }
    .ops-section { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:12px 14px;margin-bottom:16px; }
    .ops-section h3 { margin:0 0 10px;font-size:0.95rem;color:var(--win11-text); }
    .ops-agent-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:12px; }
    .ops-cron-row { display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--win11-border);transition:background 0.1s; }
    .ops-cron-row:hover { background:var(--win11-surface-hover); }
    .ops-cron-row:last-child { border-bottom:none; }
    .ops-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .ops-btn:hover { background:var(--win11-surface-active); }
    .ops-btn.primary { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .ops-btn.danger { color:#ef4444;border-color:rgba(239,68,68,0.3); }
    .ops-btn.danger:hover { background:rgba(239,68,68,0.1); }
    .ops-btn.icon { padding:4px 7px;min-width:28px;text-align:center; }
    .ops-input, .ops-select, .ops-textarea {
      width:100%;padding:6px 10px;border-radius:6px;
      border:1px solid var(--win11-border);background:var(--win11-surface);
      color:var(--win11-text);font-size:0.85rem;outline:none;box-sizing:border-box;
    }
    .ops-input:focus, .ops-select:focus, .ops-textarea:focus { border-color:var(--win11-accent); }
    .ops-textarea { resize:vertical;font-family:monospace;font-size:0.8rem; }
    .ops-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .ops-badge--success { background:rgba(34,197,94,0.15);color:#22c55e; }
    .ops-badge--muted { background:rgba(255,255,255,0.06);color:var(--win11-text-tertiary); }
    .ops-badge--accent { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .ops-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;display:none;margin-top:8px; }
    .ops-notice.visible { display:block; }
    .ops-notice.success { background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.2); }
    .ops-notice.error { background:rgba(239,68,68,0.1);color:#ef4444;border:1px solid rgba(239,68,68,0.2); }
    .ops-log { font-family:monospace;font-size:0.72rem;white-space:pre-wrap;word-break:break-all;color:var(--win11-text-secondary);background:rgba(0,0,0,0.15);border-radius:6px;padding:8px 10px;max-height:200px;overflow-y:auto;line-height:1.4; }
    .ops-schedule-group { display:grid;grid-template-columns:repeat(5,1fr);gap:6px; }
    .ops-schedule-group .ops-input { text-align:center; }
    .ops-schedule-group label { display:block;font-size:0.65rem;color:var(--win11-text-tertiary);text-align:center;margin-bottom:2px; }
  `;

  root.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">⚙️ Operations Center</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.82rem;">System health, agents, and cron job management.</p>
        </div>
        <button class="ops-btn" id="opsRefreshBtn">↻ Refresh</button>
      </div>
    </div>
    <div class="ops-tabs">
      <button class="ops-tab active" data-tab="overview">Overview</button>
      <button class="ops-tab" data-tab="cron">Cron Jobs</button>
    </div>
    <div class="ops-panel" id="opsPanel"></div>
  `;

  root.prepend(style);
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('.ops-notice');
    if (!el) return;
    el.textContent = msg;
    el.className = `ops-notice visible ${type}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'ops-notice'; }, 4000);
  }

  function truncate(str, len = 80) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  // === Data Loading ===
  async function loadAllData() {
    const [h, a, c, g] = await Promise.allSettled([
      api.health.check().catch(() => ({})),
      api.agents.status().catch(() => ({ agents: [] })),
      cronFetch('/jobs').catch(() => ({ jobs: [] })),
      fetch('/gateway-status.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    health = h.status === 'fulfilled' ? h.value : {};
    const agentPayload = a.status === 'fulfilled' ? a.value : { agents: [] };
    agents = Array.isArray(agentPayload.agents) ? agentPayload.agents : [];
    cronJobs = c.status === 'fulfilled' ? (c.value.jobs || []) : [];

    // Merge live gateway status into agent data
    if (g.status === 'fulfilled' && g.value && g.value.agents) {
      const gatewayMap = new Map(g.value.agents.map(a => [a.id, a]));
      agents = agents.map(dbAgent => {
        const gw = gatewayMap.get(dbAgent.agent_name || dbAgent.name || dbAgent.id);
        if (gw) {
          return {
            ...dbAgent,
            status: gw.status,
            last_seen_at: gw.lastActiveAt,
            sessionsCount: gw.sessionsCount,
            _gatewayStatus: gw.status,
          };
        }
        return dbAgent;
      });
      // Add agents only in gateway (not in DB)
      for (const gw of g.value.agents) {
        if (!agents.find(a => (a.agent_name || a.name || a.id) === gw.id)) {
          agents.push({
            agent_name: gw.name || gw.id,
            id: gw.id,
            name: gw.name || gw.id,
            status: gw.status,
            last_seen_at: gw.lastActiveAt,
            sessionsCount: gw.sessionsCount,
            _gatewayStatus: gw.status,
            metadata: {},
          });
        }
      }
      // Sort: active first, then recent, then offline/never
      const statusOrder = { active: 0, recent: 1, online: 2, idle: 3, offline: 4, disabled: 5, never: 6 };
      agents.sort((a, b) => {
        const oa = statusOrder[a._gatewayStatus || a.status] ?? 5;
        const ob = statusOrder[b._gatewayStatus || b.status] ?? 5;
        return oa - ob;
      });
    }
  }

  // === Tab Switching ===
  function switchTab(tab) {
    activeTab = tab;
    root.querySelectorAll('.ops-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    renderPanel();
  }

  root.querySelectorAll('.ops-tab').forEach(t => {
    const h = () => switchTab(t.dataset.tab);
    t.addEventListener('click', h);
    cleanupFns.push(() => t.removeEventListener('click', h));
  });

  // === Panel Rendering ===
  function renderPanel() {
    const panel = root.querySelector('#opsPanel');
    if (activeTab === 'overview') renderOverview(panel);
    else if (activeTab === 'cron') renderCronPanel(panel);
  }

  function renderOverview(panel) {
    const healthStatus = health.status || 'unknown';
    const isHealthy = healthStatus === 'ok' || healthStatus === 'healthy';
    const statusTone = isHealthy ? 'success' : healthStatus === 'degraded' ? 'warning' : 'error';
    const activeAgents = agents.filter(a => ['active', 'running', 'online'].includes(a.status || '')).length;

    panel.innerHTML = `
      <div class="ops-stat-grid">
        ${createStatCard({ label: 'System', value: healthStatus.toUpperCase(), tone: statusTone }).outerHTML}
        ${createStatCard({ label: 'Agents', value: `${activeAgents}/${agents.length}` }).outerHTML}
        ${createStatCard({ label: 'Cron Jobs', value: formatCount(cronJobs.length) }).outerHTML}
        ${createStatCard({ label: 'Storage', value: health.storage_type || '—' }).outerHTML}
      </div>

      <div class="ops-section">
        <h3>Service Details</h3>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--win11-border);">
            <span style="font-size:0.85rem;color:var(--win11-text);">API Server</span>
            <span class="ops-badge ${isHealthy ? 'ops-badge--success' : 'ops-badge--muted'}">${healthStatus}</span>
          </div>
          ${health.asana_storage ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--win11-border);">
            <span style="font-size:0.85rem;color:var(--win11-text);">Asana Storage</span>
            <span class="ops-badge ops-badge--success">${health.asana_storage}</span>
          </div>` : ''}
          ${health.timestamp ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--win11-border);">
            <span style="font-size:0.85rem;color:var(--win11-text);">Last Check</span>
            <span style="font-size:0.75rem;color:var(--win11-text-secondary);">${new Date(health.timestamp).toLocaleString()}</span>
          </div>` : ''}
        </div>
      </div>

      <div class="ops-section">
        <h3>Agent Status <span style="font-size:0.72rem;color:var(--win11-text-tertiary);font-weight:400;">live from gateway</span></h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">
          ${agents.length > 0 ? agents.map(a => {
            const name = a.name || a.agent_name || a.id || '?';
            const status = a._gatewayStatus || a.status || 'unknown';
            const isActive = status === 'active';
            const isRecent = status === 'recent';
            const isNever = status === 'never';
            const statusColor = isActive ? '#22c55e' : isRecent ? '#eab308' : 'var(--win11-text-tertiary)';
            const statusLabel = isActive ? '● active' : isRecent ? '◐ recent' : isNever ? '○ never' : '○ offline';
            const sessions = a.sessionsCount || 0;
            const lastSeen = a.last_seen_at || a.last_heartbeat || a.lastActiveAt;
            return `<div class="ops-agent-card" style="${isActive ? 'border-left:3px solid #22c55e;' : isRecent ? 'border-left:3px solid #eab308;' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:600;font-size:0.85rem;color:var(--win11-text);">${escapeHtml(name)}</span>
                <span style="font-size:0.72rem;font-weight:600;color:${statusColor};">${statusLabel}</span>
              </div>
              <div style="display:flex;gap:10px;margin-top:4px;font-size:0.7rem;color:var(--win11-text-tertiary);">
                ${sessions > 0 ? `<span>${sessions} session${sessions !== 1 ? 's' : ''}</span>` : ''}
                ${lastSeen ? `<span>${timeAgo(lastSeen)}</span>` : ''}
              </div>
            </div>`;
          }).join('') : '<div style="color:var(--win11-text-tertiary);font-size:0.85rem;">No agents available.</div>'}
        </div>
      </div>

      <div class="ops-section">
        <h3>Cron Jobs Summary</h3>
        <div style="font-size:0.85rem;color:var(--win11-text-secondary);">${cronJobs.length} jobs configured. <a href="#" id="opsViewCron" style="color:var(--win11-accent);text-decoration:none;">Manage cron jobs →</a></div>
      </div>
    `;

    panel.querySelector('#opsViewCron')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('cron');
    });
  }

  // === Cron Panel ===
  function renderCronPanel(panel) {
    if (editingJob !== null) {
      renderCronForm(panel);
      return;
    }

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px;">
        <h3 style="margin:0;font-size:0.95rem;color:var(--win11-text);">Cron Jobs (${cronJobs.length})</h3>
        <div style="display:flex;gap:6px;">
          <input class="ops-input" type="text" id="opsCronSearch" placeholder="Filter jobs..." style="width:180px;padding:5px 10px;font-size:0.8rem;" />
          <button class="ops-btn primary" id="opsCronCreate">+ New Job</button>
        </div>
      </div>
      <div class="ops-section" style="padding:0;">
        ${cronJobs.length > 0 ? cronJobs.map(j => `
          <div class="ops-cron-row" data-id="${escapeHtml(j.id)}">
            <span style="color:var(--win11-accent);font-size:0.75rem;font-weight:600;min-width:90px;font-family:monospace;">${escapeHtml(j.schedule)}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:500;font-size:0.84rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(j.name || j.description || j.id)}">${escapeHtml(truncate(j.name || j.description || j.id, 60))}</div>
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(j.command)}">${escapeHtml(truncate(j.command, 80))}</div>
            </div>
            <span style="font-size:0.7rem;color:var(--win11-text-tertiary);white-space:nowrap;">${j.lastRun ? timeAgo(j.lastRun) : 'never'}</span>
            <button class="ops-btn icon" data-action="run" title="Run now">▶</button>
            <button class="ops-btn icon" data-action="logs" title="View logs">📋</button>
            <button class="ops-btn icon" data-action="edit" title="Edit">✏️</button>
            <button class="ops-btn icon danger" data-action="delete" title="Delete">🗑</button>
          </div>
        `).join('') : '<div style="padding:24px;text-align:center;color:var(--win11-text-tertiary);">No cron jobs configured.</div>'}
      </div>
      <div class="ops-notice"></div>
    `;

    // Event delegation
    const cronSection = panel.querySelector('.ops-section');
    const delegation = async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('.ops-cron-row');
      if (!row) return;
      const id = row.dataset.id;
      const action = btn.dataset.action;

      if (action === 'run') {
        try {
          await cronFetch(`/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
          showNotice(`Job "${id}" triggered.`, 'success');
        } catch (err) { showNotice(`Run failed: ${err.message}`, 'error'); }
      } else if (action === 'logs') {
        await showLogs(id);
      } else if (action === 'edit') {
        editingJob = id;
        renderCronPanel(panel);
      } else if (action === 'delete') {
        if (!confirm(`Delete cron job "${id}"? This removes the .cron file.`)) return;
        try {
          await cronFetch(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
          cronJobs = cronJobs.filter(j => j.id !== id);
          showNotice(`Deleted "${id}".`, 'success');
          renderCronPanel(panel);
        } catch (err) { showNotice(`Delete failed: ${err.message}`, 'error'); }
      }
    };
    cronSection?.addEventListener('click', delegation);
    cleanupFns.push(() => cronSection?.removeEventListener('click', delegation));

    // Create button
    panel.querySelector('#opsCronCreate')?.addEventListener('click', () => {
      editingJob = '__new__';
      renderCronPanel(panel);
    });

    // Search
    let searchTimer = null;
    panel.querySelector('#opsCronSearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = e.target.value.toLowerCase();
        cronSection?.querySelectorAll('.ops-cron-row').forEach(row => {
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(q) ? '' : 'none';
        });
      }, 100);
    });
  }

  function renderCronForm(panel) {
    const isNew = editingJob === '__new__';
    const job = isNew ? { id: '', description: '', minute: '*/5', hour: '*', dom: '*', month: '*', dow: '*', command: '' }
      : cronJobs.find(j => j.id === editingJob) || { id: editingJob, description: '', minute: '*', hour: '*', dom: '*', month: '*', dow: '*', command: '' };

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;font-size:0.95rem;color:var(--win11-text);">${isNew ? 'Create Cron Job' : `Edit: ${escapeHtml(job.id)}`}</h3>
        <button class="ops-btn" id="opsCronCancel">← Back to list</button>
      </div>
      <div class="ops-section">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div style="grid-column:1/-1;">
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Job ID (filename, no spaces) *</label>
            <input class="ops-input" type="text" id="cronFormId" value="${escapeHtml(job.id)}" placeholder="my-cron-job" ${!isNew ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : ''} />
          </div>
          <div style="grid-column:1/-1;">
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Description</label>
            <input class="ops-input" type="text" id="cronFormDesc" value="${escapeHtml(job.description || job.name || '')}" placeholder="What does this job do?" />
          </div>
          <div style="grid-column:1/-1;">
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:6px;">Schedule</label>
            <div class="ops-schedule-group">
              <div><label>Minute</label><input class="ops-input" type="text" id="cronFormMin" value="${escapeHtml(job.minute)}" placeholder="*" /></div>
              <div><label>Hour</label><input class="ops-input" type="text" id="cronFormHour" value="${escapeHtml(job.hour)}" placeholder="*" /></div>
              <div><label>Day</label><input class="ops-input" type="text" id="cronFormDom" value="${escapeHtml(job.dom)}" placeholder="*" /></div>
              <div><label>Month</label><input class="ops-input" type="text" id="cronFormMonth" value="${escapeHtml(job.month)}" placeholder="*" /></div>
              <div><label>DOW</label><input class="ops-input" type="text" id="cronFormDow" value="${escapeHtml(job.dow)}" placeholder="*" /></div>
            </div>
          </div>
          <div style="grid-column:1/-1;">
            <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Command *</label>
            <textarea class="ops-textarea" id="cronFormCmd" rows="3" placeholder="/path/to/script.sh >> /path/to/log.log 2>&1">${escapeHtml(job.command || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:center;">
          <button class="ops-btn primary" id="cronFormSave">${isNew ? 'Create Job' : 'Save Changes'}</button>
          ${!isNew ? `<button class="ops-btn danger" id="cronFormDelete">Delete</button>` : ''}
          <div style="flex:1;"></div>
          <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">Writes to crontab/*.cron</span>
        </div>
        <div class="ops-notice"></div>
      </div>

      ${!isNew ? `<div class="ops-section" style="margin-top:14px;">
        <h3>Recent Logs</h3>
        <div id="cronFormLogs" style="color:var(--win11-text-tertiary);font-size:0.82rem;">Loading...</div>
      </div>` : ''}
    `;

    // Load logs for edit mode
    if (!isNew) {
      loadLogsInto(panel.querySelector('#cronFormLogs'), job.id);
    }

    // Save
    panel.querySelector('#cronFormSave')?.addEventListener('click', async () => {
      const id = panel.querySelector('#cronFormId')?.value?.trim();
      const description = panel.querySelector('#cronFormDesc')?.value?.trim();
      const minute = panel.querySelector('#cronFormMin')?.value?.trim() || '*';
      const hour = panel.querySelector('#cronFormHour')?.value?.trim() || '*';
      const dom = panel.querySelector('#cronFormDom')?.value?.trim() || '*';
      const month = panel.querySelector('#cronFormMonth')?.value?.trim() || '*';
      const dow = panel.querySelector('#cronFormDow')?.value?.trim() || '*';
      const command = panel.querySelector('#cronFormCmd')?.value?.trim();

      if (!id) { showNotice('Job ID is required.', 'error'); return; }
      if (/\s/.test(id) && isNew) { showNotice('Job ID cannot contain spaces.', 'error'); return; }
      if (!command) { showNotice('Command is required.', 'error'); return; }

      try {
        if (isNew) {
          await cronFetch('/jobs', {
            method: 'POST',
            body: JSON.stringify({ id, description, minute, hour, dom, month, dow, command }),
          });
          showNotice(`Created "${id}".`, 'success');
        } else {
          await cronFetch(`/jobs/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ description, minute, hour, dom, month, dow, command }),
          });
          showNotice(`Updated "${id}".`, 'success');
        }
        editingJob = null;
        const refreshed = await cronFetch('/jobs').catch(() => ({ jobs: [] }));
        cronJobs = refreshed.jobs || [];
        renderCronPanel(panel);
      } catch (err) { showNotice(`Save failed: ${err.message}`, 'error'); }
    });

    // Delete from form
    panel.querySelector('#cronFormDelete')?.addEventListener('click', async () => {
      if (!confirm(`Delete "${job.id}"?`)) return;
      try {
        await cronFetch(`/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
        showNotice(`Deleted "${job.id}".`, 'success');
        editingJob = null;
        cronJobs = cronJobs.filter(j => j.id !== job.id);
        renderCronPanel(panel);
      } catch (err) { showNotice(`Delete failed: ${err.message}`, 'error'); }
    });

    // Cancel
    panel.querySelector('#opsCronCancel')?.addEventListener('click', () => {
      editingJob = null;
      renderCronPanel(panel);
    });
  }

  async function loadLogsInto(container, jobId) {
    try {
      const data = await cronFetch(`/jobs/${encodeURIComponent(jobId)}/logs`);
      const logs = data.logs || [];
      if (logs.length === 0) {
        container.innerHTML = `<div style="color:var(--win11-text-tertiary);">No logs found.${data.logPath ? `<br><span style="font-size:0.72rem;">${escapeHtml(data.logPath)}</span>` : ''}</div>`;
        return;
      }
      container.innerHTML = `<div class="ops-log">${escapeHtml(logs.slice(-30).join('\n'))}</div>
        <div style="font-size:0.7rem;color:var(--win11-text-tertiary);margin-top:4px;">${logs.length} lines total${data.logPath ? ` · ${escapeHtml(data.logPath)}` : ''}</div>`;
    } catch (err) {
      container.innerHTML = `<div style="color:#ef4444;">${escapeHtml(err.message)}</div>`;
    }
  }

  async function showLogs(jobId) {
    const job = cronJobs.find(j => j.id === jobId);
    const logHtml = `<div class="ops-section" style="padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:0.95rem;color:var(--win11-text);">Logs: ${escapeHtml(jobId)}</h3>
        <button class="ops-btn" onclick="this.closest('.ops-section').remove()">✕ Close</button>
      </div>
      <div id="opsLogContent_${escapeHtml(jobId)}" style="font-size:0.82rem;">Loading logs...</div>
    </div>`;
    const panel = root.querySelector('#opsPanel');
    const existing = panel.querySelector('.ops-section:last-child');
    if (existing?.querySelector(`#opsLogContent_${jobId}`)) {
      existing.remove();
      return;
    }
    panel.insertAdjacentHTML('beforeend', logHtml);
    await loadLogsInto(panel.querySelector(`#opsLogContent_${jobId}`), jobId);
  }

  // Refresh
  root.querySelector('#opsRefreshBtn')?.addEventListener('click', async () => {
    try {
      await loadAllData();
      renderPanel();
      showNotice('Refreshed.', 'success');
    } catch (err) { showNotice(`Refresh failed: ${err.message}`, 'error'); }
  });

  // Init
  try {
    await loadAllData();
    renderPanel();
  } catch (err) {
    root.querySelector('#opsPanel').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed to load: ${escapeHtml(err.message)}</div>`;
  }

  // Sync subscription replaces manual interval
    if (sync) {
      syncUnsubscribe = sync.subscribe(async () => {
        await loadAllData();
        renderPanel();
      });
    } else {
      // Fallback: poll every 30s if sync not available
      refreshInterval = setInterval(() => {
        loadAllData().then(() => renderPanel()).catch(() => {});
      }, 30000);
    }

    return () => {
      cleanupFns.forEach(fn => fn());
      if (refreshInterval) clearInterval(refreshInterval);
    };
}

export default renderOperationsView;
