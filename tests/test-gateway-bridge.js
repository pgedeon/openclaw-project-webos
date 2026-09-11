#!/usr/bin/env node
/**
 * Focused tests for lib/gateway-bridge.js.
 * Run: node tests/test-gateway-bridge.js
 *
 * Covers the pure surface: config resolution (disabled paths + env overrides),
 * gateway event normalization, dedupe logic, and envelope-seq gap detection.
 * No network, no WebSocket connections.
 */

const assert = require('assert');
const {
  resolveBridgeConfig,
  normalizeGatewayEvent,
  createDedupeCache,
  dedupeEvent,
  detectSeqGap,
} = require('../lib/gateway-bridge');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exit(1);
  }
}

// ── resolveBridgeConfig ──────────────────────────────────────────────────

run('resolveBridgeConfig: disabled cleanly when no env and no config file', () => {
  const cfg = resolveBridgeConfig({ env: {}, gatewayConfig: null });
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.url, null);
  assert.strictEqual(cfg.auth, null);
});

run('resolveBridgeConfig: disabled cleanly when config file has no gateway block', () => {
  const cfg = resolveBridgeConfig({ env: {}, gatewayConfig: {} });
  assert.strictEqual(cfg.enabled, false);
});

run('resolveBridgeConfig: derives ws URL from openclaw.json port', () => {
  const cfg = resolveBridgeConfig({
    env: {},
    gatewayConfig: { gateway: { port: 18789 } },
  });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.url, 'ws://127.0.0.1:18789');
  assert.strictEqual(cfg.source, 'config');
});

run('resolveBridgeConfig: password auth from openclaw.json', () => {
  const cfg = resolveBridgeConfig({
    env: {},
    gatewayConfig: { gateway: { port: 18789, auth: { mode: 'password', password: 'sekrit' } } },
  });
  assert.deepStrictEqual(cfg.auth, { password: 'sekrit' });
  assert.strictEqual(cfg.authSource, 'config');
});

run('resolveBridgeConfig: token auth from openclaw.json', () => {
  const cfg = resolveBridgeConfig({
    env: {},
    gatewayConfig: { gateway: { port: 18789, auth: { mode: 'token', token: 'tok-1' } } },
  });
  assert.deepStrictEqual(cfg.auth, { token: 'tok-1' });
});

run('resolveBridgeConfig: no auth when mode none or secret missing', () => {
  const none = resolveBridgeConfig({
    env: {},
    gatewayConfig: { gateway: { port: 18789, auth: { mode: 'none' } } },
  });
  assert.strictEqual(none.auth, null);

  const emptySecret = resolveBridgeConfig({
    env: {},
    gatewayConfig: { gateway: { port: 18789, auth: { mode: 'password', password: '' } } },
  });
  assert.strictEqual(emptySecret.auth, null);
});

run('resolveBridgeConfig: GATEWAY_BRIDGE_URL/TOKEN env overrides win', () => {
  const cfg = resolveBridgeConfig({
    env: { GATEWAY_BRIDGE_URL: 'wss://gw.example:18789', GATEWAY_BRIDGE_TOKEN: 'env-tok' },
    gatewayConfig: { gateway: { port: 9999, auth: { mode: 'password', password: 'cfg-sekrit' } } },
  });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.url, 'wss://gw.example:18789');
  assert.strictEqual(cfg.source, 'env');
  assert.deepStrictEqual(cfg.auth, { token: 'env-tok' });
  assert.strictEqual(cfg.authSource, 'env');
});

run('resolveBridgeConfig: env URL alone enables bridge without config file', () => {
  const cfg = resolveBridgeConfig({ env: { GATEWAY_BRIDGE_URL: 'ws://127.0.0.1:1' }, gatewayConfig: null });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.url, 'ws://127.0.0.1:1');
});

// ── normalizeGatewayEvent ────────────────────────────────────────────────

