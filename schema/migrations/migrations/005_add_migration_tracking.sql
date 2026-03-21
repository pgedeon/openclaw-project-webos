-- Migration Tracking System
-- Tracks which migrations have been applied to the database

CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    migration_name TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum TEXT
);

-- Track existing migrations that were already applied
INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '001_add_workflow_runs', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '001_add_workflow_runs');

INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '002_add_workflow_queues', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '002_add_workflow_queues');

INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '003_add_approvals', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '003_add_approvals');

INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '004_add_blocker_classification', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '004_add_blocker_classification');

-- Track this migration itself
INSERT INTO schema_migrations (migration_name, applied_at)
SELECT '005_add_migration_tracking', NOW()
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE migration_name = '005_add_migration_tracking');
