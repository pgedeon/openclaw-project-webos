# OpenClaw Business Operations Dashboard Plan

## Purpose

This document is the implementation-ready plan for evolving the current OpenClaw dashboard into a business operations control plane.

The target system is not just a task board.

It must become a system where:

1. agents are modeled as business roles with explicit responsibilities
2. work enters through structured business requests
3. work is routed through repeatable workflow templates
4. operators can see live execution, blockers, approvals, artifacts, and outcomes
5. departments and business units have measurable performance

This plan is written so OpenClaw can implement it with minimal ambiguity.

---

## Implementation Progress Tracking

**Current Phase**: Completed Through Phase 9
**Started**: 2026-03-12
**Last Updated**: 2026-03-12 16:11 CET

### Phase Status

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| Phase 0: Stabilize | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 1: Organization & Agent Profiles | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 2: Service Catalog & Requests | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 3: Service Requests → Workflows | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 4: Artifacts & Run Details | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 5: Workflow-Aware Approvals | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 6: Blocker Intelligence & Escalation | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 7: Department Operating Views | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 8: Business Metrics & Scorecards | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |
| Phase 9: Governance & Audit | 🟢 Complete | 2026-03-12 | 2026-03-12 | Complete |

**Legend**: 🟢 Complete | 🟡 In Progress | ⚪ Not Started | 🔴 Blocked

---

## Source Of Truth

OpenClaw must treat the following directory as the only implementation source for this dashboard work:

- `/root/.openclaw/workspace/dashboard`

There are other copies of dashboard code under workflow workspaces. Do not use them as the primary implementation target unless a later sync step explicitly requires it.

Primary implementation files:

- `/root/.openclaw/workspace/dashboard/task-server.js`
- `/root/.openclaw/workspace/dashboard/storage/asana.js`
- `/root/.openclaw/workspace/dashboard/workflow-runs-api.js`
- `/root/.openclaw/workspace/dashboard/dashboard.html`
- `/root/.openclaw/workspace/dashboard/src/dashboard-integration-optimized.mjs`
- `/root/.openclaw/workspace/dashboard/src/agent-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/agents-page.mjs`
- `/root/.openclaw/workspace/dashboard/schema/openclaw-dashboard.sql`
- `/root/.openclaw/workspace/dashboard/schema/migrations/*`
- `/root/.openclaw/workspace/dashboard/scripts/dashboard-validation.js`

---

## Implementation Rules

These rules are mandatory.

### Rule 1: Use additive database migrations

Do not rewrite base schema files as the only source of change.

Every schema change must be added as a new migration under:

- `/root/.openclaw/workspace/dashboard/schema/migrations/`

Existing data must remain valid.

### Rule 2: Preserve current dashboard behavior while extending it

Do not break:

- existing board views
- existing task CRUD
- existing agent queue views
- existing workflow run endpoints
- existing approvals if already present

New functionality should be layered on top.

### Rule 3: Keep backend contracts explicit

For every new feature, define:

- table or view changes
- storage-layer methods
- API endpoints
- request payloads
- response payloads
- UI consumers

No hidden coupling.

### Rule 4: Do not make the browser parse `openclaw.json` directly

The browser must consume normalized API data from the dashboard backend.

All config parsing belongs on the server side.

### Rule 5: Use explicit metadata, not heuristics, for business modeling

Do not infer department, business role, or authority from workspace path alone.

Workspace path may be shown in the UI, but business structure must come from explicit records.

### Rule 6: Keep agent ids stable

Agent ids must continue to match configured OpenClaw agent ids from:

- `/root/.openclaw/openclaw.json`

Do not rename ids in the dashboard layer.

### Rule 7: Add tests and validation for every phase

At minimum:

- update backend API tests where behavior changes
- update frontend tests where rendering or filtering changes
- run `node scripts/dashboard-validation.js`

### Rule 8: Prefer modular route files over growing `task-server.js`

`task-server.js` already contains many concerns.

New major features should be implemented in separate route modules and then mounted by `task-server.js`.

Recommended new backend modules:

- `org-api.js`
- `service-requests-api.js`
- `artifacts-api.js`
- `metrics-api.js`
- `approvals-api.js`

