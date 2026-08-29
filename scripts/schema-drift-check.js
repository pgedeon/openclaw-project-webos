#!/usr/bin/env node
/**
 * schema-drift-check.js
 *
 * Schema drift guard for the dashboard PostgreSQL instance — the tool that
 * would have caught the 2026-08-29 incident: the staging DB (pg-livefire
 * container, openclaw_dashboard) was silently missing 8 migrations that
 * exist in schema/migrations/. GET /api/tasks/all 500'd for days
 * ("column t.deleted_at does not exist") and /api/spaces 500'd ("relation
 * workspaces does not exist"); nobody noticed until MCP adoption telemetry
 * showed list_tasks erroring 8/8.
 *
 * TWO-TIER DESIGN (why a single tracking-table comparison is not enough):
 *   Tier 1 — tracking table: SELECT migration_name FROM schema_migrations
 *     compared against the NUMBERED migration files (NNN_*.sql). The table
 *     only ever contains numbered migrations; the DATE-prefixed files
 *     (2026*.sql) were never inserted into schema_migrations even on correct
 *     databases, so a tracking-table-only comparison false-positives on
 *     every healthy DB.
 *   Tier 2 — object probes: each date-prefixed migration (plus the three
 *     numbered files 020/021/022, which predate the self-registration
 *     convention and are also absent from schema_migrations on healthy DBs)
 *     maps to concrete object probes resolved via information_schema /
 *     pg_indexes. A probe is present only if the object the migration
 *     creates actually exists in the live database.
 *
 * EXIT-CODE CONTRACT (same house contract as dag-telemetry-counter.js and
 * mcp-adoption-counter.js): any database-layer failure (unreachable
 * PostgreSQL, missing database, missing schema_migrations table, auth
 * failure) prints an HONEST unavailable message and exits 0 — unavailable
 * is NEVER reported as zero drift. Exit 1 ONLY on confirmed drift (a
 * migration file whose objects/tracking row are missing from the DB).
 *
 * Zero new dependencies: uses the already-required `pg` package and the
 * same POSTGRES_* environment variables as scripts/dashboard-validation.js.
 *
 * Usage:
 *   node scripts/schema-drift-check.js
 *   npm run db:drift-check
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'schema', 'migrations');

/**
 * Numbered migrations that are NOT expected in schema_migrations even on a
 * healthy database. 020/021/022 predate the self-registration convention
 * (006-015 and 023+ INSERT their own tracking row; 001-004 are registered
 * by 005) and were applied without tracking rows everywhere. They are
 * verified by Tier-2 object probes instead — see PROBE_MAP.
 */
const UNTRACKED_NUMBERED = new Set([
  '020_add_error_details_to_workflow_runs',
  '021_add_workflow_agent_routing',
  '022_add_run_token_cost_tracking',
]);

/**
 * Probe syntax (one string per object a migration must have created):
 *   table:<name>                 — information_schema.tables
 *   column:<table>.<column>      — information_schema.columns
 *   column-nullable:<t>.<c>      — information_schema.columns AND is_nullable = 'YES'
 *   index:<name>                 — pg_indexes
 *
 * Every date-prefixed migration file MUST have an entry here (enforced by
 * tests/test-schema-drift-check.js guard test), plus the untracked numbered
 * trio above. Object names pinned from the migration files themselves.
 */
const PROBE_MAP = {
  '20260216_add_agent_observability': [
    'table:agent_heartbeats',
    'table:task_runs',
    'column:tasks.retry_count',
  ],
  '20260216_add_archive_deleted_to_tasks': [
    'column:tasks.archived_at',
    'column:tasks.deleted_at',
    'index:idx_tasks_deleted_at',
  ],
  '20260216_add_audit_log_search_indexes': [
    'index:idx_audit_log_action',
    'index:idx_audit_log_actor_action',
  ],
  '20260216_add_cron_job_runs': [
    'table:cron_job_runs',
  ],
  '20260216_add_saved_views': [
    'table:saved_views',
  ],
  '20260216_add_updated_at_index_to_tasks': [
    'index:idx_tasks_updated_at',
  ],
  '20260428_add_state_snapshots': [
    'table:state_snapshots',
    'column:audit_log.entity_type',
  ],
  '20260429_extend_workspaces': [
    'column:workspaces.icon',
    'column:workspaces.is_default',
  ],
  '20260429_spaces_constraints': [
    'index:one_default_workspace',
  ],
  '20260826_audit_log_task_id_nullable': [
    'column-nullable:audit_log.task_id',
  ],
  '020_add_error_details_to_workflow_runs': [
    'column:workflow_runs.error_details',
  ],
  '021_add_workflow_agent_routing': [
    'table:workflow_agent_routing',
  ],
  '022_add_run_token_cost_tracking': [
    'column:workflow_runs.input_tokens',
  ],
};

