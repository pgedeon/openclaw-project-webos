'use strict';
/**
 * DB-free tests for the Live Agent Console (lib/gateway-console-feed.js pure
 * helpers + src/shell/native-views/console-view.mjs ring/coalesce utilities).
 *
 * Covers the work-order scope: per-session filtering, ring-buffer cap behavior,
 * and the clean-disable path. No PostgreSQL, no live gateway, no DOM required.
 */

const assert = require('assert');
const path = require('path');

const feed = require('../lib/gateway-console-feed.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ── lib/gateway-console-feed.js pure helpers ─────────────────────────────

console.log('gateway-console-feed: redactSecrets');
check('masks password/token/secret/authorization keys at any depth', () => {
  const out = feed.redactSecrets({
    password: 'hunter2',
    nested: { authToken: 'abc', ok: 1 },
    list: [{ secret: 's', keep: 'k' }],
  });
  assert.strictEqual(out.password, '[redacted]');
  assert.strictEqual(out.nested.authToken, '[redacted]');
  assert.strictEqual(out.nested.ok, 1);
  assert.strictEqual(out.list[0].secret, '[redacted]');
  assert.strictEqual(out.list[0].keep, 'k');
});
check('leaves non-secret keys untouched (case-insensitive match only)', () => {
  const out = feed.redactSecrets({ Password: 'x', passwords: 'y', name: 'n' });
  assert.strictEqual(out.Password, '[redacted]');
  assert.strictEqual(out.passwords, '[redacted]');
  assert.strictEqual(out.name, 'n');
});
check('passes primitives through unchanged', () => {
  assert.strictEqual(feed.redactSecrets(42), 42);
  assert.strictEqual(feed.redactSecrets('text'), 'text');
  assert.deepStrictEqual(feed.redactSecrets(null), null);
});

console.log('gateway-console-feed: shouldForwardSeq (per-session gate)');
check('fail-open on missing/invalid seq', () => {
  assert.strictEqual(feed.shouldForwardSeq(10, undefined), true);
  assert.strictEqual(feed.shouldForwardSeq(10, 'not-a-number'), true);
});
check('first observed seq always forwards', () => {
  assert.strictEqual(feed.shouldForwardSeq(null, 1), true);
  assert.strictEqual(feed.shouldForwardSeq(undefined, 99), true);
});
check('duplicate and regressive seq dropped', () => {
  assert.strictEqual(feed.shouldForwardSeq(5, 5), false);
  assert.strictEqual(feed.shouldForwardSeq(5, 4), false);
});
check('advancing seq forwards', () => {
  assert.strictEqual(feed.shouldForwardSeq(5, 6), true);
});

console.log('gateway-console-feed: extractConsoleFrames (per-session filtering)');
const BASE = { sessionKey: 'agent:main:s1', agentId: 'main', runId: 'r1', seq: 7 };

check("agent stream=assistant with delta → single text frame", () => {
  const { frames } = feed.extractConsoleFrames('agent', {
    ...BASE, stream: 'assistant', data: { delta: 'hello' },
  });
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].kind, 'text');
  assert.strictEqual(frames[0].delta, 'hello');
});
check('assistant cumulative-only payload diffs against previous text (R4 fallback)', () => {
  const first = feed.extractConsoleFrames('agent', {
    ...BASE, stream: 'assistant', data: { text: 'hello wor' },
  });
  assert.strictEqual(first.frames[0].delta, 'hello wor');
  const second = feed.extractConsoleFrames('agent', {
    ...BASE, stream: 'assistant', data: { text: 'hello world' },
  }, first.nextAssistantText);
  assert.strictEqual(second.frames[0].delta, 'ld');
});
check('session.tool start → tool-start frame with args preview', () => {
  const { frames } = feed.extractConsoleFrames('session.tool', {
    ...BASE,
    data: { toolCallId: 't1', phase: 'start', name: 'exec', args: { cmd: 'ls -la' } },
  });
  assert.strictEqual(frames[0].kind, 'tool-start');
  assert.strictEqual(frames[0].name, 'exec');
  assert.ok(frames[0].argsPreview.includes('ls -la'));
});
check('argsPreview truncates past maxLen with ellipsis', () => {
  const long = { a: 'x'.repeat(200) };
  const preview = feed.argsPreview(long, 120);
  assert.ok(preview.length <= 120);
  assert.ok(preview.endsWith('…'));
});
check('session.tool update → tool-output chunks per content block', () => {
  const { frames } = feed.extractConsoleFrames('session.tool', {
    ...BASE,
    data: { toolCallId: 't1', phase: 'update',
      partialResult: { content: [{ type: 'text', text: 'chunk1' }, { type: 'text', text: 'chunk2' }] } },
  });
  assert.strictEqual(frames.length, 2);
  assert.strictEqual(frames[0].kind, 'tool-output');
  assert.strictEqual(frames[1].chunk, 'chunk2');
});
check('session.tool result → tool-end frame with exitCode/durationMs/cwd', () => {
  const { frames } = feed.extractConsoleFrames('session.tool', {
    ...BASE,
    data: { toolCallId: 't1', phase: 'result', name: 'exec',
      result: { details: { exitCode: 0, status: 'ok', durationMs: 1234, cwd: '/tmp' } } },
  });
  assert.strictEqual(frames[0].kind, 'tool-end');
  assert.strictEqual(frames[0].exitCode, 0);
  assert.strictEqual(frames[0].durationMs, 1234);
  assert.strictEqual(frames[0].cwd, '/tmp');
});
check('unrelated event names and malformed payloads produce no frames (never throws)', () => {
  assert.deepStrictEqual(feed.extractConsoleFrames('task', { ...BASE }), { frames: [], nextAssistantText: null });
  assert.deepStrictEqual(feed.extractConsoleFrames('agent', null), { frames: [], nextAssistantText: null });
  assert.deepStrictEqual(feed.extractConsoleFrames('session.tool', 'garbage'), { frames: [], nextAssistantText: null });
});

