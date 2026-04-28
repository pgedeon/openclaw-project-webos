# OpenClaw WebOS Improvement Plan

Updated: 2026-04-28

This plan refines `docs/SPACE_AGENT_ANALYSIS.md` against the current OpenClaw WebOS codebase. The original plan is directionally useful, but several proposed features are already partly present: memory browsing/editing, session chat, SSE push updates, widget resizing, saved views, token auth, governance helpers, settings export/import, filesystem browsing, and optimistic board moves.

## Current Infrastructure Summary

- Shell entry: `src/shell/shell-main.mjs` wires `WindowManager`, `Taskbar`, `StartMenu`, `ViewAdapter`, `ViewState`, `RealtimeSync`, `WidgetRegistry`, and `WidgetPanel`.
- App registry: `src/shell/app-registry.mjs` has 25 registered apps, including undocumented `sessions`, `bing`, and `settings`.
- Widgets: `src/shell/widgets/widget-registry.mjs` manually indexes 18 widgets. `WidgetPanel` already supports add/remove, drag ordering, panel position, and per-widget size overrides in localStorage.
- Realtime: `src/shell/realtime-sync.mjs` polls seven sources and also has SSE support via `connectSSE()`, but `shell-main.mjs` does not call `connectSSE()`.
- API routing: `task-server.js` now delegates many routes to `routes/*`, plus inline handlers for org, metrics, service requests, catalog, workflow runs, diagnostics, and `/api/fs/*`.
- Auth: `task-server.js` enforces a single `DASHBOARD_AUTH_TOKEN` bearer token for `/api/*` except `/api/health`; this is not multi-user auth.
- Storage: `storage/asana.js` owns PostgreSQL CRUD, saved views, export/import helpers, org/service APIs, task history fields, and audit integration.
- Offline: `src/offline/*` provides IndexedDB state, task mutation queue, and conflict handling, but most current native views call `api`/`fetch` directly instead of using `StateManager`.
- Memory: `memory-api-server.mjs` and `src/shell/native-views/memory-view.mjs` already provide memory file browsing, facts, search, status, stats, and editing of existing files.
- Agent chat: `routes/session-routes.js`, `routes/chat-routes.js`, `routes/sse-routes.js`, `lib/gateway-client`, and `src/shell/native-views/sessions-view.mjs` already provide session browsing plus streaming chat into existing OpenClaw sessions.

## Documentation Corrections To Make First

- `README.md` says 23 apps and 17 widgets, but source has 25 app registry entries and 18 widgets.
- `docs/views-reference.md` documents 23 apps and omits `sessions`, `bing`, and `settings`.
- `docs/api-reference-complete.md` documents older memory and filesystem routes (`/api/memory/read`, `/api/fs/ls`) that differ from implemented routes (`/api/memory/file/:name`, `/api/fs/list`, `/api/fs/file`, `/api/fs/path`).
- `docs/shell-architecture.md` describes `RealtimeSync.subscribe('key', cb)`, but the implementation accepts `subscribe(callback)` with `(data, changedKeys)`.
- `docs/offline-reference.md` says conflict default is server-wins, but `SyncManager.resolveConflict()` defaults to `client-wins`.

These should be treated as a P0 quick win because every feature below depends on accurate references.

## Feature 1: Time Travel / History

**Status:** New, with partial audit/history foundation

**Current Infrastructure:**
- `routes/task-routes.js` exposes `GET /api/tasks/:id/history`, backed by `asanaStorage.getAuditLog(taskId, 100)`.
- `storage/asana.js` writes `audit_log` and appends task `history` JSONB when dependency auto-blocking happens.
- `workflow-runs-api.js` logs governance/workflow actions into `audit_log`.
- `routes/settings-routes.js` has `GET /api/settings/changelog` for settings changes.
- `src/shell/native-views/audit-view.mjs` already renders audit data.

