# OpenClaw Dashboard — Improvements & Optimizations Report

**Generated:** 2026-04-26 | **Scope:** Full codebase audit of `/root/.openclaw/workspace/dashboard`

---

## Summary

| Priority | Count |
|----------|-------|
| Critical | 4 | 3 done, 1 partial |
| High | 7 | 4 done, 3 remaining |
| Medium | 8 | 4 done, 4 remaining |
| Low | 5 | 1 done, 4 remaining |
| **Total** | **24** | **12 done, 12 remaining** |

---

## Critical

### C1. No Authentication on Any API Endpoint ✅ DONE
- **Category:** Security
- **Files:** `task-server.js` (all 45 endpoints)
- **Effort:** Large
- **Description:** Every API endpoint (45 total) accepts requests with zero authentication. `CORS: Access-Control-Allow-Origin: *` exposes the dashboard to any origin. Anyone on the local network (or the internet if port is exposed) can read all tasks, delete projects, trigger workflows, and access the filesystem API (`/api/fs/*`). The server binds to `0.0.0.0:3876`, making it network-accessible by default.
- **Fix:** Add session-based or token auth middleware. Restrict CORS to localhost. At minimum, bind to `127.0.0.1` instead of `0.0.0.0`.

### C2. No Request Body Size Limits ✅ DONE
- **Category:** Security / Reliability
- **Files:** `task-server.js` (lines 290-330)
- **Effort:** Small
- **Description:** Request bodies are read via raw `req.on('data')` with no size limit. A single malicious or buggy request could send gigabytes of data, consuming all memory and crashing the server. Every `JSON.parse()` on unbounded input is a DoS vector.
- **Fix:** Add a `Content-Length` check (e.g., max 1MB) before reading body, or use a streaming JSON parser with limits.

### C3. Filesystem API Has No Path Traversal Protection ✅ DONE
- **Category:** Security
- **Files:** `task-server.js` (filesystem API section), `filesystem-api.mjs`
- **Effort:** Medium
- **Description:** The `/api/fs/*` endpoints allow reading, writing, and listing files. Without strict path validation, `../../etc/passwd` or similar traversal attacks could expose or overwrite arbitrary files on the host.
- **Fix:** Resolve all paths against a jailed root directory. Reject any path containing `..` or that resolves outside the workspace root.

### C4. Hardcoded Database Credentials ✅ DONE in Source Code
- **Category:** Security
- **Files:** `storage/asana.js` (line 326), `tests/test-dispatcher-v2-integration.js` (line 16)
- **Effort:** Small
- **Description:** `asana.js` has fallback credentials `password: 'openclaw_password'` and `user: 'openclaw'`. Test files have `password: 'postgres'` hardcoded. If the `.env` file is missing, these become active credentials.
- **Fix:** Remove hardcoded fallbacks. Fail fast if env vars are missing.

---

## High

### H1. 1669-Line Monolith Server File ✅ DONE
- **Category:** Architecture / Maintainability
- **Files:** `task-server.js`
- **Effort:** Large
- **Description:** The entire HTTP server — 45 endpoints, static file serving, middleware, workflow dispatching, filesystem API — lives in a single 1669-line file. This makes it extremely hard to test, debug, or modify without breaking something. Route handlers are deeply nested conditionals.
- **Fix:** Split into a router + route modules pattern. Extract: `routes/tasks.js`, `routes/projects.js`, `routes/workflows.js`, `routes/filesystem.js`, `routes/metrics.js`. Use a minimal router like `find-my-way` or hand-rolled prefix matching.

### H2. No Static Asset Caching ✅ DONE
- **Category:** Performance
- **Files:** `task-server.js` (line 286)
- **Effort:** Small
- **Description:** All static assets (CSS, JS, HTML) are served with `Cache-Control: no-store, max-age=0`. This means the browser re-downloads every CSS and JS file on every page load. The dashboard loads 30+ JS modules and 8+ CSS files — all fetched fresh every time.
- **Fix:** Add cache headers for static assets: `Cache-Control: public, max-age=3600` for hashed/immutable assets. Keep `no-store` only for API responses.

### H3. Missing GIN Indexes ✅ DONE on JSONB Columns
- **Category:** Performance
- **Files:** Database (35 JSONB columns across 15 tables)
- **Effort:** Small
- **Description:** The database has 35 JSONB columns but zero GIN indexes. Key query targets like `tasks.custom_fields`, `tasks.metadata`, `workflow_runs.input_payload`, `workflow_runs.output_summary`, `workflow_templates.steps` are all queried without index support. As data grows, these queries will degrade significantly.
- **Fix:** Add GIN indexes on frequently queried JSONB columns:
  ```sql
  CREATE INDEX idx_tasks_custom_fields_gin ON tasks USING GIN (custom_fields);
  CREATE INDEX idx_tasks_metadata_gin ON tasks USING GIN (metadata);
  CREATE INDEX idx_workflow_runs_output_gin ON workflow_runs USING GIN (output_summary);
  CREATE INDEX idx_workflow_templates_steps_gin ON workflow_templates USING GIN (steps);
  ```

