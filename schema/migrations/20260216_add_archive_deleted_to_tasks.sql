-- 20260216_add_archive_deleted_to_tasks.sql
-- Add soft-delete and archiving support to tasks table

-- Add archived_at and deleted_at columns
-- Idempotent (IF NOT EXISTS): the staging DB (pg-livefire, openclaw_dashboard)
-- was created without this migration, which left /api/tasks/all failing with
-- "column t.deleted_at does not exist" and MCP list_tasks erroring 8/8.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_tasks_status_archived ON tasks(status, archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);
