-- Migration 012: Add workflow artifacts
-- Phase 4: Add Artifacts And Rich Run Details

CREATE TABLE IF NOT EXISTS workflow_artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task_id UUID NULL REFERENCES tasks(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  label TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime_type TEXT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workflow_artifacts_status_check CHECK (
    status IN ('generated', 'attached', 'approved', 'rejected', 'archived')
  )
);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_run_id ON workflow_artifacts(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_task_id ON workflow_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_type ON workflow_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_status ON workflow_artifacts(status);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_created_by ON workflow_artifacts(created_by);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_created_at ON workflow_artifacts(created_at DESC);

CREATE TRIGGER update_workflow_artifacts_updated_at BEFORE UPDATE ON workflow_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Backfill artifacts from structured output summary URLs where possible.
INSERT INTO workflow_artifacts (
  workflow_run_id,
  task_id,
  artifact_type,
  label,
  uri,
  mime_type,
  status,
  metadata,
  created_by
)
SELECT
  wr.id,
  wr.task_id,
  CASE
    WHEN output_entry.key ILIKE '%image%' THEN 'image'
    WHEN output_entry.key ILIKE '%url%' THEN 'published_url'
    WHEN output_entry.key ILIKE '%draft%' THEN 'draft'
    ELSE 'output'
  END AS artifact_type,
  initcap(replace(output_entry.key, '_', ' ')) AS label,
  output_entry.value AS uri,
  NULL AS mime_type,
  'generated' AS status,
  jsonb_build_object('backfilled_from_output_summary', true, 'source_key', output_entry.key),
  wr.owner_agent_id
FROM workflow_runs wr
CROSS JOIN LATERAL jsonb_each_text(COALESCE(wr.output_summary, '{}'::jsonb)) AS output_entry(key, value)
WHERE jsonb_typeof(COALESCE(wr.output_summary, '{}'::jsonb)) = 'object'
  AND output_entry.value ~* '^(https?://|/|file:|s3://)'
  AND NOT EXISTS (
    SELECT 1
    FROM workflow_artifacts wa
    WHERE wa.workflow_run_id = wr.id
      AND wa.uri = output_entry.value
  );

-- Refresh run artifact counts after any backfill.
UPDATE workflow_runs wr
SET actual_artifact_count = artifact_counts.count,
    updated_at = NOW()
FROM (
  SELECT workflow_run_id, COUNT(*)::integer AS count
  FROM workflow_artifacts
  GROUP BY workflow_run_id
) AS artifact_counts
WHERE wr.id = artifact_counts.workflow_run_id;

INSERT INTO schema_migrations (migration_name)
VALUES ('012_add_workflow_artifacts')
ON CONFLICT DO NOTHING;
