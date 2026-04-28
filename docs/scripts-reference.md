# Scripts Reference

## Overview

The `scripts/` directory contains operational scripts for the dashboard: health monitoring, server lifecycle, data normalization, testing, project synchronization, and system improvement scanning.

---

## Script Index

| Script | Language | Purpose |
|--------|----------|---------|
| `restart-task-server.sh` | Bash | Stop and restart the dashboard and filesystem API servers |
| `dashboard-health.sh` | Bash | Health monitor with auto-restart |
| `smoke-test-dashboard.sh` | Bash | End-to-end API smoke test |
| `dashboard-validation.js` | Node.js | Deep validation of database integrity and API correctness |
| `normalize-task-dependency-statuses.js` | Node.js | Fix tasks stuck in `in_progress` with incomplete dependencies |
| `aggregate-department-metrics.js` | Node.js | Persist daily department KPI snapshots |
| `sync-openclaw-projects.mjs` | Node.js (ESM) | Seed and synchronize OpenClaw project hierarchy and tasks |
| `test-incremental-sync.js` | Node.js | Test `updated_since` pagination on task API |
| `apply-workflow-migration.sh` | Bash | Apply the workflow runs migration (001) |
| `system-improvement-scan.sh` | Bash | Cron trigger for daily system improvement scan |
| `system-improvement-engine.py` | Python 3 | Analyze system state and create approval-gated improvement runs |

---

## Detailed Reference

### `restart-task-server.sh`

Stop any running dashboard server (and filesystem API), then start fresh using systemd-run when available (falls back to nohup).

**Usage:**

```bash
bash scripts/restart-task-server.sh
```

**Behavior:**
1. Reads PID files (primary + legacy) and stops existing processes.
2. Kills any orphan process on port `$PORT` and `$FILESYSTEM_API_PORT`.
3. Starts `task-server.js` via `systemd-run --user` (or `nohup`).
4. Starts `filesystem-api-server.mjs` the same way.
5. Verifies both servers pass their health checks.
6. Writes PID files.

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3876` | Dashboard server port |
| `HOST` | `127.0.0.1` | Bind address |
| `OPENCLAW_WORKSPACE` | `../../` (relative) | Workspace root |
| `FILESYSTEM_API_PORT` | `3880` | Filesystem API port |
| `STORAGE_TYPE` | `postgres` | Storage backend |
| `POSTGRES_*` | — | Database connection settings (forwarded to server) |

**Dependencies:** `systemd-run` (optional), `curl`, `lsof`/`fuser`/`ss`

---

### `dashboard-health.sh`

Health monitor that checks if the dashboard and filesystem API are running and responding. Can auto-restart on failure.

**Usage:**

```bash
bash scripts/dashboard-health.sh check    # Default: check health, restart if down
bash scripts/dashboard-health.sh start    # Force restart
bash scripts/dashboard-health.sh stop     # Stop both servers
bash scripts/dashboard-health.sh status   # Report health status
```

**Behavior (check mode):**
1. Checks if port 3876 is listening.
2. Sends GET to `/api/health` with a 5-second timeout.
3. Sends GET to filesystem API health endpoint.
4. If any check fails, calls `restart-task-server.sh`.

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3876` | Dashboard port |
| `HOST` | `127.0.0.1` | Bind address |
| `DASHBOARD_LOG_DIR` | `$OPENCLAW_WORKSPACE/logs` | Log directory |
| `DASHBOARD_HEALTH_LOG_FILE` | `$OPENCLAW_WORKSPACE/logs/dashboard-health.log` | Health check log |

**Dependencies:** `curl`, `ss`, `lsof`/`fuser`

---

### `smoke-test-dashboard.sh`

Minimal end-to-end test that exercises the core API lifecycle: health check, filesystem read, project CRUD.

**Usage:**

```bash
bash scripts/smoke-test-dashboard.sh
```

**Test steps:**
1. GET `/api/health-status` — verify status field exists.
2. GET `/api/fs/file?path=AGENTS.md` — verify filesystem API returns a file.
3. POST `/api/projects` — create a temporary project.
4. GET `/api/projects/:id` — read it back.
5. GET `/api/projects` — list all projects.
6. DELETE `/api/projects/:id` — clean up.

**Exit codes:** 0 on pass, 1 on any failure.

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Dashboard host |
| `PORT` | `3876` | Dashboard port |
| `FS_CANARY_PATH` | `AGENTS.md` | File used for filesystem API test |

**Dependencies:** `curl`, `python3` (for JSON parsing)

---

### `dashboard-validation.js`

Comprehensive validation suite that checks database schema, data integrity, and API endpoints.

**Usage:**

```bash
node scripts/dashboard-validation.js
```

**Checks performed:**

- **PostgreSQL connection**
- **Schema**: Verifies `projects`, `tasks`, `workflows`, `audit_log` tables exist
- **Data integrity**: Orphaned tasks, missing required fields, invalid dependency references, circular dependencies, blocked tasks with incomplete dependencies, parent-child validity, completion rule consistency
- **API endpoints**: `/api/health`, `/api/stats`, agent views, filesystem API, project CRUD, pagination limits, project-scoped task/timeline endpoints
- **QMD integration**: Verifies QMD data directory exists

