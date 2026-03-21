-- Migration: Add structured workflow queue states
-- Purpose: Add explicit queue states for content and publishing workflows
-- Date: 2026-03-11
-- Part of: Dashboard Workflow Upgrade Plan Phase 3 Item 9

-- Extend tasks.status CHECK constraint to include new queue states
-- Preserve existing statuses: backlog, ready, archived, review, completed, in_progress, blocked

-- Drop existing constraint if exists
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

-- Recreate with expanded allowed values
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    -- Existing (preserved)
    'backlog',
    'ready',
    'archived',
    'review',
    'completed',
    'in_progress',
    'blocked',
    -- Content workflow queues (new)
    'topic_candidate',
    'drafting',
    'image_pending',
    'image_ready',
    'qa_pending',
    'ready_to_publish',
    'published',
    -- Generic (new)
    'retrying',
    'failed',
    'cancelled'
  ));

-- Create index for status if not exists
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 002: Workflow queue states added to tasks.status constraint';
END $$;
