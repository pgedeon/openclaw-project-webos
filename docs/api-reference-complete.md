# Supplementary API Reference

> This document covers all server-side APIs **not** included in the main
> [api.md](api.md). Refer to that file for task, project, agent, cron, audit,
> and saved-views endpoints on the primary task server (port 3876).

## Table of Contents

- [Authentication API](#authentication-api)
  - [GET /api/auth/self](#get-apiauthself)
- [Realtime Events API](#realtime-events-api)
  - [GET /api/events](#get-apievents)
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
- [OpenClaw Session Reader API](#openclaw-session-reader-api)
  - [GET /api/oc/agents](#get-apiocagents)
  - [GET /api/oc/sessions](#get-apiocsessions)
  - [GET /api/oc/sessions/:sessionId](#get-apiocsessionssessionid)
  - [GET /api/oc/sessions/:sessionId/messages](#get-apiocsessionssessionidmessages)
- [Dashboard Agent Chat API](#dashboard-agent-chat-api)
  - [POST /api/agent/chat](#post-apiagentchat)
  - [GET /api/agent/chat/history](#get-apiagentchathistory)
- [System Scan API](#system-scan-api)
  - [POST /api/system-scan/run](#post-apisystem-scanrun)
  - [POST /api/system-scan/followup](#post-apisystem-scanfollowup)
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

## Realtime Events API

### `GET /api/events`

Opens a Server-Sent Events stream for browser clients that need live dashboard updates. The stream sends an initial comment frame, periodic heartbeat comments, and named events broadcast by task, project, space, gateway, and chat route handlers.

When `DASHBOARD_AUTH_TOKEN` is configured, this endpoint accepts either the standard `Authorization: Bearer <token>` header or `?token=<token>` for `EventSource` clients.

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

The cron manager monitors the `~/.openclaw/workspace/crontab` file and executes
scheduled jobs. It also provides a REST API for inspecting job runs.

### `GET /health`

Health check for the cron manager process.

**Response** `200`:

```json
{ "status": "ok", "uptime": 12345 }
```

### `GET /jobs`

List all defined cron jobs from the crontab file.

**Query parameters**: None

**Response** `200`:

```json
{
  "jobs": [
    {
      "id": "gateway-status-sync",
      "schedule": "*/30 * * * * *",
      "command": "node sync-gateway-status.mjs",
      "enabled": true
    }
  ]
}
```

### `GET /jobs/:id/runs`

Get recent execution runs for a specific cron job.

**Path parameters**: `id` — cron job identifier

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 20 | Max runs to return |

**Response** `200`:

```json
{
  "runs": [
    {
      "id": "run-uuid",
      "jobId": "gateway-status-sync",
      "startedAt": "2026-03-15T10:30:00Z",
      "finishedAt": "2026-03-15T10:30:02Z",
      "status": "success",
      "output": "Synced 5 agents"
    }
  ]
}
```

### `POST /jobs/:id/run`

Manually trigger a cron job run.

**Response** `200`:

```json
{ "triggered": true, "runId": "run-uuid" }
```

### `GET /runs`

List recent cron job runs across all jobs.

**Response** `200`:

```json
{
  "runs": [ ... ]
}
```

### `DELETE /runs/:runId`

Delete a specific run record.

**Response** `200`:

```json
{ "deleted": true }
```

### `GET /status`

Get the overall status of the cron manager.

**Response** `200`:

```json
{
  "status": "running",
  "totalJobs": 5,
  "activeJobs": 5,
  "lastTick": "2026-03-15T10:30:00Z"
}
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

The memory API provides access to the agent memory system — reading and writing
memory files, querying facts from the facts database, and running semantic
searches via the unified query script.

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
- Max file read/write size: 2 MB (`MAX_FILE_BYTES`)
- Protected extensions blocked from read/write: `.pem`, `.key`, `.crt`, `.p12`
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
