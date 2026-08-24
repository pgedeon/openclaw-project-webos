/**
 * Action routes — one-click actions slice 1 (docs/briefs/one-click-actions.md §3).
 *
 * POST /api/actions/execute  — the only write path for catalog actions.
 * GET  /api/actions/recent   — recent receipts feed (tray, slice 3 consumer).
 *
 * Execution pipeline (order matters):
 *   1. validateActionEnvelope()          → 400 invalid_action BEFORE anything else
 *   2. storage availability              → 503 {available:false} (no DB)
 *   3. receipt latch lookup              → duplicate:true replay / 409 stale_retry
 *   4. governance pre-check (fail CLOSED)→ rejected_governance receipt, 403
 *   5. budget headroom probe (dispatch-class only, read-only, fail OPEN)
 *                                        → 422 budget_blocked refusal, NO receipt
 *   6. latch INSERT (PK = idempotency latch; concurrent replays land here)
 *   7. backing executor (existing WorkflowRunsAPI / storage methods IN-PROCESS —
 *      never HTTP self-calls, never duplicated business logic)
 *   8. finalize: ONE transaction = receipt outcome UPDATE + audit_log mirror row
 *
 * Transactionality — honest note (work order: "same transaction where the store
 * supports it"): the backing executors (WorkflowRunsAPI.cancelRun/createRun/…)
 * own their internal transactions over the pool and accept no external client,
 * so the side effect cannot share one transaction with the receipt. The latch
 * is therefore written FIRST (own statement): a concurrent double-click hits
 * the PK constraint and returns the stored receipt instead of re-executing —
 * exactly-one-side-effect holds. Crash windows: a receipt left with
 * outcome NULL means "executing, fate unknown" and replays return
 * duplicate:true (safe direction: never re-execute an uncertain intent);
 * the finalization transaction makes receipt-outcome + audit mirror atomic
 * with each other. Raw endpoints stay uncordoned (brief §7): scripts and
 * agents bypass receipts by design.
 */
const {
  ACTION_REGISTRY,
  governanceActionFor,
  rollbackHintFor,
  validateActionEnvelope,
} = require('../lib/action-registry');
const { evaluateGovernanceAction } = require('../governance');
const { pctOfCap } = require('../lib/budget-eval');

const PG = {
  UNIQUE_VIOLATION: '23505',
  UNDEFINED_TABLE: '42P01',
};

