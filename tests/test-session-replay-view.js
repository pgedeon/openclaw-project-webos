#!/usr/bin/env node
/**
 * Focused tests for the session replay view's pure helpers
 * (src/shell/native-views/session-replay-view.mjs):
 *   - computeStateAsOf  — as-of-t cumulative state (brief AC4)
 *   - visibleWindow     — virtualized rail window math (brief AC5c)
 *   - toolBadgeState    — exitCode badge tone (green/red/status)
 *   - appendPage        — defensive chunk accumulation
 *
 * Run: node tests/test-session-replay-view.js
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✔ ${name}`); },
        (err) => { failed++; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed++;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

// ── Fixtures mirroring the server-normalized event shape ──────────────────

function fixtureEvents() {
  return [
    { line: 1, ts: 1000, kind: 'session_meta', text: 'cwd /tmp/proj' },
    { line: 2, ts: 2000, kind: 'model_change', text: '9router/ox-alpha' },
    { line: 3, ts: 3000, kind: 'user_message', role: 'user', text: 'run the tests' },
    { line: 4, ts: 4000, kind: 'assistant_thinking', role: 'assistant', text: 'plan the run' },
    { line: 4, ts: 4000, kind: 'tool_call', role: 'assistant', tool: { toolCallId: 'call_1', name: 'exec', argsPreview: '{"command":"npm test"}', resultLine: null } },
    { line: 4, ts: 4000, kind: 'assistant_text', role: 'assistant', text: 'Running now' },
    { line: 5, ts: 5000, kind: 'tool_result', role: 'toolResult', tool: { toolCallId: 'call_1', name: 'exec', resultPreview: 'all green', details: { status: 'passed', exitCode: 0, durationMs: 1234 } } },
    { line: 6, ts: 6000, kind: 'assistant_text', role: 'assistant', text: 'Done' },
    { line: 7, ts: 7000, kind: 'tool_call', role: 'assistant', tool: { toolCallId: 'call_2', name: 'write', argsPreview: '{"path":"x"}', resultLine: null } }, // unpaired
    { line: 8, ts: 8000, kind: 'compaction', text: 'summarized' },
  ];
}

(async () => {
  const viewPath = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'session-replay-view.mjs');
  const mod = await import(pathToFileURL(viewPath).href);
  const { computeStateAsOf, visibleWindow, toolBadgeState, appendPage } = mod;

  console.log('session-replay-view: computeStateAsOf');

  await check('messages at i equal the prefix [0..i] of chat content', () => {
    const events = fixtureEvents();
    // i=5 covers lines 1..4 (thinking + tool_call + text share line 4).
    const s = computeStateAsOf(events, 5);
    assert.deepStrictEqual(s.messages.map((m) => m.text), ['run the tests', 'plan the run', 'Running now']);
    assert.strictEqual(s.index, 5);
    assert.strictEqual(s.currentEvent.kind, 'assistant_text');
  });

  await check('i=-1 clamps to empty state; beyond-end clamps to last event', () => {
    const events = fixtureEvents();
    const empty = computeStateAsOf(events, -1);
    assert.strictEqual(empty.index, -1);
    assert.strictEqual(empty.messages.length, 0);
    assert.strictEqual(empty.toolCalls.length, 0);
    assert.strictEqual(empty.currentEvent, null);

    const full = computeStateAsOf(events, 9999);
    assert.strictEqual(full.index, events.length - 1);
    assert.strictEqual(full.currentEvent.kind, 'compaction');

    const weird = computeStateAsOf(events, Number.NaN);
    assert.strictEqual(weird.index, -1);
    assert.strictEqual(computeStateAsOf(events, 2.7).index, 2);
  });

  await check('empty/non-array input degrades to empty state', () => {
    for (const input of [[], undefined, null]) {
      const s = computeStateAsOf(input, 3);
      assert.strictEqual(s.total, 0);
      assert.strictEqual(s.index, -1);
      assert.strictEqual(s.currentEvent, null);
    }
  });

  await check('crossing a tool_result flips the paired call to resolved with details', () => {
    const events = fixtureEvents();
    const before = computeStateAsOf(events, 4); // tool_call step, result not yet seen
    assert.strictEqual(before.toolCalls.length, 1);
    assert.strictEqual(before.toolCalls[0].resolved, false);
    assert.strictEqual(before.toolCalls[0].resultPreview, null);

    const after = computeStateAsOf(events, 6); // result event consumed
    assert.strictEqual(after.toolCalls[0].resolved, true);
    assert.strictEqual(after.toolCalls[0].resultPreview, 'all green');
    assert.strictEqual(after.toolCalls[0].details.exitCode, 0);
    assert.strictEqual(after.toolCalls[0].resultLine, 5);
  });

  await check('unpaired tool call stays resolved:false ("no result recorded" is signal)', () => {
    const full = computeStateAsOf(fixtureEvents(), 9999);
    const orphan = full.toolCalls.find((t) => t.toolCallId === 'call_2');
    assert.ok(orphan, 'orphan call tracked');
    assert.strictEqual(orphan.resolved, false);
    assert.strictEqual(orphan.resultLine, null);
  });

  await check('tool_result without a seen call is kept, not dropped', () => {
    const events = [{ line: 1, ts: 1, kind: 'tool_result', role: 'toolResult', tool: { toolCallId: 'ghost', name: 'exec', resultPreview: 'late' } }];
    const s = computeStateAsOf(events, 0);
    assert.strictEqual(s.toolCalls.length, 1);
    assert.strictEqual(s.toolCalls[0].toolCallId, 'ghost');
    assert.strictEqual(s.toolCalls[0].resolved, true);
  });

  await check('lastModel tracks model_change ticks as-of step', () => {
    const events = fixtureEvents();
    assert.strictEqual(computeStateAsOf(events, 0).lastModel, null);
    assert.strictEqual(computeStateAsOf(events, 1).lastModel, '9router/ox-alpha');
  });

  console.log('session-replay-view: visibleWindow (virtualization math)');

  await check('window covers viewport plus overscan, clamped to list bounds', () => {
    const w = visibleWindow({ total: 10000, viewport: 520, scrollTop: 0, rowHeight: 26, overscan: 10 });
    assert.strictEqual(w.start, 0);
    assert.ok(w.end <= 10000 && w.end > Math.ceil(520 / 26), `end=${w.end}`);

    const mid = visibleWindow({ total: 10000, viewport: 520, scrollTop: 50000, rowHeight: 26, overscan: 10 });
    assert.strictEqual(mid.start, Math.floor(50000 / 26) - 10);
    assert.strictEqual(mid.end, mid.start + Math.ceil(520 / 26) + 20);
  });

  await check('DOM bound: rendered rows stay ~viewport+2×overscan regardless of total', () => {
    for (const total of [1000, 10000, 100000]) {
      const w = visibleWindow({ total, viewport: 600, scrollTop: 300000, rowHeight: 26, overscan: 10 });
      assert.ok(w.end - w.start <= Math.ceil(600 / 26) + 20 + 1, `total=${total} rows=${w.end - w.start}`);
    }
  });

  await check('degenerate geometry falls back to full render, never throws', () => {
    assert.deepStrictEqual(visibleWindow({ total: 0, viewport: 0, scrollTop: 0, rowHeight: 26 }), { start: 0, end: 0 });
    assert.deepStrictEqual(visibleWindow({ total: 5, viewport: 100, scrollTop: -50, rowHeight: 26 }).start, 0);
    const fallback = visibleWindow({ total: 5, viewport: 100, scrollTop: 0, rowHeight: 0 });
    assert.deepStrictEqual(fallback, { start: 0, end: 5 });
    const nan = visibleWindow({ total: NaN, viewport: NaN, scrollTop: NaN, rowHeight: 26 });
    assert.deepStrictEqual(nan, { start: 0, end: 0 });
  });

  console.log('session-replay-view: toolBadgeState');

  await check('exitCode 0 → good, non-zero → bad, absent → neutral status word', () => {
    assert.strictEqual(toolBadgeState({ details: { exitCode: 0 } }), 'good');
    assert.strictEqual(toolBadgeState({ details: { exitCode: 1 } }), 'bad');
    assert.strictEqual(toolBadgeState({ details: { exitCode: 127 } }), 'bad');
    assert.strictEqual(toolBadgeState({ details: { status: 'completed' } }), 'neutral');
    assert.strictEqual(toolBadgeState({}), 'neutral');
    assert.strictEqual(toolBadgeState(null), 'neutral');
  });

  console.log('session-replay-view: appendPage (chunk accumulation)');

  await check('pages concatenate in order across cursor boundaries', () => {
    const p1 = [{ line: 1, kind: 'a' }, { line: 2, kind: 'b' }];
    const p2 = [{ line: 3, kind: 'c' }, { line: 4, kind: 'd' }];
    const all = appendPage(appendPage([], p1), p2);
    assert.deepStrictEqual(all.map((e) => e.line), [1, 2, 3, 4]);
  });

  await check('same-line fan-out siblings survive within one page', () => {
    const page = [
      { line: 4, kind: 'tool_call' },
      { line: 4, kind: 'assistant_text' },
      { line: 4, kind: 'assistant_thinking' },
    ];
    const all = appendPage([{ line: 3, kind: 'a' }], page);
    assert.strictEqual(all.length, 4);
  });

  await check('defensively drops a repeated-line prefix (cursor regression guard)', () => {
    const base = [{ line: 1, kind: 'a' }, { line: 2, kind: 'b' }];
    const overlap = [{ line: 2, kind: 'b' }, { line: 3, kind: 'c' }];
    const all = appendPage(base, overlap);
    assert.deepStrictEqual(all.map((e) => e.line), [1, 2, 3]);
  });

  await check('empty/null pages and null loaded base are safe', () => {
    assert.deepStrictEqual(appendPage([], []), []);
    assert.deepStrictEqual(appendPage(undefined, [{ line: 1 }]), [{ line: 1 }]);
    assert.deepStrictEqual(appendPage([{ line: 1 }], null), [{ line: 1 }]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
