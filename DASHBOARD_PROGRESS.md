# Dashboard Business Operations - Progress Tracker

**Last Updated**: 2026-03-13 15:15 CET
**Current Phase**: Phase 9 complete + Batch A complete

## Post-Phase Sprint: Batch A Shell And View Extraction ✅ COMPLETE

**Backlog**: `BATCH_A_SPRINT_BACKLOG.md`

- [x] Task A-01 slice: Introduce a registry-driven view router in `src/dashboard-integration-optimized.mjs`
- [x] Task A-01 slice: Repair broken `memory` and `audit` routing paths
- [x] Task A-02 slice: Extract support views into `src/views/support-views.mjs`
- [x] Task A-03: Navigation readability pass in `dashboard.html`
- [x] Task A-03 slice: Add first-class `Skills & Tools` page entry points from dashboard and agents navigation
- [x] Task A-04 slice: Create dedicated `skills-tools.html` and standalone page bootstrap module
- [x] Task A-04: Extract heavy embedded views
- [x] Task A-04 slice: Extract `publish`, `metrics`, and `skills-tools` into `src/views/*.mjs`
- [x] Task A-05: Extend regression coverage and docs
- [x] Task A-05 slice: Disable stale dashboard service worker behavior on local dev hosts

### Batch A Validation

- ✅ `node --check src/dashboard-integration-optimized.mjs`
- ✅ `node --check task-server.js`
- ✅ `node --check src/view-registry.mjs`
- ✅ `node --check src/views/support-views.mjs`
- ✅ `node --check src/views/publish-view.mjs`
- ✅ `node --check src/views/metrics-view.mjs`
- ✅ `node --check src/views/skills-tools-view.mjs`
- ✅ `node --check src/views/departments-view.mjs`
- ✅ `node --check src/views/service-requests-view.mjs`
- ✅ `node --check src/views/approvals-view.mjs`
- ✅ `node --check src/views/artifacts-view.mjs`
- ✅ `node tests/test-dashboard-navigation.js`
- ✅ `node tests/test-skills-tools-entrypoint.js`
- ✅ `node --check sw.js`
- ✅ `node tests/test-local-dev-service-worker.js`
- ✅ `node --check src/skills-tools-page.mjs`
- ✅ `node tests/test-skills-tools-page.js`
- ✅ `node tests/test-view-router.js`
- ✅ `node tests/test-approvals-view.js`
- ✅ `node tests/test-publish-view.js`
- ✅ `node tests/test-skills-tools-view.js`
- ✅ `node tests/test-departments-view.js`
- ✅ `node tests/test-artifacts-view.js`
- ✅ `node tests/test-metrics-view.js`
- ✅ `node tests/test-service-requests-view.js`
- ✅ `node tests/test-extracted-views-registry.js`
- ⚠️ `node scripts/dashboard-validation.js` cannot complete in this sandbox because PostgreSQL on `127.0.0.1:5432` is not reachable
- ⚠️ `node tests/test-filter-behavior.js` cannot complete in this sandbox because Playwright Chromium is blocked by the container sandbox

---

## Phase 0: Stabilize The Current Codebase ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 0.1: Confirm source of truth
- [x] Task 0.2: Audit migrations
- [x] Task 0.3: Extract route families (`projects-api.js`)
- [x] Task 0.4: Enhanced health endpoint
- [x] Task 0.5: Developer guide

---

## Phase 1: Explicit Organization And Agent Profile Modeling ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 1.1: Migration for `departments` table (006)
- [x] Task 1.2: Migration for `agent_profiles` table (007)
- [x] Task 1.3: Seed data for departments and agent profiles
- [x] Task 1.4: Storage methods for org data
- [x] Task 1.5: Org API endpoints
- [x] Task 1.6: Frontend uses explicit department data
- [x] Task 1.7: Backend returns department-enriched agent profiles
- [x] Task 1.8: Agents page renders by department grouping

