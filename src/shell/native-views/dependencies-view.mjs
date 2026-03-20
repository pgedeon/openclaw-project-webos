import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderDependenciesView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let allTasks = [];
  let projects = [];
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;
  let selectedProjectId = '';

  const style = document.createElement('style');
  style.textContent = `
    .dpd-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px;transition:border-color 0.15s; }
    .dpd-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .dpd-btn:hover { background:var(--win11-surface-active); }
    .dpd-btn.primary { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .dpd-btn.danger:hover { border-color:#ef4444;color:#ef4444; }
    .dpd-input,.dpd-select,.dpd-textarea {
      width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);
      background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none;box-sizing:border-box;
    }
    .dpd-input:focus,.dpd-select:focus,.dpd-textarea:focus { border-color:var(--win11-accent); }
    .dpd-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .dpd-notice.is-visible { display:block; }
    .dpd-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .dpd-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }
    .dpd-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .dpd-badge--cross { background:rgba(168,85,247,0.15);color:#a855f7; }
    .dpd-badge--internal { background:rgba(96,205,255,0.1);color:var(--win11-accent); }
    .dpd-arrow { color:var(--win11-text-tertiary);font-size:0.9rem; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">🔗 Cross-Board Dependencies</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Tasks that depend on tasks from other projects.</p>
        </div>
        <button id="dpdRefresh" class="dpd-btn">↻ Refresh</button>
      </div>
      <div id="dpdStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <select id="dpdProjectFilter" class="dpd-select" style="width:auto;min-width:200px;"><option value="">All projects</option></select>
        <input id="dpdSearch" type="text" placeholder="Search tasks..." style="flex:1;min-width:140px;padding:5px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;outline:none;" />
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div id="dpdContent"></div>
    </div>
    <div id="dpdNotice" class="dpd-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#dpdNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `dpd-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'dpd-notice'; }, 4000);
  }

  function projectName(id) {
    const p = projects.find(pr => pr.id === id);
    return p ? p.name : (id || '—').substring(0, 8) + '...';
  }

  function analyze() {
    // Build a lookup map of task IDs → task objects across all projects
    const taskMap = {};
    for (const t of allTasks) {
      if (t.id) taskMap[t.id] = t;
    }

    // Find tasks with dependencies
    const withDeps = allTasks.filter(t => t.dependency_ids && t.dependency_ids.length > 0);

    // Classify: cross-board (dependency in different project) vs internal
    const crossBoard = [];
    const internal = [];
    for (const t of withDeps) {
      for (const depId of t.dependency_ids) {
        const dep = taskMap[depId];
        const isCrossBoard = dep && dep.project_id !== t.project_id;
        const entry = {
          task: t,
          dependency: dep || null,
          depId,
          isCrossBoard,
          depProject: dep ? dep.project_id : 'unknown',
        };
        if (isCrossBoard) crossBoard.push(entry);
        else internal.push(entry);
      }
    }

    return { withDeps, crossBoard, internal, taskMap };
  }

  function renderStats(analysis) {
    const { withDeps, crossBoard, internal } = analysis;
    root.querySelector('#dpdStats').innerHTML = [
      createStatCard({ label:'Tasks with Deps', value:formatCount(withDeps.length) }),
      createStatCard({ label:'Cross-Board', value:formatCount(crossBoard.length), tone: crossBoard.length > 0 ? 'warning' : 'default' }),
      createStatCard({ label:'Internal', value:formatCount(internal.length), tone:'info' }),
      createStatCard({ label:'Projects Scanned', value:formatCount(projects.length) }),
    ].map(c => c.outerHTML).join('');
  }

  function renderContent() {
    const content = root.querySelector('#dpdContent');
    const analysis = analyze();
    renderStats(analysis);

    const projectFilter = root.querySelector('#dpdProjectFilter')?.value || '';
    const search = (root.querySelector('#dpdSearch')?.value || '').trim().toLowerCase();

    // Apply filters
    let filtered = analysis.crossBoard;
    if (projectFilter) {
      filtered = filtered.filter(d => d.task.project_id === projectFilter || d.depProject === projectFilter);
    }
    if (search) {
      filtered = filtered.filter(d => {
        const haystack = `${d.task.title || ''} ${d.task.text || ''} ${d.dependency?.title || ''} ${projectName(d.task.project_id)} ${projectName(d.depProject)}`.toLowerCase();
        return haystack.includes(search);
      });
    }

    if (analysis.crossBoard.length === 0) {
      content.innerHTML = `
        <div style="text-align:center;padding:40px 20px;">
          <div style="font-size:3rem;margin-bottom:12px;opacity:0.5;">🔗</div>
          <h3 style="margin:0 0 8px;color:var(--win11-text);font-size:1rem;font-weight:600;">No Cross-Board Dependencies</h3>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;max-width:400px;margin:0 auto;">
            No tasks currently have dependencies on tasks from other projects.
            Dependencies are tracked via the <code style="background:var(--win11-surface);padding:1px 4px;border-radius:3px;font-size:0.78rem;">dependency_ids</code> field on tasks.
          </p>
        </div>`;
      return;
    }

    if (filtered.length === 0) {
      content.innerHTML = `<div style="text-align:center;padding:32px;color:var(--win11-text-tertiary);">${search || projectFilter ? 'No dependencies match filters.' : 'No cross-board dependencies found.'}</div>`;
      return;
    }

    content.innerHTML = `<div style="display:grid;gap:8px;">
      ${filtered.map(d => {
        const t = d.task;
        const dep = d.dependency;
        const tProject = projectName(t.project_id);
        const dProject = projectName(d.depProject);
        const tStatus = t.status || 'unknown';
        const dStatus = dep?.status || 'unknown';
        const blocked = tStatus === 'blocked';

        return `<div class="dpd-card" style="${blocked ? 'border-left:3px solid #ef4444;' : 'border-left:3px solid #a855f7;'}">
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;">
            <div style="min-width:0;">
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Dependent Task</div>
              <div style="font-weight:600;font-size:0.85rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.title || t.text || '')}">${escapeHtml(t.title || t.text || 'Untitled')}</div>
              <div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;">${escapeHtml(tProject)} · <span style="color:${blocked ? '#ef4444' : 'var(--win11-text-tertiary)'};">${escapeHtml(tStatus)}</span></div>
            </div>
            <div style="text-align:center;">
              <div class="dpd-arrow">← depends on</div>
            </div>
            <div style="min-width:0;">
              <div style="font-size:0.7rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">Dependency</div>
              <div style="font-weight:600;font-size:0.85rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(dep?.title || dep?.text || d.depId || '')}">${escapeHtml(dep?.title || dep?.text || d.depId || 'Unknown task')}</div>
              <div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;">${escapeHtml(dProject)} · ${escapeHtml(dStatus)}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  async function loadAll() {
    try {
      const projRes = await api.projects.list();
      projects = Array.isArray(projRes) ? projRes : [];

      root.querySelector('#dpdProjectFilter').innerHTML = '<option value="">All projects</option>' +
        projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');

      // Load tasks from all projects in parallel (batch by project)
      const taskPromises = projects.map(p =>
        api.tasks.list({ project_id: p.id }).catch(() => [])
      );
      const results = await Promise.allSettled(taskPromises);
      allTasks = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const arr = Array.isArray(r.value) ? r.value : (r.value?.tasks || []);
          allTasks.push(...arr);
        }
      }

      renderContent();
    } catch (e) {
      root.querySelector('#dpdContent').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed to load: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelector('#dpdProjectFilter')?.addEventListener('change', renderContent);
  let searchTimer = null;
  root.querySelector('#dpdSearch')?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderContent, 200); });
  root.querySelector('#dpdRefresh')?.addEventListener('click', loadAll);

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadAll());
  }

  await loadAll();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderDependenciesView;
