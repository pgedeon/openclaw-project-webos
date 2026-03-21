-- Migration: Add blocker classification
-- Purpose: Track explicit blocker types (Phase 4 Item 12)
-- Date: 2026-03-11

-- Add blocker_type to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocker_type TEXT NULL;
COMMENT ON COLUMN tasks.blocker_type IS 'Type of blocker if task is blocked: waiting_on_agent, waiting_on_approval, waiting_on_external_service, content_failed_qa, other';

-- Add blocker_description for free-text details
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocker_description TEXT NULL;

-- Also add blocker tracking to workflow_runs for consistency
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS blocker_type TEXT NULL;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS blocker_description TEXT NULL;

-- Index for queries looking for blocked items
CREATE INDEX IF NOT EXISTS idx_tasks_blocker_type ON tasks(blocker_type);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_blocker_type ON workflow_runs(blocker_type);

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 004: Blocker classification added to tasks and workflow_runs';
END $$;
