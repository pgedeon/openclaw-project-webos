-- Migration: Add action receipts (one-click actions slice 1)
-- Purpose: Durable idempotency latch + persisted record for every gated
--          operator action (docs/briefs/one-click-actions.md §3.3/§3.4).
--          action_receipts.action_id is the PRIMARY KEY — the server receipt
--          latch: a replayed client-minted actionId hits the unique
--          constraint and returns the stored receipt instead of re-executing.
-- Date: 2026-08-24
-- Part of: UPGRADE_ROADMAP.md Phase 1 - One-click agent actions (slice 1)
-- Brief: docs/briefs/one-click-actions.md

CREATE TABLE IF NOT EXISTS action_receipts (
  action_id TEXT PRIMARY KEY, -- client-minted UUID, one per confirmed intent
  kind TEXT NOT NULL CHECK (kind IN (
    'task.assign', 'run.dispatch', 'approval.decide', 'run.cancel', 'run.redispatch'
  )),
  target_id TEXT NOT NULL,
  params_hash TEXT NOT NULL, -- sha256(canonicalJSON(params)); staleness guard
  actor TEXT NOT NULL DEFAULT 'dashboard-operator',
  outcome TEXT NULL CHECK (outcome IN (
    'executed', 'rejected_governance', 'blocked_budget', 'failed', 'duplicate'
  )), -- NULL while executing (latch inserted before the side effect)
  rollback_hint TEXT NULL, -- human-readable recovery move, shown BEFORE confirm
  detail JSONB NULL, -- governance/budget verdicts, resulting entity ids, error text
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE action_receipts IS 'One receipt per executed operator action; PK is the idempotency latch — replays return the stored row with duplicate:true and never re-execute';
COMMENT ON COLUMN action_receipts.action_id IS 'Client-minted UUID bound to one confirmed intent; retries reuse it, a deliberate repeat mints a new one';
COMMENT ON COLUMN action_receipts.params_hash IS 'sha256 over canonical JSON (sorted keys) of params; same actionId + different hash = stale retry (409), never executed';
COMMENT ON COLUMN action_receipts.outcome IS 'NULL while executing; executed | rejected_governance | failed on completion. blocked_budget refusals are written pre-latch and intentionally leave NO receipt (a refusal must stay retryable after a cap raise)';
COMMENT ON COLUMN action_receipts.rollback_hint IS 'Recovery move shown in preview modals and the recent-actions tray; hints only — nothing auto-reverts';
COMMENT ON COLUMN action_receipts.detail IS 'JSONB context: executor result ids (e.g. new run_id), governance verdict, error text';

CREATE INDEX IF NOT EXISTS idx_action_receipts_created
  ON action_receipts (created_at DESC);

-- Track this migration
INSERT INTO schema_migrations (migration_name) VALUES ('024_add_action_receipts') ON CONFLICT DO NOTHING;
