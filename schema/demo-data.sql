-- Demo data for OpenClaw Project WebOS
-- Run this AFTER the base schema to populate the dashboard with example content.
-- This creates sample projects, tasks in various Kanban columns, workflow definitions,
-- departments, and agent profiles so the dashboard isn't empty on first install.

BEGIN;

-- ============================================
-- Projects
-- ============================================

INSERT INTO projects (id, name, description, status, priority, created_at)
VALUES
  ('a0000001-0000-0000-0000-000000000001', 'OpenClaw System', 'Core agent infrastructure, gateway, and runtime', 'active', 'high', NOW()),
  ('a0000001-0000-0000-0000-000000000002', 'Dashboard & Task System', 'WebOS desktop dashboard, Kanban board, widgets', 'active', 'high', NOW()),
  ('a0000001-0000-0000-0000-000000000003', 'Memory & Recall', 'Semantic memory, facts DB, search infrastructure', 'active', 'medium', NOW()),
  ('a0000001-0000-0000-0000-000000000004', 'Models & Providers', 'LLM provider configs, model management, routing', 'active', 'medium', NOW()),
  ('a0000001-0000-0000-0000-000000000005', 'Heartbeat & Automation', 'Cron jobs, monitoring, automation pipelines', 'active', 'medium', NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- Workflows
-- ============================================

INSERT INTO workflows (id, name, description, states, is_default, project_id, created_at)
VALUES
  ('w0000001-0000-0000-0000-000000000001', 'Default Workflow', 'Standard task lifecycle',
   '["backlog","ready","in_progress","blocked","review","completed","archived"]'::jsonb, true,
   'a0000001-0000-0000-0000-000000000001', NOW()),
  ('w0000001-0000-0000-0000-000000000002', 'Feature Development', 'Feature dev lifecycle with testing gate',
   '["backlog","planned","in_progress","testing","review","completed","archived"]'::jsonb, false,
   'a0000001-0000-0000-0000-000000000002', NOW()),
  ('w0000001-0000-0000-0000-000000000003', 'Bug Fix', 'Bug fix lifecycle with verification',
   '["reported","triaged","in_progress","testing","verified","closed","archived"]'::jsonb, false,
   'a0000001-0000-0000-0000-000000000001', NOW())
ON CONFLICT DO NOTHING;

-- Link projects to their default workflow
UPDATE projects SET default_workflow_id = 'w0000001-0000-0000-0000-000000000001'
WHERE id IN ('a0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000003',
              'a0000001-0000-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000005');
UPDATE projects SET default_workflow_id = 'w0000001-0000-0000-0000-000000000002'
WHERE id = 'a0000001-0000-0000-0000-000000000002';

-- ============================================
-- Demo Tasks (across various columns)
-- ============================================

INSERT INTO tasks (id, project_id, title, description, status, priority, owner, labels, due_date, created_at, updated_at) VALUES
  -- OpenClaw System — ready column
  ('t0000001-0001-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001',
   'Implement WebSocket reconnection logic', 'Add exponential backoff and auto-reconnect for gateway WebSocket drops', 'ready', 'high', 'main',
   '["infrastructure","reliability"]'::jsonb, NOW() + INTERVAL '3 days', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),

  ('t0000001-0001-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000001',
   'Add rate limiting to agent spawn endpoint', 'Prevent runaway agent spawning with configurable limits per agent type', 'ready', 'medium', NULL,
   '["security","infrastructure"]'::jsonb, NOW() + INTERVAL '7 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),

  -- Dashboard — in_progress column
  ('t0000001-0001-0000-0000-000000000003', 'a0000001-0000-0000-0000-000000000002',
   'Build widget system with drag-and-drop', 'Create modular widget panel with registry, host, and 18 built-in widgets', 'in_progress', 'high', 'main',
   '["feature","ui","widgets"]'::jsonb, NOW() + INTERVAL '2 days', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '30 minutes'),

  ('t0000001-0001-0000-0000-000000000004', 'a0000001-0000-0000-0000-000000000002',
   'Native view migration for remaining apps', 'Convert iframe-based views to native ES module views with proper data binding', 'in_progress', 'medium', 'dashboard-manager',
   '["feature","refactor"]'::jsonb, NOW() + INTERVAL '5 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours'),

  -- Dashboard — review column
  ('t0000001-0001-0000-0000-000000000005', 'a0000001-0000-0000-0000-000000000002',
   'Agent dashboard reporting integration', 'Agents report work to Kanban board via agent_reporter.py CLI', 'review', 'medium', 'main',
   '["feature","integration"]'::jsonb, NOW() + INTERVAL '1 day', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour'),

  -- Dashboard — completed column
  ('t0000001-0001-0000-0000-000000000006', 'a0000001-0000-0000-0000-000000000002',
   'Win11 shell framework and window manager', 'Desktop shell with taskbar, start menu, draggable windows, and theme system', 'completed', 'high', 'main',
   '["feature","ui","shell"]'::jsonb, NOW() - INTERVAL '1 day', NOW() - INTERVAL '5 days', NOW() - INTERVAL '1 day'),

  ('t0000001-0001-0000-0000-000000000007', 'a0000001-0000-0000-0000-000000000002',
   'Task API endpoints (CRUD, move, claim, release)', 'RESTful task management with agent claiming and Kanban column movement', 'completed', 'high', 'main',
   '["api","tasks"]'::jsonb, NULL, NOW() - INTERVAL '10 days', NOW() - INTERVAL '3 days'),

  -- Memory — in_progress
  ('t0000001-0001-0000-0000-000000000008', 'a0000001-0000-0000-0000-000000000003',
   'Facts database with search and CRUD API', 'SQLite-backed structured facts store with FTS5 search and REST API', 'in_progress', 'medium', 'main',
   '["feature","data","api"]'::jsonb, NOW() + INTERVAL '4 days', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '1 hour'),

  -- OpenClaw System — blocked
  ('t0000001-0001-0000-0000-000000000009', 'a0000001-0000-0000-0000-000000000001',
   'Session context compaction optimization', 'Reduce context window usage during long sessions with smart summarization', 'blocked', 'high', 'main',
   '["performance","agents"]'::jsonb, NOW() + INTERVAL '5 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day'),

  -- OpenClaw System — backlog
  ('t0000001-0001-0000-0000-000000000010', 'a0000001-0000-0000-0000-000000000001',
   'Plugin marketplace skeleton', 'Basic plugin discovery, install, and lifecycle management', 'backlog', 'low', NULL,
   '["feature","plugin"]'::jsonb, NULL, NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),

  ('t0000001-0001-0000-0000-000000000011', 'a0000001-0000-0000-0000-000000000001',
   'Multi-language agent support', 'Allow agents to operate in different languages based on user config', 'backlog', 'low', NULL,
   '["feature","i18n"]'::jsonb, NULL, NOW() - INTERVAL '1 week', NOW() - INTERVAL '1 week'),

  -- Heartbeat — ready
  ('t0000001-0001-0000-0000-000000000012', 'a0000001-0000-0000-0000-000000000005',
   'Cron job health monitoring dashboard', 'Visual overview of all cron jobs with status, last run, and failure alerts', 'ready', 'medium', NULL,
   '["monitoring","automation"]'::jsonb, NOW() + INTERVAL '5 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ============================================
-- Departments
-- ============================================

INSERT INTO departments (id, name, slug, description, color, created_at)
VALUES
  ('d0000001-0000-0000-0000-000000000001', 'Infrastructure', 'infrastructure', 'Core system infrastructure, gateway, deployment', '#3b82f6', NOW()),
  ('d0000001-0000-0000-0000-000000000002', 'Dashboard', 'dashboard', 'WebOS desktop dashboard, UI components, widgets', '#8b5cf6', NOW()),
  ('d0000001-0000-0000-0000-000000000003', 'Content Operations', 'content-ops', 'Website content, publishing pipelines, SEO', '#22c55e', NOW()),
  ('d0000001-0000-0000-0000-000000000004', 'Quality', 'quality', 'QA, testing, security audits, code review', '#eab308', NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- Agent Profiles
-- ============================================

INSERT INTO agent_profiles (id, agent_id, name, role, department_id, capabilities, created_at)
VALUES
  ('p0000001-0000-0000-0000-000000000001', 'main', 'Main Agent', 'Primary operator', 'd0000001-0000-0000-0000-000000000001',
   '["task_management","code_edit","browser","api_access","subagents"]'::jsonb, NOW()),
  ('p0000001-0000-0000-0000-000000000002', 'dashboard-manager', 'Dashboard Manager', 'Dashboard development & maintenance', 'd0000001-0000-0000-0000-000000000002',
   '["task_management","code_edit","api_access","subagents"]'::jsonb, NOW()),
  ('p0000001-0000-0000-0000-000000000003', '3dput', '3DPut Supervisor', '3D printing content operations', 'd0000001-0000-0000-0000-000000000003',
   '["content_creation","wordpress","api_access"]'::jsonb, NOW()),
  ('p0000001-0000-0000-0000-000000000004', 'sailboats-fr', 'Sailboats.fr Editor', 'Maritime content & SEO', 'd0000001-0000-0000-0000-000000000003',
   '["content_creation","wordpress","seo","api_access"]'::jsonb, NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- Service Catalog
-- ============================================

INSERT INTO service_catalog (id, name, description, category, tier, created_at)
VALUES
  ('s0000001-0000-0000-0000-000000000001', 'Bug Report', 'Report a bug or unexpected behavior', 'support', 'standard', NOW()),
  ('s0000001-0000-0000-0000-000000000002', 'Feature Request', 'Request a new feature or enhancement', 'enhancement', 'standard', NOW()),
  ('s0000001-0000-0000-0000-000000000003', 'Code Review', 'Request a code review for changes', 'quality', 'premium', NOW()),
  ('s0000001-0000-0000-0000-000000000004', 'Security Audit', 'Request a security review of code or infrastructure', 'security', 'premium', NOW()),
  ('s0000001-0000-0000-0000-000000000005', 'Content Review', 'Review and improve content quality', 'content', 'standard', NOW())
ON CONFLICT DO NOTHING;

-- ============================================
-- Sample Service Requests
-- ============================================

INSERT INTO service_requests (id, service_id, title, description, status, priority, requested_by, created_at)
VALUES
  ('r0000001-0000-0000-0000-000000000001', 's0000001-0000-0000-0000-000000000001',
   'Widget drag flicker on Firefox', 'Drag-and-drop reordering flickers on Firefox 121+', 'open', 'medium', 'peter', NOW() - INTERVAL '6 hours'),
  ('r0000001-0000-0000-0000-000000000002', 's0000001-0000-0000-0000-000000000002',
   'Widget resize preview', 'Show size preview while dragging resize handle', 'open', 'low', 'peter', NOW() - INTERVAL '1 day'),
  ('r0000001-0000-0000-0000-000000000003', 's0000001-0000-0000-0000-000000000003',
   'Review widget API contract', 'Verify the widget manifest and render ctx are clean before v1', 'in_progress', 'high', 'main', NOW() - INTERVAL '3 hours')
ON CONFLICT DO NOTHING;

COMMIT;
