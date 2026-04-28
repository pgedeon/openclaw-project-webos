-- State snapshots for Time Travel
-- Records full entity state at each mutation for point-in-time recovery

CREATE TABLE IF NOT EXISTS state_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL, -- 'task', 'project', 'workflow', 'view', 'setting'
  entity_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'delete', 'move', 'archive', 'restore', 'status_change'
  state JSONB NOT NULL, -- full entity state at this point
  actor TEXT NOT NULL DEFAULT 'system',
  correlation_id UUID NULL, -- groups related changes
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_entity ON state_snapshots(entity_type, entity_id);
CREATE INDEX idx_snapshots_created ON state_snapshots(created_at DESC);
CREATE INDEX idx_snapshots_action ON state_snapshots(action);
CREATE INDEX idx_snapshots_correlation ON state_snapshots(correlation_id);

-- Extend audit_log with entity_type for non-task entities
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'task';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS correlation_id UUID;
