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

### Capability resolution

Every feature that can degrade answers through one contract instead of
ad-hoc per-route shapes: `lib/capability-status.js` (pure, zero IO) resolves
a feature's EFFECTIVE capability as declared ∩ verified ∩ configured — each
leg a boolean, `null` meaning not-applicable — fail-closed: any `false` leg
means not capable, with the first failed leg named (`disabled` = declared
false, `unreachable` = verified false, `misconfigured` = configured false;
garbage leg values count as `false`). `toDegradedBody()` maps a result to
the house degrade shape `{ available: false, reason }` with the existing
reason vocabulary (`no_database`, `query_failed`, …) preserved
byte-identically, and `describeForUi()` renders one honest human string per
status so views stop hand-stringing panel states. Piloted on two surfaces
(2026-08-30, market-scan steal #2): the budget-routes degrade points and the
Mission Control runs/cron panel failure strings. Migration path for the
rest (snapshot-routes, mcp-server, remaining views): route each feature's
degrade points through `resolveCapability` + `toDegradedBody` /
`describeForUi` in place, keeping test-pinned reason strings unchanged; the
all-null `unassessed` status is the honest interim for features not yet
wired to real checks.

### Adding a Database Migration

1. Create `schema/migrations/NNN_description.sql`
2. Test against local database
3. Document in CHANGELOG.md

### Documentation Site

The docs site (GitHub Pages, cayman theme) is generated from `docs/*.md` by
`scripts/build-docs-index.mjs`. Each run writes `docs/index.md` (landing-page
link index), stamps missing Jekyll front matter onto new markdown files, and
emits `docs/search-index.json` — the corpus consumed by the client-side search
page `docs/search.html` (vanilla JS, no dependencies). After adding or changing
any doc under `docs/`, re-run:

```bash
node scripts/build-docs-index.mjs          # regenerate index.md + search-index.json
node scripts/build-docs-index.mjs --check  # drift check — exit 1 if either output is stale
```

Both generated files are committed, so the Pages workflow stays pure-Jekyll.

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

# DB-free unit/integration suite (CI verify job)
node scripts/ci-db-free-tests.js

# E2E with Playwright
npx playwright test
```

### E2E locally against a DB-free server (CI e2e job equivalent)

```bash
STORAGE_TYPE=json_snapshot HOST=127.0.0.1 PORT=13890 DASHBOARD_AUTH_TOKEN=dev-e2e-token \
  node task-server.js > task-server-e2e.log 2>&1 &
E2E_BASE_URL=http://127.0.0.1:13890 E2E_AUTH_TOKEN=dev-e2e-token npx playwright test --project=chromium
```

Coverage philosophy for API-level flows: test what the mode honestly allows
against the live server, and drive full write-path semantics over a real HTTP
harness when storage is required. The one-click actions suite
(`test.describe('One-click actions API')` in `tests/e2e.spec.ts`) shows both
layers: degradation-boundary tests pin the live json_snapshot behavior (400
unknown-kind validation ordering, 503 `{available:false}` audit-first execute
refusal, 200 read-contract `/api/actions/recent`), while the latch pipeline
(happy-path executed receipt, idempotent replay with exactly-one executor
invocation, 409 stale_retry) runs against `tests/fixtures/actions-harness.js` —
the real Router + registerActionRoutes over an ephemeral http.Server with an
in-memory receipt pool, since json_snapshot ships `pool=null` and cannot back
the PostgreSQL latch.

The same philosophy extends to DB-free end-to-end flow tests that need no
Playwright browsers at all: `tests/test-e2e-mcp-snapshot-flows.js`
(registered in `scripts/ci-db-free-tests.js`) drives two shipped features
against real servers — the MCP stdio server runs as a real child process
(`initialize` → `tools/list` → executed `tools/call`) pointed at
`tests/fixtures/snapshot-harness.js`, which serves the real snapshot routes
over an ephemeral http.Server with json_snapshot parity (`pool: null`), and
the snapshot/restore flow runs over real HTTP against the same harness
(create/preview/apply degradation boundary, registry listing + byte-identical
download of a seeded artifact, integrity-before-database ordering, redaction
invariant on the shipped bytes). One transport lesson is pinned in the test's
own harness comment: the MCP session must be driven with async `spawn`, never
`spawnSync` — a synchronous wait blocks this process' event loop, freezing the
in-process backend mid-request and deadlocking any tool call against it.

Two adapter-path suites close the seams the real-server and unit tests
leave open (both registered in `scripts/ci-db-free-tests.js`):
`tests/test-mcp-adapter.js` drives the list_tasks/get_task httpJson →
mapUpstream seam with a fake fetch — every upstream outcome shape (500 with
the error body preserved verbatim, 401, `{tasks:[…]}` envelope, unrecognized
shape passthrough, degradation body passthrough) × the local status/limit/
truncated composition, pinning the exact path that shipped the 2026-08-29
staging failure (GET /api/tasks/all 500 → MCP list_tasks errored 8/8);
`tests/test-snapshot-e2e-lite.js` connects the full mutating seam without
sockets or a database — MCP create_snapshot → minted envelope → the real
actions pipeline (validation → governance → latch → executor) → the real
`createSnapshotArtifact()` over a routing fake pool → receipt → MCP payload —
plus the route-level application of the debt-D3 deny-regex (snake_case
secret names in nested JSONB) and a no-secret-marker sweep over every
response body, artifact byte, and MCP frame.

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
- **36** views are registered in `app-registry.mjs` as `viewModule` string
  paths and are fetched via dynamic `import()` **on first window mount**
  (`window-manager.mjs`) — never at boot. `src/shell/native-views/` holds
  42 `.mjs` files total (the 36 registered views plus shared helpers/panels).
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

### Manual perf harness (D5)

`npm run perf` (`scripts/perf-benchmark.mjs`) is the scripted Playwright
 timing harness from roadmap debt D5 (reviews #3/#4). It boots task-server
the same way the CI e2e job does (json_snapshot, staged dashboard assets,
`OPENCLAW_WORKSPACE` pointed at a temp dir — never `/root/.openclaw`) and
measures, median of 3 cold runs: boot-to-interactive (navigation start →
taskbar + pinned apps + desktop ready), tasks-view first meaningful render
(open window → rows > 0 or the honest empty state), and capped-list growth
(one "load more" click → rows added + synchronous re-render wall time).

Rules: run manually per release, **never CI-blocking** — perf numbers gate
nothing and the script is not registered in `ci-db-free-tests.js` (it is
not a DB-free test; `playwright.config.ts` testMatch cannot pick it up).
Numbers are only meaningful on the machine that produced them (LAN latency,
local Chromium); the harness is the source of truth — no measured numbers
are copied into docs, they rot. Output lands in gitignored
`perf-results.json` (timestamp, node version, commit sha) plus a
human-readable table with a `VERDICT: measured` line; exit 1 only on
infrastructure failure (server never ready / Chromium cannot launch),
never on a slow number.

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
