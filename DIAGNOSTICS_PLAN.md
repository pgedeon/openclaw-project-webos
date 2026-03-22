# System Operations Center — Diagnostics Page

**Status:** Core Complete ✅  
**Created:** 2026-03-20  
**Goal:** Single dashboard page to monitor, diagnose, and repair all repeating work (cron jobs, skills, scripts, pipelines).

---

## Progress Tracker

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Create plan file | ✅ Done | This file |
| 2 | Build `diagnostics-api.js` backend module | ✅ Done | Core API routes with failure classification |
| 3 | Wire diagnostics API into `task-server.js` | ✅ Done | Routes added, handler initialized before server |
| 4 | Create `diagnostics.html` page shell | ✅ Done | Full page with nav, health summary, jobs table, detail panel |
| 5 | Health summary + jobs table | ✅ Done | Working: total/healthy/failing/stale/persistent counts, filterable jobs table |
| 6 | Log viewer with failure highlighting | ✅ Done | Cycle-grouped, color-coded (red=failure, green=success, orange=warning) |
| 7 | Repair actions (run, reset, disable/enable) | ✅ Done | All 4 actions working via POST /api/diagnostics/jobs/:id/repair |
| 8 | AI analysis endpoint | ⬜ Pending | Send logs → get diagnosis |
| 9 | Skills & scripts scanning | ⬜ Pending | Extended monitoring beyond cron |
| 10 | Nav integration + polish | ✅ Done | Integrated as Operations view button in webos dashboard |

---

## Architecture

```
/diagnostics (new page)
├── diagnostics.html          — Page shell with nav
├── src/diagnostics-page.mjs  — Frontend JS module
└── diagnostics-api.js        — Backend API (plugged into task-server.js)

Data Sources:
├── crontab/*.cron            — Cron job definitions
├── logs/*.log                — Cron job output logs
├── /tmp/openclaw-heartbeat-cron-guard-state.json — Persistent failure state
└── ~/.openclaw/skills/*/SKILL.md + workspace/skills/*/SKILL.md — Skills
```

## API Endpoints (on port 3876)

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/diagnostics/summary` | GET | Overall health counts | ✅ Working |
| `/api/diagnostics/jobs` | GET | All monitored items with status | ✅ Working |
| `/api/diagnostics/jobs/:id` | GET | Single job detail + run history | ✅ Working |
| `/api/diagnostics/jobs/:id/logs` | GET | Smart log inspection (cycle-grouped, highlighted) | ✅ Working |
| `/api/diagnostics/jobs/:id/repair` | POST | Execute repair action (run/reset_failure/disable/enable) | ✅ Working |
| `/api/diagnostics/jobs/:id/silence` | POST | Silence alerts for N hours | ✅ Working |
| `/api/diagnostics/failures` | GET | Active and persistent failures | ✅ Working |

## Failure Classification

Jobs are classified by analyzing the last 10 lines of their log output:
- **permission** — "permission denied", "eperm", "eacces"
- **missing_file** — "enoent", "no such file", "not found"
- **network** — "etimedout", "econnrefused", "econnreset"
- **pipeline_failed** — "status: failed", "status=failed"
- **crash** — "traceback", "exception"
- **generic_failure** — standalone "error" (excluding benign patterns like "error rate", "errors":[])

Success keywords override: "all checks passed", "completed successfully", "validation passed", etc.

## Repair Actions

| Action | Description | Status |
|--------|-------------|--------|
| `run` | Trigger immediate execution (spawn detached) | ✅ Working |
| `reset_failure` | Clear persistent failure counter from guard state | ✅ Working |
| `disable` | Comment out cron line with `[DISABLED]` prefix | ✅ Working |
| `enable` | Remove `[DISABLED]` prefix from cron line | ✅ Working |

## Files Created/Modified

| File | Action |
|------|--------|
| `dashboard/diagnostics-api.js` | Created — backend API module (7 endpoints) |
| `dashboard/diagnostics.html` | Created — standalone page (fallback) |
| `dashboard/src/diagnostics-page.mjs` | Created — standalone page JS (fallback) |
| `dashboard/src/diagnostics-view.mjs` | Created — **integrated dashboard view** |
| `dashboard/task-server.js` | Modified — wired in diagnostics handler + route |
| `dashboard/DIAGNOSTICS_PLAN.md` | Created — this file |
| `dashboard.html` | Modified — added Diagnostics view button in Operations group |
| `dashboard/src/dashboard-integration-optimized.mjs` | Modified — import, instance var, cleanup, registry entry |
| `scripts/heartbeat_cron_guard.py` | Modified — persistent failure tracking |
| `crontab/sailing-yachts-improve.cron` | Deleted — dead pipeline removed |

## Remaining Work

### Step 8: AI Analysis Endpoint
- POST `/api/diagnostics/jobs/:id/analyze` endpoint
- Send last N log lines + failure type + job metadata to LLM
- Return: root cause, suggested fix, severity assessment
- Consider: use local model (zai) vs external API

### Step 9: Skills & Scripts Scanning
- Scan `~/.openclaw/skills/*/SKILL.md` and `workspace/main/skills/*/SKILL.md`
- Validate SKILL.md format (frontmatter, description, location)
- Check referenced scripts exist
- Scan `workspace/scripts/*.py`, `*.sh`, `*.js`
- Add as a second source in the jobs list with type "skill" or "script"

## What This Replaces

- Standalone `cron-manager-server.mjs` (port 3878) — functionality absorbed
- Basic cron section in `operations.html` — diagnostics becomes canonical view
- `cron-view.mjs` — replaced by richer UI

## What This Keeps

- `heartbeat_cron_guard.py` — still the cheap triage layer with persistent tracking
- `crontab/*.cron` files — source of truth for cron definitions
- Dashboard task system — repair tasks can flow into existing queue
