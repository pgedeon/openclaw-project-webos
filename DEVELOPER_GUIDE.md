# Dashboard Developer Guide

**Last Updated**: 2026-03-12
**Status**: Phase 0 - Stabilization

---

## Source of Truth

### Primary Implementation Directory

All dashboard implementation work happens in:

```
/root/.openclaw/workspace/dashboard/
```

**DO NOT** use dashboard copies from other workspace directories as implementation targets.

### Primary Files

| File | Purpose | Size |
|------|---------|------|
| `task-server.js` | Main HTTP server and route handler | ~67KB |
| `storage/asana.js` | PostgreSQL storage layer | ~77KB |
| `workflow-runs-api.js` | Workflow runs handler (already modular!) | ~26KB |
| `dashboard.html` | Main dashboard UI | ~76KB |
| `src/dashboard-integration-optimized.mjs` | Frontend logic | ~156KB |
| `src/agent-view.mjs` | Agent queue view | ~28KB |
| `src/agents-page.mjs` | Agents overview page | ~31KB |
| `schema/openclaw-dashboard.sql` | Base schema | ~6KB |
| `schema/migrations/*` | Database migrations | - |

---

## Architecture Principles

### 1. Additive Migrations Only

**Rule**: Never edit old migrations. Always add new migrations.

**Location**: `/root/.openclaw/workspace/dashboard/schema/migrations/`

**Naming**: `NNN_descriptive_name.sql` where NNN is a number

**Example**:
```
001_add_workflow_runs.sql
002_add_workflow_queues.sql
003_add_approvals.sql
```

### 2. Modular Route Files

**Rule**: Extract new route families into separate modules, mount from task-server.js

**Pattern**:
```javascript
// In task-server.js
import { orgAPI } from './org-api.js';
import { serviceRequestsAPI } from './service-requests-api.js';

// Mount routes
if (url.startsWith('/api/org')) {
  return orgAPI(req, res, url, method, body);
}
```

**New Route Modules** (to be created):
- `org-api.js` - Organization and agent profiles
- `service-requests-api.js` - Service catalog and requests
- `artifacts-api.js` - Workflow artifacts
- `approvals-api.js` - Approval workflows
- `metrics-api.js` - Business metrics

### 3. Explicit Backend Contracts

**Rule**: Define all contracts explicitly, no hidden coupling.

