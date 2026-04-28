# Shell Architecture Reference

The OpenClaw WebOS desktop shell is a Win11-inspired single-page application built from modular ES modules. This document covers the internal architecture of the shell layer — the window manager, taskbar, start menu, sync system, and view infrastructure.

**Source:** `src/shell/`

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  shell-main.mjs (Bootstrap & Orchestration)              │
│  ├── WindowManager (windows, drag, resize, z-order)      │
│  ├── Taskbar (pinned apps, clock, system tray)           │
│  ├── StartMenu (app launcher, search, categories)        │
│  ├── WidgetPanel + WidgetRegistry (desktop widgets)      │
│  ├── ViewAdapter (view-to-window bridge)                 │
│  ├── ViewState (per-view reactive state)                 │
│  ├── APIClient (HTTP abstraction)                        │
│  └── RealtimeSync (20s polling, data distribution)       │
└──────────────────────────────────────────────────────────┘
```

### Bootstrap Sequence

1. `shell-main.mjs` initializes the desktop DOM structure
2. Creates `APIClient` → `RealtimeSync` → `ViewState`
3. Instantiates `WindowManager`, `Taskbar`, `StartMenu`
4. Creates `ViewAdapter` and wires it to `WindowManager`
5. Initializes `WidgetRegistry` and `WidgetPanel`
6. Calls `setShellContext()` to share instances across modules
7. Performs first data sync and renders the welcome widget

---

## Module Reference

### WindowManager

**Source:** `src/shell/window-manager.mjs`

Manages all desktop windows — creation, positioning, resizing, minimizing, maximizing, closing, and z-ordering.

#### Key Features

- **Window lifecycle:** Create, focus, minimize, maximize, restore, close
- **Drag & resize:** Pointer-event-based drag and edge/corner resize (8 directions)
- **Cascade positioning:** New windows offset by 28px from the last opened window
- **Persistence:** Window positions and sizes saved to localStorage (`openclaw.win11.windows.v1`)
- **Z-ordering:** Sequential z-index counter (starting at 40) for window stacking
- **Min size enforcement:** 360×240px minimum window dimensions

#### Window State Persistence

Window bounds (x, y, width, height) are persisted per app ID. On reload, windows restore to their last position.

#### API

```javascript
const wm = new WindowManager({ desktop, apps: APP_REGISTRY });

wm.open(appId, options);        // Open a window for an app
wm.close(appId);                 // Close a window
wm.focus(appId);                 // Bring window to front
wm.minimize(appId);              // Minimize window
wm.maximize(appId);              // Maximize window
wm.restore(appId);               // Restore from minimized/maximized
wm.getWindow(appId);             // Get window element
wm.isAppOpen(appId);             // Check if window is open
wm.getActiveAppId();             // Currently focused app ID
```

#### Events

| Event | Detail | Description |
|-------|--------|-------------|
| `window:open` | `{ appId }` | A window was opened |
| `window:close` | `{ appId }` | A window was closed |
| `window:focus` | `{ appId }` | A window gained focus |
| `window:minimize` | `{ appId }` | A window was minimized |
| `window:maximize` | `{ appId }` | A window was maximized |

---

### Taskbar

**Source:** `src/shell/taskbar.mjs`

The bottom taskbar with pinned app icons, system tray (clock, theme toggle, notifications), and running app indicators.

#### Features

- **Pinned apps:** Configurable set of always-visible app icons (from `PINNED_APP_IDS` in app-registry)
- **Running indicators:** Active windows show a dot indicator under their taskbar icon
- **Clock:** Live clock with seconds, updated every second
- **Theme toggle:** Moon/Sun icon toggles between dark and light themes
- **Notification bell:** Placeholder for future notification system
- **Widget toggle:** Opens/closes the widget panel
- **Start button:** Toggles the start menu

#### System Tray

Positioned on the right side of the taskbar:
- Theme toggle (dark/light)
- Notification bell
- Live clock (`HH:MM:SS`)

---

### StartMenu

**Source:** `src/shell/start-menu.mjs`

The Win11-style start menu with pinned apps, categorized app grid, and search filtering.

#### Features

- **Pinned section:** Top row of frequently used apps
- **Category grid:** All apps organized by category (Work, Operations, Admin, Internal)
- **Search:** Real-time text filtering across app labels, categories, and IDs
- **Keyboard support:** Escape to close, click-outside to dismiss
- **Anchor positioning:** Positions relative to the start button

#### Category Order

Apps are displayed in categories ordered by `APP_CATEGORY_ORDER`:
1. Work
2. Operations
3. Admin
4. Internal

---

### RealtimeSync

**Source:** `src/shell/realtime-sync.mjs`

Unified real-time data synchronization module. Fetches all key data sources in parallel at regular intervals and distributes updates to subscribers.

#### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `interval` | 20000ms | Polling interval |
| Debounce | 2000ms | Minimum time between refreshes |

#### Data Sources

| Key | API Endpoint | Description |
|-----|-------------|-------------|
| `stats` | `GET /api/stats` | System-wide task counts and status |
| `healthStatus` | `GET /api/health-status` | API and service health |
| `blockersSummary` | `GET /api/blockers/summary` | Active blocker summary |
| `orgSummary` | `GET /api/org/summary` | Department and agent summary |
| `approvalsPending` | `GET /api/approvals/pending` | Pending approval count |
| `activeWorkflowRuns` | `GET /api/workflow-runs/active` | Active workflow run data |
| `gatewayAgents` | `/gateway-status.json` | Gateway agent status (static file) |

#### Subscriber API

```javascript
const sync = createRealtimeSync({ api, interval: 20000 });

