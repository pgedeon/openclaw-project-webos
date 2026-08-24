#!/usr/bin/env node
/**
 * Focused tests for routes/budget-routes.js, lib/budget-eval.js, and the
 * migration-023 budget ledger storage helpers (DB-free).
 * Run: node tests/test-budget-routes.js
 *
 * Covered here:
 * - POST /api/budgets enum validation (scope/period/action_on_exceed) and the
 *   cap-XOR rule (dual caps rejected, zero/negative caps rejected).
 * - evaluateBudget() pure fixtures: period keys across month/ISO-week/year
 *   boundaries, exactly-at-cap breach boundary (>= cap counts, brief §2.4),
 *   token-cap input+output summation, inactive budgets never breach.
 * - mostRestrictive() ordering hard_stop > pause_new_runs > warn.
 * - Clean no-database degradation: every endpoint answers HTTP 200
 *   `{ available: false, reason: 'no_database' }` without PostgreSQL;
 *   query failures degrade to `reason: 'query_failed'`.
 * - Migration 023 fixture: partial unique index + XOR CHECK present in DDL.
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
  // Production ctx.asanaStorage is the AsanaStorage instance (methods + pool);
  // mirror that shape by binding the prototype over the scripted pool.
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

async function dispatch(url, { method = 'GET', pool = undefined, body = null } = {}) {
  const router = new Router();
  const { registerBudgetRoutes } = require('../routes/budget-routes');
  registerBudgetRoutes(router);
  const req = createRequest(url, method, body);
  const res = {};
  const handled = await router.handle(req, res, url.split('?')[0], method, createContext(pool));
  assert.strictEqual(handled, true, `${url} should be handled`);
  assert.ok(res.result, `${url} should produce a handled JSON response`);
  return res.result;
}

// Fake pool routing by SQL shape. spendRows is a FIFO so multi-budget lists
// get one spend aggregate per getBudgetLedger call, in call order.
function makePool(opts = {}) {
  const {
    budgets = [],
    singleBudget = null,
    spendRows = [],
    events = [],
    eventInsertResults = [],
    updateRow = null,
    failOn = null,
    failMessage = 'relation "budgets" does not exist',
  } = opts;
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      if (failOn && failOn.test(sql)) throw new Error(failMessage);
      calls.push({ sql, params });
      if (/INSERT INTO budgets/.test(sql)) {
        const [name, scope, scope_id, period, cap_usd, cap_tokens, action_on_exceed, active] = params;
        return {
          rows: [{
            id: 'generated-uuid',
            name, scope, scope_id, period, cap_usd, cap_tokens, action_on_exceed,
            active: active === null ? true : active,
            created_at: '2026-08-24T09:00:00.000Z',
          }],
        };
      }
      if (/UPDATE budgets/.test(sql)) {
        return updateRow ? { rows: [updateRow] } : { rows: [] };
      }
      if (/SUM\(cost_estimate\)/.test(sql)) {
        const row = spendRows.length ? spendRows.shift() : { spend_usd: 0, spend_tokens: 0, run_count: 0 };
        return { rows: [row] };
      }
      if (/INSERT INTO budget_events/.test(sql)) {
        const next = eventInsertResults.shift();
        return { rows: next ? [next] : [] };
      }
      if (/FROM budget_events/.test(sql)) return { rows: events };
      if (/FROM budgets WHERE id/.test(sql)) return { rows: singleBudget ? [singleBudget] : [] };
      if (/FROM budgets/.test(sql)) return { rows: budgets };
      return { rows: [] };
    },
  };
}

// ── POST validation ─────────────────────────────────────────────

async function testPostEnumValidation() {
  const base = { name: 'affiliate monthly cap', period: 'monthly', cap_usd: 50, action_on_exceed: 'pause_new_runs' };

  for (const [field, bad] of [
    ['scope', 'world'],
    ['period', 'hourly'],
    ['action_on_exceed', 'nuke'],
  ]) {
    const result = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, scope: 'agent', scope_id: 'coder', [field]: bad } });
    assert.strictEqual(result.status, 400, `${field}=${bad} should be rejected`);
    assert.strictEqual(result.payload.error, 'validation_failed');
    assert.ok(result.payload.details.some(d => d.includes(field)), `details mention ${field}`);
  }

  // Missing name.
  let r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, name: '   ', scope: 'fleet' } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.payload.details.some(d => d.includes('name')));

  // Malformed JSON body → treated as {} → name required.
  const router = new Router();
  const { registerBudgetRoutes } = require('../routes/budget-routes');
  registerBudgetRoutes(router);
  const rawRes = {};
  createContext(makePool()).sendJSON(rawRes, 0, {});
  const req = createRequest('/api/budgets', 'POST');
  req.on = (event, cb) => { if (event === 'data') cb('{not json'); if (event === 'end') cb(); };
  await router.handle(req, rawRes, '/api/budgets', 'POST', createContext(makePool()));
  assert.strictEqual(rawRes.result.status, 400);
}

async function testPostCapXorRule() {
  const base = { name: 'x', scope: 'agent', scope_id: 'coder', period: 'daily', action_on_exceed: 'warn' };

  // Both caps → rejected.
  let r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, cap_usd: 10, cap_tokens: 1000 } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.payload.details.some(d => /XOR|exactly one/i.test(d)));

  // Neither cap → rejected.
  r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base } });
  assert.strictEqual(r.status, 400);

  // Zero / negative / fractional caps → rejected.
  r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, cap_usd: 0 } });
  assert.strictEqual(r.status, 400);
  r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, cap_usd: -5 } });
  assert.strictEqual(r.status, 400);
  r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, cap_tokens: 10.5 } });
  assert.strictEqual(r.status, 400);

  // Non-fleet scope without scope_id → rejected.
  r = await dispatch('/api/budgets', { method: 'POST', pool: makePool(), body: { ...base, cap_usd: 10, scope_id: '' } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.payload.details.some(d => d.includes('scope_id')));
}

async function testPostHappyPath() {
  // Fleet budget: scope_id forced NULL, token cap kept.
  const pool = makePool();
  const r = await dispatch('/api/budgets', {
    method: 'POST',
    pool,
    body: { name: 'fleet monthly tokens', scope: 'fleet', scope_id: 'ignored-for-fleet', period: 'monthly', cap_tokens: 5000000, action_on_exceed: 'hard_stop' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.payload.available, true);
  assert.strictEqual(r.payload.budget.id, 'generated-uuid');
  assert.strictEqual(r.payload.budget.scope_id, null);

  const insert = pool.calls.find(c => /INSERT INTO budgets/.test(c.sql));
  assert.ok(insert, 'INSERT issued');
  assert.deepStrictEqual(insert.params.slice(0, 3), ['fleet monthly tokens', 'fleet', null]);
  assert.strictEqual(insert.params[5], 5000000);
  assert.strictEqual(insert.params[6], 'hard_stop');

  // Agent budget keeps scope_id.
  const pool2 = makePool();
  const r2 = await dispatch('/api/budgets', {
    method: 'POST',
    pool: pool2,
    body: { name: 'coder daily usd', scope: 'agent', scope_id: 'coder', period: 'daily', cap_usd: 25, action_on_exceed: 'warn' },
  });
  assert.strictEqual(r2.status, 201);
  const insert2 = pool2.calls.find(c => /INSERT INTO budgets/.test(c.sql));
  assert.deepStrictEqual(insert2.params.slice(0, 3), ['coder daily usd', 'agent', 'coder']);
  assert.strictEqual(insert2.params[4], 25);
}

// ── GET list ────────────────────────────────────────────────────

async function testListDerivedSpendAndStatus() {
  const pool = makePool({
    budgets: [
      { id: 'b-under', name: 'dept monthly', scope: 'department', scope_id: 'dept-uuid', period: 'monthly', cap_usd: 10, cap_tokens: null, action_on_exceed: 'warn', active: true, created_at: '2026-08-20T00:00:00Z' },
      { id: 'b-breached', name: 'wf-type daily', scope: 'project', scope_id: 'crawl-site', period: 'daily', cap_usd: null, cap_tokens: 1000, action_on_exceed: 'hard_stop', active: true, created_at: '2026-08-21T00:00:00Z' },
      { id: 'b-warned', name: 'exact warn', scope: 'agent', scope_id: 'coder', period: 'daily', cap_usd: 5, cap_tokens: null, action_on_exceed: 'warn', active: true, created_at: '2026-08-22T00:00:00Z' },
      { id: 'b-inactive', name: 'retired', scope: 'fleet', scope_id: null, period: 'weekly', cap_usd: 1, cap_tokens: null, action_on_exceed: 'pause_new_runs', active: false, created_at: '2026-08-23T00:00:00Z' },
    ],
    spendRows: [
      { spend_usd: 4.1234, spend_tokens: 88000, run_count: 12 },   // b-under: 41.23%
      { spend_usd: 0, spend_tokens: 1000, run_count: 3 },          // b-breached: exactly at token cap
      { spend_usd: 5, spend_tokens: 0, run_count: 2 },             // b-warned: exactly at usd cap
      { spend_usd: 99, spend_tokens: 0, run_count: 7 },            // b-inactive: over cap but inactive
    ],
  });

  const r = await dispatch('/api/budgets', { pool });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.available, true);
  const items = r.payload.budgets;
  assert.strictEqual(items.length, 4);

  assert.strictEqual(items[0].id, 'b-under');
  assert.strictEqual(items[0].current_spend.usd, 4.12);
  assert.strictEqual(items[0].current_spend.runs, 12);
  assert.strictEqual(items[0].pct_of_cap, 41.23);
  assert.strictEqual(items[0].status, 'under');

  // Exactly-at-token-cap with hard_stop → breached.
  assert.strictEqual(items[1].pct_of_cap, 100);
  assert.strictEqual(items[1].status, 'breached');

  // Exactly-at-usd-cap with warn → warned (>= cap counts as breached).
  assert.strictEqual(items[2].pct_of_cap, 100);
  assert.strictEqual(items[2].status, 'warned');

  // Over cap but inactive → never breaches.
  assert.strictEqual(items[3].status, 'under');

  // Spend aggregates scoped per budget: department predicate binds scope_id.
  const spendCalls = pool.calls.filter(c => /SUM\(cost_estimate\)/.test(c.sql));
  assert.strictEqual(spendCalls.length, 4);
  assert.match(spendCalls[0].sql, /owner_agent_id IN \(SELECT agent_id FROM agent_profiles/);
  assert.strictEqual(spendCalls[0].params[1], 'dept-uuid');
  assert.match(spendCalls[1].sql, /workflow_type = \$2/);
  assert.match(spendCalls[3].sql, /COALESCE\(reported_at, started_at, created_at\) >= \$1::timestamptz/);
}

// ── PATCH ───────────────────────────────────────────────────────

async function testPatch() {
  const pool = makePool({
    updateRow: { id: 'b-1', name: 'renamed', scope: 'agent', scope_id: 'coder', period: 'daily', cap_usd: 30, cap_tokens: null, action_on_exceed: 'warn', active: true, created_at: '2026-08-20T00:00:00Z' },
  });
  const r = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool, body: { active: true, cap_usd: 30, name: 'renamed' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.available, true);
  assert.strictEqual(r.payload.budget.cap_usd, 30);
  const upd = pool.calls.find(c => /UPDATE budgets/.test(c.sql));
  assert.ok(upd);
  assert.match(upd.sql, /name = \$1/);
  assert.match(upd.sql, /active = \$2/);
  assert.match(upd.sql, /cap_usd = \$3/);
  assert.match(upd.sql, /cap_tokens = \$4/); // sibling cleared server-side
  assert.strictEqual(upd.params[3], null);

  // Bad action enum → 400.
  let bad = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool: makePool(), body: { action_on_exceed: 'explode' } });
  assert.strictEqual(bad.status, 400);

  // Dual caps in one patch → 400.
  bad = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool: makePool(), body: { cap_usd: 1, cap_tokens: 2 } });
  assert.strictEqual(bad.status, 400);

  // Nulling a cap without replacement → 400.
  bad = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool: makePool(), body: { cap_usd: null } });
  assert.strictEqual(bad.status, 400);

  // Empty patch → 400.
  bad = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool: makePool(), body: {} });
  assert.strictEqual(bad.status, 400);

  // Unknown id → 404.
  const missing = await dispatch('/api/budgets/nope', { method: 'PATCH', pool: makePool(), body: { active: false } });
  assert.strictEqual(missing.status, 404);
  assert.strictEqual(missing.payload.reason, 'not_found');
}

// ── Ledger endpoint ─────────────────────────────────────────────

async function testLedgerEndpoint() {
  const pool = makePool({
    singleBudget: { id: 'b-9', name: 'fleet monthly', scope: 'fleet', scope_id: null, period: 'monthly', cap_usd: 100, cap_tokens: null, action_on_exceed: 'pause_new_runs', active: true, created_at: '2026-08-01T00:00:00Z' },
    spendRows: [{ spend_usd: 62.5, spend_tokens: 700000, run_count: 40 }],
    events: [
      { id: 2, budget_id: 'b-9', period_key: '2026-08', event_kind: 'paused', detail: { spend_usd: 100.2 }, created_at: '2026-08-14T10:00:00Z' },
      { id: 1, budget_id: 'b-9', period_key: '2026-07', event_kind: 'recovered', detail: null, created_at: '2026-08-01T00:05:00Z' },
    ],
  });
  const r = await dispatch('/api/budgets/b-9/ledger?period=current', { pool });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.available, true);
  assert.strictEqual(r.payload.budget.id, 'b-9');
  assert.match(r.payload.period_key, /^\d{4}-\d{2}$/);
  assert.strictEqual(r.payload.spend.usd, 62.5);
  assert.strictEqual(r.payload.pct_of_cap, 62.5);
  assert.strictEqual(r.payload.status, 'under');
  assert.strictEqual(r.payload.events.length, 2);
  assert.strictEqual(r.payload.events[0].event_kind, 'paused');

  // Unknown budget → 404.
  const missing = await dispatch('/api/budgets/nope/ledger', { pool: makePool() });
  assert.strictEqual(missing.status, 404);

  // Only 'current' supported in slice 1.
  const badPeriod = await dispatch('/api/budgets/b-9/ledger?period=2026-07', { pool: makePool({ singleBudget: { id: 'b-9' } }) });
  assert.strictEqual(badPeriod.status, 400);
}

// ── Degradation ─────────────────────────────────────────────────

async function testNoDatabaseDegradation() {
  for (const pool of [null, undefined, {}]) {
    const list = await dispatch('/api/budgets', { pool });
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.payload.available, false);
    assert.strictEqual(list.payload.reason, 'no_database');

    const create = await dispatch('/api/budgets', { method: 'POST', pool, body: { name: 'x', scope: 'fleet', period: 'daily', cap_usd: 1, action_on_exceed: 'warn' } });
    assert.strictEqual(create.payload.reason, 'no_database');

    const patch = await dispatch('/api/budgets/b-1', { method: 'PATCH', pool, body: { active: false } });
    assert.strictEqual(patch.payload.reason, 'no_database');

    const ledger = await dispatch('/api/budgets/b-1/ledger', { pool });
    assert.strictEqual(ledger.payload.reason, 'no_database');
  }
}

async function testQueryFailureDegradation() {
  const pool = makePool({ failOn: /FROM budgets/, failMessage: 'relation "budgets" does not exist' });
  const r = await dispatch('/api/budgets', { pool });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.payload.available, false);
  assert.strictEqual(r.payload.reason, 'query_failed');
  assert.match(r.payload.details, /budgets/);
}

// ── Pure evaluation fixtures ────────────────────────────────────

function testPeriodKeys() {
  const { periodKey } = require('../lib/budget-eval');

  // Daily — local calendar day (constructed via local Date components so the
  // fixture is timezone-independent).
  assert.strictEqual(periodKey('daily', new Date(2026, 7, 24, 12).getTime()), '2026-08-24');
  assert.strictEqual(periodKey('daily', new Date(2026, 7, 24, 0).getTime()), '2026-08-24');
  assert.strictEqual(periodKey('daily', new Date(2026, 7, 24, 23, 59, 59, 999).getTime()), '2026-08-24');

  // Monthly — month boundaries including year rollover.
  assert.strictEqual(periodKey('monthly', new Date(2026, 11, 31, 23, 59).getTime()), '2026-12');
  assert.strictEqual(periodKey('monthly', new Date(2027, 0, 1, 0, 0).getTime()), '2027-01');
  assert.strictEqual(periodKey('monthly', new Date(2026, 7, 24).getTime()), '2026-08');

  // Weekly — ISO weeks: Monday start, year belongs to the ISO year.
  // 2026-08-19 is Wednesday of ISO week 34.
  assert.strictEqual(periodKey('weekly', new Date(2026, 7, 19, 15).getTime()), '2026-W34');
  // 2026-08-24 is Monday of ISO week 35 (brief example).
  assert.strictEqual(periodKey('weekly', new Date(2026, 7, 24).getTime()), '2026-W35');
  assert.strictEqual(periodKey('weekly', new Date(2026, 7, 30).getTime()), '2026-W35'); // Sunday closes W35
  // ISO year rollover: 2026 has 53 ISO weeks (Jan 1 2026 is a Thursday), so
  // 2026-12-28..2027-01-03 is still 2026-W53.
  assert.strictEqual(periodKey('weekly', new Date(2026, 11, 28).getTime()), '2026-W53');
  assert.strictEqual(periodKey('weekly', new Date(2027, 0, 1).getTime()), '2026-W53');
  // 2027-01-03 (Sunday) closes 2026-W53; 2027-01-04 (Monday) opens 2027-W01.
  assert.strictEqual(periodKey('weekly', new Date(2027, 0, 3).getTime()), '2026-W53');
  assert.strictEqual(periodKey('weekly', new Date(2027, 0, 4).getTime()), '2027-W01');

  assert.throws(() => periodKey('hourly', Date.now()), /Invalid budget period/);
}

function testEvaluateBudgetBoundaries() {
  const { evaluateBudget } = require('../lib/budget-eval');
  const T0 = new Date(2026, 7, 24, 12).getTime(); // local noon, 2026-08-24

  // Exactly-at-cap breaches (>= cap), per brief §2.4 — for every action kind.
  for (const [action, expected] of [
    ['warn', 'warn'],
    ['pause_new_runs', 'pause_new_runs'],
    ['hard_stop', 'hard_stop'],
  ]) {
    const budget = { period: 'daily', cap_usd: 10, cap_tokens: null, action_on_exceed: action, active: true };
    const ev = evaluateBudget(budget, [{ ts: T0 - 60000, usd: 10, tokens: 0 }], T0);
    assert.strictEqual(ev.decision, expected, `exactly-at-cap ${action}`);
    assert.strictEqual(ev.pctOfCap, 100);
    assert.strictEqual(ev.periodKey, '2026-08-24');
  }

  // One micro-unit below cap → ok.
  const under = evaluateBudget(
    { period: 'daily', cap_usd: 10, cap_tokens: null, action_on_exceed: 'hard_stop', active: true },
    [{ ts: T0 - 60000, usd: 9.99, tokens: 0 }],
    T0
  );
  assert.strictEqual(under.decision, 'ok');
  assert.strictEqual(under.pctOfCap, 99.9);

  // Token cap sums entry tokens; cached tokens are already inside input and
  // are never added on top (entries carry input+output only).
  const tokenBudget = { period: 'monthly', cap_usd: null, cap_tokens: 1000, action_on_exceed: 'pause_new_runs', active: true };
  const tEv = evaluateBudget(tokenBudget, [
    { ts: T0 - 3600000, usd: 0, tokens: 600 },
    { ts: T0 - 60000, usd: 1.5, tokens: 400 },
  ], T0);
  assert.strictEqual(tEv.spendTokens, 1000);
  assert.strictEqual(tEv.spendUsd, 1.5);
  assert.strictEqual(tEv.decision, 'pause_new_runs');
  assert.strictEqual(tEv.periodKey, '2026-08');

  // Entries outside the current bucket are ignored: yesterday's spend does
  // not count against today's daily budget.
  const dayStart = new Date(2026, 7, 24, 0).getTime();
  const freshDay = evaluateBudget(
    { period: 'daily', cap_usd: 10, cap_tokens: null, action_on_exceed: 'hard_stop', active: true },
    [
      { ts: dayStart - 1, usd: 500, tokens: 0 },       // yesterday 23:59:59.999
      { ts: T0, usd: 2, tokens: 0 },                   // today
      { ts: T0 + 600000, usd: 900, tokens: 0 },        // future-dated noise
    ],
    T0
  );
  assert.strictEqual(freshDay.spendUsd, 2);
  assert.strictEqual(freshDay.decision, 'ok');

  // Inactive budgets never breach, even far over cap.
  const off = evaluateBudget(
    { period: 'daily', cap_usd: 1, cap_tokens: null, action_on_exceed: 'hard_stop', active: false },
    [{ ts: T0, usd: 1000, tokens: 0 }],
    T0
  );
  assert.strictEqual(off.decision, 'ok');

  // Empty / missing ledger → zero spend, ok.
  const empty = evaluateBudget(
    { period: 'weekly', cap_usd: 10, cap_tokens: null, action_on_exceed: 'warn', active: true },
    [],
    T0
  );
  assert.deepStrictEqual(
    { usd: empty.spendUsd, tok: empty.spendTokens, dec: empty.decision },
    { usd: 0, tok: 0, dec: 'ok' }
  );

  // Window start aligns with the bucket edge (local midnight for daily).
  assert.strictEqual(evaluateBudget({ period: 'daily', cap_usd: 1, cap_tokens: null, action_on_exceed: 'warn', active: true }, [], T0).windowStartMs, dayStart);
}

function testMostRestrictive() {
  const { mostRestrictive } = require('../lib/budget-eval');
  assert.strictEqual(mostRestrictive(['warn']), 'warn');
  assert.strictEqual(mostRestrictive(['warn', 'pause_new_runs']), 'pause_new_runs');
  assert.strictEqual(mostRestrictive(['pause_new_runs', 'hard_stop', 'warn']), 'hard_stop');
  assert.strictEqual(mostRestrictive([]), null);
  assert.strictEqual(mostRestrictive(null), null);
  assert.strictEqual(mostRestrictive(['nonsense', 'warn']), 'warn', 'unknown actions filtered');
}

// ── Storage helper degradation (no-throw contract) ──────────────

async function testStorageHelpersNoThrow() {
  const AsanaStorage = require('../storage/asana');

  // json_snapshot-style instance: pool null → every helper degrades, none throws.
  const bare = Object.create(AsanaStorage.prototype);
  bare.pool = null;
  assert.strictEqual(await bare.createBudget({ name: 'x', scope: 'fleet', period: 'daily', cap_usd: 1, action_on_exceed: 'warn' }), null);
  assert.strictEqual(await bare.listBudgets(), null);
  assert.strictEqual(await bare.getBudget('b-1'), null);
  assert.strictEqual(await bare.updateBudget('b-1', { active: false }), null);
  assert.strictEqual(await bare.getBudgetLedger({ scope: 'fleet', period: 'daily' }), null);
  assert.strictEqual(await bare.recordBudgetEvent({ budgetId: 'b-1', periodKey: '2026-08-24', eventKind: 'warned' }), null);
  assert.strictEqual(await bare.listBudgetEvents('b-1'), null);

  // Pool that throws (DB gone mid-flight) → same clean degradation.
  const throwing = Object.create(AsanaStorage.prototype);
  throwing.pool = { async query() { throw new Error('connection terminated'); } };
  assert.strictEqual(await throwing.createBudget({ name: 'x', scope: 'fleet', period: 'daily', cap_usd: 1, action_on_exceed: 'warn' }), null);
  assert.strictEqual(await throwing.listBudgets(), null);
  assert.strictEqual(await throwing.getBudgetLedger({ scope: 'agent', scope_id: 'coder', period: 'daily' }), null);
  assert.strictEqual(await throwing.recordBudgetEvent({ budgetId: 'b-1', periodKey: '2026-08', eventKind: 'paused' }), null);
}

async function testRecordBudgetEventLatch() {
  const AsanaStorage = require('../storage/asana');
  const inserted = { id: 7, budget_id: 'b-1', period_key: '2026-08', event_kind: 'paused', detail: { spend_usd: 12 }, created_at: '2026-08-14T10:00:00Z' };
  let calls = 0;
  const store = Object.create(AsanaStorage.prototype);
  store.pool = {
    async query(sql, params) {
      calls += 1;
      assert.match(sql, /ON CONFLICT \(budget_id, period_key, event_kind\) DO NOTHING/);
      return { rows: calls === 1 ? [inserted] : [] }; // second tick hits the latch
    },
  };

  const first = await store.recordBudgetEvent({ budgetId: 'b-1', periodKey: '2026-08', eventKind: 'paused', detail: { spend_usd: 12 } });
  assert.deepStrictEqual(first, inserted);
  const second = await store.recordBudgetEvent({ budgetId: 'b-1', periodKey: '2026-08', eventKind: 'paused', detail: { spend_usd: 13 } });
  assert.strictEqual(second, null, 'duplicate emission latched to null');
  assert.strictEqual(calls, 2);
}

// ── Migration 023 fixture (AC3) ─────────────────────────────────

function testMigrationFixture() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema', 'migrations', '023_add_budget_ledger.sql'), 'utf8');
  // Partial unique index: one ACTIVE budget per (scope, scope_id, period),
  // with COALESCE folding fleet's NULL scope_id into the key.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_active_scope_period/);
  assert.match(sql, /ON budgets \(scope, COALESCE\(scope_id, ''\), period\)/);
  assert.match(sql, /WHERE active/);
  // Cap XOR CHECK.
  assert.match(sql, /\(cap_usd IS NOT NULL\)::int \+ \(cap_tokens IS NOT NULL\)::int = 1/);
  // Enum constraints.
  assert.match(sql, /scope IN \('agent','department','project','fleet'\)/);
  assert.match(sql, /period IN \('daily','weekly','monthly'\)/);
  assert.match(sql, /action_on_exceed IN \('warn','pause_new_runs','hard_stop'\)/);
  assert.match(sql, /event_kind IN \('warned','paused','hard_stopped','recovered'\)/);
  // Idempotency latch + cascade delete + bookkeeping row.
  assert.match(sql, /UNIQUE \(budget_id, period_key, event_kind\)/);
  assert.match(sql, /REFERENCES budgets\(id\) ON DELETE CASCADE/);
  assert.match(sql, /INSERT INTO schema_migrations \(migration_name\) VALUES \('023_add_budget_ledger'\) ON CONFLICT DO NOTHING/);
}

async function run() {
  await testPostEnumValidation();
  await testPostCapXorRule();
  await testPostHappyPath();
  await testListDerivedSpendAndStatus();
  await testPatch();
  await testLedgerEndpoint();
  await testNoDatabaseDegradation();
  await testQueryFailureDegradation();
  testPeriodKeys();
  testEvaluateBudgetBoundaries();
  testMostRestrictive();
  await testStorageHelpersNoThrow();
  await testRecordBudgetEventLatch();
  testMigrationFixture();
  console.log('✅ tests/test-budget-routes.js — all assertions passed');
}

run().catch(err => {
  console.error('❌ test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
