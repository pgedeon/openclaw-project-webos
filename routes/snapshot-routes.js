/**
 * Snapshot / Restore routes (docs/briefs/snapshot-restore.md §4).
 *
 * Slice 2 of the build: five endpoints over the slice-1 pure libs
 * (lib/snapshot-manifest.js, lib/snapshot-diff.js, lib/snapshot-redact.js):
 *
 *   POST /api/snapshots            — capture all §2.1 tiers → redacted artifact
 *                                    atomically written to storage/snapshots/<id>.json
 *   GET  /api/snapshots            — disk registry, newest-first, honest sizes
 *   GET  /api/snapshots/:id/download — artifact as attachment download
 *   POST /api/restore/preview      — validate + schema-compat + dry-run diff
 *   POST /api/restore/apply        — checkpointed merge/replace apply + SSE progress
 *
 * Degradation contract: create/preview/apply answer `503 {available:false,
 * reason:'no_database'}` without PostgreSQL with ZERO writes (brief §4.1
 * table + AC7 — deliberately stricter than cost-routes' HTTP-200 variant;
 * the disk-only registry/download endpoints keep working without a database).
 *
 * Secrets policy (§5): the settings section is built ONLY from config-source
 * keys via redactSettings(), then the WHOLE artifact passes through
 * redactDeep() before the manifest's content_hash is computed — so the hash
 * always describes exactly the bytes an operator can re-download.
 */

const fs = require('fs');
const path = require('path');

const { resolveCapability, toDegradedBody } = require('../lib/capability-status');

const {
  sha256Canonical,
  validateManifest,
  compareSchemaVersions,
  buildManifest,
} = require('../lib/snapshot-manifest');
const { classifyRows } = require('../lib/snapshot-diff');
const { redactDeep, redactSettings } = require('../lib/snapshot-redact');

/** Default restore request cap (§4.1 / AC9): 100 MB, enforced pre-parse. */
const DEFAULT_RESTORE_MAX_BYTES = 100 * 1024 * 1024;

/** Upsert/delete batch size per statement round (§4.5 ~500 rows). */
const BATCH_SIZE = 500;

/** Snapshot ids and restoreIds are file-name components — lock them down. */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Pinned table dependency chain (§4.2 / AC10). The head is fixture-pinned by
 * the brief: workflows → projects → tasks → workflow_runs → workflow_steps →
 * workflow_approvals → workflow_artifacts. The tail orders every remaining
 * §2.1 table after its FK parents:
 *   agent_profiles → departments; budget_events → budgets; service_catalog →
 *   departments; service_requests → service_catalog/projects/tasks/
 *   departments; department_daily_metrics → departments; task_runs → tasks;
 *   audit_log.task_id → tasks; saved_views.project_id → projects.
 * Tables without mutual FKs among themselves are grouped arbitrarily.
 */
const TABLE_ORDER = [
  // Brief-pinned head of the chain (AC10 asserts this exact prefix order).
  'workflows',
  'projects',
  'tasks',
  'workflow_runs',
  'workflow_steps',
  'workflow_approvals',
  'workflow_artifacts',
  // Remaining §2.1 tables, each after its FK parents.
  'workspaces',
  'saved_views',
  'departments',
  'agent_profiles',
  'workflow_templates',
  'workflow_agent_routing',
  'budgets',
  'budget_events',
  'action_receipts',
  'audit_log',
  'service_catalog',
  'service_requests',
  'department_daily_metrics',
  'task_runs',
  'cron_job_runs',
  'agent_heartbeats',
];

/** Replace-mode delete pass runs in exact reverse (FK-safe) order (AC11). */
const REVERSE_TABLE_ORDER = [...TABLE_ORDER].reverse();

