/**
 * Diagnostics View — Webos Native Window
 *
 * System health monitoring, failure analysis, log inspection,
 * and repair actions for cron jobs and repeating tasks.
 */

import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

const DIAG_API = '/api/diagnostics';

function formatAge(ms) {
  if (!ms && ms !== 0) return '-';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '< 1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function statusLabel(status) {
  return { healthy: 'Healthy', failing: 'Failing', stale: 'Stale', persistent: 'Persistent' }[status] || 'Unknown';
}

function statusColor(status) {
  return {
    healthy: 'var(--win11-success, #22c55e)',
    failing: 'var(--win11-error, #ef4444)',
    stale: 'var(--win11-warning, #f59e0b)',
    persistent: 'var(--win11-text-secondary)',
  }[status] || 'var(--win11-text-secondary)';
}

export async function renderDiagnosticsView({ mountNode }) {
  if (!mountNode) {
    console.error('[Diagnostics] mountNode is null');
    return () => {};
  }

  ensureNativeRoot(mountNode, 'diagnostics-view');
  mountNode.innerHTML = '';

  // Local refs — never query DOM for these
  let allJobs = [];
  let activeFilter = 'all';
  let selectedJobId = null;
  let refreshTimer = null;
  let activeTab = 'info';
  let destroyed = false;

  const style = document.createElement('style');
  style.textContent = `
    .diag-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px; }
    .diag-title { font-size:1.15rem;font-weight:600; }
    .diag-content { flex:1;overflow-y:auto;padding:16px; }
    .diag-stats { display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px; }
    .diag-filters { display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap; }
    .diag-filter-btn { padding:5px 12px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.8rem;font-weight:500;transition:all .15s; }
    .diag-filter-btn:hover { background:var(--win11-surface-active); }
    .diag-filter-btn.active { background:var(--win11-accent);border-color:var(--win11-accent);color:#fff; }
    .diag-table { width:100%;border-collapse:collapse;font-size:0.82rem; }
    .diag-table th { text-align:left;padding:8px 10px;border-bottom:2px solid var(--win11-border);font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--win11-text-secondary);white-space:nowrap; }
    .diag-table td { padding:8px 10px;border-bottom:1px solid var(--win11-border);vertical-align:middle; }
    .diag-table tbody tr { cursor:pointer;transition:background .1s; }
    .diag-table tbody tr:hover { background:var(--win11-surface-hover); }
    .diag-table tbody tr.selected { background:var(--win11-surface-active); }
    .diag-badge { display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600; }
    .diag-name { font-weight:600;color:var(--win11-text); }
    .diag-sub { font-size:0.7rem;color:var(--win11-text-tertiary); }
    .diag-error { font-family:monospace;font-size:0.74rem;color:var(--win11-text-tertiary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .diag-btn { padding:4px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.8rem;font-weight:600;transition:all .15s; }
    .diag-btn:hover { background:var(--win11-surface-active);border-color:var(--win11-accent); }
    .diag-btn.danger:hover { border-color:var(--win11-error);color:var(--win11-error); }
    .diag-btn.success:hover { border-color:var(--win11-success);color:var(--win11-success); }
    .diag-detail { background:var(--win11-surface-solid);border-radius:10px;border:1px solid var(--win11-border);margin-top:16px;overflow:hidden; }
    .diag-detail-header { padding:12px 16px;border-bottom:1px solid var(--win11-border);display:flex;justify-content:space-between;align-items:center; }
    .diag-detail-header h3 { margin:0;font-size:1rem;font-weight:600; }
    .diag-tabs { display:flex;border-bottom:1px solid var(--win11-border);padding:0 16px; }
    .diag-tab { padding:8px 14px;border:none;background:none;cursor:pointer;font-size:0.82rem;font-weight:500;color:var(--win11-text-secondary);border-bottom:2px solid transparent;transition:all .15s; }
    .diag-tab:hover { color:var(--win11-text); }
    .diag-tab.active { color:var(--win11-accent);border-bottom-color:var(--win11-accent); }
    .diag-detail-content { padding:14px 16px; }
    .diag-detail-actions { display:flex;gap:6px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid var(--win11-border);background:var(--win11-surface); }
    .diag-info-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px; }
    .diag-info-label { font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--win11-text-tertiary); }
    .diag-info-value { font-family:'Segoe UI',sans-serif;font-size:0.85rem;font-weight:600; }
    .diag-log-viewer { background:#1e1e2e;color:#cdd6f4;border-radius:8px;padding:12px;font-family:'Cascadia Code','Fira Code',monospace;font-size:0.74rem;line-height:1.6;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-all; }
    .diag-log-viewer .lf { color:#f38ba8; }
    .diag-log-viewer .ls { color:#a6e3a1; }
    .diag-log-viewer .lw { color:#fab387; }
    .diag-log-viewer .li { color:#cdd6f4; }
    .diag-cycle-sep { border-top:1px solid rgba(205,214,244,0.1);margin:5px 0; }
    .diag-cycle-item { display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--win11-border);font-size:0.82rem; }
    .diag-cycle-item:last-child { border-bottom:none; }
    .diag-cmd-box { background:var(--win11-surface);padding:8px 10px;border-radius:6px;font-family:monospace;font-size:0.78rem;word-break:break-all;margin-top:12px; }
    .diag-err-box { background:rgba(239,68,68,0.06);padding:8px 10px;border-radius:6px;font-family:monospace;font-size:0.78rem;color:var(--win11-error);border:1px solid rgba(239,68,68,0.15);margin-top:10px; }
    .diag-empty { text-align:center;padding:24px;color:var(--win11-text-secondary); }
    .diag-loading { text-align:center;padding:16px;color:var(--win11-text-secondary); }
  `;

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';
  root.appendChild(style);

  // Header
  const header = document.createElement('div');
  header.className = 'diag-header';
  header.innerHTML = '<div class="diag-title">🔍 Diagnostics</div><button class="diag-btn" id="diag-refresh">↻ Refresh</button>';
  root.appendChild(header);

  // Content — created as local ref, never queried
  const content = document.createElement('div');
  content.className = 'diag-content';
  root.appendChild(content);

  // Stats container
  const statsEl = document.createElement('div');
  statsEl.className = 'diag-stats';
  content.appendChild(statsEl);

  // Filters container
  const filtersEl = document.createElement('div');
  filtersEl.className = 'diag-filters';
  content.appendChild(filtersEl);

  // Table container
  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'background:var(--win11-surface-solid);border-radius:10px;border:1px solid var(--win11-border);overflow:hidden;';
  tableWrap.innerHTML = `<table class="diag-table"><thead><tr>
    <th>Status</th><th>Job</th><th>Schedule</th><th>Fails</th><th>Last Run</th><th>Last Error</th><th></th>
  </tr></thead><tbody id="diag-tbody"></tbody></table>`;
  content.appendChild(tableWrap);
  const tbody = tableWrap.querySelector('#diag-tbody');

  // Detail panel container
  let detailPanel = null;

  // Mount everything
  mountNode.appendChild(root);

  // ── API ──
  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
    return res.json();
  }

  // ── Render functions ──
  function renderSummary() {
    const healthy = allJobs.filter(j => j.status === 'healthy').length;
    const failing = allJobs.filter(j => j.status === 'failing').length;
    const stale = allJobs.filter(j => j.status === 'stale').length;
    const persistent = allJobs.filter(j => j.status === 'persistent').length;
    statsEl.innerHTML = '';
    statsEl.appendChild(createStatCard({ label: 'Total', value: String(allJobs.length) }));
    statsEl.appendChild(createStatCard({ label: 'Healthy', value: String(healthy), tone: 'good' }));
    statsEl.appendChild(createStatCard({ label: 'Failing', value: String(failing), tone: failing ? 'bad' : 'neutral' }));
    statsEl.appendChild(createStatCard({ label: 'Stale', value: String(stale), tone: stale ? 'warn' : 'neutral' }));
    statsEl.appendChild(createStatCard({ label: 'Persistent', value: String(persistent), tone: persistent ? 'bad' : 'neutral' }));
  }

  function renderFilters() {
    const filters = [
      { id: 'all', label: 'All' },
      { id: 'failing', label: 'Failing' },
      { id: 'stale', label: 'Stale' },
      { id: 'persistent', label: 'Persistent' },
      { id: 'healthy', label: 'Healthy' },
    ];
    filtersEl.innerHTML = filters.map(f =>
      `<button class="diag-filter-btn${f.id === activeFilter ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
    ).join('');
    filtersEl.querySelectorAll('.diag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        renderFilters();
        renderTable();
      });
    });
  }

  function renderTable() {
    const filtered = activeFilter === 'all' ? allJobs : allJobs.filter(j => j.status === activeFilter);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="diag-empty">No jobs match filter</td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(j => `
      <tr data-job-id="${escapeHtml(j.id)}" class="${j.id === selectedJobId ? 'selected' : ''}">
        <td><span class="diag-badge" style="background:${statusColor(j.status)}22;color:${statusColor(j.status)}"><span style="width:6px;height:6px;border-radius:50%;background:${statusColor(j.status)};display:inline-block;"></span>${statusLabel(j.status)}</span></td>
        <td><div class="diag-name">${escapeHtml(j.name || j.id)}</div><div class="diag-sub">${escapeHtml(j.id)}</div></td>
        <td><code style="font-size:0.78rem;">${escapeHtml(j.schedule)}</code></td>
        <td style="font-weight:700;color:${j.failureCount > 0 ? 'var(--win11-error)' : 'var(--win11-text-secondary)'}">${j.failureCount || 0}</td>
        <td style="font-size:0.8rem;">${formatAge(j.lastRunAge)}</td>
        <td class="diag-error" title="${escapeHtml(j.lastError)}">${escapeHtml(j.lastError) || '—'}</td>
        <td><button class="diag-btn success diag-run-btn" data-job-id="${escapeHtml(j.id)}" title="Run now">▶</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('tr[data-job-id]').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('.diag-run-btn')) return;
        selectJob(tr.dataset.jobId);
      });
    });
    tbody.querySelectorAll('.diag-run-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); repairAction(btn.dataset.jobId, 'run'); });
    });
  }

  function renderAll() {
    if (destroyed) return;
    renderSummary();
    renderFilters();
    renderTable();
  }

  // ── Detail Panel ──
  async function selectJob(jobId) {
    selectedJobId = jobId;
    activeTab = 'info';
    renderTable();
    renderDetail();
  }

  async function renderDetail() {
    if (!selectedJobId || destroyed) return;
    let detail;
    try {
      detail = await api(`${DIAG_API}/jobs/${encodeURIComponent(selectedJobId)}`);
    } catch (e) {
      ensureDetailPanel();
      detailPanel.querySelector('.diag-detail-body').innerHTML = `<div style="color:var(--win11-error);">Failed to load: ${escapeHtml(e.message)}</div>`;
      return;
    }

    ensureDetailPanel();
    detailPanel.innerHTML = `
      <div class="diag-detail-header">
        <h3>${escapeHtml(detail.name || selectedJobId)}</h3>
        <button class="diag-btn" id="diag-close-detail">✕ Close</button>
      </div>
      <div class="diag-tabs">
        <button class="diag-tab${activeTab === 'info' ? ' active' : ''}" data-tab="info">Info</button>
        <button class="diag-tab${activeTab === 'logs' ? ' active' : ''}" data-tab="logs">Logs</button>
        <button class="diag-tab${activeTab === 'cycles' ? ' active' : ''}" data-tab="cycles">Run Cycles</button>
      </div>
      <div class="diag-detail-body" id="diag-detail-body"></div>
      <div class="diag-detail-actions">
        <button class="diag-btn success" data-action="run">▶ Run Now</button>
        <button class="diag-btn" data-action="reset_failure">↺ Reset Failures</button>
        <button class="diag-btn danger" data-action="disable">⏸ Disable</button>
        <button class="diag-btn" data-action="enable">▶ Enable</button>
      </div>
    `;

    detailPanel.querySelector('#diag-close-detail').addEventListener('click', () => {
      selectedJobId = null;
      if (detailPanel) { detailPanel.remove(); detailPanel = null; }
      renderTable();
    });

    detailPanel.querySelectorAll('.diag-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        activeTab = tab.dataset.tab;
        detailPanel.querySelectorAll('.diag-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
        await renderDetailBody(detail);
      });
    });

    detailPanel.querySelectorAll('.diag-detail-actions .diag-btn').forEach(btn => {
      btn.addEventListener('click', () => repairAction(selectedJobId, btn.dataset.action));
    });

    await renderDetailBody(detail);
  }

  function ensureDetailPanel() {
    if (detailPanel && detailPanel.parentNode) return;
    detailPanel = document.createElement('div');
    detailPanel.className = 'diag-detail';
    content.appendChild(detailPanel);
  }

  async function renderDetailBody(detail) {
    if (destroyed) return;
    const body = detailPanel ? detailPanel.querySelector('.diag-detail-body') : null;
    if (!body) return;

    if (activeTab === 'info') {
      body.innerHTML = `
        <div class="diag-info-grid">
          ${[
            ['Status', `<span style="color:${statusColor(detail.status)}">${statusLabel(detail.status)}</span>`],
            ['Schedule', escapeHtml(detail.schedule)],
            ['Last Run', detail.lastRun ? new Date(detail.lastRun).toLocaleString() : 'Never'],
            ['Age', formatAge(detail.lastRunAge)],
            ['Failures', `<span style="color:${detail.failureCount > 0 ? 'var(--win11-error)' : 'var(--win11-text)'}">${detail.failureCount || 0}</span>`],
            ['Type', escapeHtml(detail.failureType) || '—'],
            ['First Seen', detail.firstSeen ? new Date(detail.firstSeen).toLocaleString() : '—'],
            ['Escalated', detail.escalated ? new Date(detail.escalated).toLocaleString() : '—'],
          ].map(([l, v]) => `<div><div class="diag-info-label">${l}</div><div class="diag-info-value">${v}</div></div>`).join('')}
        </div>
        <div style="margin-top:12px;"><div class="diag-info-label">Command</div><div class="diag-cmd-box">${escapeHtml(detail.command)}</div></div>
        <div style="margin-top:10px;"><div class="diag-info-label">Log Path</div><div style="font-family:monospace;font-size:0.8rem;">${escapeHtml(detail.logPath)}</div></div>
        ${detail.lastError ? `<div style="margin-top:10px;"><div class="diag-info-label">Last Error</div><div class="diag-err-box">${escapeHtml(detail.lastError)}</div></div>` : ''}
      `;
    } else if (activeTab === 'logs') {
      body.innerHTML = '<div class="diag-log-viewer">Loading logs...</div>';
      try {
        const data = await api(`${DIAG_API}/jobs/${encodeURIComponent(selectedJobId)}/logs?lines=300`);
        const viewer = body.querySelector('.diag-log-viewer');
        if (!viewer) return;
        if (!data.cycles?.length) { viewer.innerHTML = '<span style="color:#89b4fa;">No log data available.</span>'; return; }
        viewer.innerHTML = data.cycles.map(c => {
          let h = c.lines.length > 2 ? '<div class="diag-cycle-sep"></div>' : '';
          h += c.lines.map(l => {
            const cls = { failure: 'lf', success: 'ls', warning: 'lw' }[l.highlight] || 'li';
            return `<div class="${cls}">${escapeHtml(l.text)}</div>`;
          }).join('');
          return h;
        }).join('');
      } catch (e) {
        const viewer = body.querySelector('.diag-log-viewer');
        if (viewer) viewer.innerHTML = `<span class="lf">Error: ${escapeHtml(e.message)}</span>`;
      }
    } else if (activeTab === 'cycles') {
      body.innerHTML = '<div class="diag-loading">Loading cycles...</div>';
      try {
        const data = await api(`${DIAG_API}/jobs/${encodeURIComponent(selectedJobId)}`);
        if (!data.cycles?.length) { body.innerHTML = '<div class="diag-empty">No run cycles detected</div>'; return; }
        body.innerHTML = data.cycles.slice().reverse().map((c, i) => {
          const icon = c.hasFailure ? '🔴' : c.hasSuccess ? '✅' : '⚪';
          const label = c.failure || (c.hasSuccess ? 'Success' : 'Unknown');
          return `<div class="diag-cycle-item"><span>${icon}</span><span style="font-weight:600;">Cycle ${data.cycles.length - i}</span><span class="diag-badge" style="background:${c.failure ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'};color:${c.failure ? 'var(--win11-error)' : 'var(--win11-success)'}">${escapeHtml(label)}</span><span style="color:var(--win11-text-secondary);font-size:0.76rem;">${c.lineCount} lines</span></div>`;
        }).join('');
      } catch (_) { body.innerHTML = '<div class="diag-empty">Failed to load cycles</div>'; }
    }
  }

  // ── Repair ──
  async function repairAction(jobId, action) {
    const msgs = { run: `Run "${jobId}" now?`, reset_failure: `Reset failures for "${jobId}"?`, disable: `Disable "${jobId}"?`, enable: `Enable "${jobId}"?` };
    if (msgs[action] && !confirm(msgs[action])) return;
    try {
      const result = await api(`${DIAG_API}/jobs/${encodeURIComponent(jobId)}/repair`, { method: 'POST', body: JSON.stringify({ action }) });
      if (result.success) {
        setTimeout(async () => {
          if (destroyed) return;
          await loadJobs();
          renderAll();
          if (selectedJobId === jobId && detailPanel) await renderDetail();
        }, action === 'run' ? 2000 : 300);
      } else {
        alert(`Failed: ${result.error}`);
      }
    } catch (e) { alert(`Error: ${e.message}`); }
  }

  // ── Loaders ──
  async function loadJobs() {
    try {
      const data = await api(`${DIAG_API}/jobs`);
      allJobs = data.jobs || [];
    } catch (e) {
      console.error('[Diagnostics]', e);
      allJobs = [];
    }
  }

  // ── Wire refresh ──
  root.querySelector('#diag-refresh').addEventListener('click', async () => {
    await loadJobs();
    renderAll();
  });

  // ── Init ──
  await loadJobs();
  renderAll();

  // Auto-refresh every 30s
  refreshTimer = setInterval(async () => {
    if (destroyed) return;
    await loadJobs();
    renderAll();
  }, 30000);

  // Cleanup
  return () => {
    destroyed = true;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    selectedJobId = null;
    detailPanel = null;
  };
}

export default renderDiagnosticsView;
