/**
 * Bing Webmaster View — URL Submission & Index Management
 *
 * Submit URLs to Bing, check quotas, and manage IndexNow submissions.
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

export async function renderBingView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'bing-view');
  mountNode.innerHTML = '';

  // ── State ──────────────────────────────────────
  let quota = { DailyQuota: 0, MonthlyQuota: 0 };
  let siteUrl = 'https://3dput.com';
  let recentSubmissions = [];
  let isLoading = false;

  // ── Styles ─────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .bw-layout { padding:20px; height:100%; overflow-y:auto; background:var(--win11-bg, #1a1a2e); color:var(--win11-text); }
    .bw-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .bw-title { font-size:1.1rem; font-weight:600; display:flex; align-items:center; gap:8px; }
    .bw-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .bw-card {
      background:var(--win11-surface-solid, #16213e);
      border:1px solid var(--win11-border);
      border-radius:8px; padding:16px;
    }
    .bw-card-title { font-size:0.85rem; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
    .bw-stat { text-align:center; padding:8px 0; }
    .bw-stat-value { font-size:1.8rem; font-weight:700; color:var(--win11-accent); }
    .bw-stat-label { font-size:0.72rem; color:var(--win11-text-secondary); margin-top:2px; }
    .bw-stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .bw-label { font-size:0.78rem; font-weight:500; margin-bottom:4px; color:var(--win11-text-secondary); }
    .bw-input, .bw-textarea {
      width:100%; box-sizing:border-box; padding:8px 12px; border-radius:6px;
      border:1px solid var(--win11-border); background:var(--win11-surface);
      color:var(--win11-text); font-size:0.82rem; font-family:inherit;
    }
    .bw-textarea { min-height:120px; resize:vertical; font-family:'Cascadia Code','Fira Code',monospace; font-size:0.78rem; }
    .bw-input:focus, .bw-textarea:focus { outline:none; border-color:var(--win11-accent); }
    .bw-btn {
      padding:8px 16px; border-radius:6px; border:none;
      font-size:0.82rem; font-weight:600; cursor:pointer;
      transition:opacity 0.15s;
    }
    .bw-btn:hover { opacity:0.9; }
    .bw-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .bw-btn-primary { background:var(--win11-accent); color:#fff; }
    .bw-btn-secondary { background:var(--win11-surface-active); color:var(--win11-text); border:1px solid var(--win11-border); }
    .bw-btn-row { display:flex; gap:8px; margin-top:12px; }
    .bw-badge {
      display:inline-flex; align-items:center; gap:4px;
      padding:2px 8px; border-radius:4px; font-size:0.72rem; font-weight:500;
    }
    .bw-badge-ok { background:rgba(34,197,94,0.15); color:#22c55e; }
    .bw-badge-err { background:rgba(239,68,68,0.15); color:#ef4444; }
    .bw-badge-warn { background:rgba(234,179,8,0.15); color:#eab308; }
    .bw-full { grid-column:1/-1; }
    .bw-history { margin-top:8px; }
    .bw-history-item {
      display:flex; justify-content:space-between; align-items:center;
      padding:6px 0; border-bottom:1px solid var(--win11-border);
      font-size:0.78rem;
    }
    .bw-history-item:last-child { border-bottom:none; }
    .bw-empty { color:var(--win11-text-tertiary); font-size:0.8rem; text-align:center; padding:16px; }
    .bw-url-preview {
      max-height:100px; overflow-y:auto; font-size:0.72rem; color:var(--win11-text-secondary);
      margin-top:8px; padding:6px 8px; background:rgba(0,0,0,0.2); border-radius:4px;
    }
    .bw-quota-bar { height:8px; border-radius:4px; background:var(--win11-surface-active); margin-top:4px; overflow:hidden; }
    .bw-quota-fill { height:100%; background:var(--win11-accent); border-radius:4px; transition:width 0.3s; }
    .bw-site-url { display:flex; gap:8px; align-items:center; margin-bottom:16px; }
    .bw-site-url input { flex:1; }
    .bw-spinner { display:inline-block; width:12px; height:12px; border:2px solid var(--win11-border); border-top-color:var(--win11-accent); border-radius:50%; animation:bw-spin 0.6s linear infinite; }
    @keyframes bw-spin { to { transform:rotate(360deg); } }
  `;

  mountNode.appendChild(style);

  // ── Layout ─────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'bw-layout';

  root.innerHTML = `
    <div class="bw-header">
      <span class="bw-title">🔍 Bing Webmaster Tools</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <span id="bw-api-status" class="bw-badge bw-badge-ok">● Connected</span>
        <button class="bw-btn bw-btn-secondary" id="bw-refresh">↻ Refresh</button>
      </div>
    </div>

    <div class="bw-site-url">
      <input class="bw-input" id="bw-site-url" value="${escapeHtml(siteUrl)}" placeholder="https://example.com" />
      <button class="bw-btn bw-btn-secondary" id="bw-update-site">Update</button>
    </div>

    <div class="bw-grid">
      <!-- Quota Card -->
      <div class="bw-card">
        <div class="bw-card-title">📊 Submission Quota</div>
        <div class="bw-stat-grid">
          <div class="bw-stat">
            <div class="bw-stat-value" id="bw-daily">—</div>
            <div class="bw-stat-label">Daily Quota Remaining</div>
            <div class="bw-quota-bar"><div class="bw-quota-fill" id="bw-daily-bar" style="width:0%"></div></div>
          </div>
          <div class="bw-stat">
            <div class="bw-stat-value" id="bw-monthly">—</div>
            <div class="bw-stat-label">Monthly Quota Remaining</div>
            <div class="bw-quota-bar"><div class="bw-quota-fill" id="bw-monthly-bar" style="width:0%"></div></div>
          </div>
        </div>
      </div>

      <!-- Quick Submit Card -->
      <div class="bw-card">
        <div class="bw-card-title">⚡ Quick Submit</div>
        <div class="bw-label">Single URL</div>
        <input class="bw-input" id="bw-single-url" placeholder="https://3dput.com/my-article" />
        <div class="bw-btn-row">
          <button class="bw-btn bw-btn-primary" id="bw-submit-single">Submit URL</button>
          <button class="bw-btn bw-btn-secondary" id="bw-submit-indexnow">via IndexNow</button>
        </div>
      </div>

      <!-- Batch Submit Card -->
      <div class="bw-card bw-full">
        <div class="bw-card-title">📦 Batch Submit</div>
        <div class="bw-label">URLs (one per line, max 500)</div>
        <textarea class="bw-textarea" id="bw-batch-urls" placeholder="https://3dput.com/article-1&#10;https://3dput.com/article-2&#10;https://3dput.com/article-3"></textarea>
        <div id="bw-batch-preview" class="bw-url-preview" style="display:none"></div>
        <div class="bw-btn-row">
          <button class="bw-btn bw-btn-primary" id="bw-submit-batch">Submit Batch</button>
          <button class="bw-btn bw-btn-secondary" id="bw-submit-batch-indexnow">via IndexNow</button>
          <button class="bw-btn bw-btn-secondary" id="bw-clear-batch">Clear</button>
          <span id="bw-batch-count" style="font-size:0.78rem;color:var(--win11-text-secondary);align-self:center;"></span>
        </div>
      </div>

      <!-- Recent Submissions -->
      <div class="bw-card bw-full">
        <div class="bw-card-title">📋 Recent Submissions</div>
        <div id="bw-history" class="bw-history">
          <div class="bw-empty">No submissions yet</div>
        </div>
      </div>
    </div>
  `;

  mountNode.appendChild(root);

  // ── Helpers ────────────────────────────────────

  function getAuthHeaders() {
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || '';
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async function apiGet(url) {
    const resp = await fetch(url, { headers: { 'Authorization': getAuthHeaders()['Authorization'] } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function apiPost(url, body) {
    const resp = await fetch(url, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const d = await resp.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    return resp.json();
  }

  function addHistoryEntry(entry) {
    recentSubmissions.unshift(entry);
    if (recentSubmissions.length > 50) recentSubmissions.pop();
    renderHistory();
  }

  function renderHistory() {
    const el = document.getElementById('bw-history');
    if (!el) return;
    if (recentSubmissions.length === 0) {
      el.innerHTML = '<div class="bw-empty">No submissions yet</div>';
      return;
    }
    el.innerHTML = recentSubmissions.map(e => {
      const statusBadge = e.ok
        ? '<span class="bw-badge bw-badge-ok">✓ OK</span>'
        : '<span class="bw-badge bw-badge-err">✗ ' + escapeHtml(e.error || 'Failed') + '</span>';
      const method = e.method === 'indexnow' ? 'IndexNow' : 'API';
      const count = e.count > 1 ? `${e.count} URLs` : '1 URL';
      return `<div class="bw-history-item">
        <span>${statusBadge} <span style="margin-left:6px;color:var(--win11-text-secondary)">${method}</span> ${escapeHtml(count)}</span>
        <span style="color:var(--win11-text-tertiary)">${e.time}</span>
      </div>`;
    }).join('');
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn._originalText = btn.textContent;
      btn.innerHTML = '<span class="bw-spinner"></span> Submitting...';
    } else {
      btn.disabled = false;
      btn.textContent = btn._originalText || 'Submit';
    }
  }

  // ── Data Loading ───────────────────────────────

  async function loadQuota() {
    try {
      const data = await apiGet(`/api/bing/quota?siteUrl=${encodeURIComponent(siteUrl)}`);
      if (data.ok && data.quota) {
        quota = data.quota;
        document.getElementById('bw-daily').textContent = quota.DailyQuota || 0;
        document.getElementById('bw-monthly').textContent = quota.MonthlyQuota || 0;
        // Calculate bar percentages (assuming max 1000 daily, 5000 monthly)
        const dailyPct = Math.min(100, Math.round(((quota.DailyQuota || 0) / 1000) * 100));
        const monthlyPct = Math.min(100, Math.round(((quota.MonthlyQuota || 0) / 5000) * 100));
        document.getElementById('bw-daily-bar').style.width = dailyPct + '%';
        document.getElementById('bw-monthly-bar').style.width = monthlyPct + '%';
      }
    } catch (err) {
      console.error('Failed to load quota:', err);
      document.getElementById('bw-api-status').className = 'bw-badge bw-badge-err';
      document.getElementById('bw-api-status').textContent = '● Error';
    }
  }

  async function checkStatus() {
    try {
      const data = await apiGet('/api/bing/status');
      const badge = document.getElementById('bw-api-status');
      if (data.ok) {
        badge.className = 'bw-badge bw-badge-ok';
        badge.textContent = '● Connected';
      } else {
        badge.className = 'bw-badge bw-badge-err';
        badge.textContent = '● Error';
      }
    } catch {
      const badge = document.getElementById('bw-api-status');
      badge.className = 'bw-badge bw-badge-err';
      badge.textContent = '● Disconnected';
    }
  }

  function updateBatchCount() {
    const textarea = document.getElementById('bw-batch-urls');
    const countEl = document.getElementById('bw-batch-count');
    const preview = document.getElementById('bw-batch-preview');
    if (!textarea || !countEl) return;

    const urls = textarea.value.split('\n').map(u => u.trim()).filter(u => u.length > 0);
    countEl.textContent = `${urls.length} URL${urls.length !== 1 ? 's' : ''}`;

    if (urls.length > 0) {
      preview.style.display = 'block';
      preview.textContent = urls.slice(0, 10).join('\n') + (urls.length > 10 ? `\n... and ${urls.length - 10} more` : '');
    } else {
      preview.style.display = 'none';
    }
  }

  function parseBatchUrls() {
    const textarea = document.getElementById('bw-batch-urls');
    if (!textarea) return [];
    return textarea.value.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Actions ────────────────────────────────────

  async function submitSingle(useIndexNow) {
    const input = document.getElementById('bw-single-url');
    const url = input?.value?.trim();
    if (!url) return;

    const btnId = useIndexNow ? 'bw-submit-indexnow' : 'bw-submit-single';
    setLoading(btnId, true);

    try {
      const endpoint = useIndexNow ? '/api/bing/indexnow' : '/api/bing/submit';
      const body = useIndexNow
        ? { host: siteUrl.replace(/^https?:\/\//, ''), urls: [url] }
        : { siteUrl, url };

      const result = await apiPost(endpoint, body);
      addHistoryEntry({
        ok: result.ok,
        count: 1,
        method: useIndexNow ? 'indexnow' : 'api',
        time: timeNow(),
        error: result.error,
      });
      input.value = '';
      loadQuota(); // Refresh quota after submission
    } catch (err) {
      addHistoryEntry({ ok: false, count: 1, method: useIndexNow ? 'indexnow' : 'api', time: timeNow(), error: err.message });
    } finally {
      setLoading(btnId, false);
    }
  }

  async function submitBatch(useIndexNow) {
    const urls = parseBatchUrls();
    if (urls.length === 0) return;

    const btnId = useIndexNow ? 'bw-submit-batch-indexnow' : 'bw-submit-batch';
    setLoading(btnId, true);

    try {
      const endpoint = useIndexNow ? '/api/bing/indexnow' : '/api/bing/submit-batch';
      const body = useIndexNow
        ? { host: siteUrl.replace(/^https?:\/\//, ''), urls }
        : { siteUrl, urls };

      const result = await apiPost(endpoint, body);
      addHistoryEntry({
        ok: result.ok,
        count: urls.length,
        method: useIndexNow ? 'indexnow' : 'api',
        time: timeNow(),
        error: result.error,
      });
      document.getElementById('bw-batch-urls').value = '';
      updateBatchCount();
      loadQuota();
    } catch (err) {
      addHistoryEntry({ ok: false, count: urls.length, method: useIndexNow ? 'indexnow' : 'api', time: timeNow(), error: err.message });
    } finally {
      setLoading(btnId, false);
    }
  }

  // ── Event Handlers ─────────────────────────────

  setTimeout(() => {
    document.getElementById('bw-refresh')?.addEventListener('click', () => {
      loadQuota();
      checkStatus();
    });

    document.getElementById('bw-update-site')?.addEventListener('click', () => {
      const input = document.getElementById('bw-site-url');
      if (input) {
        siteUrl = input.value.trim();
        loadQuota();
      }
    });

    document.getElementById('bw-submit-single')?.addEventListener('click', () => submitSingle(false));
    document.getElementById('bw-submit-indexnow')?.addEventListener('click', () => submitSingle(true));

    document.getElementById('bw-submit-batch')?.addEventListener('click', () => submitBatch(false));
    document.getElementById('bw-submit-batch-indexnow')?.addEventListener('click', () => submitBatch(true));

    document.getElementById('bw-clear-batch')?.addEventListener('click', () => {
      const textarea = document.getElementById('bw-batch-urls');
      if (textarea) textarea.value = '';
      updateBatchCount();
    });

    document.getElementById('bw-batch-urls')?.addEventListener('input', updateBatchCount);

    document.getElementById('bw-single-url')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitSingle(false);
    });
  }, 50);

  // ── Initialize ─────────────────────────────────
  await checkStatus();
  await loadQuota();
}

export default renderBingView;
