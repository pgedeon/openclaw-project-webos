#!/usr/bin/env node
/**
 * Focused tests for routes/cost-routes.js and the Mission Control anomaly engine.
 * Run: node tests/test-cost-routes.js
 *
 * Covered here:
 * - GET /api/costs/summary aggregates workflow_runs cost columns and answers
 *   HTTP 200 `{ available: false }` JSON without PostgreSQL (json_snapshot mode,
 *   missing pool, or query failure) instead of erroring.
 * - `days` query parameter defaults to 7 and clamps to [1, 90].
 * - GET /api/costs/rollup: agent / department / workflow_type grouping with
 *   per-group daily series, group_by validation (400 on unknown values),
 *   days clamping, and the same degradation contract as /summary.
 * - computeAnomalies() table-driven fixtures: one deterministic fixture per flag
 *   type plus negative fixtures producing zero flags; max 6 flag types
 *   (budget_breach joined in budget-ledger slice 3).
 */

const assert = require('assert');
const path = require('path');
const Router = require('../routes/router');

const VIEW_MODULE = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'mission-control-view.mjs');

function createRequest(url, method = 'GET') {
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on() {},
    params: {},
  };
}

function createContext(pool) {
  return {
    sendJSON(res, status, payload) {
      res.result = { status, payload };
    },
    asanaStorage: pool ? { pool } : null,
  };
}

async function dispatch(url, pool) {
  const router = new Router();
  const { registerCostRoutes } = require('../routes/cost-routes');
  registerCostRoutes(router);
  const req = createRequest(url);
  const res = {};
  const handled = await router.handle(req, res, url.split('?')[0], 'GET', createContext(pool));
  assert.strictEqual(handled, true, `${url} should be handled`);
  assert.ok(res.result, `${url} should produce a handled JSON response`);
  return res.result;
}

// Pool stub distinguishing the series query from the top-run query by SQL shape.
function makePool(seriesRows, topRunRows = [], failWith = null) {
  return {
    async query(sql) {
      if (failWith) throw failWith;
      if (/ORDER BY cost_estimate DESC/i.test(sql)) {
        return { rows: topRunRows };
      }
      return { rows: seriesRows };
    },
  };
}

async function testCostSummaryHappyPath() {
  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - now.getTimezoneOffset() * 60000 - 86400000).toISOString().slice(0, 10);

  const result = await dispatch(
    '/api/costs/summary?days=7',
    makePool(
      [
        { date: yesterday, runs: 11, cost: 9.4, input_tokens: 402100, output_tokens: 51800 },
        { date: localToday, runs: 6, cost: 4.12, input_tokens: 184320, output_tokens: 22100 },
      ],
      [
        {
          id: 'run-1',
          workflow_type: 'crawl-site',
          owner_agent_id: 'affiliate-editorial',
          status: 'completed',
          cost: 1.9,
          currency: 'USD',
        },
      ]
    )
  );

  assert.strictEqual(result.status, 200);
  const payload = result.payload;
  assert.strictEqual(payload.available, true);
  assert.strictEqual(payload.window_days, 7);
  assert.strictEqual(payload.currency, 'USD');
  assert.strictEqual(payload.today.cost, 4.12);
  assert.deepStrictEqual(payload.today.tokens, { input: 184320, output: 22100 });
  assert.strictEqual(payload.days.length, 2);
  assert.strictEqual(payload.days[0].date, yesterday);
  assert.strictEqual(payload.top_run.workflow_type, 'crawl-site');
  assert.strictEqual(payload.total_window, 13.52);
  // avg over 2 buckets = (9.4 + 4.12) / 2
  assert.strictEqual(payload.avg_daily_7d, 6.76);
}

async function testDaysParamParsing() {
  const defaultResult = await dispatch('/api/costs/summary', makePool([]));
  assert.strictEqual(defaultResult.payload.window_days, 7);

  const clampedResult = await dispatch('/api/costs/summary?days=5000', makePool([]));
  assert.strictEqual(clampedResult.payload.window_days, 90);

  const invalidResult = await dispatch('/api/costs/summary?days=abc', makePool([]));
  assert.strictEqual(invalidResult.payload.window_days, 7);
}

