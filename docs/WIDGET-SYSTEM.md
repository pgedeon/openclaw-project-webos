# OpenClaw Desktop Widget System

**Created:** 2026-03-20
**Status:** Design & Documentation
**Depends on:** Shell framework (Phase 1-2), app-registry, window-manager, api-client, realtime-sync, view-state

---

## Overview

The Widget System provides a modular, plugin-like architecture for desktop widgets — small, always-on UI panels that display real-time data and utility functions on the Win11 desktop. It follows the same patterns established by the existing shell: raw ES modules, no bundler, no framework, convention-based registration.

### Design Principles

1. **Drop-in modules** — A widget is a single `.mjs` file dropped into `src/shell/widgets/`. No registration boilerplate, no build step.
2. **Shared infrastructure** — Widgets use the same `api-client`, `realtime-sync`, `view-state`, and theme system as native views. Zero duplication.
3. **Declarative manifest** — Each widget exports a manifest object describing its ID, label, icon, size, refresh behavior, and permissions.
4. **Sandboxed rendering** — Widgets render into isolated DOM containers. No access to shell internals beyond what's explicitly provided.
5. **User-configurable layout** — Widget placement is persisted in localStorage. Users can show/hide, reorder, and resize widgets.
6. **Graceful degradation** — If a widget fails to load or throws, it renders an error card without affecting other widgets or the shell.

---

## Architecture

### Component Map

```
src/shell/
├── widgets/
│   ├── widget-registry.mjs       ← Auto-discovers & manages widget modules
│   ├── widget-panel.mjs          ← Win11 slide-in panel + desktop grid layout
│   ├── widget-host.mjs           ← Per-widget lifecycle container (mount/unmount/refresh)
│   └── widgets/                  ← Individual widget modules (drop-in)
│       ├── system-health.mjs
│       ├── task-pulse.mjs
│       ├── clock.mjs
│       └── ...                   ← Any new .mjs file is auto-discovered
```

### Integration Points

The widget system hooks into the existing shell at these points:

| Hook | Location | Purpose |
|------|----------|---------|
| **Bootstrap** | `shell-main.mjs` `bootstrapShell()` | Initialize widget panel, pass `sync`, `apiClient`, `theme` |
| **Taskbar** | `taskbar.mjs` | Add widgets button (left of tray) to toggle panel |
| **Desktop** | `#desktop` | Widget panel DOM mounts alongside window layer |
| **Keyboard** | `shell-main.mjs` key handlers | `Meta + W` toggles widget panel (configurable) |
| **Theme** | `applyTheme()` | Widget panel inherits `--win11-*` CSS variables |

### Data Flow

```
realtime-sync.mjs ─── subscribe() ──→ widget-host.mjs ──→ widget.render(data)
                                                    ↑
                                              widget manifest declares
                                              which sync keys it needs
```

Widgets do **not** fetch their own data. They declare which `realtime-sync` keys they need in their manifest, and the `widget-host` passes relevant data slices on each sync cycle.

---

## Widget Manifest

Every widget module exports a `manifest` object and a `render` function:

