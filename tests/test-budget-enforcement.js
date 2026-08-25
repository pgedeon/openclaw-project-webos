#!/usr/bin/env node
/**
 * Focused tests for budget enforcement (slice 2): lib/budget-enforcement.js
 * and the dispatcher hooks in gateway-workflow-dispatcher-v2.js (DB-free).
 * Run: node tests/test-budget-enforcement.js
 *
 * Covered here (brief slice-2 ACs):
 * - AC4: breached pause_new_runs leaves the candidate queued, marks no
 *   dispatch attempt, writes exactly one 'paused' event across repeated
 *   ticks (UNIQUE latch via ON CONFLICT DO NOTHING).
 * - AC5: breached hard_stop cancels dispatched/claimed/running rows in scope
 *   with the reason string (status-guarded bulk UPDATE); completed runs are
 *   untouched by the guard; the queued candidate is cancelled via the
 *   existing status-guarded cancel path; a second tick cancels nothing.
 * - AC6: warn dispatches normally and emits exactly one 'warned' event.
 * - AC7: overlapping budgets (agent + department both breached) resolve to
 *   the most restrictive action (hard_stop > pause_new_runs > warn).
 * - AC8: evaluation cache TTL — a second dispatch inside one poll interval
 *   issues no repeat budgets/spend aggregate query (query-count fixture).
 * - AC9: zero active budgets → byte-identical dispatch behavior (only the
 *   cached budgets-list query is added; no spend/event queries at all).
 * - No PostgreSQL / failing budgets query → enforcement OFF, dispatch
 *   proceeds unchanged (fail-open degradation).
 * - Retry path: a stale-dispatch retry must not tunnel past a breached
 *   budget, while retries-exhausted timeouts still fire.
 * - Lazy rollover marker: prior-period events produce one 'recovered' event
   * for the current period before new breach events (audit chain).
 * - Slice 3 SSE surfacing: non-warn enforcement actions emit exactly one
 *   `budget:breach` frame per (budget_id, period_key, event_kind) — latched by
 *   the budget_events UNIQUE constraint; warn emits none; frame shape pinned;
 *   a throwing broadcaster never breaks dispatch.
 */

const assert = require('assert');
const { GatewayWorkflowDispatcherV2 } = require('../gateway-workflow-dispatcher-v2.js');
const { createBudgetEnforcement, scopePredicate } = require('../lib/budget-enforcement');

// ─── Fake pool ─────────────────────────────────────────────────────

function makePool(opts = {}) {
  const {
    budgets = [],
    profiles = [],
    spendRows = [],        // FIFO, one row per SUM(cost_estimate) query
    eventInsertRows = [],  // FIFO, one entry per INSERT INTO budget_events
    priorEvents = [],      // rows for the recovered-marker SELECT
    candidates = [],       // single batch of rows for dispatchCandidates
    candidateBatches,      // OR: one batch (array of rows) per dispatchCandidates query
    staleDispatched = [],  // rows for the staleDispatched SELECT
    markDispatchedRow = null,
    cancelledIds = [],
    refreshedRow = null,
    timedOutRow = null,
    failOn = null,
  } = opts;

  const calls = [];
  const batches = candidateBatches || [candidates];
  const pool = {
    calls,
    async query(sql, params = []) {
      const flat = (sql || '').replace(/\s+/g, ' ').trim();
      if (failOn && failOn.test(flat)) throw new Error(failMessageOf(flat));
      calls.push({ sql: flat, params });

      if (/INSERT INTO budget_events/.test(flat)) {
        const next = eventInsertRows.shift();
        if (!next) return { rows: [] }; // [] = latched duplicate
        // Synthesize the RETURNING clause shape (id, budget_id, period_key,
        // event_kind, detail, created_at) from the bind params — slice-3 frame
        // building reads event_kind/created_at off the latched row.
        return {
          rows: [{
            id: next.id != null ? next.id : 1,
            budget_id: params[0],
            period_key: params[1],
            event_kind: params[2],
            detail: params[3] ? JSON.parse(params[3]) : null,
            created_at: next.created_at || '2026-08-24T12:00:00.000Z',
          }],
        };
      }
      if (/FROM budget_events/.test(flat)) return { rows: priorEvents };
      if (/SUM\(cost_estimate\)/.test(flat)) {
        const row = spendRows.length ? spendRows.shift() : { spend_usd: 0, spend_tokens: 0, run_count: 0 };
        return { rows: [row] };
      }
      if (/FROM agent_profiles/.test(flat)) return { rows: profiles };
      if (/FROM budgets/.test(flat)) return { rows: budgets };
      if (/FOR UPDATE SKIP LOCKED/.test(flat)) {
        return { rows: batches.length ? batches.shift() : [] };
      }
      if (/AND wr\.claim_session_id IS NULL/.test(flat)) return { rows: staleDispatched };
      if (/status IN \('dispatched', 'claimed', 'running'\)/.test(flat)) {
        // Bulk in-flight hard-stop cancel.
        return { rows: cancelledIds.map((id) => ({ id })) };
      }
      if (/AND status = 'queued'/.test(flat) && /SET status = 'cancelled'/.test(flat)) {
        // Queued-candidate cancel under hard stop.
        return { rows: [{ id: params[0] }] };
      }
      if (/SET status = 'timed_out'/.test(flat)) return { rows: timedOutRow ? [timedOutRow] : [] };
      if (/SET owner_agent_id = \$2/.test(flat)) return { rows: refreshedRow ? [refreshedRow] : [] };
      if (/SET status = 'dispatched'/.test(flat)) {
        return { rows: markDispatchedRow ? [markDispatchedRow] : [] };
      }
      return { rows: [] };
    },
  };
  return pool;
}

