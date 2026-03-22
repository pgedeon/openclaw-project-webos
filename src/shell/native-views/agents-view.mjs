import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderAgentsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'agents-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let agents = [];
  let projects = [];
  let selectedAgentId = null;
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    .av-agent-card { cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s; }
    .av-agent-card:hover { border-color:var(--win11-accent) !important; box-shadow:0 0 0 1px var(--win11-accent); }
    .av-agent-card.selected { border-color:var(--win11-accent) !important; box-shadow:0 0 0 2px var(--win11-accent); }
    .av-action-btn { font-size:0.78rem; padding:4px 10px; border-radius:5px; border:1px solid var(--win11-border); background:var(--win11-surface-solid); color:var(--win11-text); cursor:pointer; white-space:nowrap; }
    .av-action-btn:hover { background:var(--win11-surface-active); }
    .av-action-btn.primary { background:var(--win11-accent); color:#fff; border-color:transparent; }
    .av-action-btn.primary:hover { filter:brightness(1.1); }
    .av-input, .av-select, .av-textarea {
      width:100%; padding:5px 8px; border-radius:5px;
      border:1px solid var(--win11-border); background:var(--win11-surface);
      color:var(--win11-text); font-size:0.82rem; outline:none; box-sizing:border-box;
    }
    .av-input:focus, .av-select:focus, .av-textarea:focus { border-color:var(--win11-accent); }
    .av-textarea { resize:vertical; font-family:inherit; }
    .av-notice {
      padding:6px 12px; border-radius:6px; font-size:0.82rem; text-align:center;
      background:rgba(96,205,255,0.1); color:var(--win11-accent); border:1px solid rgba(96,205,255,0.2);
      display:none; margin-top:8px;
    }
    .av-notice.is-visible { display:block; }
    .av-notice.is-error { background:rgba(239,68,68,0.1); color:#ef4444; border-color:rgba(239,68,68,0.2); }
    .av-notice.is-success { background:rgba(34,197,94,0.1); color:#22c55e; border-color:rgba(34,197,94,0.2); }
    .av-cap-badge {
      display:inline-block; font-size:0.68rem; padding:1px 6px; border-radius:3px;
      background:rgba(96,205,255,0.08); color:var(--win11-accent); margin:1px 2px;
    }
    .av-queue-bar { height:4px; border-radius:2px; background:var(--win11-surface-active); margin-top:8px; overflow:hidden; }
    .av-queue-fill { height:100%; border-radius:2px; transition:width 0.3s; }
    .av-status-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
    .av-status-active { background:#22c55e; }
    .av-status-recent { background:#eab308; }
    .av-status-offline { background:var(--win11-text-tertiary); }
`;
  root.appendChild(style);

  // Layout
  const layout = document.createElement('div');
  layout.innerHTML = `
    <div id="avHeader" style="padding:16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">🤖 Agents</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Click an agent to view details and assign tasks.</p>
        </div>
        <button id="avRefreshBtn" class="av-action-btn">↻ Refresh</button>
      </div>
      <div id="avStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <input id="avSearch" type="text" placeholder="Search agents..." style="flex:1;min-width:140px;padding:5px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;outline:none;" />
        <select id="avDeptFilter" style="padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;">
          <option value="all">All departments</option>
        </select>
      </div>
    </div>
    <div id="avGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading agents...</div>
    </div>
    <div id="avDetail" style="display:none;border-top:2px solid var(--win11-border);overflow-y:auto;max-height:55%;flex-shrink:0;"></div>
`;

  root.appendChild(layout);
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#avNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `av-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'av-notice'; }, 4000);
  }

  // Data
  async function loadAgents() {
    try {
      let orgAgents = [];
      let agentsList = [];
      let blockers = [];

      // If sync is available and has gatewayAgents data, use it
      if (sync && sync.gatewayAgents && Array.isArray(sync.gatewayAgents)) {
        // Map gateway status to org agents
        const gatewayMap = new Map();
        for (const ga of sync.gatewayAgents) {
          const id = ga.id || ga.name;
          if (id) gatewayMap.set(id, ga);
        }

        const orgResult = await api.org.agents.list();
        orgAgents = Array.isArray(orgResult) ? orgResult : [];
        agentsList = orgAgents;

        // Merge gateway status into agent data
        for (const a of agentsList) {
          const id = a.id || a.name || a.agentId;
          const ga = gatewayMap.get(id);
          if (ga) {
            a.gatewayStatus = ga.status;
            a.lastActiveAgeMs = ga.lastActiveAgeMs;
            a.lastActiveAt = ga.lastActiveAt;
          }
        }

        const blockersResult = await api.blockers.list();
        const blockersRaw = blockersResult.status === 'fulfilled' ? blockersResult.value : {};
        blockers = Array.isArray(blockersRaw.blockers) ? blockersRaw.blockers : Array.isArray(blockersRaw) ? blockersRaw : [];
      } else {
        // Fallback to original behavior
        const [orgResult, agentsResult, blockersResult] = await Promise.allSettled([
          api.org.agents.list(),
          api.agents.list(),
          api.blockers.list(),
        ]);

        orgAgents = orgResult.status === 'fulfilled' && Array.isArray(orgResult.value) ? orgResult.value : [];
        const agentsRaw = agentsResult.status === 'fulfilled' ? agentsResult.value : {};
        agentsList = Array.isArray(agentsRaw.agents) ? agentsRaw.agents : Array.isArray(agentsRaw) ? agentsRaw : [];
        const blockersRaw = blockersResult.status === 'fulfilled' ? blockersResult.value : {};
        blockers = Array.isArray(blockersRaw.blockers) ? blockersRaw.blockers : Array.isArray(blockersRaw) ? blockersRaw : [];

        const agentMap = new Map();
        for (const a of orgAgents) {
          const id = a.id || a.name || a.agentId;
          if (id) agentMap.set(id, a);
        }
        for (const a of agentsList) {
          const id = a.id || a.name;
          if (id && agentMap.has(id)) Object.assign(agentMap.get(id), a);
          else if (id) agentMap.set(id, a);
        }

        agentsList = Array.from(agentMap.values());
      }

      agents = agentsList;
      agents.sort((a, b) => {
        const aActive = ['active', 'running', 'online'].includes(a.status || a.presence || '');
        const bActive = ['active', 'running', 'online'].includes(b.status || b.presence || '');
        if (aActive !== bActive) return bActive - aActive; // active first
        const aName = (a.displayName || a.name || a.id || '').toLowerCase();
        const bName = (b.displayName || b.name || b.id || '').toLowerCase();
        return aName.localeCompare(bName);
      });

      updateDeptFilter();
      renderStats(blockers);
      renderGrid();
    } catch (err) {
      root.querySelector('#avGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Error loading agents: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadProjects() {
    try {
      const res = await api.projects.list();
      projects = Array.isArray(res) ? res : (Array.isArray(res.projects) ? res.projects : []);
    } catch (e) { /* ok */ }
  }

  // Departments
  function getDepartments() {
    const depts = new Map();
    for (const a of agents) {
      const d = a.department;
      if (!d) continue;
      const key = d.name || d.slug || (typeof d === 'string' ? d : '');
      if (!key) continue;
      if (!depts.has(key)) {
        depts.set(key, { name: key, slug: d.slug || '', color: d.color || '', agentCount: 0 });
      }
      depts.get(key).agentCount++;
    }
    return [...depts.values()].sort((a, b) => b.agentCount - a.agentCount);
  }

  function updateDeptFilter() {
    const select = root.querySelector('#avDeptFilter');
    const depts = getDepartments();
    const current = select.value;
    select.innerHTML = '<option value="all">All departments</option>' +
      depts.map(d => `<option value="${escapeHtml(d.slug || d.name)}">${escapeHtml(d.name)} (${d.agentCount})</option>`).join('');
    select.value = depts.some(d => (d.slug || d.name) === current) ? current : 'all';
  }

  function getDeptName(a) {
    const d = a.department;
    if (!d) return '';
    if (typeof d === 'string') return d;
    return d.name || d.slug || '';
  }

  function getDeptSlug(a) {
    const d = a.department;
    if (!d) return '';
    if (typeof d === 'string') return d;
    return d.slug || d.name || '';
  }

  // Rendering
  function renderStats(blockers = []) {
    const active = agents.filter(a => ['active', 'running', 'online'].includes(a.status || a.presence || '')).length;
    const totalQueue = agents.reduce((s, a) => s + (a.queueSummary?.total || 0), 0);
    const activeBlockers = blockers.filter(b => b.status === 'active' || b.status === 'open' || !b.resolved).length;

    root.querySelector('#avStats').innerHTML = `
      ${createStatCard({ label: 'Agents', value: formatCount(agents.length) }).outerHTML}
      ${createStatCard({ label: 'Active', value: formatCount(active), tone: active > 0 ? 'success' : 'default' }).outerHTML}
      ${createStatCard({ label: 'Queued', value: formatCount(totalQueue) }).outerHTML}
      ${createStatCard({ label: 'Blockers', value: formatCount(activeBlockers), tone: activeBlockers > 0 ? 'warning' : 'default' }).outerHTML}
  `;
  }

  function renderGrid() {
    const grid = root.querySelector('#avGrid');
    const search = (root.querySelector('#avSearch')?.value || '').trim().toLowerCase();
    const deptFilter = root.querySelector('#avDeptFilter')?.value || 'all';

    let filtered = agents;
    if (deptFilter !== 'all') {
      filtered = filtered.filter(a => getDeptSlug(a) === deptFilter || getDeptName(a) === deptFilter);
    }
    if (search) {
      filtered = filtered.filter(a => {
        const name = (a.displayName || a.name || a.id || '').toLowerCase();
        const dept = getDeptName(a).toLowerCase();
        const model = (a.defaultModel || '').toLowerCase();
        const caps = (a.capabilities || []).join(' ').toLowerCase();
        return name.includes(search) || dept.includes(search) || model.includes(search) || caps.includes(search);
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">${search || deptFilter !== 'all' ? 'No agents match filters.' : 'No agents found.'}</div>`;
      return;
    }

    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;">
      ${filtered.map(a => renderAgentCard(a)).join('')}
    </div>`;

    // Wire click handlers
    grid.querySelectorAll('.av-agent-card').forEach(card => {
      const handler = () => {
        selectedAgentId = card.dataset.agentId === selectedAgentId ? null : card.dataset.agentId;
        renderGrid();
        renderDetail();
      };
      card.addEventListener('click', handler);
      cleanupFns.push(() => card.removeEventListener('click', handler));
    });
  }

  function renderAgentCard(a) {
    const id = a.id || a.agentId || a.name;
    const name = a.displayName || a.name || a.agent_name || id;
    const status = a.status || a.presence || 'unknown';
    const dept = getDeptName(a);
    const deptColor = typeof a.department === 'object' ? (a.department.color || '') : '';
    const model = a.defaultModel || a.model || '';
    const isActive = ['active', 'running', 'online'].includes(status);
    const isSelected = id === selectedAgentId;
    const queue = a.queueSummary;
    const caps = a.capabilities || [];
    const currentActivity = a.currentActivity || '';
    const lastSeen = a.lastSeenAt || a.last_seen_at || '';

    const statusColor = isActive ? 'var(--win11-accent)' : 'var(--win11-text-tertiary)';
    const queueTotal = queue?.total || 0;
    const queueProgress = queueTotal > 0 ? Math.round(((queue.completed || 0) / queueTotal) * 100) : 0;

    const modelName = model.includes('/') ? model.split('/').slice(-1)[0].split(':')[0] : model;
    const shortModel = modelName.length > 20 ? modelName.substring(0, 18) + '…' : modelName;

    return `<div class="av-agent-card${isSelected ? ' selected' : ''}" data-agent-id="${escapeHtml(id)}" style="
      background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:12px;
      border-left:3px solid ${isActive ? 'var(--win11-accent)' : deptColor || 'var(--win11-text-tertiary)'};
    ">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;font-size:0.88rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          ${dept ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(dept)}</div>` : ''}
        </div>
        <span style="font-size:0.68rem;font-weight:600;color:${statusColor};text-transform:uppercase;padding:2px 7px;border-radius:4px;background:${isActive ? 'rgba(96,205,255,0.1)' : 'var(--win11-surface-active)'};flex-shrink:0;">${escapeHtml(status)}</span>
      </div>
      ${model ? `<div style="font-size:0.7rem;color:var(--win11-text-tertiary);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(model)}">🧠 ${escapeHtml(shortModel)}</div>` : ''}
      ${currentActivity ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(currentActivity)}">⚡ ${escapeHtml(currentActivity.length > 60 ? currentActivity.substring(0, 60) + '…' : currentActivity)}</div>` : ''}
      ${caps.length > 0 ? `<div style="margin-top:6px;">${caps.slice(0, 4).map(c => `<span class="av-cap-badge">${escapeHtml(c)}</span>`).join('')}${caps.length > 4 ? `<span class="av-cap-badge">+${caps.length - 4}</span>` : ''}</div>` : ''}
      ${queueTotal > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <span style="font-size:0.68rem;color:var(--win11-text-tertiary);">Queue: ${queue.ready || 0} ready · ${queue.inProgress || 0} active · ${queue.completed || 0} done</span>
          <span style="font-size:0.68rem;color:var(--win11-text-tertiary);">${queueProgress}%</span>
        </div>
        <div class="av-queue-bar"><div class="av-queue-fill" style="width:${queueProgress}%;background:var(--win11-accent);"></div></div>
      ` : ''}
      ${!isActive && lastSeen ? `<div style="font-size:0.68rem;color:var(--win11-text-tertiary);margin-top:6px;">Last seen: ${new Date(lastSeen).toLocaleString()}</div>` : ''}
    </div>`;
  }

  // Detail panel with assign-task form
  function renderDetail() {
    const panel = root.querySelector('#avDetail');
    if (!selectedAgentId) { panel.style.display = 'none'; return; }

    const agent = agents.find(a => (a.id || a.agentId || a.name) === selectedAgentId);
    if (!agent) { panel.style.display = 'none'; selectedAgentId = null; return; }

    panel.style.display = 'block';

    const id = agent.id || agent.agentId || agent.name;
    const name = agent.displayName || agent.name || id;
    const status = agent.status || agent.presence || 'unknown';
    const dept = getDeptName(agent);
    const model = agent.defaultModel || agent.model || '';
    const caps = agent.capabilities || [];
    const queue = agent.queueSummary;
    const role = agent.role || '';
    const currentActivity = agent.currentActivity || '';
    const lastSeen = agent.lastSeenAt || agent.last_seen_at || '';
    const currentTask = agent.currentTask || agent.runtime?.currentTaskId || '';

    const isActive = ['active', 'running', 'online'].includes(status);

    panel.innerHTML = `
      <div style="padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <div>
            <h3 style="margin:0 0 4px;color:var(--win11-text);font-size:1rem;font-weight:600;">${escapeHtml(name)}</h3>
            ${dept ? `<div style="font-size:0.8rem;color:var(--win11-text-secondary);">${escapeHtml(dept)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="font-size:0.75rem;font-weight:600;color:${isActive ? 'var(--win11-accent)' : 'var(--win11-text-tertiary)'};text-transform:uppercase;">${escapeHtml(status)}</span>
            <button id="avCloseDetail" style="background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;padding:2px 6px;" title="Close">✕</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;font-size:0.8rem;margin-bottom:14px;">
          ${role ? `<div><span style="color:var(--win11-text-tertiary);">Role:</span> ${escapeHtml(role)}</div>` : ''}
          ${model ? `<div><span style="color:var(--win11-text-tertiary);">Model:</span> ${escapeHtml(model)}</div>` : ''}
          ${currentActivity ? `<div style="grid-column:1/-1;"><span style="color:var(--win11-text-tertiary);">Activity:</span> ${escapeHtml(currentActivity)}</div>` : ''}
          ${currentTask ? `<div><span style="color:var(--win11-text-tertiary);">Current task:</span> <span style="color:var(--win11-accent);">${escapeHtml(currentTask.substring(0, 24))}</span></div>` : ''}
          ${lastSeen ? `<div><span style="color:var(--win11-text-tertiary);">Last seen:</span> ${new Date(lastSeen).toLocaleString()}</div>` : ''}
        </div>

        ${caps.length > 0 ? `<div style="margin-bottom:14px;">${caps.map(c => `<span class="av-cap-badge" style="font-size:0.72rem;padding:2px 8px;">${escapeHtml(c)}</span>`).join(' ')}</div>` : ''}

        ${queue && queue.total > 0 ? `
          <div style="background:var(--win11-surface-active);border-radius:6px;padding:8px 10px;margin-bottom:14px;font-size:0.78rem;">
            <strong style="color:var(--win11-text);">Queue:</strong>
            <span style="color:var(--win11-accent);">${queue.ready || 0} ready</span> ·
            <span style="color:#f97316;">${queue.inProgress || 0} in progress</span> ·
            <span style="color:#22c55e;">${queue.completed || 0} done</span> ·
            <span>${queue.blocked || 0} blocked</span>
            <div class="av-queue-bar" style="margin-top:6px;"><div class="av-queue-fill" style="width:${queue.total > 0 ? Math.round(((queue.completed || 0) / queue.total) * 100) : 0}%;background:var(--win11-accent);"></div></div>
          </div>
        ` : ''}

        <!-- Assign Task Form -->
        <div style="border-top:1px solid var(--win11-border);padding-top:12px;">
          <h4 style="margin:0 0 8px;color:var(--win11-text);font-size:0.9rem;font-weight:600;">Assign Task to ${escapeHtml(name)}</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
            <div style="grid-column:1/-1;">
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Task title *</label>
              <input class="av-input" type="text" id="avTaskTitle" placeholder="What should this agent do?" />
            </div>
            <div style="grid-column:1/-1;">
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Description</label>
              <textarea class="av-textarea" id="avTaskDesc" rows="2" placeholder="Context, constraints, success criteria..."></textarea>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Project</label>
              <select class="av-select" id="avTaskProject">
                <option value="">Select project...</option>
                ${projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Priority</label>
              <select class="av-select" id="avTaskPriority">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Category</label>
              <input class="av-input" type="text" id="avTaskCategory" placeholder="General" />
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Status</label>
              <select class="av-select" id="avTaskStatus">
                <option value="backlog">Backlog</option>
                <option value="ready" selected>Ready</option>
                <option value="in_progress">In progress</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
            <button id="avAssignBtn" class="av-action-btn primary">Assign Task</button>
            <button id="avQuickAssignBtn" class="av-action-btn" title="Create and queue immediately" style="font-size:0.75rem;">⚡ Quick Queue</button>
            <div style="flex:1;"></div>
            <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">Press Enter to assign</span>
          </div>
          <div id="avNotice" class="av-notice"></div>
        </div>
      </div>
  `;

    // Close detail
    const closeBtn = panel.querySelector('#avCloseDetail');
    const closeH = () => { selectedAgentId = null; renderGrid(); renderDetail(); };
    closeBtn.addEventListener('click', closeH);
    cleanupFns.push(() => closeBtn.removeEventListener('click', closeH));

    // Enter to submit
    const titleInput = panel.querySelector('#avTaskTitle');
    const enterH = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAssign('ready'); } };
    titleInput.addEventListener('keydown', enterH);
    cleanupFns.push(() => titleInput.removeEventListener('keydown', enterH));

    // Assign button
    const assignBtn = panel.querySelector('#avAssignBtn');
    assignBtn.addEventListener('click', () => handleAssign());
    cleanupFns.push(() => assignBtn.removeEventListener('click', () => handleAssign()));

    // Quick queue button
    const quickBtn = panel.querySelector('#avQuickAssignBtn');
    quickBtn.addEventListener('click', () => handleAssign('in_progress'));
    cleanupFns.push(() => quickBtn.removeEventListener('click', () => handleAssign('in_progress')));
  }

  async function handleAssign(forcedStatus) {
    const title = root.querySelector('#avTaskTitle')?.value?.trim();
    if (!title) {
      showNotice('Please enter a task title.', 'error');
      root.querySelector('#avTaskTitle')?.focus();
      return;
    }

    const agent = agents.find(a => (a.id || a.agentId || a.name) === selectedAgentId);
    if (!agent) return;

    const projectId = root.querySelector('#avTaskProject')?.value;
    if (!projectId) {
      showNotice('Please select a project.', 'error');
      return;
    }

    const agentName = agent.displayName || agent.name || agent.id;

    try {
      const taskData = {
        project_id: projectId,
        title,
        text: title,
        description: root.querySelector('#avTaskDesc')?.value?.trim() || '',
        owner: agentName,
        priority: root.querySelector('#avTaskPriority')?.value || 'medium',
        category: root.querySelector('#avTaskCategory')?.value?.trim() || 'General',
        labels: [root.querySelector('#avTaskCategory')?.value?.trim() || 'General'],
        status: forcedStatus || root.querySelector('#avTaskStatus')?.value || 'ready',
        metadata: agent.defaultModel ? { openclaw: { preferred_model: agent.defaultModel } } : {},
      };

      await api.tasks.create(taskData);

      showNotice(`Task assigned to ${agentName} successfully.`, 'success');

      // Clear form
      root.querySelector('#avTaskTitle').value = '';
      root.querySelector('#avTaskDesc').value = '';
      root.querySelector('#avTaskCategory').value = '';
      root.querySelector('#avTaskStatus').value = 'ready';

      // Refresh agent data to update queue counts
      loadAgents();
    } catch (err) {
      showNotice(`Failed to assign: ${err.message}`, 'error');
    }
  }

  // Event wiring
  let searchTimer = null;
  root.querySelector('#avSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderGrid(), 150);
  });
  root.querySelector('#avDeptFilter')?.addEventListener('change', () => renderGrid());
  root.querySelector('#avRefreshBtn')?.addEventListener('click', () => loadAgents());

  // === Sync subscription ===
  if (sync) {
    syncUnsubscribe = sync.subscribe(async (data, changedKeys) => {
      // Refresh if gateway agents changed
      if (changedKeys.includes('gatewayAgents') || changedKeys.includes('stats')) {
        await loadAgents();
        // Refresh blocker stats if blockers changed
        if (changedKeys.includes('blockersSummary')) {
          const blockersResult = await api.blockers.list();
          const blockersRaw = blockersResult.status === 'fulfilled' ? blockersResult.value : {};
          const blockers = Array.isArray(blockersRaw.blockers) ? blockersRaw.blockers : Array.isArray(blockersRaw) ? blockersRaw : [];
          renderStats(blockers);
        }
      }
    });
  }

  // Init
  await Promise.all([loadAgents(), loadProjects()]);

  return () => { 
    if (syncUnsubscribe) {
      syncUnsubscribe();
      syncUnsubscribe = null;
    }
    cleanupFns.forEach(fn => fn()); 
    cleanupFns = []; 
  };
}

export default renderAgentsView;