run('normalizeGatewayEvent: task upsert → task-updated with fields', () => {
  const evt = normalizeGatewayEvent('task', {
    action: 'upserted',
    task: {
      id: 't-1', taskId: 't-1', kind: 'cli', runtime: 'cli', status: 'running',
      title: 'Do things', agentId: 'coder', sessionKey: 'agent:coder:main',
      runId: 'r-1', updatedAt: 1000,
    },
  });
  assert.ok(evt, 'task event should normalize');
  assert.strictEqual(evt.type, 'task-updated');
  assert.strictEqual(evt.id, 't-1');
  assert.strictEqual(evt.updatedAt, 1000);
  assert.strictEqual(evt.data.status, 'running');
  assert.strictEqual(evt.data.agentId, 'coder');
  assert.strictEqual(evt.data.sessionKey, 'agent:coder:main');
  assert.strictEqual(evt.data.runId, 'r-1');
});

run('normalizeGatewayEvent: task without id → null', () => {
  assert.strictEqual(normalizeGatewayEvent('task', { action: 'upserted', task: {} }), null);
  assert.strictEqual(normalizeGatewayEvent('task', {}), null);
});

run('normalizeGatewayEvent: budget.breach envelope → budget:breach frame (slice 3)', () => {
  const evt = normalizeGatewayEvent('budget.breach', {
    seq: 12,
    budget_id: 'b-1',
    budget_name: 'fleet monthly cap',
    scope: 'fleet',
    scope_id: null,
    period: 'monthly',
    period_key: '2026-08',
    event_kind: 'paused',
    action: 'pause_new_runs',
    spend_usd: 12.5,
    spend_tokens: 7000,
    cap_usd: 10,
    cap_tokens: null,
    timestamp: '2026-08-24T12:00:00.000Z',
  });
  assert.ok(evt, 'budget.breach should normalize');
  assert.strictEqual(evt.type, 'budget:breach');
  assert.strictEqual(evt.id, 'b-1:2026-08:paused', 'id = budget_id:period_key:event_kind (latch throttle key)');
  assert.strictEqual(evt.updatedAt, 12, 'seq wins when present');
  assert.strictEqual(evt.data.type, 'budget:breach');
  assert.strictEqual(evt.data.budget_name, 'fleet monthly cap');
  assert.strictEqual(evt.data.action, 'pause_new_runs');
  assert.ok(evt.data.message.includes('pause_new_runs enforced at $12.50 of $10.00 cap (2026-08)'));
});

run('normalizeGatewayEvent: budget.breach without identity → null', () => {
  assert.strictEqual(normalizeGatewayEvent('budget.breach', { seq: 1 }), null);
  assert.strictEqual(normalizeGatewayEvent('budget.breach', { seq: 1, budget_id: 'b-1' }), null,
    'period_key and event_kind are required for the latch id');
});

run('normalizeGatewayEvent: agent item stream → agent-status-changed', () => {
  const evt = normalizeGatewayEvent('agent', {
    stream: 'item',
    seq: 42,
    sessionKey: 'agent:coder:s1',
    agentId: 'coder',
    data: { itemId: 'tool:c-1', phase: 'end', kind: 'tool', name: 'exec', status: 'completed' },
  });
  assert.ok(evt, 'agent item should normalize');
  assert.strictEqual(evt.type, 'agent-status-changed');
  assert.strictEqual(evt.id, 'agent:coder:s1/tool:c-1');
  assert.strictEqual(evt.updatedAt, 42);
  assert.strictEqual(evt.data.phase, 'end');
  assert.strictEqual(evt.data.status, 'completed');
});

run('normalizeGatewayEvent: agent command_output stream → agent-status-changed', () => {
  const evt = normalizeGatewayEvent('agent', {
    stream: 'command_output',
    seq: 7,
    sessionKey: 'agent:coder:s1',
    data: { itemId: 'command:c-2', phase: 'end', name: 'exec', status: 'completed', exitCode: 0 },
  });
  assert.ok(evt, 'command_output should normalize');
  assert.strictEqual(evt.type, 'agent-status-changed');
  assert.strictEqual(evt.data.itemId, 'command:c-2');
});

