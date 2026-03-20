# Release v3.0.0-rc.1

**Release date:** 2026-03-20

## Breaking Changes from v2.0.0-rc.2

- The entire frontend has been rebuilt as a **WebOS desktop environment**. The legacy `dashboard.html` is removed; all access goes through `index.html`.
- All views are now **native ES modules** — iframe wrappers are gone. Each view is a self-contained `.mjs` file under `src/shell/native-views/`.
- CSS uses `--win11-*` custom properties exclusively. If you had custom theme overrides, update selectors.
- Memory API server (`memory-api-server.mjs`) is now a separate process on port 3879.

## New Features

### WebOS Desktop Shell
- Win11-style desktop with glass effects, rounded corners, and smooth animations
- Window manager: drag, minimize, maximize, close, z-order management
- Taskbar with pinned apps, system tray, active window indicators
- Start menu with categorized app launcher
- Full keyboard shortcut support (Meta for start, Meta+W for widgets, Escape to close)

### Widget System
- 18 built-in widgets covering system health, task metrics, utilities, and ambient info
- Modular widget registry — add new widgets by dropping a `.mjs` file in `src/shell/widgets/widgets/`
- Drag-and-drop reordering with visual drop position indicators
- Per-widget resize handles with size popup menu (1×1, 2×1, 2×2, 3×1, 1×2)
- Panel position toggle: slide in from left, right, or top
- Widget picker overlay for enabling/disabling widgets
- All widget state persisted to localStorage

### Agent Dashboard Reporting
- `scripts/agent_reporter.py` — CLI for agents to create, complete, block, and list Kanban tasks
- Agents auto-detect their ID from `OPENCLAW_AGENT_ID` or session key
- Per-agent SOUL.md instructions for automatic task reporting
- Activity messages and heartbeats via the dashboard API

### Memory & Facts System
- Browser-based memory file browser with search and inline editing
- Facts tab with full CRUD (add, delete, search) via REST API
- FTS5 search across facts with namespace filtering
- Fixed FTS5 trigger issues causing delete failures
- CORS preflight support for PUT and DELETE methods

### Native View Migration
- All 20 apps migrated from iframe to native ES module views
- Direct data binding via `api-client.mjs` and `realtime-sync.mjs`
- Departments view fixed (`api.org.departments` namespace)
- Consistent Win11 styling across all views

## Improved

- Task CRUD API with proper validation and error messages
- Realtime sync polls 7 data sources every 20 seconds
- Dashboard health, restart, and smoke-test scripts
- Comprehensive test suite for widget system (33 tests)
- Install docs updated with agent reporting setup instructions

## Known Issues

- Widget panel position state resets on first load after upgrade (localStorage migration)
- Touch drag-and-drop not yet supported (desktop mouse only)
- Some native views may show stale data if the task-server was not restarted after code changes

## Upgrade from v2.0.0-rc.2

```bash
cd ~/.openclaw/workspace/dashboard
git pull origin main
npm install
npm start
# Also restart memory-api if you use the memory/facts features:
node memory-api-server.mjs &
```

If upgrading from the filament-settings-webapp fork, this is a new repo — clone fresh:

```bash
git clone https://github.com/pgedeon/openclaw-project-webos.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard
npm install
cp .env.example .env
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql
psql -U openclaw -d openclaw_dashboard -f schema/demo-data.sql
npm start
```