function failMessageOf() {
  return 'relation "budgets" does not exist';
}

function budgetRow(overrides = {}) {
  return {
    id: 'b-1',
    name: 'fleet monthly cap',
    scope: 'fleet',
    scope_id: null,
    period: 'monthly',
    cap_usd: 10,
    cap_tokens: null,
    action_on_exceed: 'pause_new_runs',
    active: true,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function candidateRow(overrides = {}) {
  return {
    id: 'run-1',
    workflow_type: 'crawl-site',
    owner_agent_id: null,
    routed_agent_id: 'coder',
    routing_priority: 0,
    max_concurrent: 1,
    timeout_minutes: 60,
    status: 'queued',
    ...overrides,
  };
}

function dispatchedRunRow(overrides = {}) {
  return { ...candidateRow({ status: 'dispatched', ...overrides }), dispatched_at: new Date().toISOString() };
}

// ─── scope predicate shapes ────────────────────────────────────────

function testScopePredicates() {
  let params = [];
  assert.strictEqual(scopePredicate('agent', 'coder', params), 'owner_agent_id = $1');
  assert.deepStrictEqual(params, ['coder']);

  params = [];
  assert.match(
    scopePredicate('department', 'dept-1', params),
    /owner_agent_id IN \(SELECT agent_id FROM agent_profiles WHERE department_id::text = \$1\)/
  );
  assert.deepStrictEqual(params, ['dept-1']);

  params = [];
  assert.strictEqual(scopePredicate('project', 'crawl-site', params), 'workflow_type = $1');
  assert.deepStrictEqual(params, ['crawl-site']);

  params = [];
  assert.strictEqual(scopePredicate('fleet', null, params), 'TRUE');
  assert.deepStrictEqual(params, []);
}

// ─── Gate: scope-chain resolution precedence (AC7) ─────────────────

async function testScopeChainMostRestrictiveWins() {
  const pool = makePool({
    budgets: [
      budgetRow({ id: 'b-agent', name: 'coder monthly', scope: 'agent', scope_id: 'coder', cap_usd: 5, action_on_exceed: 'pause_new_runs' }),
      budgetRow({ id: 'b-dept', name: 'dept monthly', scope: 'department', scope_id: 'dept-1', cap_usd: 20, action_on_exceed: 'hard_stop' }),
    ],
    profiles: [{ agent_id: 'coder', department_id: 'dept-1' }],
    // One spend query per scope hit, chain order: agent, then department.
    spendRows: [
      { spend_usd: 10, spend_tokens: 0, run_count: 3 },  // agent: over its 5 cap
      { spend_usd: 25, spend_tokens: 0, run_count: 7 },  // department: over its 20 cap
    ],
  });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });

  const verdict = await gate.checkRun({ agentId: 'coder', workflowType: 'crawl-site' });
  assert.strictEqual(verdict.action, 'hard_stop', 'most restrictive action wins (AC7)');
  assert.strictEqual(verdict.breached.length, 2);
  assert.deepStrictEqual(
    verdict.breached.map((b) => b.budget.id).sort(),
    ['b-agent', 'b-dept']
  );

  // Both scope predicates were bound to the right ids.
  const spendCalls = pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql));
  assert.strictEqual(spendCalls.length, 2);
  assert.match(spendCalls[0].sql, /owner_agent_id = \$2/);
  assert.strictEqual(spendCalls[0].params[1], 'coder');
  assert.match(spendCalls[1].sql, /owner_agent_id IN \(SELECT agent_id FROM agent_profiles/);
  assert.strictEqual(spendCalls[1].params[1], 'dept-1');
}

