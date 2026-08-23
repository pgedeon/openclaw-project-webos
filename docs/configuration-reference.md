# Configuration Reference

## Overview

The OpenClaw Dashboard is configured via environment variables. A template is provided at `.env.example`.

---

## Environment Variables

### Server

| Variable | Required | Default | Description | Component |
|----------|----------|---------|-------------|-----------|
| `PORT` | No | `3876` | HTTP port for the dashboard server | `task-server.js` |
| `HOST` | No | `127.0.0.1` | Bind address for the dashboard server, honored by `listen()`; unauthenticated mode (`REQUIRE_AUTH=false`) refuses non-loopback hosts | `task-server.js` |
| `DASHBOARD_AUTH_TOKEN` | Yes* | — | Bearer token for `/api/*` routes except `/api/health` and `/api/auth/self` (*required unless `REQUIRE_AUTH=false` is set) | `task-server.js` |
| `REQUIRE_AUTH` | No | `true` | Set to `false` only for explicitly open local development without `DASHBOARD_AUTH_TOKEN`; the server then refuses to bind any non-loopback `HOST` | `task-server.js` |

The current auth mode is single-operator bearer token auth. Full login/session/RBAC auth is deferred until a multi-operator requirement exists. See [Auth Reference](auth-reference.md).

### Storage

| Variable | Required | Default | Description | Component |
|----------|----------|---------|-------------|-----------|
| `STORAGE_TYPE` | No | `postgres` | Storage backend type (`postgres`) | `task-server.js`, `AsanaStorage` |
| `POSTGRES_HOST` | No | `localhost` | PostgreSQL host | `AsanaStorage` |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port | `AsanaStorage` |
| `POSTGRES_DB` | No | `openclaw_dashboard` | PostgreSQL database name | `AsanaStorage` |
| `POSTGRES_USER` | No | `openclaw` | PostgreSQL user | `AsanaStorage` |
| `POSTGRES_PASSWORD` | Yes* | `change-me` | PostgreSQL password (*must be changed from default*) | `AsanaStorage` |

### OpenClaw Integration

| Variable | Required | Default | Description | Component |
|----------|----------|---------|-------------|-----------|
| `OPENCLAW_WORKSPACE` | No | `/root/.openclaw/workspace` | Path to the OpenClaw workspace directory | `task-server.js`, `restart-task-server.sh`, `dashboard-health.sh` |
| `OPENCLAW_CONFIG_FILE` | No | `/root/.openclaw/openclaw.json` | Path to the OpenClaw configuration file | `aggregate-department-metrics.js` |
| `OPENCLAW_BIN` | No | `openclaw` | Path or command to the OpenClaw CLI binary | Dispatcher, agent wake |
| `OPENCLAW_FS_ROOT` | No | `/root/.openclaw` | Root directory served by the filesystem API | `filesystem-api-server.mjs` |

### Filesystem API

| Variable | Required | Default | Description | Component |
|----------|----------|---------|-------------|-----------|
| `FILESYSTEM_API_PORT` | No | `3880` | HTTP port for the filesystem API server | `filesystem-api-server.mjs`, `restart-task-server.sh`, `dashboard-health.sh` |

---

## Operational Variables (used by scripts, not in .env.example)

These variables are used by operational scripts and can be set in the environment or crontab.

| Variable | Default | Description | Used By |
|----------|---------|-------------|---------|
| `DASHBOARD_API_BASE` | `http://localhost:3876` | Base URL for dashboard API calls | `sync-openclaw-projects.mjs`, `system-improvement-engine.py`, `test-incremental-sync.js` |
| `DASHBOARD_PID_FILE` | `$OPENCLAW_WORKSPACE/.dashboard.pid` | PID file for the dashboard server | `restart-task-server.sh`, `dashboard-health.sh` |
| `DASHBOARD_SERVER_LOG_FILE` | `$OPENCLAW_WORKSPACE/logs/dashboard-server.log` | Server log file path | `restart-task-server.sh`, `dashboard-health.sh` |
| `DASHBOARD_HEALTH_LOG_FILE` | `$OPENCLAW_WORKSPACE/logs/dashboard-health.log` | Health check log file path | `dashboard-health.sh` |
| `DASHBOARD_SYSTEMD_UNIT` | `openclaw-dashboard` | systemd user unit name for the dashboard | `restart-task-server.sh`, `dashboard-health.sh` |
| `FILESYSTEM_API_HOST` | `127.0.0.1` | Bind address for filesystem API | `restart-task-server.sh`, `dashboard-health.sh` |
| `FILESYSTEM_API_PID_FILE` | `$OPENCLAW_WORKSPACE/.filesystem-api.pid` | PID file for filesystem API | `restart-task-server.sh`, `dashboard-health.sh` |
| `FILESYSTEM_API_LOG_FILE` | `$OPENCLAW_WORKSPACE/logs/filesystem-api.log` | Filesystem API log file path | `restart-task-server.sh` |
| `FILESYSTEM_API_SCRIPT` | `filesystem-api-server.mjs` | Path to filesystem API script | `restart-task-server.sh` |
| `FILESYSTEM_SYSTEMD_UNIT` | `openclaw-filesystem-api` | systemd user unit name for filesystem API | `restart-task-server.sh`, `dashboard-health.sh` |
| `DASHBOARD_SCRIPT` | `task-server.js` | Path to dashboard server script | `dashboard-health.sh` |
| `DASHBOARD_HEALTH_PATH` | `/api/health` | Health check endpoint path | `dashboard-health.sh` |
| `DASHBOARD_HEALTH_URL` | `http://$HOST:$PORT/api/health` | Full health check URL | `dashboard-health.sh` |
| `FS_CANARY_PATH` | `AGENTS.md` | File used for filesystem API smoke test | `smoke-test-dashboard.sh` |

---

## .env.example

```bash
PORT=3876
DASHBOARD_AUTH_TOKEN=change-this-dashboard-token
# Set REQUIRE_AUTH=false only for explicitly open local development.
# REQUIRE_AUTH=false
STORAGE_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openclaw_dashboard
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=change-me
OPENCLAW_WORKSPACE=/root/.openclaw/workspace
OPENCLAW_CONFIG_FILE=/root/.openclaw/openclaw.json
OPENCLAW_BIN=openclaw
OPENCLAW_FS_ROOT=/root/.openclaw
FILESYSTEM_API_PORT=3880
```

---

## Configuration Priority

1. **Environment variables** — highest priority
2. **`.env` file** — loaded by Node.js dotenv (if configured)
3. **Code defaults** — fallback values in source code and scripts
