#!/usr/bin/env node
/**
 * DB-free tests for MCP tool-call adoption telemetry:
 *   - routes/mcp-telemetry-routes.js
 *       validateMcpTelemetry pure validation (tool against live registry,
 *       outcome enum, integer durationMs bounds)
 *       endpoint via real Router: registration, validation-before-pool
 *       (named 400s even without DB), graceful degradation (no pool /
 *       42P01 audit_log missing), audit row shape (actor 'openclaw', action
 *       'mcp-tool-call', JSONB detail), query failure → 500.
 *   - scripts/mcp-adoption-counter.js evaluateMcpAdoption pure aggregation:
 *       per-tool counts, ok/error split, unattributed-outcome honesty,
 *       UTC day bucketing (Date vs ISO string), window filtering,
 *       malformed-row tolerance, never-called registered tools listing.
 *
 * Run: node tests/test-mcp-telemetry.js
 */

const assert = require('assert');
const EventEmitter = require('events');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✔ ${name}`); },
        (err) => { failed++; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed++;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const START = Date.parse('2026-08-25T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function mockReq(body) {
  const req = new EventEmitter();
  process.nextTick(() => {
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
  req.url = '/api/mcp/telemetry';
  req.headers = { host: 'localhost' };
  return req;
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    writeHead(status) { res.statusCode = status; },
    end(payload) { res.body = payload ? JSON.parse(payload) : null; }
  };
  return res;
}

function makeStubPool(queryImpl) {
  let calls = 0;
  return {
    get callCount() { return calls; },
    async query(...args) { calls++; return queryImpl(...args); }
  };
}

(async () => {
  const routesMod = require(path.join(__dirname, '..', 'routes', 'mcp-telemetry-routes.js'));
  const counterMod = require(path.join(__dirname, '..', 'scripts', 'mcp-adoption-counter.js'));
  const { validateMcpTelemetry } = routesMod;
  const { evaluateMcpAdoption } = counterMod;
  const Router = require(path.join(__dirname, '..', 'routes', 'router.js'));
  const { TOOLS } = require(path.join(__dirname, '..', 'lib', 'mcp-server'));

  console.log('validateMcpTelemetry (pure)');

  await check('valid payload passes with trimmed shape', () => {
    const v = validateMcpTelemetry({ tool: 'list_tasks', outcome: 'ok', durationMs: 42 });
    assert.deepStrictEqual(v, { ok: true, tool: 'list_tasks', outcome: 'ok', durationMs: 42 });
  });

  await check('non-object / array / null body → invalid_body', () => {
    for (const bad of [null, undefined, 'x', 42, [], [{ tool: 'list_tasks' }]]) {
      assert.strictEqual(validateMcpTelemetry(bad).error, 'invalid_body', String(JSON.stringify(bad)));
    }
  });

  await check('unknown or non-string tool → invalid_tool (validated against live registry)', () => {
    for (const tool of ['nope', '', 'LIST_TASKS', 7, undefined, 'drop table']) {
      assert.strictEqual(
        validateMcpTelemetry({ tool, outcome: 'ok', durationMs: 1 }).error, 'invalid_tool', String(tool));
    }
    // every currently-registered tool name is accepted
    for (const t of TOOLS) {
      assert.ok(validateMcpTelemetry({ tool: t.name, outcome: 'ok', durationMs: 1 }).ok, t.name);
    }
  });

  await check('outcome must be exactly ok|error', () => {
    for (const outcome of ['OK', 'success', true, 1, undefined, null]) {
      assert.strictEqual(
        validateMcpTelemetry({ tool: 'list_tasks', outcome, durationMs: 1 }).error, 'invalid_outcome', String(outcome));
    }
    assert.ok(validateMcpTelemetry({ tool: 'list_tasks', outcome: 'error', durationMs: 1 }).ok);
  });

  await check('durationMs must be an integer within [0, 1h]', () => {
    for (const d of [-1, 1.5, '42', NaN, Infinity, null, undefined, 60 * 60 * 1000 + 1]) {
      assert.strictEqual(
        validateMcpTelemetry({ tool: 'list_tasks', outcome: 'ok', durationMs: d }).error, 'invalid_duration', String(d));
    }
    assert.ok(validateMcpTelemetry({ tool: 'list_tasks', outcome: 'ok', durationMs: 0 }).ok);
    assert.ok(validateMcpTelemetry({ tool: 'list_tasks', outcome: 'ok', durationMs: 60 * 60 * 1000 }).ok);
  });

  console.log('POST /api/mcp/telemetry (via real Router)');

  await check('route registers at POST /api/mcp/telemetry', () => {
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    assert.ok(router.list().some((r) => r.method === 'POST' && r.path === '/api/mcp/telemetry'));
  });

  await check('validation fires BEFORE the pool check — invalid body gets named 400 even in no-DB mode', async () => {
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    const res = mockRes();
    const handled = await router.handle(mockReq({ tool: 'junk_tool', outcome: 'ok', durationMs: 1 }), res, '/api/mcp/telemetry', 'POST', {});
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid_tool' });
  });

  await check('no DB pool → graceful 200 {stored:false, reason:no_database}', async () => {
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    const res = mockRes();
    const handled = await router.handle(
      mockReq({ tool: 'get_task', outcome: 'ok', durationMs: 12 }),
      res, '/api/mcp/telemetry', 'POST', {});
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: false, reason: 'no_database' });
  });

  await check('with pool: writes mcp-tool-call audit row (actor openclaw, task_id NULL, JSONB detail)', async () => {
    const seen = [];
    const pool = makeStubPool(async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; });
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ tool: 'search_audit', outcome: 'error', durationMs: 250 }),
      res, '/api/mcp/telemetry', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: true, action: 'mcp-tool-call' });
    assert.strictEqual(pool.callCount, 1);
    assert.match(seen[0].sql, /INSERT INTO audit_log/);
    assert.strictEqual(seen[0].params[0], 'openclaw');
    assert.strictEqual(seen[0].params[1], 'mcp-tool-call');
    assert.deepStrictEqual(JSON.parse(seen[0].params[2]), { tool: 'search_audit', outcome: 'error', durationMs: 250 });
  });

  await check('audit_log table absent (42P01) → 200 {stored:false, reason:audit_log_missing}', async () => {
    const pool = makeStubPool(async () => { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; });
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ tool: 'list_budgets', outcome: 'ok', durationMs: 3 }),
      res, '/api/mcp/telemetry', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: false, reason: 'audit_log_missing' });
  });

  await check('unexpected write failure → 500 {error:query_failed}', async () => {
    const pool = makeStubPool(async () => { throw new Error('connection reset'); });
    const router = new Router();
    routesMod.registerMcpTelemetryRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ tool: 'list_budgets', outcome: 'ok', durationMs: 3 }),
      res, '/api/mcp/telemetry', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'query_failed' });
  });

  console.log('evaluateMcpAdoption (pure aggregation)');

  await check('empty/null/non-array rows → honest zeros, no fabrication', () => {
    for (const bad of [null, undefined, 'nope', 42, {}]) {
      const r = evaluateMcpAdoption(bad);
      assert.strictEqual(r.totalCalls, 0);
      assert.strictEqual(r.activeDays, 0);
      assert.strictEqual(r.firstCallAt, null);
      assert.strictEqual(r.tools.filter((t) => t.used).length, 0);
    }
    assert.strictEqual(evaluateMcpAdoption([]).registeredToolCount, TOOLS.length);
  });

  await check('per-tool counts + ok/error split across mixed rows', () => {
    const rows = [
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 5 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS + 3600e3), new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 7 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS + 7200e3), new_value: { tool: 'get_task', outcome: 'error', durationMs: 9 } },
      { action: 'workflow-graph-open', timestamp: new Date(START + DAY_MS), new_value: { template: 't' } }, // other action ignored
    ];
    const r = evaluateMcpAdoption(rows);
    assert.strictEqual(r.totalCalls, 3);
    assert.strictEqual(r.okCalls, 2);
    assert.strictEqual(r.errorCalls, 1);
    const lt = r.tools.find((t) => t.name === 'list_tasks');
    assert.deepStrictEqual({ name: lt.name, calls: lt.calls, ok: lt.ok, error: lt.error }, { name: 'list_tasks', calls: 2, ok: 2, error: 0 });
    const gt = r.tools.find((t) => t.name === 'get_task');
    assert.strictEqual(gt.calls, 1);
    assert.strictEqual(gt.error, 1);
  });

  await check('window filter: pre-slice-1 rows dropped', () => {
    const rows = [
      { action: 'mcp-tool-call', timestamp: new Date(START - 1000), new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 5 } },
      { action: 'mcp-tool-call', timestamp: new Date(START), new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 5 } },
    ];
    const r = evaluateMcpAdoption(rows);
    assert.strictEqual(r.totalCalls, 1);
  });

  await check('UTC day bucketing handles Date and ISO-string timestamps alike', () => {
    const iso = new Date(START + 2 * DAY_MS + 23 * 3600e3).toISOString(); // still day+2 UTC
    const rows = [
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'list_budgets', outcome: 'ok', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: iso, new_value: { tool: 'list_budgets', outcome: 'ok', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + 3 * DAY_MS), new_value: { tool: 'list_budgets', outcome: 'ok', durationMs: 1 } },
    ];
    const r = evaluateMcpAdoption(rows);
    assert.strictEqual(r.activeDays, 3);
    assert.strictEqual(r.firstCallAt, new Date(START + DAY_MS).toISOString());
    assert.strictEqual(r.lastCallAt, new Date(START + 3 * DAY_MS).toISOString());
  });

  await check('malformed rows tolerated: bad timestamp drops row; bad detail counts under unknown/unattributed', () => {
    const rows = [
      { action: 'mcp-tool-call', timestamp: 'not-a-date', new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: 'not-json{' },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'list_tasks', outcome: 'weird', durationMs: 1 } },
    ];
    const r = evaluateMcpAdoption(rows);
    assert.strictEqual(r.totalCalls, 2);
    assert.strictEqual(r.otherOutcomeCalls, 2, 'both malformed-detail rows count as calls but stay unattributed');
    const unknown = r.tools.find((t) => t.name === 'unknown');
    assert.strictEqual(unknown.calls, 1);
    assert.strictEqual(unknown.ok, 0);
    assert.strictEqual(unknown.error, 0);
    const lt = r.tools.find((t) => t.name === 'list_tasks');
    assert.strictEqual(lt.calls, 1);
    assert.strictEqual(lt.ok, 0);
    assert.strictEqual(lt.error, 0);
  });

  await check('never-called registered tools listed unused; used sort first by calls desc then name', () => {
    const rows = [
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'search_audit', outcome: 'ok', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'list_tasks', outcome: 'ok', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'list_tasks', outcome: 'error', durationMs: 1 } },
      { action: 'mcp-tool-call', timestamp: new Date(START + DAY_MS), new_value: { tool: 'zzz_not_registered', outcome: 'ok', durationMs: 1 } },
    ];
    const r = evaluateMcpAdoption(rows);
    const used = r.tools.filter((t) => t.used).map((t) => t.name);
    assert.deepStrictEqual(used, ['list_tasks', 'search_audit', 'zzz_not_registered']);
    const unusedNames = new Set(r.tools.filter((t) => !t.used).map((t) => t.name));
    assert.ok(unusedNames.has('create_task'), 'mutating trio appears as never-called when unused');
    assert.ok(unusedNames.has('get_mission_control_summary'));
    assert.strictEqual(r.tools.length, TOOLS.length + 1, 'registered set + one unregistered observation');
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})();