sync.subscribe('stats', (newStats, oldStats) => { ... });
sync.subscribe('healthStatus', (newHealth) => { ... });

// Force immediate refresh
sync.refresh();

// Get current data
sync.getData(); // → SyncState

// Get fetch timestamps
sync.getTimestamps(); // → FetchTimestamps

// Get fetch errors
sync.getErrors(); // → FetchErrors
```

#### Data Flow

```
Every 20s:
  Promise.all([
    fetch /api/stats,
    fetch /api/health-status,
    fetch /api/blockers/summary,
    fetch /api/org/summary,
    fetch /api/approvals/pending,
    fetch /api/workflow-runs/active,
    fetch /gateway-status.json
  ])
  → Cache results with timestamps
  → Notify subscribers for changed keys
  → Update widget panel
```

---

### APIClient

**Source:** `src/shell/api-client.mjs`

HTTP client abstraction for all dashboard API communication.

#### Features

- **Automatic base URL resolution:** Detects the dashboard server from the current page origin
- **Query string builder:** Handles arrays and null values in query parameters
- **Error parsing:** Extracts error messages from JSON or text responses
- **Response type detection:** Auto-parses JSON responses, returns text for others

#### API

```javascript
const api = createAPIClient();

// GET request
const data = await api.get('/api/tasks', { project_id: 'uuid', limit: 50 });

// POST request
const task = await api.post('/api/tasks', { title: 'New Task', status: 'ready' });

// PUT request
await api.put('/api/tasks/uuid', { status: 'completed' });

// DELETE request
await api.delete('/api/tasks/uuid');
```

---

### ViewAdapter

**Source:** `src/shell/view-adapter.mjs`

Bridges desktop views (native-views) with the WindowManager. Provides shared utilities for view rendering.

#### Utility Functions

| Function | Purpose |
|----------|---------|
| `escapeHtml(str)` | HTML entity escaping |
| `formatTimestamp(dateStr)` | Format ISO date to locale string |
| `formatRelativeTime(dateStr)` | Relative time ("2 hours ago", "in 3 days") |
| `formatTokenLabel(str)` | Pretty-print snake_case identifiers |

#### View Creation

```javascript
const adapter = createViewAdapter({ apiClient, sync, viewState, windowManager });

// Open a view in a window
adapter.openView('tasks', { project_id: 'uuid' });