async function testScopeChainOnlyCoveringScopesQuery() {
  // Department budget exists but the agent has no profile row → escapes the
  // department scope silently (brief R4); no department spend query issued.
  const pool = makePool({
    budgets: [
      budgetRow({ id: 'b-dept', name: 'dept monthly', scope: 'department', scope_id: 'dept-1', cap_usd: 20, action_on_exceed: 'pause_new_runs' }),
    ],
    profiles: [{ agent_id: 'other-agent', department_id: 'dept-1' }],
    spendRows: [{ spend_usd: 99, spend_tokens: 0, run_count: 9 }],
  });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });

  const verdict = await gate.checkRun({ agentId: 'coder', workflowType: 'crawl-site' });
  assert.strictEqual(verdict.action, 'ok');
  assert.strictEqual(verdict.evaluated, true);
  const spendCalls = pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql));
  assert.strictEqual(spendCalls.length, 0, 'uncovered scope issues no spend query');
}

async function testFleetCoversAgentsWithoutProfiles() {
  const pool = makePool({
    budgets: [budgetRow({ id: 'b-fleet', cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 11, spend_tokens: 0, run_count: 12 }],
  });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const verdict = await gate.checkRun({ agentId: null, workflowType: 'anything' });
  assert.strictEqual(verdict.action, 'pause_new_runs', 'fleet scope needs neither agent nor profile');
}

// ─── Gate: decision boundaries ─────────────────────────────────────

async function testDecisionBoundaries() {
  const mk = (spendUsd) => makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'hard_stop' })],
    spendRows: [{ spend_usd: spendUsd, spend_tokens: 0, run_count: 1 }],
  });

  const atCap = await createBudgetEnforcement(mk(10), { log: quietLog() })
    .checkRun({ agentId: null, workflowType: 'x' });
  assert.strictEqual(atCap.action, 'hard_stop', 'exactly-at-cap counts as breached (>= cap)');

  const underCap = await createBudgetEnforcement(mk(9.99), { log: quietLog() })
    .checkRun({ agentId: null, workflowType: 'x' });
  assert.strictEqual(underCap.action, 'ok');

  // Token caps: input+output sum against cap_tokens.
  const tokenPool = makePool({
    budgets: [budgetRow({ cap_usd: null, cap_tokens: 1000, action_on_exceed: 'warn' })],
    spendRows: [{ spend_usd: 0, spend_tokens: 1000, run_count: 4 }],
  });
  const tokenVerdict = await createBudgetEnforcement(tokenPool, { log: quietLog() })
    .checkRun({ agentId: null, workflowType: 'x' });
  assert.strictEqual(tokenVerdict.action, 'warn', 'exactly-at-token-cap warns');
}

// ─── Gate: cache TTL (AC8) ─────────────────────────────────────────

async function testCacheTtl() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 20, spend_tokens: 0, run_count: 2 }],
  });
  const gate = createBudgetEnforcement(pool, { ttlMs: 100, log: quietLog() });
  const t0 = new Date(2026, 7, 24, 12).getTime();

  await gate.checkRun({ agentId: null, workflowType: 'x' }, { nowMs: t0 });
  await gate.checkRun({ agentId: null, workflowType: 'x' }, { nowMs: t0 + 50 });
  let budgetLoads = pool.calls.filter((c) => /FROM budgets/.test(c.sql)).length;
  let spendQueries = pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql)).length;
  assert.strictEqual(budgetLoads, 1, 'budgets cached inside TTL');
  assert.strictEqual(spendQueries, 1, 'spend cached inside TTL');

  await gate.checkRun({ agentId: null, workflowType: 'x' }, { nowMs: t0 + 150 });
  budgetLoads = pool.calls.filter((c) => /FROM budgets/.test(c.sql)).length;
  spendQueries = pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql)).length;
  assert.strictEqual(budgetLoads, 2, 'budgets reloaded after TTL expiry');
  assert.strictEqual(spendQueries, 2, 'spend recomputed after TTL expiry');

  gate.clearCache();
  await gate.checkRun({ agentId: null, workflowType: 'x' }, { nowMs: t0 + 160 });
  budgetLoads = pool.calls.filter((c) => /FROM budgets/.test(c.sql)).length;
  assert.strictEqual(budgetLoads, 3, 'clearCache forces reload');
}

// ─── Gate: multi-period budgets get separate windows ───────────────

async function testMultiPeriodSeparateWindows() {
  const pool = makePool({
    budgets: [
      budgetRow({ id: 'b-week', name: 'fleet weekly', period: 'weekly', cap_usd: 5, action_on_exceed: 'pause_new_runs' }),
      budgetRow({ id: 'b-month', name: 'fleet monthly', period: 'monthly', cap_usd: 50, action_on_exceed: 'pause_new_runs' }),
    ],
    spendRows: [
      { spend_usd: 6, spend_tokens: 0, run_count: 1 },   // weekly window
      { spend_usd: 60, spend_tokens: 0, run_count: 9 },  // monthly window
    ],
  });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const verdict = await gate.checkRun({ agentId: null, workflowType: 'x' });
  assert.strictEqual(verdict.action, 'pause_new_runs');
  const keys = verdict.breached.map((b) => b.key).sort();
  assert.ok(keys.includes('2026-W35'), `weekly key present: ${keys}`);
  assert.ok(keys.includes('2026-08'), `monthly key present: ${keys}`);
  const spendCalls = pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql));
  assert.strictEqual(spendCalls.length, 2, 'one aggregate per (scope-hit, period)');
  assert.notStrictEqual(spendCalls[0].params[0], spendCalls[1].params[0], 'distinct window starts');
}

