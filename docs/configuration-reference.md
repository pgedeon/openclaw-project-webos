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
| `DASHBOARD_AUTH_TOKEN` | Yes* | — | Bearer token for `/api/*` routes except `/api/health` and `/api/auth/self` (*required unless `REQUIRE_AUTH=false` is set). Also required by `filesystem-api-server.mjs` and `memory-api-server.mjs`, which refuse to start without it (SECURITY-AUDIT-2026-08.md F5/F6) | `task-server.js`, `filesystem-api-server.mjs`, `memory-api-server.mjs`, `restart-task-server.sh`, `dashboard-health.sh` |
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
| `OPENCLAW_HOME` | No | `$HOME` | Root of OpenClaw gateway data (`agents/*/sessions`) read by the cost/token backfill | `backfill-run-costs.js` |

### Gateway Bridge (optional, default off)

The gateway bridge (`lib/gateway-bridge.js`) opens one server-side WebSocket to the OpenClaw
gateway and fans normalized events out to browsers over the bridge-fed SSE channel
(`GET /api/events/stream`). It is enabled only when a gateway URL resolves; otherwise it
disables cleanly and the dashboard keeps its 20s polling feed.

Resolution order: environment overrides first, then the shared gateway config
(`~/.openclaw/openclaw.json` → `gateway.port`, `gateway.auth.{mode,password,token}`),
the same source the probe (`scripts/probe-gateway-ws.mjs`) uses. The gateway shared secret
never leaves the server process — browsers only ever see the dashboard's own SSE surface.

| Variable | Required | Default | Description | Component |
|----------|----------|---------|-------------|-----------|
| `GATEWAY_BRIDGE_URL` | No | derived from `openclaw.json` (`ws://127.0.0.1:<gateway.port>`) | Full WebSocket URL for the bridge (e.g. `wss://127.0.0.1:18789`); when neither this nor a readable `openclaw.json` resolves, the bridge stays disabled | `lib/gateway-bridge.js` |
| `GATEWAY_BRIDGE_TOKEN` | No | `gateway.auth` from `openclaw.json` | Shared gateway secret in token mode; overrides the config-file credential | `lib/gateway-bridge.js` |

Browser side, live mode is opt-in per operator via localStorage: set `openclaw.liveSync=1`
to switch `src/shell/realtime-sync.mjs` from 20s polling to the SSE stream (polling remains
the automatic fallback). Default OFF — zero behavior change unless enabled.

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

---

## Staging Deployment (LAN dev machine)

The dashboard runs a dedicated staging slot on the LAN dev machine per
`DEPLOY-POLICY.md` (Amendment 10) — all verification happens there; production is
written only by the daily release batch.

| Property | Value |
|----------|-------|
| Staging URL | `http://192.168.0.81:8120/` |
| Host access | `ssh dev` (192.168.0.81, user `pgedeon`, key auth) |
| Webroot | `~/www/staging/openclaw-dashboard/` |
| Server file | `~/openclaw-dashboard-staging-server.js` (launcher: loads webroot `.env`, then requires `task-server.js`) |
| Keepalive | per-minute cron on dev: `curl http://127.0.0.1:8120/api/health || nohup node …` (same pattern as the other staging slots) |
| Deploy command | `scripts/dashboard-staging-deploy.sh` from a repo checkout (idempotent: rsync → env check → deps → restart → health verify) |
| Log | `~/openclaw-dashboard-staging.log` on dev |

Staging `.env` values (provisioned once in the webroot, never overwritten by the
deploy script):

```env
PORT=8120
HOST=0.0.0.0
STORAGE_TYPE=json_snapshot
DASHBOARD_AUTH_TOKEN=<fresh random — provisioned secret, not in git>
OPENCLAW_WORKSPACE=/home/pgedeon/www/staging/openclaw-dashboard/workspace
ASANA_JSON_SNAPSHOT_PATH=/home/pgedeon/www/staging/openclaw-dashboard/workspace/data/asana-db.json
```

Notes:

- `WORKSPACE` is resolved via `OPENCLAW_WORKSPACE` so the static UI is served from
  `<webroot>/workspace/dashboard` (symlink to the webroot) instead of the hardcoded
  `/root/.openclaw/workspace` default.
- `STORAGE_TYPE=json_snapshot` runs the read-only snapshot backend — no PostgreSQL
  on the staging host; `/api/health` reports `storage_type: json_snapshot` with
  status `degraded` by design.
- The server sets `X-Robots-Tag: noindex, nofollow` on every response (staging
  platform invariant).
- All `/api/*` routes except `/api/health` and `/api/auth/self` require the
  `Authorization: Bearer <DASHBOARD_AUTH_TOKEN>` header; unauthenticated requests
  get `401`.
