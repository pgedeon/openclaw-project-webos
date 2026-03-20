-- Migration 007: Add agent_profiles table for explicit agent-to-department mapping
-- Phase 1: Explicit Organization And Agent Profile Modeling

CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR(255) NOT NULL UNIQUE,  -- matches openclaw.json agent.id
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  display_name VARCHAR(255) NOT NULL,
  role VARCHAR(100),                       -- e.g., 'orchestrator', 'specialist', 'pipeline'
  model_primary VARCHAR(255),              -- primary model from openclaw.json
  capabilities JSONB DEFAULT '[]',         -- e.g., ['coding', 'vision', 'content']
  status VARCHAR(50) DEFAULT 'active',     -- active, inactive, deprecated
  workspace_path TEXT,                     -- agent workspace directory
  metadata JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_profiles_agent_id ON agent_profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_department ON agent_profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON agent_profiles(status);

-- Seed agent profiles from openclaw.json configuration
-- Core Platform
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('main', (SELECT id FROM departments WHERE name = 'Core Platform'), 'Main Agent', 'orchestrator', 'openrouter/hunter-alpha', '["orchestration", "coding", "analysis", "memory"]'),
  ('coder', (SELECT id FROM departments WHERE name = 'Core Platform'), 'Coder', 'specialist', 'zai/glm-5', '["coding", "debugging", "refactoring"]'),
  ('antfarm-medic', (SELECT id FROM departments WHERE name = 'Core Platform'), 'Antfarm Medic', 'specialist', 'zai/glm-4.7', '["diagnostics", "repair"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Content & Publishing
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('affiliate-editorial', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Affiliate Editorial', 'specialist', 'zai/glm-4.7', '["content", "seo", "affiliate"]'),
  ('blogger-affiliate-manager', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Affiliate Manager', 'specialist', 'stepfun/step-3.5-flash:free', '["affiliate", "management"]'),
  ('blogger-inventory', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Blogger Inventory', 'specialist', 'stepfun/step-3.5-flash:free', '["inventory", "tracking"]'),
  ('topic-planner', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Topic Planner', 'specialist', 'stepfun/step-3.5-flash:free', '["planning", "topics"]'),
  ('product-finder', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Product Finder', 'specialist', 'stepfun/step-3.5-flash:free', '["products", "research"]'),
  ('seo-rewriter', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'SEO Rewriter', 'specialist', 'stepfun/step-3.5-flash:free', '["seo", "writing"]'),
  ('blogger-publisher', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Blogger Publisher', 'specialist', 'stepfun/step-3.5-flash:free', '["publishing", "wordpress"]'),
  ('qa-auditor', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'QA Auditor', 'specialist', 'zai/glm-4.7', '["quality", "auditing"]'),
  ('video-discoverer', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Video Discoverer', 'specialist', 'stepfun/step-3.5-flash:free', '["video", "discovery"]'),
  ('benchmark-labs-writer', (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'Benchmark Labs Writer', 'specialist', 'stepfun/step-3.5-flash:free', '["writing", "benchmarks"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Bug Fix Pipeline
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('bug-fix_triager', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'Triager', 'pipeline', 'stepfun/step-3.5-flash:free', '["triage", "classification"]'),
  ('bug-fix_investigator', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'Investigator', 'pipeline', 'zai/glm-5', '["investigation", "debugging"]'),
  ('bug-fix_setup', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'Setup', 'pipeline', 'stepfun/step-3.5-flash:free', '["setup", "environment"]'),
  ('bug-fix_fixer', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'Fixer', 'pipeline', 'zai/glm-5', '["coding", "fixing"]'),
  ('bug-fix_verifier', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'Verifier', 'pipeline', 'zai/glm-4.7', '["verification", "testing"]'),
  ('bug-fix_pr', (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'PR Creator', 'pipeline', 'stepfun/step-3.5-flash:free', '["git", "pull-requests"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Security Pipeline
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('security-audit_scanner', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Scanner', 'pipeline', 'stepfun/step-3.5-flash:free', '["scanning", "security"]'),
  ('security-audit_prioritizer', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Prioritizer', 'pipeline', 'stepfun/step-3.5-flash:free', '["prioritization", "risk-assessment"]'),
  ('security-audit_setup', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Setup', 'pipeline', 'stepfun/step-3.5-flash:assistant', '["setup", "environment"]'),
  ('security-audit_fixer', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Fixer', 'pipeline', 'stepfun/step-3.5-flash:free', '["fixing", "patching"]'),
  ('security-audit_verifier', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Verifier', 'pipeline', 'stepfun/step-3.5-flash:free', '["verification", "testing"]'),
  ('security-audit_tester', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'Tester', 'pipeline', 'stepfun/step-3.5-flash:free', '["testing", "penetration"]'),
  ('security-audit_pr', (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'PR Creator', 'pipeline', 'stepfun/step-3.5-flash:free', '["git", "pull-requests"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Feature Development
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('feature-dev_planner', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Planner', 'pipeline', 'zai/glm-5', '["planning", "architecture"]'),
  ('feature-dev_setup', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Setup', 'pipeline', 'stepfun/step-3.5-flash:free', '["setup", "environment"]'),
  ('feature-dev_developer', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Developer', 'pipeline', 'zai/glm-5', '["coding", "implementation"]'),
  ('feature-dev_verifier', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Verifier', 'pipeline', 'zai/glm-4.7', '["verification", "review"]'),
  ('feature-dev_tester', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Tester', 'pipeline', 'zai/glm-4.7', '["testing", "qa"]'),
  ('feature-dev_reviewer', (SELECT id FROM departments WHERE name = 'Feature Development'), 'Reviewer', 'pipeline', 'zai/glm-4.7', '["review", "code-review"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Web Properties
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('3dput', (SELECT id FROM departments WHERE name = 'Web Properties'), '3dput', 'specialist', 'zai/glm-4.7', '["3d-printing", "website"]'),
  ('sailboats-fr', (SELECT id FROM departments WHERE name = 'Web Properties'), 'Sailboats Developer', 'specialist', 'zai/glm-4.7', '["web-development", "maritime"]'),
  ('sailboats-fr-jobs', (SELECT id FROM departments WHERE name = 'Web Properties'), 'Sailboats Jobs', 'specialist', 'stepfun/step-3.5-flash:free', '["jobs", "scraping"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Media & Vision
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('vision-agent', (SELECT id FROM departments WHERE name = 'Media & Vision'), 'Vision Processor', 'specialist', 'nvidia/nemotron-nano-12b-v2-vl:free', '["vision", "image-analysis"]'),
  ('comfyui-image-agent', (SELECT id FROM departments WHERE name = 'Media & Vision'), 'ComfyUI Image Agent', 'specialist', 'stepfun/step-3.5-flash:free', '["image-generation", "comfyui"]'),
  ('image-prompt-writer', (SELECT id FROM departments WHERE name = 'Media & Vision'), 'Image Prompt Writer', 'specialist', 'stepfun/step-3.5-flash:free', '["prompts", "writing"]'),
  ('image-source-selector', (SELECT id FROM departments WHERE name = 'Media & Vision'), 'Image Source Selector', 'specialist', 'stepfun/step-3.5-flash:free', '["images", "selection"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Research & Analysis
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('us-spending-integrity', (SELECT id FROM departments WHERE name = 'Research & Analysis'), 'US Spending Integrity', 'specialist', 'zai/glm-4.7', '["research", "data-integrity"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Automation
INSERT INTO agent_profiles (agent_id, department_id, display_name, role, model_primary, capabilities) VALUES
  ('serial-automator', (SELECT id FROM departments WHERE name = 'Automation'), 'Serial Automator', 'specialist', 'zai/glm-4.7', '["automation", "workflows"]')
ON CONFLICT (agent_id) DO NOTHING;

-- Track this migration
INSERT INTO schema_migrations (migration_name) VALUES ('007_add_agent_profiles') ON CONFLICT DO NOTHING;