**For each feature, document**:
- Table/view changes (migration)
- Storage-layer methods (in storage/asana.js or storage/*.js)
- API endpoints (in route module)
- Request payloads (JSON schema)
- Response payloads (JSON schema)
- UI consumers (which frontend modules call it)

**Example**:
```
Feature: Department View

Migration: 006_add_departments.sql
  - Creates: departments table

Storage Method (storage/org.js):
  - listDepartments()
  - getDepartment(id)

API Endpoints (org-api.js):
  - GET /api/org/departments
  - GET /api/org/departments/:id

Request Schema:
  - Query params: status, limit, offset

Response Schema:
  - { departments: [...], total: N, limit: N, offset: N }

UI Consumer:
  - src/departments-view.mjs (new)
  - src/agents-page.mjs (updated)
```

### 4. No Browser Config Parsing

**Rule**: Browser consumes normalized API data. Config parsing happens on server.

**Wrong**:
```javascript
// In browser
const config = await fetch('/openclaw.json');
```

**Right**:
```javascript
// In task-server.js
app.get('/api/agents', (req, res) => {
  const config = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json'));
  const normalized = normalizeAgentData(config);
  res.json(normalized);
});
```

### 5. Explicit Business Metadata

**Rule**: Use explicit records for business structure, not heuristics.

**Wrong**:
```javascript
// Infer department from workspace path
const department = workspace.includes('3dput') ? 'automation' : 'content';
```

**Right**:
```javascript
// Fetch from database
const agent = await getAgentProfile(agentId);
const department = agent.department_id; // Explicit reference
```

### 6. Stable Agent IDs

**Rule**: Agent IDs match OpenClaw configuration.

**Source**: `/root/.openclaw/openclaw.json`

**DO NOT** rename or transform agent IDs in the dashboard layer.

**Example**:
```javascript
// Right
const agentId = 'affiliate-editorial'; // Matches config

// Wrong
const agentId = 'affiliateEditorial'; // Transformed name
```

---

## Database Management

### Connection

```javascript
// In storage/asana.js or task-server.js
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || 'openclaw_dashboard',
  user: process.env.POSTGRES_USER || 'openclaw',
  password: process.env.POSTGRES_PASSWORD || 'openclaw_password'
});
```

### Migration Status Check

```bash
# Check applied migrations
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U openclaw -d openclaw_dashboard \
  -c "SELECT migration_name, applied_at FROM schema_migrations ORDER BY applied_at DESC;"
```

### Required Tables (as of Phase 0)

- tasks
- projects
- workflow_runs
- workflow_steps
- workflow_templates
- workflow_approvals
- task_runs
- agent_heartbeats
- audit_log
- saved_views
- cron_jobs
- cron_job_runs
- schema_migrations (new in Phase 0)

---

## Testing

### Validation Script

```bash
cd /root/.openclaw/workspace/dashboard
node scripts/dashboard-validation.js
```

### API Tests

```bash
# Test specific route family
node tests/test-saved-views-api.js
npm test
```

---

## Health Endpoints

### Basic Health Check

```
GET /api/health
Response: { status: 'ok', timestamp: '...', storage_type: 'postgres' }
```

### Comprehensive Health Check

```
GET /api/health-status
Response: {
  status: 'ok' | 'degraded',
  checks: {
    database: { healthy: true, latency_ms: 5 },
    stuck_workflow_runs: { count: 2, healthy: true },
    active_workflow_runs: { count: 5 },
    migrations: { applied: [001, 002, 003, 004], pending: [] }
  }
}
```

---

## Adding New Features

### Step-by-Step Process

1. **Create Migration**
   ```bash
   # In schema/migrations/
   006_add_new_feature.sql
   ```

2. **Add Storage Methods**
   ```javascript
   // In storage/asana.js or new storage file
   async listNewFeature() { ... }
   ```

3. **Create Route Module**
   ```javascript
   // In new-feature-api.js
   export function newFeatureAPI(req, res, url, method, body) { ... }
   ```

4. **Mount in task-server.js**
   ```javascript
   import { newFeatureAPI } from './new-feature-api.js';
   
   if (url.startsWith('/api/new-feature')) {
    return newFeatureAPI(req, res, url, method, body);
   }
   ```

5. **Update Frontend**
   ```javascript
   // In src/new-feature-view.mjs
   const data = await fetch('/api/new-feature');
   ```

6. **Add Tests**
   ```bash
   # In tests/
   test-new-feature-api.js
   ```

7. **Update Documentation**
   - Update this file
   - Update DASHBOARD_PROGRESS.md

---

## Current Route Structure

### Already Modular

- ✅ `workflow-runs-api.js` - Workflow runs management

### In task-server.js (to be extracted)

- 📦 Projects API - `/api/projects/*`
- 📦 Tasks API - `/api/tasks/*`
- 📦 Views API - `/api/views/*`
- 📦 Agent API - `/api/agent/*`, `/api/agents`
- 📦 Metrics API - `/api/metrics/*`
- 📦 Cron API - `/api/cron/*`
- 📦 Stats API - `/api/stats`
- 📦 Health API - `/api/health*`

### Planned (Phase 1+)

- 🆕 `org-api.js` - Organization and departments
- 🆕 `service-requests-api.js` - Service catalog and requests
- 🆕 `artifacts-api.js` - Workflow artifacts
- 🆕 `approvals-api.js` - Approval management
- 🆕 `metrics-api.js` - Business metrics (enhance existing)

---

## Troubleshooting

### Dashboard Won't Start

```bash
# Check if port is in use
lsof -i :3876

# Check logs
tail -f /root/.openclaw/workspace/dashboard/task-server.log

# Restart
cd /root/.openclaw/workspace/dashboard
node task-server.js
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
systemctl status postgresql

# Test connection
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U openclaw -d openclaw_dashboard -c "SELECT 1"
```

### Migration Failed

```bash
# Check what was applied
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U openclaw -d openclaw_dashboard \
  -c "SELECT * FROM schema_migrations"

# Apply manually
PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -U openclaw -d openclaw_dashboard \
  -f schema/migrations/005_add_migration_tracking.sql
```

---

## Next Phase Checklist

Before moving to Phase 1, ensure:

- [ ] All Phase 0 tasks complete
- [ ] Health endpoint checks migrations
- [ ] Route modules documented
- [ ] Developer guide complete
- [ ] All tests passing
- [ ] Dashboard running normally

---

## References

- Full Plan: `DASHBOARD_BUSINESS_PLAN.md`
- Progress: `DASHBOARD_PROGRESS.md`
- Tests: `tests/` directory
- Migrations: `schema/migrations/` directory
