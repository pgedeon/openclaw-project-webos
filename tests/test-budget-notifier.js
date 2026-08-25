#!/usr/bin/env node
/**
 * DB-free tests for the budget breach channel notifier (budget-ledger slice 5).
 *
 * Covers docs/briefs/budget-channel-alerts.md §8 acceptance criteria:
 * pure formatter output, in-memory seen-set dedupe, kind/mute/disabled
 * gating, send-failure degradation with log-once suppression, secret
 * absence, and the gateway `send` RPC contract pin.
 * No database, no network, no gateway.
 */

const assert = require('assert');
const {
  formatBudgetAlertMessage,
  sanitizeBudgetName,
  createBudgetChannelNotifier,
} = require('../lib/budget-channel-notifier');

let passed = 0;
let failed = 0;
const asyncTests = [];

function test(name, fn) {
  // Async-aware: promise-returning bodies run after the sync batch, awaited.
  let result;
  try {
    result = fn();
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
    return;
  }
  if (result && typeof result.then === 'function') {
    asyncTests.push(
      result.then(
        () => {
          passed++;
          console.log(`  ✓ ${name}`);
        },
        (err) => {
          failed++;
          console.error(`  ✗ ${name}: ${err && err.message}`);
        }
      )
    );
    return;
  }
  passed++;
  console.log(`  ✓ ${name}`);
}

// ─── Fixtures ─────────────────────────────────────────────────────

