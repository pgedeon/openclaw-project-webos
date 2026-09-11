#!/usr/bin/env node
/**
 * Focused DB-free tests for routes/snapshot-routes.js (snapshot/restore
 * slice 2), docs/briefs/snapshot-restore.md acceptance criteria AC5–AC11 +
 * route-level AC13. Response-capture style follows tests/test-export-routes.js;
 * PostgreSQL is always a fixture pool, artifacts live in a temp directory.
 *
 * Run: node tests/test-snapshot-routes.js
 */

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Router = require('../routes/router');
const { registerSnapshotRoutes, TABLE_ORDER } = require('../routes/snapshot-routes');
const { buildManifest } = require('../lib/snapshot-manifest');

// ── Response-capture harness (test-export-routes.js style) ─────────

function createResponseCapture() {
  return { result: null, writes: [], headers: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function createRequest(url, method = 'GET', body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3876' };

  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  return req;
}

function createContext(overrides = {}) {
  return {
    sendJSON,
    ...overrides,
  };
}

async function dispatch(router, method, url, context, body) {
  const req = createRequest(url, method, body);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  if (!res.result) {
    assert.ok(res.payload || res.headers, `${method} ${url} should produce a response`);
    // Download path: normalize into the usual result shape.
    return { status: res.status || 200, payload: res.payload, headers: res.headers };
  }
  return res.result;
}

// ── Fixture pool ────────────────────────────────────────────────────

function stmtIndexOf(pool, substr) {
  const idx = pool.statements.findIndex((s) => s.sql.includes(substr));
  assert.ok(idx >= 0, `expected a statement containing "${substr}", got:\n${pool.statements.map((s) => s.sql).join('\n')}`);
  return idx;
}

function createFakePool(options = {}) {
  const statements = [];
  const clients = [];
  const tables = options.tables || {};
  const migrations = options.migrations || ['001_add_workflow_runs'];
  let connectCount = 0;

  return {
    statements,
    clients,
    get connectCount() {
      return connectCount;
    },
    async query(sql) {
      statements.push({ sql });
      if (options.failPoolQuery && options.failPoolQuery(sql)) throw new Error('pool query failed');
      if (/FROM\s+schema_migrations/i.test(sql)) {
        return { rows: migrations.map((m) => ({ migration_name: m })) };
      }
      if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ n: options.activeRuns || 0 }] };
      const m = sql.match(/FROM\s+([a-z_]+)/i);
      if (m && tables[m[1]]) return { rows: tables[m[1]] };
      return { rows: [] };
    },
    async connect() {
      connectCount += 1;
      if (options.failConnect) throw new Error('connect failed');
      const client = {
        released: false,
        async query(sql, params) {
          statements.push({ sql, params });
          if (options.failClientQuery && options.failClientQuery(sql)) {
            throw new Error('transaction write failed');
          }
          return { rows: [] };
        },
        release() {
          client.released = true;
        },
      };
      clients.push(client);
      return client;
    },
  };
}

// ── Artifact fixtures ───────────────────────────────────────────────

const T0 = '2026-08-24T12:00:00.000Z';
let snapshotCounter = 0;

function nextSnapshotId() {
  snapshotCounter += 1;
  return `11111111-2222-4333-8444-00000000000${snapshotCounter}`;
}

function buildArtifact(rowsByTable, opts = {}) {
  const settings = opts.settings || { theme: 'dark' };
  const manifest = buildManifest(rowsByTable, settings, opts.migrations || ['001_add_workflow_runs'], {
    snapshotId: opts.snapshotId || nextSnapshotId(),
    name: opts.name,
    createdAt: opts.createdAt || T0,
    generator: 'openclaw-project-webos test',
  });
  return { manifest, tables: rowsByTable, settings };
}

function tempSnapshotsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-routes-test-'));
}

function makeRouter(snapshotsDir, extra = {}) {
  const router = new Router();
  const frames = [];
  registerSnapshotRoutes(router, {
    snapshotsDir,
    broadcastStream: (frame) => frames.push(frame),
    settingsStore: extra.settingsStore || null,
  });
  return { router, frames };
}

