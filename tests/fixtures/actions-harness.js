'use strict';
/**
 * Actions e2e harness — one-click actions flow coverage (tests/e2e.spec.ts).
 *
 * Serves the REAL routes/router.js + REAL routes/action-routes.js pipeline
 * over a real http.Server on an ephemeral port, with two injection points:
 *   - getStorage → an in-memory receipt-latch pool that mimics the exact SQL
 *     shapes the pipeline issues (PK-conflict 23505 on duplicate latch
 *     INSERT, transactional client for finalize).
 *   - executors  → counting cancelRun stub so "executor invoked exactly once"
 *     is directly observable from the test.
 *
 * Why a harness instead of the live json_snapshot server: the latch needs
 * PostgreSQL semantics (unique-violation errors, BEGIN/COMMIT clients) and
 * AsanaJsonSnapshotStorage ships pool=null, so every valid envelope honestly
 * degrades to 503 {available:false} there. The unit suite
 * (tests/test-action-routes.js) covers full semantics but over synthetic
 * req/ctx objects — this harness adds real HTTP stream parsing, status
 * codes, and router wiring on top.
 */
const http = require('http');
const Router = require('../../routes/router');
const { registerActionRoutes } = require('../../routes/action-routes');

/** In-memory pool speaking just enough PG for the actions pipeline. */
function createLatchPool() {
  const receipts = new Map(); // action_id → row (detail kept as raw JSON string)
  const stats = { inserts: 0, updates: 0, latchSelects: 0 };

  async function query(sql, params = []) {
    if (/INSERT INTO action_receipts/.test(sql)) {
      stats.inserts += 1;
      if (receipts.has(params[0])) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "action_receipts_pkey"'),
          { code: '23505' }
        );
      }
      receipts.set(params[0], {
        action_id: params[0],
        kind: params[1],
        target_id: params[2],
        params_hash: params[3],
        actor: params[4],
        outcome: null,
        rollback_hint: null,
        detail: params[6], // raw JSON string, like a jsonb round-trip
        created_at: new Date().toISOString(),
      });
      return { rows: [] };
    }
    if (/UPDATE action_receipts/.test(sql)) {
      stats.updates += 1;
      const row = receipts.get(params[0]);
      if (row) {
        row.outcome = params[1];
        row.rollback_hint = params[2];
        row.detail = params[3];
      }
      return { rows: [] };
    }
    if (/FROM action_receipts WHERE action_id/.test(sql)) {
      stats.latchSelects += 1;
      const row = receipts.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/SELECT task_id FROM workflow_runs WHERE id/.test(sql)) return { rows: [] }; // audit_skipped path
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
    return { rows: [] };
  }

  const pool = {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
  return { pool, stats, receipts };
}

/**
 * Start the harness. Resolves once the server is listening.
 * @param {{executor?: Function}} [opts] - override the cancelRun executor.
 * @returns {Promise<{baseUrl: string, executorCalls: string[], stats: object,
 *                     close: () => Promise<void>}>}
 */
function startActionsHarness(opts = {}) {
  const latch = createLatchPool();
  const executorCalls = [];
  const debug = process.env.ACTIONS_HARNESS_DEBUG === '1';
  const cancelRun = opts.executor || (async ({ envelope }) => {
    executorCalls.push(envelope.actionId);
    return { run_id: envelope.targetId, status: 'cancelled' };
  });

  const router = new Router();
  registerActionRoutes(router, {
    getStorage: () => ({ pool: latch.pool }),
    executors: { cancelRun },
  });

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const ctx = {
      sendJSON(res2, status, body) {
        res2.writeHead(status, { 'Content-Type': 'application/json' });
        res2.end(JSON.stringify(body));
      },
    };
    try {
      if (debug) {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          process.stderr.write(`[actions-harness] ${req.method} ${pathname} body=${chunks.join('')}\n`);
        });
      }
      const handled = await router.handle(req, res, pathname, req.method, ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'harness_error', message: String(err && err.message) }));
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        executorCalls,
        stats: latch.stats,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { startActionsHarness };