```js
// src/shell/widgets/widgets/system-health.mjs

/**
 * Widget manifest — declares metadata and data requirements.
 */
export const manifest = {
  // Required
  id: 'system-health',              // Unique string ID, used as CSS class prefix and storage key
  label: 'System Health',           // Display name in widget picker
  description: 'Live status of API, agents, cron, and gateway services',
  icon: `<svg>...</svg>`,           // SVG string for 24x24 icon (inline, no viewBox wrapper needed)

  // Sizing — determines grid cell allocation
  size: 'medium',                   // 'small' (1x1), 'medium' (2x1), 'large' (2x2), 'wide' (3x1)

  // Data — which realtime-sync keys this widget consumes
  // The widget-host passes a filtered data object containing only these keys.
  dataKeys: ['healthStatus', 'gatewayAgents', 'orgSummary'],

  // Refresh — override sync interval for this widget (optional)
  refreshInterval: null,            // null = uses sync's default (20s), or number in ms

  // Capabilities — optional feature flags
  capabilities: {
    clickable: false,               // Whether widget handles clicks to open related views
    configurable: false,            // Whether widget has user-settable options
    resizable: false,               // Whether user can override default size
  },

  // Default configuration (user can override via settings)
  defaults: {
    compact: false,                 // Widget-specific options
  },
};

/**
 * Render function — called by widget-host.
 *
 * @param {Object} ctx
 * @param {HTMLElement} ctx.mountNode  - The widget's container div (already styled)
 * @param {Object} ctx.data            - Filtered realtime-sync data (only declared dataKeys)
 * @param {Object} ctx.config          - User configuration merged with defaults
 * @param {Object} ctx.helpers         - Shared utility functions
 * @param {Function} ctx.helpers.escapeHtml
 * @param {Function} ctx.helpers.formatRelativeTime
 * @param {Function} ctx.helpers.formatTimestamp
 * @param {Function} ctx.helpers.formatTokenLabel
 * @param {Object} ctx.api             - The APIClient instance (read-only, for custom fetches)
 * @param {Function} ctx.navigate       - Navigate to a view: (viewId, payload?) => void
 * @param {Function} ctx.showNotice     - Show a toast/notification
 * @param {Object} ctx.theme           - Current theme info
 * @param {string} ctx.theme.current   - 'dark' | 'light'
 * @param {Function} ctx.onConfigChange - Register config change callback
 * @returns {Function|null} cleanup function (or null)
 */
export function render(ctx) {
  const { mountNode, data, helpers, navigate, api } = ctx;
  const { escapeHtml, formatRelativeTime } = helpers;

  // Render into mountNode — mountNode is a live container, update innerHTML freely
  const update = () => {
    const health = data.healthStatus;
    const status = health?.status || 'unknown';
    const isOk = status === 'ok' || status === 'healthy';

    mountNode.innerHTML = `
      <div class="widget-card">
        <div class="widget-card__header">
          <span class="widget-card__dot ${isOk ? 'is-ok' : 'is-error'}"></span>
          <span class="widget-card__title">${escapeHtml(manifest.label)}</span>
        </div>
        <div class="widget-card__body">
          <span class="widget-card__status ${isOk ? 'is-ok' : 'is-error'}">${status.toUpperCase()}</span>
        </div>
      </div>
    `;
  };

  update();

  // Return a cleanup function (called when widget is unmounted)
  return () => {
    mountNode.innerHTML = '';
  };
}
```

### Manifest Fields Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier. Must match `^[a-z][a-z0-9-]*$`. Used as CSS class prefix and localStorage key. |
| `label` | `string` | ✅ | Human-readable name, max 30 chars. |
| `description` | `string` | ✅ | One-line description for the widget picker. |
| `icon` | `string` | ✅ | Inner SVG content (no `<svg>` wrapper — host provides viewBox/stroke). Use `fill="currentColor"` or `stroke="currentColor"`. |
| `size` | `string` | ✅ | One of: `small` (1×1), `medium` (2×1), `large` (2×2), `wide` (3×1), `tall` (1×2). |
| `dataKeys` | `string[]` | ✅ | Keys from `realtime-sync` data this widget needs. Host filters and passes only these. |
| `refreshInterval` | `number\|null` | No | Override sync interval in ms. `null` = use global 20s. |
| `capabilities` | `object` | No | Feature flags: `clickable`, `configurable`, `resizable`. |
| `defaults` | `object` | No | Default config values user can override. |

### Render Context (`ctx`)

