#!/usr/bin/env node
/**
 * Focused tests for one-click actions slice 1 (DB-free):
 * lib/action-registry.js + routes/action-routes.js + migration 024 DDL.
 * Run: node tests/test-action-routes.js
 *
 * Covered here (work-order list + brief slice-1 ACs reachable without PG):
 * - Envelope validation: unknown kind / missing fields / params-schema
 *   violations → 400 invalid_action BEFORE governance or execution (AC1).
 * - Idempotency replay: existing action_id → stored receipt, duplicate:true,
 *   executor NOT invoked (AC3); concurrent latch conflict → same shape (AC2).
 * - Staleness: same actionId, different paramsHash → 409 stale_retry (AC4).
 * - Deliberate repeat: two distinct actionIds → both execute (AC5).
 * - unknown_kind → 400; no-DB → 503 {available:false} (audit-first refusal).
 * - Severity/confirmation-mode mapping per brief §3.2.
 * - Budget probe: breached pause_new_runs → 422 budget_blocked refusal,
 *   NO receipt written, executor not invoked (AC8-shaped); probe failure
 *   fails OPEN.
 * - Governance denial → rejected_governance receipt, no side effect (AC7).
 * - canonicalJson/hashParams stability (sorted keys, arrays order-preserved).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Router = require('../routes/router');

function createRequest(url, method = 'GET', body = null) {
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    params: {},
    on(event, cb) {
      if (event === 'data' && body != null) cb(JSON.stringify(body));
      if (event === 'end') cb();
    },
  };
}

function createContext(pool) {
  let store = null;
  if (pool) {
    const AsanaStorage = require('../storage/asana');
    store = Object.create(AsanaStorage.prototype);
    store.pool = pool;
  }
  return {
    sendJSON(res, status, payload) {
      res.result = { status, payload };
    },
    asanaStorage: store,
  };
}

async function dispatch(url, { method = 'GET', pool = undefined, body = null, options } = {}) {
  const router = new Router();
  const { registerActionRoutes } = require('../routes/action-routes');
  registerActionRoutes(router, options);
  const req = createRequest(url, method, body);
  const res = {};
  const handled = await router.handle(req, res, url.split('?')[0], method, createContext(pool));
  assert.strictEqual(handled, true, `${url} should be handled`);
  assert.ok(res.result, `${url} should produce a handled JSON response`);
  return res.result;
}

// Counting executors — business logic is injected so the fake pool never has
// to impersonate WorkflowRunsAPI SQL.
function makeExecutors(calls, failOnKind = null) {
  const fns = {};
  for (const name of ['assignTaskOwner', 'dispatchRun', 'decideApproval', 'cancelRun', 'redispatchRun']) {
    fns[name] = async ({ envelope }) => {
      calls.push({ executor: name, envelope });
      if (failOnKind && envelope.kind === failOnKind) throw new Error('forced executor failure');
      if (name === 'dispatchRun') return { new_run_id: 'run-new-1', status: 'running' };
      return { ok: true };
    };
  }
  return fns;
}

// Fake pool routing by SQL shape. receiptRows feeds the action_id SELECT;
// insertConflict simulates a concurrent double-click losing the PK race.
function makePool(opts = {}) {
  const {
    receiptRows = [],
    insertConflict = false,
    taskRow = null,
    runRow = null,
    approvalTaskRow = null,
    budgets = [],
    spendRows = [],
    failOn = null,
    failMessage = 'relation "action_receipts" does not exist',
  } = opts;
  const calls = [];
  let inserts = 0;
  let updates = [];
  let auditInserts = [];
  const pool = {
    calls,
    get inserts() { return inserts; },
    get updates() { return updates; },
    get auditInserts() { return auditInserts; },
    async query(sql, params = []) {
      if (failOn && failOn.test(sql)) throw Object.assign(new Error(failMessage), { code: '42P01' });
      calls.push({ sql, params });
      if (/INSERT INTO action_receipts/.test(sql)) {
        inserts += 1;
        if (insertConflict) return { rows: [] }; // ON CONFLICT would swallow this
        return {
          rows: [{
            action_id: params[0], kind: params[1], target_id: params[2],
            params_hash: params[3], actor: params[4], outcome: params[5],
            rollback_hint: params[6], detail: params[7], created_at: new Date(),
          }],
        };
      }
      if (/UPDATE action_receipts/.test(sql)) {
        updates.push({ sql, params });
        return { rows: [{ action_id: params[0], outcome: params[1] }] };
      }
      if (/INSERT INTO audit_log/.test(sql)) {
        auditInserts.push({ sql, params });
        return { rows: [] };
      }
      if (/FROM action_receipts WHERE action_id/.test(sql)) {
        return { rows: receiptRows.length ? [receiptRows.shift()] : [] };
      }
      if (/JOIN workflow_runs wr ON wr\.id = a\.workflow_run_id/.test(sql)) {
        return { rows: approvalTaskRow ? [approvalTaskRow] : [] };
      }
      if (/SELECT owner_agent_id FROM tasks WHERE id/.test(sql)) {
        return { rows: taskRow ? [taskRow] : [] };
      }
      if (/SELECT owner_agent_id, workflow_type FROM workflow_runs WHERE id/.test(sql)) {
        return { rows: runRow ? [runRow] : [] };
      }
      if (/SELECT task_id FROM workflow_runs WHERE id/.test(sql)) {
        return { rows: runRow ? [{ task_id: runRow.task_id }] : [] };
      }
      // budget-enforcement probe shapes
      if (/SUM\(cost_estimate\)/.test(sql)) {
        const row = spendRows.length ? spendRows.shift() : { spend_usd: 0, spend_tokens: 0, run_count: 0 };
        return { rows: [row] };
      }
      if (/FROM agent_profiles/.test(sql)) return { rows: [] };
      if (/FROM budgets/.test(sql)) return { rows: budgets };
      if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async connect() {
      return {
        query: (sql, params) => pool.query(sql, params),
        release() {},
      };
    },
  };
  return pool;
}

const BASE_ENVELOPE = {
  actionId: 'a1000000-0000-4000-8000-000000000001',
  kind: 'run.cancel',
  targetId: 'b1000000-0000-4000-8000-000000000002',
  params: { reason: 'stale work' },
};

// ── Registry data: severity / confirmation-mode mapping ────────

function testRegistryMapping() {
  const { ACTION_REGISTRY, CONFIRM_MODES, SEVERITIES, ACTION_KINDS } = require('../lib/action-registry');

  assert.deepStrictEqual([...ACTION_KINDS], [
    'task.assign', 'run.dispatch', 'approval.decide', 'run.cancel', 'run.redispatch',
    'task.create', 'task.update', 'snapshot.create',
  ]);

  const expected = {
    'task.assign': { severity: 'LOW', confirmMode: 'NONE' },
    'run.dispatch': { severity: 'MEDIUM', confirmMode: 'PREVIEW_MODAL' },
    'approval.decide': { severity: 'MEDIUM-HIGH', confirmMode: 'PREVIEW_MODAL' },
    'run.cancel': { severity: 'HIGH', confirmMode: 'HOLD_CONFIRM' },
    'run.redispatch': { severity: 'MEDIUM', confirmMode: 'PREVIEW_MODAL' },
    // MCP slice 2 kinds (docs/briefs/mcp-exposure.md §8 OQ2 = YES).
    'task.create': { severity: 'LOW', confirmMode: 'NONE' },
    'task.update': { severity: 'MEDIUM', confirmMode: 'PREVIEW_MODAL' },
    'snapshot.create': { severity: 'LOW', confirmMode: 'NONE' },
  };
  for (const [kind, want] of Object.entries(expected)) {
    const entry = ACTION_REGISTRY[kind];
    assert.ok(entry, `${kind} registered`);
    assert.strictEqual(entry.severity, want.severity, `${kind} severity`);
    assert.strictEqual(entry.confirmMode, want.confirmMode, `${kind} confirmMode`);
    assert.ok(SEVERITIES.includes(entry.severity), `${kind} severity tier valid`);
    assert.ok(CONFIRM_MODES.includes(entry.confirmMode), `${kind} confirm mode valid`);
    assert.strictEqual(typeof entry.executor, 'string', `${kind} executor reference name`);
    assert.ok(entry.governanceAction, `${kind} governance rule present`);
  }

  // LOW ⇔ NONE invariant (brief §3.2: NONE only for LOW).
  for (const entry of Object.values(ACTION_REGISTRY)) {
    if (entry.confirmMode === 'NONE') assert.strictEqual(entry.severity, 'LOW');
    if (entry.severity === 'HIGH') assert.strictEqual(entry.confirmMode, 'HOLD_CONFIRM');
  }

  // Rollback hints present for every kind (brief §3.4).
  for (const entry of Object.values(ACTION_REGISTRY)) {
    assert.ok(entry.rollbackHint && entry.rollbackHint.length > 0, `${entry.kind} rollbackHint`);
  }

  // Dynamic hint interpolation.
  const { rollbackHintFor } = require('../lib/action-registry');
  assert.strictEqual(
    rollbackHintFor('run.dispatch', { new_run_id: 'r-42' }),
    'Cancel run r-42 if unwanted'
  );
  assert.strictEqual(rollbackHintFor('run.cancel'), 'Re-dispatch via run.redispatch');
}

// ── canonicalJson / hashParams stability ───────────────────────

function testCanonicalJsonAndHash() {
  const { canonicalJson, hashParams } = require('../lib/action-registry');

  assert.strictEqual(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.strictEqual(canonicalJson({ x: { d: 4, c: [3, 1, 2] }, y: null }), '{"x":{"c":[3,1,2],"d":4},"y":null}');
  assert.strictEqual(canonicalJson([]), '[]');
  assert.strictEqual(canonicalJson('s'), '"s"');

  // Key order never changes the hash; array order always does.
  assert.strictEqual(hashParams({ a: 1, b: 2 }), hashParams({ b: 2, a: 1 }));
  assert.notStrictEqual(hashParams([1, 2]), hashParams([2, 1]));
  assert.strictEqual(hashParams(undefined), hashParams({}));
}

// ── Envelope validation (AC1) ──────────────────────────────────

async function testEnvelopeValidation() {
  const calls = [];
  const pool = makePool();
  const options = { executors: makeExecutors(calls) };

  // Unknown kind.
  let r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: { ...BASE_ENVELOPE, kind: 'fleet.nuke' }, options,
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.payload.error, 'invalid_action');
  assert.ok(r.payload.details.some(d => d.includes('unknown_kind')));

  // Missing actionId / targetId.
  for (const field of ['actionId', 'targetId']) {
    const body = { ...BASE_ENVELOPE };
    delete body[field];
    r = await dispatch('/api/actions/execute', { method: 'POST', pool, body, options });
    assert.strictEqual(r.status, 400, `${field} required`);
    assert.ok(r.payload.details.some(d => d.includes(field)));
  }

  // Whitespace-only targetId = bad target format.
  r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: { ...BASE_ENVELOPE, targetId: '   ' }, options,
  });
  assert.strictEqual(r.status, 400);

  // Per-kind params violations.
  const badParams = [
    [{ ...BASE_ENVELOPE, kind: 'task.assign', targetId: 't1', params: {} }, 'params.owner'],
    [{ ...BASE_ENVELOPE, kind: 'task.assign', targetId: 't1', params: { owner: 7 } }, 'params.owner'],
    [{ ...BASE_ENVELOPE, kind: 'run.dispatch', targetId: 't1', params: {} }, 'params.template'],
    [{ ...BASE_ENVELOPE, kind: 'approval.decide', targetId: 'a1', params: { decision: 'maybe' } }, 'params.decision'],
    [{ ...BASE_ENVELOPE, kind: 'approval.decide', targetId: 'a1', params: {} }, 'params.decision'],
    [{ ...BASE_ENVELOPE, kind: 'run.dispatch', targetId: 't1', params: { template: 'x', input_payload: 'nope' } }, 'input_payload'],
  ];
  for (const [body, fragment] of badParams) {
    r = await dispatch('/api/actions/execute', { method: 'POST', pool, body, options });
    assert.strictEqual(r.status, 400, `params violation: ${fragment}`);
    assert.strictEqual(r.payload.error, 'invalid_action');
    assert.ok(r.payload.details.some(d => d.includes(fragment)), `details mention ${fragment}`);
  }

  // Valid envelope passes validation and reaches the executor exactly once.
  calls.length = 0;
  r = await dispatch('/api/actions/execute', { method: 'POST', pool, body: BASE_ENVELOPE, options });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].executor, 'cancelRun');
}

// ── Idempotency: replay + concurrency latch (AC2/AC3) ──────────

async function testIdempotentReplay() {
  const calls = [];
  const storedReceipt = {
    action_id: BASE_ENVELOPE.actionId,
    kind: 'run.cancel',
    target_id: BASE_ENVELOPE.targetId,
    params_hash: require('../lib/action-registry').hashParams(BASE_ENVELOPE.params),
    actor: 'dashboard-operator',
    outcome: 'executed',
    rollback_hint: 'Re-dispatch via run.redispatch',
    detail: { result: { run_id: BASE_ENVELOPE.targetId, status: 'cancelled' } },
    created_at: '2026-08-24T10:00:00.000Z',
  };

  // Retry-after-success: stored receipt returned, zero side effects (AC3).
  let pool = makePool({ receiptRows: [storedReceipt] });
  let r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.duplicate, true);
  assert.strictEqual(r.payload.receipt.action_id, BASE_ENVELOPE.actionId);
  assert.strictEqual(r.payload.receipt.outcome, 'executed');
  assert.strictEqual(calls.length, 0, 'executor must NOT run on replay');
  assert.strictEqual(pool.inserts, 0, 'no second receipt row');

  // Concurrent double-click: pre-select misses, PK insert conflicts →
  // duplicate:true, still exactly one execution (AC2).
  pool = makePool({ insertConflict: true, receiptRows: [storedReceipt] });
  calls.length = 0;
  r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.duplicate, true);
  assert.strictEqual(calls.length, 0, 'loser of the PK race must not execute');
}

// ── Staleness guard (AC4) + deliberate repeat (AC5) ────────────

async function testStaleRetryAndRepeat() {
  const { hashParams } = require('../lib/action-registry');
  const calls = [];

  // Same actionId, different paramsHash → 409 stale_retry, no execution (AC4).
  let pool = makePool({
    receiptRows: [{
      action_id: BASE_ENVELOPE.actionId,
      kind: 'run.cancel',
      target_id: BASE_ENVELOPE.targetId,
      params_hash: hashParams({ reason: 'different intent' }),
      actor: 'dashboard-operator',
      outcome: 'executed',
      created_at: '2026-08-24T10:00:00.000Z',
    }],
  });
  let r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.payload.error, 'stale_retry');
  assert.strictEqual(calls.length, 0);

  // Deliberate repeat: two distinct actionIds, identical kind/target/params →
  // both execute, both receipted (AC5 pins retry-vs-repeat semantics).
  pool = makePool();
  calls.length = 0;
  const options = { executors: makeExecutors(calls) };
  for (const suffix of ['1', '2']) {
    r = await dispatch('/api/actions/execute', {
      method: 'POST', pool,
      body: { ...BASE_ENVELOPE, actionId: `a1000000-0000-4000-8000-00000000000${suffix}` },
      options,
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.payload.duplicate, undefined);
    assert.strictEqual(r.payload.receipt.outcome, 'executed');
  }
  assert.strictEqual(calls.length, 2, 'both repeats execute');
  assert.strictEqual(pool.inserts, 2, 'one receipt row each');
}

// ── unknown_kind 400 + no-database 503 ─────────────────────────

async function testUnknownKindAndNoDatabase() {
  const calls = [];

  // Registry-checked unknown kind → 400 unknown_kind-shaped invalid_action.
  let pool = makePool();
  let r = await dispatch('/api/actions/execute', {
    method: 'POST', pool,
    body: { ...BASE_ENVELOPE, kind: 'import.run' },
    options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.payload.error, 'invalid_action');
  assert.strictEqual(pool.inserts, 0);

  // No DB → 503 {available:false}, audit-first refusal: zero writes (AC9).
  r = await dispatch('/api/actions/execute', {
    method: 'POST', pool: undefined, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.payload.available, false);
  assert.strictEqual(r.payload.reason, 'no_database');
  assert.strictEqual(calls.length, 0);

  // Migration unapplied (undefined_table) → receipts_unavailable refusal.
  pool = makePool({ failOn: /FROM action_receipts WHERE action_id/ });
  r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.payload.reason, 'receipts_unavailable');
  assert.strictEqual(calls.length, 0);

  // GET recent degrades with the house read contract (200).
  r = await dispatch('/api/actions/recent?limit=50', { pool: undefined });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.available, false);
  assert.strictEqual(r.payload.reason, 'no_database');

  pool = makePool({ failOn: /FROM action_receipts\s*\n?\s*ORDER BY/ });
  r = await dispatch('/api/actions/recent', { pool });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.reason, 'receipts_unavailable');
}

// ── Execute happy path: receipt + audit mirror in one tx ───────

async function testExecuteWritesReceiptAndAudit() {
  const calls = [];
  const pool = makePool({ runRow: { id: BASE_ENVELOPE.targetId, task_id: 'task-1' } });
  const r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.receipt.outcome, 'executed');
  assert.strictEqual(r.payload.receipt.rollback_hint, 'Re-dispatch via run.redispatch');
  assert.strictEqual(calls.length, 1);

  // Finalization: exactly one UPDATE (outcome) + exactly one audit mirror row.
  assert.strictEqual(pool.updates.length, 1);
  assert.strictEqual(pool.updates[0].params[1], 'executed');
  assert.strictEqual(pool.auditInserts.length, 1);
  const audit = pool.auditInserts[0].params;
  assert.strictEqual(audit[0], 'task-1'); // resolved from workflow_runs.task_id
  assert.strictEqual(audit[1], 'dashboard-operator');
  assert.strictEqual(audit[2], 'action.run.cancel'); // brief §3.4 naming
  const newValue = JSON.parse(audit[3]);
  assert.strictEqual(newValue.action_id, BASE_ENVELOPE.actionId);
  assert.strictEqual(newValue.outcome, 'executed');
}

// ── Governance denial (AC7) ────────────────────────────────────

async function testGovernanceDenial() {
  const calls = [];
  const pool = makePool({ runRow: { id: BASE_ENVELOPE.targetId, task_id: 'task-1' } });
  const r = await dispatch('/api/actions/execute', {
    method: 'POST', pool,
    body: { ...BASE_ENVELOPE, actor: 'some-random-agent' }, // non-privileged, no profile capabilities
    options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.payload.error, 'rejected_governance');
  assert.strictEqual(r.payload.receipt.outcome, 'rejected_governance');
  assert.strictEqual(calls.length, 0, 'no side effect on governance denial');
  assert.strictEqual(pool.auditInserts.length, 1); // receipt mirrored to audit_log

  // Privileged actor passes the same gate.
  const pool2 = makePool({ runRow: { id: BASE_ENVELOPE.targetId, task_id: 'task-1' } });
  const r2 = await dispatch('/api/actions/execute', {
    method: 'POST', pool: pool2,
    body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.payload.receipt.outcome, 'executed');
}

// ── Budget probe: block refuses WITHOUT a receipt; failure fails open ──

async function testBudgetInterplay() {
  const breachedBudget = {
    id: 'budget-1', name: 'affiliate monthly cap', scope: 'agent', scope_id: 'coder',
    period: 'monthly', cap_usd: 50, cap_tokens: null, action_on_exceed: 'pause_new_runs', active: true,
  };
  const calls = [];

  // Breached pause_new_runs over the dispatch scope chain → structured
  // refusal, NO receipt written, NO execution (work order: refusal ≠ outcome).
  let pool = makePool({
    taskRow: { id: 'task-1', owner_agent_id: 'coder' },
    budgets: [breachedBudget],
    spendRows: [{ spend_usd: 61.25, spend_tokens: 900000, run_count: 10 }],
  });
  let r = await dispatch('/api/actions/execute', {
    method: 'POST', pool,
    body: {
      actionId: 'c1000000-0000-4000-8000-000000000001',
      kind: 'run.dispatch',
      targetId: 'task-1',
      params: { template: 'code-change', input_payload: { prompt: 'fix bug' } },
    },
    options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 422);
  assert.strictEqual(r.payload.error, 'budget_blocked');
  assert.strictEqual(r.payload.action, 'pause_new_runs');
  assert.strictEqual(r.payload.budgets.length, 1);
  assert.strictEqual(r.payload.budgets[0].name, 'affiliate monthly cap');
  assert.strictEqual(r.payload.budgets[0].period_key, typeof r.payload.budgets[0].period_key === 'string' ? r.payload.budgets[0].period_key : null);
  assert.ok(r.payload.budgets[0].pct_of_cap >= 100);
  assert.strictEqual(pool.inserts, 0, 'refusal writes NO receipt');
  assert.strictEqual(calls.length, 0, 'no run dispatched through a breach');

  // Probe unavailable (budgets table missing → checkRun fails open) → proceeds.
  pool = makePool({ taskRow: { id: 'task-1', owner_agent_id: 'coder' }, failOn: /FROM budgets/ });
  calls.length = 0;
  r = await dispatch('/api/actions/execute', {
    method: 'POST', pool,
    body: {
      actionId: 'c1000000-0000-4000-8000-000000000002',
      kind: 'run.dispatch',
      targetId: 'task-1',
      params: { template: 'code-change', input_payload: { prompt: 'fix bug' } },
    },
    options: { executors: makeExecutors(calls) },
  });
  assert.strictEqual(r.status, 200, 'probe failure fails OPEN (dispatcher remains backstop)');
  assert.strictEqual(calls.length, 1);

  // Non-dispatch kinds skip the probe entirely (zero budget queries).
  pool = makePool({ runRow: { id: BASE_ENVELOPE.targetId, task_id: 'task-1' } });
  calls.length = 0;
  await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE, options: { executors: makeExecutors(calls) },
  });
  assert.ok(!pool.calls.some(c => /FROM budgets/.test(c.sql)), 'run.cancel does not probe budgets');
}

// ── Executor failure → failed receipt, honest error ────────────

async function testExecutorFailure() {
  const calls = [];
  const pool = makePool({ runRow: { id: BASE_ENVELOPE.targetId, task_id: 'task-1' } });
  const r = await dispatch('/api/actions/execute', {
    method: 'POST', pool, body: BASE_ENVELOPE,
    options: { executors: makeExecutors(calls, 'run.cancel') },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.payload.error, 'execution_failed');
  assert.strictEqual(r.payload.receipt.outcome, 'failed');
  assert.strictEqual(pool.auditInserts.length, 1);
  assert.strictEqual(JSON.parse(pool.auditInserts[0].params[3]).outcome, 'failed');
}

// ── Migration 024 fixture: latch PK + enum CHECKs present ──────

function testMigrationFixture() {
  const ddl = fs.readFileSync(
    path.join(__dirname, '..', 'schema', 'migrations', '024_add_action_receipts.sql'),
    'utf8'
  );
  assert.ok(/CREATE TABLE IF NOT EXISTS action_receipts/.test(ddl), 'idempotent CREATE');
  assert.ok(/action_id TEXT PRIMARY KEY/.test(ddl), 'PK = idempotency latch');
  assert.ok(/kind TEXT NOT NULL CHECK \(kind IN \(/.test(ddl), 'kind CHECK');
  for (const kind of ['task.assign', 'run.dispatch', 'approval.decide', 'run.cancel', 'run.redispatch']) {
    assert.ok(ddl.includes(`'${kind}'`), `catalog kind ${kind} in CHECK`);
  }
  assert.ok(/outcome TEXT NULL CHECK/.test(ddl), 'outcome CHECK (NULL while executing)');
  for (const outcome of ['executed', 'rejected_governance', 'blocked_budget', 'failed', 'duplicate']) {
    assert.ok(ddl.includes(`'${outcome}'`), `outcome ${outcome} in CHECK`);
  }
  assert.ok(/params_hash TEXT NOT NULL/.test(ddl), 'staleness guard column');
  assert.ok(/created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(ddl), 'created_at default');
  assert.ok(/idx_action_receipts_created/.test(ddl), 'recent-feed index');
  assert.ok(/INSERT INTO schema_migrations \(migration_name\) VALUES \('024_add_action_receipts'\) ON CONFLICT DO NOTHING/.test(ddl),
    'migration tracked idempotently');
}

// ── Runner ─────────────────────────────────────────────────────

(async function main() {
  let passed = 0;
  let failed = 0;
  const tests = [
    testRegistryMapping,
    testCanonicalJsonAndHash,
    testEnvelopeValidation,
    testIdempotentReplay,
    testStaleRetryAndRepeat,
    testUnknownKindAndNoDatabase,
    testExecuteWritesReceiptAndAudit,
    testGovernanceDenial,
    testBudgetInterplay,
    testExecutorFailure,
    testMigrationFixture,
  ];
  for (const test of tests) {
    try {
      await test();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${test.name}`);
      console.error(err);
    }
  }
  console.log(`\n${passed}/${tests.length} assertion groups passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
