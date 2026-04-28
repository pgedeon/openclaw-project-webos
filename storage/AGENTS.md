# storage/ — PostgreSQL Storage Layer

## Purpose

All persistent data access goes through `asana.js`. It owns PostgreSQL CRUD for tasks, projects, saved views, org/service APIs, audit logging, and export/import.

## Ownership

| File | Owns |
|------|------|
| `asana.js` | Complete storage layer: tasks, projects, views, audit, org, services, export/import |

## Database Connection

- Uses `pg.Pool` with `DATABASE_URL` environment variable
- Pool config: `max: 10`, `idleTimeoutMillis: 30000`
- Schema initialized from `schema/openclaw-dashboard.sql` + migrations

## Key Public Methods

- `getTasks(filters)`, `createTask(data)`, `updateTask(id, data)`, `deleteTask(id)`
- `getProjects()`, `createProject(data)`, `updateProject(id, data)`, `deleteProject(id)`
- `getSavedViews()`, `createSavedView(data)`, `updateSavedView(id, data)`, `deleteSavedView(id)`
- `getAuditLog(taskId, limit)`, `logAuditEntry(data)`
- `getOrgSummary()`, `getDepartments()`, `getAgents()`, `getAgentProfile(id)`
- `exportData()`, `importData(data)`

## Conventions

- All methods return promises
- UUIDs generated with `crypto.randomUUID()`
- Timestamps use `new Date().toISOString()`
- Methods validate input before querying
- Audit entries logged for all mutations
- Never expose raw SQL errors to API responses
