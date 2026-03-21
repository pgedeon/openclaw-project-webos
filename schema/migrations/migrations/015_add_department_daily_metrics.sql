-- Migration 015: Add department_daily_metrics snapshots
-- Phase 8: Business metrics and scorecards

CREATE TABLE IF NOT EXISTS department_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT department_daily_metrics_unique UNIQUE (department_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_department_daily_metrics_department
  ON department_daily_metrics(department_id);
CREATE INDEX IF NOT EXISTS idx_department_daily_metrics_metric_date
  ON department_daily_metrics(metric_date DESC);

CREATE TRIGGER update_department_daily_metrics_updated_at
  BEFORE UPDATE ON department_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE department_daily_metrics IS 'Daily department KPI snapshots for dashboard trend and scorecard views.';
COMMENT ON COLUMN department_daily_metrics.metrics IS 'Structured scorecard metrics payload for the department and metric date.';

INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '015_add_department_daily_metrics', NOW()
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'schema_migrations'
)
AND NOT EXISTS (
  SELECT 1 FROM schema_migrations
  WHERE migration_name = '015_add_department_daily_metrics'
);
