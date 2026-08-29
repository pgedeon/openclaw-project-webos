#!/usr/bin/env node
/**
 * Connected snapshot-flow coverage WITHOUT a database, socket, or browser —
 * the "e2e-lite" middle layer the existing suites leave open:
 *
 *   - tests/test-mcp-server.js fakes the POST /api/actions/execute RESPONSE,
 *     so the real actions pipeline never runs behind an MCP mutation.
 *   - tests/test-action-routes.js exercises the pipeline but INJECTS a
 *     throwing createSnapshot executor (debt D4) — the real snapshot
 *     executor never executes there.
 *   - tests/test-snapshot-routes.js covers route semantics directly; its
 *     route-level redaction fixture (api_key) is matched by the ORIGINAL
 *     deny-regex too, so the debt-D3 widening is only pinned at lib level.
 *   - tests/test-e2e-mcp-snapshot-flows.js runs the real MCP child over
 *     real HTTP but only ever calls the read-only list_snapshots tool.
 *
 * THIS file connects the full mutating seam DB-free:
 *   MCP create_snapshot → minted envelope → REAL routes/action-routes.js
 *   pipeline (validation → governance → latch → executor) → REAL
 *   createSnapshotArtifact() over a storage stub → receipt →
 *   mapActionOutcome → MCP payload — and pins the ROUTE-level application
 *   of the debt-D3 deny-regex (snake_case secret names in NESTED JSONB)
 *   plus the no-secret-marker-in-any-response-body invariant.
 *
 * DB-free: the "task-server" is the real Router dispatched through a
 * fetch-shaped bridge (response-capture style, no sockets); PostgreSQL is
 * a routing fake pool; artifacts live in a temp directory.
 * Run: node tests/test-snapshot-e2e-lite.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Router = require('../routes/router');
const { registerActionRoutes } = require('../routes/action-routes');
const { registerSnapshotRoutes } = require('../routes/snapshot-routes');
const { sha256Canonical } = require('../lib/snapshot-manifest');
const { dispatch, createMcpServer, handleMessage } = require('../lib/mcp-server');

const TOKEN = 'e2e-lite-bearer-token-51af';

/** Marker secrets — asserted absent from every response body and shipped byte. */
const MARKERS = {
  dbPassword: 'sup3r-secret-db-pass-9q',
  accessToken: 'tok-live-access-7z',
  openaiApiKey: 'sk-proj-openai-marker-3k',
  settingsPassword: 'hunter2-lite-5t',
};

// ── Storage stub: routing fake pool (action_receipts latch + snapshot tiers) ──

function makeLitePool(options = {}) {
  const { tables = {}, migrations = ['001_add_workflow_runs'], failOn = null } = options;
  const statements = [];
  let inserts = 0;
  const updates = [];
  const auditInserts = [];
  const pool = {
    statements,
    get inserts() { return inserts; },
    get updates() { return updates; },
    get auditInserts() { return auditInserts; },
    async query(sql, params = []) {
      if (failOn && failOn.test(sql)) throw new Error('pool query failed (forced)');
      statements.push({ sql, params });
      if (/INSERT INTO action_receipts/.test(sql)) {
        inserts += 1;
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
      if (/FROM action_receipts WHERE action_id/.test(sql)) return { rows: [] };
      if (/FROM schema_migrations/i.test(sql)) {
        return { rows: migrations.map((m) => ({ migration_name: m })) };
      }
      const m = sql.match(/FROM\s+([a-z_]+)/i);
      if (m && tables[m[1]]) return { rows: tables[m[1]] };
      return { rows: [] };
    },
    async connect() {
      const client = {
        async query(sql, params) { return pool.query(sql, params); },
        release() {},
      };
      return client;
    },
  };
  return pool;
}

function liteSettingsStore() {
  return {
    getAll() {
      return {
        appearance: {
          theme: { value: 'dark', type: 'select', source: 'config' },
        },
        general: {
          DASHBOARD_AUTH_TOKEN: { value: MARKERS.settingsPassword, type: 'password', source: 'env' },
        },
      };
    },
  };
}

// ── Response-capture request/response shapes (test-snapshot-routes style) ──

function makeReq(method, url, rawBody) {
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    params: {},
    on(event, cb) {
      if (event === 'data' && rawBody != null) cb(rawBody);
      if (event === 'end') cb();
    },
  };
}

function makeCtx(storage) {
  return {
    sendJSON(res, status, payload) { res.result = { status, payload }; },
    asanaStorage: storage, // undefined → the honest no-database shape
  };
}

