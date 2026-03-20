-- Optional indexes to speed up audit log filters.
-- Note: For free-text q searches, consider pg_trgm indexes if needed.

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_action ON audit_log(actor, action);
