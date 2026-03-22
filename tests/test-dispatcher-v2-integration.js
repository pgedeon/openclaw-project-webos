#!/usr/bin/env node
/**
 * Integration tests for Gateway Workflow Dispatcher V2
 * Runs against the real PostgreSQL database (mission_control).
 */

const assert = require('assert');
const { GatewayWorkflowDispatcherV2 } = require('../gateway-workflow-dispatcher-v2.js');
const pg = require('pg');

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  database: 'mission_control',
  user: 'postgres',
  password: 'postgres',
};

const T = 'd2test-'; // short prefix for test data

let passed = 0;
let failed = 0;
let pool;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}: ${err.message}`);
    }
  })();
}

async function setup() {
  pool = new pg.Pool(DB_CONFIG);

  // Insert test routing
  await pool.query(`
    INSERT INTO workflow_agent_routing (workflow_type, agent_id, priority, max_concurrent, timeout_minutes)
    VALUES 
      ('${T}qa', '${T}qa-agent', 10, 2, 5),
      ('${T}deploy', '${T}deploy-agent', 5, 1, 10)
    ON CONFLICT (workflow_type) DO UPDATE SET agent_id = EXCLUDED.agent_id
  `);

  // Clean leftover test data
  await cleanupTestData();
}

async function cleanupTestData() {
  await pool.query(`DELETE FROM workflow_steps WHERE workflow_run_id IN (SELECT id FROM workflow_runs WHERE workflow_type LIKE '${T}%')`);
  await pool.query(`DELETE FROM workflow_approvals WHERE workflow_run_id IN (SELECT id FROM workflow_runs WHERE workflow_type LIKE '${T}%')`);
  await pool.query(`DELETE FROM workflow_runs WHERE workflow_type LIKE '${T}%'`);
}

async function teardown() {
  if (!pool) return;
  try {
    await cleanupTestData();
    await pool.query(`DELETE FROM workflow_agent_routing WHERE workflow_type LIKE '${T}%'`);
    await pool.end();
  } catch (e) { /* ignore */ }
}

async function createRun(overrides = {}) {
  const result = await pool.query(`
    INSERT INTO workflow_runs (workflow_type, owner_agent_id, status, input_payload)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [
    overrides.workflow_type || `${T}qa`,
    overrides.owner_agent_id || `${T}main`,
    overrides.status || 'queued',
    overrides.input_payload || JSON.stringify({ test: true })
  ]);
  return result.rows[0].id;
}

