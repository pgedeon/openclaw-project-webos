# Workflow Runs Integration Guide

## Overview

This guide explains how to integrate the new Workflow Runs API into the existing task-server.js.

## Files Created

1. **Database Schema**: `schema/migrations/001_add_workflow_runs.sql`
   - Creates `workflow_runs`, `workflow_steps`, and `workflow_templates` tables
   - Adds views for active and stuck runs
   - Inserts 7 default workflow templates

2. **API Module**: `workflow-runs-api.js`
   - `WorkflowRunsAPI` class with all CRUD operations
   - HTTP request handler for REST endpoints
   - Ready to integrate into task-server.js

3. **Migration Script**: `scripts/apply-workflow-migration.sh`
   - Applies database migration
   - Checks prerequisites
   - Verifies results

4. **Test Script**: `test-workflow-api.js`
   - Tests all API endpoints
   - Validates database operations
   - Provides test summary

## Integration Steps

### Step 1: Apply Database Migration

```bash
cd dashboard
./scripts/apply-workflow-migration.sh
```

Or manually:

```bash
psql -d openclaw_dashboard -f schema/migrations/001_add_workflow_runs.sql
```

### Step 2: Integrate API into task-server.js

Add the following to `task-server.js`:

#### At the top of the file (imports section):

```javascript
const { createWorkflowRunsHandler } = require('./workflow-runs-api.js');
```

#### After asanaStorage initialization (around line 150):

```javascript
// Initialize workflow runs handler
let workflowRunsHandler = null;
if (STORAGE_TYPE === 'postgres') {
  workflowRunsHandler = createWorkflowRunsHandler(asanaStorage.pool);
}
```

#### In the request handler (handleRequest function), add this before the final "not found" handler:

```javascript
// Workflow runs API
if (workflowRunsHandler) {
  const handled = await workflowRunsHandler(req, res, parsedUrl.pathname, body);
  if (handled) return;
}
```

#### Complete example integration:

```javascript
async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  
  // Parse body for POST/PATCH requests
  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    // ... existing body parsing code ...
  }

  // ... existing endpoints ...

  // Workflow runs API (add before the final catch-all)
  if (workflowRunsHandler) {
    const handled = await workflowRunsHandler(req, res, pathname, body);
    if (handled) return;
  }

  // ... existing static file handler and 404 ...
}
```

### Step 3: Restart Task Server

```bash
cd dashboard
node task-server.js
```

### Step 4: Test Integration

```bash
cd dashboard
node test-workflow-api.js
```

## New API Endpoints

### Workflow Runs

- `GET /api/workflow-runs` - List all runs (with filters)
- `GET /api/workflow-runs/:id` - Get run with steps
- `POST /api/workflow-runs` - Create new run
- `PATCH /api/workflow-runs/:id` - Update run
- `DELETE /api/workflow-runs/:id` - Cancel run
- `POST /api/workflow-runs/:id/start` - Start execution
- `POST /api/workflow-runs/:id/heartbeat` - Record heartbeat
- `POST /api/workflow-runs/:id/complete` - Mark completed
- `POST /api/workflow-runs/:id/fail` - Mark failed
- `POST /api/workflow-runs/:id/step` - Update step

### Workflow Templates

- `GET /api/workflow-templates` - List all templates
- `GET /api/workflow-templates/:name` - Get template by name

### Special Queries

- `GET /api/workflow-runs/active` - List active runs
- `GET /api/workflow-runs/stuck` - List stuck runs

## Example Usage

### Create a workflow run

```bash
curl -X POST http://localhost:3876/api/workflow-runs \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "affiliate-article",
    "owner_agent_id": "3dput",
    "initiator": "user",
    "input_payload": {
      "topic": "Best 3D Printers 2026",
      "target_site": "3dput.com"
    }
  }'
```

### Start the run

```bash
curl -X POST http://localhost:3876/api/workflow-runs/{run_id}/start
```

### Update a step

```bash
curl -X POST http://localhost:3876/api/workflow-runs/{run_id}/step \
  -H "Content-Type: application/json" \
  -d '{
    "step_name": "topic_discovery",
    "status": "completed",
    "output": {
      "topic": "Best 3D Printers 2026",
      "keywords": ["3d printer", "review", "comparison"]
    }
  }'
```

