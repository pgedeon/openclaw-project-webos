#!/usr/bin/env node
/**
 * Unit tests for Gateway Workflow Dispatcher V2
 * Uses a fake Pool with semantic query matching — no real database required.
 */

const assert = require('assert');
const { GatewayWorkflowDispatcherV2, normalizeRunRow, normalizeStatsRow, DEFAULT_OPTIONS } = require('../gateway-workflow-dispatcher-v2.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// ─── Fake Pool ────────────────────────────────────────────────────

function createFakePool(handlers = {}) {
  const queries = [];
  return {
    _queries: queries,
    _handlers: handlers,
    async query(sql, params) {
      const entry = { sql: (sql || '').replace(/\s+/g, ' ').trim(), params };
      queries.push(entry);
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (entry.sql.includes(pattern)) {
          return handler(entry.sql, params);
        }
      }
      return { rows: [] };
    },
    async end() {}
  };
}

function fakeRun(overrides = {}) {
  return {
    id: 'run-001',
    workflow_type: 'test-workflow',
    owner_agent_id: 'agent-1',
    status: 'queued',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dispatch_attempts: 0,
    ...overrides
  };
}

// ─── normalizeRunRow Tests ────────────────────────────────────────

console.log('\n=== normalizeRunRow ===');

test('returns null for null/undefined input', () => {
  assert.strictEqual(normalizeRunRow(null), null);
  assert.strictEqual(normalizeRunRow(undefined), null);
});

test('preserves both snake_case and camelCase fields', () => {
  const row = normalizeRunRow({ workflow_type: 'test', workflowType: 'test' });
  assert.strictEqual(row.workflowType, 'test');
  assert.strictEqual(row.workflow_type, 'test');
});

test('parses JSON fields from strings', () => {
  const row = normalizeRunRow({ input_payload: '{"key":"val"}', output_summary: '{"count":1}' });
  assert.deepStrictEqual(row.inputPayload, { key: 'val' });
  assert.deepStrictEqual(row.outputSummary, { count: 1 });
});

test('preserves JSON fields already parsed', () => {
  const row = normalizeRunRow({ input_payload: { key: 'val' } });
  assert.deepStrictEqual(row.inputPayload, { key: 'val' });
});

test('defaults dispatch_attempts to 0', () => {
  const row = normalizeRunRow({});
  assert.strictEqual(row.dispatchAttempts, 0);
});

test('converts string dispatch_attempts to number', () => {
  const row = normalizeRunRow({ dispatch_attempts: '3' });
  assert.strictEqual(row.dispatchAttempts, 3);
});

test('defaults timeout_minutes to 60', () => {
  const row = normalizeRunRow({});
  assert.strictEqual(row.timeoutMinutes, 60);
});

test('defaults max_concurrent to 1', () => {
  const row = normalizeRunRow({});
  assert.strictEqual(row.maxConcurrent, 1);
});

// ─── normalizeStatsRow Tests ──────────────────────────────────────

console.log('\n=== normalizeStatsRow ===');

test('defaults all counts to 0', () => {
  const stats = normalizeStatsRow({});
  assert.strictEqual(stats.queuedCount, 0);
  assert.strictEqual(stats.pendingCount, 0);
  assert.strictEqual(stats.claimedCount, 0);
  assert.strictEqual(stats.runningCount, 0);
  assert.strictEqual(stats.completedCount, 0);
  assert.strictEqual(stats.failedCount, 0);
  assert.strictEqual(stats.timedOutCount, 0);
  assert.strictEqual(stats.staleUnclaimedCount, 0);
  assert.strictEqual(stats.staleClaimedCount, 0);
});

test('reads counts from snake_case rows', () => {
  const stats = normalizeStatsRow({ queued_count: '5', pending_count: '3' });
  assert.strictEqual(stats.queuedCount, 5);
  assert.strictEqual(stats.pendingCount, 3);
});

test('reads counts from camelCase rows', () => {
  const stats = normalizeStatsRow({ queuedCount: '7' });
  assert.strictEqual(stats.queuedCount, 7);
});

// ─── Dispatcher Constructor Tests ─────────────────────────────────

console.log('\n=== Constructor ===');

test('accepts injected pool', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool, {});
  assert.strictEqual(d.pool, pool);
  assert.strictEqual(d.ownsPool, false);
});

test('creates default pool when no pool injected', () => {
  const d = new GatewayWorkflowDispatcherV2({}, console);
  assert.strictEqual(d.ownsPool, true);
  d.close(); // cleanup
});

