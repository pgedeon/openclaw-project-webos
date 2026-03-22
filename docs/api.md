# Project Dashboard API Reference

Comprehensive documentation for the REST API provided by `task-server.js`.

**Base URL:** `http://localhost:3876` (adjust `PORT` as needed)  
**Authentication:** None by default; place behind a reverse proxy or VPN in production.  
**Content‑Type:** JSON for request/response bodies unless noted.  
**Pagination:** `?page=` and `?limit=` parameters where applicable (defaults: page=1, limit=50).

---

## Common Data Types

### Project

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "status": "active|paused|archived",
  "tags": ["string"],
  "default_workflow_id": "uuid",
  "metadata": {},
  "qmd_project_namespace": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

### Task

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "string",
  "description": "string",
  "status": "backlog|ready|in_progress|blocked|review|completed|archived",
  "priority": "low|medium|high|critical",
  "owner": "string|null",
  "due_date": "ISO8601|null",
  "start_date": "ISO8601|null",
  "estimated_effort": "number|null",
  "actual_effort": "number|null",
  "parent_task_id": "uuid|null",
  "dependency_ids": ["uuid"],
  "labels": ["string"],
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "completed_at": "ISO8601|null",
  "recurrence_rule": "string|null",
  "metadata": {}
}
```

### Audit Record

```json
{
  "timestamp": "ISO8601",
  "actor": "string",
  "action": "created|updated|deleted|status_changed|...",
  "task_id": "uuid|null",
  "project_id": "uuid|null",
  "old_value": "any|null",
  "new_value": "any|null"
}
```

---

## Health

### `GET /api/health`

Returns basic service health.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-15T16:25:16.870Z",
  "asana_storage": "enabled|disabled",
  "storage_type": "postgres|json",
  "port": 3876
}
```

---

## Projects

### `GET /api/projects`

List all projects.

**Query:**
- `status` (optional): filter by `active|paused|archived`
- `tags` (optional): comma-separated tags to match
- `search` (optional): case-insensitive name/description filter
- `include_meta=true` (optional): include task counts and related metadata
- `include_test=true` (optional): include filtered test/fixture projects
- `limit` (optional): maximum 200
- `offset` (optional): pagination offset

**Response:** array of Project objects (without `workflow` expansion).

### `GET /api/projects/default`

Resolve the startup project used by the dashboard when no explicit project is already selected.

**Response:** project summary object with task counts.

### `POST /api/projects`

Create a project.

**Body:** Partial Project (omit `id`, `created_at`, `updated_at`).

**Response:** `201 Created` with full Project object.

### `GET /api/projects/:id`

Get a single project.

**Response:** Project object, including `default_workflow` if set.

### `PATCH /api/projects/:id`

Update a project.

**Body:** fields to update.

**Response:** `200 OK` with updated Project.

### `DELETE /api/projects/:id`

Archive or delete a project.

**Response:** `200 OK` with `{ "deleted": true }`.

---

## Tasks

### `GET /api/tasks/all`

List tasks with optional project filter.

**Query:**
- `project_id` (optional): limit to a project
- `status` (optional): comma‑separated statuses
- `owner` (optional): filter by agent name
- `due_before`, `due_after` (optional): ISO8601 dates
- `includeGraph` (optional): `true` to include subtasks and dependencies recursively
- `depth` (optional): integer limit for recursion depth (default unlimited)
- `archived` (optional): `true` to include archived tasks; default `false` (active only)
- `updated_since` (optional): ISO8601 timestamp; return only tasks with `updated_at` greater than this value. Used for incremental sync.

**Response:** array of Task objects. If `includeGraph` is true, each task may have `subtasks` and `dependencies` arrays embedded.

### `GET /api/tasks/:id`

Get a single task.

**Query:**
- `includeGraph` (optional): `true` to embed subtasks and dependencies.

**Response:** Task object.

### `POST /api/tasks`

Create a task.

**Body:** Partial Task (omit `id`, `created_at`, `updated_at`, `completed_at`).

**Response:** `201 Created` with full Task (including generated UUID).

### `GET /api/task-options`

Return OpenClaw-aware defaults used by the task composer.

**Response:**

```json
{
  "defaults": {
    "agent": "main",
    "model": "provider/model"
  },
  "agents": [],
  "models": []
}
```