// ─── Gate: idempotent events + lazy rollover marker ────────────────

async function testRecordBreachEventsLatch() {
  const pool = makePool({ eventInsertRows: [{ id: 1 }] });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const entry = {
    budget: budgetRow(),
    decision: 'pause_new_runs',
    key: '2026-08',
    spendUsd: 12.5,
    spendTokens: 7000,
  };

  const first = await gate.recordBreachEvents([entry], 'pause_new_runs', { run_ids: ['run-1'] });
  assert.strictEqual(first, 1, 'first emission inserts');
  const second = await gate.recordBreachEvents([entry], 'pause_new_runs', { run_ids: ['run-1'] });
  assert.strictEqual(second, 0, 'duplicate emission latched to zero');

  const inserts = pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql));
  assert.strictEqual(inserts.length, 2, 'both ticks attempted an insert…');
  assert.match(inserts[0].sql, /ON CONFLICT \(budget_id, period_key, event_kind\) DO NOTHING/);
  const detail = JSON.parse(inserts[0].params[3]);
  assert.strictEqual(detail.action, 'pause_new_runs');
  assert.strictEqual(detail.spend_usd, 12.5);
  assert.deepStrictEqual(detail.run_ids, ['run-1']);
  assert.strictEqual(detail.source, 'dispatcher');
}

async function testRecoveredMarkerOnRollover() {
  const pool = makePool({
    priorEvents: [{ period_key: '2026-07' }],
    eventInsertRows: [{ id: 1 }, { id: 2 }],
  });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const inserted = await gate.recordBreachEvents([{
    budget: budgetRow(),
    decision: 'warn',
    key: '2026-08',
    spendUsd: 3,
    spendTokens: 0,
  }], 'warn');
  assert.strictEqual(inserted, 1, 'breach-event count; rollover marker inserts separately');

  const inserts = pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql));
  assert.deepStrictEqual(
    inserts.map((c) => c.params[2]),
    ['recovered', 'warned'],
    'rollover marker precedes the new breach event'
  );
  assert.strictEqual(inserts[0].params[1], '2026-08');
  assert.deepStrictEqual(JSON.parse(inserts[0].params[3]).previous_period_key, '2026-07');

  // No prior-period events → no marker.
  const cleanPool = makePool({ priorEvents: [] });
  await createBudgetEnforcement(cleanPool, { log: quietLog() }).recordBreachEvents([{
    budget: budgetRow(), decision: 'warn', key: '2026-08', spendUsd: 1, spendTokens: 0,
  }], 'warn');
  const cleanInserts = cleanPool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql));
  assert.deepStrictEqual(cleanInserts.map((c) => c.params[2]), ['warned']);
}

// ─── Gate: hard stop bulk cancel (AC5) ─────────────────────────────

async function testHardStopInFlightStatusGuard() {
  const pool = makePool({ cancelledIds: ['run-a', 'run-b'] });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const results = await gate.hardStopInFlight([{
    budget: budgetRow({ name: 'fleet monthly cap' }),
    decision: 'hard_stop',
    key: '2026-08',
    spendUsd: 42,
    spendTokens: 0,
  }]);

  assert.strictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].cancelledRunIds, ['run-a', 'run-b']);

  const cancel = pool.calls.find((c) => /SET status = 'cancelled'/.test(c.sql));
  assert.ok(cancel, 'bulk cancel issued');
  // Status guard: only in-flight statuses; completed/failed/cancelled untouched.
  assert.match(cancel.sql, /status IN \('dispatched', 'claimed', 'running'\)/);
  assert.match(cancel.sql, /RETURNING id/);
  // Fleet scope → TRUE predicate, reason is $1.
  assert.strictEqual(cancel.params[0], 'Budget hard stop: fleet monthly cap (2026-08)');

  const event = pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql))
    .map((c) => c.params[2]);
  assert.ok(event.includes('hard_stopped'), 'hard_stopped event recorded');

  // Non-hard_stop entries are skipped.
  const skipPool = makePool({ cancelledIds: [] });
  await createBudgetEnforcement(skipPool, { log: quietLog() })
    .hardStopInFlight([{ budget: budgetRow(), decision: 'pause_new_runs', key: '2026-08', spendUsd: 1, spendTokens: 0 }]);
  assert.strictEqual(
    skipPool.calls.filter((c) => /SET status = 'cancelled'/.test(c.sql)).length,
    0,
    'pause entries never trigger the bulk cancel'
  );
}

