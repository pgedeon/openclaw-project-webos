import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderSkillsToolsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'skills-tools-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let catalog = null;
  let projects = [];
  let agents = [];
  let selectedSkillId = null;
  let cleanupFns = [];
  let noticeTimer = null;
  let searchQuery = '';
  let skillFilter = 'all';
  let syncUnsubscribe = null;

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    .stv-card { cursor:pointer; transition:border-color 0.15s, box-shadow 0.15s; }
    .stv-card:hover { border-color:var(--win11-accent) !important; box-shadow:0 0 0 1px var(--win11-accent); }
    .stv-card.selected { border-color:var(--win11-accent) !important; box-shadow:0 0 0 2px var(--win11-accent); }
    .stv-card.stv--ready { border-left:3px solid #22c55e; }
    .stv-card.stv--blocked { border-left:3px solid #eab308; }
    .stv-card.stv--disabled { border-left:3px solid var(--win11-text-tertiary); }
    .stv-card.stv--error { border-left:3px solid #ef4444; }
    .stv-action-btn { font-size:0.78rem; padding:4px 10px; border-radius:5px; border:1px solid var(--win11-border); background:var(--win11-surface-solid); color:var(--win11-text); cursor:pointer; white-space:nowrap; }
    .stv-action-btn:hover { background:var(--win11-surface-active); }
    .stv-action-btn.primary { background:var(--win11-accent); color:#fff; border-color:transparent; }
    .stv-input, .stv-select, .stv-textarea {
      width:100%; padding:5px 8px; border-radius:5px;
      border:1px solid var(--win11-border); background:var(--win11-surface);
      color:var(--win11-text); font-size:0.82rem; outline:none; box-sizing:border-box;
    }
    .stv-input:focus, .stv-select:focus, .stv-textarea:focus { border-color:var(--win11-accent); }
    .stv-textarea { resize:vertical; font-family:inherit; }
    .stv-notice {
      padding:6px 12px; border-radius:6px; font-size:0.82rem; text-align:center;
      background:rgba(96,205,255,0.1); color:var(--win11-accent); border:1px solid rgba(96,205,255,0.2);
      display:none; margin-top:8px;
    }
    .stv-notice.is-visible { display:block; }
    .stv-notice.is-error { background:rgba(239,68,68,0.1); color:#ef4444; border-color:rgba(239,68,68,0.2); }
    .stv-notice.is-success { background:rgba(34,197,94,0.1); color:#22c55e; border-color:rgba(34,197,94,0.2); }
    .stv-badge {
      display:inline-block; font-size:0.68rem; padding:1px 6px; border-radius:3px;
      font-weight:600; text-transform:uppercase; letter-spacing:0.03em;
    }
    .stv-badge--success { background:rgba(34,197,94,0.15); color:#22c55e; }
    .stv-badge--warning { background:rgba(234,179,8,0.15); color:#eab308; }
    .stv-badge--muted { background:rgba(255,255,255,0.06); color:var(--win11-text-tertiary); }
    .stv-badge--error { background:rgba(239,68,68,0.15); color:#ef4444; }
    .stv-badge--info { background:rgba(96,205,255,0.1); color:var(--win11-accent); }
    .stv-tool-chip {
      display:inline-block; font-size:0.68rem; padding:2px 7px; border-radius:3px;
      background:rgba(96,205,255,0.08); color:var(--win11-accent); margin:1px 2px;
    }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div id="stvHeader" style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">🧩 Skills & Tools</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Click a skill to create a task that uses it.</p>
        </div>
        <button id="stvRefreshBtn" class="stv-action-btn">↻ Refresh</button>
      </div>
      <div id="stvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <input id="stvSearch" type="text" placeholder="Search skills, tools, agents..." style="flex:1;min-width:140px;padding:5px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;outline:none;" />
        <select id="stvFilter" style="padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;">
          <option value="all">All skills</option>
          <option value="ready">Ready</option>
          <option value="managed">Managed</option>
          <option value="unavailable">Unavailable</option>
        </select>
        <select id="stvSourceFilter" style="padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;">
          <option value="all">All sources</option>
        </select>
      </div>
    </div>
    <div id="stvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading skills catalog...</div>
    </div>
    <div id="stvDetail" style="display:none;border-top:2px solid var(--win11-border);overflow-y:auto;max-height:55%;flex-shrink:0;"></div>
  `;

  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#stvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `stv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'stv-notice'; }, 4000);
  }

  // Data
  async function loadCatalog() {
    const grid = root.querySelector('#stvGrid');
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading...</div>';
    try {
      const res = await fetch('/api/catalog/skills-tools');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = await res.json();
      updateSourceFilter();
      renderStats();
      renderGrid();
    } catch (e) {
      grid.innerHTML = `<div style="padding:24px;color:#ef4444;">Failed to load catalog: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadProjects() {
    try {
      const res = await api.projects.list();
      projects = Array.isArray(res) ? res : (Array.isArray(res.projects) ? res.projects : []);
    } catch (e) { /* ok */ }
  }

  async function loadAgents() {
    try {
      const res = await api.org.agents.list();
      agents = Array.isArray(res) ? res : [];
    } catch (e) { /* ok */ }
  }

  function getSources() {
    const srcs = new Set();
    for (const s of (catalog?.skills || [])) {
      if (s.source) srcs.add(s.source);
    }
    return [...srcs].sort();
  }

  function updateSourceFilter() {
    const select = root.querySelector('#stvSourceFilter');
    const srcs = getSources();
    select.innerHTML = '<option value="all">All sources</option>' +
      srcs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  function getFilteredSkills() {
    const skills = catalog?.skills || [];
    const srcFilter = root.querySelector('#stvSourceFilter')?.value || 'all';

    return skills.filter(s => {
      if (skillFilter === 'ready' && s.status !== 'ready') return false;
      if (skillFilter === 'managed' && !s.locallyManaged) return false;
      if (skillFilter === 'unavailable' && s.status === 'ready') return false;
      if (srcFilter !== 'all' && s.source !== srcFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return [s.name, s.description, s.source, s.status, ...(s.missingSummary || [])].some(v => String(v || '').toLowerCase().includes(q));
      }
      return true;
    });
  }

  // Rendering
  function renderStats() {
    const summary = catalog?.summary || {};
    root.querySelector('#stvStats').innerHTML = `
      ${createStatCard({ label: 'Skills', value: formatCount(summary.totalSkills || 0) }).outerHTML}
      ${createStatCard({ label: 'Ready', value: formatCount(summary.readySkills || 0), tone: (summary.readySkills || 0) > 0 ? 'success' : 'default' }).outerHTML}
      ${createStatCard({ label: 'Managed', value: formatCount(summary.locallyManagedSkills || 0) }).outerHTML}
      ${createStatCard({ label: 'Tools', value: formatCount(summary.distinctTools || 0) }).outerHTML}
    `;
  }

  function renderGrid() {
    const grid = root.querySelector('#stvGrid');
    const skills = getFilteredSkills();

    if (skills.length === 0) {
      grid.innerHTML = `<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">${searchQuery || skillFilter !== 'all' ? 'No skills match filters.' : 'No skills found.'}</div>`;
      return;
    }

    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
      ${skills.map(s => renderSkillCard(s)).join('')}
    </div>`;

    grid.querySelectorAll('.stv-card').forEach(card => {
      const handler = () => {
        selectedSkillId = card.dataset.skillId === selectedSkillId ? null : card.dataset.skillId;
        renderGrid();
        renderDetail();
      };
      card.addEventListener('click', handler);
      cleanupFns.push(() => card.removeEventListener('click', handler));
    });
  }

  function renderSkillCard(s) {
    const id = s.name || '';
    const isSelected = id === selectedSkillId;
    const status = s.status || 'unknown';
    const desc = s.description || '';
    const source = s.source || '';
    const isReady = status === 'ready';
    const emoji = s.emoji || '🧩';
    const isManaged = s.locallyManaged;
    const isBundled = s.bundled;
    const primaryEnv = s.primaryEnv || '';

    const truncatedDesc = desc.length > 100 ? desc.substring(0, 100) + '…' : desc;
    const statusBadge = status === 'ready' ? '<span class="stv-badge stv-badge--success">Ready</span>'
      : status === 'blocked' ? '<span class="stv-badge stv-badge--warning">Blocked</span>'
      : status === 'disabled' ? '<span class="stv-badge stv-badge--muted">Disabled</span>'
      : `<span class="stv-badge stv-badge--error">${escapeHtml(status)}</span>`;

    return `<div class="stv-card stv-card stv--${status}${isSelected ? ' selected' : ''}" data-skill-id="${escapeHtml(id)}" style="
      background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:12px;
      border-left:3px solid ${isReady ? '#22c55e' : status === 'blocked' ? '#eab308' : 'var(--win11-text-tertiary)'};
    ">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(id)}">${escapeHtml(emoji)} ${escapeHtml(id)}</div>
          ${truncatedDesc ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:3px;line-height:1.3;">${escapeHtml(truncatedDesc)}</div>` : ''}
        </div>
        <div style="flex-shrink:0;">${statusBadge}</div>
      </div>
      <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">
        ${isManaged ? '<span class="stv-badge stv-badge--info">Local</span>' : ''}
        ${isBundled ? '<span class="stv-badge stv-badge--muted">Bundled</span>' : ''}
        ${primaryEnv ? `<span class="stv-badge stv-badge--muted" style="font-size:0.64rem;">${escapeHtml(primaryEnv)}</span>` : ''}
        <span style="font-size:0.68rem;color:var(--win11-text-tertiary);margin-left:auto;">${escapeHtml(source)}</span>
      </div>
    </div>`;
  }

  function renderDetail() {
    const panel = root.querySelector('#stvDetail');
    if (!selectedSkillId) { panel.style.display = 'none'; return; }

    const skill = (catalog?.skills || []).find(s => s.name === selectedSkillId);
    if (!skill) { panel.style.display = 'none'; selectedSkillId = null; return; }

    panel.style.display = 'block';

    const id = skill.name;
    const desc = skill.description || '';
    const status = skill.status || 'unknown';
    const source = skill.source || '';
    const emoji = skill.emoji || '🧩';
    const homepage = skill.homepage || '';
    const isReady = status === 'ready';
    const missing = skill.missingSummary || [];
    const primaryEnv = skill.primaryEnv || '';

    // Find tools related to this skill
    const relatedTools = (catalog?.tools || []).filter(t => t.name.includes(id.replace(/-/g, '')));

    // Find agents that have tools related to this skill
    const relatedAgents = (catalog?.agents || []).filter(a =>
      a.allowedTools?.some(t => t.includes(id.replace(/-/g, '')) || t.includes(id))
    );

    panel.innerHTML = `
      <div style="padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px;">
          <div style="min-width:0;flex:1;">
            <h3 style="margin:0 0 4px;color:var(--win11-text);font-size:1rem;font-weight:600;word-break:break-word;">${escapeHtml(emoji)} ${escapeHtml(id)}</h3>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
              <span class="stv-badge stv-badge--${isReady ? 'success' : status === 'blocked' ? 'warning' : 'muted'}">${escapeHtml(status)}</span>
              <span class="stv-badge stv-badge--info">${escapeHtml(source)}</span>
              ${skill.locallyManaged ? '<span class="stv-badge stv-badge--info">Local</span>' : ''}
              ${skill.bundled ? '<span class="stv-badge stv-badge--muted">Bundled</span>' : ''}
              ${primaryEnv ? `<span class="stv-badge stv-badge--muted">${escapeHtml(primaryEnv)}</span>` : ''}
            </div>
          </div>
          <button id="stvCloseDetail" style="background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;padding:2px 6px;" title="Close">✕</button>
        </div>

        ${desc ? `<div style="color:var(--win11-text-secondary);font-size:0.83rem;margin-bottom:12px;line-height:1.4;">${escapeHtml(desc)}</div>` : ''}
        ${homepage ? `<div style="font-size:0.78rem;margin-bottom:12px;"><a href="${escapeHtml(homepage)}" target="_blank" rel="noopener" style="color:var(--win11-accent);">${escapeHtml(homepage)}</a></div>` : ''}

        ${missing.length > 0 ? `<div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:0.78rem;color:#eab308;">
          <strong>Missing:</strong> ${missing.map(m => escapeHtml(m)).join(' · ')}
        </div>` : ''}

        ${relatedTools.length > 0 ? `<div style="margin-bottom:12px;">
          <div style="font-size:0.78rem;color:var(--win11-text-tertiary);margin-bottom:4px;">Related tools:</div>
          ${relatedTools.map(t => `<span class="stv-tool-chip" title="${escapeHtml(t.description || '')}">${escapeHtml(t.label || t.name)}</span>`).join('')}
        </div>` : ''}

        ${relatedAgents.length > 0 ? `<div style="margin-bottom:12px;">
          <div style="font-size:0.78rem;color:var(--win11-text-tertiary);margin-bottom:4px;">Agents with access:</div>
          ${relatedAgents.slice(0, 8).map(a => `<span class="stv-tool-chip">${escapeHtml(a.name || a.id)}</span>`).join('')}${relatedAgents.length > 8 ? `<span class="stv-tool-chip">+${relatedAgents.length - 8}</span>` : ''}
        </div>` : ''}

        <!-- Task Creation Form -->
        <div style="border-top:1px solid var(--win11-border);padding-top:12px;">
          <h4 style="margin:0 0 8px;color:var(--win11-text);font-size:0.9rem;font-weight:600;">Create Task Using ${escapeHtml(id)}</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
            <div style="grid-column:1/-1;">
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Task title *</label>
              <input class="stv-input" type="text" id="stvTaskTitle" placeholder="What should be done with this skill?" />
            </div>
            <div style="grid-column:1/-1;">
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Description</label>
              <textarea class="stv-textarea" id="stvTaskDesc" rows="2" placeholder="Detailed instructions for the agent...">${escapeHtml(desc.substring(0, 200))}</textarea>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Project</label>
              <select class="stv-select" id="stvTaskProject">
                <option value="">Select project...</option>
                ${projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Assign to agent</label>
              <select class="stv-select" id="stvTaskAgent">
                <option value="">Unassigned</option>
                ${agents.slice(0, 30).map(a => {
                  const name = a.displayName || a.name || a.id;
                  const isActive = ['active', 'running', 'online'].includes(a.status || a.presence || '');
                  return `<option value="${escapeHtml(name)}"${isActive ? ' selected' : ''}>${escapeHtml(name)}${isActive ? ' ●' : ''}</option>`;
                }).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Priority</label>
              <select class="stv-select" id="stvTaskPriority">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Category</label>
              <input class="stv-input" type="text" id="stvTaskCategory" value="${escapeHtml(id)}" />
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;">
            <button id="stvCreateBtn" class="stv-action-btn primary">Create Task</button>
            <button id="stvQuickBtn" class="stv-action-btn" title="Create as ready and assign immediately" style="font-size:0.75rem;">⚡ Quick Queue</button>
            <div style="flex:1;"></div>
            <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">Enter to create</span>
          </div>
          <div id="stvNotice" class="stv-notice"></div>
        </div>
      </div>
    `;

    // Close
    const closeBtn = panel.querySelector('#stvCloseDetail');
    const closeH = () => { selectedSkillId = null; renderGrid(); renderDetail(); };
    closeBtn.addEventListener('click', closeH);
    cleanupFns.push(() => closeBtn.removeEventListener('click', closeH));

    // Enter to submit
    const titleInput = panel.querySelector('#stvTaskTitle');
    const enterH = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreate('ready'); } };
    titleInput.addEventListener('keydown', enterH);
    cleanupFns.push(() => titleInput.removeEventListener('keydown', enterH));

    // Create button
    panel.querySelector('#stvCreateBtn')?.addEventListener('click', () => handleCreate());
    cleanupFns.push(() => panel.querySelector('#stvCreateBtn')?.removeEventListener('click', () => handleCreate()));

    // Quick queue
    panel.querySelector('#stvQuickBtn')?.addEventListener('click', () => handleCreate('in_progress'));
    cleanupFns.push(() => panel.querySelector('#stvQuickBtn')?.removeEventListener('click', () => handleCreate('in_progress')));
  }

  async function handleCreate(forcedStatus) {
    const title = root.querySelector('#stvTaskTitle')?.value?.trim();
    if (!title) { showNotice('Please enter a task title.', 'error'); root.querySelector('#stvTaskTitle')?.focus(); return; }

    const projectId = root.querySelector('#stvTaskProject')?.value;
    if (!projectId) { showNotice('Please select a project.', 'error'); return; }

    const skillId = selectedSkillId;
    const agentName = root.querySelector('#stvTaskAgent')?.value || '';

    // Prepend skill reference to description
    const desc = root.querySelector('#stvTaskDesc')?.value?.trim() || '';
    const skillRef = `[Skill: ${skillId}]\n\n`;
    const fullDesc = desc.includes(skillId) ? desc : skillRef + desc;

    try {
      await api.tasks.create({
        project_id: projectId,
        title,
        text: title,
        description: fullDesc,
        owner: agentName || null,
        priority: root.querySelector('#stvTaskPriority')?.value || 'medium',
        category: root.querySelector('#stvTaskCategory')?.value?.trim() || skillId,
        labels: [skillId, root.querySelector('#stvTaskCategory')?.value?.trim() || skillId],
        status: forcedStatus || 'backlog',
      });

      showNotice(`Task created with skill "${skillId}"${agentName ? ` → ${agentName}` : ''}.`, 'success');

      root.querySelector('#stvTaskTitle').value = '';
      root.querySelector('#stvTaskDesc').value = skillRef;
    } catch (err) {
      showNotice(`Failed: ${err.message}`, 'error');
    }
  }

  // Events
  let searchTimer = null;
  root.querySelector('#stvSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = e.target.value.trim(); renderGrid(); }, 150);
  });
  root.querySelector('#stvFilter')?.addEventListener('change', (e) => { skillFilter = e.target.value; renderGrid(); });
  root.querySelector('#stvSourceFilter')?.addEventListener('change', () => renderGrid());
  root.querySelector('#stvRefreshBtn')?.addEventListener('click', () => loadCatalog());

  // === Sync subscription ===
  // Note: catalog data is fetched directly from /api/catalog/skills-tools
  // We could add catalog to sync in the future for auto-refresh
  if (sync) {
    // For now, just re-render on any sync to refresh display if needed
    syncUnsubscribe = sync.subscribe((data, changedKeys) => {
      // Re-render if we want to sync anything in the future
      // Currently skills-tools fetches directly from catalog endpoint
    });
  }

  // Init
  await Promise.all([loadCatalog(), loadProjects(), loadAgents()]);

  return () => { 
    if (syncUnsubscribe) {
      syncUnsubscribe();
      syncUnsubscribe = null;
    }
    cleanupFns.forEach(fn => fn()); 
    cleanupFns = []; 
  };
}

export default renderSkillsToolsView;
