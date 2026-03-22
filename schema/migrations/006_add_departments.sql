-- Migration 006: Add departments table for organizational modeling
-- Phase 1: Explicit Organization And Agent Profile Modeling

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',  -- hex color for UI
  icon VARCHAR(50) DEFAULT 'folder',   -- lucide icon name
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_departments_sort_order ON departments(sort_order);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

-- Seed with initial departments based on agent configuration
INSERT INTO departments (name, description, color, icon, sort_order, metadata) VALUES
  ('Core Platform', 'Primary orchestrator and platform agents', '#6366f1', 'cpu', 10, '{"agents": ["main", "coder", "antfarm-medic"]}'),
  ('Content & Publishing', 'Blog content, SEO, affiliate, and publishing pipeline', '#22c55e', 'file-text', 20, '{"agents": ["affiliate-editorial", "blogger-affiliate-manager", "blogger-inventory", "topic-planner", "product-finder", "seo-rewriter", "blogger-publisher", "qa-auditor", "video-discoverer", "benchmark-labs-writer"]}'),
  ('Bug Fix Pipeline', 'Bug triage, investigation, fixing, and verification', '#ef4444', 'bug', 30, '{"agents": ["bug-fix_triager", "bug-fix_investigator", "bug-fix_setup", "bug-fix_fixer", "bug-fix_verifier", "bug-fix_pr"]}'),
  ('Security Pipeline', 'Security scanning, auditing, and remediation', '#f59e0b', 'shield', 40, '{"agents": ["security-audit_scanner", "security-audit_prioritizer", "security-audit_setup", "security-audit_fixer", "security-audit_verifier", "security-audit_tester", "security-audit_pr"]}'),
  ('Feature Development', 'Feature planning, development, and review', '#8b5cf6', 'code', 50, '{"agents": ["feature-dev_planner", "feature-dev_setup", "feature-dev_developer", "feature-dev_verifier", "feature-dev_tester", "feature-dev_reviewer"]}'),
  ('Web Properties', 'Website management and development', '#06b6d4', 'globe', 60, '{"agents": ["3dput", "sailboats-fr", "sailboats-fr-jobs"]}'),
  ('Media & Vision', 'Image processing, vision, and media generation', '#ec4899', 'image', 70, '{"agents": ["vision-agent", "comfyui-image-agent", "image-prompt-writer", "image-source-selector"]}'),
  ('Research & Analysis', 'Research, data integrity, and analysis', '#14b8a6', 'search', 80, '{"agents": ["us-spending-integrity"]}'),
  ('Automation', 'Serial automation and workflow agents', '#f97316', 'zap', 90, '{"agents": ["serial-automator"]}')
ON CONFLICT (name) DO NOTHING;

-- Track this migration
INSERT INTO schema_migrations (migration_name) VALUES ('006_add_departments') ON CONFLICT DO NOTHING;
