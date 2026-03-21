-- Migration: Add workflow_runs table
-- Purpose: Track actual execution instances of workflows
-- Date: 2026-03-11
-- Part of: Dashboard Workflow Upgrade Plan Phase 1 Item 1

-- Workflow Runs: track actual execution of a workflow
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Context: which board/task this run belongs to
  board_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
  
  -- Workflow template information
  workflow_type TEXT NOT NULL, -- e.g., 'affiliate-article', 'image-generation', 'wordpress-publish'
  
  -- Agent ownership
  owner_agent_id TEXT NOT NULL, -- agent name (e.g., '3dput', 'affiliate-editorial')
  initiator TEXT NULL, -- who/what started this run (user, agent, schedule)
  
  -- Execution state
  status TEXT NOT NULL DEFAULT 'queued',
  -- Valid statuses: 'queued', 'running', 'waiting_for_approval', 'blocked', 'retrying', 'completed', 'failed', 'cancelled'
  
  current_step TEXT NULL, -- current step in the workflow (e.g., 'drafting', 'image_generation', 'qa_review')
  
  -- Timing
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  last_heartbeat_at TIMESTAMPTZ NULL,
  
  -- Retry and error tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT NULL,
  last_error_at TIMESTAMPTZ NULL,
  
  -- Input and output
  input_payload JSONB NOT NULL DEFAULT '{}', -- task parameters, config, etc.
  output_summary JSONB NOT NULL DEFAULT '{}', -- results, artifacts, URLs
  
  -- Gateway session binding (link to live OpenClaw session)
  gateway_session_id TEXT NULL, -- which gateway session is working this run
  gateway_session_active BOOLEAN NOT NULL DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_workflow_run_status CHECK (status IN (
    'queued', 
    'running', 
    'waiting_for_approval', 
    'blocked', 
    'retrying', 
    'completed', 
    'failed', 
    'cancelled'
  ))
);

-- Indexes for common queries
CREATE INDEX idx_workflow_runs_board_id ON workflow_runs(board_id);
CREATE INDEX idx_workflow_runs_task_id ON workflow_runs(task_id);
CREATE INDEX idx_workflow_runs_owner_agent_id ON workflow_runs(owner_agent_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_workflow_type ON workflow_runs(workflow_type);
CREATE INDEX idx_workflow_runs_started_at ON workflow_runs(started_at);
CREATE INDEX idx_workflow_runs_last_heartbeat_at ON workflow_runs(last_heartbeat_at);
CREATE INDEX idx_workflow_runs_gateway_session ON workflow_runs(gateway_session_id);

-- GIN indexes for JSONB fields
CREATE INDEX idx_workflow_runs_input_payload ON workflow_runs USING GIN(input_payload);
CREATE INDEX idx_workflow_runs_output_summary ON workflow_runs USING GIN(output_summary);

-- Auto-update updated_at timestamp
CREATE TRIGGER update_workflow_runs_updated_at BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Workflow Steps: track individual steps within a run (for timeline)
CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  
  -- Step identification
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  
  -- Step state
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed', 'skipped'
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  
  -- Step output
  output JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_workflow_step_status CHECK (status IN (
    'pending', 
    'in_progress', 
    'completed', 
    'failed', 
    'skipped'
  ))
);

-- Indexes for workflow_steps
CREATE INDEX idx_workflow_steps_run_id ON workflow_steps(workflow_run_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status);
CREATE INDEX idx_workflow_steps_step_order ON workflow_steps(step_order);

