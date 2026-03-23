import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

const FS_API = '/api/fs';

export async function renderNotepadView({ mountNode, stateStore }) {
  ensureNativeRoot(mountNode, 'notepad-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  let tabs = []; // {id, path, name, content, savedContent, dirty, readOnly, warning, saving}
  let activeTabId = null;
  let tabCounter = 0;
  let lastOpenRequestAt = null;

  const style = document.createElement('style');
  style.textContent = `
    .np-tab-bar { display:flex;align-items:center;border-bottom:1px solid var(--win11-border);flex-shrink:0;min-height:32px;padding:0 8px;overflow-x:auto;gap:2px;background:var(--win11-surface); }
    .np-tab { display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px 6px 0 0;border:1px solid transparent;background:transparent;color:var(--win11-text-secondary);cursor:pointer;font-size:0.8rem;white-space:nowrap;max-width:180px; }
    .np-tab:hover { background:var(--win11-surface-active); }
    .np-tab.active { background:var(--win11-surface-solid);color:var(--win11-text);font-weight:600;border-color:var(--win11-border);border-bottom-color:var(--win11-surface-solid); }
    .np-tab-dirty { color:#eab308;font-size:0.7rem;margin-left:2px; }
    .np-tab-close { padding:0 3px;border:none;background:transparent;color:var(--win11-text-secondary);cursor:pointer;font-size:0.85rem;border-radius:3px;line-height:1; }
    .np-tab-close:hover { background:var(--win11-surface-active);color:var(--win11-text); }
    .np-editor-area { flex:1;position:relative;overflow:hidden; }
    .np-editor { width:100%;height:100%;padding:12px;border:none;outline:none;resize:none;background:var(--win11-surface-solid);color:var(--win11-text);font-family:'SF Mono','Cascadia Code','Consolas','Courier New',monospace;font-size:0.85rem;line-height:1.5;tab-size:2; }
    .np-editor:read-only { opacity:0.7; }
    .np-status { display:flex;align-items:center;justify-content:space-between;padding:4px 12px;border-top:1px solid var(--win11-border);flex-shrink:0;font-size:0.75rem;color:var(--win11-text-secondary);background:var(--win11-surface);gap:12px; }
    .np-status-path { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .np-status-right { display:flex;gap:12px;align-items:center;flex-shrink:0; }
    .np-status-meta { display:flex;gap:12px;align-items:center; }
    .np-status-dirty { color:#eab308; }
    .np-status-saved { color:#22c55e; }
    .np-status-readonly { color:#ef4444; }
    .np-save-btn { padding:4px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface-solid);color:var(--win11-text);cursor:pointer;font-size:0.75rem; }
    .np-save-btn:hover:not(:disabled) { background:var(--win11-surface-active); }
    .np-save-btn:disabled { opacity:0.6;cursor:not-allowed; }
    .np-save-btn.is-dirty { background:var(--win11-accent);border-color:var(--win11-accent);color:#fff; }
    .np-warning { padding:8px 12px;background:rgba(234,179,8,0.12);border-bottom:1px solid rgba(234,179,8,0.3);color:#eab308;font-size:0.8rem;flex-shrink:0; }
    .np-empty { display:flex;align-items:center;justify-content:center;height:100%;color:var(--win11-text-tertiary);font-size:0.9rem; }
  `;
  root.appendChild(style);

  const tabBar = document.createElement('div');
  tabBar.className = 'np-tab-bar';
  root.appendChild(tabBar);

  const warningBar = document.createElement('div');
  warningBar.className = 'np-warning';
  warningBar.style.display = 'none';
  root.appendChild(warningBar);

  const editorArea = document.createElement('div');
  editorArea.className = 'np-editor-area';
  editorArea.innerHTML = '<div class="np-empty">Open a file to edit</div>';
  root.appendChild(editorArea);

  const statusBar = document.createElement('div');
  statusBar.className = 'np-status';
  statusBar.innerHTML = `
    <span class="np-status-path"></span>
    <span class="np-status-right">
      <span class="np-status-meta"></span>
      <button type="button" class="np-save-btn" disabled>Save</button>
    </span>
  `;
  root.appendChild(statusBar);

  const saveButton = statusBar.querySelector('.np-save-btn');
  saveButton.addEventListener('click', () => {
    if (activeTabId) {
      saveTab(activeTabId);
    }
  });

  mountNode.appendChild(root);

  // --- Tab Management ---

  function nextTabId() { return `tab-${++tabCounter}`; }

  function getTab(id) { return tabs.find(t => t.id === id); }

  function switchTab(id) {
    activeTabId = id;
    const tab = getTab(id);
    renderEditor(tab);
    renderTabs();
    updateStatus();
  }

  function renderTabs() {
    tabBar.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = `np-tab${tab.id === activeTabId ? ' active' : ''}`;
      el.innerHTML = `
        <span>${escapeHtml(tab.name)}</span>
        ${tab.dirty ? '<span class="np-tab-dirty">●</span>' : ''}
        <button class="np-tab-close" data-close="${tab.id}" title="Close">×</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.dataset.close) {
          closeTab(e.target.dataset.close);
          return;
        }
        switchTab(tab.id);
      });
      tabBar.appendChild(el);
    });
  }

  function renderEditor(tab) {
    if (!tab) {
      editorArea.innerHTML = '<div class="np-empty">Open a file to edit</div>';
      warningBar.style.display = 'none';
      return;
    }

    editorArea.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'np-editor';
    textarea.value = tab.content;
    textarea.readOnly = tab.readOnly;
    textarea.spellcheck = false;

    textarea.addEventListener('input', () => {
      tab.content = textarea.value;
      tab.dirty = tab.content !== tab.savedContent;
      renderTabs();
      updateStatus();
    });

    textarea.addEventListener('keydown', (e) => {
      // Tab key inserts spaces
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = '  ';
        textarea.value = tab.content = tab.content.substring(0, start) + spaces + tab.content.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
        tab.dirty = tab.content !== tab.savedContent;
        renderTabs();
        updateStatus();
        return;
      }

      // Ctrl/Cmd+S save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveTab(tab.id);
        return;
      }
    });

    editorArea.appendChild(textarea);

    if (tab.warning) {
      warningBar.textContent = tab.warning;
      warningBar.style.display = 'block';
    } else {
      warningBar.style.display = 'none';
    }

    requestAnimationFrame(() => textarea.focus());
  }

  function updateStatus() {
    const tab = getTab(activeTabId);
    const pathEl = statusBar.querySelector('.np-status-path');
    const metaEl = statusBar.querySelector('.np-status-meta');

    if (!tab) {
      pathEl.textContent = '';
      metaEl.innerHTML = '';
      saveButton.disabled = true;
      saveButton.classList.remove('is-dirty');
      saveButton.textContent = 'Save';
      saveButton.title = 'Open a file to edit';
      return;
    }

    pathEl.textContent = tab.path || 'No file';
    const lines = tab.content.split('\n').length;
    let parts = [`${lines} lines`];

    if (tab.readOnly) parts.push('<span class="np-status-readonly">Read-only</span>');
    else if (tab.saving) parts.push('<span>Saving...</span>');
    else if (tab.dirty) parts.push('<span class="np-status-dirty">Unsaved</span>');
    else parts.push('<span class="np-status-saved">Saved</span>');

    metaEl.innerHTML = parts.join(' · ');
    saveButton.disabled = tab.readOnly || tab.saving || !tab.dirty;
    saveButton.classList.toggle('is-dirty', !tab.readOnly && !tab.saving && tab.dirty);
    saveButton.textContent = tab.readOnly ? 'Read-only' : tab.saving ? 'Saving...' : tab.dirty ? 'Save' : 'Saved';
    saveButton.title = tab.readOnly
      ? 'This file cannot be edited'
      : tab.saving
        ? 'Save in progress'
      : tab.dirty
        ? 'Save file (Ctrl/Cmd+S)'
        : 'No unsaved changes';
  }

  async function saveTab(id) {
    const tab = getTab(id);
    if (!tab || tab.readOnly || tab.saving || !tab.dirty) return;

    tab.saving = true;
    updateStatus();

    try {
      const res = await fetch(`${FS_API}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      });
      const data = await res.json();

      if (!res.ok) {
        tab.saving = false;
        updateStatus();
        alert(`Save failed: ${data.error || res.statusText}`);
        return;
      }

      tab.savedContent = tab.content;
      tab.dirty = false;
      tab.saving = false;
      tab.warning = data.warning || null;
      renderTabs();
      updateStatus();
      if (warningBar.parentElement) {
        if (tab.id === activeTabId) {
          if (tab.warning) {
            warningBar.textContent = tab.warning;
            warningBar.style.display = 'block';
          } else {
            warningBar.style.display = 'none';
          }
        }
      }
    } catch (err) {
      tab.saving = false;
      updateStatus();
      alert(`Save failed: ${err.message}`);
    }
  }

  function closeTab(id) {
    const tab = getTab(id);
    if (!tab) return;

    if (tab.dirty) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    }

    const idx = tabs.findIndex(t => t.id === id);
    tabs.splice(idx, 1);

    if (activeTabId === id) {
      if (tabs.length > 0) {
        switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
      } else {
        activeTabId = null;
        renderEditor(null);
        updateStatus();
      }
    }

    renderTabs();
  }

  async function openFile(path) {
    // Check if already open
    const existing = tabs.find(t => t.path === path);
    if (existing) {
      switchTab(existing.id);
      return;
    }

    try {
      const res = await fetch(`${FS_API}/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();

      if (!res.ok) {
        alert(`Failed to open: ${data.error || res.statusText}`);
        return;
      }

      const tab = {
        id: nextTabId(),
        path: data.path,
        name: data.name,
        content: data.content,
        savedContent: data.content,
        dirty: false,
        readOnly: data.readOnly || !data.isText,
        warning: data.warning || null,
        saving: false,
      };

      tabs.push(tab);
      switchTab(tab.id);
    } catch (err) {
      alert(`Failed to open: ${err.message}`);
    }
  }

  // --- Cross-app communication ---
  // Listen for open requests from Explorer via DOM event
  const openFileRequestHandler = (e) => {
    const { path, requestedAt } = e.detail || {};
    if (path && requestedAt !== lastOpenRequestAt) {
      lastOpenRequestAt = requestedAt;
      openFile(path);
    }
  };
  document.addEventListener('notepad:open-file', openFileRequestHandler);

  // Also poll stateStore for openRequest
  let unsubscribeOpenRequest = null;
  if (stateStore) {
    try {
      unsubscribeOpenRequest = stateStore.subscribe('notepad.openRequest', (val) => {
        if (val && val.path && val.requestedAt !== lastOpenRequestAt) {
          lastOpenRequestAt = val.requestedAt;
          openFile(val.path);
        }
      });

      // Check for pending request on mount
      const pending = stateStore.getState('notepad.openRequest');
      if (pending && pending.path) {
        lastOpenRequestAt = pending.requestedAt;
        openFile(pending.path);
      }
    } catch (e) {
      // stateStore may not support this path — DOM events are the fallback
    }
  }

  // Global save handler
  const globalSaveHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && activeTabId) {
      e.preventDefault();
      e.stopPropagation();
      saveTab(activeTabId);
    }
  };
  document.addEventListener('keydown', globalSaveHandler);

  // Cleanup
  return () => {
    document.removeEventListener('keydown', globalSaveHandler);
    document.removeEventListener('notepad:open-file', openFileRequestHandler);
    unsubscribeOpenRequest?.();
  };
}

export default renderNotepadView;
