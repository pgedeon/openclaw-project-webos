#!/usr/bin/env node
/**
 * Focused tests for one-click actions slice 2 (DB-free):
 * src/shell/action-client.mjs pure surface + src/shell/recent-actions-tray.mjs
 * navigation mapping. Run: node tests/test-action-client.js
 *
 * Covered (work-order slice-2 items reachable without a browser):
 * - ACTION_CATALOG parity with the authoritative server registry
 *   (lib/action-registry.js): kinds, severity, confirmMode, targetType,
 *   rollbackHint; LOW⇔NONE / HIGH⇔HOLD_CONFIRM invariants (AC10 shape).
 * - buildEnvelope: UUID-shaped unique actionIds per intent, kind/target/params
 *   preserved, unknown kind throws loudly.
 * - describeOutcome response table: executed / duplicate / budget_blocked /
 *   rejected_governance / stale_retry / invalid_action / execution_failed /
 *   no-database degradation.
 * - formatBudgetBanner: budget name + period_key + pct present; hard_stop
 *   mentions cancelled in-flight runs (work order: amber banner w/ name+period).
 * - Receipt store: newest-first ring buffer capped at 50, subscriber notified,
 *   duplicate action_id ignored.
 * - loadRecentReceipts: api-client path + house degradation contract mapping.
 * - HOLD_CONFIRM_MS === 1200 (brief §3.2 ≥1.2 s).
 * - navigateTargetFor tray routing (run → workflows ?runId=, task → tasks,
 *   approval → approvals).
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadClientModule() {
  return import(pathToFileURL(path.join(__dirname, '..', 'src', 'shell', 'action-client.mjs')).href);
}

function testCatalogParity(client) {
  const registry = require('../lib/action-registry');

  assert.deepStrictEqual(
    Object.keys(client.ACTION_CATALOG).sort(),
    [...registry.ACTION_KINDS].sort(),
    'client catalog covers exactly the server catalog'
  );

  for (const [kind, meta] of Object.entries(client.ACTION_CATALOG)) {
    const entry = registry.ACTION_REGISTRY[kind];
    assert.ok(entry, `${kind} exists server-side`);
    assert.strictEqual(meta.severity, entry.severity, `${kind} severity parity`);
    assert.strictEqual(meta.confirmMode, entry.confirmMode, `${kind} confirmMode parity`);
    assert.strictEqual(meta.targetType, entry.targetType, `${kind} targetType parity`);
    assert.strictEqual(meta.rollbackHint, entry.rollbackHint, `${kind} rollbackHint parity`);
    assert.ok(meta.label && meta.label.length > 0, `${kind} has a UI label`);
  }

  // Severity→mode invariants hold on the client mirror too (§3.2).
  for (const meta of Object.values(client.ACTION_CATALOG)) {
    if (meta.confirmMode === 'NONE') assert.strictEqual(meta.severity, 'LOW');
    if (meta.severity === 'HIGH') assert.strictEqual(meta.confirmMode, 'HOLD_CONFIRM');
    if (meta.confirmMode === 'HOLD_CONFIRM') assert.strictEqual(meta.severity, 'HIGH');
  }

  // Confirm-mode derivation helpers agree with the catalog.
  assert.strictEqual(client.confirmModeFor('run.cancel'), 'HOLD_CONFIRM');
  assert.strictEqual(client.confirmModeFor('task.assign'), 'NONE');
  assert.strictEqual(client.confirmModeFor('fleet.nuke'), null);
  assert.strictEqual(client.catalogFor('fleet.nuke'), null);
}

function testBuildEnvelope(client) {
  const e1 = client.buildEnvelope({ kind: 'run.cancel', targetId: 'run-abc', params: { reason: 'stale' } });
  const e2 = client.buildEnvelope({ kind: 'run.cancel', targetId: 'run-abc', params: { reason: 'stale' } });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(e1.actionId, UUID, 'actionId is a UUID v4 shape');
  assert.match(e2.actionId, UUID);
  assert.notStrictEqual(e1.actionId, e2.actionId, 'each confirmed intent mints a fresh actionId');

  assert.strictEqual(e1.kind, 'run.cancel');
  assert.strictEqual(e1.targetId, 'run-abc');
  assert.deepStrictEqual(e1.params, { reason: 'stale' });

  // Deliberate repeat = new actionId, identical kind/target/params (AC5 shape).
  assert.deepStrictEqual(
    { ...e1, actionId: null }, { ...e2, actionId: null },
    'repeat differs only by actionId'
  );

  assert.throws(() => client.buildEnvelope({ kind: 'fleet.nuke', targetId: 'x' }), /unknown_kind/);
  assert.throws(() => client.buildEnvelope({ kind: 'run.cancel', targetId: '' }), /targetId/);
}

function testDescribeOutcome(client) {
  // Executed.
  let o = client.describeOutcome({ status: 200, payload: { receipt: { outcome: 'executed', rollback_hint: 'hint' } } });
  assert.strictEqual(o.tone, 'success');
  assert.strictEqual(o.receipt.rollback_hint, 'hint');

  // Duplicate replay.
  o = client.describeOutcome({ status: 200, payload: { receipt: { outcome: 'executed' }, duplicate: true } });
  assert.strictEqual(o.tone, 'info');
  assert.strictEqual(o.duplicate, true);

  // Budget block — structured verdict carried through.
  const verdict = {
    error: 'budget_blocked', action: 'pause_new_runs',
    budgets: [{ name: 'affiliate monthly cap', period_key: '2026-08', pct_of_cap: 122.5 }],
  };
  o = client.describeOutcome({ status: 422, payload: verdict });
  assert.strictEqual(o.tone, 'blocked');
  assert.strictEqual(o.verdict, verdict);
  assert.ok(o.message.includes('affiliate monthly cap'));

  // Governance denial carries the typed receipt.
  o = client.describeOutcome({ status: 403, payload: { error: 'rejected_governance', reason: 'no cancel_run capability', receipt: { outcome: 'rejected_governance' } } });
  assert.strictEqual(o.tone, 'error');
  assert.strictEqual(o.receipt.outcome, 'rejected_governance');
  assert.ok(o.message.includes('no cancel_run capability'));

  // Staleness guard.
  o = client.describeOutcome({ status: 409, payload: { error: 'stale_retry' } });
  assert.strictEqual(o.tone, 'warn');

  // Envelope refusal.
  o = client.describeOutcome({ status: 400, payload: { error: 'invalid_action', details: ['params.owner is required'] } });
  assert.strictEqual(o.tone, 'error');
  assert.ok(o.message.includes('params.owner is required'));

  // Executor failure.
  o = client.describeOutcome({ status: 400, payload: { error: 'execution_failed', message: 'Workflow run not found', receipt: { outcome: 'failed' } } });
  assert.strictEqual(o.tone, 'error');
  assert.strictEqual(o.message, 'Workflow run not found');

  // House read-contract degradation.
  o = client.describeOutcome({ status: 503, payload: { available: false, reason: 'no_database' } });
  assert.strictEqual(o.tone, 'unavailable');
  assert.strictEqual(o.message, 'no_database');

  // Unknown shape still answers honestly.
  o = client.describeOutcome({ status: 500, payload: null });
  assert.strictEqual(o.tone, 'error');
}

function testBudgetBanner(client) {
  const banner = client.formatBudgetBanner({
    action: 'pause_new_runs',
    budgets: [{ name: 'affiliate monthly cap', period_key: '2026-08', pct_of_cap: 122.5 }],
  });
  assert.ok(banner.includes('affiliate monthly cap'), 'banner names the budget');
  assert.ok(banner.includes('2026-08'), 'banner names the period');
  assert.ok(banner.includes('122.5%'), 'banner shows pct of cap');
  assert.ok(banner.includes('rollover'), 'pause_new_runs explains automatic drain');

  const hardStop = client.formatBudgetBanner({
    action: 'hard_stop',
    budgets: [{ name: 'fleet weekly', period_key: '2026-W35', pct_of_cap: 100 }],
  });
  assert.ok(hardStop.includes('cancelled by the dispatcher'), 'hard_stop explains in-flight cancellations');

  // Empty verdict degrades to a non-crashing string.
  assert.ok(typeof client.formatBudgetBanner({}) === 'string');
}

async function testReceiptStore(client) {
  const seen = [];
  const unsubscribe = client.subscribeReceipts((r) => seen.push(r.action_id));

  for (let i = 0; i < 60; i += 1) {
    client.recordReceipt({ action_id: `id-${i}`, kind: 'run.cancel', outcome: 'executed' });
  }
  let snapshot = client.getRecentReceipts();
  assert.strictEqual(snapshot.length, 50, 'ring buffer capped at 50');
  assert.strictEqual(snapshot[0].action_id, 'id-59', 'newest first');
  assert.strictEqual(snapshot[49].action_id, 'id-10');
  assert.deepStrictEqual(seen, Array.from({ length: 60 }, (_, i) => `id-${i}`), 'subscriber sees every insert');

  // Duplicate action_id is ignored (replays never double-list).
  client.recordReceipt({ action_id: 'id-59', kind: 'run.cancel', outcome: 'executed' });
  assert.strictEqual(client.getRecentReceipts().length, 50);

  unsubscribe();
  client.recordReceipt({ action_id: 'post-unsub', kind: 'run.cancel', outcome: 'executed' });
  assert.deepStrictEqual(seen.slice(-1), ['id-59'], 'unsubscribed listener stops receiving');
  assert.strictEqual(client.getRecentReceipts()[0].action_id, 'post-unsub');
}

async function testLoadRecentReceipts(client) {
  // Happy path via an api client exposing actions.recent().
  const receipts = [
    { action_id: 'a-1', kind: 'run.cancel', outcome: 'executed', created_at: '2026-08-24T10:00:00Z' },
    { action_id: 'a-2', kind: 'task.assign', outcome: 'executed', created_at: '2026-08-24T09:59:00Z' },
  ];
  let calledWith = null;
  const api = { actions: { recent: async (params) => { calledWith = params; return { available: true, receipts }; } } };
  const res = await client.loadRecentReceipts(api, 10);
  assert.deepStrictEqual(calledWith, { limit: 10 });
  assert.strictEqual(res.available, true);
  assert.strictEqual(res.receipts.length, 2);
  assert.strictEqual(res.receipts[0].action_id, 'a-1');

  // Degradation contracts pass through named reasons.
  for (const reason of ['no_database', 'receipts_unavailable', 'query_failed']) {
    const degraded = await client.loadRecentReceipts(
      { actions: { recent: async () => ({ available: false, reason }) } },
      10
    );
    assert.strictEqual(degraded.available, false);
    assert.strictEqual(degraded.reason, reason);
    assert.deepStrictEqual(degraded.receipts, []);
  }

  // Throwing api degrades without throwing.
  const failed = await client.loadRecentReceipts(
    { actions: { recent: async () => { throw new Error('boom'); } } },
    10
  );
  assert.strictEqual(failed.available, false);
  assert.strictEqual(failed.reason, 'query_failed');
}

function testHoldThresholdAndTrayRouting(client, trayModule) {
  assert.strictEqual(client.HOLD_CONFIRM_MS, 1200, 'hold threshold is 1.2 s (brief §3.2)');

  const { navigateTargetFor } = trayModule;
  assert.deepStrictEqual(
    navigateTargetFor({ kind: 'run.cancel', target_id: 'run-9' }),
    { view: 'workflows', params: { runId: 'run-9' } }
  );
  assert.deepStrictEqual(
    navigateTargetFor({ kind: 'run.redispatch', target_id: 'run-9' }),
    { view: 'workflows', params: { runId: 'run-9' } }
  );
  assert.deepStrictEqual(
    navigateTargetFor({ kind: 'task.assign', target_id: 'task-3' }),
    { view: 'tasks', params: { taskId: 'task-3' } }
  );
  assert.deepStrictEqual(
    navigateTargetFor({ kind: 'approval.decide', target_id: 'ap-7' }),
    { view: 'approvals', params: {} }
  );
  assert.strictEqual(navigateTargetFor(null), null);
}

// ── Runner ─────────────────────────────────────────────────────

(async function main() {
  let passed = 0;
  let failed = 0;
  const tests = [
    ['catalog parity with lib/action-registry.js', () => testCatalogParity(client)],
    ['buildEnvelope minting + validation', () => testBuildEnvelope(client)],
    ['describeOutcome response table', () => testDescribeOutcome(client)],
    ['formatBudgetBanner name+period+pct', () => testBudgetBanner(client)],
    ['receipt ring buffer + subscribers', () => testReceiptStore(client)],
    ['loadRecentReceipts happy + degradation', () => testLoadRecentReceipts(client)],
    ['hold threshold + tray navigation map', () => testHoldThresholdAndTrayRouting(client, trayModule)],
  ];
  let client;
  let trayModule;
  try {
    client = await loadClientModule();
    trayModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'shell', 'recent-actions-tray.mjs')).href);
  } catch (err) {
    console.error('FAIL module import');
    console.error(err);
    process.exit(1);
  }
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(err);
    }
  }
  console.log(`\n${passed}/${tests.length} assertion groups passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
