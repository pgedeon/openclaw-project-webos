/**
 * Spaces View — reimplemented with Desktop Layouts + Agent Rooms + Project Assignment
 *
 * Each Space is a full context: its own windows, agent config, projects.
 * Switching spaces = switching your entire working environment.
 */

const COLORS = ['#0078d4', '#107c10', '#c239b3', '#e74856', '#ffb900', '#00b7c3', '#8764b8', '#00cc6a'];
const ICONS = ['📁', '🏠', '💼', '🚀', '🎯', '📊', '🔧', '🎨', '📦', '⚡'];

const CSS = `
.spc-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 0.85rem; }
.spc-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
.spc-title { font-size: 1.1rem; font-weight: 600; }
.spc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; padding: 16px; overflow-y: auto; flex: 1; }

/* Cards */
.spc-card { border: 1px solid var(--win11-border); border-radius: 8px; padding: 16px; cursor: pointer; transition: all .15s; position: relative; }
.spc-card:hover { border-color: var(--win11-accent); box-shadow: 0 2px 8px rgba(0,0,0,.1); }
.spc-card.active { border-color: var(--win11-accent); background: color-mix(in srgb, var(--win11-accent) 8%, transparent); }
.spc-card-icon { font-size: 2rem; margin-bottom: 8px; }
.spc-card-name { font-weight: 600; margin-bottom: 4px; }
.spc-card-desc { font-size: 0.78rem; color: var(--win11-text-secondary); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spc-card-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: var(--win11-accent); color: #fff; display: inline-block; }
.spc-card-stats { display: flex; gap: 12px; font-size: 0.72rem; color: var(--win11-text-tertiary); margin-top: 4px; }
.spc-card-stats span { display: flex; align-items: center; gap: 3px; }
.spc-card-actions { display: flex; gap: 6px; margin-top: 10px; }

/* Buttons */
.spc-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--win11-border); background: var(--win11-surface-solid); cursor: pointer; font-size: 0.75rem; }
.spc-btn:hover { background: var(--win11-surface-hover); }
.spc-btn-primary { background: var(--win11-accent); color: #fff; border-color: var(--win11-accent); }
.spc-btn-danger { color: #e74856; border-color: #e74856; }
.spc-btn-danger:hover { background: #e7485620; }
.spc-btn-switch { color: #0078d4; border-color: #0078d4; }
.spc-btn-switch:hover { background: #0078d420; }
.spc-add { border: 2px dashed var(--win11-border); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 120px; opacity: .6; }
.spc-add:hover { opacity: 1; border-color: var(--win11-accent); }

/* Modal — wider for settings tabs */
.spc-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.4); }
.spc-modal-inner { background: var(--win11-surface-solid); border-radius: 8px; padding: 24px; width: 560px; max-width: 92vw; max-height: 85vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,.3); }
.spc-modal h3 { margin: 0 0 16px; font-size: 1.05rem; }

/* Tabs */
.spc-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--win11-border); margin-bottom: 16px; }
.spc-tab { padding: 8px 16px; font-size: 0.82rem; cursor: pointer; border-bottom: 2px solid transparent; color: var(--win11-text-secondary); background: none; border-top: none; border-left: none; border-right: none; }
.spc-tab:hover { color: var(--win11-text); }
.spc-tab.active { color: var(--win11-accent); border-bottom-color: var(--win11-accent); font-weight: 600; }
.spc-tab-content { display: none; }
.spc-tab-content.active { display: block; }

/* Form fields */
.spc-field { margin-bottom: 12px; }
.spc-field label { display: block; font-size: 0.78rem; color: var(--win11-text-secondary); margin-bottom: 4px; }
.spc-field input, .spc-field textarea, .spc-field select { width: 100%; padding: 6px 10px; border: 1px solid var(--win11-border); border-radius: 4px; font-size: 0.85rem; background: var(--win11-surface-solid); color: var(--win11-text-primary); box-sizing: border-box; }
.spc-field textarea { resize: vertical; min-height: 60px; }
.spc-field .spc-hint { font-size: 0.72rem; color: var(--win11-text-tertiary); margin-top: 3px; }

/* Icon/Color pickers */
.spc-icon-picker { display: flex; gap: 6px; flex-wrap: wrap; }
.spc-icon-pick { font-size: 1.4rem; padding: 4px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
.spc-icon-pick.selected { border-color: var(--win11-accent); background: color-mix(in srgb, var(--win11-accent) 15%, transparent); }
.spc-color-picker { display: flex; gap: 6px; }
.spc-color-swatch { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
.spc-color-swatch.selected { border-color: var(--win11-text-primary); transform: scale(1.2); }

/* Project list */
.spc-project-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--win11-border); border-radius: 4px; padding: 8px; }
.spc-project-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 0.82rem; }
.spc-project-item input[type=checkbox] { accent-color: var(--win11-accent); }
.spc-project-item .spc-proj-status { font-size: 0.7rem; padding: 1px 6px; border-radius: 8px; }
.spc-project-item .spc-proj-status.active { background: #107c1020; color: #107c10; }
.spc-project-item .spc-proj-status.archived { background: #88888820; color: #888; }

/* Pinned apps */
.spc-app-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.spc-app-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--win11-border); border-radius: 6px; cursor: pointer; font-size: 0.78rem; transition: all .15s; }
.spc-app-item:hover { border-color: var(--win11-accent); }
.spc-app-item.selected { border-color: var(--win11-accent); background: color-mix(in srgb, var(--win11-accent) 10%, transparent); }
.spc-app-item .spc-app-icon { font-size: 1.1rem; }

/* Toggle switch */
.spc-toggle { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.spc-toggle input[type=checkbox] { accent-color: var(--win11-accent); width: 16px; height: 16px; }
.spc-toggle label { font-size: 0.82rem; cursor: pointer; }

/* Modal actions */
.spc-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.spc-notice { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 6px; font-size: 0.82rem; z-index: 10000; transition: opacity .3s; }
.spc-notice.success { background: #107c10; color: #fff; }
.spc-notice.error { background: #e74856; color: #fff; }
`;

