/**
 * Native Runbooks / Workflow Templates View for WebOS Dashboard
 *
 * Displays workflow templates as runbooks — showing description, steps,
 * input schema, governance policies, success criteria, and department info.
 * No separate runbook markdown files needed; the template IS the runbook.
 */

import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

// ── Helpers ──────────────────────────────────────────────────────────
const trunc = (s, n = 60) => (!s ? '' : s.length > n ? s.slice(0, n) + '…' : s);
const esc = escapeHtml;

const CATEGORY_ICONS = {
  content: '📝', development: '💻', quality: '✅', operations: '⚙️',
  infrastructure: '🏗️', design: '🎨', research: '🔍', general: '📋',
};

const STATUS_COLORS = {
  true: '#22c55e', false: '#9ca3af',
};

// ── CSS ──────────────────────────────────────────────────────────────
const CSS_ID = 'rb-styles-v2';
function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = `
    .rb{display:flex;flex-direction:column;height:100%;background:var(--win11-surface-solid);font-family:'Segoe UI',system-ui,-apple-system,sans-serif}
    .rb-tb{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--win11-border);flex-shrink:0;flex-wrap:wrap;background:var(--win11-surface-solid);position:sticky;top:0;z-index:4}
    .rb-tb__title{font-size:1rem;font-weight:600;color:var(--win11-text);margin-right:auto;white-space:nowrap}
    .rb-inp{padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none;width:180px}
    .rb-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text-tertiary);font-size:.75rem;cursor:pointer;user-select:none;transition:background .15s}
    .rb-chip:hover{background:var(--win11-surface-hover)}
    .rb-chip.on{background:var(--win11-accent-light);border-color:var(--win11-accent);color:var(--win11-accent)}

    .rb-body{display:flex;flex:1;overflow:hidden}
    .rb-list{width:280px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--win11-border);padding:12px}
    .rb-item{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:8px;cursor:pointer;transition:background .15s;border:1px solid transparent;margin-bottom:4px}
    .rb-item:hover{background:var(--win11-surface-hover)}
    .rb-item.active{background:var(--win11-accent-light);border-color:var(--win11-accent)}
    .rb-item__icon{font-size:1.1rem;flex-shrink:0;margin-top:1px}
    .rb-item__info{flex:1;min-width:0}
    .rb-item__name{font-size:.84rem;font-weight:500;color:var(--win11-text);word-break:break-word}
    .rb-item__meta{display:flex;gap:6px;margin-top:3px;flex-wrap:wrap;align-items:center}
    .rb-item__cat{font-size:.7rem;color:var(--win11-text-tertiary);background:rgba(0,0,0,.04);padding:1px 6px;border-radius:4px}
    .rb-item__dept{font-size:.7rem;padding:1px 6px;border-radius:4px;font-weight:500}
    .rb-item__steps{font-size:.7rem;color:var(--win11-text-tertiary);margin-left:auto;white-space:nowrap}

    .rb-detail{flex:1;overflow-y:auto;padding:20px 24px}
    .rb-detail-hd{margin-bottom:20px}
    .rb-detail-hd__name{font-size:1.2rem;font-weight:700;color:var(--win11-text);margin-bottom:4px}
    .rb-detail-hd__desc{font-size:.88rem;color:var(--win11-text-secondary);line-height:1.5}
    .rb-detail-hd__badges{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
    .rb-detail-hd__badge{font-size:.72rem;padding:2px 8px;border-radius:999px;font-weight:500}

    .rb-section{margin-bottom:20px}
    .rb-section__title{font-size:.78rem;font-weight:700;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--win11-border)}

    .rb-step{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--win11-border);align-items:flex-start}
    .rb-step:last-child{border-bottom:none}
    .rb-step__num{width:24px;height:24px;border-radius:50%;background:var(--win11-accent-light);color:var(--win11-accent);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;flex-shrink:0}
    .rb-step__name{font-size:.85rem;font-weight:500;color:var(--win11-text)}
    .rb-step__req{font-size:.7rem;color:var(--win11-text-tertiary);margin-top:2px}
    .rb-step__req.yes{color:var(--win11-accent)}

    .rb-field{margin-bottom:8px;display:flex;gap:8px;font-size:.83rem}
    .rb-field__label{color:var(--win11-text-tertiary);min-width:100px;flex-shrink:0;font-weight:500}
    .rb-field__value{color:var(--win11-text);word-break:break-word}
    .rb-field__req{font-size:.68rem;color:var(--win11-accent);font-weight:600}

    .rb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
    .rb-grid-item{padding:8px 10px;border-radius:6px;background:var(--win11-surface);border:1px solid var(--win11-border);font-size:.8rem}
    .rb-grid-item__label{color:var(--win11-text-tertiary);font-size:.7rem;margin-bottom:2px}
    .rb-grid-item__value{color:var(--win11-text);font-weight:500}

    .rb-policy{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;background:var(--win11-surface);border:1px solid var(--win11-border);margin-bottom:6px;font-size:.8rem}
    .rb-policy__icon{flex-shrink:0}
    .rb-policy__text{color:var(--win11-text)}
    .rb-policy__roles{font-size:.7rem;color:var(--win11-text-tertiary);margin-top:2px}

    .rb-criteria{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:var(--win11-surface);border:1px solid var(--win11-border);margin-bottom:4px;font-size:.8rem}
    .rb-criteria__check{color:#22c55e;font-size:.85rem}
    .rb-criteria__label{color:var(--win11-text-tertiary);flex:1}
    .rb-criteria__value{color:var(--win11-text);font-weight:500}

    .rb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:60px 20px;color:var(--win11-text-tertiary);text-align:center;gap:12px}
    .rb-empty__icon{font-size:2.5rem;opacity:.5}

    .rb-count{font-size:.72rem;color:var(--win11-text-tertiary);text-align:center;padding:8px}

    .rb-list::-webkit-scrollbar,.rb-detail::-webkit-scrollbar{width:6px}
    .rb-list::-webkit-scrollbar-thumb,.rb-detail::-webkit-scrollbar-thumb{background:var(--win11-border-strong);border-radius:3px}
  `;
  document.head.appendChild(s);
}