function baseFrame(overrides = {}) {
  return {
    type: 'budget:breach',
    id: '11111111-1111-1111-1111-111111111111:2026-08:paused',
    budget_id: '11111111-1111-1111-1111-111111111111',
    budget_name: 'affiliate-editorial monthly cap',
    scope: 'agent',
    scope_id: 'affiliate-editorial',
    period: 'monthly',
    period_key: '2026-08',
    event_kind: 'paused',
    action: 'pause_new_runs',
    spend_usd: 123.45,
    spend_tokens: 0,
    cap_usd: 100,
    cap_tokens: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function enabledConfig(overrides = {}) {
  return {
    channel: 'whatsapp',
    target: '+491700000000',
    eventKinds: ['paused', 'hard_stopped'],
    mutedBudgets: [],
    dashboardUrlBase: '',
    ...overrides,
  };
}

/** Fake GatewayClient double WITHOUT sendDelivery — pins the raw RPC contract. */
function rawRpcClient() {
  const calls = [];
  return {
    calls,
    _request(method, params) {
      calls.push({ method, params });
      return Promise.resolve({ ok: true });
    },
  };
}

/** Fake client WITH a sendDelivery wrapper (production shape). */
function wrapperClient(opts = {}) {
  const calls = [];
  return {
    calls,
    sendDelivery({ channel, to, message }) {
      if (opts.throwSync) throw new Error('sync boom');
      if (opts.reject) return Promise.reject(new Error('async boom'));
      calls.push({ channel, to, message });
      return Promise.resolve({ ok: true });
    },
  };
}

// ─── Formatting ───────────────────────────────────────────────────

console.log('\n=== formatBudgetAlertMessage ===');

test('AC1: USD frame renders $X.YY of $Y.YY cap with rounded percent', () => {
  const msg = formatBudgetAlertMessage(baseFrame(), enabledConfig());
  assert.ok(msg.includes('⏸ PAUSED — Budget "affiliate-editorial monthly cap"'), msg);
  assert.ok(msg.includes('Scope: agent/affiliate-editorial · Period: monthly (2026-08)'), msg);
  assert.ok(msg.includes('Spend: $123.45 of $100.00 cap (123%)'), msg);
  assert.ok(msg.includes('Action: pause_new_runs — new runs queue until cap raised or period rolls'), msg);
});

test('AC1b: percent rounds to nearest integer; spend/cap labels match frame values', () => {
  const msg = formatBudgetAlertMessage(baseFrame({ spend_usd: 74, cap_usd: 90 }), enabledConfig());
  assert.ok(msg.includes('Spend: $74.00 of $90.00 cap (82%)'), msg);
});

test('AC2: token-cap frame renders locale-grouped counts, no $ sign', () => {
  const msg = formatBudgetAlertMessage(
    baseFrame({ spend_usd: 0, cap_usd: null, spend_tokens: 1234567, cap_tokens: 1000000 }),
    enabledConfig()
  );
  assert.ok(msg.includes('Spend: 1,234,567 of 1,000,000 tokens cap (123%)'), msg);
  assert.ok(!msg.includes('$'), msg);
});

test('AC3: fleet scope renders bare; agent scope renders agent/<id>', () => {
  const fleet = formatBudgetAlertMessage(baseFrame({ scope: 'fleet', scope_id: null }), enabledConfig());
  assert.ok(fleet.includes('Scope: fleet ·'), fleet);
  const agent = formatBudgetAlertMessage(baseFrame(), enabledConfig());
  assert.ok(agent.includes('Scope: agent/affiliate-editorial ·'), agent);
});

test('AC4: hostile name truncates to 80 sanitized chars, skeleton line count unchanged', () => {
  const hostile = baseFrame({ budget_name: 'x\n'.repeat(120) + 'END' });
  const baseline = formatBudgetAlertMessage(baseFrame(), enabledConfig()).split('\n').length;
  const msg = formatBudgetAlertMessage(hostile, enabledConfig());
  assert.strictEqual(msg.split('\n').length, baseline);
  assert.ok(!msg.includes('\nx\nx'), 'raw newlines must not survive');
  const nameLine = msg.split('\n')[0];
  const extracted = nameLine.match(/Budget "(.*)"$/);
  assert.ok(extracted && extracted[1].length <= 80, `name too long: ${extracted && extracted[1].length}`);
  assert.ok(sanitizeBudgetName('a\u0000\u0007b') === 'a b', 'control chars stripped');
});

test('unknown event_kind falls back to raw kind label', () => {
  const msg = formatBudgetAlertMessage(baseFrame({ event_kind: 'weird', action: 'weird' }), enabledConfig());
  assert.ok(msg.startsWith('weird — Budget "'), msg);
});

test('AC11: empty dashboardUrlBase omits Dashboard line entirely', () => {
  const msg = formatBudgetAlertMessage(baseFrame(), enabledConfig({ dashboardUrlBase: '' }));
  assert.ok(!msg.includes('Dashboard:'), msg);
});

test('Dashboard line renders configured URL base with budgets deep-link', () => {
  const msg = formatBudgetAlertMessage(baseFrame(), enabledConfig({ dashboardUrlBase: 'http://192.168.0.81:8120/' }));
  assert.ok(msg.includes('Dashboard: http://192.168.0.81:8120/?view=budgets'), msg);
});

test('hard_stopped frame uses HARD STOP label and hard_stop clause', () => {
  const msg = formatBudgetAlertMessage(
    baseFrame({ event_kind: 'hard_stopped', action: 'hard_stop' }),
    enabledConfig()
  );
  assert.ok(msg.includes('🛑 HARD STOP — Budget "'), msg);
  assert.ok(msg.includes('in-flight runs cancelled'), msg);
});

test('null/unformattable frame returns null', () => {
  assert.strictEqual(formatBudgetAlertMessage(null, enabledConfig()), null);
  assert.strictEqual(formatBudgetAlertMessage({}, enabledConfig()), null);
});

// ─── deliverFrame gating + dedupe + degradation ──────────────────

function makeNotifier(configOverrides, senderOpts, logSink) {
  const client = wrapperClient(senderOpts || {});
  const logs = logSink || [];
  const notifier = createBudgetChannelNotifier({
    gatewayClient: client,
    configSource: () => enabledConfig(configOverrides || {}),
    log: {
      log: (...a) => logs.push(['log', ...a]),
      error: (...a) => logs.push(['error', ...a]),
      warn: (...a) => logs.push(['warn', ...a]),
    },
    now: (() => { let t = 1_000_000; return () => (t += 60_000); })(),
  });
  return { notifier, client, logs };
}

console.log('\n=== createBudgetChannelNotifier.deliverFrame ===');

test('happy path: one sendDelivery call with verbatim formatted text', async () => {
  const { notifier, client } = makeNotifier();
  const res = await notifier.deliverFrame(baseFrame());
  assert.deepStrictEqual(res, { sent: true });
  assert.strictEqual(client.calls.length, 1);
  assert.strictEqual(client.calls[0].channel, 'whatsapp');
  assert.strictEqual(client.calls[0].to, '+491700000000');
  assert.ok(client.calls[0].message.includes('⏸ PAUSED'), client.calls[0].message);
});

test('AC8: master off ⇒ zero invocations, zero logs', async () => {
  const logs = [];
  const { notifier, client } = makeNotifier({ channel: 'off' }, {}, logs);
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.sent, false);
  assert.strictEqual(res.skipped, true);
  assert.strictEqual(res.reason, 'disabled');
  assert.strictEqual(client.calls.length, 0);
  assert.strictEqual(logs.length, 0);
});

test('AC8b: channels unset ⇒ zero invocations, zero logs', async () => {
  const logs = [];
  const { notifier, client } = makeNotifier({ channel: '' }, {}, logs);
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.reason, 'disabled');
  assert.strictEqual(client.calls.length, 0);
  assert.strictEqual(logs.length, 0);
});