/** Primary-key column per §2.1 table (from schema/migrations + base schema). */
const PK_BY_TABLE = {
  workflows: 'id',
  projects: 'id',
  tasks: 'id',
  workflow_runs: 'id',
  workflow_steps: 'id',
  workflow_approvals: 'id',
  workflow_artifacts: 'id',
  workspaces: 'id',
  saved_views: 'id',
  departments: 'id',
  agent_profiles: 'id',
  workflow_templates: 'id',
  workflow_agent_routing: 'workflow_type',
  budgets: 'id',
  budget_events: 'id',
  action_receipts: 'action_id',
  audit_log: 'id',
  service_catalog: 'id',
  service_requests: 'id',
  department_daily_metrics: 'id',
  task_runs: 'id',
  cron_job_runs: 'id',
  agent_heartbeats: 'agent_name',
};

/**
 * Settings-section secret filter (§5.3): stricter than the deep-walk DENY_RE
 * because \b never fires after underscores — this name filter catches the
 * snake_case password keys (POSTGRES_PASSWORD, OPENCLAW_GATEWAY_TOKEN, …)
 * should a hand-edited artifact try to smuggle them back in through settings.
 */
const SECRET_SETTING_NAME = /pass(word|wd)|secret|token|api[_-]?key|credential|auth/i;

function restoreMaxBytes() {
  const raw = parseInt(process.env.RESTORE_MAX_BYTES, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RESTORE_MAX_BYTES;
}

function getPool(ctx) {
  const pool = ctx && ctx.asanaStorage && ctx.asanaStorage.pool;
  if (!pool || typeof pool.query !== 'function') return null;
  return pool;
}

/**
 * Degrade bodies resolve through lib/capability-status.js (capability
 * migration completion, 2026-08-30): pool absent ⇒ the database leg is not
 * configured (verified never ran — null); thrown query ⇒ the database is
 * configured but verification failed at runtime. The reason vocabulary
 * ('no_database', 'query_failed') and the HTTP 503 status stay EXACTLY as
 * the brief §4.1 contract pinned them (tests/test-snapshot-routes.js) —
 * only the body construction routes through the resolver. Status
 * passthrough stays the route's job; the resolver names the body.
 */
function noDatabaseBody() {
  return toDegradedBody(resolveCapability('snapshots', { declared: true, verified: null, configured: false }));
}

function queryFailedBody(err) {
  return {
    ...toDegradedBody(resolveCapability('snapshots', { declared: true, verified: false, configured: true })),
    details: err && err.message ? err.message : String(err),
  };
}

/**
 * Read a JSON body enforcing RESTORE_MAX_BYTES BEFORE any JSON.parse (AC9).
 * Returns { ok:true, body } | { ok:false, tooLarge:true } | { ok:false, invalidJson:true }.
 */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve) => {
    let data = '';
    let bytes = 0;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk) => {
      if (settled) return; // oversized: keep draining, never parse
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        done({ ok: false, tooLarge: true });
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      try {
        done({ ok: true, body: data.trim() ? JSON.parse(data) : {} });
      } catch {
        done({ ok: false, invalidJson: true });
      }
    });
    req.on('error', () => done({ ok: false, invalidJson: true }));
  });
}

