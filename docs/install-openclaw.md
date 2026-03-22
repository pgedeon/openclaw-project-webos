# Install In OpenClaw

Use this mode when the dashboard should be part of an existing OpenClaw installation and read the local OpenClaw config and workspace state directly.

## Target Layout

```text
~/.openclaw/
├── openclaw.json
└── workspace/
    ├── dashboard/
    ├── scripts/
    ├── tasks.md
    └── ...
```

The dashboard assumes that layout by default. When cloned into `~/.openclaw/workspace/dashboard`, no extra path configuration is required.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- An existing OpenClaw install with `~/.openclaw/openclaw.json`

## Setup

1. Clone the dashboard into the OpenClaw workspace.

```bash
git clone https://github.com/pgedeon/openclaw-project-dashboard.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard
```

2. Install dependencies.

```bash
npm install
```

3. Configure environment variables.

```bash
cp .env.example .env
```

At minimum, set `POSTGRES_PASSWORD`. Leave `OPENCLAW_WORKSPACE` and `OPENCLAW_CONFIG_FILE` at their defaults unless your install lives elsewhere.

4. Create or update the database schema.

```bash
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql
```

5. Start the dashboard.

```bash
npm start
```

6. Open `http://localhost:3876/`.

## Agent Setup (Recommended)

If you want agents to report their work to the Kanban board, configure each agent:

1. Ensure `agent_reporter.py` is accessible. It lives at:
   ```
   ~/.openclaw/workspace/main/scripts/agent_reporter.py
   ```

2. For each agent that should report work, add the following to its `SOUL.md` (located in the agent's `agentDir`):

   ```markdown
   ---

   ## Dashboard Reporting

   When working on substantive tasks, report your work to the Kanban board. See
   docs/AGENT-DASHBOARD-REPORTING.md for full instructions.

   Quick start:
   python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task create -t "Description" -p "Project Name" --auto-claim
   python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task complete -i <task-id>
   ```

3. Verify reporting works for an agent:
   ```bash
   OPENCLAW_AGENT_ID=my-agent python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py heartbeat
   ```

Agents will now create Kanban tasks when they start substantive work and complete them when done. See [AGENT-DASHBOARD-REPORTING.md](AGENT-DASHBOARD-REPORTING.md) for the full reference.

## Operational Notes

- `task-server.js` reads OpenClaw agent and model configuration from `OPENCLAW_CONFIG_FILE`.
- `/api/task-options` exposes those configured agents and models to the task composer.
- Dashboard-to-agent wakeups rely on the bridge scripts already present in the OpenClaw workspace.
- The health helper can be used directly:

```bash
./scripts/dashboard-health.sh start
./scripts/dashboard-health.sh status
```

## Systemd Example

```ini
[Unit]
Description=OpenClaw Project Dashboard
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=%h/.openclaw/workspace/dashboard
EnvironmentFile=%h/.openclaw/workspace/dashboard/.env
ExecStart=/usr/bin/node task-server.js
Restart=on-failure

[Install]
WantedBy=default.target
```
