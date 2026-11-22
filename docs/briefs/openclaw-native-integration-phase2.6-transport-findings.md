---
layout: default
---

# Phase 2.6 — Full desktop shell in the gateway tab: Step 0 transport findings

**Task key:** `webos:openclaw-native-integration:phase2.6:full-desktop-shell-tab:v1`
**Card:** `cef78f32-40c7-4493-837f-c600bf63dddb`
**Date:** 2026-11-22
**Verdict:** **BRANCH B — STOP.** The full desktop shell cannot boot in the
Control UI tab without a gateway/config or task-server transport change. No
shell code was written. The unblocking change belongs in a separate
owner-approval card.

Environment: dev host, OpenClaw **2026.11.3**
(`/usr/local/node-v24.22.1-linux-x64/lib/node_modules/openclaw`), gateway
HTTPS `127.0.0.1:18789` (`basePath=/openclaw`), staging task-server plain
HTTP `127.0.0.1:8120`, repo `/root/.openclaw/workspace/webos-canonical`
(HEAD `5198809`, equal to `origin/main`).

All evidence below is first-hand output from this host. No production writes,
no gateway config edits, no task-server writes.

---

## Step 0 evidence

### E1 — CORS preflight from the Control UI origin fails

```bash
curl -sS -i -X OPTIONS http://127.0.0.1:8120/api/cards \
  -H 'Origin: https://home.3dput.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

Response (2026-11-22T06:23Z):

```http
HTTP/1.1 204 No Content
X-Robots-Tag: noindex, nofollow
Access-Control-Allow-Origin: http://localhost:8120
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

The header is hardcoded to `http://localhost:8120` for **every** request
origin — the same value is returned for both
`Origin: https://home.3dput.com` and `Origin: http://localhost:8120`. There is
no `Vary: Origin` and no credentialed-origin allowance. Per the Fetch
standard, a browser at `https://home.3dput.com` (or any other Control UI
origin) therefore blocks the cross-origin API response. Source:
`task-server.js:302`, `:337`, `:744`.

A normal cross-origin GET is also unauthenticated:

```http
GET /api/settings  Origin: https://home.3dput.com
HTTP/1.1 401 Unauthorized
{"error":"Unauthorized","message":"Valid Bearer token required"}
```

### E2 — `DASHBOARD_AUTH_TOKEN` cannot be obtained without a second login

The task-server never embeds the token in any page (security fix F1):

```html
<!-- index.html -->
<!-- The server never embeds DASHBOARD_AUTH_TOKEN in the page. The shell
     only boots after a token is verified against /api/auth/self ... -->
const TOKEN_STORAGE_KEY = 'openclaw.dashboardToken';
```

Boot path: `readStoredToken()` → `checkAuth()` → if not OK, a fullscreen
`#auth-bootstrap-token` password prompt → `storeToken()` in `localStorage` →
`import('/src/shell/shell-main.mjs')`. There is no gateway-token exchange, no
single-sign-on handoff, and no `/api/auth/*` route that mints a token from a
gateway device/operator session.

`/api/auth/self` (public) returns:

```json
{"authenticated":false,"mode":"token","actor":null,"role":null,"user":null,
 "tokenRequired":true,"supportedSchemes":["bearer-token"],
 "publicRoutes":["/api/health","/api/auth/self"],
 "capabilities":{"bearerToken":true,"singleOperator":true,"sessions":false,
 "rbac":false,"multiOperator":false}}
```

The gateway process does not have the token either:

```bash
tr '\0' '\n' < /proc/639266/environ | grep -c '^DASHBOARD_AUTH_TOKEN='
# 0
```

The value exists only in the MCP-server block of `~/.openclaw/openclaw.json`
(consumed by a different process), not in the gateway service environment or
the `openclaw-webos` plugin config. Using it inside a tab proxy would require
new gateway/plugin configuration holding a secret — an owner-gated change.

### E3 — Scheme mismatch: gateway is HTTPS, task-server is plain HTTP

```bash
curl -k -o /dev/null -w '%{http_code}\n' https://127.0.0.1:18789/openclaw/
# 200
curl    -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/openclaw/
# curl: (52) Empty reply from server
curl -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8120/
# curl: (35) TLS connect error: ... wrong version number
```

Gateway: TLS-only on `18789`, external origin `https://home.3dput.com`,
`controlUi.basePath=/openclaw`. Task-server: `http.createServer` only
(`task-server.js:730`), listener `0.0.0.0:8120`, no TLS listener. An iframe or
subresource from the HTTPS Control UI to `http://192.168.0.81:8120` is mixed
active content and is blocked by the browser before CORS is even evaluated.
`:8120` also sends no `X-Frame-Options`/CSP `frame-ancestors`, so framing is
not the blocker — the scheme and CORS are.