function showNotice(msg, type = 'success') {
  const n = document.createElement('div');
  n.className = `spc-notice ${type}`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 3000);
}

/**
 * Modal with tab support. Returns a promise resolving to the form data.
 * tabs = [{ id, label, html }]
 */
function showTabbedModal(title, tabs, { width } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'spc-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const tabBtns = tabs.map((t, i) =>
      `<button class="spc-tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`
    ).join('');

    const tabContents = tabs.map((t, i) =>
      `<div class="spc-tab-content${i === 0 ? ' active' : ''}" data-tab-content="${t.id}">${t.html}</div>`
    ).join('');

    overlay.innerHTML = `<div class="spc-modal-inner" style="${width ? `width:${width}px` : ''}">
      <h3>${title}</h3>
      <div class="spc-tabs">${tabBtns}</div>
      ${tabContents}
      <div class="spc-modal-actions">
        <button class="spc-btn" data-cancel>Cancel</button>
        <button class="spc-btn spc-btn-primary" data-confirm>Save</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    const inner = overlay.querySelector('.spc-modal-inner');

    // Tab switching
    inner.querySelectorAll('.spc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        inner.querySelectorAll('.spc-tab').forEach(t => t.classList.remove('active'));
        inner.querySelectorAll('.spc-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        inner.querySelector(`[data-tab-content="${tab.dataset.tab}"]`)?.classList.add('active');
      });
    });

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    inner.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    inner.querySelector('[data-confirm]')?.addEventListener('click', () => {
      // Collect all form data from all tabs
      const form = {};
      inner.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.type === 'checkbox') {
          form[el.name] = el.checked;
        } else {
          form[el.name] = el.value;
        }
      });
      form._selectedIcon = inner.querySelector('.spc-icon-pick.selected')?.textContent || '📁';
      form._selectedColor = inner.querySelector('.spc-color-swatch.selected')?.dataset.color || '#0078d4';
      form._selectedApps = Array.from(inner.querySelectorAll('.spc-app-item.selected')).map(el => el.dataset.appId);
      form._checkedProjects = Array.from(inner.querySelectorAll('input[name^="project_"]:checked')).map(cb => cb.name.replace('project_', ''));
      close(form);
    });

    // Icon picker clicks
    inner.querySelectorAll('.spc-icon-pick').forEach(el => {
      el.addEventListener('click', () => {
        inner.querySelectorAll('.spc-icon-pick').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    // Color picker clicks
    inner.querySelectorAll('.spc-color-swatch').forEach(el => {
      el.addEventListener('click', () => {
        inner.querySelectorAll('.spc-color-swatch').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    // App grid toggle clicks
    inner.querySelectorAll('.spc-app-item').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('selected'));
    });

    const first = inner.querySelector('input, textarea, button');
    first?.focus();
  });
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Known apps for pinned-app selection
const KNOWN_APPS = [
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'board', label: 'Board', icon: '📊' },
  { id: 'agents', label: 'Agents', icon: '🤖' },
  { id: 'workflows', label: 'Workflows', icon: '⚡' },
  { id: 'operations', label: 'Operations', icon: '🔧' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
  { id: 'history', label: 'History', icon: '📜' },
  { id: 'explorer', label: 'Explorer', icon: '📂' },
  { id: 'spaces', label: 'Spaces', icon: '📁' },
  { id: 'skills-tools', label: 'Skills & Tools', icon: '🛠' },
  { id: 'notifications', label: 'Notifications', icon: '🔔' },
  { id: 'dashboard', label: 'Dashboard', icon: '📈' },
];

export async function renderSpacesView({ mountNode, api, adapter, stateStore, sync }) {
  let spaces = [];

  mountNode.innerHTML = `<style>${CSS}</style><div class="spc-container"><div style="text-align:center;padding:40px;">Loading spaces…</div></div>`;
  const container = mountNode.querySelector('.spc-container');

  function getActiveSpaceId() {
    return stateStore?.getState?.('activeSpaceId') || null;
  }

  function setActiveSpace(space) {
    // Before switching, save current desktop layout to the old space
    saveCurrentDesktopLayout();
    stateStore?.setState?.('activeSpaceId', space.id);
    globalThis.dispatchEvent(new CustomEvent('space:changed', { detail: { space } }));
  }

  /** Save the current window layout into the active space's settings */
  function saveCurrentDesktopLayout() {
    try {
      const activeId = getActiveSpaceId();
      if (!activeId) return;
      const wm = window.__OPENCLAW_WIN11_SHELL__?.windowManager;
      if (!wm) return;
      const layout = wm.getWindowLayout?.() || wm._getPersistData?.();
      if (!layout) return;
      const space = spaces.find(s => s.id === activeId);
      if (!space) return;
      const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : (space.settings || {});
      settings.desktop = { ...settings.desktop, layout };
      // Fire and forget — don't block switching
      api.spaces.update(activeId, { settings }).catch(() => {});
    } catch {}
  }

  /** Restore a space's saved desktop layout */
  function restoreDesktopLayout(space) {
    try {
      const settings = typeof space.settings === 'string' ? JSON.parse(space.settings) : (space.settings || {});
      const layout = settings.desktop?.layout;
      if (!layout) return;
      const wm = window.__OPENCLAW_WIN11_SHELL__?.windowManager;
      if (!wm?.restoreLayout) return;
      wm.restoreLayout(layout);
    } catch {}
  }

  async function load() {
    try {
      const result = await api.spaces.list();
      spaces = result.spaces || [];
      const stats = await Promise.allSettled(
        spaces.map(s => api.spaces.stats(s.id).catch(() => null))
      );
      spaces.forEach((s, i) => {
        if (stats[i]?.status === 'fulfilled' && stats[i]?.value) {
          s._projectCount = stats[i].value.projects;
          s._taskCount = stats[i].value.tasks;
        }
      });
    } catch { spaces = []; }
    render();
  }

  function render() {
    container.innerHTML = '';
    const activeId = getActiveSpaceId();

    const header = document.createElement('div');
    header.className = 'spc-header';
    header.innerHTML = `
      <div class="spc-title">📁 Spaces</div>
      <button class="spc-btn spc-btn-primary" id="spc-create-btn">+ New Space</button>
    `;
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'spc-grid';

    spaces.forEach(space => {
      const card = document.createElement('div');
      card.className = 'spc-card';
      if (space.id === activeId) card.classList.add('active');

      const iconEl = document.createElement('div');
      iconEl.className = 'spc-card-icon';
      iconEl.textContent = space.icon || '📁';

      const nameEl = document.createElement('div');
      nameEl.className = 'spc-card-name';
      nameEl.textContent = space.name;

      const descEl = document.createElement('div');
      descEl.className = 'spc-card-desc';
      descEl.textContent = space.description || space.slug;
      card.appendChild(iconEl);
      card.appendChild(nameEl);
      card.appendChild(descEl);

      if (space.is_default) {
        const badge = document.createElement('span');
        badge.className = 'spc-card-badge';
        badge.textContent = 'Default';
        card.appendChild(badge);
      }

      // Show agent config indicator
      const settings = typeof space.settings === 'string' ? JSON.parse(space.settings || '{}') : (space.settings || {});
      const agentCfg = settings.agent || {};
      const desktopCfg = settings.desktop || {};
      const indicators = [];
      if (agentCfg.defaultModel) indicators.push('🤖');
      if (desktopCfg.pinnedApps?.length) indicators.push('📌');
      if (agentCfg.systemPrompt) indicators.push('💬');

      const statsEl = document.createElement('div');
      statsEl.className = 'spc-card-stats';
      statsEl.innerHTML = `<span>📁 ${space._projectCount ?? '?'} projects</span><span>✅ ${space._taskCount ?? '?'} tasks</span>${indicators.length ? `<span>${indicators.join(' ')}</span>` : ''}`;
      card.appendChild(statsEl);

      const actions = document.createElement('div');
      actions.className = 'spc-card-actions';
      const isActive = space.id === activeId;

      if (!isActive) {
        const switchBtn = document.createElement('button');
        switchBtn.className = 'spc-btn spc-btn-switch';
        switchBtn.textContent = 'Switch';
        switchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveSpace(space);
          restoreDesktopLayout(space);
          showNotice(`Switched to ${space.name}`);
          render();
        });
        actions.appendChild(switchBtn);
      } else {
        const activeBtn = document.createElement('button');
        activeBtn.className = 'spc-btn';
        activeBtn.textContent = '✓ Active';
        activeBtn.disabled = true;
        actions.appendChild(activeBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.className = 'spc-btn';
      editBtn.textContent = 'Settings';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); handleEdit(space.id); });
      actions.appendChild(editBtn);

      const dupBtn = document.createElement('button');
      dupBtn.className = 'spc-btn';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDuplicate(space.id); });
      actions.appendChild(dupBtn);

      if (!space.is_default) {
        const delBtn = document.createElement('button');
        delBtn.className = 'spc-btn spc-btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete(space.id); });
        actions.appendChild(delBtn);
      }
      card.appendChild(actions);

      if (!isActive) {
        card.addEventListener('click', () => {
          setActiveSpace(space);
          restoreDesktopLayout(space);
          showNotice(`Switched to ${space.name}`);
          render();
        });
      }
      grid.appendChild(card);
    });

    const addCard = document.createElement('div');
    addCard.className = 'spc-card spc-add';
    addCard.innerHTML = '<div style="font-size:2rem">+</div><div>New Space</div>';
    addCard.addEventListener('click', handleCreate);
    grid.appendChild(addCard);

    container.appendChild(grid);
    header.querySelector('#spc-create-btn')?.addEventListener('click', handleCreate);
  }

  // ── Tab builders ──

  function buildGeneralTab(space) {
    return `
      <div class="spc-field"><label>Name</label><input name="name" value="${esc(space.name)}" maxlength="120"></div>
      <div class="spc-field"><label>Description</label><textarea name="description" maxlength="1000">${esc(space.description || '')}</textarea></div>
      <div class="spc-field"><label>Icon</label><div class="spc-icon-picker">${ICONS.map(i => `<span class="spc-icon-pick${i === (space.icon || '📁') ? ' selected' : ''}">${i}</span>`).join('')}</div></div>
      <div class="spc-field"><label>Color</label><div class="spc-color-picker">${COLORS.map(c => `<span class="spc-color-swatch${c === (space.color || '#0078d4') ? ' selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div></div>
    `;
  }

  function buildProjectsTab(allProjects, currentProjectIds) {
    if (!allProjects.length) {
      return '<div style="color:var(--win11-text-tertiary);font-size:0.82rem;padding:12px 0;">No projects found</div>';
    }
    const items = allProjects.map(p => `
      <label class="spc-project-item">
        <input type="checkbox" name="project_${p.id}" ${currentProjectIds.has(p.id) ? 'checked' : ''}>
        <span>${esc(p.name)}</span>
        <span class="spc-proj-status ${p.status || 'active'}">${p.status || 'active'}</span>
      </label>
    `).join('');
    return `<div class="spc-project-list">${items}</div>
      <div class="spc-hint">${allProjects.length} projects available, ${currentProjectIds.size} currently assigned</div>`;
  }

  function buildDesktopTab(space) {
    const settings = typeof space.settings === 'string' ? JSON.parse(space.settings || '{}') : (space.settings || {});
    const desktop = settings.desktop || {};
    const pinnedApps = desktop.pinnedApps || [];

    const appGrid = KNOWN_APPS.map(app => {
      const sel = pinnedApps.includes(app.id) ? ' selected' : '';
      return `<div class="spc-app-item${sel}" data-app-id="${app.id}">
        <span class="spc-app-icon">${app.icon}</span>
        <span>${esc(app.label)}</span>
      </div>`;
    }).join('');

    return `
      <div class="spc-field">
        <label>Pinned Apps (shown on taskbar when this space is active)</label>
        <div class="spc-app-grid">${appGrid}</div>
        <div class="spc-hint">Click to toggle. These apps appear in the taskbar quick-launch for this space.</div>
      </div>
      <div class="spc-toggle">
        <input type="checkbox" id="spc-restore-layout" name="restoreLayout" ${desktop.restoreLayout !== false ? 'checked' : ''}>
        <label for="spc-restore-layout">Restore window layout when switching to this space</label>
      </div>
      <div class="spc-toggle">
        <input type="checkbox" id="spc-save-layout" name="saveLayout" ${desktop.saveLayout !== false ? 'checked' : ''}>
        <label for="spc-save-layout">Auto-save window layout when switching away</label>
      </div>
      <div class="spc-field">
        <label>Home view (opens by default when entering this space)</label>
        <select name="homeView">
          <option value="">None (keep current)</option>
          ${KNOWN_APPS.map(a => `<option value="${a.id}"${desktop.homeView === a.id ? ' selected' : ''}>${a.icon} ${esc(a.label)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  function buildAgentTab(space) {
    const settings = typeof space.settings === 'string' ? JSON.parse(space.settings || '{}') : (space.settings || {});
    const agent = settings.agent || {};

    return `
      <div class="spc-field">
        <label>Default AI Model</label>
        <input name="agentModel" value="${esc(agent.defaultModel || '')}" placeholder="e.g. openrouter/anthropic/claude-sonnet-4">
        <div class="spc-hint">The model used by the agent when this space is active. Leave empty for system default.</div>
      </div>
      <div class="spc-field">
        <label>System Prompt</label>
        <textarea name="agentSystemPrompt" rows="4" placeholder="You are helping with...">${esc(agent.systemPrompt || '')}</textarea>
        <div class="spc-hint">Custom instructions for the AI agent in this space. It knows the context and behaves accordingly.</div>
      </div>
      <div class="spc-field">
        <label>Agent Name</label>
        <input name="agentName" value="${esc(agent.name || '')}" placeholder="e.g. Code Assistant, Life Planner">
        <div class="spc-hint">Optional display name for the agent in this space.</div>
      </div>
      <div class="spc-toggle">
        <input type="checkbox" id="spc-agent-memory" name="agentMemoryScope" ${agent.memoryScope === 'workspace' ? 'checked' : ''}>
        <label for="spc-agent-memory">Restrict agent memory to this space only</label>
      </div>
      <div class="spc-toggle">
        <input type="checkbox" id="spc-agent-autonomous" name="agentAutonomous" ${agent.autonomous === true ? 'checked' : ''}>
        <label for="spc-agent-autonomous">Allow autonomous actions (workflows, file edits)</label>
      </div>
    `;
  }

  // ── Handlers ──

  async function handleCreate() {
    const tabs = [
      { id: 'general', label: '📋 General', html: buildGeneralTab({ name: '', description: '', icon: '📁', color: '#0078d4' }) },
      { id: 'projects', label: '📂 Projects', html: buildProjectsTab([], new Set()) },
      { id: 'desktop', label: '🖥️ Desktop', html: buildDesktopTab({ settings: {} }) },
      { id: 'agent', label: '🤖 Agent', html: buildAgentTab({ settings: {} }) },
    ];
    const form = await showTabbedModal('Create Space', tabs);
    if (!form?.name) return;
    try {
      const settings = buildSettings(form);
      await api.spaces.create({ name: form.name, description: form.description, icon: form._selectedIcon, color: form._selectedColor, settings });
      showNotice('Space created!', 'success');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  async function handleEdit(id) {
    const space = spaces.find(s => s.id === id);
    if (!space) return;

    // Fetch projects in parallel
    let allProjects = [];
    let currentProjectIds = new Set();
    try {
      const [allRes, wsRes] = await Promise.all([
        api.projects?.list?.().catch(() => ({ projects: [] })),
        api.spaces.projects(id).catch(() => ({ projects: [] }))
      ]);
      allProjects = allRes?.projects || (Array.isArray(allRes) ? allRes : []);
      currentProjectIds = new Set((wsRes?.projects || []).map(p => p.id));
    } catch {}

    const tabs = [
      { id: 'general', label: '📋 General', html: buildGeneralTab(space) },
      { id: 'projects', label: `📂 Projects (${currentProjectIds.size}/${allProjects.length})`, html: buildProjectsTab(allProjects, currentProjectIds) },
      { id: 'desktop', label: '🖥️ Desktop', html: buildDesktopTab(space) },
      { id: 'agent', label: '🤖 Agent', html: buildAgentTab(space) },
    ];

    const form = await showTabbedModal(`Edit "${space.name}"`, tabs);
    if (!form) return;

    try {
      const settings = buildSettings(form);
      await Promise.all([
        api.spaces.update(id, {
          name: form.name || space.name,
          description: form.description ?? space.description,
          icon: form._selectedIcon || space.icon,
          color: form._selectedColor || space.color,
          settings,
        }),
        api.spaces.assignProjects(id, form._checkedProjects || []),
      ]);
      showNotice('Settings saved!', 'success');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  function buildSettings(form) {
    return {
      desktop: {
        pinnedApps: form._selectedApps || [],
        restoreLayout: !!form.restoreLayout,
        saveLayout: !!form.saveLayout,
        homeView: form.homeView || '',
      },
      agent: {
        defaultModel: form.agentModel || '',
        systemPrompt: form.agentSystemPrompt || '',
        name: form.agentName || '',
        memoryScope: form.agentMemoryScope ? 'workspace' : 'global',
        autonomous: !!form.agentAutonomous,
      },
    };
  }

  async function handleDuplicate(id) {
    try {
      await api.spaces.duplicate(id);
      showNotice('Space duplicated!');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  async function handleDelete(id) {
    const space = spaces.find(s => s.id === id);
    if (!confirm(`Delete "${space?.name}"? This cannot be undone.`)) return;
    try {
      await api.spaces.delete(id);
      showNotice('Space deleted.');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  load();

  // SSE listener for multi-tab sync
  const onSSEChange = (event) => {
    const data = event.data ? JSON.parse(event.data) : null;
    if (data?.action === 'delete' && data.spaceId === getActiveSpaceId()) {
      const def = spaces.find(s => s.is_default) || spaces[0];
      if (def) setActiveSpace(def);
    }
    load();
  };
  globalThis.addEventListener?.('sse:space:changed', onSSEChange);

  return () => {
    globalThis.removeEventListener?.('sse:space:changed', onSSEChange);
  };
}

export default renderSpacesView;
