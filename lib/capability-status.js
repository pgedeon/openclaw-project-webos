/**
 * Capability resolver (market scan 2026-08-30 steal #2 pilot — the
 * "verified-capability snapshot pattern" Paperclip proved on sandbox
 * providers): formalizes how a feature resolves its EFFECTIVE capability —
 * declared ∩ verified ∩ configured, fail-closed — so every degradation
 * surfacing state is provable instead of hand-stringed per feature.
 *
 * PURE module: no fs, no network, no DOM, zero IO — DB-free unit-testable
 * (tests/test-capability-status.js). Consumed from both worlds:
 *  - Node CJS (routes/budget-routes.js) via require(esm) — same pattern as
 *    lib/task-conversation.js (require(esm) is default on Node >= 20.19,
 *    which is what CI runs).
 *  - Browser ESM (src/shell/native-views/mission-control-view.mjs) — this
 *    file is served verbatim under /lib/ by task-server's static handler.
 *
 * Contract:
 *  - resolveCapability(feature, checks): checks = { declared, verified,
 *    configured }, each leg a boolean or null (null = not-applicable /
 *    don't-care). Fail-closed precedence: ANY false leg ⇒ not capable, and
 *    the FIRST failed leg names the status — declared false ⇒ 'disabled',
 *    verified false ⇒ 'unreachable', configured false ⇒ 'misconfigured'.
 *    Legs that are neither boolean nor null (undefined, missing, strings,
 *    numbers, objects) count as FALSE — garbage never passes a gate it did
 *    not clear. All three legs explicitly null ⇒ capable with status
 *    'unassessed': the honest interim reserved for legacy features not yet
 *    wired to real checks (deliberate nulls required — a missing or
 *    non-object checks value is fail-closed, not unassessed).
 *  - toDegradedBody(result): maps a not-capable result to the house degrade
 *    shape { available: false, reason }. The reason vocabulary stays aligned
 *    with the enums callers already pin in tests ('no_database',
 *    'query_failed', …); per-feature overrides keep wired reasons
 *    byte-identical, and new explicit tokens exist only where the current
 *    vocabulary genuinely cannot express the failed leg.
 *  - describeForUi(result, featureLabel): one honest human string per
 *    status, generated from tables — views stop hand-stringing panel
 *    failure text.
 */

// Generic machine reasons per status. New explicit tokens — used only when
// no per-feature override expresses the leg better; the existing house
// vocabulary ('no_database', 'query_failed', …) is never redefined.
const GENERIC_REASONS = {
  disabled: 'feature_disabled',
  unreachable: 'dependency_unreachable',
  misconfigured: 'dependency_not_configured',
};

// Per-feature reason overrides preserving the EXISTING wire vocabulary
// callers pin in tests. budgets: an absent pool is the long-standing
// 'no_database' degrade (the database leg is not configured); a thrown
// query is 'query_failed' (the database is configured but verification
// failed at runtime).
const FEATURE_REASONS = {
  budgets: {
    unreachable: 'query_failed',
    misconfigured: 'no_database',
  },
};

// Generic UI clauses per status — the honest fallback when the feature's
// dependency is not nameable from the resolver's point of view.
const GENERIC_UI_CLAUSES = {
  ready: 'ready',
  unassessed: 'capability not yet assessed',
  disabled: 'feature disabled',
  unreachable: 'dependency unreachable',
  misconfigured: 'required configuration missing',
};

// Per-feature UI clauses where the dependency IS known and nameable —
// honest AND specific instead of generic.
const FEATURE_UI_CLAUSES = {
  budgets: {
    unreachable: 'database query failed',
    misconfigured: 'database not configured',
  },
  runs: {
    unreachable: 'workflow runs data unreachable',
  },
  cron: {
    unreachable: 'openclaw CLI not reachable',
  },
};