### E4 — The available tab mount cannot serve the shell document or assets

Installed asset-route admission regex (2026.11.3,
`dist/control-ui-assets-DErxGcit.mjs:25`):

```js
/^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:m?js|css)$/u
```

Only `.js`/`.mjs`/`.css` files from the plugin's `dist/` are served. There is
no `.html` (or image/font) route; the tab page is a `ControlUiView` DOM mount,
not a URL. The shell entry is an HTML document that loads
`/src/shell/shell-main.mjs` (absolute path) and all API calls use the
relative base `/api` (`src/shell/api-client.mjs`, `createAPIClient('/api')`).
Copying modules into the plugin bundle therefore still sends `/api/*` and
`/src/*` to the gateway origin, which has no dashboard proxy. The plugin asset
route cannot rewrite or proxy those paths.

A plugin **can** register an HTTP route at runtime
(`api.registerHttpRoute` / `registerPluginHttpRoute`, installed
`dist/config-contracts-CY87ANNp.d.ts:51535`,
`dist/http-registry-Cu9yxX1P.mjs:140`) with no new gateway config key. That is
the only potential Branch A seam, but it does not remove the blockers above:
the route would still need the task-server bearer token server-side (not in
the gateway process), and it would need to proxy or rewrite the shell's
absolute `/src/*` and `/api/*` paths — both are change-bearing decisions, not
a transparent mount.

### E5 — Current tab is healthy; it mounts the Workboard view only

`https://127.0.0.1:18789/openclaw/desktop` → 200. The installed tab loads
`openclaw-webos` and renders `webos-desktop-view.js` via `host.request`
(Workboard read/write RPCs). It does **not** load the desktop shell or its
`/api` data plane. That remains the Phase 2 gap this card targeted.

---

## Branch decision

**Branch B.** Booting the full shell in the tab requires all three of:

1. a same-origin transport for the shell document and its `/src/*` modules,
   or a TLS endpoint for `:8120` plus an exact allowed origin;
2. an `/api/*` path that reaches the task-server from the gateway origin
   (same-origin proxy or CORS-enabled HTTPS backend);
3. a bearer token obtained without a second login (gateway→task-server token
   exchange, or server-side injection by the proxy).

None of the three exists today, and each fix changes either the gateway
plugin/config (secret injection, proxy route) or the task-server security
model (CORS allowlist, TLS, token exchange). The brief and this card reserve
those changes for an owner-approval gate.

**Delivered here:** this findings document, a brief status update, a roadmap
status update, a CHANGELOG entry, and an `openclaw-webos/README.md` transport
note. No shell code, no plugin bundle change, no gateway config change, no
task-server change, no production writes.

## What an owner-approved follow-up card must decide

- **T1 — Transport:** same-origin plugin HTTP proxy under the gateway
  (`/openclaw/__webos__/*` → `:8120`) vs TLS + CORS on the task-server for
  the exact Control UI origins. The proxy avoids mixed content and CORS but
  needs path rewriting for `/src/*` and `/api/*`.
- **T2 — Token:** accept the gateway operator identity on the task-server
  (new auth mode) vs inject `DASHBOARD_AUTH_TOKEN` server-side in the proxy
  (secret in gateway/plugin config). Either is a security-model change.
- **T3 — Shell entry:** keep `index.html` + absolute `/src` paths behind the
  proxy, or refactor the shell entry to relative/base-aware URLs (repo change,
  no build step) so it can be served from a subpath.
- **T4 — Fallback:** keep the current Workboard-only tab and the `:8120` link
  until T1–T3 are approved; the tab's `desktop-unavailable`/deep-link path is
  already honest.

## Acceptance checks for the follow-up (Branch A)

1. `curl -i` preflight from `https://home.3dput.com` returns
   `Access-Control-Allow-Origin: https://home.3dput.com` **or** the request is
   same-origin through the gateway proxy (no CORS needed).
2. Loading `/openclaw/desktop` boots the full shell with **zero** token
   prompts; `/api/health` and one authenticated `/api/*` call return 200 from
   the tab context.
3. No `http://` subresource is requested from the HTTPS page (DevTools
   console clean); no second login.
4. Served asset md5 equals the dev checkout after an honest staging restart.
5. `node scripts/ci-db-free-tests.js` and `node scripts/docs-drift-check.js`
   green; single registry preserved (no local task writes, no parallel queue).
