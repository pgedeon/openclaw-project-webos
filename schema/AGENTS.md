# schema/ — Database Migrations

## Purpose

SQL migration files that define and evolve the PostgreSQL schema. Applied in sequential order.

## Ownership

| File | Owns |
|------|------|
| `openclaw-dashboard.sql` | Base schema (tables, indexes, constraints) |
| `migrations/001_*.sql` through `migrations/023_*.sql` | Sequential schema changes |

## Migration Rules

1. **Sequential numbering:** `001_<name>.sql`, `002_<name>.sql`, etc.
2. **Never modify** a migration after it's been pushed
3. Each migration should be **idempotent** where possible (use `IF NOT EXISTS`)
4. **Update `docs/schema-reference.md`** in the same commit
5. Test against existing data before merging

## Core Tables

- `tasks` — Project tasks with status, priority, assignee, dependencies
- `projects` — Task containers with departments and status
- `saved_views` — Board/timeline filter presets
- `audit_log` — Mutation audit trail
- `workflow_runs` — Workflow execution records
- `workflow_agent_routing` — Agent routing rules
- `cron_jobs` — Scheduled job definitions
- `cron_job_runs` — Job execution history

## Adding a Migration

1. Create `migrations/<N+1>_<descriptive-name>.sql`
2. Include both `CREATE TABLE`/`ALTER TABLE` and any data migrations
3. Add corresponding `down` migration in comments if needed
4. Update `docs/schema-reference.md` with new table/column docs
5. Update `storage/asana.js` with new CRUD methods if needed


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