function writeArtifactAtomic(dir, id, json) {
  // tmp+rename inside the SAME directory: atomic on Windows/WSL mounts (R6) —
  // tmp files must never cross devices.
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${id}.json`);
  const tmpPath = path.join(dir, `.${id}.tmp`);
  fs.writeFileSync(tmpPath, json);
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

function readSnapshotFile(dir, id) {
  if (!SAFE_ID_RE.test(id)) return null;
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Disk index scan of storage/snapshots/*.json — corrupt files are skipped. */
function listSnapshots(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
      const manifest = artifact && artifact.manifest;
      if (!manifest || !manifest.snapshot_id) continue;
      const counts = manifest.counts || {};
      out.push({
        snapshot_id: manifest.snapshot_id,
        name: manifest.name || manifest.snapshot_id,
        created_at: manifest.created_at || null,
        total_rows: Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0),
        size_bytes: stat.size, // honest on-disk size (R2)
        generator: manifest.generator || null,
      });
    } catch {
      continue; // unreadable/hand-broken file: skip, never break the listing
    }
  }
  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}

/**
 * Resolve + structurally validate an artifact from body.artifact or
 * body.snapshot_id. Returns { error: [status, payload] } or { artifact }.
 * The content_hash integrity check (AC8) runs here — BEFORE any diffing or
 * DB access — so hand-edited artifacts die at the door.
 */
function resolveAndValidateArtifact(body, dir) {
  let artifact = body ? body.artifact : null;
  if (!artifact && body && body.snapshot_id) {
    if (typeof body.snapshot_id !== 'string' || !SAFE_ID_RE.test(body.snapshot_id)) {
      return { error: [400, { error: 'invalid_snapshot_id' }] };
    }
    artifact = readSnapshotFile(dir, body.snapshot_id);
    if (!artifact) return { error: [404, { error: 'snapshot_not_found', snapshot_id: body.snapshot_id }] };
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { error: [400, { error: 'missing_artifact' }] };
  }

  const v = validateManifest(artifact.manifest, artifact);
  if (!v.valid) {
    return { error: [400, { error: 'invalid_manifest', missing: v.missing, errors: v.errors }] };
  }

  if (sha256Canonical({ tables: artifact.tables, settings: artifact.settings }) !== artifact.manifest.content_hash) {
    return { error: [400, { error: 'artifact_corrupt' }] };
  }

  return { artifact };
}

async function readTargetMigrations(pool) {
  const result = await pool.query('SELECT migration_name FROM schema_migrations ORDER BY id');
  return (result.rows || []).map((r) => r.migration_name);
}

/**
 * Settings-section gate (§5.3): restoring settings skips absent keys silently
 * and NEVER accepts a settings section containing password-type /
 * secret-looking keys — the whole section is dropped and surfaced, rather
 * than partially trusted.
 */
function evaluateSettingsSection(settings) {
  const keys = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? Object.keys(settings)
    : [];
  const dropped = keys.some((key) => SECRET_SETTING_NAME.test(key));
  return { keys: keys.length, dropped };
}

/** Single-row PK upsert SQL (idempotent by construction, §4.4). */
function upsertSql(table, row, pk) {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = cols.filter((c) => c !== pk).map((c) => `${c} = EXCLUDED.${c}`);
  const conflictAction = updates.length > 0
    ? `DO UPDATE SET ${updates.join(', ')}`
    : `DO UPDATE SET ${pk} = EXCLUDED.${pk}`; // pk-only row: harmless self-update keeps ON CONFLICT valid
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${pk}) ${conflictAction}`;
}

/**
 * Apply one table inside a single transaction: batched PK upserts (merge
 * semantics). A crashed table rolls back ENTIRELY and re-applies from
 * scratch on resume — checkpoints track tables, not rows (AC6 invariant).
 */
async function applyTableUpserts(pool, table, rows, pk) {
  const client = await pool.connect();
  let upserted = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      for (const row of rows.slice(i, i + BATCH_SIZE)) {
        await client.query(upsertSql(table, row, pk), Object.values(row));
        upserted += 1;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    throw err;
  } finally {
    client.release();
  }
  return { upserted };
}

/**
 * Replace-mode delete pass for one table: remove rows ABSENT from the
 * artifact (never the artifact rows themselves), reporting the honest count
 * via RETURNING. Runs in the FK-safe reverse-order pass (AC11).
 */
