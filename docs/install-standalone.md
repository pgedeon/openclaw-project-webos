# Standalone Install

Use this mode when you want the dashboard repository outside the OpenClaw workspace, but still want it to talk to an OpenClaw install.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A reachable OpenClaw workspace and config file

## Setup

1. Clone the repo anywhere you want.

```bash
git clone https://github.com/pgedeon/openclaw-project-dashboard.git /opt/openclaw-project-dashboard
cd /opt/openclaw-project-dashboard
```

2. Install dependencies.

```bash
npm install
```

3. Create the environment file.

```bash
cp .env.example .env
```

4. Set these values explicitly:

```bash
OPENCLAW_WORKSPACE=~/.openclaw/workspace
OPENCLAW_CONFIG_FILE=~/.openclaw/openclaw.json
POSTGRES_PASSWORD=change-me
```

5. Apply the schema and start the server.

```bash
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql
npm start
```

## What Changes In Standalone Mode

- The dashboard no longer auto-discovers the OpenClaw workspace from its own directory layout.
- `dashboard-health.sh`, `restart-task-server.sh`, and `migrate-dashboard-to-asana.js` all respect `OPENCLAW_WORKSPACE`.
- OpenClaw-specific features still work as long as `OPENCLAW_WORKSPACE` and `OPENCLAW_CONFIG_FILE` are correct.

## Recommended Service Unit

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/openclaw-project-dashboard
EnvironmentFile=/opt/openclaw-project-dashboard/.env
ExecStart=/usr/bin/node task-server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