async function testNoDatabaseDegradation() {
  // json_snapshot storage: asanaStorage exists but pool is null.
  const noPool = await dispatch('/api/costs/summary?days=7', null);
  assert.strictEqual(noPool.status, 200);
  assert.strictEqual(noPool.payload.available, false);
  assert.strictEqual(noPool.payload.reason, 'no_database');

  // No storage at all.
  const noStorage = await dispatch('/api/costs/summary', undefined);
  assert.strictEqual(noStorage.status, 200);
  assert.strictEqual(noStorage.payload.available, false);
  assert.strictEqual(noStorage.payload.reason, 'no_database');

  // Pool without a query function counts as unavailable.
  const dumbPool = await dispatch('/api/costs/summary', {});
  assert.strictEqual(dumbPool.status, 200);
  assert.strictEqual(dumbPool.payload.available, false);
}

async function testQueryFailureDegradation() {
  const result = await dispatch('/api/costs/summary', makePool([], [], new Error('relation "workflow_runs" does not exist')));
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.payload.available, false);
  assert.strictEqual(result.payload.reason, 'query_failed');
  assert.match(result.payload.details, /workflow_runs/);
}

// ── Anomaly engine fixtures ─────────────────────────────────────

async function loadAnomalyEngine() {
  const mod = await import(VIEW_MODULE);
  assert.strictEqual(mod.ANOMALY_FLAG_TYPES.length, 6, 'exactly 6 flag types defined');
  // Part 2: thresholds are named exported constants; pin their values so an
  // accidental retune fails loudly instead of silently changing operator
  // semantics (views-reference documents these exact numbers).
  assert.strictEqual(mod.STALE_RUN_MINUTES, 15);
  assert.strictEqual(mod.ZERO_TOKEN_MINUTES, 10);
  assert.strictEqual(mod.CRASH_LOOP_CONSECUTIVE_FAILURES, 2);
  assert.strictEqual(mod.COST_SPIKE_MULTIPLIER, 2);
  assert.strictEqual(mod.COST_SPIKE_MIN_HISTORY_DAYS, 3);
  assert.strictEqual(mod.BUDGET_WARN_FRACTION, 0.75);
  assert.strictEqual(mod.BUDGET_BREACH_FRACTION, 1);
  return mod;
}

function minutesAgo(mins) {
  return new Date(Date.now() - mins * 60000).toISOString();
}

