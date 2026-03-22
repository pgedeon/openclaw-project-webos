-- Migration: Add workflow agent routing and dispatcher v2 state
-- Purpose: Support database-first workflow dispatching with DB-backed agent routing,
--          atomic claims, and stale run recovery.
-- Date: 2026-03-22

CREATE TABLE IF NOT EXISTS workflow_agent_routing (
  workflow_type VARCHAR(100) PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  timeout_minutes INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_agent_routing_agent_id
  ON workflow_agent_routing(agent_id);

CREATE INDEX IF NOT EXISTS idx_workflow_agent_routing_priority
  ON workflow_agent_routing(priority DESC);

ALTER TABLE IF EXISTS workflow_runs
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS claim_session_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS workflow_runs
  ALTER COLUMN dispatch_attempts SET DEFAULT 0;

UPDATE workflow_runs
SET dispatch_attempts = 0
WHERE dispatch_attempts IS NULL;

ALTER TABLE IF EXISTS workflow_runs
  ALTER COLUMN dispatch_attempts SET NOT NULL;

ALTER TABLE IF EXISTS workflow_runs
  DROP CONSTRAINT IF EXISTS valid_workflow_run_status;

ALTER TABLE IF EXISTS workflow_runs
  ADD CONSTRAINT valid_workflow_run_status CHECK (status IN (
    'queued',
    'dispatched',
    'claimed',
    'running',
    'waiting_for_approval',
    'blocked',
    'retrying',
    'completed',
    'failed',
    'cancelled',
    'timed_out'
  ));

CREATE INDEX IF NOT EXISTS idx_workflow_runs_dispatch_status
  ON workflow_runs(status, dispatched_at);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_claim_status
  ON workflow_runs(status, last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_claim_session_id
  ON workflow_runs(claim_session_id);

COMMENT ON COLUMN workflow_runs.dispatched_at IS 'Timestamp when the dispatcher last exposed the run to agents.';
COMMENT ON COLUMN workflow_runs.claimed_at IS 'Timestamp when an agent atomically claimed the run for execution.';
COMMENT ON COLUMN workflow_runs.claimed_by IS 'Agent identifier that successfully claimed the run.';
COMMENT ON COLUMN workflow_runs.claim_session_id IS 'Gateway session identifier that currently owns the claimed run.';
COMMENT ON COLUMN workflow_runs.dispatch_attempts IS 'Number of DB-backed dispatch attempts, including the initial dispatch.';
