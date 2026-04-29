# Views Reference — All Desktop Windows

The OpenClaw Project WebOS exposes **23 windowed applications** through the desktop shell. Each view is a self-contained module loaded on demand when the user opens its window from the start menu or taskbar.

Views are organized into three categories in the start menu: **Work**, **Operations**, and **Admin**.

> **Already documented in detail** in [user-guide.md](user-guide.md): Tasks, Board, Timeline, Agent, Audit, and Cron views. These are briefly cross-referenced below but not re-documented.

---

## Table of Contents

### Work
- [Tasks](#tasks) ✓ (see user-guide.md)
- [Board](#board) ✓ (see user-guide.md)
- [Timeline](#timeline) ✓ (see user-guide.md)
- [Agents](#agents) ✓ (see user-guide.md)
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
- [Audit](#audit) ✓ (see user-guide.md)
- [Cron](#cron) ✓ (see user-guide.md)
- [Diagnostics](#diagnostics)

### Admin
- [Departments](#departments)
- [Explorer](#explorer)
- [Notepad](#notepad)
- [Skills & Tools](#skills--tools)
- [Workflows](#workflows)
- [Operations](#operations)

### Internal
- [Agent Queue](#agent-queue)
- [Support Wrapper](#support-wrapper)
- [Legacy Wrapper](#legacy-wrapper)

---

## Work

### Tasks

**Category:** Work · **ID:** `tasks` · **Default size:** 1080×720

The primary task list view. Fully documented in the [User Guide — List View](user-guide.md#list-view-default).

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
- **Approve/Reject actions** — operators can approve or reject with optional comments
- **Governance-aware** — only agents with `approve`/`reject` capabilities (per governance rules) see action buttons
- **Escalation** — escalate approvals to higher-authority agents
- **System scan follow-up** — integration with `GET /api/system-scan/followup` for improvement suggestion approvals
- **Run binding** — shows linked workflow run ID and gateway session for each approval

**API endpoints used:**
- `GET /api/approvals/pending`
- `POST /api/workflow-runs/:id/approve`
- `POST /api/workflow-runs/:id/reject`
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

### Diagnostics

### History

**File:** `src/shell/native-views/history-view.mjs`
**App ID:** `history`
**Category:** Operations

Two-pane history/diff UI for browsing audit log entries and state snapshots.

- Tabbed interface: Audit Log + State Snapshots
- Filter by actor, action type
- Per-task history drilling
- Snapshot preview and revert
- API: `GET /api/history`, `GET /api/snapshots/:type/:id`

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
- **Action buttons** — start, pause, resume, cancel, and retry workflow runs
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
- `GET/POST /api/cron-admin/jobs` (via cron-manager on port 3878)
- `POST /api/cron-admin/jobs/:id/run`

---

## Internal Views

### Agent Queue

**Category:** Internal · **ID:** `agent-queue`

Lightweight agent queue view used by the Agents view to show per-agent task queues. Not a standalone start-menu app — rendered as a sub-component.

**Features:**
- Displays the assigned tasks for a selected agent
- Delegates rendering to the view adapter

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