async function testAnomalies() {
  const { computeAnomalies } = await loadAnomalyEngine();

  // Empty inputs → zero flags.
  assert.deepStrictEqual(computeAnomalies({}), []);

  // Flag 1 — stale run (>15 min without heartbeat).
  const staleRun = {
    id: 'r1',
    workflow_type: 'publish-daily',
    status: 'running',
    started_at: minutesAgo(40),
    last_heartbeat_at: minutesAgo(23),
    updated_at: minutesAgo(23),
  };
  const freshRun = {
    id: 'r2',
    workflow_type: 'fix-auth',
    status: 'running',
    started_at: minutesAgo(5),
    last_heartbeat_at: minutesAgo(1),
  };
  let flags = computeAnomalies({ runs: { running: [staleRun, freshRun] } });
  assert.strictEqual(flags.filter(f => f.type === 'stale_run').length, 1);
  assert.strictEqual(flags[0].severity, 'warn');
  assert.strictEqual(flags[0].subject, 'publish-daily');

  // Flag 1 boundary — exactly STALE_RUN_MINUTES old is NOT stale (strictly
  // greater-than); one second past is. Pins the constant behaviorally.
  const T0 = new Date('2026-08-24T12:00:00Z').getTime();
  const atThresholdRun = {
    id: 'rb',
    workflow_type: 'edge-exact',
    status: 'running',
    started_at: new Date(T0 - 30 * 60000).toISOString(),
    last_heartbeat_at: new Date(T0 - 15 * 60000).toISOString(),
  };
  flags = computeAnomalies({ now: T0, runs: { running: [atThresholdRun] } });
  assert.strictEqual(flags.filter(f => f.type === 'stale_run').length, 0, 'exactly 15 min is not stale');

  flags = computeAnomalies({
    now: T0,
    runs: {
      running: [{ ...atThresholdRun, last_heartbeat_at: new Date(T0 - 15 * 60000 - 1000).toISOString() }],
    },
  });
  assert.strictEqual(flags.filter(f => f.type === 'stale_run').length, 1, '1s past threshold is stale');

  // Flag 2 — zero-token loop (running >10 min, reported_at NULL).
  const zeroTokenRun = {
    id: 'r3',
    workflow_type: 'seo-audit',
    status: 'running',
    started_at: minutesAgo(12),
    last_heartbeat_at: minutesAgo(0),
    reported_at: null,
    input_tokens: 0,
    output_tokens: 0,
  };
  const healthyLongRun = {
    id: 'r4',
    workflow_type: 'crawl-site',
    status: 'running',
    started_at: minutesAgo(30),
    last_heartbeat_at: minutesAgo(0),
    reported_at: minutesAgo(1),
    input_tokens: 5000,
    output_tokens: 900,
  };
  flags = computeAnomalies({ runs: { running: [zeroTokenRun, healthyLongRun] } });
  assert.strictEqual(flags.filter(f => f.type === 'zero_token_loop').length, 1);
  assert.strictEqual(flags.find(f => f.type === 'zero_token_loop').subject, 'seo-audit');

  // Flag 2 boundary — exactly ZERO_TOKEN_MINUTES elapsed is NOT a loop.
  const atZeroTokenBoundary = {
    id: 'rz',
    workflow_type: 'edge-exact',
    status: 'running',
    started_at: new Date(T0 - 10 * 60000).toISOString(),
    last_heartbeat_at: new Date(T0).toISOString(),
    reported_at: null,
    input_tokens: 0,
    output_tokens: 0,
  };
  flags = computeAnomalies({ now: T0, runs: { running: [atZeroTokenBoundary] } });
  assert.strictEqual(flags.filter(f => f.type === 'zero_token_loop').length, 0, 'exactly 10 min is not a zero-token loop');

  // Flag 3 — crash-looping cron (≥2 consecutive failures), deduped against
  // diagnostics classification for the same job.
  flags = computeAnomalies({
    cron: {
      jobs: [{ id: 'j1', name: 'seo-audit', status: 'failed', consecutiveFailures: 2 }],
      failures: [{ id: 'j1', name: 'seo-audit', failureType: 'crash', failureCount: 2 }],
    },
  });
  assert.strictEqual(flags.filter(f => f.type === 'crash_loop_cron').length, 1);
  assert.strictEqual(flags[0].severity, 'error');

  // Flag 3 negative — single failure only.
  flags = computeAnomalies({
    cron: {
      jobs: [{ id: 'j2', name: 'one-off', status: 'failed', consecutiveFailures: 1 }],
      failures: [],
    },
  });
  assert.strictEqual(flags.length, 0);

  // Flag 4 — cost spike: today > 2× trailing mean, ≥3 history days required.
  // Deterministic: pin `now` and derive the today-key exactly like the engine.
  const NOW = new Date('2026-08-24T12:00:00Z').getTime();
  const todayKey = new Date(NOW - new Date(NOW).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const costSpikeInput = {
    available: true,
    today: { cost: 9.2 },
    days: [
      { date: '2026-08-18', cost: 4 },
      { date: '2026-08-19', cost: 4 },
      { date: '2026-08-20', cost: 4 },
      { date: todayKey, cost: 9.2 },
    ],
  };
  flags = computeAnomalies({ cost: costSpikeInput, now: NOW });
  assert.strictEqual(flags.filter(f => f.type === 'cost_spike').length, 1);
  assert.strictEqual(flags[0].severity, 'error');
  assert.match(flags[0].detail, /2\.3×/);

  // Flag 4 negatives — below threshold and insufficient history. The first
  // case doubles as the exact-boundary pin: today == exactly COST_SPIKE_MULTIPLIER ×
  // mean must NOT flag (strictly greater-than comparison).
  flags = computeAnomalies({
    now: NOW,
    cost: {
      available: true,
      today: { cost: 8 },
      days: [
        { date: '2026-08-18', cost: 4 },
        { date: '2026-08-19', cost: 4 },
        { date: '2026-08-20', cost: 4 },
        { date: todayKey, cost: 8 },
      ],
    },
  });
  assert.strictEqual(flags.filter(f => f.type === 'cost_spike').length, 0);

  flags = computeAnomalies({
    now: NOW,
    cost: {
      available: true,
      today: { cost: 100 },
      days: [
        { date: '2026-08-23', cost: 1 },
        { date: todayKey, cost: 100 },
      ],
    },
  });
  assert.strictEqual(flags.filter(f => f.type === 'cost_spike').length, 0, 'needs ≥3 history days');

  // Flag 5 — idle agent with queued task assigned.
  flags = computeAnomalies({
    fleet: {
      agents: [{ name: 'coder', status: 'idle' }],
      queueTasks: [{ assignee: 'coder', status: 'queued' }],
    },
  });
  assert.strictEqual(flags.filter(f => f.type === 'idle_agent_queue').length, 1);
  assert.strictEqual(flags[0].severity, 'warn');

  // Flag 5 negatives — busy agent, or queue empty.
  flags = computeAnomalies({
    fleet: {
      agents: [{ name: 'coder', status: 'online' }],
      queueTasks: [{ assignee: 'coder', status: 'queued' }],
    },
  });
  assert.strictEqual(flags.length, 0);

  flags = computeAnomalies({
    fleet: {
      agents: [{ name: 'coder', status: 'offline' }],
      queueTasks: [{ assignee: 'other-agent', status: 'queued' }],
    },
  });
  assert.strictEqual(flags.length, 0);

  // Flag 6 — budget breach (slice 3): status 'breached' or pct_of_cap >= 100.
  // Payload shape mirrors GET /api/budgets items exactly.
  const breachedBudget = {
    id: 'b-1',
    name: 'fleet monthly cap',
    scope: 'fleet',
    scope_id: null,
    period: 'monthly',
    cap_usd: 10,
    cap_tokens: null,
    action_on_exceed: 'pause_new_runs',
    active: true,
    period_key: '2026-08',
    current_spend: { usd: 12.5, tokens: 7000, runs: 2 },
    pct_of_cap: 125,
    status: 'breached',
  };
  flags = computeAnomalies({ budgets: [breachedBudget] });
  assert.strictEqual(flags.filter(f => f.type === 'budget_breach').length, 1);
  assert.strictEqual(flags[0].severity, 'error', 'budget_breach pins severity error');
  assert.strictEqual(flags[0].subject, 'fleet monthly cap', 'subject = budget name');
  assert.match(flags[0].detail, /\$12\.50 of \$10\.00 cap/, 'detail carries spend/cap');
  assert.match(flags[0].detail, /pause_new_runs/, 'detail carries the action');
  assert.strictEqual(flags[0].since, '2026-08');

  // Flag 6 boundary — exactly BUDGET_BREACH_FRACTION×100 pct IS a breach even
  // when the status string disagrees (pct fallback guards a lagging payload).
  flags = computeAnomalies({ budgets: [{ ...breachedBudget, pct_of_cap: 100, status: 'under' }] });
  assert.strictEqual(flags.filter(f => f.type === 'budget_breach').length, 1, 'pct >= 100 flags');

  // Flag 6 negative — amber-only zone (75–99%) is bar color, never a flag.
  flags = computeAnomalies({ budgets: [{ ...breachedBudget, pct_of_cap: 75, status: 'under' }] });
  assert.strictEqual(flags.filter(f => f.type === 'budget_breach').length, 0, '75% is warn-zone only');
  flags = computeAnomalies({ budgets: [{ ...breachedBudget, pct_of_cap: 99.9, status: 'warned' }] });
  assert.strictEqual(flags.filter(f => f.type === 'budget_breach').length, 0);

  // Flag 6 negative — healthy budget stays silent.
  flags = computeAnomalies({ budgets: [{ ...breachedBudget, pct_of_cap: 42, status: 'under' }] });
  assert.strictEqual(flags.length, 0);

  // Flag 6 token-cap formatting.
  flags = computeAnomalies({
    budgets: [{
      ...breachedBudget,
      cap_usd: null,
      cap_tokens: 100000,
      current_spend: { usd: 0, tokens: 120000, runs: 4 },
      pct_of_cap: 120,
    }],
  });
  assert.match(flags.find(f => f.type === 'budget_breach').detail, /120,000 of 100,000 tokens/);

  // Flag 6 max-flags interaction — the sixth type participates in the
  // MAX_ANOMALY_FLAGS slicing like every other type.
  flags = computeAnomalies({
    budgets: Array.from({ length: 30 }, (_, i) => ({ ...breachedBudget, id: `b-${i}`, name: `cap-${i}` })),
  });
  assert.strictEqual(flags.length, 25, '30 breached budgets slice to MAX_ANOMALY_FLAGS');
  assert.ok(flags.every(f => f.type === 'budget_breach'));

  // Missing inputs skip silently (no throw, no bogus flags).
  flags = computeAnomalies({ fleet: null, runs: null, cron: null, cost: null, budgets: null });
  assert.deepStrictEqual(flags, []);
}

// ── Rollup endpoint (/api/costs/rollup) ─────────────────────────

// Pool stub for the rollup endpoint: distinguishes the currency lookup from
// the grouped rollup query by SQL shape and records every query so tests can
// assert on the SQL (joins present, params bound).
function makeRollupPool(rows, failWith = null) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (failWith) throw failWith;
      if (/ORDER BY reported_at DESC/i.test(sql)) {
        return { rows: [{ currency: 'EUR' }] };
      }
      return { rows };
    },
  };
}

