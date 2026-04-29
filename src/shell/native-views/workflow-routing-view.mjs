/**
 * Workflow Routing Admin — manage workflow_agent_routing table.
 *
 * View and edit which agents handle which workflow types.
 */

const CSS = `
  .wra-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 0.85rem; }
  .wra-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .wra-title { font-size: 1.1rem; font-weight: 600; }
  .wra-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--win11-border); background: var(--win11-surface-solid); cursor: pointer; font-size: 0.82rem; }
  .wra-btn:hover { background: var(--win11-surface-hover); }
  .wra-btn-primary { background: var(--win11-accent); color: #fff; border-color: var(--win11-accent); }
  .wra-table { flex: 1; overflow-y: auto; }
  .wra-table table { width: 100%; border-collapse: collapse; }
  .wra-table th { position: sticky; top: 0; background: var(--win11-surface-solid); padding: 8px 12px; text-align: left; font-size: 0.78rem; color: var(--win11-text-secondary); border-bottom: 1px solid var(--win11-border); z-index: 1; }
  .wra-table td { padding: 8px 12px; border-bottom: 1px solid var(--win11-border); }
  .wra-table tr:hover { background: var(--win11-surface-hover); }
  .wra-table input { width: 100%; padding: 4px 8px; border: 1px solid var(--win11-border); border-radius: 4px; font-size: 0.82rem; background: var(--win11-surface-solid); color: var(--win11-text-primary); box-sizing: border-box; }
  .wra-table input:focus { border-color: var(--win11-accent); outline: none; }
  .wra-actions { display: flex; gap: 6px; }
  .wra-save-btn { padding: 3px 10px; border-radius: 3px; border: 1px solid #107c10; background: #107c1020; color: #107c10; cursor: pointer; font-size: 0.75rem; }
  .wra-del-btn { padding: 3px 10px; border-radius: 3px; border: 1px solid #e74856; background: transparent; color: #e74856; cursor: pointer; font-size: 0.75rem; }
  .wra-empty { text-align: center; padding: 40px; color: var(--win11-text-tertiary); }
`;

export async function renderWorkflowRoutingView({ mountNode, api }) {
  mountNode.innerHTML = `<style>${CSS}</style><div class="wra-container"><div style="text-align:center;padding:40px;">Loading routing table...</div></div>`;
  const container = mountNode.querySelector('.wra-container');

  let routes = [];

  async function load() {
    try {
      const resp = await fetch('/api/workflow-routing', {
        headers: { 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' }
      });
      if (resp.ok) {
        const data = await resp.json();
        routes = data.routes || [];
      } else { routes = []; }
    } catch { routes = []; }
    render();
  }

  function render() {
    container.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'wra-header';
    header.innerHTML = `
      <div class="wra-title">🔀 Workflow Routing</div>
      <button class="wra-btn wra-btn-primary" id="wra-add-btn">+ Add Route</button>
    `;
    container.appendChild(header);

    const tableDiv = document.createElement('div');
    tableDiv.className = 'wra-table';

    if (routes.length === 0) {
      tableDiv.innerHTML = '<div class="wra-empty">No routing rules configured</div>';
    } else {
      tableDiv.innerHTML = `<table>
        <thead><tr>
          <th>Workflow Type</th>
          <th>Agent ID</th>
          <th>Priority</th>
          <th>Max Concurrent</th>
          <th>Timeout (min)</th>
          <th>Actions</th>
        </tr></thead>
        <tbody>
          ${routes.map((r, i) => `<tr data-idx="${i}">
            <td><input value="${esc(r.workflow_type)}" data-field="workflow_type" ${i > 0 ? '' : 'readonly'}></td>
            <td><input value="${esc(r.agent_id)}" data-field="agent_id"></td>
            <td><input type="number" value="${r.priority}" data-field="priority" style="width:60px"></td>
            <td><input type="number" value="${r.max_concurrent}" data-field="max_concurrent" style="width:80px"></td>
            <td><input type="number" value="${r.timeout_minutes}" data-field="timeout_minutes" style="width:80px"></td>
            <td class="wra-actions">
              <button class="wra-save-btn" data-save="${i}">Save</button>
              <button class="wra-del-btn" data-del="${i}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }

    container.appendChild(tableDiv);

    // Wire events
    header.querySelector('#wra-add-btn')?.addEventListener('click', () => {
      routes.push({ workflow_type: '', agent_id: '', priority: 5, max_concurrent: 1, timeout_minutes: 60 });
      render();
    });

    tableDiv.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.save);
        const row = tableDiv.querySelector(`tr[data-idx="${idx}"]`);
        const data = {};
        row.querySelectorAll('input').forEach(inp => { data[inp.dataset.field] = inp.type === 'number' ? parseInt(inp.value) : inp.value; });
        try {
          await fetch('/api/workflow-routing', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' },
            body: JSON.stringify(data),
          });
          load();
        } catch (err) { alert('Save failed: ' + err.message); }
      });
    });

    tableDiv.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.del);
        const wf = routes[idx]?.workflow_type;
        if (!wf || !confirm(`Delete routing for "${wf}"?`)) return;
        try {
          await fetch(`/api/workflow-routing/${encodeURIComponent(wf)}`, {
            method: 'DELETE',
            headers: { 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' },
          });
          load();
        } catch (err) { alert('Delete failed: ' + err.message); }
      });
    });
  }

  load();
}

function esc(str) { return String(str || '').replace(/"/g, '&quot;'); }

export default renderWorkflowRoutingView;
