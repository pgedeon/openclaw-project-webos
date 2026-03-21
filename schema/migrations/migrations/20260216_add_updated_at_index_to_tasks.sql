-- Add index on tasks.updated_at for efficient incremental sync queries
-- This migration supports the Incremental Sync + Pagination feature.

CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);

COMMIT;