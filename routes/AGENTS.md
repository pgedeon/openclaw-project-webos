# routes/ — HTTP Route Handlers

## Purpose

Modular route handlers registered on the task-server.js router. Each file owns a domain of API endpoints.

## Ownership

| File | Routes | Domain |
|------|--------|--------|
| `router.js` | — | Prefix-matching router with :param support |
| `health-routes.js` | `/api/health`, `/api/health-status`, `/api/stats` | System health |
| `auth-policy.js` | — | Single-operator bearer token auth policy helpers |
| `task-routes.js` | `/api/tasks/*` | Task CRUD, history, bulk ops |
| `project-routes.js` | `/api/projects/*` | Project CRUD |
| `view-routes.js` | `/api/views/*` | Board/timeline/agent views, saved views |
| `cron-routes.js` | `/api/cron/*` | Cron job management |
| `agent-routes.js` | `/api/agents/*`, `/api/org/*` | Agent status, org summary |
| `session-routes.js` | `/api/oc/sessions/*` | Session listing and history |
| `chat-routes.js` | `/api/oc/chat/*` | Agent chat send/abort/status |
| `sse-routes.js` | `/api/events`, `/api/events/stream` | Server-Sent Events push (poller-fed + gateway-bridge-fed) |
| `bing-routes.js` | `/api/bing/*` | Bing webmaster integration |
| `settings-routes.js` | `/api/settings/*` | Configuration management |
| `memory-routes.js` | `/api/memory/*` | Proxy to memory-api-server (port 3879) |

## Route Registration Pattern

```js
function registerMyRoutes(router) {
  router.add('GET', '/api/my-route', async (req, res, ctx, params) => {
    // ctx.sendJSON, ctx.asanaStorage, etc.
    return true; // handled
  });
}
module.exports = { registerMyRoutes };
```

## Handler Context (ctx)

- `sendJSON(res, status, data)` — JSON response helper
- `asanaStorage` — PostgreSQL storage instance
- `broadcast(event)` — SSE broadcast function

## Conventions

- Registration order matters — specific routes before catch-alls
- All routes are authenticated via Bearer token middleware in task-server.js (except `/api/health` and `/api/auth/self`)
- Full login/session/RBAC auth is deferred until a multi-operator requirement exists; keep route modules in single-operator token mode until then
- Route files should not import `pg` directly — use `ctx.asanaStorage`


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
