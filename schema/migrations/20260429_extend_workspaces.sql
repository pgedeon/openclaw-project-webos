-- Extend workspaces table for Spaces UI
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '📁';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#0078d4';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- Mark existing default workspace
UPDATE workspaces SET is_default = true WHERE slug = 'default';