async function testRollupAgentGrouping() {
  const pool = makeRollupPool([
    { key: 'affiliate-editorial', date: '2026-08-23', runs: 4, cost: 3.1, input_tokens: 1000, output_tokens: 200 },
    { key: 'affiliate-editorial', date: '2026-08-24', runs: 2, cost: 1.0, input_tokens: 500, output_tokens: 100 },
    { key: 'coder', date: '2026-08-24', runs: 7, cost: 9.99, input_tokens: 8000, output_tokens: 900 },
  ]);

  const result = await dispatch('/api/costs/rollup?group_by=agent&days=7', pool);

  assert.strictEqual(result.status, 200);
  const payload = result.payload;
  assert.strictEqual(payload.available, true);
  assert.strictEqual(payload.group_by, 'agent');
  assert.strictEqual(payload.window_days, 7);
  assert.strictEqual(payload.currency, 'EUR');
  assert.strictEqual(payload.group_count, 2);
  // Sorted by cost descending.
  assert.deepStrictEqual(payload.groups.map((g) => g.key), ['coder', 'affiliate-editorial']);
  assert.strictEqual(payload.groups[0].cost, 9.99);
  assert.strictEqual(payload.groups[0].runs, 7);
  assert.deepStrictEqual(payload.groups[0].tokens, { input: 8000, output: 900 });
  assert.strictEqual(payload.total_window, 14.09);
  // Series is date-ascending within a group (sparkline-ready).
  const editorial = payload.groups[1];
  assert.strictEqual(editorial.cost, 4.1);
  assert.deepStrictEqual(editorial.series.map((p) => p.date), ['2026-08-23', '2026-08-24']);
  assert.deepStrictEqual(editorial.series.map((p) => p.cost), [3.1, 1.0]);
  // days param bound into both queries.
  assert.strictEqual(pool.queries.length, 2);
  assert.ok(pool.queries.every((q) => q.params[0] === 7));
}

