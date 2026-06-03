# AGENTS.md — OpenClaw Project WebOS

## Purpose

Win11-style desktop environment for managing OpenClaw agent workflows. Served entirely in the browser with vanilla JS, no frameworks, no build step.

## Architecture Constraints

- **No build step.** All frontend code is vanilla ES modules loaded directly by the browser.
- **No framework.** No React, Vue, Svelte, etc. Pure DOM manipulation.
- **PostgreSQL backend.** All persistent data lives in PostgreSQL via `storage/asana.js`.
- **Bearer token auth.** Single `DASHBOARD_AUTH_TOKEN` for all API routes except `/api/health` and `/api/auth/self`.
- **Multiple Node servers.** task-server (3876), cron-manager (3878), memory-api (3879), filesystem-api (3880). All proxy through task-server for browser access.

## Directory Ownership

| Directory | Owns | Doc |
|-----------|------|-----|
| `src/shell/` | Desktop shell (window manager, taskbar, start menu, views) | `src/shell/AGENTS.md` |
| `src/shell/native-views/` | 26 windowed app views | `src/shell/native-views/AGENTS.md` |
| `src/shell/widgets/` | 18 desktop widgets + widget system | `src/shell/widgets/AGENTS.md` |
| `src/offline/` | IndexedDB, sync, offline UI | `src/offline/AGENTS.md` |
| `routes/` | HTTP route handlers | `routes/AGENTS.md` |
| `storage/` | PostgreSQL storage layer | `storage/AGENTS.md` |
| `schema/` | Database migrations | `schema/AGENTS.md` |
| `scripts/` | Operational scripts | `scripts/AGENTS.md` |
| `docs/` | User/developer documentation | — |

## Route Registration

1. Add route handler in `routes/<name>-routes.js`
2. Export `register<Name>Routes(router)` function
3. Require and call in `task-server.js`
4. Route ordering matters — more specific patterns before less specific

## Migration Rules

1. Sequential numbering: `001_<name>.sql`, `002_<name>.sql`, etc.
2. Each migration must be idempotent where possible
3. Update `docs/schema-reference.md` in the same commit
4. Never modify a migration after it's been pushed

## View Registration

1. Create view in `src/shell/native-views/<name>-view.mjs`
2. Export a render function: `render(container, context)`
3. Add entry to `APP_REGISTRY` in `src/shell/app-registry.mjs`
4. Update `docs/views-reference.md` in the same commit

## Widget Registration

1. Create widget in `src/shell/widgets/widgets/<name>-widget.mjs`
2. Add entry to `WIDGET_INDEX` in `src/shell/widgets/widget-registry.mjs`
3. Update `docs/widget-catalog.md` in the same commit

## Documentation Rules

- Every code change that modifies public API, views, widgets, or schema must update the matching docs
- Run `npm run validate` before pushing — it includes docs drift checking
- `scripts/docs-drift-check.js` validates counts and route coverage

## Key Entry Points

- **Shell bootstrap:** `src/shell/shell-main.mjs`
- **API server:** `task-server.js` (port 3876)
- **Storage layer:** `storage/asana.js`
- **App registry:** `src/shell/app-registry.mjs`
- **Widget registry:** `src/shell/widgets/widget-registry.mjs`
