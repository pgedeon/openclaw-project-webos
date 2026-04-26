# Security Review: Phase 2 — Security Hardening

**Reviewer:** Automated Security Review  
**Date:** 2026-04-26  
**Scope:** C1 (Auth), C1 (CORS), C3 (Path Traversal), H2 (Static Caching), M1 (Secret Sanitization)

---

## 1. C1: Authentication Middleware — `task-server.js`

### Verdict: **PASS** (with caveats)

**Bearer token check on /api/* routes (except /api/health):** ✅  
Lines 565–572 implement the auth middleware correctly:
```js
if (DASHBOARD_AUTH_TOKEN && url.startsWith('/api/') && url !== '/api/health') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== DASHBOARD_AUTH_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Valid Bearer token required' }));
        return;
    }
}
```
- Only `/api/health` is exempted — correct.
- Returns 401 with JSON error for missing/invalid tokens — correct.
- The check is placed after CORS preflight handler and before the try block — correct placement.

**Token source — `DASHBOARD_AUTH_TOKEN` env var:** ✅  
Line 114: `const DASHBOARD_AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || null;`  
Defaults to `null` when not set (auth disabled) — reasonable design for local dev.

**Token injection into dashboard HTML:** ✅  
Lines 1674–1681: When `DASHBOARD_AUTH_TOKEN` is set, the root `/` handler reads `index.html`, injects `<script>globalThis.__DASHBOARD_AUTH_TOKEN__="...";</script>` before `</head>`.  
The HTML response is served with `no-store` cache headers — good.

**Frontend API client token injection:** ✅  
`src/shell/api-client.mjs` lines 226–229:
```js
const authToken = globalThis.__DASHBOARD_AUTH_TOKEN__;
if (authToken && url.startsWith('/api')) {
    requestInit.headers.set('Authorization', `Bearer ${authToken}`);
}
```
Correctly reads from the injected global and attaches as Bearer header.

**Caveat — Auth is optional by design:** When `DASHBOARD_AUTH_TOKEN` is not set, all endpoints are unauthenticated. This is intentional for local dev but should be documented as requiring the env var in production.

**Caveat — `/api/fs/*` double-check bypass:** The filesystem API section (line ~1573) has an inline `!url.includes('..')` guard, but the main auth middleware already protects it since it starts with `/api/`. No bypass here.

---

## 2. C1: CORS Restriction — `task-server.js`

### Verdict: **PARTIAL**

**`task-server.js` main CORS headers:** ✅  
All three locations in `task-server.js` use `http://localhost:{PORT}`:
- `sendJSON()` (line 253): `'Access-Control-Allow-Origin': 'http://localhost:' + PORT`
- `sendFile()` (line 288): `'Access-Control-Allow-Origin': 'http://localhost:' + PORT`
- OPTIONS handler (line 554): `'Access-Control-Allow-Origin': 'http://localhost:' + PORT`

No instances of `*` in `task-server.js` — confirmed via grep.

**Adjacent modules still using `*`:** ⚠️ FAIL  
The following modules used by the same server still set `Access-Control-Allow-Origin: *`:
1. **`diagnostics-api.js`** line 50 — `sendJSON()` uses `'*'`
2. **`gateway-workflow-dispatcher-v2.js`** line 431 — `sendJSON()` uses `'*'`

These modules are called from within `task-server.js` request handlers and their responses go directly to the client. This means the diagnostics and workflow dispatcher endpoints have permissive CORS despite the main server being locked down.

**Other standalone servers (lesser concern):**  
- `cron-manager-server.mjs`, `memory-api-server.mjs` — use `*`, but these are separate processes
- `filesystem-api-server.mjs` — uses its own `isAllowedCorsOrigin()` which correctly validates loopback origins

**Recommendation:** Update `diagnostics-api.js` and `gateway-workflow-dispatcher-v2.js` to accept CORS origin as a parameter or use the same `http://localhost:{PORT}` pattern.

---

## 3. C3: Path Traversal Protection — `task-server.js` sendFile()

### Verdict: **PASS**

The `sendFile()` function (lines ~258–305) implements all four required protections:

1. **`..` rejected before path joining:** ✅  
   ```js
   if (filePath.includes('..') || filePath.includes('\x00')) {
       res.writeHead(403);
       res.end('Forbidden');
       return;
   }
   ```

2. **Null bytes rejected:** ✅  
   Same check: `filePath.includes('\x00')`

3. **`path.resolve()` used instead of `path.join()`:** ✅  
   ```js
   const fullPath = path.resolve(WORKSPACE, filePath);
   ```

4. **Resolved path checked against WORKSPACE prefix:** ✅  
   ```js
   if (!fullPath.startsWith(WORKSPACE + path.sep) && fullPath !== WORKSPACE) {
       res.writeHead(403);
       res.end('Forbidden');
       return;
   }
   ```

This is a solid implementation. The combination of pre-check (reject `..`) and post-check (verify resolved path is within workspace) provides defense-in-depth.

**Minor note:** The filesystem API section (line ~1573) has a separate `!url.includes('..')` guard but delegates to `filesystem-api-server.mjs` which has its own path validation. The main `sendFile()` path traversal protection is thorough.

---

## 4. H2: Static Asset Caching — `task-server.js` sendFile()

### Verdict: **PASS**

The cache headers in `sendFile()` (lines ~280–298) are correctly differentiated by file type:

| Asset Type | Cache Header | Expected | Status |
|---|---|---|---|
| CSS | `public, max-age=3600` | `public, max-age=3600` | ✅ |
| Images (.png, .jpg, .jpeg, .gif, .svg, .ico, .webp) | `public, max-age=86400` | `public, max-age=86400` | ✅ |
| Fonts (.woff, .woff2, .ttf, .eot) | `public, max-age=604800` | `public, max-age=604800` | ✅ |
| HTML/JS (.html, .js, .mjs) | `no-store, max-age=0` | `no-store, max-age=0` | ✅ |

HTML/JS additionally gets `Clear-Site-Data: "cache"` to bust service worker caches — good defensive measure.

The root `/` handler when auth is enabled also correctly uses `Cache-Control: no-store` for the HTML response.

---

## 5. M1: Secret Sanitization — `lib/qmd-security.js`

### Verdict: **PASS**

**Module is a real implementation, not a stub:** ✅  
`qmd-security.js` is a full 120-line module with 10 regex patterns for secret detection.

**Regex patterns are reasonable:** ✅  
Covers: AWS access keys, AWS secret keys, GitHub tokens (ghp_/ghs_), Slack tokens, private keys, JWTs, generic passwords, Bearer tokens, connection strings, WordPress app passwords.  
Patterns are well-formed with appropriate global/insensitive flags.

**Logs warnings when secrets found:** ✅  
```js
if (findings.length > 0) {
    console.warn(`[SECURITY] ${context}: ${findings.length} secret(s) redacted`, findings);
}
```
Logs count, context, and finding details (type, path, 20-char preview).

**`sanitizeData()` in `storage/asana.js` delegates to this module:** ✅  
Line 8: `const security = require('../lib/qmd-security');`  
Lines 342–344: 
```js
sanitizeData(data, context) {
    return security.safeWrite(data, context);
}
```

**Sanitization is called at all write points:** ✅  
Found 9 call sites across the storage layer:
- `service_request.create`, `service_request.update`, `service_request.route`
- `project.create`, `project.update`
- `task.create`, `task.update`
- `saved_view.create`, `saved_view.update`

**Allowlist for safe fields:** ✅  
`ALLOWED_FIELDS` set contains `password_hash`, `hashed_password`, `auth_provider` — prevents false positives on known-safe fields.

**Minor concern:** The `safeRead()` method is a no-op (`return true`). This is documented as intentional ("secrets are redacted on write") — acceptable design choice, but if secrets somehow bypass the write path, they'd be readable.

---

## 6. Security Concerns

### 6a. Auth token exposed in log files?  
**Risk: LOW** ✅  
Grep confirmed no auth/token/Bearer values are logged by `task-server.js`. The request logger (line ~547) only logs `${method} ${url}`, not headers. The token value is never logged.

### 6b. Can the token be leaked through the API?  
**Risk: MEDIUM** ⚠️  
The token is embedded in the HTML page served at `/` via inline `<script>`. This means:
- Anyone who can access the dashboard HTML can extract the token
- The token appears in browser DevTools → Sources
- Browser extensions can read `globalThis.__DASHBOARD_AUTH_TOKEN__`
- No `HttpOnly` or `Content-Security-Policy` protection

This is an inherent trade-off of the client-side token approach. For a localhost-only dashboard, this is acceptable. For network-exposed deployments, consider cookie-based auth or short-lived tokens.

### 6c. Endpoints that bypass auth?  
**Risk: LOW** ✅  
- `/api/health` is intentionally exempt (monitoring endpoint)
- Static file serving (`/` and all non-`/api/*` paths) bypass auth — this is correct since static assets are the UI shell
- The filesystem API (`/api/fs/*`) is protected by the auth middleware
- All `/api/*` routes are covered

### 6d. Timing attack risk in token comparison?  
**Risk: MEDIUM** ⚠️  
The comparison uses JavaScript strict equality (`token !== DASHBOARD_AUTH_TOKEN`). This is **not constant-time** and is theoretically vulnerable to timing attacks:

```js
if (token !== DASHBOARD_AUTH_TOKEN) {  // string comparison, not constant-time
```

An attacker could measure response times to progressively guess the token byte-by-byte. However, this is mitigated by:
1. **Network jitter** on localhost connections makes timing measurements unreliable
2. **The server binds to 127.0.0.1 only** — remote timing attacks are not possible
3. **Node.js string comparison is optimized** and may not leak timing in practice

**Recommendation:** For defense-in-depth, use `crypto.timingSafeEqual`:
```js
const crypto = require('crypto');
const tokenBuf = Buffer.from(token || '', 'utf8');
const expectedBuf = Buffer.from(DASHBOARD_AUTH_TOKEN, 'utf8');
if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    // reject
}
```

---

## Summary

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | C1: Auth Middleware | **PASS** | Correct implementation, optional-by-design |
| 2 | C1: CORS Restriction | **PARTIAL** | `task-server.js` fixed; `diagnostics-api.js` and `gateway-workflow-dispatcher-v2.js` still use `*` |
| 3 | C3: Path Traversal Protection | **PASS** | Four-layer defense: `..` check, null byte check, `path.resolve()`, prefix verification |
| 4 | H2: Static Asset Caching | **PASS** | Correct per-type headers for CSS, images, fonts, HTML/JS |
| 5 | M1: Secret Sanitization | **PASS** | Real module, good patterns, 9 call sites in asana.js, logs warnings |
| 6a | Token in logs | **PASS** | No token logging found |
| 6b | Token leak via API | **LOW RISK** | Inherent to client-side token approach; acceptable for localhost |
| 6c | Auth bypass endpoints | **PASS** | Only `/api/health` and static files exempt |
| 6d | Timing attack | **MEDIUM RISK** | Uses `!==` instead of `crypto.timingSafeEqual`; mitigated by localhost-only binding |

---

## Action Items

1. **Fix CORS in adjacent modules** — Update `diagnostics-api.js:50` and `gateway-workflow-dispatcher-v2.js:431` to use `http://localhost:{PORT}` instead of `*`
2. **Consider constant-time token comparison** — Replace `!==` with `crypto.timingSafeEqual` for defense-in-depth (low priority given localhost binding)
3. **Document auth requirement** — Add note that `DASHBOARD_AUTH_TOKEN` must be set in production environments

---

*Review completed 2026-04-26*
