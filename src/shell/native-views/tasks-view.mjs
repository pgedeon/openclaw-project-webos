import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

// Capped-render virtualization (roadmap perf pass): task rows have VARIABLE
// height (the chip row wraps on narrow windows), so the session-replay
// fixed-row rail pattern does not apply — see the pattern split in
// ../list-window.mjs. We render the first LIST_INITIAL_CAP filtered rows and
// expose a "load more" control for the remainder.
import { cappedWindow, growCap } from '../list-window.mjs';

// Conversation tab (roadmap candidate "Task ↔ session conversation binding"):
// pure event→chat-item mapping for the embedded transcript view.
import { CONVERSATION_INITIAL_CAP, foldChatPage, capChatItems } from '../../../lib/task-conversation.js';

import { executeAction } from '../action-client.mjs';

const FALLBACK_DEFAULT_MODEL = 'openrouter1/stepfun/step-3.5-flash:free';

// Capped-render sizing: initial window and per-"load more" increment.
const LIST_INITIAL_CAP = 100;
const LIST_CAP_STEP = 100;

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'alpha', label: 'Alphabetical' },
];

const FILTER_DEFS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'my_tasks', label: 'My tasks' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'blocked', label: 'Blocked' },
];

function getModelDisplayName(modelId) {
  if (!modelId) return '';
  if (modelId.includes('/')) {
    const provider = modelId.split('/')[0];
    const shortName = modelId.split('/').slice(-1)[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return provider ? `${shortName} · ${provider}` : shortName;
  }
  return modelId;
}

function getModelChipLabel(modelId) {
  const d = getModelDisplayName(modelId);
  return d.length > 28 ? `${d.slice(0, 25)}…` : d;
}

function getCanonicalModelRef(model) {
  if (!model) return '';
  if (typeof model === 'string') return model.trim();
  const id = typeof model.id === 'string' ? model.id.trim() : '';
  const provider = typeof model.provider === 'string' ? model.provider.trim() : '';
  if (!id) return '';
  if (!provider || id.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) return id;
  return `${provider}/${id}`;
}

function modelRefMatchesSelection(model, selectedId = '') {
  const selected = typeof selectedId === 'string' ? selectedId.trim() : '';
  if (!selected) return false;
  const bareId = typeof model?.id === 'string' ? model.id.trim() : '';
  const canonicalId = getCanonicalModelRef(model);
  return selected === bareId || selected === canonicalId;
}

function buildTaskMetadata(existing = {}, { preferredModel = '' } = {}) {
  const meta = { ...existing };
  const openclaw = { ...(meta.openclaw || {}) };
  if (preferredModel) openclaw.preferred_model = preferredModel;
  if (Object.keys(openclaw).length > 0) meta.openclaw = openclaw;
  return meta;
}

function isTaskArchived(t) {
  return t.status === 'archived' || !!t.archived || !!t.archived_at;
}

function isTaskCompleted(t) {
  return t.status === 'completed' || !!t.completed_at || !!t.completed;
}

function isTaskPending(t) {
  return !isTaskArchived(t) && !isTaskCompleted(t);
}

function getTaskStatus(t) {
  if (isTaskArchived(t)) return 'archived';
  if (t.status && t.status.trim()) return t.status.trim();
  return t.completed ? 'completed' : 'backlog';
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildTaskListParams(projectId) {
  const params = {
    include_child_projects: 'true',
    include_archived: 'true',
  };

  if (projectId && projectId !== 'all') {
    params.project_id = projectId;
  }

  return params;
}

export async function renderTasksView({ mountNode, api, adapter, stateStore, sync, params = {}, navigateToView }) {
  ensureNativeRoot(mountNode, 'tasks-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  // === State ===
  let tasks = [];
  // Deep-link params (P2/P5): auto-select task or filter by project
  // Space scope (P4): filter by active space's projects
  let activeSpaceId = stateStore?.getState?.('activeSpaceId') || null;
  let spaceProjectIds = null; // null = all projects, array = space-scoped
  let projects = [];
  let currentProjectId = params.projectId || null;
  let initialTaskId = params.taskId || null;
  let currentFilter = 'all';
  let searchQuery = '';
  let categoryFilter = 'all';
  let sortValue = 'newest';
  let selectedTaskId = null;
  let isCreating = false;
  let isLoading = true;
  let cleanupFns = [];
  let noticeTimer = null;
  let cachedModels = [];
  let cachedModelProviders = [];
  let cachedAgents = [];
  let currentAgent = null;
  let isRefreshing = false;
  let syncUnsubscribe = null;
  // Capped-render state: how many filtered rows are currently rendered.
  // Reset to LIST_INITIAL_CAP whenever the filter set changes (project,
  // filter tab, search, category, sort), preserved across selection toggles.
  let listShownCount = LIST_INITIAL_CAP;

  // === Style injection ===
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .tv-task-row { transition: background 0.12s; }
    .tv-task-row.selected { border-color: var(--win11-accent) !important; background: rgba(96,205,255,0.06) !important; }
    .tv-task-row.overdue-row { border-left: 3px solid #ef4444 !important; }
    .tv-filter { transition: background 0.15s, color 0.15s; }
    .tv-filter.active { background: var(--win11-accent) !important; color: #fff !important; }
    .tv-filter .count { font-size: 0.68rem; opacity: 0.6; margin-left: 5px; }
    .tv-action-btn { font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--win11-border); background: var(--win11-surface-solid); color: var(--win11-text-secondary); cursor: pointer; white-space: nowrap; }
    .tv-action-btn:hover { background: var(--win11-surface-active); color: var(--win11-text); }
    .tv-action-btn.danger:hover { border-color: #ef4444; color: #ef4444; }
    .tv-action-btn.primary { background: var(--win11-accent); color: #fff; border-color: transparent; }
    .tv-compose-label { display: block; font-size: 0.78rem; color: var(--win11-text-secondary); margin-bottom: 3px; font-weight: 500; }
    .tv-input, .tv-select, .tv-textarea {
      width: 100%; padding: 5px 8px; border-radius: 5px;
      border: 1px solid var(--win11-border); background: var(--win11-surface);
      color: var(--win11-text); font-size: 0.83rem; outline: none;
      box-sizing: border-box;
    }
    .tv-input:focus, .tv-select:focus, .tv-textarea:focus { border-color: var(--win11-accent); }
    .tv-textarea { resize: vertical; font-family: inherit; }
    .tv-notice.is-error { background: rgba(239,68,68,0.1); color: #ef4444; border-color: rgba(239,68,68,0.2); }
    .tv-notice.is-success { background: rgba(34,197,94,0.1); color: #22c55e; border-color: rgba(34,197,94,0.2); }
    .tv-notice.is-visible { display: block; }
    @keyframes tv-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .tv-session-badge { animation: tv-pulse 2s infinite; cursor: pointer; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .tv-refresh-spinner { display: inline-block; }
    .tv-live-indicator { display: inline-block; }
    /* Conversation tab (embedded transcript) — badge tones mirror console-view
       .cl-badge-* / replay .sr-badge-* styling. */
    .tv-conv-badge { display:inline-block; border-radius:4px; padding:0 6px; font-size:0.7rem; }
    .tv-conv-badge-good { background:rgba(34,197,94,0.15); color:#22c55e; }
    .tv-conv-badge-bad { background:rgba(239,68,68,0.18); color:#ef4444; }
    .tv-conv-badge-neutral { background:rgba(148,163,184,0.15); color:#94a3b8; }
    .tv-conv-bubble { max-width:92%; margin:0 0 6px; padding:5px 9px; border-radius:8px;
      white-space:pre-wrap; word-break:break-word; line-height:1.45; font-size:0.76rem; }
    .tv-conv-bubble.user { margin-left:auto; background:rgba(96,205,255,0.10); border:1px solid rgba(96,205,255,0.25); }
    .tv-conv-bubble.assistant { background:rgba(255,255,255,0.04); border:1px solid var(--win11-border); }
    .tv-conv-who { display:block; font-size:0.64rem; color:var(--win11-text-tertiary,#55607080); margin-bottom:2px; }
  `;
  root.appendChild(styleEl);

  // === Layout ===
  root.innerHTML += `
    <!-- Composer (collapsible) -->
    <div id="tvComposer" style="display:none;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="padding:12px 16px 8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="margin:0;font-size:0.95rem;color:var(--win11-text);">New Task</h3>
          <button id="tvToggleComposer" style="background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1rem;padding:2px 6px;" title="Close composer">▼</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
          <div style="grid-column:1/-1;">
            <label class="tv-compose-label" for="tvNewTitle">Task name</label>
            <input class="tv-input" type="text" id="tvNewTitle" placeholder="Enter a new task..." />
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewCategory">Category</label>
            <input class="tv-input" type="text" id="tvNewCategory" placeholder="General" />
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewStatus">Status</label>
            <select class="tv-select" id="tvNewStatus">
              ${STATUS_OPTIONS.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1;">
            <label class="tv-compose-label" for="tvNewDesc">Description</label>
            <textarea class="tv-textarea" id="tvNewDesc" rows="2" placeholder="Add context, constraints, success criteria..."></textarea>
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewOwner">Assigned agent</label>
            <select class="tv-select" id="tvNewOwner"><option value="">Unassigned</option></select>
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewModel">LLM model</label>
            <select class="tv-select" id="tvNewModel"><option value="">Loading models...</option></select>
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewPriority">Priority</label>
            <select class="tv-select" id="tvNewPriority">
              ${PRIORITY_OPTIONS.map(p => `<option value="${p.value}"${p.value === 'medium' ? ' selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewRecurrence">Recurrence</label>
            <select class="tv-select" id="tvNewRecurrence">
              ${RECURRENCE_OPTIONS.map(r => `<option value="${r.value}">${r.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewStart">Start date</label>
            <input class="tv-input" type="date" id="tvNewStart" />
          </div>
          <div>
            <label class="tv-compose-label" for="tvNewDue">Due date</label>
            <input class="tv-input" type="date" id="tvNewDue" />
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <span style="font-size:0.75rem;color:var(--win11-text-tertiary);">Press Enter in task name for quick create</span>
          <div style="display:flex;gap:8px;">
            <button id="tvCreateSubmit" class="tv-action-btn primary">Create Task</button>
            <button id="tvCreateCancel" class="tv-action-btn">Cancel</button>
          </div>
        </div>
        <div id="tvNotice" class="tv-notice"></div>
      </div>
    </div>

    <!-- Toolbar -->
    <div id="tvToolbar" style="padding:10px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:180px;">
          <h2 style="margin:0;color:var(--win11-text);font-size:1.15rem;font-weight:700;white-space:nowrap;">📋 Tasks</h2><span id="tvLiveIndicator" style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span><span id="tvRefreshSpinner" style="display:none;font-size:0.9rem;animation:spin 1s linear infinite;margin-left:4px;">⟳</span>
          <select id="tvProjectSelect" style="flex:1;max-width:240px;padding:4px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;">
            <option value="">Loading...</option>
          </select>
        </div>
        <button id="tvNewBtn" class="tv-action-btn primary" style="font-weight:600;">+ New Task</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <div id="tvFilterBar" style="display:flex;gap:3px;flex-wrap:wrap;">
          ${FILTER_DEFS.map(f => `<button data-filter="${f.value}" class="tv-filter${f.value === 'all' ? ' active' : ''}" style="padding:3px 9px;border-radius:4px;border:1px solid var(--win11-border);background:${f.value === 'all' ? 'var(--win11-accent)' : 'var(--win11-surface-solid)'};color:${f.value === 'all' ? '#fff' : 'var(--win11-text)'};cursor:pointer;font-size:0.76rem;">${f.label} <span class="count" id="tvFilterCount_${f.value}">0</span></button>`).join('')}
        </div>
        <input id="tvSearch" type="text" placeholder="Search tasks or categories..." style="flex:1;min-width:100px;padding:4px 9px;border-radius:4px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;outline:none;" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
        <select id="tvCategoryFilter" style="padding:4px 8px;border-radius:4px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.78rem;">
          <option value="all">All categories</option>
        </select>
        <select id="tvSort" style="padding:4px 8px;border-radius:4px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.78rem;">
          ${SORT_OPTIONS.map(s => `<option value="${s.value}"${s.value === 'newest' ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <div style="flex:1;"></div>
        <button id="tvExportJson" class="tv-action-btn">Export JSON</button>
        <button id="tvExportCsv" class="tv-action-btn">Export CSV</button>
        <label id="tvImportLabel" class="tv-action-btn" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.78rem;white-space:nowrap;">📥 Import<input type="file" id="tvImportFile" accept=".json,.csv" hidden /></label>
        <button id="tvArchiveCompleted" class="tv-action-btn" style="color:var(--win11-text-tertiary);">Archive completed</button>
      </div>
    </div>

    <!-- Stats -->
    <div id="tvStats" style="padding:8px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;"></div>

    <!-- Task List -->
    <div id="tvList" style="flex:1;overflow-y:auto;padding:6px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading tasks...</div>
    </div>

    <!-- Detail Panel -->
    <div id="tvDetail" style="display:none;border-top:2px solid var(--win11-border);max-height:45%;overflow-y:auto;flex-shrink:0;"></div>
  `;

  mountNode.appendChild(root);

  // === Notice helper ===
  function showNotice(msg, type = '') {
    const el = root.querySelector('#tvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `tv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'tv-notice'; }, 4000);
  }

  // === Data loading ===
  async function loadProjects() {
    try {
      const res = await api.projects.list();
      projects = Array.isArray(res) ? res : (Array.isArray(res.projects) ? res.projects : []);
      const select = root.querySelector('#tvProjectSelect');
      select.innerHTML = '<option value="all">All Projects</option>' +
        projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
      if (currentProjectId) select.value = currentProjectId;
    } catch (e) {
      console.warn('[TasksView] Failed to load projects:', e);
    }
  }

  async function loadTaskOptions() {
    // Load model catalog from sync'd openclaw.json (auto-updated by sync-models-catalog.js)
    try {
      const [catalogResult, agentsResult] = await Promise.allSettled([
        fetch('/models-catalog.json', { headers: { 'Authorization': `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__ || ''}` } }).then(r => r.ok ? r.json() : null),
        api.org.agents.list(),
      ]);

      // Models from openclaw.json providers
      if (catalogResult.status === 'fulfilled' && catalogResult.value) {
        const catalog = catalogResult.value;
        cachedModels = Array.isArray(catalog.models) ? catalog.models : [];
        // Group by provider for optgroup display
        cachedModelProviders = Array.isArray(catalog.providers) ? catalog.providers : [];
      }

      // Agents from org API
      if (agentsResult.status === 'fulfilled') {
        const orgAgents = Array.isArray(agentsResult.value) ? agentsResult.value : [];
        if (orgAgents.length > 0) {
          cachedAgents = orgAgents.map(a => ({ id: a.id || a.name, name: a.name || a.id }));
        }
      }
    } catch (e) {
      console.warn('[TasksView] Could not load task options:', e);
    }

    if (cachedModels.length === 0) {
      cachedModels = [{ id: FALLBACK_DEFAULT_MODEL, displayName: 'Step-3.5 Flash Free', provider: 'openrouter1' }];
    }

    populateModelSelect(root.querySelector('#tvNewModel'));
    populateAgentSelect(root.querySelector('#tvNewOwner'));
  }

  function buildModelOptions(selectedId = '') {
    let html = '';
    if (cachedModelProviders.length > 1) {
      const byProvider = new Map();
      for (const m of cachedModels) {
        const prov = m.provider || 'other';
        if (!byProvider.has(prov)) byProvider.set(prov, []);
        byProvider.get(prov).push(m);
      }
      for (const [prov, models] of byProvider) {
        const provName = prov.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        html += `<optgroup label="${escapeHtml(provName)} (${models.length})">`;
        for (const m of models) {
          const modelRef = getCanonicalModelRef(m);
          html += `<option value="${escapeHtml(modelRef)}"${modelRefMatchesSelection(m, selectedId) ? ' selected' : ''}${m.reasoning ? ' data-reasoning="true"' : ''}>${escapeHtml(m.displayName || getModelDisplayName(modelRef))}${m.reasoning ? ' 🧠' : ''}</option>`;
        }
        html += '</optgroup>';
      }
    } else {
      for (const m of cachedModels) {
        const modelRef = getCanonicalModelRef(m);
        html += `<option value="${escapeHtml(modelRef)}"${modelRefMatchesSelection(m, selectedId) ? ' selected' : ''}>${escapeHtml(m.displayName || getModelDisplayName(modelRef))}</option>`;
      }
    }
    return html;
  }

  function populateModelSelect(select) {
    if (!select) return;
    let html = '<option value="">No model preference</option>';
    // Group models by provider
    if (cachedModelProviders.length > 1) {
      const byProvider = new Map();
      for (const m of cachedModels) {
        const prov = m.provider || 'other';
        if (!byProvider.has(prov)) byProvider.set(prov, []);
        byProvider.get(prov).push(m);
      }
      for (const [prov, models] of byProvider) {
        const provName = prov.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        html += `<optgroup label="${escapeHtml(provName)} (${models.length})">`;
        for (const m of models) {
          const modelRef = getCanonicalModelRef(m);
          html += `<option value="${escapeHtml(modelRef)}"${m.reasoning ? ' data-reasoning="true"' : ''}>${escapeHtml(m.displayName || getModelDisplayName(modelRef))}${m.reasoning ? ' 🧠' : ''}</option>`;
        }
        html += '</optgroup>';
      }
    } else {
      for (const m of cachedModels) {
        const modelRef = getCanonicalModelRef(m);
        html += `<option value="${escapeHtml(modelRef)}">${escapeHtml(m.displayName || getModelDisplayName(modelRef))}</option>`;
      }
    }
    select.innerHTML = html;
    select.value = FALLBACK_DEFAULT_MODEL;
  }

  function populateAgentSelect(select) {
    if (!select) return;
    select.innerHTML = '<option value="">Unassigned</option>' +
      cachedAgents.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name || a.id)}</option>`).join('');
  }

  function buildScopedTaskParams() {
    const query = buildTaskListParams(currentProjectId);
    const wsId = stateStore?.getState?.('activeSpaceId');
    if (wsId && (!currentProjectId || currentProjectId === 'all')) query.workspace_id = wsId;
    return query;
  }

  async function loadTasks() {
    isLoading = true;
    listShownCount = LIST_INITIAL_CAP; // fresh data → fresh cap
    renderList();
    try {
      const params = buildScopedTaskParams();
      const res = await api.tasks.list(params);
      tasks = Array.isArray(res) ? res : [];
    } catch (e) {
      console.warn('[TasksView] Failed to load tasks:', e);
      tasks = [];
    }
    isLoading = false;
    // Auto-select task from deep-link (P2/P5)
    if (initialTaskId) {
      const found = tasks.find(t => t.id === initialTaskId);
      if (found) { selectedTaskId = initialTaskId; }
      initialTaskId = null; // Only apply once
    }
    updateCategoryFilter();
    renderStats();
    renderFilterCounts();
    renderList();
    if (selectedTaskId) renderDetail();
  }

  // === Categories ===
  function getCategories() {
    const cats = new Set();
    tasks.forEach(t => {
      if (t.category && t.category.trim()) cats.add(t.category.trim());
      if (t.labels) t.labels.forEach(l => { if (l) cats.add(l); });
    });
    return [...cats].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function updateCategoryFilter() {
    const select = root.querySelector('#tvCategoryFilter');
    const cats = getCategories();
    const current = select.value;
    select.innerHTML = '<option value="all">All categories</option>' +
      cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    select.value = cats.includes(current) ? current : 'all';
    if (current !== 'all' && !cats.includes(current)) {
      categoryFilter = 'all';
    }
  }

  // === Filtering & Sorting ===
  function getFilteredTasks() {
    let filtered = [...tasks];

    switch (currentFilter) {
      case 'all':
        // Exclude archived by default — use "Archived" tab to see those
        filtered = filtered.filter(t => !isTaskArchived(t));
        break;
      case 'pending':
        filtered = filtered.filter(t => isTaskPending(t));
        break;
      case 'completed':
        filtered = filtered.filter(t => isTaskCompleted(t));
        break;
      case 'archived':
        filtered = filtered.filter(t => isTaskArchived(t));
        break;
      case 'my_tasks':
        filtered = filtered.filter(t => t.owner && t.owner === currentAgent && !isTaskArchived(t));
        break;
      case 'overdue':
        { const now = new Date();
          filtered = filtered.filter(t => isTaskPending(t) && t.due_date && new Date(t.due_date) < now); }
        break;
      case 'blocked':
        { const taskMap = new Map(tasks.map(t => [t.id, t]));
          filtered = filtered.filter(t => {
            if (isTaskArchived(t) || isTaskCompleted(t)) return false;
            if (t.status === 'blocked') return true;
            if (t.dependency_ids && t.dependency_ids.length > 0) {
              return t.dependency_ids.some(depId => { const dep = taskMap.get(depId); return dep && isTaskPending(dep); });
            }
            return false;
          }); }
        break;
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category === categoryFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        (t.title || t.text || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.labels || []).some(l => l.toLowerCase().includes(q))
      );
    }

    const sorted = [...filtered];
    switch (sortValue) {
      case 'oldest':
        sorted.sort((a, b) => new Date(a.created_at || a.createdAt || 0) - new Date(b.created_at || b.createdAt || 0));
        break;
      case 'updated':
        sorted.sort((a, b) => new Date(b.updated_at || b.updatedAt || b.created_at || 0) - new Date(a.updated_at || a.updatedAt || a.created_at || 0));
        break;
      case 'alpha':
        sorted.sort((a, b) => (a.title || a.text || '').localeCompare(b.title || b.text || '', undefined, { sensitivity: 'base' }));
        break;
      default: // newest
        sorted.sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
    }

    return sorted;
  }

  function countByFilter(filterVal) {
    const saved = currentFilter;
    currentFilter = filterVal;
    const count = getFilteredTasks().length;
    currentFilter = saved;
    return count;
  }

  // === Rendering ===
  function renderStats() {
    const total = tasks.filter(t => !isTaskArchived(t)).length;
    const pending = tasks.filter(t => isTaskPending(t)).length;
    const completed = tasks.filter(t => isTaskCompleted(t)).length;
    const archived = tasks.filter(t => isTaskArchived(t)).length;
    const overdue = tasks.filter(t => isTaskPending(t) && t.due_date && new Date(t.due_date) < new Date()).length;

    root.querySelector('#tvStats').innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${createStatCard({ label: 'Total', value: formatCount(total) }).outerHTML}
        ${createStatCard({ label: 'Pending', value: formatCount(pending) }).outerHTML}
        ${createStatCard({ label: 'Completed', value: formatCount(completed), tone: completed > 0 ? 'success' : 'muted' }).outerHTML}
        ${createStatCard({ label: 'Archived', value: formatCount(archived) }).outerHTML}
        ${createStatCard({ label: 'Overdue', value: formatCount(overdue), tone: overdue > 0 ? 'error' : 'muted' }).outerHTML}
      </div>
    `;
  }

  function renderFilterCounts() {
    FILTER_DEFS.forEach(f => {
      const el = root.querySelector(`#tvFilterCount_${f.value}`);
      if (el) el.textContent = countByFilter(f.value);
    });
  }

  function renderList() {
    const container = root.querySelector('#tvList');

    if (isLoading) {
      container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading tasks...</div>';
      return;
    }

    const filtered = getFilteredTasks();

    if (filtered.length === 0) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">
        ${searchQuery ? 'No tasks match your search.' : currentFilter !== 'all' ? `No ${currentFilter.replace('_', ' ')} tasks.` : 'No tasks yet. Click "+ New Task" to create one.'}
      </div>`;
      return;
    }

    // Capped render: only the first listShownCount rows reach the DOM
    // (variable-height rows → capped-render + load-more, not fixed-row rail).
    const { end, hidden } = cappedWindow({ total: filtered.length, shown: listShownCount });
    container.innerHTML = filtered.slice(0, end).map(t => renderTaskRow(t)).join('') + (
      hidden > 0
        ? `<div style="padding:10px;text-align:center;">
             <button id="tvLoadMore" class="tv-action-btn" style="padding:5px 14px;">Load ${Math.min(LIST_CAP_STEP, hidden)} more… (${hidden} hidden)</button>
           </div>`
        : ''
    );

    // Attach event handlers via delegation
    attachListHandlers(container);
  }

  function renderTaskRow(t) {
    const title = t.title || t.text || 'Untitled';
    const status = getTaskStatus(t);
    const isComp = isTaskCompleted(t);
    const isArch = isTaskArchived(t);
    const priority = t.priority || 'medium';
    const category = t.category || t.labels?.[0] || '';
    const owner = t.owner || '';
    const created = t.created_at || t.createdAt;
    const hasDesc = !!(t.description && t.description.trim());
    const depCount = (t.dependency_ids || []).length;
    const isSelected = t.id === selectedTaskId;
    const isOverdue = isTaskPending(t) && t.due_date && new Date(t.due_date) < new Date();
    const preferredModel = t.metadata?.openclaw?.preferred_model || '';
    const hasModel = !!preferredModel;
    const recurrence = t.recurrence_rule && !isComp && !isArch ? t.recurrence_rule : '';

    const priColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
    const priColor = priColors[priority] || 'var(--win11-text-tertiary)';
    const statusIcons = { backlog: '📋', ready: '✅', in_progress: '🔄', review: '👁️', blocked: '⛔', completed: '✓', archived: '📦' };
    const statusIcon = statusIcons[status] || '📋';

    const truncatedTitle = title.length > 120 ? title.substring(0, 120) + '…' : title;

    return `<div class="tv-task-row${isSelected ? ' selected' : ''}${isOverdue ? ' overdue-row' : ''}" data-task-id="${escapeHtml(t.id)}" style="
      display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:6px;margin-bottom:3px;
      cursor:pointer;border:1px solid ${isSelected ? 'var(--win11-accent)' : 'transparent'};
      background:${isSelected ? 'rgba(96,205,255,0.06)' : 'transparent'};
    " onmouseenter="this.style.background='var(--win11-surface-active)'" onmouseleave="this.style.background='${isSelected ? 'rgba(96,205,255,0.06)' : 'transparent'}'">
      <button class="tv-complete-btn" data-task-id="${escapeHtml(t.id)}" title="${isComp ? 'Reopen' : 'Complete'}" style="
        margin-top:2px;width:18px;height:18px;border-radius:4px;border:2px solid ${isComp ? 'var(--win11-accent)' : 'var(--win11-border)'};
        background:${isComp ? 'var(--win11-accent)' : 'transparent'};cursor:pointer;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;padding:0;
      ">${isComp ? '✓' : ''}</button>
      <div style="min-width:0;flex:1;">
        <div style="font-size:0.86rem;font-weight:500;color:var(--win11-text);${isComp ? 'text-decoration:line-through;opacity:0.6;' : ''}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(truncatedTitle)}</div>
        <div style="display:flex;gap:5px;align-items:center;margin-top:3px;flex-wrap:wrap;">
          <span style="font-size:0.68rem;color:${priColor};font-weight:600;text-transform:uppercase;">${escapeHtml(priority)}</span>
          <span style="font-size:0.68rem;color:var(--win11-text-tertiary);">${statusIcon} ${escapeHtml(status)}</span>
          ${category ? `<span style="font-size:0.68rem;padding:0 5px;border-radius:3px;background:rgba(96,205,255,0.1);color:var(--win11-accent);">${escapeHtml(category)}</span>` : ''}
          ${owner ? `<span style="font-size:0.68rem;color:var(--win11-text-tertiary);">👤 ${escapeHtml(owner)}</span>` : ''}
          ${hasModel ? `<span style="font-size:0.65rem;color:var(--win11-text-tertiary);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(preferredModel)}">🧠 ${escapeHtml(getModelChipLabel(preferredModel))}</span>` : ''}
          ${recurrence ? `<span style="font-size:0.68rem;">🔄 ${escapeHtml(recurrence)}</span>` : ''}
          ${depCount > 0 ? `<span style="font-size:0.68rem;color:var(--win11-text-tertiary);">📎 ${depCount}</span>` : ''}
          ${isOverdue ? `<span style="font-size:0.68rem;color:#ef4444;font-weight:600;">⚠ OVERDUE</span>` : ''}
          ${hasDesc ? `<span style="font-size:0.68rem;color:var(--win11-text-tertiary);">📄</span>` : ''}
          <span style="font-size:0.66rem;color:var(--win11-text-tertiary);margin-left:auto;">${created ? new Date(created).toLocaleDateString() : ''}</span>
        </div>
      </div>
      <div class="tv-row-actions" style="display:flex;gap:4px;flex-shrink:0;opacity:0;transition:opacity 0.15s;">
        <button class="tv-action-btn tv-row-done" data-task-id="${escapeHtml(t.id)}" title="${isComp ? 'Reopen' : 'Done'}">${isComp ? '↩' : '✓'}</button>
        <button class="tv-action-btn tv-row-edit" data-task-id="${escapeHtml(t.id)}" title="Edit">✎</button>
        <button class="tv-action-btn tv-row-archive" data-task-id="${escapeHtml(t.id)}" title="${isArch ? 'Restore' : 'Archive'}">${isArch ? '↩' : '📦'}</button>
        <button class="tv-action-btn danger tv-row-delete" data-task-id="${escapeHtml(t.id)}" title="Delete">✕</button>
      </div>
    </div>`;
  }

  function attachListHandlers(container) {
    // Show action buttons on hover
    container.querySelectorAll('.tv-task-row').forEach(row => {
      const actions = row.querySelector('.tv-row-actions');
      if (!actions) return;
      const show = () => actions.style.opacity = '1';
      const hide = () => actions.style.opacity = '0';
      row.addEventListener('mouseenter', show);
      row.addEventListener('mouseleave', hide);
      cleanupFns.push(() => { row.removeEventListener('mouseenter', show); row.removeEventListener('mouseleave', hide); });
    });

    // "Load more" — grow the cap by one step and re-render
    const loadMore = container.querySelector('#tvLoadMore');
    if (loadMore) {
      const handler = () => {
        const filtered = getFilteredTasks();
        listShownCount = growCap({ shown: listShownCount, total: filtered.length, step: LIST_CAP_STEP });
        renderList();
      };
      loadMore.addEventListener('click', handler);
      cleanupFns.push(() => loadMore.removeEventListener('click', handler));
    }

    // Row click -> select
    container.querySelectorAll('.tv-task-row').forEach(row => {
      const handler = (e) => {
        if (e.target.closest('.tv-row-actions') || e.target.closest('.tv-complete-btn')) return;
        selectedTaskId = selectedTaskId === row.dataset.taskId ? null : row.dataset.taskId;
        renderList();
        renderDetail();
      };
      row.addEventListener('click', handler);
      cleanupFns.push(() => row.removeEventListener('click', handler));
    });

    // Checkbox
    container.querySelectorAll('.tv-complete-btn').forEach(btn => {
      const handler = async (e) => {
        e.stopPropagation();
        const task = tasks.find(t => t.id === btn.dataset.taskId);
        if (!task) return;
        const comp = isTaskCompleted(task);
        try {
          await api.tasks.move(task.id, comp ? 'backlog' : 'completed');
          await loadTasks();
        } catch (err) { console.error('[TasksView] toggle failed:', err); }
      };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    // Action buttons
    container.querySelectorAll('.tv-row-done').forEach(btn => {
      const handler = async (e) => { e.stopPropagation(); const task = tasks.find(t => t.id === btn.dataset.taskId); if (!task) return; try { await api.tasks.move(task.id, isTaskCompleted(task) ? 'backlog' : 'completed'); await loadTasks(); } catch (err) { console.error(err); } };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    container.querySelectorAll('.tv-row-edit').forEach(btn => {
      const handler = (e) => { e.stopPropagation(); const task = tasks.find(t => t.id === btn.dataset.taskId); if (task) showEditModal(task); };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    container.querySelectorAll('.tv-row-archive').forEach(btn => {
      const handler = async (e) => { e.stopPropagation(); const task = tasks.find(t => t.id === btn.dataset.taskId); if (!task) return; try { if (isTaskArchived(task)) { await api.tasks.restore(task.id); } else { await api.tasks.archive(task.id); } await loadTasks(); } catch (err) { console.error(err); } };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    container.querySelectorAll('.tv-row-delete').forEach(btn => {
      const handler = async (e) => { e.stopPropagation(); const task = tasks.find(t => t.id === btn.dataset.taskId); if (!task) return; if (!confirm(`Delete "${task.title || task.text || 'Untitled'}"?`)) return; try { await api.tasks.remove(task.id); if (selectedTaskId === task.id) selectedTaskId = null; await loadTasks(); renderDetail(); } catch (err) { alert('Delete failed: ' + err.message); } };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });
  }

  function renderDetail() {
    const panel = root.querySelector('#tvDetail');
    if (!selectedTaskId) { panel.style.display = 'none'; return; }
    const task = tasks.find(t => t.id === selectedTaskId);
    if (!task) { panel.style.display = 'none'; selectedTaskId = null; return; }

    panel.style.display = 'block';
    const title = task.title || task.text || 'Untitled';
    const desc = task.description || '';
    const status = getTaskStatus(task);
    const priority = task.priority || 'medium';
    const owner = task.owner || '—';
    const created = task.created_at || task.createdAt;
    const updated = task.updated_at || task.updatedAt;
    const completed = task.completed_at || '';
    const labels = (task.labels || []).join(', ');
    const category = task.category || '';
    const depIds = task.dependency_ids || [];
    const model = task.metadata?.openclaw?.preferred_model || '';
    const recurrence = task.recurrence_rule || '';
    const dueDate = task.due_date || '';
    const startDate = task.start_date || '';
    const error = task.last_error || '';
    const isOverdue = isTaskPending(task) && dueDate && new Date(dueDate) < new Date();

    const priColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
    const statusOpts = [...STATUS_OPTIONS, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }];

    panel.innerHTML = `
      <div style="padding:12px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <h3 style="margin:0 0 4px;color:var(--win11-text);font-size:0.95rem;font-weight:600;flex:1;word-break:break-word;">${escapeHtml(title)}</h3>
          <button id="tvCloseDetail" style="background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1rem;padding:2px 6px;" title="Close">✕</button>
        </div>
        ${desc ? `<div style="color:var(--win11-text-secondary);font-size:0.83rem;margin-bottom:10px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(desc)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;font-size:0.8rem;">
          <div><span style="color:var(--win11-text-tertiary);">Status:</span> <strong>${escapeHtml(status)}</strong></div>
          <div><span style="color:var(--win11-text-tertiary);">Priority:</span> <strong style="color:${priColors[priority] || 'inherit'};">${escapeHtml(priority)}</strong>${isOverdue ? ' <span style="color:#ef4444;">⚠ OVERDUE</span>' : ''}</div>
          <div><span style="color:var(--win11-text-tertiary);">Owner:</span> <strong>${escapeHtml(owner)}</strong></div>
          ${category ? `<div><span style="color:var(--win11-text-tertiary);">Category:</span> <strong>${escapeHtml(category)}</strong></div>` : ''}
          ${model ? `<div style="grid-column:1/-1;"><span style="color:var(--win11-text-tertiary);">Model:</span> <strong style="font-size:0.76rem;">${escapeHtml(getModelDisplayName(model))}</strong></div>` : ''}
          ${recurrence ? `<div><span style="color:var(--win11-text-tertiary);">Recurrence:</span> ${escapeHtml(recurrence)}</div>` : ''}
          ${startDate ? `<div><span style="color:var(--win11-text-tertiary);">Start:</span> ${escapeHtml(startDate)}</div>` : ''}
          ${dueDate ? `<div><span style="color:var(--win11-text-tertiary);">Due:</span> <strong${isOverdue ? ' style="color:#ef4444;"' : ''}>${escapeHtml(dueDate)}</strong></div>` : ''}
          <div><span style="color:var(--win11-text-tertiary);">Created:</span> ${created ? new Date(created).toLocaleString() : '—'}</div>
          <div><span style="color:var(--win11-text-tertiary);">Updated:</span> ${updated ? new Date(updated).toLocaleString() : '—'}</div>
          ${completed ? `<div><span style="color:var(--win11-text-tertiary);">Completed:</span> ${new Date(completed).toLocaleString()}</div>` : ''}
          ${depIds.length ? `<div><span style="color:var(--win11-text-tertiary);">Dependencies:</span> ${depIds.length}</div>` : ''}
          ${labels ? `<div style="grid-column:1/-1;"><span style="color:var(--win11-text-tertiary);">Labels:</span> ${escapeHtml(labels)}</div>` : ''}
          ${error ? `<div style="grid-column:1/-1;color:#ef4444;"><strong>Error:</strong> ${escapeHtml(error)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button id="tvDetailEdit" class="tv-action-btn">Edit</button>
          <button id="tvDetailArchive" class="tv-action-btn">${isTaskArchived(task) ? 'Restore' : 'Archive'}</button>
          <button id="tvDetailDelete" class="tv-action-btn danger">Delete</button>
        </div>
        <!-- Cross-navigation actions (P5) -->
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          ${task.project_id ? `<button class="tv-nav-btn" data-nav="board" data-project-id="${escapeHtml(task.project_id)}" title="Open in Board view">📋 Board</button>` : ''}
          ${owner && owner !== '—' ? `<button class="tv-nav-btn" data-nav="agent" data-agent-name="${escapeHtml(owner)}" title="Open agent details">🤖 Agent</button>` : ''}
          <button class="tv-nav-btn" data-nav="history" data-task-id="${escapeHtml(task.id)}" title="View task history">📜 History</button>
          <button class="tv-nav-btn" data-nav="memory" data-query="${escapeHtml(title)}" title="Search memory for this task">🧠 Memory</button>
        </div>
        <!-- Sessions (task↔session binding, docs/briefs/task-session-binding.md §4):
             filled async by loadTaskSessions(); stays empty (absent) on failure/empty -->
        <div id="tvSessions" style="margin-top:10px;"></div>
      </div>
    `;

    const closeH = () => { selectedTaskId = null; renderList(); renderDetail(); };
    const closeBtn = panel.querySelector('#tvCloseDetail');
    closeBtn.addEventListener('click', closeH);
    cleanupFns.push(() => closeBtn.removeEventListener('click', closeH));

    const editBtn = panel.querySelector('#tvDetailEdit');
    editBtn.addEventListener('click', () => showEditModal(task));
    cleanupFns.push(() => editBtn.removeEventListener('click', () => showEditModal(task)));

    const archiveBtn = panel.querySelector('#tvDetailArchive');
    const archiveH = async () => {
      try {
        if (isTaskArchived(task)) await api.tasks.restore(task.id);
        else await api.tasks.archive(task.id);
        await loadTasks(); renderDetail();
      } catch (e) { alert('Failed: ' + e.message); }
    };
    archiveBtn.addEventListener('click', archiveH);
    cleanupFns.push(() => archiveBtn.removeEventListener('click', archiveH));

    const deleteBtn = panel.querySelector('#tvDetailDelete');
    const deleteH = async () => {
      if (!confirm(`Delete "${title}"?`)) return;
      try { await api.tasks.remove(task.id); selectedTaskId = null; await loadTasks(); renderDetail(); } catch (e) { alert('Delete failed: ' + e.message); }
    };
    deleteBtn.addEventListener('click', deleteH);
    cleanupFns.push(() => deleteBtn.removeEventListener('click', deleteH));

    // Cross-navigation handlers (P5)
    panel.querySelectorAll('.tv-nav-btn').forEach(btn => {
      const navType = btn.dataset.nav;
      const handler = () => {
        switch (navType) {
          case 'board':
            navigateToView?.('board', { params: { projectId: btn.dataset.projectId } });
            break;
          case 'agent':
            navigateToView?.('agents', { params: { agentName: btn.dataset.agentName } });
            break;
          case 'history':
            navigateToView?.('history', { params: { taskId: btn.dataset.taskId } });
            break;
          case 'memory':
            navigateToView?.('memory', { params: { query: btn.dataset.query } });
            break;
        }
      };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });

    // Sessions section (brief §4): exactly ONE GET per detail render, zero
    // non-GET requests ever. Endpoint failure / 503 / empty list → section
    // stays absent, silent by design (most tasks have no runs).
    loadTaskSessions(task);
  }

  // === Sessions section (task↔session binding, docs/briefs/task-session-binding.md) ===
  function tvRelTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  function tvSessionRowHtml(b) {
    const time = b.startedAt ? tvRelTime(b.startedAt) : '';
    const meta = `${escapeHtml(b.workflowType || 'run')} · ${escapeHtml(b.runStatus || '')}${time ? ` · ${time}` : ''}`;
    // R1 honesty label: re-queued runs lose earlier gateway_session_id values,
    // so what is listed is only the latest attempt's session.
    const retryNote = b.retryCycled
      ? `<div style="font-size:0.66rem;color:var(--win11-text-tertiary);margin:2px 0 0 20px;">└ retried ${escapeHtml(String(b.retryCount ?? 0))}× · latest attempt shown</div>`
      : '';

    let main;
    if (b.deepLink && b.deepLink.params) {
      // Resolvable transcript: live → Live Console (auto-attach), everything
      // else → Session Replay (resolves by sessionId).
      const isLive = b.deepLink.view === 'console';
      const glyph = isLive ? '▶' : (b.runStatus === 'completed' ? '✔' : '✕');
      const label = isLive ? 'Live →' : 'Replay →';
      main = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="width:14px;text-align:center;color:${isLive ? '#22c55e' : 'var(--win11-text-secondary)'};">${glyph}</span>
        <span style="font-family:monospace;font-size:0.74rem;color:var(--win11-text);word-break:break-all;">${escapeHtml(b.sessionKey || '')}</span>
        <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">· ${meta}</span>
        <button class="tv-action-btn tv-conv-toggle" data-run-id="${escapeHtml(b.runId || '')}" data-agent="${escapeHtml(b.deepLink.params.agent || '')}" data-session="${escapeHtml(b.deepLink.params.session || '')}" title="Embedded conversation (read-only)">Conversation ▸</button>
        <button class="tv-action-btn tv-session-nav" data-view="${escapeHtml(b.deepLink.view)}" data-agent="${escapeHtml(b.deepLink.params.agent || '')}" data-session="${escapeHtml(b.deepLink.params.session || '')}">${label}</button>
      </div>`;
    } else if (b.sessionKey) {
      // Orphaned: key retained but transcript pruned/rotated — permanent honest
      // dead end, never a fabricated link (brief §4 rule 4).
      main = `<div title="transcript no longer on disk" style="cursor:not-allowed;font-size:0.78rem;color:var(--win11-text-tertiary);">
        <span style="display:inline-block;width:14px;text-align:center;">∅</span>
        <span style="font-family:monospace;font-size:0.74rem;word-break:break-all;">${escapeHtml(b.sessionKey)}</span>
        <span style="font-size:0.72rem;"> · ${meta}</span>
      </div>`;
    } else {
      // Pre-binding / queued run with no session recorded (AC5 legacy rows).
      main = `<div style="font-size:0.78rem;color:var(--win11-text-tertiary);opacity:0.7;">
        <span style="display:inline-block;width:14px;text-align:center;">?</span>
        no session recorded · ${meta}
      </div>`;
    }

    const convSlot = (b.deepLink && b.deepLink.params && b.runId)
      ? `<div class="tv-conv" id="tvConv-${escapeHtml(b.runId)}" style="display:none;margin:4px 0 6px 20px;"></div>`
      : '';
    return `<div style="padding:3px 0;border-bottom:1px solid var(--win11-border);">${main}${retryNote}${convSlot}</div>`;
  }

  async function loadTaskSessions(task) {
    const holder = root.querySelector('#tvSessions');
    if (!holder) return;
    const taskId = task.id;
    let bindings = [];
    try {
      const payload = await api.tasks.sessions(taskId);
      bindings = Array.isArray(payload?.sessions) ? payload.sessions : [];
    } catch (_) {
      return; // 503 / failure → section absent, silent (§4 interaction rules)
    }
    if (selectedTaskId !== taskId) return; // selection moved on — drop stale render
    if (!bindings.length) return;          // empty list → absent
    holder.innerHTML = `
      <div style="font-size:0.7rem;font-weight:600;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Sessions</div>
      ${bindings.map(tvSessionRowHtml).join('')}
    `;
    holder.innerHTML = `
      <div style="font-size:0.7rem;font-weight:600;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Sessions</div>
      ${bindings.map(tvSessionRowHtml).join('')}
    `;
    holder.querySelectorAll('.tv-session-nav').forEach(btn => {
      const handler = () => {
        navigateToView?.(btn.dataset.view, { params: { agent: btn.dataset.agent, session: btn.dataset.session } });
      };
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });
    // Conversation tab (roadmap candidate): inline expand/collapse per bound
    // session row. Fetches the transcript through the ALREADY-SHIPPED
    // cursor-paginated GET /api/oc/sessions/:sessionId/events route — read-only,
    // zero new write paths.
    holder.querySelectorAll('.tv-conv-toggle').forEach(btn => {
      const handler = () => toggleConversation(btn);
      btn.addEventListener('click', handler);
      cleanupFns.push(() => btn.removeEventListener('click', handler));
    });
  }

  // === Conversation tab (embedded transcript, read-only) ===
  // One open conversation at a time keeps the task-detail DOM bounded; the
  // state map survives collapse so re-expanding does not refetch.
  const convStates = new Map(); // runId → {items, nextAfterLine, hasMore, cap, state}

  function tvBadgeTone(exitCode) {
    if (typeof exitCode === 'number' && Number.isFinite(exitCode)) return exitCode === 0 ? 'good' : 'bad';
    return 'neutral';
  }

  function tvConvItemHtml(item) {
    if (item.type === 'user') {
      return `<div class="tv-conv-bubble user"><span class="tv-conv-who">user</span>${escapeHtml(item.text || '(empty)')}</div>`;
    }
    if (item.type === 'assistant') {
      return `<div class="tv-conv-bubble assistant"><span class="tv-conv-who">assistant</span>${escapeHtml(item.text || '(empty)')}</div>`;
    }
    if (item.type === 'tool') {
      const tone = tvBadgeTone(item.exitCode);
      const mark = item.resolved ? (tone === 'good' ? '✔' : '✖') : '⟳';
      const status = item.resolved
        ? `exitCode ${item.exitCode}`
        : 'no result recorded';
      const args = item.args ? ` <span style="color:var(--win11-text-tertiary,#55607080);">${escapeHtml(item.args)}</span>` : '';
      return `<div style="margin:0 0 6px;"><span class="tv-conv-badge tv-conv-badge-${tone}">${mark} ${escapeHtml(item.name)} · ${status}</span>${args}</div>`;
    }
    return '';
  }

  function renderConversation(runId) {
    const holder = root.querySelector('#tvSessions');
    const slot = holder?.querySelector(`#tvConv-${CSS.escape(runId)}`);
    const st = convStates.get(runId);
    if (!slot || !st) return;
    if (st.state === 'loading') {
      slot.innerHTML = '<div style="font-size:0.72rem;color:var(--win11-text-tertiary);padding:2px 0;">⏳ loading conversation…</div>';
      return;
    }
    if (st.state === 'error') {
      // Zero-throw degradation: inline error + retry + link to full replay.
      const replayParams = st.agentId != null
        ? `agent=${encodeURIComponent(st.agentId)}&session=${encodeURIComponent(st.sessionId)}`
        : '';
      slot.innerHTML = `<div style="font-size:0.72rem;color:#ef4444;padding:2px 0;">⚠ failed to load transcript${st.errorMessage ? ` — ${escapeHtml(st.errorMessage)}` : ''}.
        <button class="tv-action-btn tv-conv-retry" style="margin:0 4px;">Retry</button>
        <a href="/?view=session-replay&amp;${replayParams}" class="tv-conv-replay-link" style="color:var(--win11-accent,#60cdff);">open full Replay →</a></div>`;
      slot.querySelector('.tv-conv-retry').addEventListener('click', () => { void loadConversation(runId, true); });
      slot.querySelector('.tv-conv-replay-link').addEventListener('click', (e) => {
        e.preventDefault();
        navigateToView?.('session-replay', { params: { agent: st.agentId, session: st.sessionId } });
      });
      return;
    }
    const { visible, hiddenOlder } = capChatItems(st.items, st.cap);
    if (!visible.length) {
      // Honest empty state — the transcript exists but recorded no chat events.
      slot.innerHTML = '<div style="font-size:0.72rem;color:var(--win11-text-tertiary);padding:2px 0;">no events recorded</div>';
      return;
    }
    const olderBtn = hiddenOlder > 0
      ? `<button class="tv-action-btn tv-conv-older" style="margin-bottom:6px;">⏶ load earlier (${hiddenOlder} hidden)</button>`
      : '';
    const moreBtn = st.hasMore
      ? `<button class="tv-action-btn tv-conv-more" style="margin-top:6px;">load more ▾</button>`
      : '';
    slot.innerHTML = `${olderBtn}<div class="tv-conv-feed" style="max-height:320px;overflow-y:auto;padding-right:4px;">${visible.map(tvConvItemHtml).join('')}</div>${moreBtn}`;
    slot.querySelector('.tv-conv-older')?.addEventListener('click', () => { st.cap += CONVERSATION_INITIAL_CAP; renderConversation(runId); });
    slot.querySelector('.tv-conv-more')?.addEventListener('click', () => { void loadConversation(runId, true); });
    const feed = slot.querySelector('.tv-conv-feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  async function loadConversation(runId, force = false) {
    const st = convStates.get(runId);
    if (!st || (st.state === 'loading' && !force)) return;
    st.state = 'loading';
    renderConversation(runId);
    try {
      const data = await api.tasks.sessionEvents(st.sessionId, {
        agent: st.agentId,
        afterLine: st.nextAfterLine || 0,
        limit: CONVERSATION_INITIAL_CAP,
      });
      if (data?.notFound) throw new Error('session not found');
      const folded = foldChatPage(st.items, data?.events || []);
      st.items = folded.items;
      st.hasMore = !!data?.hasMore;
      st.nextAfterLine = data?.hasMore ? data.nextAfterLine : null;
      st.state = 'ready';
    } catch (err) {
      st.state = 'error';
      st.errorMessage = err?.message || 'fetch failed';
    }
    if (selectedTaskId !== st.taskId) return; // selection moved on — drop stale render
    renderConversation(runId);
  }

  function toggleConversation(btn) {
    const runId = btn.dataset.runId;
    const slot = root.querySelector(`#tvConv-${CSS.escape(runId)}`);
    if (!slot) return;
    const isOpen = slot.style.display !== 'none';
    if (isOpen) {
      slot.style.display = 'none';
      btn.textContent = 'Conversation ▸';
      return;
    }
    // Collapse any other open conversation — one at a time keeps DOM bounded.
    root.querySelectorAll('.tv-conv-toggle').forEach(other => {
      if (other !== btn) {
        other.textContent = 'Conversation ▸';
        const otherSlot = root.querySelector(`#tvConv-${CSS.escape(other.dataset.runId)}`);
        if (otherSlot) otherSlot.style.display = 'none';
      }
    });
    slot.style.display = 'block';
    btn.textContent = 'Conversation ▾';
    if (!convStates.has(runId)) {
      convStates.set(runId, {
        taskId: selectedTaskId,
        sessionId: btn.dataset.session,
        agentId: btn.dataset.agent,
        items: [],
        nextAfterLine: 0,
        hasMore: false,
        cap: CONVERSATION_INITIAL_CAP,
        state: 'idle',
        errorMessage: '',
      });
    }
    const st = convStates.get(runId);
    if (st.state === 'idle' || st.state === 'error') void loadConversation(runId, st.state === 'error');
    else renderConversation(runId);
  }

  // === Composer ===
  function toggleComposer(show) {
    const composer = root.querySelector('#tvComposer');
    if (show === undefined) show = composer.style.display === 'none';
    composer.style.display = show ? 'block' : 'none';
    if (show) {
      const titleInput = composer.querySelector('#tvNewTitle');
      titleInput.focus();
    }
  }

  function resetComposer() {
    const c = root.querySelector('#tvComposer');
    if (!c) return;
    c.querySelector('#tvNewTitle').value = '';
    c.querySelector('#tvNewCategory').value = '';
    c.querySelector('#tvNewStatus').value = 'backlog';
    c.querySelector('#tvNewDesc').value = '';
    c.querySelector('#tvNewPriority').value = 'medium';
    c.querySelector('#tvNewRecurrence').value = 'none';
    c.querySelector('#tvNewStart').value = '';
    c.querySelector('#tvNewDue').value = '';
    const ownerSelect = c.querySelector('#tvNewOwner');
    if (ownerSelect) ownerSelect.value = '';
    const modelSelect = c.querySelector('#tvNewModel');
    if (modelSelect) modelSelect.value = FALLBACK_DEFAULT_MODEL;
  }

  async function handleCreateTask() {
    const title = root.querySelector('#tvNewTitle').value.trim();
    if (!title) { showNotice('Please enter a task description.', 'error'); root.querySelector('#tvNewTitle').focus(); return; }

    const projId = currentProjectId && currentProjectId !== 'all' ? currentProjectId : (projects[0]?.id || '');
    if (!projId) { showNotice('Select a project first.', 'error'); return; }

    const preferredModel = root.querySelector('#tvNewModel').value || FALLBACK_DEFAULT_MODEL;
    const status = root.querySelector('#tvNewStatus').value;
    const recurrence = root.querySelector('#tvNewRecurrence').value;
    const category = root.querySelector('#tvNewCategory').value.trim() || 'General';

    try {
      await api.tasks.create({
        project_id: projId,
        title,
        text: title,
        description: root.querySelector('#tvNewDesc').value.trim() || '',
        category,
        labels: [category],
        owner: root.querySelector('#tvNewOwner').value || null,
        status,
        priority: root.querySelector('#tvNewPriority').value,
        start_date: root.querySelector('#tvNewStart').value || null,
        due_date: root.querySelector('#tvNewDue').value || null,
        recurrence_rule: recurrence !== 'none' ? recurrence : null,
        metadata: buildTaskMetadata({}, { preferredModel }),
      });
      resetComposer();
      toggleComposer(false);
      showNotice('Task added successfully.', 'success');
      await loadTasks();
    } catch (e) {
      showNotice('Failed to add task.', 'error');
      console.error('[TasksView] create error:', e);
    }
  }

  // === Edit Modal ===
  function showEditModal(task) {
    const form = document.createElement('div');
    form.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:12px;padding:18px;z-index:1000;width:92%;max-width:520px;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

    const preferredModel = task.metadata?.openclaw?.preferred_model || '';
    const status = getTaskStatus(task);

    form.innerHTML = `
      <h3 style="margin:0 0 12px;color:var(--win11-text);font-size:1rem;">Edit Task</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;">
        <div style="grid-column:1/-1;">
          <label class="tv-compose-label">Title</label>
          <input class="tv-input" type="text" id="tvEditTitle" value="${escapeHtml(task.title || task.text || '')}" />
        </div>
        <div style="grid-column:1/-1;">
          <label class="tv-compose-label">Description</label>
          <textarea class="tv-textarea" id="tvEditDesc" rows="2">${escapeHtml(task.description || '')}</textarea>
        </div>
        <div>
          <label class="tv-compose-label">Status</label>
          <select class="tv-select" id="tvEditStatus">
            ${STATUS_OPTIONS.map(s => `<option value="${s.value}"${status === s.value ? ' selected' : ''}>${s.label}</option>`).join('')}
            <option value="completed"${status === 'completed' ? ' selected' : ''}>Completed</option>
            <option value="archived"${status === 'archived' ? ' selected' : ''}>Archived</option>
          </select>
        </div>
        <div>
          <label class="tv-compose-label">Priority</label>
          <select class="tv-select" id="tvEditPriority">
            ${PRIORITY_OPTIONS.map(p => `<option value="${p.value}"${task.priority === p.value ? ' selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="tv-compose-label">Category</label>
          <input class="tv-input" type="text" id="tvEditCategory" value="${escapeHtml(task.category || '')}" />
        </div>
        <div>
          <label class="tv-compose-label">Owner</label>
          <select class="tv-select" id="tvEditOwner">
            <option value="">Unassigned</option>
            ${cachedAgents.map(a => `<option value="${escapeHtml(a.id)}"${task.owner === a.id ? ' selected' : ''}>${escapeHtml(a.name || a.id)}</option>`).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1;">
          <label class="tv-compose-label">LLM model</label>
          <select class="tv-select" id="tvEditModel">
            <option value="">No model preference</option>
            ${buildModelOptions(preferredModel)}
          </select>
        </div>
        <div>
          <label class="tv-compose-label">Recurrence</label>
          <select class="tv-select" id="tvEditRecurrence">
            ${RECURRENCE_OPTIONS.map(r => `<option value="${r.value}"${(task.recurrence_rule || 'none') === r.value ? ' selected' : ''}>${r.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="tv-compose-label">Start date</label>
          <input class="tv-input" type="date" id="tvEditStart" value="${task.start_date || ''}" />
        </div>
        <div>
          <label class="tv-compose-label">Due date</label>
          <input class="tv-input" type="date" id="tvEditDue" value="${task.due_date || ''}" />
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        <button class="tv-action-btn primary" id="tvEditSave">Save</button>
        <button class="tv-action-btn" id="tvEditCancelBtn">Cancel</button>
      </div>
    `;

    // Backdrop click to close
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:999;';
    document.body.appendChild(backdrop);
    document.body.appendChild(form);

    const doSave = async () => {
      const titleVal = form.querySelector('#tvEditTitle').value.trim();
      if (!titleVal) { form.querySelector('#tvEditTitle').style.borderColor = '#ef4444'; return; }
      const modelVal = form.querySelector('#tvEditModel').value;
      const recurrenceVal = form.querySelector('#tvEditRecurrence').value;
      const newStatus = form.querySelector('#tvEditStatus').value;
      const newOwner = form.querySelector('#tvEditOwner').value || '';
      const ownerChanged = newOwner !== (task.owner || '');

      // One-click actions slice 2: owner set/change routes through the gated
      // task.assign action (LOW severity → NONE mode, fires immediately with a
      // receipt). Unassign stays on the raw PATCH — registry v1 requires a
      // non-empty owner, and scripts keep the raw endpoint regardless.
      if (ownerChanged && newOwner) {
        const assign = await executeAction({ kind: 'task.assign', targetId: task.id, params: { owner: newOwner } });
        if (!assign.ok) return; // gate refused/blocked — abort so fields never half-move
      }

      try {
        await api.tasks.update(task.id, {
          title: titleVal,
          text: titleVal,
          description: form.querySelector('#tvEditDesc').value.trim() || null,
          status: newStatus,
          priority: form.querySelector('#tvEditPriority').value,
          ...(ownerChanged && newOwner ? {} : { owner: newOwner || null }), // gated path already moved ownership
          category: form.querySelector('#tvEditCategory').value.trim() || null,
          labels: form.querySelector('#tvEditCategory').value.trim() ? [form.querySelector('#tvEditCategory').value.trim()] : [],
          start_date: form.querySelector('#tvEditStart').value || null,
          due_date: form.querySelector('#tvEditDue').value || null,
          recurrence_rule: recurrenceVal !== 'none' ? recurrenceVal : null,
          metadata: buildTaskMetadata(task.metadata || {}, { preferredModel: modelVal || '' }),
        });
        form.remove(); backdrop.remove();
        await loadTasks(); renderDetail();
      } catch (e) { alert('Update failed: ' + e.message); }
    };
    const doCancel = () => { form.remove(); backdrop.remove(); };
    const doBackdrop = (e) => { if (e.target === backdrop) doCancel(); };

    form.querySelector('#tvEditSave').addEventListener('click', doSave);
    form.querySelector('#tvEditCancelBtn').addEventListener('click', doCancel);
    backdrop.addEventListener('click', doBackdrop);
    form.querySelector('#tvEditTitle').focus();
    cleanupFns.push(() => {
      form.querySelector('#tvEditSave')?.removeEventListener('click', doSave);
      form.querySelector('#tvEditCancelBtn')?.removeEventListener('click', doCancel);
      backdrop.removeEventListener('click', doBackdrop);
      form.remove(); backdrop.remove();
    });
  }

  // === Export / Import ===
  function handleExportJson() {
    const data = JSON.stringify(tasks, null, 2);
    downloadFile(data, 'tasks.json', 'application/json');
  }

  function handleExportCsv() {
    const headers = ['ID', 'Title', 'Category', 'Status', 'Priority', 'Owner', 'Completed', 'Created', 'Updated', 'Due Date'];
    const rows = tasks.map(t => [
      t.id,
      `"${(t.title || t.text || '').replace(/"/g, '""')}"`,
      t.category || '',
      t.status || '',
      t.priority || '',
      t.owner || '',
      isTaskCompleted(t) ? 'Yes' : 'No',
      t.created_at || t.createdAt || '',
      t.updated_at || t.updatedAt || '',
      t.due_date || ''
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    downloadFile(csv, 'tasks.csv', 'text/csv');
  }

  function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target.result;
        let imported;
        if (file.name.endsWith('.json')) {
          imported = JSON.parse(content);
        } else if (file.name.endsWith('.csv')) {
          const lines = content.split('\n').filter(l => l.trim());
          if (lines.length < 2) throw new Error('CSV too short');
          const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          imported = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, i) => obj[h.toLowerCase()] = vals[i] || '');
            return obj;
          });
        } else {
          throw new Error('Unsupported file format');
        }
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        const projId = currentProjectId && currentProjectId !== 'all' ? currentProjectId : (projects[0]?.id || '');
        if (!projId) { showNotice('Select a project first.', 'error'); return; }
        let count = 0;
        for (const t of imported) {
          const title = t.title || t.text || t.name || '';
          if (!title) continue;
          try {
            await api.tasks.create({
              project_id: projId,
              title,
              text: title,
              description: t.description || '',
              category: t.category || 'General',
              priority: t.priority || 'medium',
              owner: t.owner || null,
            });
            count++;
          } catch (err) { /* skip bad rows */ }
        }
        showNotice(`Imported ${count} tasks.`, 'success');
        await loadTasks();
      } catch (e) {
        showNotice('Import failed: ' + e.message, 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  }

  async function handleArchiveCompleted() {
    const completed = tasks.filter(t => isTaskCompleted(t) && !isTaskArchived(t));
    if (completed.length === 0) { showNotice('No completed tasks to archive.', ''); return; }
    if (!confirm(`Archive ${completed.length} completed tasks?`)) return;
    let count = 0;
    for (const t of completed) {
      try { await api.tasks.archive(t.id); count++; } catch (e) { /* skip */ }
    }
    showNotice(`Archived ${count} tasks.`, 'success');
    await loadTasks();
  }

  // === Event Wiring ===
  function wireEvent(selector, event, handler) {
    const el = root.querySelector(selector);
    if (!el) return;
    el.addEventListener(event, handler);
    cleanupFns.push(() => el.removeEventListener(event, handler));
  }

  wireEvent('#tvProjectSelect', 'change', (e) => {
    currentProjectId = e.target.value || null;
    selectedTaskId = null;
    listShownCount = LIST_INITIAL_CAP;
    loadTasks();
    renderDetail();
  });

  root.querySelectorAll('.tv-filter').forEach(btn => {
    const handler = () => {
      currentFilter = btn.dataset.filter;
      root.querySelectorAll('.tv-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      listShownCount = LIST_INITIAL_CAP;
      renderList();
    };
    btn.addEventListener('click', handler);
    cleanupFns.push(() => btn.removeEventListener('click', handler));
  });

  let searchTimer = null;
  wireEvent('#tvSearch', 'input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = e.target.value.trim(); listShownCount = LIST_INITIAL_CAP; renderList(); }, 200);
  });

  wireEvent('#tvCategoryFilter', 'change', (e) => {
    categoryFilter = e.target.value;
    listShownCount = LIST_INITIAL_CAP;
    renderList();
  });

  wireEvent('#tvSort', 'change', (e) => { sortValue = e.target.value; listShownCount = LIST_INITIAL_CAP; renderList(); });

  wireEvent('#tvNewBtn', 'click', () => toggleComposer(true));
  wireEvent('#tvToggleComposer', 'click', () => toggleComposer(false));
  wireEvent('#tvCreateSubmit', 'click', handleCreateTask);
  wireEvent('#tvCreateCancel', 'click', () => { resetComposer(); toggleComposer(false); });

  // Quick create: Enter in title field
  wireEvent('#tvNewTitle', 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCreateTask(); }
  });

  wireEvent('#tvExportJson', 'click', handleExportJson);
  wireEvent('#tvExportCsv', 'click', handleExportCsv);
  wireEvent('#tvImportFile', 'change', handleImport);
  wireEvent('#tvArchiveCompleted', 'click', handleArchiveCompleted);

  // === Sync subscription ===
  if (sync) {
    syncUnsubscribe = sync.subscribe(async () => {
      const spinner = root.querySelector('#tvRefreshSpinner');
      if (spinner) spinner.style.display = 'inline-block';
      try { await loadTasks(); } finally {
        if (spinner) spinner.style.display = 'none';
      }
    });
  }

  // === Init ===
  await loadProjects();
  await loadTaskOptions();
  // Fix 6: Handle agentFilter from agent navigation
  if (params.agentFilter) {
    searchQuery = params.agentFilter;
  }
  await loadTasks();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderTasksView;
