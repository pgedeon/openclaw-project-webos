import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

const MORNING_JOB_ID = '64c1165f-eb92-48e2-b032-8aca0065defc';
const AUTH_HEADER = () => ({ 'Authorization': `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__ || ''}` });

/** Render markdown-ish briefing text into safe HTML. */
function renderBriefingMarkdown(text) {
  let html = escapeHtml(text);

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Headings (### or ##)
  html = html.replace(/^###\s+(.+)$/gm, '<h4 class="mr-section">$1</h4>');
  html = html.replace(/^##\s+(.+)$/gm, '<h3 class="mr-section">$1</h3>');

  // Bullet list items
  html = html.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="mr-list">${m}</ul>`);

  // Paragraph breaks
  html = html.replace(/\n\n+/g, '</p><p class="mr-para">');
  html = `<p class="mr-para">${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p class="mr-para">\s*<\/p>/g, '');

  return html;
}

export async function renderMorningReportView({ mountNode, sync }) {
  ensureNativeRoot(mountNode, 'morning-report-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const style = document.createElement('style');
  style.textContent = `
    .mr-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--win11-border);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .mr-title { font-size: 1.15rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .mr-content { flex: 1; overflow-y: auto; padding: 20px 24px; line-height: 1.65; font-size: 0.9rem; }
    .mr-meta-bar {
      display: flex; gap: 16px; flex-wrap: wrap;
      font-size: 0.78rem; color: var(--win11-text-secondary);
      padding: 8px 16px; border-bottom: 1px solid var(--win11-border);
      flex-shrink: 0;
    }
    .mr-badge {
      font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; font-weight: 600;
    }
    .mr-badge.ok { background: rgba(34,197,94,0.15); color: #22c55e; }
    .mr-badge.warn { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .mr-badge.bad { background: rgba(239,68,68,0.15); color: #ef4444; }
    .mr-badge.muted { background: rgba(148,163,184,0.12); color: var(--win11-text-secondary); }
    .mr-btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid var(--win11-border);
      background: var(--win11-surface-solid); color: var(--win11-text);
      cursor: pointer; font-size: 0.85rem;
    }
    .mr-btn:hover { background: var(--win11-surface-active); }
    .mr-btn:disabled { opacity: 0.5; cursor: default; }
    .mr-loading { text-align: center; padding: 40px; color: var(--win11-text-secondary); }
    .mr-error { text-align: center; padding: 32px; color: #ef4444; }
    .mr-empty { text-align: center; padding: 40px; color: var(--win11-text-secondary); }
    .mr-section {
      margin-top: 16px; margin-bottom: 6px;
      font-weight: 600; font-size: 0.95rem;
      color: var(--win11-text);
    }
    .mr-list { margin: 4px 0 8px 0; padding-left: 4px; list-style: none; }
    .mr-list li {
      padding: 2px 0 2px 16px; position: relative;
    }
    .mr-list li::before {
      content: '▸'; position: absolute; left: 0; color: var(--win11-accent);
    }
    .mr-para { margin: 6px 0; }
    .mr-history {
      flex-shrink: 0; border-top: 1px solid var(--win11-border);
      padding: 10px 16px; max-height: 180px; overflow-y: auto;
    }
    .mr-history-title { font-size: 0.8rem; font-weight: 600; margin-bottom: 6px; color: var(--win11-text-secondary); }
    .mr-history-item {
      display: flex; gap: 10px; align-items: center;
      padding: 4px 0; font-size: 0.78rem; cursor: pointer;
      border-bottom: 1px solid var(--win11-border);
    }
    .mr-history-item:hover { background: var(--win11-surface-active); }
    .mr-history-item.active { background: rgba(59,130,246,0.08); }
  `;
  root.appendChild(style);

  // Header
  const header = document.createElement('div');
  header.className = 'mr-header';
  header.innerHTML = `
    <div class="mr-title">☀️ Morning Intelligence Briefing</div>
    <div style="display:flex;gap:8px;">
      <button id="mr-refresh" class="mr-btn">↻ Refresh</button>
      <button id="mr-run-now" class="mr-btn">▶ Run Now</button>
    </div>
  `;
  root.appendChild(header);

  // Meta bar
  const metaBar = document.createElement('div');
  metaBar.className = 'mr-meta-bar';
  root.appendChild(metaBar);

  // Content area
  const content = document.createElement('div');
  content.className = 'mr-content';
  root.appendChild(content);

  // History strip
  const history = document.createElement('div');
  history.className = 'mr-history';
  root.appendChild(history);

  mountNode.appendChild(root);

  let runs = [];
  let selectedRunIdx = 0;

  async function loadData() {
    content.innerHTML = '<div class="mr-loading">Loading briefing…</div>';
    try {
      const resp = await fetch(`/api/cron/jobs/${MORNING_JOB_ID}/runs`, { headers: AUTH_HEADER() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw = data.runs || data;
      runs = raw.entries || raw.runs || (Array.isArray(raw) ? raw : []);
      runs.sort((a, b) => (b.runAtMs || b.ts || 0) - (a.runAtMs || a.ts || 0));
    } catch (err) {
      console.error('[MorningReport]', err);
      content.innerHTML = `<div class="mr-error">Failed to load briefing: ${escapeHtml(err.message)}</div>`;
      return;
    }
    render();
  }

  function formatDate(ms) {
    if (!ms) return 'N/A';
    const d = new Date(ms);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    if (runs.length === 0) {
      content.innerHTML = '<div class="mr-empty">No briefing runs found.</div>';
      metaBar.innerHTML = '';
      history.innerHTML = '';
      return;
    }

    const run = runs[selectedRunIdx] || runs[0];
    const summary = run.summary || run.output || 'No summary available.';
    const isLatest = selectedRunIdx === 0;
    const delivered = run.delivery?.resolved?.ok || run.delivered;
    const deliveryNote = delivered ? 'delivered' : 'not delivered';

    // Meta bar
    metaBar.innerHTML = `
      <span>📅 ${escapeHtml(formatDate(run.runAtMs || run.ts))}</span>
      <span class="mr-badge ${run.status === 'ok' ? 'ok' : 'bad'}">${escapeHtml(run.status || 'unknown')}</span>
      ${!isLatest ? `<span class="mr-badge muted">viewing history</span>` : ''}
      <span class="mr-badge ${delivered ? 'ok' : 'warn'}">${deliveryNote}</span>
      ${run.durationMs ? `<span>⏱ ${(run.durationMs / 1000).toFixed(0)}s</span>` : ''}
      <span>🤖 ${escapeHtml(run.model || '?')}</span>
    `;

    // Content — render the briefing summary
    content.innerHTML = `<div class="mr-briefing">${renderBriefingMarkdown(summary)}</div>`;

    // History strip
    if (runs.length > 1) {
      let html = '<div class="mr-history-title">Recent Runs</div>';
      runs.slice(0, 10).forEach((r, i) => {
        const cls = i === selectedRunIdx ? 'mr-history-item active' : 'mr-history-item';
        const status = r.status === 'ok' ? '✅' : '❌';
        html += `
          <div class="${cls}" data-idx="${i}">
            <span>${status}</span>
            <span>${escapeHtml(formatDate(r.runAtMs || r.ts))}</span>
            <span style="color:var(--win11-text-secondary);font-size:0.72rem;">${escapeHtml((r.summary || '').substring(0, 80))}…</span>
          </div>
        `;
      });
      history.innerHTML = html;

      history.querySelectorAll('[data-idx]').forEach(el => {
        el.addEventListener('click', () => {
          selectedRunIdx = parseInt(el.dataset.idx, 10);
          render();
        });
      });
    } else {
      history.innerHTML = '';
    }
  }

  // Wire up buttons
  root.querySelector('#mr-refresh').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Loading…';
    await loadData();
    e.target.disabled = false;
    e.target.textContent = '↻ Refresh';
  });

  root.querySelector('#mr-run-now').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Triggering…';
    try {
      const resp = await fetch(`/api/cron/jobs/${MORNING_JOB_ID}/run`, {
        method: 'POST',
        headers: { ...AUTH_HEADER(), 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      e.target.textContent = '✓ Triggered';
      setTimeout(() => { e.target.disabled = false; e.target.textContent = '▶ Run Now'; }, 3000);
    } catch (err) {
      e.target.textContent = '✗ Failed';
      console.error('[MorningReport] run failed:', err);
      setTimeout(() => { e.target.disabled = false; e.target.textContent = '▶ Run Now'; }, 3000);
    }
  });

  await loadData();

  return () => {};
}

export default renderMorningReportView;
