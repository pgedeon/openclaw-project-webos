#!/usr/bin/env node
/**
 * Focused DB-free tests for scripts/backfill-run-costs.js pure helpers:
 * session-key parsing, transcript usage extraction/aggregation, window
 * filtering, candidate resolution, dominant-model selection, and the
 * idempotency guard baked into the runs SELECT.
 * Run: node tests/test-backfill-run-costs.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const backfill = require('../scripts/backfill-run-costs');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ── parseSessionKey ─────────────────────────────────────────────────────────

test('parseSessionKey extracts agentId from a subagent key', () => {
  assert.strictEqual(
    backfill.parseSessionKey('agent:affiliate-editorial:subagent:8119ae68-4e16-4d10-a442-6938d7ee59c0'),
    'affiliate-editorial'
  );
});

test('parseSessionKey handles channel keys with extra colons', () => {
  assert.strictEqual(
    backfill.parseSessionKey('agent:main:whatsapp:direct:+4915153004362'),
    'main'
  );
});

test('parseSessionKey rejects non-session-key formats', () => {
  assert.strictEqual(backfill.parseSessionKey('spawned-360932e0-pid769975'), null);
  assert.strictEqual(backfill.parseSessionKey('gateway-session-abc123'), null);
  assert.strictEqual(backfill.parseSessionKey(''), null);
  assert.strictEqual(backfill.parseSessionKey(null), null);
  assert.strictEqual(backfill.parseSessionKey('agent:onlytwo'), null);
});

// ── extractUsageFromLine ────────────────────────────────────────────────────

const T0 = Date.parse('2026-08-24T07:00:00.000Z');

test('extractUsageFromLine reads assistant usage + model ref', () => {
  const line = {
    type: 'message',
    message: {
      role: 'assistant',
      provider: '9router',
      model: 'coding',
      timestamp: T0,
      usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 0, totalTokens: 120, cost: { total: 0 } },
    },
  };
  const u = backfill.extractUsageFromLine(line);
  assert.deepStrictEqual(
    { input: u.input, output: u.output, cachedTokens: u.cachedTokens, costEstimate: u.costEstimate, modelRef: u.modelRef, timestamp: u.timestamp },
    { input: 100, output: 20, cachedTokens: 80, costEstimate: 0, modelRef: '9router/coding', timestamp: T0 }
  );
});

test('extractUsageFromLine keeps only positive gateway-reported costs', () => {
  const base = (total) => ({
    type: 'message',
    message: { role: 'assistant', timestamp: T0, model: 'm', usage: { input: 1, output: 1, cost: { total } } },
  });
  assert.strictEqual(backfill.extractUsageFromLine(base(0)).costEstimate, 0);
  assert.strictEqual(backfill.extractUsageFromLine(base(0.25)).costEstimate, 0.25);
});

test('extractUsageFromLine ignores non-assistant / usage-less lines', () => {
  assert.strictEqual(backfill.extractUsageFromLine(null), null);
  assert.strictEqual(backfill.extractUsageFromLine({ type: 'session' }), null);
  assert.strictEqual(
    backfill.extractUsageFromLine({ type: 'message', message: { role: 'user', content: 'hi' } }),
    null
  );
  assert.strictEqual(
    backfill.extractUsageFromLine({ type: 'message', message: { role: 'assistant', content: [] } }),
    null
  );
});

// ── aggregateTranscript (window filter + malformed-line tolerance) ──────────

async function aggregateFixture(lines, startMs, endMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-test-'));
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  const acc = backfill.emptyAccumulator();
  await backfill.aggregateTranscript(file, startMs, endMs, acc);
  return acc;
}

function usageLine(ts, input, output, cacheRead, model) {
  return {
    type: 'message',
    message: {
      role: 'assistant', provider: 'prov', model, timestamp: ts,
      usage: { input, output, cacheRead, cost: { total: 0 } },
    },
  };
}

test('aggregateTranscript sums only in-window messages', async () => {
  const acc = await aggregateFixture([
    { type: 'session', id: 's' },
    usageLine(T0 - 5000, 999, 999, 999, 'before'),   // before window
    usageLine(T0, 100, 10, 50, 'alpha'),
    { type: 'message', message: { role: 'user', timestamp: T0 + 1, content: 'x' } },
    usageLine(T0 + 2000, 30, 5, 0, 'beta'),
    usageLine(T0 + 99999, 777, 777, 777, 'after'),   // after window end
    '{ this line is not json',
  ], T0, T0 + 5000);
  assert.strictEqual(acc.input, 130);
  assert.strictEqual(acc.output, 15);
  assert.strictEqual(acc.cachedTokens, 50);
  assert.strictEqual(acc.messages, 2);
});

test('aggregateTranscript open-ended windows respect single bound', async () => {
  const acc = await aggregateFixture([
    usageLine(T0 - 1000, 1, 1, 0, 'a'),
    usageLine(T0 + 1000, 10, 2, 0, 'a'),
  ], T0, null);
  assert.strictEqual(acc.input, 10);
  assert.strictEqual(acc.messages, 1);
});

test('aggregateTranscript returns false for missing files', async () => {
  const acc = backfill.emptyAccumulator();
  const found = await backfill.aggregateTranscript(path.join(os.tmpdir(), `nope-${Date.now()}.jsonl`), null, null, acc);
  assert.strictEqual(found, false);
  assert.strictEqual(acc.messages, 0);
});

// ── pickDominantModel ───────────────────────────────────────────────────────

test('pickDominantModel picks first-seen majority, stable on ties', () => {
  const counts = new Map([['a/x', 3], ['b/y', 5], ['c/z', 5]]);
  assert.strictEqual(backfill.pickDominantModel(counts), 'b/y');
  assert.strictEqual(backfill.pickDominantModel(new Map()), null);
});

// ── accumulatorToPayload ────────────────────────────────────────────────────

test('accumulatorToPayload builds update payload; empty → null', () => {
  const acc = backfill.emptyAccumulator();
  assert.strictEqual(backfill.accumulatorToPayload(acc), null);

  acc.input = 500; acc.output = 90; acc.cachedTokens = 300; acc.messages = 4;
  acc.modelCounts.set('9router/coding', 4);
  const payload = backfill.accumulatorToPayload(acc);
  assert.deepStrictEqual(payload, {
    input_tokens: 500,
    output_tokens: 90,
    cached_tokens: 300,
    currency: 'USD',
    model_id: '9router/coding',
  });
  // zero gateway-reported cost → no cost_estimate key (never invent prices)
  assert.ok(!('cost_estimate' in payload));
});

test('accumulatorToPayload includes positive reported cost only', () => {
  const acc = backfill.emptyAccumulator();
  acc.costEstimate = 1.5;
  acc.messages = 2;
  const payload = backfill.accumulatorToPayload(acc);
  assert.strictEqual(payload.cost_estimate, 1.5);
  assert.strictEqual(payload.currency, 'USD');
});

// ── resolveSessionCandidates (fake HOME tree) ───────────────────────────────

test('resolveSessionCandidates resolves sessionId + family files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-home-'));
  const sessionsDir = path.join(home, '.openclaw', 'agents', 'ag', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const liveId = '11111111-1111-1111-1111-111111111111';
  const oldId = '22222222-2222-2222-2222-222222222222';
  const goneId = '33333333-3333-3333-3333-333333333333';
  fs.writeFileSync(path.join(sessionsDir, 'sessions.json'), JSON.stringify({
    'agent:ag:main': { sessionId: liveId, usageFamilySessionIds: [oldId, goneId] },
  }));
  fs.writeFileSync(path.join(sessionsDir, `${liveId}.jsonl`), '');
  fs.writeFileSync(path.join(sessionsDir, `${oldId}.jsonl`), '');

  const res = backfill.resolveSessionCandidates(path.join(home, '.openclaw', 'agents'), 'agent:ag:main');
  assert.strictEqual(res.reason, null);
  assert.strictEqual(res.files.length, 2);
  assert.ok(res.files.includes(path.join(sessionsDir, `${liveId}.jsonl`)));
  assert.ok(res.files.includes(path.join(sessionsDir, `${oldId}.jsonl`)));
});

test('resolveSessionCandidates reports precise unmatched reasons', () => {
  const agentsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-empty-')), 'agents');

  assert.strictEqual(
    backfill.resolveSessionCandidates(agentsDir, 'spawned-abc-pid1').reason,
    'not_a_session_key'
  );
  assert.strictEqual(
    backfill.resolveSessionCandidates(agentsDir, 'agent:ghost:main').reason,
    'sessions_json_unreadable'
  );

  const sessionsDir = path.join(agentsDir, 'ag', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, 'sessions.json'), JSON.stringify({ 'agent:ag:cron:x': { sessionId: 's1' } }));

  assert.strictEqual(
    backfill.resolveSessionCandidates(agentsDir, 'agent:ag:other').reason,
    'session_key_not_found'
  );
  assert.strictEqual(
    backfill.resolveSessionCandidates(agentsDir, 'agent:ag:cron:x').reason,
    'transcript_files_missing'
  );
});

// ── runWindowMs + idempotent SELECT guard ───────────────────────────────────

test('runWindowMs parses bounds, tolerates NULLs', () => {
  const w = backfill.runWindowMs({ started_at: '2026-03-22T16:37:52Z', finished_at: '2026-03-22T16:43:18Z' });
  assert.strictEqual(w.startMs, Date.parse('2026-03-22T16:37:52Z'));
  assert.strictEqual(w.endMs, Date.parse('2026-03-22T16:43:18Z'));

  const open = backfill.runWindowMs({ started_at: null, finished_at: null });
  assert.strictEqual(open.startMs, null);
  assert.strictEqual(open.endMs, null);
});

test('runs SELECT only targets fully-unreported rows with a session binding', () => {
  const sql = backfill.RUNS_SELECT_SQL;
  for (const col of ['input_tokens IS NULL', 'output_tokens IS NULL', 'cached_tokens IS NULL', 'model_id IS NULL', 'cost_estimate IS NULL']) {
    assert.ok(sql.includes(col), `missing idempotency guard: ${col}`);
  }
  assert.ok(sql.includes('gateway_session_id IS NOT NULL'));
});

console.log(`\n${passed} assertions groups passed`);