**Gap Analysis:**
- No global history API across tasks, workflows, settings, filesystem, and configuration.
- No snapshot table, diff model, revert preview, or reversible transaction layer.
- Git-backed hard reset is unrealistic for PostgreSQL state and unsafe for workflow runs. Use audit-backed rollback and optional Git history only for filesystem/custom docs.
- `audit_log.task_id` is `NOT NULL`, which makes non-task audit entries awkward. Workflow code appears to work around this, but a general history feature needs entity-level audit fields.

**Implementation Plan:**
- Add migration `schema/migrations/022_add_history_snapshots.sql`:
  - Add `state_snapshots(id, scope, entity_type, entity_id, actor, action, before_state, after_state, diff, correlation_id, snapshot_at, revert_of_snapshot_id)`.
  - Add nullable `entity_type`, `entity_id`, `correlation_id` to `audit_log` if feasible without breaking existing queries.
- Update `docs/schema-reference.md` after migration.
- Extend `storage/asana.js`:
  - Add `recordStateSnapshot({ scope, entityType, entityId, actor, action, beforeState, afterState, correlationId })`.
  - Add `listHistory({ scope, entityType, entityId, limit, offset })`.
  - Add `getHistoryDiff(snapshotId)`.
  - Add `previewRevert(snapshotId)`.
  - Add `revertSnapshot(snapshotId, actor)` for reversible task/project/saved-view/settings records only.
- Add `routes/history-routes.js` and register it in `task-server.js`:
  - `GET /api/history`
  - `GET /api/history/:id/diff`
  - `POST /api/history/:id/preview-revert`
  - `POST /api/history/:id/revert`
- Instrument existing mutation routes:
  - `routes/task-routes.js`: create/update/delete/archive/restore/move/retry.
  - `routes/project-routes.js`: create/update/delete.
  - `routes/view-routes.js`: saved view create/update/delete.
  - `routes/settings-routes.js`: key/category/import writes.
  - `workflow-runs-api.js`: pause/resume/cancel/reassign/escalate/override/approval actions.
- Add client API methods in `src/shell/api-client.mjs` under `history`.
- Add view `src/shell/native-views/history-view.mjs` and registry entry in `src/shell/app-registry.mjs`.
- Reuse `src/shell/native-views/audit-view.mjs` patterns for filtering, but build a two-pane history/diff UI.
- Offline behavior: cache history list in `apiCache`; disable revert while offline.

**Dependencies:** Documentation correction P0. No dependency on spaces or auth.

**Estimated Complexity:** L. PostgreSQL-safe revert needs transactional before/after snapshots, entity-level audit changes, and careful exclusions for irreversible workflow side effects.

## Feature 2: Hierarchical Documentation Ownership

**Status:** New

**Current Infrastructure:**
- Strong flat docs already exist in `docs/`.
- No `AGENTS.md` files exist in this repo.
- Source directories are cleanly bounded: `src/shell`, `src/shell/native-views`, `src/shell/widgets`, `src/offline`, `routes`, `storage`, `schema`, `scripts`, `lib`.

**Gap Analysis:**
- Developers must infer local contracts from scattered reference docs.
- Docs drift is already visible between source and `README.md`, `views-reference.md`, `widget-catalog.md`, and API references.

**Implementation Plan:**
- Create root `AGENTS.md` with project-wide constraints: no build step, vanilla JS modules, route registration rules, migration rules, auth/security rules.
- Create directory docs:
  - `src/shell/AGENTS.md`
  - `src/shell/native-views/AGENTS.md`
  - `src/shell/widgets/AGENTS.md`
  - `src/offline/AGENTS.md`
  - `routes/AGENTS.md`
  - `storage/AGENTS.md`
  - `schema/AGENTS.md`
  - `scripts/AGENTS.md`
- Add `scripts/docs-drift-check.js`:
  - Compare `APP_REGISTRY` count to `docs/views-reference.md`.
  - Compare `WIDGET_INDEX` count to `docs/widget-catalog.md`.
  - Grep implemented route patterns and report missing docs entries.
- Add `npm run docs:check` in `package.json`.
- Update `README.md` and `DEVELOPER_GUIDE.md` to require contract updates with code changes.

**Dependencies:** None.

