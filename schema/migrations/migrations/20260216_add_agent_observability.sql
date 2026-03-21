-- Agent Observability: heartbeats and task run history
-- Run: psql -d openclaw_dashboard -f this_file.sql

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_name TEXT PRIMARY KEY,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'online', -- online, offline, error
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_agent_heartbeats_last_seen ON agent_heartbeats(last_seen_at);

CREATE TABLE IF NOT EXISTS task_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL, -- pending, running, success, failure
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  error_summary TEXT NULL,
  output_summary TEXT NULL,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'running', 'success', 'failure'))
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_agent_name ON task_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_task_runs_started_at ON task_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_agent_attempt ON task_runs(task_id, agent_name, attempt_number);

-- Add retry_count to tasks for quick access
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE agent_heartbeats IS 'Tracks agent liveness via periodic heartbeat signals.';
COMMENT ON TABLE task_runs IS 'Log of every task execution attempt by agents, used for retry, history, and observability.';

COMMIT;