async function applyReplaceDeletes(pool, table, rows, pk) {
  const client = await pool.connect();
  let deleted = 0;
  try {
    await client.query('BEGIN');
    const keepPks = rows.map((r) => String(r[pk]));
    if (keepPks.length === 0) {
      const result = await client.query(`DELETE FROM ${table} RETURNING ${pk}`);
      deleted += (result.rows || []).length;
    } else {
      for (let i = 0; i < keepPks.length; i += BATCH_SIZE) {
        const chunk = keepPks.slice(i, i + BATCH_SIZE);
        const placeholders = chunk.map((_, j) => `$${j + 1}`);
        const result = await client.query(
          `DELETE FROM ${table} WHERE ${pk} NOT IN (${placeholders.join(', ')}) RETURNING ${pk}`,
          chunk
        );
        deleted += (result.rows || []).length;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    throw err;
  } finally {
    client.release();
  }
  return { deleted };
}

/**
 * Create one full-state snapshot artifact. Shared by POST /api/snapshots and
 * the snapshot.create action executor (routes/action-routes.js — MCP slice 2
 * receipt-minted mutations). Returns {status, body} using the route's exact
 * response shapes; never throws.
 *
 * §5 secrets policy: structural exclusion first, deny-regex second — BOTH
 * before buildManifest so content_hash describes the shipped bytes.
 */
async function createSnapshotArtifact({ pool, settingsStore = null, snapshotsDir, name }) {
  try {
    if (!pool || typeof pool.query !== 'function') {
      return { status: 503, body: noDatabaseBody() };
    }
    // Serialize all tiers in one pass (§3.1 step 2), deterministic order.
    const tables = {};
    for (const table of TABLE_ORDER) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      tables[table] = result.rows || [];
    }
    const migrationsApplied = await readTargetMigrations(pool);

    let settings = {};
    try {
      settings = redactDeep(redactSettings(settingsStore && settingsStore.getAll ? settingsStore.getAll() : {}));
    } catch { /* settings unavailable → empty section, never fail the capture */ }
    for (const table of Object.keys(tables)) {
      tables[table] = redactDeep(tables[table]);
    }

    const manifest = buildManifest(tables, settings, migrationsApplied, name ? { name } : {});
    const artifact = { manifest, tables, settings };

    writeArtifactAtomic(snapshotsDir, manifest.snapshot_id, JSON.stringify(artifact, null, 2));

    return { status: 201, body: { snapshot_id: manifest.snapshot_id, manifest } };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

function registerSnapshotRoutes(router, options = {}) {
  const snapshotsDir = options.snapshotsDir
    || path.join(__dirname, '..', 'storage', 'snapshots');
  const settingsStore = options.settingsStore || null;

  // SSE fan-out goes to the existing bridge-fed stream (§3.2 step 4);
  // injection wins so tests can spy without opening sockets.
  const injectedBroadcast = typeof options.broadcastStream === 'function' ? options.broadcastStream : null;
  const emitProgress = (frame) => {
    if (injectedBroadcast) {
      try { injectedBroadcast(frame); } catch { /* progress is convenience, not correctness (§4.5) */ }
      return;
    }
    try {
      // Lazy require: keeps the route module loadable before sse-routes boots.
      // eslint-disable-next-line global-require
      require('./sse-routes').broadcastStream('restore-progress', frame);
    } catch { /* progress is convenience, not correctness (§4.5) */ }
  };

  // ── POST /api/snapshots — create snapshot ────────────────────────
  router.add('POST', '/api/snapshots', async (req, res, ctx) => {
    const pool = getPool(ctx);
    if (!pool) {
      return ctx.sendJSON(res, 503, noDatabaseBody());
    }

    const parsed = await readJsonBody(req, restoreMaxBytes());
    if (parsed.tooLarge) {
      return ctx.sendJSON(res, 413, { error: 'payload_too_large' });
    }
    if (!parsed.ok) {
      return ctx.sendJSON(res, 400, { error: 'invalid_json' });
    }
    const name = typeof parsed.body.name === 'string' && parsed.body.name.trim()
      ? parsed.body.name.trim().slice(0, 120)
      : undefined;

    const out = await createSnapshotArtifact({ pool, settingsStore, snapshotsDir, name });
    return ctx.sendJSON(res, out.status, out.body);
  });

  // ── GET /api/snapshots — disk registry (works without PostgreSQL, AC7) ──
  router.add('GET', '/api/snapshots', async (req, res, ctx) => {
    try {
      const snapshots = listSnapshots(snapshotsDir);
      return ctx.sendJSON(res, 200, { available: true, count: snapshots.length, snapshots });
    } catch (err) {
      return ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // ── GET /api/snapshots/:id/download — attachment stream (disk-only) ──
  router.add('GET', '/api/snapshots/:id/download', async (req, res, ctx, params) => {
    try {
      const id = params && params.id;
      if (!id || !SAFE_ID_RE.test(id)) {
        return ctx.sendJSON(res, 404, { error: 'snapshot_not_found' });
      }
      const file = path.join(snapshotsDir, `${id}.json`);
      if (!fs.existsSync(file)) {
        return ctx.sendJSON(res, 404, { error: 'snapshot_not_found', snapshot_id: id });
      }
      const raw = fs.readFileSync(file);

      let filename = `${id}.json`;
      try {
        const manifest = JSON.parse(raw.toString('utf8')).manifest;
        if (manifest && typeof manifest.name === 'string' && manifest.name.trim()) {
          filename = `${manifest.name.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
        }
      } catch { /* fall back to id-based filename */ }

      if (typeof res.writeHead === 'function') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': raw.length,
          'Content-Disposition': `attachment; filename="${filename}"`,
        });
        res.end(raw);
      } else {
        // Test-capture path (response-capture harness has no real response).
        res.result = {
          status: 200,
          payload: JSON.parse(raw.toString('utf8')),
          headers: { 'content-disposition': `attachment; filename="${filename}"` },
        };
      }
      return true;
    } catch (err) {
      return ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // ── POST /api/restore/preview — dry-run diff, zero writes ─────────
  router.add('POST', '/api/restore/preview', async (req, res, ctx) => {
    try {
      const parsed = await readJsonBody(req, restoreMaxBytes());
      if (parsed.tooLarge) {
        return ctx.sendJSON(res, 413, { error: 'payload_too_large' });
      }
      if (!parsed.ok) {
        return ctx.sendJSON(res, 400, { error: 'invalid_json' });
      }

      const resolved = resolveAndValidateArtifact(parsed.body, snapshotsDir);
      if (resolved.error) {
        return ctx.sendJSON(res, resolved.error[0], resolved.error[1]);
      }
      const artifact = resolved.artifact;

      const pool = getPool(ctx);
      if (!pool) {
        return ctx.sendJSON(res, 503, noDatabaseBody());
      }

      let targetMigrations;
      try {
        targetMigrations = await readTargetMigrations(pool);
      } catch (err) {
        return ctx.sendJSON(res, 503, queryFailedBody(err));
      }

      // §4.3: refuse restore from newer, warn into older.
      const compat = compareSchemaVersions(artifact.manifest.schema_version.migrations_applied, targetMigrations);
      if (compat.verdict === 'too_new') {
        return ctx.sendJSON(res, 409, { error: 'schema_too_new', missing: compat.missing });
      }

      const warnings = [];
      if (compat.verdict === 'target_newer') warnings.push('target_newer');

      // R4: warn when live writers (dispatcher/cron/gateway sync) are active.
      try {
        const activeResult = await pool.query(
          `SELECT COUNT(*)::int AS n FROM workflow_runs
           WHERE status IN ('dispatched', 'claimed', 'running', 'waiting_for_approval')`
        );
        if ((activeResult.rows[0] && activeResult.rows[0].n) > 0) warnings.push('active_runs');
      } catch { /* warning is best-effort; never block preview on it */ }

      const createdAt = artifact.manifest.created_at;
      const tables = {};
      const totals = { added: 0, updated: 0, conflicts: 0, unchanged: 0 };

      for (const [table, rows] of Object.entries(artifact.tables)) {
        const pk = PK_BY_TABLE[table] || 'id';
        let currentRows;
        try {
          const result = await pool.query(`SELECT * FROM ${table}`);
          currentRows = result.rows || [];
        } catch (err) {
          tables[table] = { error: err.message }; // unknown-on-target: surface honestly
          continue;
        }
        const cls = classifyRows(rows, currentRows, pk, createdAt);
        tables[table] = {
          added: cls.added.length,
          updated: cls.updated.length,
          conflicts: cls.conflicts.length,
          unchanged: cls.unchanged.length,
          added_pks: cls.added.slice(0, 5).map((r) => String(r[pk])),
          conflict_pks: cls.conflicts.slice(0, 5).map((r) => String(r[pk])),
        };
        totals.added += cls.added.length;
        totals.updated += cls.updated.length;
        totals.conflicts += cls.conflicts.length;
        totals.unchanged += cls.unchanged.length;
      }

      const settingsInfo = evaluateSettingsSection(artifact.settings);
      if (settingsInfo.dropped) warnings.push('settings_section_dropped');

      return ctx.sendJSON(res, 200, {
        schema_compat: compat.verdict,
        warnings,
        tables,
        totals,
        settings: settingsInfo,
        snapshot_id: artifact.manifest.snapshot_id,
        created_at: createdAt,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // ── POST /api/restore/apply — checkpointed merge/replace ──────────
  router.add('POST', '/api/restore/apply', async (req, res, ctx) => {
    let cpPath = null;
    try {
      const parsed = await readJsonBody(req, restoreMaxBytes());
      if (parsed.tooLarge) {
        return ctx.sendJSON(res, 413, { error: 'payload_too_large' });
      }
      if (!parsed.ok) {
        return ctx.sendJSON(res, 400, { error: 'invalid_json' });
      }
      const body = parsed.body;

      const mode = body.mode || 'merge';
      if (mode !== 'merge' && mode !== 'replace') {
        return ctx.sendJSON(res, 400, { error: 'invalid_mode', mode });
      }
      const restoreId = body.restoreId;
      if (typeof restoreId !== 'string' || !SAFE_ID_RE.test(restoreId)) {
        return ctx.sendJSON(res, 400, { error: 'missing_or_invalid_restore_id' });
      }

      // Idempotency latch is FILE-backed (§4.4) — checked BEFORE the DB gate
      // so replays stay answerable even while PostgreSQL is down.
      cpPath = path.join(snapshotsDir, `${restoreId}.resume.json`);
      let checkpoint = null;
      if (fs.existsSync(cpPath)) {
        try { checkpoint = JSON.parse(fs.readFileSync(cpPath, 'utf8')); } catch { checkpoint = null; }
      }
      if (checkpoint && checkpoint.summary && checkpoint.completedAt) {
        // Completed restore: replay returns the stored summary, executes nothing.
        return ctx.sendJSON(res, 200, { duplicate: true, restoreId, summary: checkpoint.summary });
      }

      const pool = getPool(ctx);
      if (!pool) {
        return ctx.sendJSON(res, 503, noDatabaseBody()); // zero writes
      }

      const resolved = resolveAndValidateArtifact(body, snapshotsDir);
      if (resolved.error) {
        return ctx.sendJSON(res, resolved.error[0], resolved.error[1]);
      }
      const artifact = resolved.artifact;

      let targetMigrations;
      try {
        targetMigrations = await readTargetMigrations(pool);
      } catch (err) {
        return ctx.sendJSON(res, 503, queryFailedBody(err));
      }
      const compat = compareSchemaVersions(artifact.manifest.schema_version.migrations_applied, targetMigrations);
      if (compat.verdict === 'too_new') {
        return ctx.sendJSON(res, 409, { error: 'schema_too_new', missing: compat.missing });
      }

      const resumed = !!checkpoint;
      checkpoint = checkpoint || {
        restoreId,
        snapshotId: artifact.manifest.snapshot_id,
        mode,
        completedTables: [],
        deletedTables: [],
        startedAt: new Date().toISOString(),
        lastError: null,
      };
      checkpoint.completedTables = Array.isArray(checkpoint.completedTables) ? checkpoint.completedTables : [];
      checkpoint.deletedTables = Array.isArray(checkpoint.deletedTables) ? checkpoint.deletedTables : [];

      const summary = {
        mode,
        snapshot_id: artifact.manifest.snapshot_id,
        tables: {},
        totals: { upserted: 0, deleted: 0 },
        settings: { applied: 0, dropped_section: false },
        resumed,
        startedAt: checkpoint.startedAt,
      };

      const completedTables = new Set(checkpoint.completedTables);
      const deletedTables = new Set(checkpoint.deletedTables);
      const persistCheckpoint = () => {
        fs.mkdirSync(snapshotsDir, { recursive: true });
        fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));
      };
      persistCheckpoint(); // resume anchor exists before the first row write

      // REPLACE pass 1 — deletes absent-from-artifact rows per table in
      // FK-safe reverse dependency order (§4.2 / AC11), one transaction per
      // table, checkpointing after each.
      if (mode === 'replace') {
        for (const table of REVERSE_TABLE_ORDER) {
          const rows = artifact.tables[table];
          if (!rows || deletedTables.has(table)) continue;
          const { deleted } = await applyReplaceDeletes(pool, table, rows, PK_BY_TABLE[table] || 'id');
          summary.tables[table] = summary.tables[table] || { upserted: 0, deleted: 0 };
          summary.tables[table].deleted = deleted;
          summary.totals.deleted += deleted;
          checkpoint.deletedTables.push(table);
          persistCheckpoint();
        }
      }

      // Pass 2 — upserts in pinned forward dependency order (AC10), one
      // transaction per table, checkpoint + SSE frame after each (§4.5).
      for (const table of TABLE_ORDER) {
        const rows = artifact.tables[table];
        if (!rows || completedTables.has(table)) continue;
        const { upserted } = await applyTableUpserts(pool, table, rows, PK_BY_TABLE[table] || 'id');
        summary.tables[table] = summary.tables[table] || { upserted: 0, deleted: 0 };
        summary.tables[table].upserted = upserted;
        summary.totals.upserted += upserted;
        checkpoint.completedTables.push(table);
        persistCheckpoint();
        try {
          emitProgress({ restoreId, table, doneRows: upserted, totalRows: rows.length });
        } catch { /* progress is convenience, not correctness (§4.5) */ }
      }

      // Settings last (§5.3): drop the whole section when it carries
      // secret-looking keys; otherwise set present keys, skipping failures.
      const settingsInfo = evaluateSettingsSection(artifact.settings);
      summary.settings.dropped_section = settingsInfo.dropped;
      if (settingsInfo.dropped) {
        summary.settings.skipped_keys = settingsInfo.keys;
      } else if (artifact.settings && settingsStore && typeof settingsStore.set === 'function') {
        for (const [key, value] of Object.entries(artifact.settings)) {
          try {
            await settingsStore.set(key, value);
            summary.settings.applied += 1;
          } catch { /* absent/unsettable key: skip silently (§5.3) */ }
        }
      }

      summary.completedAt = new Date().toISOString();
      checkpoint.summary = summary;
      checkpoint.completedAt = summary.completedAt;
      checkpoint.lastError = null;
      persistCheckpoint();

      return ctx.sendJSON(res, 200, { restoreId, duplicate: false, resumed, summary });
    } catch (err) {
      // Crash between table transactions leaves prior tables committed —
      // that is the resume point, not corruption (§4.4). Record and invite
      // the replay; the same restoreId resumes at the first incomplete table.
      if (cpPath) {
        try {
          const checkpoint = fs.existsSync(cpPath)
            ? JSON.parse(fs.readFileSync(cpPath, 'utf8'))
            : { restoreId: path.basename(cpPath, '.resume.json') };
          checkpoint.lastError = err.message;
          fs.mkdirSync(snapshotsDir, { recursive: true });
          fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2));
        } catch { /* best-effort error recording */ }
      }
      return ctx.sendJSON(res, 500, {
        error: 'restore_failed',
        details: err.message,
        resume_hint: 're-POST with the same restoreId to resume at the first incomplete table',
      });
    }
  });
}

module.exports = {
  registerSnapshotRoutes,
  createSnapshotArtifact,
  TABLE_ORDER,
  REVERSE_TABLE_ORDER,
  PK_BY_TABLE,
  DEFAULT_RESTORE_MAX_BYTES,
};