// ── Pure helpers (exported for DB-free tests) ──────────────────────────────

/** '001_add_workflow_runs.sql' → '001_add_workflow_runs'; non-.sql → null. */
function migrationNameFromFilename(filename) {
  if (typeof filename !== 'string' || !filename.endsWith('.sql')) return null;
  return filename.slice(0, -'.sql'.length);
}

/** Numbered migrations are NNN_*.sql (three leading digits + underscore). */
function isNumberedMigrationName(name) {
  return /^\d{3}_/.test(name);
}

/** Date-prefixed migrations are YYYYMMDD_*.sql (eight leading digits). */
function isDatePrefixedMigrationName(name) {
  return /^\d{8}_/.test(name);
}

/**
 * Split migration names into the two tiers:
 *   tracked  — numbered migrations expected in schema_migrations
 *              (numbered minus the UNTRACKED_NUMBERED trio)
 *   probed   — migrations verified via PROBE_MAP object probes
 * A name in PROBE_MAP always lands in `probed`, even if numbered.
 * A name in neither tier is a CHECKER GAP (the guard test forbids it).
 */
function splitTiers(names) {
  const tracked = [];
  const probed = [];
  const gaps = [];
  for (const name of names) {
    if (PROBE_MAP[name]) {
      probed.push(name);
    } else if (isNumberedMigrationName(name) && !UNTRACKED_NUMBERED.has(name)) {
      tracked.push(name);
    } else {
      gaps.push(name);
    }
  }
  tracked.sort();
  probed.sort();
  return { tracked, probed, gaps };
}

/**
 * Parse one probe string → {kind, table, column, name}.
 * Throws on unknown syntax — the guard test pins every PROBE_MAP entry,
 * so a throw here means a checker bug, not a DB condition.
 */
function parseProbe(probe) {
  if (typeof probe !== 'string') throw new Error(`probe not a string: ${probe}`);
  if (probe.startsWith('table:')) {
    const name = probe.slice('table:'.length);
    if (!name) throw new Error(`empty table probe: ${probe}`);
    return { kind: 'table', name };
  }
  if (probe.startsWith('column-nullable:')) {
    const ref = probe.slice('column-nullable:'.length);
    const dot = ref.indexOf('.');
    if (dot <= 0 || dot === ref.length - 1) throw new Error(`bad column-nullable probe: ${probe}`);
    return { kind: 'column-nullable', table: ref.slice(0, dot), column: ref.slice(dot + 1) };
  }
  if (probe.startsWith('column:')) {
    const ref = probe.slice('column:'.length);
    const dot = ref.indexOf('.');
    if (dot <= 0 || dot === ref.length - 1) throw new Error(`bad column probe: ${probe}`);
    return { kind: 'column', table: ref.slice(0, dot), column: ref.slice(dot + 1) };
  }
  if (probe.startsWith('index:')) {
    const name = probe.slice('index:'.length);
    if (!name) throw new Error(`empty index probe: ${probe}`);
    return { kind: 'index', name };
  }
  throw new Error(`unknown probe syntax: ${probe}`);
}

/**
 * Group all probes of a PROBE_MAP into the four batch queries the checker
 * runs. Returns { tables: [names], columns: [[table, column]...],
 * nullableColumns: [[table, column]...], indexes: [names] }.
 */
function collectProbes(probeMap) {
  const tables = [];
  const columns = [];
  const nullableColumns = [];
  const indexes = [];
  for (const [file, probes] of Object.entries(probeMap)) {
    for (const probe of probes) {
      const p = parseProbe(probe);
      if (p.kind === 'table') tables.push(p.name);
      else if (p.kind === 'column') columns.push([p.table, p.column]);
      else if (p.kind === 'column-nullable') nullableColumns.push([p.table, p.column]);
      else if (p.kind === 'index') indexes.push(p.name);
    }
  }
  return {
    tables: [...new Set(tables)].sort(),
    columns: [...new Set(columns.map(([t, c]) => `${t}.${c}`))].sort().map((ref) => ref.split('.')),
    nullableColumns: [...new Set(nullableColumns.map(([t, c]) => `${t}.${c}`))].sort().map((ref) => ref.split('.')),
    indexes: [...new Set(indexes)].sort(),
  };
}