// Close a view
adapter.closeView('tasks');
```

---

### ViewState

**Source:** `src/shell/view-state.mjs`

Reactive per-view state management. Supports dot-path get/set with change notification.

#### Features

- **Dot-path access:** `state.get('filters.status')`, `state.set('filters.status', 'active')`
- **Change detection:** Only notifies when values actually change
- **Deep cloning:** Prevents reference mutations
- **Listener API:** Subscribe to specific paths or all changes

#### API

```javascript
const vs = createViewState({ api, sync });

// Get/set state
vs.get('tasks');                    // → current task list
vs.set('filter', 'completed');      // → triggers listeners
vs.set('project.activeId', uuid);   // → deep path set

// Subscribe
vs.subscribe('filter', (newVal, oldVal) => { ... });
vs.subscribe('*', (key, newVal, oldVal) => { ... });

// Batch updates (single notification)
vs.batch(() => {
  vs.set('filter', 'all');
  vs.set('sort', 'newest');
});
```

---

### shell-main.mjs

**Source:** `src/shell/shell-main.mjs`

The bootstrap module that wires everything together. Creates and connects all shell components.

#### Initialization Order

1. Create `APIClient`
2. Create `ViewState`
3. Create `RealtimeSync`
4. Create `WindowManager`
5. Create `Taskbar` with system tray
6. Create `StartMenu`
7. Create `ViewAdapter`
8. Create `WidgetRegistry` and `WidgetPanel`
9. Call `setShellContext()` to share instances
10. Wire event listeners between components
11. Render welcome widget with live stats
12. Start realtime sync

#### Quick Launch Apps

Five apps are configured for quick launch from the welcome widget:
`tasks`, `agents`, `skills-tools`, `operations`, `workflows`

---

## Data Flow Summary

```
Browser
  │
  ├── shell-main.mjs (init)
  │     │
  │     ├── APIClient ──HTTP──→ task-server:3876
  │     │
  │     ├── RealtimeSync (20s poll)
  │     │     └──→ 7 endpoints in parallel
  │     │     └──→ Cache + Notify subscribers
  │     │
  │     ├── ViewState (reactive state)
  │     │     └──→ ViewAdapter → Native Views
  │     │
  │     ├── WindowManager (windows)
  │     │     └──→ Taskbar (running indicators)
  │     │
  │     ├── Taskbar (bottom bar)
  │     │     └──→ StartMenu (launcher)
  │     │
  │     └── WidgetPanel
  │           └──→ WidgetRegistry → 17 Widgets
  │
  └── Offline Layer (IndexedDB)
        └──→ StateManager → SyncManager
```

---

## Theme System

Themes are stored in localStorage (`openclaw.win11.theme.v1`). The shell detects the system preference on first load and defaults to `dark`. The taskbar provides a toggle button (moon/sun icon) that persists the choice.

CSS classes applied to the root element:
- `.theme-dark` — Dark theme (default)
- `.theme-light` — Light theme

---

## LocalStorage Keys

| Key | Module | Purpose |
|-----|--------|---------|
| `openclaw.win11.theme.v1` | shell-main | Theme preference |
| `openclaw.win11.windows.v1` | WindowManager | Window positions/sizes |
| `openclaw.dashboard.widgets.visible` | WidgetPanel | Widget visibility state |
| `projectDashboardState` | StateManager | Legacy dashboard state (fallback) |

---

## Extending the Shell

### Adding a New View

1. Create `src/shell/native-views/your-view.mjs`
2. Export a `render(container, { api, sync, viewState })` function
3. Add entry to `APP_REGISTRY` in `app-registry.mjs`
4. The ViewAdapter will auto-discover and render it

### Adding a New Widget

1. Create `src/shell/widgets/widgets/your-widget.mjs`
2. Export `manifest` and `render(ctx)` function
3. Register in `widget-registry.mjs`
4. See [widget-catalog.md](widget-catalog.md) for full details

### Adding a New Data Source

1. Add endpoint to `task-server.js`
2. Add fetch key to `RealtimeSync` data sources
3. Subscribe to the new key in views/widgets that need it
