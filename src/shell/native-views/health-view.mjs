import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

export async function renderHealthView({ mountNode, api, sync }) {
  ensureNativeRoot(mountNode, 'health-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let healthData = null;
  let statusData = null;

  const style = document.createElement('style');
  style.textContent = `
    .hv-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center; }
    .hv-title { font-size:1.15rem;font-weight:600; }
    .hv-content { flex:1;overflow-y:auto;padding:16px; }
    .hv-section { margin-bottom:20px; }
    .hv-section h3 { margin:0 0 12px;font-size:0.95rem;font-weight:600;color:var(--win11-text); }
    .hv-status-row { display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);margin-bottom:6px; }
    .hv-status-name { font-weight:600;font-size:0.88rem; }
    .hv-status-badge { font-size:0.75rem;padding:2px 8px;border-radius:4px;font-weight:600; }
    .hv-status-badge.ok { background:rgba(34,197,94,0.15);color:#22c55e; }
    .hv-status-badge.warn { background:rgba(234,179,8,0.15);color:#eab308; }
    .hv-status-badge.error { background:rgba(239,68,68,0.15);color:#ef4444; }
    .hv-detail { font-size:0.8rem;color:var(--win11-text-secondary);margin-top:4px; }
    .hv-loading { text-align:center;padding:20px;color:var(--win11-text-secondary); }
    .hv-btn { padding:6px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.82rem; }
    .hv-btn:hover { background:var(--win11-surface-active); }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'hv-header';
  header.innerHTML = `<div class="hv-title">💚 Health Check</div><button id="hv-refresh" class="hv-btn">↻ Refresh</button>`;
  root.appendChild(header);

  const content = document.createElement('div');
  content.className = 'hv-content';
  root.appendChild(content);

  mountNode.appendChild(root);

  root.querySelector('#hv-refresh').addEventListener('click', async () => {
    content.innerHTML = '<div class="hv-loading">Refreshing...</div>';
    await loadData();
    render();
  });

  async function loadData() {
    try {
      const [h, s] = await Promise.allSettled([
        api.health.check().catch(() => null),
        fetch('/api/health-status').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      healthData = h.status === 'fulfilled' ? h.value : null;
      statusData = s.status === 'fulfilled' ? s.value : null;
    } catch (err) {
      console.error('[HealthView]', err);
    }
  }

  function render() {
    content.innerHTML = '';

    // Overall status
    const overallStatus = statusData?.status || healthData?.status || 'unknown';
    const statusTone = overallStatus === 'healthy' || overallStatus === 'ok' ? 'ok' : overallStatus === 'degraded' ? 'warn' : 'error';
    const checkedAt = statusData?.timestamp || healthData?.timestamp || 'unknown';

    const statsGrid = document.createElement('div');
    statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;';
    statsGrid.appendChild(createStatCard({ label: 'Overall', value: overallStatus.toUpperCase(), tone: statusTone === 'ok' ? 'good' : statusTone === 'warn' ? 'neutral' : 'bad' }));
    statsGrid.appendChild(createStatCard({ label: 'Storage', value: healthData?.storage_type || statusData?.database?.status || 'unknown' }));
    statsGrid.appendChild(createStatCard({ label: 'Gateway', value: statusData?.gateway?.status || 'unknown', tone: (statusData?.gateway?.status || '') === 'running' ? 'good' : 'neutral' }));
    statsGrid.appendChild(createStatCard({ label: 'Port', value: healthData?.port || '3876' }));
    content.appendChild(statsGrid);

    // Detailed checks from /api/health-status
    if (statusData && statusData.checks) {
      const section = document.createElement('div');
      section.className = 'hv-section';
      section.innerHTML = '<h3>Service Checks</h3>';
      content.appendChild(section);

      for (const [name, check] of Object.entries(statusData.checks)) {
        const healthy = check.healthy !== false;
        const tone = healthy ? 'ok' : 'error';
        const detail = check.latency_ms
          ? `Latency: ${check.latency_ms}ms`
          : check.status || check.note || (check.count !== undefined ? `Count: ${check.count}` : '');

        const row = document.createElement('div');
        row.className = 'hv-status-row';
        row.innerHTML = `
          <div>
            <div class="hv-status-name">${escapeHtml(name)}</div>
            <div class="hv-detail">${escapeHtml(detail)}</div>
          </div>
          <span class="hv-status-badge ${tone}">${healthy ? '● Healthy' : '● Unhealthy'}</span>
        `;
        content.appendChild(row);
      }
    }

    // Raw health-status fields if available
    if (statusData) {
      const fields = ['database', 'gateway', 'task_server'];
      const existingChecks = statusData.checks ? Object.keys(statusData.checks) : [];
      const extraFields = fields.filter(f => !existingChecks.includes(f) && statusData[f]);

      if (extraFields.length) {
        const section = document.createElement('div');
        section.className = 'hv-section';
        section.innerHTML = '<h3>Infrastructure</h3>';
        content.appendChild(section);

        extraFields.forEach(field => {
          const val = statusData[field];
          const status = val.status || val.healthy !== false ? 'ok' : 'error';
          const detail = typeof val === 'string' ? val : (val.status || val.healthy !== false ? 'Connected' : 'Disconnected');
          const row = document.createElement('div');
          row.className = 'hv-status-row';
          row.innerHTML = `
            <div class="hv-status-name">${escapeHtml(field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</div>
            <span class="hv-status-badge ${status}">${escapeHtml(detail)}</span>
          `;
          content.appendChild(row);
        });
      }
    }

    // Last checked
    const footer = document.createElement('div');
    footer.style.cssText = 'text-align:center;font-size:0.78rem;color:var(--win11-text-tertiary);padding:12px 0;';
    footer.textContent = `Last checked: ${checkedAt !== 'unknown' ? new Date(checkedAt).toLocaleString() : 'N/A'}`;
    content.appendChild(footer);
  }

  await loadData();
  render();

  return () => {};
}

export default renderHealthView;
