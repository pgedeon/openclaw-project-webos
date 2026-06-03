# Auth Reference

## Current Mode

OpenClaw WebOS currently uses single-operator bearer token auth.

- Set `DASHBOARD_AUTH_TOKEN` to require `Authorization: Bearer <token>` on API requests.
- `/api/health` remains public for health checks.
- `/api/auth/self` remains public so the shell can inspect the current auth mode and token status.
- The effective authenticated actor is always `dashboard-operator` with role `operator`.

If `DASHBOARD_AUTH_TOKEN` is not set, the server starts in local open mode only when the startup guard is explicitly bypassed with `REQUIRE_AUTH=false`.

## Deferred Full Auth

Full authentication is intentionally deferred until a multi-operator requirement exists. Do not add login, logout, password, session-cookie, CSRF, user-management, or per-user RBAC flows without first accepting that requirement in the improvement plan.

The deferred full-auth design remains captured in `docs/SPACE_AGENT_ANALYSIS.md` as a future feature. The current runtime policy reports this through `/api/auth/self`:

```json
{
  "authenticated": true,
  "mode": "token",
  "actor": "dashboard-operator",
  "role": "operator",
  "tokenRequired": true,
  "capabilities": {
    "bearerToken": true,
    "singleOperator": true,
    "sessions": false,
    "rbac": false,
    "multiOperator": false
  },
  "deferred": {
    "fullAuth": true,
    "until": "multi-operator requirement exists"
  }
}
```

## Client Behavior

The desktop shell receives the token in `globalThis.__DASHBOARD_AUTH_TOKEN__` when `DASHBOARD_AUTH_TOKEN` is set. `src/shell/api-client.mjs` injects the bearer header for same-origin `/api/*` requests.

Manual API calls should include:

```bash
curl -H "Authorization: Bearer $DASHBOARD_AUTH_TOKEN" \
  http://127.0.0.1:3876/api/tasks/all
```

## Server Behavior

`task-server.js` enforces token auth for `/api/*` routes except `/api/health` and `/api/auth/self`. Server-Sent Events at `/api/events` also accept `?token=` for EventSource compatibility.

When binding without a token, startup fails unless `REQUIRE_AUTH=false` is set. This keeps accidental network exposure from silently running unauthenticated.
