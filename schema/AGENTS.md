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
