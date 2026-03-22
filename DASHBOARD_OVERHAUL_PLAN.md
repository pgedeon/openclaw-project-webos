# OpenClaw Project Dashboard Overhaul Plan

Date: 2026-03-08

## Executive Summary

The current dashboard is not failing because the idea of a dashboard is wrong. It is failing because it tries to be a full Asana-style project manager, a local-first offline app, a cron monitor, an agent queue, an audit explorer, and a QMD surface at the same time, while living as a standalone HTML plus vanilla JS application outside the main OpenClaw frontend.

The best overhaul is:

1. Reposition it as an operations-first OpenClaw control surface.
2. Keep project and task management, but move it behind explicit project-focused views instead of making it the whole homepage.
3. Rebuild it inside the main Next.js frontend and shared component system.
4. Replace unbounded list loading with summarized, paginated, and project-scoped APIs.

## What Other OpenClaw Users Are Doing

### Official OpenClaw direction

The official browser dashboard is the Gateway Control UI, not a project management clone. The docs describe it as the browser admin surface for chat, config, sessions, nodes, and exec approvals.

Implication:

- OpenClaw's native dashboard pattern is operational control, not task-database-first UX.
- A good custom dashboard should feel like "mission control for agents" first, and "task board" second.

Sources:

- https://docs.openclaw.ai/dashboard
- https://docs.openclaw.ai/control-ui

### Community pattern 1: Mission Control

The installed community `agent-dashboard` skill takes a lightweight mission-control approach:

- action required
- active now
- cron job health
- recent activity
- optional product status cards
- simple polling or realtime transport

Its strength is that it answers "what needs attention right now?" in one screen.

Reference:

- `skills/skills/tahseen137/agent-dashboard/SKILL.md`
- `skills/skills/tahseen137/agent-dashboard/assets/tier3-realtime.html`

### Community pattern 2: Ops Summary

The installed `ops-dashboard` skill is even narrower. It summarizes operational health:

- disk usage
- git status
- recent commits
- load average
- largest directories

Its strength is that it stays brutally focused on operator decisions.

Reference:

- `skills/skills/crimsondevil333333/ops-dashboard/README.md`
- `skills/skills/crimsondevil333333/ops-dashboard/references/ops-dashboard.md`

## Current State Audit

### What is working

- The dashboard server is live at `http://localhost:3876/`.
- Health and data APIs respond successfully.
- The validation script passes against the live database with warnings only.
- PostgreSQL storage is initialized and the API surface is real, not mocked.

### What is structurally wrong

1. The dashboard is the wrong product shape.

It is designed as an Asana-like task app. OpenClaw users need:

- active agents
- sessions
- cron health
- failures
- approvals
- task queues
- recent executions

Those are operational views. In the current app, they are secondary to task CRUD.

2. The dashboard exists outside the main frontend stack.

You already have a real app shell, auth model, sidebar, tables, and generated API client in the main frontend. The dashboard ignores that and ships as:

- `workspace/dashboard/dashboard.html`
- `workspace/dashboard/src/dashboard-integration-optimized.mjs`
- `workspace/dashboard/task-server.js`

This creates duplicated UX, duplicated state logic, and separate maintenance burden.

3. There are two dashboard code copies.

There is a served copy in `workspace/dashboard/` and a separate workflow snapshot in `workspaces/workflows/feature-dev/agents/planner/project-dashboard/dashboard/`. They have already diverged.

That is a maintenance trap and makes it unclear which code is authoritative.

4. The data-loading model does not scale cleanly.

Current live data:

- 477 projects
- 2892 tasks
- 497 workflows
- 3259 audit entries

The frontend auto-select logic fetches `/api/projects`, then probes `/api/tasks/all` project-by-project until it finds one with tasks. That is the wrong algorithm once the system has a lot of test or empty projects.

5. The project list is polluted with test fixtures.

The top of `/api/projects` is dominated by `Board Test Project ...` records. Even if the app technically works, the operator experience is poor because the default project selection path is buried under noise.

6. The dashboard package is dependency-drifted.

The local `workspace/dashboard/package.json` only declares `busboy` and Playwright, while the server and validation scripts depend on `pg`. The runtime works because the environment currently provides `pg` elsewhere, but the project manifest is not truthful.

7. The validation warnings point to weak operational semantics.

Current warnings:

- 17 `in_progress` tasks have unmet dependencies and should probably be blocked.
- QMD data directory not found.

These are good examples of why the homepage should emphasize operational integrity and exceptions instead of raw task CRUD.

## Local Evidence

- `workspace/dashboard/src/dashboard-integration-optimized.mjs`
- `workspace/dashboard/task-server.js`
- `workspace/dashboard/package.json`
- `frontend/src/app/dashboard/page.tsx`
- `frontend/src/components/templates/DashboardShell.tsx`
- `frontend/src/components/templates/DashboardPageLayout.tsx`

## Recommendation

Do not continue evolving the current standalone dashboard as the primary long-term UI.

Instead:

1. Freeze the current standalone dashboard to maintenance-only.
2. Build a new dashboard inside the main frontend.
3. Treat the existing task backend as a data source to be wrapped by cleaner summary and list APIs.
4. Keep the old dashboard running until the new one covers the critical operator flows.

## Target Product Shape

### Homepage: Mission Control

The landing page should answer, in under 10 seconds:

- what is broken
- what is currently running
- what needs operator approval
- what jobs are failing
- what agents are blocked
- what projects need attention today

Recommended homepage sections:

1. Action Required
   - failed cron jobs
   - blocked tasks with missing dependencies
   - approvals waiting
   - stale agents