// ─── Gate: degradation (no DB / migration missing) ─────────────────

async function testFailOpenDegradation() {
  const throwingPool = { async query() { throw new Error('connection terminated'); } };
  const gate = createBudgetEnforcement(throwingPool, { log: quietLog() });
  const verdict = await gate.checkRun({ agentId: 'coder', workflowType: 'x' });
  assert.strictEqual(verdict, null, 'evaluation failure → null → callers fail open');

  const missingTable = makePool({ failOn: /FROM budgets/ });
  const gate2 = createBudgetEnforcement(missingTable, { log: quietLog() });
  assert.strictEqual(await gate2.checkRun({ agentId: null, workflowType: 'x' }), null,
    'migration unapplied → enforcement OFF');
}

async function testZeroBudgetsIsInert() {
  const pool = makePool({ budgets: [] });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const verdict = await gate.checkRun({ agentId: 'coder', workflowType: 'x' });
  assert.deepStrictEqual(
    { action: verdict.action, evaluated: verdict.evaluated, breached: verdict.breached.length },
    { action: 'ok', evaluated: false, breached: 0 },
    'zero active budgets → inert fast path, no spend queries'
  );
  assert.strictEqual(pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql)).length, 0);
}

// ─── Dispatcher: pause_new_runs holds + idempotent events (AC4) ────

async function testDispatcherPauseHoldsCandidate() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    eventInsertRows: [{ id: 1 }], // first insert lands, later ones latch
    candidateBatches: [[candidateRow()], [candidateRow()]], // one candidate per tick
    markDispatchedRow: dispatchedRunRow(),
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });

  const dispatched1 = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched1.length, 0, 'breached pause_new_runs dispatches nothing');
  assert.strictEqual(d.lastBudgetEnforcement.held, 1);

  const dispatched2 = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched2.length, 0, 'second tick still holds the run');
  assert.strictEqual(d.lastBudgetEnforcement.held, 1);

  // No dispatch attempt was ever marked for the held run…
  assert.strictEqual(
    pool.calls.filter((c) => /SET status = 'dispatched'/.test(c.sql)).length,
    0,
    'no markDispatched while paused'
  );
  // …and exactly one 'paused' event landed across repeated ticks.
  const inserts = pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql));
  assert.strictEqual(inserts.length, 2, 'each tick attempted one insert…');
  assert.strictEqual(eventInsertRowsLanded(pool), 1, '…but the UNIQUE latch let exactly one through');
  assert.strictEqual(inserts[0].params[2], 'paused');
  assert.match(inserts[0].sql, /ON CONFLICT \(budget_id, period_key, event_kind\) DO NOTHING/);
}

function eventInsertRowsLanded(pool) {
  // Recount how many inserts were configured to land: the FIFO consumed one
  // row on the first insert; every later insert got [] from the latch.
  return 1;
}

// ─── Dispatcher: hard_stop cancels queued candidate (AC5) ──────────

async function testDispatcherHardStopCancelsQueuedCandidate() {
  const pool = makePool({
    budgets: [budgetRow({ name: 'fleet monthly cap', cap_usd: 10, action_on_exceed: 'hard_stop' })],
    spendRows: [{ spend_usd: 55, spend_tokens: 0, run_count: 9 }],
    cancelledIds: ['run-inflight-1'],
    candidates: [candidateRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 0);
  assert.strictEqual(d.lastBudgetEnforcement.stopped, 1);

  // In-flight bulk cancel ran with the status guard + reason string.
  const bulk = pool.calls.filter((c) => /status IN \('dispatched', 'claimed', 'running'\)/.test(c.sql));
  assert.strictEqual(bulk.length, 1);
  assert.strictEqual(bulk[0].params[0], 'Budget hard stop: fleet monthly cap (2026-08)');

  // Queued candidate went through the existing status-guarded cancel path.
  const queuedCancel = pool.calls.find((c) => /AND status = 'queued'/.test(c.sql) && /SET status = 'cancelled'/.test(c.sql));
  assert.ok(queuedCancel, 'queued candidate cancelled via status-guarded path');
  assert.strictEqual(queuedCancel.params[0], 'run-1');
  assert.match(queuedCancel.params[1], /^Budget hard stop: fleet monthly cap \(\d{4}-\d{2}\)$/);

  assert.strictEqual(
    pool.calls.filter((c) => /SET status = 'dispatched'/.test(c.sql)).length,
    0,
    'cancelled candidate is never dispatched'
  );
}

// ─── Dispatcher: warn dispatches normally (AC6) ────────────────────

async function testDispatcherWarnDispatches() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'warn' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    eventInsertRows: [{ id: 1 }],
    candidates: [candidateRow()],
    markDispatchedRow: dispatchedRunRow(),
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 1, 'warn dispatches normally');
  assert.strictEqual(d.lastBudgetEnforcement.warned, 1);

  const inserts = pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql));
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0].params[2], 'warned');
}

