# OpenClaw WebOS Improvement Plan — Progress Tracker

**Updated:** 2026-04-28
**Source analysis:** `docs/SPACE_AGENT_ANALYSIS.md`

This plan was refined by Codex against the actual WebOS codebase. Each item has a checkbox for tracking progress. Update the file as work proceeds.

---

## Overall Progress

| Phase | Items | Done | Status |
|-------|-------|------|--------|
| P0 — Doc Corrections | 5 | 5/5 | ✅ Done |
| P0 — Quick Wins | 7 | 7/7 | ✅ Done |
| P0 — Hierarchical Docs | 1 | 1/1 | ✅ Done |
| P1 — Features | 4 | 0/4 | 🔲 Not started |
| P2 — Features | 2 | 0/2 | 🔲 Not started |
| P3 — Deferred | 2 | — | ⏸️ On hold |

---

## P0: Documentation Corrections

> Every feature below depends on accurate references. Fix these first.

- [x] **DOC-1:** Fix `README.md` — says 23 apps and 17 widgets, source has 25 apps and 18 widgets
- [x] **DOC-2:** Fix `docs/views-reference.md` — missing `sessions`, `bing`, and `settings` apps
- [x] **DOC-3:** Fix `docs/api-reference-complete.md` — memory routes documented as `/api/memory/read` but implemented as `/api/memory/file/:name`; filesystem routes documented as `/api/fs/ls` but implemented as `/api/fs/list`, `/api/fs/file`, `/api/fs/path`
- [x] **DOC-4:** Fix `docs/shell-architecture.md` — describes `RealtimeSync.subscribe('key', cb)` but implementation is `subscribe(callback)` with `(data, changedKeys)`
- [x] **DOC-5:** Fix `docs/offline-reference.md` — says conflict default is server-wins, but `SyncManager.resolveConflict()` defaults to `client-wins`

---

## P0: Quick Wins

> Small changes with outsized impact. Most are one-line fixes.

- [x] **QW-1:** Enable SSE — import and call `connectSSE()` in `src/shell/shell-main.mjs` after `sync.start()`
- [x] **QW-2:** Fix `SyncManager.syncAll()` — fetches `/api/tasks` (legacy) instead of `/api/tasks/all`
- [x] **QW-3:** Add `/api/auth/self` — returns `{ mode: 'token', actor: 'dashboard-operator', role: 'operator' }`
- [x] **QW-4:** Add `api.memory` helpers to `src/shell/api-client.mjs` — stop views from open-coding fetches
- [x] **QW-5:** Add `api.settings`, `api.sessions`, `api.chat` helpers to `src/shell/api-client.mjs`
- [x] **QW-6:** Replace absolute memory API calls in `memory-view.mjs` — use same-origin `/api/memory/*` after adding proxy route
- [x] **QW-7:** Add `scripts/docs-drift-check.js` and wire into `npm run validate`

---

## P0: Hierarchical Documentation Ownership

> Every source directory that owns code also owns a documentation contract.

- [x] **HIER-1:** Create root `AGENTS.md` — project-wide constraints (no build step, vanilla JS, route registration, migration rules)
- [x] **HIER-2:** Create `src/shell/AGENTS.md` — shell module contracts
- [x] **HIER-3:** Create `src/shell/native-views/AGENTS.md` — view conventions and registry
- [x] **HIER-4:** Create `src/shell/widgets/AGENTS.md` — widget system contracts
- [x] **HIER-5:** Create `src/offline/AGENTS.md` — offline layer contracts
- [x] **HIER-6:** Create `routes/AGENTS.md` — route conventions
- [x] **HIER-7:** Create `storage/AGENTS.md` — storage layer contracts
- [x] **HIER-8:** Create `schema/AGENTS.md` — migration rules
- [x] **HIER-9:** Create `scripts/AGENTS.md` — operational script contracts
- [x] **HIER-10:** Update `README.md` and `DEVELOPER_GUIDE.md` to reference the hierarchy

---

## P1: Persistent Agent Memory System

> **Status:** Partially implemented — server and view exist, needs route normalization and new endpoints

**Current infrastructure:**
- `memory-api-server.mjs` on port 3879: list, read, write, search, facts, status, stats
- `src/shell/native-views/memory-view.mjs`: file browser, editor, search, facts

