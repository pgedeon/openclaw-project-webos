/**
 * Snapshot manifest — pure, DB-free functions for the snapshot/restore feature
 * (docs/briefs/snapshot-restore.md §4.2 artifact format, §4.3 schema compat).
 *
 * Slice 1 of the build: zero routes, zero shared files. Everything here is a
 * pure function of its arguments so manifest shape, validation failures, and
 * schema-version verdicts are table-driven testable without PostgreSQL
 * (tests/test-snapshot-lib.js, AC1 + AC2).
 *
 * Manifest contract (§4.2): every artifact carries artifact_version, a
 * snapshot_id, name, created_at, actor, generator, the exact applied-migration
 * list under schema_version.migrations_applied, per-table exact row counts,
 * and a content_hash over {tables, settings} for integrity checking at
 * preview time (AC8 consumes it; this lib produces it).
 */

const crypto = require('crypto');

/** Artifact format version. Bump only when the manifest shape changes. */
const ARTIFACT_VERSION = 1;

/**
 * Stable JSON stringify: object keys sorted recursively, arrays kept in
 * order. Same canonical form used by content_hash here and canonicalRowHash()
 * in lib/snapshot-diff.js — a row hashed at snapshot time and the same row
 * hashed at restore time must produce identical bytes.
 *
 * Date instances normalize to ISO-8601 UTC strings: PostgreSQL drivers return
 * timestamptz columns as Date objects while artifacts carry the JSON-serialized
 * ISO strings — without this, every timestamped row would hash differently on
 * the two sides of classifyRows() and misclassify as updated/conflict.
 * Invalid Dates canonicalize to null rather than throwing mid-hash.
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? JSON.stringify(null) : JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined) // undefined props drop like a JSON round-trip drops them
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** sha256 hex over the canonical JSON of `value`. */
function sha256Canonical(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Local-time default snapshot name per §3.1: snapshot-YYYYMMDD-HHmm. */
function defaultSnapshotName(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `snapshot-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
}

let cachedGenerator = null;
/** Generator string per §4.2: "<repo> <version>" read once from package.json. */
function generatorString() {
  if (cachedGenerator) return cachedGenerator;
  let version = 'unknown';
  try {
    // eslint-disable-next-line global-require
    version = require('../package.json').version || 'unknown';
  } catch {
    // fall through — generator stays honest about the unknown version
  }
  cachedGenerator = `openclaw-project-webos ${version}`;
  return cachedGenerator;
}

/**
 * Build a v1 manifest (§4.2). Pure aside from id/date defaults, which are
 * injectable via `opts` so tests are deterministic:
 *   opts.snapshotId  — UUID; default crypto.randomUUID()
 *   opts.name        — default snapshot-YYYYMMDD-HHmm (local time)
 *   opts.createdAt   — ISO string; default now
 *   opts.actor       — default 'dashboard-operator'
 *   opts.generator   — default 'openclaw-project-webos <pkg version>'
 *
 * rowsByTable: { <table>: row[] } — counts recorded per table (AC1: exact).
 * settings:    already-redacted flat settings map (route composes
 *              lib/snapshot-redact.js redactSettings() BEFORE calling this;
 *              this lib never sees raw settings).
 * migrationsApplied: string[] — schema_version.migrations_applied verbatim.
 */
function buildManifest(rowsByTable, settings, migrationsApplied, opts = {}) {
  if (!rowsByTable || typeof rowsByTable !== 'object' || Array.isArray(rowsByTable)) {
    throw new TypeError('buildManifest: rowsByTable must be an object of table → row[]');
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('buildManifest: settings must be a plain object');
  }
  if (!Array.isArray(migrationsApplied) || migrationsApplied.some((m) => typeof m !== 'string')) {
    throw new TypeError('buildManifest: migrationsApplied must be an array of migration-name strings');
  }

  const counts = {};
  for (const [table, rows] of Object.entries(rowsByTable)) {
    if (!Array.isArray(rows)) {
      throw new TypeError(`buildManifest: rowsByTable["${table}"] is not an array`);
    }
    counts[table] = rows.length;
  }

  const createdAt = opts.createdAt || new Date().toISOString();
  const manifest = {
    artifact_version: ARTIFACT_VERSION,
    snapshot_id: opts.snapshotId || crypto.randomUUID(),
    name: opts.name || defaultSnapshotName(new Date(createdAt)),
    created_at: createdAt,
    actor: opts.actor || 'dashboard-operator',
    generator: opts.generator || generatorString(),
    schema_version: { migrations_applied: [...migrationsApplied] },
    counts,
    content_hash: sha256Canonical({ tables: rowsByTable, settings }),
  };
  return manifest;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Structural manifest validation (AC1). Does NOT verify content_hash against
 * a payload (that is the preview-time integrity check, AC8) — only that every
 * §4.2 manifest field is present and well-formed.
 *
 * Per §4.2 the artifact wraps the manifest: { manifest, tables, settings } —
 * `tables` is a SIBLING of the manifest, never a manifest field. Pass the
 * full artifact as the optional second argument to also cross-check
 * counts[] against the actual table payloads (anti hand-edit guard).
 *
 * Returns { valid: true } or { valid: false, missing: [...], errors: [...] }
 * where missing[] names absent top-level fields (AC1 language) and errors[]
 * carries shape problems beyond absence.
 */
function validateManifest(manifest, artifact) {
  const missing = [];
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, missing: ['manifest'], errors: ['manifest must be a plain object'] };
  }

  const isAbsent = (field) => !(field in manifest) || manifest[field] === undefined || manifest[field] === null;
  const nonEmptyStr = (v) => typeof v === 'string' && v.length > 0;

  // artifact_version: exactly the v1 marker
  if (isAbsent('artifact_version')) missing.push('artifact_version');
  else if (manifest.artifact_version !== ARTIFACT_VERSION) errors.push(`artifact_version: must be ${ARTIFACT_VERSION}`);

  for (const field of ['snapshot_id', 'name', 'actor', 'generator']) {
    if (isAbsent(field)) missing.push(field);
    else if (!nonEmptyStr(manifest[field])) errors.push(`${field}: must be a non-empty string`);
  }

  if (isAbsent('created_at')) missing.push('created_at');
  else if (!(typeof manifest.created_at === 'string'
    && ISO_RE.test(manifest.created_at)
    && !Number.isNaN(Date.parse(manifest.created_at)))) {
    errors.push('created_at: must be an ISO-8601 timestamp string');
  }

  if (isAbsent('schema_version')) {
    missing.push('schema_version');
    missing.push('schema_version.migrations_applied');
  } else if (!manifest.schema_version || typeof manifest.schema_version !== 'object' || Array.isArray(manifest.schema_version)) {
    errors.push('schema_version: must be a plain object');
    missing.push('schema_version.migrations_applied');
  } else if (!Array.isArray(manifest.schema_version.migrations_applied)) {
    missing.push('schema_version.migrations_applied');
  } else if (manifest.schema_version.migrations_applied.some((m) => typeof m !== 'string')) {
    errors.push('schema_version.migrations_applied: every entry must be a string');
  }

  if (isAbsent('counts')) missing.push('counts');
  else if (!manifest.counts || typeof manifest.counts !== 'object' || Array.isArray(manifest.counts)) {
    errors.push('counts: must be a plain object');
  } else if (Object.values(manifest.counts).some((n) => !Number.isInteger(n) || n < 0)) {
    errors.push('counts: every count must be a non-negative integer');
  }

  // Optional artifact-level cross-check: counts keys must match the sibling
  // tables payload exactly — a count without its table (or vice versa) means
  // the artifact was hand-edited or truncated.
  const tables = artifact ? artifact.tables : undefined;
  if (manifest.counts && typeof manifest.counts === 'object' && !Array.isArray(manifest.counts)
    && tables !== undefined) {
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)
      || Object.values(tables).some((rows) => !Array.isArray(rows))) {
      errors.push('artifact.tables: must be a plain object of table → row[]');
    } else {
      const tableKeys = Object.keys(tables).sort();
      const countKeys = Object.keys(manifest.counts).sort();
      if (JSON.stringify(tableKeys) !== JSON.stringify(countKeys)) {
        errors.push('counts: keys do not exactly match tables keys');
      } else {
        for (const table of tableKeys) {
          if (manifest.counts[table] !== tables[table].length) {
            errors.push(`counts["${table}"]: ${manifest.counts[table]} != actual ${tables[table].length} rows`);
          }
        }
      }
    }
  }

  if (isAbsent('content_hash')) missing.push('content_hash');
  else if (!(typeof manifest.content_hash === 'string' && /^[0-9a-f]{64}$/.test(manifest.content_hash))) {
    errors.push('content_hash: must be a sha256 hex string');
  }

  return { valid: missing.length === 0 && errors.length === 0, missing, errors };
}

/**
 * Schema-version compatibility verdict (§4.3): refuse restore from newer,
 * warn into older.
 *   'too_new'       — artifact names migrations the target never applied →
 *                     preview/apply refuse (409 schema_too_new, missing[])
 *   'target_newer'  — target applied migrations the artifact doesn't know →
 *                     allowed; preview surfaces warnings:['target_newer']
 *   'ok'            — identical migration sets
 * Refusal dominates: if the artifact is ahead in ANY migration the verdict is
 * 'too_new' even when the target is also ahead elsewhere.
 */
function compareSchemaVersions(artifactMigrations, targetMigrations) {
  const artifact = Array.isArray(artifactMigrations) ? artifactMigrations : [];
  const target = Array.isArray(targetMigrations) ? targetMigrations : [];
  const targetSet = new Set(target);

  const missing = artifact.filter((m) => !targetSet.has(m));
  if (missing.length > 0) return { verdict: 'too_new', missing };

  const artifactSet = new Set(artifact);
  const targetAhead = target.some((m) => !artifactSet.has(m));
  return { verdict: targetAhead ? 'target_newer' : 'ok', missing: [] };
}

module.exports = {
  ARTIFACT_VERSION,
  canonicalJson,
  sha256Canonical,
  buildManifest,
  validateManifest,
  compareSchemaVersions,
};