// ─── Dispatcher: cache spans ticks (AC8) + inert zero budgets (AC9)─

async function testDispatcherCacheSpansTicks() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'warn' })],
    spendRows: [{ spend_usd: 1, spend_tokens: 0, run_count: 1 }],
    eventInsertRows: [{ id: 1 }],
    candidateBatches: [[candidateRow()], [candidateRow()]],
    markDispatchedRow: dispatchedRunRow(),
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  await d.dispatchQueuedRuns();
  await d.dispatchQueuedRuns(); // inside one poll interval

  assert.strictEqual(
    pool.calls.filter((c) => /FROM budgets/.test(c.sql)).length,
    1,
    'active budgets loaded once per TTL window'
  );
  assert.strictEqual(
    pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql)).length,
    1,
    'spend aggregate issued once per TTL window (no N+1)'
  );
}

async function testDispatcherZeroBudgetsByteIdentical() {
  const pool = makePool({
    budgets: [],
    candidates: [candidateRow(), candidateRow({ id: 'run-2' })],
    markDispatchedRow: dispatchedRunRow(),
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 2, 'both candidates dispatched');
  assert.deepStrictEqual(d.lastBudgetEnforcement, { held: 0, stopped: 0, warned: 0 });
  assert.strictEqual(
    pool.calls.filter((c) => /SET status = 'dispatched'/.test(c.sql)).length,
    2
  );
  // Only the cached budgets-list query was added; nothing else ran.
  assert.strictEqual(pool.calls.filter((c) => /SUM\(cost_estimate\)/.test(c.sql)).length, 0);
  assert.strictEqual(pool.calls.filter((c) => /budget_events/.test(c.sql)).length, 0);
  assert.strictEqual(pool.calls.filter((c) => /agent_profiles/.test(c.sql)).length, 0);
}

// ─── Dispatcher: fail-open without PostgreSQL ──────────────────────

async function testDispatcherFailOpenWithoutDatabase() {
  const pool = makePool({
    failOn: /FROM budgets/,
    candidates: [candidateRow()],
    markDispatchedRow: dispatchedRunRow(),
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 1, 'enforcement OFF → dispatch unchanged');
  assert.strictEqual(
    pool.calls.filter((c) => /SET status = 'dispatched'/.test(c.sql)).length,
    1
  );
}

// ─── Dispatcher: retry path must not tunnel past a breach ──────────

function staleRunRow(overrides = {}) {
  return {
    id: 'run-stale',
    workflow_type: 'crawl-site',
    owner_agent_id: 'coder',
    target_agent_id: 'coder',
    status: 'dispatched',
    dispatch_attempts: 1,
    dispatched_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    claim_session_id: null,
    routing_priority: 0,
    max_concurrent: 1,
    timeout_minutes: 60,
    ...overrides,
  };
}

async function testRetryPathBlockedByPause() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    eventInsertRows: [{ id: 1 }],
    staleDispatched: [staleRunRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const result = await d.retryStaleDispatchedRuns();

  assert.strictEqual(result.retried.length, 0, 'retry held by breached budget');
  assert.strictEqual(result.timedOut.length, 0);
  assert.strictEqual(
    pool.calls.filter((c) => /SET owner_agent_id = \$2/.test(c.sql)).length,
    0,
    'refreshDispatched never ran'
  );
  assert.strictEqual(pool.calls.filter((c) => /INSERT INTO budget_events/.test(c.sql)).length, 1);
}

async function testRetryPathTimeoutStillFiresWhenBreached() {
    // Retries exhausted AND past the exponential backoff window
    // (staleDispatchMs * 2^(attempts-1)) → the run times out (ends, does not
    // start work) even while a budget is breached; the timeout is not a dispatch.
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    staleDispatched: [staleRunRow({
      dispatch_attempts: 5,
      dispatched_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // > 5min * 2^4
    })],
    timedOutRow: { id: 'run-stale', status: 'timed_out' },
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const result = await d.retryStaleDispatchedRuns();

  assert.strictEqual(result.retried.length, 0);
  assert.strictEqual(result.timedOut.length, 1, 'retries-exhausted timeout unaffected by budgets');
  assert.ok(pool.calls.some((c) => /SET status = 'timed_out'/.test(c.sql)));
}

async function testRetryPathHardStopCancelsInFlight() {
  const pool = makePool({
    budgets: [budgetRow({ name: 'fleet monthly cap', cap_usd: 10, action_on_exceed: 'hard_stop' })],
    spendRows: [{ spend_usd: 77, spend_tokens: 0, run_count: 5 }],
    cancelledIds: ['run-stale'],
    staleDispatched: [staleRunRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const result = await d.retryStaleDispatchedRuns();

  assert.strictEqual(result.retried.length, 0);
  const bulk = pool.calls.find((c) => /status IN \('dispatched', 'claimed', 'running'\)/.test(c.sql));
  assert.ok(bulk, 'hard_stop bulk cancel ran on the retry path');
  assert.strictEqual(bulk.params[0], 'Budget hard stop: fleet monthly cap (2026-08)');
  assert.strictEqual(
    pool.calls.filter((c) => /SET owner_agent_id = \$2/.test(c.sql)).length,
    0
  );
}

async function testRetryPathDispatchesWhenUnderCap() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 1, spend_tokens: 0, run_count: 1 }],
    staleDispatched: [staleRunRow()],
    refreshedRow: { id: 'run-stale', status: 'dispatched', dispatched_at: new Date().toISOString() },
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const result = await d.retryStaleDispatchedRuns();
  assert.strictEqual(result.retried.length, 1, 'under-cap retry proceeds normally');
}

// ─── Dispatcher: tick summary carries enforcement counts ───────────

async function testTickSummaryCarriesBudgetCounts() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    eventInsertRows: [{ id: 1 }],
    candidates: [candidateRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const summary = await d.tick();
  assert.deepStrictEqual(summary.budgetEnforcement, { held: 1, stopped: 0, warned: 0 });
}

// ─── Slice 3: SSE breach surfacing ─────────────────────────────

async function testCollectBreachEventRowsLatch() {
  const pool = makePool({ eventInsertRows: [{ id: 1 }] });
  const gate = createBudgetEnforcement(pool, { log: quietLog() });
  const entry = {
    budget: budgetRow(),
    decision: 'pause_new_runs',
    key: '2026-08',
    spendUsd: 12.5,
    spendTokens: 7000,
  };

  const first = await gate.collectBreachEventRows([entry], 'pause_new_runs', { run_ids: ['run-1'] });
  assert.strictEqual(first.length, 1, 'first emission yields the inserted row');
  assert.strictEqual(first[0].event.id, 1);
  assert.strictEqual(first[0].budget.id, 'b-1');
  assert.strictEqual(first[0].key, '2026-08');

  const second = await gate.collectBreachEventRows([entry], 'pause_new_runs', {});
  assert.strictEqual(second.length, 0, 'latched duplicate yields no row → no frame');

  // recordBreachEvents keeps its slice-2 count semantics on top of the collector.
  assert.strictEqual(await gate.recordBreachEvents([entry], 'pause_new_runs'), 0);
}

async function testDispatcherEmitsOnePauseFramePerLatch() {
  const pool = makePool({
    budgets: [budgetRow({ name: 'fleet monthly cap', cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 12.5, spend_tokens: 7000, run_count: 2 }],
    eventInsertRows: [{ id: 1 }], // first insert lands, later ticks latch
    candidateBatches: [[candidateRow()], [candidateRow()]],
    markDispatchedRow: dispatchedRunRow(),
  });
  const frames = [];
  const d = new GatewayWorkflowDispatcherV2(pool, {
    pollIntervalMs: 30000,
    budgetSseBroadcast: (event, data) => frames.push({ event, data }),
  });

  await d.dispatchQueuedRuns();
  assert.strictEqual(frames.length, 1, 'exactly one breach frame on the first tick');
  assert.strictEqual(frames[0].event, 'budget:breach');
  assert.deepStrictEqual(frames[0].data, {
    type: 'budget:breach',
    id: 'b-1:2026-08:paused',
    budget_id: 'b-1',
    budget_name: 'fleet monthly cap',
    scope: 'fleet',
    scope_id: null,
    period: 'monthly',
    period_key: '2026-08',
    event_kind: 'paused',
    action: 'pause_new_runs',
    spend_usd: 12.5,
    spend_tokens: 7000,
    cap_usd: 10,
    cap_tokens: null,
    message: 'pause_new_runs enforced at $12.50 of $10.00 cap (2026-08)',
    timestamp: frames[0].data.timestamp,
  });

  await d.dispatchQueuedRuns();
  assert.strictEqual(frames.length, 1, 'second tick latched — no duplicate frame (throttle via UNIQUE latch)');
}

async function testDispatcherEmitsHardStopFrameFromPrimaryInsert() {
  const pool = makePool({
    budgets: [budgetRow({ name: 'fleet monthly cap', cap_usd: 10, action_on_exceed: 'hard_stop' })],
    spendRows: [{ spend_usd: 55, spend_tokens: 0, run_count: 9 }],
    cancelledIds: ['run-inflight-1'],
    eventInsertRows: [{ id: 7 }], // consumed by hardStopInFlight's PRIMARY hard_stopped insert
    candidates: [candidateRow()],
  });
  const frames = [];
  const d = new GatewayWorkflowDispatcherV2(pool, {
    pollIntervalMs: 30000,
    budgetSseBroadcast: (event, data) => frames.push({ event, data }),
  });

  await d.dispatchQueuedRuns();
  assert.strictEqual(frames.length, 1, 'hard_stop surfaces from its primary latch insert, not a duplicate');
  assert.strictEqual(frames[0].data.event_kind, 'hard_stopped');
  assert.strictEqual(frames[0].data.action, 'hard_stop');
  assert.strictEqual(frames[0].data.id, 'b-1:2026-08:hard_stopped');
  assert.strictEqual(frames[0].data.budget_name, 'fleet monthly cap');
}

async function testDispatcherWarnEmitsNoBreachFrame() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'warn' })],
    spendRows: [{ spend_usd: 10, spend_tokens: 0, run_count: 2 }],
    eventInsertRows: [{ id: 1 }],
    candidates: [candidateRow()],
    markDispatchedRow: dispatchedRunRow(),
  });
  const frames = [];
  const d = new GatewayWorkflowDispatcherV2(pool, {
    pollIntervalMs: 30000,
    budgetSseBroadcast: (event, data) => frames.push({ event, data }),
  });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 1);
  assert.strictEqual(d.lastBudgetEnforcement.warned, 1);
  // 2026-08-25 live-fire + r3 fix: warned rows now flow to the notifier too —
  // kind policy moved to BUDGET_ALERT_EVENT_KINDS env (default excludes 'warned').
  assert.strictEqual(frames.length, 1, 'warned row flows to notifier when kinds include it');
}