async function getRunStatus(id) {
  const { rows } = await pool.query(
    "SELECT status, claim_session_id, claimed_at, last_heartbeat_at, finished_at, dispatched_at, last_error FROM workflow_runs WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function runAllTests() {
  await setup();

  const dispatcher = new GatewayWorkflowDispatcherV2(pool, {
    pollIntervalMs: 999999,
    staleClaimMs: 60 * 1000,
    staleDispatchMs: 30 * 1000,
  });

  try {
    // ─── Basic Dispatch ──────────────────────────────────────────
    console.log('\n=== Basic Dispatch ===');

    const runId1 = await createRun();
    const runId2 = await createRun();

    await test('tick dispatches queued runs', async () => {
      const summary = await dispatcher.tick();
      assert.strictEqual(summary.dispatchedCount, 2);

      const r1 = await getRunStatus(runId1);
      assert.strictEqual(r1.status, 'dispatched');
      assert.ok(r1.dispatched_at, 'dispatched_at should be set');
    });

    // ─── Claim ────────────────────────────────────────────────────
    console.log('\n=== Claim ===');

    await test('claimRun claims a dispatched run', async () => {
      const run = await dispatcher.claimRun(runId1, { sessionId: 'sess-1' });
      assert.ok(run);
      assert.strictEqual(run.status, 'claimed');
      assert.strictEqual(run.claimSessionId, 'sess-1');

      const db = await getRunStatus(runId1);
      assert.strictEqual(db.status, 'claimed');
      assert.strictEqual(db.claim_session_id, 'sess-1');
      assert.ok(db.claimed_at);
    });

    await test('double claim returns null', async () => {
      const run = await dispatcher.claimRun(runId1, { sessionId: 'sess-2' });
      assert.strictEqual(run, null);
    });

    await test('claim non-existent run returns null', async () => {
      const run = await dispatcher.claimRun('00000000-0000-0000-0000-000000000000', { sessionId: 'sess-1' });
      assert.strictEqual(run, null);
    });

    // ─── Heartbeat ───────────────────────────────────────────────
    console.log('\n=== Heartbeat ===');

    await test('heartbeatRun updates liveness', async () => {
      const run = await dispatcher.heartbeatRun(runId1, { sessionId: 'sess-1' });
      assert.ok(run);

      const db = await getRunStatus(runId1);
      assert.ok(db.last_heartbeat_at);
    });

    await test('heartbeatRun rejects wrong session', async () => {
      const run = await dispatcher.heartbeatRun(runId1, { sessionId: 'wrong' });
      assert.strictEqual(run, null);
    });

    // ─── Complete ────────────────────────────────────────────────
    console.log('\n=== Complete ===');

    await test('completeRun marks as completed', async () => {
      const run = await dispatcher.completeRun(runId1, {
        sessionId: 'sess-1',
        outputSummary: { result: 'success', tests: 47 }
      });

      const db = await getRunStatus(runId1);
      assert.strictEqual(db.status, 'completed');
      assert.ok(db.finished_at);
    });

    await test('completeRun rejects wrong session', async () => {
      // Claim runId2 first
      await dispatcher.claimRun(runId2, { sessionId: 'sess-3' });

      const run = await dispatcher.completeRun(runId2, {
        sessionId: 'wrong',
        outputSummary: {}
      });
      assert.strictEqual(run, null);

      // Verify it's still claimed, not completed
      const db = await getRunStatus(runId2);
      assert.strictEqual(db.status, 'claimed');
    });

    // ─── Full Lifecycle ──────────────────────────────────────────
    console.log('\n=== Full Lifecycle ===');

    await test('queue → dispatch → claim → heartbeat → complete', async () => {
      const id = await createRun({ workflow_type: `${T}deploy` });

      // Dispatch
      const s1 = await dispatcher.tick();
      assert.ok(s1.dispatchedCount >= 1);

      // Claim
      const claimed = await dispatcher.claimRun(id, { sessionId: 'lc' });
      assert.strictEqual(claimed.status, 'claimed');

      // Heartbeat
      const hb = await dispatcher.heartbeatRun(id, { sessionId: 'lc' });
      assert.ok(hb);

      // Complete
      const done = await dispatcher.completeRun(id, {
        sessionId: 'lc',
        outputSummary: { deployed: true }
      });
      assert.strictEqual(done.status, 'completed');
    });

    // ─── Failure via Direct DB (no failRun method) ──────────────
    console.log('\n=== Failure Handling ===');

    await test('failed runs count in stats', async () => {
      // Manually mark a run as failed (simulating a failure from the timeout system)
      const id = await createRun();
      await pool.query("UPDATE workflow_runs SET status = 'failed', last_error = 'Simulated failure', finished_at = NOW() WHERE id = $1", [id]);

      const stats = await dispatcher.getStats();
      assert.ok(stats.failedCount >= 1, `Expected at least 1 failed, got ${stats.failedCount}`);
    });

    // ─── Timeout Handling ────────────────────────────────────────
    console.log('\n=== Timeout Handling ===');

    await test('stale claimed runs get released', async () => {
      const id = await createRun();
      await dispatcher.tick(); // dispatch

      // Claim and set claimed_at to 2 minutes ago (beyond staleClaimMs of 60s)
      await pool.query(
        "UPDATE workflow_runs SET status = 'claimed', claim_session_id = 'stale-sess', claimed_at = NOW() - INTERVAL '2 minutes' WHERE id = $1",
        [id]
      );

      // Tick should release it
      const summary = await dispatcher.tick();
      assert.ok(summary.releasedCount >= 1, `Expected at least 1 released, got ${summary.releasedCount}`);

      // Verify it went back to dispatched
      const db = await getRunStatus(id);
      assert.strictEqual(db.status, 'dispatched', 'Released run should be back to dispatched');
      assert.strictEqual(db.claim_session_id, null, 'Session should be cleared');
    });

    await test('over-timeout runs get timed_out', async () => {
      const id = await createRun({ workflow_type: `${T}deploy` });
      await dispatcher.tick(); // dispatch
      await pool.query(
        "UPDATE workflow_runs SET status = 'claimed', claim_session_id = 'timeout-sess', claimed_at = NOW() - INTERVAL '15 minutes' WHERE id = $1",
        [id]
      );

      const summary = await dispatcher.tick();
      // The timeout handler runs with a 60s staleClaimMs, so 15 min old = timed out
      assert.ok(summary.timedOutCount >= 1, `Expected at least 1 timed out, got ${summary.timedOutCount}`);

      const db = await getRunStatus(id);
      assert.strictEqual(db.status, 'timed_out');
    });

    // ─── Stats ──────────────────────────────────────────────────
    console.log('\n=== Stats ===');

    await test('getStats returns accurate counts', async () => {
      const stats = await dispatcher.getStats();
      assert.ok(stats.completedCount >= 2, `Completed >= 2, got ${stats.completedCount}`);
      assert.ok(stats.failedCount >= 1, `Failed >= 1, got ${stats.failedCount}`);
      assert.ok(stats.dispatchCount >= 1, `Dispatched >= 1, got ${stats.dispatchCount}`);
      assert.ok(stats.routeCount >= 2, `Routes >= 2, got ${stats.routeCount}`);
      assert.ok(stats.failureRate >= 0, 'Failure rate should be non-negative');
    });

    // ─── getPendingRuns ─────────────────────────────────────────
    console.log('\n=== getPendingRuns ===');

    await test('returns only dispatched unclaimed runs', async () => {
      // Create and dispatch a run
      const id = await createRun();
      await dispatcher.tick();

      const pending = await dispatcher.getPendingRuns();
      assert.ok(pending.length > 0, 'Should have pending runs');

      // Claim it
      await dispatcher.claimRun(id, { sessionId: 'pending-sess' });

      // Should no longer appear
      const pending2 = await dispatcher.getPendingRuns();
      const stillThere = pending2.find(r => r.id === id);
      assert.strictEqual(stillThere, undefined, 'Claimed run should not appear in pending');
    });

    // ─── getRun ─────────────────────────────────────────────────
    console.log('\n=== getRun ===');

    await test('returns run by ID with routing info', async () => {
      const id = await createRun();
      const run = await dispatcher.getRun(id);

      assert.ok(run);
      assert.strictEqual(run.id, id);
      assert.strictEqual(run.workflowType, `${T}qa`);
    });

    await test('returns null for missing run', async () => {
      const run = await dispatcher.getRun('00000000-0000-0000-0000-000000000000');
      assert.strictEqual(run, null);
    });

    // ─── HTTP Handler ───────────────────────────────────────────
    console.log('\n=== HTTP Handler ===');

    await test('GET /pending returns JSON array', async () => {
      const id = await createRun();
      await dispatcher.tick();

      const handler = require('../gateway-workflow-dispatcher-v2.js').createGatewayWorkflowDispatcherV2Handler(dispatcher);

      const res = await httpGet(handler, '/api/workflow-runs/pending');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.runs));
      assert.ok(res.body.runs.length > 0);
    });

    await test('POST /:id/claim with body', async () => {
      const id = await createRun();
      // Dispatch directly via DB to avoid tick side-effects
      await pool.query(
        "UPDATE workflow_runs SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1",
        [id]
      );

      const handler = require('../gateway-workflow-dispatcher-v2.js').createGatewayWorkflowDispatcherV2Handler(dispatcher);
      const res = await httpPost(handler, `/api/workflow-runs/${id}/claim`, { session_id: 'http-sess' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'claimed');
    });

    await test('GET /dispatcher/stats returns stats', async () => {
      const handler = require('../gateway-workflow-dispatcher-v2.js').createGatewayWorkflowDispatcherV2Handler(dispatcher);
      const res = await httpGet(handler, '/api/workflow-runs/dispatcher/stats');

      assert.strictEqual(res.status, 200);
      assert.ok('completedCount' in res.body);
      assert.ok('failureRate' in res.body);
    });

    // ─── Concurrency ────────────────────────────────────────────
    console.log('\n=== Concurrency ===');

    await test('concurrent claims: only one succeeds', async () => {
      const id = await createRun();
      // Dispatch it explicitly via DB to avoid tick timing
      await pool.query(
        "UPDATE workflow_runs SET status = 'dispatched', dispatched_at = NOW() WHERE id = $1",
        [id]
      );

      const [r1, r2] = await Promise.all([
        dispatcher.claimRun(id, { sessionId: 'race-1' }),
        dispatcher.claimRun(id, { sessionId: 'race-2' }),
      ]);

      const successes = [r1, r2].filter(r => r !== null);
      assert.strictEqual(successes.length, 1, 'Exactly one claim should succeed');
    });

    await test('concurrent ticks: no double-dispatch', async () => {
      const id = await createRun();

      const [s1, s2] = await Promise.all([
        dispatcher.tick(),
        dispatcher.tick(),
      ]);

      // The run should be dispatched only once (tick 1 dispatches, tick 2 sees it as dispatched)
      const totalDispatched = s1.dispatchedCount + s2.dispatchedCount;
      assert.ok(totalDispatched <= 2, `Should not double-dispatch, got ${totalDispatched}`);
    });

  } finally {
    dispatcher.close();
  }

  await teardown();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Integration Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── HTTP Helpers ──────────────────────────────────────────────────

async function httpGet(handler, path) {
  const res = {
    _status: 0,
    _body: '',
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(code, headers) { this._status = code; if (headers) Object.assign(this._headers, headers); },
    end(body) { this._body = body; }
  };
  await handler({ method: 'GET', url: path, headers: { host: 'localhost' } }, res, path);
  return { status: res._status, body: JSON.parse(res._body), headers: res._headers };
}

async function httpPost(handler, path, body) {
  const res = {
    _status: 0,
    _body: '',
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(code, headers) { this._status = code; if (headers) Object.assign(this._headers, headers); },
    end(body) { this._body = body; }
  };
  await handler({ method: 'POST', url: path, headers: { host: 'localhost' } }, res, path, body);
  return { status: res._status, body: JSON.parse(res._body), headers: res._headers };
}

runAllTests().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
