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
