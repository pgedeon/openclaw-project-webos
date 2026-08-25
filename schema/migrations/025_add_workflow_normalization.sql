-- Migration: Workflow data normalization (roadmap debt D1)
-- Purpose:
--   1) Align the workflow_steps.status CHECK constraint with the status
--      vocabulary reality produces. The dispatcher v2 run vocabulary
--      (migration 021) is mirrored onto current-step rows by gateway
--      sessions (observed live 2026-08-25: 'timed_out' step rows on
--      deployments where the original 001 CHECK never applied because
--      CREATE TABLE IF NOT EXISTS skips existing tables; fresh deployments
--      instead reject the same writes with a constraint violation).
--      Chosen allowed set = step-native lifecycle ∪ migration-021 run
--      vocabulary (14 values, documented in docs/schema-reference.md).
--   2) Lift bare-string template steps into the canonical structured shape
--      the code reads ({name, display_name, required} per normalizeStep()
--      in lib/workflow-graph-layout.js). 14 of 29 active templates stored
--      plain display strings, which broke run launches (step_name = NULL
--      insert failure in createRun) and forced every reader to
--      special-case strings.
-- Date: 2026-08-25
-- Idempotency / re-run safety:
--   - Constraint swap uses DROP CONSTRAINT IF EXISTS + re-ADD (same final
--     state on every run).
--   - The step lift only rewrites arrays that STILL contain string elements;
--     object entries pass through verbatim and array order (step_order
--     semantics) is preserved via WITH ORDINALITY. Re-running is a no-op.
--   - Note: ADD CONSTRAINT validates existing rows. A deployment carrying
--     step statuses outside even the widened set fails loudly here — that is
--     deliberate (unknown garbage must be cleaned, not silently legalized).

BEGIN;

-- 1. Status vocabulary repair ----------------------------------------------

ALTER TABLE workflow_steps
  DROP CONSTRAINT IF EXISTS valid_workflow_step_status;

ALTER TABLE workflow_steps
  ADD CONSTRAINT valid_workflow_step_status CHECK (status IN (
    -- step-native lifecycle (001)
    'pending',
    'in_progress',
    'completed',
    'failed',
    'skipped',
    -- dispatcher v2 run vocabulary (021) mirrored onto step rows
    'queued',
    'dispatched',
    'claimed',
    'running',
    'waiting_for_approval',
    'blocked',
    'retrying',
    'cancelled',
    'timed_out'
  ));

COMMENT ON CONSTRAINT valid_workflow_step_status ON workflow_steps IS
  'Step-native statuses plus the dispatcher v2 run vocabulary (migration 021) that agents mirror onto their current step. Writers must use workflow-runs-api updateStep, which validates against the same list (WORKFLOW_STEP_STATUSES).';

-- 2. String-only template step lift -----------------------------------------

UPDATE workflow_templates wt
SET steps = (
    SELECT jsonb_agg(
        CASE
            WHEN jsonb_typeof(e) = 'string' THEN
                CASE
                    WHEN btrim(e #>> '{}') = '' THEN
                        jsonb_build_object(
                            'name', '(unnamed step ' || ord::text || ')',
                            'display_name', '(unnamed step ' || ord::text || ')',
                            'required', true)
                    ELSE
                        jsonb_build_object(
                            'name', btrim(e #>> '{}'),
                            'display_name', btrim(e #>> '{}'),
                            'required', true)
                END
            ELSE e
        END
        ORDER BY ord)
    FROM jsonb_array_elements(wt.steps) WITH ORDINALITY AS s(e, ord)
)
WHERE jsonb_typeof(wt.steps) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(wt.steps) e
    WHERE jsonb_typeof(e) = 'string'
  );

-- Track this migration
INSERT INTO schema_migrations (migration_name) VALUES ('025_add_workflow_normalization') ON CONFLICT DO NOTHING;

COMMIT;