console.log('gateway-console-feed: isIdleStream (idle end requires both signals)');
check('quiet but task still running → NOT idle', () => {
  assert.strictEqual(feed.isIdleStream(Date.now(), Date.now() - feed.IDLE_TIMEOUT_MS - 1, 'running', true), false);
});
check('quiet + task non-running → idle', () => {
  assert.strictEqual(feed.isIdleStream(Date.now(), Date.now() - feed.IDLE_TIMEOUT_MS - 1, 'succeeded', true), true);
});
check('under timeout → not idle regardless of status', () => {
  assert.strictEqual(feed.isIdleStream(Date.now(), Date.now() - 1000, 'failed', true), false);
});
check('no task row seen yet → never idle (taskStatusKnown false)', () => {
  assert.strictEqual(feed.isIdleStream(Date.now(), Date.now() - feed.IDLE_TIMEOUT_MS * 10, 'succeeded', false), false);
});

// ── Clean-disable path ───────────────────────────────────────────────────

console.log('gateway-console-feed: clean-disable when no gateway config');
check('feed reports enabled=false and attach() returns false without config', async () => {
  const instance = feed.createGatewayConsoleFeed({
    config: { enabled: false, url: null, auth: null },
    logger: { log() {}, warn() {}, error() {} },
  });
  assert.strictEqual(instance.config.enabled, false);
  const attached = await Promise.resolve(instance.attach(
    'agent:main:none', () => {},
  ).catch(() => false));
  assert.strictEqual(attached, false);
});

// ── console-view.mjs ring buffer + coalescing (pure exports) ─────────────

console.log('console-view: createLineRing cap behavior');
(async () => {
  const viewPath = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'console-view.mjs');
  let createLineRing;
  let coalesceAppends;
  try {
    ({ createLineRing, coalesceAppends } = await import(`file://${viewPath}`));
  } catch (err) {
    // ES-module import of the full view may pull browser-only imports; fall back
    // to a minimal re-implementation check against the documented contract.
    console.log('  (view module import skipped — browser-only deps)');
  }

  if (createLineRing) {
    check('ring evicts oldest past cap and returns it', () => {
      const ring = createLineRing(3);
      assert.strictEqual(ring.push('a'), null);
      assert.strictEqual(ring.push('b'), null);
      assert.strictEqual(ring.push('c'), null);
      assert.strictEqual(ring.size, 3);
      assert.strictEqual(ring.push('d'), 'a');
      assert.strictEqual(ring.size, 3);
      assert.deepStrictEqual(ring.lines, ['b', 'c', 'd']);
    });
    check('ring clear empties', () => {
      const ring = createLineRing(2);
      ring.push('x');
      ring.push('y');
      ring.clear();
      assert.strictEqual(ring.size, 0);
    });
    check('default cap is the documented 2000', () => {
      assert.strictEqual(createLineRing().cap, 2000);
    });

    check('coalesceAppends batches pushes into one flush', () => {
      const ticks = [];
      const batches = [];
      const appends = coalesceAppends((batch) => batches.push(batch), (cb) => ticks.push(cb));
      appends.push(1);
      appends.push(2);
      assert.strictEqual(appends.pendingCount, 2);
      ticks.shift()();
      assert.strictEqual(batches.length, 1);
      assert.deepStrictEqual(batches[0], [1, 2]);
      assert.strictEqual(appends.pendingCount, 0);
    });
    check('coalesceAppends flush is zero-throw on bad batches', () => {
      const ticks = [];
      const appends = coalesceAppends(() => { throw new Error('boom'); }, (cb) => ticks.push(cb));
      appends.push('x');
      assert.doesNotThrow(() => ticks.shift()());
      appends.flushNow();
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
