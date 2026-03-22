-- Migration 009: Add service_requests table
-- Phase 2: Service Catalog And Service Requests

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  requested_by VARCHAR(255) NOT NULL,
  requested_for VARCHAR(255),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status VARCHAR(50) NOT NULL DEFAULT 'new',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  target_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  target_agent_id VARCHAR(255),
  input_payload JSONB DEFAULT '{}',
  routing_decision JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT service_requests_status_check CHECK (
    status IN (
      'new',
      'triaged',
      'planned',
      'running',
      'waiting_for_approval',
      'blocked',
      'completed',
      'failed',
      'cancelled'
    )
  ),
  CONSTRAINT service_requests_priority_check CHECK (
    priority IN ('low', 'medium', 'high', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS idx_service_requests_service_id ON service_requests(service_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_service_requests_priority ON service_requests(priority);
CREATE INDEX IF NOT EXISTS idx_service_requests_target_department ON service_requests(target_department_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_target_agent ON service_requests(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_project ON service_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_created_at ON service_requests(created_at DESC);

INSERT INTO schema_migrations (migration_name) VALUES ('009_add_service_requests') ON CONFLICT DO NOTHING;
