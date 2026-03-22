# Dashboard Workflow Execution Layer

## Quick Start

This directory contains the implementation of the **Workflow Execution Layer** for the OpenClaw Dashboard.

### What's New

The dashboard now tracks **workflow runs** - actual execution instances of automated workflows - not just tasks.

### Current Status

✅ **Phase 1, Item 1 COMPLETE**: workflow_run model created and ready for deployment

**Files Created**:
- `schema/migrations/001_add_workflow_runs.sql` - Database schema
- `workflow-runs-api.js` - REST API module
- `scripts/apply-workflow-migration.sh` - Migration script
- `test-workflow-api.js` - Test suite
- `WORKFLOW_INTEGRATION_GUIDE.md` - Integration instructions

### Deploy Now

```bash
# 1. Apply database migration
cd dashboard
./scripts/apply-workflow-migration.sh

# 2. Integrate API (follow WORKFLOW_INTEGRATION_GUIDE.md)
# Edit task-server.js to import and use workflow-runs-api.js

# 3. Restart task server
node task-server.js

# 4. Test
node test-workflow-api.js
```

### What This Enables

Once deployed, you can:

1. **Create workflow runs** - Start automation from the dashboard
2. **Track execution** - See which step a workflow is on
3. **Monitor health** - Detect stuck or failed runs
4. **Collect outputs** - Store results, URLs, artifacts
5. **Bind to sessions** - Link runs to live OpenClaw sessions

### Example Workflow

```bash
# Create a new affiliate article workflow
curl -X POST http://localhost:3876/api/workflow-runs \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_type": "affiliate-article",
    "owner_agent_id": "3dput",
    "input_payload": {
      "topic": "Best 3D Printer Filaments 2026"
    }
  }'

# Start execution
curl -X POST http://localhost:3876/api/workflow-runs/{id}/start

# Monitor progress
curl http://localhost:3876/api/workflow-runs/{id}

# See active runs
curl http://localhost:3876/api/workflow-runs/active

# Check for stuck runs
curl http://localhost:3876/api/workflow-runs/stuck
```

### Workflow Templates Available

1. **affiliate-article** - Create and publish affiliate content
2. **image-generation** - Generate images with ComfyUI
3. **wordpress-publish** - Publish to WordPress with verification
4. **site-fix** - Investigate and fix site issues
5. **incident-investigation** - Investigate incidents
6. **code-change** - Implement code changes with review
7. **qa-review** - Quality assurance review

### Documentation

- **Full Plan**: `../DASHBOARD_WORKFLOW_UPGRADE.md` (25 items, 8 phases)
- **Progress**: `WORKFLOW_UPGRADE_PROGRESS.md` (current status)
- **Integration**: `WORKFLOW_INTEGRATION_GUIDE.md` (step-by-step)
- **API Reference**: See WORKFLOW_INTEGRATION_GUIDE.md#new-api-endpoints

### Architecture

```
Dashboard Frontend
    ↓
Task Server (task-server.js)
    ↓
Workflow Runs API (workflow-runs-api.js)
    ↓
PostgreSQL Database
    ├── workflow_runs (execution instances)
    ├── workflow_steps (step tracking)
    └── workflow_templates (reusable types)
```

### Key Features

- **Status Tracking**: queued → running → waiting_for_approval → completed/failed
- **Heartbeat Monitoring**: Detect stuck runs automatically
- **Step Timeline**: Track every step transition
- **Gateway Binding**: Link to live OpenClaw sessions
- **Flexible Payloads**: JSONB for input/output data
- **Template System**: Reusable workflow definitions

### Next Steps

After deployment:

1. **UI Components** - Build React components for workflow display
2. **Run Actions** - Add "Run with OpenClaw" buttons to task cards
3. **Live Updates** - Implement real-time status updates
4. **Gateway Integration** - Connect runs to gateway sessions
5. **Agent Heartbeats** - Automatic heartbeat from working agents

### Support

- Check `WORKFLOW_INTEGRATION_GUIDE.md#troubleshooting` for common issues
- See `../memory/2026-03-11.md` for daily progress notes
- Review `WORKFLOW_UPGRADE_PROGRESS.md` for detailed status

### Contributing

This is Phase 1 of an 8-phase upgrade. See `../DASHBOARD_WORKFLOW_UPGRADE.md` for the full roadmap.

Each phase builds on the previous:
- Phase 1: Task Execution (current)
- Phase 2: Observability
- Phase 3: Publishing Pipelines
- Phase 4: Approvals & Blockers
- Phase 5: Cross-Board Coordination
- Phase 6: Operations Visibility
- Phase 7: Metrics & Measurement
- Phase 8: Governance & QoL

---

**Status**: Ready for deployment
**Next Action**: Apply migration and integrate API
**Contact**: See main workspace MEMORY.md for context
