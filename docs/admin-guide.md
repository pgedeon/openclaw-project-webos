# Project Dashboard Administration Guide

Procedures and reference for operators of the OpenClaw Project Dashboard.

## Contents

1. [Installation & Configuration](#installation--configuration)
2. [Running the Server](#running-the-server)
3. [Health Monitoring](#health-monitoring)
4. [Database Maintenance](#database-maintenance)
5. [Migration & Upgrades](#migration--upgrades)
6. [Security](#security)
7. [Logging & Troubleshooting](#logging--troubleshooting)
8. [Backup & Restore](#backup--restore)

---

## Installation & Configuration

### Prerequisites

- Node.js v18+ (v22 recommended)
- PostgreSQL 14+ (if using `STORAGE_TYPE=postgres`)
- `uuid` npm package (installed automatically if missing)

### Setup

1. Ensure database exists:

```sql
CREATE DATABASE openclaw_dashboard;
CREATE USER openclaw WITH PASSWORD 'your-password-here';
GRANT ALL ON DATABASE openclaw_dashboard TO openclaw;
```

2. Apply schema:

```bash
psql -U openclaw -d openclaw_dashboard -f dashboard/schema/openclaw-dashboard.sql
```

3. Set environment variables (example in a `.env` file in the dashboard repo root):

```bash
PORT=3876
STORAGE_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openclaw_dashboard
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=yourpassword
OPENCLAW_WORKSPACE=/root/.openclaw/workspace
OPENCLAW_CONFIG_FILE=/root/.openclaw/openclaw.json
```

4. Start the server:

```bash
npm start
```

---

## Running the Server

### Direct (development)

```bash
npm start
```

The server prints startup logs and listens on `0.0.0.0:PORT`. Press Ctrl+C to stop.

### Health script (production helper)

`scripts/dashboard-health.sh` can start, stop, check status, and auto-restart if unhealthy.

```bash
# Check status (exit 0 if healthy)
./scripts/dashboard-health.sh status

# Start
./scripts/dashboard-health.sh start

# Stop
./scripts/dashboard-health.sh stop

# Health check (used by cron or monitoring)
./scripts/dashboard-health.sh check
```

By default the script writes logs under `$OPENCLAW_WORKSPACE/logs`, stores the active PID at `$OPENCLAW_WORKSPACE/.dashboard.pid`, and mirrors that PID into the legacy `dashboard/task-server.pid` file for compatibility with older tooling. Health probes target `/api/health`. Override with `DASHBOARD_LOG_DIR`, `DASHBOARD_HEALTH_LOG_FILE`, `DASHBOARD_SERVER_LOG_FILE`, `DASHBOARD_PID_FILE`, `DASHBOARD_LEGACY_PID_FILE`, or `DASHBOARD_HEALTH_URL` if needed.

A source-managed cron entry is available at `../crontab/dashboard-health.cron`. Install or merge that file into the host crontab if you want the dashboard to auto-start on boot and auto-restart every 5 minutes when unhealthy.

### Systemd (recommended for production)

Create `/etc/systemd/system/dashboard.service`:

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/root/.openclaw/workspace/dashboard
ExecStart=/usr/bin/node task-server.js
Restart=on-failure
EnvironmentFile=/root/.openclaw/workspace/dashboard/.env
# Or set Environment= lines explicitly

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable dashboard.service
sudo systemctl start dashboard.service
sudo systemctl status dashboard.service
```

Logs via `journalctl -u dashboard.service -f`.

---

## Health Monitoring

The built‑in `/api/health` endpoint returns JSON:

```json
{
  "status": "ok",
  "timestamp": "2026-02-15T16:25:16.870Z",
  "asana_storage": "enabled",
  "storage_type": "postgres",
  "port": 3876
}
```

- `asana_storage` is `"enabled"` if storage initialized, `"disabled"` otherwise.
- Use this endpoint for uptime checks (monitoring, cron).

The health script (`dashboard-health.sh`) performs this check and restarts the server if the port is not listening or the endpoint returns non‑200.

---

## Database Maintenance

### Schema

Key tables (see `dashboard/schema/openclaw-dashboard.sql`):

- `projects`
- `tasks`
- `workflows`
- `audit_log`

Indexes are provided for common queries (project_id, status, owner, timestamps).

### Routine Tasks

- **Vacuum & Analyze** (PostgreSQL only, weekly):

```sql
VACUUM ANALYZE projects, tasks, audit_log;
```

- **Table bloat check** (monthly) if large updates occur:

```sql
SELECT schemaname, tablename, n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE schemaname = 'public';
```

If `n_dead_tup` is high, consider `VACUUM FULL` during maintenance windows.

### Archiving Old Tasks

The dashboard uses an `archived` flag rather than deleting tasks. To physically delete very old archived tasks:

```sql
DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '2 years';
DELETE FROM tasks WHERE archived = true AND completed_at < NOW() - INTERVAL '2 years';
-- Optionally delete from projects if empty
```

Always test deletes on a staging database first.

---

## Migration & Upgrades

### From Legacy Markdown (`tasks.md`) to PostgreSQL

Use `dashboard/scripts/migrate-dashboard-to-asana.js`. It:

1. Backs up `tasks.md`.
2. Creates a “Legacy Dashboard” project.
3. Parses markdown tasks (including subtasks by indentation).
4. Inserts into PostgreSQL preserving hierarchy.
5. Maps `#openclaw` tags to labels.

Run:

```bash
STORAGE_TYPE=postgres node dashboard/scripts/migrate-dashboard-to-asana.js
```

### JSON → PostgreSQL

If you have an existing `data/asana-db.json` from the JSON storage backend, you can write a one‑off script to read that file and insert records into PostgreSQL using the `AsanaStorage` class. There is no builtin script for this yet; see `storage/asana.js` for the data model.

### Version Upgrades

Dashboard files are self‑contained. To upgrade:

1. Pull new files into the dashboard repository.
2. Review `schema/` for migrations. If the schema changed, apply the new SQL on top of existing DB (backward compatible changes are typical). For breaking changes, a migration script will be provided.
3. Restart the server.

No data loss should occur; however, always backup the database before schema changes:

```bash
pg_dump -U openclaw openclaw_dashboard > backup_$(date +%F).sql
```

---

## Security

### Authentication

The dashboard API currently has no built‑in authentication; it is intended to be bound to localhost or placed behind a reverse proxy with basic auth or IP allowlist.

If exposing externally, put Nginx/Apache in front with TLS and require authentication.

### Secrets & QMD Integration

- The storage layer integrates with `src/security/secrets.py` to detect and redact secrets before writing to QMD.
- Ensure `QMD_SAFE_MODE` is set to `redact` (default) in production.
- Audit logs may contain sensitive data; restrict log file permissions (`600`).

### Data Validation

- Input validation on all API endpoints (UUID formats, enums, date strings).
- Dependency circularity detection enforced by `storage/asana.js`.
- Task model rejects unknown fields.

---

## Logging & Troubleshooting

### Server‑side logs

If running directly or via systemd, logs go to stdout/stderr. With systemd:

```bash
journalctl -u dashboard.service -f
```

### Health script logs

`logs/dashboard-health.log` contains start/stop/restart events.

### Common Issues

**“Cannot find module './src/offline/state-manager.mjs'”**

- You are running an old version. Ensure you start `dashboard/task-server.js` from the workspace root; it expects the `dashboard/` directory with `src/` inside.

**Audit view shows “unavailable”**

- The dynamic import of `./src/audit-view.mjs` failed. Check the browser console for 404. Verify the file exists and the server can serve it (path `dashboard/src/audit-view.mjs` from the server root).

**Board/Timeline placeholders**

- These views are stubs. The modules `board-view.mjs` and `timeline-view.mjs` are present but not yet integrated. Future updates will wire them up.

**Tasks not persisting**

- If `STORAGE_TYPE=json`, writes go to `data/asana-db.json`. Ensure the directory exists and is writable.
- If `postgres`, verify DB credentials and that the connection succeeds (check server logs on startup).

**Port already in use**

- Another process is on 3876. Change `PORT` or kill the existing process.

---

## Backup & Restore

### PostgreSQL

Backup (daily via cron recommended):

```bash
pg_dump -U openclaw openclaw_dashboard > /backup/dashboard_$(date +%F).sql
```

Restore:

```bash
psql -U openclaw -d openclaw_dashboard -f /backup/dashboard_2026-02-15.sql
```

### JSON storage

Copy `data/asana-db.json` to a safe location. Ensure the server is stopped during copy to avoid race conditions.

---

## Performance Tips

- Indexes are defined on `project_id`, `status`, `owner`, `created_at`, `updated_at`. For large datasets (100k+ tasks), monitor query performance and consider partial indexes for active tasks.
- The UI uses virtual scrolling for the List view when >100 tasks; this is automatic.
- Debounced search prevents excessive API calls.
- If using the Agent heartbeat, a 30‑second interval is a good balance; you can adjust in `dashboard/dashboard.html` (search for `agentRefreshInterval`).

---

## Customization

### Styling

All styles are embedded in `dashboard/dashboard.html`. You can edit the `:root` CSS variables to change colors:

```css
--bg: #f4f1ff;
--surface: #ffffff;
--accent: #5c6bf2;
```

For dark theme, edit the `[data-theme="dark"]` block.

### Adding New Views

1. Create a module in `dashboard/src/`, e.g., `my-view.mjs`.
2. Export a class with a constructor `(container, options)` and a `render()` method.
3. Add a button in the view switcher (HTML) with `data-view="myview"`.
4. Add a `case 'myview':` in `renderView()` to instantiate and call `render()`.

---

## Support

For bugs or feature requests, open an issue on the GitHub repository: https://github.com/pgedeon/openclaw-project-dashboard

Include:
- Dashboard version (commit hash or date)
- Browser console logs (if UI issue)
- Server logs (if API error)
- Steps to reproduce