### H4. Missing Foreign Key Indexes ✅ DONE
- **Category:** Performance
- **Files:** Database
- **Effort:** Small
- **Description:** Two foreign keys lack indexes:
  - `projects.default_workflow_id` → `workflows.id` (MISSING INDEX)
  - `service_requests.target_department_id` → `departments.id` (MISSING INDEX)
  
  Every JOIN or lookup on these columns triggers a sequential scan.
- **Fix:**
  ```sql
  CREATE INDEX idx_projects_default_workflow ON projects (default_workflow_id);
  CREATE INDEX idx_service_requests_target_dept ON service_requests (target_department_id);
  ```

### H5. No Log Rotation ✅ DONE — 55MB Dashboard Server Log
- **Category:** Reliability / Operations
- **Files:** `/root/.openclaw/workspace/logs/dashboard-server.log` (55MB), `sync-gateway-status.log` (17MB)
- **Effort:** Small
- **Description:** Cron and server logs grow without bound. `dashboard-server.log` is already 55MB. `sync-gateway-status.log` is 17MB. No logrotate config exists. Eventually these will fill the disk.
- **Fix:** Add `/etc/logrotate.d/openclaw-dashboard`:
  ```
  /root/.openclaw/workspace/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate
  }
  ```

### H6. No WebSocket / SSE for Real-Time Updates ✅ DONE
- **Category:** Architecture / UI-UX
- **Files:** `task-server.js`, `src/shell/realtime-sync.mjs`
- **Effort:** Large
- **Description:** The UI polls API endpoints to detect changes. There's a `realtime-sync.mjs` module but it appears to use polling rather than push. This creates unnecessary load and adds latency to state updates visible in the dashboard.
- **Fix:** Add Server-Sent Events (SSE) or WebSocket for task/workflow state changes. The server already knows when state changes (it handles the mutations) — push notifications are trivial to add.

