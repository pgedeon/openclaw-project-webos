# OpenClaw Project WebOS

A WebOS-style project management dashboard — desktop environment for managing tasks, workflows, and team activity.

![WebOS Desktop](docs/screenshot.png)

## Features

### 🖥️ Desktop Environment
- **Window Manager** — Draggable, resizable windows with minimize/maximize/close
- **Taskbar** — Running apps, system tray, clock
- **Start Menu** — App launcher with pinned apps and categories

### 📋 Kanban Board
- Project-scoped kanban with drag-and-drop status transitions
- Quick-add tasks inline, click-to-inspect detail panel
- Collapsible completed column (hidden by default to reduce noise)
- Sub-project aggregation toggle

### 📅 Gantt Timeline
- Horizontal time-axis with day/week/month zoom
- Status-coded bars: active tasks pulse to "now", completed show duration
- Scroll-synced task sidebar with search and filters

### 🤝 Activity Feed
- Real-time task lifecycle events from audit log
- Owner change detection (handoffs) highlighted
- Filter by owner changes, status moves, or all activity
- Click-to-inspect with full before/after diff

### 📖 Runbooks
- Workflow templates displayed as structured runbooks
- Steps, input schema, governance policies, success criteria
- Required approvals, artifact contracts, SLA settings

### 🚀 Workflow Engine
- Template-based workflow execution with step tracking
- Approval gates with role-based access control
- Dependency management, blocker classification
- Agent assignment and escalation policies

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# Clone the repository
git clone https://github.com/pgedeon/openclaw-project-webos.git
cd openclaw-project-webos

# Install dependencies
npm install

# Configure database
cp .env.example .env
# Edit .env with your database credentials

# Create database and run migrations
createdb openclaw_webos
psql -d openclaw_webos -f schema/openclaw-dashboard.sql
psql -d openclaw_webos -f schema/migrations/001_add_workflow_runs.sql
psql -d openclaw_webos -f schema/migrations/002_add_workflow_queues.sql
psql -d openclaw_webos -f schema/migrations/003_add_approvals.sql
psql -d openclaw_webos -f schema/migrations/004_add_blocker_classification.sql
psql -d openclaw_webos -f schema/migrations/005_add_migration_tracking.sql
psql -d openclaw_webos -f schema/migrations/006_add_departments.sql
psql -d openclaw_webos -f schema/migrations/007_add_agent_profiles.sql
psql -d openclaw_webos -f schema/migrations/008_add_service_catalog.sql
psql -d openclaw_webos -f schema/migrations/009_add_service_requests.sql
psql -d openclaw_webos -f schema/migrations/010_harmonize_service_catalog.sql
psql -d openclaw_webos -f schema/migrations/011_extend_workflow_business_context.sql
psql -d openclaw_webos -f schema/migrations/012_add_workflow_artifacts.sql
psql -d openclaw_webos -f schema/migrations/013_extend_workflow_approvals.sql
psql -d openclaw_webos -f schema/migrations/014_add_workflow_run_blocker_intelligence.sql
psql -d openclaw_webos -f schema/migrations/015_add_department_daily_metrics.sql

# Seed demo data
node scripts/seed-demo.js

# Start the server
node task-server.js
```

Open **http://localhost:3876** in your browser.

## Architecture

```
├── index.html                    # WebOS desktop entry point
├── task-server.js                # HTTP server + REST API
├── storage/
│   └── asana.js                  # PostgreSQL data layer
├── src/
│   ├── shell/                    # WebOS desktop shell
│   │   ├── shell-main.mjs        # Main entry, initializes desktop
│   │   ├── window-manager.mjs    # Draggable/resizable windows
│   │   ├── taskbar.mjs           # Bottom taskbar
│   │   ├── start-menu.mjs        # Start menu / app launcher
│   │   ├── app-registry.mjs      # App definitions & routing
│   │   ├── api-client.mjs        # API client library
│   │   ├── view-adapter.mjs      # View lifecycle management
│   │   └── native-views/         # Per-app view renderers
│   │       ├── board-view.mjs    # Kanban board
│   │       ├── timeline-view.mjs # Gantt timeline
│   │       ├── handoffs-view.mjs # Activity feed
│   │       ├── runbooks-view.mjs # Workflow runbooks
│   │       ├── publish-view.mjs  # Publishing center
│   │       └── ...               # More views
│   ├── styles/                   # Win11-inspired CSS theme
│   └── views/                    # Shared view components
├── schema/                       # PostgreSQL schema & migrations
├── scripts/                      # Utility scripts
└── runbooks/                     # Runbook markdown files
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/projects` | List all projects |
| GET | `/api/tasks/all` | List tasks (project_id optional) |
| GET | `/api/tasks/:id` | Get task details |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| POST | `/api/tasks/:id/move` | Change task status |
| GET | `/api/views/board` | Kanban board data |
| GET | `/api/lead-handoffs` | Activity feed with handoff detection |
| GET | `/api/audit` | Full audit log with filters |
| GET | `/api/workflow-templates` | List workflow templates |
| GET | `/api/projects/default` | Get default project |

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES Modules), no build step
- **Backend:** Node.js HTTP server (raw, no framework)
- **Database:** PostgreSQL with JSONB
- **Styling:** Custom Win11-inspired CSS (no CSS framework)

## License

MIT