async function testRollupDepartmentJoinAndDefault() {
  const pool = makeRollupPool([
    { key: 'Content & Publishing', date: '2026-08-24', runs: 5, cost: 2.5, input_tokens: 100, output_tokens: 50 },
    { key: 'Unassigned', date: '2026-08-24', runs: 1, cost: 0.25, input_tokens: 10, output_tokens: 5 },
  ]);

  const result = await dispatch('/api/costs/rollup?group_by=department', pool);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.payload.group_by, 'department');
  assert.deepStrictEqual(result.payload.groups.map((g) => g.key), ['Content & Publishing', 'Unassigned']);

  // Department mode must join agent_profiles → departments.
  const rollupSql = pool.queries[0].sql;
  assert.match(rollupSql, /LEFT JOIN agent_profiles ap ON ap\.agent_id = wr\.owner_agent_id/);
  assert.match(rollupSql, /LEFT JOIN departments d ON d\.id = ap\.department_id/);
  assert.match(rollupSql, /COALESCE\(d\.name, 'Unassigned'\)/);
  // Shared COALESCE bucketing pattern with /summary.
  assert.match(rollupSql, /COALESCE\(reported_at, started_at, created_at\)/);

  // Missing group_by defaults to agent (no joins in SQL).
  const defaultPool = makeRollupPool([]);
  const defaultResult = await dispatch('/api/costs/rollup', defaultPool);
  assert.strictEqual(defaultResult.payload.group_by, 'agent');
  assert.doesNotMatch(defaultPool.queries[0].sql, /LEFT JOIN departments/);
}

