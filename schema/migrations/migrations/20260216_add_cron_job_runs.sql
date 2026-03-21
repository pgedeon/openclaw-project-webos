-- Cron Job Runs: Track execution history with outcomes
-- This complements the file-based cron system with structured database records

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  exit_code INTEGER NULL,
  output TEXT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running, success, failure
  duration_ms INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job_id ON cron_job_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_started_at ON cron_job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status);

-- Optional: auto-delete old runs after 90 days (adjust as needed)
-- DELETE FROM cron_job_runs WHERE started_at < NOW() - INTERVAL '90 days';
-- To automate, create a cron job for that cleanup.

COMMIT;
