# Changelog

All notable changes to the Project Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Codified current auth as single-operator bearer-token mode and exposed deferred full-auth policy metadata from `/api/auth/self`.

### Added
- Live agent console validated against the live gateway (docs/research/console-validation-2026-08-24.md): real v4 handshake via the console feed tap, live tool-start/tool-output/tool-end frames captured from a working qa-auditor session with exitCode/durationMs/cwd intact, per-session filtering confirmed (0 cross-session frames), secret redaction clean; idle end-path fires in production conditions. Roadmap ticked.
- Live agent console v1 (lib/gateway-console-feed.js + routes/sse-routes.js `GET /api/console/stream?session=` + src/shell/native-views/console-view.mjs): second gateway subscriber (own protocol-v4 connection; lib/gateway-bridge.js untouched) tapping the chatty console-class streams — per-session fanout only while a client is attached (operator.read is fleet-wide; filtering is server-side), drop-oldest 300-frame client queues without resync (terminal semantics), idle end requires both signals (quiet >= 20s AND task row non-running), bridge loss emits `console:end {reason:"bridge-disconnected"}` with manual reattach. Terminal view: 2000-line DOM ring buffer with rAF-coalesced appends, stick-to-bottom scrolling with jump-to-now pill, inline tool-call badges (name/duration/exitCode green-red), zero-throw disconnected state; registered under Integration (33 windowed apps). 24 DB-free assertions in tests/test-console-feed.js (suite now 40/40); secret redaction defense-in-depth on every fanned-out frame.
- Market scan 2026-08-24 (docs/research/market-scan-2026-08-24.md): post-1.1.0 competitive delta refresh — FleetQ + Mission Control quiet since ~Aug 20 (MC's last commit is security hardening; no releases either side); sweep surfaced Paperclip (79k★, per-agent budget hard-stops, approval gates + revisioned rollback + immutable audit) and LoopX (5k★, protected-action receipts) as new entrants attacking the governance differentiator; refreshed top-5 steals (budget ledger pulled forward to Phase 1 in UPGRADE_ROADMAP.md; MCP reframed depth-over-count vs FleetQ's 675+ tools; protected-action receipts added to one-click-actions brief requirements); differentiator audit — desktop shell/offline/zero-build hold, "governance nobody else has" narrowed to publish-pipeline governance; single recommendation: ship budget ledger + auto-pause now.
- Live agent console design brief (docs/briefs/live-console.md): terminal-style live stream per roadmap Phase 1 run 5 — pick running agent → attach to a scrolling stream of command output lines + assistant text with inline tool-call badges (name, duration, exitCode), pause + bounded 2000-line ring scrollback, jump-now affordance, idle end-of-stream banner with auto-rearm; data contract maps the spike-verified gateway events (`agent` assistant deltas / item / command_output, `session.tool` start→update→result) through a NEW dedicated console SSE channel (`GET /api/console/stream`) recommended over passthrough on the bridge-fed state channel (isolated backpressure domain, server-side per-session filtering under fleet-wide `operator.read`, drop-oldest-without-resync terminal semantics, keeps the existing SSE contract frozen); plain-DOM capped-ring rendering chosen over virtualized/canvas under the no-frameworks constraint; additive `gateway-console-feed.js` sequencing guard so the concurrent bridge-v1 validation lane stays untouched; read-only AC set (zero non-GET, buffer bound under 10k-line flood, seq dedupe/gap tolerance, auth/secret checks).
- Gateway bridge v1 (lib/gateway-bridge.js + routes/sse-routes.js `GET /api/events/stream` + realtime-sync live mode): one server-side WebSocket subscribes to the OpenClaw gateway per the streaming-spike v4 handshake recipe (connect.challenge → connect with the shared secret from gateway.auth, `operator.read` only — the secret never reaches the browser), normalizes task/agent/tool events into a small internal set (`task-updated`, `agent-status-changed`, `run-updated`) with id+updatedAt/seq dedupe against the gateway's heavy task re-upserts and envelope-seq gap detection that emits a `resync` hint; bridge-fed SSE channel reuses the F7 auth surface with per-client bounded queues (drop-oldest + single `resync` hint on overflow); frontend live mode is opt-in via localStorage `openclaw.liveSync=1` — halts 20s polling while connected, falls back automatically on SSE error/close with capped reconnect attempts (5) before staying on polling; disabled cleanly when no gateway config resolves (env overrides GATEWAY_BRIDGE_URL/GATEWAY_BRIDGE_TOKEN), default OFF with zero behavior change. Validated end-to-end against the live gateway 2026-08-24 (docs/research/bridge-validation-2026-08-24.md): v4 handshake + SSE fan-out + dedupe confirmed under load (0 duplicate id+updatedAt frames across 1583 delivered events); roadmap checkbox ticked.
- Session replay inspector design brief (docs/briefs/session-replay.md): time-travel stepper per roadmap-review Phase 1 reorder — pick agent → pick session → timeline scrubber → step through events with expandable tool calls (args in, result out, exitCode badge from persisted `toolResult.details`), assistant text rendered as-of-t; v1 read-only client-side rendering from one fetched transcript via two new GET routes on `routes/session-routes.js` (`/events` cursor-paginated normalized event list + `/events/:line` full-body detail) backed by new `readEvents` reader functions, virtualized rendering pinned by a 10k-event scrub performance AC, graceful missing/partial-transcript states, DB-free testable normalizer (`normalizeTranscriptEvents`) and state function (`computeStateAsOf`), explicit non-goals (no editing, no live tailing until the WS bridge lands, no cross-session search).
- Gateway streaming spike (docs/research/gateway-streaming-spike-2026-08-24.md): read-only WebSocket recon of the OpenClaw gateway — verified v4 handshake recipe with TLS fingerprint pinning, event shapes (`session.tool` args→partial→result lifecycle, `agent` assistant/command-output deltas, `task` upserts with dedupe caveat, dual seq framing), live traffic volumes, and feasibility verdicts: server-side fan-out WS bridge replacing `realtime-sync` polling = feasible; live agent console streaming = feasible; SSE-first delivery contract retained. Includes read-only probe script `scripts/probe-gateway-ws.mjs` with secret redaction.
- Mission Control view part 2: Win11 visual polish matching sibling views (health-view badge semantics, no horizontal scroll at the default 1180×780 window size), distinct loading/empty/error states per panel with last-good-data stale flagging, cost panel distinguishing "No cost data recorded yet" from "Cost unavailable — no database"; anomaly thresholds promoted to named exported constants (`STALE_RUN_MINUTES`, `ZERO_TOKEN_MINUTES`, `CRASH_LOOP_CONSECUTIVE_FAILURES`, `COST_SPIKE_MULTIPLIER`, `COST_SPIKE_MIN_HISTORY_DAYS`, `MAX_ANOMALY_FLAGS`) each carrying a justification comment, with boundary fixtures pinning them in tests/test-cost-routes.js and a thresholds note added to docs/views-reference.md.
- Mission Control view (Phase 1 flagship, part 1): six-panel read-only command center (fleet status, blocked/stale runs, cron health, cost today/7d, anomaly flags max 5 types, quick links) with per-panel independent degradation and GET-only polling at 20/30/60/120 s intervals; new `routes/cost-routes.js` exposing `GET /api/costs/summary?days=7` aggregate over workflow_runs cost columns that degrades to `{ available: false }` JSON without PostgreSQL; registered under Operations in the app registry (32 windowed apps).
- Mission Control design brief (docs/briefs/mission-control.md): read-only command-center aggregation per UPGRADE_ROADMAP Phase 1 — six-panel layout (fleet status, blocked/stale runs, cron health, cost today/7d, anomaly flags, quick links), per-panel data contracts over existing routes plus one small needs-new `/api/costs/summary` aggregate, v1 anomaly-flag definitions (max 5), file plan, DB-free-testable acceptance criteria, explicit non-goals (no editing actions, polling only).
- Added focused standalone coverage and API documentation corrections for export/import route handlers.
- Added auth reference documentation and focused auth policy regression coverage.
- Added focused standalone coverage for agent route handlers.
- Added focused standalone coverage for Bing Webmaster route handlers.
- Added focused standalone coverage and API documentation for chat route handlers.
- Added focused standalone coverage and API documentation for cron route handlers.
- Added focused standalone coverage and API documentation for history and snapshot route handlers.
- Added focused standalone coverage and API documentation for health, route catalog, and OpenClaw status route handlers.
- Added focused standalone coverage and API documentation for memory proxy route handlers.
- Added focused standalone coverage for project route handlers.
- Added focused standalone coverage and API documentation for settings route handlers.
- Added focused standalone coverage and API documentation for space route handlers.
- Added focused standalone coverage and API documentation for OpenClaw session reader route handlers.
- Added focused standalone coverage and API documentation for the SSE event stream route.
- Added focused standalone coverage and API documentation corrections for task route handlers.
- Added focused standalone coverage for view route handlers.
- Added focused standalone coverage and API documentation for workflow routing admin route handlers.