-- Auto-update updated_at timestamp
CREATE TRIGGER update_workflow_steps_updated_at BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Workflow Templates: define reusable workflow types
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Template identification
  name TEXT NOT NULL UNIQUE, -- 'affiliate-article', 'image-generation', etc.
  display_name TEXT NOT NULL, -- 'Affiliate Article Workflow'
  description TEXT NOT NULL DEFAULT '',
  
  -- Template configuration
  default_owner_agent TEXT NOT NULL, -- which agent should own runs by default
  steps JSONB NOT NULL DEFAULT '[]', -- ordered list of step definitions
  -- Example: [
  --   {"name": "topic_discovery", "display_name": "Topic Discovery", "required": true},
  --   {"name": "drafting", "display_name": "Content Drafting", "required": true},
  --   {"name": "image_generation", "display_name": "Image Generation", "required": false},
  --   {"name": "qa_review", "display_name": "QA Review", "required": true},
  --   {"name": "publish", "display_name": "Publish", "required": true}
  -- ]
  
  required_approvals JSONB NOT NULL DEFAULT '[]', -- which steps require approval
  -- Example: ["draft_approval", "publish_approval"]
  
  success_criteria JSONB NOT NULL DEFAULT '{}', -- what defines success
  -- Example: {"live_url": "required", "affiliate_links_valid": true}
  
  -- Metadata
  category TEXT NOT NULL DEFAULT 'general', -- 'content', 'publishing', 'maintenance', 'incident'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for workflow_templates
CREATE INDEX idx_workflow_templates_category ON workflow_templates(category);
CREATE INDEX idx_workflow_templates_is_active ON workflow_templates(is_active);

-- Auto-update updated_at timestamp
CREATE TRIGGER update_workflow_templates_updated_at BEFORE UPDATE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update tasks table to link to active workflow run
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS active_workflow_run_id UUID NULL REFERENCES workflow_runs(id) ON DELETE SET NULL;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS idx_tasks_active_workflow_run_id ON tasks(active_workflow_run_id);

-- View: Active workflow runs with task context
CREATE OR REPLACE VIEW active_workflow_runs AS
SELECT
  wr.id,
  wr.workflow_type,
  wr.status,
  wr.current_step,
  wr.owner_agent_id,
  wr.initiator,
  wr.started_at,
  wr.finished_at,
  wr.last_heartbeat_at,
  wr.retry_count,
  wr.last_error,
  wr.gateway_session_id,
  wr.gateway_session_active,
  t.id as task_id,
  t.title as task_title,
  t.status as task_status,
  p.id as board_id,
  p.name as board_name,
  EXTRACT(EPOCH FROM (NOW() - wr.started_at)) as elapsed_seconds,
  CASE
    WHEN wr.last_heartbeat_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at))
  END as heartbeat_age_seconds
FROM workflow_runs wr
LEFT JOIN tasks t ON wr.task_id = t.id
LEFT JOIN projects p ON wr.board_id = p.id
WHERE wr.status IN ('queued', 'running', 'waiting_for_approval', 'blocked', 'retrying');

-- View: Stuck workflow runs (for monitoring)
CREATE OR REPLACE VIEW stuck_workflow_runs AS
SELECT
  wr.id,
  wr.workflow_type,
  wr.status,
  wr.current_step,
  wr.owner_agent_id,
  wr.last_heartbeat_at,
  EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) as heartbeat_age_seconds,
  t.title as task_title,
  CASE
    WHEN wr.gateway_session_active = false THEN 'session_inactive'
    WHEN wr.last_heartbeat_at IS NULL THEN 'no_heartbeat'
    WHEN EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) > 600 THEN 'heartbeat_stale'
    WHEN wr.retry_count >= wr.max_retries THEN 'max_retries_exceeded'
    ELSE 'unknown'
  END as stuck_reason
FROM workflow_runs wr
LEFT JOIN tasks t ON wr.task_id = t.id
WHERE wr.status IN ('running', 'blocked', 'retrying')
  AND (
    wr.gateway_session_active = false
    OR wr.last_heartbeat_at IS NULL
    OR EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) > 600
    OR wr.retry_count >= wr.max_retries
  );

