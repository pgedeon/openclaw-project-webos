-- Migration 011: Extend workflow templates and runs with business context
-- Phase 3: Connect Service Requests To Workflow Templates And Runs

ALTER TABLE workflow_templates
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS artifact_contract JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS blocker_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS escalation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS runbook_ref TEXT NULL,
  ADD COLUMN IF NOT EXISTS ui_category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS service_request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_priority TEXT NULL,
  ADD COLUMN IF NOT EXISTS approval_state TEXT NULL,
  ADD COLUMN IF NOT EXISTS outcome_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS operator_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS expected_artifact_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_artifact_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS value_score NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS customer_scope TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_templates_department_id ON workflow_templates(department_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_service_id ON workflow_templates(service_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_ui_category ON workflow_templates(ui_category);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_service_request_id ON workflow_runs(service_request_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_department_id ON workflow_runs(department_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_run_priority ON workflow_runs(run_priority);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_approval_state ON workflow_runs(approval_state);

-- Backfill templates from the best matching service catalog row.
WITH mapped_services AS (
  SELECT DISTINCT ON (template_name)
    template_name,
    id AS service_id,
    department_id,
    intake_fields,
    metadata,
    sla_hours
  FROM (
    SELECT
      COALESCE(wt.name, sc.metadata->>'workflow_template_name') AS template_name,
      sc.id,
      sc.department_id,
      sc.intake_fields,
      sc.metadata,
      sc.sla_hours,
      sc.sort_order
    FROM service_catalog sc
    LEFT JOIN workflow_templates wt ON wt.id = sc.workflow_template_id
    WHERE COALESCE(wt.name, sc.metadata->>'workflow_template_name') IS NOT NULL
  ) candidates
  ORDER BY template_name, COALESCE(sort_order, 0) DESC, service_id
)
UPDATE workflow_templates wt
SET
  department_id = COALESCE(wt.department_id, mapped_services.department_id),
  service_id = COALESCE(wt.service_id, mapped_services.service_id),
  input_schema = CASE
    WHEN wt.input_schema = '{}'::jsonb
      THEN jsonb_build_object('fields', COALESCE(mapped_services.intake_fields, '[]'::jsonb))
    ELSE wt.input_schema
  END,
  artifact_contract = CASE
    WHEN wt.artifact_contract = '{}'::jsonb
      THEN jsonb_build_object('expected_outputs', COALESCE(wt.success_criteria, '{}'::jsonb))
    ELSE wt.artifact_contract
  END,
  blocker_policy = CASE
    WHEN wt.blocker_policy = '{}'::jsonb
      THEN jsonb_build_object('block_on_missing_inputs', true, 'block_on_failed_approvals', true)
    ELSE wt.blocker_policy
  END,
  escalation_policy = CASE
    WHEN wt.escalation_policy = '{}'::jsonb
      THEN jsonb_build_object(
        'sla_hours',
        COALESCE(mapped_services.sla_hours, 72),
        'escalate_to_department',
        true
      )
    ELSE wt.escalation_policy
  END,
  ui_category = CASE
    WHEN wt.ui_category = 'general' THEN COALESCE(NULLIF(wt.category, ''), 'general')
    ELSE wt.ui_category
  END,
  updated_at = NOW()
FROM mapped_services
WHERE wt.name = mapped_services.template_name;

-- Backfill workflow runs from already-recorded routing metadata where available.
UPDATE workflow_runs wr
SET
  service_request_id = COALESCE(wr.service_request_id, sr.id),
  department_id = COALESCE(wr.department_id, sr.target_department_id),
  run_priority = COALESCE(wr.run_priority, sr.priority),
  customer_scope = COALESCE(
    wr.customer_scope,
    NULLIF(sr.input_payload->>'site', ''),
    NULLIF(sr.input_payload->>'website', '')
  )
FROM service_requests sr
WHERE wr.service_request_id IS NULL
  AND sr.routing_decision->>'workflow_run_id' = wr.id::text;

INSERT INTO schema_migrations (migration_name)
VALUES ('011_extend_workflow_business_context')
ON CONFLICT DO NOTHING;