### Validation Results

- ✅ Agents page groups by department instead of workspace heuristics
- ✅ Org API returns department and agent profile data
- ✅ Dashboard codebase includes explicit org bootstrap metadata

---

## Phase 2: Service Catalog And Service Requests ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 2.1: Add migration for `service_catalog` table (008)
- [x] Task 2.2: Add migration for `service_requests` table (009)
- [x] Task 2.3: Harmonize business service catalog rows (010)
- [x] Task 2.4: Add storage methods for services and service requests
- [x] Task 2.5: Add service and service-request API endpoints
- [x] Task 2.6: Add `Service Requests` dashboard view
- [x] Task 2.7: Add business intake form with service-specific fields
- [x] Task 2.8: Allow linking service requests to project/task
- [x] Task 2.9: Add request filters, routing, and workflow launch actions

### Validation Results

- ✅ `node tests/test-service-requests-api.js` passes
- ✅ `node tests/test-service-requests-view.js` passes
- ✅ `node tests/test-extracted-views-registry.js`
- ✅ Service request intake, routing, and launch surfaces are wired in the dashboard

### Business Services Added / Harmonized

1. Affiliate Article
2. Image Pack
3. WordPress Publish
4. Site Fix
5. Incident Investigation
6. Code Change
7. QA Review
8. Topic Research

---

## Phase 3: Connect Service Requests To Workflow Templates And Runs ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 3.1: Extend `workflow_templates` with department/service/input metadata (011)
- [x] Task 3.2: Extend `workflow_runs` with service-request and business context (011)
- [x] Task 3.3: Persist linked `service_request_id` during workflow launch
- [x] Task 3.4: Expose department/service/template context on workflow run detail
- [x] Task 3.5: Normalize workflow run status for UI consumers
- [x] Task 3.6: Show workflow template summary in service request detail
- [x] Task 3.7: Show linked workflow run trace in service request detail

### Validation Results

- ✅ `node tests/test-service-requests-api.js` passes with run-linkage assertions
- ✅ `node tests/test-workflow-runs-business-context.js` passes
- ✅ Service request detail surfaces template and run traceability

---

## Phase 4: Add Artifacts And Rich Run Details ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 4.1: Add migration for `workflow_artifacts` table (012)
- [x] Task 4.2: Add artifact storage and API methods on workflow runs
- [x] Task 4.3: Add `GET /api/artifacts`
- [x] Task 4.4: Add `GET /api/workflow-runs/:id/artifacts`
- [x] Task 4.5: Add `POST /api/workflow-runs/:id/artifacts`
- [x] Task 4.6: Extend workflow run detail endpoint to include artifacts
- [x] Task 4.7: Add artifacts panel to workflow run detail modal
- [x] Task 4.8: Add dedicated `Artifacts` dashboard view with filters
- [x] Task 4.9: Show artifact counts on existing task/run surfaces

### Validation Results

- ✅ `node tests/test-workflow-artifacts-api.js` passes
- ✅ `node tests/test-artifacts-view.js` passes
- ✅ Workflow run detail now includes artifact data and a recorded-artifacts panel

---

## Phase 5: Add Approval Inbox And Approval Actions ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 5.1: Extend `workflow_approvals` with approval type, artifact link, due/expiration, escalation, and decision metadata (013)
- [x] Task 5.2: Add approval-aware workflow API methods and route handlers
- [x] Task 5.3: Support artifact-linked approvals on create/list flows
- [x] Task 5.4: Update workflow runs to `waiting_for_approval`, `approved`, or `blocked` based on approval state
- [x] Task 5.5: Write approval request, escalation, and decision events into the audit trail
- [x] Task 5.6: Add `Approvals` inbox dashboard view
- [x] Task 5.7: Add approve/reject controls with required note field
- [x] Task 5.8: Add escalation controls from the inbox
- [x] Task 5.9: Extend workflow run detail modal with approval summary and approval timeline events

