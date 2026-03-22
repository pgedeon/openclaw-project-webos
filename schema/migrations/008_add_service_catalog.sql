-- Migration 008: Add service_catalog table
-- Phase 2: Service Catalog And Service Requests

CREATE TABLE IF NOT EXISTS service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  default_agent_id VARCHAR(255),  -- references agent_profiles.agent_id
  workflow_template_id UUID,      -- references workflow_templates.id when available
  intake_fields JSONB DEFAULT '[]', -- fields required for this service request
  sla_hours INTEGER DEFAULT 72,     -- service level agreement in hours
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_slug ON service_catalog(slug);
CREATE INDEX IF NOT EXISTS idx_service_catalog_department ON service_catalog(department_id);
CREATE INDEX IF NOT EXISTS idx_service_catalog_active ON service_catalog(is_active);

-- Seed service catalog
INSERT INTO service_catalog (name, slug, description, department_id, default_agent_id, sla_hours, intake_fields, sort_order) VALUES
  ('Bug Report', 'bug-report', 'Report a bug or defect for investigation and fix', 
   (SELECT id FROM departments WHERE name = 'Bug Fix Pipeline'), 'bug-fix_triager', 48,
   '[{"name":"title","type":"text","required":true,"label":"Bug Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"steps_to_reproduce","type":"textarea","required":false,"label":"Steps to Reproduce"},{"name":"severity","type":"select","required":true,"options":["critical","high","medium","low"],"label":"Severity"}]', 10),
  
  ('Security Issue', 'security-issue', 'Report a security vulnerability or concern',
   (SELECT id FROM departments WHERE name = 'Security Pipeline'), 'security-audit_scanner', 24,
   '[{"name":"title","type":"text","required":true,"label":"Issue Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"affected_system","type":"text","required":false,"label":"Affected System"},{"name":"severity","type":"select","required":true,"options":["critical","high","medium","low"],"label":"Severity"}]', 20),
  
  ('Feature Request', 'feature-request', 'Request a new feature or enhancement',
   (SELECT id FROM departments WHERE name = 'Feature Development'), 'feature-dev_planner', 168,
   '[{"name":"title","type":"text","required":true,"label":"Feature Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"use_case","type":"textarea","required":false,"label":"Use Case"},{"name":"priority","type":"select","required":true,"options":["high","medium","low"],"label":"Priority"}]', 30),
  
  ('Content Creation', 'content-creation', 'Request new content, blog post, or article',
   (SELECT id FROM departments WHERE name = 'Content & Publishing'), 'topic-planner', 72,
   '[{"name":"title","type":"text","required":true,"label":"Content Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"target_audience","type":"text","required":false,"label":"Target Audience"},{"name":"content_type","type":"select","required":true,"options":["blog-post","article","guide","review"],"label":"Content Type"}]', 40),
  
  ('Data Research', 'data-research', 'Request data analysis or research task',
   (SELECT id FROM departments WHERE name = 'Research & Analysis'), 'us-spending-integrity', 96,
   '[{"name":"title","type":"text","required":true,"label":"Research Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"data_sources","type":"textarea","required":false,"label":"Data Sources"}]', 50),
  
  ('Image Generation', 'image-generation', 'Request image creation or visual content',
   (SELECT id FROM departments WHERE name = 'Media & Vision'), 'comfyui-image-agent', 48,
   '[{"name":"title","type":"text","required":true,"label":"Image Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"style","type":"text","required":false,"label":"Style Reference"},{"name":"dimensions","type":"text","required":false,"label":"Dimensions"}]', 60),
  
  ('Website Update', 'website-update', 'Request changes to a web property',
   (SELECT id FROM departments WHERE name = 'Web Properties'), '3dput', 72,
   '[{"name":"title","type":"text","required":true,"label":"Update Title"},{"name":"description","type":"textarea","required":true,"label":"Description"},{"name":"website","type":"select","required":true,"options":["3dput.com","sailboats.fr","other"],"label":"Website"}]', 70),
  
  ('General Request', 'general-request', 'General business request not fitting other categories',
   NULL, NULL, 72,
   '[{"name":"title","type":"text","required":true,"label":"Request Title"},{"name":"description","type":"textarea","required":true,"label":"Description"}]', 100)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO schema_migrations (migration_name) VALUES ('008_add_service_catalog') ON CONFLICT DO NOTHING;
