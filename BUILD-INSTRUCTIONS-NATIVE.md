# Native Views — Build Instructions for Codex

**Target directory:** `/root/.openclaw/workspace/dashboard/`
**Reference plan:** `memory/2026-03-19-native-views-plan.md` (read it first for full context)

## Overview

Replace iframe-based window content with native views. Each view is a JS module that renders directly into a window's content div, calling APIs natively instead of through a separate HTML page.

## What to Build (Phases 1-3)

### Phase 1: Infrastructure

#### 1.1 `src/shell/view-adapter.mjs`
Creates the shared context that all view modules need. View modules currently expect these parameters:
```
{ state, mountNode, fetchImpl, escapeHtml, showNotice, showSessionDetails, formatTimestamp, resolveProjectId }
```

The adapter should:
- Export `createViewAdapter(windowContentDiv, shellAPI)` where shellAPI provides:
  - `showNotice(message, type)` — shows a toast notification via the shell
  - `navigateTo(viewId)` — open a different view (optional, for cross-view links)
  - `getProjectId()` — returns the current default project ID
  - `getTheme()` — returns current theme
- Return an object with:
  - `mount(viewModule, options)` — call the view's render function with the right params
  - `unmount()` — call cleanup, clear the container
  - `state` — reactive state object
- Also export shared utilities:
  - `escapeHtml(value)` — HTML entity escaping
  - `formatTimestamp(dateString)` — localized date formatting
  - `formatRelativeTime(dateString)` — "2 hours ago" style

#### 1.2 `src/shell/view-state.mjs`
Simple shared state store:
- Export `createViewState(initialState)` → returns `{ getState, setState, subscribe, onStateChange }`
- Subscribe by key path: `subscribe('project.id', callback)`
- Views use this to share state (selected task, active filters, current project)

#### 1.3 `src/shell/api-client.mjs`
Typed API client wrapper:
- Export `createAPIClient(baseURL = '/api')` → returns method groups:
  - `client.tasks.list({ project_id, status, filter })` → GET /api/tasks
  - `client.tasks.get(id)` → GET /api/tasks/:id
  - `client.tasks.create(data)` → POST /api/tasks
  - `client.tasks.update(id, data)` → PATCH /api/tasks/:id
  - `client.tasks.remove(id)` → DELETE /api/tasks/:id
  - `client.tasks.archive(id)` / `client.tasks.restore(id)`
  - `client.tasks.history(id)` → GET /api/tasks/:id/history
  - `client.tasks.dependencies(id)` → GET /api/tasks/:id/dependencies
  - `client.projects.list()` → GET /api/projects
  - `client.projects.getDefault()` → GET /api/projects/default
  - `client.projects.get(id)` → GET /api/projects/:id
  - `client.org.departments.list()` → GET /api/org/departments
  - `client.org.agents.list(opts)` → GET /api/org/agents
  - `client.org.summary()` → GET /api/org/summary
  - `client.health.check()` → GET /api/health
  - `client.health.status()` → GET /api/health-status
  - `client.stats()` → GET /api/stats
  - `client.cron.jobs()` → GET /api/cron/jobs
  - `client.cron.runJob(id)` → POST /api/cron/jobs/:id/run
  - `client.audit.list(opts)` → GET /api/audit
  - `client.workflows.runs(opts)` → GET /api/workflow-runs
  - `client.workflows.templates()` → GET /api/workflow-templates
  - `client.catalog.all()` → GET /api/catalog
  - `client.metrics.org()` → GET /api/metrics/org
  - `client.agents.list()` → GET /api/agents
  - `client.agents.status()` → GET /api/agents/status
  - `client.blockers.list()` → GET /api/blockers
  - `client.artifacts.list()` → GET /api/artifacts
  - `client.approvals.pending()` → GET /api/approvals/pending
- Use native `fetch`, throw on non-OK responses with status + message
- Simple request dedup: cache inflight GETs by URL, return same promise

### Phase 2: Adapt Existing View Modules

The existing `src/views/*.mjs` modules already export render functions. They need small adaptations to work with the adapter.

#### 2.1 Read these existing files to understand their interfaces:
- `src/views/support-views.mjs` — exports `createSupportViews({ mountNode, resolveProjectId, escapeHtml })`, provides views for: health, memory, cron, audit, handoffs, dependencies, runbooks
- `src/views/skills-tools-view.mjs` — exports `renderSkillsToolsView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`
- `src/views/approvals-view.mjs` — exports `renderApprovalsView({ state, mountNode, fetchImpl, escapeHtml, showNotice, showSessionDetails, formatTimestamp })`
- `src/views/artifacts-view.mjs` — exports `renderArtifactsView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`
- `src/views/metrics-view.mjs` — exports `renderMetricsView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`
- `src/views/departments-view.mjs` — exports `renderDepartmentsView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`
- `src/views/service-requests-view.mjs` — exports `renderServiceRequestsView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`
- `src/views/publish-view.mjs` — exports `renderPublishView({ state, mountNode, fetchImpl, escapeHtml, showNotice })`

#### 2.2 Create thin wrapper modules that bridge the adapter to each existing view:

**`src/shell/native-views/operations-view.mjs`** (NEW)
- Calls the health view from support-views + agent status + cron
- Uses `createSupportViews` from `../views/support-views.mjs`
- API: `GET /api/health`, `GET /api/agents/status`, `GET /api/cron/jobs`
- Layout: health status cards at top, agent grid below, cron job list

**`src/shell/native-views/skills-tools-view.mjs`** (NEW)
- Wraps existing `renderSkillsToolsView` from `../views/skills-tools-view.mjs`
- Uses api-client instead of raw fetch
- Minimal wrapper — just adapter glue

