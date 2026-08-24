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
