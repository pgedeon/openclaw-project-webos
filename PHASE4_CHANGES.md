# Phase 4 Changes — Architecture Refactor

**Date:** 2026-04-26
**Items:** H1 (monolith split), H6 (SSE real-time), L1 (storage modularization start)

## Files Created

### Router Infrastructure
- `routes/router.js` — Minimal prefix-matching router with `:param` support
- `routes/health-routes.js` — /api/health, /api/stats, /api/citation-queue/*
- `routes/task-routes.js` — /api/tasks/all, /api/tasks/:id, /api/tasks/:id/* (archive, restore, move, deps, subtasks, history, retry)
- `routes/project-routes.js` — /api/projects, /api/projects/:id, /api/projects/default
- `routes/view-routes.js` — /api/views, /api/views/:id, /api/views/board, /api/views/timeline, /api/views/agent
- `routes/cron-routes.js` — /api/cron/jobs, /api/cron/jobs/:id/runs, /api/cron/jobs/:id/run
- `routes/agent-routes.js` — /api/agents, /api/agents/status, /api/agent/claim, /api/agent/release

### SSE Real-time
- `routes/sse-routes.js` — GET /api/events (SSE endpoint with heartbeat + broadcast)
- Auth via `?token=` query param (EventSource API limitation)
- Frontend: `src/shell/realtime-sync.mjs` — connectSSE() function

### Storage Modularization (Proxy Pattern)
- `storage/task-repository.js` — Proxies to asana.js (ready for method extraction)
- `storage/project-repository.js` — Proxies to asana.js (ready for method extraction)

## Integration in task-server.js

- Router registered before inline handlers
- Route modules handle requests first, inline code is fallback
- Broadcast calls exposed via router context for SSE
- All existing functionality preserved — no behavioral changes

## Route Coverage

| Route Group | Routed | Fallback (inline) |
|------------|--------|-------------------|
| Health/Stats | ✅ | — |
| Tasks CRUD | ✅ | — |
| Projects CRUD | ✅ | — |
| Views | ✅ | — |
| Cron | ✅ | — |
| Agents | ✅ | — |
| SSE Events | ✅ | — |
| Legacy /api/tasks (markdown) | — | ✅ |
| Diagnostics | — | ✅ (separate module) |
| Workflow Runs | — | ✅ (separate module) |
| Metrics | — | ✅ (separate module) |
| Services | — | ✅ (separate module) |
| Filesystem | — | ✅ (separate module) |
