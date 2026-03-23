import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

const FS_API = '/api/fs';
const DEFAULT_EVENT_TARGET = typeof document !== 'undefined' ? document : null;

const QUICK_ROOTS = [
  { label: 'Backend', path: 'workspace/main' },
  { label: 'Dashboard', path: 'workspace/dashboard/src' },
  { label: 'Extensions', path: 'extensions' },
  { label: 'Agents', path: 'workspace/main' },
  { label: 'Docs', path: 'workspace/dashboard/docs' },
];

export function createNotepadOpenRequest(path, requestedAt = new Date().toISOString()) {
  return {
    path,
    requestedAt,
  };
}

export function requestNotepadOpen({
  path,
  stateStore = null,
  navigateToView = null,
  eventTarget = DEFAULT_EVENT_TARGET,
  requestedAt = new Date().toISOString(),
} = {}) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return null;
  }

  const request = createNotepadOpenRequest(normalizedPath, requestedAt);

  if (stateStore && typeof stateStore.setState === 'function') {
    stateStore.setState({
      notepad: {
        openRequest: request,
      },
    });
  }

  if (eventTarget && typeof eventTarget.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    eventTarget.dispatchEvent(new CustomEvent('notepad:open-file', { detail: request }));
  }

  if (typeof navigateToView === 'function') {
    navigateToView('notepad', request);
  }

  return request;
}

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fileIcon(item) {
  if (item.type === 'directory') return '📁';
  if (!item.isText) return '⚙️';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','jpeg','gif','webp','svg','ico','bmp'].includes(ext)) return '🖼️';
  return '📄';
}

function isProtectedBadge(item) {
  return item.isProtected ? ' 🔒' : '';
}