function respond(ctx, res, status, body) {
  if (ctx && typeof ctx.sendJSON === 'function') {
    ctx.sendJSON(res, status, body);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function getStorage(ctx) {
  const store = ctx && ctx.asanaStorage;
  const pool = store && store.pool;
  if (!pool || typeof pool.query !== 'function') return null;
  return store;
}

function normalizeReceiptRow(row) {
  if (!row) return null;
  let detail = row.detail;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch { /* keep raw string */ }
  }
  return {
    action_id: row.action_id,
    kind: row.kind,
    target_id: row.target_id,
    params_hash: row.params_hash,
    actor: row.actor,
    outcome: row.outcome ?? null,
    rollback_hint: row.rollback_hint ?? null,
    detail: detail ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
  };
}

/**
 * Default executors over existing machinery. Every function REUSES shipped
 * business logic in-process (WorkflowRunsAPI methods / storage helpers) —
 * the gate is additive; raw endpoints keep working unchanged (brief §3.6).
 */
function createDefaultExecutors(store) {
  // Lazy require keeps this module importable without the (heavy) runs API
  // when tests inject their own executor map.
  const { WorkflowRunsAPI } = require('../workflow-runs-api');
  const api = new WorkflowRunsAPI(store.pool);

  return {
    // PATCH /api/tasks/:id {owner} logic via storage.updateTask (tasks-view path)
    async assignTaskOwner({ envelope }) {
      const task = await store.updateTask(envelope.targetId, { owner: envelope.params.owner });
      if (!task) throw new Error('Task not found');
      return { task_id: task.id || envelope.targetId, owner: envelope.params.owner };
    },

    // POST /api/workflow-runs + /:id/start composed server-side (never two
    // HTTP calls from the client). createRun enforces launch_workflow
    // governance internally; startRun flips queued → running immediately.
    async dispatchRun({ envelope }) {
      const run = await api.createRun({
        task_id: envelope.targetId,
        workflow_type: envelope.params.template,
        input_payload: envelope.params.input_payload || {},
        actor: envelope.actor,
      });
      let started = null;
      try {
        started = await api.startRun(run.id);
      } catch (err) {
        // Run exists (queued; dispatcher will pick it up) but the immediate
        // start failed — report honestly rather than pretending success.
        err.runCreatedId = run.id;
        throw err;
      }
      return { new_run_id: run.id, status: (started && started.status) || 'running' };
    },

    // PATCH /api/approvals/:id decision logic, same shape as the raw handler:
    // approver lookup → ensureGovernancePermission(approve|reject) → updateApproval
    async decideApproval({ envelope }) {
      const decisionAction = envelope.params.decision === 'rejected' ? 'reject' : 'approve';
      const lookup = await api.pool.query(
        'SELECT approver_id FROM workflow_approvals WHERE id = $1 LIMIT 1',
        [envelope.targetId]
      );
      await api.ensureGovernancePermission(decisionAction, envelope.actor, {
        approverId: lookup.rows[0]?.approver_id || null,
      });
      const approval = await api.updateApproval(
        envelope.targetId,
        envelope.params.decision,
        envelope.params.notes || '',
        envelope.actor
      );
      return { approval_id: envelope.targetId, decision: envelope.params.decision };
    },

    // POST /api/workflow-runs/:id/cancel (cancel_run governance enforced inside)
    async cancelRun({ envelope }) {
      const run = await api.cancelRun(envelope.targetId, envelope.actor, envelope.params.reason || '');
      return { run_id: envelope.targetId, status: (run && run.status) || 'cancelled' };
    },

    // POST /api/workflow-runs/:id/override-failure next_status:'queued'
    // (override_failure governance enforced inside; dispatcher picks it up)
    async redispatchRun({ envelope }) {
      const run = await api.overrideFailure(envelope.targetId, envelope.actor, '', 'queued');
      return { run_id: envelope.targetId, status: (run && run.status) || 'queued' };
    },
  };
}

/** Resolve task_id for the audit mirror (audit_log.task_id is NOT NULL FK). */
async function resolveAuditTaskId(pool, envelope) {
  try {
    if (envelope.kind === 'task.assign' || envelope.kind === 'run.dispatch') {
      return envelope.targetId;
    }
    if (envelope.kind === 'approval.decide') {
      const r = await pool.query(
        `SELECT wr.task_id
         FROM workflow_approvals a
         JOIN workflow_runs wr ON wr.id = a.workflow_run_id
         WHERE a.id = $1 LIMIT 1`,
        [envelope.targetId]
      );
      return r.rows[0]?.task_id || null;
    }
    const r = await pool.query(
      'SELECT task_id FROM workflow_runs WHERE id = $1 LIMIT 1',
      [envelope.targetId]
    );
    return r.rows[0]?.task_id || null;
  } catch {
    return null; // audit mirror is best-effort on id resolution; never blocks execution
  }
}

/**
 * Budget headroom probe over the SAME scope chain the dispatcher's
 * lib/budget-enforcement.js checkRun() walks (agent → department →
 * project/workflow_type → fleet). Read-only; fails OPEN (probe failure or
 * unavailable budgets ⇒ proceed — the dispatcher remains the enforcement
 * backstop, brief §3.5/§3.6 rule 5).
 *
 * @returns {null | {blocked:boolean, action:string, breached:Array}}
 */
async function probeBudgets(pool, envelope) {
  const entry = ACTION_REGISTRY[envelope.kind];
  if (!entry || !entry.budgetProbe) return null;

  let agentId = null;
  let workflowType = null;
  try {
    if (envelope.kind === 'run.dispatch') {
      const r = await pool.query(
        'SELECT owner_agent_id FROM tasks WHERE id = $1 LIMIT 1',
        [envelope.targetId]
      );
      agentId = r.rows[0]?.owner_agent_id || null;
      workflowType = envelope.params.template;
    } else {
      const r = await pool.query(
        'SELECT owner_agent_id, workflow_type FROM workflow_runs WHERE id = $1 LIMIT 1',
        [envelope.targetId]
      );
      agentId = r.rows[0]?.owner_agent_id || null;
      workflowType = r.rows[0]?.workflow_type || null;
    }

    const { createBudgetEnforcement } = require('../lib/budget-enforcement');
    const verdict = await createBudgetEnforcement(pool).checkRun({ agentId, workflowType });
    if (!verdict) return null; // enforcement unavailable → fail open
    const blocked = verdict.action === 'pause_new_runs' || verdict.action === 'hard_stop';
    return { blocked, action: verdict.action, breached: verdict.breached || [] };
  } catch {
    return null; // probe failure must never block an action (fail open)
  }
}

function budgetRefusal(verdict) {
  return {
    error: 'budget_blocked',
    action: verdict.action,
    budgets: (verdict.breached || []).map((b) => ({
      name: b.budget.name,
      scope: b.budget.scope,
      period_key: b.key,
      spend_usd: b.budget.cap_usd != null ? Math.round(b.spendUsd * 100) / 100 : undefined,
      spend_tokens: b.budget.cap_tokens != null ? b.spendTokens : undefined,
      cap_usd: b.budget.cap_usd ?? undefined,
      cap_tokens: b.budget.cap_tokens ?? undefined,
      pct_of_cap: pctOfCap(b.budget, b.spendUsd, b.spendTokens),
    })),
  };
}

function registerActionRoutes(router, options = {}) {
  const getStore = options.getStorage || getStorage;

  // GET /api/actions/recent?limit=50 — tray feed. Read endpoints degrade with
  // the house contract (200 {available:false, reason}); execute degrades with
  // 503 per the audit-first refusal rules (§3.6).
  router.add('GET', '/api/actions/recent', async (req, res, ctx) => {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    let limit = parseInt(url.searchParams.get('limit') || '50', 10);
    if (!Number.isFinite(limit)) limit = 50;
    limit = Math.max(1, Math.min(200, limit));

    const store = getStore(ctx);
    if (!store) {
      respond(ctx, res, 200, { available: false, reason: 'no_database', timestamp: new Date().toISOString() });
      return true;
    }
    try {
      const result = await store.pool.query(
        `SELECT action_id, kind, target_id, params_hash, actor, outcome,
                rollback_hint, detail, created_at
         FROM action_receipts
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      respond(ctx, res, 200, {
        available: true,
        receipts: (result.rows || []).map(normalizeReceiptRow),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      if (err && err.code === PG.UNDEFINED_TABLE) {
        respond(ctx, res, 200, { available: false, reason: 'receipts_unavailable', timestamp: new Date().toISOString() });
      } else {
        respond(ctx, res, 200, {
          available: false,
          reason: 'query_failed',
          details: err && err.message ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }
    return true;
  });

  // POST /api/actions/execute — the gated write path.
  router.add('POST', '/api/actions/execute', async (req, res, ctx) => {
    const body = await parseBody(req);

    // 1. Envelope validation BEFORE any permission check or execution (AC1).
    const validated = validateActionEnvelope(body);
    if (!validated.ok) {
      respond(ctx, res, 400, { error: 'invalid_action', details: validated.errors });
      return true;
    }
    const envelope = validated.envelope;
    const entry = ACTION_REGISTRY[envelope.kind];

    // 2. No PostgreSQL → audit-first refusal: no receipt persistence, no side effect.
    const store = getStore(ctx);
    if (!store) {
      respond(ctx, res, 503, { available: false, reason: 'no_database' });
      return true;
    }
    const pool = store.pool;

    const selectReceipt = async () => {
      const r = await pool.query(
        `SELECT action_id, kind, target_id, params_hash, actor, outcome,
                rollback_hint, detail, created_at
         FROM action_receipts WHERE action_id = $1 LIMIT 1`,
        [envelope.actionId]
      );
      return r.rows[0] || null;
    };

    // 3. Receipt latch lookup — replay semantics (AC2/AC3/AC4).
    let existing = null;
    try {
      existing = await selectReceipt();
    } catch (err) {
      if (err && err.code === PG.UNDEFINED_TABLE) {
        respond(ctx, res, 503, { available: false, reason: 'receipts_unavailable' });
      } else {
        respond(ctx, res, 503, {
          available: false,
          reason: 'query_failed',
          details: err && err.message ? err.message : String(err),
        });
      }
      return true;
    }
    if (existing) {
      if (existing.params_hash !== envelope.paramsHash) {
        respond(ctx, res, 409, {
          error: 'stale_retry',
          details: 'actionId was already used with different params; mint a new actionId',
        });
        return true;
      }
      respond(ctx, res, 200, { receipt: normalizeReceiptRow(existing), duplicate: true });
      return true;
    }

    // 4. Governance pre-check — fail CLOSED (§3.6 rule 4). The backing
    // executors re-check internally where the raw endpoints do; this pre-check
    // produces the typed rejected_governance receipt before any side effect.
    const govAction = governanceActionFor(envelope.kind, envelope.params);
    let evaluation;
    try {
      evaluation = evaluateGovernanceAction(govAction, envelope.actor);
    } catch (err) {
      evaluation = { allowed: false, reason: `governance helper unavailable: ${err.message}` };
    }

    // 5. Budget headroom probe (dispatch-class only) — READ-ONLY, happens
    // BEFORE the latch insert so a refusal leaves NO receipt at all: a refusal
    // is not an outcome, and the action must stay retryable after a cap raise.
    const budgetVerdict = await probeBudgets(pool, envelope);
    if (budgetVerdict && budgetVerdict.blocked) {
      respond(ctx, res, 422, budgetRefusal(budgetVerdict));
      return true;
    }

    // 6. Latch insert — PK constraint is the concurrency backstop (AC2):
    // a double-click that races the first request lands here.
    try {
      await pool.query(
        `INSERT INTO action_receipts
           (action_id, kind, target_id, params_hash, actor, outcome, rollback_hint, detail)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6::jsonb)`,
        [
          envelope.actionId,
          envelope.kind,
          envelope.targetId,
          envelope.paramsHash,
          envelope.actor,
          JSON.stringify({ phase: 'executing' }),
        ]
      );
    } catch (err) {
      if (err && err.code === PG.UNIQUE_VIOLATION) {
        const winner = await selectReceipt();
        if (winner && winner.params_hash !== envelope.paramsHash) {
          respond(ctx, res, 409, { error: 'stale_retry', details: 'actionId was already used with different params; mint a new actionId' });
          return true;
        }
        respond(ctx, res, 200, { receipt: normalizeReceiptRow(winner), duplicate: true });
        return true;
      }
      respond(ctx, res, 503, {
        available: false,
        reason: 'query_failed',
        details: err && err.message ? err.message : String(err),
      });
      return true;
    }

    /** Finalize: receipt outcome UPDATE + audit mirror in ONE transaction. */
    const finalize = async (outcome, detail, hintOverride = null) => {
      const hint = hintOverride ?? rollbackHintFor(envelope.kind, detail || {});
      const taskId = await resolveAuditTaskId(pool, envelope);
      const detailWithMeta = { ...(detail || {}) };
      if (!taskId) detailWithMeta.audit_skipped = 'no resolvable task_id (audit_log.task_id is NOT NULL)';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE action_receipts
           SET outcome = $2, rollback_hint = $3, detail = $4::jsonb
           WHERE action_id = $1`,
          [envelope.actionId, outcome, hint, JSON.stringify(detailWithMeta)]
        );
        if (taskId) {
          await client.query(
            `INSERT INTO audit_log (task_id, actor, action, old_value, new_value)
             VALUES ($1, $2, $3, NULL, $4::jsonb)`,
            [
              taskId,
              envelope.actor,
              `action.${envelope.kind}`,
              JSON.stringify({
                action_id: envelope.actionId,
                kind: envelope.kind,
                target_id: envelope.targetId,
                outcome,
                rollback_hint: hint,
                ...(outcome === 'failed' && detailWithMeta.error ? { error: detailWithMeta.error } : {}),
              }),
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return {
        ...normalizeReceiptRow({
          action_id: envelope.actionId,
          kind: envelope.kind,
          target_id: envelope.targetId,
          params_hash: envelope.paramsHash,
          actor: envelope.actor,
          outcome,
          rollback_hint: hint,
          detail: detailWithMeta,
          created_at: new Date().toISOString(),
        }),
      };
    };

    // Governance denial → typed receipt, zero side effects (AC7-shaped).
    if (!evaluation.allowed) {
      const receipt = await finalize('rejected_governance', { reason: evaluation.reason || 'governance denied' });
      respond(ctx, res, 403, { error: 'rejected_governance', reason: evaluation.reason || 'governance denied', receipt });
      return true;
    }

    // 7. Execute the kind's backing operation (reused business logic).
    const executors = options.executors || createDefaultExecutors(store);
    const executor = executors[entry.executor];
    if (typeof executor !== 'function') {
      // Registry/executor wiring bug — surface as unknown_kind, leave the
      // latch as a failed receipt so the actionId cannot half-execute later.
      const receipt = await finalize('failed', { error: `no executor wired for '${entry.executor}'` });
      respond(ctx, res, 400, { error: 'unknown_kind', details: `no executor wired for '${entry.executor}'`, receipt });
      return true;
    }

    try {
      const result = await executor({ envelope, entry, store }) || {};
      const receipt = await finalize('executed', { result });
      respond(ctx, res, 200, { receipt });
    } catch (err) {
      const detail = { error: err && err.message ? err.message : String(err) };
      if (err && err.runCreatedId) detail.new_run_id = err.runCreatedId; // dispatch: run exists, start failed
      const receipt = await finalize('failed', detail);
      const message = detail.error || '';
      const status = /not found/i.test(message) ? 404 : 400;
      respond(ctx, res, status, { error: 'execution_failed', message, receipt });
    }
    return true;
  });
}

module.exports = { registerActionRoutes };
