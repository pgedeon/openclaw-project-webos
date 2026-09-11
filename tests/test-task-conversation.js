#!/usr/bin/env node
/**
 * Focused DB-free tests for lib/task-conversation.js — the pure event→chat-item
 * mapping behind the task-detail Conversation tab (roadmap candidate "Task ↔
 * session conversation binding", docs/briefs/task-session-binding.md §UX).
 *
 * Covered:
 * - eventToChatItem: user/assistant bubbles, thinking suppressed, tool_call /
 *   tool_result badges with exitCode extraction, arg summarization incl.
 *   malformed JSON argsPreview, malformed/hostile inputs → null (never throws)
 * - foldChatPage: tick dropping, call+result merge into one badge, unmerged
 *   orphan results kept, overlap-prefix guard, empty inputs
 * - capChatItems: cap enforcement (visible tail + hiddenOlder count), exact-fit
 *   and under-cap passthrough, invalid cap falls back to the default
 *
 * Run: node tests/test-task-conversation.js
 */

const assert = require('assert');
const {
  CONVERSATION_INITIAL_CAP,
  eventToChatItem,
  foldChatPage,
  capChatItems,
} = require('../lib/task-conversation');

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

(async () => {

  console.log('eventToChatItem');

  await check('user_message → user bubble', () => {
    assert.deepStrictEqual(
      eventToChatItem({ line: 3, ts: 1000, kind: 'user_message', role: 'user', text: 'run the tests' }),
      { type: 'user', line: 3, ts: 1000, text: 'run the tests' },
    );
  });

  await check('assistant_text → assistant bubble', () => {
    const item = eventToChatItem({ line: 6, ts: 2000, kind: 'assistant_text', role: 'assistant', text: 'Done' });
    assert.strictEqual(item.type, 'assistant');
    assert.strictEqual(item.text, 'Done');
    assert.strictEqual(item.line, 6);
  });

  await check('assistant_thinking suppressed (stays behind Replay deep-link)', () => {
    assert.strictEqual(eventToChatItem({ line: 4, ts: 1, kind: 'assistant_thinking', role: 'assistant', text: 'plan' }), null);
  });

  await check('ticks carry no chat content → null', () => {
    for (const kind of ['session_meta', 'model_change', 'compaction', 'other']) {
      assert.strictEqual(eventToChatItem({ line: 1, ts: 1, kind, text: 'x' }), null);
    }
  });

  await check('tool_call → unresolved badge with summarized args', () => {
    const item = eventToChatItem({
      line: 4, ts: 5, kind: 'tool_call', role: 'assistant',
      tool: { toolCallId: 'c1', name: 'exec', argsPreview: '{"command":"npm test"}', resultLine: null },
    });
    assert.deepStrictEqual(item, {
      type: 'tool', phase: 'call', line: 4, ts: 5,
      name: 'exec', args: 'npm test', exitCode: null, resolved: false,
    });
  });

  await check('tool_result → resolved badge with exitCode from details', () => {
    const item = eventToChatItem({
      line: 5, ts: 6, kind: 'tool_result', role: 'toolResult',
      tool: { toolCallId: 'c1', name: 'exec', resultPreview: 'ok', details: { status: 'passed', exitCode: 0 } },
    });
    assert.strictEqual(item.phase, 'result');
    assert.strictEqual(item.exitCode, 0);
    assert.strictEqual(item.resolved, true);
  });

  await check('non-finite exitCode degrades to null (neutral badge)', () => {
    const item = eventToChatItem({ line: 5, ts: 6, kind: 'tool_result', tool: { name: 'write', details: {} } });
    assert.strictEqual(item.exitCode, null);
    assert.strictEqual(eventToChatItem({ line: 5, ts: 6, kind: 'tool_result', tool: { name: 'w' } }).exitCode, null);
  });

  await check('argsPreview non-JSON falls back to one-line text; long values truncate at 60', () => {
    const item = eventToChatItem({
      line: 9, ts: 9, kind: 'tool_call',
      tool: { name: 'web_fetch', argsPreview: 'not json {', },
    });
    assert.strictEqual(item.args, 'not json {');

    const long = eventToChatItem({
      line: 10, ts: 10, kind: 'tool_call',
      tool: { name: 'read', argsPreview: JSON.stringify({ path: 'x'.repeat(80) }) },
    });
    assert.ok(long.args.length <= 61, `args truncated, got length ${long.args.length}`);
    assert.ok(long.args.endsWith('…'));
  });

  await check('malformed events never throw → null or degraded fields', () => {
    for (const input of [null, undefined, 42, 'x', {}, { kind: 'user_message' }, { kind: 'tool_call' }, { kind: 'tool_call', tool: null }]) {
      const item = eventToChatItem(input);
      if (item !== null) {
        assert.ok(typeof item.type === 'string');
        if (item.type === 'user' || item.type === 'assistant') assert.strictEqual(item.text, '');
        if (item.type === 'tool') assert.strictEqual(typeof item.name, 'string');
      }
    }
    assert.strictEqual(eventToChatItem({ line: 1, ts: 1, kind: 'mystery_kind' }), null);
  });

  console.log('foldChatPage');

  await check('page folds to chat items, ticks dropped', () => {
    const page = [
      { line: 1, ts: 1, kind: 'session_meta', text: 'cwd /tmp' },
      { line: 2, ts: 2, kind: 'user_message', text: 'go' },
      { line: 3, ts: 3, kind: 'assistant_text', text: 'doing' },
    ];
    const { items, appended } = foldChatPage([], page);
    assert.strictEqual(appended, 2);
    assert.deepStrictEqual(items.map((i) => i.type), ['user', 'assistant']);
  });

  await check('tool result merges into its open call — one badge, exitCode attached', () => {
    const page = [
      { line: 4, ts: 4, kind: 'tool_call', tool: { toolCallId: 'c1', name: 'exec', argsPreview: '{"command":"ls"}' } },
      { line: 5, ts: 5, kind: 'tool_result', tool: { toolCallId: 'c1', name: 'exec', details: { exitCode: 0 } } },
    ];
    const { items, appended } = foldChatPage([], page);
    assert.strictEqual(appended, 1, 'result folded into call, not appended');
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].resolved, true);
    assert.strictEqual(items[0].exitCode, 0);
    assert.strictEqual(items[0].args, 'ls');
  });

  await check('unpaired result without a seen call is kept as its own badge', () => {
    const { items } = foldChatPage([], [
      { line: 7, ts: 7, kind: 'tool_result', tool: { toolCallId: 'ghost', name: 'exec', details: { exitCode: 3 } } },
    ]);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].phase, 'result');
    assert.strictEqual(items[0].exitCode, 3);
  });

  await check('merge targets the LAST unresolved call of the same name only', () => {
    const { items } = foldChatPage([], [
      { line: 1, ts: 1, kind: 'tool_call', tool: { toolCallId: 'a', name: 'exec', argsPreview: '{}' } },
      { line: 2, ts: 2, kind: 'tool_call', tool: { toolCallId: 'b', name: 'exec', argsPreview: '{}' } },
      { line: 3, ts: 3, kind: 'tool_result', tool: { toolCallId: 'b', name: 'exec', details: { exitCode: 1 } } },
    ]);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].resolved, false, 'older call stays open');
    assert.strictEqual(items[1].resolved, true);
    assert.strictEqual(items[1].exitCode, 1);
  });

  await check('overlap prefix guard: incoming lines ≤ last accepted line are dropped', () => {
    const base = foldChatPage([], [{ line: 5, ts: 5, kind: 'user_message', text: 'first' }]).items;
    const { items, appended } = foldChatPage(base, [
      { line: 5, ts: 5, kind: 'user_message', text: 'dup' },
      { line: 6, ts: 6, kind: 'assistant_text', text: 'next' },
    ]);
    assert.strictEqual(appended, 1);
    assert.deepStrictEqual(items.map((i) => i.text), ['first', 'next']);
  });

  await check('empty / hostile inputs degrade to empty results', () => {
    assert.deepStrictEqual(foldChatPage([], []).appended, 0);
    assert.deepStrictEqual(foldChatPage(undefined, undefined).items, []);
    assert.deepStrictEqual(foldChatPage([{ type: 'user', line: 2, ts: 1, text: 'keep' }], null).items.length, 1);
  });

  console.log('capChatItems');

  await check('under-cap list passes through whole', () => {
    const items = [{ type: 'user', line: 1 }, { type: 'assistant', line: 2 }];
    const { visible, hiddenOlder } = capChatItems(items, 200);
    assert.strictEqual(visible.length, 2);
    assert.strictEqual(hiddenOlder, 0);
  });

  await check('over-cap list keeps the NEWEST tail and counts hidden older items', () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ type: 'user', line: i + 1 }));
    const { visible, hiddenOlder } = capChatItems(items, 200);
    assert.strictEqual(visible.length, 200);
    assert.strictEqual(hiddenOlder, 50);
    assert.strictEqual(visible[0].line, 51, 'tail starts after hidden prefix');
    assert.strictEqual(visible[199].line, 250);
  });

  await check('exact-fit boundary flips nothing', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ type: 'user', line: i + 1 }));
    const { visible, hiddenOlder } = capChatItems(items, CONVERSATION_INITIAL_CAP);
    assert.strictEqual(visible.length, 200);
    assert.strictEqual(hiddenOlder, 0);
  });

  await check('invalid cap falls back to default; hostile input degrades', () => {
    assert.strictEqual(capChatItems([], -5).hiddenOlder, 0);
    assert.deepStrictEqual(capChatItems(null).visible, []);
    const big = Array.from({ length: 201 }, (_, i) => ({ type: 'user', line: i + 1 }));
    assert.strictEqual(capChatItems(big, Number.NaN).visible.length, CONVERSATION_INITIAL_CAP);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
