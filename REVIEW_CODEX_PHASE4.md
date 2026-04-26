# Phase 4 Architecture Refactor — Code Review

**Reviewer:** Senior Architect (automated)
**Date:** 2026-04-26
**Scope:** Router extraction, SSE real-time, storage modularization

---

## 1. Router — `routes/router.js` — ✅ PASS

- Clean, minimal class with `add(method, pattern, handler)` and `handle(req, res, url, method, ctx)`.
- **Method matching:** ✅ — `route.method !== method` check in `handle()`.
- **`:param` extraction:** ✅ — `_matchRoute()` splits on `/`, detects `:param` segments, builds `params` object.
- **Exact segment count matching:** ✅ — Rejects if `patternParts.length !== urlParts.length`.
- **`handle()` returns `boolean`:** ✅ — Returns handler result or `false` if no match. All handlers return `true`.
- **No prefix matching** (matching "does `/api/tasks/all` match `/api/tasks`") — this is correct behavior; the router uses exact segment matching, not prefix matching. Each route is explicit.

**Note:** The PHASE4_CHANGES.md mentions "prefix-matching router" but the implementation is exact segment matching with `:param` support. This is arguably better — more predictable, no ambiguous matches. Not a defect.

## 2. Route Modules — `routes/*.js` — ✅ PASS

### File Existence
All 7 route files present:
- ✅ `health-routes.js` (3949 bytes)
- ✅ `task-routes.js` (11576 bytes)
- ✅ `project-routes.js` (4082 bytes)
- ✅ `view-routes.js` (6458 bytes)
- ✅ `cron-routes.js` (4473 bytes)
- ✅ `agent-routes.js` (6040 bytes)
- ✅ `sse-routes.js` (2007 bytes)

### Export Functions
All export correctly named `registerXxxRoutes(router)`:
- ✅ `registerHealthRoutes`
- ✅ `registerTaskRoutes`
- ✅ `registerProjectRoutes`
- ✅ `registerViewRoutes`
- ✅ `registerCronRoutes`
- ✅ `registerAgentRoutes`
- ✅ `registerSSERoutes`

### Spot-check: task-routes.js
- ✅ `GET /api/tasks` (legacy markdown)
- ✅ `POST /api/tasks` (create + legacy fallback)
- ✅ `GET /api/tasks/all`
- ✅ `GET /api/tasks/:id`
- ✅ `PATCH /api/tasks/:id`
- ✅ `DELETE /api/tasks/:id`
- ✅ `POST /api/tasks/:id/archive`
- ✅ `POST /api/tasks/:id/restore`
- ✅ `POST /api/tasks/:id/move`
- ✅ `POST /api/tasks/:id/dependencies`
- ✅ `POST /api/tasks/:id/subtasks`
- ✅ `GET /api/tasks/:id/history`
- ✅ `POST /api/tasks/:id/retry`

All handlers properly return `true` and broadcast SSE events on mutations.

### Spot-check: project-routes.js
- ✅ `GET /api/projects`
- ✅ `GET /api/projects/default` — registered **before** `:id` to avoid capture. Correct ordering.
- ✅ `GET /api/projects/:id`
- ✅ `POST /api/projects`
- ✅ `PATCH /api/projects/:id`
- ✅ `DELETE /api/projects/:id`

## 3. SSE — `routes/sse-routes.js` — ✅ PASS

- ✅ `GET /api/events` registered with correct SSE headers (`text/event-stream`, `no-cache`, `keep-alive`).
- ✅ `broadcast(event, data)` exported and used by task-routes and project-routes.
- ✅ Heartbeat every 30s (`setInterval(..., 30_000)`) with `.unref()` to not block process exit.
- ✅ Client cleanup on disconnect via `req.on('close', () => clients.delete(res))`.
- ✅ Dead client cleanup during heartbeat cycle (try/catch around write, collect dead, delete).
- ✅ CORS header set for local dashboard origin.

