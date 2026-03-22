# Admin Guide

## Overview

The OpenClaw Project Dashboard is an operations-first task management system with a Win11-style desktop shell UI. It integrates with the OpenClaw agent runtime for bidirectional agent communication.

## Server Management

### Start

```bash
node task-server.js
```

### Restart

```bash
bash scripts/restart-task-server.sh
```

### Health Check

```bash
bash scripts/dashboard-health.sh check
```

### Validate API

```bash
node scripts/dashboard-validation.js
```

## Database Management

### Apply a Migration

```bash
bash scripts/apply-workflow-migration.sh schema/migrations/001_add_workflow_runs.sql
```

### Check Database Connection

```bash
PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;"
```

### Reset (Destructive)

```bash
psql -U postgres -d mission_control -f schema/openclaw-dashboard.sql
```

## Cron Job Management

### Install Cron Jobs

Cron definitions are in `crontab/` files. Install with:

```bash
cat crontab/*.cron | crontab -
```

### Monitor Cron

The cron-manager-server (port 3878) provides an API:

```bash
curl http://127.0.0.1:3878/api/cron-admin/jobs
```

### Keepalive Servers

The cron-manager and memory-api servers auto-restart every 2 minutes via keepalive crons. They log health checks to `/tmp/cron-manager-restart.log` and `/tmp/memory-api-restart.log`.

## Agent Integration

### Agent Reporting

Agents report work to the Kanban board via `agent_reporter.py`:

```bash
# Create task
python3 scripts/agent_reporter.py task create -t "Task title" -p "Project" --auto-claim

# Complete task
python3 scripts/agent_reporter.py task complete -i <task-id>
```

### Agent Heartbeat

Agents send heartbeats via:

```bash
python3 scripts/agent_reporter.py heartbeat
```

The dashboard displays live agent status in the Agents view.

### Gateway Sync

The gateway sync runs every 30 seconds, pulling OpenClaw agent status into the dashboard. Enable via:

```bash
# Already configured in crontab
* * * * * node /path/to/sync-gateway-status.mjs >> /path/to/logs/sync-gateway-status.log 2>&1
```

## Troubleshooting

### Server won't start

```bash
# Check if port is in use
ss -tlnp | grep 3876

# Check database connection
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d mission_control -c "SELECT 1;"

# Check logs
node task-server.js 2>&1 | head -20
```

### Blank page in browser

1. Check server is running: `curl http://localhost:3876/api/health`
2. Check browser console for JS errors
3. Clear browser cache and hard refresh

### Cron jobs showing stale

1. Verify crontab is installed: `crontab -l | grep cron-manager`
2. Check keepalive log: `tail -20 /tmp/cron-manager-restart.log`
3. Run heartbeat guard: `python3 scripts/heartbeat_cron_guard.py --json`

### Widget panel not loading

1. Check IndexedDB availability in browser
2. Clear site data: DevTools → Application → Clear storage
3. Hard refresh the page

## Customization

### CSS Theme

The Win11 theme uses CSS variables. Edit `src/styles/win11-theme.css`:

```css
:root {
  --win11-accent: #0078d4;
  --win11-bg: #202020;
  /* ... */
}
```

### Add a Custom View

See `DEVELOPER_GUIDE.md` → "Adding a New View"

## Security

- All credentials via environment variables (`.env`)
- Secret scanning pipeline in `src/security/`
- No hardcoded credentials in codebase
- CORS headers configured per-origin
- See `.env.example` for all configurable settings

## Support

- Issues: https://github.com/pgedeon/openclaw-project-webos/issues
