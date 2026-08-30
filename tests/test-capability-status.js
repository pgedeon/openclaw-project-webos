#!/usr/bin/env node
/**
 * Focused DB-free tests for lib/capability-status.js — the pure capability
 * resolver behind the market-scan-2026-08-30 steal #2 pilot (declared ∩
 * verified ∩ configured, fail-closed).
 * Run: node tests/test-capability-status.js
 *
 * Covered:
 * - resolveCapability precedence matrix: each leg failing alone names its
 *   status (disabled/unreachable/misconfigured); multiple legs failing name
 *   the FIRST failed leg (declared > verified > configured).
 * - Boolean/null tri-state: null legs are don't-care (never fail); a mix of
 *   true + null resolves ready.
 * - All-null legacy case: explicit {null, null, null} ⇒ capable with status
 *   'unassessed' (honest migration path for features not yet wired).
 * - Fail-closed on garbage: non-boolean non-null legs, missing legs, and
 *   non-object checks all resolve NOT capable.
 * - toDegradedBody round-trip: budget shapes preserve the EXISTING wire
 *   reasons byte-identically ('no_database', 'query_failed'); generic
 *   features get the new explicit tokens; capable/garbage results throw.
 * - describeForUi output table: per-feature clauses where the dependency is
 *   nameable (budgets/runs/cron), generic clauses otherwise, label fallback.
 */

const assert = require('assert');
const {
  resolveCapability,
  toDegradedBody,
  describeForUi,
} = require('../lib/capability-status');

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// ── Precedence matrix ───────────────────────────────────────────

check('each leg failing alone names its status', () => {
  assert.deepStrictEqual(
    resolveCapability('x', { declared: false, verified: null, configured: null }),
    { feature: 'x', capable: false, status: 'disabled', reason: 'feature_disabled' }
  );
  assert.deepStrictEqual(
    resolveCapability('x', { declared: true, verified: false, configured: null }),
    { feature: 'x', capable: false, status: 'unreachable', reason: 'dependency_unreachable' }
  );
  assert.deepStrictEqual(
    resolveCapability('x', { declared: null, verified: null, configured: false }),
    { feature: 'x', capable: false, status: 'misconfigured', reason: 'dependency_not_configured' }
  );
});

check('multiple legs failing name the FIRST failed leg', () => {
  // declared wins over everything.
  assert.strictEqual(resolveCapability('x', { declared: false, verified: false, configured: false }).status, 'disabled');
  // verified wins over configured.
  assert.strictEqual(resolveCapability('x', { declared: true, verified: false, configured: false }).status, 'unreachable');
  assert.strictEqual(resolveCapability('x', { declared: null, verified: false, configured: false }).status, 'unreachable');
  // configured alone when the first two legs pass.
  assert.strictEqual(resolveCapability('x', { declared: true, verified: true, configured: false }).status, 'misconfigured');
  assert.strictEqual(resolveCapability('x', { declared: null, verified: null, configured: false }).status, 'misconfigured');
});

check('all-true resolves ready', () => {
  assert.deepStrictEqual(
    resolveCapability('x', { declared: true, verified: true, configured: true }),
    { feature: 'x', capable: true, status: 'ready', reason: null }
  );
});

// ── Boolean/null tri-state ──────────────────────────────────────

check('null legs are don\'t-care, never fail', () => {
  for (const checks of [
    { declared: true, verified: null, configured: null },
    { declared: null, verified: true, configured: null },
    { declared: null, verified: null, configured: true },
    { declared: true, verified: true, configured: null },
    { declared: true, verified: null, configured: true },
    { declared: null, verified: true, configured: true },
  ]) {
    const r = resolveCapability('x', checks);
    assert.strictEqual(r.capable, true, JSON.stringify(checks));
    assert.strictEqual(r.status, 'ready', JSON.stringify(checks));
    assert.strictEqual(r.reason, null, JSON.stringify(checks));
  }
});

check('all-null legacy case resolves capable/unassessed', () => {
  assert.deepStrictEqual(
    resolveCapability('legacy-feature', { declared: null, verified: null, configured: null }),
    { feature: 'legacy-feature', capable: true, status: 'unassessed', reason: null }
  );
});

// ── Fail-closed on garbage ──────────────────────────────────────

check('garbage leg values (non-boolean non-null) fail closed', () => {
  // Each garbage leg alone fails as its own status.
  assert.strictEqual(resolveCapability('x', { declared: 'yes', verified: null, configured: null }).status, 'disabled');
  assert.strictEqual(resolveCapability('x', { declared: true, verified: 1, configured: null }).status, 'unreachable');
  assert.strictEqual(resolveCapability('x', { declared: true, verified: true, configured: {} }).status, 'misconfigured');
  // All-garbage: first leg names it.
  const allGarbage = resolveCapability('x', { declared: 'yes', verified: 1, configured: {} });
  assert.strictEqual(allGarbage.capable, false);
  assert.strictEqual(allGarbage.status, 'disabled');
});