/** Direct router call → {status, payload}. */
async function routeCall(router, method, url, ctx, body) {
  const res = {};
  const handled = await router.handle(makeReq(method, url, body != null ? JSON.stringify(body) : null), res, url.split('?')[0], method, ctx);
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  assert.ok(res.result, `${method} ${url} should produce a JSON response`);
  return res.result;
}

/**
 * Fetch-shaped bridge: MCP httpJson() → the REAL router. Records every call
 * (url + options + response) so the no-secret sweep can cover them all.
 */
function makeBridge({ router, context }) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (options.method || 'GET').toUpperCase();
    const res = {};
    const ctx = makeCtx(context.storage);
    const raw = options.body !== undefined && options.body !== null ? String(options.body) : null;
    const handled = await router.handle(makeReq(method, u.pathname + u.search, raw), res, u.pathname, method, ctx);
    const status = handled && res.result ? res.result.status : 404;
    const payload = handled && res.result ? res.result.payload : { error: 'not_found' };
    calls.push({ url, options, status, payload });
    return { status, json: async () => payload };
  };
  impl.calls = calls;
  return impl;
}

function buildRouter(snapshotsDir, pool, extraOptions = {}) {
  const router = new Router();
  const routeOptions = {
    snapshotsDir,
    settingsStore: liteSettingsStore(),
    ...extraOptions,
  };
  registerActionRoutes(router, routeOptions);
  registerSnapshotRoutes(router, routeOptions);
  return router;
}

