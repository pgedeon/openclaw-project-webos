import { ensureNativeRoot, createStatCard, formatCount, escapeHtml } from './helpers.mjs';

export async function renderMetricsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode);
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let metricsData = null;
  let cleanupFns = [];
  let noticeTimer = null;
  let syncUnsubscribe = null;
  let dateFrom = null;
  let dateTo = null;

  const style = document.createElement('style');
  style.textContent = `
    .mtv-card { background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:10px;padding:14px; }
    .mtv-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px; }
    .mtv-table { width:100%;border-collapse:collapse;font-size:0.82rem; }
    .mtv-table th { text-align:left;padding:8px 10px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--win11-text-tertiary);border-bottom:1px solid var(--win11-border); }
    .mtv-table td { padding:8px 10px;border-bottom:1px solid var(--win11-border); }
    .mtv-btn { font-size:0.78rem;padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer; }
    .mtv-btn:hover { background:var(--win11-surface-active); }
    .mtv-btn.active { background:var(--win11-accent);color:#fff;border-color:transparent; }
    .mtv-input { padding:5px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.82rem;outline:none; }
    .mtv-input:focus { border-color:var(--win11-accent); }
    .mtv-bar-track { height:6px;background:var(--win11-border);border-radius:3px;overflow:hidden; }
    .mtv-bar-fill { height:100%;border-radius:3px;transition:width 0.3s; }
    .mtv-notice { padding:6px 12px;border-radius:6px;font-size:0.82rem;text-align:center;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);display:none;margin-top:8px; }
    .mtv-notice.is-visible { display:block; }
    .mtv-notice.is-error { background:rgba(239,68,68,0.1);color:#ef4444;border-color:rgba(239,68,68,0.2); }
  `;
  root.appendChild(style);

  function applyRange(days) {
    const to = new Date();
    const from = new Date(to.getTime() - ((days - 1) * 86400000));
    dateFrom = from.toISOString().slice(0, 10);
    dateTo = to.toISOString().slice(0, 10);
    root.querySelector('#mtvFrom').value = dateFrom;
    root.querySelector('#mtvTo').value = dateTo;
    root.querySelectorAll('.mtv-range-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.days) === days));
    loadMetrics();
  }

  root.innerHTML += `
    <div style="padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <h2 style="margin:0 0 4px;color:var(--win11-text);font-size:1.2rem;font-weight:700;">📊 Metrics</h2><span style="font-size:0.7rem;color:var(--win11-accent);opacity:0.7;margin-left:4px;" title="Live data">●</span>
          <p style="margin:0;color:var(--win11-text-secondary);font-size:0.85rem;">Organization-wide performance scorecard.</p>
        </div>
        <button id="mtvRefresh" class="mtv-btn">↻ Refresh</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="mtvFrom" class="mtv-input" style="width:auto;">
        <span style="color:var(--win11-text-tertiary);">→</span>
        <input type="date" id="mtvTo" class="mtv-input" style="width:auto;">
        <div style="display:flex;gap:4px;margin-left:8px;">
          <button class="mtv-btn mtv-range-btn active" data-days="7">7d</button>
          <button class="mtv-btn mtv-range-btn" data-days="30">30d</button>
          <button class="mtv-btn mtv-range-btn" data-days="90">90d</button>
        </div>
      </div>
    </div>
    <div id="mtvGrid" style="flex:1;overflow-y:auto;padding:12px 16px;">
      <div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">Loading metrics...</div>
    </div>
    <div id="mtvNotice" class="mtv-notice"></div>
  `;
  mountNode.appendChild(root);

  function fmtPct(v) { return v === null || v === undefined ? 'N/A' : `${Number(v).toFixed(1)}%`; }
  function fmtHrs(v) { return v === null || v === undefined ? 'N/A' : `${Number(v).toFixed(1)}h`; }

  function renderGrid() {
    const grid = root.querySelector('#mtvGrid');
    const sc = metricsData?.scorecard;
    const dr = metricsData?.dateRange;
    if (!sc) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--win11-text-tertiary);">No metrics data available.</div>';
      return;
    }

    const successRate = sc.workflowSuccessRate ?? 0;
    const barColor = successRate >= 90 ? '#22c55e' : successRate >= 70 ? '#eab308' : '#ef4444';

    grid.innerHTML = `
      <div style="margin-bottom:12px;font-size:0.78rem;color:var(--win11-text-tertiary);">
        ${dr ? `Period: ${escapeHtml(dr.from?.slice(0,10))} → ${escapeHtml(dr.to?.slice(0,10))} (${dr.days || '?'} days)` : ''}
      </div>
      <div class="mtv-grid" style="margin-bottom:16px;">
        ${[
          { label:'Workflow Runs', value:formatCount(sc.workflowRunsStarted || 0), sub:`${sc.workflowRunsCompleted || 0} completed, ${sc.workflowRunsFailed || 0} failed` },
          { label:'Success Rate', value:fmtPct(sc.workflowSuccessRate), sub:`${sc.workflowRunsFailed || 0} failures`, bar:successRate, barColor },
          { label:'Median Completion', value:fmtHrs(sc.medianCompletionHours), sub:'from start to done' },
          { label:'Blocked Time', value:fmtHrs(sc.blockedTimeHours), sub:'total hours blocked' },
          { label:'Pending Approvals', value:formatCount(sc.pendingApprovals || 0) },
          { label:'Active Workload', value:formatCount(sc.activeWorkload || 0) },
          { label:'Approval Latency', value:fmtHrs(sc.approvalLatencyHours), sub:'median' },
          { label:'Stale Runs', value:formatCount(sc.staleRunCount || 0) },
          { label:'Departments', value:formatCount(sc.departmentsTracked || 0) },
          { label:'Agents', value:formatCount(sc.agentsTracked || 0) },
          { label:'Services', value:formatCount(sc.servicesTracked || 0) },
          { label:'SR Opened / Completed', value:`${sc.serviceRequestsOpened || 0} / ${sc.serviceRequestsCompleted || 0}` },
        ].map(c => `<div class="mtv-card">
          <div style="font-size:0.72rem;color:var(--win11-text-tertiary);text-transform:uppercase;letter-spacing:0.06em;">${c.label}</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--win11-text);margin:4px 0 2px;">${c.value}</div>
          ${c.sub ? `<div style="font-size:0.72rem;color:var(--win11-text-secondary);">${c.sub}</div>` : ''}
          ${c.bar !== undefined ? `<div class="mtv-bar-track" style="margin-top:6px;"><div class="mtv-bar-fill" style="width:${Math.min(c.bar,100)}%;background:${c.barColor};"></div></div>` : ''}
        </div>`).join('')}
      </div>
    `;
  }

  async function loadMetrics() {
    const from = root.querySelector('#mtvFrom')?.value || dateFrom;
    const to = root.querySelector('#mtvTo')?.value || dateTo;
    if (!from || !to) return;
    dateFrom = from; dateTo = to;
    try {
      metricsData = await api.metrics.org({ from, to });
      renderGrid();
    } catch (e) {
      root.querySelector('#mtvGrid').innerHTML = `<div style="padding:24px;color:#ef4444;">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }

  root.querySelectorAll('.mtv-range-btn').forEach(btn => {
    const h = () => applyRange(parseInt(btn.dataset.days));
    btn.addEventListener('click', h);
    cleanupFns.push(() => btn.removeEventListener('click', h));
  });

  root.querySelector('#mtvFrom')?.addEventListener('change', loadMetrics);
  root.querySelector('#mtvTo')?.addEventListener('change', loadMetrics);
  root.querySelector('#mtvRefresh')?.addEventListener('click', loadMetrics);

  if (sync) {
    syncUnsubscribe = sync.subscribe(() => loadMetrics());
  }

  applyRange(30);

  return () => {
    if (syncUnsubscribe) syncUnsubscribe();
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];
  };
}

export default renderMetricsView;