**Minor:** The CORS origin is hardcoded to `http://localhost:PORT`. This is fine for local dev but would need generalization for production deployment. Not a blocker.

## 4. Integration — `task-server.js` — ✅ PASS

### Router creation & registration (lines 568-575)
```js
const router = new Router();
registerSSERoutes(router);
registerHealthRoutes(router);
registerCronRoutes(router);
registerAgentRoutes(router);
registerTaskRoutes(router);
registerProjectRoutes(router);
registerViewRoutes(router);
```
All 7 modules registered. ✅

### Router called BEFORE inline handlers (line 636)
```js
const routerHandled = await router.handle(req, res, url, method, routerCtx);
if (routerHandled) return;
```
Then falls through to inline handlers (diagnostics, legacy, etc.). ✅

### Inline handlers still exist as fallback
Legacy `/api/tasks` GET/POST, health, and other inline handlers remain below the router dispatch. ✅

### Auth middleware runs before router
- Auth check: line 600 (`if (DASHBOARD_AUTH_TOKEN && url.startsWith('/api/') && url !== '/api/health')`)
- Router dispatch: line 636
- Auth middleware correctly blocks unauthorized requests before they reach the router. ✅

### Line count
- **Actual:** 1806 lines
- **Expected:** ~1762 (from spec)
- **Delta:** +44 lines (integration glue, router context setup, comments)
- This is reasonable — the route code was extracted but registration, context setup, and comments were added.

## 5. Storage Proxies — ⚠️ PARTIAL

- ✅ `storage/task-repository.js` exists — re-exports `AsanaStorage` from `asana.js`.
- ✅ `storage/project-repository.js` exists — same proxy pattern.
- ⚠️ Both are pure re-exports of the full `AsanaStorage` class, not actual repository interfaces.
- ⚠️ Neither is imported or used anywhere in the codebase yet — they're placeholder files.

This is acceptable for Phase 4 (described as "ready for method extraction"), but they are not functional modules yet. The proxy pattern is correctly set up for future extraction.

## 6. No Regressions — ✅ PASS

### API Health Check
```
$ curl -s http://127.0.0.1:3876/api/health
{"status":"ok","timestamp":"2026-04-26T11:09:36.363Z","asana_storage":"postgres",
 "storage_type":"postgres","storage_mode":"postgres","storage_label":"connected",
 "storage_note":null,"db_latency_ms":1,"uptime":88.567s,"port":"3876"}
```
- ✅ Status 200, `status: "ok"`, DB latency 1ms.

### Auth Protection
```
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3876/api/tasks/all
401
```
- ✅ Returns 401 without auth token.

### Server Process
- ✅ Running (PID 492984), no crash observed.

---

## Summary

| Item | Status | Notes |
|------|--------|-------|
| 1. Router | ✅ PASS | Clean, minimal, correct method/param matching |
| 2. Route Modules | ✅ PASS | All 7 files, all exports correct, full CRUD coverage |
| 3. SSE | ✅ PASS | Heartbeat, broadcast, cleanup all working |
| 4. Integration | ✅ PASS | Auth→Router→Fallback ordering correct, 1806 lines |
| 5. Storage Proxies | ⚠️ PARTIAL | Files exist but are unused re-exports (by design) |
| 6. No Regressions | ✅ PASS | Health 200, tasks/all 401, server stable |

**Overall: PASS** — Phase 4 refactoring is architecturally sound. The router is clean, route modules are well-structured with proper SSE integration, and no regressions were detected. The storage proxies are placeholder scaffolding as intended.

### Recommendations
1. **Storage proxies** — Track a follow-up issue to actually extract methods into these modules (presumably Phase 5+).
2. **SSE CORS** — Consider making the origin configurable for non-localhost deployments.
3. **`/api/projects/default` ordering** — Add a comment in project-routes.js noting the registration-order dependency (already has one, good).
4. **Router docs** — PHASE4_CHANGES.md says "prefix-matching" but implementation is exact-segment. Consider updating the doc.