/**
 * Tier 1 evaluation: expected tracking rows vs applied rows.
 *   missing — file exists but no schema_migrations row → DRIFT
 *   orphan  — row exists but no migration file (historical/superseded
 *             names) → WARN only, never drift
 */
function evaluateTier1(expectedTracked, appliedNames) {
  const applied = new Set(Array.isArray(appliedNames) ? appliedNames : []);
  const missing = expectedTracked.filter((name) => !applied.has(name));
  const orphan = [...applied].filter((name) => !expectedTracked.includes(name)).sort();
  return { missing, orphan };
}

/**
 * Tier 2 evaluation: probe presence sets vs PROBE_MAP.
 * present = { tables:Set, columns:Set('t.c'), nullableColumns:Set('t.c'),
 *             indexes:Set }
 * Returns { total, missing: [{file, probe}] } — missing = DRIFT.
 */
function evaluateTier2(probeMap, present) {
  const tables = present.tables || new Set();
  const columns = present.columns || new Set();
  const nullable = present.nullableColumns || new Set();
  const indexes = present.indexes || new Set();
  const missing = [];
  let total = 0;
  for (const [file, probes] of Object.entries(probeMap)) {
    for (const probe of probes) {
      total += 1;
      const p = parseProbe(probe);
      let found = false;
      if (p.kind === 'table') found = tables.has(p.name);
      else if (p.kind === 'column') found = columns.has(`${p.table}.${p.column}`);
      else if (p.kind === 'column-nullable') found = nullable.has(`${p.table}.${p.column}`);
      else if (p.kind === 'index') found = indexes.has(p.name);
      if (!found) missing.push({ file, probe });
    }
  }
  return { total, missing };
}

/** Combine both tiers into a verdict: 'ok' | 'drift'. */
function verdictFor(tier1, tier2) {
  if (tier1.missing.length > 0 || tier2.missing.length > 0) return 'drift';
  return 'ok';
}

// ── DB layer ───────────────────────────────────────────────────────────────

function pgConfig() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'mission_control',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    connectionTimeoutMillis: 5000, // fail fast in DB-less contexts
  };
}

const TIER1_QUERY = 'SELECT migration_name FROM schema_migrations';

const TABLES_QUERY = `
  SELECT table_name FROM information_schema.tables
  WHERE table_name = ANY($1::text[])
    AND table_schema NOT IN ('pg_catalog', 'information_schema')`;

const COLUMNS_QUERY = `
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name = ANY($1::text[])
    AND column_name = ANY($2::text[])
    AND table_schema NOT IN ('pg_catalog', 'information_schema')`;

const NULLABLE_QUERY = `
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name = ANY($1::text[])
    AND column_name = ANY($2::text[])
    AND is_nullable = 'YES'
    AND table_schema NOT IN ('pg_catalog', 'information_schema')`;

const INDEXES_QUERY = `
  SELECT indexname FROM pg_indexes
  WHERE indexname = ANY($1::text[])
    AND schemaname NOT IN ('pg_catalog', 'information_schema')`;

