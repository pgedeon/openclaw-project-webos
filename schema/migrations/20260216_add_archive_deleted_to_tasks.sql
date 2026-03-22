-- 20260216_add_archive_deleted_to_tasks.sql
-- Add soft-delete and archiving support to tasks table

-- Add archived_at and deleted_at columns
ALTER TABLE tasks ADD COLUMN archived_at TIMESTAMP NULL;
ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP NULL;

-- Indexes for efficient filtering
CREATE INDEX idx_tasks_status_archived ON tasks(status, archived_at);
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);
