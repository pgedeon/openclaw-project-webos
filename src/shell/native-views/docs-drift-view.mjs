/**
 * Docs Drift Widget — shows whether documentation matches source counts.
 *
 * Compares documented endpoint/route counts with the actual running routes.
 */

const CSS = `
  .ddw-container { padding: 16px; font-size: 0.85rem; }
  .ddw-title { font-weight: 600; margin-bottom: 12px; }
  .ddw-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--win11-border); }
  .ddw-label { color: var(--win11-text-secondary); }
  .ddw-value { font-family: monospace; font-weight: 600; }
  .ddw-ok { color: #107c10; }
  .ddw-warn { color: #f59e0b; }
  .ddw-err { color: #e74856; }
  .ddw-summary { margin-top: 12px; padding: 8px 12px; border-radius: 6px; background: var(--win11-surface-hover); }
`;

export async function renderDocsDriftWidget({ mountNode, api }) {
  mountNode.innerHTML = `<style>${CSS}</style><div class="ddw-container"><div style="color:var(--win11-text-tertiary)">Checking drift...</div></div>`;
  const container = mountNode.querySelector('.ddw-container');

  try {
    // Get actual route count
    const routesResp = await fetch('/api/routes', {
      headers: { 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' }
    });
    const routesData = routesResp.ok ? await routesResp.json() : { routes: [], total: 0 };

    // Count by method
    const methodCounts = {};
    routesData.routes.forEach(r => { methodCounts[r.method] = (methodCounts[r.method] || 0) + 1; });

    // Get documented routes (from the descriptions map in route-catalog-view)
    const documented = 24; // from DESCRIPTIONS map in route-catalog-view.mjs

    // Get DB stats
    let dbStats = {};
    try {
      const statsResp = await fetch('/api/stats', {
        headers: { 'Authorization': globalThis.__DASHBOARD_AUTH_TOKEN__ ? `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__}` : '' }
      });
      if (statsResp.ok) dbStats = await statsResp.json();
    } catch {}

    const drift = routesData.total - documented;
    const driftClass = drift === 0 ? 'ddw-ok' : drift > 5 ? 'ddw-err' : 'ddw-warn';
    const driftLabel = drift === 0 ? 'In sync' : `${Math.abs(drift)} routes ${drift > 0 ? 'undocumented' : 'over-documented'}`;

    container.innerHTML = `
      <div class="ddw-title">📐 Docs Drift Check</div>
      <div class="ddw-row">
        <span class="ddw-label">Live Routes</span>
        <span class="ddw-value">${routesData.total}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">Documented Endpoints</span>
        <span class="ddw-value">${documented}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">Drift</span>
        <span class="ddw-value ${driftClass}">${driftLabel}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">GET</span>
        <span class="ddw-value">${methodCounts.GET || 0}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">POST</span>
        <span class="ddw-value">${methodCounts.POST || 0}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">PUT/PATCH</span>
        <span class="ddw-value">${(methodCounts.PUT || 0) + (methodCounts.PATCH || 0)}</span>
      </div>
      <div class="ddw-row">
        <span class="ddw-label">DELETE</span>
        <span class="ddw-value">${methodCounts.DELETE || 0}</span>
      </div>
      ${dbStats.totalTasks ? `
      <div class="ddw-row">
        <span class="ddw-label">Tasks in DB</span>
        <span class="ddw-value">${dbStats.totalTasks}</span>
      </div>` : ''}
      ${dbStats.totalProjects ? `
      <div class="ddw-row">
        <span class="ddw-label">Projects in DB</span>
        <span class="ddw-value">${dbStats.totalProjects}</span>
      </div>` : ''}
      <div class="ddw-summary ${driftClass}">
        ${drift === 0 ? '✅ All documented' : `⚠️ ${Math.abs(drift)} route${Math.abs(drift) !== 1 ? 's' : ''} ${drift > 0 ? 'missing from docs' : 'documented but not live'}`}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="ddw-title">📐 Docs Drift Check</div><div style="color:var(--win11-text-tertiary)">Error: ${err.message}</div>`;
  }
}

export default renderDocsDriftWidget;
