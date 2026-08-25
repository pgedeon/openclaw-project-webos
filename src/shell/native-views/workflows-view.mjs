import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

import { mutate } from '../mutation-manager.mjs';
import { executeAction } from '../action-client.mjs';

export async function renderWorkflowsView({ mountNode, api, adapter, stateStore, sync, params = {}, navigateToView}) {
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
    /* Workflow graph (visual editor Stage 1 — read-only chain render) */
    .wfv-graph-wrap { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:12px;overflow-x:auto; }
    .wfv-graph-node rect { transition:fill 0.15s; }
    .wfv-graph-node:hover rect { filter:brightness(1.15); }
    .wfv-graph-node.selected rect { stroke-width:2.5; }
    .wfv-graph-banner { padding:6px 10px;border-radius:6px;font-size:0.75rem;margin-bottom:8px;background:rgba(234,179,8,0.12);color:#eab308;border:1px solid rgba(234,179,8,0.25); }
    .wfv-graph-state { padding:18px;text-align:center;color:var(--win11-text-tertiary);font-size:0.82rem; }
    .wfv-graph-detail { margin-top:10px;padding:10px;border-radius:8px;background:var(--win11-surface);border:1px solid var(--win11-border);font-size:0.78rem;color:var(--win11-text-secondary); }
    .wfv-graph-detail pre { white-space:pre-wrap;word-break:break-word;font-size:0.72rem;max-height:180px;overflow-y:auto;background:var(--win11-surface-solid);padding:8px;border-radius:6px;margin:6px 0 0; }
    .wfv-graph-feedback { display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:0.78rem;color:var(--win11-text-secondary); }
    .wfv-graph-feedback input { flex:1;min-width:120px;padding:4px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.78rem;outline:none; }
    .wfv-graph-feedback .active { border-color:var(--win11-accent);box-shadow:0 0 0 1px var(--win11-accent); }
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
        <button id="wfvGraphBtn" class="wfv-btn" title="Read-only step chain graph (latest run status colors)">Graph</button>
        <span style="font-size:0.72rem;color:var(--win11-text-tertiary);">Creates a run and starts it immediately</span>
      </div>

      <div id="wfvGraphPanel" style="display:none;margin-top:12px;"></div>
    </div>`;

    // Wire close button
    panel.querySelector('#wfvCloseTrigger')?.addEventListener('click', () => {
      selectedTemplateId = null;
      renderTemplates();
      renderTriggerPanel();
    });

    // Wire graph toggle (visual editor Stage 1 — read-only chain render)
    panel.querySelector('#wfvGraphBtn')?.addEventListener('click', () => {
      const gPanel = root.querySelector('#wfvGraphPanel');
      if (!gPanel) return;
      const show = gPanel.style.display === 'none';
      gPanel.style.display = show ? 'block' : 'none';
      if (show) renderGraphPanel(tpl);
    });

    // Wire trigger button
    panel.querySelector('#wfvTriggerBtn')?.addEventListener('click', handleTrigger);
  }

  // ── Workflow graph (visual editor Stage 1 — read-only chain render) ────
  // Pure helpers live in lib/workflow-graph-layout.js (DB-free tested); this
  // view only assembles data + renders SVG. Read-only invariant: the ONLY
  // non-GET is the fire-and-forget earn-use telemetry POST (brief §6).

  let graphLibPromise = null;
  let graphOpenSent = false; // one 'open' event per view-session (brief §6)

  function ensureGraphLib() {
    if (globalThis.WorkflowGraphLayout?.layoutLayered) return Promise.resolve(globalThis.WorkflowGraphLayout);
    if (!graphLibPromise) {
      // Served at /lib/workflow-graph-layout.js (UMD fallback sets globalThis).
      graphLibPromise = import('/lib/workflow-graph-layout.js')
        .then(() => globalThis.WorkflowGraphLayout || null)
        .catch(() => null);
    }
    return graphLibPromise;
  }

  function sendGraphEvent(payload) {
    // Fire-and-forget: telemetry must never bother the operator (brief §4
    // degradation matrix — endpoint absent/staging no-DB fails silently).
    try { api.workflows.graphEvent(payload)?.catch(() => {}); } catch { /* ignore */ }
  }

  const GRAPH_TONE_COLORS = {
    success: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.12)' },
    info: { stroke: 'var(--win11-accent)', fill: 'rgba(96,205,255,0.10)' },
    danger: { stroke: '#ef4444', fill: 'rgba(239,68,68,0.12)' },
    warning: { stroke: '#eab308', fill: 'rgba(234,179,8,0.12)' },
    neutral: { stroke: 'var(--win11-border)', fill: 'var(--win11-surface-solid)' },
    unknown: { stroke: 'var(--win11-text-tertiary)', fill: 'var(--win11-surface-solid)' }
  };

  function truncLabel(s, n) {
    const str = String(s ?? '');
    return str.length > n ? str.substring(0, n - 1) + '…' : str;
  }

  async function renderGraphPanel(tpl) {
    const panel = root.querySelector('#wfvGraphPanel');
    if (!panel) return;
    panel.innerHTML = '<div class="wfv-graph-state">Loading graph…</div>';

    const lib = await ensureGraphLib();
    if (!lib) {
      panel.innerHTML = '<div class="wfv-graph-state">Graph helpers unavailable — retry by toggling Graph.</div>';
      return;
    }

    let layout;
    try {
      layout = lib.layoutLayered(Array.isArray(tpl.steps) ? tpl.steps : []);
    } catch (err) {
      // Cycle in depends_on authoring — named error state, never a blank frame.
      panel.innerHTML = `<div class="wfv-graph-state" style="color:#ef4444;">Cannot render graph: ${escapeHtml(err?.message || 'invalid step graph')}</div>`;
      return;
    }

    if (!layout.nodes.length) {
      panel.innerHTML = '<div class="wfv-graph-state">Template has no steps.</div>';
      return;
    }

    // Latest run for status colors (template mode fallback: neutral nodes).
    let run = null;
    try {
      const res = await api.workflows.runs({ workflow_type: tpl.name, limit: 1 });
      const list = Array.isArray(res?.runs) ? res.runs : [];
      if (list.length && list[0]?.id) run = await api.workflows.get(list[0].id);
    } catch { /* template mode — neutral nodes are honest without a run */ }

    const merged = lib.mergeRunStatus(layout.laidOut, run?.steps);
    const hasRun = Boolean(run?.id);

    const banner = layout.truncated
      ? `<div class="wfv-graph-banner">Showing first ${merged.length} of ${layout.total} steps</div>`
      : '';

    const nodeById = new Map(merged.map((n) => [n.id, n]));
    const posById = new Map(layout.laidOut.map((n) => [n.id, n]));

    const edgesSvg = layout.edges.map((e) => {
      const a = posById.get(e.from);
      const b = posById.get(e.to);
      if (!a || !b) return '';
      return `<path d="M ${a.x + a.width / 2} ${a.y + a.height} L ${b.x + b.width / 2} ${b.y}" fill="none" stroke="var(--win11-text-tertiary)" stroke-width="1.5" marker-end="url(#wfvArrow)" />`;
    }).join('');

    const nodesSvg = merged.map((n) => {
      const tone = GRAPH_TONE_COLORS[n.tone] || GRAPH_TONE_COLORS.neutral;
      const dash = n.tone === 'unknown' ? 'stroke-dasharray="4 3"' : '';
      const icon = lib.stepIcon(n.name);
      const statusLabel = hasRun ? ` · ${truncLabel(n.status, 14)}` : '';
      return `<g class="wfv-graph-node" data-node-id="${escapeHtml(n.id)}">
        <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8"
          fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="1.5" ${dash} />
        <text x="${n.x + 12}" y="${n.y + 28}" font-size="15">${icon}</text>
        <text x="${n.x + 36}" y="${n.y + 19}" font-size="12" fill="var(--win11-text)">${escapeHtml(truncLabel(n.display_name, 24))}</text>
        <text x="${n.x + 36}" y="${n.y + 34}" font-size="10" fill="var(--win11-text-tertiary)">Step ${n.index + 1}${statusLabel}</text>
        <circle cx="${n.x + n.width - 12}" cy="${n.y + n.height / 2}" r="4"
          fill="${n.required ? 'var(--win11-accent)' : 'var(--win11-text-tertiary)'}">
          <title>${n.required ? 'Required step' : 'Optional step'}</title>
        </circle>
      </g>`;
    }).join('');

    panel.innerHTML = `
      ${banner}
      <div style="font-size:0.72rem;color:var(--win11-text-tertiary);margin-bottom:6px;">
        ${hasRun ? `Latest run <code>${escapeHtml(String(run.id).substring(0, 8))}</code> · ${escapeHtml(run.status || 'unknown')}` : 'Template view — no runs yet (neutral nodes)'} · click a node for details
      </div>
      <div class="wfv-graph-wrap">
        <svg width="${layout.width + 8}" height="${layout.height + 8}" role="img" aria-label="Workflow step chain for ${escapeHtml(tpl.display_name || tpl.name)}">
          <defs>
            <marker id="wfvArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--win11-text-tertiary)" />
            </marker>
          </defs>
          ${edgesSvg}
          ${nodesSvg}
        </svg>
      </div>
      <div id="wfvGraphDetail"></div>
      <div class="wfv-graph-feedback">
        <span>Should editing happen here?</span>
        <button class="wfv-btn wfv-fb-helpful" title="Yes — editing belongs in this graph">👍</button>
        <button class="wfv-btn wfv-fb-not-helpful" title="No — read-only is enough">👎</button>
        <input type="text" id="wfvFbNote" placeholder="Optional note…" maxlength="500" />
      </div>`;

    // Earn-use telemetry: one open event per view-session on first successful render.
    if (!graphOpenSent) {
      graphOpenSent = true;
      sendGraphEvent({ event: 'open', template: tpl.name });
    }

    // Click node → detail card (config summary; run mode adds status/error/output).
    panel.querySelectorAll('.wfv-graph-node').forEach((gEl) => {
      gEl.addEventListener('click', () => {
        const node = nodeById.get(gEl.dataset.nodeId);
        if (!node) return;
        panel.querySelectorAll('.wfv-graph-node.selected').forEach((s) => s.classList.remove('selected'));
        gEl.classList.add('selected');
        const detail = root.querySelector('#wfvGraphDetail');
        if (!detail) return;
        const outputPreview = node.output == null ? ''
          : truncLabel(typeof node.output === 'string' ? node.output : JSON.stringify(node.output), 400);
        detail.innerHTML = `<div class="wfv-graph-detail">
          <strong style="color:var(--win11-text);">${escapeHtml(node.display_name)}</strong>
          <div>name: <code>${escapeHtml(node.name)}</code> · position ${node.index + 1} of ${merged.length} · ${node.required ? 'required' : 'optional'}</div>
          ${hasRun ? `<div>status: <strong>${escapeHtml(node.status)}</strong>${node.started_at ? ` · started ${escapeHtml(fmtDate(node.started_at))}` : ''}${node.finished_at ? ` · finished ${escapeHtml(fmtDate(node.finished_at))}` : ''}</div>` : ''}
          ${node.error_message ? `<div style="color:#ef4444;margin-top:4px;">${escapeHtml(node.error_message)}</div>` : ''}
          ${outputPreview ? `<div style="margin-top:4px;color:var(--win11-text-tertiary);">output preview (truncated):<pre>${escapeHtml(outputPreview)}</pre></div>` : ''}
        </div>`;
      });
    });

    // Feedback chip: 👍/👎 posts verdict (+ optional note) immediately.
    const noteInput = panel.querySelector('#wfvFbNote');
    const feedbackRow = panel.querySelector('.wfv-graph-feedback');
    async function postFeedback(helpful, btn) {
      sendGraphEvent({ event: 'feedback', template: tpl.name, helpful, note: noteInput?.value?.trim() || undefined });
      if (feedbackRow) {
        feedbackRow.innerHTML = `<span style="color:#22c55e;">Thanks — feedback recorded${helpful ? '' : ' (read-only stays)'}.</span>`;
      }
      void btn;
    }
    panel.querySelector('.wfv-fb-helpful')?.addEventListener('click', (e) => postFeedback(true, e.currentTarget));
    panel.querySelector('.wfv-fb-not-helpful')?.addEventListener('click', (e) => postFeedback(false, e.currentTarget));
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
      // Create + start workflow via mutation manager
      const result = await mutate({
        key: 'workflow-create-start',
        optimisticApply: () => { btn.textContent = 'Triggered ✓'; },
        request: async () => {
          const run = await api.workflows.create({
            workflow_type: tpl.name,
            owner_agent_id: agent || null,
            task_id: taskId || null,
            initiator: 'dashboard-operator',
            run_priority: priority,
            input_payload: { instructions, ...extraPayload },
          });
          if (!run?.id) throw new Error('No run ID returned from create');
          await api.workflows.start(run.id);
          return run;
        },
        rollback: () => { btn.textContent = '🚀 Start'; btn.disabled = false; },
        onSuccess: (run) => showNotice(`Workflow "${tpl.display_name || tpl.name}" triggered → run ${run.id.substring(0, 8)} assigned to ${agent || 'default'}.`, 'success'),
        onError: (err) => showNotice(`Workflow failed: ${err.message}`, 'error'),
      });

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

  // One-click actions slice 2 — row-action eligibility per brief §2:
  // run.cancel covers non-terminal runs; run.redispatch re-queues failed runs.
  const CANCELABLE_STATUSES = ['queued', 'running', 'waiting_for_approval', 'blocked', 'retrying'];
  const REDISPATCHABLE_STATUSES = ['failed'];

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

      return `<div class="wfv-run-row" data-run-id="${escapeHtml(r.id)}" style="cursor:pointer;" title="Click for details">
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
          ${CANCELABLE_STATUSES.includes(status) ? `<button class="wfv-btn danger wfv-run-cancel" data-cancel-id="${escapeHtml(r.id)}" title="Cancel run (hold to confirm)" aria-label="Cancel run ${escapeHtml(r.id)}">⛔</button>` : ''}
          ${REDISPATCHABLE_STATUSES.includes(status) ? `<button class="wfv-btn wfv-run-redispatch" data-redispatch-id="${escapeHtml(r.id)}" title="Re-dispatch failed run (reset to queued)" aria-label="Re-dispatch run ${escapeHtml(r.id)}">↻</button>` : ''}
          <span style="font-size:0.72rem;color:var(--win11-accent);">▶</span>
        </div>
      </div>`;
    }).join('');

    // Run row click handlers (P7)
    container.querySelectorAll('[data-run-id]').forEach(row => {
      row.addEventListener('click', () => {
        const run = runs.find(r => r.id === row.dataset.runId);
        if (!run) return;
        if (run.owner_agent_id) {
          navigateToView?.('agents', { params: { agentName: run.owner_agent_id } });
        } else if (run.task_id) {
          navigateToView?.('tasks', { params: { taskId: run.task_id } });
        }
      });
    });

    // ⛔ Cancel — gated run.cancel (HIGH severity → HOLD_CONFIRM overlay with
    // keyboard parity; outcome toast + receipt handled by the action client).
    container.querySelectorAll('.wfv-run-cancel').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const runId = btn.dataset.cancelId;
        if (!runId) return;
        btn.disabled = true;
        try {
          const result = await executeAction({ kind: 'run.cancel', targetId: runId, params: {}, api });
          if (result.ok) await loadRuns();
        } finally {
          btn.disabled = false;
        }
      });
    });

    // ↻ Re-dispatch — gated run.redispatch (PREVIEW_MODAL shows the reset-to-
    // queued semantics; budget breaches surface as the amber refusal banner).
    container.querySelectorAll('.wfv-run-redispatch').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const runId = btn.dataset.redispatchId;
        if (!runId) return;
        btn.disabled = true;
        try {
          const result = await executeAction({ kind: 'run.redispatch', targetId: runId, params: {}, api });
          if (result.ok) await loadRuns();
        } finally {
          btn.disabled = false;
        }
      });
    });
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
      // Fix 8: fetch specific run if deep-linked
      if (params.runId && !runs.some(r => r.id === params.runId)) {
        try { runs.unshift(await api.workflows.get(params.runId)); } catch {}
      }
      renderRuns();
      // Scroll to deep-linked run
      if (params.runId) {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-run-id="${CSS.escape(params.runId)}"]`);
          if (el) { el.style.background = 'rgba(0,120,212,.12)'; el.scrollIntoView({ block: 'center' }); }
        });
      }
    } catch (e) { /* ok */ }
  }

  async function loadMeta() {
    const _wsId = stateStore?.getState?.('activeSpaceId');
    try { const r = await api.projects.list(_wsId ? { workspace_id: _wsId } : {}); projects = Array.isArray(r) ? r : []; } catch { projects = []; }
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
