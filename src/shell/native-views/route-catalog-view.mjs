/**
 * Route Catalog View — auto-generated API inventory from the router.
 *
 * Queries GET /api/routes to list all registered endpoints.
 * Falls back to a hardcoded list if the endpoint is unavailable.
 */

const CSS = `
  .rc-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 0.85rem; }
  .rc-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .rc-title { font-size: 1.1rem; font-weight: 600; }
  .rc-search { padding: 6px 10px; border: 1px solid var(--win11-border); border-radius: 6px; font-size: 0.82rem; width: 200px; background: var(--win11-surface-solid); color: var(--win11-text-primary); outline: none; }
  .rc-search:focus { border-color: var(--win11-accent); }
  .rc-body { flex: 1; overflow-y: auto; padding: 8px; }
  .rc-group { margin-bottom: 16px; }
  .rc-group-title { font-size: 0.9rem; font-weight: 600; padding: 6px 12px; background: var(--win11-surface-hover); border-radius: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; }
  .rc-group-count { font-size: 0.72rem; color: var(--win11-text-tertiary); }
  .rc-route { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-radius: 4px; }
  .rc-route:hover { background: var(--win11-surface-hover); }
  .rc-method { font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 3px; min-width: 50px; text-align: center; }
  .rc-method-GET { background: #107c1020; color: #107c10; }
  .rc-method-POST { background: #0078d420; color: #0078d4; }
  .rc-method-PUT { background: #f59e0b20; color: #f59e0b; }
  .rc-method-PATCH { background: #8764b820; color: #8764b8; }
  .rc-method-DELETE { background: #e7485620; color: #e74856; }
  .rc-path { font-family: monospace; font-size: 0.82rem; color: var(--win11-text-primary); }
  .rc-desc { font-size: 0.75rem; color: var(--win11-text-secondary); margin-left: auto; }
  .rc-empty { text-align: center; padding: 40px; color: var(--win11-text-tertiary); }
  .rc-stats { display: flex; gap: 16px; padding: 8px 16px; border-bottom: 1px solid var(--win11-border); font-size: 0.78rem; color: var(--win11-text-secondary); flex-shrink: 0; }
`;

// Known route descriptions (from docs/api-reference-complete.md)
const DESCRIPTIONS = {
  'GET /api/health': 'Server health check',
  'GET /api/tasks': 'List tasks',
  'POST /api/tasks': 'Create task',
  'PATCH /api/tasks/:id': 'Update task',
  'DELETE /api/tasks/:id': 'Delete task',
  'POST /api/tasks/:id/archive': 'Archive task',
  'POST /api/tasks/:id/restore': 'Restore task',
  'POST /api/tasks/:id/move': 'Move task status',
  'GET /api/projects': 'List projects',
  'POST /api/projects': 'Create project',
  'PUT /api/projects/:id': 'Update project',
  'DELETE /api/projects/:id': 'Delete project',
  'GET /api/workflows': 'List workflows',
  'GET /api/history': 'List audit history',
  'GET /api/state-snapshots': 'List state snapshots (Time Travel)',
  'GET /api/snapshots': 'List full-state snapshot artifacts',
  'GET /api/snapshots/:entityType/:entityId': 'List state snapshots',
  'GET /api/spaces': 'List workspaces',
  'POST /api/spaces': 'Create workspace',
  'GET /api/export': 'Export dashboard bundle',
  'POST /api/import': 'Import dashboard bundle',
  'POST /api/settings/restart': 'Restart server',
  'GET /api/stats': 'Dashboard statistics',
  'GET /api/events': 'SSE event stream',
};

export async function renderRouteCatalogView({ mountNode, api }) {
  mountNode.innerHTML = `<style>${CSS}</style><div class="rc-container"><div style="text-align:center;padding:40px;">Loading routes...</div></div>`;
  const container = mountNode.querySelector('.rc-container');

  let routes = [];
  let filter = '';

  async function load() {
    try {
      const resp = await fetch('/api/routes', {
        headers: { 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' }
      });
      if (resp.ok) {
        const data = await resp.json();
        routes = data.routes || [];
      } else {
        throw new Error('no /api/routes');
      }
    } catch {
      // Fallback: scan known routes
      routes = Object.keys(DESCRIPTIONS).map(r => {
        const [method, ...pathParts] = r.split(' ');
        return { method, path: pathParts.join(' ') };
      });
    }
    render();
  }

  function render() {
    const filtered = filter
      ? routes.filter(r => (r.method + ' ' + r.path).toLowerCase().includes(filter.toLowerCase()))
      : routes;

    // Group by path prefix
    const groups = {};
    filtered.forEach(r => {
      const prefix = r.path.split('/').slice(0, 3).join('/');
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(r);
    });

    // Count by method
    const methodCounts = {};
    filtered.forEach(r => { methodCounts[r.method] = (methodCounts[r.method] || 0) + 1; });

    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'rc-header';
    header.innerHTML = `
      <div class="rc-title">🗺️ Route Catalog</div>
      <input class="rc-search" placeholder="Filter routes..." value="${esc(filter)}">
    `;
    container.appendChild(header);

    // Stats
    const stats = document.createElement('div');
    stats.className = 'rc-stats';
    stats.innerHTML = `
      <span>Total: ${filtered.length}</span>
      ${Object.entries(methodCounts).map(([m, c]) => `<span>${m}: ${c}</span>`).join('')}
    `;
    container.appendChild(stats);

    // Body
    const body = document.createElement('div');
    body.className = 'rc-body';

    if (filtered.length === 0) {
      body.innerHTML = '<div class="rc-empty">No routes found</div>';
    } else {
      for (const [prefix, groupRoutes] of Object.entries(groups)) {
        const group = document.createElement('div');
        group.className = 'rc-group';
        group.innerHTML = `
          <div class="rc-group-title">
            ${esc(prefix)}
            <span class="rc-group-count">${groupRoutes.length} routes</span>
          </div>
          ${groupRoutes.map(r => `
            <div class="rc-route">
              <span class="rc-method rc-method-${r.method}">${r.method}</span>
              <span class="rc-path">${esc(r.path)}</span>
              <span class="rc-desc">${esc(DESCRIPTIONS[r.method + ' ' + r.path] || r.description || '')}</span>
            </div>
          `).join('')}
        `;
        body.appendChild(group);
      }
    }

    container.appendChild(body);

    // Wire search
    header.querySelector('.rc-search')?.addEventListener('input', (e) => {
      filter = e.target.value;
      render();
    });
  }

  load();
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export default renderRouteCatalogView;
