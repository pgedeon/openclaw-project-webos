#!/usr/bin/env node
/**
 * Focused tests for the settings-view Snapshots & Restore panel's pure
 * helpers (src/shell/native-views/snapshot-panel-helpers.mjs) — slice 3 of
 * docs/briefs/snapshot-restore.md, DB-free per the work order.
 *
 * Covered:
 * - formatBytes: honest byte formatting (R2) incl. unknown/negative/units.
 * - formatTimestamp + defaultSnapshotName (§3.1 snapshot-YYYYMMDD-HHmm).
 * - verdictToBadge: ok/target_newer/too_new/unknown mapping (§4.3).
 * - warningLines: target_newer / active_runs / settings_section_dropped +
 *   unknown-code passthrough (§3.2 step 2).
 * - previewGridRows: normalization, busiest-first ordering, PK samples,
 *   per-table error passthrough.
 * - describeApplyResult: fresh vs resumed vs duplicate endings (§4.4/R5)
 *   incl. settings-dropped line and totals.
 * - progressPercent: determinate math + indeterminate null without preview
 *   (resume-after-refresh reattach), clamping.
 *
 * Run: node tests/test-snapshot-panel.js
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

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

async function loadHelpers() {
  return import(pathToFileURL(path.join(__dirname, '..', 'src', 'shell', 'native-views', 'snapshot-panel-helpers.mjs')).href);
}

(async () => {
  const H = await loadHelpers();

  console.log('\nformatBytes');
  await check('bytes under 1 KB stay raw', () => {
    assert.strictEqual(H.formatBytes(0), '0 B');
    assert.strictEqual(H.formatBytes(512), '512 B');
    assert.strictEqual(H.formatBytes(1023), '1023 B');
  });
  await check('KB/MB/GB ladder with one decimal (two above 100)', () => {
    assert.strictEqual(H.formatBytes(1536), '1.5 KB');
    assert.strictEqual(H.formatBytes(1024 * 1024 * 3.3), '3.3 MB');
    assert.strictEqual(H.formatBytes(1024 ** 3), '1.0 GB');
    assert.strictEqual(H.formatBytes(1024 ** 3 * 150), '150 GB');
  });
  await check('unknown values render as em dash, never fake zero', () => {
    assert.strictEqual(H.formatBytes(null), '—');
    assert.strictEqual(H.formatBytes(undefined), '—');
    assert.strictEqual(H.formatBytes(-4), '—');
    assert.strictEqual(H.formatBytes('not-a-number'), '—');
  });

  console.log('\nformatTimestamp / defaultSnapshotName');
  await check('ISO → local YYYY-MM-DD HH:mm; falsy → —; garbage echoes back', () => {
    const d = new Date(2026, 7, 24, 22, 5); // local 2026-08-24 22:05
    assert.strictEqual(H.formatTimestamp(d.toISOString()), '2026-08-24 22:05');
    assert.strictEqual(H.formatTimestamp(null), '—');
    assert.strictEqual(H.formatTimestamp(undefined), '—');
    assert.strictEqual(H.formatTimestamp('not-a-date'), 'not-a-date');
  });
  await check('defaultSnapshotName matches snapshot-YYYYMMDD-HHmm (§3.1)', () => {
    const d = new Date(2026, 7, 24, 9, 7);
    assert.strictEqual(H.defaultSnapshotName(d), 'snapshot-20260824-0907');
    assert.match(H.defaultSnapshotName(new Date()), /^snapshot-\d{8}-\d{4}$/);
  });

  console.log('\nverdictToBadge');
  await check('ok/target_newer/too_new map to ok/warn/error tones (§4.3)', () => {
    assert.deepStrictEqual(
      { tone: H.verdictToBadge('ok').tone, label: H.verdictToBadge('ok').label },
      { tone: 'ok', label: 'schema compatible' }
    );
    assert.strictEqual(H.verdictToBadge('target_newer').tone, 'warn');
    assert.strictEqual(H.verdictToBadge('too_new').tone, 'error');
  });
  await check('unknown/absent verdict → explicit neutral "not checked"', () => {
    for (const v of [undefined, null, '', 'weird']) {
      const b = H.verdictToBadge(v);
      assert.strictEqual(b.tone, 'neutral');
      assert.strictEqual(b.label, 'not checked');
    }
  });

  console.log('\nwarningLines');
  await check('known codes get human lines', () => {
    const lines = H.warningLines(['target_newer', 'active_runs']);
    assert.ok(lines[0].includes('newer'));
    assert.ok(lines[1].toLowerCase().includes('active workflow runs'));
  });
  await check('settings_section_dropped + unknown code passthrough + non-array', () => {
    const lines = H.warningLines(['settings_section_dropped', 'mystery_code']);
    assert.ok(lines[0].includes('Settings section dropped'));
    assert.strictEqual(lines[1], 'mystery_code');
    assert.deepStrictEqual(H.warningLines(undefined), []);
  });

  console.log('\npreviewGridRows');
  const PREVIEW = {
    tables: {
      tasks: { added: 2, updated: 1, conflicts: 3, unchanged: 40, added_pks: ['t-9'], conflict_pks: ['t-1', 't-2'] },
      agent_heartbeats: { added: 0, updated: 0, conflicts: 0, unchanged: 900 },
      audit_log: { added: 5, updated: 0, conflicts: 0, unchanged: 10 },
      broken_table: { error: 'relation does not exist' },
    },
  };
  await check('busiest table first, ties alphabetical, errors ride along', () => {
    const rows = H.previewGridRows(PREVIEW);
    assert.deepStrictEqual(rows.map((r) => r.name),
      ['tasks', 'audit_log', 'agent_heartbeats', 'broken_table']);
    const broken = rows.find((r) => r.name === 'broken_table');
    assert.strictEqual(broken.error, 'relation does not exist');
    assert.strictEqual(broken.added, 0);
  });
  await check('PK samples normalized to strings', () => {
    const rows = H.previewGridRows(PREVIEW);
    const tasks = rows.find((r) => r.name === 'tasks');
    assert.deepStrictEqual(tasks.conflict_pks, ['t-1', 't-2']);
    assert.deepStrictEqual(tasks.added_pks, ['t-9']);
  });
  await check('missing/null preview degrades to empty grid, never throws', () => {
    assert.deepStrictEqual(H.previewGridRows(null), []);
    assert.deepStrictEqual(H.previewGridRows({}), []);
    assert.deepStrictEqual(H.previewGridRows({ tables: null }), []);
  });

  console.log('\ndescribeApplyResult');
  const SUMMARY = {
    restoreId: 'r-1',
    duplicate: false,
    resumed: false,
    summary: {
      mode: 'merge',
      totals: { upserted: 120, deleted: 0 },
      settings: { applied: 14, dropped_section: false },
    },
  };
  await check('fresh apply headline + totals + settings line', () => {
    const out = H.describeApplyResult(SUMMARY);
    assert.strictEqual(out.kind, 'fresh');
    assert.strictEqual(out.headline, 'Restore complete');
    assert.ok(out.lines.some((l) => l.includes('rows upserted 120')));
    assert.ok(out.lines.some((l) => l.includes('Settings applied: 14')));
  });
  await check('resumed apply says so explicitly (R5)', () => {
    const out = H.describeApplyResult({ ...SUMMARY, resumed: true });
    assert.strictEqual(out.kind, 'resumed');
    assert.strictEqual(out.headline, 'Restore resumed — completed');
    assert.ok(out.lines.some((l) => l.includes('Resumed from checkpoint')));
  });
  await check('duplicate replay executes nothing and says so (§4.4)', () => {
    const out = H.describeApplyResult({ ...SUMMARY, duplicate: true });
    assert.strictEqual(out.kind, 'duplicate');
    assert.strictEqual(out.headline, 'Already completed');
    assert.ok(out.lines[0].includes('nothing was executed'));
  });
  await check('dropped settings section surfaces with key count (§5.3)', () => {
    const out = H.describeApplyResult({
      summary: { mode: 'replace', totals: {}, settings: { applied: 0, dropped_section: true, skipped_keys: 3 } },
    });
    assert.ok(out.lines.some((l) => l.includes('dropped') && l.includes('3')));
  });
  await check('empty/garbage payload degrades without throwing', () => {
    const out = H.describeApplyResult({});
    assert.strictEqual(out.kind, 'fresh');
    assert.ok(Array.isArray(out.lines));
  });

  console.log('\nprogressPercent');
  await check('determinate math from completed vs expected tables', () => {
    assert.strictEqual(H.progressPercent(0, 23), 0);
    assert.strictEqual(H.progressPercent(11.5, 23), 50);
    assert.strictEqual(H.progressPercent(23, 23), 100);
  });
  await check('no preview (resume-after-refresh reattach) → null = indeterminate', () => {
    assert.strictEqual(H.progressPercent(3, undefined), null);
    assert.strictEqual(H.progressPercent(3, 0), null);
    assert.strictEqual(H.progressPercent(3, NaN), null);
  });
  await check('clamps over-completion from late frames', () => {
    assert.strictEqual(H.progressPercent(99, 23), 100);
    assert.strictEqual(H.progressPercent(-2, 23), 0);
  });

  console.log('\nRESTORE_MAX_BYTES_DEFAULT');
  await check('client cap mirror is exactly 100 MB (AC9 default)', () => {
    assert.strictEqual(H.RESTORE_MAX_BYTES_DEFAULT, 100 * 1024 * 1024);
  });

  console.log('\nroute-order integration (slice-3 regression)');
  await check('snapshot-routes own /api/snapshots* when registered first (task-server order)', async () => {
    const { pathToFileURL: p2u } = require('url');
    const Router = (await import(p2u(path.join(__dirname, '..', 'routes', 'router.js')).href)).default;
    const { registerSnapshotRoutes } = require('../routes/snapshot-routes');
    const { registerHistoryRoutes } = require('../routes/history-routes');

    const router = new Router();
    // EXACT task-server.js registration order (slice-3 fix).
    registerSnapshotRoutes(router, {
      snapshotsDir: path.join(__dirname, 'fixtures', 'no-such-snapshots-dir'),
      settingsStore: null,
    });
    registerHistoryRoutes(router, { pool: null });

    const ctx = { sendJSON: (res, status, payload) => { res.status = status; res.payload = payload; } };
    const res = () => ({ status: 0, payload: null });
    const handle = (r, url, method) => router.handle({ url }, r, url, method, ctx);

    // Bare GET /api/snapshots → disk registry shape, NOT history's DB gate.
    let r = res();
    await handle(r, '/api/snapshots', 'GET');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.payload.available, true);
    assert.ok(Array.isArray(r.payload.snapshots));

    // Download route reachable (history's :entityType/:entityId must not shadow it).
    r = res();
    await handle(r, '/api/snapshots/does-not-exist/download', 'GET');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.payload.error, 'snapshot_not_found');

    // POST create without a pool → snapshot-routes' degradation contract.
    r = res();
    await handle(r, '/api/snapshots', 'POST');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.payload.available, false);

    // Time Travel entity listing still resolves — to history's handler.
    r = res();
    await handle(r, '/api/snapshots/project/project-1', 'GET');
    assert.strictEqual(r.status, 503); // pool:null → history's named DB-gate error
    assert.match(r.payload.error, /Database not available/);

    // Alias serves the Time Travel listing when a pool exists.
    const calls = [];
    const router2 = new Router();
    registerSnapshotRoutes(router2, { snapshotsDir: path.join(__dirname, 'fixtures', 'no-such-snapshots-dir'), settingsStore: null });
    registerHistoryRoutes(router2, { get pool() { return { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 's1' }] }; } }; } });
    r = res();
    // task-server strips the query before dispatch (req.url.split('?')[0]);
    // handlers read req.url themselves for limit parsing.
    await router2.handle({ url: '/api/state-snapshots?limit=7' }, r, '/api/state-snapshots', 'GET', ctx);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.payload, { snapshots: [{ id: 's1' }], total: 1 });
    assert.match(calls[0].sql, /state_snapshots/);
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})();