test('applies default options', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  assert.strictEqual(d.options.pollIntervalMs, DEFAULT_OPTIONS.pollIntervalMs);
  assert.strictEqual(d.options.maxDispatchRetries, 3);
  assert.strictEqual(d.options.staleDispatchMs, 5 * 60 * 1000);
});

test('merges custom options with defaults', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool, { maxDispatchRetries: 5, batchSize: 20 });
  assert.strictEqual(d.options.maxDispatchRetries, 5);
  assert.strictEqual(d.options.batchSize, 20);
  assert.strictEqual(d.options.pollIntervalMs, DEFAULT_OPTIONS.pollIntervalMs);
});

test('not running by default', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  assert.strictEqual(d.running, false);
});

// ─── start/stop Tests ─────────────────────────────────────────────

console.log('\n=== start/stop ===');

test('start sets running to true', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  d.start();
  assert.strictEqual(d.running, true);
  d.stop();
});

test('stop clears interval and running state', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  d.start();
  d.stop();
  assert.strictEqual(d.running, false);
  assert.strictEqual(d.interval, null);
});

test('start is idempotent', () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  d.start();
  d.start();
  assert.strictEqual(d.running, true);
  d.stop();
});

// ─── tick Tests ───────────────────────────────────────────────────

console.log('\n=== tick ===');

test('tick dispatches queued runs', async () => {
  const pool = createFakePool({
    'GREATEST': () => ({ rows: [{ ...fakeRun(), routed_agent_id: 'agent-1' }] }),
    "SET status = 'dispatched'": () => ({ rows: [{ ...fakeRun({ status: 'dispatched' }), routed_agent_id: 'agent-1' }] }),
    "status = 'dispatched'\n      AND wr.dispatched_at IS NOT NULL": () => ({ rows: [] }),
    "status IN ('claimed', 'running')\n      AND COALESCE(wr.last_heartbeat_at, wr.claimed_at)": () => ({ rows: [] }),
    "COALESCE(wr.claimed_at, wr.started_at, wr.created_at) <= NOW()": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 999999 });
  const summary = await d.tick();

  assert.strictEqual(summary.dispatchedCount, 1);
  assert.strictEqual(summary.retriedCount, 0);
  assert.strictEqual(summary.releasedCount, 0);
  assert.strictEqual(summary.timedOutCount, 0);
});