### Validation Results

- ✅ `node tests/test-workflow-approvals-api.js` passes
- ✅ `node tests/test-approvals-view.js` passes
- ✅ `node tests/test-workflow-runs-business-context.js` passes with approval summary coverage
- ✅ Existing Phase 2-4 regression tests still pass after Phase 5 changes
- ✅ `node scripts/dashboard-validation.js` passes with 27 checks passing, 0 failures, and 2 warnings
- ✅ `python3 /root/.openclaw/backend/scripts/check_agent_environment.py` passes
- ⚠️ Validation still reports 17 `in_progress` tasks with unmet dependencies
- ⚠️ Validation still reports missing QMD data directory

### Phase 5 Artifacts

1. Migration `013_extend_workflow_approvals.sql`
2. Approval-aware run-state syncing and audit logging in `workflow-runs-api.js`
3. Dedicated `Approvals` inbox and modal approval summary/timeline in `dashboard-integration-optimized.mjs`
4. Regression coverage in `test-workflow-approvals-api.js` and `test-approvals-view.js`

---

## Phase 6: Add Blocker Intelligence And Escalation ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 6.1: Extend `workflow_runs` with blocker-detection, pause, and escalation metadata (014)
- [x] Task 6.2: Normalize blocker classification across workflow runs and tasks
- [x] Task 6.3: Add summary queries for blocked work by department and blocker type
- [x] Task 6.4: Add `GET /api/blockers`
- [x] Task 6.5: Add `GET /api/blockers/summary`
- [x] Task 6.6: Add run operator endpoints for `reassign`, `escalate`, `pause`, and `resume`
- [x] Task 6.7: Add org-level blocker radar to the agents workspace
- [x] Task 6.8: Add department blocker counts and type chips to the agents workspace
- [x] Task 6.9: Add per-agent blocker console with operator controls
- [x] Task 6.10: Add regression coverage for blocker API and agents-page blocker wiring

### Validation Results

- ✅ `node tests/test-workflow-blockers-api.js` passes
- ✅ `node tests/test-agents-page-blockers.js` passes
- ✅ `node tests/test-agents-page-explicit-grouping.js` passes
- ✅ `node tests/test-workflow-approvals-api.js` passes
- ✅ `node tests/test-workflow-artifacts-api.js` passes
- ✅ `node tests/test-workflow-runs-business-context.js` passes
- ✅ `node --check workflow-runs-api.js` passes
- ✅ `node --check src/agents-page.mjs` passes
- ✅ `python3 /root/.openclaw/backend/scripts/check_agent_environment.py` passes
- ⚠️ `node scripts/dashboard-validation.js` could not complete in this sandbox: `connect EPERM 127.0.0.1:5432`

### Phase 6 Artifacts

1. Migration `014_add_workflow_run_blocker_intelligence.sql`
2. Blocker classification, summary queries, and run-control endpoints in `workflow-runs-api.js`
3. Org blocker radar, department blocker chips, and per-agent blocker console in `src/agents-page.mjs`
4. Operator control styling in `agents.html`
5. Regression coverage in `test-workflow-blockers-api.js` and `test-agents-page-blockers.js`

---

## Phase 7: Add Department Operating Views ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 7.1: Add department operating-view aggregation in `org-api.js`
- [x] Task 7.2: Reuse blocker intelligence in department operating-view payloads
- [x] Task 7.3: Add `Departments` view button to the main dashboard
- [x] Task 7.4: Add `renderDepartmentOpsView(state)` to the main dashboard
- [x] Task 7.5: Add `Overview` section with lead, staffing, service lines, and workload
- [x] Task 7.6: Add `Work Queue` section with open requests, active runs, blocked work, and overdue items
- [x] Task 7.7: Add `Approvals`, `Artifacts`, and `Reliability` sections to the department page
- [x] Task 7.8: Add regression coverage for the new org API payload and dashboard wiring