**Estimated Complexity:** S. Most work is documentation plus one small validation script.

## Feature 3: Persistent Agent Memory System

**Status:** Partially Implemented

**Current Infrastructure:**
- `memory-api-server.mjs` exposes:
  - `GET /api/memory/list`
  - `GET /api/memory/file/:name`
  - `PUT /api/memory/file/:name`
  - `GET /api/memory/root`
  - `GET /api/memory/search?q=`
  - `GET/POST/DELETE /api/memory/facts`
  - `GET /api/memory/facts/list`
  - `GET /api/memory/facts/search`
  - `GET /api/memory/status`
  - `GET /api/memory/stats`
- `src/shell/native-views/memory-view.mjs` already supports file list, read, edit, search, facts, status, stats.
- `src/security/README.md` documents memory secret-scrubbing helpers.

**Gap Analysis:**
- Original proposed endpoints do not match implementation.
- No `POST /api/memory/append`, `DELETE /api/memory/file/:name`, create-new-file endpoint, or assembled prompt context endpoint.
- Memory API is a separate port and not proxied through `task-server.js`, so dashboard token auth and same-origin API conventions are inconsistent.
- No visible integration from memory into session chat prompts or workflow launch context.
- Writes only update existing files and use `basename`, which prevents subdirectory files.

**Implementation Plan:**
- Keep existing route names. Do not replace them with the old proposal's names.
- Add in `memory-api-server.mjs`:
  - `POST /api/memory/file/:name` to create a new `.md` file.
  - `POST /api/memory/file/:name/append`.
  - `DELETE /api/memory/file/:name`.
  - `GET /api/memory/context?scope=agent&agent=main&limit=...`.
  - Shared `validateMemoryPath(name)` allowing safe subpaths if needed.
- Add `routes/memory-routes.js` to proxy `/api/memory/*` through `task-server.js` using the local memory handler or HTTP to port 3879.
- Add `api.memory` methods in `src/shell/api-client.mjs`.
- Update `src/shell/native-views/memory-view.mjs`:
  - Use `api.memory` instead of absolute `http://127.0.0.1:3879`.
  - Add create, append, delete actions with confirmation.
  - Add context preview tab.
- Update `routes/chat-routes.js`:
  - Optional `memoryContext` field on `POST /api/oc/chat/send`.
  - For safety, start with read-only context preview, not automatic prompt injection into every session.
- Update docs:
  - `docs/api-reference-complete.md`
  - `docs/views-reference.md`
  - `docs/AGENT_INTEGRATION.md`
  - Add `docs/memory-system.md`.

**Dependencies:** Documentation correction P0. Proxy should come before UI expansion.

**Estimated Complexity:** M. The server and view exist; the main work is route normalization, create/delete/append, auth consistency, and context assembly.

## Feature 4: Spaces / Workspaces

**Status:** New, with partial layout/filter foundations

**Current Infrastructure:**
- Window bounds persist in `WindowManager` under `openclaw.win11.windows.v1`.
- Widget panel persists enabled widgets, size config, layout, and panel position in `src/shell/widgets/widget-panel.mjs`.
- `src/offline/state-manager.mjs` stores `savedViews` and `activeSavedViewId`.
- PostgreSQL `saved_views` table exists, with routes in `routes/view-routes.js`.
- `storage/asana.js` references a `workspaces` table in vNext paths, but the schema reference and migrations in this repo do not define it.

**Gap Analysis:**
- No first-class space entity, active space state, taskbar switcher, or layout scoping.
- Existing widget/window layout keys are global, not per space.
- Saved views are project-scoped filters, not full desktop spaces.
- The old plan's "agent instructions per space" is viable only after memory/chat context is normalized.

**Implementation Plan:**
- Add migration `schema/migrations/023_add_spaces.sql`:
  - `spaces(id, name, icon, color, layout, filters, agent_instructions, created_by, created_at, updated_at)`.
  - Avoid `owner`/multi-user fields until real auth exists; use `created_by` string.
