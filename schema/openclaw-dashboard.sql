-- OpenClaw Asana-Style Dashboard Database Schema
-- PostgreSQL 13+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workflows: defines the state machine for tasks
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  states TEXT[] NOT NULL, -- Array of state names in order
  is_default BOOLEAN NOT NULL DEFAULT false,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE, -- NULL means global default
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects: container for tasks with settings
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, archived
  tags TEXT[] NOT NULL DEFAULT '{}',
  default_workflow_id UUID NOT NULL REFERENCES workflows(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  qmd_project_namespace TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks: the core work items
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'medium', -- low, medium, high, critical
  owner TEXT NULL, -- agent name or human identifier
  due_date DATE NULL,
  start_date DATE NULL,
  estimated_effort NUMERIC NULL, -- hours or story points
  actual_effort NUMERIC NULL,
  parent_task_id UUID NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_ids UUID[] NOT NULL DEFAULT '{}', -- Array of task IDs
  labels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  recurrence_rule TEXT NULL, -- cron-like syntax
  metadata JSONB NOT NULL DEFAULT '{}',
  execution_lock TIMESTAMPTZ NULL, -- When locked for execution
  execution_locked_by TEXT NULL, -- Agent currently holding lock
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT valid_status CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'completed', 'archived'))
);

-- Indexes for performance
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_owner ON tasks(owner);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at);

-- GIN indexes for array and JSONB fields
CREATE INDEX idx_tasks_dependency_ids ON tasks USING GIN(dependency_ids);
CREATE INDEX idx_tasks_labels ON tasks USING GIN(labels);
CREATE INDEX idx_tasks_metadata ON tasks USING GIN(metadata);
CREATE INDEX idx_projects_tags ON projects USING GIN(tags);
CREATE INDEX idx_projects_metadata ON projects USING GIN(metadata);

-- Audit log: track all significant changes
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, -- user or agent name
  action TEXT NOT NULL, -- create, update, delete, claim, release, move, etc.
  old_value JSONB NULL, -- Snapshot of relevant fields before change
  new_value JSONB NULL, -- Snapshot after change
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_task_id ON audit_log(task_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);

-- Triggers: auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for convenience

-- Task graph view: includes parent/child relationships flattened
CREATE OR REPLACE VIEW task_graph AS
SELECT
  t.id,
  t.project_id,
  t.title,
  t.status,
  t.priority,
  t.owner,
  t.due_date,
  t.start_date,
  t.parent_task_id,
  t.dependency_ids,
  p.name as project_name,
  p.status as project_status
FROM tasks t
JOIN projects p ON t.project_id = p.id
WHERE p.status = 'active';

-- Pre-execution guard view: identifies tasks that are blocked by dependencies
CREATE OR REPLACE VIEW blocked_tasks AS
SELECT
  t.id,
  t.title,
  t.project_id,
  t.status,
  t.dependency_ids,
  COUNT(dep.id) FILTER (WHERE dep.status NOT IN ('completed', 'archived')) as blocking_dependencies
FROM tasks t
LEFT JOIN tasks dep ON t.dependency_ids @> ARRAY[dep.id]
WHERE t.status NOT IN ('completed', 'archived', 'blocked')
GROUP BY t.id
HAVING COUNT(dep.id) FILTER (WHERE dep.status NOT IN ('completed', 'archived')) > 0;

-- Grant minimal permissions (adjust as needed)
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO openclaw_reader;
-- GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openclaw_writer;

COMMIT;
