# Install — Standalone

Install the dashboard as a standalone service, independent of OpenClaw.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+

## Install

```bash
git clone https://github.com/pgedeon/openclaw-project-webos.git /opt/openclaw-project-webos
cd /opt/openclaw-project-webos
npm install
cp .env.example .env
```

## Database Setup

```bash
# Create database
createdb openclaw_dashboard

# Apply schema and migrations
psql -U postgres -d openclaw_dashboard -f schema/openclaw-dashboard.sql
for f in schema/migrations/*.sql; do
  psql -U postgres -d openclaw_dashboard -f "$f"
done
```

## Configure

Edit `.env`:

```env
PORT=3876
STORAGE_TYPE=postgres
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=openclaw_dashboard
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-password
```

Without OpenClaw, some features will be unavailable:
- Agent heartbeat and status (no gateway connection)
- Model catalog sync
- Workflow dispatching

The core dashboard, task management, workflows, and cron monitoring all work independently.

## Start

### Manual

```bash
node task-server.js
```

### Systemd Service

Create `/etc/systemd/system/openclaw-dashboard.service`:

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/openclaw-project-webos
ExecStart=/usr/bin/node /opt/openclaw-project-webos/task-server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable openclaw-dashboard
systemctl start openclaw-dashboard
```

### With PM2

```bash
npm install -g pm2
pm2 start task-server.js --name openclaw-dashboard
pm2 save
pm2 startup
```

## Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name dashboard.example.com;

    location / {
        proxy_pass http://127.0.0.1:3876;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Verify

```bash
bash scripts/dashboard-health.sh check
node scripts/dashboard-validation.js
```

Open `http://localhost:3876` in your browser.
