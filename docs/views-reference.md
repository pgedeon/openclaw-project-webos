# Views Reference — All Desktop Windows

The OpenClaw Project WebOS exposes **34 windowed applications** through the desktop shell. Each view is a self-contained module loaded on demand when the user opens its window from the start menu or taskbar.

Views are organized into four categories in the start menu: **Work**, **Operations**, **System**, and **Admin**.

> **Shell chrome, not windows:** the Recent-actions tray (⚡ in the taskbar, one-click actions slice 2) is a taskbar popover sibling of the notification center — deliberately NOT a windowed app, so the app count above stays frozen. See [user-guide.md — One-Click Actions](user-guide.md#one-click-actions--confirmations).

> **Already documented in detail** in [user-guide.md](user-guide.md): Tasks, Board, Timeline, Agent, Audit, and Cron views. These are briefly cross-referenced below but not re-documented.

---

## Table of Contents

### Work
- [Tasks](#tasks) ✓ (see user-guide.md)
- [Board](#board) ✓ (see user-guide.md)
- [Timeline](#timeline) ✓ (see user-guide.md)
- [Agents](#agents) ✓ (see user-guide.md)
- [Sessions](#sessions)
- [Session Replay](#session-replay)
- [Requests](#requests)
- [Publish](#publish)
- [Approvals](#approvals)
- [Artifacts](#artifacts)

### Operations
- [Dependencies](#dependencies)
- [Health](#health)
- [Metrics](#metrics)
- [Runbooks](#runbooks)
- [Memory](#memory)
- [Handoffs](#handoffs)
- [History](#history)
- [Audit](#audit) ✓ (see user-guide.md)
- [Cron](#cron) ✓ (see user-guide.md)
- [Diagnostics](#diagnostics)
- [Mission Control](#mission-control)

### System
- [Spaces](#spaces)
- [Route Catalog](#route-catalog)
- [Workflow Routing](#workflow-routing)
- [Docs Drift](#docs-drift)

### Admin
- [Departments](#departments)
- [Explorer](#explorer)
- [Notepad](#notepad)
- [Skills & Tools](#skills--tools)
- [Workflows](#workflows)
- [Operations](#operations)
- [Bing Webmaster](#bing-webmaster)
- [Settings](#settings)

### Internal
- [Agent Queue](#agent-queue)
- [Support Wrapper](#support-wrapper)
- [Legacy Wrapper](#legacy-wrapper)

---

## Work

### Tasks

**Category:** Work · **ID:** `tasks` · **Default size:** 1080×720

The primary task list view. Fully documented in the [User Guide — List View](user-guide.md#list-view-default).

Owner set/change from the edit form routes through the governed `task.assign` action (`POST /api/actions/execute`, LOW severity → fires immediately with a receipt); unassigning stays on the raw PATCH. See [user-guide.md — One-Click Actions](user-guide.md#one-click-actions--confirmations).

### Board

**Category:** Work · **ID:** `board` · **Default size:** 1120×740

Kanban board view. Fully documented in the [User Guide — Board View](user-guide.md#board-view-kanban).

### Timeline

**Category:** Work · **ID:** `timeline` · **Default size:** 1180×760

Gantt-style timeline view. Fully documented in the [User Guide — Timeline View](user-guide.md#timeline-view-gantt).

### Agents

**Category:** Work · **ID:** `agents` · **Default size:** 1120×740

Agent dashboard with queue visibility. Fully documented in the [User Guide — Agent View](user-guide.md#agent-view).

### Requests

**Category:** Work · **ID:** `requests` · **Default size:** 1060×720

Service request management view. Provides a business-facing intake system for submitting and tracking automation requests against the service catalog.

**Features:**
- **Service catalog panel** — browse available services (from `GET /api/services`) with filtering by department
- **Request creation** — submit new requests with title, description, service type, department, and priority
- **Request list** — view all submitted requests with status, owner, and priority indicators
- **Status filtering** — filter requests by status (pending, routed, in_progress, completed)
- **Route action** — assign a request to an agent and prepare it for workflow launch
- **Launch action** — convert a routed request into an active workflow run
- **Department context** — shows department information alongside requests

**API endpoints used:**
- `GET/POST /api/service-requests`
- `GET /api/services`
- `GET /api/org/departments`

---

### Publish

**Category:** Work · **ID:** `publish` · **Default size:** 1060×700

Publishing pipeline view for managing content publication workflows.

**Features:**
- **Publish queue** — displays tasks and workflow runs related to content publishing
- **Status tracking** — shows publish-ready, in-progress, and completed publish operations
- **Quick actions** — approve, reject, or retry publish workflows directly from the view

**API endpoints used:** Task API and workflow runs API filtered to publish-related items.

---

### Approvals

**Category:** Work · **ID:** `approvals` · **Default size:** 1040×700

Approval management view for workflow gates and quality checkpoints.

**Features:**
- **Pending approvals queue** — lists all workflow runs awaiting approval
- **Approval detail panel** — shows run details, input payload, and context for each approval
- **Approve/Reject actions** — routed through the governed `approval.decide` action (one-click actions slice 2): a typed preview modal shows decision + note + rollback hint before anything fires; outcome toasts and receipts land in the Recent-actions tray
- **Delete relabeled (R2)** — the button that DELETEs a run is labeled "Delete" everywhere (it was previously mislabeled "Cancel", colliding with the distinct `run.cancel` status transition)
- **Governance-aware** — only agents with `approve`/`reject` capabilities (per governance rules) see action buttons; denials surface as typed `rejected_governance` receipts
- **Escalation** — escalate approvals to higher-authority agents
- **System scan follow-up** — integration with `GET /api/system-scan/followup` for improvement suggestion approvals
- **Run binding** — shows linked workflow run ID and gateway session for each approval

**API endpoints used:**
- `GET /api/approvals/pending`
- `POST /api/actions/execute` (kind `approval.decide` → existing approve/reject logic in-process)
- `POST /api/workflow-runs/:id/approve`
- `POST /api/workflow-runs/:id/reject`
- `DELETE /api/workflow-runs/:id` (the "Delete" button)
- `GET /api/system-scan/followup`

---

### Artifacts

**Category:** Work · **ID:** `artifacts` · **Default size:** 1040×700

Artifact browser for viewing outputs and deliverables produced by workflow runs.

**Features:**
- **Artifact list** — displays workflow run outputs (URLs, files, summaries) organized by run
- **Tabbed navigation** — switch between different artifact types or source runs
- **Action menu** — per-row menu for downloading, opening, or inspecting artifacts
- **Detail view** — expandable entries showing full artifact metadata

**API endpoints used:**
- `GET /api/workflow-runs` (artifact data embedded in run output summaries)
- `GET /api/artifacts` (if available)

---

## Operations

### Dependencies

**Category:** Operations · **ID:** `dependencies` · **Default size:** 1040×700

Task dependency visualization and management.

**Features:**
- **Dependency graph** — visual representation of task dependencies (parent-child and cross-task dependencies)
- **Status indicators** — shows whether dependencies are satisfied, blocked, or pending
- **Dependency management** — add or remove dependencies via the task API
- **Blocked task detection** — highlights tasks blocked by unsatisfied dependencies

**API endpoints used:**
- `GET /api/tasks` (with `includeGraph=true`)
- `GET /api/projects`

---

### Health

**Category:** Operations · **ID:** `health` · **Default size:** 980×680

System health monitoring dashboard.

**Features:**
- **Health status display** — aggregate system health from `GET /api/health-status`
- **Tabbed layout** — separate tabs for different health dimensions
- **Service status** — individual status indicators for API, database, cron, gateway, and other services
- **Refresh controls** — manual refresh button for on-demand status checks
- **Basic health endpoint** — fallback to `GET /api/health` if detailed status is unavailable

**API endpoints used:**
- `GET /api/health-status`
- `GET /api/health`

---

### Metrics

**Category:** Operations · **ID:** `metrics` · **Default size:** 1040×700

Date-range-aware business metrics dashboard with scorecards.

**Features:**
- **Tabbed views** — switch between organization, department, agent, service, and site scorecards
- **Date range selector** — configure time range via `from`, `to`, or `days` parameters
- **Metric cards** — key performance indicators displayed as cards
- **Quick range buttons** — preset time ranges (7 days, 30 days, 90 days)

**API endpoints used:**
- `GET /api/metrics/org`
- `GET /api/metrics/departments`
- `GET /api/metrics/agents`
- `GET /api/metrics/services`
- `GET /api/metrics/sites`

---

### Runbooks

**Category:** Operations · **ID:** `runbooks` · **Default size:** 1020×680

Operational runbook browser and executor.

**Features:**
- **Runbook list** — displays available workflow templates that serve as runbooks
- **Runbook details** — shows steps, required approvals, success criteria, and default agent for each runbook
- **Template metadata** — category, description, active status, and required capabilities
- **Launch integration** — create a workflow run from a runbook template

**API endpoints used:**
- `GET /api/workflow-templates`

---

### Memory

**Category:** Operations · **ID:** `memory` · **Default size:** 1040×720

Memory system browser for viewing and editing OpenClaw workspace memory files.

**Features:**
- **File list panel** — browse memory files from `GET /api/memory/list`, showing name, size, line count, and modified date
- **Daily vs. specialized** — distinguishes daily notes (`YYYY-MM-DD.md`) from specialized memory files
- **File reader** — view full file contents with line count
- **Search** — semantic memory search via `GET /api/memory/search`
- **Memory root** — quick access to `MEMORY.md` (long-term memory)
- **Facts management** — browse, add, and delete structured facts from the facts database
- **Editing** — save changes to existing memory files via `PUT /api/memory/file/:name`
- **Statistics** — aggregate memory directory stats (file counts, total size)
- **Tabbed interface** — switch between file browser, search, facts, and stats tabs
- **Action buttons** — open, edit, delete memory files

**API endpoints used:**
- `GET /api/memory/list`
- `GET /api/memory/file/:name`
- `PUT /api/memory/file/:name`
- `GET /api/memory/root`
- `GET /api/memory/search`
- `GET/POST/DELETE /api/memory/facts`
- `GET /api/memory/facts/list`
- `GET /api/memory/facts/search`
- `GET /api/memory/status`
- `GET /api/memory/stats`

---

### Handoffs

**Category:** Operations · **ID:** `handoffs` · **Default size:** 1040×700

Lead handoff tracking for cross-team and cross-agent work transitions.

**Features:**
- **Handoff list** — displays tracked handoffs from `GET /api/lead-handoffs`
- **Action buttons** — create, accept, decline, and complete handoffs
- **Tabbed interface** — separate views for different handoff states (pending, accepted, completed)
- **Project context** — shows associated project information

**API endpoints used:**
- `GET /api/lead-handoffs`
- `GET /api/projects`

---

### Audit

**Category:** Operations · **ID:** `audit` · **Default size:** 1020×700

Full audit trail. Documented in the [User Guide — Audit View](user-guide.md#audit-view).

### Cron

**Category:** Operations · **ID:** `cron` · **Default size:** 980×660

Cron job management. Documented in the [User Guide — Cron View](user-guide.md#cron-view).

### History

**File:** `src/shell/native-views/history-view.mjs`
**App ID:** `history`
**Category:** Operations

Two-pane history/diff UI for browsing audit log entries and state snapshots.

- Tabbed interface: Audit Log + State Snapshots
- Filter by actor, action type
- Per-task history drilling
- Snapshot preview and revert
- API: `GET /api/history`, `GET /api/state-snapshots` (Time Travel listing alias — bare `GET /api/snapshots` serves the snapshot/restore artifact registry), `GET /api/snapshots/:type/:id`

---

### Spaces

**File:** `src/shell/native-views/spaces-view.mjs`
**App ID:** `spaces`
**Category:** System

Multi-workspace management UI. Create, edit, duplicate, and delete workspaces.

- Card grid layout with icon/color pickers
- Modal forms for create/edit
- Default workspace protection (cannot delete)
- Taskbar space switcher integration
- API: `GET/POST/PUT/DELETE /api/spaces`

### Route Catalog

**Category:** System · **ID:** `route-catalog` · **Default size:** 1080×720

Operator-facing API inventory generated from registered task-server routes.

**Features:**
- **Route list** — displays registered route method/path pairs from `GET /api/routes`
- **Search and filtering** — narrow routes by method, path, or API area
- **Coverage hints** — helps compare implemented routes with API documentation

**API endpoints used:**
- `GET /api/routes`

---

### Workflow Routing

**Category:** System · **ID:** `workflow-routing` · **Default size:** 1120×720

Administration view for workflow-to-agent routing policy.

**Features:**
- **Routing table** — lists workflow routing rules and target agents
- **Rule editing** — update routing priority, agent assignment, and activation status
- **Operational visibility** — inspect routing metadata used by workflow dispatch

**API endpoints used:**
- `GET /api/workflow-routing`
- `PUT /api/workflow-routing`
- `DELETE /api/workflow-routing/:workflow_type`

---

### Docs Drift

**Category:** System · **ID:** `docs-drift` · **Default size:** 1080×720

Documentation drift monitor for route, view, widget, and schema coverage checks.

**Features:**
- **Drift summary** — shows current docs drift status and recent check output
- **Route coverage view** — highlights routes that may need API reference entries
- **Registry coverage view** — compares app and widget registries against docs

**API endpoints used:**
- `GET /api/routes`
- `GET /api/stats`

---

### Diagnostics

**Category:** Operations · **ID:** `diagnostics` · **Default size:** 1080×720

System Operations Center for monitoring, diagnosing, and repairing failing components.

**Features:**
- **Summary dashboard** — high-level health overview from `GET /api/diagnostics/summary`
- **Jobs tab** — list all monitored jobs (cron, skills, scripts) with health status
- **Failures tab** — focused view on failing components only
- **Job detail** — expandable details for individual jobs showing failure classification, recent logs
- **Log inspection** — view recent log output via `GET /api/diagnostics/jobs/:id/logs`
- **Repair actions** — attempt to repair failed jobs via `POST /api/diagnostics/jobs/:id/repair`
- **Silence alerts** — acknowledge and temporarily silence failing job alerts via `POST /api/diagnostics/jobs/:id/silence`
- **Failure classification** — automatic classification of failures using keyword detection (traceback, fatal, exception, etc.)

**API endpoints used:**
- `GET /api/diagnostics/summary`
- `GET /api/diagnostics/jobs`
- `GET /api/diagnostics/failures`
- `GET /api/diagnostics/jobs/:id`
- `GET /api/diagnostics/jobs/:id/logs`
- `POST /api/diagnostics/jobs/:id/repair`
- `POST /api/diagnostics/jobs/:id/silence`

---

### Mission Control

**Category:** Operations · **ID:** `mission-control` · **Default size:** 1180×780

Read-only command-center aggregation — one window answering "is anything broken, blocked, or burning money?" in under five seconds. Per the design brief (`docs/briefs/mission-control.md`).

**Features:**
- **Fleet status panel** — overall/gateway/database health, agent counts with active/idle/offline breakdown, queue depth (30 s poll)
- **Blocked / stale runs panel** — running/blocked/failed counts plus live run ages with staleness warning at 15 min (20 s poll, aligned with realtime-sync)
- **Cron health panel** — enabled/failing job counts, next scheduled job, consecutive-failure detection via lazy per-job run lookups (max 3 per sweep), file-based diagnostics health summary (60 s poll)
- **Cost panel** — today's spend, 7-day total and daily average, top run by cost, spike badge when today exceeds 2× the trailing mean (120 s poll); budget bars (budget-ledger slice 3) render under the today/7d block when GET /api/budgets returns active budgets — per-budget track+fill colored green below 75% of cap, amber above it, red at/over cap, with name, action badge (pause_new_runs/hard_stop), spend-vs-cap line and period key; budgets-absent or unavailable payloads render no section and a budgets fetch failure never blanks the cost rows (degraded independently via Promise.allSettled); token-capped budgets still render when cost history is empty
- **Anomaly flags panel** — client-side heuristics over polled data, max 6 flag types: stale run, zero-token loop, crash-looping cron, cost burn spike, idle-agent-with-queued-task, budget breach; recomputed on every runs poll
- **Thresholds** — anomaly heuristics are named exported constants in `src/shell/native-views/mission-control-view.mjs`, each with a justification comment at its definition: `STALE_RUN_MINUTES = 15` (stale-run flag), `ZERO_TOKEN_MINUTES = 10` (zero-token loop), `CRASH_LOOP_CONSECUTIVE_FAILURES = 2` (crash-loop flag, also gates the diagnostics classification path), `COST_SPIKE_MULTIPLIER = 2` (spike badge/flag, strictly greater-than — exactly 2× is not a spike), `COST_SPIKE_MIN_HISTORY_DAYS = 3` (minimum trailing history before spike evaluation), `BUDGET_WARN_FRACTION = 0.75` (budget bars turn amber at >75% of cap — bar color only, never a flag), `BUDGET_BREACH_FRACTION = 1` (bar red AND the `budget_breach` error flag fires at ≥100% of cap — exactly-at-cap IS a breach, matching the >= boundary in lib/budget-eval.js), `MAX_ANOMALY_FLAGS = 25` (render cap). Boundary behavior is pinned by fixtures in `tests/test-cost-routes.js`; retuning a value requires updating this note in the same commit
- **Quick links panel** — static grid opening Health, Diagnostics, Cron, Workflows, Agents, Sessions, Approvals, and Audit via shell navigation
- **Independent degradation** — every panel has its own load/render/error path with three visually distinct states (loading pulses, empty is muted italic, error is red-tinted); DB-backed panels show named "unavailable" states in json_snapshot mode while CLI-backed panels stay fully populated; a poll failure after last-good data keeps the data and flags the panel stale instead of blanking; the cost panel distinguishes "No cost data recorded yet" (endpoint healthy, migration-022 history not accumulated) from "Cost unavailable — no database"; no editing actions (read-only guarantee, GET-only polling)

**API endpoints used:**
- `GET /api/health-status`
- `GET /api/openclaw/agents`
- `GET /api/agents/status` (Postgres only)
- `GET /api/tasks?status=queued` (Postgres only)
- `GET /api/workflow-runs` (Postgres only)
- `GET /api/workflow-runs/stuck` (Postgres only)
- `GET /api/blockers/summary` (Postgres only)
- `GET /api/cron/jobs`
- `GET /api/cron/jobs/:id/runs`
- `GET /api/diagnostics/summary`
- `GET /api/diagnostics/failures`
- `GET /api/costs/summary`

---

## Admin

### Departments

**Category:** Admin · **ID:** `departments` · **Default size:** 1020×700

Organization department management.

**Features:**
- **Department cards** — displays all departments as cards with name, description, color, agent count
- **Create department** — add new departments with name, slug, description, color, and icon
- **Edit department** — modify existing department properties
- **Agent counts** — shows total and active agent counts per department
- **Org API integration** — uses `GET/POST /api/org/departments`

**API endpoints used:**
- `GET /api/org/departments`
- `POST /api/org/departments`

---

### Explorer

**Category:** Admin · **ID:** `explorer` · **Default size:** 1020×700

File explorer for browsing the OpenClaw workspace directly from the desktop shell.

**Features:**
- **Quick-access roots** — one-click navigation to key directories (Backend, Dashboard, Extensions, Agents, Docs)
- **Breadcrumb navigation** — click any path segment to jump up the tree
- **File listing** — displays name, size, type, and modified time for files and directories
- **Directory browsing** — click folders to descend; click breadcrumbs to ascend
- **File type indicators** — folder/file icon differentiation with protected/read-only badges
- **Search** — filename and content search via ripgrep (`GET /api/fs/search`)
- **Notepad integration** — double-click a file to open it in the Notepad app via the shared state bridge (`notepad:open-file` event)
- **Status bar** — shows current path and item count

**Security:** Connects to the local-only filesystem API server (`http://127.0.0.1:3880`). Protected paths (`.git/`, credentials, `.env`, certificates) are displayed with read-only badges.

**API endpoints used:**
- `GET /api/fs/list`
- `GET /api/fs/stat`
- `GET /api/fs/search`

---

### Notepad

**Category:** Admin · **ID:** `notepad` · **Default size:** 960×700

Lightweight text editor for viewing and editing files from the Explorer or standalone.

**Features:**
- **Tabbed editing** — multiple files open simultaneously as tabs with individual close buttons
- **File open from Explorer** — receives `notepad:open-file` events from the Explorer via shared state (`stateStore`)
- **Direct path input** — open any workspace file by typing its path in a path bar
- **Syntax-aware display** — renders file content with line numbers and basic formatting
- **Unsaved indicator** — per-tab dirty state indicator (dot on tab when unsaved changes exist)
- **Save** — `Ctrl+S` / `Cmd+S` keyboard shortcut to save, plus save button
- **Read-only files** — protected files open in read-only mode with a badge
- **Status bar** — shows file path, line count, and save status
- **Close guard** — warns when closing a tab with unsaved changes

**Security:** Connects to the local-only filesystem API server. Writes are blocked for protected paths and binary files.

**API endpoints used:**
- `GET /api/fs/file`
- `PUT /api/fs/file`

---

### Skills & Tools

**Category:** Admin · **ID:** `skills-tools` · **Default size:** 1120×740

Registry browser for OpenClaw skills and agent tool allowlists.

**Features:**
- **Combined catalog** — shows both skills (from `openclaw skills list`) and tools (from agent allowlists in `openclaw.json`)
- **Skills panel** — lists all registered skills with status badges (ready, disabled, blocked, unavailable)
- **Skills detail** — shows skill name, source, description, location, and missing requirements
- **Tools panel** — lists all tools with descriptions and which agents have them enabled
- **Filtering** — search and filter skills and tools independently
- **Card-based layout** — each skill/tool rendered as an information card

**API endpoints used:**
- `GET /api/catalog/skills-tools`
- `GET /api/catalog/skills`
- `GET /api/catalog/tools`

---

### Workflows

**Category:** Admin · **ID:** `workflows` · **Default size:** 1120×760

Workflow engine management and monitoring.

**Features:**
- **Workflow runs list** — displays all workflow runs with status, type, owner, and timestamps
- **Tabbed navigation** — switch between active, completed, failed, and all runs
- **Run detail panel** — expandable panel showing run input, output, steps, and agent routing
- **Run row actions (one-click actions slice 2)** — non-terminal rows expose ⛔ Cancel behind hold-to-confirm (HIGH severity gate, keyboard parity via held Enter); failed rows expose ↻ Re-dispatch behind a typed preview modal (resets to `queued`, dispatcher picks it up); both fire through `POST /api/actions/execute` and record receipts
- **Step timeline** — visual step progression for active runs
- **Template reference** — link to workflow template definition
- **Claim integration** — shows claim status and agent session binding
- **Project filtering** — filter runs by project

**API endpoints used:**
- `GET /api/workflow-runs`
- `GET /api/workflow-runs/active`
- `GET /api/workflow-runs/:id`
- `POST /api/workflow-runs/:id/start`
- `POST /api/workflow-runs/:id/complete`
- `POST /api/actions/execute` (kinds `run.cancel` / `run.redispatch` → existing cancel / override-failure logic in-process)
- `GET /api/workflow-templates`
- `GET /api/projects`

---

### Operations

**Category:** Admin · **ID:** `operations` · **Default size:** 1120×760

Comprehensive operations console combining multiple operational views in a tabbed interface.

**Features:**
- **Multi-tab layout** — tabbed panel combining:
  - **Services** — service catalog and status
  - **Cron** — cron job management (mirrors Cron view)
  - **Health** — system health monitoring
  - **Diagnostics** — failure detection and repair
  - **Agents** — agent fleet status
  - **Metrics** — business metrics overview
- **Action buttons** — run, repair, and manage operational components directly
- **Cron admin integration** — connects to the cron-manager API on port 3878 for advanced cron operations
- **Health status** — real-time health indicators from the gateway status endpoint

**API endpoints used:**
- `GET /api/health-status`
- `GET /api/agents/status`
- `GET/POST /api/cron-admin/jobs` (via cron-manager on port 3878; requires `Authorization: Bearer $DASHBOARD_AUTH_TOKEN`)
- `POST /api/cron-admin/jobs/:id/run` (same auth; `Content-Type: application/json` required)

---

## Internal Views

### Agent Queue

**Category:** Internal · **ID:** `agent-queue`

Lightweight agent queue view used by the Agents view to show per-agent task queues. Not a standalone start-menu app — rendered as a sub-component.

**Features:**
- Displays the assigned tasks for a selected agent
- Delegates rendering to the view adapter
- **⚡ Run workflow… row action** (one-click actions slice 2) — every task card opens a template picker, then the typed preview modal, then dispatches through the governed `run.dispatch` action (create+start composed server-side); receipts land in the Recent-actions tray

### Support Wrapper

**Category:** Internal

Factory function that creates view renderers for support/debugging views. Used to wrap views that need additional support context (e.g., session info, debug metadata).

**Usage:** `createSupportViewRenderer(methodName)` returns a render function.

### Legacy Wrapper

**Category:** Internal

Compatibility wrapper that adapts legacy view render functions to the current shell API. Used during migration from the old single-page layout to the windowed desktop shell.

**Usage:** `renderLegacyView(renderFn, context)` wraps an old-style render function.

### Sessions

**Category:** Work · **ID:** `sessions` · **Default size:** 1120×740

Live session browser and chat interface for interacting with OpenClaw agents. Shows active and past sessions with streaming chat support.

**Features:**
- Browse active and past agent sessions
- Stream chat messages in real-time via SSE
- Send messages to running sessions
- View session history and metadata
- Abort running session tasks

**API:** Uses `/api/oc/chat/send`, `/api/oc/chat/status`, `/api/oc/chat/abort`, `/api/oc/sessions` routes.

### Session Replay

**Category:** Work · **ID:** `session-replay` · **Default size:** 1000×700

Time-travel stepper over a persisted session transcript (docs/briefs/session-replay.md). Pick an agent → pick a session → the transcript is fetched once through the read-only `/events` endpoint, then scrubbed entirely offline in memory.

**Features:**
- **Agent + session pickers** — mirror the Sessions view (`GET /api/oc/agents`, `GET /api/oc/sessions?agent=`); deep-linkable via `/?view=session-replay&agent=<id>&session=<sessionId>`
- **Timeline scrubber + stepper** — horizontal slider proportional to event index; `←`/`→` step one event, `Home`/`End` jump to start/end (buttons too)
- **As-of-t pane** — cumulative chat transcript rendered as of the current step: user/assistant bubbles plus collapsed thinking blocks; newest text appears as the stepper crosses its event
- **Current-step detail card** — tool calls show args (IN) and result (OUT) previews, expandable inline; exitCode badge green (0) / red (non-zero) / gray status word for non-process tools from persisted `toolResult.details`; unpaired calls honestly show "no result recorded"
- **Load full output** — on-demand single GET to `/api/oc/sessions/:sessionId/events/:line` replaces truncated previews with full bodies; cached per line (LRU cap 50)
- **Virtualized event rail** — fixed-row-height windowed renderer: only visible rows (+overscan) exist in the DOM regardless of transcript size; chat pane renders a bounded 60-message tail

**Graceful degradation:** missing transcript → named empty state; API errors → error state with retry; crash-truncated transcripts → amber banner (`partial`); over-size-cap files → banner (`truncated`); sessions beyond the client guardrail stop at 20,000 events with a banner. Read-only: replay emits zero non-GET requests.

**API endpoints used:**
- `GET /api/oc/sessions/:sessionId/events?agent=&afterLine=&limit=` — cursor-paginated normalized events
- `GET /api/oc/sessions/:sessionId/events/:line?agent=` — full-fidelity single event
- `GET /api/oc/agents`, `GET /api/oc/sessions` — pickers

### Bing Webmaster

**Category:** Admin · **ID:** `bing`

Submit URLs to Bing and manage search engine indexing for connected sites.

**Features:**
- Submit URLs for indexing
- Check indexing status
- Manage sitemap submissions

### Settings

**Category:** Admin · **ID:** `settings`

Configuration panel for OpenClaw Desktop settings and preferences.

**Features:**
- View and edit dashboard settings by category
- Import/export configuration bundles
- View settings changelog
- Persist settings across sessions
- **Snapshots & Restore** tab (snapshot/restore slice 3, brief §3): one-click full-state snapshot creation with a default `snapshot-YYYYMMDD-HHmm` name; newest-first server-side registry listing name/id, created_at, honest on-disk size and total rows plus the last-previewed schema-compat verdict badge (`not checked` until a preview runs); per-row artifact download (Bearer stays in headers, never the URL) and restore entry points for server-side snapshots or uploaded artifacts. The restore flow is preview-first: dry-run diff grid per table (added / updated / conflicts / unchanged with expandable PK samples), schema verdict + warnings (`target_newer`, `active_runs`, dropped settings section) and the rollback hint to re-create a snapshot BEFORE confirming. Merge confirms plainly; Replace flips to the HOLD_CONFIRM gate — press-and-hold ≥1.2 s conic-gradient ring with Enter-hold keyboard parity and a typed-confirm fallback (type REPLACE), early release fires nothing (AC12). Apply POSTs with a client-minted `restoreId` minted once per confirmed intent, drives a determinate progress bar from `restore-progress` SSE frames on `/api/events/stream`, survives page closes via a localStorage reattach record, retries failures by resuming at the first incomplete table under the same `restoreId`, and ends in a completion summary distinguishing fresh vs resumed vs duplicate replays. Zero-throw degradation throughout: loading / empty / unavailable / error-retry list states, and without PostgreSQL create/preview/apply surface the server's 503 `{available:false}` while the disk-only registry and downloads keep working (AC7).
