import { ensureNativeRoot, escapeHtml, createStatCard, formatCount } from './helpers.mjs';

const MEMORY_API_BASE = 'http://127.0.0.1:3879/api/memory';

export async function renderMemoryView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'memory-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let currentTab = 'browse';
  let memoryFiles = [];
  let searchResults = [];
  let facts = [];
  let stats = null;
  let systemStatus = null;
  let selectedFile = null;
  let searchQuery = '';
  let searchTimeout = null;

  const style = document.createElement('style');
  style.textContent = `
    .mem-header { padding:14px 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px; }
    .mem-title { font-size:1.15rem;font-weight:600; }
    .mem-tabs { display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--win11-border);flex-shrink:0; }
    .mem-tab { padding:6px 14px;border-radius:6px 6px 0 0;border:1px solid transparent;background:transparent;color:var(--win11-text-secondary);cursor:pointer;font-size:0.82rem;transition:all 0.15s; }
    .mem-tab:hover { background:var(--win11-surface);color:var(--win11-text); }
    .mem-tab.active { background:var(--win11-surface);color:var(--win11-text);font-weight:600;border-bottom:2px solid var(--win11-accent); }
    .mem-content { flex:1;overflow-y:auto;padding:16px; }
    .mem-stats-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px; }
    .mem-search-box { display:flex;gap:8px;margin-bottom:16px; }
    .mem-search-input { flex:1;padding:8px 12px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:0.85rem;outline:none; }
    .mem-search-input:focus { border-color:var(--win11-accent); }
    .mem-search-btn { padding:8px 16px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.85rem; }
    .mem-search-btn:hover { background:var(--win11-surface-active); }
    .mem-file-list { display:grid;gap:8px; }
    .mem-file-card { padding:10px 12px;border-radius:8px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);cursor:pointer;transition:border-color 0.15s,background 0.15s; }
    .mem-file-card:hover { border-color:var(--win11-accent);background:var(--win11-surface); }
    .mem-file-card.selected { border-color:var(--win11-accent);box-shadow:0 0 0 2px var(--win11-accent); }
    .mem-file-name { font-weight:600;font-size:0.9rem;margin-bottom:4px; }
    .mem-file-meta { font-size:0.78rem;color:var(--win11-text-secondary);display:flex;gap:12px;align-items:center; }
    .mem-file-badge { font-size:0.7rem;padding:2px 6px;border-radius:3px;background:var(--win11-surface-active);border:1px solid var(--win11-border); }
    .mem-file-badge.daily { background:rgba(96,205,255,0.15);color:var(--win11-accent);border-color:rgba(96,205,255,0.3); }
    .mem-file-badge.specialized { background:rgba(168,85,247,0.15);color:#a855f7;border-color:rgba(168,85,247,0.3); }
    .mem-result-item { padding:10px 12px;border-radius:8px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);margin-bottom:8px;cursor:pointer;transition:border-color 0.15s; }
    .mem-result-item:hover { border-color:var(--win11-accent); }
    .mem-result-path { font-size:0.85rem;color:var(--win11-text-secondary);margin-bottom:4px;font-family:monospace; }
    .mem-result-snippet { font-size:0.85rem;line-height:1.4; }
    .mem-result-score { font-size:0.75rem;color:var(--win11-accent);margin-top:4px; }
    .mem-fact-row { padding:8px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);margin-bottom:6px;font-size:0.85rem; }
    .mem-fact-predicate { font-weight:600;color:var(--win11-text); }
    .mem-fact-value { color:var(--win11-text-secondary);margin-left:8px; }
    .mem-status-item { display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--win11-border);font-size:0.85rem; }
    .mem-status-item:last-child { border-bottom:none; }
    .mem-status-value { font-weight:600; }
    .mem-status-value.ok { color:#22c55e; }
    .mem-status-value.mixed { color:#eab308; }
    .mem-status-value.bad { color:#ef4444; }
    .mem-file-viewer { display:flex;flex-direction:column;height:100%; }
    .mem-file-header { display:flex;justify-content:space-between;align-items:center;padding:8px 0 12px;margin-bottom:8px;border-bottom:1px solid var(--win11-border); }
    .mem-file-close { padding:6px 12px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.82rem; }
    .mem-file-close:hover { background:var(--win11-surface-active); }
    .mem-file-editor { flex:1;width:100%;resize:none;padding:12px;border-radius:8px;background:var(--win11-surface-solid);border:1px solid var(--win11-border);color:var(--win11-text);font-family:'SF Mono','Consolas','Courier New',monospace;font-size:0.82rem;line-height:1.5;outline:none;tab-size:2; }
    .mem-file-editor:focus { border-color:var(--win11-accent); }
    .mem-file-content { flex:1;overflow-y:auto;padding:12px;border-radius:8px;background:var(--win11-surface-solid);border:1px solid var(--win11-border);font-family:'SF Mono','Consolas',monospace;font-size:0.82rem;line-height:1.5;white-space:pre-wrap;word-wrap:break-word; }
    .mem-empty { text-align:center;padding:32px;color:var(--win11-text-secondary); }
    .mem-loading { text-align:center;padding:20px;color:var(--win11-text-secondary); }
  `;
  root.appendChild(style);

  // Header
  const header = document.createElement('div');
  header.className = 'mem-header';
  header.innerHTML = `
    <div class="mem-title">🧠 Memory System</div>
    <button id="mem-refresh-btn" class="mem-search-btn">Refresh</button>
  `;
  root.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'mem-tabs';
  tabs.innerHTML = `
    <div data-tab="browse" class="mem-tab active">Browse Files</div>
    <div data-tab="search" class="mem-tab">Search</div>
    <div data-tab="facts" class="mem-tab">Facts</div>
    <div data-tab="status" class="mem-tab">System Status</div>
  `;
  root.appendChild(tabs);

  // Content
  const content = document.createElement('div');
  content.className = 'mem-content';
  root.appendChild(content);

  mountNode.appendChild(root);

  // Tab switching
  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.mem-tab');
    if (tab) {
      tabs.querySelectorAll('.mem-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderContent();
    }
  });

  // Refresh button
  root.addEventListener('click', async (e) => {
    if (e.target.id === 'mem-refresh-btn') {
      content.innerHTML = '<div class="mem-loading">Refreshing...</div>';
      await loadData();
      renderContent();
    }
  });

  async function loadData() {
    try {
      const [filesResp, statsResp, statusResp, factsResp] = await Promise.all([
        fetch(`${MEMORY_API_BASE}/list`),
        fetch(`${MEMORY_API_BASE}/stats`),
        fetch(`${MEMORY_API_BASE}/status`),
        fetch(`${MEMORY_API_BASE}/facts`),
      ]);

      memoryFiles = (await filesResp.json()).files || [];
      stats = await statsResp.json();
      systemStatus = await statusResp.json();
      facts = (await factsResp.json()).facts || [];
      searchResults = [];
    } catch (err) {
      console.error('[Memory View] Error loading data:', err);
      content.innerHTML = `<div class="mem-empty">Error loading memory data: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function performSearch(query) {
    if (!query.trim()) {
      searchResults = [];
      renderContent();
      return;
    }

    content.innerHTML = '<div class="mem-loading">Searching...</div>';
    try {
      const resp = await fetch(`${MEMORY_API_BASE}/search?q=${encodeURIComponent(query)}`);
      const data = await resp.json();
      searchResults = data.hits || []; console.log('[MemoryView] searchResults:', searchResults.length);
      renderContent();
    } catch (err) {
      console.error('[Memory View] Search error:', err);
      content.innerHTML = `<div class="mem-empty">Search error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderContent() {
    content.innerHTML = '';

    switch (currentTab) {
      case 'browse':
        renderBrowseTab();
        break;
      case 'search':
        renderSearchTab();
        break;
      case 'facts':
        renderFactsTab();
        break;
      case 'status':
        renderStatusTab();
        break;
    }
  }

  function renderBrowseTab() {
    if (!stats) {
      content.innerHTML = '<div class="mem-loading">Loading...</div>';
      return;
    }

    // Stats cards
    const statsGrid = document.createElement('div');
    statsGrid.className = 'mem-stats-grid';
    statsGrid.appendChild(createStatCard({ label: 'Total Files', value: formatCount(stats.totalFiles) }));
    statsGrid.appendChild(createStatCard({ label: 'Daily Files', value: formatCount(stats.dailyFiles) }));
    statsGrid.appendChild(createStatCard({ label: 'Specialized Files', value: formatCount(stats.specializedFiles) }));
    statsGrid.appendChild(createStatCard({ label: 'Total Lines', value: formatCount(stats.totalLines) }));
    content.appendChild(statsGrid);

    // Filter
    const filterBox = document.createElement('div');
    filterBox.className = 'mem-search-box';
    filterBox.innerHTML = `
      <input id="mem-filter" class="mem-search-input" placeholder="Filter files..." value="${escapeHtml(searchQuery)}">
      <button id="mem-filter-btn" class="mem-search-btn">Filter</button>
      <select id="mem-filter-type" class="mem-search-input" style="flex:0 0 140px;">
        <option value="all">All Types</option>
        <option value="daily">Daily Only</option>
        <option value="specialized">Specialized Only</option>
      </select>
    `;
    content.appendChild(filterBox);

    // File list
    const fileList = document.createElement('div');
    fileList.className = 'mem-file-list';

    const filterValue = searchQuery.toLowerCase();
    const filterType = filterBox.querySelector('#mem-filter-type').value;

    const filtered = memoryFiles.filter(f => {
      const matchesQuery = !filterValue || f.name.toLowerCase().includes(filterValue) || f.title.toLowerCase().includes(filterValue);
      const matchesType = filterType === 'all' || (filterType === 'daily' && f.isDaily) || (filterType === 'specialized' && f.isSpecialized);
      return matchesQuery && matchesType;
    });

    if (filtered.length === 0) {
      fileList.innerHTML = '<div class="mem-empty">No files match filter</div>';
    } else {
      filtered.forEach(f => {
        const card = document.createElement('div');
        card.className = 'mem-file-card';
        card.innerHTML = `
          <div class="mem-file-name">${escapeHtml(f.name)}</div>
          <div class="mem-file-meta">
            <span>${f.lines.toLocaleString()} lines</span>
            <span>${formatSize(f.size)}</span>
            ${f.isDaily ? '<span class="mem-file-badge daily">daily</span>' : ''}
            ${f.isSpecialized ? '<span class="mem-file-badge specialized">specialized</span>' : ''}
          </div>
          ${f.title !== f.name ? `<div style="font-size:0.8rem;color:var(--win11-text-secondary);margin-top:4px;">${escapeHtml(f.title.substring(0, 80))}${f.title.length > 80 ? '...' : ''}</div>` : ''}
        `;
        card.addEventListener('click', () => openFile(f.name));
        fileList.appendChild(card);
      });
    }
    content.appendChild(fileList);

    // Filter handlers
    const filterBtn = filterBox.querySelector('#mem-filter-btn');
    const filterInput = filterBox.querySelector('#mem-filter');
    const filterTypeSelect = filterBox.querySelector('#mem-filter-type');

    filterBtn.addEventListener('click', () => { searchQuery = filterInput.value; renderContent(); });
    filterInput.addEventListener('input', (e) => { searchQuery = e.target.value; renderContent(); });
    filterTypeSelect.addEventListener('change', () => renderContent());
  }

  function renderSearchTab() {
    const searchBox = document.createElement('div');
    searchBox.className = 'mem-search-box';
    searchBox.innerHTML = `
      <input id="mem-search-input" class="mem-search-input" placeholder="Search memory (semantic + full-text)..." value="${escapeHtml(searchQuery)}">
      <button id="mem-search-btn" class="mem-search-btn">Search</button>
    `;
    content.appendChild(searchBox);

    if (searchResults.length === 0 && !searchQuery) {
      content.innerHTML += '<div class="mem-empty">Enter a query to search across all memory files using semantic search</div>';
      return;
    }

    if (searchResults.length > 0) {
      const resultsDiv = document.createElement('div');
      resultsDiv.innerHTML = '<div style="font-size:0.82rem;color:var(--win11-text-secondary);margin-bottom:10px;"><strong>' + searchResults.length + '</strong> results for "<strong>' + escapeHtml(searchQuery) + '</strong>"</div>';
      searchResults.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'mem-result-item';
        const snippet = r.snippet || r.context || '';
        item.innerHTML = `
          <div class="mem-result-path">${escapeHtml(r.path)}${r.heading ? '#' + escapeHtml(r.heading) : ''}</div>
          <div class="mem-result-snippet">${escapeHtml(snippet.substring(0, 300))}${snippet.length > 300 ? '...' : ''}</div>
          <div class="mem-result-score">Relevance: ${(r.score * 100).toFixed(1)}%</div>
        `;
        const filename = r.path && r.path.includes('/') ? r.path.split('/').pop() : r.path;
        if (filename && filename.endsWith('.md')) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => openFile(filename));
        }
        resultsDiv.appendChild(item);
      });
      content.appendChild(resultsDiv);
    } else if (searchQuery) {
      content.innerHTML += '<div class="mem-empty">No results found for "' + escapeHtml(searchQuery) + '"</div>';
    }
  }

  // Delegated search handler on root
  root.addEventListener('click', (e) => {
    if (e.target.id === 'mem-search-btn' || e.target.closest('#mem-search-btn')) {
      const input = document.getElementById('mem-search-input');
      if (input) {
        searchQuery = input.value.trim();
        performSearch(searchQuery);
      }
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'mem-search-input') {
      searchQuery = e.target.value.trim();
      performSearch(searchQuery);
    }
  });

  function renderFactsTab() {
    if (!facts || facts.length === 0) {
      content.innerHTML = '<div class="mem-empty">No structured facts available</div>';
      return;
    }

    const namespace = facts[0]?.namespace || 'unknown';
    const header = document.createElement('div');
    header.style.cssText = 'padding:0 0 12px;border-bottom:1px solid var(--win11-border);margin-bottom:12px;';
    header.innerHTML = `<strong>${escapeHtml(namespace)}</strong> namespace — ${facts.length} facts`;
    content.appendChild(header);

    facts.forEach(f => {
      const row = document.createElement('div');
      row.className = 'mem-fact-row';
      row.innerHTML = `
        <div><span class="mem-fact-predicate">${escapeHtml(f.subject)} → ${escapeHtml(f.predicate)}</span><span class="mem-fact-value">${escapeHtml(String(f.value))}</span></div>
        ${f.tags?.length ? `<div style="font-size:0.75rem;color:var(--win11-text-secondary);margin-top:4px;">Tags: ${escapeHtml(f.tags.join(', '))}</div>` : ''}
      `;
      content.appendChild(row);
    });
  }

  function renderStatusTab() {
    if (!systemStatus) {
      content.innerHTML = '<div class="mem-loading">Loading...</div>';
      return;
    }

    const status = Array.isArray(systemStatus) ? systemStatus[0]?.status : systemStatus?.status || {};
    const embeddingProbe = Array.isArray(systemStatus) ? systemStatus[0]?.embeddingProbe : systemStatus?.embeddingProbe;

    const info = document.createElement('div');
    info.style.cssText = 'padding:0 0 12px;border-bottom:1px solid var(--win11-border);margin-bottom:16px;';

    info.innerHTML = `
      <h3 style="margin:0 0 8px 0;">Index Status</h3>
      ${createStatusRow('Agent ID', status.agentId || 'unknown')}
      ${createStatusRow('Backend', status.backend || 'unknown', 'ok')}
      ${createStatusRow('Files Indexed', status.files || 0, 'ok')}
      ${createStatusRow('Chunks', status.chunks || 0, 'ok')}
      ${createStatusRow('Model', status.model || 'unknown')}
      ${createStatusRow('Provider', status.provider || 'unknown', status.provider === 'openai' ? 'ok' : 'mixed')}
      <h3 style="margin:16px 0 8px 0;">Search Features</h3>
      ${createStatusRow('Full-Text Search', status.fts?.available ? 'Available' : 'Not available', status.fts?.available ? 'ok' : 'bad')}
      ${createStatusRow('Vector Search', status.vector?.available ? 'Available' : 'Not available', status.vector?.available ? 'ok' : 'bad')}
      ${createStatusRow('Vector Dimensions', status.vector?.dims || 'N/A', 'ok')}
      ${createStatusRow('Embeddings Cache', status.cache?.entries || 0, status.cache?.enabled ? 'ok' : 'mixed')}
      ${createStatusRow('Embedding Probe', embeddingProbe?.ok ? 'OK' : 'Failed', embeddingProbe?.ok ? 'ok' : 'bad')}
      <h3 style="margin:16px 0 8px 0;">Storage</h3>
      ${createStatusRow('Database Path', status.dbPath || 'unknown')}
      ${createStatusRow('Workspace', status.workspaceDir || 'unknown')}
      ${createStatusRow('Dirty State', status.dirty ? 'Yes (needs rebuild)' : 'Clean', status.dirty ? 'bad' : 'ok')}
      <h3 style="margin:16px 0 8px 0;">Scan Info</h3>
      ${createStatusRow('Total Files Scanned', status.scan?.totalFiles || 0, 'ok')}
      ${status.scan?.issues?.length ? `<div style="color:#ef4444;margin-top:8px;font-size:0.85rem;">Issues: ${escapeHtml(status.scan.issues.join(', '))}</div>` : ''}
    `;
    content.appendChild(info);
  }

  function createStatusRow(label, value, tone = 'default') {
    return `
      <div class="mem-status-item">
        <span>${escapeHtml(label)}</span>
        <span class="mem-status-value ${tone}">${escapeHtml(String(value))}</span>
      </div>
    `;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function openFile(filename) {
    content.innerHTML = '<div class="mem-loading">Loading file...</div>';
    try {
      const resp = await fetch(`${MEMORY_API_BASE}/file/${encodeURIComponent(filename)}`);
      if (!resp.ok) throw new Error('File not found');
      const data = await resp.json();

      content.innerHTML = '';
      const viewer = document.createElement('div');
      viewer.className = 'mem-file-viewer';

      const header = document.createElement('div');
      header.className = 'mem-file-header';
      header.innerHTML = `
        <div><strong id="mem-file-title">${escapeHtml(data.name)}</strong> — <span id="mem-file-meta">${data.lines.toLocaleString()} lines, ${formatSize(data.size)}</span></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span id="mem-save-status" style="font-size:0.78rem;color:var(--win11-text-secondary);"></span>
          <button id="mem-save-file" class="mem-file-close" style="background:var(--win11-accent);color:#fff;border-color:var(--win11-accent);">💾 Save</button>
          <button id="mem-close-file" class="mem-file-close">← Back to list</button>
        </div>
      `;
      viewer.appendChild(header);

      const textarea = document.createElement('textarea');
      textarea.className = 'mem-file-editor';
      textarea.value = data.content;
      textarea.spellcheck = false;
      viewer.appendChild(textarea);

      content.appendChild(viewer);

      const saveBtn = viewer.querySelector('#mem-save-file');
      const saveStatus = viewer.querySelector('#mem-save-status');
      const fileMeta = viewer.querySelector('#mem-file-meta');

      saveBtn.addEventListener('click', async () => {
        const newContent = textarea.value;
        saveBtn.disabled = true;
        saveStatus.textContent = 'Saving...';
        saveStatus.style.color = 'var(--win11-text-secondary)';
        try {
          const saveResp = await fetch(`${MEMORY_API_BASE}/file/${encodeURIComponent(filename)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent }),
          });
          if (!saveResp.ok) throw new Error('Save failed');
          const result = await saveResp.json();
          fileMeta.textContent = `${result.lines.toLocaleString()} lines, ${formatSize(result.size)}`;
          saveStatus.textContent = '✓ Saved';
          saveStatus.style.color = '#22c55e';
        } catch (err) {
          saveStatus.textContent = `✗ ${err.message}`;
          saveStatus.style.color = '#ef4444';
        } finally {
          saveBtn.disabled = false;
        }
      });

      // Ctrl+S / Cmd+S to save
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveBtn.click();
        }
      });

      viewer.querySelector('#mem-close-file').addEventListener('click', () => renderBrowseTab());
    } catch (err) {
      content.innerHTML = `<div class="mem-empty">Error loading file: ${escapeHtml(err.message)}</div>`;
    }
  }

  await loadData();
  renderContent();

  return () => {
    if (searchTimeout) clearTimeout(searchTimeout);
  };
}

export default renderMemoryView;
