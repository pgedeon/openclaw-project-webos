---
layout: default
---

# MCP Server Reference — Dashboard as Tool Provider

> The dashboard ships an MCP (Model Context Protocol) server so OpenClaw agents
> — or any external MCP client such as Claude Desktop — can query project state
> through standardized tools inside their normal tool loop. Design brief:
> [briefs/mcp-exposure.md](briefs/mcp-exposure.md). Depth over count: a small
> catalog of deep, OpenClaw-native tools over data generic platforms cannot see.

## Status

**Slice 2 shipped** — the full 13-tool catalog is live: the 10 read-only tools
below plus the mutating trio (`create_task`, `update_task`, `create_snapshot`)
behind `OPENCLAW_MCP_MUTATIONS=1`. Without the flag the server stays strictly
read-only.

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
| `OPENCLAW_MCP_MUTATIONS` | Set to `1` to register the mutating trio. Off (default) = read-only profile. See [Mutating tools](#mutating-tools--the-receipts-audit-trail). |

Prerequisite: **the task-server must be running locally.** If it is down,
tools return structured `isError` results (`task_server_unreachable`) instead
of crashing. Auth failures surface as `{error:"auth_failed"}` with a hint
naming `DASHBOARD_AUTH_TOKEN` — never a retry loop.

Failure honesty contract:

- Upstream `404` → normal result `{error:"not_found"}` (business-level miss).
- Degradation bodies pass through verbatim, e.g. costs without PostgreSQL →
  `{available:false, reason:"no_database"}`.
- Unreachable / `401` / `403` / `5xx` → `isError:true` structured results.
- Mutations refused by storage (503) → `isError:true`
  `{error:"unavailable", reason, hint:"…nothing executed"}` — an honest
  write-refusal mapping, never a crash and never a half-executed write.

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

Read-only profile above. To let this client execute the mutating trio, add
`"OPENCLAW_MCP_MUTATIONS": "1"` to the `env` object — enablement is per
client spawn, explicit, and local to the operator's machine.

The token value is the operator's own (same one the dashboard uses). The MCP
server never mints or proxies credentials.

### Registering with OpenClaw

OpenClaw has first-class MCP server management (`openclaw mcp add` probes the
server before saving). Registered 2026-08-26 as `webos-dashboard`, pointed at
the LAN staging task-server (current code — the telemetry route ships there
first):

```bash
openclaw mcp add webos-dashboard \
  --command node \
  --arg /mnt/c/Users/Rosa/Documents/openclaw-project-webos/mcp-server.js \
  --cwd /mnt/c/Users/Rosa/Documents/openclaw-project-webos \
  --env TASK_SERVER_URL=http://192.168.0.81:8120 \
  --env DASHBOARD_AUTH_TOKEN=<staging token from webroot/.env>
```

- The probe connects over stdio and lists capabilities before saving; expect
  `webos-dashboard: 10 tools` (13 registered minus the 3 mutation-gated).
- Verify with `openclaw mcp probe webos-dashboard`; inspect with
  `openclaw mcp show webos-dashboard`.
- Env names are exactly `TASK_SERVER_URL` + `DASHBOARD_AUTH_TOKEN`
  (see `resolveMcpConfig()` in lib/mcp-server.js) — no other env needed for
  the read-only profile.

## Agent integration (pilot wiring, 2026-08-26; extended 2026-08-29)

Registration alone does not put the tools in front of an agent's model — it
saves a definition. Exposure works like this: OpenClaw projects every enabled
`mcp.servers` entry into agent runtimes as plugin-owned tools under the
`bundle-mcp` plugin id, and the tool profiles implicitly allow that id for
`coding` and `messaging` profiles (`full` allows everything). So after plain
registration the tools are already visible to agents whose profile/allowlist
doesn't exclude them; per-server scoping is done with a tool filter:

```bash
# Scope the server to the 10 read-only tools (include-list; mutating trio
# additionally stays hidden behind OPENCLAW_MCP_MUTATIONS=1 at the server).
openclaw mcp tools webos-dashboard --include \
  'get_fleet_status,get_mission_control_summary,list_tasks,get_task,list_budgets,get_budget_ledger,list_snapshots,get_costs_summary,get_cost_rollup,search_audit'
```

This writes a `toolFilter.include` array into the server's config entry
(`openclaw mcp show webos-dashboard` to inspect). Config changes live outside
the repo in `/root/.openclaw/openclaw.json` — nothing in this repo needs to
change for the wiring. Notes learned during the pilot:

- Agents with an explicit `tools.allow` list (e.g. `main`,
  `dashboard-manager`) do NOT get MCP tools automatically — `allow` replaces
  the profile default, so entries like `bundle-mcp` or specific
  `webos-dashboard__*` names must be added there explicitly. Agents using
  `tools.alsoAllow` + `deny` (e.g. `coder`) inherit the unrestricted profile
  and see the filtered tools immediately.
- Coverage (2026-08-29): `main` and `dashboard-manager` now carry
  `bundle-mcp` in their explicit `tools.allow` lists (the plugin id under
  which OpenClaw projects enabled MCP servers), so both inherit the
  `webos-dashboard` tool surface (10 read-only tools via the server's
  `toolFilter.include`) alongside their existing allowlists. `coder`
  unchanged (already covered via `alsoAllow` + `deny`).
- Per-agent granularity exists at two levels: `agents.list[].tools.allow/
  deny` (whole-surface) and the per-server `toolFilter.include/exclude`
  above (per-tool). There is no per-agent-per-server matrix; combine both if
  you need one.
- After changing filters, start a NEW session (or reload) so discovery picks
  up the change; dynamic tool-list changes invalidate the cached catalog on
  next use.

### Pilot evidence (first organic calls)

Pilot agent: **coder** (the repo's own coding agent). A fresh session was
given the natural-language task "What is the current fleet status of my
agents, and are there any budget breaches right now?" via
`openclaw agent --agent coder --session-key agent:coder:mcp-pilot-0826` with
no tool hints. The agent answered from live data (fleet healthy; 4 budgets,
all under cap) and the adoption telemetry recorded exactly two new rows —
proof the calls went through the MCP path (telemetry only fires on executed
`tools/call`):

| timestamp (UTC) | tool | outcome | durationMs |
| --- | --- | --- | --- |
| 2026-08-26T06:46:08Z | `get_fleet_status` | ok | 50 |
| 2026-08-26T06:46:09Z | `list_budgets` | ok | 9 |

Reproduce the check: `npm run mcp:telemetry` (needs `POSTGRES_HOST/PORT/DB/
USER/PASSWORD` env pointing at the dashboard DB) — organic calls appear as
new rows after the pilot timestamp. Baseline before the pilot was 5 rows
(manual probe + same-session verification calls); the counter cannot
distinguish clients over stdio, so "organic" = rows created by an agent turn
that was never told which tools exist.

### Main-agent adoption evidence (2026-08-29)

`main` (the primary operator agent) was given the same natural-language
prompt — "show me current fleet status and any budget alerts" — in a fresh
session (`agent:main:mcp-adoption-0829` via `openclaw agent`) with zero tool
hints. It answered from live data (fleet healthy; 5 budgets all under cap,
zero spend, no alerts) and the adoption telemetry recorded exactly two new
rows, confirming the calls went through the MCP path:

| timestamp (UTC) | tool | outcome | durationMs |
| --- | --- | --- | --- |
| 2026-08-29T06:20:55Z | `get_fleet_status` | ok | 42 |
| 2026-08-29T06:20:55Z | `list_budgets` | ok | 13 |

Counter after the run: 19 total rows (11 ok / 8 error), 5 distinct tools
used across 3 active days. `dashboard-manager` inherits the same surface
via its `bundle-mcp` allow entry but has no organic call yet — telemetry
will record its first rows when it next runs a dashboard question.

## Mutating tools & the receipts audit trail

The mutating set is deliberately tiny — three tools, each routed through the
**same governed write path the dashboard UI uses** (`POST
/api/actions/execute`, the one-click-actions pipeline), NOT raw REST
endpoints. Every agent-side mutation therefore mints a row in the
`action_receipts` table (plus an `audit_log` mirror where a task identity
resolves): envelope validation → audit-first refusal without database
storage → idempotency latch on a client-minted `actionId` → fail-closed
governance pre-check → backing executor reusing the storage layer in-process
→ receipt outcome + audit mirror finalized in one transaction.

- **Actor**: receipts are stamped `actor: 'openclaw'` — a privileged system
  actor, since the MCP process IS the operator's agent. Non-privileged
  actors calling the same action kinds get typed `rejected_governance`
  receipts instead of silent writes.
- **Idempotency**: every call mints a fresh `mcp-<ts>-<random>` actionId, so
  retries by the agent are legitimate repeats that each get their own
  receipt; the latch exists to collapse concurrent double-fires.
- **Action kinds**: `task.create` (target = project_id), `task.update`
  (target = task_id, patch passes through verbatim), `snapshot.create`
  (target = snapshot name). These kinds are registered in
  `lib/action-registry.js` but referenced by no UI button — the flag below
  is the only enablement gate.
- **Flag semantics**: with `OPENCLAW_MCP_MUTATIONS` unset or ≠ `1`, the trio
  is ABSENT from `tools/list` AND `tools/call` on them answers JSON-RPC
  `-32601 method_not_found` — indistinguishable from any other absent
  method. A read-only client never sees a write affordance to refuse
  (hidden-not-refused invariant). With `=1` they register and execute.

### `create_task`

```jsonc
{ "title": "string (required)", "project_id": "string (required)",
  "description": "string (optional)", "owner_agent": "string (optional)",
  "status": "string (optional)", "due_date": "ISO date (optional)" }
// → { receipt: { kind:'task.create', outcome:'executed', detail:{result:{new_task_id,…}} } }
```

### `update_task`

```jsonc
{ "task_id": "string (required)",
  "patch": { /* field:value updates, passed through verbatim */ } }
// → { receipt: { kind:'task.update', outcome:'executed', … } }
```

Raw PATCH semantics apply (owner reassignment included); unknown task ids
return `{error:"not_found", receipt}` as a normal result with the failed
receipt attached.

### `create_snapshot`

```jsonc
{ "name": "string (optional, ≤120 chars, default snapshot-YYYYMMDD-HHmm)" }
// → { receipt: { kind:'snapshot.create', outcome:'executed', detail:{result:{snapshot_id}} } }
```

Additive-only (writes one artifact file after a full redacted read pass over
all tier tables). Requires database storage like the dashboard's own create
button; without it the tool answers structured `unavailable`. Restore is
deliberately NOT tool-exposed — restore is HOLD_CONFIRM territory in the UI
and has no business being one tool-call away from an autonomous agent.

Receipt replays (`duplicate:true`) and governance denials surface verbatim
as normal/isError results respectively, so the agent can always see what the
pipeline decided and why.

## Adoption telemetry (did anything actually call our tools?)

Every **executed** `tools/call` — after the call completes — fires a
fire-and-forget `POST /api/mcp/telemetry` to the task-server (same base URL
and bearer credential as the tool calls themselves). The emission is never
awaited on the response path and never alters the tool result: a down
telemetry sink is byte-for-byte invisible to the MCP client. The only place
emission is waited on is a bounded shutdown drain in `runStdio` so process
exit cannot kill an in-flight POST.

- **What counts**: every call that reaches a registered, visible tool —
  including validation rejections and upstream failures (both emit
  `outcome: "error"`). Protocol-level rejects are deliberately NOT emitted:
  an unknown-tool `-32602` or a hidden-mutation `-32601` probe is not tool
  usage, and emitting it would let a misbehaving client write junk rows.
- **Sink**: `POST /api/mcp/telemetry` (routes/mcp-telemetry-routes.js)
  appends one `audit_log` row per event — action `mcp-tool-call`, actor
  `openclaw`, `task_id` NULL, `new_value` JSONB
  `{tool, outcome, durationMs}`. Bearer-auth like every API route; tool
  names validate against the live registry. Degradation mirrors the
  workflow-graph events contract: no database pool or missing `audit_log`
  table answers `200 {"stored": false, "reason": "no_database" |
  "audit_log_missing"}` instead of erroring — staging/json_snapshot mode
  stays silent by design.
- **Counter**: `npm run mcp:telemetry` (`scripts/mcp-adoption-counter.js`)
  reads the `mcp-tool-call` audit rows since the slice-1 ship date
  **2026-08-25** and prints total calls, the ok/error split, days-with-
  activity, first/last call timestamps, a per-tool breakdown, and the list
  of registered tools NEVER called this window. Distinct client sessions are
  honestly reported as not derivable (stdio carries no session identity).
  Same graceful no-DB contract as `dag:telemetry`: database unavailability
  prints an honest unavailable message and exits 0 — unavailable is never
  reported as zero.
- **First real adoption (2026-08-26)**: after OpenClaw registration (see
  "Registering with OpenClaw" above), one read-only `get_fleet_status` call
  through the registered server recorded the first row — counter output:
  `Total tool calls: 1 · 1 ok / 0 error · Tools used: 1 of 13 ·
  get_fleet_status: 1 call, ok`.
- **Schema note**: `audit_log.task_id` must be nullable for these task-less
  system rows; migrations/20260826_audit_log_task_id_nullable.sql aligns
  schemas provisioned from the original NOT NULL DDL (prod was already
  nullable — drift, not a semantic change).

## Tool catalog (10 read-only + 3 mutating)

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
three catalogued mutations, NO restore/delete/cron-control tools,
no HTTP-SSE transport. See brief §7.

## Testing

DB-free suite: `node tests/test-mcp-server.js` plus
`node tests/test-mcp-telemetry.js` (both registered in
`scripts/ci-db-free-tests.js`). Covers protocol conformance, framing survival,
validation-before-fetch, per-tool dispatch golden paths, degradation/auth/
unreachable mapping, allSettled composition, a no-token-leakage grep, the
slice-2 mutation contract: flag-off hides the trio from list AND call with
zero fetches, flag-on registers all 13 tools, receipt envelopes carry the
right kind/target/params/actor, and 503 write-refusals map to honest
structured errors — plus the adoption-telemetry contract: exactly one POST
per executed call with the right outcome/durationMs, error-outcome emission
on validation rejections and upstream failures, byte-identical results when
the telemetry sink is down, zero emission on protocol-level rejects, and the
route/aggregation pure helpers (validation matrix, degradation ladder, audit
row shape, UTC day bucketing, malformed-row tolerance).
