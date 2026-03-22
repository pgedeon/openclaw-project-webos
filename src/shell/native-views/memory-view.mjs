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
  let factsRecords = [];
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
      facts = (await factsResp.json()).namespaces || [];
      searchResults = [];
      // Fetch actual fact records
      const factsListResp = await fetch(`${MEMORY_API_BASE}/facts/list`);
      if (factsListResp.ok) {
        factsRecords = (await factsListResp.json()).facts || [];
      }
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

  async function renderFactsTab() {
    content.innerHTML = '<div class="mem-loading">Loading facts...</div>';

    // Refresh facts from API
    try {
      const resp = await fetch(`${MEMORY_API_BASE}/facts/list`);
      if (resp.ok) {
        factsRecords = (await resp.json()).facts || [];
      }
    } catch (e) { /* use cached */ }

    content.innerHTML = '';

    // Stats header
    const statsRow = document.createElement('div');
    statsRow.style.cssText = 'padding:0 0 12px;border-bottom:1px solid var(--win11-border);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;';
    statsRow.innerHTML = `
      <div>
        <strong>${escapeHtml(facts.length ? facts.map(n => n.namespace).join(', ') : 'facts')}</strong>
        — ${factsRecords.length} fact${factsRecords.length !== 1 ? 's' : ''}
      </div>
      <div style="display:flex;gap:6px;">
        <button id="mem-facts-add-btn" class="mem-file-close" style="background:var(--win11-accent);color:#fff;border-color:var(--win11-accent);">+ Add Fact</button>
        <button id="mem-facts-refresh-btn" class="mem-file-close">↻ Refresh</button>
      </div>
    `;
    content.appendChild(statsRow);

    // Search box
    const searchBox = document.createElement('div');
    searchBox.className = 'mem-search-box';
    searchBox.innerHTML = `
      <input id="mem-facts-search" class="mem-search-input" placeholder="Search facts..." style="flex:1;">
      <button id="mem-facts-search-btn" class="mem-search-btn">Search</button>
    `;
    content.appendChild(searchBox);

    // Fact list
    const listContainer = document.createElement('div');
    listContainer.id = 'mem-facts-list';
    listContainer.style.cssText = 'display:grid;gap:8px;margin-top:12px;';
    renderFactList(listContainer, factsRecords);
    content.appendChild(listContainer);

    // Add form (hidden by default)
    const addForm = document.createElement('div');
    addForm.id = 'mem-facts-add-form';
    addForm.hidden = true;
    addForm.style.cssText = 'padding:16px;border-radius:10px;border:1px solid var(--win11-accent);background:var(--win11-surface-solid);margin-top:12px;display:grid;gap:10px;';
    addForm.innerHTML = `
      <div style="font-weight:700;font-size:0.95rem;color:var(--win11-text);">Add New Fact</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <input id="mf-namespace" class="mem-fact-input" placeholder="Namespace" value="openclaw" style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
        <input id="mf-subject" class="mem-fact-input" placeholder="Subject *" required style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <input id="mf-predicate" class="mem-fact-input" placeholder="Predicate *" required style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
        <input id="mf-value" class="mem-fact-input" placeholder="Value" style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
      </div>
      <input id="mf-source" class="mem-fact-input" placeholder="Source (optional)" style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
      <input id="mf-note" class="mem-fact-input" placeholder="Note (optional)" style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
      <input id="mf-tags" class="mem-fact-input" placeholder="Tags (comma-separated, optional)" style="padding:6px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.85rem;outline:none;">
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="mf-cancel" class="mem-file-close">Cancel</button>
        <button id="mf-save" class="mem-file-close" style="background:var(--win11-accent);color:#fff;border-color:var(--win11-accent);">Save Fact</button>
      </div>
      <div id="mf-status" style="font-size:0.8rem;min-height:1.2em;"></div>
    `;
    content.appendChild(addForm);

    // Event handlers
    const toggleForm = () => { addForm.hidden = !addForm.hidden; };
    const refreshFacts = async () => {
      listContainer.innerHTML = '<div class="mem-loading">Refreshing...</div>';
      try {
        const resp = await fetch(`${MEMORY_API_BASE}/facts/list`);
        if (resp.ok) {
          factsRecords = (await resp.json()).facts || [];
          renderFactList(listContainer, factsRecords);
          statsRow.querySelector('strong').parentElement.innerHTML = `<strong>${escapeHtml(facts.length ? facts.map(n => n.namespace).join(', ') : 'facts')}</strong> — ${factsRecords.length} fact${factsRecords.length !== 1 ? 's' : ''}`;
        }
      } catch (e) {
        listContainer.innerHTML = '<div class="mem-empty">Failed to refresh</div>';
      }
    };

    statsRow.querySelector('#mem-facts-add-btn').addEventListener('click', toggleForm);
    statsRow.querySelector('#mem-facts-refresh-btn').addEventListener('click', refreshFacts);

    const doSearch = async () => {
      const q = searchBox.querySelector('#mem-facts-search').value.trim();
      if (!q) { renderFactList(listContainer, factsRecords); return; }
      listContainer.innerHTML = '<div class="mem-loading">Searching...</div>';
      try {
        const resp = await fetch(`${MEMORY_API_BASE}/facts/search?query=${encodeURIComponent(q)}`);
        if (resp.ok) {
          const results = (await resp.json()).facts || [];
          renderFactList(listContainer, results, true);
        }
      } catch (e) {
        listContainer.innerHTML = '<div class="mem-empty">Search failed</div>';
      }
    };

    searchBox.querySelector('#mem-facts-search-btn').addEventListener('click', doSearch);
    searchBox.querySelector('#mem-facts-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
      if (e.key === 'Escape') { e.target.value = ''; renderFactList(listContainer, factsRecords); }
    });

    addForm.querySelector('#mf-cancel').addEventListener('click', toggleForm);
    addForm.querySelector('#mf-save').addEventListener('click', async () => {
      const subject = addForm.querySelector('#mf-subject').value.trim();
      const predicate = addForm.querySelector('#mf-predicate').value.trim();
      if (!subject || !predicate) {
        addForm.querySelector('#mf-status').innerHTML = '<span style="color:#ef4444;">Subject and predicate are required.</span>';
        return;
      }
      const statusEl = addForm.querySelector('#mf-status');
      statusEl.innerHTML = '<span style="color:var(--win11-text-secondary);">Saving...</span>';
      try {
        const tagsRaw = addForm.querySelector('#mf-tags').value.trim();
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
        const resp = await fetch(`${MEMORY_API_BASE}/facts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            namespace: addForm.querySelector('#mf-namespace').value.trim() || 'openclaw',
            subject,
            predicate,
            value: addForm.querySelector('#mf-value').value.trim(),
            source: addForm.querySelector('#mf-source').value.trim(),
            note: addForm.querySelector('#mf-note').value.trim(),
            tags,
          }),
        });
        if (!resp.ok) throw new Error('Save failed');
        statusEl.innerHTML = '<span style="color:#22c55e;">✓ Saved</span>';
        // Clear form
        addForm.querySelector('#mf-subject').value = '';
        addForm.querySelector('#mf-predicate').value = '';
        addForm.querySelector('#mf-value').value = '';
        addForm.querySelector('#mf-source').value = '';
        addForm.querySelector('#mf-note').value = '';
        addForm.querySelector('#mf-tags').value = '';
        // Refresh list
        await refreshFacts();
        setTimeout(() => { addForm.hidden = true; }, 800);
      } catch (e) {
        statusEl.innerHTML = `<span style="color:#ef4444;">✗ ${escapeHtml(e.message)}</span>`;
      }
    });
  }

  function renderFactList(container, records, isSearch = false) {
    if (!records || records.length === 0) {
      container.innerHTML = isSearch
        ? '<div class="mem-empty">No matching facts found.</div>'
        : '<div class="mem-empty">No structured facts available. Click "+ Add Fact" to create one.</div>';
      return;
    }

    container.innerHTML = '';
    records.forEach(f => {
      const row = document.createElement('div');
      row.className = 'mem-fact-row';
      row.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);transition:border-color 0.15s;';
      row.onmouseenter = () => row.style.borderColor = 'var(--win11-accent)';
      row.onmouseleave = () => row.style.borderColor = 'var(--win11-border)';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:0.7rem;padding:2px 6px;border-radius:3px;background:var(--win11-surface-active);color:var(--win11-text-secondary);">${escapeHtml(f.namespace || 'unknown')}</span>
              <span style="font-weight:600;font-size:0.85rem;color:var(--win11-text);">${escapeHtml(f.subject || '')}</span>
              <span style="color:var(--win11-accent);">→</span>
              <span style="font-weight:600;font-size:0.85rem;color:var(--win11-accent);">${escapeHtml(f.predicate || '')}</span>
            </div>
            <div style="margin-top:4px;font-size:0.82rem;color:var(--win11-text);word-break:break-word;">${escapeHtml(String(f.value || f.value_text || ''))}</div>
            ${f.note ? `<div style="margin-top:4px;font-size:0.75rem;color:var(--win11-text-secondary);font-style:italic;">${escapeHtml(f.note)}</div>` : ''}
            ${f.tags?.length ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${f.tags.map(t => `<span style="font-size:0.68rem;padding:1px 6px;border-radius:3px;background:rgba(96,205,255,0.1);color:var(--win11-accent);border:1px solid rgba(96,205,255,0.2);">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          </div>
          <button class="mem-fact-delete" data-ns="${escapeHtml(f.namespace)}" data-subject="${escapeHtml(f.subject)}" data-predicate="${escapeHtml(f.predicate)}" style="flex-shrink:0;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--win11-border);background:transparent;color:var(--win11-text-tertiary);cursor:pointer;font-size:0.9rem;opacity:0;transition:opacity 0.15s,background 0.15s;" title="Delete fact">✕</button>
        </div>
        <div style="margin-top:4px;font-size:0.68rem;color:var(--win11-text-tertiary);">${f.updated_at ? new Date(f.updated_at).toLocaleString() : ''}${f.source ? ' · ' + escapeHtml(f.source) : ''}</div>
      `;
      // Show delete button on hover
      const delBtn = row.querySelector('.mem-fact-delete');
      row.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
      row.addEventListener('mouseleave', () => delBtn.style.opacity = '0');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete fact: ${f.subject} → ${f.predicate}?`)) return;
        delBtn.textContent = '…';
        delBtn.disabled = true;
        try {
          const resp = await fetch(`${MEMORY_API_BASE}/facts`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ namespace: f.namespace, subject: f.subject, predicate: f.predicate }),
          });
          if (!resp.ok) throw new Error('Delete failed');
          row.style.opacity = '0';
          row.style.transform = 'translateX(20px)';
          row.style.transition = 'opacity 0.2s, transform 0.2s';
          setTimeout(() => row.remove(), 200);
        } catch (err) {
          delBtn.textContent = '✕';
          delBtn.disabled = false;
          alert('Failed to delete: ' + err.message);
        }
      });
      container.appendChild(row);
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
