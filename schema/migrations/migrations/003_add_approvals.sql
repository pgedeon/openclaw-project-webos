-- Migration: Add approvals system for workflow gates
-- Purpose: Implement approval gates by workflow step (Phase 4 Item 11)
-- Date: 2026-03-11

-- Approvals table
CREATE TABLE IF NOT EXISTS workflow_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL, -- which workflow step this approval is for (e.g., 'draft_approval')
  approver_id TEXT NOT NULL, -- user or agent id who should approve

  -- Approval state
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, cancelled
  decision TEXT NULL, -- notes from approver
  decided_at TIMESTAMPTZ NULL,

  -- Requester info
  requested_by TEXT NOT NULL, -- who requested this approval (usually system or agent)
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}', -- additional context (e.g., artifact URLs to review)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_run_id ON workflow_approvals(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_status ON workflow_approvals(status);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_approver_id ON workflow_approvals(approver_id);

-- Auto-update updated_at timestamp
CREATE TRIGGER update_workflow_approvals_updated_at BEFORE UPDATE ON workflow_approvals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Notify completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 003: Approvals table created for workflow gates';
END $$;
