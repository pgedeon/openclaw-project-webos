-- Migration: Add budget ledger (budgets + budget_events)
-- Purpose: Named spending rules (scope x period x cap x breach action) with spend
--          DERIVED from the workflow_runs cost/token columns shipped in migration
--          022 — no new metering, no double-count. budget_events is the append-only
--          enforcement audit trail; UNIQUE (budget_id, period_key, event_kind) is
--          the idempotency latch so repeated dispatcher ticks / API calls never
--          duplicate an event.
-- Date: 2026-08-24
-- Part of: UPGRADE_ROADMAP.md Phase 1 - Budget Ledger + Auto-Pause guardrail
-- Brief: docs/briefs/budget-ledger.md (slice 1: model + API, no enforcement)

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('agent','department','project','fleet')),
  scope_id TEXT NULL,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  cap_usd NUMERIC(12,6) NULL,
  cap_tokens BIGINT NULL,
  action_on_exceed TEXT NOT NULL CHECK (action_on_exceed IN ('warn','pause_new_runs','hard_stop')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cap is XOR: exactly one of cap_usd / cap_tokens. An operator wanting both
  -- creates two budgets; one row, one trigger condition, no precedence puzzles.
  CHECK ((cap_usd IS NOT NULL)::int + (cap_tokens IS NOT NULL)::int = 1)
);

COMMENT ON TABLE budgets IS 'Named spending rules; spend is derived from workflow_runs (migration 022) at evaluation time, never stored twice';
COMMENT ON COLUMN budgets.scope_id IS 'Scope target: agent id, department id, or workflow_type for project scope; NULL only for fleet scope';
COMMENT ON COLUMN budgets.cap_usd IS 'USD cap against workflow_runs.cost_estimate; XOR with cap_tokens (CHECK)';
COMMENT ON COLUMN budgets.cap_tokens IS 'Token cap over input_tokens + output_tokens (cached_tokens is a subset of input and never added on top); XOR with cap_usd';
COMMENT ON COLUMN budgets.action_on_exceed IS 'Breach action: warn (notify only) | pause_new_runs (queue holds) | hard_stop (in-flight cancelled)';

-- One ACTIVE budget per (scope, scope_id, period). COALESCE folds the fleet
-- scope's NULL scope_id into the key so two active fleet budgets cannot coexist
-- (plain unique indexes treat NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_active_scope_period
  ON budgets (scope, COALESCE(scope_id, ''), period)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_budgets_scope_period
  ON budgets (scope, period, active);

CREATE TABLE IF NOT EXISTS budget_events (
  id BIGSERIAL PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('warned','paused','hard_stopped','recovered')),
  detail JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_key, event_kind)
);

COMMENT ON TABLE budget_events IS 'Append-only enforcement audit trail; UNIQUE (budget_id, period_key, event_kind) makes every emission idempotent (ON CONFLICT DO NOTHING)';
COMMENT ON COLUMN budget_events.period_key IS 'Calendar bucket that breached, e.g. 2026-08-24 (daily) / 2026-W35 (ISO weekly) / 2026-08 (monthly)';
COMMENT ON COLUMN budget_events.detail IS 'Breach context JSONB: spend at breach, affected run ids, actor';

CREATE INDEX IF NOT EXISTS idx_budget_events_budget_created
  ON budget_events (budget_id, created_at DESC);

-- Track this migration
INSERT INTO schema_migrations (migration_name) VALUES ('023_add_budget_ledger') ON CONFLICT DO NOTHING;