export async function renderExplorerView({ mountNode, stateStore, navigateToView }) {
  ensureNativeRoot(mountNode, 'explorer-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let currentPath = '';
  let fileItems = [];
  let sortKey = 'name';
  let sortAsc = true;
  let searchQuery = '';
  let searchTimeout = null;
  let searchResults = null;
  let treeExpanded = new Set();
  let contextTarget = null;

  const style = document.createElement('style');
  style.textContent = `
    .ex-toolbar { display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--win11-border);flex-shrink:0;flex-wrap:wrap;background:var(--win11-surface); }
    .ex-root-btn { padding:3px 10px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text-secondary);cursor:pointer;font-size:0.75rem;white-space:nowrap; }
    .ex-root-btn:hover { background:var(--win11-surface-active);color:var(--win11-text);border-color:var(--win11-accent); }
    .ex-body { display:flex;flex:1;overflow:hidden; }
    .ex-sidebar { width:200px;flex-shrink:0;border-right:1px solid var(--win11-border);overflow-y:auto;padding:4px 0;background:var(--win11-surface); }
    .ex-tree-item { display:flex;align-items:center;gap:4px;padding:3px 8px;cursor:pointer;font-size:0.8rem;color:var(--win11-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .ex-tree-item:hover { background:var(--win11-surface-active);color:var(--win11-text); }
    .ex-tree-item.active { background:var(--win11-surface-solid);color:var(--win11-text);font-weight:600; }
    .ex-tree-arrow { font-size:0.6rem;flex-shrink:0; }
    .ex-main { flex:1;display:flex;flex-direction:column;overflow:hidden; }
    .ex-breadcrumb { display:flex;align-items:center;gap:4px;padding:6px 12px;border-bottom:1px solid var(--win11-border);flex-shrink:0;font-size:0.78rem;color:var(--win11-text-secondary);background:var(--win11-surface); }
    .ex-breadcrumb-segment { cursor:pointer;padding:2px 4px;border-radius:3px; }
    .ex-breadcrumb-segment:hover { background:var(--win11-surface-active);color:var(--win11-text); }
    .ex-breadcrumb-current { color:var(--win11-text);font-weight:600; }
    .ex-search { flex:1;max-width:240px;margin-left:auto; }
    .ex-search-input { width:100%;padding:4px 8px;border-radius:5px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);font-size:0.8rem;outline:none;box-sizing:border-box; }
    .ex-search-input:focus { border-color:var(--win11-accent); }
    .ex-file-header { display:grid;grid-template-columns:1fr 80px 100px;gap:8px;padding:6px 12px;border-bottom:1px solid var(--win11-border);flex-shrink:0;font-size:0.75rem;color:var(--win11-text-secondary);background:var(--win11-surface);font-weight:600;cursor:default; }
    .ex-file-header-col { cursor:pointer;user-select:none; }
    .ex-file-header-col:hover { color:var(--win11-text); }
    .ex-file-list { flex:1;overflow-y:auto; }
    .ex-file-row { display:grid;grid-template-columns:1fr 80px 100px;gap:8px;padding:4px 12px;cursor:pointer;font-size:0.82rem;border-bottom:1px solid transparent;align-items:center; }
    .ex-file-row:hover { background:var(--win11-surface-active); }
    .ex-file-name { display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .ex-file-name-icon { flex-shrink:0; }
    .ex-file-size { color:var(--win11-text-secondary);font-size:0.78rem;text-align:right; }
    .ex-file-modified { color:var(--win11-text-secondary);font-size:0.78rem;text-align:right; }
    .ex-file-badge { font-size:0.7rem;padding:1px 4px;border-radius:3px;margin-left:4px; }
    .ex-file-badge.protected { background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3); }
    .ex-file-badge.readonly { background:rgba(148,163,184,0.12);color:#94a3b8;border:1px solid rgba(148,163,184,0.3); }
    .ex-search-results { padding:0 12px; }
    .ex-search-result { padding:8px;cursor:pointer;border-bottom:1px solid var(--win11-border);font-size:0.82rem; }
    .ex-search-result:hover { background:var(--win11-surface-active); }
    .ex-search-result-path { font-size:0.75rem;color:var(--win11-text-secondary);font-family:monospace;margin-bottom:2px; }
    .ex-search-result-preview { color:var(--win11-text-secondary);font-size:0.78rem;white-space:pre-wrap;max-height:60px;overflow:hidden; }
    .ex-context-menu { position:fixed;z-index:9999;background:var(--win11-surface-solid);border:1px solid var(--win11-border);border-radius:8px;padding:4px;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.2); }
    .ex-context-item { padding:6px 12px;border-radius:5px;cursor:pointer;font-size:0.82rem;color:var(--win11-text); }
    .ex-context-item:hover { background:var(--win11-surface-active); }
    .ex-context-item.danger { color:#ef4444; }
    .ex-context-item.danger:hover { background:rgba(239,68,68,0.12); }
    .ex-context-sep { height:1px;background:var(--win11-border);margin:4px 0; }
    .ex-empty { display:flex;align-items:center;justify-content:center;height:100%;color:var(--win11-text-tertiary);font-size:0.85rem; }
    .ex-status { padding:4px 12px;border-top:1px solid var(--win11-border);font-size:0.72rem;color:var(--win11-text-secondary);flex-shrink:0;background:var(--win11-surface); }
  `;
  root.appendChild(style);

  // Toolbar with quick roots + search
  const toolbar = document.createElement('div');
  toolbar.className = 'ex-toolbar';
  QUICK_ROOTS.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'ex-root-btn';
    btn.textContent = r.label;
    btn.addEventListener('click', () => navigateTo(r.path));
    toolbar.appendChild(btn);
  });
  const searchInput = document.createElement('input');
  searchInput.className = 'ex-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search files...';
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      if (searchQuery.length >= 2) {
        doSearch(searchQuery);
      } else {
        searchResults = null;
        renderFileList();
      }
    }, 300);
  });
  toolbar.appendChild(searchInput);
  root.appendChild(toolbar);

  // Body: sidebar + main
  const body = document.createElement('div');
  body.className = 'ex-body';
  root.appendChild(body);

  const sidebar = document.createElement('div');
  sidebar.className = 'ex-sidebar';
  body.appendChild(sidebar);

  const main = document.createElement('div');
  main.className = 'ex-main';
  body.appendChild(main);

  // Breadcrumb
  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'ex-breadcrumb';
  main.appendChild(breadcrumb);

  // File header
  const fileHeader = document.createElement('div');
  fileHeader.className = 'ex-file-header';
  fileHeader.innerHTML = `
    <div class="ex-file-header-col" data-sort="name">Name</div>
    <div class="ex-file-header-col" data-sort="size">Size</div>
    <div class="ex-file-header-col" data-sort="modified">Modified</div>
  `;
  fileHeader.querySelectorAll('[data-sort]').forEach(col => {
    col.addEventListener('click', () => {
      const key = col.dataset.sort;
      if (sortKey === key) sortAsc = !sortAsc;
      else { sortKey = key; sortAsc = true; }
      sortAndRender();
    });
  });
  main.appendChild(fileHeader);

  // File list
  const fileList = document.createElement('div');
  fileList.className = 'ex-file-list';
  main.appendChild(fileList);

  // Status bar
  const statusBar = document.createElement('div');
  statusBar.className = 'ex-status';
  root.appendChild(statusBar);

  mountNode.appendChild(root);

  // --- Context menu ---
  let contextMenu = null;

  function hideContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
  }

  function showContextMenu(x, y, item) {
    hideContextMenu();
    contextMenu = document.createElement('div');
    contextMenu.className = 'ex-context-menu';
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;

    const items = [];

    if (item && item.type === 'file' && item.isText && !item.readOnly) {
      items.push({ label: 'Open in Notepad', action: () => openInNotepad(item.path) });
    }
    if (item && item.type === 'file' && item.isText && item.readOnly) {
      items.push({ label: 'Open (read-only)', action: () => openInNotepad(item.path) });
    }
    if (item && item.isText !== false) {
      items.push({ label: 'Copy Path', action: () => navigator.clipboard.writeText(item.path) });
    }
    if (item && !item.isProtected) {
      items.push({ label: 'Rename', action: () => doRename(item) });
      items.push({ label: 'Delete', action: () => doDelete(item), cls: 'danger' });
    }
    if (!item) {
      items.push({ label: 'New File', action: () => doNewFile() });
      items.push({ label: 'New Folder', action: () => doNewFolder() });
    }

    if (!items.length) { return; }

    items.forEach(it => {
      if (it.sep) {
        const sep = document.createElement('div');
        sep.className = 'ex-context-sep';
        contextMenu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.className = `ex-context-item${it.cls ? ` ${it.cls}` : ''}`;
      el.textContent = it.label;
      el.addEventListener('click', () => { hideContextMenu(); it.action(); });
      contextMenu.appendChild(el);
    });

    document.body.appendChild(contextMenu);

    // Adjust position if off-screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) contextMenu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) contextMenu.style.top = `${y - rect.height}px`;
  }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.ex-file-row');
    if (row && row.dataset.path) {
      e.preventDefault();
      const item = fileItems.find(i => i.path === row.dataset.path);
      if (item) showContextMenu(e.clientX, e.clientY, item);
    } else if (e.target.closest('.ex-file-list') && !searchResults) {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, null);
    }
  });

  // --- Navigation ---

  async function navigateTo(path) {
    currentPath = path || '';
    searchResults = null;
    searchInput.value = '';
    searchQuery = '';
    sidebar.querySelector('.ex-tree-item.active')?.classList.remove('active');

    await loadDirectory();
    renderBreadcrumb();
    renderFileList();
    updateSidebarActive();
  }

  async function loadDirectory() {
    try {
      const res = await fetch(`${FS_API}/list?path=${encodeURIComponent(currentPath)}`);
      const data = await res.json();

      if (!res.ok) {
        fileList.innerHTML = `<div class="ex-empty">Error: ${escapeHtml(data.error)}</div>`;
        fileItems = [];
        return;
      }

      fileItems = data.items || [];
      sortAndRender();
      loadTreeTopLevel();

      statusBar.textContent = `${fileItems.length} item${fileItems.length !== 1 ? 's' : ''}`;
    } catch (err) {
      fileList.innerHTML = `<div class="ex-empty">Failed to load: ${escapeHtml(err.message)}</div>`;
      fileItems = [];
    }
  }

  function sortAndRender() {
    fileItems.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      else if (sortKey === 'size') cmp = (a.size || 0) - (b.size || 0);
      else if (sortKey === 'modified') cmp = new Date(a.modified || 0) - new Date(b.modified || 0);
      return sortAsc ? cmp : -cmp;
    });
    renderFileList();
  }

  function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const parts = currentPath.split('/').filter(Boolean);

    const rootBtn = document.createElement('span');
    rootBtn.className = 'ex-breadcrumb-segment';
    rootBtn.textContent = '📁 root';
    rootBtn.addEventListener('click', () => navigateTo(''));
    breadcrumb.appendChild(rootBtn);

    let builtPath = '';
    parts.forEach((part, i) => {
      builtPath += (builtPath ? '/' : '') + part;
      const seg = document.createElement('span');
      seg.className = `ex-breadcrumb-segment${i === parts.length - 1 ? ' ex-breadcrumb-current' : ''}`;
      seg.textContent = ` / ${part}`;
      const p = builtPath;
      seg.addEventListener('click', () => navigateTo(p));
      breadcrumb.appendChild(seg);
    });
  }

  function renderFileList() {
    if (searchResults) {
      renderSearchResults();
      return;
    }

    fileList.innerHTML = '';

    // Back to parent
    if (currentPath) {
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      const row = document.createElement('div');
      row.className = 'ex-file-row';
      row.innerHTML = `
        <div class="ex-file-name"><span class="ex-file-name-icon">⬆️</span> ..</div>
        <div class="ex-file-size"></div>
        <div class="ex-file-modified"></div>
      `;
      row.addEventListener('click', () => navigateTo(parentPath));
      row.addEventListener('dblclick', () => navigateTo(parentPath));
      fileList.appendChild(row);
    }

    if (!fileItems.length) {
      fileList.innerHTML = '<div class="ex-empty">Empty directory</div>';
      return;
    }

    fileItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'ex-file-row';
      row.dataset.path = item.path;

      let badges = '';
      if (item.isProtected) badges += '<span class="ex-file-badge protected">🔒</span>';
      if (item.readOnly && item.isText) badges += '<span class="ex-file-badge readonly">RO</span>';

      row.innerHTML = `
        <div class="ex-file-name">
          <span class="ex-file-name-icon">${fileIcon(item)}</span>
          <span>${escapeHtml(item.name)}</span>${badges}
        </div>
        <div class="ex-file-size">${item.type === 'directory' ? '' : formatSize(item.size)}</div>
        <div class="ex-file-modified">${formatTime(item.modified)}</div>
      `;

      row.addEventListener('click', () => {
        // Single click for directories navigates
      });

      row.addEventListener('dblclick', () => {
        if (item.type === 'directory') {
          navigateTo(item.path);
        } else if (item.isText) {
          openInNotepad(item.path);
        }
      });

      fileList.appendChild(row);
    });
  }

  function renderSearchResults() {
    if (!searchResults || !searchResults.results.length) {
      fileList.innerHTML = '<div class="ex-empty">No results found</div>';
      statusBar.textContent = searchResults ? '0 results' : '';
      return;
    }

    fileList.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'ex-search-results';

    searchResults.results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ex-search-result';
      row.innerHTML = `
        <div class="ex-search-result-path">${fileIcon({ type: r.type === 'content' ? 'file' : 'file', isText: true })} ${escapeHtml(r.path)}${r.line != null ? `:${r.line}` : ''}</div>
        ${r.preview ? `<div class="ex-search-result-preview">${escapeHtml(r.preview)}</div>` : ''}
      `;
      row.addEventListener('click', () => openInNotepad(r.path));
      container.appendChild(row);
    });

    fileList.appendChild(container);
    statusBar.textContent = `${searchResults.results.length} result${searchResults.results.length !== 1 ? 's' : ''} for "${escapeHtml(searchResults.query)}"`;
  }

  // --- Sidebar Tree ---

  async function loadTreeTopLevel() {
    try {
      const res = await fetch(`${FS_API}/list?path=`);
      const data = await res.json();
      if (!res.ok) return;

      const folders = (data.items || []).filter(i => i.type === 'directory' && i.name !== '.git');
      renderTree(folders);
    } catch (e) { /* sidebar is optional */ }
  }

  function renderTree(folders) {
    sidebar.innerHTML = '';
    folders.forEach(f => {
      const item = document.createElement('div');
      item.className = `ex-tree-item${f.path === currentPath ? ' active' : ''}`;
      item.dataset.path = f.path;
      item.innerHTML = `<span class="ex-tree-arrow">▸</span> 📁 ${escapeHtml(f.name)}`;
      item.addEventListener('click', () => navigateTo(f.path));
      sidebar.appendChild(item);
    });
  }

  function updateSidebarActive() {
    sidebar.querySelectorAll('.ex-tree-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === currentPath);
    });
  }

  // --- Actions ---

  function openInNotepad(path) {
    requestNotepadOpen({ path, stateStore, navigateToView });
  }

  async function doRename(item) {
    const newName = prompt('Rename to:', item.name);
    if (!newName || newName === item.name) return;

    const parentPath = item.path.split('/').slice(0, -1).join('/');
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;

    try {
      const res = await fetch(`${FS_API}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path, newPath }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Rename failed: ${data.error}`); return; }
      await navigateTo(currentPath);
    } catch (err) { alert(`Rename failed: ${err.message}`); }
  }

  async function doDelete(item) {
    const typeLabel = item.type === 'directory' ? 'folder' : 'file';
    if (!confirm(`Delete ${typeLabel} "${item.name}"?`)) return;

    try {
      const res = await fetch(`${FS_API}/path`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Delete failed: ${data.error}`); return; }
      await navigateTo(currentPath);
    } catch (err) { alert(`Delete failed: ${err.message}`); }
  }

  async function doNewFile() {
    const name = prompt('New file name:');
    if (!name) return;
    const path = currentPath ? `${currentPath}/${name}` : name;

    try {
      const res = await fetch(`${FS_API}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: '' }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Create failed: ${data.error}`); return; }
      await navigateTo(currentPath);
      openInNotepad(path);
    } catch (err) { alert(`Create failed: ${err.message}`); }
  }

  async function doNewFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    const path = currentPath ? `${currentPath}/${name}` : name;

    try {
      const res = await fetch(`${FS_API}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Create failed: ${data.error}`); return; }
      await navigateTo(currentPath);
    } catch (err) { alert(`Create failed: ${err.message}`); }
  }

  async function doSearch(query) {
    try {
      const searchPath = currentPath || '';
      const res = await fetch(`${FS_API}/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(searchPath)}`);
      const data = await res.json();
      if (!res.ok) {
        fileList.innerHTML = `<div class="ex-empty">Search failed: ${escapeHtml(data.error)}</div>`;
        searchResults = null;
        return;
      }
      searchResults = data;
      renderFileList();
    } catch (err) {
      fileList.innerHTML = `<div class="ex-empty">Search failed: ${escapeHtml(err.message)}</div>`;
      searchResults = null;
    }
  }

  // --- Init ---
  await navigateTo('');
}

export default renderExplorerView;
