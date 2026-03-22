-- Migration: Add error details tracking to workflow runs
-- Purpose: Capture detailed error context for failed workflow runs
-- Date: 2026-03-21
-- Part of: System improvement - better error logging

-- Add error_details column to store structured error information
ALTER TABLE workflow_runs
ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '{}';

-- Add index for error_details searches
CREATE INDEX IF NOT EXISTS idx_workflow_runs_error_details ON workflow_runs USING GIN(error_details);

-- Update comment
COMMENT ON COLUMN workflow_runs.error_details IS 'Structured error information including stack trace, current step, and context when run failed';

COMMIT;