test('AC6: kind outside eventKinds ⇒ zero sender invocations', async () => {
  const { notifier, client } = makeNotifier();
  const res = await notifier.deliverFrame(baseFrame({ event_kind: 'warned', action: 'warn' }));
  assert.strictEqual(res.reason, 'kind_filtered');
  assert.strictEqual(client.calls.length, 0);
});

test('AC7: muted budget id ⇒ zero invocations', async () => {
  const { notifier, client } = makeNotifier({
    mutedBudgets: ['11111111-1111-1111-1111-111111111111'],
  });
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.reason, 'muted');
  assert.strictEqual(client.calls.length, 0);
});

test('AC5: same (budget_id, period_key, event_kind) twice ⇒ one send; different key/kind ⇒ sends', async () => {
  const { notifier, client } = makeNotifier();
  await notifier.deliverFrame(baseFrame());
  const dup = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(dup.reason, 'duplicate');
  await notifier.deliverFrame(baseFrame({ period_key: '2026-09' }));
  await notifier.deliverFrame(baseFrame({ event_kind: 'hard_stopped', action: 'hard_stop' }));
  assert.strictEqual(client.calls.length, 3);
});

test('AC9: sync-throwing sender resolves {sent:false}, no exception escapes', async () => {
  const logs = [];
  const { notifier } = makeNotifier({}, { throwSync: true }, logs);
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.sent, false);
  assert.strictEqual(res.reason, 'send_failed');
  assert.strictEqual(logs.filter(([lvl]) => lvl === 'error').length, 1);
});

test('AC9b: rejecting sender degrades identically', async () => {
  const { notifier } = makeNotifier({}, { reject: true });
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.sent, false);
  assert.strictEqual(res.reason, 'send_failed');
});

test('AC9c: second failure inside window produces no repeat error log; success resets suppression', async () => {
  const logs = [];
  const { notifier } = makeNotifier({}, { throwSync: true }, logs);
  await notifier.deliverFrame(baseFrame());
  await notifier.deliverFrame(baseFrame({ period_key: '2026-09' }));
  assert.strictEqual(logs.filter(([lvl]) => lvl === 'error').length, 1, 'log-once window');
  // Success resets suppression state.
  const recovering = makeNotifier({}, {}, logs);
  await recovering.notifier.deliverFrame(baseFrame());
  assert.strictEqual(recovering.client.calls.length, 1);
});

test('no gateway client ⇒ silent degrade with single log-once line', async () => {
  const logs = [];
  const notifier = createBudgetChannelNotifier({
    getClient: () => null,
    configSource: () => enabledConfig(),
    log: { error: (...a) => logs.push(a.join(' ')) },
  });
  const res = await notifier.deliverFrame(baseFrame());
  assert.strictEqual(res.reason, 'no_client');
  await notifier.deliverFrame(baseFrame({ period_key: '2026-09' }));
  assert.strictEqual(logs.length, 1);
});

test('AC10: canary gateway token never appears in any formatted message', () => {
  const canary = 'sk-gw-canary-9f2c-secret-token-value';
  process.env.OPENCLAW_GATEWAY_TOKEN = canary;
  try {
    for (const kind of ['paused', 'hard_stopped', 'warned']) {
      const action = kind === 'paused' ? 'pause_new_runs' : kind === 'hard_stopped' ? 'hard_stop' : 'warn';
      const msg = formatBudgetAlertMessage(
        baseFrame({ event_kind: kind, action }),
        enabledConfig({ dashboardUrlBase: 'http://staging.example' })
      );
      assert.ok(!msg.includes(canary), `token leaked for kind ${kind}`);
    }
  } finally {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
  }
});

test('AC12: raw-RPC double receives _request("send", {channel,to,message,idempotencyKey})', async () => {
  const client = rawRpcClient();
  const notifier = createBudgetChannelNotifier({
    gatewayClient: client,
    configSource: () => enabledConfig(),
  });
  await notifier.deliverFrame(baseFrame());
  assert.strictEqual(client.calls.length, 1);
  const { method, params } = client.calls[0];
  assert.strictEqual(method, 'send');
  assert.strictEqual(params.channel, 'whatsapp');
  assert.strictEqual(params.to, '+491700000000');
  assert.ok(typeof params.idempotencyKey === 'string' && params.idempotencyKey.length >= 32, JSON.stringify(params.idempotencyKey));
  assert.ok(Object.keys(params).every((k) => ['channel', 'to', 'message', 'idempotencyKey'].includes(k)), Object.keys(params).join(','));
});

// ─── Summary ──────────────────────────────────────────────────────

(async () => {
  await Promise.all(asyncTests);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
