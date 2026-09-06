-- 027_add_workspace_columns_to_projects_tasks.sql
-- workspace_id columns for projects + tasks.
--
-- History: the P3 Spaces feature (storage/asana.js) reads/writes
-- projects.workspace_id (create/update/list/copy/assign-to-workspace) and
-- tasks.workspace_id (copy-workspace insert, per-workspace reassign + counts),
-- but no migration and not the canonical schema/openclaw-dashboard.sql ever
-- defined those columns — the Spaces commit only shipped the workspaces
-- ALTER migrations (20260429_*). Databases provisioned without the private
-- bootstrap lack the columns: staging pg-livefire 400'd
-- POST /api/projects with
--   column "workspace_id" of relation "projects" does not exist
-- (found 2026-09-06 by the smoke test after the AUTH_ARGS fix let it reach
-- the route). Same pattern migration 026 fixed for the workspaces base
-- table. cron_jobs is NOT touched: no code path queries
-- cron_jobs.workspace_id (the docs claim was stale).
--
-- Existing rows keep workspace_id NULL — storage null-coalesces to the
-- default workspace at read/create time (createProject falls back to
-- `SELECT id FROM workspaces WHERE slug='default'`), so NULL is the honest
-- state; no fabricated backfill assignments.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL;

-- Storage filters/counts by workspace_id on both tables
-- (e.g. SELECT COUNT(*) FROM tasks WHERE workspace_id = $1).
CREATE INDEX IF NOT EXISTS idx_projects_workspace_id ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id);

INSERT INTO schema_migrations (migration_name)
VALUES ('027_add_workspace_columns_to_projects_tasks')
ON CONFLICT DO NOTHING;