async function run() {
  let passed = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (err) {
      console.error(`FAIL ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    }
  };

  const bodies = []; // every response body seen anywhere in this run

  // ── [01] Connected happy path: MCP → pipeline → real executor → receipt ──

  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-lite-'));
  const pool1 = makeLitePool({
    tables: {
      workflows: [{ id: 'wf1', name: 'nightly' }],
      tasks: [{ id: 't1', title: 'alpha' }, { id: 't2', title: 'beta' }],
    },
  });
  const router1 = buildRouter(dir1, pool1);
  const bridge1 = makeBridge({ router: router1, context: { storage: { pool: pool1 } } });
  const server1 = createMcpServer({
    env: { DASHBOARD_AUTH_TOKEN: TOKEN, OPENCLAW_MCP_MUTATIONS: '1' },
    fetchImpl: bridge1,
  });

  let snapshotId1 = null;
  await step('[01] MCP create_snapshot → real actions pipeline → real executor → executed receipt + artifact', async () => {
    const res = await handleMessage(server1, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'create_snapshot', arguments: { name: 'qa-e2e-lite' } },
    });
    const frame = res.result;
    assert.strictEqual(frame.isError, undefined, 'executed mutation is a normal result');
    const payload = JSON.parse(frame.content[0].text);
    bodies.push(frame.content[0].text);
    const receipt = payload.receipt;
    assert.ok(receipt, 'receipt rides the tool payload');
    assert.strictEqual(receipt.kind, 'snapshot.create');
    assert.strictEqual(receipt.outcome, 'executed');
    assert.strictEqual(receipt.actor, 'openclaw');
    assert.ok(receipt.rollback_hint, 'rollback hint present');
    snapshotId1 = receipt.detail.result.snapshot_id;
    assert.ok(typeof snapshotId1 === 'string' && snapshotId1.length > 0, 'executor result carries the snapshot id');

    // The bridge hit the REAL pipeline over the wire shape MCP uses.
    const execute = bridge1.calls.find((c) => c.url.endsWith('/api/actions/execute'));
    assert.ok(execute, 'POST /api/actions/execute reached the router');
    assert.strictEqual(execute.options.headers.Authorization, `Bearer ${TOKEN}`);
    const envelope = JSON.parse(execute.options.body);
    assert.strictEqual(envelope.kind, 'snapshot.create');
    assert.strictEqual(envelope.targetId, 'qa-e2e-lite');
    assert.strictEqual(envelope.actor, 'openclaw');

    // The artifact really exists on disk, written by createSnapshotArtifact.
    const file = path.join(dir1, `${snapshotId1}.json`);
    assert.ok(fs.existsSync(file), 'artifact file written');
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(artifact.manifest.name, 'qa-e2e-lite');
    assert.strictEqual(artifact.manifest.counts.tasks, 2);
    bodies.push(fs.readFileSync(file, 'utf8'));

    // Receipt latch + audit mirror really hit the storage stub.
    assert.strictEqual(pool1.inserts, 1, 'latch INSERT written');
    assert.strictEqual(pool1.updates.length, 1, 'receipt finalized via UPDATE');
    assert.strictEqual(JSON.parse(pool1.updates[0].params[3]).result.snapshot_id, snapshotId1);
    assert.strictEqual(pool1.auditInserts.length, 0, 'no audit mirror row: snapshot.create has no resolvable task_id (audit_log.task_id NOT NULL)');
    // …and the receipt says so honestly via the audit_skipped note.
    assert.ok(receipt.detail.audit_skipped.includes('no resolvable task_id'));
  });

  // ── [02] Route-level debt-D3 redaction: snake_case secrets in nested JSONB ──

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-lite-'));
  const secretRow = {
    id: 't1',
    title: 'doc',
    metadata: {
      db: { db_password: MARKERS.dbPassword, host: 'db.local' },
      creds: [{ access_token: MARKERS.accessToken }, { note: 'keep me' }],
      openai_api_key: MARKERS.openaiApiKey,
      tokens_used: 42,
      keyboard_hint: 'Ctrl+K',
    },
  };
  const pool2 = makeLitePool({ tables: { tasks: [secretRow] } });
  const router2 = buildRouter(dir2, pool2);

  await step('[02] route-level D3: snake_case secret names in nested JSONB redacted, structure + near-misses survive', async () => {
    const result = await routeCall(router2, 'POST', '/api/snapshots', makeCtx({ pool: pool2 }), { name: 'd3-route-level' });
    bodies.push(JSON.stringify(result.payload));
    assert.strictEqual(result.status, 201);
    const file = path.join(dir2, `${result.payload.snapshot_id}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    bodies.push(raw);
    const artifact = JSON.parse(raw);

    const meta = artifact.tables.tasks[0].metadata;
    assert.strictEqual(meta.db.db_password, '[REDACTED]', 'underscore-prefixed password dies (D3 class)');
    assert.strictEqual(meta.db.host, 'db.local', 'sibling keys survive');
    assert.strictEqual(meta.creds[0].access_token, '[REDACTED]', 'secret inside array element dies');
    assert.strictEqual(meta.creds[1].note, 'keep me', 'array structure + clean elements survive');
    assert.strictEqual(meta.openai_api_key, '[REDACTED]', 'underscore-prefixed api key dies (D3 class)');
    assert.strictEqual(meta.tokens_used, 42, 'near-miss (token + suffix) survives');
    assert.strictEqual(meta.keyboard_hint, 'Ctrl+K', 'near-miss survives');

    // Settings section: config-source only, password-type structurally absent.
    assert.deepStrictEqual(artifact.settings, { theme: 'dark' });
    assert.ok(!raw.includes('DASHBOARD_AUTH_TOKEN'));

    // The content_hash describes exactly the shipped (redacted) bytes.
    assert.strictEqual(
      sha256Canonical({ tables: artifact.tables, settings: artifact.settings }),
      artifact.manifest.content_hash,
      'hash covers the redacted bytes an operator can re-download'
    );
  });

  // ── [03] No unredacted secret marker in ANY response body or shipped byte ──

  await step('[03] no secret marker appears in any response body, artifact byte, or MCP frame', async () => {
    // Registry listing + download round-trip join the sweep.
    const listing = await routeCall(router2, 'GET', '/api/snapshots', makeCtx());
    bodies.push(JSON.stringify(listing.payload));
    const snapId = listing.payload.snapshots[0].snapshot_id;
    const download = await routeCall(router2, 'GET', `/api/snapshots/${snapId}/download`, makeCtx());
    bodies.push(JSON.stringify(download.payload));

    // Every bridged call's response body (pipeline + telemetry misses).
    for (const c of bridge1.calls) bodies.push(JSON.stringify(c.payload));

    const needles = Object.values(MARKERS);
    for (const body of bodies) {
      for (const marker of needles) {
        assert.ok(!body.includes(marker), `secret marker leaked: ${marker} in "${body.slice(0, 120)}…"`);
      }
    }
  });

  // ── [04] Request validation (bad entity) before anything else ─────────

  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-lite-'));
  const pool4 = makeLitePool({ tables: { tasks: [{ id: 't1' }] } });
  const router4 = buildRouter(dir4, pool4);

  await step('[04] bad envelope → 400 invalid_action before governance/latch/executor; bad MCP args → invalid_params with zero fetches', async () => {
    // Missing actionId.
    const noId = await routeCall(router4, 'POST', '/api/actions/execute', makeCtx({ pool: pool4 }), {
      kind: 'snapshot.create', targetId: 'x', params: {},
    });
    bodies.push(JSON.stringify(noId.payload));
    assert.strictEqual(noId.status, 400);
    assert.strictEqual(noId.payload.error, 'invalid_action');
    assert.strictEqual(pool4.inserts, 0, 'no latch written for an invalid envelope');
    assert.strictEqual(fs.readdirSync(dir4).length, 0, 'no artifact written for an invalid envelope');

    // Unknown kind (not in the catalog).
    const badKind = await routeCall(router4, 'POST', '/api/actions/execute', makeCtx({ pool: pool4 }), {
      actionId: 'a1', kind: 'snapshot.delete', targetId: 'x', params: {},
    });
    bodies.push(JSON.stringify(badKind.payload));
    assert.strictEqual(badKind.status, 400);
    assert.ok(badKind.payload.details.some((d) => d.includes('unknown_kind')));

    // MCP-level: over-long name rejected at validation, zero upstream calls.
    const bridge4 = makeBridge({ router: router4, context: { storage: { pool: pool4 } } });
    const outcome = await dispatch('create_snapshot', { name: 'x'.repeat(121) }, { fetchImpl: bridge4, baseUrl: 'http://x', token: TOKEN });
    assert.strictEqual(outcome.isError, true);
    assert.strictEqual(outcome.payload.error, 'invalid_params');
    assert.strictEqual(bridge4.calls.length, 0, 'validation rejects before any HTTP');
  });

  // ── [05] no_database degradation through the connected MCP path ───────

  const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-lite-'));
  const router5 = buildRouter(dir5, null); // json_snapshot parity: no storage at all
  const bridge5 = makeBridge({ router: router5, context: { storage: undefined } });

  await step('[05] create_snapshot with no database → pipeline 503 → isError unavailable, zero writes', async () => {
    const outcome = await dispatch('create_snapshot', { name: 'no-db' }, { fetchImpl: bridge5, baseUrl: 'http://x', token: TOKEN });
    assert.strictEqual(outcome.isError, true, 'write refusal is an isError result');
    assert.strictEqual(outcome.payload.error, 'unavailable');
    assert.strictEqual(outcome.payload.reason, 'no_database');
    assert.ok(outcome.payload.hint.includes('nothing executed'), 'honest refusal hint');
    const execute = bridge5.calls.find((c) => c.url.endsWith('/api/actions/execute'));
    assert.strictEqual(execute.status, 503, 'pipeline answered 503 over the bridge');
    assert.deepStrictEqual(execute.payload, { available: false, reason: 'no_database' });
    bodies.push(JSON.stringify(execute.payload));
    assert.strictEqual(fs.readdirSync(dir5).length, 0, 'degraded create writes nothing');
  });

  // ── [06] Real-executor failure keeps the structured snapshot_body (D4 complement) ──

  const dir6 = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-lite-'));
  const pool6 = makeLitePool({ tables: { tasks: [{ id: 't1' }] }, failOn: /FROM schema_migrations/i });
  const router6 = buildRouter(dir6, pool6);
  const bridge6 = makeBridge({ router: router6, context: { storage: { pool: pool6 } } });

  await step('[06] real createSnapshot executor failure → execution_failed receipt carrying snapshot_body', async () => {
    const outcome = await dispatch('create_snapshot', { name: 'fails-mid-capture' }, { fetchImpl: bridge6, baseUrl: 'http://x', token: TOKEN });
    assert.strictEqual(outcome.isError, true);
    const execute = bridge6.calls.find((c) => c.url.endsWith('/api/actions/execute'));
    assert.strictEqual(execute.status, 400);
    assert.strictEqual(execute.payload.error, 'execution_failed');
    bodies.push(JSON.stringify(execute.payload));
    const receipt = execute.payload.receipt;
    assert.strictEqual(receipt.outcome, 'failed');
    assert.ok(receipt.detail.error.includes('snapshot capture failed (500)'));
    assert.deepStrictEqual(receipt.detail.snapshot_body, { error: 'pool query failed (forced)' },
      'the endpoint-shaped failure body survives into the receipt (D4, real executor)');
    // Same structured detail persisted to the latch UPDATE.
    const persisted = JSON.parse(pool6.updates[0].params[3]);
    assert.deepStrictEqual(persisted.snapshot_body, receipt.detail.snapshot_body);
    assert.strictEqual(fs.readdirSync(dir6).length, 0, 'failed capture writes no artifact');
  });

  // Cleanup + final sweep double-check across every collected body.
  fs.rmSync(dir1, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(dir4, { recursive: true, force: true });
  fs.rmSync(dir5, { recursive: true, force: true });
  fs.rmSync(dir6, { recursive: true, force: true });
  for (const body of bodies) {
    for (const marker of Object.values(MARKERS)) {
      assert.ok(!body.includes(marker), `final sweep: marker leaked — ${marker}`);
    }
  }

  console.log(`\ntest-snapshot-e2e-lite: ${passed} checks passed`);
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});