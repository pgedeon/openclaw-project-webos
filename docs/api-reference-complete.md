---
layout: default
---

# Supplementary API Reference

> This document covers all server-side APIs **not** included in the main
> [api.md](api.md). Refer to that file for task, project, agent, cron, audit,
> and saved-views endpoints on the primary task server (port 3876).

## Table of Contents

- [Authentication API](#authentication-api)
  - [GET /api/auth/self](#get-apiauthself)
- [Dashboard Health And OpenClaw Status API](#dashboard-health-and-openclaw-status-api)
  - [GET /api/health](#get-apihealth)
  - [GET /api/stats](#get-apistats)
  - [GET /api/health-status](#get-apihealth-status)
  - [GET /api/citation-queue/status](#get-apicitation-queuestatus)
  - [GET /api/openclaw/health](#get-apiopenclawhealth)
  - [GET /api/openclaw/tasks](#get-apiopenclawtasks)
  - [GET /api/openclaw/tasks/audit](#get-apiopenclawtasksaudit)
  - [GET /api/openclaw/agents](#get-apiopenclawagents)
  - [POST /api/openclaw/memory/index](#post-apiopenclawmemoryindex)
  - [GET /api/openclaw/memory/promote](#get-apiopenclawmemorypromote)
  - [POST /api/openclaw/memory/promote](#post-apiopenclawmemorypromote)
  - [GET /api/routes](#get-apiroutes)
- [Cost Analytics API](#cost-analytics-api)
  - [GET /api/costs/summary](#get-apicostssummary)
  - [GET /api/costs/rollup](#get-apicostsrollup)
- [Budgets API](#budgets-api)
  - [GET /api/budgets](#get-apibudgets)
  - [POST /api/budgets](#post-apibudgets)
  - [PATCH /api/budgetsid](#patch-apibudgetsid)
  - [GET /api/budgetsidledger](#get-apibudgetsidledger)
- [Actions API](#actions-api)
  - [POST /api/actionsexecute](#post-apiactionsexecute)
  - [GET /api/actionsrecent](#get-apiactionsrecent)
- [Snapshots API](#snapshots-api)
  - [POST /api/snapshots](#post-apisnapshots)
  - [GET /api/snapshots](#get-apisnapshots)
  - [GET /api/snapshotsiddownload](#get-apisnapshotsiddownload)
  - [POST /api/restorepreview](#post-apirestorepreview)
  - [POST /api/restoreapply](#post-apirestoreapply)
- [Realtime Events API](#realtime-events-api)
  - [GET /api/events](#get-apievents)
  - [GET /api/events/stream](#get-apieventsstream)
- [Settings Control Panel API](#settings-control-panel-api)
  - [GET /api/settings](#get-apisettings)
  - [GET /api/settings/schema](#get-apisettingsschema)
  - [GET /api/settings/system-info](#get-apisettingssystem-info)
  - [GET /api/settings/restart-required](#get-apisettingsrestart-required)
  - [GET /api/settings/changelog](#get-apisettingschangelog)
  - [POST /api/settings/test-db](#post-apisettingstest-db)
  - [POST /api/settings/test-gateway](#post-apisettingstest-gateway)
  - [POST /api/settings/export](#post-apisettingsexport)
  - [POST /api/settings/import](#post-apisettingsimport)
  - [POST /api/settings/reload](#post-apisettingsreload)
  - [POST /api/settings/restart](#post-apisettingsrestart)
  - [PUT /api/settings/key/:key](#put-apisettingskeykey)
  - [GET /api/settings/:category](#get-apisettingscategory)
  - [PUT /api/settings/:category](#put-apisettingscategory)
- [Bing Webmaster API](#bing-webmaster-api)
  - [GET /api/bing/quota](#get-apibingquota)
  - [POST /api/bing/submit](#post-apibingsubmit)
  - [POST /api/bing/submit-batch](#post-apibingsubmit-batch)
  - [POST /api/bing/indexnow](#post-apibingindexnow)
  - [GET /api/bing/status](#get-apibingstatus)
- [Microservice Ports](#microservice-ports)
- [Cron Manager API (Port 3878)](#cron-manager-api-port-3878)
  - [GET /health](#get-health)
  - [GET /jobs](#get-jobs)
  - [GET /jobs/:id/runs](#get-jobsidruns)
  - [POST /jobs/:id/run](#post-jobsidrun)
  - [GET /runs](#get-runs)
  - [DELETE /runs/:runId](#delete-runsrunid)
  - [GET /status](#get-status)
  - [POST /guard/acknowledge](#post-guardacknowledge)
- [Memory API (Port 3879)](#memory-api-port-3879)
  - [GET /api/memory/list](#get-apimemorylist)
  - [GET /api/memory/file/:name](#get-apimemoryfilename)
  - [POST /api/memory/file/:name](#post-apimemoryfilename)
  - [PUT /api/memory/file/:name](#put-apimemoryfilename)
  - [POST /api/memory/file/:name/append](#post-apimemoryfilenameappend)
  - [DELETE /api/memory/file/:name](#delete-apimemoryfilename)
  - [GET /api/memory/root](#get-apimemoryroot)
  - [GET /api/memory/context](#get-apimemorycontext)
  - [GET /api/memory/search](#get-apimemorysearch)
  - [GET /api/memory/facts](#get-apimemoryfacts)
  - [GET /api/memory/facts/list](#get-apimemoryfactslist)
  - [POST /api/memory/facts](#post-apimemoryfacts)
  - [DELETE /api/memory/facts](#delete-apimemoryfacts)
  - [GET /api/memory/facts/search](#get-apimemoryfactssearch)
  - [GET /api/memory/status](#get-apimemorystatus)
  - [GET /api/memory/stats](#get-apimemorystats)
- [Filesystem API (Port 3880)](#filesystem-api-port-3880)
  - [GET /api/fs/list](#get-apifslist)
  - [GET /api/fs/file](#get-apifsfile)
  - [PUT /api/fs/file](#put-apifsfile)
  - [POST /api/fs/file](#post-apifsfile)
  - [POST /api/fs/mkdir](#post-apifsmkdir)
  - [POST /api/fs/rename](#post-apifsrename)
  - [DELETE /api/fs/path](#delete-apifspath)
  - [GET /api/fs/search](#get-apifssearch)
  - [GET /api/fs/stat](#get-apifsstat)
- [Organization API](#organization-api)
  - [GET /api/org/summary](#get-apiorgsummary)
  - [GET /api/org/departments](#get-apiorgdepartments)
  - [GET /api/org/agents](#get-apiorgagents)
  - [GET /api/org/agents/:id](#get-apiorgagentsid)
- [Service Catalog API](#service-catalog-api)
  - [GET /api/services](#get-apiservices)
  - [GET /api/services/:id](#get-apiservicesid)
  - [POST /api/services](#post-apiservices)
  - [PATCH /api/services/:id](#patch-apiservicesid)
  - [DELETE /api/services/:id](#delete-apiservicesid)
- [Service Requests API](#service-requests-api)
  - [GET /api/service-requests](#get-apiservice-requests)
  - [GET /api/service-requests/:id](#get-apiservice-requestsid)
  - [POST /api/service-requests](#post-apiservice-requests)
  - [PATCH /api/service-requests/:id](#patch-apiservice-requestsid)
- [Model Catalog API](#model-catalog-api)
  - [GET /api/catalog/models](#get-apicatalogmodels)
  - [GET /api/catalog/providers](#get-apicatalogproviders)
  - [GET /api/catalog/refresh](#get-apicatalogrefresh)
- [Metrics API](#metrics-api)
  - [GET /api/metrics/summary](#get-apimetricssummary)
  - [GET /api/metrics/department/:slug](#get-apimetricsdepartmentslug)
  - [GET /api/metrics/trends](#get-apimetricstrends)
- [Diagnostics API](#diagnostics-api)
  - [GET /api/diagnostics/info](#get-apidiagnosticsinfo)
  - [GET /api/diagnostics/state](#get-apidiagnosticsstate)
  - [POST /api/diagnostics/check](#post-apidiagnosticscheck)
  - [POST /api/diagnostics/guard](#post-apidiagnosticsguard)
- [Workflow Runs API](#workflow-runs-api)
  - [GET /api/workflow-runs](#get-apiworkflow-runs)
  - [POST /api/workflow-runs](#post-apiworkflow-runs)
  - [GET /api/workflow-runs/:id](#get-apiworkflow-runsid)
  - [PATCH /api/workflow-runs/:id](#patch-apiworkflow-runsid)
  - [DELETE /api/workflow-runs/:id](#delete-apiworkflow-runsid)
  - [POST /api/workflow-runs/:id/start](#post-apiworkflow-runsidstart)
  - [POST /api/workflow-runs/:id/heartbeat](#post-apiworkflow-runsidheartbeat)
  - [POST /api/workflow-runs/:id/complete](#post-apiworkflow-runsidcomplete)
  - [POST /api/workflow-runs/:id/fail](#post-apiworkflow-runsidfail)
  - [POST /api/workflow-runs/:id/step](#post-apiworkflow-runsidstep)
  - [POST /api/workflow-runs/:id/cancel](#post-apiworkflow-runsidcancel)
  - [POST /api/workflow-runs/:id/pause](#post-apiworkflow-runsidpause)
  - [POST /api/workflow-runs/:id/resume](#post-apiworkflow-runsidresume)
  - [POST /api/workflow-runs/:id/escalate](#post-apiworkflow-runsidescalate)
  - [POST /api/workflow-runs/:id/reassign](#post-apiworkflow-runsidreassign)
  - [POST /api/workflow-runs/:id/override-failure](#post-apiworkflow-runsidoverride-failure)
  - [POST /api/workflow-runs/:id/bind-session](#post-apiworkflow-runsidbind-session)
  - [POST /api/workflow-runs/:id/unbind-session](#post-apiworkflow-runsidunbind-session)
  - [GET /api/workflow-runs/:id/artifacts](#get-apiworkflow-runsidartifacts)
  - [POST /api/workflow-runs/:id/artifacts](#post-apiworkflow-runsidartifacts)
  - [GET /api/workflow-runs/:id/approvals](#get-apiworkflow-runsidapprovals)
  - [POST /api/workflow-runs/:id/approvals](#post-apiworkflow-runsidapprovals)
  - [GET /api/workflow-runs/stuck](#get-apiworkflow-runsstuck)
  - [GET /api/workflow-runs/active](#get-apiworkflow-runsactive)
  - [POST /api/workflow-runs/cleanup-timeouts](#post-apiworkflow-runscleanup-timeouts)
- [Workflow Routing API](#workflow-routing-api)
  - [GET /api/workflow-routing](#get-apiworkflow-routing)
  - [PUT /api/workflow-routing](#put-apiworkflow-routing)
  - [DELETE /api/workflow-routing/:type](#delete-apiworkflow-routingtype)
- [Workflow Graph API](#workflow-graph-api)
  - [POST /api/workflow-graph/events](#post-apiworkflow-graphevents)
- [MCP Telemetry API](#mcp-telemetry-api)
  - [POST /api/mcp/telemetry](#post-apimcptelemetry)
- [Workflow Templates API](#workflow-templates-api)
  - [GET /api/workflow-templates](#get-apiworkflow-templates)
  - [GET /api/workflow-templates/:name](#get-apiworkflow-templatesname)
  - [POST /api/workflow-templates](#post-apiworkflow-templates)
  - [PATCH /api/workflow-templates/:name](#patch-apiworkflow-templatesname)
- [Approvals API](#approvals-api)
  - [GET /api/approvals](#get-apiapprovals)
  - [GET /api/approvals/pending](#get-apiapprovalspending)
  - [PATCH /api/approvals/:id](#patch-apiapprovalsid)
  - [POST /api/approvals/:id/escalate](#post-apiapprovalidescalate)
- [Artifacts API](#artifacts-api)
  - [GET /api/artifacts](#get-apiartifacts)
  - [PATCH /api/artifacts/:id](#patch-apiartifactsid)
  - [DELETE /api/artifacts/:id](#delete-apiartifactsid)
- [Blockers API](#blockers-api)
  - [GET /api/blockers](#get-apiblockers)
  - [GET /api/blockers/summary](#get-apiblockerssummary)
- [Sessions API](#sessions-api)
  - [GET /api/sessions/active](#get-apisessionsactive)
  - [POST /api/sessions/:id/heartbeat](#post-apisessionsidheartbeat)
- [Task Sessions API](#task-sessions-api)
  - [GET /api/tasks/:id/sessions](#get-apitasksidsessions)
- [OpenClaw Session Reader API](#openclaw-session-reader-api)
  - [GET /api/oc/agents](#get-apiocagents)
  - [GET /api/oc/sessions](#get-apiocsessions)
  - [GET /api/oc/sessions/:sessionId](#get-apiocsessionssessionid)
  - [GET /api/oc/sessions/:sessionId/messages](#get-apiocsessionssessionidmessages)
  - [GET /api/oc/sessions/:sessionId/events](#get-apiocsessionssessionidevents)
  - [GET /api/oc/sessions/:sessionId/events/:line](#get-apiocsessionssessionideventslines)
- [Dashboard Agent Chat API](#dashboard-agent-chat-api)
  - [POST /api/agent/chat](#post-apiagentchat)
  - [GET /api/agent/chat/history](#get-apiagentchathistory)
- [System Scan API](#system-scan-api)
  - [POST /api/system-scan/run](#post-apisystem-scanrun)
  - [POST /api/system-scan/followup](#post-apisystem-scanfollowup)
- [History / Time Travel API](#history--time-travel-api)
  - [GET /api/history](#get-apihistory)
  - [GET /api/history/:taskId](#get-apihistorytaskid)
  - [GET /api/history/:taskId/snapshot](#get-apihistorytaskidsnapshot)
  - [GET /api/history/:taskId/diff](#get-apihistorytaskiddiff)
  - [GET /api/state-snapshots](#get-apistate-snapshots)
  - [GET /api/snapshots/:entityType/:entityId](#get-apisnapshotsentitytypeentityid)
  - [POST /api/snapshots/:snapshotId/preview-revert](#post-apisnapshotssnapshotidpreview-revert)
  - [POST /api/snapshots/:snapshotId/revert](#post-apisnapshotssnapshotidrevert)
- [Governance Module (Library)](#governance-module-library)

## Authentication API

The dashboard uses single-operator bearer token auth. Full login/session/RBAC auth is deferred until a multi-operator requirement exists. See [Auth Reference](auth-reference.md).

### GET /api/auth/self

Returns the current auth mode, effective actor, and deferred full-auth policy. This endpoint is public so the shell can validate whether its injected token is usable.

**Response:**

```json
{
  "authenticated": true,
  "mode": "token",
  "actor": "dashboard-operator",
  "role": "operator",
  "user": "dashboard-operator",
  "tokenRequired": true,
  "supportedSchemes": ["bearer-token"],
  "publicRoutes": ["/api/health", "/api/auth/self"],
  "capabilities": {
    "bearerToken": true,
    "singleOperator": true,
    "sessions": false,
    "rbac": false,
    "multiOperator": false
  },
  "deferred": {
    "fullAuth": true,
    "until": "multi-operator requirement exists",
    "reason": "Full auth is deferred until a multi-operator requirement exists."
  }
}
```

---

## Dashboard Health And OpenClaw Status API

These endpoints are served by the primary task server on port 3876. `/api/health` is public for monitoring; the other endpoints use the normal dashboard bearer-token middleware.

### `GET /api/health`

Returns basic task-server and storage health.

**Response** `200`:

```json
{
  "status": "ok",
  "timestamp": "2026-03-12T10:11:12.000Z",
  "asana_storage": "postgres",
  "storage_type": "postgres",
  "storage_mode": "postgres",
  "storage_label": "PostgreSQL",
  "storage_note": null,
  "db_latency_ms": 7,
  "uptime": 12345,
  "port": 3876
}
```

### `GET /api/stats`

Returns aggregate storage statistics from the dashboard storage layer.

**Response** `200`:

```json
{ "projects": 12, "tasks": 128, "completed": 45 }
```

**Error** `503`: storage has not initialized.

### `GET /api/health-status`

Returns unified dashboard-local health with database, gateway sync, task-server, and optional cron checks.

**Response** `200`:

```json
{
  "status": "healthy",
  "database": { "status": "PostgreSQL", "healthy": true, "mode": "postgres" },
  "gateway": { "status": "ok", "healthy": true, "agent_count": 2 },
  "task_server": { "healthy": true, "status": "running" },
  "checks": {
    "database": { "healthy": true, "status": "PostgreSQL", "mode": "postgres" },
    "gateway_sync": { "healthy": true, "status": "ok", "count": 2 },
    "task_server": { "healthy": true, "status": "running" }
  }
}
```

### `GET /api/citation-queue/status`

Returns citation queue status from the editorial citation queue script.

**Response** `200`:

```json
{ "success": true, "pending": 3, "total": 5, "timestamp": "2026-03-12T10:11:12.000Z" }
```

### `GET /api/openclaw/health`

Proxies `openclaw health --json`.

**Response** `200`:

```json
{
  "source": "openclaw-cli",
  "ok": true,
  "channels": {},
  "agents": [],
  "heartbeatSeconds": 30,
  "defaultAgentId": "main"
}
```

**Error** `502`: OpenClaw CLI health failed or returned an error payload.

### `GET /api/openclaw/tasks`

Lists background tasks from `openclaw tasks list`.

**Query parameters**:

| Param | Type | Description |
|---|---|---|
| `runtime` | string | Optional runtime filter |
| `status` | string | Optional task status filter |

**Response** `200`:

```json
{ "source": "openclaw-cli", "count": 1, "tasks": [{ "id": "task-1" }] }
```

### `GET /api/openclaw/tasks/audit`

Runs the OpenClaw stale/broken task audit.

**Response** `200`:

```json
{ "source": "openclaw-cli", "stale": [], "broken": [] }
```

### `GET /api/openclaw/agents`

Lists OpenClaw agents.

**Response** `200`:

```json
{ "source": "openclaw-cli", "agents": [{ "id": "main" }] }
```

### `POST /api/openclaw/memory/index`

Triggers memory indexing for an agent.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent memory namespace to index |

**Response** `200`:

```json
{ "source": "openclaw-cli", "success": true, "agentId": "main", "result": {} }
```

### `GET /api/openclaw/memory/promote`

Previews memory promotion candidates.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent memory namespace |
| `limit` | number | `10` | Max candidates to return |

**Response** `200`:

```json
{ "source": "openclaw-cli", "agentId": "main", "candidates": [] }
```

### `POST /api/openclaw/memory/promote`

Applies memory promotions.

**Body**:

```json
{ "agent": "main", "limit": 10 }
```

**Response** `200`:

```json
{ "source": "openclaw-cli", "success": true, "agentId": "main", "promoted": [] }
```

### `GET /api/routes`

Returns the registered route catalog from the in-process router.

**Response** `200`:

```json
{
  "routes": [{ "method": "GET", "path": "/api/health" }],
  "total": 1
}
```

---

## Cost Analytics API

### `GET /api/costs/summary`

Aggregate token/cost summary over the `workflow_runs` cost columns shipped in migration `022_add_run_token_cost_tracking.sql` (`cost_estimate`, `input_tokens`, `output_tokens`, `reported_at`). Consumed by the Mission Control cost panel.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | number | 7 | Lookback window in days (today inclusive, clamped to 1–90) |

**Degradation contract:** without PostgreSQL (json_snapshot mode, pool not initialized, or query failure) the endpoint answers HTTP `200` with `{ "available": false, ... }` instead of an error status. Clients must render a "Cost unavailable — no database" state when `available === false`.

**Response** `200` (database available):

```json
{
  "available": true,
  "window_days": 7,
  "currency": "USD",
  "today": {
    "cost": 4.12,
    "tokens": { "input": 184320, "output": 22100 },
    "runs": 6
  },
  "days": [
    { "date": "2026-08-24", "cost": 4.12, "runs": 6, "tokens": { "input": 184320, "output": 22100 } },
    { "date": "2026-08-23", "cost": 9.4, "runs": 11, "tokens": { "input": 402100, "output": 51800 } }
  ],
  "avg_daily_7d": 8.83,
  "total_window": 61.8,
  "top_run": {
    "id": "b1e2c3d4-...",
    "workflow_type": "crawl-site",
    "owner_agent_id": "affiliate-editorial",
    "status": "completed",
    "cost": 1.9
  },
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

**Response** `200` (no database):

```json
{
  "available": false,
  "reason": "no_database",
  "window_days": 7,
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

Daily buckets use `reported_at` when usage was reported, falling back to `started_at` then `created_at`, so unreported runs still land in a day bucket. `days[]` is the per-day series (`date`, `cost`, `runs`, `tokens`); `avg_daily_7d` is the mean daily cost across all buckets in the window.

### `GET /api/costs/rollup`

Per-group cost/token rollups over the same migration-022 `workflow_runs` columns as `/summary`, grouped by agent, department, or workflow type. Consumed by the Cost Rollup desktop widget (top-N agents with sparklines).

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `group_by` | enum | `agent` | Rollup dimension: `agent` (per `owner_agent_id`), `department` (via `agent_profiles` → `departments`; agents without a mapping land in `Unassigned`), or `workflow_type`. Unknown values answer `400 validation_failed`. |
| `days` | number | 7 | Lookback window in days (today inclusive, clamped to 1–90) |

**Degradation contract:** identical to `/summary` — HTTP `200` with `{ "available": false }` (`reason: no_database` or `query_failed`) instead of an error status.

**Response** `200` (database available):

```json
{
  "available": true,
  "group_by": "agent",
  "window_days": 7,
  "currency": "USD",
  "group_count": 2,
  "groups": [
    {
      "key": "affiliate-editorial",
      "cost": 4.1,
      "runs": 6,
      "tokens": { "input": 1500, "output": 300 },
      "series": [
        { "date": "2026-08-23", "cost": 3.1 },
        { "date": "2026-08-24", "cost": 1.0 }
      ]
    },
    {
      "key": "coder",
      "cost": 9.99,
      "runs": 7,
      "tokens": { "input": 8000, "output": 900 },
      "series": [{ "date": "2026-08-24", "cost": 9.99 }]
    }
  ],
  "total_window": 14.09,
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

`groups[]` is sorted by cost descending; each group's `series[]` is date-ascending and sparkline-ready (one point per day that had runs). Daily bucketing reuses the exact `COALESCE(reported_at, started_at, created_at)` pattern from `/summary`.

---

## Budgets API

Named spending rules with derived spend (Budget Ledger slice 1, migration `023_add_budget_ledger.sql`; design brief `docs/briefs/budget-ledger.md`). A budget pairs a scope (`agent` / `department` / `project` / `fleet`) with a calendar period (`daily` / `weekly` / `monthly`), exactly one cap (`cap_usd` XOR `cap_tokens`), and a breach action (`warn` / `pause_new_runs` / `hard_stop`). Spend is **derived** from the migration-022 `workflow_runs` cost/token columns using the same `COALESCE(reported_at, started_at, created_at)` bucketing as the cost summary — never stored twice. Enforcement hooks in the dispatcher are slice 2; these endpoints are model + read/CRUD only.

Token caps cover `input_tokens + output_tokens` (`cached_tokens` is a subset of input and never added on top). Pause state is derived: `spend >= cap && active` — there is no un-pause endpoint; recovery is period rollover, raising the cap, or deactivating via PATCH.

**Degradation contract:** without PostgreSQL every endpoint answers HTTP `200` with `{ "available": false, "reason": "no_database" }`; query failures degrade to `{ "available": false, "reason": "query_failed" }`. Validation failures answer HTTP `400` `{ "error": "validation_failed", "details": [...] }`.

### `GET /api/budgets`

List budgets with derived current-period spend and percent-of-cap.

**Response** `200`:

```json
{
  "available": true,
  "budgets": [
    {
      "id": "b1e2c3d4-...",
      "name": "affiliate-editorial monthly cap",
      "scope": "agent",
      "scope_id": "affiliate-editorial",
      "period": "monthly",
      "cap_usd": 50,
      "cap_tokens": null,
      "action_on_exceed": "pause_new_runs",
      "active": true,
      "created_at": "2026-08-24T09:00:00.000Z",
      "period_key": "2026-08",
      "current_spend": { "usd": 41.2, "tokens": 880000, "runs": 120 },
      "pct_of_cap": 82.4,
      "status": "under"
    }
  ],
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

`status` is derived per evaluation: `under` | `warned` (at/over cap on a `warn` budget) | `breached` (at/over cap on a `pause_new_runs`/`hard_stop` budget). The breach boundary is `>= cap` — exactly-at-cap counts as breached.

### `POST /api/budgets`

Create a budget rule. Validates enums, the cap-XOR rule (exactly one of `cap_usd` / `cap_tokens`, both positive), and scope semantics (`fleet` forces `scope_id` NULL; other scopes require it).

**Request:**

```json
{
  "name": "affiliate-editorial monthly cap",
  "scope": "agent",
  "scope_id": "affiliate-editorial",
  "period": "monthly",
  "cap_usd": 50,
  "action_on_exceed": "pause_new_runs"
}
```

**Response** `201`: `{ "available": true, "budget": { ... }, "timestamp" }`. Only one **active** budget per `(scope, scope_id, period)` can exist (partial unique index in migration 023); deactivate the old rule first to replace it.

### `PATCH /api/budgets/:id`

Update `name`, `action_on_exceed`, `active`, or the cap. Provide at most one cap field per call — the sibling cap is cleared automatically so the table-level XOR CHECK stays satisfied; caps cannot be nulled without a replacement. These PATCH moves are the only sanctioned "un-pause" actions (brief §2.4).

**Response** `200`: `{ "available": true, "budget": { ... } }`. Unknown id → `404` `{ "available": false, "reason": "not_found" }`.

### `GET /api/budgets/:id/ledger?period=current`

Derived current-period spend plus the append-only enforcement event trail for one budget. Only `period=current` is supported in slice 1.

**Response** `200`:

```json
{
  "available": true,
  "budget": { "id": "b1e2c3d4-...", "name": "fleet monthly", "scope": "fleet", "period": "monthly", "cap_usd": 100, "action_on_exceed": "hard_stop", "active": true },
  "period_key": "2026-08",
  "window_start": "2026-08-01T00:00:00.000Z",
  "spend": { "usd": 62.5, "tokens": 700000, "runs": 40 },
  "pct_of_cap": 62.5,
  "status": "under",
  "events": [
    { "id": 2, "budget_id": "b1e2c3d4-...", "period_key": "2026-08", "event_kind": "paused", "detail": { "spend_usd": 100.2 }, "created_at": "2026-08-14T10:00:00.000Z" }
  ],
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

`events[]` is newest-first (limit 100) from `budget_events`; `event_kind` is one of `warned` | `paused` | `hard_stopped` | `recovered`, and `UNIQUE (budget_id, period_key, event_kind)` makes every emission idempotent. Unknown id → `404`.

---

## Actions API

One governed path for every consequential operator action (One-Click Agent Actions slice 1, migration `024_add_action_receipts.sql`; design brief `docs/briefs/one-click-actions.md`). Every catalog action (`task.assign`, `run.dispatch`, `approval.decide`, `run.cancel`, `run.redispatch`, `task.create`) is a typed envelope validated against the registry (`lib/action-registry.js`), latched by an idempotency receipt, gated by governance, and — for dispatch-class actions — probed against budget headroom before execution. Backing business logic is the existing workflow-runs/tasks machinery called in-process; the raw endpoints stay uncordoned for scripts and agents.

**Idempotency contract:** `actionId` is minted client-side ONCE per confirmed intent; retries of that intent reuse it. A replayed `actionId` returns the stored receipt with `"duplicate": true` and performs nothing. Same `actionId` with a different `paramsHash` → `409 stale_retry`. Two different `actionId`s with identical params are a legitimate repeat: both execute, both receipted.

**Degradation contract:** without PostgreSQL `POST /api/actions/execute` refuses ALL actions with HTTP `503` `{ "available": false, "reason": "no_database" }` — audit-first: no receipt persistence, no side effect. Migration 024 unapplied → `503 { "available": false, "reason": "receipts_unavailable" }`. Read endpoint degrades with the house contract: HTTP `200` `{ "available": false, "reason": "no_database" | "receipts_unavailable" | "query_failed" }`. Envelope violations answer `400 { "error": "invalid_action", "details": [...] }` before any permission check or execution.

### `POST /api/actions/execute`

Execute one catalog action. Request body:

```json
{
  "actionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "kind": "run.dispatch",
  "targetId": "task-uuid",
  "params": { "template": "code-change", "input_payload": { "prompt": "fix login bug" } },
  "actor": "dashboard-operator"
}
```

Per-kind `params`: `task.assign` → `{ owner }` (required); `run.dispatch` → `{ template }` (required) + optional `input_payload` object; `approval.decide` → `{ decision }` (`approved` | `rejected`, required) + optional `notes`; `run.cancel` → optional `{ reason }`; `run.redispatch` → `{}`; `task.create` → `{ title }` (required) + optional `description`, `owner_agent`, `status`, `due_date` — `targetId` is the project the task lands in (severity LOW, confirmation NONE: creation is reversible via archive). `paramsHash` is computed server-side as sha256 over canonical JSON (sorted keys) of `params`. `actor` defaults to `dashboard-operator`.

**Response** `200` (executed):

```json
{
  "receipt": {
    "action_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "kind": "run.dispatch",
    "target_id": "task-uuid",
    "params_hash": "9f2a…",
    "actor": "dashboard-operator",
    "outcome": "executed",
    "rollback_hint": "Cancel run run-new-1 if unwanted",
    "detail": { "result": { "new_run_id": "run-new-1", "status": "running" } },
    "created_at": "2026-08-24T12:00:00.000Z"
  }
}
```

Replays return `200 { "receipt": { … }, "duplicate": true }` with zero side effects.

**Other responses:**

| Status | Body | When |
|---|---|---|
| `400` | `{ "error": "invalid_action", "details": [...] }` | unknown kind / bad target format / params-schema violation — checked BEFORE governance or execution |
| `400` | `{ "error": "execution_failed", "message", "receipt" }` | backing operation failed; receipt records `outcome: "failed"` with the error message under `detail.error`, plus any structured executor payload when present — `snapshot.create` failures preserve the snapshot endpoint's exact response body as `detail.snapshot_body` (e.g. `{ available: false, reason }` / `{ error }`) so operators see why, not just a message string (`404` when the message indicates not-found) |
| `403` | `{ "error": "rejected_governance", "reason", "receipt" }` | actor lacks the mapped governance capability (`reassign_owner` / `launch_workflow` / `approve`–`reject` / `cancel_run` / `override_failure`); receipt records `outcome: "rejected_governance"`, no side effect |
| `409` | `{ "error": "stale_retry" }` | same `actionId` replayed with different params |
| `422` | `{ "error": "budget_blocked", "action": "pause_new_runs" \| "hard_stop", "budgets": [{ "name", "scope", "period_key", "spend_usd" \| "spend_tokens", "cap_usd" \| "cap_tokens", "pct_of_cap" }] }` | dispatch-class pre-execution headroom probe breached over the same scope chain the dispatcher enforces. **No receipt is written** — a refusal is not an outcome, and the action stays retryable after a cap raise (deliberate divergence from brief AC8's blocked_budget receipt). Probe failures fail OPEN; the dispatcher remains the enforcement backstop |
| `503` | `{ "available": false, "reason": "no_database" \| "receipts_unavailable" \| "query_failed" }` | audit-first refusal — never executes without durable receipts |

Every executed (or failed/rejected) receipt is mirrored into `audit_log` as one row with `action = "action.<kind>"` (e.g. `action.run.cancel`) inside the same transaction that stamps the receipt outcome, so the Audit view shows actions with zero view changes. Transactionality note: the backing executors own their internal transactions, so the receipt latch is written BEFORE the side effect (PK constraint guarantees exactly-one-execution under concurrent double-clicks); a receipt left with `outcome: null` means "executing, fate unknown" and replays return `duplicate: true`.

### `GET /api/actions/recent?limit=50`

Recent receipts, newest first (tray feed). `limit` clamped to 1–200, default 50.

**Response** `200`:

```json
{
  "available": true,
  "receipts": [
    {
      "action_id": "7c9e6679-…",
      "kind": "run.cancel",
      "target_id": "run-uuid",
      "params_hash": "aa13…",
      "actor": "dashboard-operator",
      "outcome": "executed",
      "rollback_hint": "Re-dispatch via run.redispatch",
      "detail": { "result": { "run_id": "run-uuid", "status": "cancelled" } },
      "created_at": "2026-08-24T11:59:00.000Z"
    }
  ],
  "timestamp": "2026-08-24T12:00:00.000Z"
}
```

Without PostgreSQL or with migration 024 unapplied: `200 { "available": false, "reason": "no_database" | "receipts_unavailable" }`.

---

## Snapshots API

Full-state snapshot/restore (docs/briefs/snapshot-restore.md). A snapshot is a JSON **artifact** — every dashboard table plus non-secret (config-source) settings, wrapped in a manifest carrying exact row counts, the applied-migration list, and a `content_hash` integrity digest. Artifacts live in `storage/snapshots/<snapshot_id>.json` (runtime state, gitignored); there are NO new database tables — the registry IS the directory listing.

Secrets policy: the settings section carries config-source keys ONLY (every env-source key, including all five password-type keys, is structurally absent), then a deny-regex pass (`\b(password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential)\b`, case-insensitive) replaces matching values anywhere in the artifact with `[REDACTED]`. Restoring a settings section that contains secret-looking keys drops the WHOLE section with a warning instead of partially trusting it.

**Size cap:** restore requests larger than `RESTORE_MAX_BYTES` (env, default 100 MB) are rejected `413 {"error": "payload_too_large"}` BEFORE the body is parsed.

**Degradation contract:** create/preview/apply answer `503 {"available": false, "reason": "no_database"}` without PostgreSQL with zero writes — deliberately stricter than the cost-routes HTTP-200 variant because these endpoints mutate state. The disk-only endpoints (`GET /api/snapshots`, `/download`) keep working without a database.

### `POST /api/snapshots`

Capture a full-state snapshot: reads all §2.1 tier tables in one pass, redacts, computes the manifest, and atomically writes the artifact (tmp + rename inside the same directory).

**Request:** `{ "name": "snapshot-20260824-1536" }` (name optional; default `snapshot-YYYYMMDD-HHmm`).

**Response** `201`:

```json
{
  "snapshot_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "manifest": {
    "artifact_version": 1,
    "snapshot_id": "7c9e6679-...",
    "name": "snapshot-20260824-1536",
    "created_at": "2026-08-24T15:36:00.000Z",
    "actor": "dashboard-operator",
    "generator": "openclaw-project-webos 1.1.0",
    "schema_version": { "migrations_applied": ["001_add_workflow_runs", "..."] },
    "counts": { "workflows": 4, "projects": 12, "tasks": 123 },
    "content_hash": "sha256-hex-over-canonical-{tables,settings}"
  }
}
```

### `GET /api/snapshots`

Disk index scan of `storage/snapshots/*.json`, newest-first by `created_at`. Works without PostgreSQL.

**Route-order note (slice 3):** this path is shared with the Time Travel feature's state-snapshots listing. `task-server.js` registers snapshot-routes BEFORE history-routes, so the bare path serves THIS registry; Time Travel's listing moved to the identical-handler alias [`GET /api/state-snapshots`](#get-apistate-snapshots). Regression-pinned in tests/test-snapshot-panel.js.

**Response** `200`: `{ "available": true, "count": 2, "snapshots": [{ "snapshot_id", "name", "created_at", "total_rows", "size_bytes", "generator" }] }` — `size_bytes` is the honest on-disk size; unreadable/corrupt files are skipped rather than breaking the listing.

### `GET /api/snapshots/:id/download`

Streams the raw artifact as an attachment (`Content-Disposition: attachment; filename="<name>.json"`). Unknown or malformed ids answer `404 {"error": "snapshot_not_found"}`. Works without PostgreSQL.

### `POST /api/restore/preview`

Dry-run diff against the live database — nothing is written. Request: `{ "artifact": {...} }` (a full artifact) or `{ "snapshot_id": "..." }` (a server-side snapshot).

Validation pipeline, in order: JSON parse → manifest structure (`400 invalid_manifest`) → `content_hash` integrity check (`400 artifact_corrupt`, before any diffing) → database availability (`503`) → schema compatibility → per-table diff.

**Schema compatibility (§4.3):** an artifact naming migrations absent from the target is refused `409 {"error": "schema_too_new", "missing": ["..."]}`; a target ahead of the artifact is allowed with `warnings: ["target_newer"]`.

**Warnings:** `target_newer` (additive migrations assumed safe), `active_runs` (dispatcher/gateway writers active during preview — R4 race caution), `settings_section_dropped` (artifact settings carried secret-looking keys).

**Response** `200`:

```json
{
  "schema_compat": "ok",
  "warnings": [],
  "tables": {
    "tasks": { "added": 3, "updated": 2, "conflicts": 1, "unchanged": 117, "added_pks": ["..."], "conflict_pks": ["..."] }
  },
  "totals": { "added": 3, "updated": 2, "conflicts": 1, "unchanged": 117 },
  "settings": { "keys": 18, "dropped": false },
  "snapshot_id": "7c9e6679-...",
  "created_at": "2026-08-24T15:36:00.000Z",
  "timestamp": "2026-08-24T16:00:00.000Z"
}
```

Classification per table (PK-keyed): **added** = PK absent from target; **updated** = hash differs, target row not modified after the snapshot; **conflict** = hash differs AND the live row changed after `created_at`; **unchanged** = identical canonical hash.

### `POST /api/restore/apply`

Apply a previewed artifact. Request: `{ "artifact" | "snapshot_id", "mode": "merge" | "replace", "restoreId": "<client-minted uuid>" }`. `merge` (default) upserts added+updated+conflict rows by PK and deletes nothing; `replace` additionally deletes rows absent from the artifact, per table, in FK-safe reverse dependency order (destructive — the UI gates it behind HOLD_CONFIRM). Table writes follow the pinned dependency chain `workflows → projects → tasks → workflow_runs → workflow_steps → workflow_approvals → workflow_artifacts → …`, one transaction per table (~500-row batches).

**Idempotency + resume (§4.4):** the latch is file-backed — `storage/snapshots/<restoreId>.resume.json` records completed tables after each fully-applied table. Re-POST with the same `restoreId` after a partial failure resumes at the first incomplete table (completed tables skipped; a crashed table rolled back entirely and re-applies from scratch — checkpoints track tables, not rows). A COMPLETED restore replays as `{ "duplicate": true, "summary": {...} }` executing nothing.

**Progress:** one additive SSE `restore-progress` frame fans out on the existing `/api/events/stream` channel per completed table: `{ "restoreId", "table", "doneRows", "totalRows" }`. Missing frames degrade safely to the final summary.

**Response** `200`: `{ "restoreId", "duplicate": false, "resumed": false, "summary": { "mode", "tables": { "<t>": { "upserted", "deleted" } }, "totals": { "upserted", "deleted" }, "settings": { "applied", "dropped_section" }, "startedAt", "completedAt" } }`. A mid-apply crash answers `500 {"error": "restore_failed", ...}` with prior tables committed — re-POST the same `restoreId` to resume.

---

## Realtime Events API

### `GET /api/events`

Opens a Server-Sent Events stream for browser clients that need live dashboard updates. The stream sends an initial comment frame, periodic heartbeat comments, and named events broadcast by task, project, space, gateway, and chat route handlers.

When `DASHBOARD_AUTH_TOKEN` is configured, this endpoint requires authentication. The standard `Authorization: Bearer <token>` header is the preferred credential. The `?token=<token>` query parameter remains only as a documented legacy fallback for `EventSource` clients (which cannot set request headers); since query strings can leak into browser history, proxy logs, and `Referer` headers, the server strips query strings from all request log lines so the token is never logged (SECURITY-AUDIT-2026-08.md F7).

**Response** `200`:

Headers:

| Header | Value |
|---|---|
| `Content-Type` | `text/event-stream` |
| `Cache-Control` | `no-cache` |
| `Connection` | `keep-alive` |

Initial frame:

```text
: connected
```

Event frame shape:

```text
event: task:changed
data: {"action":"update","taskId":"task-1"}
```

### `GET /api/events/stream`

Bridge-fed Server-Sent Events stream. Same authentication contract as `GET /api/events`
(bearer token preferred, `?token=` legacy fallback for `EventSource`). Multiple browser tabs
each get their own stream; the server broadcasts every normalized event to all of them.

The feed is produced by the gateway bridge (`lib/gateway-bridge.js`): one server-side
WebSocket subscribes to the OpenClaw gateway, normalizes events into a small internal set,
and dedupes them by id + updatedAt/seq before fan-out (the gateway re-upserts the same task
many times with only `updatedAt` bumped). When the bridge is disabled (no gateway config)
or disconnected, no frames arrive — clients keep their polling fallback; the endpoint itself
stays up and healthy.

**Response** `200`: same headers as `GET /api/events`. Initial frame `: connected`, periodic
heartbeat comments.

Event frame shapes:

```text
event: task-updated
data: {"id":"<task uuid>","updatedAt":1787530620467,"taskId":"…","kind":"cli","runtime":"cli","status":"running","title":"…","agentId":"coder","sessionKey":"agent:coder:main","runId":"…"}
```

```text
event: agent-status-changed
data: {"id":"agent:coder:main/tool:<callId>","updatedAt":7,"sessionKey":"agent:coder:main","agentId":"coder","runId":"…","itemId":"tool:<callId>","stream":"item","phase":"end","name":"exec","status":"completed","title":"…"}
```

```text
event: run-updated
data: {"id":"<runId>/<toolCallId>","updatedAt":2754,"runId":"…","sessionKey":"agent:coder:main","agentId":"coder","toolCallId":"<callId>","phase":"result","name":"exec","meta":"…","exitCode":0}
```

```text
event: budget:breach
data: {"type":"budget:breach","id":"<budgetId>/<periodKey>/<eventKind>","budget_id":"…","budget_name":"fleet monthly cap","scope":"fleet","scope_id":null,"period":"monthly","period_key":"2026-08","event_kind":"paused","action":"pause_new_runs","spend_usd":12.5,"spend_tokens":7000,"cap_usd":10,"cap_tokens":null,"message":"pause_new_runs enforced at $12.50 of $10.00 cap (2026-08)","timestamp":"…"}
```

`budget:breach` (budget-ledger slice 3) fires when enforcement takes a non-warn action
(`pause_new_runs` / `hard_stop`); `warn` records its audit event but never pages. Emission is
throttled by the `budget_events` UNIQUE latch — exactly one frame per
`(budget_id, period_key, event_kind)` per period, so repeated dispatch ticks do not re-page.
Frames reach this channel two ways: the dispatcher fans out directly via `broadcastStream`
(and mirrors onto the legacy always-connected `GET /api/events` channel so notification
delivery does not depend on opt-in liveSync), and the gateway bridge additionally normalizes
an additive `budget.breach` gateway envelope into the same frame shape
(`lib/budget-enforcement.js buildBudgetBreachFrame`) for a future relay — both producers emit
byte-compatible frames. Clients: `src/shell/realtime-sync.mjs` surfaces frames as actionable
notification-center entries (blocker tier, deep-linking Mission Control's budgets panel);
Mission Control also derives the `budget_breach` anomaly flag from polled `GET /api/budgets`
data independently of this stream.

```text
event: resync
data: {"reason":"overflow|seq-gap|bridge-connected"}
```

`resync` tells the client its stream state may be incomplete (slow-consumer overflow with
drop-oldest, missed gateway frames detected via envelope-seq gap, or a fresh bridge
connect/reconnect): the client should do one manual refresh. Assistant token deltas are
deliberately not fanned out in v1 — too chatty for dashboard state.

---

## Settings Control Panel API

Routes for reading and updating dashboard configuration. Write routes are rate limited to 10 writes per minute per server process.

### `GET /api/settings`

Returns all settings grouped by category.

**Response:** `{ ok: true, settings: { [category]: { [key]: setting } } }`

### `GET /api/settings/schema`

Returns the full settings schema.

**Response:** `{ ok: true, schema: { [key]: schemaEntry } }`

### `GET /api/settings/system-info`

Returns runtime system information derived from the settings store and task server dependencies.

**Response:** `{ ok: true, system: object }`

### `GET /api/settings/restart-required`

Returns whether pending settings changes require a server restart.

**Response:** `{ required: boolean, reasons: [...] }`

### `GET /api/settings/changelog`

Returns the in-memory settings change log.

**Response:** `{ ok: true, changelog: [...] }`

### `POST /api/settings/test-db`

Tests the configured PostgreSQL pool with `SELECT 1`.

**Response:** `{ ok: boolean, latency?: number, error?: string }`

### `POST /api/settings/test-gateway`

Reports the current gateway client connection state.

**Response:** `{ ok: boolean, connected: boolean, url: string }`

### `POST /api/settings/export`

Exports current settings.

**Response:** `{ ok: true, settings: object, exportedAt: string }`

### `POST /api/settings/import`

Imports settings from a JSON payload.

**Body:** `{ settings: object }`

**Response:** `{ ok: true, imported: number, required: boolean, reasons: [...] }`

### `POST /api/settings/reload`

Reloads settings from disk.

**Response:** `{ ok: true, message: string }`

### `POST /api/settings/restart`

Schedules a graceful task-server restart. The server responds before emitting `SIGTERM`.

**Body:** `{ confirm: "restart" }`

**Response:** `{ ok: true, message: "Restarting server..." }`

### `PUT /api/settings/key/:key`

Updates a single setting.

**Body:** `{ value: any }`

**Response:** `{ ok: true, ...result, required: boolean, reasons: [...] }`

### `GET /api/settings/:category`

Returns settings for a single category.

**Response:** `{ ok: true, category: string, settings: object }`

### `PUT /api/settings/:category`

Updates all provided settings in a category.

**Body:** `{ [key]: value }`

**Response:** `{ ok: true, updated: [...], required: boolean, reasons: [...] }`

---

## Bing Webmaster API

The task server exposes a server-side proxy for Bing Webmaster URL submission and IndexNow calls. These routes require `BING_WEBMASTER_API_KEY`; when the key is absent, the route module does not register `/api/bing/*` routes.

### GET /api/bing/quota

Returns the Bing URL submission quota for a site.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `siteUrl` | string | `https://3dput.com` | Site URL registered in Bing Webmaster Tools |

**Response:**

```json
{
  "ok": true,
  "quota": {
    "dailyQuota": 100,
    "used": 3
  }
}
```

### POST /api/bing/submit

Submits one URL through Bing Webmaster Tools.

**Body:**

```json
{
  "siteUrl": "https://3dput.com",
  "url": "https://3dput.com/page"
}
```

`url` is required. `siteUrl` defaults to `https://3dput.com`.

### POST /api/bing/submit-batch

Submits up to 500 URLs through Bing Webmaster Tools.

**Body:**

```json
{
  "siteUrl": "https://3dput.com",
  "urls": [
    "https://3dput.com/page-a",
    "https://3dput.com/page-b"
  ]
}
```

`urls` must be a non-empty array. Requests with more than 500 URLs return `400`.

### POST /api/bing/indexnow

Submits URLs through the WordPress IndexNow plugin proxy configured by `WORDPRESS_API_URL`, `WORDPRESS_USER`, and `WORDPRESS_APP_PASS`.

**Body:**

```json
{
  "urls": [
    "https://3dput.com/page-a",
    "https://3dput.com/page-b"
  ]
}
```

Returns `200` when every URL succeeds, or `207` when at least one URL is rejected by the upstream IndexNow endpoint.

### GET /api/bing/status

Checks whether the configured Bing API key can read quota information for the default site.

**Response:**

```json
{
  "ok": true,
  "apiKeyConfigured": true,
  "quota": {
    "remaining": 12
  }
}
```

---

## Microservice Ports

| Service | Default Port | File | Protocol |
|---|---|---|---|
| Task Server (primary) | 3876 | `task-server.js` | HTTP REST |
| Cron Manager | 3878 | `cron-manager-server.mjs` | HTTP REST |
| Memory API | 3879 | `memory-api-server.mjs` | HTTP REST |
| Filesystem API | 3880 | `filesystem-api-server.mjs` | HTTP REST |

All JSON APIs accept and return `Content-Type: application/json` unless noted.

---

## Cron Manager API (Port 3878)

The cron manager (`cron-manager-server.mjs`) manages job definition files in
`~/.openclaw/workspace/crontab/*.cron`, executes scheduled jobs, and exposes a
REST API for inspecting and triggering them.

**Base URL:** `http://127.0.0.1:3878/api/cron-admin`

### Authentication & request rules

Since the 2026-08 security fixes (SECURITY-AUDIT-2026-08.md F2/F3):

- Every endpoint requires `Authorization: Bearer $DASHBOARD_AUTH_TOKEN`.
  The server refuses to start when `DASHBOARD_AUTH_TOKEN` is unset.
- The `Host` header must be `127.0.0.1:3878` or `localhost:3878`
  (DNS-rebinding defense).
- A browser `Origin` header, when present, must match the task-server origin
  (`http://localhost:3876` or `http://127.0.0.1:3876`). CORS preflight allows
  only `Content-Type` and `Authorization` headers.
- Mutating methods (`POST`, `PUT`, `DELETE`) must send
  `Content-Type: application/json`; anything else returns `415`.
- Job `id` values must match `/^[A-Za-z0-9._-]+$/` with no `..` sequence;
  violations return `400`. Ids are validated before any filesystem use.

### `GET /jobs`

List all defined cron jobs.

**Response** `200`:

```json
{
  "jobs": [
    {
      "id": "gateway-status-sync",
      "schedule": "*/30 * * * * *",
      "command": "node sync-gateway-status.mjs",
      "description": "Sync gateway status",
      "logPath": "/root/.openclaw/workspace/logs/gateway-status.log",
      "lastRun": "2026-08-23T10:30:00.000Z",
      "status": "active"
    }
  ]
}
```

### `POST /jobs`

Create a cron job. Body: `{ "id", "command", "description"?, "minute"?, "hour"?, "dom"?, "month"?, "dow"? }` — schedule fields default to `*`.

**Response** `201`: the created job object.

### `GET /jobs/:id`

Get a single job. **Response** `200` job object; `404` if the id is unknown.

### `PUT /jobs/:id`

Update schedule fields, command, or description. **Response** `200`: the updated job object.

### `DELETE /jobs/:id`

Delete the job definition file. **Response** `200`:

```json
{ "success": true, "deleted": "gateway-status-sync" }
```

### `POST /jobs/:id/run`

Trigger an immediate detached run of the job command. **Response** `202`:

```json
{ "success": true, "pid": 12345, "job": "gateway-status-sync" }
```

### `GET /jobs/:id/logs`

Return the tail of the job's log file (default last 50 lines).

**Response** `200`:

```json
{ "logs": ["line 1", "line 2"], "logPath": "/root/.openclaw/workspace/logs/gateway-status.log" }
```

Example:

```bash
curl -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" \
     http://127.0.0.1:3878/api/cron-admin/jobs
```

### `POST /guard/acknowledge`

Acknowledge the cron guard state (used by diagnostic system to reset the guard
lock file at `/tmp/openclaw-heartbeat-cron-guard-state.json`).

**Response** `200`:

```json
{ "acknowledged": true }
```

---

## Memory API (Port 3879)

The memory API (`memory-api-server.mjs`) provides access to the agent memory
system — reading and writing memory files, querying facts from the facts
database, and running semantic searches via the unified query script.
Dashboard traffic normally reaches it through the authenticated task-server
proxy (`routes/memory-routes.js`).

### Authentication & request rules

Since the 2026-08 security fixes (SECURITY-AUDIT-2026-08.md F6):

- Every endpoint requires `Authorization: Bearer $DASHBOARD_AUTH_TOKEN`.
  The server refuses to start when `DASHBOARD_AUTH_TOKEN` is unset.
- The `Host` header must be `127.0.0.1:3879`, `localhost:3879`, or
  `[::1]:3879` (DNS-rebinding defense).
- A browser `Origin` header, when present, must match the task-server origin
  (`http://localhost:3876` or `http://127.0.0.1:3876`). CORS preflight allows
  only `Content-Type` and `Authorization` headers.
- Mutating methods (`POST`, `PUT`, `DELETE`) must send
  `Content-Type: application/json`; anything else returns `415`.
- Every write path validates file names via `validateMemoryPath`: only `.md`
  files, no hidden files, no path traversal. Violations return an error and
  the file is never touched.

### `GET /api/memory/list`

List memory files in the agent workspace.

**Response** `200`:

```json
{
  "files": [
    {
      "name": "2026-03-15.md",
      "title": "March 15",
      "size": 2048,
      "lines": 42,
      "modified": "2026-03-15T10:00:00Z",
      "isDaily": true,
      "isSpecialized": false
    }
  ]
}
```

### `GET /api/memory/file/:name`

Read a specific memory file by name.

**URL parameters**:

| Param | Type | Description |
|---|---|---|
| `name` | string | Memory file name (e.g. `2026-03-15.md`) |

**Response** `200`:

```json
{
  "name": "2026-03-15.md",
  "content": "# March 15\n...",
  "size": 2048,
  "lines": 42
}
```

### `POST /api/memory/file/:name`

Create a new memory file.

**URL parameters**:

| Param | Type | Description |
|---|---|---|
| `name` | string | Memory file name to create |

**Body**:

```json
{ "content": "# New Memory\nInitial content..." }
```

**Response** `201`:

```json
{ "created": true, "name": "new-topic.md", "size": 31 }
```

### `PUT /api/memory/file/:name`

Write content to an existing memory file.

**URL parameters**:

| Param | Type | Description |
|---|---|---|
| `name` | string | Memory file name to update |

**Body**:

```json
{ "content": "# March 15\nUpdated content..." }
```

**Response** `200`:

```json
{ "saved": true, "name": "2026-03-15.md", "size": 256 }
```

### `POST /api/memory/file/:name/append`

Append content to an existing memory file.

**URL parameters**:

| Param | Type | Description |
|---|---|---|
| `name` | string | Memory file name to append |

**Body**:

```json
{ "content": "\n- Follow-up note" }
```

**Response** `200`:

```json
{ "appended": true, "name": "2026-03-15.md", "size": 512 }
```

### `DELETE /api/memory/file/:name`

Delete a memory file.

**URL parameters**:

| Param | Type | Description |
|---|---|---|
| `name` | string | Memory file name to delete |

**Response** `200`:

```json
{ "deleted": true, "name": "old-topic.md" }
```

### `GET /api/memory/root`

Read the main MEMORY.md file.

**Response** `200`:

```json
{
  "name": "MEMORY.md",
  "content": "# Long-Term Memory\n...",
  "size": 4096
}
```

### `GET /api/memory/context`

Return prompt-ready memory context assembled from memory files.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `scope` | string | `all` | Context scope requested by the caller |
| `limit` | number | — | Maximum number of memory entries to include |

**Response** `200`:

```json
{
  "context": "## Long-Term Memory\n...",
  "sources": ["MEMORY.md", "memory/2026-03-15.md"]
}
```

### `GET /api/memory/search`

Search memory files using the unified query script (`scripts/memory_query_unified.js`).

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Search query |

**Response** `200`:

```json
{
  "results": [
    { "source": "memory/2026-03-15.md", "score": 0.85, "text": "..." }
  ]
}
```

### `GET /api/memory/facts`

Get aggregated facts statistics across all namespaces.

**Response** `200`:

```json
{
  "namespaces": [
    { "name": "general", "fact_count": 42 }
  ]
}
```

### `GET /api/memory/facts/list`

List facts, optionally filtered by namespace.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `namespace` | string | — | Filter by namespace |

**Response** `200`:

```json
{
  "facts": [
    { "key": "preference.theme", "value": "dark", "namespace": "general" }
  ]
}
```

### `POST /api/memory/facts`

Create or update a fact.

**Body**:

```json
{
  "key": "preference.theme",
  "value": "dark",
  "namespace": "general"
}
```

### `DELETE /api/memory/facts`

Delete a fact.

**Body**:

```json
{ "key": "preference.theme", "namespace": "general" }
```

### `GET /api/memory/facts/search`

Search facts by key or value.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Search query |
| `namespace` | string | — | Filter by namespace |

### `GET /api/memory/status`

Memory system status (index health, embeddings, etc.).

**Response** `200`:

```json
{
  "status": "ok",
  "memoryDir": "/root/.openclaw/workspace/main/memory",
  "fileCount": 15,
  "indexReady": true
}
```

### `GET /api/memory/stats`

Aggregate memory statistics.

**Response** `200`:

```json
{
  "totalFiles": 15,
  "totalSize": 45056,
  "totalLines": 890,
  "dailyNotes": 12,
  "specializedFiles": 3
}
```

---

## Filesystem API (Port 3880)

The filesystem API provides controlled access to files within the
`OPENCLAW_FS_ROOT` directory (default: `/root/.openclaw`). It enforces size
limits, blocks sensitive file extensions, and redacts secrets from responses.

**Security controls**:
- Bearer auth on every route: `Authorization: Bearer $DASHBOARD_AUTH_TOKEN`
  (SECURITY-AUDIT-2026-08.md F5). The server refuses to start without the token.
- Host header must be `127.0.0.1:<port>`, `localhost:<port>`, or `[::1]:<port>`
  (DNS-rebinding defense); other Host values get `403`.
- A browser `Origin` header, when present, must match the task-server origin
  (`http://localhost:3876` / `http://127.0.0.1:3876`); others get `403`.
- Mutating methods (`POST`/`PUT`/`DELETE`) require `Content-Type: application/json`
  (`415` otherwise).
- Max file read/write size: 2 MB (`MAX_FILE_BYTES`)
- Protected extensions blocked from read/write: `.pem`, `.key`, `.crt`, `.p12`
- Writes refused outright under `crontab/`, `.ssh/`, and `agents/*/sessions/`
  (reads stay allowed; those paths surface `readOnly: true`)
- Secret regex pattern redacts values in responses
- Max search results: 50

### `GET /api/fs/list`

List directory contents.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `path` | string | `/` | Directory path relative to FS root |

**Response** `200`:

```json
{
  "path": "/workspace/main",
  "entries": [
    { "name": "AGENTS.md", "type": "file", "size": 2048, "modified": "..." },
    { "name": "memory", "type": "directory" }
  ]
}
```

### `GET /api/fs/file`

Read a file's contents (max 2 MB).

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | File path relative to FS root |

**Response** `200`:

```json
{
  "path": "workspace/main/AGENTS.md",
  "content": "# AGENTS.md\n...",
  "size": 2048
}
```

**Error responses**:
- `400` — missing path, path outside root, protected extension
- `404` — file not found
- `413` — file exceeds 2 MB limit

### `PUT /api/fs/file`

Write content to a file (max 2 MB body).

**Body**:

```json
{
  "path": "workspace/main/test.txt",
  "content": "Hello world"
}
```

**Response** `200`:

```json
{ "saved": true, "path": "workspace/main/test.txt", "size": 11 }
```

### `POST /api/fs/file`

Append content to a file or create with content.

**Body**:

```json
{
  "path": "workspace/main/test.txt",
  "content": "Appended line"
}
```

### `POST /api/fs/mkdir`

Create a directory (recursive).

**Body**:

```json
{ "path": "workspace/main/memory/archive" }
```

**Response** `200`:

```json
{ "created": true, "path": "workspace/main/memory/archive" }
```

### `POST /api/fs/rename`

Rename or move a file/directory.

**Body**:

```json
{ "oldPath": "workspace/main/old.txt", "newPath": "workspace/main/new.txt" }
```

### `DELETE /api/fs/path`

Remove a file or empty directory.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Path to remove relative to FS root |

**Response** `200`:

```json
{ "removed": true, "path": "workspace/main/test.txt" }
```

### `GET /api/fs/search`

Search for files matching a pattern.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Search query |
| `path` | string | `/` | Root directory to search from |

**Response** `200`:

```json
{
  "results": [
    { "path": "workspace/main/AGENTS.md", "type": "file", "size": 2048 }
  ]
}
```

### `GET /api/fs/stat`

Get file/directory metadata.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | Path relative to FS root |

**Response** `200`:

```json
{
  "path": "workspace/main/AGENTS.md",
  "type": "file",
  "size": 2048,
  "modified": "2026-03-15T10:00:00Z"
}
```

---

## Organization API

The org API serves as the single source of truth for department and agent
metadata. It falls back to the bootstrap data in `org-bootstrap.js` when the
database tables are unavailable.

### `GET /api/org/summary`

Get a summary of the organization — department counts, agent counts, and
quick stats.

**Response** `200`:

```json
{
  "totalDepartments": 9,
  "totalAgents": 42,
  "liveSummary": {
    "totalAgents": 42,
    "onlineAgents": 5,
    "offlineAgents": 37
  },
  "departments": [ ... ]
}
```

### `GET /api/org/departments`

List all departments.

**Response** `200`:

```json
{
  "departments": [
    {
      "slug": "core-platform",
      "name": "Core Platform",
      "description": "Primary orchestration, repair, and core coding agents.",
      "color": "#6366f1",
      "icon": "cpu",
      "sortOrder": 10,
      "agentCount": 3,
      "onlineCount": 1
    }
  ]
}
```

### `GET /api/org/agents`

List all agent profiles.

**Response** `200`:

```json
{
  "agents": [
    {
      "agentId": "main",
      "displayName": "Main Agent",
      "departmentSlug": "core-platform",
      "role": "orchestrator",
      "capabilities": ["orchestration", "coding", "analysis", "memory"],
      "status": "online"
    }
  ]
}
```

### `GET /api/org/agents/:id`

Get a single agent's profile by ID.

**Response** `200`:

```json
{
  "agentId": "main",
  "displayName": "Main Agent",
  "departmentSlug": "core-platform",
  "role": "orchestrator",
  "capabilities": ["orchestration", "coding", "analysis", "memory"]
}
```

**Error responses**: `404` — agent not found.

---

## Service Catalog API

The service catalog defines available services offered by departments. Services
can be linked to workflow templates and tracked via service requests.

### `GET /api/services`

List all services, optionally filtered.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `department_id` | string | — | Filter by department UUID |
| `active` | boolean | — | Filter by active status |
| `search` | string | — | Text search on name/description |

**Response** `200`:

```json
{
  "services": [
    {
      "id": "uuid",
      "slug": "content-publishing",
      "name": "Content Publishing",
      "description": "End-to-end content creation and publishing.",
      "department_id": "dept-uuid",
      "category": "content",
      "is_active": true,
      "tags": ["publishing", "wordpress"],
      "metadata": {}
    }
  ]
}
```

### `GET /api/services/:id`

Get a single service by UUID.

### `POST /api/services`

Create a new service entry.

**Body**:

```json
{
  "name": "Bug Fixing",
  "slug": "bug-fixing",
  "description": "Triage, investigate, fix, and verify bugs.",
  "department_id": "dept-uuid",
  "category": "engineering"
}
```

**Response**: `201` with the created service.

### `PATCH /api/services/:id`

Update a service. Accepts partial fields.

### `DELETE /api/services/:id`

Soft-delete (deactivate) a service. **Response**: `200`.

---

## Service Requests API

Service requests track incoming requests for services. Each request is routed to
a department and optionally assigned to a specific agent.

### `GET /api/service-requests`

List service requests.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter by status (`open`, `in_progress`, `completed`, `cancelled`) |
| `priority` | string | — | Filter by priority (`low`, `medium`, `high`, `critical`) |
| `service_id` | string | — | Filter by service UUID |
| `department_id` | string | — | Filter by target department |
| `limit` | number | 50 | Pagination limit |
| `offset` | number | 0 | Pagination offset |

**Response** `200`:

```json
{
  "requests": [
    {
      "id": "uuid",
      "title": "Add comparison table to review",
      "service_id": "svc-uuid",
      "target_department_id": "dept-uuid",
      "target_agent_id": "affiliate-editorial",
      "status": "open",
      "priority": "medium",
      "created_at": "2026-03-15T10:00:00Z"
    }
  ],
  "total": 15
}
```

### `GET /api/service-requests/:id`

Get a single service request by UUID.

### `POST /api/service-requests`

Create a new service request.

**Body**:

```json
{
  "title": "Add comparison table",
  "description": "Add a 3-column comparison table to the product review.",
  "service_id": "svc-uuid",
  "target_department_id": "dept-uuid",
  "priority": "medium"
}
```

**Response**: `201` with the created request.

### `PATCH /api/service-requests/:id`

Update a service request (change status, priority, assignment, etc.).

---

## Model Catalog API

The model catalog provides information about available AI models and their
providers, sourced from `~/.openclaw/openclaw.json`.

### `GET /api/catalog/models`

List all available models.

**Response** `200`:

```json
{
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o",
      "provider": "openai",
      "reasoning": false,
      "contextWindow": 128000,
      "maxTokens": 16384,
      "displayName": "GPT-4o · openai"
    }
  ]
}
```

### `GET /api/catalog/providers`

List all model providers.

**Response** `200`:

```json
{
  "providers": [
    {
      "id": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "api": "openai-completions",
      "modelCount": 5
    }
  ]
}
```

### `GET /api/catalog/refresh`

Force a re-read of the OpenClaw config file and refresh the catalog. Triggered
automatically via `sync-models-catalog.js` on a file-watch interval or on
demand.

**Response** `200`:

```json
{
  "models": 12,
  "providers": 3,
  "syncedAt": "2026-03-15T10:30:00Z"
}
```

---

## Metrics API

The metrics API provides aggregated statistics and trend data.

### `GET /api/metrics/summary`

Get dashboard-wide summary metrics.

**Response** `200`:

```json
{
  "tasks": { "total": 150, "completed": 80, "active": 20, "blocked": 5 },
  "workflowRuns": { "total": 40, "active": 3, "completed": 35, "failed": 2 },
  "agents": { "total": 42, "online": 5 },
  "departments": { "total": 9 },
  "approvals": { "pending": 2, "total": 10 }
}
```

### `GET /api/metrics/department/:slug`

Get metrics scoped to a specific department.

**Path parameters**: `slug` — department slug (e.g., `content-publishing`)

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | number | 7 | Lookback period in days |

**Response** `200`:

```json
{
  "department": "content-publishing",
  "tasks": { "total": 30, "completed": 20 },
  "agents": { "total": 12, "online": 2 },
  "dailyMetrics": [
    { "date": "2026-03-15", "completed": 5, "created": 2 }
  ]
}
```

### `GET /api/metrics/trends`

Get time-series trend data.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `metric` | string | `tasks_completed` | Metric to trend |
| `days` | number | 30 | Lookback period |
| `granularity` | string | `day` | `day` or `week` |

**Response** `200`:

```json
{
  "metric": "tasks_completed",
  "granularity": "day",
  "data": [
    { "date": "2026-03-15", "value": 5 },
    { "date": "2026-03-16", "value": 8 }
  ]
}
```

---

## Diagnostics API

The diagnostics API provides system health introspection and the cron guard
mechanism.

### `GET /api/diagnostics/info`

Get system diagnostic information — runtime versions, uptime, environment.

**Response** `200`:

```json
{
  "nodeVersion": "v22.22.0",
  "platform": "linux",
  "uptime": 86400,
  "memoryUsage": { "rss": "128MB", "heapUsed": "64MB" },
  "openclawVersion": "1.0.0"
}
```

### `GET /api/diagnostics/state`

Get the current diagnostics state, including cron guard status.

**Response** `200`:

```json
{
  "cronGuard": {
    "stateFile": "/tmp/openclaw-heartbeat-cron-guard-state.json",
    "lastGuardAt": "2026-03-15T10:00:00Z",
    "acknowledged": false
  },
  "lastCheckAt": "2026-03-15T10:30:00Z"
}
```

### `POST /api/diagnostics/check`

Run a diagnostic check suite and return results.

**Body** (optional):

```json
{
  "checks": ["database", "api", "cron", "filesystem"]
}
```

**Response** `200`:

```json
{
  "checks": [
    { "name": "database", "status": "ok", "latencyMs": 5 },
    { "name": "api", "status": "ok", "latencyMs": 2 },
    { "name": "cron", "status": "warning", "message": "Guard not acknowledged" }
  ],
  "overall": "degraded"
}
```

### `POST /api/diagnostics/guard`

Update the cron guard state.

**Body**:

```json
{
  "action": "acknowledge",
  "reason": "Manual check passed"
}
```

**Response** `200`:

```json
{ "status": "acknowledged", "updatedAt": "2026-03-15T10:30:00Z" }
```

---

## Workflow Runs API

Workflow runs track execution instances of workflow templates. These endpoints
are served from `workflow-runs-api.js` on the primary task server (port 3876).

### `GET /api/workflow-runs`

List workflow runs with optional filters.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter by status |
| `workflow_type` | string | — | Filter by workflow type |
| `owner_agent_id` | string | — | Filter by owner agent |
| `department_id` | string | — | Filter by department |
| `limit` | number | 50 | Pagination limit |
| `offset` | number | 0 | Pagination offset |
| `sort` | string | `created_at` | Sort field |
| `order` | string | `desc` | Sort direction |

**Response** `200`:

```json
{
  "runs": [
    {
      "id": "uuid",
      "workflow_type": "citation-improvement",
      "status": "running",
      "owner_agent_id": "affiliate-editorial",
      "input_payload": { ... },
      "current_step": "fact_checking",
      "started_at": "2026-03-15T10:00:00Z",
      "created_at": "2026-03-15T10:00:00Z"
    }
  ],
  "total": 25
}
```

### `POST /api/workflow-runs`

Create a new workflow run.

**Body**:

```json
{
  "workflow_type": "citation-improvement",
  "owner_agent_id": "affiliate-editorial",
  "input_payload": {
    "title": "Best espresso machines 2026",
    "article_url": "https://example.com/best-espresso"
  },
  "department_id": "dept-uuid",
  "run_priority": "medium"
}
```

**Response** `201` with the created run.

### `GET /api/workflow-runs/:id`

Get a workflow run with its steps.

**Response** `200`:

```json
{
  "run": { ... },
  "steps": [
    {
      "id": "uuid",
      "workflow_run_id": "run-uuid",
      "step_name": "fetch_article",
      "status": "completed",
      "started_at": "...",
      "finished_at": "...",
      "output_summary": { ... }
    }
  ]
}
```

### `PATCH /api/workflow-runs/:id`

Update a workflow run (partial fields).

### `DELETE /api/workflow-runs/:id`

Cancel and delete a workflow run.

**Response** `200`:

```json
{ "deleted": true, "id": "uuid" }
```

### `POST /api/workflow-runs/:id/start`

Start (begin execution of) a workflow run.

### `POST /api/workflow-runs/:id/heartbeat`

Record a heartbeat to indicate the run is still alive.

**Body**:

```json
{
  "current_step": "fact_checking",
  "progress": 0.5,
  "message": "Processing citation 3 of 7"
}
```

### `POST /api/workflow-runs/:id/complete`

Mark a workflow run as completed.

**Body**:

```json
{
  "summary": "Added 5 citations and comparison table",
  "published_url": "https://...",
  "draft_url": "https://...",
  "image_url": "https://..."
}
```

Top-level string values (e.g., `published_url`, `draft_url`) are automatically
captured as workflow artifacts.

### `POST /api/workflow-runs/:id/fail`

Mark a workflow run as failed.

**Body**:

```json
{
  "error": "WordPress API returned 500",
  "step": "publishing"
}
```

### `POST /api/workflow-runs/:id/step`

Update the current step of a workflow run.

**Body**:

```json
{
  "step_name": "fact_checking",
  "status": "in_progress"
}
```

### `POST /api/workflow-runs/:id/cancel`

Cancel a running workflow run. Requires governance authorization.

### `POST /api/workflow-runs/:id/pause`

Pause a running workflow run. Records `paused_at`, `paused_by`, and `pause_reason`.

**Body**:

```json
{ "reason": "Awaiting external dependency" }
```

### `POST /api/workflow-runs/:id/resume`

Resume a paused workflow run. Records `resumed_at` and `resumed_by`.

### `POST /api/workflow-runs/:id/escalate`

Escalate a workflow run to a higher-level agent or operator.

**Body**:

```json
{
  "escalated_to": "dashboard-operator",
  "reason": "Requires human decision on pricing data"
}
```

### `POST /api/workflow-runs/:id/reassign`

Reassign a workflow run to a different agent.

**Body**:

```json
{
  "new_owner": "bug-fix_fixer",
  "reason": "Rerouting to specialist"
}
```

### `POST /api/workflow-runs/:id/override-failure`

Override a failed run status, resetting it to allow re-execution.

**Body**:

```json
{
  "reason": "External API issue resolved, retrying"
}
```

### `POST /api/workflow-runs/:id/bind-session`

Bind a gateway session to a workflow run (sets `gateway_session_id` and
`gateway_session_active = true`).

**Body**:

```json
{
  "sessionId": "wf-uuid-pid12345"
}
```

### `POST /api/workflow-runs/:id/unbind-session`

Unbind the gateway session from a run (sets `gateway_session_active = false`).

### `GET /api/workflow-runs/:id/artifacts`

List artifacts associated with a workflow run.

### `POST /api/workflow-runs/:id/artifacts`

Create an artifact for a workflow run.

**Body**:

```json
{
  "artifact_type": "url",
  "name": "Published Article",
  "value": "https://example.com/article",
  "metadata": {}
}
```

### `GET /api/workflow-runs/:id/approvals`

List approvals for a workflow run.

### `POST /api/workflow-runs/:id/approvals`

Create an approval gate for a workflow run step.

**Body**:

```json
{
  "step_name": "operator_review",
  "approver_id": "dashboard-operator",
  "requested_by": "system-improvement-scan",
  "approval_type": "improvement_suggestion",
  "metadata": {
    "category": "performance",
    "priority": "medium",
    "action_prompt": "Add caching to reduce API latency by ~40%"
  },
  "required_note": false
}
```

### `GET /api/workflow-runs/stuck`

List workflow runs that appear stuck (running but no heartbeat for a configurable
threshold).

### `GET /api/workflow-runs/active`

List currently active (running/in-progress) workflow runs.

### `POST /api/workflow-runs/cleanup-timeouts`

Cleanup zombie sessions — marks runs as timed out if their gateway sessions are
no longer active.

---

## Workflow Routing API

Workflow routing rules map workflow types to target agents for dispatcher
assignment.

### `GET /api/workflow-routing`

List all workflow routing rules ordered by descending priority.

**Response** `200`:

```json
{
  "routes": [
    {
      "workflow_type": "citation-improvement",
      "agent_id": "affiliate-editorial",
      "priority": 10,
      "max_concurrent": 1,
      "timeout_minutes": 60
    }
  ]
}
```

### `PUT /api/workflow-routing`

Create or update a routing rule for a workflow type.

**Body**:

```json
{
  "workflow_type": "citation-improvement",
  "agent_id": "affiliate-editorial",
  "priority": 10,
  "max_concurrent": 1,
  "timeout_minutes": 60
}
```

`workflow_type` and `agent_id` are required. Omitted numeric fields default to
`priority: 5`, `max_concurrent: 1`, and `timeout_minutes: 60`.

**Response** `200` with the inserted or updated routing row.

### `DELETE /api/workflow-routing/:type`

Delete the routing rule for a workflow type.

**Response** `200`:

```json
{ "deleted": true }
```

Returns `404` when no rule exists for `type`.

---

## Workflow Graph API

Read-only telemetry for the workflow visual editor Stage 1 (workflows view
Graph toggle). One endpoint, instrumentation only: appends `audit_log` rows
that feed the Stage-2 GO/NO-GO earn-use metric (≥8 distinct render-days AND
≥3 explicit asks within 21 days of staging deploy). It never touches workflow
state.

### `POST /api/workflow-graph/events`

Record one earn-use event.

**Body**:

```json
{
  "event": "open",
  "template": "topic-discovery"
}
```

- `event` (required): `open` (first successful graph render per view-session)
  or `feedback` (operator 👍/👎 on the "Should editing happen here?" chip).
- `template` (required): workflow template name matching `[a-z0-9-]+`.
- `helpful` (required for `feedback`): boolean verdict.
- `note` (optional): free-text feedback, trimmed and capped at 500 chars.

Validation failures return `400` with a named error:
`invalid_body` / `invalid_event` / `invalid_template` / `invalid_helpful`.

**Response** `200` on success:

```json
{ "stored": true, "action": "workflow-graph-open" }
```

Audit actions written: `workflow-graph-open`, `workflow-graph-feedback`
(actor `dashboard-operator`, `task_id` NULL — same non-task precedent as the
import marker rows in export-routes).

**Degradation** (telemetry must never bother the operator — the graph view
fires these fire-and-forget): without a database pool or when `audit_log` is
missing, the endpoint answers `200 {"stored": false, "reason":
"no_database" | "audit_log_missing"}` instead of erroring; unexpected write
failures return `500 {"error": "query_failed"}`.

---

## MCP Telemetry API

Adoption telemetry for the dashboard MCP server (improvement-loop queue:
"did anything actually call our tools?"). One endpoint, instrumentation
only: appends an `audit_log` row per MCP tool call reported by
lib/mcp-server.js, which fires these POSTs fire-and-forget after each
executed `tools/call`. Counts feed `npm run mcp:telemetry`
(scripts/mcp-adoption-counter.js). It never touches task/workflow state.

### `POST /api/mcp/telemetry`

Record one MCP tool-call event.

**Body**:

```json
{
  "tool": "list_tasks",
  "outcome": "ok",
  "durationMs": 42
}
```

- `tool` (required): a tool name from the live registry (all 13, mutating
  trio included — the flag governs visibility at the MCP layer, not name
  validity).
- `outcome` (required): `ok` or `error` (validation rejections and upstream
  failures count as `error`).
- `durationMs` (required): non-negative integer, capped at one hour.

Validation failures return `400` with a named error:
`invalid_body` / `invalid_tool` / `invalid_outcome` / `invalid_duration`.
Validation runs BEFORE the pool check, so bad payloads get named errors even
in json_snapshot/no-DB mode.

**Response** `200` on success:

```json
{ "stored": true, "action": "mcp-tool-call" }
```

Audit action written: `mcp-tool-call` (actor `openclaw`, `task_id` NULL,
`new_value` JSONB `{tool, outcome, durationMs}`).

**Degradation** (the MCP client's emission is fire-and-forget and must never
bother anyone): without a database pool or when `audit_log` is missing, the
endpoint answers `200 {"stored": false, "reason": "no_database" |
"audit_log_missing"}` instead of erroring; unexpected write failures return
`500 {"error": "query_failed"}`.

---

## Workflow Templates API

### `GET /api/workflow-templates`

List all workflow templates.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `department_id` | string | — | Filter by department |
| `ui_category` | string | — | Filter by UI category |

**Response** `200`:

```json
{
  "templates": [
    {
      "name": "citation-improvement",
      "display_name": "Citation Improvement",
      "description": "Add/improve citations on affiliate articles",
      "steps": ["fetch", "analyze", "fact_check", "update", "publish"],
      "department_id": "dept-uuid",
      "ui_category": "content"
    }
  ]
}
```

### `GET /api/workflow-templates/:name`

Get a single template by name.

### `POST /api/workflow-templates`

Create a new workflow template.

### `PATCH /api/workflow-templates/:name`

Update an existing workflow template.

---

## Approvals API

### `GET /api/approvals`

List all approvals.

### `GET /api/approvals/pending`

List pending approvals, optionally filtered by approver.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `approver_id` | string | — | Filter by approver |
| `limit` | number | 50 | Max results |

**Response** `200`:

```json
{
  "approvals": [
    {
      "id": "uuid",
      "workflow_run_id": "run-uuid",
      "step_name": "operator_review",
      "status": "pending",
      "approver_id": "dashboard-operator",
      "approval_type": "improvement_suggestion",
      "created_at": "2026-03-15T10:00:00Z"
    }
  ]
}
```

### `PATCH /api/approvals/:id`

Decide on an approval (approve or reject).

**Body**:

```json
{
  "decision": "approved",
  "decided_by": "dashboard-operator",
  "note": "Looks good, proceed"
}
```

### `POST /api/approvals/:id/escalate`

Escalate an approval to another approver.

**Body**:

```json
{
  "escalated_to": "main",
  "reason": "Requires orchestrator review"
}
```

---

## Artifacts API

### `GET /api/artifacts`

List artifacts across all workflow runs.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `workflow_run_id` | string | — | Filter by run |
| `artifact_type` | string | — | Filter by type (`url`, `file`, `text`) |
| `status` | string | — | Filter by status |

### `PATCH /api/artifacts/:id`

Update an artifact's metadata or status.

### `DELETE /api/artifacts/:id`

Delete an artifact.

---

## Blockers API

### `GET /api/blockers`

List current blockers across tasks and workflow runs.

**Response** `200`:

```json
{
  "blockers": [
    {
      "id": "uuid",
      "sourceType": "task",
      "sourceId": "task-uuid",
      "blockerType": "dependency",
      "description": "Waiting on task ABC",
      "severity": "medium",
      "createdAt": "2026-03-15T10:00:00Z"
    }
  ]
}
```

### `GET /api/blockers/summary`

Get a summary of blockers grouped by type.

**Response** `200`:

```json
{
  "total": 5,
  "byType": [
    { "blockerType": "dependency", "count": 3, "severity": "medium" },
    { "blockerType": "external_api", "count": 2, "severity": "high" }
  ]
}
```

---

## Sessions API

### `GET /api/sessions/active`

List currently active gateway sessions associated with workflow runs.

### `POST /api/sessions/:id/heartbeat`

Record a heartbeat for a session, keeping it marked as active.

---

## Task Sessions API

Read-only bindings between a dashboard task and the gateway sessions that
worked on it (docs/briefs/task-session-binding.md). The join is derived at
read time from `workflow_runs.task_id` → `gateway_session_id` (which stores an
OpenClaw session **key**, `agent:<agentId>:<kind>:<id>`) and resolved against
each agent's `sessions.json`. No write-time bookkeeping; the dispatcher
remains the sole writer of the binding columns.

### `GET /api/tasks/:id/sessions`

List the gateway sessions bound to a task's workflow runs, newest run first,
capped at the 20 most recent runs. Response carries metadata only — never
transcript bodies.

**Response** `200`:

```json
{
  "taskId": "uuid",
  "sessions": [
    {
      "runId": "uuid",
      "workflowType": "code-change",
      "runStatus": "completed",
      "isActiveRun": false,
      "sessionKey": "agent:coder:main",
      "agentId": "coder",
      "sessionId": "abc123",
      "sessionActive": false,
      "liveness": "completed",
      "startedAt": 1787530620467,
      "finishedAt": 1787530999999,
      "heartbeatAt": 1787530990000,
      "retryCount": 0,
      "retryCycled": false,
      "deepLink": {
        "view": "session-replay",
        "params": { "agent": "coder", "session": "abc123" }
      }
    }
  ]
}
```

**Field semantics:**

| Field | Meaning |
|---|---|
| `liveness` | `live` (run still active per migration-001 ∪ 021 status vocabulary), `completed`, or `failed` |
| `sessionId` | resolved from sessions.json; `null` = orphaned transcript (key retained, file gone) |
| `retryCycled` | R1 honesty flag — re-queued runs lose earlier `gateway_session_id` values, so only the latest attempt's session survives a retry cycle |
| `deepLink` | view-routing hint: `console` (by session key) when live, `session-replay` (by sessionId) otherwise; `null` when unresolvable — links are never fabricated |

**Errors:** unknown task → `404 {error}`; storage uninitialized → `503
{error: "Asana storage not initialized"}` (the Tasks view hides the Sessions
section on non-200).

Pure mapping logic lives in `lib/task-session-binding.js` (`parseSessionKey`,
`deriveLiveness`, `buildTaskSessionBindings`), fixture-tested DB-free in
tests/test-task-session-binding.js.

---

## OpenClaw Session Reader API

Read OpenClaw agent session metadata and JSONL conversation history. These routes are read-only and require the dashboard bearer token.

### `GET /api/oc/agents`

List OpenClaw agents discovered by the session reader.

**Response** `200`:

```json
{
  "agents": [
    { "agentId": "main", "sessions": 12 }
  ]
}
```

### `GET /api/oc/sessions`

List session metadata for one agent, or for all agents when `all=true`.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent ID to read when `all` is not `true` |
| `all` | boolean | `false` | When `true`, flatten sessions across all agents |
| `active` | number | none | Return only sessions updated within the last N minutes |

**Response** `200`:

```json
{
  "agentId": "main",
  "sessions": [
    {
      "sessionId": "session-uuid",
      "key": "agent:main:webchat:abc",
      "kind": "webchat",
      "channel": "webchat",
      "icon": "💬",
      "status": "active",
      "updatedAt": 1770897600000
    }
  ],
  "total": 1
}
```

When `all=true`, each session also includes `agentId` and the top-level `agentId` field is omitted.

### `GET /api/oc/sessions/:sessionId`

Return one session's metadata plus the latest messages.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent ID that owns the session |
| `messages` | number | `30` | Number of latest messages to include |

**Response** `200`:

```json
{
  "sessionId": "session-uuid",
  "key": "agent:main:webchat:abc",
  "kind": "webchat",
  "channel": "webchat",
  "icon": "💬",
  "status": "active",
  "messages": [
    { "line": 42, "type": "message", "message": { "role": "assistant", "content": "Ready." } }
  ],
  "totalLines": 42,
  "hasOlder": true,
  "oldestLine": 12
}
```

Returns `404` with `{ "error": "Session not found" }` when the session metadata is unavailable.

### `GET /api/oc/sessions/:sessionId/messages`

Return paginated session JSONL entries.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent ID that owns the session |
| `after` | number | `0` | Start reading after this line number |
| `limit` | number | `50` | Maximum entries to return |
| `filter` | string | `messages` | `messages` for chat messages only, or `all` for all supported JSONL entry types |

**Response** `200`:

```json
{
  "sessionId": "session-uuid",
  "messages": [
    { "line": 43, "type": "message", "message": { "role": "user", "content": "Next step?" } }
  ],
  "nextCursor": null,
  "hasMore": false
}
```

### `GET /api/oc/sessions/:sessionId/events`

Return cursor-paginated, normalized replay events for a session transcript (session replay inspector, part 1). Each JSONL line is normalized into typed events: `session_meta`, `model_change`, `user_message`, `assistant_thinking`, `tool_call`, `tool_result`, `compaction`, or a generic `other` tick — unknown/forward-compat line types pass through as `other` ticks and are never dropped. An assistant line carrying multiple content blocks fans out into one event per block, all sharing the same `line` number. Tool calls are back-paired with their `toolResult` line via `toolCallId` (`tool.resultLine`). Preview bodies are truncated to 400 characters; full bodies stay reachable through the `/events/:line` detail endpoint.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent ID that owns the session |
| `afterLine` | number | `0` | Start after this JSONL line number (exclusive cursor) |
| `limit` | number | `500` | Maximum events to return, capped at 2000 |

**Response** `200`:

```json
{
  "sessionId": "session-uuid",
  "agentId": "main",
  "events": [
    {
      "line": 4,
      "ts": 1770897600000,
      "kind": "tool_call",
      "role": "assistant",
      "tool": {
        "toolCallId": "call_1",
        "name": "exec",
        "argsPreview": "{\"command\":\"npm test\"}",
        "resultLine": 5
      }
    },
    {
      "line": 5,
      "ts": 1770897601000,
      "kind": "tool_result",
      "role": "toolResult",
      "tool": {
        "toolCallId": "call_1",
        "name": "exec",
        "resultPreview": "all green",
        "details": { "status": "passed", "exitCode": 0, "durationMs": 1234, "cwd": "/tmp/proj" }
      }
    }
  ],
  "nextAfterLine": null,
  "hasMore": false,
  "totalLines": 42,
  "partial": false,
  "truncated": false
}
```

Pagination boundaries fall at line granularity: a page may exceed `limit` by the extra events of its last line, and scanning always runs to EOF so tool_call→tool_result back-pairing works across chunk edges. `partial` is `true` when at least one line failed to parse; `truncated` is `true` when the transcript exceeded the size cap (`SESSION_REPLAY_MAX_BYTES`, default 20 MB) and only the first cap bytes were read.

Returns `404` with `{ "error": "Session not found" }` when the transcript file does not exist.

### `GET /api/oc/sessions/:sessionId/events/:line`

Return full-fidelity detail for the event(s) at one JSONL line. Bodies are NOT truncated; the raw parsed source line is included as `source` so heavy fields such as exec-class `details.aggregated` remain reachable.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `agent` | string | `main` | Agent ID that owns the session |

**Response** `200`:

```json
{
  "sessionId": "session-uuid",
  "agentId": "main",
  "line": 4,
  "found": true,
  "event": { "line": 4, "ts": 1770897600000, "kind": "assistant_thinking", "role": "assistant", "text": "plan the run" },
  "extraEvents": [],
  "source": { "type": "message", "message": { "role": "assistant", "content": [] } },
  "totalLines": 42
}
```

`event` is the first normalized event at that line and `extraEvents` holds any remaining events fanned out from the same line.

Returns `400` with `{ "error": "Invalid line number" }` for non-numeric or sub-1 line values, `404` with `{ "error": "Session not found" }` when the transcript file does not exist, and `404` with `{ "error": "Event not found" }` when the line has no normalized event.

---

## Dashboard Agent Chat API

### `POST /api/agent/chat`

Send a dashboard-scoped message through the OpenClaw gateway. When dashboard context is provided, the server prefixes the message with the active view, space, project count, and recent task count before forwarding it to the gateway.

**Body:**

```json
{
  "message": "Summarize current blockers",
  "sessionKey": "dashboard-agent",
  "context": {
    "activeView": "tasks",
    "activeSpace": { "name": "Platform" },
    "stats": { "projects": 3, "recentTasks": 8 }
  }
}
```

`message` is required. `sessionKey` defaults to `dashboard-agent`.

### `GET /api/agent/chat/history`

Return recent history for the dashboard agent session.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `50` | Maximum history entries to request from the gateway |

**Response** `200`:

```json
{
  "history": [
    { "role": "user", "content": "Summarize current blockers" },
    { "role": "assistant", "content": "Two blockers need attention." }
  ]
}
```

---

## System Scan API

### `POST /api/system-scan/run`

Queue a system improvement scan — creates a workflow run that spawns an agent
to analyze the current system state and create approval-gated suggestions.

**Body** (optional):

```json
{
  "scan_areas": ["performance", "reliability", "documentation"],
  "max_suggestions": 10
}
```

**Response** `201`:

```json
{
  "workflowRunId": "uuid",
  "status": "queued",
  "message": "System improvement scan queued"
}
```

### `POST /api/system-scan/followup`

Inject a follow-up message into an existing scan run's agent session.

**Body**:

```json
{
  "run_id": "run-uuid",
  "message": "Focus on the cron timeout issues specifically"
}
```

---


## History / Time Travel API

### `GET /api/history`

List recent changes across all entities.

**Query parameters:** `limit` (max 100), `actor`, `action`, `entity_type`

**Response:** `{ entries: [...], total: number }`

### `GET /api/history/:taskId`

Full audit history for a specific task.

**Query parameters:** `limit` (max 200)

**Response:** `{ taskId, entries: [...], total }`

### `GET /api/history/:taskId/snapshot`

Point-in-time state from snapshots.

**Query parameters:** `at` (ISO timestamp, required)

**Response:** `{ snapshot: object, exact: boolean }`

### `GET /api/history/:taskId/diff`

Diff between two points in time.

**Query parameters:** `from`, `to` (ISO timestamps, required)

**Response:** `{ taskId, changes: [{ field, from, to }], from, to }`

### `GET /api/state-snapshots`

List recent state snapshots across all entities (Time Travel). Canonical path for this listing since the snapshot/restore build: the bare `/api/snapshots` path now serves the full-state artifact registry (see Snapshots API) because task-server.js registers snapshot-routes first. `/api/snapshots` remains registered on this handler too for isolated use, but is shadowed at integration time.

**Query parameters:** `limit` (max 200)

**Response:** `{ snapshots: [...], total }`

### `GET /api/snapshots/:entityType/:entityId`

List state snapshots for any entity.

**Query parameters:** `limit` (max 200)

**Response:** `{ snapshots: [...], total }`

### `POST /api/snapshots/:snapshotId/preview-revert`

Preview what reverting to a snapshot would change (no side effects).

**Response:** `{ snapshot, currentState, snapshotState }`

### `POST /api/snapshots/:snapshotId/revert`

Revert an entity to a previous snapshot state. Records pre-revert and revert snapshots.

**Body:** `{ actor: string }`

**Response:** `{ reverted: true, entityType, entityId }`

---

## Export / Import API

### `GET /api/export`

Export the entire dashboard as a JSON bundle.

**Response:** `{ version, exportedAt, projects, tasks, workflows, auditLog, settings }`

### `POST /api/import/preview`

Preview what an import would do without applying it.

**Body:** `{ version, projects?, tasks?, workflows?, auditLog?, settings? }`

**Response:** `{ version, projects, tasks, workflows, auditLog, hasSettings, projectNames }`

### `POST /api/import`

Import a bundle. Supports `merge` (default) and `replace` modes.

**Body:** `{ version, mode, projects?, tasks?, workflows?, auditLog?, settings? }`

**Response:** `{ imported: { projects, tasks, workflows, auditLog }, mode }`

---

## Spaces API

### `GET /api/spaces`

List all workspaces.

**Response:** `{ spaces: [...] }`

### `GET /api/spaces/:id`

Get a single workspace.

**Response:** Workspace object

### `POST /api/spaces`

Create a new workspace.

**Body:** `{ name, slug?, icon?, color?, description?, settings? }`

**Response:** Workspace object (201)

### `PUT /api/spaces/:id`

Update a workspace.

**Body:** `{ name?, slug?, icon?, color?, description?, settings?, sort_order?, is_default? }`

**Response:** Updated workspace

### `DELETE /api/spaces/:id`

Delete a workspace (cannot delete default).

**Response:** `{ deleted: true }`

### `POST /api/spaces/:id/duplicate`

Duplicate a workspace.

**Body:** `{ slug? }`

**Response:** New workspace (201)

### `POST /api/spaces/:id/set-default`

Set a workspace as the default workspace.

**Response:** Workspace object

### `GET /api/spaces/:id/projects`

List projects assigned to a workspace.

**Response:** `{ projects: [...] }`

### `PUT /api/spaces/:id/projects`

Batch assign projects to a workspace.

**Body:** `{ project_ids: [...] }`

**Response:** Assignment result from storage

### `GET /api/spaces/:id/stats`

Get workspace project and task counts.

**Response:** Workspace stats object

---

## Governance Module (Library)

`governance.js` is a **library module**, not a standalone API server. It is
imported by the workflow-runs-api and other server modules to enforce
authorization policies on workflow actions.

### Actions and Rules

| Action | Allowed Roles | Allowed Capabilities | Assigned Approver |
|---|---|---|---|
| `launch_workflow` | orchestrator, pipeline, specialist, operator | orchestration, automation, workflows, quality, auditing | — |
| `approve` | orchestrator, operator | quality, auditing, management | ✅ |
| `reject` | orchestrator, operator | quality, auditing, management | ✅ |
| `cancel_run` | orchestrator, operator | orchestration, management | — |
| `override_failure` | orchestrator, operator | orchestration, management, repair, diagnostics | — |
| `reassign_owner` | orchestrator, operator, pipeline | orchestration, management | — |
| `escalate_run` | orchestrator, operator, pipeline | orchestration, management | — |
| `escalate_approval` | orchestrator, operator, pipeline | orchestration, management, quality, auditing | — |
| `pause_run` | orchestrator, operator, pipeline | orchestration, management | — |
| `resume_run` | orchestrator, operator, pipeline | orchestration, management | — |

### Actor Resolution

The `normalizeActorContext()` function resolves actors into a standardized
context:

1. **System actors** (`system`, `dashboard-operator`, `openclaw`) → full
   operator privileges.
2. **Pattern match** (`ops-*`, `*-operator`, `*-controller`, `*-director`) →
   operator role.
3. **Database/Bootstrap profile** → role and capabilities from the profile.
4. **Unknown actors** → `external` role, no capabilities.

### Usage

```js
const { evaluateGovernanceAction, buildGovernancePolicySummary } = require('./governance.js');

// Check if an actor can perform an action
const result = evaluateGovernanceAction('approve', { id: 'main' });
// { allowed: true, actor: { id: 'main', role: 'orchestrator', ... }, policy: { ... } }

// Get policy summary for UI display
const summary = buildGovernancePolicySummary(['approve', 'cancel_run', 'escalate_run']);
// [{ action: 'approve', label: 'Approve', roles: [...], capabilities: [...] }, ...]
```
