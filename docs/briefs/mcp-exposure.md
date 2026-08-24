# Design Brief — MCP Server Exposure (Dashboard as Tool Provider)

**Status:** Draft for build review · **Roadmap:** Phase 2 (UPGRADE_ROADMAP.md "MCP server exposure" — Phase 2 opener per roadmap review #2, which named it the single most defensible roadmap item and protected it from slippage)
**Evidence base:** existing machinery verified in-repo 2026-08-24: `routes/task-routes.js` (full tasks CRUD), `routes/cost-routes.js` (`GET /api/costs/summary`, `GET /api/costs/rollup?group_by=agent|department|workflow_type`), `routes/budget-routes.js` (`GET /api/budgets`, `GET /api/budgets/:id/ledger`), `routes/snapshot-routes.js` (slice 2 shipped: `POST /api/snapshots`, `GET /api/snapshots`, `/download`), `routes/agent-routes.js` (`GET /api/audit` with q/actor/action/task_id/date/entity_type/governance_only filters), `routes/health-routes.js` + `routes/agent-routes.js` (`/api/health-status`, `/api/openclaw/agents`, `/api/agents/status`), `workflow-runs-api.js` (`/api/workflow-runs`, `/stuck`, `/active`, `/api/blockers/summary`), Mission Control aggregation recipe (`src/shell/native-views/mission-control-view.mjs` fans out over ~10 endpoints client-side), bearer-token auth policy (`routes/auth-policy.js`: single operator, SHA-256 digest timing-safe compare, `DASHBOARD_AUTH_TOKEN`), loopback binding guard (`task-server.js`: fatal on non-loopback bind without token; gateway bridge pattern `ws://127.0.0.1:<port>` with the secret kept server-side in `lib/gateway-bridge.js`).
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit. Concurrent-lane guard: coder is building snapshot slice 3 (`src/shell/native-views/settings-view.mjs`) — this brief's build phase must not touch that file or any view file (§6 sequencing).

---

## 1. Positioning

**Expose the dashboard AS an MCP server**, so any OpenClaw agent — or any external MCP client (Claude Desktop, other editors) — can query and act on project state through standardized tools inside their normal tool loop.

The market scan (docs/research/market-scan-2026-08-24.md) reframed this item as **depth over count**: FleetQ advertises 675+ MCP tools across 45 domains; we do not chase that number. We ship ~13 deep, OpenClaw-native tools over data generic platforms cannot see — task boards with dependency state, budget ledgers with breach latches, per-agent cost rollups, full-state snapshots, fleet health, audit search. A tool dump is a feature list; a well-designed tool catalog is an integration surface.

Three properties make this defensible rather than cosmetic:

1. **It is an adapter layer, not a rewrite.** Nearly every tool maps 1:1 onto a shipped REST endpoint (§2). The only genuinely new server-side logic is one aggregation handler (`get_mission_control_summary`, §2.14) plus schema validation and dispatch plumbing.
2. **Depth = schema + semantics.** Each tool carries typed input schemas, honest degradation mirrors of the house contract (`{available:false, reason:'no_database'}`), and read-only vs mutating classification up front.
3. **Governance adjacency.** The mutating set is deliberately tiny (3 tools) and sits next to the one-click-actions gating machinery (action_receipts, severity tiers) — v1 routes mutations through raw endpoints behind an explicit enablement flag; routing them through governed action kinds is the designated v1.1 upgrade path (§8 open question).

## 2. Tool Catalog Proposal (13 tools)

Classification: **R** = read-only (default enabled), **M** = mutating (requires explicit enablement, §4.3). All handlers live in `lib/mcp-server.js` and call task-server over loopback HTTP with the bearer token — no direct DB access from the MCP layer.

| # | Tool | Class | Backing endpoint (exists?) |
|---|------|-------|----------------------------|
| 1 | `list_tasks` | R | `GET /api/tasks?status=&limit=` (+ `GET /api/tasks/all`) ✅ |
| 2 | `get_task` | R | `GET /api/tasks/:id` ✅ |
| 3 | `create_task` | M | `POST /api/tasks` ✅ |
| 4 | `update_task` | M | `PATCH /api/tasks/:id` ✅ |
| 5 | `get_costs_summary` | R | `GET /api/costs/summary?days=` ✅ |
| 6 | `get_cost_rollup` | R | `GET /api/costs/rollup?group_by=&days=` ✅ |
| 7 | `list_budgets` | R | `GET /api/budgets` ✅ |
| 8 | `get_budget_ledger` | R | `GET /api/budgets/:id/ledger?period=` ✅ |
| 9 | `list_snapshots` | R | `GET /api/snapshots` ✅ |
| 10 | `create_snapshot` | M | `POST /api/snapshots` ✅ |
| 11 | `get_fleet_status` | R | `GET /api/health-status` + `GET /api/agents/status` + `GET /api/workflow-runs?status=running&limit=` + `GET /api/workflow-runs/stuck` ✅ |
| 12 | `get_mission_control_summary` | R | NEW aggregation handler composing the same endpoints Mission Control polls (§2.14) |
| 13 | `search_audit` | R | `GET /api/audit?q=&actor=&action=&task_id=&start_date=&end_date=&entity_type=&governance_only=&limit=&offset=` ✅ |

Workflow-run status rides inside `get_fleet_status` / `get_mission_control_summary` in v1; a dedicated `list_workflow_runs` tool is the first v1.1 candidate (§7 non-goals).

### 2.1 `list_tasks` (R)

```jsonc
// input
{ "status": "queued|in_progress|blocked|done|…(optional)",
  "project_id": "string (optional)", "limit": "integer 1–200, default 50",
  "include_archived": "boolean, default false" }
// output: { tasks: [...], total } — passthrough of REST shape
```
Description text tells the model the ordering and that archived tasks need the flag — schema-carried semantics, not tribal knowledge.

### 2.2 `get_task` (R)

```jsonc
{ "task_id": "string (required)" }
```
Returns the full task row incl. dependencies and history pointer. Unknown id → structured `{error:"not_found"}` result, never a thrown JSON-RPC error for business-level misses.

### 2.3 `create_task` (M)

```jsonc
{ "title": "string (required)", "project_id": "string (required)",
  "description": "string (optional)", "owner_agent": "string (optional)",
  "status": "string (optional, default queued)", "due_date": "ISO date (optional)" }
```

### 2.4 `update_task` (M)

```jsonc
{ "task_id": "string (required)",
  "patch": { /* any PATCH /api/tasks/:id field */ } }
```
Patch object passed through verbatim after schema check; response echoes the updated row. Owner reassignment intentionally NOT special-cased in v1 — raw PATCH semantics apply; governed `task.assign` routing is §8 OQ2.

### 2.5 `get_costs_summary` (R)

```jsonc
{ "days": "integer 1–90, default 7" }   // MAX_DAYS clamp mirrored from cost-routes
```
Passthrough incl. the degradation body `{available:false, reason:'no_database'}` — the tool result states availability honestly instead of erroring.

### 2.6 `get_cost_rollup` (R)

```jsonc
{ "group_by": "agent|department|workflow_type (default agent)",
  "days": "integer 1–90, default 7" }
```
Enum validated locally BEFORE the HTTP call so typos fail at the tool boundary with the same message the route would return.

### 2.7 `list_budgets` (R)

```jsonc
{}   // no parameters
```
Returns budgets with derived status (`breached` included) — the exact payload Mission Control's budget bars consume.

### 2.8 `get_budget_ledger` (R)

```jsonc
{ "budget_id": "string (required)", "period": "current|YYYY-MM (default current)" }
```

### 2.9 `list_snapshots` (R)

```jsonc
{}   // disk registry, newest-first — works without PostgreSQL (AC-pinned in snapshot brief)
```

### 2.10 `create_snapshot` (M)

```jsonc
{ "name": "string (optional, default snapshot-YYYYMMDD-HHmm)" }
```
Mutating but additive-only (writes one artifact file); classified M because it consumes disk and performs a full read pass over all tier tables. Restore is deliberately NOT exposed as a tool in v1 (§7) — restore is HOLD_CONFIRM territory in the UI and has no business being one tool-call away from an autonomous agent.

### 2.11 `get_fleet_status` (R)

```jsonc
{ "include_stuck": "boolean, default true", "running_limit": "integer 1–100, default 20" }
```
Composes health-status + agents/status + running/stuck workflow runs into one flat answer: `{health, agents:[...], running_runs, stuck_runs}`. This is the "is anything on fire" tool.

### 2.12 `get_mission_control_summary` (R)

```jsonc
{ "sections": "array of health|agents|queue|runs|blockers|cron|costs|budgets (optional, default all)" }
```
NEW aggregation handler mirroring `mission-control-view.mjs`'s fetch list (`/api/health-status`, `/api/openclaw/agents`, `/api/agents/status`, `/api/tasks?status=queued&limit=200`, `/api/workflow-runs?status=running&limit=50`, `/api/workflow-runs/stuck`, `/api/blockers/summary`, `/api/workflow-runs?status=failed&limit=10`, `/api/cron/jobs`, `/api/costs/summary?days=7`, `/api/budgets`) composed SERVER-side with `Promise.allSettled` semantics: a failing section returns `{section:"unavailable"}` and never blanks the summary. This is the flagship depth tool — one call answers what otherwise takes ten.

### 2.13 `search_audit` (R)

```jsonc
{ "q": "string (optional free-text)", "actor": "string (optional)",
  "action": "string (optional)", "task_id": "string (optional)",
  "start_date": "ISO date (optional)", "end_date": "ISO date (optional)",
  "entity_type": "string (optional)", "governance_only": "boolean, default false",
  "limit": "integer 1–500, default 100", "offset": "integer ≥0, default 0" }
```
The accountability tool: agents can answer "what happened to this task / who did what" without shell access to the DB.

## 3. Transport Choice — stdio for v1

Two candidates:

| | **stdio MCP server** (recommended v1) | HTTP-SSE MCP transport |
|---|---|---|
| Topology | Client (Claude Desktop / OpenClaw) spawns `node mcp-server.js`; JSON-RPC 2.0 newline-delimited over stdin/stdout | Long-lived HTTP + SSE endpoints added to task-server or a sibling process |
| Network surface | Zero new listeners — process I/O only | New bind, new auth surface, CORS/keepalive concerns |
| Auth | Env-injected bearer token; secrets stay in the client config env block, never on the wire | Token on every request; loopback guard applies |
| Fits deployment | Single-operator, same-host dashboard (task-server binds `127.0.0.1:3876` by design) | Multi-host/remote clients — we don't have them |
| Effort | Adapter only | Transport + session management + reconnect logic |

**Recommendation: stdio wrapping task-server HTTP.** The dashboard is a deliberately local, single-operator system — task-server already refuses non-loopback binds without a token (`task-server.js` fatal guard), and the gateway bridge established the house pattern: long-lived protocol connections terminate in a server-side process that holds the secret (`ws://127.0.0.1:<gw.port>` in `lib/gateway-bridge.js`), never exposing it to browsers or clients. The stdio MCP server inherits exactly that shape: the MCP client spawns it locally, it holds `DASHBOARD_AUTH_TOKEN` in its environment, and all privileged calls happen over loopback HTTP.

**Loopback landmine (the reason this paragraph exists):** the naive "just add SSE routes to task-server" approach quietly turns a loopback-only service into a network-exposed tool endpoint and duplicates auth logic outside `auth-policy.js`. If remote clients ever become real, HTTP-SSE transport must be a SEPARATE listener with the same bind-guard discipline (loopback default, token required, fatal on violation) — noted here so the shortcut isn't taken under time pressure. v1 ships stdio only.

## 4. Auth & Scoping

### 4.1 Credential model

Same bearer token as everything else: the MCP server reads `DASHBOARD_AUTH_TOKEN` (and optional `TASK_SERVER_URL`, default `http://127.0.0.1:3876`) from its environment and attaches `Authorization: Bearer …` to every task-server call. No second credential, no token derivation, no storage-layer credentials in the MCP process. Secrets stay server-side by construction — the client config holds the env block, the wire carries loopback HTTP with the header, nothing lands in agent-visible transcripts except tool results.

### 4.2 Failure honesty

401 from task-server surfaces as a structured tool result (`{error:"auth_failed"}`) with a hint naming the env var — an agent that can't authenticate should say so, not retry-loop.

### 4.3 Tool-level scoping

Two profiles:

- **Read-only (default):** the 10 R tools. Enabled whenever the server starts.
- **Mutating set:** `create_task`, `update_task`, `create_snapshot`. Gated behind explicit enablement — `OPENCLAW_MCP_MUTATIONS=1` in the spawn env. When unset, the tools are hidden from `tools/list` entirely (not merely refused at call time), so a read-only-configured client never sees write affordances it cannot use.

Rationale: MCP clients range from trusted operator assistants to semi-autonomous loops. Default-off writes mean the out-of-the-box configuration can be pointed at ANY project with zero blast radius, and enabling writes is a deliberate operator act recorded in their own client config.

## 5. Implementation Plan

### 5.1 File plan (build phase — future commits, NOT this one)

| File | New/Mod | Contents |
|---|---|---|
| `lib/mcp-server.js` | NEW | Protocol core + tool registry + handlers. Vanilla JS, zero SDK — repo charter is no-framework/no-build and MCP's stdio transport is just newline-delimited JSON-RPC 2.0 over stdin/stdout, well inside hand-rolled range (~400 lines with schemas). Exports pure pieces for DB-free tests: `TOOLS` registry, `validateInput(tool, params)`, `dispatch(tool, params, deps)` with injectable `fetch`. |
| `scripts/mcp-server.js` or root entry | NEW | Thin executable entry: `node mcp-server.js` → reads env, wires real fetch against `TASK_SERVER_URL`, runs the stdio loop. Handles `initialize`, `tools/list`, `tools/call`, `ping`; unknown method → JSON-RPC error `-32601`. |
| `tests/test-mcp-server.js` | NEW | DB-free suite (§6 ACs). |
| `docs/mcp-reference.md` | NEW | Tool reference + client registration (§5.3). |

No changes to `task-server.js`, no new routes, no migrations — the adapter calls existing HTTP endpoints. That constraint is deliberate: it keeps the MCP lane collision-free with every concurrent build lane and makes the whole thing removable without a trace.

### 5.2 Build sequence

1. **MVP slice:** protocol core + the 10 read-only tools + DB-free tests. Deliverable: `node mcp-server.js` speaks to Claude Desktop; every read tool verified against a running task-server.
   *Acceptance:* AC1–AC6 below.
2. **Slice 2:** mutating trio behind `OPENCLAW_MCP_MUTATIONS=1` + hidden-from-tools/list behavior + tests.
   *Acceptance:* AC7–AC9.
3. **Slice 3:** `get_mission_control_summary` aggregation handler + docs (`docs/mcp-reference.md`, registration guide) + CHANGELOG.
   *Acceptance:* AC10–AC12.

Slices are independently shippable; slice 1 alone closes the roadmap checkbox's read-only-first clause ("read-only tool set first, write actions behind approval gates").

### 5.3 Registration (documented in slice 3)

Claude Desktop (`claude_desktop_config.json`):

```jsonc
{ "mcpServers": { "openclaw-dashboard": {
    "command": "node",
    "args": ["/path/to/openclaw-project-webos/scripts/mcp-server.js"],
    "env": { "DASHBOARD_AUTH_TOKEN": "…", "TASK_SERVER_URL": "http://127.0.0.1:3876",
             "OPENCLAW_MCP_MUTATIONS": "0" } } } }
```

OpenClaw MCP client config follows the same shape (command + env). Docs must state the prerequisite plainly: task-server must be running locally, and the token value is the operator's own — the MCP server never mints or proxies credentials.

## 6. Acceptance Criteria

qa-auditor tests each slice against these. All run DB-free in `tests/test-mcp-server.js` via injected-fetch stubs; none require PostgreSQL or a live task-server.

- **AC1** — `tools/list` returns exactly the 13 catalogued tools (10 R + 3 M when mutations enabled; 10 when disabled), each with name, description, and a JSON Schema `inputSchema` that parses and validates (§2).
- **AC2** — `validateInput` rejects missing required fields, out-of-range numbers (`days` > 90 clamps or rejects per the mirrored route clamp — pinned by fixture), and unknown enum values (`group_by: 'banana'` → validation error naming the legal values) BEFORE any fetch is issued (zero-call assertion).
- **AC3** — `dispatch` maps every tool to its handler and issues the correct method+path+query to the injected fetch (one golden-path fixture per tool; e.g. `get_budget_ledger {budget_id:'b1'}` → `GET /api/budgets/b1/ledger?period=current` with `Authorization: Bearer …` header present).
- **AC4** — Business-level failures surface as structured tool results, not thrown JSON-RPC errors: upstream 404 → `{error:'not_found'}`, 401 → `{error:'auth_failed'}`, degradation bodies pass through verbatim (`{available:false, reason:'no_database'}`).
- **AC5** — Protocol conformance: `initialize` handshake responds with capabilities; `ping` → `{}`; unknown method → `-32601`; malformed JSON line on stdin → JSON-RPC error on stdout, loop survives and processes the next line.
- **AC6** — Read-only profile regression guard: with mutations disabled, `tools/call create_task …` returns the mutations-disabled error AND `tools/list` omits all three M tools (hidden-not-refused invariant).
- **AC7** — With `OPENCLAW_MCP_MUTATIONS=1`, the three M tools appear and dispatch correctly (fixture asserts POST/PATCH bodies pass through the validated patch object unchanged).
- **AC8** — `get_mission_control_summary` composes stubbed section responses into the flat summary; one failing section yields `{section:'unavailable'}` while remaining sections stay populated (allSettled semantics, §2.14).
- **AC9** — Stdio framing: newline-delimited request/response pairs round-trip; a handler that throws produces a JSON-RPC error frame and does not kill the process.
- **AC10** — No secret leakage: tool results and error strings never echo the bearer token (fixture greps outputs for the token value).
- **AC11** — `search_audit` passes filters through as query params exactly (URL-encoded), including `governance_only=true` and date bounds.
- **AC12** — Repo-conformance: no `.js` file outside `lib/mcp-server.js` + entry script modified; no new npm dependencies (package.json untouched); docs-drift-check stays green.

## 7. Explicit Non-Goals (v1)

- **No resource subscriptions** — no `resources/*` primitives, no server-initiated pushes; agents poll via tools. SSE-fed live data remains a UI concern.
- **No prompts primitives** — no `prompts/*`; tool descriptions carry the guidance.
- **No write tools beyond the three catalogued mutations** — notably NO restore tool, NO delete-task tool, NO budget/project mutation tools, NO cron control. Every additional write widens autonomous blast radius; additions require a brief revision.
- **No HTTP-SSE transport** (§3) — stdio only.
- **No SDK dependency** — vanilla JSON-RPC 2.0 per repo charter.
- **No direct DB access from the MCP layer** — HTTP adapter only, so auth/degradation/governance stay single-homed in task-server.

## 8. Risks & Open Questions

- **R1 — Tool-result size.** `list_tasks` unbounded could dump megabytes into a model context. Mitigation: hard limits in schemas (§2.1), truncation flags in results. Pinned by AC2 fixtures.
- **R2 — Mutation governance gap.** v1 `update_task` bypasses the action-receipt gating that one-click actions established for owner reassignment. Acceptable because enablement is explicit and local, but v1.1 should consider routing gated operations through `POST /api/actions/execute` kinds to inherit idempotency latches + receipts. Decision needed before slice 2 merges if CEO wants receipts from day one.
- **R3 — Concurrent-lane friction.** Build phase touches only `lib/` + `tests/` + docs; zero overlap with settings-view (slice 3) or any in-flight lane. Keep it that way — no "while we're in there" route refactors.
- **R4 — Spec drift.** MCP spec evolves; hand-rolled server pins whatever protocol version `initialize` negotiates. Mitigation: pin and document the negotiated version in `docs/mcp-reference.md`; bump deliberately, not silently.
- **OQ1 — Does any external MCP client actually get deployed, or is OpenClaw the only consumer?** Affects whether slice 3's registration docs target Claude Desktop first or OpenClaw config first. Cheap either way; default both.
- **OQ2 — Should `create_task`/`update_task` mint action receipts?** (see R2). Owner decision requested before slice 2.

## Related

- [Snapshot/restore brief](snapshot-restore.md) — `create_snapshot`/`list_snapshots` back onto its shipped endpoints; restore deliberately not tool-exposed (§7)
- [One-click actions brief](one-click-actions.md) — governance machinery the mutating tools may join (§8 R2/OQ2)
- [Budget ledger brief](budget-ledger.md) — ledger tool semantics
- [Roadmap](../../UPGRADE_ROADMAP.md) — Phase 2 "MCP server exposure"
- [Market scan 2026-08-24](../research/market-scan-2026-08-24.md) — depth-over-count framing vs FleetQ's 675+ tools