2. Active Now
   - active sessions
   - current agent/model
   - started at / elapsed
   - current task or queue item

3. Cron Health
   - job name
   - next run
   - last run
   - last result
   - error count

4. Project Pulse
   - top 5 active projects
   - task counts by status
   - overdue count
   - blocked count

5. Recent Activity
   - recent task transitions
   - session completions
   - cron failures
   - deploy or publish outcomes

6. Memory / System Health
   - memory index dirty/clean
   - last reindex
   - disk usage
   - queue backlog

### Secondary views

Use separate routes or tabs for:

- Projects
- Tasks
- Agents
- Cron
- Audit
- Approvals

### Projects view

This should be a searchable, paginated projects table with:

- pinned projects
- hide test/archive noise by default
- filters for active, paused, archived, test
- task counts and health badges

### Task view

This should only load a selected project by default.

The task area can still support:

- list
- board
- timeline
- audit detail

But only after the user chooses a project or pinned context.

## Architecture Plan

### UI stack

Rebuild inside the main frontend:

- reuse `DashboardShell`
- reuse `DashboardPageLayout`
- reuse existing table, card, badge, and chart components
- add a new route such as `/operations` or replace `/dashboard`

Why:

- consistent auth and navigation
- easier testing
- shared API client generation
- easier long-term maintenance

### Backend/API plan

Keep the existing storage layer, but stop exposing the UI directly to raw broad queries as its first step.

Add new endpoints optimized for the new UX:

1. `GET /api/project-dashboard/summary`
   - action-required counts
   - active agent count
   - failing cron count
   - blocked task count
   - overdue task count
   - memory health snapshot

2. `GET /api/project-dashboard/projects`
   - paginated
   - filterable
   - includes task/status summary per project
   - hides test fixtures by default unless requested

3. `GET /api/project-dashboard/projects/:id/tasks`
   - paginated
   - filterable
   - explicit sort
   - no implicit whole-project overfetch if not needed

4. `GET /api/project-dashboard/agents`
   - active sessions
   - claimed tasks
   - last heartbeat / last output

5. `GET /api/project-dashboard/cron`
   - status summary
   - last failures
   - next run

6. `GET /api/project-dashboard/activity`
   - normalized recent events feed

### Realtime strategy

Do not start with a complex websocket rewrite.

Phase the freshness model:

1. Polling every 15-30 seconds for summary cards.
2. Polling every 60 seconds for project tables.
3. Optional SSE or websocket later for:
   - active sessions
   - live cron state
   - approvals

### Data hygiene

Before launch, clean the project dataset:

- mark test projects clearly
- add a `system/test` or `metadata.is_fixture` flag
- hide fixture projects from default queries
- add pinned or default project support

## Delivery Phases

### Phase 1: Stabilize the current system

Goal: make the current dashboard less painful while the new one is built.

Changes:

- make one dashboard directory authoritative
- remove the other copy or archive it after comparison
- add truthful dependencies to `workspace/dashboard/package.json`
- stop auto-probing every project to find the first with tasks
- add a server-side default project selection endpoint
- exclude test projects from default project lists
- paginate `/api/projects`
- make the UI remember the last chosen project robustly

Expected impact:

- much faster first load
- fewer "blank or frozen" experiences
- lower operator confusion

### Phase 2: Build the new Mission Control homepage in the main frontend

Goal: replace the current homepage with a true operational control panel.

Changes:

- create a new route in `frontend/src/app`
- add summary cards
- add action-required panel
- add active agents panel
- add cron health panel
- add recent activity panel

Expected impact:

- immediate usefulness
- better fit with how OpenClaw is actually operated

### Phase 3: Rebuild project and task views inside the main frontend

Goal: migrate task management without dragging over the old architecture.

Changes:

- projects index page
- selected project task list
- board and timeline as scoped subviews
- audit as a separate project subview

Expected impact:

- preserves useful task features
- removes giant single-file UI complexity

### Phase 4: Operational integrity

Goal: make the dashboard trustworthy.

Changes:

- surface dependency violations directly
- surface missing QMD directories or config drift
- add fixture/test-data indicators
- add last successful sync timestamps
- add empty/loading/error states for every panel

Expected impact:

- operators trust the dashboard
- faster troubleshooting

### Phase 5: Sunset the old standalone dashboard

Goal: remove the maintenance burden.

Changes:

- freeze old dashboard to read-only or retire it
- redirect operators to the new frontend route
- keep legacy APIs only if still needed by scripts

Expected impact:

- one source of truth
- simpler testing
- less code drift

## Concrete First Sprint

If you want the highest-value first sprint, do this:

1. Add a server-side "default project" endpoint or pinned-project logic.
2. Hide test projects from the default project list.
3. Paginate `/api/projects`.
4. Stop sequential project probing in the frontend.
5. Build a simple Mission Control page in the main frontend with:
   - action required
   - active agents
   - cron health
   - recent activity
   - top active projects

That sprint alone will deliver a dashboard that feels much more reliable.

## Success Metrics

Use these as acceptance criteria:

- first meaningful paint under 2 seconds on localhost
- homepage loads without scanning all projects
- default landing page shows urgent issues without requiring project selection
- project table supports pagination and search
- operators can reach active tasks, cron issues, and approvals in one click
- no duplicated dashboard codebase remains in active use

## Decision

Recommendation: rebuild, not beautify.

Keep the existing backend where useful, but move the user experience into the main OpenClaw frontend and narrow the homepage to operational control. The current standalone dashboard is carrying too many responsibilities and too much architectural drift to be the right long-term foundation.