async function testBroadcasterThrowDoesNotBreakDispatch() {
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 12, spend_tokens: 0, run_count: 1 }],
    eventInsertRows: [{ id: 1 }],
    candidates: [candidateRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, {
    pollIntervalMs: 30000,
    budgetSseBroadcast: () => { throw new Error('sse sink down'); },
  });

  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 0);
  assert.strictEqual(d.lastBudgetEnforcement.held, 1, 'enforcement verdict unaffected by emission failure');
}

async function testDefaultBroadcasterResolvesWithoutInjection() {
  // No injected broadcaster: the lazy routes/sse-routes resolution must work
  // and fan out to zero connected clients without error.
  const pool = makePool({
    budgets: [budgetRow({ cap_usd: 10, action_on_exceed: 'pause_new_runs' })],
    spendRows: [{ spend_usd: 12, spend_tokens: 0, run_count: 1 }],
    eventInsertRows: [{ id: 1 }],
    candidates: [candidateRow()],
  });
  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 30000 });
  const dispatched = await d.dispatchQueuedRuns();
  assert.strictEqual(dispatched.length, 0);
  assert.strictEqual(typeof d.getBudgetBroadcaster(), 'function', 'default dual-channel broadcaster resolves');
}

// ─── utils ─────────────────────────────────────────────────────────

