# OpenClaw Project WebOS

`3.0.0-rc.1`

A Windows 11-style desktop environment for managing your OpenClaw agent fleet. WebOS turns project management into a windowed desktop with a Kanban board, 18+ live widgets, start menu, taskbar, and native views — all powered by raw ES modules with zero framework dependencies.

## Screenshots

### Dashboard

<p align="center">
  <img src="docs/screenshots/dashboard-overview-dark-full.png" alt="Dark-mode full-page desktop overview of the OpenClaw Project Dashboard" width="100%" />
</p>

### Agents

<p align="center">
  <img src="docs/screenshots/agents-overview-dark-full.png" alt="Dark-mode full-page desktop overview of the OpenClaw agents workspace" width="100%" />
</p>

## What's in RC1

**WebOS Desktop Environment**
- Win11-style shell with desktop, taskbar, start menu, and window manager
- 20 windowed apps (tasks, board, timeline, agents, workflows, departments, metrics, etc.)
- All native views — no iframes, all ES modules with direct data binding
- Dark/light theme with glass effects and smooth animations
- Keyboard shortcuts, window persistence via localStorage

**Widget System (18 widgets)**
- Modular widget registry — drop-in `.mjs` files, auto-discovered
- Drag-and-drop reordering with visual drop indicators
- Per-widget resize handles with size popup (1×1 through 3×1)
- Panel position toggle (left / right / top)
- Widgets: system-health, task-pulse, clock, queue-monitor, blocker-alert, workflow-pulse, approval-queue, project-stats, agent-fleet, cron-countdown, quick-notes, session-timer, system-uptime, mini-sparkline, error-feed, department-status, command-runner, motd-widget

**Kanban Board**
- Multi-project board with custom workflows per project
- Drag-and-drop task movement between columns
- Task composition with dependencies, subtasks, labels, priorities
- Agent claiming and execution locking

**Agent Integration**
- Agent heartbeat and status reporting via REST API
- `agent_reporter.py` CLI for agents to create/complete/block tasks
- Per-agent SOUL.md instructions for automatic Kanban reporting
- Live agent status from gateway-status.json integration

**Memory & Facts System**
- In-browser memory file browser with search
- Facts tab with CRUD, search, and add/delete capabilities
- Memory API server (port 3879) with CORS support

**Operations**
- Service catalog and service requests tracking
- Department management with operating views
- Workflow run monitoring and blocker intelligence
- Audit log with full-text search

## Install

Two install modes are documented:

- OpenClaw workspace install: [docs/install-openclaw.md](docs/install-openclaw.md)
- Standalone repo install: [docs/install-standalone.md](docs/install-standalone.md)

Quick OpenClaw workspace install:

```bash
git clone https://github.com/pgedeon/openclaw-project-dashboard.git ~/.openclaw/workspace/dashboard
cd ~/.openclaw/workspace/dashboard
npm install
cp .env.example .env
psql -U openclaw -d openclaw_dashboard -f schema/openclaw-dashboard.sql
psql -U openclaw -d openclaw_dashboard -f schema/demo-data.sql  # Optional: populates demo projects and tasks
npm start
```

When the repo is installed at `~/.openclaw/workspace/dashboard`, the server auto-detects the workspace path. If you install elsewhere, set `OPENCLAW_WORKSPACE` and `OPENCLAW_CONFIG_FILE`.

## Runtime Model
## Agent Dashboard Reporting

Agents can report their work to the Kanban board in real-time using the built-in `agent_reporter.py` CLI. This lets you see what every agent is working on directly from the Board view.

### Quick Example

```bash
# Agent creates a task (appears in "ready" column)
python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task create   --title "Build authentication feature"   --project "OpenClaw System"   --auto-claim

# Agent completes the task (moves to "completed" column)
python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task complete --id <task-id>
```

### Required Setup

For each agent that should report to the dashboard, add the following to the agent's `SOUL.md`:

```markdown
---

## Dashboard Reporting

When working on substantive tasks, report your work to the Kanban board. See
`docs/AGENT-DASHBOARD-REPORTING.md` for full instructions.

Quick start:
python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task create -t "Description" -p "Project Name" --auto-claim
python3 ~/.openclaw/workspace/main/scripts/agent_reporter.py task complete -i <task-id>
```