/** Run the four batch probe queries; returns the `present` sets. */
async function loadPresentObjects(pool, probes) {
  const [tablesRes, columnsRes, nullableRes, indexesRes] = await Promise.all([
    pool.query(TABLES_QUERY, [probes.tables]),
    pool.query(COLUMNS_QUERY, [probes.columns.map(([t]) => t), probes.columns.map(([, c]) => c)]),
    pool.query(NULLABLE_QUERY, [probes.nullableColumns.map(([t]) => t), probes.nullableColumns.map(([, c]) => c)]),
    pool.query(INDEXES_QUERY, [probes.indexes]),
  ]);
  return {
    tables: new Set(tablesRes.rows.map((r) => r.table_name)),
    columns: new Set(columnsRes.rows.map((r) => `${r.table_name}.${r.column_name}`)),
    nullableColumns: new Set(nullableRes.rows.map((r) => `${r.table_name}.${r.column_name}`)),
    indexes: new Set(indexesRes.rows.map((r) => r.indexname)),
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function printReport(tier1, tier2, fileCounts) {
  console.log('=== Schema drift check (schema/migrations vs database) ===');
  console.log(`Migration files: ${fileCounts.total} (${fileCounts.tracked} tracking-tier, ${fileCounts.probed} probe-tier)`);
  console.log('');
  console.log('Tier 1 — schema_migrations tracking table (numbered migrations)');
  console.log(`  Expected tracking rows : ${tier1.expected.length}`);
  console.log(`  Applied rows found     : ${tier1.applied.length}`);
  if (tier1.missing.length > 0) {
    console.log('  DRIFT — file exists but migration NOT applied:');
    for (const name of tier1.missing) console.log(`    ${name}`);
  } else {
    console.log('  All expected numbered migrations are tracked.');
  }
  if (tier1.orphan.length > 0) {
    console.log('  WARN — applied rows with no migration file (historical/superseded, not drift):');
    for (const name of tier1.orphan) console.log(`    ${name}`);
  }
  console.log('');
  console.log('Tier 2 — object probes (date-prefixed + untracked numbered migrations)');
  console.log(`  Probes run             : ${tier2.total}`);
  if (tier2.missing.length > 0) {
    console.log('  DRIFT — migration objects missing from the database:');
    for (const { file, probe } of tier2.missing) console.log(`    ${file}: ${probe}`);
  } else {
    console.log('  All probed migration objects are present.');
  }
}

function printUnavailable(err) {
  const code = err?.code || '';
  let reason;
  if (code === '42P01') reason = 'schema_migrations table does not exist on this instance (migration 005 not applied)';
  else if (code === '3D000') reason = `database "${pgConfig().database}" does not exist`;
  else if (code === '28P01' || code === '28000') reason = 'PostgreSQL authentication failed';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) reason = `cannot reach PostgreSQL at ${pgConfig().host}:${pgConfig().port} (${code})`;
  else reason = `${code || 'unknown'} ${err?.message || err}`;

  console.error('=== Schema drift check (schema/migrations vs database) ===');
  console.error('Database unavailable — drift status CANNOT be determined.');
  console.error(`Reason: ${reason}`);
  console.error('This is NOT zero drift: no data was read.');
  console.error('Re-run when the dashboard PostgreSQL instance is reachable');
  console.error('(env: POSTGRES_HOST/PORT/DB/USER/PASSWORD, same as dashboard-validation.js).');
  console.error('VERDICT: unavailable');
}

async function safeEnd(pool) {
  try { await pool.end(); } catch { /* already closed */ }
}

async function main() {
  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch (err) {
    console.error(`[schema-drift-check] cannot read ${MIGRATIONS_DIR}: ${err?.message || err}`);
    process.exit(1);
  }
  const names = files.map(migrationNameFromFilename).filter(Boolean);
  const { tracked, probed, gaps } = splitTiers(names);
  if (gaps.length > 0) {
    // Unreachable via the guard test; fail loud rather than false-ok.
    console.error('[schema-drift-check] CHECKER GAP — migrations with no coverage (add PROBE_MAP entries):');
    for (const name of gaps) console.error(`    ${name}`);
    process.exit(1);
  }

  const pool = new Pool(pgConfig());
  try {
    const [tier1Res, present] = await Promise.all([
      pool.query(TIER1_QUERY),
      loadPresentObjects(pool, collectProbes(PROBE_MAP)),
    ]);
    const appliedNames = tier1Res.rows.map((r) => r.migration_name);
    const tier1 = evaluateTier1(tracked, appliedNames);
    const tier2 = evaluateTier2(PROBE_MAP, present);
    const verdict = verdictFor(tier1, tier2);

    printReport(
      { ...tier1, expected: tracked, applied: appliedNames },
      tier2,
      { total: names.length, tracked: tracked.length, probed: probed.length },
    );
    console.log('');
    console.log(`VERDICT: ${verdict}`);
    if (verdict === 'drift') process.exitCode = 1;
  } catch (err) {
    // Graceful no-DB contract: honest message, exit 0 — must work in
    // CI-less, DB-less contexts without failing.
    printUnavailable(err);
  } finally {
    await safeEnd(pool);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[schema-drift-check] unexpected failure: ${err?.message || err}`);
    process.exit(1);
  });
}

module.exports = {
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
};