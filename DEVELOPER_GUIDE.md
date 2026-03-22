# OpenClaw Project Dashboard — Developer Guide

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your PostgreSQL credentials
psql -U postgres -d mission_control -f schema/openclaw-dashboard.sql
node task-server.js
```

Open `http://localhost:3876` in your browser.

## Architecture Overview

The dashboard is a Win11-style desktop shell SPA. The single `index.html` entry point loads the shell (`shell-main.mjs`), which manages windows, taskbar, start menu, and widget panel. Each view is a lazy-loaded ES module under `src/shell/native-views/`.

```
index.html
  └─ shell-main.mjs (desktop shell)
       ├─ window-manager.mjs (draggable windows)
       ├─ taskbar.mjs + start-menu.mjs (taskbar)
       ├─ app-registry.mjs (app definitions)
       ├─ view-adapter.mjs (loads views into windows)
       ├─ widgets/ (desktop widget system)
       └─ native-views/ (all view modules)
            ├─ board-view.mjs
            ├─ agents-view.mjs
            ├─ operations-view.mjs
            ├─ workflows-view.mjs
            ├─ tasks-view.mjs
            └─ ... (25 views total)
```

### Key Files

| File | Purpose |
|------|---------|
| `index.html` | SPA entry point, loads shell CSS + JS |
| `task-server.js` | Main API server (port 3876) |
| `cron-manager-server.mjs` | Cron monitoring API (port 3878) |
| `memory-api-server.mjs` | Memory system API (port 3879) |
| `workflow-runs-api.js` | Workflow engine API |
| `gateway-workflow-dispatcher.js` | OpenClaw gateway bridge |
| `storage/asana.js` | PostgreSQL storage layer |
| `src/shell/shell-main.mjs` | Desktop shell initialization |
| `src/shell/window-manager.mjs` | Window management |
| `src/shell/native-views/` | All view modules |
| `src/shell/widgets/` | Widget system |
| `src/offline/` | IndexedDB offline sync |
| `src/security/` | Secret scanning and redaction |
| `schema/openclaw-dashboard.sql` | Base database schema |
| `schema/migrations/` | Database migrations |

## API Server

The `task-server.js` provides a REST API:

- `GET /api/tasks` — List tasks (with filters, pagination)
- `POST /api/tasks` — Create task
- `PATCH /api/tasks/:id` — Update task
- `DELETE /api/tasks/:id` — Soft-delete task
- `GET /api/projects` — List projects
- `GET /api/agents/status` — Agent fleet status
- `POST /api/agents/heartbeat` — Agent heartbeat
- `GET /api/workflows/*` — Workflow engine endpoints
- `GET /api/cron/jobs` — Cron job list
- See `docs/api.md` for full reference

## Database

PostgreSQL with `mission_control` database by default.

Apply migrations:

```bash
psql -U postgres -d mission_control -f schema/openclaw-dashboard.sql
for f in schema/migrations/*.sql; do
  psql -U postgres -d mission_control -f "$f"
done
```

Or use the migration script:

```bash
bash scripts/apply-workflow-migration.sh <migration-file>
```

## Adding a New View

1. Create `src/shell/native-views/your-view.mjs`:
```javascript
export class YourView {
  constructor(container, apiClient) {
    this.container = container;
    this.api = apiClient;
  }
  async render() {
    this.container.innerHTML = '<div class="your-view">...</div>';
  }
  destroy() { this.container.innerHTML = ''; }
}
```

2. Register in `src/shell/app-registry.mjs`:
```javascript
{ id: 'your-view', label: 'Your View', viewModule: () => import('./native-views/your-view.mjs') }
```

3. The shell will automatically add it to the start menu and taskbar.

## Adding a Widget

1. Create `src/shell/widgets/widgets/your-widget.mjs`
2. Register in `src/shell/widgets/widget-registry.mjs`
3. Widget panel will pick it up automatically

## Testing

```bash
# Run all tests
node tests/comprehensive-test.mjs

# Validate API
node scripts/dashboard-validation.js

# Smoke test (server must be running)
bash scripts/smoke-test-dashboard.sh

# Health check
bash scripts/dashboard-health.sh check

# Specific test suites
node tests/test-workflow-approvals-api.js
node tests/test-saved-views-api.js
pytest tests/  # Python security tests
npx playwright test  # E2E tests
```

## Offline Support

The offline system uses IndexedDB for local storage:

- `src/offline/idb.mjs` — IndexedDB wrapper
- `src/offline/state-manager.mjs` — State management with action queue
- `src/offline/sync-manager.mjs` — Background sync with retry logic
- `src/offline/offline-ui.mjs` — Offline banner and status indicators

## Security

- Secret scanning: `src/security/secrets.py` — detects and redacts credentials
- QMD security: `lib/qmd-security.js` — workspace data protection
- All credentials via environment variables (see `.env.example`)
- CORS headers configured in `task-server.js`

## Configuration

See `.env.example` for all environment variables. Key settings:

- `PORT` — API server port (default: 3876)
- `STORAGE_TYPE` — `postgres` or `memory`
- `POSTGRES_*` — Database connection settings
- `OPENCLAW_WORKSPACE` — OpenClaw workspace path (auto-detected)
- `OPENCLAW_CONFIG_FILE` — OpenClaw config path (auto-detected)