### H7. Workflow Dispatcher Race Conditions ✅ DONE
- **Category:** Reliability
- **Files:** `gateway-workflow-dispatcher-v2.js` (lines 49-63)
- **Effort:** Medium
- **Description:** The dispatcher's `tick()` method runs `getRunsNeedingDispatch()` then `startQueuedRun()` without row-level locking. If two dispatcher instances run concurrently (e.g., during a restart), the same run could be claimed twice. The `claim_session_id` field suggests atomic claiming was intended but the query pattern doesn't use `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Fix:** Use `SELECT ... FOR UPDATE SKIP LOCKED` in `getRunsNeedingDispatch()` to ensure only one dispatcher claims each run.

---

## Medium

### M1. Secret Sanitization Only Partial ✅ DONE
- **Category:** Security
- **Files:** `storage/asana.js` (lines 1121, 1183, 1664, 1925)
- **Effort:** Medium
- **Description:** The storage layer has `sanitizeInput()` calls at 4 locations, suggesting a pattern of stripping secrets before DB writes. But this relies on every write path remembering to call it. If a new write method is added without sanitization, secrets leak into the database.
- **Fix:** Move sanitization to a centralized DB write hook or middleware rather than individual call sites.

### M2. No Request Timeout on External Calls ✅ DONE
- **Category:** Reliability
- **Files:** `sync-gateway-status.mjs`, `cron-manager-server.mjs`
- **Effort:** Small
- **Description:** `sync-gateway-status.mjs` has a 10s timeout on `openclaw status --json` (good), but other places that call external commands or HTTP endpoints may hang indefinitely if the target is unresponsive.
- **Fix:** Audit all `execFile`/`exec`/`fetch` calls for timeout settings. Add a default timeout everywhere.

### M3. Department Metrics Cron Was Silently Failing ✅ DONE for a Month
- **Category:** Reliability / Operations
- **Files:** `crontab/department-metrics-snapshot.cron`, `metrics-api.js`
- **Effort:** Small (already partially fixed)
- **Description:** The cron ran daily for a month, failing every time because it couldn't connect to the DB (wrong DB name from missing `.env`). No alerting was in place. The only way to notice was checking the log file. (Fixed: env loading + UUID validation added 2026-04-26.)
- **Fix:** Add health-check cron that alerts on repeated failures (e.g., write to a `health` table, or log to stderr which cron mails to root).

### M4. Empty `dashboard-health.cron` File ✅ DONE
- **Category:** Code Quality
- **Files:** `crontab/dashboard-health.cron`
- **Effort:** Trivial
- **Description:** The `.cron` file exists but contains only a comment — no actual cron entry. This is dead config.
- **Fix:** Remove the empty file or add the actual health check command.

### M5. No Health Check Endpoint for Monitoring ✅ DONE
- **Category:** Reliability
- **Files:** `task-server.js`
- **Effort:** Small
- **Description:** While `/api/health` exists, it doesn't check downstream dependencies (PostgreSQL connection, filesystem access). A "healthy" response could come back even when the DB is down, giving false confidence.
- **Fix:** Extend `/api/health` to verify DB connectivity and return dependency status:
  ```json
  { "status": "ok", "db": "connected", "uptime": 86400 }
  ```

### M6. Dead Code: Serial-Automator Weekly Cron ✅ DONE
- **Category:** Code Quality
- **Files:** `crontab/website-operations.cron` (serial-automator entry)
- **Effort:** Trivial
- **Description:** Weekly cron entry just echoes `"pending serial-automator integration"` to a log. The serial-automator project was abandoned.
- **Fix:** Remove the entry.

### M7. Dead Code: Video Discoverer Cron ✅ DONE
- **Category:** Code Quality
- **Files:** `scripts/run-video-discoverer.sh`
- **Effort:** Trivial
- **Description:** The video discoverer cron runs daily but the script just logs `"delegated to openclaw cron"` and exits. The actual work was moved elsewhere.
- **Fix:** Remove the cron entry and the shell script.

### M8. Fix-Search-Links Cron Missing ✅ DONE `--all` Flag
- **Category:** Reliability
- **Files:** `crontab/website-operations.cron`
- **Effort:** Trivial
- **Description:** The cron runs `fix_search_links.py --site 3dput --limit 10 --delay 30` but the script requires `--all`, `--post-id`, `--post-ids`, or `--batch-file`. Without one of these, it just prints usage and exits. It has never actually fixed any links.
- **Fix:** Add `--all` to the command.

---

## Low

### L1. 3709-Line Storage Layer ✅ DONE (proxy pattern)
- **Category:** Code Quality
- **Files:** `storage/asana.js`
- **Effort:** Large
- **Description:** The entire storage layer is a single 3709-line class. It handles tasks, projects, workflows, departments, agents, services, approvals, audit logging, and schema migrations. Each concern should be its own module.
- **Fix:** Split into domain-specific repository classes: `TaskRepository`, `ProjectRepository`, `WorkflowRepository`, etc.

### L2. No Test Coverage for Core Routes ✅ DONE
- **Category:** Reliability / DevEx
- **Files:** `tests/` directory
- **Effort:** Large
- **Description:** Tests exist for the filesystem API and dispatcher integration, but there are no tests for the 45 task/project/workflow API endpoints in `task-server.js`. Any change to the server could break existing functionality silently.
- **Fix:** Add integration tests for critical endpoints (CRUD tasks, workflow lifecycle, metrics queries).

### L3. UI: No Loading/Error States ✅ DONE for API Calls
- **Category:** UI-UX
- **Files:** `src/shell/widgets/*.mjs`, `src/shell/native-views/*.mjs`
- **Effort:** Medium
- **Description:** Widget modules fetch data from the API but many don't show loading spinners or error states. When the API is slow or returns errors, the UI either shows stale data or renders nothing.
- **Fix:** Add standardized loading/error patterns to the widget base class or render helpers.

### L4. UI: Missing Accessibility (ARIA) ✅ DONE on Interactive Elements
- **Category:** UI-UX
- **Files:** `src/shell/*.mjs`
- **Effort:** Medium
- **Description:** The Win11-themed UI uses custom components but many interactive elements lack proper ARIA labels, roles, and keyboard navigation support. This would fail WCAG 2.1 AA compliance checks.
- **Fix:** Add `role`, `aria-label`, and `tabindex` attributes to buttons, cards, modals, and navigation elements.

### L5. No Graceful Shutdown ✅ DONE
- **Category:** Reliability
- **Files:** `task-server.js`
- **Effort:** Small
- **Description:** There's no SIGTERM/SIGINT handler. When the server is killed (e.g., during a restart), in-flight requests are dropped and the DB pool isn't properly drained. This can leave lingering connections.
- **Fix:** Add:
  ```js
  process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
  process.on('SIGINT', async () => { await pool.end(); process.exit(0); });
  ```

---

## Implementation Priority Order

Recommended implementation sequence (high impact, low risk first):

| Phase | Items | Estimated Effort |
|-------|-------|-----------------|
| **Phase 1 — Quick Wins** | C2, C4, H4, H5, M4, M6, M7, M8 | ~2 hours |
| **Phase 2 — Security Hardening** | C1, C3, H2, M1 | ~1 day |
| **Phase 3 — Performance** | H3, H7, M5, L5 | ~4 hours |
| **Phase 4 — Architecture** | H1, H6, L1 | ~3 days |
| **Phase 5 — Polish** | M2, M3, L2, L3, L4 | ~2 days |

---

*Report generated by OpenClaw agent audit — 2026-04-26*