async function testRollupWorkflowTypeAndDaysClamp() {
  const pool = makeRollupPool([]);
  const result = await dispatch('/api/costs/rollup?group_by=workflow_type&days=5000', pool);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.payload.group_by, 'workflow_type');
  assert.strictEqual(result.payload.window_days, 90, 'days clamps to [1, 90] like /summary');
  assert.deepStrictEqual(result.payload.groups, []);
}

async function testRollupValidation() {
  const result = await dispatch('/api/costs/rollup?group_by=bogus', makeRollupPool([]));
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.payload.error, 'validation_failed');
  assert.match(result.payload.message, /agent, department, workflow_type/);
}

async function testRollupDegradation() {
  // No storage at all.
  const noStorage = await dispatch('/api/costs/rollup?group_by=agent', undefined);
  assert.strictEqual(noStorage.status, 200);
  assert.strictEqual(noStorage.payload.available, false);
  assert.strictEqual(noStorage.payload.reason, 'no_database');

  // Pool without query function.
  const dumbPool = await dispatch('/api/costs/rollup?group_by=workflow_type', {});
  assert.strictEqual(dumbPool.payload.available, false);
  assert.strictEqual(dumbPool.payload.reason, 'no_database');
  assert.strictEqual(dumbPool.payload.group_by, 'workflow_type');

  // Query failure degrades instead of erroring.
  const failing = await dispatch(
    '/api/costs/rollup?group_by=department&days=3',
    makeRollupPool([], new Error('relation "agent_profiles" does not exist'))
  );
  assert.strictEqual(failing.status, 200);
  assert.strictEqual(failing.payload.available, false);
  assert.strictEqual(failing.payload.reason, 'query_failed');
  assert.match(failing.payload.details, /agent_profiles/);
  assert.strictEqual(failing.payload.window_days, 3);
}

async function run() {
  await testCostSummaryHappyPath();
  await testDaysParamParsing();
  await testNoDatabaseDegradation();
  await testQueryFailureDegradation();
  await testAnomalies();
  await testRollupAgentGrouping();
  await testRollupDepartmentJoinAndDefault();
  await testRollupWorkflowTypeAndDaysClamp();
  await testRollupValidation();
  await testRollupDegradation();
  console.log('✅ tests/test-cost-routes.js — all assertions passed');
}

run().catch(err => {
  console.error('❌ test failed:', err.message);
  process.exit(1);
});