**`src/shell/native-views/approvals-view.mjs`** (NEW)
- Wraps existing `renderApprovalsView`
- Uses api-client

**`src/shell/native-views/artifacts-view.mjs`** (NEW)
- Wraps existing `renderArtifactsView`
- Uses api-client

**`src/shell/native-views/departments-view.mjs`** (NEW)
- Wraps existing `renderDepartmentsView`
- Uses api-client

**`src/shell/native-views/service-requests-view.mjs`** (NEW)
- Wraps existing `renderServiceRequestsView`
- Uses api-client

**`src/shell/native-views/metrics-view.mjs`** (NEW)
- Wraps existing `renderMetricsView`
- Uses api-client

**`src/shell/native-views/publish-view.mjs`** (NEW)
- Wraps existing `renderPublishView`
- Uses api-client

### Phase 3: Extract Views from Standalone Pages

#### 3.1 `src/shell/native-views/agents-view.mjs` (NEW)
- Extract from `src/agents-page.mjs`
- Read it first to understand what it needs
- Render: agent presence grid, agent detail panel, blocker summary, metrics
- API: `/api/org/agents`, `/api/blockers`, `/api/blockers/summary`, `/api/workflow-runs/:id/reassign|escalate|pause|resume`
- Strip standalone boilerplate (theme toggle, favicon, page shell)
- Export: `renderAgentsView({ mountNode, api, adapter })`

#### 3.2 `src/shell/native-views/workflows-view.mjs` (NEW)
- Extract from `src/workflows-page.mjs` (read it first)
- Render: template grid, run history, run detail
- API: `/api/workflow-runs`, `/api/workflow-templates`, `/api/workflow-runs/:id/start`
- Export: `renderWorkflowsView({ mountNode, api, adapter })`

#### 3.3 `src/shell/native-views/task-list-view.mjs` (NEW)
- Extract task list rendering from `src/dashboard-integration-optimized.mjs`
- This is the hardest view. Read the file carefully.
- Render: task list with virtual scrolling, filters, search, sort, CRUD form
- API: `/api/tasks`, `/api/tasks/:id`, `/api/projects/default`
- Export: `renderTaskListView({ mountNode, api, adapter, state })`

#### 3.4 `src/shell/native-views/board-view.mjs` (NEW)
- Extract board (kanban) from `src/dashboard-integration-optimized.mjs`
- Render: kanban columns, drag-drop between statuses
- API: `/api/views/board`
- Export: `renderBoardView({ mountNode, api, adapter, state })`

#### 3.5 `src/shell/native-views/timeline-view.mjs` (NEW)
- Extract timeline from `src/dashboard-integration-optimized.mjs`
- Render: gantt-style timeline with date ranges
- API: `/api/views/timeline`
- Export: `renderTimelineView({ mountNode, api, adapter, state })`

#### 3.6 `src/shell/native-views/agent-queue-view.mjs` (NEW)
- Extract agent queue from `src/dashboard-integration-optimized.mjs`
- Render: agent cards with claim/release
- API: `/api/views/agent`, `/api/agent/claim`, `/api/agent/release`
- Export: `renderAgentQueueView({ mountNode, api, adapter, state })`

### Phase 4: Integration — Wire Native Views into Window Manager

#### 4.1 Modify `src/shell/window-manager.mjs`
- Add `contentMode` support: when an app has `viewModule` in the registry, import and mount it natively instead of creating an iframe
- On window open: `import(viewModule)` → create content div → call `render()` → store instance for cleanup
- On window close: call view's cleanup function (if returned), remove content div
- Keep iframe as fallback if viewModule not specified or import fails

#### 4.2 Modify `src/shell/app-registry.mjs`
- Add `viewModule` field to each app entry pointing to the native view path
- Example: `{ id: 'tasks', viewModule: './shell/native-views/task-list-view.mjs', url: '/dashboard.html?view=list' }`
- The `url` field stays as iframe fallback

#### 4.3 Modify `src/shell/shell-main.mjs`
- Import `createViewAdapter` and `createAPIClient`
- Create shared instances at boot
- Pass them through to the window manager so native views can access them

## Important Constraints

- Do NOT modify any existing files in `src/views/` — they're used by dashboard.html too
- Do NOT modify `dashboard.html`, `agents.html`, `operations.html`, `workflows.html`, `skills-tools.html`
- Do NOT modify `src/dashboard-integration-optimized.mjs`
- All new files go in `src/shell/native-views/` and `src/shell/`
- Native views are wrappers/extracts — the originals stay untouched
- The iframe fallback must keep working throughout

## Styling for Native Views

Native views render inside the window's content area. They inherit the window's background color. For consistent styling:
- Use CSS custom properties from `win11-theme.css`: `var(--win11-surface-solid)`, `var(--win11-text)`, etc.
- Create `src/styles/view-shared.css` with shared view styles (stat cards, tables, form controls, filters)
- Each native view can also include inline styles for layout (like the existing view modules do)

## Test Pages

Create `tests/native-views-test.html` (Tailwind CDN) that:
1. Imports `createViewAdapter` and verifies the API
2. Imports `createAPIClient` and tests a real API call to `/api/health`
3. Imports each native view module and verifies it exports a render function
4. Tests that `window-manager.mjs` can open a native view window (check content div has children, no iframe)
5. Tests fallback to iframe when viewModule not specified

## When Finished

Run: `openclaw system event --text "Done: Native view migration phases 1-4 complete" --mode now`