- Extend `storage/asana.js`:
  - `listSpaces()`, `getSpace(id)`, `createSpace(data)`, `updateSpace(id, data)`, `deleteSpace(id)`, `duplicateSpace(id)`.
- Add `routes/space-routes.js`:
  - `GET/POST /api/spaces`
  - `GET/PATCH/DELETE /api/spaces/:id`
  - `POST /api/spaces/:id/duplicate`
- Add `api.spaces` in `src/shell/api-client.mjs`.
- Update shell state:
  - In `src/shell/shell-main.mjs`, keep `activeSpaceId` in `ViewState` and localStorage.
  - Add `applySpace(space)` to update project/filter state, open pinned apps, and restore widget/window layout.
- Update `WindowManager`:
  - Add optional storage namespace or `storageKeyForSpace(spaceId)`.
- Update `WidgetPanel`:
  - Add storage namespace for `PANEL_STORAGE_KEY`, `DESKTOP_LAYOUT_STORAGE_KEY`, `PANEL_POSITION_STORAGE_KEY`.
- Update `Taskbar`:
  - Add compact space switcher near the tray or start section.
- Add `src/shell/native-views/spaces-view.mjs` for create/edit/duplicate/delete.
- Register `spaces` in `src/shell/app-registry.mjs`.

**Dependencies:** Memory context proxy for agent instructions is optional. Documentation correction should happen first.

**Estimated Complexity:** L. Layout state is scattered across localStorage keys and shell modules, and the DB/entity model is new.

## Feature 5: Agent-as-Capability / In-Browser Agent

**Status:** Partially Implemented

**Current Infrastructure:**
- `routes/session-routes.js` lists agents/sessions and reads session JSONL history.
- `routes/chat-routes.js` exposes `POST /api/oc/chat/send`, `POST /api/oc/chat/abort`, and `GET /api/oc/chat/status`.
- `routes/sse-routes.js` streams chat deltas/finals/errors.
- `src/shell/native-views/sessions-view.mjs` already has a session browser and streaming chat input.
- `src/shell/realtime-sync.mjs` has `connectSSE()`, but `shell-main.mjs` does not call it.
- Governance exists in `governance.js`, and workflow actions log audit events.

**Gap Analysis:**
- Existing chat is tied to existing sessions; it is not a global assistant panel with dashboard context.
- No safe action planner, action confirmation UI, or API allowlist for agent-initiated dashboard actions.
- No use of active view, selected task, current filters, or memory context in chat payloads.
- `sessions-view.mjs` uses direct `fetch` helpers instead of `api-client`.

**Implementation Plan:**
- First, make SSE active:
  - Import and call `connectSSE()` in `src/shell/shell-main.mjs` after `sync.start()`.
  - Add `workflow:changed` broadcasts in `workflow-runs-api.js` for create/update/actions where missing.
- Add `src/shell/agent-context.mjs`:
  - `buildDashboardContext({ sync, viewState, windowManager })`.
  - Include active app, project, selected task/run ids, stats, blockers, approvals, active workflows.
- Extend `routes/chat-routes.js`:
  - `POST /api/agent/chat` for a dashboard-scoped chat turn.
  - Reuse `gatewayClient.chatSend()` internally, but create or target a dashboard assistant session.
  - Accept `context`, `memoryContext`, and `allowedActions`.
- Add `src/shell/agent-actions.mjs`:
  - Define read-only actions first: `tasks.list`, `tasks.get`, `workflows.list`, `health.status`, `memory.search`.
  - Define mutation actions later with confirmation: `tasks.create`, `tasks.update`, `approvals.decide`, `workflows.action`.
- Add `src/shell/native-views/agent-chat-view.mjs` or docked panel module:
  - Use right-side panel, not a full marketing screen.
  - Show proposed actions as confirmable buttons before write calls.
- Audit writes:
  - Route all confirmed write actions through existing `api-client` methods.
  - Include actor `dashboard-agent` and correlation id.

**Dependencies:** Memory context proxy and history snapshots should precede write-capable actions.

**Estimated Complexity:** L. Chat transport exists, but safe dashboard actions and context-aware UX are substantial.