### Validation Results

- ✅ `node tests/test-org-department-operating-view.js` passes
- ✅ `node tests/test-departments-view.js` passes
- ✅ `node tests/test-org-api.js` passes
- ✅ `node tests/test-service-requests-view.js` passes
- ✅ `node tests/test-extracted-views-registry.js`
- ✅ `node tests/test-approvals-view.js` passes
- ✅ `node tests/test-artifacts-view.js` passes
- ✅ `node --check org-api.js` passes
- ✅ `node --check src/dashboard-integration-optimized.mjs` passes
- ✅ `python3 /root/.openclaw/backend/scripts/check_agent_environment.py` passes
- ⚠️ `node scripts/dashboard-validation.js` was not rerun in this sandbox because localhost PostgreSQL access is restricted here

### Phase 7 Artifacts

1. Department operating-view aggregation and `/api/org/departments/:id/operating-view` in `org-api.js`
2. Dedicated `Departments` operating console in `src/dashboard-integration-optimized.mjs`
3. Toolbar entry in `dashboard.html`
4. Regression coverage in `test-org-department-operating-view.js` and `test-departments-view.js`

---

## Phase 8: Add Business Metrics And Scorecards ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 8.1: Add migration for `department_daily_metrics` snapshots (015)
- [x] Task 8.2: Add dedicated `metrics-api.js` route module
- [x] Task 8.3: Add `GET /api/metrics/org`
- [x] Task 8.4: Add `GET /api/metrics/departments`
- [x] Task 8.5: Add `GET /api/metrics/departments/:id`
- [x] Task 8.6: Add `GET /api/metrics/agents`
- [x] Task 8.7: Add `GET /api/metrics/services`
- [x] Task 8.8: Add `GET /api/metrics/sites`
- [x] Task 8.9: Upgrade the `Metrics` dashboard view to org, department, agent, service, and site scorecards
- [x] Task 8.10: Add date-range filtering to the metrics view
- [x] Task 8.11: Add scheduled metrics aggregation job
- [x] Task 8.12: Backfill and surface department trend snapshots from `department_daily_metrics`

### Validation Results

- ✅ `node tests/test-metrics-api.js` passes
- ✅ `node tests/test-metrics-view.js` passes
- ✅ `node tests/test-metrics-snapshot-job.js` passes
- ✅ `node tests/test-org-api.js` passes
- ✅ `node tests/test-departments-view.js` passes
- ✅ `node --check metrics-api.js` passes
- ✅ `node --check scripts/aggregate-department-metrics.js` passes
- ✅ `node --check task-server.js` passes
- ✅ `node --check src/dashboard-integration-optimized.mjs` passes
- ✅ `python3 /root/.openclaw/backend/scripts/check_agent_environment.py` passes
- ⚠️ `node scripts/dashboard-validation.js` could not complete in this sandbox: `connect EPERM 127.0.0.1:5432`

### Phase 8 Artifacts

1. Migration `015_add_department_daily_metrics.sql`
2. Dedicated scorecard endpoints in `metrics-api.js`
3. Main dashboard metrics overhaul in `src/dashboard-integration-optimized.mjs`
4. Department snapshot aggregation script in `scripts/aggregate-department-metrics.js`
5. Daily cron entry in `../crontab/department-metrics-snapshot.cron`
6. Department trend snapshots on `GET /api/metrics/departments/:id`
7. Regression coverage in `test-metrics-api.js`, `test-metrics-view.js`, and `test-metrics-snapshot-job.js`

---

## Phase 9: Governance, Audit, And Operator Safety ✅ COMPLETE

**Status**: ✅ Complete

