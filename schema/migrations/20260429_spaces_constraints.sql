-- Ensure exactly one default workspace
CREATE UNIQUE INDEX IF NOT EXISTS one_default_workspace
  ON workspaces ((is_default)) WHERE is_default = true;
