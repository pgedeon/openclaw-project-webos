-- Add saved_views table for user-saved filter/sort combinations
-- Migration: 20260216_add_saved_views
-- Created by: Project Dashboard Improvement Agent

CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  sort TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX idx_saved_views_project_id ON saved_views(project_id);
CREATE INDEX idx_saved_views_created_by ON saved_views(created_by);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_saved_views_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_saved_views_updated_at'
  ) THEN
    CREATE TRIGGER update_saved_views_updated_at BEFORE UPDATE ON saved_views
      FOR EACH ROW EXECUTE FUNCTION update_saved_views_updated_at();
  END IF;
END;
$$;

COMMIT;
