-- 026_add_workspaces_base.sql
-- Base table for Spaces / multi-workspace support.
--
-- History: the P3 Spaces feature (commit a7298d1, 2026-04-29) added
-- routes/space-routes.js, storage methods and the 20260429_extend_workspaces
-- ALTER migration, but the CREATE TABLE for `workspaces` itself never landed
-- in any migration — it only existed in databases provisioned from an older
-- private bootstrap. Fresh deployments (e.g. the staging pg-livefire
-- container, openclaw_dashboard DB) had /api/spaces fail with
-- "relation \"workspaces\" does not exist".
--
-- This migration creates the base table exactly as documented in
-- docs/schema-reference.md ("Spaces / Workspaces" section), idempotently.
-- The 20260429 extend/constraints migrations then apply cleanly on top.

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  icon TEXT DEFAULT '📁',
  color TEXT DEFAULT '#0078d4',
  description TEXT DEFAULT '',
  settings JSONB DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_sort_order ON workspaces(sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);

-- Seed the default workspace so the UI has something to switch to.
-- Matches 20260429_extend_workspaces.sql which marks slug='default' default.
INSERT INTO workspaces (name, slug, icon, color, description, settings, is_default, sort_order)
VALUES ('Default', 'default', '📁', '#0078d4', 'Default workspace', '{}', true, 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO schema_migrations (migration_name) VALUES ('026_add_workspaces_base') ON CONFLICT DO NOTHING;