This instructs the agent to create Kanban tasks when it starts work and complete them when done. The agent's name is automatically attached via `OPENCLAW_AGENT_ID`.

### Available Commands

| Command | Description |
|---------|-------------|
| `task create` | Create a task on the board (`--auto-claim` to start immediately) |
| `task start` | Claim and begin working on a task |
| `task complete` | Move a task to completed |
| `task block` | Mark a task as blocked with a reason |
| `task move` | Move a task to any column |
| `task list` | List tasks with optional filters |
| `activity` | Post a status update + heartbeat |
| `heartbeat` | Send a simple "I'm alive" ping |

### Known Projects

- **OpenClaw System** — agent infrastructure, dashboard, gateway
- **Dashboard & Task System** — dashboard features, task management
- **Memory & Recall** — memory system, facts DB, semantic search
- **Models & Providers** — LLM provider configs, model management
- **Heartbeat & Automation** — cron jobs, automation, monitoring
- **Facts & Structured Data** — facts_db, structured data pipeline

See [docs/AGENT-DASHBOARD-REPORTING.md](docs/AGENT-DASHBOARD-REPORTING.md) for the full reference including when to report, Kanban column flow, and rules for what not to report.



The dashboard is served by `task-server.js` and stores data in PostgreSQL by default.

- Agents page: `agents.html`
- UI entry: `dashboard.html`
- API server: `task-server.js`
- Storage layer: `storage/asana.js`
- Frontend integration: `src/dashboard-integration-optimized.mjs`

Important OpenClaw-aware endpoints:

- `GET /api/task-options`
- `GET /api/projects/default`
- `GET /api/views/agent`
- `GET /api/agents/status`
- `POST /api/agents/heartbeat`

## Repository Layout

```text
.
├── index.html                    # WebOS entry point
├── task-server.js                # API server (port 3876)
├── memory-api-server.mjs         # Memory/facts API (port 3879)
├── cron-manager-server.mjs       # Cron job manager (port 3878)
├── storage/
│   └── asana.js                  # PostgreSQL storage layer
├── src/
│   └── shell/                    # WebOS shell
│       ├── shell-main.mjs        # Bootstrap & window manager
│       ├── taskbar.mjs           # Win11 taskbar
│       ├── start-menu.mjs        # Start menu
│       ├── window-manager.mjs    # Window management
│       ├── realtime-sync.mjs     # 20s data polling
│       ├── api-client.mjs        # Dashboard API client
│       ├── view-adapter.mjs      # View loading & state
│       ├── view-state.mjs        # Persistence
│       ├── native-views/         # 20 native view modules
│       └── widgets/              # Widget system
│           ├── widget-registry.mjs
│           ├── widget-host.mjs
│           ├── widget-panel.mjs
│           └── widgets/           # 18 widget modules
├── src/styles/
│   ├── win11-theme.css           # Theme tokens
│   ├── win11-shell.css           # Desktop styles
│   ├── win11-taskbar.css         # Taskbar styles
│   ├── win11-widget-panel.css    # Widget panel
│   └── win11-widget-card.css     # Widget cards
├── schema/
│   ├── openclaw-dashboard.sql    # Base schema
│   ├── demo-data.sql             # Demo projects, tasks, departments
│   └── migrations/               # Schema migrations
├── scripts/
│   └── agent_reporter.py         # Agent Kanban reporting CLI
├── docs/
│   ├── AGENT-DASHBOARD-REPORTING.md
│   ├── install-openclaw.md
│   └── ...
└── tests/                        # Offline + integration tests
```

## Configuration

See [.env.example](.env.example) for the supported environment variables.

The most important ones are:

- `PORT`
- `STORAGE_TYPE`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `OPENCLAW_WORKSPACE`
- `OPENCLAW_CONFIG_FILE`
- `OPENCLAW_BIN`

## Development

```bash
npm install
npm run validate
node tests/test-filter-behavior.js
```

If the dashboard server is already running on another port, point validation at it:

```bash
DASHBOARD_API_BASE=http://localhost:3887 node scripts/dashboard-validation.js
```

## Release Candidate Notes

This repository snapshot targets `github.com/pgedeon/openclaw-project-dashboard` and is tagged as `v2.0.0-rc.2`.

Release notes: [RELEASE.md](RELEASE.md)  
Change history: [CHANGELOG.md](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).

## License

MIT. See [LICENSE](LICENSE).