**Exit codes:** 0 (pass), 0 with warnings, 1 (failure).

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | Database host |
| `POSTGRES_PORT` | `5432` | Database port |
| `POSTGRES_DB` | `openclaw_dashboard` | Database name |
| `POSTGRES_USER` | `openclaw` | Database user |
| `POSTGRES_PASSWORD` | (required) | Database password |
| `PORT` | `3876` | Dashboard port (for API base URL) |
| `DASHBOARD_API_BASE` | `http://localhost:$PORT` | Override API base URL |

**Dependencies:** `pg` (npm), Node.js built-in `http`

---

### `normalize-task-dependency-statuses.js`

Finds tasks in `in_progress` status that have incomplete dependencies and moves them to `blocked`.

**Usage:**

```bash
node scripts/normalize-task-dependency-statuses.js --dry-run
node scripts/normalize-task-dependency-statuses.js
node scripts/normalize-task-dependency-statuses.js --limit 25
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `--dry-run` | List tasks that would be normalized without writing changes |
| `--limit N` | Only inspect the first N matching tasks (1–1000) |
| `-h`, `--help` | Show help |

**Output:** For each affected task, prints the task ID, title, and either the blocking dependencies (dry-run) or the new status.

**Dependencies:** `storage/asana` (project-local AsanaStorage module)

---

### `aggregate-department-metrics.js`

Computes and persists daily department KPI snapshots into the `department_daily_metrics` table.

**Usage:**

```bash
node scripts/aggregate-department-metrics.js
node scripts/aggregate-department-metrics.js --yesterday
node scripts/aggregate-department-metrics.js --date 2026-03-12
node scripts/aggregate-department-metrics.js --date 2026-03-12 --backfill-days 7
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `--date YYYY-MM-DD` | Target snapshot date (default: today UTC) |
| `--yesterday` | Shorthand for yesterday's date |
| `--backfill-days N` | Persist N consecutive days ending at `--date` (1–366) |
| `-h`, `--help` | Show help |

**Dependencies:** `storage/asana`, `metrics-api.js`, `fs` (reads `openclaw.json`)

---

### `sync-openclaw-projects.mjs`

Seeds and synchronizes the OpenClaw project hierarchy and tasks from a hardcoded definition. Designed for idempotent re-runs.

**Usage:**

```bash
node scripts/sync-openclaw-projects.mjs
```

**Behavior:**
1. Archives stale projects matching legacy name patterns.
2. Creates or updates the project tree (OpenClaw System → Dashboard & Task System, Memory & Recall, etc.).
3. Creates or updates seed tasks within each project with status, priority, owner, labels, and preferred model metadata.
4. Skips updates when existing data already matches.

**Arguments:** None.

**Environment Variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_API_BASE` | `http://localhost:3876` | Dashboard API base URL |

**Dependencies:** ESM `fetch` (Node.js built-in), no external packages.

---

### `test-incremental-sync.js`

Tests the `updated_since` query parameter on `/api/tasks/all` for incremental sync support.

**Usage:**

```bash
node scripts/test-incremental-sync.js
```

**Test steps:**
1. Fetches all projects, picks the first.
2. Fetches all tasks for the project.
3. Identifies the most recently updated task.
4. Queries with `updated_since` set to 10 minutes before that update.
5. Verifies the returned set matches a manual timestamp filter.
6. Queries with a future timestamp and verifies zero results.

**Exit codes:** 0 on pass, 1 on failure.

**Dependencies:** `node-fetch`

---

### `apply-workflow-migration.sh`

Applies the `001_add_workflow_runs.sql` migration to the database with safety checks.

**Usage:**

```bash
bash scripts/apply-workflow-migration.sh
```

**Behavior:**
1. Validates `psql` is available.
2. Tests database connectivity.
3. Checks if `workflow_runs` table already exists (prompts before overwriting).
4. Applies the migration SQL file.
5. Reports created tables, views, and seeded templates.

**Environment Variables:** Standard `POSTGRES_*` variables.

**Dependencies:** `psql`

---

### `system-improvement-scan.sh`

Cron-triggered wrapper that creates a workflow run for the system improvement scan.

**Usage:**

```bash
bash scripts/system-improvement-scan.sh
```

**Behavior:**
1. Checks if a scan is already active (skips if so).
2. Checks if a scan completed in the last 20 hours (skips if so).
3. Creates a `system-improvement-scan` workflow run via POST `/api/workflow-runs`.
4. Logs result to `$LOG_DIR/system-improvement-scan.log`.

**Suggested cron:** `0 8 * * *` (daily at 08:00).

**Dependencies:** `curl`, `python3`

---

### `system-improvement-engine.py`

Analyzes the current system state (templates, runs, approvals, cron health) and creates approval-gated workflow runs for improvement suggestions.

**Usage:**

```bash
python3 scripts/system-improvement-engine.py
```

**Analysis areas:**
1. **Artifact contracts** — templates missing output definitions
2. **Workflow health** — failed or stuck runs
3. **Cron health** — stale or missing cron job logs
4. **Workflow output** — low artifact capture rate on completed runs
5. **Approval gaps** — publishing/site-change runs bypassing approval gates

**Behavior:**
1. Gathers system state from dashboard API endpoints and log file timestamps.
2. Analyzes opportunities based on thresholds.
3. Deduplicates against existing pending approvals.
4. Creates approval-gated workflow runs for each actionable suggestion.
5. Prints a JSON summary to stdout.

**Suggested cron:** Triggered by `system-improvement-scan.sh` via workflow run.

**Dependencies:** Python 3.10+ (stdlib only — `urllib`, `json`, `subprocess`)
