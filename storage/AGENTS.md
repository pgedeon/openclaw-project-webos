# storage/ — PostgreSQL Storage Layer

## Purpose

All persistent data access goes through `asana.js`. It owns PostgreSQL CRUD for tasks, projects, saved views, org/service APIs, audit logging, and export/import.

## Ownership

| File | Owns |
|------|------|
| `asana.js` | Complete storage layer: tasks, projects, views, audit, org, services, export/import |

## Database Connection

- Uses `pg.Pool` with `DATABASE_URL` environment variable
- Pool config: `max: 10`, `idleTimeoutMillis: 30000`
- Schema initialized from `schema/openclaw-dashboard.sql` + migrations

## Key Public Methods

- `getTasks(filters)`, `createTask(data)`, `updateTask(id, data)`, `deleteTask(id)`
- `getProjects()`, `createProject(data)`, `updateProject(id, data)`, `deleteProject(id)`
- `getSavedViews()`, `createSavedView(data)`, `updateSavedView(id, data)`, `deleteSavedView(id)`
- `getAuditLog(taskId, limit)`, `logAuditEntry(data)`
- `getOrgSummary()`, `getDepartments()`, `getAgents()`, `getAgentProfile(id)`
- `exportData()`, `importData(data)`

## Conventions

- All methods return promises
- UUIDs generated with `crypto.randomUUID()`
- Timestamps use `new Date().toISOString()`
- Methods validate input before querying
- Audit entries logged for all mutations
- Never expose raw SQL errors to API responses


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