## Feature 6: Deterministic Extension / Plugin Discovery

**Status:** Partially Implemented

**Current Infrastructure:**
- `app-registry.mjs` provides a deterministic app registry, lazy `viewModule` imports, category ordering, and pinned app ids.
- `WidgetRegistry` dynamically imports widget modules from a manual `WIDGET_INDEX` and validates manifests.
- `ViewAdapter.resolveRenderFunction()` already supports default exports, named render functions, and `renderX` functions.
- Routes are more modular than before via `routes/*` and `Router`.

**Gap Analysis:**
- New views and widgets still require manual registry edits.
- API route modules require manual import/register in `task-server.js`.
- Browser ES modules cannot scan directories at runtime without a manifest generated by Node or a build step.
- The original "no manual registration files" conflicts with the no-build-step browser architecture unless a server-generated manifest is introduced.

**Implementation Plan:**
- Prefer manifest generation, not runtime filesystem scanning in the browser.
- Add `scripts/generate-shell-manifests.js`:
  - Scan `src/shell/native-views/*-view.mjs` for exported `manifest` objects.
  - Scan `src/shell/widgets/widgets/*.mjs` for `manifest`.
  - Write `src/shell/generated/app-manifest.mjs` and `src/shell/generated/widget-manifest.mjs`.
- Update `app-registry.mjs`:
  - Import generated app manifest.
  - Keep explicit `PINNED_APP_IDS` and icon mapping for shell-critical apps.
- Update widget registry:
  - Import generated widget index by default.
  - Preserve constructor override for tests.
- Add `routes/manifest-routes.js`:
  - `GET /api/shell/apps`
  - `GET /api/shell/widgets`
- Add `npm run manifests` and include it in validation scripts.
- Defer API route auto-mounting. Keep explicit `registerXRoutes()` calls because route ordering matters (`/api/views/board` must precede `/api/views/:id`).

**Dependencies:** Hierarchical docs should define manifest contracts first.

**Estimated Complexity:** M. View/widget manifests are straightforward; API auto-discovery should be deferred to avoid route ordering bugs.

## Feature 7: Optimistic UI Updates

**Status:** Partially Implemented

**Current Infrastructure:**
- `src/offline/state-manager.mjs` performs optimistic local task CRUD and queues operations.
- `src/offline/sync-manager.mjs` queues create/update/delete/archive/restore and retries.
- `src/shell/native-views/board-view.mjs` already does optimistic status moves and reloads on failure.
- `src/shell/native-views/sessions-view.mjs` optimistically appends the user's chat message.

**Gap Analysis:**
- Most native views bypass `StateManager` and call `api`/`fetch` directly.
- Offline queue only targets `/api/tasks`; approvals, workflows, cron, settings, service requests, and saved views are not queued.
- `SyncManager.syncAll()` fetches `/api/tasks`, which is the legacy markdown endpoint, not `/api/tasks/all`.
- Conflict default differs between docs and implementation.
- No shared rollback/notice helper for optimistic mutations.

**Implementation Plan:**
- Add `src/shell/mutation-manager.mjs`:
  - `mutate({ key, optimisticApply, request, rollback, onSuccess, entityType, entityId })`.
  - Integrate with `ViewState` and `RealtimeSync.refresh(true)`.
- Update `src/offline/sync-manager.mjs`:
  - Support generic queue items with `{ method, url, body, entityType, entityId }`.
  - Fix task list refresh to `/api/tasks/all`.
  - Set conflict default intentionally; recommend `server-wins` unless user explicitly chooses client.
  - Add bearer token headers.
- Update `src/offline/offline-ui.mjs` to show generic pending operation counts.
- Migrate in order:
  - `tasks-view.mjs`: create/update/move/archive/delete.
  - `board-view.mjs`: replace local custom optimistic code with `MutationManager`.
  - `approvals-view.mjs`: approve/reject/escalate.
  - `workflows-view.mjs`: start/pause/resume/cancel.
  - `operations-view.mjs` and `cron-view.mjs`: run job and cron admin actions, but do not queue destructive cron edits until server supports idempotency.
