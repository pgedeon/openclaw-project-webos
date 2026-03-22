# Agent Integration Guide — Workflow Dispatcher v2

## Overview

The v2 dispatcher is a database-first workflow queue. No file I/O — the PostgreSQL database IS the queue. Agents discover work via the dashboard bridge heartbeat output or the REST API.

## Architecture

```
Dashboard creates workflow_run (queued)
  ↓
Dispatcher tick (every 30s): marks "dispatched" + calls wakeAgent()
  ↓
wakeAgent(): execSync('openclaw system event --mode now --text "Workflow run..."')
  ↓
Gateway delivers system event → wakes agent on next heartbeat
  ↓
Agent runs dashboard_agent_bridge.py heartbeat → sees state: "workflow_ready"
  ↓
Agent claims via POST /api/workflow-runs/{id}/claim (atomic SQL)
  ↓
Agent spawns sub-agent via sessions_spawn(agentId, task, mode: "session")
  ↓
Sub-agent heartbeats every 2-5 min → completes via POST /api/workflow-runs/{id}/complete
```

## System Event Bridge

After each successful dispatch, the v2 dispatcher calls `openclaw system event --mode now` with the run details. This wakes the agent immediately via the gateway's WebSocket protocol. The agent doesn't need to poll — the gateway delivers the event.

The event text includes: run ID, workflow type, target agent, claim URL, and input payload (truncated to 200 chars).

If the wake fails (gateway down, auth issue), the dispatch still succeeds. The agent picks it up on the next scheduled heartbeat (default 2h).

## Heartbeat Integration

The `dashboard_agent_bridge.py heartbeat --json` command now includes dispatched workflow runs in its output:

```json
{
  "state": "workflow_ready",
  "agent": "openclaw-control-ui",
  "ready_count": 0,
  "active_count": 0,
  "pending_workflow_runs": [
    {
      "id": "uuid",
      "workflow_type": "citation-improvement",
      "target_agent_id": "affiliate-editorial",
      "input_payload": { "task": "Process articles" },
      "dispatch_attempts": 0
    }
  ],
  "workflow_run_count": 1
}
```

When `state: "workflow_ready"`, the agent MUST claim and spawn — it should not return HEARTBEAT_OK.

### HEARTBEAT.md Instructions

The main agent's `HEARTBEAT.md` must:
1. Be under 1772 characters (gateway truncation limit)
2. Check for `state: "workflow_ready"` in the bridge output FIRST
3. Provide the exact claim + spawn curl commands
4. Specify that workflow claim is the ONLY trigger that may spawn sub-agents

See the current `~/.openclaw/workspace/main/HEARTBEAT.md` for the production version (1411 bytes).

## API Endpoints

All endpoints are on the dashboard task server at `http://127.0.0.1:3876`.

### List Pending Runs

```
GET /api/workflow-runs/pending?limit=5
```

Returns dispatched runs awaiting claim.

### Claim a Run

```
POST /api/workflow-runs/{id}/claim
Content-Type: application/json
{ "agent_id": "<target_agent_id>", "session_id": "<agent_session_key>" }
```

- Returns 200 with the claimed run on success
- Returns 409 if already claimed by another agent
- Returns 400 if `session_id` is missing
- **Atomic**: `UPDATE ... WHERE status = 'dispatched' RETURNING *` prevents double-claiming
- The `session_id` is the agent's OpenClaw session key (e.g., `agent:main:main`)

### Send Heartbeat

```
POST /api/workflow-runs/{id}/heartbeat
Content-Type: application/json
{ "session_id": "<agent_session_key>" }
```

Sub-agents should heartbeat every 2-5 minutes while working. Missed heartbeats trigger stale run recovery.

### Complete a Run

```
POST /api/workflow-runs/{id}/complete
Content-Type: application/json
{ "session_id": "<agent_session_key>", "output_summary": { "result": "ok" } }
```

### Dispatcher Stats

```
GET /api/workflow-runs/dispatcher/stats
```

Returns queue counts, failure rate, route count, last tick info.

## Agent Workflow — Full Example

```
# 1. Dashboard bridge reports workflow_ready state
python3 scripts/dashboard_agent_bridge.py heartbeat --json
→ {"state": "workflow_ready", "pending_workflow_runs": [...]}

# 2. Claim the run (atomic)
curl -s -X POST "http://127.0.0.1:3876/api/workflow-runs/{id}/claim" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"<target>","session_id":"agent:main:main"}'

# 3. Spawn sub-agent
sessions_spawn(agentId: target_agent_id, mode: "session", task: input_payload)

# 4. Store child session key back to the run
curl -s -X PATCH "http://127.0.0.1:3876/api/workflow-runs/{id}" \
  -H "Content-Type: application/json" \
  -d '{"gateway_session_id":"CHILD_KEY","gateway_session_active":true}'
```

## CLI Tool

The `agent-workflow-client.js` provides a CLI for manual testing:

```bash
node agent-workflow-client.js poll
node agent-workflow-client.js claim <id> --session <session-id> --agent <agent-id>
node agent-workflow-client.js heartbeat <id> --session <session-id>
node agent-workflow-client.js complete <id> --session <session-id> --output '{"result":"ok"}'
node agent-workflow-client.js stats
```

## Agent Routing Table

Workflow types are mapped to agents via the `workflow_agent_routing` DB table:

```sql
INSERT INTO workflow_agent_routing (workflow_type, agent_id, priority, timeout_minutes)
VALUES ('my-workflow', 'my-agent', 10, 30);
```

No code changes needed — the dispatcher reads routing from the database at runtime.

### Production Routing (to be seeded)

| workflow_type | agent_id | priority |
|---|---|---|
| citation-improvement | affiliate-editorial | 10 |
| affiliate-article | affiliate-editorial | 10 |
| code-change | coder | 10 |
| image-generation | comfyui-image-agent | 10 |
| qa-review | qa-review | 10 |
| system-improvement-scan | main | 10 |
| improvement-suggestion | coder | 10 |

## Stale Run Recovery

The dispatcher handles stuck runs automatically:

| Condition | Action | Timing |
|---|---|---|
| Dispatched but not claimed | Retry dispatch (up to 3x) | After 5 min |
| Claimed but no heartbeat | Release back to dispatched | After 10 min |
| Running too long | Mark as timed_out | After configurable timeout |

## Files Modified

- `gateway-workflow-dispatcher-v2.js` — added `wakeAgent()` method with `openclaw system event --mode now`
- `docs/AGENT_INTEGRATION.md` — this file (updated)
- `~/.openclaw/workspace/main/HEARTBEAT.md` — compressed to 1411 bytes, added `workflow_ready` handling
- `~/.openclaw/workspace/main/scripts/dashboard_agent_bridge.py` — added `pending_workflow_runs` check + `workflow_ready` state

## Configuration

- `agents.defaults.heartbeat.target`: set to `"last"` (routes heartbeat to last contact channel)
- `agents.defaults.heartbeat.every`: `"2h"` (default interval)
- HEARTBEAT.md must stay under 1772 characters (gateway bootstrap truncation limit)
- `.env.secrets` in dashboard dir (chmod 600, gitignored) — never commit credentials