### `PATCH /api/tasks/:id`

Update a task.

**Body:** fields to update (validated).

**Response:** `200 OK` with updated Task.

### `DELETE /api/tasks/:id`

Soft‑delete a task. This sets `deleted_at` and clears `archived_at`, effectively hiding it from all standard listings. Returns `{ "deleted": true, "id": "uuid" }`.

**Response:** `200 OK`

### `POST /api/tasks/:id/archive`

Archive a task (preserve for history but hide from active lists). Sets `archived_at` to now. Cannot archive a task that is already deleted.

**Response:** `200 OK` with updated Task.

### `POST /api/tasks/:id/restore`

Restore a task from deletion or archiving. Clears both `deleted_at` and `archived_at`.

**Response:** `200 OK` with updated Task.

### `POST /api/tasks/:id/move`

Change the task’s status (workflow transition).

**Body:**

```json
{
  "status": "in_progress"
}
```

**Response:** `200 OK` with updated Task and `status_updated_at` set.

### `POST /api/tasks/:id/dependencies`

Add or remove dependencies.

**Body:**

```json
{
  "add": ["uuid"],
  "remove": ["uuid"]
}
```

**Response:** `200 OK` with updated `dependency_ids` array.

### `POST /api/tasks/:id/subtasks`

Link an existing task as a subtask.

**Body:**

```json
{
  "subtask_id": "uuid"
}
```

**Response:** `200 OK` with updated Task.

---

## Views

### Saved Views CRUD

#### `GET /api/views`

List saved views for a project.

**Query:**
- `project_id` (required): UUID of the project.

