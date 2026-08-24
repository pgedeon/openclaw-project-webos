/**
 * Snapshot diff — pure, DB-free row classification for restore preview
 * (docs/briefs/snapshot-restore.md §4.2).
 *
 * Slice 1 of the build: zero routes, zero shared files. classifyRows() is the
 * exact function the dry-run preview grid (§3.2 step 2) will render from:
 * per table, keyed by PK column, every artifact row lands in exactly one of
 * added / updated / conflicts / unchanged. Nothing here touches PostgreSQL —
 * routes fetch current rows and hand them in.
 *
 * Classification contract (§4.2):
 *   added      — PK absent from current DB
 *   updated    — PK present, canonical hash differs, DB row updated_at ≤
 *                artifact created_at (safe to take the artifact version)
 *   conflicts  — PK present, hash differs, DB row changed AFTER the snapshot
 *                was taken (updated_at > created_at) — live divergence the
 *                operator must see before confirming
 *   unchanged  — identical canonical hash
 */

const crypto = require('crypto');
const { canonicalJson } = require('./snapshot-manifest');

/**
 * Stable content hash for one row: sha256 over canonicalJson (recursively
 * key-sorted), so {a:1,b:2} and {b:2,a:1} hash identically regardless of
 * driver column order. Arrays keep order; primitives/null hash as-is.
 */
function canonicalRowHash(row) {
  return crypto.createHash('sha256').update(canonicalJson(row)).digest('hex');
}

/**
 * Normalize a timestamp to epoch millis. Accepts Date (pg drivers return
 * timestamptz as Date), epoch-millis numbers, ISO strings, and nullish.
 * Unparseable → null so callers can apply their own conservative rule.
 */
function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Classify artifact rows against current DB rows (AC4).
 *
 * @param {Array<object>} artifactRows — rows from the snapshot artifact
 * @param {Array<object>} currentRows  — live rows read from the target table
 * @param {string} pkColumn            — primary-key column name
 * @param {Date|number|string} createdAt — artifact creation timestamp (the
 *        manifest's created_at); the conflict boundary
 * @returns {{added: object[], updated: object[], conflicts: object[], unchanged: object[]}}
 *          buckets hold the ARTIFACT-side row (the row a merge upsert would
 *          write); routes derive PK samples for the expandable preview grid.
 * @throws TypeError on non-array inputs or empty pkColumn
 * @throws Error on duplicate PK values within either input (corrupt artifact /
 *          impossible live state — fail loudly rather than silently dropping)
 */
function classifyRows(artifactRows, currentRows, pkColumn, createdAt) {
  if (!Array.isArray(artifactRows)) throw new TypeError('classifyRows: artifactRows must be an array');
  if (!Array.isArray(currentRows)) throw new TypeError('classifyRows: currentRows must be an array');
  if (typeof pkColumn !== 'string' || pkColumn.length === 0) {
    throw new TypeError('classifyRows: pkColumn must be a non-empty string');
  }

  const createdMs = toMillis(createdAt);
  if (createdMs === null) throw new TypeError('classifyRows: createdAt must be a parseable timestamp');

  const byPk = (rows, label) => {
    const map = new Map();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new TypeError(`classifyRows: ${label} contains a non-object row`);
      }
      if (!(pkColumn in row)) {
        throw new Error(`classifyRows: ${label} row missing PK column "${pkColumn}"`);
      }
      const pk = String(row[pkColumn]);
      if (map.has(pk)) throw new Error(`classifyRows: duplicate PK "${pk}" in ${label}`);
      map.set(pk, row);
    }
    return map;
  };

  const artifactByPk = byPk(artifactRows, 'artifactRows');
  const currentByPk = byPk(currentRows, 'currentRows');

  const added = [];
  const updated = [];
  const conflicts = [];
  const unchanged = [];

  for (const [pk, artifactRow] of artifactByPk) {
    const currentRow = currentByPk.get(pk);

    // added: PK absent from current DB
    if (!currentRow) {
      added.push(artifactRow);
      continue;
    }

    // unchanged: identical canonical hash
    if (canonicalRowHash(artifactRow) === canonicalRowHash(currentRow)) {
      unchanged.push(artifactRow);
      continue;
    }

    // Hash differs → conflict only when the LIVE row provably changed after
    // the snapshot was taken (updated_at > created_at). A missing/unparseable
    // updated_at is treated as "not newer" → updated (conservative toward
    // taking the artifact version; never silently hides a known divergence).
    const currentUpdatedMs = toMillis(currentRow.updated_at);
    if (currentUpdatedMs !== null && currentUpdatedMs > createdMs) {
      conflicts.push(artifactRow);
    } else {
      updated.push(artifactRow);
    }
  }

  return { added, updated, conflicts, unchanged };
}

module.exports = { canonicalRowHash, classifyRows };
