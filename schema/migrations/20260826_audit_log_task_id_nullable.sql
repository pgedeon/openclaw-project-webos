-- audit_log.task_id must be nullable: system-level event appends have no task.
--
-- routes/mcp-telemetry-routes.js (MCP adoption telemetry) and
-- routes/workflow-graph-routes.js (graph open/feedback events) append
-- task-less system events with task_id = NULL. The original NOT NULL made
-- every such INSERT fail on schemas provisioned from
-- schema/openclaw-dashboard.sql:
--   [mcp-telemetry] insert failed: null value in column "task_id" of
--   relation "audit_log" violates not-null constraint
-- (observed live on the LAN staging instance, 2026-08-26 — the first real
-- OpenClaw MCP tool call executed fine but its adoption row was rejected).
--
-- Production (WSL mission_control) already runs the column nullable, so this
-- migration aligns the canonical schema with deployed reality and with the
-- DAG telemetry precedent (scripts/dag-telemetry-counter.js reads the same
-- kind of task-less rows there). The foreign key stays enforced;
-- NULL simply means "event not tied to a task".

ALTER TABLE audit_log ALTER COLUMN task_id DROP NOT NULL;
