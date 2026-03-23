# Install — OpenClaw Workspace

Install the dashboard inside an existing OpenClaw workspace.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- OpenClaw installed at `~/.openclaw/`

## Install

```bash
git clone https://github.com/pgedeon/openclaw-project-webos.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard
npm install
cp .env.example .env
```

## Database Setup

```bash
# Create database
createdb mission_control

# Apply schema
psql -U postgres -d mission_control -f schema/openclaw-dashboard.sql

# Apply migrations
for f in schema/migrations/*.sql; do
  psql -U postgres -d mission_control -f "$f"
done
```

## Configure

Edit `.env` with your PostgreSQL credentials:

```env
PORT=3876
STORAGE_TYPE=postgres
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=mission_control
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-password
OPENCLAW_FS_ROOT=/root/.openclaw
FILESYSTEM_API_PORT=3880
```

## Start

```bash
# Terminal 1
node task-server.js

# Terminal 2
node filesystem-api-server.mjs
```

Open `http://localhost:3876` in your browser.

The server auto-detects the OpenClaw workspace when installed at `~/.openclaw/workspace/dashboard`. For custom paths, set `OPENCLAW_WORKSPACE` in `.env`.

## Start on Boot

```bash
# Copy the systemd unit (adjust paths)
cp scripts/openclaw-dashboard.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable openclaw-dashboard
systemctl start openclaw-dashboard
```

## Verify

```bash
# Health check
bash scripts/dashboard-health.sh check

# API validation
node scripts/dashboard-validation.js

# Smoke test
bash scripts/smoke-test-dashboard.sh
```