- [x] Task 9.1: Add governance policy helper and action matrix
- [x] Task 9.2: Enforce role-based control for launch, approve, reject, cancel, override-failure, and reassign actions
- [x] Task 9.3: Add explicit run operator endpoints for `cancel` and `override-failure`
- [x] Task 9.4: Extend audit querying with workflow/entity/governance filters
- [x] Task 9.5: Upgrade the audit view with operator-action and entity controls
- [x] Task 9.6: Surface runbooks and governance policy metadata in workflow template and run detail UI
- [x] Task 9.7: Add regression coverage for governance, audit filtering, and runbook embeds

### Validation Results

- ✅ `node tests/test-workflow-governance.js` passes
- ✅ `node tests/test-audit-view-governance.js` passes
- ✅ `node tests/test-runbook-governance-embeds.js` passes
- ✅ `node tests/test-workflow-runs-business-context.js` passes
- ✅ `node tests/test-service-requests-view.js` passes
- ✅ `node tests/test-extracted-views-registry.js`
- ✅ `node tests/test-departments-view.js` passes
- ✅ `node tests/test-approvals-view.js` passes
- ✅ `node --check workflow-runs-api.js` passes
- ✅ `node --check src/audit-view.mjs` passes
- ✅ `node --check src/dashboard-integration-optimized.mjs` passes
- ✅ `python3 /root/.openclaw/backend/scripts/check_agent_environment.py` passes
- ✅ Host validation on 2026-03-12 passed after restarting the dashboard server: `27` passes, `0` failures, `2` warnings
- ✅ `scripts/dashboard-health.sh status` reports the dashboard healthy on the host after restart
- ✅ `scripts/restart-task-server.sh` successfully restored the live server on `127.0.0.1:3876`
- ✅ Fixed `scripts/smoke-test-dashboard.sh` JSON parsing so the smoke test no longer crashes before cleanup
- ✅ Fixed the false-positive QMD warning in `scripts/dashboard-validation.js` by restoring the real workspace QMD path check
- ✅ Added dependency-status normalization helpers plus a host remediation script for `in_progress` tasks with unmet dependencies

### Phase 9 Artifacts

1. Governance policy helper in `governance.js`
2. Role-aware action enforcement, launch/cancel/override audit logging, and new `cancel` / `override-failure` run endpoints in `workflow-runs-api.js`
3. Governance-aware audit filtering in `storage/asana.js` and `task-server.js`
4. Audit view controls for workflow/operator actions in `src/audit-view.mjs`
5. Runbook and governance surfaces in `src/dashboard-integration-optimized.mjs`
6. Regression coverage in `test-workflow-governance.js`, `test-audit-view-governance.js`, and `test-runbook-governance-embeds.js`
7. Post-Phase 9 dashboard watchdog hardening in `scripts/dashboard-health.sh`, `scripts/restart-task-server.sh`, and `../crontab/dashboard-health.cron`
8. Host-side recovery confirmation and smoke-test repair in `scripts/smoke-test-dashboard.sh`
9. Operational follow-up hardening in `scripts/dashboard-validation.js`, `storage/asana.js`, and `scripts/normalize-task-dependency-statuses.js`

### Post-Phase 9 Operational Follow-Up

- ✅ Added a managed `dashboard-health.cron` file so the watchdog exists in the source-managed cron set again
- ✅ Switched `dashboard-health.sh` to probe `/api/health` instead of `/`
- ✅ Taught the dashboard restart/health scripts to clean up the legacy `dashboard/task-server.pid` file so stale PID state does not linger
- ✅ Live recovery was verified from the host shell on 2026-03-12 after restarting the dashboard
- ✅ Fixed the validation script so it checks `/root/.openclaw/workspace/data/qmd` instead of the nonexistent `dashboard/scripts/data/qmd` path
- ✅ Added `scripts/normalize-task-dependency-statuses.js` to block tasks that still violate dependency ordering
- ✅ Added a `Skills & Tools` dashboard view plus `/api/catalog/skills-tools` so operators can inspect live skill inventory and per-agent tool access
- ✅ Added regression coverage in `tests/test-catalog-api.js` and `tests/test-skills-tools-view.js`
- ℹ️ The remaining live warning should now be only the `17` in-progress tasks with unmet dependencies until the normalization script is run on the host