// ── Main render ──────────────────────────────────────────────────────
export async function renderRunbooksView({ mountNode, api, adapter, stateStore }) {
  ensureNativeRoot(mountNode, 'runbooks-view');
  injectCSS();

  let destroyed = false;
  let templates = [];
  let selected = null;
  let filterCategory = 'all';
  let filterQuery = '';

  // ── HTML shell ─────────────────────────────────────────────────────
  mountNode.innerHTML = `
    <div class="rb">
      <div class="rb-tb">
        <span class="rb-tb__title">📖 Runbooks</span>
        <input class="rb-inp" id="rbQ" type="text" placeholder="Filter runbooks…">
        <select class="rb-chip" id="rbCat" style="padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem;outline:none;cursor:pointer">
          <option value="all">All Categories</option>
        </select>
      </div>
      <div class="rb-body">
        <div class="rb-list" id="rbList"></div>
        <div class="rb-detail" id="rbDetail">
          <div class="rb-empty">
            <div class="rb-empty__icon">📖</div>
            <p>Select a runbook to view details.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = (s) => mountNode.querySelector(s);
  const listEl = $('#rbList');
  const detailEl = $('#rbDetail');
  const inpQ = $('#rbQ');
  const catSel = $('#rbCat');

  // ── Load templates ─────────────────────────────────────────────────
  try {
    const r = await fetch('/api/workflow-templates');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    templates = Array.isArray(data) ? data : (data.templates || data.data || []);
  } catch (e) {
    listEl.innerHTML = `<div class="rb-empty"><p>Failed to load runbooks.</p><p style="font-size:.8rem">${esc(e.message)}</p></div>`;
    return () => {};
  }
  if (destroyed) return () => {};

  // Populate category filter
  const categories = [...new Set(templates.map(t => t.category || 'general'))].sort();
  categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = (CATEGORY_ICONS[c] || '📋') + ' ' + c.charAt(0).toUpperCase() + c.slice(1);
    catSel.appendChild(o);
  });

  // ── Draw list ──────────────────────────────────────────────────────
  function drawList() {
    let filtered = templates;

    if (filterCategory !== 'all') {
      filtered = filtered.filter(t => (t.category || 'general') === filterCategory);
    }
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      filtered = filtered.filter(t => {
        const name = (t.display_name || t.name || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const dept = (t.template_department_name || '').toLowerCase();
        return name.includes(q) || desc.includes(q) || dept.includes(q);
      });
    }

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--win11-text-tertiary);font-size:.85rem">No runbooks match</div>';
      return;
    }

    filtered.forEach(t => {
      const cat = t.category || 'general';
      const deptColor = t.template_department_color || '#6b7280';
      const deptName = t.template_department_name || '';
      const stepsCount = t.steps?.length || t.stepsCount || 0;
      const isActive = t.is_active !== false && t.isActive !== false;

      const el = document.createElement('div');
      el.className = 'rb-item' + (selected?.id === t.id ? ' active' : '');
      el.innerHTML = `
        <span class="rb-item__icon">${CATEGORY_ICONS[cat] || '📋'}</span>
        <div class="rb-item__info">
          <div class="rb-item__name" title="${esc(t.display_name || t.name || '')}">${esc(t.display_name || t.name.replace(/-/g, ' '))}</div>
          <div class="rb-item__meta">
            ${deptName ? `<span class="rb-item__dept" style="background:${deptColor}18;color:${deptColor}">${esc(trunc(deptName, 16))}</span>` : ''}
            <span class="rb-item__cat">${esc(cat)}</span>
            <span class="rb-item__steps">${stepsCount} step${stepsCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      `;
      el.addEventListener('click', () => select(t));
      listEl.appendChild(el);
    });

    // Count
    const countEl = document.createElement('div');
    countEl.className = 'rb-count';
    countEl.textContent = `${filtered.length} of ${templates.length} runbooks`;
    listEl.appendChild(countEl);
  }

  // ── Select & draw detail ───────────────────────────────────────────
  function select(template) {
    selected = template;
    drawList();
    drawDetail(template);
  }

  function drawDetail(t) {
    const deptColor = t.template_department_color || '#6b7280';
    const deptName = t.template_department_name || '';
    const deptDesc = t.template_department_description || '';
    const desc = t.description || 'No description available.';
    const steps = t.steps || [];
    const inputFields = t.input_schema?.fields || t.inputSchema?.fields || [];
    const approvals = t.required_approvals || t.requiredApprovals || [];
    const successCriteria = t.success_criteria || t.successCriteria || {};
    const artifactContract = t.artifact_contract || t.artifactContract || {};
    const blockerPolicy = t.blocker_policy || t.blockerPolicy || {};
    const escalationPolicy = t.escalation_policy || t.escalationPolicy || {};
    const ownerAgent = t.default_owner_agent || t.defaultOwnerAgent || '';
    const serviceName = t.service_name || '';
    const serviceDesc = t.service_description || '';
    const governance = t.governance || {};
    const actionPolicies = governance.actionPolicy || [];

    // Build governance section
    let governanceHtml = '';
    if (actionPolicies.length > 0) {
      governanceHtml = `
        <div class="rb-section">
          <div class="rb-section__title">Governance — Actions & Permissions</div>
          ${actionPolicies.map(ap => `
            <div class="rb-policy">
              <span class="rb-policy__icon">${ap.label === 'Launch workflow' ? '🚀' : ap.label === 'Approve' ? '✅' : ap.label === 'Reject' ? '❌' : ap.label === 'Cancel run' ? '⛔' : ap.label === 'Override failure' ? '🔧' : '👥'}</span>
              <div>
                <div class="rb-policy__text">${esc(ap.label)}</div>
                <div class="rb-policy__roles">Roles: ${(ap.roles || []).join(', ')}${ap.allowAssignedApprover ? ' (can self-approve)' : ''}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Success criteria
    let criteriaHtml = '';
    const critEntries = Object.entries(successCriteria);
    if (critEntries.length > 0) {
      criteriaHtml = `
        <div class="rb-section">
          <div class="rb-section__title">Success Criteria</div>
          ${critEntries.map(([key, val]) => `
            <div class="rb-criteria">
              <span class="rb-criteria__check">✓</span>
              <span class="rb-criteria__label">${esc(key.replace(/_/g, ' '))}</span>
              <span class="rb-criteria__value">${typeof val === 'boolean' ? (val ? 'Required' : 'Optional') : esc(String(val))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Artifact contract
    let artifactHtml = '';
    const artifactOutputs = artifactContract?.expected_outputs || {};
    const artEntries = Object.entries(artifactOutputs);
    if (artEntries.length > 0) {
      artifactHtml = `
        <div class="rb-section">
          <div class="rb-section__title">Expected Artifacts</div>
          ${artEntries.map(([key, val]) => `
            <div class="rb-criteria">
              <span class="rb-criteria__check">📄</span>
              <span class="rb-criteria__label">${esc(key.replace(/_/g, ' '))}</span>
              <span class="rb-criteria__value">${typeof val === 'boolean' ? (val ? 'Required' : 'Optional') : esc(String(val))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    detailEl.innerHTML = `
      <div class="rb-detail-hd">
        <div class="rb-detail-hd__name">${esc(t.display_name || t.name.replace(/-/g, ' '))}</div>
        <div class="rb-detail-hd__desc">${esc(desc)}</div>
        <div class="rb-detail-hd__badges">
          ${deptName ? `<span class="rb-detail-hd__badge" style="background:${deptColor}18;color:${deptColor}">${esc(deptName)}</span>` : ''}
          <span class="rb-detail-hd__badge" style="background:var(--win11-accent-light);color:var(--win11-accent)">${esc(t.category || 'general')}</span>
          ${serviceName ? `<span class="rb-detail-hd__badge" style="background:rgba(0,0,0,.04);color:var(--win11-text-tertiary)">${esc(serviceName)}</span>` : ''}
          <span class="rb-detail-hd__badge" style="background:rgba(0,0,0,.04);color:var(--win11-text-tertiary)">${steps.length} steps</span>
        </div>
      </div>

      ${serviceDesc ? `
        <div class="rb-section">
          <div class="rb-section__title">Service Description</div>
          <p style="font-size:.85rem;color:var(--win11-text-secondary);line-height:1.5;margin:0">${esc(serviceDesc)}</p>
        </div>
      ` : ''}

      <div class="rb-section">
        <div class="rb-section__title">Steps</div>
        ${steps.map((s, i) => `
          <div class="rb-step">
            <div class="rb-step__num">${i + 1}</div>
            <div>
              <div class="rb-step__name">${esc(s.display_name || s.name.replace(/_/g, ' '))}</div>
              <div class="rb-step__req ${s.required ? 'yes' : ''}">${s.required ? 'Required' : 'Optional'}${s.name !== s.display_name ? ` — <code style="font-size:.7rem">${esc(s.name)}</code>` : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>

      ${inputFields.length > 0 ? `
        <div class="rb-section">
          <div class="rb-section__title">Input Schema</div>
          ${inputFields.map(f => `
            <div class="rb-field">
              <span class="rb-field__label">${esc(f.label || f.name)}</span>
              <span class="rb-field__value">
                <span style="font-size:.72rem;color:var(--win11-text-tertiary);background:rgba(0,0,0,.04);padding:1px 6px;border-radius:3px;margin-right:4px">${esc(f.type)}</span>
                ${f.required ? '<span class="rb-field__req">required</span>' : ''}
              </span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${approvals.length > 0 ? `
        <div class="rb-section">
          <div class="rb-section__title">Required Approvals</div>
          ${approvals.map(a => `
            <div class="rb-criteria">
              <span class="rb-criteria__check">🔒</span>
              <span class="rb-criteria__label">${esc(a.replace(/_/g, ' '))}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${criteriaHtml}
      ${artifactHtml}

      <div class="rb-section">
        <div class="rb-section__title">Configuration</div>
        <div class="rb-grid">
          ${ownerAgent ? `<div class="rb-grid-item"><div class="rb-grid-item__label">Default Owner</div><div class="rb-grid-item__value">${esc(ownerAgent)}</div></div>` : ''}
          ${blockerPolicy.block_on_missing_inputs !== undefined ? `<div class="rb-grid-item"><div class="rb-grid-item__label">Block Missing</div><div class="rb-grid-item__value">${blockerPolicy.block_on_missing_inputs ? 'Yes' : 'No'}</div></div>` : ''}
          ${blockerPolicy.block_on_failed_approvals !== undefined ? `<div class="rb-grid-item"><div class="rb-grid-item__label">Block Failed</div><div class="rb-grid-item__value">${blockerPolicy.block_on_failed_approvals ? 'Yes' : 'No'}</div></div>` : ''}
          ${escalationPolicy.sla_hours ? `<div class="rb-grid-item"><div class="rb-grid-item__label">SLA</div><div class="rb-grid-item__value">${escalationPolicy.sla_hours}h</div></div>` : ''}
          ${escalationPolicy.escalate_to_department !== undefined ? `<div class="rb-grid-item"><div class="rb-grid-item__label">Escalation</div><div class="rb-grid-item__value">${escalationPolicy.escalate_to_department ? 'Enabled' : 'Disabled'}</div></div>` : ''}
        </div>
      </div>

      ${governanceHtml}

      <div class="rb-section" style="margin-top:24px;padding-top:12px;border-top:1px solid var(--win11-border)">
        <div style="font-size:.72rem;color:var(--win11-text-tertiary)">
          Template ID: ${esc(t.id || '')} · Created: ${t.created_at ? esc(new Date(t.created_at).toLocaleDateString()) : '—'} · Updated: ${t.updated_at ? esc(new Date(t.updated_at).toLocaleDateString()) : '—'}
        </div>
      </div>
    `;
  }

  // ── Event bindings ─────────────────────────────────────────────────
  inpQ.addEventListener('input', () => { filterQuery = inpQ.value.trim(); drawList(); });
  catSel.addEventListener('change', () => { filterCategory = catSel.value; drawList(); });

  // ── Initial render ─────────────────────────────────────────────────
  drawList();

  // ── Cleanup ───────────────────────────────────────────────────────
  return () => {
    destroyed = true;
    mountNode.innerHTML = '';
  };
}

export default renderRunbooksView;