const STATUSES = Object.freeze(['ready', 'unassessed', 'disabled', 'unreachable', 'misconfigured']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize one capability leg: true/false pass through, null = don't-care,
 * anything else (undefined, missing key, garbage of any type) = false —
 * fail-closed, a leg that was never honestly asserted never passes.
 */
function leg(value) {
  if (value === null) return null;
  return value === true;
}

function reasonFor(feature, status) {
  const overrides = feature ? FEATURE_REASONS[feature] : null;
  if (overrides && typeof overrides[status] === 'string') return overrides[status];
  return GENERIC_REASONS[status];
}

/**
 * Resolve a feature's EFFECTIVE capability: declared ∩ verified ∩ configured.
 *
 * @param {string} feature machine id ('budgets', 'runs', …) selecting the
 *   per-feature reason/UI vocabulary; unknown ids get the generic tokens.
 * @param {{declared?: boolean|null, verified?: boolean|null, configured?: boolean|null}} checks
 *   declared  — the feature exists / is enabled in this build;
 *   verified  — the runtime probe (health check, query, fetch) passed;
 *   configured — the backing dependency is configured (pool, CLI, env).
 *   Each leg: boolean or null (not-applicable). Non-object checks fail closed.
 * @returns {{feature: string|null, capable: boolean, status: string, reason: string|null}}
 */
export function resolveCapability(feature, checks) {
  const featureId = typeof feature === 'string' && feature.trim() ? feature.trim() : null;
  const legs = isPlainObject(checks)
    ? { declared: leg(checks.declared), verified: leg(checks.verified), configured: leg(checks.configured) }
    : { declared: false, verified: false, configured: false };

  // Fail-closed precedence: the first false leg names the status.
  if (legs.declared === false) {
    return { feature: featureId, capable: false, status: 'disabled', reason: reasonFor(featureId, 'disabled') };
  }
  if (legs.verified === false) {
    return { feature: featureId, capable: false, status: 'unreachable', reason: reasonFor(featureId, 'unreachable') };
  }
  if (legs.configured === false) {
    return { feature: featureId, capable: false, status: 'misconfigured', reason: reasonFor(featureId, 'misconfigured') };
  }

  // No leg failed. All three explicitly null = legacy feature not yet wired
  // to real checks: capable with the honest interim status.
  if (legs.declared === null && legs.verified === null && legs.configured === null) {
    return { feature: featureId, capable: true, status: 'unassessed', reason: null };
  }
  return { feature: featureId, capable: true, status: 'ready', reason: null };
}

/**
 * Map a not-capable resolveCapability result to the house degrade shape
 * `{ available: false, reason }`. Refuses capable/garbage results loudly
 * (TypeError) — a degrade body must never be minted from a passing result.
 * @param {{capable: boolean, reason: string|null}} result
 * @returns {{available: boolean, reason: string}}
 */
export function toDegradedBody(result) {
  if (!isPlainObject(result) || result.capable !== false
    || typeof result.reason !== 'string' || !result.reason) {
    throw new TypeError('toDegradedBody expects a not-capable resolveCapability result carrying a string reason');
  }
  return { available: false, reason: result.reason };
}

/**
 * One honest human string per status, from a table — views stop
 * hand-stringing panel failure text. Per-feature clauses where the
 * dependency is nameable, generic clauses otherwise.
 * @param {{feature: string|null, status: string}} result
 * @param {string} featureLabel display label ('Budgets', 'Runs', …);
 *   falls back to the result's machine feature id, then 'Feature'.
 * @returns {string} e.g. 'Budgets — database not configured'
 */
export function describeForUi(result, featureLabel) {
  if (!isPlainObject(result) || !STATUSES.includes(result.status)) {
    throw new TypeError('describeForUi expects a resolveCapability result with a known status');
  }
  const label = typeof featureLabel === 'string' && featureLabel.trim()
    ? featureLabel.trim()
    : (typeof result.feature === 'string' && result.feature ? result.feature : 'Feature');
  const overrides = result.feature ? FEATURE_UI_CLAUSES[result.feature] : null;
  const clause = overrides && typeof overrides[result.status] === 'string'
    ? overrides[result.status]
    : GENERIC_UI_CLAUSES[result.status];
  return `${label} — ${clause}`;
}
