# MCP Server Reference — Dashboard as Tool Provider

> The dashboard ships an MCP (Model Context Protocol) server so OpenClaw agents
> — or any external MCP client such as Claude Desktop — can query project state
> through standardized tools inside their normal tool loop. Design brief:
> [briefs/mcp-exposure.md](briefs/mcp-exposure.md). Depth over count: a small
> catalog of deep, OpenClaw-native tools over data generic platforms cannot see.

## Status

**Slice 1 shipped** — protocol core + the 10 read-only tools below.
Slice 2 (pending) adds the mutating trio (`create_task`, `update_task`,
`create_snapshot`) behind `OPENCLAW_MCP_MUTATIONS=1`; until then no write
tools exist at all.

## Transport & process model

- **stdio only**: the MCP client spawns `node mcp-server.js` locally and
  speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. No SDK, no new
  network listeners.
- Methods: `initialize`, `tools/list`, `tools/call`, `ping`. Unknown methods
  get JSON-RPC error `-32601`. Malformed lines get `-32700` and the loop
  survives. Notifications (requests without `id`) get no reply.
- Protocol version pinned by the server: **`2024-11-05`** (bumped deliberately,
  never silently).
- stdout carries protocol frames exclusively; logs go to stderr.

## Auth model

Same bearer token as everything else, single credential:

| Env var | Meaning |
|---|---|
| `DASHBOARD_AUTH_TOKEN` | Operator's task-server bearer token. Attached as `Authorization: Bearer …` to every loopback call. Never minted, proxied, logged, or echoed into results/errors. |
| `TASK_SERVER_URL` | Optional; default `http://127.0.0.1:3876`. |
| `OPENCLAW_MCP_MUTATIONS` | Reserved for slice 2 (`1` enables the mutating trio). Inert today. |

Prerequisite: **the task-server must be running locally.** If it is down,
tools return structured `isError` results (`task_server_unreachable`) instead
of crashing. Auth failures surface as `{error:"auth_failed"}` with a hint
naming `DASHBOARD_AUTH_TOKEN` — never a retry loop.

Failure honesty contract:

- Upstream `404` → normal result `{error:"not_found"}` (business-level miss).
- Degradation bodies pass through verbatim, e.g. costs without PostgreSQL →
  `{available:false, reason:"no_database"}`.
- Unreachable / `401` / `403` / `5xx` → `isError:true` structured results.

## Client registration

OpenClaw MCP client config (same shape for Claude Desktop's
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openclaw-dashboard": {
      "command": "node",
      "args": ["/path/to/openclaw-project-webos/mcp-server.js"],
      "env": {
        "DASHBOARD_AUTH_TOKEN": "<operator's own token>",
        "TASK_SERVER_URL": "http://127.0.0.1:3876"
      }
    }
  }
}
```

The token value is the operator's own (same one the dashboard uses). The MCP
server never mints or proxies credentials.

## Tool catalog (slice 1 — all read-only)

All tools take a single `arguments` object; unknown or invalid arguments are
rejected at the tool boundary BEFORE any HTTP call, with messages naming legal
values/ranges. Results are returned as a `content` text frame containing the
JSON payload.

### `list_tasks`

List tasks from the dashboard database. Archived tasks are excluded unless
`include_archived=true`.

```jsonc
// input
{ "status": "string (optional, exact match against tasks.status)",
  "project_id": "string (optional)",
  "limit": "integer 1–200, default 50",
  "include_archived": "boolean, default false" }
// output { tasks: [...], total, truncated, include_archived }
```

Adapter note: the server's DB-backed list lives at `GET /api/tasks/all`
(`GET /api/tasks` is the legacy markdown reader), and that endpoint has no
server-side status/limit params — the MCP layer applies both locally and
reports `truncated` honestly. Status values follow the `tasks_status_check`
set (backlog, ready, in_progress, blocked, review, completed, topic_candidate,
drafting, image_pending, image_ready, qa_pending, ready_to_publish, published,
retrying, failed, cancelled, archived).

### `get_task`

```jsonc
{ "task_id": "string (required)" }   // full row incl. dependencies + history pointer
```

Unknown id → `{error:"not_found"}` as a normal result.

### `get_costs_summary`

```jsonc
{ "days": "integer 1–90, default 7" }   // mirrors cost-routes MAX_DAYS=90 (rejects, not clamps)
```

Degrades honestly: `{available:false, reason:"no_database"}` without PostgreSQL.

### `get_cost_rollup`

```jsonc
{ "group_by": "agent|department|workflow_type (default agent)",
  "days": "integer 1–90, default 7" }
```

Enum validated locally before the HTTP call.

### `list_budgets`

```jsonc
{}   // budgets with derived status ('breached' included) — Mission Control's budget-bar payload
```

### `get_budget_ledger`

```jsonc
{ "budget_id": "string (required)", "period": "current|YYYY-MM (default current)" }
```

Breach latches, warnings, rollovers for one budget.

### `list_snapshots`

```jsonc
{}   // disk registry, newest-first — works without PostgreSQL
```

### `get_fleet_status`

```jsonc
{ "include_stuck": "boolean, default true", "running_limit": "integer 1–100, default 20" }
// output { health, agents, running_runs, stuck_runs? }
```

Composes `/api/health-status` + `/api/agents/status` +
`/api/workflow-runs?status=running&limit=N` (+ `/api/workflow-runs/stuck`)
into one flat answer. Sections fail soft: a failing section reports
`{section:"unavailable"}` without blanking the rest.

### `get_mission_control_summary`

```jsonc
{ "sections": ["health","agents","queue","runs","blockers","cron","costs","budgets"] (optional subset, default all) }
```

Flagship depth tool — one call answers what otherwise takes ten. Server-side
`Promise.allSettled` composition of the endpoints Mission Control polls:
health-status, openclaw/agents + agents/status, queued tasks (DB-backed list,
queued filter applied in the adapter, cap 200), workflow runs
(running/stuck/failed), blockers summary, cron jobs, costs summary (7d),
budgets. A failing section yields `{section:"unavailable"}`; remaining
sections stay populated.

### `search_audit`

```jsonc
{ "q": "string (optional free-text)", "actor": "string (optional)",
  "action": "string (optional)", "task_id": "string (optional)",
  "start_date": "YYYY-MM-DD (optional)", "end_date": "YYYY-MM-DD (optional)",
  "entity_type": "string (optional)", "governance_only": "boolean, default false",
  "limit": "integer 1–500, default 100", "offset": "integer ≥0, default 0" }
```

Accountability tool: who did what to which entity, when. Filters pass through
as URL-encoded query params on `GET /api/audit`.

## Non-goals (v1)

No resource subscriptions, no prompts primitives, no write tools beyond the
three catalogued mutations (slice 2), NO restore/delete/cron-control tools,
no HTTP-SSE transport. See brief §7.

## Testing

DB-free suite: `node tests/test-mcp-server.js` (also registered in
`scripts/ci-db-free-tests.js`). Covers protocol conformance, framing survival,
validation-before-fetch, per-tool dispatch golden paths, degradation/auth/
unreachable mapping, allSettled composition, and a no-token-leakage grep.