### Fixed
- Fixed import route validation so malformed bundles do not acquire a database client and connection failures return handled JSON errors.
- Fixed history route handled returns and unavailable-database detection for delayed PostgreSQL initialization.
- Fixed health routes so storage failures return handled JSON errors and OpenClaw CLI error payloads return dependency failures.
- Fixed project list route storage failures so they return handled JSON 500 responses.
- Fixed settings routes so matched handlers report handled status to the task-server router.
- Fixed space route unavailable-database handling and body parser error status responses.
- Fixed task subtask route error mapping so missing parent/child tasks return 404 and validation failures return 400.
- Fixed cron route handling of OpenClaw CLI dependency errors returned as `{ error }` payloads.
- Fixed workflow routing admin handlers so validation and missing-database responses are consistently reported as handled by the router.
- Fixed standalone filesystem API server (SECURITY-AUDIT-2026-08.md F5): bearer-token auth on every route, Host-header loopback allowlist, task-server-only Origin allowlist, JSON-only mutating requests, and outright write refusal for `crontab/`, `.ssh/`, and `agents/*/sessions/` trees (reads stay allowed for the explorer).

## [1.1.0] - 2026-08-23

### Added
- Market scan (docs/research/market-scan-2026-08-23.md): competitive landscape across 18 agent-ops/workflow platforms, top-5 steal-worthy features with impact/effort scores; UPGRADE_ROADMAP updated — run-anomaly flags in Mission Control scope, session inspector expanded to replay stepper, budget ledger + auto-pause added to cost analytics, new MCP server exposure item.
- Security audit shipped, 11 findings (2 critical, 3 high), fixes queued (SECURITY-AUDIT-2026-08.md).
- CI: Playwright e2e job (`e2e`, separate from `verify`) — chromium-only DB-free smoke suite run against `task-server.js` in `STORAGE_TYPE=json_snapshot` mode on `127.0.0.1:3876`, Playwright report uploaded on failure. Restored `storage/asana-json-snapshot.js` (referenced by `task-server.js` and documented in README, but missing from the repo — without it json_snapshot mode left storage uninitialized and the server 503'd every request, including static files). Replaced the storage-CRUD e2e spec with a DB-free smoke suite (title, auth token gate, no uncaught JS errors, `/api/health` + `/api/auth/self` contract, shell boot with valid stored token) — the old spec's CRUD assertions require real PostgreSQL. (a99385b, fixed 86c5ffb)
- Added per-run token/cost tracking schema (migration `022_add_run_token_cost_tracking.sql`) on `workflow_runs` — `input_tokens`, `output_tokens`, `cached_tokens`, `model_id`, `cost_estimate`, `currency`, `reported_at` — plus minimal usage read/write helpers in `storage/asana.js`; history accumulates ahead of Phase 2 analytics UI. (88abe97)
- CI: GitHub Actions pipeline (`.github/workflows/ci.yml`) — `node --check` over all JS, docs drift check, and 33 verified DB-free tests on every push/PR. No PostgreSQL in CI. (8751775)

### Changed
- CI: triaged all 31 previously CI-excluded tests — 3 fixed and now running in the DB-free suite (36 total: `test-metrics-api.js` UUID fixtures, `test-task-server-storage-fallback.js` repointed to `routes/health-routes.js`, `test-workflow-runs-business-context.js` defused time-bombed approval fixture), 20 deleted (19 pre-shell-era view/page tests plus `test-asana-json-snapshot.js`, whose target module never existed in the repo), 8 kept excluded but now skipping gracefully with clear `SKIP:` lines when their PostgreSQL/server/browser/`.env`/host-file dependency is absent.

### Fixed
- **Security (SECURITY-AUDIT-2026-08.md F1):** stopped injecting `DASHBOARD_AUTH_TOKEN` into the unauthenticated dashboard HTML at `/`; the shell now verifies an operator-entered token against `/api/auth/self` before booting and sends it as a Bearer header.
- **Security (SECURITY-AUDIT-2026-08.md F2):** cron-manager API now requires bearer auth (`DASHBOARD_AUTH_TOKEN`, server refuses to start without it), validates `Host`/`Origin` against allowlists, and requires `Content-Type: application/json` on mutating routes.
- **Security (SECURITY-AUDIT-2026-08.md F3):** cron job ids are validated against `/^[A-Za-z0-9._-]+$/` with any `..` rejected before being used in filesystem paths.
- **Security (SECURITY-AUDIT-2026-08.md F4):** filesystem search passes `-e <query>` plus `--` separators to `rg` so queries starting with `-` can no longer inject flags such as `--pre`.
- **Security (SECURITY-AUDIT-2026-08.md F6):** memory API now requires bearer auth (`DASHBOARD_AUTH_TOKEN`, server refuses to start without it), validates `Host`/`Origin` against loopback allowlists, requires `Content-Type: application/json` on mutating routes, and applies `validateMemoryPath` on every write path including `PUT /api/memory/file/:name`.
- **Security (SECURITY-AUDIT-2026-08.md F7):** task-server SSE authentication prefers the `Authorization: Bearer` header; `?token=` remains only a documented legacy fallback for `EventSource` clients, and request log lines strip query strings so the token never reaches logs.
- **Security (SECURITY-AUDIT-2026-08.md F8):** task-server honors the `HOST` environment variable in `listen()` (default `127.0.0.1`, matching the documented default), refuses non-loopback binds when serving without authentication (`REQUIRE_AUTH=false`), reports the real bind address at startup, and `start-server.sh` now uses the same `change-me` placeholder as `.env.example`.

## [2.0.0-rc.4] – 2026-03-23

### Added
- **Explorer → Notepad desktop flow**: Explorer can open files directly in Notepad from the desktop shell, and Notepad now exposes a visible Save button with in-flight save state.
- **Read-only JSON snapshot fallback**: When PostgreSQL is unavailable, the dashboard now boots against `workspace/data/asana-db.json` for projects, tasks, board, timeline, stats, and audit reads instead of failing hard.
- **Regression coverage for desktop file editing and storage fallback**: Added focused tests for filesystem routing, gateway health snapshot usage, and JSON snapshot storage behavior.

### Changed
- **Filesystem API routing moved in-process**: Desktop `/api/fs/*` requests now use a shared in-process filesystem handler instead of a second localhost proxy hop, improving Explorer/Notepad save, open, and delete reliability.
- **Health reporting now exposes degraded storage mode**: `/api/health` and `/api/health-status` now distinguish between full PostgreSQL mode and read-only snapshot mode so the shell can stay usable during database outages.
- **Gateway health checks now use cached status**: `/api/health-status` reads `gateway-status.json` instead of invoking `openclaw gateway status`, avoiding repeated false-positive gateway conflict warnings in logs.

### Fixed
- **Notepad save path failures**: Fixed save failures caused by CORS checks, forwarded browser transport headers, drained request bodies, and aborted proxy hops.
- **Explorer file opening**: Fixed the shell wiring that prevented Explorer's "Open in Notepad" action from opening or focusing the Notepad window.
- **Filesystem sidecar instability**: Fixed restart and availability handling so dead PID files and missing sidecar processes no longer break Explorer delete/save flows.
- **Dashboard startup degradation on missing PostgreSQL**: Fixed the raw `{"error":"Asana storage not initialized"}` boot failure by falling back to read-only snapshot storage when `openclaw_dashboard` is unavailable.

## [1.0.0-rc.2] – 2026-03-21

### Added
- **Windows 11-style Desktop Shell**: Complete webOS with taskbar, start menu, window manager, draggable/resizable windows, theme toggle (dark/light), system tray clock, and keyboard shortcuts.
- **Native View System**: Operations, Agents, Tasks, Workflows, Health, Approvals, Memory, and Departments views — all render natively inside desktop windows (no iframes).
- **Widget System**: Extensible widget framework with panel, card, and inline variants. Includes department status, MOTD, and health status widgets with a registry for custom widget creation.
- **Approval Workflow UI**: Cards with Approve/Reject actions, notes, agent status tracking, Execute button for approved runs, details panel for completed runs, and follow-up prompt injection. Added delete/dismiss with confirmation for all approval states.
- **Gateway Workflow Dispatcher**: Spawns sub-agents via `sessions_spawn` to execute approved workflow runs, with session tracking and heartbeat monitoring.
- **System Improvement Scanner**: Daily automated scan (6 categories: artifact contracts, workflow health, cron health, site health, template coverage, approval gaps) with 20h dedup and approval-gated workflow creation.
- **Workflow Run Lifecycle**: Input validation, timeout handling, session cleanup, queued→running state transitions, and run artifact management.
- **Playwright E2E Test Suite**: 33 tests covering desktop shell, start menu, window manager, native views, keyboard shortcuts, and error handling.

### Changed
- **Full desktop webOS replaces legacy dashboard**: The monolithic single-page dashboard is gone. The shell, views, and widgets are modular ES6 imports.
- **Approvals view simplified**: Removed escalate, 5-filter dropdown, dense metadata grid, overdue badges. Streamlined to title→description→status→actions. Default filter shows only active items.
- **Artifact contract enforcement**: POST `/api/workflow-templates` auto-injects artifact contracts; `createRun` backfills templates missing contracts.
- **21→29 workflow templates** updated with complete artifact contracts including URL fields for auto-extraction.

### Removed
- Legacy dashboard HTML, backup files, and monolithic integration module.
- Benchmark labs, download-gcode.php, and stale backup artifacts from earlier versions.
- `_legacy-archive/` directory excluded from repo (still available locally).

### Security
- Removed hardcoded database passwords from all source files. PostgreSQL credentials now require `POSTGRES_PASSWORD` environment variable.
- Replaced internal IP addresses in `models-catalog.json` with `localhost` placeholder.
- Runtime state files (`gateway-status.json`, `task-server.pid`) excluded from version control.
- Backup files (`*.bak`, `*.backup`) excluded from version control.

## [1.2.0-rc.1] – 2026-02-28

### Added
- **Frontend-Database Sync Phase 1**: Real-time sync between IndexedDB and PostgreSQL backend with conflict resolution.
- **Memory Query System**: Semantic vector search with local CPU embeddings (all-MiniLM-L6-v2), BM25 hybrid search, and auto-tagging.
- **API Contract Shape Tests**: Verification tests for payload consistency between frontend and backend.

## [1.1.1] – 2026-02-16

### Fixed
- Task edit/toggle 400 errors caused by incorrect sync payload schema.
- Server startup path issues after directory consolidation.
- Duplicate history assignment in PATCH operations.

## [1.1.0] – 2026-02-15

### Added
- Keyboard shortcuts help modal (`?` key) with focus trapping and ARIA attributes.
- Performance monitor panel (`Ctrl+Shift+P` or `#perf`).
- Enhanced toolbar filters: My tasks, Overdue, Blocked, No due date.
- Board View integration with lazy loading.
- Agent View for task queue monitoring with claim/release actions.
- Dashboard health monitoring via cron (`scripts/dashboard-health.sh`).
- Expanded task edit form with status, priority, owner, dates.
- Debounced autosave with backup rotation and corruption recovery.
- Cron Job visibility and management view.

### Improved
- Modular ES6 frontend architecture (replaced 1663-line inline script).
- Persistent sync error banner with retry capability.
- Dashboard UI accessibility: skip links, ARIA labels, focus management.