- [x] **MEM-1:** Add `routes/memory-routes.js` — proxy `/api/memory/*` through `task-server.js`
- [x] **MEM-2:** Add `POST /api/memory/file/:name` — create new `.md` file
- [x] **MEM-3:** Add `POST /api/memory/file/:name/append` — append to existing file
- [x] **MEM-4:** Add `DELETE /api/memory/file/:name` — delete memory file
- [x] **MEM-5:** Add `GET /api/memory/context` — assembled prompt context for agent injection
- [x] **MEM-6:** Add `validateMemoryPath(name)` — safe subpath handling
- [x] **MEM-7:** Update `memory-view.mjs` — use `api.memory` instead of absolute `http://127.0.0.1:3879`
- [x] **MEM-8:** Update `memory-view.mjs` — add create, append, delete actions with confirmation
- [x] **MEM-9:** Update `memory-view.mjs` — add context preview tab
- [x] **MEM-10:** Update `docs/api-reference-complete.md` with actual memory routes
- [x] **MEM-11:** Add `docs/memory-system.md`

**Complexity:** M | **Dependencies:** DOC corrections, QW-4

---

## P1: Optimistic UI Updates

> **Status:** Partially implemented — offline queue exists for tasks, needs to cover all mutations

**Current infrastructure:**
- `src/offline/state-manager.mjs` — optimistic task CRUD
- `src/offline/sync-manager.mjs` — create/update/delete/archive/restore queue
- `board-view.mjs` already does optimistic status moves

- [x] **OPT-1:** Create `src/shell/mutation-manager.mjs` — `mutate({ key, optimisticApply, request, rollback, onSuccess })`
- [x] **OPT-2:** Update `sync-manager.mjs` — generic queue items with `{ method, url, body, entityType }`
- [x] **OPT-3:** Fix `SyncManager.syncAll()` — use `/api/tasks/all` (also tracked as QW-2)
- [x] **OPT-4:** Set intentional conflict default — document whether server-wins or client-wins
- [x] **OPT-5:** Add bearer token headers to sync manager requests
- [x] **OPT-6:** Update `offline-ui.mjs` — show generic pending operation counts
- [x] **OPT-7:** Migrate `tasks-view.mjs` — create/update/move/archive/delete
- [ ] **OPT-8:** Migrate `board-view.mjs` — replace local optimistic code with MutationManager
- [ ] **OPT-9:** Migrate `approvals-view.mjs` — approve/reject/escalate
- [ ] **OPT-10:** Migrate `workflows-view.mjs` — start/pause/resume/cancel

**Complexity:** M | **Dependencies:** DOC corrections, QW-2

---

## P1: Time Travel / History

> **Status:** New — partial audit/history foundation exists

**Current infrastructure:**
- `audit_log` table and `getAuditLog()` in `asana.js`
- `audit-view.mjs` renders audit data
- Task history JSONB on dependency changes

- [ ] **TT-1:** Add migration `schema/migrations/022_add_history_snapshots.sql` — `state_snapshots` table
- [ ] **TT-2:** Make `audit_log.task_id` nullable — add `entity_type`, `entity_id`, `correlation_id`
- [ ] **TT-3:** Extend `storage/asana.js` — `recordStateSnapshot()`, `listHistory()`, `getHistoryDiff()`, `previewRevert()`, `revertSnapshot()`
- [ ] **TT-4:** Add `routes/history-routes.js` — `GET /api/history`, `GET /api/history/:id/diff`, `POST /api/history/:id/preview-revert`, `POST /api/history/:id/revert`
- [ ] **TT-5:** Instrument `task-routes.js` — snapshot on create/update/delete/archive/restore/move/retry
- [ ] **TT-6:** Instrument `project-routes.js` — snapshot on create/update/delete
- [ ] **TT-7:** Instrument `view-routes.js` — snapshot on saved view create/update/delete
- [ ] **TT-8:** Instrument `settings-routes.js` — snapshot on key/category/import writes
- [ ] **TT-9:** Instrument `workflow-runs-api.js` — snapshot on pause/resume/cancel/approval actions
- [ ] **TT-10:** Add `api.history` methods in `api-client.mjs`
- [ ] **TT-11:** Create `src/shell/native-views/history-view.mjs` — two-pane history/diff UI
- [ ] **TT-12:** Register `history` in `app-registry.mjs`
- [ ] **TT-13:** Update `docs/schema-reference.md`, `docs/api-reference-complete.md`, `docs/views-reference.md`