- Add tests:
  - Unit-style tests for `SyncManager.executeOperation()` mappings.
  - Playwright flow for board move failure rollback.

**Dependencies:** History snapshots improve rollback auditing but are not required for UI optimism.

**Estimated Complexity:** M. The task foundation exists; broadening it safely across views is the work.

## Feature 8: Multi-User Support With Role-Based Access

**Status:** Partially Implemented, but original full auth should be deferred

**Current Infrastructure:**
- `task-server.js` has bearer token auth via `DASHBOARD_AUTH_TOKEN`.
- `governance.js` has role/capability rules for workflow actions.
- `workflow-runs-api.js` uses governance checks for workflow control actions.
- `agent_profiles` table models agent roles/capabilities, not human users.
- Audit routes can filter actor/action.

**Gap Analysis:**
- No users table, sessions, password hashing, CSRF protection, login UI, or per-user isolation.
- Governance is action authorization for agents/operators, not authenticated user RBAC.
- Current single-token auth is acceptable for local/operator deployment and simpler than full sessions.

**Implementation Plan:**
- Defer full username/password auth until the product needs multiple human operators.
- Short-term hardening:
  - Document `DASHBOARD_AUTH_TOKEN`, `REQUIRE_AUTH`, `OPENCLAW_GATEWAY_*` in `docs/configuration-reference.md` and `.env.example`.
  - Add `GET /api/auth/self` returning `{ mode: 'token', actor: 'dashboard-operator', role: 'operator' }`.
  - Add `src/shell/native-views/settings-view.mjs` status panel for auth mode.
  - Standardize actor extraction helper in `task-server.js` or `routes/auth-context.js`.
- Full auth later:
  - Add `users`, `sessions`, `user_roles` tables.
  - Add `routes/auth-routes.js`.
  - Add login screen before shell bootstrap.
  - Update all mutations to use authenticated actor in audit/history.
  - Add CSRF token for cookie sessions or keep bearer-only API.

**Dependencies:** History snapshots should come before full auth so user actors are captured consistently.

**Estimated Complexity:** L for full auth; S for token-mode hardening. Recommendation: do token-mode hardening now, defer full auth.

## Feature 9: Cloud Share / Export-Import

**Status:** Partially Implemented

**Current Infrastructure:**
- `storage/asana.js` has `exportData()` and `importData(data)`, but no routes call them.
- `routes/settings-routes.js` exposes `POST /api/settings/export` and `POST /api/settings/import`.
- `settings-view.mjs` has settings export/import UI.
- `tasks-view.mjs` has client-side visible task JSON/CSV export/import controls.
- `saved_views` exist in DB and routes.

**Gap Analysis:**
- No general `/api/export`, `/api/import`, or import preview.
- `storage.importData()` is destructive: it clears audit, tasks, projects, and workflows.
- Export does not include service catalog, service requests, workflow artifacts, approvals, spaces, settings, cron job files, or widget/window layouts.
- No ZIP packaging or cross-instance compatibility checks.

**Implementation Plan:**
- Add `lib/export-bundle.js`:
  - `buildExportBundle({ scope, storage, settingsStore })`.
  - `validateImportBundle(bundle)`.
  - `previewImportBundle(bundle, storage)`.
- Add `routes/export-routes.js`:
  - `GET /api/export?scope=tasks|projects|workflows|settings|all`
  - `POST /api/import/preview`
  - `POST /api/import`
- Do not use current destructive `storage.importData()` for normal imports.
- Extend `storage/asana.js` with additive upsert methods:
  - `upsertProjectFromImport()`
  - `upsertTaskFromImport()`
  - `upsertWorkflowTemplateFromImport()`
  - `upsertSavedViewFromImport()`
- Add import preview UI to `settings-view.mjs`, not a new app initially.
- Add audit/history entries for import operations.
- Cloud share should remain deferred until there is a hosting target and user auth.

**Dependencies:** History snapshots for rollback. Spaces if exporting spaces.

**Estimated Complexity:** M for local export/import; L for cloud share. Recommendation: implement local bundle export/import first.

