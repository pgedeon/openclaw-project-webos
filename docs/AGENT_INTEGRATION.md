# Agent Integration Guide — Workflow Dispatcher v2

## Overview

The v2 dispatcher exposes a REST API at `http://127.0.0.1:3876` that agents poll to discover, claim, and complete workflow runs. No file I/O needed — the database IS the queue.

## How Agents Discover Work

The OpenClaw main agent's heartbeat loop is the primary consumer. During each heartbeat, the agent:

1. **Polls** `GET /api/workflow-runs/pending` for dispatched workflow runs
2. **Claims** a run via `POST /api/workflow-runs/{id}/claim`
3. **Spawns** a sub-agent via `sessions_spawn` to execute the workflow
4. The sub-agent sends **heartbeats** while working
5. The sub-agent **completes** the run when done

## API Endpoints

### List Pending Runs

```
GET /api/workflow-runs/pending?limit=5
```

Response:
```json
{
  "runs": [
    {
      "id": "uuid",
      "workflowType": "citation-improvement",
      "targetAgentId": "affiliate-editorial",
      "ownerAgentId": "main",
      "inputPayload": { "task": "Process articles from citation queue" },
      "dispatchAttempts": 0,
      "dispatchedAt": "2026-03-22T10:00:00Z",
      "timeoutMinutes": 60
    }
  ]
}
```

### Claim a Run

```
POST /api/workflow-runs/{id}/claim
Content-Type: application/json
{ "session_id": "agent-session-id" }
```

- Returns 200 with the claimed run on success
- Returns 409 if already claimed by another agent
- Returns 400 if `session_id` is missing
- **Atomic**: the `UPDATE WHERE status = 'dispatched'` query prevents double-claiming

### Send Heartbeat

```
POST /api/workflow-runs/{id}/heartbeat
Content-Type: application/json
{ "session_id": "agent-session-id" }
```

- Returns 200 on success, null if session mismatch
- Agents should heartbeat every 2-5 minutes while executing
- Missed heartbeats trigger stale run recovery

### Complete a Run

```
POST /api/workflow-runs/{id}/complete
Content-Type: application/json
{ "session_id": "agent-session-id", "output_summary": { "result": "ok" } }
```

- Returns 200 on success
- Sets `finished_at` timestamp

### Dispatcher Stats

```
GET /api/workflow-runs/dispatcher/stats
```

Returns queue counts, failure rate, route count, last tick info.

## Agent Workflow — Example

```
# During heartbeat, the main agent does this:

1. curl http://127.0.0.1:3876/api/workflow-runs/pending
   → Returns list of dispatched runs

2. For each run:
   a. POST /api/workflow-runs/{id}/claim { session_id: "main" }
   b. If claim succeeds:
      - Extract workflowType and targetAgentId from the run
      - Extract the task description from inputPayload
      - sessions_spawn(agentId, task)
      - Store child session key for follow-up

3. Spawned sub-agent executes the task:
   - Sends heartbeat every 2-5 min
   - POST /api/workflow-runs/{id}/complete on success
   - If fails, the dispatcher's timeout system handles cleanup
```

## Agent Routing Table

Workflow types are mapped to agent IDs via the `workflow_agent_routing` table:

```sql
SELECT * FROM workflow_agent_routing ORDER BY priority DESC;
```

To add a new workflow type:

```sql
INSERT INTO workflow_agent_routing (workflow_type, agent_id, priority, timeout_minutes)
VALUES ('my-workflow', 'my-agent', 10, 30);
```

No code changes needed — the dispatcher reads routing from the database.

## CLI Tool

The `agent-workflow-client.js` provides a CLI for manual testing and scripting:

```bash
# List pending runs
node agent-workflow-client.js poll

# Claim a run
node agent-workflow-client.js claim <id> --session <session-id>

# Send heartbeat
node agent-workflow-client.js heartbeat <id> --session <session-id>

# Complete a run
node agent-workflow-client.js complete <id> --session <session-id> --output '{"result":"ok"}'

# View dispatcher stats
node agent-workflow-client.js stats
```

## HEARTBEAT.md Update Required

The main agent's `HEARTBEAT.md` still references the old `/tmp/dashboard-workflow-pickup.json` file-based system. It needs to be updated to:

1. Poll `GET /api/workflow-runs/pending` instead of reading a file
2. Use `POST /api/workflow-runs/{id}/claim` for atomic claiming
3. Pass `targetAgentId` from the claimed run to `sessions_spawn`

### New HEARTBEAT.md step (replaces step 5):

```
5. Check for pending workflow runs: curl -sfS http://127.0.0.1:3876/api/workflow-runs/pending?limit=3
   If runs are returned, claim the first one via:
     curl -s -X POST "http://127.0.0.1:3876/api/workflow-runs/{id}/claim" \
       -H "Content-Type: application/json" \
       -d '{"session_id":"main"}'
   If claim succeeds (status 200), spawn a sub-agent:
     sessions_spawn(agentId: run.targetAgentId, task: run.inputPayload.task, mode: "session")
   Then update the run with the child session key:
     curl -s -X PATCH "http://127.0.0.1:3876/api/workflow-runs/{id}" \
       -H "Content-Type: application/json" \
       -d '{"gateway_session_id":"CHILD_SESSION_KEY","gateway_session_active":true}'
   This is the ONLY heartbeat trigger that may spawn sub-agents.
```

## Stale Run Recovery

The dispatcher automatically handles stuck runs:

| Condition | Action | Timing |
|---|---|---|
| Dispatched but not claimed | Retry dispatch (up to 3x) | After 5 min |
| Claimed but no heartbeat | Release back to dispatched | After 10 min |
| Running too long | Mark as timed_out | After configurable timeout |
