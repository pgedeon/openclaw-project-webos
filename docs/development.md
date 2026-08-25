---
layout: default
---

# Development Guide

## Setup

```bash
git clone https://github.com/pgedeon/openclaw-project-webos.git
cd openclaw-project-webos
npm install
cp .env.example .env
# Edit .env, then start
node task-server.js
```

## Architecture

The dashboard is a single-page application with a Win11 desktop shell.

### SPA Entry Point

`index.html` — loads CSS and the shell module:

```html
<script type="module" src="/src/shell/shell-main.mjs"></script>
```

### Shell System (`src/shell/`)

- **`shell-main.mjs`** — Initializes desktop, taskbar, widgets, and default view
- **`window-manager.mjs`** — Draggable, resizable window management
- **`taskbar.mjs`** — Bottom taskbar with app buttons and system tray
- **`start-menu.mjs`** — Start menu with pinned apps
- **`app-registry.mjs`** — Registry of all available apps/views
- **`view-adapter.mjs`** — Loads view modules into windows
- **`view-state.mjs`** — Per-view state management
- **`realtime-sync.mjs`** — WebSocket integration for live updates
- **`api-client.mjs`** — REST API client with auth and error handling

### Views (`src/shell/native-views/`)

Each view is an ES module exporting a class:

```javascript
export class MyView {
  constructor(container, apiClient, options) { ... }
  async render() { ... }
  destroy() { ... }
}
```

Views are lazy-loaded when their window is opened.

### Widgets (`src/shell/widgets/`)

- **`widget-registry.mjs`** — Registers available widgets
- **`widget-host.mjs`** — Renders widgets in the panel
- **`widget-panel.mjs`** — Slide-out widget panel UI
- Individual widgets in `widgets/` directory

### Offline (`src/offline/`)

- **`idb.mjs`** — IndexedDB wrapper
- **`state-manager.mjs`** — Action queue with undo support
- **`sync-manager.mjs`** — Background sync with exponential backoff
- **`offline-ui.mjs`** — Connection status indicators

### API Server (`task-server.js`)

Express-like HTTP server providing REST endpoints. Key routes:

- `/api/tasks/*` — Task CRUD
- `/api/projects/*` — Project management
- `/api/agents/*` — Agent status and heartbeat
- `/api/workflows/*` — Workflow engine
- `/api/cron/*` — Cron job management
- `/api/audit` — Audit log
- `/api/health` — Health check

### Storage (`storage/asana.js`)

PostgreSQL storage layer with parameterized queries. All mutations write to an audit log.

### Security (`src/security/`)

- **`secrets.py`** — Detects and redacts credentials in text
- **`test_secrets.py`** — Tests for the secret scanner
- **`utils/security.mjs`** — Client-side security utilities

## Making Changes

### Adding a View

1. Create `src/shell/native-views/your-view.mjs` exporting a class with `render()` and `destroy()`
2. Add entry to `src/shell/app-registry.mjs` in the `apps` array
3. The shell automatically adds it to the start menu and taskbar

### Adding a Widget

1. Create `src/shell/widgets/widgets/your-widget.mjs`
2. Register in `src/shell/widgets/widget-registry.mjs`

### Adding an API Endpoint

1. Add route handler in `task-server.js`
2. Add storage methods in `storage/asana.js` if needed
3. Add migration in `schema/migrations/` if schema changes
4. Add tests in `tests/`
5. Update `docs/api.md`

### Adding a Database Migration

1. Create `schema/migrations/NNN_description.sql`
2. Test against local database
3. Document in CHANGELOG.md

## Testing

```bash
# API validation (server must be running)
node scripts/dashboard-validation.js

# Comprehensive test suite
node tests/comprehensive-test.mjs

# Individual test files
node tests/test-workflow-approvals-api.js
node tests/test-saved-views-api.js

# Python security tests
pytest tests/test_secrets.py

# E2E with Playwright
npx playwright test
```

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs on every push/PR to `main`:

- **verify** job: syntax check (`node --check` over root/routes/storage/scripts/src), docs drift check, DB-free test suite (`scripts/ci-db-free-tests.js`), and an `npm audit --omit=dev --audit-level=critical` gate — critical-or-higher vulnerabilities in production dependencies fail the build; dev-dependency findings and moderate-and-below never block.
- **e2e** job: DB-free Playwright smoke suite against a json_snapshot server (separate job so e2e failures do not block the verify gates).

The audit level starts at `critical` because the current prod tree carries 5 known-open HIGH advisories (ws 8.20.0 direct dep; extract-zip 2.0.1 via puppeteer-core 24.x). Once ws >= 8.20.2 and puppeteer[-core] >= 25 land, tighten to `--audit-level=high` (path documented in the workflow comment).

## Performance Notes

Static facts only — no synthetic benchmarks. Measured 2026-08-25 by walking
the static `import` graph of `src/shell/shell-main.mjs` (dynamic `import()`
calls excluded).

### Boot module count

- **20** local ES modules load statically at shell boot (`shell-main.mjs`
  closure: window-manager, taskbar, start-menu, view-adapter, api-client,
  widget panel/registry/host, etc.).
- **35** views are registered in `app-registry.mjs` as `viewModule` string
  paths and are fetched via dynamic `import()` **on first window mount**
  (`window-manager.mjs`) — never at boot. `src/shell/native-views/` holds
  41 `.mjs` files total (the 35 registered views plus shared helpers/panels).
- The perf pass (2026-08-25) verified this lazy loading was already in place;
  no eager→lazy conversion was required, so the boot module count is
  unchanged by the pass.

### List virtualization

Shared window math lives in `src/shell/list-window.mjs` (pure, DOM-free,
covered by `tests/test-list-window.js`):

- **Fixed-row rail** (`visibleWindow`) — session-replay-view event rail;
  constant 26px rows, only the visible window + overscan exists in the DOM.
- **Capped render + "load more"** (`cappedWindow` / `growCap`) — used where
  row heights are variable:
  - `tasks-view.mjs`: first 100 filtered rows, +100 per click.
  - `board-view.mjs`: first 50 cards per column, +50 per click; a column
    that receives a dragged/dropped task auto-reveals it.

## Debugging

- Server logs: `node task-server.js` (stdout)
- Browser: DevTools → Console
- API calls: DevTools → Network
- Database: `psql` directly or via `scripts/dashboard-health.sh`

## Style Guide

- ES modules (`import`/`export`)
- Classes for views and major components
- Async/await for all I/O
- No hardcoded credentials (use env vars)
- Parameterized SQL queries only
- CSS variables for theming