**Complexity:** L | **Dependencies:** DOC corrections

---

## P1: Local Export/Import Bundle

> **Status:** Partially implemented — settings export/import exists, `exportData()`/`importData()` in asana.js unused

- [x] **EXP-1:** Create `lib/export-bundle.js` — `buildExportBundle()`, `validateImportBundle()`, `previewImportBundle()`
- [x] **EXP-2:** Add `routes/export-routes.js` — `GET /api/export?scope=`, `POST /api/import/preview`, `POST /api/import`
- [x] **EXP-3:** Extend `storage/asana.js` — additive upsert methods (not destructive `importData()`)
- [x] **EXP-4:** Add import preview UI to `settings-view.mjs`
- [ ] **EXP-5:** Add audit/history entries for import operations
- [ ] **EXP-6:** Update docs

**Complexity:** M | **Dependencies:** Time Travel (for rollback), DOC corrections

---

## P2: Spaces / Workspaces

> **Status:** New — partial layout/filter foundations exist

- [ ] **SPC-1:** Add migration `023_add_spaces.sql`
- [ ] **SPC-2:** Extend `storage/asana.js` — space CRUD
- [ ] **SPC-3:** Add `routes/space-routes.js`
- [ ] **SPC-4:** Add `api.spaces` in `api-client.mjs`
- [ ] **SPC-5:** Update `shell-main.mjs` — `activeSpaceId` in ViewState, `applySpace()`
- [ ] **SPC-6:** Update `WindowManager` — per-space storage keys
- [ ] **SPC-7:** Update `WidgetPanel` — per-space layout storage
- [ ] **SPC-8:** Update `Taskbar` — space switcher
- [ ] **SPC-9:** Create `spaces-view.mjs` — create/edit/duplicate/delete
- [ ] **SPC-10:** Register in `app-registry.mjs`
- [ ] **SPC-11:** Update docs

**Complexity:** L | **Dependencies:** Memory system (for agent instructions per space)

---

## P2: Dashboard Agent Chat

> **Status:** Partially implemented — session chat exists, needs dashboard context and safe actions

- [ ] **AGT-1:** Enable SSE in `shell-main.mjs` (also QW-1)
- [ ] **AGT-2:** Create `src/shell/agent-context.mjs` — `buildDashboardContext()`
- [ ] **AGT-3:** Add `POST /api/agent/chat` — dashboard-scoped chat with context
- [ ] **AGT-4:** Create `src/shell/agent-actions.mjs` — read-only actions first, then confirmed writes
- [ ] **AGT-5:** Create agent chat panel (docked sidebar or floating panel)
- [ ] **AGT-6:** Wire confirmed writes through `api-client` with actor `dashboard-agent`

**Complexity:** L | **Dependencies:** Memory system, SSE enablement

---

## P3: Deferred

> These are valid ideas but not priorities right now.

### Multi-User Auth (P3)
- [ ] Token-mode hardening: document auth env vars, add `/api/auth/self`
- [ ] Full auth deferred until multi-operator requirement exists
- **Complexity:** L for full auth | S for token hardening

### Desktop App Packaging (P3)
- [ ] Defer until service lifecycle and token auth are cleaned up
- **Complexity:** M for local, L for cross-platform signed

---

## Features Dropped

- ❌ Git hard reset for DB state — use DB snapshots instead
- ❌ API handler auto-discovery — explicit route ordering is safer

---

## New Ideas (Not Yet Scheduled)

These were discovered by Codex from the actual codebase. Schedule when capacity allows.

- [ ] **Notification Center** — taskbar bell → panel with blockers, approvals, workflow events, SSE
- [ ] **Route Catalog View** — auto-generated API inventory from `routes/*` for operators
- [ ] **Workflow Routing Admin** — UI for `workflow_agent_routing` table
- [ ] **Memory Safety Guard** — wire `src/security` scrubbing into memory API writes
- [ ] **Docs Drift Widget** — widget showing whether docs match source counts
- [ ] **Dispatcher Live Feed** — SSE from `GatewayWorkflowDispatcherV2` → workflows view

---

## Change Log

| Date | Change |
|------|--------|
| 2026-04-28 | Initial plan created by Codex from SPACE_AGENT_ANALYSIS.md + codebase audit |
| 2026-04-28 | Converted to progress tracker with checkboxes |
