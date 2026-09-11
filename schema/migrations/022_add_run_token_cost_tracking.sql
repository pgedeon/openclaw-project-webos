-- Migration: Add per-run token/cost tracking
-- Purpose: Accumulate LLM token usage and cost estimates on workflow runs so analytics history exists before any UI ships
-- Date: 2026-08-23
-- Part of: UPGRADE_ROADMAP.md Phase 0 - "Cost/token schema now" (advisory: waiting destroys data)

-- Token usage columns (NULL = not reported yet)
ALTER TABLE workflow_runs
ADD COLUMN IF NOT EXISTS input_tokens BIGINT,
ADD COLUMN IF NOT EXISTS output_tokens BIGINT,
ADD COLUMN IF NOT EXISTS cached_tokens BIGINT;

-- Model and cost estimate columns
ALTER TABLE workflow_runs
ADD COLUMN IF NOT EXISTS model_id TEXT,
ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC(12,6),
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;

-- Column comments
COMMENT ON COLUMN workflow_runs.input_tokens IS 'Prompt/input tokens consumed by the run (as reported by the gateway)';
COMMENT ON COLUMN workflow_runs.output_tokens IS 'Completion/output tokens produced by the run';
COMMENT ON COLUMN workflow_runs.cached_tokens IS 'Tokens served from cache (subset of input tokens)';
COMMENT ON COLUMN workflow_runs.model_id IS 'Primary model used for this run (e.g., claude-sonnet-4-5)';
COMMENT ON COLUMN workflow_runs.cost_estimate IS 'Estimated cost of the run in currency units';
COMMENT ON COLUMN workflow_runs.currency IS 'ISO 4217 currency code for cost_estimate';
COMMENT ON COLUMN workflow_runs.reported_at IS 'When usage/cost was last reported for this run';

COMMIT;
