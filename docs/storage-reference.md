---
layout: default
---

# Storage Layer Reference

The OpenClaw WebOS uses a PostgreSQL-backed storage layer that provides CRUD operations for projects, tasks, workflows, dependencies, and all related entities.

**Source:** `storage/asana.js`

---

## Architecture

The storage layer is implemented as a single module (`storage/asana.js`) that exports an `AsanaStorage` class. It wraps a PostgreSQL connection pool and provides methods for all dashboard data operations.

### Connection

```javascript
const storage = new AsanaStorage({
  host: 'localhost',
  port: 5432,
  database: 'openclaw_dashboard',
  user: 'openclaw',
  password: 'change-me'
});
```

Connection parameters are read from environment variables (see [configuration-reference.md](configuration-reference.md)).

---

## Entity Operations

### Projects

| Method | Description |
|--------|-------------|
| `listProjects(options)` | List projects with pagination, filtering by status/tags |
| `getProject(id)` | Get a single project by ID |
| `createProject(data)` | Create a new project |
| `updateProject(id, data)` | Update project fields |
| `deleteProject(id)` | Delete a project (cascade deletes tasks) |
| `getProjectByNamespace(namespace)` | Find project by QMD namespace |

**Options for `listProjects`:**
- `status` — Filter by status (`active`, `paused`, `archived`)
- `tags` — Filter by tags (array)
- `limit` — Page size (max 200)
- `offset` — Pagination offset
- `sort` — Sort field (`name`, `created_at`, `updated_at`)
- `order` — Sort direction (`asc`, `desc`)

### Tasks

| Method | Description |
|--------|-------------|
| `listTasks(options)` | List tasks with filtering, pagination, and search |
| `getTask(id)` | Get a single task with metadata |
| `createTask(data)` | Create a new task |
| `updateTask(id, data)` | Update task fields |
| `deleteTask(id)` | Delete a task |
| `batchUpdateTasks(updates)` | Update multiple tasks in a transaction |
| `getTasksByProject(projectId, options)` | List tasks for a project |
| `getTasksByStatus(status, options)` | List tasks by status |
| `getTasksByOwner(owner, options)` | List tasks assigned to an owner |
| `getTaskGraph(projectId)` | Get task dependency graph for a project |

**Task options:**
- `project_id` — Filter by project
- `status` — Filter by status
- `priority` — Filter by priority
- `owner` — Filter by owner
- `labels` — Filter by labels
- `search` — Full-text search in title and description
- `sort` — Sort field (`newest`, `oldest`, `updated`, `alpha`, `priority`, `due_date`)
- `limit` / `offset` — Pagination
- `updated_since` — Incremental sync (only tasks modified after timestamp)

### Workflows

| Method | Description |
|--------|-------------|
| `listWorkflows(options)` | List all workflows |
| `getWorkflow(id)` | Get a workflow by ID |
| `createWorkflow(data)` | Create a new workflow |
| `updateWorkflow(id, data)` | Update a workflow |
| `deleteWorkflow(id)` | Delete a workflow |
| `getDefaultWorkflow(projectId)` | Get default workflow for a project |

### Audit Log

| Method | Description |
|--------|-------------|
| `logAudit(taskId, actor, action, oldValue, newValue)` | Create an audit log entry |
| `getAuditLog(options)` | Query audit log with filters |
| `getAuditForTask(taskId)` | Get all audit entries for a task |

**Audit log options:**
- `task_id` — Filter by task
- `actor` — Filter by actor
- `action` — Filter by action type
- `from` / `to` — Date range filter
- `limit` / `offset` — Pagination

---

## Default Workflow States

```javascript
const DEFAULT_WORKFLOW_STATES = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'archived'
];
```

---

## Valid Values

### Task Priorities

```javascript
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
```

### Project Statuses

```javascript
const PROJECT_STATUSES = ['active', 'paused', 'archived'];
```

---

## Dependency Management

The storage layer automatically handles dependency-based blocking:

- When a task has `dependency_ids` pointing to incomplete tasks, its status may be auto-blocked
- When all dependencies complete, blocked tasks can be auto-unblocked
- Dependency block events are recorded in the audit log with action `auto_block_unmet_dependencies`

### `buildDependencyBlockHistoryEntry(incompleteDependencies, actor)`

Creates a structured audit entry for dependency-related status changes.

---

## Fixture Detection

The storage layer includes fixture project detection to filter out test data:

```javascript
const FIXTURE_PROJECT_PATTERNS = [
  /^board test project\b/i,
  /^test project\b/i,
  /^test$/i,
  /^my new project\b/i,
  /\bfixture\b/i,
  /\bseed\b/i
];
```

Projects matching these patterns are excluded from normal listings unless explicitly requested.

---

## Security

The storage layer integrates with `lib/qmd-security` for input validation and sanitization. Key protections:

- **SQL injection:** All queries use parameterized statements via `pg` Pool
- **Input normalization:** Metadata fields are validated as plain objects (no arrays)
- **Project ID normalization:** Empty or "all" project IDs are normalized to empty string (list all)
- **Pagination limits:** Maximum page size of 200 enforced

---

## Org Bootstrap Integration

The storage layer imports bootstrap data from `org-bootstrap.js`:

- **Departments:** `DEPARTMENTS` — Seed department definitions
- **Agent profiles:** `AGENT_PROFILES` — Seed agent profile definitions
- **Lookup helpers:** `getDepartmentBySlug()`, `getAgentProfileById()`

These are used as fallbacks when the database tables haven't been seeded yet (before migrations are applied).

---

## Error Handling

All storage methods return Promises and throw on database errors. The caller (task-server API layer) is responsible for:

1. Catching errors
2. Mapping to HTTP status codes (404, 500, etc.)
3. Returning error responses to the client

Common patterns:
- `SELECT ... WHERE id = $1` returning no rows → 404 Not Found
- `INSERT ... ON CONFLICT` → 409 Conflict (duplicate)
- Connection errors → 503 Service Unavailable

---

## Performance Notes

- **Connection pooling:** Uses `pg.Pool` with default pool size (10 connections)
- **Prepared statements:** All queries use parameterized `$1, $2, ...` placeholders
- **GIN indexes:** Array fields (`labels`, `dependency_ids`) and JSONB (`metadata`) have GIN indexes
- **Composite indexes:** Common query patterns (project+status, owner, due_date) have dedicated indexes
- **Pagination:** Always use `limit`/`offset` for large result sets
