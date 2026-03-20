-- Migration 013: Extend workflow approvals with artifacts, due dates, and escalation
-- Phase 5: Make Approvals Workflow-Aware

ALTER TABLE workflow_approvals
  ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'step_gate',
  ADD COLUMN IF NOT EXISTS artifact_id UUID NULL REFERENCES workflow_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS escalated_to TEXT NULL,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS required_note BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decided_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_artifact_id ON workflow_approvals(artifact_id);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_due_at ON workflow_approvals(due_at);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_expires_at ON workflow_approvals(expires_at);
CREATE INDEX IF NOT EXISTS idx_workflow_approvals_escalated_to ON workflow_approvals(escalated_to);

UPDATE workflow_approvals
SET due_at = COALESCE(due_at, requested_at + INTERVAL '24 hours'),
    expires_at = COALESCE(expires_at, requested_at + INTERVAL '24 hours')
WHERE due_at IS NULL OR expires_at IS NULL;

INSERT INTO schema_migrations (migration_name)
VALUES ('013_extend_workflow_approvals')
ON CONFLICT DO NOTHING;