run('normalizeGatewayEvent: assistant token deltas ignored', () => {
  assert.strictEqual(
    normalizeGatewayEvent('agent', { stream: 'assistant', seq: 9, data: { text: 'x', delta: 'x' } }),
    null,
    'assistant deltas are too chatty for fanout v1'
  );
});

run('normalizeGatewayEvent: session.tool lifecycle → run-updated', () => {
  const evt = normalizeGatewayEvent('session.tool', {
    runId: 'r-9',
    stream: 'tool',
    data: { phase: 'result', name: 'exec', toolCallId: 'c-3', result: { details: { exitCode: 0 } } },
    sessionKey: 'agent:coder:s2',
    agentId: 'coder',
    seq: 2754,
  });
  assert.ok(evt, 'session.tool should normalize');
  assert.strictEqual(evt.type, 'run-updated');
  assert.strictEqual(evt.id, 'r-9/c-3');
  assert.strictEqual(evt.updatedAt, 2754);
  assert.strictEqual(evt.data.phase, 'result');
  assert.strictEqual(evt.data.exitCode, 0);
});

run('normalizeGatewayEvent: irrelevant events → null', () => {
  assert.strictEqual(normalizeGatewayEvent('tick', {}), null);
  assert.strictEqual(normalizeGatewayEvent('health', { ok: true }), null);
  assert.strictEqual(normalizeGatewayEvent('chat', { state: 'delta' }), null);
  assert.strictEqual(normalizeGatewayEvent('unknown.event', { foo: 1 }), null);
});

// ── dedupeEvent ──────────────────────────────────────────────────────────

run('dedupeEvent: first observation passes, exact duplicate blocked', () => {
  const cache = createDedupeCache();
  const evt = { type: 'task-updated', id: 't-1', updatedAt: 100 };
  assert.strictEqual(dedupeEvent(cache, evt), true, 'first pass');
  assert.strictEqual(dedupeEvent(cache, evt), false, 'same updatedAt is a dupe');
});

run('dedupeEvent: newer updatedAt passes, older/equal blocked', () => {
  const cache = createDedupeCache();
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-1', updatedAt: 100 }), true);
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-1', updatedAt: 200 }), true, 'newer passes');
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-1', updatedAt: 150 }), false, 'older blocked');
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-1', updatedAt: 200 }), false, 'equal blocked');
});

run('dedupeEvent: ids and types are independent keys', () => {
  const cache = createDedupeCache();
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-1', updatedAt: 100 }), true);
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated', id: 't-2', updatedAt: 100 }), true, 'different id passes');
  assert.strictEqual(dedupeEvent(cache, { type: 'run-updated', id: 't-1', updatedAt: 100 }), true, 'different type passes');
});

run('dedupeEvent: malformed events never pass', () => {
  const cache = createDedupeCache();
  assert.strictEqual(dedupeEvent(cache, null), false);
  assert.strictEqual(dedupeEvent(cache, {}), false);
  assert.strictEqual(dedupeEvent(cache, { type: 'task-updated' }), false);
});

// ── detectSeqGap ─────────────────────────────────────────────────────────

run('detectSeqGap: init on first observation', () => {
  assert.strictEqual(detectSeqGap(null, 5), 'init');
});

run('detectSeqGap: contiguous and same-seq frames are ok', () => {
  assert.strictEqual(detectSeqGap(5, 6), 'ok');
  assert.strictEqual(detectSeqGap(5, 5), 'ok', 'duplicate envelope frame is not a gap');
});

run('detectSeqGap: skipped frames are a gap', () => {
  assert.strictEqual(detectSeqGap(5, 7), 'gap');
  assert.strictEqual(detectSeqGap(5, 12), 'gap');
});

run('detectSeqGap: non-numeric seq ignored', () => {
  assert.strictEqual(detectSeqGap(5, undefined), 'ok');
  assert.strictEqual(detectSeqGap(null, undefined), 'ok');
});

console.log('PASS: gateway bridge');