### Record heartbeat

```bash
curl -X POST http://localhost:3876/api/workflow-runs/{run_id}/heartbeat
```

### Complete the run

```bash
curl -X POST http://localhost:3876/api/workflow-runs/{run_id}/complete \
  -H "Content-Type: application/json" \
  -d '{
    "output_summary": {
      "live_url": "https://3dput.com/best-3d-printers-2026",
      "affiliate_links_valid": true,
      "featured_image_present": true
    }
  }'
```

## Database Schema Reference

### workflow_runs table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| board_id | UUID | Reference to project |
| task_id | UUID | Reference to task |
| workflow_type | TEXT | Template name |
| owner_agent_id | TEXT | Agent name |
| initiator | TEXT | Who started the run |
| status | TEXT | queued/running/waiting_for_approval/blocked/retrying/completed/failed/cancelled |
| current_step | TEXT | Current step name |
| started_at | TIMESTAMPTZ | When started |
| finished_at | TIMESTAMPTZ | When finished |
| last_heartbeat_at | TIMESTAMPTZ | Last heartbeat |
| retry_count | INTEGER | Number of retries |
| max_retries | INTEGER | Max allowed retries |
| last_error | TEXT | Last error message |
| input_payload | JSONB | Input parameters |
| output_summary | JSONB | Output results |
| gateway_session_id | TEXT | Gateway session ID |
| gateway_session_active | BOOLEAN | Session status |

### workflow_steps table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workflow_run_id | UUID | Reference to run |
| step_name | TEXT | Step identifier |
| step_order | INTEGER | Step order |
| status | TEXT | pending/in_progress/completed/failed/skipped |
| started_at | TIMESTAMPTZ | When started |
| finished_at | TIMESTAMPTZ | When finished |
| output | JSONB | Step output |
| error_message | TEXT | Error if failed |

### workflow_templates table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Template identifier (unique) |
| display_name | TEXT | Human-readable name |
| description | TEXT | Template description |
| default_owner_agent | TEXT | Default agent |
| steps | JSONB | Step definitions |
| required_approvals | JSONB | Required approval gates |
| success_criteria | JSONB | Success criteria |
| category | TEXT | Template category |
| is_active | BOOLEAN | Active flag |

## Next Steps

After integration:

1. **UI Components**: Build React components to display workflow runs in the dashboard
2. **Run Actions**: Add "Run with OpenClaw" button to task cards
3. **Live Updates**: Implement WebSocket or polling for live status updates
4. **Gateway Binding**: Link workflow runs to actual gateway sessions
5. **Heartbeat Mechanism**: Implement automatic heartbeat from agents
6. **Stuck Detection**: Add monitoring for stuck runs
7. **Metrics**: Add workflow metrics to dashboard

## Troubleshooting

### Migration fails with "relation already exists"

The migration may have been partially applied. Check existing tables:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'workflow%';
```

If tables exist but are incomplete, you may need to drop them first:

```sql
DROP TABLE IF EXISTS workflow_steps CASCADE;
DROP TABLE IF EXISTS workflow_runs CASCADE;
DROP TABLE IF EXISTS workflow_templates CASCADE;
```

### API returns 404

- Verify task-server.js is running
- Check that migration was applied
- Verify integration code was added correctly
- Restart task-server.js after changes

### Database connection errors

Check environment variables:

```bash
echo $PGHOST $PGPORT $PGDATABASE $PGUSER
```

Test connection:

```bash
psql -d openclaw_dashboard -c "SELECT 1;"
```

### API endpoints not working

- Verify `workflow-runs-api.js` is in the same directory as `task-server.js`
- Check that `createWorkflowRunsHandler` is imported correctly
- Ensure `workflowRunsHandler` is called before the final 404 handler
- Check task-server.js logs for errors

## Support

For issues or questions, check:
- Dashboard memory: `dashboard/MEMORY.md`
- Main upgrade plan: `DASHBOARD_WORKFLOW_UPGRADE.md`
- Daily progress: `memory/2026-03-11.md`
