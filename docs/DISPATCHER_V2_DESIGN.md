# Gateway Workflow Dispatcher v2 — Design Document

## Problem Statement

The current dispatcher has five fundamental flaws:

1. **File-based handoff** — `/tmp/dashboard-workflow-pickup.json` is a race condition risk, not persisted across reboots, no acknowledgment protocol
2. **Polling** — 30-second interval means up to 30s latency; wastes DB queries when idle
3. **No retry/ack** — failed dispatches are silently dropped, no way to confirm pickup
4. **Hardcoded routing** — adding workflow types requires code changes
5. **Zero test coverage** — no tests exist

## Design: Database-First Dispatch with Polling API

Instead of writing to a file, the dispatcher uses the **existing PostgreSQL database** as the message queue. The main agent polls a well-defined API endpoint.

### Core Idea

```
workflow_runs table (already exists)
    ↓
dispatcher marks runs as "dispatched" in DB
    ↓
main agent polls GET /api/workflow-runs?status=dispatched&limit=1
    ↓
main agent claims run (status → "claimed", records agent session)
    ↓
sub-agent executes via sessions_spawn
    ↓
sub-agent reports back via POST /api/workflow-runs/:id/complete
```

### Why This Works

- **No file I/O** — the database IS the queue (ACID, persistent, crash-safe)
- **No race conditions** — `UPDATE ... WHERE status = 'dispatched' RETURNING *` is atomic
- **Acknowledgment built in** — "claimed" status means the agent picked it up
- **Self-healing** — unclaimed dispatched runs get retried automatically
- **Testable** — pure HTTP API + SQL, no file system dependencies

### Changes Required

#### 1. New workflow_run statuses

```
queued      → (existing) waiting to be dispatched
dispatched  → (NEW) written to DB, waiting for agent pickup
claimed     → (NEW) an agent picked it up, executing
running     → (existing) alternative to claimed, agent is active
completed   → (existing) done
failed      → (existing) error
timed_out   → (existing or NEW) exceeded time limit
```

#### 2. Dispatcher changes

- Remove file I/O entirely
- Add `dispatched` → `claimed` transition tracking
- Add configurable agent routing table (stored in DB or config)
- Add dispatch retry count with exponential backoff
- Add metrics: dispatch count, claim latency, failure rate

#### 3. New API endpoints on task-server

```
GET  /api/workflow-runs/pending          → dispatched runs awaiting pickup
POST /api/workflow-runs/:id/claim        → atomically claim a run
POST /api/workflow-runs/:id/heartbeat    → keep-alive while executing
GET  /api/workflow-runs/dispatcher/stats → dispatcher metrics
```

#### 4. Agent routing from DB

Instead of hardcoded map, store routing in a table:

```sql
CREATE TABLE IF NOT EXISTS workflow_agent_routing (
  workflow_type VARCHAR(100) PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL,
  priority INT DEFAULT 0,
  max_concurrent INT DEFAULT 1,
  timeout_minutes INT DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

This lets users add routing rules without code changes.

#### 5. Main agent integration

The main agent's heartbeat loop (already runs every 2 minutes) would:

1. Call `GET /api/workflow-runs/pending`
2. For each pending run, call `POST /api/workflow-runs/:id/claim`
3. If claim succeeds, `sessions_spawn` the appropriate agent
4. The spawned agent calls `/heartbeat` while working
5. On completion, calls `/complete`

### Stale/Timeout Handling

- **Unclaimed runs**: If `dispatched` for >5 min without claim → retry dispatch (up to 3x)
- **Claimed but no heartbeat**: If `claimed` and no heartbeat for >10 min → release back to `dispatched`
- **Running too long**: If `claimed`/`running` for >configurable timeout → mark `timed_out`

### Testing Strategy

1. **Unit tests** — test dispatcher logic with mocked DB (pg-mem or in-memory)
2. **Integration tests** — test full dispatch → claim → complete flow against real DB
3. **Concurrency test** — simulate multiple agents claiming simultaneously
4. **Timeout test** — verify stale run detection and recovery
5. **API tests** — test all new endpoints via HTTP

### Migration Plan

1. Write new dispatcher as `gateway-workflow-dispatcher-v2.js`
2. Add database migration for `workflow_agent_routing` table
3. Add new API endpoints to task-server.js
4. Write tests (unit + integration)
5. Run tests against dev database
6. Deploy alongside v1 (disabled), verify v2 works
7. Switch to v2, remove v1

### Files Changed

```
gateway-workflow-dispatcher-v2.js     # New dispatcher (replaces v1)
schema/migrations/XXX_add_workflow_agent_routing.sql  # New table
task-server.js                         # New endpoints
tests/test-dispatcher-v2.js           # Unit tests
tests/test-dispatcher-integration.js   # Integration tests
gateway-workflow-dispatcher.js         # DELETE after v2 is verified
```

### What Doesn't Change

- The workflow-runs API (existing start/complete/endpoints)
- The agent heartbeat system
- The workflow template system
- The UI (operations view, workflow view)
