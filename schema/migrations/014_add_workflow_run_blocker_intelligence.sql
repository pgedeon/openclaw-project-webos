-- Migration 014: Add workflow run blocker intelligence and operator control state
-- Extends workflow_runs with normalized blocker metadata, escalation state, and
-- operator pause/resume lifecycle fields for Phase 6.

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS blocker_detected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS blocker_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS blocker_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS escalation_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS escalated_to TEXT NULL,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paused_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS resumed_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_blocker_detected_at ON workflow_runs(blocker_detected_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_escalation_status ON workflow_runs(escalation_status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_escalated_to ON workflow_runs(escalated_to);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_paused_at ON workflow_runs(paused_at);

COMMENT ON COLUMN workflow_runs.blocker_detected_at IS 'When the current blocker was first classified or manually set.';
COMMENT ON COLUMN workflow_runs.blocker_source IS 'How the blocker was identified: manual, detector, operator.';
COMMENT ON COLUMN workflow_runs.blocker_metadata IS 'Structured blocker context such as stale step, retry, or approval counters.';
COMMENT ON COLUMN workflow_runs.escalation_status IS 'Current escalation lifecycle for a blocked run: escalated, acknowledged, resolved.';
COMMENT ON COLUMN workflow_runs.paused_at IS 'Operator pause timestamp for paused workflow runs.';
COMMENT ON COLUMN workflow_runs.pause_reason IS 'Operator-supplied pause reason.';
COMMENT ON COLUMN workflow_runs.resumed_at IS 'Last operator resume timestamp for paused workflow runs.';

INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '014_add_workflow_run_blocker_intelligence', NOW()
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'schema_migrations'
)
AND NOT EXISTS (
  SELECT 1 FROM schema_migrations
  WHERE migration_name = '014_add_workflow_run_blocker_intelligence'
);