async function run() {
  // ── [01] Route registration ───────────────────────────────────────
  {
    const router = new Router();
    registerSnapshotRoutes(router, {});
    const expected = [
      ['POST', '/api/snapshots'],
      ['GET', '/api/snapshots'],
      ['GET', '/api/snapshots/:id/download'],
      ['POST', '/api/restore/preview'],
      ['POST', '/api/restore/apply'],
    ];
    for (const [method, p] of expected) {
      assert.ok(
        router.list().some((r) => r.method === method && r.path === p),
        `${method} ${p} should be registered`
      );
    }
    console.log('PASS [01] five snapshot/restore routes registered');
  }

  const snapshotsDir = tempSnapshotsDir();

  // ── [02] Create: 201 + atomic artifact + exact counts + redaction ──
  {
    const pool = createFakePool({
      tables: {
        workflows: [{ id: 'wf1', name: 'nightly', metadata: { api_key: 'sk-live-secret-wf', keyboard_hint: 'Ctrl+K' } }],
        tasks: [
          { id: 't1', title: 'alpha' },
          { id: 't2', title: 'beta' },
        ],
      },
      migrations: ['001_add_workflow_runs', '005_add_migration_tracking'],
    });
    const settingsStore = {
      getAll() {
        return {
          appearance: {
            theme: { value: 'dark', type: 'select', source: 'config' },
            accentColor: { value: '#60CDFF', type: 'string', source: 'config' },
          },
          general: {
            DASHBOARD_AUTH_TOKEN: { value: 'hunter2', type: 'password', source: 'env' },
            REQUIRE_AUTH: { value: true, type: 'toggle', source: 'env' },
          },
        };
      },
    };
    const { router } = makeRouter(snapshotsDir, { settingsStore });
    const result = await dispatch(router, 'POST', '/api/snapshots', createContext({ asanaStorage: { pool } }), { name: 'test-snap' });

    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.payload.snapshot_id, result.payload.manifest.snapshot_id);
    const manifest = result.payload.manifest;
    assert.strictEqual(manifest.name, 'test-snap');
    assert.strictEqual(manifest.counts.tasks, 2, 'counts must be exact row counts');
    assert.strictEqual(manifest.counts.workflows, 1);
    assert.deepStrictEqual(manifest.schema_version.migrations_applied, ['001_add_workflow_runs', '005_add_migration_tracking']);

    // Atomic write: final file exists, no tmp leftovers (AC5).
    const file = path.join(snapshotsDir, `${manifest.snapshot_id}.json`);
    assert.ok(fs.existsSync(file), 'artifact file should exist');
    const leftovers = fs.readdirSync(snapshotsDir).filter((f) => f.includes('.tmp'));
    assert.deepStrictEqual(leftovers, [], 'no tmp files may survive the rename');

    // Whole-artifact redaction (AC13 at route level): marker secrets die,
    // near-miss keys survive, password-type settings structurally absent.
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('hunter2'), 'password-type setting value must not ship');
    assert.ok(!raw.includes('DASHBOARD_AUTH_TOKEN'), 'password-type key must be structurally absent');
    assert.ok(!raw.includes('REQUIRE_AUTH'), 'env-source keys stay out (config-source only)');
    assert.ok(!raw.includes('sk-live-secret-wf'), 'deny-regex hit inside JSONB must be redacted');
    assert.ok(raw.includes('keyboard_hint'), 'near-miss key names survive');
    assert.ok(raw.includes('Ctrl+K'), 'near-miss values survive');
    const artifact = JSON.parse(raw);
    assert.deepStrictEqual(artifact.tables.tasks, [
      { id: 't1', title: 'alpha' },
      { id: 't2', title: 'beta' },
    ]);
    assert.deepStrictEqual(artifact.settings, { theme: 'dark', accentColor: '#60CDFF' });

    console.log('PASS [02] POST /api/snapshots creates atomically, exact counts, redacted (AC5, AC13)');
  }

  // ── [03] Create degradation: 503 {available:false} without DB ──────
  {
    const { router } = makeRouter(tempSnapshotsDir());
    const result = await dispatch(router, 'POST', '/api/snapshots', createContext(), { name: 'x' });
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.payload.available, false);
    assert.strictEqual(result.payload.reason, 'no_database');
    console.log('PASS [03] create degrades 503 {available:false, reason:no_database} (AC7)');
  }

  // ── [04] Registry listing: newest-first, honest sizes, corrupt skip ─
  {
    const dir = tempSnapshotsDir();
    const older = buildArtifact({ tasks: [{ id: 'a' }] }, { createdAt: '2026-08-23T09:00:00.000Z', name: 'older-one' });
    const newer = buildArtifact({ tasks: [{ id: 'b' }, { id: 'c' }] }, { createdAt: '2026-08-24T20:00:00.000Z', name: 'newer-one' });
    fs.writeFileSync(path.join(dir, `${older.manifest.snapshot_id}.json`), JSON.stringify(older));
    fs.writeFileSync(path.join(dir, `${newer.manifest.snapshot_id}.json`), JSON.stringify(newer));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');

    const { router } = makeRouter(dir);
    // Disk-only: context carries NO database at all (AC7 half).
    const result = await dispatch(router, 'GET', '/api/snapshots', createContext());
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.available, true);
    assert.strictEqual(result.payload.count, 2, 'corrupt registry entries are skipped');
    assert.strictEqual(result.payload.snapshots[0].snapshot_id, newer.manifest.snapshot_id, 'newest first');
    assert.strictEqual(result.payload.snapshots[1].snapshot_id, older.manifest.snapshot_id);
    for (const snap of result.payload.snapshots) {
      const stat = fs.statSync(path.join(dir, `${snap.snapshot_id}.json`));
      assert.strictEqual(snap.size_bytes, stat.size, 'sizes honest per R2');
      assert.ok(Number.isInteger(snap.total_rows));
    }
    assert.strictEqual(result.payload.snapshots[0].total_rows, 2);
    console.log('PASS [04] GET /api/snapshots lists newest-first with honest sizes, disk-only');
  }

  // ── [05] Download round-trip + 404s ────────────────────────────────
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact(
      { workflows: [{ id: 'wf1', name: 'n' }], tasks: [{ id: 't1', title: 'round trip' }] },
      { name: 'download-me' }
    );
    fs.writeFileSync(path.join(dir, `${artifact.manifest.snapshot_id}.json`), JSON.stringify(artifact));
    const { router } = makeRouter(dir);

    const dl = await dispatch(
      router,
      'GET',
      `/api/snapshots/${artifact.manifest.snapshot_id}/download`,
      createContext()
    );
    assert.strictEqual(dl.status, 200);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="download-me\.json"$/);
    assert.deepStrictEqual(dl.payload, artifact, 'download round-trips the exact artifact');

    const missing = await dispatch(router, 'GET', '/api/snapshots/no-such-id/download', createContext());
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.payload.error, 'snapshot_not_found');

    const traversal = await dispatch(router, 'GET', '/api/snapshots/..%2F..%2F.env/download', createContext());
    assert.strictEqual(traversal.status, 404, 'path-traversal ids never reach the filesystem');
    console.log('PASS [05] download streams attachment; unknown/traversal ids 404 (AC5)');
  }

  // ── [06] Preview classifications 1/1/1/1 ───────────────────────────
  {
    const artifactRows = [
      { id: 't1', title: 'same', updated_at: '2026-08-24T10:00:00.000Z' },
      { id: 't2', title: 'old-change', updated_at: '2026-08-24T10:00:00.000Z' },
      { id: 't3', title: 'diverged', updated_at: '2026-08-24T10:00:00.000Z' },
      { id: 't4', title: 'brand-new', updated_at: '2026-08-24T10:00:00.000Z' },
    ];
    const artifact = buildArtifact({ tasks: artifactRows });
    const currentRows = [
      { id: 't1', title: 'same', updated_at: '2026-08-24T10:00:00.000Z' },
      { id: 't2', title: 'changed-before-snapshot', updated_at: '2026-08-24T11:00:00.000Z' },
      { id: 't3', title: 'changed-after-snapshot', updated_at: '2026-08-24T13:00:00.000Z' },
    ];
    const pool = createFakePool({ tables: { tasks: currentRows } });
    const { router } = makeRouter(tempSnapshotsDir());
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { artifact }
    );
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.schema_compat, 'ok');
    assert.deepStrictEqual(result.payload.warnings, []);
    assert.deepStrictEqual(result.payload.tables.tasks, {
      added: 1,
      updated: 1,
      conflicts: 1,
      unchanged: 1,
      added_pks: ['t4'],
      conflict_pks: ['t3'],
    });
    assert.deepStrictEqual(result.payload.totals, { added: 1, updated: 1, conflicts: 1, unchanged: 1 });
    console.log('PASS [06] preview classifies added/updated/conflicts/unchanged (AC4 route-level)');
  }

  // ── [07] Schema compat: too_new refuses 409, target_newer warns ────
  {
    const ahead = buildArtifact({ tasks: [{ id: 't1' }] }, { migrations: ['001_add_workflow_runs', '999_future_migration'] });
    const pool = createFakePool({ migrations: ['001_add_workflow_runs'] });
    const { router } = makeRouter(tempSnapshotsDir());
    const refused = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { artifact: ahead }
    );
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.payload.error, 'schema_too_new');
    assert.deepStrictEqual(refused.payload.missing, ['999_future_migration']);

    const behind = buildArtifact({ tasks: [{ id: 't1' }] }, { migrations: ['001_add_workflow_runs'] });
    const pool2 = createFakePool({ migrations: ['001_add_workflow_runs', '006_add_departments'] });
    const warned = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool: pool2 } }),
      { artifact: behind }
    );
    assert.strictEqual(warned.status, 200);
    assert.strictEqual(warned.payload.schema_compat, 'target_newer');
    assert.ok(warned.payload.warnings.includes('target_newer'), 'target_newer must surface as warning (AC2)');
    console.log('PASS [07] schema-compat: 409 schema_too_new refusal + target_newer warning (AC2)');
  }

  // ── [08] Active-runs warning (R4) ──────────────────────────────────
  {
    const artifact = buildArtifact({ tasks: [{ id: 't1', title: 'x' }] });
    const pool = createFakePool({ activeRuns: 3, tables: { tasks: [] } });
    const { router } = makeRouter(tempSnapshotsDir());
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { artifact }
    );
    assert.strictEqual(result.status, 200);
    assert.ok(result.payload.warnings.includes('active_runs'), 'live writers must warn (R4)');
    console.log('PASS [08] preview warns active_runs while runs are in flight (R4)');
  }

  // ── [09] Settings-section drop warning + apply behavior (§5.3) ─────
  {
    const smuggled = buildArtifact({ tasks: [{ id: 't1' }] }, { settings: { DASHBOARD_AUTH_TOKEN: 'hunter2' } });
    const pool = createFakePool({ tables: { tasks: [] } });
    const setCalls = [];
    const { router } = makeRouter(tempSnapshotsDir(), {
      settingsStore: { async set(key, value) { setCalls.push([key, value]); } },
    });
    const preview = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { artifact: smuggled }
    );
    assert.ok(preview.payload.warnings.includes('settings_section_dropped'), 'secret-bearing settings section must warn');

    const applied = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact: smuggled, mode: 'merge', restoreId: 'restore-settings-drop' }
    );
    assert.strictEqual(applied.status, 200);
    assert.strictEqual(applied.payload.summary.settings.dropped_section, true);
    assert.strictEqual(applied.payload.summary.settings.applied, 0);
    assert.deepStrictEqual(setCalls, [], 'dropped settings section must never reach settingsStore.set');

    // Clean settings section applies through the store.
    const clean = buildArtifact({ tasks: [{ id: 't1' }] }, { settings: { theme: 'light' } });
    const appliedClean = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact: clean, mode: 'merge', restoreId: 'restore-settings-clean' }
    );
    assert.strictEqual(appliedClean.status, 200);
    assert.strictEqual(appliedClean.payload.summary.settings.applied, 1);
    assert.deepStrictEqual(setCalls, [['theme', 'light']]);
    console.log('PASS [09] settings section: secret-bearing dropped + warned, clean keys applied (§5.3)');
  }

  // ── [10] Corrupt artifact rejected before ANY diffing (AC8) ────────
  {
    const artifact = buildArtifact({ tasks: [{ id: 't1', title: 'honest' }] });
    artifact.tables.tasks[0].title = 'tampered';
    const pool = createFakePool({});
    const { router } = makeRouter(tempSnapshotsDir());
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { artifact }
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.payload.error, 'artifact_corrupt');
    assert.strictEqual(pool.statements.length, 0, 'integrity check must run before any DB access');
    console.log('PASS [10] content-hash mismatch → 400 artifact_corrupt pre-diff (AC8)');
  }

  // ── [11] Manifest validation + artifact resolution errors ──────────
  {
    const { router } = makeRouter(tempSnapshotsDir());
    const ctx = createContext({ asanaStorage: { pool: createFakePool({}) } });

    const broken = buildArtifact({ tasks: [] });
    delete broken.manifest.content_hash;
    const invalid = await dispatch(router, 'POST', '/api/restore/preview', ctx, { artifact: broken });
    assert.strictEqual(invalid.status, 400);
    assert.strictEqual(invalid.payload.error, 'invalid_manifest');
    assert.ok(invalid.payload.missing.includes('content_hash'));

    const none = await dispatch(router, 'POST', '/api/restore/preview', ctx, {});
    assert.strictEqual(none.status, 400);
    assert.strictEqual(none.payload.error, 'missing_artifact');

    const badJson = await dispatch(router, 'POST', '/api/restore/preview', ctx, '{nope');
    assert.strictEqual(badJson.status, 400);
    assert.strictEqual(badJson.payload.error, 'invalid_json');

    const unknownId = await dispatch(router, 'POST', '/api/restore/preview', ctx, { snapshot_id: 'ghost' });
    assert.strictEqual(unknownId.status, 404);
    assert.strictEqual(unknownId.payload.error, 'snapshot_not_found');

    const evilId = await dispatch(router, 'POST', '/api/restore/preview', ctx, { snapshot_id: '../evil' });
    assert.strictEqual(evilId.status, 400);
    assert.strictEqual(evilId.payload.error, 'invalid_snapshot_id');
    console.log('PASS [11] invalid_manifest / missing_artifact / invalid_json / snapshot_id errors');
  }

  // ── [12] snapshot_id resolution reads the server-side artifact ─────
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({ tasks: [{ id: 't1', title: 'on disk' }] }, { name: 'stored' });
    fs.writeFileSync(path.join(dir, `${artifact.manifest.snapshot_id}.json`), JSON.stringify(artifact));
    const pool = createFakePool({ tables: { tasks: [] } });
    const { router } = makeRouter(dir);
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext({ asanaStorage: { pool } }),
      { snapshot_id: artifact.manifest.snapshot_id }
    );
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.snapshot_id, artifact.manifest.snapshot_id);
    assert.strictEqual(result.payload.tables.tasks.added, 1);
    console.log('PASS [12] preview resolves {snapshot_id} from the disk registry');
  }

  // ── [13] 413 cap enforced pre-parse (AC9) ──────────────────────────
  {
    const prevMax = process.env.RESTORE_MAX_BYTES;
    process.env.RESTORE_MAX_BYTES = '300';
    try {
      const bigArtifact = JSON.stringify(buildArtifact({
        tasks: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `padding-padding-${i}` })),
      }));
      assert.ok(bigArtifact.length > 300, 'fixture must exceed the tiny cap');
      const pool = createFakePool({});
      const { router } = makeRouter(tempSnapshotsDir());
      const result = await dispatch(
        router,
        'POST',
        '/api/restore/preview',
        createContext({ asanaStorage: { pool } }),
        bigArtifact
      );
      assert.strictEqual(result.status, 413);
      assert.strictEqual(result.payload.error, 'payload_too_large');
      assert.strictEqual(pool.statements.length, 0, 'oversized bodies must die before any query');

      const createResult = await dispatch(
        router,
        'POST',
        '/api/snapshots',
        createContext({ asanaStorage: { pool: createFakePool({}) } }),
        bigArtifact
      );
      assert.strictEqual(createResult.status, 413);
      console.log('PASS [13] RESTORE_MAX_BYTES rejects oversized requests 413 pre-parse (AC9)');
    } finally {
      if (prevMax === undefined) delete process.env.RESTORE_MAX_BYTES;
      else process.env.RESTORE_MAX_BYTES = prevMax;
    }
  }

  // ── [14] Merge apply: upserts by PK, deletes nothing, AC10 order ───
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({
      workflows: [{ id: 'wf1', name: 'nightly' }],
      projects: [{ id: 'p1', name: 'core' }],
      tasks: [{ id: 't1', title: 'merge me' }],
    });
    const pool = createFakePool({ migrations: ['001_add_workflow_runs'] });
    const { router, frames } = makeRouter(dir);
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact, mode: 'merge', restoreId: 'restore-merge-1' }
    );
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.duplicate, false);
    assert.strictEqual(result.payload.resumed, false);
    assert.strictEqual(result.payload.restoreId, 'restore-merge-1');
    assert.strictEqual(result.payload.summary.totals.upserted, 3);
    assert.strictEqual(result.payload.summary.totals.deleted, 0, 'merge deletes nothing (AC11)');
    assert.strictEqual(result.payload.summary.mode, 'merge');

    // AC10 insertion order: workflows → projects → tasks.
    const iWf = stmtIndexOf(pool, 'INSERT INTO workflows');
    const iP = stmtIndexOf(pool, 'INSERT INTO projects');
    const iT = stmtIndexOf(pool, 'INSERT INTO tasks');
    assert.ok(iWf < iP && iP < iT, `dependency chain violated: ${iWf}, ${iP}, ${iT}`);
    assert.ok(!pool.statements.some((s) => /DELETE FROM/i.test(s.sql)), 'merge mode must never DELETE');

    // PK upsert shape (idempotent by construction, §4.4).
    const wfStmt = pool.statements[iWf];
    assert.match(wfStmt.sql, /ON CONFLICT \(id\) DO UPDATE SET/);
    assert.deepStrictEqual(wfStmt.params, ['wf1', 'nightly']);

    // One transaction per table, all released.
    assert.strictEqual(pool.clients.length, 3);
    assert.ok(pool.statements.filter((s) => s.sql === 'BEGIN').length >= 3);
    assert.ok(pool.statements.every((s) => s.sql !== 'ROLLBACK'));
    for (const c of pool.clients) assert.strictEqual(c.released, true);

    // Checkpoint latched complete.
    const cp = JSON.parse(fs.readFileSync(path.join(dir, 'restore-merge-1.resume.json'), 'utf8'));
    assert.deepStrictEqual(cp.completedTables, ['workflows', 'projects', 'tasks']);
    assert.ok(cp.completedAt, 'completed restores carry completedAt');

    // SSE restore-progress frames per completed table (§4.5).
    assert.deepStrictEqual(frames, [
      { restoreId: 'restore-merge-1', table: 'workflows', doneRows: 1, totalRows: 1 },
      { restoreId: 'restore-merge-1', table: 'projects', doneRows: 1, totalRows: 1 },
      { restoreId: 'restore-merge-1', table: 'tasks', doneRows: 1, totalRows: 1 },
    ]);

    // Duplicate replay executes NOTHING and returns the stored summary.
    const connectsBefore = pool.connectCount;
    const replay = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact, mode: 'merge', restoreId: 'restore-merge-1' }
    );
    assert.strictEqual(replay.status, 200);
    assert.strictEqual(replay.payload.duplicate, true);
    assert.deepStrictEqual(replay.payload.summary, result.payload.summary);
    assert.strictEqual(pool.connectCount, connectsBefore, 'duplicate replay must not touch the database');
    console.log('PASS [14] merge apply: PK upserts, zero deletes, AC10 order, SSE frames, duplicate replay inert (AC10, AC11)');
  }

  // ── [15] Replace apply: reverse-order deletes, then forward upserts ─
  {
    const artifact = buildArtifact({
      workflows: [{ id: 'wf1', name: 'nightly' }],
      projects: [{ id: 'p1', name: 'core' }],
      tasks: [{ id: 't1', title: 'kept' }],
      workflow_runs: [], // empty artifact table → full-table delete branch
    });
    const pool = createFakePool({ migrations: ['001_add_workflow_runs'] });
    const { router } = makeRouter(tempSnapshotsDir());
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact, mode: 'replace', restoreId: 'restore-replace-1' }
    );
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.payload.summary.mode, 'replace');

    // Delete pass runs FIRST, in FK-safe REVERSE dependency order (AC11):
    // workflow_runs → tasks → projects → workflows.
    const dRuns = stmtIndexOf(pool, 'DELETE FROM workflow_runs');
    const dTasks = stmtIndexOf(pool, 'DELETE FROM tasks WHERE id NOT IN');
    const dProjects = stmtIndexOf(pool, 'DELETE FROM projects WHERE id NOT IN');
    const dWorkflows = stmtIndexOf(pool, 'DELETE FROM workflows WHERE id NOT IN');
    assert.ok(dRuns < dTasks && dTasks < dProjects && dProjects < dWorkflows, 'delete pass must run in reverse dependency order');
    assert.match(pool.statements[dRuns].sql, /RETURNING id/, 'delete counts come from RETURNING');

    // Upsert pass afterwards, forward order (AC10 still holds under replace).
    const iWf = stmtIndexOf(pool, 'INSERT INTO workflows');
    const iTasks = stmtIndexOf(pool, 'INSERT INTO tasks');
    assert.ok(dWorkflows < iWf, 'all deletes happen before any upsert');
    assert.ok(iWf < iTasks, 'upsert pass keeps the pinned forward chain');
    assert.ok(pool.statements.every((s) => s.sql !== 'ROLLBACK'));
    console.log('PASS [15] replace apply: reverse-order deletes of absent rows, then forward upserts (AC10, AC11)');
  }

  // ── [16] Apply validation: mode + restoreId ────────────────────────
  {
    const artifact = buildArtifact({ tasks: [{ id: 't1' }] });
    const { router } = makeRouter(tempSnapshotsDir());
    const ctx = createContext({ asanaStorage: { pool: createFakePool({}) } });

    const badMode = await dispatch(router, 'POST', '/api/restore/apply', ctx, { artifact, mode: 'nuke', restoreId: 'r1' });
    assert.strictEqual(badMode.status, 400);
    assert.strictEqual(badMode.payload.error, 'invalid_mode');

    const noId = await dispatch(router, 'POST', '/api/restore/apply', ctx, { artifact, mode: 'merge' });
    assert.strictEqual(noId.status, 400);
    assert.strictEqual(noId.payload.error, 'missing_or_invalid_restore_id');

    const evilId = await dispatch(router, 'POST', '/api/restore/apply', ctx, { artifact, mode: 'merge', restoreId: '../../etc' });
    assert.strictEqual(evilId.status, 400);
    console.log('PASS [16] apply validates mode + restoreId before anything else');
  }

  // ── [17] Apply refuses schema-too-new with zero writes ─────────────
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({ tasks: [{ id: 't1' }] }, { migrations: ['999_future_migration'] });
    const pool = createFakePool({ migrations: ['001_add_workflow_runs'] });
    const { router } = makeRouter(dir);
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool } }),
      { artifact, mode: 'merge', restoreId: 'restore-schema-refused' }
    );
    assert.strictEqual(result.status, 409);
    assert.strictEqual(result.payload.error, 'schema_too_new');
    assert.strictEqual(pool.connectCount, 0, 'refused apply must not open a transaction');
    assert.strictEqual(fs.readdirSync(dir).length, 0, 'refused apply must not write a checkpoint');
    console.log('PASS [17] apply refuses schema_too_new 409 with zero writes (§4.3)');
  }

  // ── [18] Checkpoint resume after mid-table crash (AC6) ─────────────
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({
      workflows: [{ id: 'wf1', name: 'n' }],
      projects: [{ id: 'p1', name: 'c' }],
      tasks: [{ id: 't1', title: 't' }],
      workflow_steps: [{ id: 's1', workflow_run_id: 'r1' }],
    });

    // Attempt 1: workflow_steps transaction explodes mid-apply.
    const failingPool = createFakePool({
      migrations: ['001_add_workflow_runs'],
      failClientQuery: (sql) => sql.includes('INSERT INTO workflow_steps'),
    });
    const { router: routerA } = makeRouter(dir);
    const failed = await dispatch(
      routerA,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool: failingPool } }),
      { artifact, mode: 'merge', restoreId: 'restore-resume-1' }
    );
    assert.strictEqual(failed.status, 500);
    assert.strictEqual(failed.payload.error, 'restore_failed');
    assert.ok(failingPool.statements.some((s) => s.sql === 'ROLLBACK'), 'crashed table rolls back entirely');
    const cpAfterCrash = JSON.parse(fs.readFileSync(path.join(dir, 'restore-resume-1.resume.json'), 'utf8'));
    assert.deepStrictEqual(cpAfterCrash.completedTables, ['workflows', 'projects', 'tasks'], 'prior tables committed + checkpointed');
    assert.strictEqual(cpAfterCrash.completedTables.includes('workflow_steps'), false);
    assert.strictEqual(cpAfterCrash.lastError, 'transaction write failed');

    // Attempt 2: same restoreId resumes — completed tables skipped, crashed
    // table re-applied from scratch.
    const resumePool = createFakePool({ migrations: ['001_add_workflow_runs'] });
    const { router: routerB } = makeRouter(dir);
    const resumed = await dispatch(
      routerB,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool: resumePool } }),
      { artifact, mode: 'merge', restoreId: 'restore-resume-1' }
    );
    assert.strictEqual(resumed.status, 200);
    assert.strictEqual(resumed.payload.resumed, true);
    assert.strictEqual(resumed.payload.duplicate, false);
    assert.strictEqual(resumePool.statements.some((s) => s.sql.includes('INSERT INTO workflows')), false, 'completed tables skipped');
    assert.strictEqual(resumePool.statements.some((s) => s.sql.includes('INSERT INTO projects')), false, 'completed tables skipped');
    assert.strictEqual(resumePool.statements.some((s) => s.sql.includes('INSERT INTO tasks')), false, 'completed tables skipped');
    stmtIndexOf(resumePool, 'INSERT INTO workflow_steps');
    assert.ok(resumePool.statements.some((s) => s.sql === 'COMMIT'));
    assert.strictEqual(resumed.payload.summary.totals.upserted, 1, 'only the resumed table reports fresh upserts');

    // Attempt 3: completed restore replays as duplicate, executing nothing.
    const connectsBefore = resumePool.connectCount;
    const dup = await dispatch(
      routerB,
      'POST',
      '/api/restore/apply',
      createContext({ asanaStorage: { pool: resumePool } }),
      { artifact, mode: 'merge', restoreId: 'restore-resume-1' }
    );
    assert.strictEqual(dup.status, 200);
    assert.strictEqual(dup.payload.duplicate, true);
    assert.deepStrictEqual(dup.payload.summary, resumed.payload.summary);
    assert.strictEqual(resumePool.connectCount, connectsBefore);
    console.log('PASS [18] checkpoint resume: crashed table re-applies, completed skipped, duplicate inert (AC6)');
  }

  // ── [19] Apply degradation: 503 zero writes, no checkpoint file ────
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({ tasks: [{ id: 't1' }] });
    const { router } = makeRouter(dir);
    const result = await dispatch(
      router,
      'POST',
      '/api/restore/apply',
      createContext(),
      { artifact, mode: 'merge', restoreId: 'restore-no-db' }
    );
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.payload.available, false);
    assert.strictEqual(result.payload.reason, 'no_database');
    assert.strictEqual(fs.readdirSync(dir).length, 0, 'degraded apply must write nothing (AC7)');

    const preview = await dispatch(
      router,
      'POST',
      '/api/restore/preview',
      createContext(),
      { artifact }
    );
    assert.strictEqual(preview.status, 503);
    assert.strictEqual(preview.payload.available, false);
    console.log('PASS [19] preview/apply degrade 503 {available:false} with zero writes (AC7)');
  }

  // ── [20] Registry + download keep working without PostgreSQL (AC7) ─
  {
    const dir = tempSnapshotsDir();
    const artifact = buildArtifact({ tasks: [{ id: 't1' }] }, { name: 'disk-only' });
    fs.writeFileSync(path.join(dir, `${artifact.manifest.snapshot_id}.json`), JSON.stringify(artifact));
    const { router } = makeRouter(dir);
    const listed = await dispatch(router, 'GET', '/api/snapshots', createContext());
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.payload.count, 1);
    const dl = await dispatch(router, 'GET', `/api/snapshots/${artifact.manifest.snapshot_id}/download`, createContext());
    assert.strictEqual(dl.status, 200);
    assert.deepStrictEqual(dl.payload, artifact);
    console.log('PASS [20] registry + download serve from disk with no database (AC7)');
  }

  // ── [21] Pinned TABLE_ORDER head (AC10 anchor) ─────────────────────
  {
    const head = ['workflows', 'projects', 'tasks', 'workflow_runs', 'workflow_steps', 'workflow_approvals', 'workflow_artifacts'];
    assert.deepStrictEqual(TABLE_ORDER.slice(0, 7), head, 'brief-pinned dependency-chain head');
    assert.strictEqual(TABLE_ORDER.length, 23, 'all §2.1 tiers captured');
    console.log('PASS [21] TABLE_ORDER pins the brief dependency chain + all §2.1 tables');
  }

  fs.rmSync(snapshotsDir, { recursive: true, force: true });
  console.log('\ntest-snapshot-routes: all tests passed');
}

run()
  .catch((err) => {
    console.error('test-snapshot-routes failed:', err);
    process.exit(1);
  });