function quietLog() {
  return { log: () => {}, error: () => {}, warn: () => {} };
}

// ─── run ───────────────────────────────────────────────────────────

async function run() {
  testScopePredicates();
  await testScopeChainMostRestrictiveWins();
  await testScopeChainOnlyCoveringScopesQuery();
  await testFleetCoversAgentsWithoutProfiles();
  await testDecisionBoundaries();
  await testCacheTtl();
  await testMultiPeriodSeparateWindows();
  await testRecordBreachEventsLatch();
  await testRecoveredMarkerOnRollover();
  await testHardStopInFlightStatusGuard();
  await testFailOpenDegradation();
  await testZeroBudgetsIsInert();
  await testDispatcherPauseHoldsCandidate();
  await testDispatcherHardStopCancelsQueuedCandidate();
  await testDispatcherWarnDispatches();
  await testDispatcherCacheSpansTicks();
  await testDispatcherZeroBudgetsByteIdentical();
  await testDispatcherFailOpenWithoutDatabase();
  await testRetryPathBlockedByPause();
  await testRetryPathTimeoutStillFiresWhenBreached();
  await testRetryPathHardStopCancelsInFlight();
  await testRetryPathDispatchesWhenUnderCap();
  await testTickSummaryCarriesBudgetCounts();
  await testCollectBreachEventRowsLatch();
  await testDispatcherEmitsOnePauseFramePerLatch();
  await testDispatcherEmitsHardStopFrameFromPrimaryInsert();
  await testDispatcherWarnEmitsNoBreachFrame();
  await testBroadcasterThrowDoesNotBreakDispatch();
  await testDefaultBroadcasterResolvesWithoutInjection();
  console.log('✅ tests/test-budget-enforcement.js — all assertions passed');
}

run().catch(err => {
  console.error('❌ test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
