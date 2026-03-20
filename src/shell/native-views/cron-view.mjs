import { ensureNativeRoot, escapeHtml, createStatCard } from './helpers.mjs';

const CRON_ADMIN_BASE = 'http://127.0.0.1:3878/api/cron-admin';

export async function renderCronView({ mountNode, sync }) {
  ensureNativeRoot(mountNode, 'cron-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let jobs = [];
  let filter = '';

  const style = document.createElement('style');
  style.textContent = `
    .cron-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px; }
    .cron-title { font-size:1.15rem;font-weight:600; }
    .cron-content { flex:1;overflow-y:auto;padding:16px; }
    .cron-stats { display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px; }
    .cron-search { display:flex;gap:8px;margin-bottom:16px; }
    .cron-search input { flex:1;padding:8px 12px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.85rem;outline:none; }
    .cron-search input:focus { border-color:var(--win11-accent); }
    .cron-btn { padding:8px 16px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.85rem; }
    .cron-btn:hover { background:var(--win11-surface-active); }
    .cron-job { padding:10px 12px;border-radius:8px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);margin-bottom:8px; }
    .cron-job-name { font-weight:600;font-size:0.9rem;margin-bottom:4px; }
    .cron-job-meta { font-size:0.78rem;color:var(--win11-text-secondary);display:flex;gap:12px;align-items:center;flex-wrap:wrap; }
    .cron-badge { font-size:0.7rem;padding:2px 6px;border-radius:3px;font-weight:600; }
    .cron-badge.enabled { background:rgba(34,197,94,0.15);color:#22c55e; }
    .cron-badge.disabled { background:rgba(239,68,68,0.15);color:#ef4444; }
    .cron-empty { text-align:center;padding:32px;color:var(--win11-text-secondary); }
    .cron-loading { text-align:center;padding:20px;color:var(--win11-text-secondary); }
  `;
  root.appendChild(style);

  const header = document.createElement('div');
  header.className = 'cron-header';
  header.innerHTML = `<div class="cron-title">⏰ Cron Jobs</div><button id="cron-refresh" class="cron-btn">↻ Refresh</button>`;
  root.appendChild(header);

  const content = document.createElement('div');
  content.className = 'cron-content';
  root.appendChild(content);

  mountNode.appendChild(root);

  root.querySelector('#cron-refresh').addEventListener('click', async () => {
    content.innerHTML = '<div class="cron-loading">Refreshing...</div>';
    await loadJobs();
    render();
  });

  async function loadJobs() {
    try {
      const resp = await fetch(`${CRON_ADMIN_BASE}/jobs`);
      if (!resp.ok) throw new Error('Failed to fetch cron jobs');
      const data = await resp.json();
      jobs = data.jobs || [];
    } catch (err) {
      console.error('[CronView]', err);
      jobs = [];
    }
  }

  function render() {
    content.innerHTML = '';

    const enabled = jobs.filter(j => j.enabled !== false);
    const failed = jobs.filter(j => j.last_status === 'failed');

    const statsGrid = document.createElement('div');
    statsGrid.className = 'cron-stats';
    statsGrid.appendChild(createStatCard({ label: 'Total', value: String(jobs.length) }));
    statsGrid.appendChild(createStatCard({ label: 'Enabled', value: String(enabled.length), tone: 'good' }));
    statsGrid.appendChild(createStatCard({ label: 'Disabled', value: String(jobs.length - enabled.length), tone: 'neutral' }));
    statsGrid.appendChild(createStatCard({ label: 'Failed', value: String(failed.length), tone: failed.length ? 'bad' : 'neutral' }));
    content.appendChild(statsGrid);

    const searchBox = document.createElement('div');
    searchBox.className = 'cron-search';
    searchBox.innerHTML = `<input id="cron-filter" placeholder="Filter jobs..." value="${escapeHtml(filter)}"><button class="cron-btn">Filter</button>`;
    content.appendChild(searchBox);

    const filterBtn = searchBox.querySelector('.cron-btn');
    const filterInput = searchBox.querySelector('#cron-filter');
    filterBtn.addEventListener('click', () => { filter = filterInput.value; render(); });
    filterInput.addEventListener('input', (e) => { filter = e.target.value; render(); });

    const filtered = jobs.filter(j => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (j.name || '').toLowerCase().includes(q) || (j.command || '').toLowerCase().includes(q) || (j.schedule || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      content.innerHTML += '<div class="cron-empty">No cron jobs found</div>';
      return;
    }

    filtered.forEach(job => {
      const card = document.createElement('div');
      card.className = 'cron-job';
      const isEnabled = job.enabled !== false;
      const lastStatus = job.last_status || 'unknown';
      const lastRun = job.last_run ? new Date(job.last_run).toLocaleString() : 'Never';
      const nextRun = job.next_run ? new Date(job.next_run).toLocaleString() : 'N/A';

      card.innerHTML = `
        <div class="cron-job-name">${escapeHtml(job.name || 'unnamed')}</div>
        <div class="cron-job-meta">
          <span class="cron-badge ${isEnabled ? 'enabled' : 'disabled'}">${isEnabled ? '● enabled' : '○ disabled'}</span>
          <span>📅 ${escapeHtml(job.schedule || 'N/A')}</span>
          <span>↻ ${escapeHtml(lastRun)}</span>
          <span>▶ ${escapeHtml(nextRun)}</span>
          <span style="color:${lastStatus === 'ok' || lastStatus === 'success' ? '#22c55e' : lastStatus === 'failed' ? '#ef4444' : 'var(--win11-text-secondary)'};">Last: ${escapeHtml(lastStatus)}</span>
        </div>
        ${job.command ? `<div style="font-size:0.78rem;color:var(--win11-text-tertiary);margin-top:6px;font-family:monospace;word-break:break-all;">${escapeHtml(job.command.substring(0, 200))}${job.command.length > 200 ? '...' : ''}</div>` : ''}
      `;
      content.appendChild(card);
    });
  }

  await loadJobs();
  render();

  return () => {};
}

export default renderCronView;