test('tick returns empty summary for idle system', async () => {
  const pool = createFakePool({
    'GREATEST': () => ({ rows: [] }),
    "status = 'dispatched'\n      AND wr.dispatched_at IS NOT NULL": () => ({ rows: [] }),
    "status IN ('claimed', 'running')\n      AND COALESCE(wr.last_heartbeat_at, wr.claimed_at)": () => ({ rows: [] }),
    "COALESCE(wr.claimed_at, wr.started_at, wr.created_at) <= NOW()": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool, { pollIntervalMs: 999999 });
  const summary = await d.tick();

  assert.strictEqual(summary.dispatchedCount, 0);
  assert.strictEqual(summary.retriedCount, 0);
  assert.strictEqual(summary.releasedCount, 0);
  assert.strictEqual(summary.timedOutCount, 0);
});

test('tick sets lastTickAt and clears lastTickError on success', async () => {
  const pool = createFakePool({
    'GREATEST': () => ({ rows: [] }),
    "status = 'dispatched'\n      AND wr.dispatched_at IS NOT NULL": () => ({ rows: [] }),
    "status IN ('claimed', 'running')\n      AND COALESCE(wr.last_heartbeat_at, wr.claimed_at)": () => ({ rows: [] }),
    "COALESCE(wr.claimed_at, wr.started_at, wr.created_at) <= NOW()": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  await d.tick();

  assert.ok(d.lastTickAt);
  assert.strictEqual(d.lastTickError, null);
});

// ─── claimRun Tests ───────────────────────────────────────────────

console.log('\n=== claimRun ===');

test('requires sessionId', async () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  await assert.rejects(() => d.claimRun('run-1', {}), /sessionId is required/);
});

test('returns run on successful claim', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({
      rows: [{ ...fakeRun({ status: 'claimed', claim_session_id: 'sess-1' }), routed_agent_id: 'agent-1' }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.claimRun('run-001', { sessionId: 'sess-1' });
  assert.ok(run);
  assert.strictEqual(run.status, 'claimed');
  assert.strictEqual(run.claimSessionId, 'sess-1');
});

test('returns null when run is not available (already claimed)', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.claimRun('run-001', { sessionId: 'sess-1' });
  assert.strictEqual(run, null);
});

// ─── heartbeatRun Tests ───────────────────────────────────────────

console.log('\n=== heartbeatRun ===');

test('requires sessionId', async () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  await assert.rejects(() => d.heartbeatRun('run-1', {}), /sessionId is required/);
});

test('updates heartbeat on claimed/running run', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({
      rows: [{ ...fakeRun({ status: 'running', last_heartbeat_at: new Date().toISOString() }) }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.heartbeatRun('run-001', { sessionId: 'sess-1' });
  assert.ok(run);
});

test('returns null when session mismatch', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.heartbeatRun('run-001', { sessionId: 'sess-wrong' });
  assert.strictEqual(run, null);
});

// ─── completeRun Tests ────────────────────────────────────────────

console.log('\n=== completeRun ===');

test('completes a running run', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({
      rows: [{ ...fakeRun({ status: 'completed', finished_at: new Date().toISOString() }) }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.completeRun('run-001', { sessionId: 'sess-1', outputSummary: { result: 'ok' } });
  assert.ok(run);
  assert.strictEqual(run.status, 'completed');
});

test('returns null when run not found for completion', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.completeRun('run-001');
  assert.strictEqual(run, null);
});

// ─── getPendingRuns Tests ─────────────────────────────────────────

console.log('\n=== getPendingRuns ===');

test('returns empty array when no pending runs', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const runs = await d.getPendingRuns();
  assert.deepStrictEqual(runs, []);
});

test('returns normalized pending runs', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({
      rows: [{ ...fakeRun({ status: 'dispatched', dispatched_at: new Date().toISOString() }), routed_agent_id: 'agent-1' }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const runs = await d.getPendingRuns();
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].status, 'dispatched');
});

// ─── getStats Tests ───────────────────────────────────────────────

console.log('\n=== getStats ===');

test('returns zeroed stats for empty database', async () => {
  const pool = createFakePool({
    'COUNT(*) FILTER': () => ({ rows: [{ queued_count: 0, pending_count: 0, dispatched_count: 0, average_claim_latency_seconds: 0 }] }),
    'SELECT COUNT(*)': () => ({ rows: [{ route_count: 0 }] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const stats = await d.getStats();

  assert.strictEqual(stats.queuedCount, 0);
  assert.strictEqual(stats.routeCount, 0);
  assert.strictEqual(stats.failureRate, 0);
});

test('computes failure rate from stats', async () => {
  const pool = createFakePool({
    'COUNT(*) FILTER': () => ({ rows: [{ queued_count: 0, pending_count: 0, completed_count: 8, failed_count: 1, timed_out_count: 1, dispatched_count: 10, stale_unclaimed_count: 0, stale_claimed_count: 0, average_claim_latency_seconds: 2.5 }] }),
    'SELECT COUNT(*)': () => ({ rows: [{ route_count: 3 }] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const stats = await d.getStats();

  assert.strictEqual(stats.dispatchCount, 10);
  assert.strictEqual(stats.completedCount, 8);
  assert.strictEqual(stats.failedCount, 1);
  assert.strictEqual(stats.timedOutCount, 1);
  assert.ok(stats.failureRate > 0);
  assert.strictEqual(stats.routeCount, 3);
});

// ─── getRun Tests ─────────────────────────────────────────────────

console.log('\n=== getRun ===');

test('returns normalized run by id', async () => {
  const pool = createFakePool({
    "wr.id = $1": () => ({
      rows: [{ ...fakeRun({ status: 'running' }), routed_agent_id: 'agent-1', routing_priority: 0, max_concurrent: 1, timeout_minutes: 60 }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.getRun('run-001');
  assert.ok(run);
  assert.strictEqual(run.workflowType, 'test-workflow');
});

test('returns null for non-existent run', async () => {
  const pool = createFakePool({
    "wr.id = $1": () => ({ rows: [] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const run = await d.getRun('nonexistent');
  assert.strictEqual(run, null);
});

// ─── HTTP Handler Tests ───────────────────────────────────────────

console.log('\n=== HTTP Handler ===');

function fakeReq(method, url) {
  return { method, url, headers: { host: 'localhost' } };
}

function fakeRes() {
  const res = {
    _statusCode: 0,
    _body: null,
    writeHead(code, headers) { res._statusCode = code; res._headers = headers; },
    end(body) { res._body = body; },
    _json() { return JSON.parse(res._body); }
  };
  return res;
}

test('GET /api/workflow-runs/pending returns runs', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({ rows: [{ ...fakeRun({ status: 'dispatched' }), routed_agent_id: 'agent-1' }] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('GET', '/api/workflow-runs/pending');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/pending');
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
  const body = res._json();
  assert.strictEqual(body.runs.length, 1);
});

test('POST /api/workflow-runs/:id/claim claims a run', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({
      rows: [{ ...fakeRun({ status: 'claimed', claim_session_id: 'sess-1' }), routed_agent_id: 'agent-1' }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('POST', '/api/workflow-runs/run-001/claim');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/run-001/claim', { session_id: 'sess-1' });
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
  const body = res._json();
  assert.strictEqual(body.status, 'claimed');
});

test('POST /api/workflow-runs/:id/claim returns 409 when already claimed', async () => {
  const pool = createFakePool({
    "wr.status = 'dispatched'": () => ({ rows: [] }),
    "wr.id = $1\n      LIMIT 1": () => ({ rows: [{ ...fakeRun({ status: 'claimed', claim_session_id: 'sess-other' }) }] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('POST', '/api/workflow-runs/run-001/claim');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/run-001/claim', { session_id: 'sess-1' });
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 409);
});

test('POST /api/workflow-runs/:id/claim returns 400 when no sessionId', async () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('POST', '/api/workflow-runs/run-001/claim');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/run-001/claim', {});
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 400);
  assert.ok(res._json().error.includes('sessionId'));
});

test('POST /api/workflow-runs/:id/heartbeat updates heartbeat', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({
      rows: [{ ...fakeRun({ status: 'running', last_heartbeat_at: new Date().toISOString() }) }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('POST', '/api/workflow-runs/run-001/heartbeat');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/run-001/heartbeat', { session_id: 'sess-1' });
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
});

test('POST /api/workflow-runs/:id/complete completes a run', async () => {
  const pool = createFakePool({
    "status IN ('claimed', 'running')": () => ({
      rows: [{ ...fakeRun({ status: 'completed', finished_at: new Date().toISOString() }) }]
    })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('POST', '/api/workflow-runs/run-001/complete');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/run-001/complete', { session_id: 'sess-1', output_summary: { result: 'done' } });
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
});

test('GET /api/workflow-runs/dispatcher/stats returns stats', async () => {
  const pool = createFakePool({
    'COUNT(*) FILTER': () => ({ rows: [{ queued_count: 0, pending_count: 0, completed_count: 0, failed_count: 0, timed_out_count: 0, dispatched_count: 0, stale_unclaimed_count: 0, stale_claimed_count: 0, average_claim_latency_seconds: 0 }] }),
    'SELECT COUNT(*)': () => ({ rows: [{ route_count: 0 }] })
  });

  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('GET', '/api/workflow-runs/dispatcher/stats');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/dispatcher/stats');
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
  const body = res._json();
  assert.strictEqual(body.routeCount, 0);
});

test('OPTIONS returns CORS headers', async () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('OPTIONS', '/api/workflow-runs/pending');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/workflow-runs/pending');
  assert.strictEqual(handled, true);
  assert.strictEqual(res._statusCode, 200);
  assert.strictEqual(res._headers['Access-Control-Allow-Origin'], '*');
});

test('returns false for unrecognized paths', async () => {
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  const req = fakeReq('GET', '/api/unknown');
  const res = fakeRes();

  const handled = await d.handleHttpRequest(req, res, '/api/unknown');
  assert.strictEqual(handled, false);
});

// ─── createGatewayWorkflowDispatcherV2Handler Tests ───────────────

console.log('\n=== createGatewayWorkflowDispatcherV2Handler ===');

test('creates handler with injected dispatcher', () => {
  const { createGatewayWorkflowDispatcherV2Handler } = require('../gateway-workflow-dispatcher-v2.js');
  const pool = createFakePool();
  const d = new GatewayWorkflowDispatcherV2(pool);
  const handler = createGatewayWorkflowDispatcherV2Handler(d);
  assert.strictEqual(handler.dispatcher, d);
  assert.strictEqual(typeof handler, 'function');
});

test('creates handler with pool', () => {
  const { createGatewayWorkflowDispatcherV2Handler } = require('../gateway-workflow-dispatcher-v2.js');
  const pool = createFakePool();
  const handler = createGatewayWorkflowDispatcherV2Handler(pool, {}, console);
  assert.ok(handler.dispatcher instanceof GatewayWorkflowDispatcherV2);
});

// ─── Summary ──────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Unit Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