---

## Current Baseline

The current dashboard already includes important primitives:

- projects and tasks
- board view and timeline view
- agent queue and heartbeat views
- workflow runs API
- approvals migration
- blocker classification migration
- workflow queue state migration
- agent overview page

Important existing implementation facts:

1. `workflow_runs`, `workflow_steps`, and `workflow_templates` already exist in migration `001_add_workflow_runs.sql`.
2. expanded task states already exist in migration `002_add_workflow_queues.sql`.
3. workflow approvals already exist in migration `003_add_approvals.sql`.
4. blocker classification already exists in migration `004_add_blocker_classification.sql`.
5. `agent_heartbeats` and `task_runs` already exist in migration `20260216_add_agent_observability.sql`.
6. the current agents overview page still groups agents using heuristics in `/root/.openclaw/workspace/dashboard/src/agents-page.mjs`.
7. the current agent view is still queue-first, not department-first.

Conclusion:

The next work is not "start from scratch."

The next work is:

- normalize the business model
- connect existing workflow concepts to that model
- build business and department views on top

---

## Target Operating Model

The dashboard should model the business in five layers.

### Layer 1: Organization

The business structure.

Examples:

- Executive / Main Control
- Content Operations
- Engineering
- Publishing
- Automation Operations
- Security
- Research

### Layer 2: Agent Profiles

Each agent becomes a business role.

Examples:

- `main` -> executive dispatcher
- `3dput` -> business-unit lead for 3dput
- `affiliate-editorial` -> content pipeline lead
- `coder` -> engineering executor
- `qa-auditor` -> quality gate

### Layer 3: Service Catalog

Work should enter the system as a business service request, not just a generic task.

Examples:

- publish affiliate article
- investigate site incident
- deploy code change
- generate image pack
- audit workflow
- research topic cluster

### Layer 4: Workflow Execution

A service request becomes one or more workflow runs.

Each run must track:

- owner
- current step
- live session binding
- approvals
- artifacts
- blockers
- outcome

### Layer 5: Business Metrics

The dashboard must show outcomes, not just activity.

Examples:

- publish success rate
- median approval latency
- blocked work by department
- tasks completed per agent
- defect rate after publish
- site-specific output scorecards

---

## Domain Model To Implement

This is the canonical new business model.

### 1. `departments`

Purpose:

- explicit business grouping for agents and workflows

Required columns:

- `id UUID PRIMARY KEY`
- `slug TEXT UNIQUE NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `lead_agent_id TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Allowed status values:

- `active`
- `paused`
- `archived`

Initial rows:

- `executive`
- `content-operations`
- `publishing`
- `engineering`
- `automation-operations`
- `security`
- `research`

### 2. `agent_profiles`

Purpose:

- make each OpenClaw agent a first-class business role

Required columns:

- `id UUID PRIMARY KEY`
- `agent_id TEXT UNIQUE NOT NULL`
- `display_name TEXT NOT NULL`
- `department_id UUID NOT NULL REFERENCES departments(id)`
- `role_kind TEXT NOT NULL`
- `responsibility_summary TEXT NOT NULL DEFAULT ''`
- `manager_agent_id TEXT NULL`
- `is_human_facing BOOLEAN NOT NULL DEFAULT false`
- `can_approve BOOLEAN NOT NULL DEFAULT false`
- `can_launch_workflows BOOLEAN NOT NULL DEFAULT false`
- `sla_target_minutes INTEGER NULL`
- `max_concurrency INTEGER NULL`
- `cost_weight NUMERIC NULL`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Examples of `role_kind`:

- `executive`
- `department-lead`
- `specialist`
- `reviewer`
- `publisher`
- `operator`
- `automation`

Required metadata keys:

- `capabilities`: string array
- `owned_sites`: string array
- `workflow_types`: string array
- `approval_types`: string array

### 3. `service_catalog`

Purpose:

- define the kinds of business requests the dashboard can intake

Required columns:

- `id UUID PRIMARY KEY`
- `slug TEXT UNIQUE NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `department_id UUID NOT NULL REFERENCES departments(id)`
- `default_workflow_template_id UUID NULL REFERENCES workflow_templates(id)`
- `default_owner_agent_id TEXT NULL`
- `intake_schema JSONB NOT NULL DEFAULT '{}'`
- `success_definition JSONB NOT NULL DEFAULT '{}'`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Initial services:

- `affiliate-article`
- `image-pack`
- `wordpress-publish`
- `site-fix`
- `incident-investigation`
- `code-change`
- `qa-review`
- `topic-research`

### 4. `service_requests`

Purpose:

- top-level intake objects representing business work requested by a human, schedule, or agent

Required columns:

- `id UUID PRIMARY KEY`
- `service_id UUID NOT NULL REFERENCES service_catalog(id)`
- `project_id UUID NULL REFERENCES projects(id)`
- `task_id UUID NULL REFERENCES tasks(id)`
- `requested_by TEXT NOT NULL`
- `requested_for TEXT NULL`
- `title TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL DEFAULT 'new'`
- `priority TEXT NOT NULL DEFAULT 'medium'`
- `target_department_id UUID NULL REFERENCES departments(id)`
- `target_agent_id TEXT NULL`
- `input_payload JSONB NOT NULL DEFAULT '{}'`
- `routing_decision JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Allowed `status` values:

- `new`
- `triaged`
- `planned`
- `running`
- `waiting_for_approval`
- `blocked`
- `completed`
- `failed`
- `cancelled`

### 5. Extend `workflow_templates`

Do not replace the existing table.

Add these columns:

- `department_id UUID NULL REFERENCES departments(id)`
- `service_id UUID NULL REFERENCES service_catalog(id)`
- `input_schema JSONB NOT NULL DEFAULT '{}'`
- `artifact_contract JSONB NOT NULL DEFAULT '{}'`
- `blocker_policy JSONB NOT NULL DEFAULT '{}'`
- `escalation_policy JSONB NOT NULL DEFAULT '{}'`
- `runbook_ref TEXT NULL`
- `ui_category TEXT NOT NULL DEFAULT 'general'`

Purpose:

- connect template to department and business service
- define inputs, outputs, artifacts, approvals, and escalation

### 6. Extend `workflow_runs`

Do not replace the existing table.

Add these columns:

- `service_request_id UUID NULL REFERENCES service_requests(id) ON DELETE SET NULL`
- `department_id UUID NULL REFERENCES departments(id) ON DELETE SET NULL`
- `run_priority TEXT NULL`
- `approval_state TEXT NULL`
- `outcome_code TEXT NULL`
- `operator_notes TEXT NULL`
- `expected_artifact_count INTEGER NOT NULL DEFAULT 0`
- `actual_artifact_count INTEGER NOT NULL DEFAULT 0`
- `value_score NUMERIC NULL`
- `customer_scope TEXT NULL`

Purpose:

- make workflow runs business-aware

### 7. `workflow_artifacts`

Purpose:

- track concrete run outputs

Required columns:

- `id UUID PRIMARY KEY`
- `workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE`
- `task_id UUID NULL REFERENCES tasks(id) ON DELETE SET NULL`
- `artifact_type TEXT NOT NULL`
- `label TEXT NOT NULL`
- `uri TEXT NOT NULL`
- `mime_type TEXT NULL`
- `status TEXT NOT NULL DEFAULT 'generated'`
- `metadata JSONB NOT NULL DEFAULT '{}'`
- `created_by TEXT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Artifact types should include:

- `draft`
- `image`
- `screenshot`
- `publish_receipt`
- `validation_report`
- `log`
- `url`
- `diff`

### 8. Extend `workflow_approvals`

Add:

- `approval_type TEXT NOT NULL DEFAULT 'general'`
- `department_id UUID NULL REFERENCES departments(id)`
- `artifact_id UUID NULL REFERENCES workflow_artifacts(id) ON DELETE SET NULL`
- `expires_at TIMESTAMPTZ NULL`
- `escalation_status TEXT NULL`

Purpose:

- allow approvals to attach to specific stages and outputs

### 9. `department_daily_metrics`

Purpose:

- store computed metrics snapshots for trend charts

Required columns:

- `id UUID PRIMARY KEY`
- `department_id UUID NOT NULL REFERENCES departments(id)`
- `metric_date DATE NOT NULL`
- `metrics JSONB NOT NULL DEFAULT '{}'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Unique key:

- `(department_id, metric_date)`

---

## Initial Agent To Department Mapping

OpenClaw should seed these mappings first.

### Executive

- `main`

### Content Operations

- `affiliate-editorial`
- `topic-planner`
- `product-finder`
- `seo-rewriter`
- `benchmark-labs-writer`
- `video-discoverer`

### Publishing

- `blogger-publisher`
- `blogger-affiliate-manager`
- `blogger-inventory`
- `image-source-selector`
- `image-prompt-writer`
- `comfyui-image-agent`
- `image-qa`

### Engineering

- `coder`
- `feature-dev_planner`
- `feature-dev_setup`
- `feature-dev_developer`
- `feature-dev_verifier`
- `feature-dev_tester`
- `feature-dev_reviewer`
- `bug-fix_triager`
- `bug-fix_investigator`
- `bug-fix_setup`
- `bug-fix_fixer`
- `bug-fix_verifier`
- `bug-fix_pr`

### Automation Operations

- `serial-automator`
- `antfarm-medic`
- `3dput`
- `sailboats-fr`
- `sailboats-fr-jobs`
- `us-spending-integrity`

### Security

- `security-audit_scanner`
- `security-audit_prioritizer`
- `security-audit_setup`
- `security-audit_fixer`
- `security-audit_verifier`
- `security-audit_tester`
- `security-audit_pr`

### Quality And Review

- `qa-auditor`
- `vision-agent`

This mapping must live in seed data or a controlled bootstrap script, not only in frontend code.

---

## Backend API Plan

All new backend endpoints must be mounted from `task-server.js` through small route modules.

### A. Organization API

Create:

- `GET /api/org/departments`
- `GET /api/org/departments/:id`
- `POST /api/org/departments`
- `PATCH /api/org/departments/:id`
- `GET /api/org/agents`
- `GET /api/org/agents/:agentId`
- `PATCH /api/org/agents/:agentId`

`GET /api/org/agents` response must include:

- agent id
- display name
- department
- role kind
- manager
- capabilities
- permissions
- current presence
- queue summary
- active workflow run summary

### B. Service Catalog API

Create:

- `GET /api/services`
- `GET /api/services/:id`
- `POST /api/services`
- `PATCH /api/services/:id`

Response must include:

- service metadata
- default workflow template
- default department
- default owner agent
- input schema
- success definition

### C. Service Request API

Create:

- `GET /api/service-requests`
- `GET /api/service-requests/:id`
- `POST /api/service-requests`
- `PATCH /api/service-requests/:id`
- `POST /api/service-requests/:id/route`
- `POST /api/service-requests/:id/launch`

`POST /api/service-requests/:id/launch` must:

1. validate service request state
2. resolve workflow template
3. create workflow run
4. optionally bind to task and project
5. return created workflow run id

### D. Workflow Run API Extensions

Extend existing workflow runs endpoints to include:

- service request summary
- department summary
- artifact summary
- approval summary
- blocker summary
- outcome summary

Add endpoints:

- `GET /api/workflow-runs/:id/artifacts`
- `POST /api/workflow-runs/:id/artifacts`
- `GET /api/workflow-runs/:id/approvals`
- `POST /api/workflow-runs/:id/request-approval`
- `POST /api/workflow-runs/:id/escalate`
- `POST /api/workflow-runs/:id/pause`
- `POST /api/workflow-runs/:id/resume`
- `POST /api/workflow-runs/:id/cancel`

### E. Approvals API

Create:

- `GET /api/approvals`
- `GET /api/approvals/:id`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`
- `POST /api/approvals/:id/cancel`

### F. Metrics API

Create:

- `GET /api/metrics/org`
- `GET /api/metrics/departments`
- `GET /api/metrics/departments/:id`
- `GET /api/metrics/agents`
- `GET /api/metrics/services`
- `GET /api/metrics/sites`

---

## Frontend UI Plan

The frontend should be extended, not replaced.

### 1. New top-level views

Add the following views:

- `Org`
- `Departments`
- `Service Requests`
- `Approvals`
- `Artifacts`
- `Metrics`

Recommended new frontend modules:

- `/root/.openclaw/workspace/dashboard/src/org-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/departments-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/service-requests-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/approvals-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/artifacts-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/metrics-view.mjs`

### 2. Upgrade `agents-page.mjs`

Replace current workspace-based grouping logic with department-based grouping.

Current problem:

- groups are derived from id and workspace path heuristics

Required change:

- fetch explicit org agent profiles from backend
- render by department
- show manager, authority, capability tags, SLA target, and workload

New agent card fields:

- display name
- department
- role kind
- manager
- current activity
- ready tasks
- active runs
- blocked runs
- approval load
- SLA health

### 3. Upgrade `agent-view.mjs`

The current agent view is task queue oriented.

It should become a business execution console for one agent.

Required additions:

- active workflow run panel
- pending approvals owned by this agent
- artifacts produced in last 24 hours
- blocker history
- service mix breakdown
- recent failure reasons

### 4. Upgrade task cards in `dashboard-integration-optimized.mjs`

Task cards should show:

- active workflow run badge
- service request badge
- current step
- approval state
- blocker type
- artifact count

Task detail modal should show:

- service request summary
- workflow timeline
- artifacts list
- approvals list
- live session binding
- operator actions

### 5. Add department pages

Each department page must show:

- department lead
- staffed agents
- queue totals
- blocked work
- approval wait time
- service mix
- workflow success rate
- recent artifacts

### 6. Add a business intake form

A new request form should allow:

- selecting service type
- entering structured input payload
- choosing urgency
- choosing target business unit
- optionally linking an existing project/task

This should create a `service_request`, not a raw task only.

---

## Detailed Phase Plan

## Phase 0: Stabilize The Current Codebase

### Goal

Reduce implementation risk before adding more features.

### Tasks

1. Confirm `/root/.openclaw/workspace/dashboard` is the source of truth.
2. Audit existing workflow and approvals migrations to confirm they are applied.
3. Extract new route families out of `task-server.js` into separate files.
4. Add a lightweight backend health endpoint that confirms:
 - database reachable
 - required tables exist
 - migrations applied
5. Add a dashboard developer note documenting route modules and source-of-truth rules.

### Deliverables

- route module layout
- migration status check
- updated development docs

### Acceptance Criteria

- dashboard starts normally
- existing views still work
- no endpoint regressions
- route registration is modular enough for later phases

---

## Phase 1: Add Explicit Organization And Agent Profile Modeling

### Goal

Replace heuristic agent grouping with real business metadata.

### Backend

1. Add migration for `departments`.
2. Add migration for `agent_profiles`.
3. Add seed data for initial departments and agent mappings.
4. Add storage methods:
 - `listDepartments`
 - `getDepartment`
 - `createDepartment`
 - `updateDepartment`
 - `listAgentProfiles`
 - `getAgentProfile`
 - `updateAgentProfile`
5. Add org API endpoints.

### Frontend

1. Replace `buildAgentZone()` heuristics in `agents-page.mjs`.
2. Fetch org agent profile data from backend.
3. Render agent groups by department.
4. Add agent detail fields:
 - role
 - manager
 - capabilities
 - authority flags
 - SLA

### Acceptance Criteria

- every configured agent appears in exactly one department
- no agent grouping relies on workspace path for department classification
- org API returns normalized profiles
- agents page renders without heuristic zoning logic

---

## Phase 2: Add Service Catalog And Service Requests

### Goal

Make business work enter as structured requests.

### Backend

1. Add migration for `service_catalog`.
2. Add migration for `service_requests`.
3. Seed initial service catalog rows.
4. Add storage methods:
 - `listServices`
 - `getService`
 - `createServiceRequest`
 - `updateServiceRequest`
 - `routeServiceRequest`
5. Add service and service-request APIs.

### Frontend

1. Add `Service Requests` view.
2. Add intake form for business requests.
3. Allow linking service request to project/task.
4. Add request list filters:
 - status
 - department
 - service type
 - owner

### Acceptance Criteria

- operator can create a service request without manually creating a task first
- service request can be routed to a department or specific agent
- service request can launch a workflow template

---

## Phase 3: Connect Service Requests To Workflow Templates And Runs

### Goal

Make workflow execution business-aware.

### Backend

1. Extend `workflow_templates`.
2. Extend `workflow_runs`.
3. Add `POST /api/service-requests/:id/launch`.
4. Ensure launch flow:
 - validates service request
 - selects template
 - creates workflow run
 - links service request id
 - links task/project where relevant
5. Add run status normalization for UI consumers.

### Frontend

1. Add launch action in service request detail.
2. Show workflow template summary before launch.
3. Show current workflow run linked to request.

### Acceptance Criteria

- every launched business request creates a workflow run with `service_request_id`
- workflow run detail includes department and service context
- operators can trace request -> run -> task

---

## Phase 4: Add Artifacts And Rich Run Details

### Goal

Make outputs inspectable.

### Backend

1. Add migration for `workflow_artifacts`.
2. Add artifact API endpoints.
3. Add storage methods:
 - `listWorkflowArtifacts`
 - `createWorkflowArtifact`
4. Extend workflow run detail endpoint to include artifacts.

### Frontend

1. Add artifacts panel to task detail.
2. Add artifacts panel to workflow run detail.
3. Add dedicated `Artifacts` view with filters:
 - workflow type
 - artifact type
 - status
 - agent
 - site

### Acceptance Criteria

- artifacts can be attached to workflow runs
- artifacts are visible from task, run, and dedicated artifact views
- artifact counts appear on run and task surfaces

---

## Phase 5: Make Approvals Workflow-Aware

### Goal

Turn approvals into stage-level business gates.

### Backend

1. Extend `workflow_approvals`.
2. Add approval-specific endpoints.
3. Add support for approval requests referencing artifacts.
4. Add expiration and escalation support.
5. Add approval summary on workflow run detail.

### Frontend

1. Add `Approvals` inbox view.
2. Add approval cards with:
 - approval type
 - requesting run
 - requesting agent
 - artifact preview links
 - due time
3. Add approve/reject UI with required note field.

### Acceptance Criteria

- approvals can be created for a run step
- approvals can reference specific artifacts
- run state changes to `waiting_for_approval` when required
- approval actions are visible in audit trail

---

## Phase 6: Add Blocker Intelligence And Escalation

### Goal

Make the dashboard proactive about stuck work.

### Backend

1. Normalize blocker types across tasks and runs.
2. Add stuck-work detection rules:
 - no heartbeat
 - stale step
 - repeated retries
 - approval timeout
 - active task with no session
3. Add escalation API for runs and approvals.
4. Add summary queries for blocked work by department and type.

### Frontend

1. Add blocker panels to:
 - org view
 - department view
 - agent detail
2. Show escalation state and next action.
3. Add operator controls:
 - reassign
 - escalate
 - pause
 - resume

### Acceptance Criteria

- blocked work is classified
- stuck runs can be listed from backend
- department view shows blocker counts by type
- escalations are visible and auditable

---

## Phase 7: Add Department Operating Views

### Goal

Make the dashboard feel like a business operating system.

### Department page sections

Each department view must have:

1. `Overview`
 - lead
 - staffed agents
 - service lines
 - current workload

2. `Work Queue`
 - open service requests
 - active runs
 - blocked work
 - overdue items

3. `Approvals`
 - pending
 - expired
 - average approval time

4. `Artifacts`
 - recent outputs
 - failed outputs
 - verification reports

5. `Reliability`
 - success rate
 - retry rate
 - stale run count
 - failure reasons

### Acceptance Criteria

- each department has a coherent dashboard page
- business leads can manage work without switching to raw task tables
- agent staffing and output quality are visible in one place

---

## Phase 8: Add Business Metrics And Scorecards

### Goal

Measure results, not just activity.

### Backend

1. Add `department_daily_metrics`.
2. Add scheduled metric aggregation job.
3. Add metrics endpoints.

### Required metrics

#### Department metrics

- service requests opened
- service requests completed
- workflow runs started
- workflow runs completed
- workflow success rate
- blocked time
- approval latency
- median completion time

#### Agent metrics

- active workload
- completion count
- failure count
- retry count
- stale run count
- approval burden

#### Site metrics

For `3dput` and `sailboats-fr`:

- drafts created
- drafts approved
- posts published
- image pass rate
- publish verification pass rate
- publish defect rate

### Acceptance Criteria

- metrics page shows org, department, agent, and site scorecards
- metrics are queryable by date range
- metrics are based on workflow/run/approval/artifact data, not only raw task counts

---

## Phase 9: Governance, Audit, And Operator Safety

### Goal

Make the system safe to use for real business operations.

### Required additions

1. role-based action control for:
 - launch workflow
 - approve
 - reject
 - cancel run
 - override failure
 - reassign owner
2. operator audit trail for:
 - run launches
 - run stops
 - approval decisions
 - reassignments
 - escalation actions
3. runbooks and playbooks embedded in UI

### Acceptance Criteria

- privileged actions are logged
- runbooks are visible from workflow template and run detail
- operator actions are queryable from the audit view

---

## File-Level Implementation Guidance

Use this mapping when implementing.

### Database

Add new migrations under:

- `/root/.openclaw/workspace/dashboard/schema/migrations/`

Do not edit old migrations in place.

### Storage Layer

Extend:

- `/root/.openclaw/workspace/dashboard/storage/asana.js`

If the file becomes too large, split into:

- `storage/org.js`
- `storage/services.js`
- `storage/workflows.js`
- `storage/metrics.js`

### Route Layer

Keep `task-server.js` as the entrypoint, but move new route logic into:

- `/root/.openclaw/workspace/dashboard/org-api.js`
- `/root/.openclaw/workspace/dashboard/service-requests-api.js`
- `/root/.openclaw/workspace/dashboard/artifacts-api.js`
- `/root/.openclaw/workspace/dashboard/approvals-api.js`
- `/root/.openclaw/workspace/dashboard/metrics-api.js`

### Frontend

Extend:

- `/root/.openclaw/workspace/dashboard/src/dashboard-integration-optimized.mjs`
- `/root/.openclaw/workspace/dashboard/src/agent-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/agents-page.mjs`

Add:

- `/root/.openclaw/workspace/dashboard/src/org-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/departments-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/service-requests-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/approvals-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/artifacts-view.mjs`
- `/root/.openclaw/workspace/dashboard/src/metrics-view.mjs`

### HTML Navigation

Update:

- `/root/.openclaw/workspace/dashboard/dashboard.html`

Add nav entries for new views and any new modal shells needed by the new modules.

---

## Testing And Validation Plan

For each phase:

1. add or update backend tests
2. add or update frontend tests where rendering logic changes
3. run validation script
4. manually verify changed views

### Required commands

From `/root/.openclaw/workspace/dashboard`:

```bash
npm install
node scripts/dashboard-validation.js
```

Run relevant tests:

```bash
node tests/test-saved-views-api.js
npm test
```

If a new backend route module is added, add at least one API test per route family.

If a new migration is added, verify it applies cleanly to a database that already has all current migrations.

---

## Rollout Strategy

Use this rollout order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

Do not implement all phases in one change set.

Preferred change granularity:

- one migration family per PR/change set
- one backend route family per PR/change set
- one frontend major view per PR/change set

---

## Definition Of Done

This project is considered complete when all of the following are true:

1. every OpenClaw agent can be shown as a business role with explicit metadata
2. work can enter through a business service request flow
3. service requests can launch workflow runs
4. workflow runs show live execution state, blockers, approvals, and artifacts
5. operators can manage departments, not just isolated tasks
6. scorecards show business outcomes by department, agent, and site
7. auditability and operator safety are built in

---

## Immediate Next Step

Implement these first, in this exact order:

1. Phase 0 stabilization
2. `departments` migration
3. `agent_profiles` migration
4. org API
5. department-based agents page update

That is the cleanest foundation for everything else in this document.