## Feature 10: Desktop App Packaging

**Status:** New

**Current Infrastructure:**
- No Electron dependency, main process, packaging config, or CI workflow.
- `package.json` only supports `npm start`, validation, tests, and `npm pack`.
- Servers are separate Node processes: `task-server.js`, `cron-manager-server.mjs`, `memory-api-server.mjs`, `filesystem-api-server.mjs`.

**Gap Analysis:**
- Packaging must manage multiple local services and config files.
- Current auth assumes server binding and bearer token injection into served HTML.
- Electron adds operational complexity without improving the current browser-first local deployment.

**Implementation Plan:**
- Defer until WebOS is stable as a browser app.
- When needed:
  - Add `electron/main.js` to spawn `task-server.js` and optional helper servers.
  - Use `wait-on` or a small polling loop before loading `http://127.0.0.1:3876`.
  - Add secure token generation per launch and inject via environment.
  - Add `electron-builder` config for Windows/macOS/Linux.
  - Add graceful shutdown for child processes.
  - Add docs in `docs/desktop-app-reference.md`.

**Dependencies:** Token-mode auth hardening and service lifecycle cleanup.

**Estimated Complexity:** M to package locally; L for cross-platform signed releases. Recommendation: defer.

## Prioritized Implementation Order

1. P0 - Documentation correction pass: counts, route names, sync API shape, offline conflict default.
2. P0 - Hierarchical `AGENTS.md` contracts and `docs:check`.
3. P0 - Enable SSE in shell and standardize route/API docs for existing sessions, settings, memory, and filesystem.
4. P1 - Memory route proxy plus create/append/delete/context endpoints.
5. P1 - Optimistic mutation manager for tasks and board, then approvals/workflows.
6. P1 - Time Travel history snapshots and history view.
7. P1 - Local export/import bundle with preview.
8. P2 - Spaces as saved desktop layouts.
9. P2 - Dashboard-scoped agent chat with read-only tools, then confirmed write actions.
10. P3 - Full multi-user auth and cloud share.
11. P3 - Electron desktop packaging.

## Quick Wins

- Call `connectSSE()` from `shell-main.mjs` so existing SSE work actually refreshes views after mutations.
- Update docs to include `sessions`, `bing`, `settings`, and 18 widgets.
- Replace absolute memory API usage in `memory-view.mjs` with same-origin `/api/memory/*` after adding a proxy route.
- Add `/api/auth/self` for current auth mode visibility.
- Fix `SyncManager.syncAll()` to fetch `/api/tasks/all` instead of legacy `/api/tasks`.
- Add `api.memory`, `api.settings`, `api.sessions`, and `api.chat` helpers to `src/shell/api-client.mjs` so views stop open-coding authenticated fetches.
- Add `scripts/docs-drift-check.js` and run it in `npm run validate`.

## Features To Defer Or Drop

- Drop Git hard reset for database state. Use Git only for filesystem/custom docs and use DB snapshots for dashboard entities.
- Defer API handler auto-discovery. Explicit route ordering is safer with the current router.
- Defer cloud share until local export/import and auth are mature.
- Defer full multi-user auth until there is a real multi-operator requirement.
- Defer Electron packaging until service lifecycle and token-mode auth are cleaned up.

## New Feature Ideas From The Actual Codebase

- Notification Center: make the taskbar bell open a panel backed by blockers, approvals, workflow runs, and SSE events.
- Route Catalog view: generate a read-only API route inventory from `routes/*` and `workflow-runs-api.js` for operators and docs drift checks.
- Workflow Routing Admin: UI for `workflow_agent_routing` to adjust target agent, priority, concurrency, and timeout.
- Memory Safety Guard: wire `src/security` secret-scrubbing into `memory-api-server.mjs` writes and import flows.
- Docs Drift Widget: small widget showing whether docs match source counts and route manifests.
- Dispatcher Live Feed: add SSE broadcasts from `GatewayWorkflowDispatcherV2` for dispatch/claim/heartbeat/complete events and render them in `workflows-view.mjs`.
