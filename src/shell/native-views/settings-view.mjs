/**
 * Settings / Control Panel View
 *
 * Phase 2 additions:
 *   - Save & Restart button (writes + triggers graceful restart)
 *   - Import settings from JSON file
 *   - Unsaved changes warning when switching tabs
 *   - Changelog display (last 20 changes)
 *   - Unsaved indicator in tab badge
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';
import { mountSnapshotsPanel } from './snapshot-panel.mjs';

const CATEGORY_META = {
  general:     { icon: '⚙️', label: 'General' },
  database:    { icon: '🗄️', label: 'Database' },
  gateway:     { icon: '🔌', label: 'Gateway' },
  appearance:  { icon: '🎨', label: 'Appearance' },
  apps:        { icon: '📱', label: 'Apps' },
  security:    { icon: '🔒', label: 'Security' },
  integrations:{ icon: '🔗', label: 'Integrations' },
  sse:         { icon: '📡', label: 'SSE & RT' },
  snapshots:   { icon: '💾', label: 'Snapshots & Restore' },
  system:      { icon: 'ℹ️', label: 'System Info' },
};

const CATEGORY_ORDER = ['general','database','gateway','appearance','apps','security','integrations','sse','snapshots','system'];

import { mutate } from '../mutation-manager.mjs';

export async function renderSettingsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'settings-view');
  mountNode.innerHTML = '';

  let activeTab = 'general';
  let settingsData = {};
  let schema = {};
  let systemInfo = {};
  let restartRequired = false;
  let pendingKeys = [];
  let dirty = {};
  let changelog = [];
  let saveInProgress = false;

  // ── Styles ─────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .cp-layout { display:flex; height:100%; background:var(--win11-bg, #1a1a2e); color:var(--win11-text); }
    .cp-sidebar {
      width:200px; min-width:180px; border-right:1px solid var(--win11-border);
      background:var(--win11-surface-solid, #16213e); padding:8px 0;
      display:flex; flex-direction:column;
    }
    .cp-sidebar-title { font-size:0.88rem; font-weight:600; padding:12px 16px 8px; }
    .cp-tab {
      padding:8px 16px; cursor:pointer; font-size:0.8rem;
      display:flex; align-items:center; gap:8px;
      border-left:3px solid transparent; transition:background 0.1s;
    }
    .cp-tab:hover { background:var(--win11-surface-active, rgba(255,255,255,0.04)); }
    .cp-tab.active { background:rgba(96,205,255,0.08); border-left-color:var(--win11-accent); color:var(--win11-accent); }
    .cp-tab-icon { font-size:1rem; width:20px; text-align:center; }
    .cp-dirty-dot {
      width:7px; height:7px; border-radius:50%; background:#eab308;
      margin-left:auto; flex-shrink:0; display:none;
    }
    .cp-dirty-dot.visible { display:block; }
    .cp-content { flex:1; overflow-y:auto; padding:20px 24px; }
    .cp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .cp-title { font-size:1.05rem; font-weight:600; }
    .cp-restart-banner {
      background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.3);
      border-radius:6px; padding:8px 14px; margin-bottom:16px;
      font-size:0.8rem; color:#eab308; display:flex; align-items:center; gap:8px;
    }
    .cp-group {
      background:var(--win11-surface-solid, #16213e);
      border:1px solid var(--win11-border);
      border-radius:8px; padding:16px; margin-bottom:16px;
    }
    .cp-group-title { font-size:0.85rem; font-weight:600; margin-bottom:12px; }
    .cp-field { margin-bottom:12px; }
    .cp-label { font-size:0.78rem; font-weight:500; margin-bottom:4px; color:var(--win11-text-secondary); }
    .cp-input {
      width:100%; box-sizing:border-box; padding:7px 12px; border-radius:5px;
      border:1px solid var(--win11-border); background:var(--win11-surface);
      color:var(--win11-text); font-size:0.82rem;
    }
    .cp-input:focus { outline:none; border-color:var(--win11-accent); }
    .cp-input.dirty { border-color:#eab308; }
    .cp-input[type="color"] { height:36px; padding:2px 4px; cursor:pointer; }
    .cp-toggle-wrap { display:flex; align-items:center; gap:10px; }
    .cp-toggle {
      width:40px; height:22px; border-radius:11px;
      background:var(--win11-surface-active); cursor:pointer;
      position:relative; transition:background 0.2s;
    }
    .cp-toggle.on { background:var(--win11-accent); }
    .cp-toggle-knob {
      width:16px; height:16px; border-radius:50%; background:#fff;
      position:absolute; top:3px; left:3px; transition:left 0.2s;
    }
    .cp-toggle.on .cp-toggle-knob { left:21px; }
    .cp-btn {
      padding:7px 16px; border-radius:5px; border:none;
      font-size:0.8rem; font-weight:600; cursor:pointer;
    }
    .cp-btn:hover { opacity:0.9; }
    .cp-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .cp-btn-primary { background:var(--win11-accent); color:#fff; }
    .cp-btn-secondary { background:var(--win11-surface-active); color:var(--win11-text); border:1px solid var(--win11-border); }
    .cp-btn-danger { background:#ef4444; color:#fff; }
    .cp-btn-warn { background:#f59e0b; color:#fff; }
    .cp-btn-row { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
    .cp-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; font-size:0.72rem; }
    .cp-badge-ok { background:rgba(34,197,94,0.15); color:#22c55e; }
    .cp-badge-err { background:rgba(239,68,68,0.15); color:#ef4444; }
    .cp-badge-warn { background:rgba(234,179,8,0.15); color:#eab308; }
    .cp-stat-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px; }
    .cp-stat { background:var(--win11-surface-active); border-radius:6px; padding:12px; text-align:center; }
    .cp-stat-value { font-size:1.3rem; font-weight:700; color:var(--win11-accent); }
    .cp-stat-label { font-size:0.7rem; color:var(--win11-text-secondary); margin-top:2px; }
    .cp-toast {
      position:fixed; bottom:20px; right:20px; padding:10px 20px;
      border-radius:6px; font-size:0.82rem; z-index:99999;
      animation: cp-fade-in 0.2s ease;
    }
    .cp-toast-ok { background:rgba(34,197,94,0.9); color:#fff; }
    .cp-toast-err { background:rgba(239,68,68,0.9); color:#fff; }
    .cp-toast-warn { background:rgba(234,179,8,0.9); color:#fff; }
    @keyframes cp-fade-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    .cp-select {
      padding:7px 12px; border-radius:5px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.82rem;
      width:100%; box-sizing:border-box;
    }
    .cp-select:focus { outline:none; border-color:var(--win11-accent); }
    .cp-spinner { display:inline-block; width:14px; height:14px; border:2px solid var(--win11-border); border-top-color:var(--win11-accent); border-radius:50%; animation:cp-spin 0.6s linear infinite; }
    @keyframes cp-spin { to { transform:rotate(360deg); } }
    .cp-changelog { font-size:0.75rem; }
    .cp-changelog-entry {
      padding:6px 0; border-bottom:1px solid var(--win11-border);
      display:flex; gap:10px; align-items:flex-start;
    }
    .cp-changelog-time { color:var(--win11-text-tertiary); white-space:nowrap; min-width:70px; }
    .cp-changelog-key { color:var(--win11-accent); font-weight:500; }
    .cp-changelog-val { color:var(--win11-text-secondary); }
    .cp-confirm-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:99998;
      display:flex; align-items:center; justify-content:center;
    }
    .cp-confirm-dialog {
      background:var(--win11-surface-solid, #16213e);
      border:1px solid var(--win11-border); border-radius:10px;
      padding:24px; max-width:380px; width:90%; text-align:center;
    }
    .cp-confirm-dialog h3 { font-size:1rem; margin-bottom:8px; }
    .cp-confirm-dialog p { font-size:0.82rem; color:var(--win11-text-secondary); margin-bottom:16px; }
    .cp-confirm-dialog .cp-btn-row { justify-content:center; }
    .cp-file-input { display:none; }
  `;
  mountNode.appendChild(style);

  // ── Layout ─────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'cp-layout';

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'cp-sidebar';
  sidebar.innerHTML = `<div class="cp-sidebar-title">⚙️ Settings</div>`;

  for (const cat of CATEGORY_ORDER) {
    const meta = CATEGORY_META[cat];
    const tab = document.createElement('div');
    tab.className = `cp-tab${cat === activeTab ? ' active' : ''}`;
    tab.dataset.category = cat;
    tab.innerHTML = `<span class="cp-tab-icon">${meta.icon}</span><span>${meta.label}</span><span class="cp-dirty-dot" id="cp-dirty-${cat}"></span>`;
    tab.addEventListener('click', () => {
      if (Object.keys(dirty).length > 0) {
        showConfirmDialog(
          'Unsaved Changes',
          'You have unsaved changes on this tab. Discard them and switch?',
          () => { dirty = {}; updateDirtyDots(); switchTab(cat); }
        );
      } else {
        switchTab(cat);
      }
    });
    sidebar.appendChild(tab);
  }

  // Content area
  const content = document.createElement('div');
  content.className = 'cp-content';
  content.id = 'cp-content';

  layout.appendChild(sidebar);
  layout.appendChild(content);
  mountNode.appendChild(layout);

  // ── Hidden file input for import ──
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.className = 'cp-file-input';
  fileInput.id = 'cp-import-file';
  fileInput.addEventListener('change', handleImportFile);
  mountNode.appendChild(fileInput);

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

  async function apiPut(url, body) {
    const resp = await fetch(url, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body) });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const d = await resp.json(); msg = d.error || msg; } catch {}
      throw new Error(msg);
    }
    return resp.json();
  }

  async function apiPost(url, body = {}) {
    const resp = await fetch(url, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
    return resp.json();
  }

  function showToast(message, type = 'ok') {
    const existing = document.querySelector('.cp-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `cp-toast cp-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function showConfirmDialog(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'cp-confirm-overlay';
    overlay.innerHTML = `
      <div class="cp-confirm-dialog">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="cp-btn-row">
          <button class="cp-btn cp-btn-secondary" id="cp-confirm-cancel">Cancel</button>
          <button class="cp-btn cp-btn-primary" id="cp-confirm-ok">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#cp-confirm-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#cp-confirm-ok').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function updateDirtyDots() {
    for (const cat of CATEGORY_ORDER) {
      const dot = document.getElementById(`cp-dirty-${cat}`);
      if (dot) {
        const hasCatDirty = Object.keys(dirty).some(k => schema[k] && schema[k].category === cat);
        dot.classList.toggle('visible', hasCatDirty);
      }
    }
  }

  function switchTab(cat) {
    activeTab = cat;
    document.querySelectorAll('.cp-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === cat);
    });
    renderContent();
  }

  function createField(key, fieldSchema) {
    const wrap = document.createElement('div');
    wrap.className = 'cp-field';

    const label = document.createElement('div');
    label.className = 'cp-label';
    label.textContent = fieldSchema.label || key;
    wrap.appendChild(label);

    const currentValue = fieldSchema.value;

    if (fieldSchema.type === 'toggle') {
      const toggleWrap = document.createElement('div');
      toggleWrap.className = 'cp-toggle-wrap';

      const toggle = document.createElement('div');
      toggle.className = `cp-toggle${currentValue ? ' on' : ''}`;
      toggle.innerHTML = '<div class="cp-toggle-knob"></div>';
      toggle.addEventListener('click', () => {
        const newVal = !toggle.classList.contains('on');
        toggle.classList.toggle('on', newVal);
        dirty[key] = newVal;
        renderRestartBanner();
        updateDirtyDots();
      });

      const status = document.createElement('span');
      status.style.cssText = 'font-size:0.78rem; color:var(--win11-text-secondary);';
      status.textContent = currentValue ? 'Enabled' : 'Disabled';

      toggleWrap.appendChild(toggle);
      toggleWrap.appendChild(status);
      wrap.appendChild(toggleWrap);
    } else if (fieldSchema.type === 'select') {
      const select = document.createElement('select');
      select.className = 'cp-select';
      select.dataset.key = key;
      (fieldSchema.options || []).forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt === String(currentValue)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        dirty[key] = select.value;
        select.classList.add('dirty');
        renderRestartBanner();
        updateDirtyDots();
      });
      wrap.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.className = 'cp-input';
      input.dataset.key = key;
      input.type = fieldSchema.type === 'password' ? 'password' : (fieldSchema.type === 'color' || key === 'accentColor') ? 'color' : 'text';
      input.value = fieldSchema.type === 'password' ? '' : String(currentValue ?? '');
      if (fieldSchema.type === 'password') input.placeholder = '••••••••';
      input.addEventListener('input', () => {
        dirty[key] = input.value;
        input.classList.add('dirty');
        renderRestartBanner();
        updateDirtyDots();
      });
      wrap.appendChild(input);
    }

    // Hot-reload indicator
    if (fieldSchema.hotReload) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:0.66rem; color:var(--win11-text-tertiary); margin-left:8px;';
      badge.textContent = '🔄 hot';
      wrap.querySelector('.cp-label')?.appendChild(badge);
    }

    return wrap;
  }

  // ── Render Content ─────────────────────────────

  function renderRestartBanner() {
    let banner = document.getElementById('cp-restart-banner');
    const hasDirtyRestart = Object.keys(dirty).some(k => schema[k] && !schema[k].hotReload);

    if (hasDirtyRestart) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cp-restart-banner';
        banner.className = 'cp-restart-banner';
        const contentEl = document.getElementById('cp-content');
        if (contentEl) contentEl.insertBefore(banner, contentEl.firstChild);
      }
      banner.innerHTML = '⚠️ Some changes require a server restart to take effect';
    } else if (banner) {
      banner.remove();
    }
  }

  function renderContent() {
    const el = document.getElementById('cp-content');
    if (!el) return;
    el.innerHTML = '';
    dirty = {};
    updateDirtyDots();

    if (activeTab === 'system') {
      renderSystemTab(el);
      return;
    }

    if (activeTab === 'snapshots') {
      renderSnapshotsTab(el);
      return;
    }

    const catSettings = settingsData[activeTab] || {};
    const meta = CATEGORY_META[activeTab];

    // Header
    const header = document.createElement('div');
    header.className = 'cp-header';
    header.innerHTML = `<span class="cp-title">${meta.icon} ${meta.label}</span>`;
    el.appendChild(header);

    // Restart banner placeholder
    const bannerPlaceholder = document.createElement('div');
    bannerPlaceholder.id = 'cp-restart-banner';
    el.appendChild(bannerPlaceholder);

    // Fields group
    const group = document.createElement('div');
    group.className = 'cp-group';

    for (const [key, fieldSchema] of Object.entries(catSettings)) {
      group.appendChild(createField(key, fieldSchema));
    }

    el.appendChild(group);

    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'cp-btn-row';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'cp-btn cp-btn-primary';
    saveBtn.textContent = '💾 Save Changes';
    saveBtn.addEventListener('click', saveSettings);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'cp-btn cp-btn-secondary';
    resetBtn.textContent = '↩ Reset';
    resetBtn.addEventListener('click', () => { dirty = {}; updateDirtyDots(); renderContent(); });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(resetBtn);

    // Save & Restart button for tabs with non-hot-reload settings
    const hasNonHotReload = Object.entries(catSettings).some(([, s]) => !s.hotReload);
    if (hasNonHotReload) {
      const saveRestartBtn = document.createElement('button');
      saveRestartBtn.className = 'cp-btn cp-btn-warn';
      saveRestartBtn.textContent = '💾 Save & Restart';
      saveRestartBtn.addEventListener('click', saveAndRestart);
      btnRow.appendChild(saveRestartBtn);
    }

    // Test buttons for specific tabs
    if (activeTab === 'database') {
      const testDbBtn = document.createElement('button');
      testDbBtn.className = 'cp-btn cp-btn-secondary';
      testDbBtn.id = 'cp-test-db';
      testDbBtn.textContent = '🔍 Test Connection';
      testDbBtn.addEventListener('click', testDatabase);
      btnRow.appendChild(testDbBtn);
    }

    if (activeTab === 'gateway') {
      const testGwBtn = document.createElement('button');
      testGwBtn.className = 'cp-btn cp-btn-secondary';
      testGwBtn.id = 'cp-test-gw';
      testGwBtn.textContent = '🔍 Test Connection';
      testGwBtn.addEventListener('click', testGateway);
      btnRow.appendChild(testGwBtn);
    }

    el.appendChild(btnRow);

    // Changelog for this category
    const catChanges = changelog.filter(c => c.schema === activeTab);
    if (catChanges.length > 0) {
      const clGroup = document.createElement('div');
      clGroup.className = 'cp-group';
      clGroup.style.marginTop = '20px';

      const clTitle = document.createElement('div');
      clTitle.className = 'cp-group-title';
      clTitle.textContent = `📋 Recent Changes (${catChanges.length})`;
      clGroup.appendChild(clTitle);

      const clList = document.createElement('div');
      clList.className = 'cp-changelog';
      catChanges.slice(0, 10).forEach(entry => {
        const row = document.createElement('div');
        row.className = 'cp-changelog-entry';
        row.innerHTML = `
          <span class="cp-changelog-time">${escapeHtml(entry.time ? entry.time.slice(11, 19) : '—')}</span>
          <span class="cp-changelog-key">${escapeHtml(entry.key)}</span>
          <span class="cp-changelog-val">${escapeHtml(String(entry.oldValue ?? ''))} → ${escapeHtml(String(entry.newValue ?? ''))}</span>
        `;
        clList.appendChild(row);
      });
      clGroup.appendChild(clList);
      el.appendChild(clGroup);
    }
  }

  function renderSnapshotsTab(el) {
    const meta = CATEGORY_META.snapshots;
    el.innerHTML = `
      <div class="cp-header">
        <span class="cp-title">${meta.icon} ${meta.label}</span>
      </div>`;
    const group = document.createElement('div');
    group.className = 'cp-group';
    el.appendChild(group);
    mountSnapshotsPanel({
      container: group,
      apiGet,
      apiPost,
      authHeaders: getAuthHeaders,
      showToast,
    });
  }

  function renderSystemTab(el) {
    const info = systemInfo;
    if (!info || !info.version) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--win11-text-tertiary)">Loading system info...</div>';
      return;
    }

    el.innerHTML = `
      <div class="cp-header">
        <span class="cp-title">ℹ️ System Info</span>
        <button class="cp-btn cp-btn-secondary" id="cp-refresh-sys">↻ Refresh</button>
      </div>

      <div class="cp-stat-grid">
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(info.version)}</div>
          <div class="cp-stat-label">Version</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(info.uptimeHuman || '—')}</div>
          <div class="cp-stat-label">Uptime</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(info.nodeVersion)}</div>
          <div class="cp-stat-label">Node.js</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(info.platform)} ${escapeHtml(info.arch)}</div>
          <div class="cp-stat-label">Platform</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(info.memory?.rss || '—')}</div>
          <div class="cp-stat-label">Memory (RSS)</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${escapeHtml(String(info.memory?.heapUsed || '—'))}</div>
          <div class="cp-stat-label">Heap Used</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${info.sseClients ?? '—'}</div>
          <div class="cp-stat-label">SSE Clients</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${info.gatewayConnected ? '<span class="cp-badge cp-badge-ok">● Connected</span>' : '<span class="cp-badge cp-badge-err">● Disconnected</span>'}</div>
          <div class="cp-stat-label">Gateway</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${info.registeredApps ?? '—'}</div>
          <div class="cp-stat-label">Registered Apps</div>
        </div>
        <div class="cp-stat">
          <div class="cp-stat-value">${info.pid ?? '—'}</div>
          <div class="cp-stat-label">PID</div>
        </div>
      </div>

      <div class="cp-group" style="margin-top:16px;">
        <div class="cp-group-title">📁 Paths</div>
        <div style="font-size:0.78rem; line-height:1.8;">
          <div><strong>Dashboard Root:</strong> <code style="background:rgba(0,0,0,0.2); padding:1px 6px; border-radius:3px;">${escapeHtml(info.dashboardRoot || '—')}</code></div>
          <div><strong>Gateway URL:</strong> <code style="background:rgba(0,0,0,0.2); padding:1px 6px; border-radius:3px;">${escapeHtml(info.gatewayUrl || '—')}</code></div>
        </div>
      </div>

      <div class="cp-btn-row">
        <button class="cp-btn cp-btn-secondary" id="cp-export">📦 Export Settings</button>
        <button class="cp-btn cp-btn-secondary" id="cp-import">📥 Import Settings</button>
        <button class="cp-btn cp-btn-secondary" id="cp-reload-settings">🔄 Reload from Disk</button>
      </div>

      ${changelog.length > 0 ? `
      <div class="cp-group" style="margin-top:16px;">
        <div class="cp-group-title">📋 All Recent Changes (${changelog.length})</div>
        <div class="cp-changelog">
          ${changelog.slice(0, 20).map(entry => `
            <div class="cp-changelog-entry">
              <span class="cp-changelog-time">${escapeHtml(entry.time ? entry.time.slice(0, 16) : '—')}</span>
              <span class="cp-changelog-key">${escapeHtml(entry.key)}</span>
              <span class="cp-changelog-val">${escapeHtml(String(entry.oldValue ?? ''))} → ${escapeHtml(String(entry.newValue ?? ''))}</span>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;

    document.getElementById('cp-refresh-sys')?.addEventListener('click', loadSystemInfo);
    document.getElementById('cp-export')?.addEventListener('click', exportSettings);
    document.getElementById('cp-import')?.addEventListener('click', () => {
      fileInput.click();
    });
    document.getElementById('cp-reload-settings')?.addEventListener('click', reloadSettings);
  }

  // ── Actions ────────────────────────────────────

  async function saveSettings() {
    if (Object.keys(dirty).length === 0) {
      showToast('No changes to save', 'ok');
      return;
    }

    if (saveInProgress) return;
    saveInProgress = true;

    try {
      const result = await mutate({
        key: `settings-save-${activeTab}`,
        request: () => apiPut(`/api/settings/${activeTab}`, dirty),
        onError: (err) => showToast(`Save failed: ${err.message}`, 'error'),
      });
      if (!result.ok) return;
      const saved = result.data;
      dirty = {};
      updateDirtyDots();
      await loadChangelog();
      if (result.restartRequired) {
        showToast('Saved! Restart required for some changes.', 'warn');
      } else {
        showToast('Settings saved!', 'ok');
      }
      // Reload to get fresh values
      await loadSettings();
      renderContent();
    } catch (err) {
      if (err.message.includes('429') || err.message.includes('Rate limit')) {
        showToast('Rate limited — slow down!', 'err');
      } else {
        showToast(`Save failed: ${err.message}`, 'err');
      }
    } finally {
      saveInProgress = false;
    }
  }

  async function saveAndRestart() {
    if (Object.keys(dirty).length === 0) {
      showToast('No changes to save', 'ok');
      return;
    }

    showConfirmDialog(
      'Save & Restart Server',
      'This will save your changes and restart the server. All active connections will be temporarily interrupted. Continue?',
      async () => {
        try {
          // First save
          const result = await mutate({
        key: `settings-save-${activeTab}`,
        request: () => apiPut(`/api/settings/${activeTab}`, dirty),
        onError: (err) => showToast(`Save failed: ${err.message}`, 'error'),
      });
      if (!result.ok) return;
      const saved = result.data;
          dirty = {};
          updateDirtyDots();

          if (result.restartRequired) {
            // Server restart needed — trigger it
            showToast('Saving and restarting...', 'warn');
            await apiPost('/api/settings/restart', { confirm: 'restart' });
            // Page will go unresponsive — that's expected
            setTimeout(() => {
              showToast('Restart triggered. If page doesn\'t reload, refresh manually.', 'warn');
            }, 2000);
          } else {
            showToast('Saved! No restart needed (all changes are hot-reloadable).', 'ok');
            await loadSettings();
            renderContent();
          }
        } catch (err) {
          showToast(`Failed: ${err.message}`, 'err');
        }
      }
    );
  }

  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    showConfirmDialog(
      'Import Settings',
      `Import settings from "${file.name}"? This will overwrite existing values. Passwords in the import file will be applied.`,
      async () => {
        try {
          const text = await file.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            showToast('Invalid JSON file', 'err');
            return;
          }

          // Accept both { settings: {...} } and bare { ... }
          const settings = data.settings || data;
          if (typeof settings !== 'object') {
            showToast('Invalid settings format', 'err');
            return;
          }

          const result = await apiPost('/api/settings/import', { settings });
          if (result.ok) {
            showToast(`Imported ${result.imported} settings${result.restartRequired ? '. Restart required.' : ''}`, result.restartRequired ? 'warn' : 'ok');
            await loadSettings();
            await loadChangelog();
            renderContent();
          } else {
            showToast(`Import failed: ${result.error}`, 'err');
          }
        } catch (err) {
          showToast(`Import error: ${err.message}`, 'err');
        }
        // Reset file input
        fileInput.value = '';
      }
    );
  }

  async function testDatabase() {
    const btn = document.getElementById('cp-test-db');
    if (!btn) return;
    btn.innerHTML = '<span class="cp-spinner"></span> Testing...';
    btn.disabled = true;

    try {
      const result = await apiPost('/api/settings/test-db');
      if (result.ok) {
        btn.innerHTML = `✓ Connected (${result.latency}ms)`;
        btn.style.color = '#22c55e';
      } else {
        btn.innerHTML = `✗ ${result.error}`;
        btn.style.color = '#ef4444';
      }
    } catch (err) {
      btn.innerHTML = `✗ ${err.message}`;
      btn.style.color = '#ef4444';
    }
    btn.disabled = false;
    setTimeout(() => { btn.innerHTML = '🔍 Test Connection'; btn.style.color = ''; }, 5000);
  }

  async function testGateway() {
    const btn = document.getElementById('cp-test-gw');
    if (!btn) return;
    btn.innerHTML = '<span class="cp-spinner"></span> Testing...';
    btn.disabled = true;

    try {
      const result = await apiPost('/api/settings/test-gateway');
      if (result.ok) {
        btn.innerHTML = `✓ Connected`;
        btn.style.color = '#22c55e';
      } else {
        btn.innerHTML = `✗ Disconnected`;
        btn.style.color = '#ef4444';
      }
    } catch (err) {
      btn.innerHTML = `✗ ${err.message}`;
      btn.style.color = '#ef4444';
    }
    btn.disabled = false;
    setTimeout(() => { btn.innerHTML = '🔍 Test Connection'; btn.style.color = ''; }, 5000);
  }

  async function exportSettings() {
    try {
      const result = await apiPost('/api/settings/export');
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openclaw-desktop-settings-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Settings exported!', 'ok');
    } catch (err) {
      showToast(`Export failed: ${err.message}`, 'err');
    }
  }

  async function reloadSettings() {
    try {
      await apiPost('/api/settings/reload');
      await loadSettings();
      renderContent();
      showToast('Settings reloaded from disk', 'ok');
    } catch (err) {
      showToast(`Reload failed: ${err.message}`, 'err');
    }
  }

  // ── Data Loading ───────────────────────────────

  async function loadSettings() {
    try {
      const [settingsResp, schemaResp] = await Promise.all([
        apiGet('/api/settings'),
        apiGet('/api/settings/schema'),
      ]);
      settingsData = settingsResp.settings || {};
      schema = schemaResp.schema || {};
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function loadSystemInfo() {
    try {
      const resp = await apiGet('/api/settings/system-info');
      systemInfo = resp.system || {};
    } catch (err) {
      console.error('Failed to load system info:', err);
    }
  }

  async function loadChangelog() {
    try {
      const resp = await apiGet('/api/settings/changelog');
      changelog = resp.changelog || [];
    } catch {
      changelog = [];
    }
  }

  // ── Initialize ─────────────────────────────────
  await loadSettings();
  await loadSystemInfo();
  await loadChangelog();
  renderContent();
}

export default renderSettingsView;
