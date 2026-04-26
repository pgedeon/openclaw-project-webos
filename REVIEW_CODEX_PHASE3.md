# Phase 3 (Performance) — Code Review

**Reviewer:** Senior Backend Reviewer (subagent)  
**Date:** 2026-04-26  
**Scope:** H7, M5, M8, plus regression smoke-test

---

## 1. H7: Workflow Dispatcher Race Conditions — `gateway-workflow-dispatcher-v2.js`

### Verdict: ✅ PASS

**`FOR UPDATE SKIP LOCKED`**  
The `SQL.dispatchCandidates` CTE query (line ~13) now ends with:
```sql
FOR UPDATE SKIP LOCKED
```
This is applied after the `LIMIT $1` clause. When two dispatcher instances call `dispatchCandidates` concurrently, PostgreSQL will:
1. Lock the selected rows.
2. Skip any rows already locked by the other instance (`SKIP LOCKED`).
3. Each instance gets a disjoint set of rows — no double-dispatch.

This is the correct pattern for work-queue polling in PostgreSQL.

**`markDispatched` second guard**  
The `SQL.markDispatched` UPDATE (line ~52) still contains:
```sql
WHERE id = $1
  AND status = 'queued'
```
Even if two instances somehow selected the same row (which they can't with `SKIP LOCKED`), only the first UPDATE would succeed because the second would see `status != 'queued'` after the first UPDATE commits. The `RETURNING *` clause is checked in `dispatchQueuedRuns()` — if `dispatchResult.rows[0]` is empty, the candidate is silently skipped. Correct defensive pattern.

**Additional notes:**
- The `dispatchQueuedRuns()` method runs SELECT + individual UPDATEs in a loop within an implicit transaction per statement (pg autocommit). Since each `pool.query()` is its own transaction, the `FOR UPDATE SKIP LOCKED` lock is held only for the duration of the SELECT, but that's fine because the immediately-following `markDispatched` UPDATE with `AND status = 'queued'` provides the atomicity guarantee. Two dispatchers cannot claim the same run.
- The `batchSize` default is 10, which is reasonable.

---

## 2. M5: Health Check with DB Verification — `task-server.js`

### Verdict: ✅ PASS

**`getAsanaStorageHealth()` function** (line 147):

- ✅ Performs a real `SELECT 1 AS health_check` query against the DB pool.
- ✅ Measures latency with `Date.now()` before/after the query → `dbLatencyMs`.
- ✅ Returns structured object with: `mode`, `ready`, `databaseHealthy`, `dbLatencyMs`, `label`, `note`.

**`/api/health` endpoint** (line 648):

- ✅ Response includes `status` field:
  - `'ok'` when `ready=true && databaseHealthy=true`
  - `'degraded'` when `ready=true && databaseHealthy=false` (e.g. json_snapshot mode)
  - `'error'` when `ready=false`
- ✅ Response includes `db_latency_ms` (null when not in postgres mode, integer ms otherwise).
- ✅ Response includes `uptime` via `process.uptime()`.
- ✅ Response includes `storage_label` (`'connected'`, `'unreachable'`, `'snapshot'`, or `'disconnected'`).
- ✅ Returns `'degraded'` or `'error'` when DB is unreachable.

**Live verification:**
```json
{"status":"ok","db_latency_ms":1,"uptime":62.31,"storage_label":"connected"}
```
DB latency is 1ms — healthy.

---

## 3. M8: Fix-Search-Links Cron

### Verdict: ✅ PASS

Active crontab checked via `crontab -l`. There is **no** entry containing `fix.search.link` or referencing `fix_search_links.py`. The fix-search-links cron entry was removed during the dead cron cleanup (alongside video-discoverer, sailboats.fr-jobs, and serial-automator entries as noted in the crontab header comment).

---

## 4. Overall — No Regressions

### Server Start: ✅ PASS

Last log entry shows clean startup:
```
✅ Connected to PostgreSQL database
✅ Asana PostgreSQL storage initialized
✅ Workflow runs API handler initialized
[DispatcherV2] Starting gateway workflow dispatcher v2...
✅ Workflow dispatcher v2 started (DB-first, atomic claiming)
```

No errors, no warnings, all subsystems initialized.

### Health Endpoint: ✅ PASS

`GET /api/health` returns `200` with `status: "ok"`, `db_latency_ms: 1`, confirming the server is running and DB is reachable.

### Auth Middleware: ✅ PASS

`GET /api/tasks` without a Bearer token returns `HTTP 401`. Auth middleware is working correctly. The `/api/health` endpoint is correctly excluded from auth (`url !== '/api/health'`).

---

## Summary

| Item | Description | Verdict |
|------|-------------|---------|
| **H7** | Workflow Dispatcher Race Conditions | ✅ **PASS** |
| **M5** | Health Check with DB Verification | ✅ **PASS** |
| **M8** | Fix-Search-Links Cron Removed | ✅ **PASS** |
| **Regression** | Server start, health endpoint, auth middleware | ✅ **PASS** |

**Phase 3: All items PASS. No regressions detected.**

---

*Review completed 2026-04-26 by automated code review subagent.*