---

## Migrations Applied

| Migration | Description | Status |
|-----------|-------------|--------|
| 001_add_workflow_runs | Workflow tracking | ✅ |
| 002_add_workflow_queues | Queue management | ✅ |
| 003_add_approvals | Initial approval workflows | ✅ |
| 004_add_blocker_classification | Blocker tracking | ✅ |
| 005_add_migration_tracking | Schema migration tracking | ✅ |
| 006_add_departments | Organizational departments | ✅ |
| 007_add_agent_profiles | Agent-to-department mapping | ✅ |
| 008_add_service_catalog | Service catalog | ✅ |
| 009_add_service_requests | Service request intake | ✅ |
| 010_harmonize_service_catalog | Business service harmonization | ✅ |
| 011_extend_workflow_business_context | Workflow business context | ✅ |
| 012_add_workflow_artifacts | Workflow artifacts | ✅ |
| 013_extend_workflow_approvals | Approval metadata, escalation, and audit support | ✅ |
| 014_add_workflow_run_blocker_intelligence | Run blocker detection, escalation, and pause metadata | ✅ |
| 015_add_department_daily_metrics | Department KPI snapshot table | 🟡 Added on disk, not applied in this sandbox |

---

## API Endpoints

### Org API

- GET /api/org/departments
- GET /api/org/departments/:id
- GET /api/org/departments/:id/operating-view
- GET /api/org/agents
- GET /api/org/agents/:id
- GET /api/org/summary
- PATCH /api/org/agents/:id

### Services API

- GET /api/services
- GET /api/services/:id
- GET /api/service-requests
- POST /api/service-requests
- GET /api/service-requests/:id
- PATCH /api/service-requests/:id
- POST /api/service-requests/:id/route
- POST /api/service-requests/:id/launch

### Workflow API

- GET /api/workflow-runs
- GET /api/workflow-runs/:id
- POST /api/workflow-runs
- POST /api/workflow-runs/:id/cancel
- POST /api/workflow-runs/:id/override-failure
- GET /api/workflow-runs/stuck
- GET /api/workflow-runs/active
- POST /api/workflow-runs/:id/reassign
- POST /api/workflow-runs/:id/escalate
- POST /api/workflow-runs/:id/pause
- POST /api/workflow-runs/:id/resume
- GET /api/workflow-templates
- GET /api/workflow-templates/:name

### Blockers API

- GET /api/blockers
- GET /api/blockers/summary

### Artifacts API

- GET /api/artifacts
- GET /api/workflow-runs/:id/artifacts
- POST /api/workflow-runs/:id/artifacts

### Metrics API

- GET /api/metrics/org
- GET /api/metrics/departments
- GET /api/metrics/departments/:id
- GET /api/metrics/agents
- GET /api/metrics/services
- GET /api/metrics/sites

### Approvals API

- GET /api/workflow-runs/:id/approvals
- POST /api/workflow-runs/:id/approvals
- GET /api/approvals/pending
- PATCH /api/approvals/:id
- POST /api/approvals/:id/escalate

### Health

- GET /api/health
- GET /api/health-status

---

## Modular API Architecture

| Module | Endpoints | Status |
|--------|-----------|--------|
| `projects-api.js` | `/api/projects` CRUD | ✅ |
| `org-api.js` | `/api/org/*` | ✅ |
| `services-api.js` | `/api/services/*` | ✅ |
| `service-requests-api.js` | `/api/service-requests/*` | ✅ |
| `workflow-runs-api.js` | `/api/workflow-runs/*`, approvals, artifacts, templates | ✅ |
| `governance.js` | workflow action policy and audit classification helpers | ✅ |