| Field | Type | Description |
|-------|------|-------------|
| `mountNode` | `HTMLElement` | Widget's container div. Widget owns its innerHTML. Host styles the outer container. |
| `data` | `Object` | Filtered realtime-sync snapshot. Only keys listed in `manifest.dataKeys` are present. |
| `config` | `Object` | Merged user config + `manifest.defaults`. Persisted to localStorage. |
| `helpers` | `Object` | `{ escapeHtml, formatRelativeTime, formatTimestamp, formatTokenLabel }` — same as view-adapter. |
| `api` | `APIClient` | Read-only reference to the dashboard API client. Use for widget-specific fetches beyond sync data. |
| `navigate` | `Function` | `(viewId: string, payload?: object) => void` — opens a view window. |
| `showNotice` | `Function` | `(message: string, type?: string) => void` — triggers a system notification. |
| `theme` | `{ current: string }` | Current theme. React to changes by subscribing via `ctx.onThemeChange`. |
| `onThemeChange` | `Function` | `(callback: (theme: string) => void) => void` — register theme change listener. Returns unsubscribe. |
| `onConfigChange` | `Function` | `(callback: (config: object) => void) => void` — register config change listener. Returns unsubscribe. |
| `onResize` | `Function` | `(callback: (size: string) => void) => void` — fires when widget size changes. Returns unsubscribe. |

### Return Value

`render()` **must return** one of:
- `null` — no cleanup needed
- `() => void` — cleanup function called on unmount

---

## Widget Registry (`widget-registry.mjs`)

### Auto-Discovery

The registry dynamically imports all `.mjs` files from `./widgets/` using the browser's native `import()` with static globbing. Since there's no bundler, we use an **explicit manifest index** approach:

```js
// src/shell/widgets/widget-registry.mjs

// Widget index — add new widgets by dropping a file in widgets/ and adding a line here.
// This is the ONLY file that needs updating when adding a new widget.
const WIDGET_INDEX = [
  { id: 'system-health', module: './widgets/system-health.mjs' },
  { id: 'task-pulse',    module: './widgets/task-pulse.mjs' },
  { id: 'clock-widget',  module: './widgets/clock-widget.mjs' },
  // ↓ Add new widgets here
];

export class WidgetRegistry {
  constructor({ sync, api, navigate, showNotice, getTheme } = {}) {
    this.sync = sync;
    this.api = api;
    this.navigate = navigate;
    this.showNotice = showNotice;
    this.getTheme = getTheme;
    this.widgets = new Map(); // id → { manifest, render, module }
    this.loaded = false;
  }

  async loadAll() {
    const entries = await Promise.allSettled(
      WIDGET_INDEX.map(async ({ id, module }) => {
        const mod = await import(module);
        const manifest = mod.manifest;
        const render = mod.render;

        if (!manifest?.id || !render) {
          console.warn(`[WidgetRegistry] ${id}: missing manifest or render export`);
          return null;
        }

        if (manifest.id !== id) {
          console.warn(`[WidgetRegistry] filename ID "${id}" ≠ manifest.id "${manifest.id}"`);
          return null;
        }

        return { id, manifest, render, module: mod };
      })
    );

    entries.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        this.widgets.set(result.value.id, result.value);
      }
    });

    this.loaded = true;
    return this.widgets;
  }

  get(id) {
    return this.widgets.get(id) ?? null;
  }

  list() {
    return [...this.widgets.values()].map((w) => w.manifest);
  }

  listBySize(size) {
    return this.list().filter((m) => m.size === size);
  }
}
```

