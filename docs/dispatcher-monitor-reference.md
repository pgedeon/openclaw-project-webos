# Workflow Dispatcher & Monitor Reference

The OpenClaw WebOS includes a two-layer workflow execution system: a **dispatcher** that queues and assigns workflow runs to agents, and a **monitor** that watches for stale, orphaned, or timed-out runs.

---

## Dispatcher V2

**Source:** `gateway-workflow-dispatcher-v2.js`

A database-first dispatcher that runs as a background process alongside `task-server.js`. It uses PostgreSQL for atomic claim/dispatch operations and the `workflow_agent_routing` table for agent assignment.

### How It Works

1. **Poll cycle** (every 30s): Query `workflow_runs` for status=`queued` runs
2. **Routing lookup:** Join with `workflow_agent_routing` to find the target agent
3. **Concurrency check:** Compare active runs per `workflow_type` against `max_concurrent`
4. **Budget enforcement:** Evaluate each candidate against ACTIVE budgets covering its scope chain (see [Budget Enforcement](#budget-enforcement-slice-2))
5. **Atomic dispatch:** Mark run as `dispatched` + assign agent in a single SQL UPDATE
6. **Stale recovery:** Detect dispatched runs that never got claimed (after `staleDispatchMs`)
7. **Agent notification:** Use `openclaw system-event` to notify the target agent

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `pollIntervalMs` | 30,000 | Time between dispatch polls |
| `staleDispatchMs` | 300,000 (5 min) | Time before a dispatched run is considered stale |
| `staleClaimMs` | 600,000 (10 min) | Time before a claimed run is considered stale |
| `maxDispatchRetries` | 3 | Max dispatch attempts before marking failed |
| `batchSize` | 10 | Max runs processed per poll cycle |

### Workflow Agent Routing Table

The `workflow_agent_routing` table controls which agent handles which workflow type:

| Column | Type | Description |
|--------|------|-------------|
| `workflow_type` | VARCHAR(100) | Primary key — workflow type name |
| `agent_id` | VARCHAR(100) | Target agent for dispatch |
| `priority` | INT | Routing priority (higher = dispatched first) |
| `max_concurrent` | INT | Max concurrent runs for this type (default 1) |
| `timeout_minutes` | INT | Run timeout (default 60) |

### Dispatch State Machine

```
                    ┌──────────┐
          created   │  queued  │ ◄─── New run created
                    └────┬─────┘
                         │ dispatcher picks up
                    ┌────▼─────┐
                    │dispatched│ ◄─── Agent assigned, waiting for claim
                    └────┬─────┘
                         │ agent claims
                    ┌────▼─────┐
                    │ claimed  │ ◄─── Agent acknowledged
                    └────┬─────┘
                         │ agent starts work
                    ┌────▼─────┐
                    │ running  │ ◄─── Agent executing
                    └────┬─────┘
                  ┌──────┼──────┐
            ┌─────▼──┐ ┌─▼────┐ ┌▼────────┐
            │completed│ │failed│ │timed_out│
            └────────┘ └──────┘ └─────────┘
```

### Stale Recovery

The dispatcher handles two types of stale runs:

1. **Stale dispatched** (5 min): Run was dispatched but never claimed → re-dispatch or fail
2. **Stale claimed** (10 min): Run was claimed but never started → release claim and re-dispatch

Stale runs that exceed `maxDispatchRetries` are marked as `failed` with an error message.

A stale-dispatch retry is a fresh dispatch attempt: it passes through the same budget gate and never tunnels past a breached budget (the retries-exhausted timeout still fires — it ends a run, it does not start one).

### Budget Enforcement (Slice 2)

**Source:** `lib/budget-enforcement.js` (gate) hooked inside `gateway-workflow-dispatcher-v2.js`

The dispatcher enforces ACTIVE budgets from migration 023 (`budgets` table, managed via `GET/POST/PATCH /api/budgets`) at dispatch time. Design brief: `docs/briefs/budget-ledger.md` §3.

**Hook points**

| Hook | Behavior on breach |
|------|--------------------|
| `dispatchQueuedRuns()` — between the `dispatchCandidates` SELECT and `markDispatched` | per-candidate verdict (below) |
| `retryStaleDispatchedRuns()` — before `refreshDispatched` | pause/hard_stop skip the retry this tick |

**Scope chain.** Each candidate is evaluated against every ACTIVE budget covering it, in specificity order: `agent` (routed agent id) → `department` (via `agent_profiles.department_id`) → `project` (= `workflow_type`) → `fleet`. When several covering budgets are breached at once, the **most restrictive action wins**: `hard_stop` > `pause_new_runs` > `warn`.

**Actions on breach**

| Verdict | Queued candidate | In-flight runs | Audit |
|---------|------------------|----------------|-------|
| `warn` | dispatches normally | untouched | one `warned` event per budget+period |
| `pause_new_runs` | held in `queued`, no dispatch attempt marked | run to completion | one `paused` event per budget+period |
| `hard_stop` | cancelled via the status-guarded cancel path (`queued → cancelled`) | bulk-cancelled by a status-guarded UPDATE limited to `status IN ('dispatched','claimed','running')`; completed runs untouched; `last_error = "Budget hard stop: <name> (<period_key>)"` | one `hard_stopped` event with `cancelled_run_ids` in `detail` |

**Cost & staleness.** Active budgets + department memberships load once per cache TTL (= `pollIntervalMs`, 30 s default); spend derives from the migration-022 `workflow_runs` columns with one aggregate query per (scope-hit, period), cached for the same TTL — no N+1s. Spend crossing a cap is enforced at most one tick (≈30 s) later.

**Un-pause is derived.** There is no stored pause flag: period rollover, a cap raise (`PATCH /api/budgets/:id`), or deactivation naturally resumes dispatch on the next tick because evaluation recomputes spend from the ledger each time.

**Idempotency.** Every enforcement event goes through `INSERT … ON CONFLICT (budget_id, period_key, event_kind) DO NOTHING` (`UNIQUE` latch from migration 023), so repeated ticks never duplicate an event. When prior-period events exist, the first evaluation in a new period writes a lazy `recovered` rollover marker before new events, keeping the audit chain unbroken without a cron job.

**Degradation.** Without PostgreSQL, with migration 023 unapplied, or on any evaluation error, the gate fails OPEN: enforcement OFF, dispatch behavior byte-identical to pre-slice-2. Zero active budgets is equally inert (only the cached budgets-list query is added).

**Tick visibility.** `lastTickSummary.budgetEnforcement` (and `GET /api/workflow-runs/dispatcher/stats` → `last_tick_summary`) carries `{ held, stopped, warned }` counts for the last dispatch phase.

### SQL Queries

The dispatcher uses raw SQL for performance and atomicity:

- **`dispatchCandidates`**: CTE query joining runs with routing config, filtering by concurrency limits
- **`markDispatched`**: Atomic UPDATE setting status + agent + timestamp
- **`cancelQueuedForBudgetStop`**: Status-guarded queued→cancelled transition used by hard_stop enforcement
- **`staleDispatched`**: Find dispatched runs older than threshold with no claim
- **`refreshDispatched`**: Re-dispatch a stale run to its agent
- **`markStaleClaimFailed`**: Mark a stale claimed run for re-dispatch

---

## Workflow Run Monitor

**Source:** `workflow-run-monitor.js`

A background process that watches for two conditions:

1. **Orphaned runs:** Runs in `running` status without an active gateway session
2. **Stale runs:** Runs that have been running longer than 60 minutes

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `POLL_INTERVAL_MS` | 30,000 | Check interval |
| `STALE_TIMEOUT_MINUTES` | 60 | Max run duration before timeout |

### Workflow-Agent Mapping

| Workflow Type | Agent |
|---------------|-------|
| `citation-improvement` | `affiliate-editorial` |
| `affiliate-article` | `affiliate-editorial` |
| `code-change` | `code-change` |
| `image-generation` | `comfyui-image-agent` |
| `qa-review` | `qa-review` |
| `incident-investigation` | `incident-investigation` |
| `system-improvement-scan` | `main` |
| `improvement-suggestion` | `coder` |

### Monitor Actions

1. **Orphan recovery:** If a run is `running` but its gateway session is inactive, spawns a new agent session via `openclaw agent`
2. **Stale timeout:** If a run exceeds `STALE_TIMEOUT_MINUTES`, marks it as `timed_out`
3. **Session tracking:** Maintains an in-memory map of spawned sessions to prevent duplicate spawns

---

## Agent Workflow Client

**Source:** `agent-workflow-client.js`

A CLI tool that lets OpenClaw agents interact with the workflow dispatch system. Agents use this to poll for work, claim runs, send heartbeats, and report completion.

### Commands

```bash
# Check for available runs
node agent-workflow-client.js poll [--limit 3]

# Claim a run for this session
node agent-workflow-client.js claim <run-id> --session <session-id>

# Send heartbeat (prevents stale detection)
node agent-workflow-client.js heartbeat <run-id> --session <session-id>

# Mark run as completed
node agent-workflow-client.js complete <run-id> --session <session-id> [--output '{"result":"ok"}']

# Show dispatch stats
node agent-workflow-client.js stats
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_API_BASE` | `http://127.0.0.1:3876` | Dashboard API URL |

### Agent Workflow Lifecycle

```
1. Agent starts → poll for available runs
2. Found a run → claim it with session ID
3. Start work → send periodic heartbeats (every 5 min)
4. Work complete → call complete with output payload
5. Work failed → call complete with error in output
```

---

## Governance Module

**Source:** `governance.js`

Policy helpers that control which roles and capabilities are required for workflow actions. Used by the API layer to authorize operator actions.

### Governance Actions

| Action | Required Roles | Required Capabilities |
|--------|---------------|----------------------|
| `launch_workflow` | orchestrator, pipeline, specialist, operator | orchestration, automation, workflows, quality, auditing |
| `approve` | orchestrator, operator | quality, auditing, management |
| `reject` | orchestrator, operator | quality, auditing, management |
| `cancel_run` | orchestrator, operator | orchestration, management |
| `override_failure` | orchestrator, operator | orchestration, management, repair, diagnostics |
| `reassign_owner` | orchestrator, operator, pipeline | orchestration, management |
| `escalate_run` | orchestrator, operator, pipeline | orchestration, management |
| `escalate_approval` | orchestrator, operator, pipeline | orchestration, management, quality, auditing |
| `pause_run` | orchestrator, operator, pipeline | orchestration, management |
| `resume_run` | orchestrator, operator, pipeline | orchestration, management |

### Functions

| Function | Purpose |
|----------|---------|
| `canPerformAction(agentId, action)` | Check if an agent can perform a governance action |
| `classifyAuditEvent(action)` | Classify an action for audit log severity |
| `getSafetyBanner(agentId)` | Get safety warning text for the operator UI |
| `getActionRules()` | Returns all governance action rules |

### Assigned Approver Override

Actions with `allowAssignedApprover: true` (approve, reject) can also be performed by the agent explicitly assigned as the approver for that workflow step, regardless of role/capability match.

---

## Sync Modules

### Gateway Status Sync

**Source:** `sync-gateway-status.mjs`

Runs via cron every 30 seconds. Calls `openclaw status --json` and writes a lightweight agent status map to `gateway-status.json` for the RealtimeSync module to consume.

**Output:** `gateway-status.json` containing:
- `syncedAt` — Sync timestamp
- `agentCount` — Total agents
- `agents[]` — Per-agent status (active/recent/offline/never)
- `recentSessions[]` — Top 5 recent sessions
- `sessionsTotal` — Total session count
- `heartbeat` — Gateway heartbeat data

Agent status is derived from `lastActiveAgeMs`:
- `< 120s` → `active`
- `< 600s` → `recent`
- `≥ 600s` → `offline`
- `null` → `never`

### Models Catalog Sync

**Source:** `sync-models-catalog.js`

Reads `~/.openclaw/openclaw.json` model providers and writes a flat catalog to `models-catalog.json` for the desktop views.

**Output:** `models-catalog.json` containing:
- `models[]` — Flat list of all models with provider, context window, reasoning flag
- `providers[]` — Provider summary with base URL and model count
- `syncedAt` — Sync timestamp

Usage:
```bash
node sync-models-catalog.js           # One-time sync
node sync-models-catalog.js --watch   # Watch config file for changes
```

---

## Integration Diagram

```
┌─────────────────────────────────────────────────┐
│  task-server.js (port 3876)                     │
│  ├── Workflow Runs API (CRUD, claim, heartbeat) │
│  ├── Governance API (action authorization)      │
│  └── Agent Workflow Client API                  │
└────────────┬────────────────────────────────────┘
             │
    ┌────────▼────────┐
    │  PostgreSQL DB   │
    │  workflow_runs   │
    │  workflow_agent_ │
    │  routing         │
    └────────┬────────┘
             │
    ┌────────▼────────────────────────────┐
    │  Dispatcher V2 (background process) │
    │  Polls every 30s                    │
    │  ├── Dispatch queued → agent        │
    │  ├── Recover stale dispatched       │
    │  └── Recover stale claimed          │
    └────────┬───────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │  Workflow Run Monitor               │
    │  Polls every 30s                    │
    │  ├── Spawn agents for orphans       │
    │  └── Timeout runs over 60 min       │
    └────────────────────────────────────┘
             │
    ┌────────▼────────────────────────────┐
    │  Agent (via agent-workflow-client)   │
    │  poll → claim → heartbeat → complete│
    └────────────────────────────────────┘
```