**Response:** Array of Saved View objects.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "name": "string",
    "filters": { "filter": "all|pending|completed|archived|my_tasks|overdue|blocked|no_due_date", "search": "string", "categoryFilter": "string", "sort": "newest|oldest|updated|alpha" },
    "sort": "string|null",
    "created_by": "string",
    "created_at": "ISO8601",
    "updated_at": "ISO8601"
  }
]
```

#### `POST /api/views`

Create a saved view.

**Body:**

```json
{
  "project_id": "uuid",
  "name": "string",
  "filters": { /* filter criteria object */ },
  "sort": "string|null",
  "created_by": "string"
}
```

**Response:** `201 Created` with the created Saved View object.

#### `GET /api/views/:id`

Get a single saved view by ID.

**Response:** Saved View object or `404 Not Found`.

#### `PATCH /api/views/:id`

Update a saved view (name, filters, sort fields).

**Body:** any of `name`, `filters`, `sort`.

**Response:** `200 OK` with updated Saved View; `404` if not found.

#### `DELETE /api/views/:id`

Delete a saved view.

**Response:** `200 OK` with `{ "deleted": true, "id": "uuid" }`; `404` if not found.

### Built-in Views

#### `GET /api/views/board`

Kanban board state.

**Query:**
- `project_id` (required): UUID of the project.

**Response:**

```json
{
  "project": { /* Project object */ },
  "workflow": { /* Workflow object with states array */ },
  "columns": {
    "backlog": [ /* Task objects */ ],
    "ready": [...],
    "in_progress": [...],
    "blocked": [...],
    "review": [...],
    "completed": [...]
  }
}
```

### `GET /api/views/timeline`

Timeline data for Gantt chart.

**Query:**
- `project_id` (required)
- `start` (optional, ISO8601) – window start
- `end` (optional, ISO8601) – window end

**Response:**

```json
{
  "project": { /* Project object */ },
  "tasks": [
    {
      "task": { /* Task object with dates */ },
      "subtasks": [],  // optionally included
      "dependencies": [] // list of { id, title, start_date, due_date }
    }
  ],
  "range": { "start": "ISO", "end": "ISO" }
}
```

### `GET /api/views/agent`

Agent’s task queue.

**Query:**
- `agent_name` (required): string
- `page` (optional, default 1)
- `limit` (optional, default 50)

**Response:**

```json
{
  "agent": "agent_name",
  "tasks": [ /* Task objects where owner=agent and status in [ready,in_progress] */ ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 120,
    "pages": 3
  }
}
```

---

## Agent Execution

### `POST /api/agent/claim`

Atomically lock a task for execution by an agent.

**Body:**

```json
{
  "task_id": "uuid",
  "agent_name": "string"
}
```

**Response:** `200 OK` with claimed Task (adds `locked_at`, `locked_by`).  
**Error:** `409 Conflict` if already locked; `404` if task not found.

### `POST /api/agent/release`

Unlock a task.

**Body:**

```json
{
  "task_id": "uuid"
}
```

**Response:** `200 OK` with `{ "released": true }`.  
**Error:** `404` if not found or not locked by caller.

---

## Agent Observability

### `POST /api/agents/heartbeat`

Record a heartbeat signal from an agent to indicate liveness. Typically called periodically by agents or the UI.

**Body:**

```json
{
  "agent_name": "string",
  "status": "online"
}
```

**Response:** `200 OK` with `{ "ok": true }`.

### `GET /api/agents/status`

Get liveness status for all agents that have reported a heartbeat.

**Response:**

```json
{
  "agents": [
    {
      "agent_name": "string",
      "last_seen_at": "ISO8601",
      "status": "online|offline|error",
      "metadata": {}
    }
  ]
}
```

### `POST /api/tasks/:id/retry`

Increment the retry count for a task and reset its status to `ready`, clearing any execution lock. Used to manually retry a failed task.

**Response:** `200 OK` with `{ "retried": true, "retry_count": number, "task": { ...task object... } }`  
**Errors:** `404` if task not found.

---

## Cron Management

### `GET /api/cron/jobs`

List all cron jobs defined in the `crontab/` directory.

**Response:**

```json
[
  {
    "id": "string (filename without .cron)",
    "name": "string (optional job name from file comment)",
    "schedule": "string (cron expression or description)",
    "enabled": true,
    "lastRun": "ISO8601|null",
    "nextRun": "ISO8601|null",
    "lastExitCode": number|null
  }
]
```

### `GET /api/cron/jobs/:id/runs`

Get execution history for a specific cron job.

**Query:**
- `limit` (optional, default 20): number of recent runs to return

**Response:**

```json
[
  {
    "timestamp": "ISO8601",
    "exitCode": number,
    "durationMs": number,
    "output": "string (last 4KB of stdout/stderr)"
  }
]
```

### `POST /api/cron/jobs/:id/run`

Manually trigger a cron job execution now (bypasses schedule).

**Response:** `200 OK` with:

```json
{
  "triggered": true,
  "jobId": "string",
  "timestamp": "ISO8601"
}
```

**Error:** `404` if job not found; `500` if job execution fails.

---

## Audit

### `GET /api/audit`

Retrieve audit log entries.

**Query:**
- `task_id` (optional)
- `actor` (optional)
- `action` (optional)
- `start_date`, `end_date` (optional, ISO8601)
- `limit` (optional, default 100, max 1000)
- `offset` (optional, default 0)

**Response:** array of Audit records, newest first (typically).

---

## Legacy Endpoints (for backward compatibility)

These are still supported but will be deprecated in favor of the Asana‑style API.

### `GET /api/tasks`

Reads `tasks.md` (legacy format). Returns array of simple tasks:

```json
[
  {
    "id": "number",
    "text": "string",
    "category": "string",
    "completed": boolean,
    "createdAt": "ISO",
    "updatedAt": "ISO|null"
  }
]
```

### `POST /api/tasks`

Writes to `tasks.md`. Body is an array of the above simple tasks. Not recommended for new integrations.

---

## Error Responses

All endpoints return appropriate HTTP status codes. On error, JSON body:

```json
{
  "error": "Human readable message"
}
```

Common codes:

- `400` – Bad request (validation failed)
- `404` – Not found
- `409` – Conflict (e.g., task already locked)
- `500` – Server error
- `503` – Storage unavailable

---

## Rate Limiting & Production

Currently no rate limiting is enforced. In production, put the server behind a reverse proxy (nginx, Traefik) and configure rate limits there. Also enable TLS.

---

## CORS

All endpoints include `Access-Control-Allow-Origin: *` for simplicity. Adjust `task-server.js` if you need stricter policies.

---

## Versioning

This API is stable as of v1.0 (February 2026). Breaking changes will be reflected in the endpoint path (e.g., `/api/v2/...`) and documented here.
