import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderWorkflowsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'workflows-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let templates = [];
  let runs = [];
  let projects = [];
  let agents = [];
  let selectedTemplateId = null;
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;

  const style = document.createElement('style');
  style.textContent = `
    .wfv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:12px;cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s; }
    .wfv-card:hover { border-color:var(--win11-accent);box-shadow:0 0 0 1px var(--win11-accent); }
    .wfv-card.selected { border-color:var(--win11-accent);box-shadow:0 0 0 2px var(--win11-accent); }
    .wfv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;white-space:nowrap; }
    .wfv-btn:hover { background:var(--win11-surface-active); }
    .wfv-btn.primary { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .wfv-btn.primary:hover { opacity:0.9; }
    .wfv-btn.danger { border-color:#ef4444;color:#ef4444; }
    .wfv-btn.danger:hover { background:rgba(239,68,68,0.1); }
    .wfv-input,.wfv-select,.wfv-textarea {
      width:100%;padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);
      background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none;box-sizing:border-box;
    }
    .wfv-input:focus,.wfv-select:focus,.wfv-textarea:focus { border-color:var(--win11-accent); }
    .wfv-textarea { resize:vertical;font-family:inherit; }
    .wfv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .wfv-notice.is-visible { display:block; }
    .wfv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
    .wfv-notice.is-success { background:rgba(34,197,94,0.1);color:#22c55e;border-color:rgba(34,197,94,0.2); }
    .wfv-badge { display:inline-block;font-size:0.68rem;padding:1px 6px;border-radius:3px;font-weight:600; }
    .wfv-badge--running { background:rgba(96,205,255,0.1);color:var(--win11-accent);animation:wfv-pulse 2s infinite; }
    .wfv-badge--completed { background:rgba(34,197,94,0.15);color:#22c55e; }
    .wfv-badge--failed { background:rgba(239,68,68,0.15);color:#ef4444; }
    .wfv-badge--queued { background:rgba(234,179,8,0.15);color:#eab308; }
    @keyframes wfv-pulse { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
    .wfv-step { display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;padding:3px 8px;border-radius:4px;background:var(--win11-surface);border:1px solid var(--win11-border); }
    .wfv-step-dot { width:6px;height:6px;border-radius:50%; }
    .wfv-run-row { display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid var(--win11-border);transition:background 0.1s; }
    .wfv-run-row:hover { background:rgba(96,205,255,0.04); }
    .wfv-tab { padding:6px 14px;border-radius:6px 6px 0 0;border:1px solid var(--win11-border);border-bottom:none;background:var(--win11-surface-solid);color:var(--win11-text-secondary);cursor:pointer;font-size:0.82rem; }
    .wfv-tab.active { background:var(--win11-surface);color:var(--win11-text);font-weight:600;border-bottom:2px solid var(--win11-accent); }
    .wfv-trigger-panel { background:var(--win11-surface);border:1px solid var(--win11-border);border-radius:10px;padding:14px;margin-bottom:16px; }
  `;
  root.appendChild(style);

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">⚡ Workflows</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Click a template to configure and trigger a workflow run.</p>
        </div>
        <button id="wfvRefresh" class="wfv-btn">↻ Refresh</button>
      </div>
      <div id="wfvStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <input id="wfvSearch" type="text" placeholder="Search templates..." style="flex:1;min-width:140px;padding:5px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.82rem;outline:none;" />
        <select id="wfvCatFilter" class="wfv-select" style="width:auto;min-width:130px;"><option value="">All categories</option></select>
      </div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div id="wfvTriggerPanel" style="display:none;margin-bottom:16px;"></div>
      <h3 style="margin:0 0 10px;font-size:0.95rem;color:var(--win11-text);">Templates (<span id="wfvTemplateCount">0</span>)</h3>
      <div id="wfvTemplates" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-bottom:24px;"></div>
      <h3 style="margin:0 0 10px;font-size:0.95rem;color:var(--win11-text);">Recent Runs (<span id="wfvRunCount">0</span>)</h3>
      <div id="wfvRuns" style="background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;overflow:hidden;"></div>
    </div>
    <div id="wfvNotice" class="wfv-notice"></div>
  `;
  mountNode.appendChild(root);

  function showNotice(msg, type = '') {
    const el = root.querySelector('#wfvNotice');
    if (!el) return;
    el.textContent = msg;
    el.className = `wfv-notice is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { el.className = 'wfv-notice'; }, 5000);
  }

  function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return d; } }

  function statusBadge(s) {
    const cls = s === 'running' || s === 'active' ? 'running' : s === 'completed' || s === 'done' ? 'completed' : s === 'failed' || s === 'error' ? 'failed' : 'queued';
    return `<span class="wfv-badge wfv-badge--${cls}">${escapeHtml(s)}</span>`;
  }

  function renderStats() {
    const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'active');
    const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'error');
    root.querySelector('#wfvStats').innerHTML = [
      createStatCard({ label:'Templates', value:formatCount(templates.length) }),
      createStatCard({ label:'Total Runs', value:formatCount(runs.length) }),
      createStatCard({ label:'Active', value:formatCount(activeRuns.length), tone: activeRuns.length > 0 ? 'success' : 'default' }),
      createStatCard({ label:'Failed', value:formatCount(failedRuns.length), tone: failedRuns.length > 0 ? 'danger' : 'default' }),
    ].map(c => c.outerHTML).join('');
  }

  function getFilteredTemplates() {
    const q = (root.querySelector('#wfvSearch')?.value || '').trim().toLowerCase();
    const cat = root.querySelector('#wfvCatFilter')?.value || '';
    return templates.filter(t => {
      if (cat && t.category !== cat) return false;
      if (q) {
        const searchable = `${t.name} ${t.display_name} ${t.description} ${t.default_owner_agent} ${t.category}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    });
  }

  function renderTemplates() {
    const grid = root.querySelector('#wfvTemplates');
    const filtered = getFilteredTemplates();
    root.querySelector('#wfvTemplateCount').textContent = filtered.length;

    if (!filtered.length) {
      grid.innerHTML = '<div style="padding:20px;text-align:center;color:var(--win11-text-tertiary);font-size:0.85rem;">No templates match.</div>';
      return;
    }

    grid.innerHTML = filtered.map(t => {
      const id = t.id || t.name;
      const isSelected = id === selectedTemplateId;
      const name = t.display_name || t.name;
      const desc = t.description || '';
      const steps = Array.isArray(t.steps) ? t.steps : [];
      const agent = t.default_owner_agent || '';
      const cat = t.category || '';
      const active = t.is_active !== false;
      return `<div class="wfv-card${isSelected ? ' selected' : ''}" data-tpl-id="${escapeHtml(id)}" style="opacity:${active ? '1' : '0.5'};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px;">
          <div style="font-weight:600;font-size:0.85rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          ${isSelected ? '<span style="font-size:0.9rem;color:var(--win11-accent);">▼</span>' : ''}
        </div>
        ${desc ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-bottom:6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(desc)}</div>` : ''}
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
          ${cat ? `<span class="wfv-badge" style="background:rgba(96,205,255,0.08);color:var(--win11-accent);">${escapeHtml(cat)}</span>` : ''}
          <span style="font-size:0.7rem;color:var(--win11-text-tertiary);">${steps.length} steps</span>
          ${agent ? `<span style="font-size:0.7rem;color:var(--win11-text-secondary);margin-left:auto;">→ ${escapeHtml(agent)}</span>` : ''}
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.wfv-card').forEach(card => {
      const h = () => {
        const newId = card.dataset.tplId;
        selectedTemplateId = newId === selectedTemplateId ? null : newId;
        renderTemplates();
        renderTriggerPanel();
      };
      card.addEventListener('click', h);
      cleanupFns.push(() => card.removeEventListener('click', h));
    });
  }

  function renderTriggerPanel() {
    const panel = root.querySelector('#wfvTriggerPanel');
    if (!selectedTemplateId) { panel.style.display = 'none'; return; }

    const tpl = templates.find(t => (t.id || t.name) === selectedTemplateId);
    if (!tpl) { panel.style.display = 'none'; return; }

    const steps = Array.isArray(tpl.steps) ? tpl.steps : [];
    const defaultAgent = tpl.default_owner_agent || '';
    const name = tpl.display_name || tpl.name;

    panel.style.display = 'block';
    panel.innerHTML = `<div class="wfv-trigger-panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;color:var(--win11-text);font-size:1rem;font-weight:600;">🚀 Trigger: ${escapeHtml(name)}</h3>
        <button id="wfvCloseTrigger" style="background:none;border:none;color:var(--win11-text-tertiary);cursor:pointer;font-size:1.1rem;" title="Close">✕</button>
      </div>

      ${tpl.description ? `<p style="margin:0 0 12px;color:var(--win11-text-secondary);font-size:0.85rem;">${escapeHtml(tpl.description)}</p>` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        ${steps.map((s, i) => {
          const req = s.required !== false;
          return `<div class="wfv-step"><span class="wfv-step-dot" style="background:${req ? 'var(--win11-accent)' : 'var(--win11-text-tertiary)'};"></span>${escapeHtml(s.display_name || s.name)}${!req ? ' (opt)' : ''}</div>`;
        }).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div>
          <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Assign to agent</label>
          <select class="wfv-select" id="wfvAgent">
            <option value="">Use default (${escapeHtml(defaultAgent)})</option>
            ${agents.map(a => `<option value="${escapeHtml(a.name || a.id)}">${escapeHtml(a.displayName || a.name || a.id)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Priority</label>
          <select class="wfv-select" id="wfvPriority">
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Link to task (optional)</label>
        <select class="wfv-select" id="wfvTask">
          <option value="">No task</option>
        </select>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Instructions for the workflow *</label>
        <textarea class="wfv-textarea" id="wfvInstructions" rows="3" placeholder="Describe what this workflow should do, any specific targets, URLs, content to process..."></textarea>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;color:var(--win11-text-secondary);display:block;margin-bottom:3px;">Input payload (JSON, optional)</label>
        <textarea class="wfv-textarea" id="wfvPayload" rows="3" placeholder='{"url": "https://...", "post_id": "123"}' style="font-family:monospace;font-size:0.78rem;"></textarea>
      </div>

      <div style="display:flex;gap:8px;align-items:center;">
        <button id="wfvTriggerBtn" class="wfv-btn primary" style="padding:6px 20px;font-size:0.85rem;">⚡ Trigger Workflow</button>
        <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">Creates a run and starts it immediately</span>
      </div>
    </div>`;

    // Wire close button
    panel.querySelector('#wfvCloseTrigger')?.addEventListener('click', () => {
      selectedTemplateId = null;
      renderTemplates();
      renderTriggerPanel();
    });

    // Wire trigger button
    panel.querySelector('#wfvTriggerBtn')?.addEventListener('click', handleTrigger);
  }

  async function handleTrigger() {
    const instructions = root.querySelector('#wfvInstructions')?.value?.trim();
    if (!instructions) {
      showNotice('Please provide instructions for the workflow.', 'error');
      root.querySelector('#wfvInstructions')?.focus();
      return;
    }

    const tpl = templates.find(t => (t.id || t.name) === selectedTemplateId);
    if (!tpl) return;

    const agentSelect = root.querySelector('#wfvAgent')?.value;
    const agent = agentSelect || tpl.default_owner_agent || '';
    const priority = root.querySelector('#wfvPriority')?.value || 'normal';
    const taskId = root.querySelector('#wfvTask')?.value || null;
    const btn = root.querySelector('#wfvTriggerBtn');

    // Parse optional JSON payload
    let extraPayload = {};
    const payloadStr = root.querySelector('#wfvPayload')?.value?.trim();
    if (payloadStr) {
      try {
        extraPayload = JSON.parse(payloadStr);
      } catch {
        showNotice('Invalid JSON in input payload.', 'error');
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = 'Starting...';

    try {
      // Create the workflow run
      const run = await api.workflows.create({
        workflow_type: tpl.name,
        owner_agent_id: agent || null,
        task_id: taskId || null,
        initiator: 'dashboard-operator',
        run_priority: priority,
        input_payload: {
          instructions,
          ...extraPayload,
        },
      });

      if (!run?.id) throw new Error('No run ID returned from create');

      // Start it immediately
      await api.workflows.start(run.id);

      showNotice(`Workflow "${tpl.display_name || tpl.name}" triggered → run ${run.id.substring(0, 8)} assigned to ${agent || 'default'}.`, 'success');

      // Reset form
      root.querySelector('#wfvInstructions').value = '';
      root.querySelector('#wfvPayload').value = '';
      selectedTemplateId = null;
      renderTemplates();
      renderTriggerPanel();

      // Refresh runs list
      await loadRuns();
    } catch (err) {
      showNotice(`Failed to trigger workflow: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ Trigger Workflow';
    }
  }

  function renderRuns() {
    const container = root.querySelector('#wfvRuns');
    root.querySelector('#wfvRunCount').textContent = runs.length;

    if (!runs.length) {
      container.innerHTML = '<div style="padding:20px;color:var(--win11-text-tertiary);font-size:0.85rem;text-align:center;">No workflow runs yet.</div>';
      return;
    }

    container.innerHTML = runs.slice(0, 50).map(r => {
      const name = r.name || r.workflow_name || r.template_name || r.title || `Run ${r.id?.substring(0,8) || '?'}`;
      const status = r.status || 'unknown';
      const agent = r.owner_agent_id || '';
      const stepsCompleted = r.stepsCompleted || r.steps_completed || '';
      const totalSteps = r.totalSteps || r.total_steps || '';
      const currentStep = r.current_step || '';
      const stepsLabel = stepsCompleted && totalSteps ? `${stepsCompleted}/${totalSteps}` : '';
      const inputTitle = r.input_payload?.title || r.input_payload?.instructions || '';

      return `<div class="wfv-run-row">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:500;font-size:0.83rem;color:var(--win11-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(name)}">${escapeHtml(name.length > 80 ? name.substring(0,80)+'...' : name)}</div>
          <div style="font-size:0.72rem;color:var(--win11-text-secondary);margin-top:2px;">
            ${agent ? `→ ${escapeHtml(agent)} · ` : ''}${fmtDate(r.started_at || r.created_at)}
            ${inputTitle ? ` · <span style="color:var(--win11-text-tertiary);">${escapeHtml(inputTitle.length > 60 ? inputTitle.substring(0,60)+'...' : inputTitle)}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:12px;">
          ${currentStep ? `<span style="font-size:0.7rem;color:var(--win11-text-tertiary);">${escapeHtml(currentStep)}</span>` : ''}
          ${stepsLabel ? `<span style="font-size:0.7rem;color:var(--win11-text-tertiary);">${stepsLabel} steps</span>` : ''}
          ${statusBadge(status)}
        </div>
      </div>`;
    }).join('');
  }

  async function loadTemplates() {
    try {
      const res = await api.workflows.templates();
      templates = Array.isArray(res?.templates) ? res.templates : (Array.isArray(res) ? res : []);
      // Build category filter
      const cats = [...new Set(templates.map(t => t.category).filter(Boolean))].sort();
      root.querySelector('#wfvCatFilter').innerHTML = '<option value="">All categories</option>' +
        cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      renderTemplates();
    } catch (e) {
      root.querySelector('#wfvTemplates').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  async function loadRuns() {
    try {
      const res = await api.workflows.runs({ limit: 50 });
      runs = Array.isArray(res?.runs) ? res.runs : (Array.isArray(res) ? res : []);
      renderRuns();
    } catch (e) { /* ok */ }
  }

  async function loadMeta() {
    try { const r = await api.projects.list(); projects = Array.isArray(r) ? r : []; } catch { projects = []; }
    try { const r = await api.org.agents.list(); agents = Array.isArray(r) ? r : []; } catch { agents = []; }

    // Populate task dropdown (recent tasks with active workflow runs)
    const tpl = templates.find(t => (t.id || t.name) === selectedTemplateId);
    if (tpl) renderTriggerPanel();
  }

  // Events
  let searchTimer = null;
  root.querySelector('#wfvSearch')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTemplates, 150);
  });
  root.querySelector('#wfvCatFilter')?.addEventListener('change', renderTemplates);
  root.querySelector('#wfvRefresh')?.addEventListener('click', () => {
    Promise.all([loadTemplates(), loadRuns()]).then(() => showNotice('Refreshed.', 'success'));
  });

  // Sync
  if (sync) {
    syncUnsubscribe = sync.subscribe((data, changedKeys) => {
      if (changedKeys.includes('activeWorkflowRuns')) loadRuns();
    });
  }

  // Init
  await Promise.all([loadTemplates(), loadRuns(), loadMeta()]);
  renderStats();

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderWorkflowsView;
