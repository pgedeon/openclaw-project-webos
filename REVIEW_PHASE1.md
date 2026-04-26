# Phase 1 Review — Dashboard Improvements

**Reviewer:** Subagent (dashboard-review)  
**Date:** 2026-04-26  
**Scope:** Phase 1 quick wins: C2, C4, H3, H4, H5, L5, M4, M6/M7, C1(partial)

---

## Results Summary

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | C2 — Body size limit | ✅ **PASS** | `parseJSONBody(req, maxBytes = 1048576)` with `req.destroy()` on overflow |
| 2 | C4 — Hardcoded credentials | ⚠️ **PARTIAL PASS** | `openclaw_dashboard` / `openclaw_password` removed; see caveats below |
| 3 | H4 — FK indexes | ✅ **PASS** | Both `idx_projects_default_workflow` and `idx_service_requests_target_dept` exist |
| 4 | H3 — GIN indexes | ✅ **PASS** | All 4 GIN indexes created on the correct columns |
| 5 | H5 — Log rotation | ✅ **PASS** | `/etc/logrotate.d/openclaw-dashboard` configured with daily, compress, maxsize 50M |
| 6 | M4 — Empty cron removed | ✅ **PASS** | `dashboard-health.cron` does not exist |
| 7 | M6/M7 — Dead cron entries | ✅ **PASS** | video-discoverer, serial-automator, sailboats.fr-jobs all removed |
| 8 | L5 — Graceful shutdown | ✅ **PASS** | SIGTERM/SIGINT handlers with `pool.end()` and 10s force timeout |
| 9 | C1(partial) — Bind to localhost | ✅ **PASS** | `server.listen(PORT, '127.0.0.1', ...)` |

---

## Detailed Findings

### 1. C2 — Request Body Size Limit ✅ PASS

`parseJSONBody()` at line 294 of `task-server.js`:
- Default `maxBytes = 1048576` (1 MB) ✅
- Accumulates byte count and checks against limit ✅
- Calls `req.destroy()` when exceeded ✅
- Returns proper error via promise rejection ✅

### 2. C4 — Hardcoded Credentials ⚠️ PARTIAL PASS

**Good news:** The specific strings `openclaw_dashboard` and `openclaw_password` are **gone** from all audited files. The fallbacks are now `'mission_control'` (DB name) and `'postgres'` (user/password).

**Remaining concern in `workflow-runs-api.js` line 3874:**
```js
const pool = new Pool({ host: 'localhost', port: 5432, database: 'mission_control',
  user: process.env.POSTGRES_USER || 'openclaw', password: process.env.POSTGRES_PASSWORD || '' });
```
This inline pool creation uses `'openclaw'` as the user fallback (not `'postgres'` like the rest) and `''` as the password fallback. While the specific `openclaw_dashboard`/`openclaw_password` strings are removed, this is inconsistent with the other connection patterns and represents an ad-hoc pool that bypasses the shared connection config. If the env var is unset, this will fail differently from the main pool. **Recommend: align fallbacks with the rest or remove inline pool creation entirely.**

### 3. H4 — Foreign Key Indexes ✅ PASS

```
 idx_projects_default_workflow  | index | projects
 idx_service_requests_target_dept | index | service_requests
```
Both indexes exist on the correct tables and columns.

### 4. H3 — GIN Indexes ✅ PASS

All 4 GIN indexes confirmed:
```
 idx_tasks_custom_fields_gin      | tasks
 idx_tasks_metadata_gin           | tasks
 idx_workflow_runs_output_gin     | workflow_runs
 idx_workflow_templates_steps_gin | workflow_templates
```

### 5. H5 — Log Rotation ✅ PASS

`/etc/logrotate.d/openclaw-dashboard`:
- `daily` rotation ✅
- `compress` + `delaycompress` ✅
- `maxsize 50M` ✅
- `rotate 7` ✅
- `missingok`, `notifempty`, `copytruncate` ✅

### 6. M4 — Empty dashboard-health.cron ✅ PASS

File `/root/.openclaw/workspace/crontab/dashboard-health.cron` does **not** exist. Cleanly removed.

### 7. M6/M7 — Dead Cron Entries ✅ PASS

`website-operations.cron` now contains only the 3dput health check entry. The following dead entries are confirmed removed:
- video-discoverer ✅ removed
- serial-automator ✅ removed  
- sailboats.fr-jobs ✅ removed

Header comment acknowledges the cleanup: *"Updated: 2026-04-26 — removed dead entries (video-discoverer, sailboats.fr-jobs, serial-automator)"*

### 8. L5 — Graceful Shutdown ✅ PASS

End of `task-server.js`:
- `gracefulShutdown(signal)` function defined ✅
- Calls `server.close()` then `asanaStorage.pool.end()` ✅
- Force exit after `10000`ms (10s) timeout ✅
- Both `SIGTERM` and `SIGINT` handlers registered ✅

### 9. C1(partial) — Bind to 127.0.0.1 ✅ PASS

Line 1658: `server.listen(PORT, '127.0.0.1', async () => { ... })`

Minor nitpick: the startup log message still says `http://0.0.0.0:${PORT}` which is misleading (it's actually listening on 127.0.0.1). Not a functional issue, but confusing for anyone reading logs.

---

## Additional Issues Flagged

1. **`workflow-runs-api.js` line 3874 — Inline pool with inconsistent fallbacks:** Creates a throwaway `Pool` with `user: 'openclaw'` fallback instead of `'postgres'`, and empty password fallback. This is both a credential inconsistency and an architectural smell (ad-hoc DB connection in a route handler instead of using the shared storage pool).

2. **Log message mismatch:** Server logs `http://0.0.0.0:${PORT}` but actually binds to `127.0.0.1`. Should be updated to match reality.

3. **M8 not verified:** The `--all` flag fix for `fix_search_links.py` cron entry was not in the review scope but is listed as a Phase 1 item. Worth checking separately.

---

## Verdict

**8 of 9 items fully PASS. 1 item PARTIAL PASS (C4) with one minor remnant.**

The Phase 1 implementation is solid. The only actionable item is the inline pool in `workflow-runs-api.js:3874` with inconsistent fallback credentials, which should be cleaned up for consistency.
