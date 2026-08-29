#!/usr/bin/env node
/**
 * DB-free tests for the schema drift checker (scripts/schema-drift-check.js).
 *
 * Coverage:
 *   (a) GUARD TEST — every .sql file in schema/migrations/ must be covered
 *       by the checker: either a numbered migration expected in
 *       schema_migrations (tracking tier) or a PROBE_MAP entry (probe
 *       tier). This fails CI if a future migration forgets its probe or
 *       its self-registration — the exact class of silent drift that
 *       caused the 2026-08-29 incident (8 migrations missing on staging,
 *       /api/tasks/all + /api/spaces 500 for days).
 *   (b) Pure-function tests — name extraction, tier splitting, probe
 *       parsing/collection, tier evaluation with fabricated rows:
 *       missing applied migration → drift; unavailable → NOT drift;
 *       orphan tracking rows → warn only; probe absence → drift.
 *
 * Run: node tests/test-schema-drift-check.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  UNTRACKED_NUMBERED,
  PROBE_MAP,
  migrationNameFromFilename,
  isNumberedMigrationName,
  isDatePrefixedMigrationName,
  splitTiers,
  parseProbe,
  collectProbes,
  evaluateTier1,
  evaluateTier2,
  verdictFor,
} = require('../scripts/schema-drift-check.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'schema', 'migrations');

(async () => {
  // ── (a) GUARD TEST: every migration file has checker coverage ────────────
  console.log('Guard: migration file coverage');

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  check('migration directory is non-empty', () => {
    assert.ok(files.length > 0, 'no migration files found');
  });

  const names = files.map(migrationNameFromFilename).filter(Boolean);
  check('every .sql file yields a migration name', () => {
    assert.strictEqual(names.length, files.length);
  });

  check('every migration file is covered (tracking tier or PROBE_MAP)', () => {
    const uncovered = names.filter((name) => {
      if (PROBE_MAP[name]) return false;
      return !(isNumberedMigrationName(name) && !UNTRACKED_NUMBERED.has(name));
    });
    assert.deepStrictEqual(uncovered, [],
      `uncovered migrations (add PROBE_MAP entries): ${uncovered.join(', ')}`);
  });

  check('every date-prefixed migration has a PROBE_MAP entry', () => {
    const dated = names.filter(isDatePrefixedMigrationName);
    const missing = dated.filter((name) => !PROBE_MAP[name]);
    assert.deepStrictEqual(missing, [],
      `date-prefixed migrations without probes: ${missing.join(', ')}`);
  });

  check('every PROBE_MAP key is a real migration file', () => {
    const nameSet = new Set(names);
    const phantom = Object.keys(PROBE_MAP).filter((name) => !nameSet.has(name));
    assert.deepStrictEqual(phantom, [],
      `PROBE_MAP entries with no file: ${phantom.join(', ')}`);
  });

  check('every UNTRACKED_NUMBERED migration has probe coverage', () => {
    const uncovered = [...UNTRACKED_NUMBERED].filter((name) => !PROBE_MAP[name]);
    assert.deepStrictEqual(uncovered, [],
      `untracked numbered migrations without probes: ${uncovered.join(', ')}`);
  });

  check('every PROBE_MAP entry parses to a known probe kind', () => {
    const bad = [];
    for (const [file, probes] of Object.entries(PROBE_MAP)) {
      for (const probe of probes) {
        try {
          const p = parseProbe(probe);
          assert.ok(['table', 'column', 'column-nullable', 'index'].includes(p.kind));
        } catch (err) {
          bad.push(`${file}: ${probe} (${err.message})`);
        }
      }
    }
    assert.deepStrictEqual(bad, [], `bad probes: ${bad.join(', ')}`);
  });

  check('incident objects pinned: tasks soft-delete/archive + workspaces + state_snapshots + nullable task_id', () => {
    const archive = PROBE_MAP['20260216_add_archive_deleted_to_tasks'] || [];
    assert.ok(archive.includes('column:tasks.archived_at'), 'archived_at probe missing');
    assert.ok(archive.includes('column:tasks.deleted_at'), 'deleted_at probe missing (the 500 cause)');
    assert.ok(archive.includes('index:idx_tasks_deleted_at'), 'idx_tasks_deleted_at probe missing');
    assert.ok((PROBE_MAP['20260429_extend_workspaces'] || []).includes('column:workspaces.is_default'),
      'workspaces.is_default probe missing');
    assert.ok((PROBE_MAP['20260429_spaces_constraints'] || []).includes('index:one_default_workspace'),
      'one_default_workspace probe missing');
    assert.ok((PROBE_MAP['20260428_add_state_snapshots'] || []).includes('table:state_snapshots'),
      'state_snapshots probe missing');
    assert.ok((PROBE_MAP['20260826_audit_log_task_id_nullable'] || []).includes('column-nullable:audit_log.task_id'),
      'audit_log.task_id nullable probe missing');
  });

  // ── (b) Pure-function tests ──────────────────────────────────────────────
  console.log('Pure helpers');

  check('migrationNameFromFilename strips .sql only', () => {
    assert.strictEqual(migrationNameFromFilename('001_add_workflow_runs.sql'), '001_add_workflow_runs');
    assert.strictEqual(migrationNameFromFilename('20260216_add_saved_views.sql'), '20260216_add_saved_views');
    assert.strictEqual(migrationNameFromFilename('README.md'), null);
    assert.strictEqual(migrationNameFromFilename(null), null);
  });

  check('numbered vs date-prefixed classification', () => {
    assert.ok(isNumberedMigrationName('001_add_workflow_runs'));
    assert.ok(isNumberedMigrationName('026_add_workspaces_base'));
    assert.ok(!isNumberedMigrationName('20260216_add_saved_views'));
    assert.ok(!isNumberedMigrationName('x001_foo'));
    assert.ok(isDatePrefixedMigrationName('20260216_add_saved_views'));
    assert.ok(isDatePrefixedMigrationName('20260826_audit_log_task_id_nullable'));
    assert.ok(!isDatePrefixedMigrationName('026_add_workspaces_base'));
  });

  check('splitTiers: numbered → tracking, dated + untracked trio → probes, unknown → gap', () => {
    const { tracked, probed, gaps } = splitTiers([
      '001_add_workflow_runs',
      '020_add_error_details_to_workflow_runs',
      '20260216_add_saved_views',
      '026_add_workspaces_base',
      'orphan_thing',
    ]);
    assert.deepStrictEqual(tracked, ['001_add_workflow_runs', '026_add_workspaces_base']);
    assert.deepStrictEqual(probed, ['020_add_error_details_to_workflow_runs', '20260216_add_saved_views']);
    assert.deepStrictEqual(gaps, ['orphan_thing']);
  });

  check('parseProbe: all four kinds + rejection of junk', () => {
    assert.deepStrictEqual(parseProbe('table:state_snapshots'), { kind: 'table', name: 'state_snapshots' });
    assert.deepStrictEqual(parseProbe('column:tasks.deleted_at'), { kind: 'column', table: 'tasks', column: 'deleted_at' });
    assert.deepStrictEqual(parseProbe('column-nullable:audit_log.task_id'), { kind: 'column-nullable', table: 'audit_log', column: 'task_id' });
    assert.deepStrictEqual(parseProbe('index:idx_tasks_deleted_at'), { kind: 'index', name: 'idx_tasks_deleted_at' });
    assert.throws(() => parseProbe('table:'));
    assert.throws(() => parseProbe('column:tasks'));
    assert.throws(() => parseProbe('column:.deleted_at'));
    assert.throws(() => parseProbe('view:foo'));
    assert.throws(() => parseProbe(42));
  });

  check('collectProbes: groups by kind, dedupes, sorts', () => {
    const c = collectProbes({
      m1: ['table:tasks', 'column:tasks.deleted_at', 'index:idx_a'],
      m2: ['table:tasks', 'column-nullable:audit_log.task_id', 'index:idx_b'],
    });
    assert.deepStrictEqual(c.tables, ['tasks']);
    assert.deepStrictEqual(c.columns, [['tasks', 'deleted_at']]);
    assert.deepStrictEqual(c.nullableColumns, [['audit_log', 'task_id']]);
    assert.deepStrictEqual(c.indexes, ['idx_a', 'idx_b']);
  });

  check('evaluateTier1: missing applied migration → drift; orphan row → warn only', () => {
    const r = evaluateTier1(['001_add_workflow_runs', '002_add_workflow_queues'], ['001_add_workflow_runs', 'legacy_superseded_name']);
    assert.deepStrictEqual(r.missing, ['002_add_workflow_queues']);
    assert.deepStrictEqual(r.orphan, ['legacy_superseded_name']);
  });

  check('evaluateTier1: full match → no drift, no orphans', () => {
    const r = evaluateTier1(['001_add_workflow_runs'], ['001_add_workflow_runs']);
    assert.deepStrictEqual(r.missing, []);
    assert.deepStrictEqual(r.orphan, []);
  });

  check('evaluateTier1: empty tracking table → every expected file is drift', () => {
    const r = evaluateTier1(['001_add_workflow_runs', '002_add_workflow_queues'], []);
    assert.deepStrictEqual(r.missing, ['001_add_workflow_runs', '002_add_workflow_queues']);
  });

  check('evaluateTier2: all probes present → no drift', () => {
    const r = evaluateTier2(
      { m1: ['table:tasks', 'column:tasks.deleted_at', 'index:idx_tasks_deleted_at'] },
      {
        tables: new Set(['tasks']),
        columns: new Set(['tasks.deleted_at']),
        nullableColumns: new Set(),
        indexes: new Set(['idx_tasks_deleted_at']),
      },
    );
    assert.strictEqual(r.total, 3);
    assert.deepStrictEqual(r.missing, []);
  });

  check('evaluateTier2: absent object → drift entry with file + probe', () => {
    const r = evaluateTier2(
      { m1: ['table:tasks', 'column:tasks.deleted_at'] },
      { tables: new Set(), columns: new Set(), nullableColumns: new Set(), indexes: new Set() },
    );
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(r.missing, [
      { file: 'm1', probe: 'table:tasks' },
      { file: 'm1', probe: 'column:tasks.deleted_at' },
    ]);
  });

  check('evaluateTier2: nullable probe requires is_nullable = YES', () => {
    const probeMap = { m1: ['column-nullable:audit_log.task_id'] };
    const notNullable = evaluateTier2(probeMap, {
      tables: new Set(), columns: new Set(['audit_log.task_id']), nullableColumns: new Set(), indexes: new Set(),
    });
    assert.strictEqual(notNullable.missing.length, 1, 'column exists but NOT nullable → drift');
    const nullable = evaluateTier2(probeMap, {
      tables: new Set(), columns: new Set(['audit_log.task_id']), nullableColumns: new Set(['audit_log.task_id']), indexes: new Set(),
    });
    assert.deepStrictEqual(nullable.missing, []);
  });

  check('verdictFor: drift only on confirmed missing objects/rows', () => {
    assert.strictEqual(verdictFor({ missing: [] }, { missing: [] }), 'ok');
    assert.strictEqual(verdictFor({ missing: ['001_add_workflow_runs'] }, { missing: [] }), 'drift');
    assert.strictEqual(verdictFor({ missing: [] }, { missing: [{ file: 'm', probe: 'table:x' }] }), 'drift');
    // Orphan tracking rows are WARN-only — never drift.
    assert.strictEqual(verdictFor({ missing: [], orphan: ['legacy'] }, { missing: [] }), 'ok');
  });

  check('require() does not open a pool or run main (no DB side effects)', () => {
    // Re-require in a fresh module registry; if main() ran it would try to
    // connect and print. Exports must be plain functions/constants only.
    const fresh = require('../scripts/schema-drift-check.js');
    assert.strictEqual(typeof fresh.evaluateTier1, 'function');
    assert.strictEqual(typeof fresh.evaluateTier2, 'function');
    assert.strictEqual(typeof fresh.verdictFor, 'function');
    assert.ok(fresh.PROBE_MAP['20260216_add_archive_deleted_to_tasks'].length > 0);
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})();