**Why an explicit index instead of runtime glob?**
- No bundler, no `import.meta.glob` (that's a Vite/webpack feature)
- Explicit index is zero-magic, fails visibly, and works with plain ES modules
- Adding a widget = 1 line in the index + 1 file in `widgets/`

---

## Widget Host (`widget-host.mjs`)

The host manages the lifecycle of a single widget instance — mounting, passing data, handling config, and cleanup.

```js
// src/shell/widgets/widget-host.mjs

export class WidgetHost {
  /**
   * @param {Object} widgetDef - { manifest, render } from registry
   * @param {HTMLElement} container - DOM element to mount into
   * @param {Object} shellAPI - { sync, api, navigate, showNotice, getTheme, helpers }
   * @param {Object} userConfig - Persisted user config for this widget
   */
  constructor(widgetDef, container, shellAPI, userConfig = {}) {
    this.manifest = widgetDef.manifest;
    this.renderFn = widgetDef.render;
    this.container = container;
    this.shellAPI = shellAPI;
    this.userConfig = { ...widgetDef.manifest.defaults, ...userConfig };
    this.cleanup = null;
    this.syncUnsubscribe = null;
    this.themeUnsubscribe = null;
    this.configSubscribers = [];
    this.resizeSubscribers = [];
  }

  async mount() {
    // Create mount node inside container
    this.container.innerHTML = '';
    this.container.className = `widget-host widget-host--${this.manifest.size} widget-host--${this.manifest.id}`;

    const mountNode = document.createElement('div');
    mountNode.className = 'widget-host__content';
    this.container.appendChild(mountNode);

    // Build context
    const ctx = {
      mountNode,
      data: this.getFilteredData(),
      config: this.userConfig,
      helpers: this.shellAPI.helpers,
      api: this.shellAPI.api,
      navigate: this.shellAPI.navigate,
      showNotice: this.shellAPI.showNotice,
      theme: { current: this.shellAPI.getTheme() },
      onThemeChange: (cb) => {
        this.themeUnsubscribe = this.shellAPI.onThemeChange?.(cb) || null;
        return () => { this.themeUnsubscribe?.(); };
      },
      onConfigChange: (cb) => {
        this.configSubscribers.push(cb);
        return () => { this.configSubscribers = this.configSubscribers.filter((fn) => fn !== cb); };
      },
      onResize: (cb) => {
        this.resizeSubscribers.push(cb);
        return () => { this.resizeSubscribers = this.resizeSubscribers.filter((fn) => fn !== cb); };
      },
    };

    // Subscribe to sync for this widget's declared dataKeys
    this.syncUnsubscribe = this.shellAPI.sync.subscribe((data, changedKeys) => {
      const relevant = changedKeys.some((key) => this.manifest.dataKeys.includes(key));
      if (relevant) {
        ctx.data = this.getFilteredData();
        // Re-render: call render again with updated data
        this.reRender(ctx);
      }
    });

    // Initial render
    try {
      const result = await this.renderFn(ctx);
      this.cleanup = typeof result === 'function' ? result : null;
    } catch (error) {
      console.error(`[WidgetHost] ${this.manifest.id} render error:`, error);
      mountNode.innerHTML = `
        <div class="widget-card widget-card--error">
          <div class="widget-card__header">
            <span class="widget-card__title">${escapeHtml(this.manifest.label)}</span>
          </div>
          <div class="widget-card__body">
            <span class="widget-card__error">Failed to load widget</span>
          </div>
        </div>
      `;
    }
  }

  reRender(ctx) {
    // Graceful re-render: catch errors without killing the widget
    try {
      if (this.cleanup) this.cleanup();
      const result = this.renderFn(ctx);
      if (typeof result === 'function') this.cleanup = result;
    } catch (error) {
      console.error(`[WidgetHost] ${this.manifest.id} re-render error:`, error);
    }
  }

  getFilteredData() {
    const syncData = this.shellAPI.sync.getData?.() || {};
    const filtered = {};
    for (const key of this.manifest.dataKeys) {
      if (key in syncData) {
        filtered[key] = syncData[key];
      }
    }
    return filtered;
  }

  updateConfig(newConfig) {
    this.userConfig = { ...this.manifest.defaults, ...newConfig };
    this.configSubscribers.forEach((cb) => {
      try { cb(this.userConfig); } catch (e) { /* ignore subscriber errors */ }
    });
  }

  resize(newSize) {
    this.container.className = `widget-host widget-host--${newSize} widget-host--${this.manifest.id}`;
    this.resizeSubscribers.forEach((cb) => {
      try { cb(newSize); } catch (e) { /* ignore */ }
    });
  }

  unmount() {
    this.syncUnsubscribe?.();
    this.themeUnsubscribe?.();
    if (typeof this.cleanup === 'function') {
      try { this.cleanup(); } catch (e) { /* cleanup errors are non-fatal */ }
    }
    this.cleanup = null;
    this.container.innerHTML = '';
  }
}
```

---

## Widget Panel (`widget-panel.mjs`)

The panel provides two modes:
1. **Desktop mode** — Widgets displayed in a grid on the desktop (behind windows)
2. **Panel mode** — Win11-style slide-in panel from the left edge

### Panel Behavior

```
┌──────────────────────────────────────────────┐
│ ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│ │  Widget   │  │  Widget   │  │  Widget   │    │  ← Desktop grid
│ │  (small)  │  │  (medium) │  │  (small)  │    │
│ └──────────┘  └──────────┘  └──────────┘    │
│                                              │
│               [ windows layer ]              │
│                                              │
├──────────────────────────────────────────────┤
│ [Start] [Apps...]              [🔒][🔔][🕐]  │  ← Taskbar
└──────────────────────────────────────────────┘
```

Panel mode (slides from left):
```
┌────────┬─────────────────────────────────────┐
│ Widget │                                     │
│ Panel  │         [ windows layer ]           │
│        │                                     │
│ [🔍]   │                                     │
│ ┌────┐ │                                     │
│ │ sys│ │                                     │
│ │health│                                     │
│ └────┘ │                                     │
│ ┌────┐ │                                     │
│ │task │ │                                     │
│ │pulse│ │                                     │
│ └────┘ │                                     │
│        │                                     │
├────────┴─────────────────────────────────────┤
│ [Start] [Apps...]              [🔒][🔔][🕐]  │
└─────────────────────────────────────────────┘
```

### Panel Implementation Outline

```js
// src/shell/widgets/widget-panel.mjs

const PANEL_STORAGE_KEY = 'openclaw.win11.widgets.v1';
const DESKTOP_LAYOUT_STORAGE_KEY = 'openclaw.win11.widgets.layout.v1';

export class WidgetPanel {
  constructor({
    desktop,                // #desktop element
    registry,               // WidgetRegistry instance
    shellAPI,               // { sync, api, navigate, showNotice, getTheme, helpers }
    taskbar,                // Taskbar instance (for button)
    mode = 'panel',         // 'panel' | 'desktop'
  } = {}) {
    this.desktop = desktop;
    this.registry = registry;
    this.shellAPI = shellAPI;
    this.taskbar = taskbar;
    this.mode = mode;
    this.isOpen = false;
    this.hosts = new Map();  // widgetId → WidgetHost instance
    this.enabledWidgets = this.loadEnabledWidgets();
    this.widgetConfigs = this.loadWidgetConfigs();
  }

  async init() {
    // Create panel DOM
    this.createPanelDOM();

    // Mount all enabled widgets
    for (const widgetId of this.enabledWidgets) {
      await this.addWidget(widgetId);
    }

    // Add toggle button to taskbar
    this.addTaskbarButton();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.panelEl.classList.toggle('is-open', this.isOpen);
    this.taskbarButton?.classList.toggle('is-active', this.isOpen);
  }

  open() { this.isOpen = true; this.panelEl.classList.add('is-open'); }
  close() { this.isOpen = false; this.panelEl.classList.remove('is-open'); }

  async addWidget(widgetId) {
    if (this.hosts.has(widgetId)) return;

    const widgetDef = this.registry.get(widgetId);
    if (!widgetDef) return;

    // Create container
    const container = document.createElement('div');
    container.className = `widget-slot widget-slot--${widgetDef.manifest.size}`;
    container.dataset.widgetId = widgetId;

    this.gridEl.appendChild(container);

    // Create and mount host
    const host = new WidgetHost(widgetDef, container, this.shellAPI, this.widgetConfigs[widgetId]);
    await host.mount();
    this.hosts.set(widgetId, host);
  }

  removeWidget(widgetId) {
    const host = this.hosts.get(widgetId);
    if (!host) return;

    host.unmount();
    host.container.remove();
    this.hosts.delete(widgetId);

    this.enabledWidgets = this.enabledWidgets.filter((id) => id !== widgetId);
    this.saveEnabledWidgets();
  }

  // Persistence
  loadEnabledWidgets() {
    try {
      const stored = localStorage.getItem(PANEL_STORAGE_KEY);
      return stored ? JSON.parse(stored) : ['system-health', 'task-pulse', 'clock-widget'];
    } catch { return ['system-health', 'task-pulse', 'clock-widget']; }
  }

  saveEnabledWidgets() {
    try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(this.enabledWidgets)); } catch {}
  }

  loadWidgetConfigs() {
    try {
      const stored = localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }

  saveWidgetConfigs() {
    try { localStorage.setItem(DESKTOP_LAYOUT_STORAGE_KEY, JSON.stringify(this.widgetConfigs)); } catch {}
  }
}
```

---

## CSS Integration

### File Structure

```
src/styles/
├── win11-theme.css          ← Add widget CSS variables here
├── win11-shell.css          ← Add widget grid styles here
├── win11-widget-panel.css   ← NEW: Panel chrome, slide animation, picker
├── win11-widget-card.css    ← NEW: Widget card base styles
└── win11-taskbar.css        ← Already exists, minor update for widgets button
```

### Theme Variables to Add (`win11-theme.css`)

```css
:root {
  /* Widget-specific tokens */
  --win11-widget-bg: var(--win11-surface-card);
  --win11-widget-border: var(--win11-border-subtle);
  --win11-widget-radius: 12px;
  --win11-widget-padding: 12px;
  --win11-widget-gap: 8px;
  --win11-widget-panel-width: 320px;
  --win11-widget-grid-cols: 3;
  --win11-widget-cell-small: 100px;
  --win11-widget-cell-medium: 212px;
  --win11-widget-cell-large: 212px;
  --win11-widget-cell-wide: 324px;
  --win11-widget-cell-tall: 100px;
}
```

### Widget Card Base (`win11-widget-card.css`)

```css
.widget-card {
  background: var(--win11-widget-bg);
  border: 1px solid var(--win11-widget-border);
  border-radius: var(--win11-widget-radius);
  padding: var(--win11-widget-padding);
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: background 0.2s, border-color 0.2s;
}

.widget-card:hover {
  border-color: var(--win11-accent);
}

.widget-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.widget-card__title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--win11-text-secondary);
}

.widget-card__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.widget-card__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.widget-card__dot.is-ok { background: #22c55e; }
.widget-card__dot.is-error { background: #ef4444; }
.widget-card__dot.is-warning { background: #eab308; }
.widget-card__dot.is-unknown { background: var(--win11-text-tertiary); }

.widget-card__status {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.widget-card__status.is-ok { color: #22c55e; }
.widget-card__status.is-error { color: #ef4444; }
.widget-card__status.is-warning { color: #eab308; }

.widget-card--error {
  opacity: 0.6;
  border-color: var(--win11-error);
}
```

---

## Shell Integration Changes

### `shell-main.mjs` — Add Widget Panel Bootstrap

```js
// In bootstrapShell(), after viewAdapter and sync are created:

import { WidgetRegistry } from './widgets/widget-registry.mjs';
import { WidgetPanel } from './widgets/widget-panel.mjs';

// After sync.start():
const widgetRegistry = new WidgetRegistry({
  sync,
  api: apiClient,
  navigate: shellNavigateTo,
  showNotice: shellShowNotice,
  getTheme: () => currentTheme,
});

await widgetRegistry.loadAll();

const widgetPanel = new WidgetPanel({
  desktop,
  registry: widgetRegistry,
  shellAPI: {
    sync,
    api: apiClient,
    navigate: shellNavigateTo,
    showNotice: shellShowNotice,
    getTheme: () => currentTheme,
    helpers: { escapeHtml, formatRelativeTime, formatTimestamp, formatTokenLabel },
    onThemeChange: (cb) => {
      const originalApplyTheme = applyTheme;
      // Theme change already broadcasts through CSS variables
      // Widgets re-read from mountNode's computed style
      return () => {};
    },
  },
  taskbar,
  mode: 'panel',
});

await widgetPanel.init();

// Keyboard shortcut
// Add to onKeyDown: Meta + W → widgetPanel.toggle()
```

### `taskbar.mjs` — Add Widgets Toggle Button

Add a widgets button in the left section (after Start button, before pinned apps):

```js
// In render(), in the left section:
<button type="button" class="win11-taskbar__button" data-action="widgets" aria-label="Toggle widgets">
  <span class="win11-taskbar__glyph"><!-- widget grid icon SVG --></span>
  <span class="win11-taskbar__tooltip">Widgets</span>
</button>

// In click handler:
const widgetsButton = event.target.closest('[data-action="widgets"]');
if (widgetsButton) {
  this.onWidgetsToggle?.();
  return;
}
```

### `index.html` — Add Widget CSS

```html
<link rel="stylesheet" href="/src/styles/win11-widget-panel.css">
<link rel="stylesheet" href="/src/styles/win11-widget-card.css">
```

---

## Adding a New Widget — Step by Step

### 1. Create the widget file

```bash
# src/shell/widgets/widgets/my-new-widget.mjs
```

### 2. Write manifest + render

```js
export const manifest = {
  id: 'my-new-widget',
  label: 'My Widget',
  description: 'What this widget does',
  icon: `<path d="M12 2l..."/>`,
  size: 'small',              // or 'medium', 'large', 'wide', 'tall'
  dataKeys: ['stats'],        // which sync data it needs
};

export function render(ctx) {
  const { mountNode, data, helpers } = ctx;

  mountNode.innerHTML = `<div class="widget-card">...</div>`;

  return () => { mountNode.innerHTML = ''; };
}
```

### 3. Register in the widget index

```js
// src/shell/widgets/widget-registry.mjs — add one line:
{ id: 'my-new-widget', module: './widgets/my-new-widget.mjs' },
```

### 4. Done. No build step. No config restart.

The widget appears in the widget picker and can be added to the panel or desktop grid.

---

## Widget Picker UI

When the widget panel is open, a "+" button at the top opens a picker overlay showing all available widgets (from registry) with their icon, label, description, and size indicator. Enabled widgets show a checkmark. Clicking toggles them on/off.

```
┌─────────────────────┐
│  Add Widgets     [✕] │
├─────────────────────┤
│ ☑ System Health  2×1│
│ ☑ Task Pulse     1×1│
│ ☑ Clock          1×1│
│ ☐ Metrics Mini   2×1│
│ ☐ Cron Next      1×1│
│ ☐ Quick Notes    2×1│
│ ☐ Agent Feed     2×2│
│ ...                │
└─────────────────────┘
```

---

## Persistence Schema

### `localStorage['openclaw.win11.widgets.v1']`

```json
["system-health", "task-pulse", "clock-widget"]
```

Array of enabled widget IDs. Order determines display order.

### `localStorage['openclaw.win11.widgets.layout.v1']`

```json
{
  "system-health": { "compact": true },
  "clock-widget": { "format": "24h" }
}
```

Per-widget user config overrides merged with manifest defaults.

---

## Testing Strategy

### Unit Tests (per widget)

```js
// tests/widget-system-health-test.html
// - Renders without errors
// - Shows "OK" status when healthStatus.status === "ok"
// - Shows "ERROR" status when healthStatus.status === "error"
// - Calls cleanup on unmount (innerHTML cleared)
```

### Integration Tests

```js
// tests/widget-registry-test.html
// - Loads all widgets from index
// - Rejects widgets with mismatched IDs
// - Rejects widgets missing manifest/render

// tests/widget-panel-test.html
// - Toggles open/close
// - Adds/removes widgets
// - Persists enabled widgets to localStorage
// - Survives theme changes
```

### Test Helpers

Widgets can be tested in isolation by passing mock `ctx`:

```js
const mockCtx = {
  mountNode: document.createElement('div'),
  data: { healthStatus: { status: 'ok' } },
  config: {},
  helpers: { escapeHtml: (s) => s, formatRelativeTime: () => 'now' },
  api: {},
  navigate: () => {},
  showNotice: () => {},
  theme: { current: 'dark' },
  onThemeChange: () => () => {},
  onConfigChange: () => () => {},
  onResize: () => () => {},
};

const cleanup = await render(mockCtx);
// assert DOM content
cleanup();
```

---

## Available `realtime-sync` Data Keys

These are the keys widgets can declare in `manifest.dataKeys`:

| Key | Source | Type | Description |
|-----|--------|------|-------------|
| `stats` | `/api/stats` | `Object` | System stats (projects, tasks, etc.) |
| `healthStatus` | `/api/health-status` | `Object` | System health with status field |
| `blockersSummary` | `/api/blockers/summary` | `Object` | Blocker counts |
| `orgSummary` | `/api/org/summary` | `Object` | Org departments, agents summary |
| `approvalsPending` | `/api/approvals/pending` | `Object` | Pending approvals with details |
| `activeWorkflowRuns` | `/api/workflow-runs/active` | `Object` | Currently running workflows |
| `gatewayAgents` | `/gateway-status.json` | `Array` | Gateway agent status list |

Widgets can also use `ctx.api` directly for any dashboard API endpoint (see `api-client.mjs` for full method list).

---

## Icon Guidelines

Widget icons use the same style as app icons — inner SVG paths without the wrapping `<svg>` tag. The widget host provides:

```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" 
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- widget manifest.icon content goes here -->
</svg>
```

Use `stroke="currentColor"` for outline icons or `fill="currentColor"` for solid icons.

---

## Size Specifications

| Size | Grid Cells | Min Width | Min Height | Max Width |
|------|-----------|-----------|------------|-----------|
| `small` | 1×1 | 100px | 100px | 100px |
| `medium` | 2×1 | 212px | 100px | 212px |
| `large` | 2×2 | 212px | 212px | 212px |
| `wide` | 3×1 | 324px | 100px | 324px |
| `tall` | 1×2 | 100px | 212px | 100px |

Widths include 1× gap (8px) between cells.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Widget error crashes shell | Widget host wraps all renders/re-renders in try/catch. Error renders an error card, not a crash. |
| Widget memory leak | Cleanup function is mandatory. Host tracks and calls it on unmount. |
| Widget blocks sync | Widgets are passive consumers — they don't fetch, they receive. No circular dependency. |
| Too many widgets slow desktop | Widget host can lazy-mount (only render visible widgets). Add `maxWidgets` config. |
| localStorage bloat | Widget config is bounded (small JSON). Total storage < 5KB for 20 widgets. |
| Widget ID collision | Registry validates uniqueness. Warns on duplicate IDs at load time. |

---

## Implementation Order

1. **`widget-registry.mjs`** — Core discovery and management
2. **`widget-host.mjs`** — Per-widget lifecycle
3. **`win11-widget-card.css`** — Base card styles
4. **`widget-panel.mjs`** — Panel + desktop grid
5. **`win11-widget-panel.css`** — Panel chrome styles
6. **Shell integration** — `shell-main.mjs` + `taskbar.mjs` + `index.html`
7. **First widgets** — system-health, task-pulse, clock (validate the system works)
8. **Widget picker** — UI for enabling/disabling widgets
9. **Tests** — Registry, host, panel, and per-widget tests
10. **Documentation** — Update this file with any deviations from design