check('missing legs and non-object checks fail closed (never unassessed)', () => {
  // Missing keys are undefined ⇒ false, NOT don't-care: only explicit nulls
  // opt out, so a half-wired caller can never silently pass.
  assert.strictEqual(resolveCapability('x', {}).capable, false);
  assert.strictEqual(resolveCapability('x', {}).status, 'disabled');
  assert.strictEqual(resolveCapability('x', { declared: true }).capable, false);
  assert.strictEqual(resolveCapability('x', { declared: true }).status, 'unreachable');
  assert.strictEqual(resolveCapability('x', null).capable, false);
  assert.strictEqual(resolveCapability('x', null).status, 'disabled');
  assert.strictEqual(resolveCapability('x', 'budgets').capable, false);
  assert.strictEqual(resolveCapability('x', undefined).status, 'disabled');
  assert.strictEqual(resolveCapability('x', []).status, 'disabled');
});

check('garbage feature id degrades to generic vocabulary, never throws', () => {
  const r = resolveCapability(null, { declared: true, verified: false, configured: null });
  assert.strictEqual(r.feature, null);
  assert.strictEqual(r.reason, 'dependency_unreachable');
  const numeric = resolveCapability(42, { declared: true, verified: false, configured: null });
  assert.strictEqual(numeric.feature, null);
  assert.strictEqual(numeric.reason, 'dependency_unreachable');
});

// ── toDegradedBody round-trip ───────────────────────────────────

check('budget shapes preserve the EXISTING wire reasons byte-identically', () => {
  // Pool absent ⇒ configured:false ⇒ 'no_database' (the HTTP 200 degrade
  // budget-routes has answered since slice 1 — pinned by test-budget-routes).
  const noDb = resolveCapability('budgets', { declared: true, verified: null, configured: false });
  assert.deepStrictEqual(toDegradedBody(noDb), { available: false, reason: 'no_database' });
  // Query threw ⇒ verified:false ⇒ 'query_failed'.
  const qf = resolveCapability('budgets', { declared: true, verified: false, configured: true });
  assert.deepStrictEqual(toDegradedBody(qf), { available: false, reason: 'query_failed' });
});

check('generic features get the new explicit tokens', () => {
  assert.deepStrictEqual(
    toDegradedBody(resolveCapability('unknown-feature', { declared: true, verified: false, configured: null })),
    { available: false, reason: 'dependency_unreachable' }
  );
  assert.deepStrictEqual(
    toDegradedBody(resolveCapability('unknown-feature', { declared: false, verified: null, configured: null })),
    { available: false, reason: 'feature_disabled' }
  );
  assert.deepStrictEqual(
    toDegradedBody(resolveCapability('unknown-feature', { declared: true, verified: true, configured: false })),
    { available: false, reason: 'dependency_not_configured' }
  );
});

check('toDegradedBody refuses capable/garbage results loudly', () => {
  assert.throws(() => toDegradedBody(resolveCapability('x', { declared: true, verified: true, configured: true })), /not-capable/);
  assert.throws(() => toDegradedBody(resolveCapability('x', { declared: null, verified: null, configured: null })), /not-capable/);
  assert.throws(() => toDegradedBody(null), /not-capable/);
  assert.throws(() => toDegradedBody({ capable: false, reason: null }), /not-capable/);
  assert.throws(() => toDegradedBody({ capable: false }), /not-capable/);
  assert.throws(() => toDegradedBody('no_database'), /not-capable/);
});

// ── describeForUi output table ──────────────────────────────────

check('per-feature clauses where the dependency is nameable', () => {
  // The work-order example shape, exactly.
  assert.strictEqual(
    describeForUi(resolveCapability('budgets', { declared: true, verified: null, configured: false }), 'Budgets'),
    'Budgets — database not configured'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('budgets', { declared: true, verified: false, configured: true }), 'Budgets'),
    'Budgets — database query failed'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('runs', { declared: true, verified: false, configured: null }), 'Runs'),
    'Runs — workflow runs data unreachable'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('cron', { declared: true, verified: false, configured: null }), 'Cron'),
    'Cron — openclaw CLI not reachable'
  );
});

check('generic clauses for unknown features and non-degrade statuses', () => {
  assert.strictEqual(
    describeForUi(resolveCapability('x', { declared: true, verified: false, configured: null }), 'Fleet'),
    'Fleet — dependency unreachable'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('x', { declared: false, verified: null, configured: null }), 'Fleet'),
    'Fleet — feature disabled'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('x', { declared: true, verified: true, configured: false }), 'Fleet'),
    'Fleet — required configuration missing'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('x', { declared: true, verified: true, configured: true }), 'Fleet'),
    'Fleet — ready'
  );
  assert.strictEqual(
    describeForUi(resolveCapability('x', { declared: null, verified: null, configured: null }), 'Fleet'),
    'Fleet — capability not yet assessed'
  );
});

check('describeForUi label fallback and garbage refusal', () => {
  // No label ⇒ machine feature id; neither ⇒ 'Feature'.
  assert.strictEqual(
    describeForUi(resolveCapability('budgets', { declared: true, verified: null, configured: false })),
    'budgets — database not configured'
  );
  assert.strictEqual(
    describeForUi(resolveCapability(null, { declared: true, verified: false, configured: null })),
    'Feature — dependency unreachable'
  );
  assert.throws(() => describeForUi(null, 'X'), /known status/);
  assert.throws(() => describeForUi({ status: 'exploded' }, 'X'), /known status/);
  assert.throws(() => describeForUi('nope', 'X'), /known status/);
});

console.log(`✅ tests/test-capability-status.js — all ${passed} checks passed`);