-- Insert default workflow templates
INSERT INTO workflow_templates (name, display_name, description, default_owner_agent, category, steps, required_approvals, success_criteria)
VALUES
  (
    'affiliate-article',
    'Affiliate Article Workflow',
    'Complete workflow for creating and publishing affiliate content',
    'affiliate-editorial',
    'content',
    '[
      {"name": "topic_discovery", "display_name": "Topic Discovery", "required": true},
      {"name": "product_matching", "display_name": "Product Matching", "required": true},
      {"name": "drafting", "display_name": "Content Drafting", "required": true},
      {"name": "image_generation", "display_name": "Image Generation", "required": false},
      {"name": "qa_review", "display_name": "QA Review", "required": true},
      {"name": "publish", "display_name": "Publish", "required": true},
      {"name": "verification", "display_name": "Live Verification", "required": true}
    ]'::jsonb,
    '["draft_approval", "publish_approval"]'::jsonb,
    '{"live_url": "required", "affiliate_links_valid": true, "featured_image_present": true}'::jsonb
  ),
  (
    'image-generation',
    'Image Generation Lane',
    'Generate images for content using ComfyUI',
    'comfyui-image-agent',
    'content',
    '[
      {"name": "prompt_creation", "display_name": "Prompt Creation", "required": true},
      {"name": "generation", "display_name": "Image Generation", "required": true},
      {"name": "qa_check", "display_name": "Quality Check", "required": true},
      {"name": "delivery", "display_name": "Delivery", "required": true}
    ]'::jsonb,
    '["qa_approval"]'::jsonb,
    '{"image_url": "required", "meets_quality_standards": true}'::jsonb
  ),
  (
    'wordpress-publish',
    'WordPress Publish Workflow',
    'Publish content to WordPress with verification',
    '3dput',
    'publishing',
    '[
      {"name": "prepublish_check", "display_name": "Pre-publish Checks", "required": true},
      {"name": "publish", "display_name": "Publish to WordPress", "required": true},
      {"name": "verification", "display_name": "Live Verification", "required": true}
    ]'::jsonb,
    '["publish_approval"]'::jsonb,
    '{"live_url": "required", "mobile_rendering_ok": true}'::jsonb
  ),
  (
    'site-fix',
    'Site Fix Workflow',
    'Investigate and fix site issues',
    '3dput',
    'maintenance',
    '[
      {"name": "investigation", "display_name": "Investigation", "required": true},
      {"name": "diagnosis", "display_name": "Diagnosis", "required": true},
      {"name": "fix_implementation", "display_name": "Fix Implementation", "required": true},
      {"name": "testing", "display_name": "Testing", "required": true},
      {"name": "deployment", "display_name": "Deployment", "required": true}
    ]'::jsonb,
    '["fix_approval"]'::jsonb,
    '{"issue_resolved": true, "tests_passing": true}'::jsonb
  ),
  (
    'incident-investigation',
    'Incident Investigation Workflow',
    'Investigate and resolve incidents',
    'main',
    'incident',
    '[
      {"name": "triage", "display_name": "Triage", "required": true},
      {"name": "investigation", "display_name": "Investigation", "required": true},
      {"name": "root_cause", "display_name": "Root Cause Analysis", "required": true},
      {"name": "remediation", "display_name": "Remediation", "required": true},
      {"name": "prevention", "display_name": "Prevention Measures", "required": true}
    ]'::jsonb,
    '["remediation_approval"]'::jsonb,
    '{"incident_resolved": true, "prevention_in_place": true}'::jsonb
  ),
  (
    'code-change',
    'Code Change Workflow',
    'Implement code changes with review',
    'coder',
    'development',
    '[
      {"name": "planning", "display_name": "Planning", "required": true},
      {"name": "implementation", "display_name": "Implementation", "required": true},
      {"name": "testing", "display_name": "Testing", "required": true},
      {"name": "review", "display_name": "Code Review", "required": true},
      {"name": "merge", "display_name": "Merge", "required": true}
    ]'::jsonb,
    '["review_approval"]'::jsonb,
    '{"tests_passing": true, "review_approved": true}'::jsonb
  ),
  (
    'qa-review',
    'QA Review Workflow',
    'Quality assurance review of content or code',
    'qa-auditor',
    'quality',
    '[
      {"name": "intake", "display_name": "Intake", "required": true},
      {"name": "review", "display_name": "Review", "required": true},
      {"name": "feedback", "display_name": "Feedback", "required": true},
      {"name": "rework", "display_name": "Rework (if needed)", "required": false},
      {"name": "final_approval", "display_name": "Final Approval", "required": true}
    ]'::jsonb,
    '["final_approval"]'::jsonb,
    '{"standards_met": true}'::jsonb
  )
ON CONFLICT (name) DO NOTHING;

COMMIT;
