/**
 * Snapshot redaction — pure, DB-free secrets policy for the snapshot/restore
 * feature (docs/briefs/snapshot-restore.md §5).
 *
 * Slice 1 of the build: zero routes, zero shared files. Two layers:
 *
 *   redactSettings(getAllOutput) — §5.1 structural exclusion at the source.
 *     Builds the artifact settings section from a settingsStore.getAll()
 *     output keeping ONLY config-source keys. Every env-source key and every
 *     type:'password' key is structurally absent — no placeholders, absence
 *     itself is the policy. Filtering runs on the metadata getAll() attaches
 *     to each entry (derived from the SCHEMA at runtime), so future settings
 *     additions can't silently leak through a hardcoded key list.
 *
 *   redactDeep(obj) — §5.2 defense-in-depth deny-regex pass. Recursive walk
 *     over every value (JSONB cells included); any object KEY matching the
 *     deny-regex has its VALUE replaced with "[REDACTED]". Keys keep their
 *     names so structure stays restorable; values die.
 *
 * Deny-regex (widened 2026-08-25, debt D3 fix of the originally pinned
 * §5.2 pattern):
 *   (?<![a-z0-9])(password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential)(?![a-z0-9])
 * case-insensitive. Boundary logic: letters/digits count as word continuation
 * (keyboard/monkeybusiness/keynote/tokens never trip), underscore does NOT —
 * underscore-attached names like db_password / access_token / SECRET_KEY now
 * match, closing the snake_case gap the original \b version had. Layer 1
 * still exists and runs first: the five password-type settings keys are
 * excluded structurally by redactSettings(); the deny pass remains the
 * second net.
 */

// §5.2 deny-regex (widened per debt D3) — case-insensitive with variable
// boundaries: the lookarounds exclude [a-z0-9] neighbors but deliberately
// ALLOW '_' adjacency, so db_password / access_token / SECRET_KEY match while
// keyboard / monkeybusiness / keynote / tokens / secretSanta do not ('_' is
// absent from both classes on purpose — that IS the boundary rule). AC3 pins
// both directions; do not widen without re-running those fixtures.
const DENY_RE = /(?<![a-z0-9])(?:password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential)(?![a-z0-9])/i;

// Fallback name filter for provenance-less entries (flat maps without schema
// metadata). Mirrors SECRET_SETTING_NAME in routes/export-routes.js so the
// export hotfix and this lib stay behaviorally identical for the same input.
const SECRET_SETTING_NAME = /pass(word|wd)|secret|token|api[_-]?key|credential|auth/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 100; // JSONB payloads are shallow; the cap only stops hostile/pathological nesting

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursive deny-regex walk (§5.2). Pure: returns a new structure, never
 * mutates the input. Matching keys keep their names; their entire value —
 * string, number, object, array, null — becomes "[REDACTED]" without being
 * descended into. Non-matching object/array values are walked recursively.
 */
function redactDeep(value, depth = 0) {
  if (depth > MAX_DEPTH) return REDACTED; // fail closed past the cap
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = DENY_RE.test(key) ? REDACTED : redactDeep(val, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Build the artifact settings section from a settingsStore.getAll() output
 * (§5.1). Returns a FLAT { key: value } map per the §4.2 artifact format —
 * schema metadata (type/source/category blobs) is stripped, values kept.
 *
 * Accepts both real-world input shapes:
 *   - grouped getAll() output: { category: { KEY: { value, type, source } } }
 *   - flat fallback maps:      { KEY: value } with no provenance metadata
 *
 * Rules:
 *   - entry.type === 'password' → dropped ALWAYS, even if source says 'config'
 *     (defensive; §5.1 names all five password-type keys env-source today)
 *   - entry.source present and !== 'config' → dropped (env/runtime excluded)
 *   - entry.source === 'config' → kept (value only)
 *   - provenance-less entry (no usable metadata): kept ONLY if the key name
 *     passes the secret-name deny filter — same fallback routes/export-routes.js
 *     shipped for its flat-map path; cannot prove config-source, so anything
 *     secret-looking dies rather than shipping.
 */
function redactSettings(getAllOutput) {
  const source = getAllOutput || {};
  const looksGrouped = Object.values(source).some(
    (v) => v && typeof v === 'object' && !Array.isArray(v)
  );

  const out = {};

  if (!looksGrouped) {
    // Flat map without provenance: keep only keys that don't look secret-bearing.
    for (const [key, value] of Object.entries(source)) {
      if (!SECRET_SETTING_NAME.test(key)) out[key] = value;
    }
    return out;
  }

  for (const entries of Object.values(source)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [key, entry] of Object.entries(entries)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        if (entry.type === 'password') continue; // §5: never serialized, no placeholders
        if (typeof entry.source === 'string' && entry.source !== 'config') continue;
        if (SECRET_SETTING_NAME.test(key)) continue; // deny-filter fallback
        out[key] = entry.value;
      } else if (!SECRET_SETTING_NAME.test(key)) {
        // Provenance-less scalar inside a grouped shape — same deny fallback.
        out[key] = entry;
      }
    }
  }

  return out;
}

module.exports = { DENY_RE, redactDeep, redactSettings };
