#!/usr/bin/env node
/**
 * Focused tests for the session replay reader (lib/session-jsonl-reader.js)
 * and its /events route wiring in routes/session-routes.js.
 * Run: node tests/test-session-jsonl-reader.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The reader resolves AGENTS_DIR from HOME at require time — point it at a
// throwaway tree before loading the module.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'session-replay-test-'));
process.env.HOME = FAKE_HOME;

const reader = require('../lib/session-jsonl-reader');

const AGENT = 'replay-agent';
const SESSION = 'sess-fixtures';
const SESSIONS_DIR = path.join(FAKE_HOME, '.openclaw', 'agents', AGENT, 'sessions');

const T0 = Date.parse('2026-08-24T07:00:00.000Z');

/** Fixture lines mirroring the live persisted transcript schema (v3). */
function fixtureLines() {
  return [
    // 1 — session meta (top-level ISO timestamp string)
    JSON.stringify({ type: 'session', id: SESSION, cwd: '/tmp/proj', timestamp: '2026-08-24T07:00:00.000Z' }),
    // 2 — model change (data.timestamp number fallback)
    JSON.stringify({ type: 'model_change', provider: '9router', modelId: 'ox-alpha', data: { timestamp: T0 + 1000 } }),
    // 3 — user message (message.timestamp number, block-array content)
    JSON.stringify({
      type: 'message',
      message: { role: 'user', timestamp: T0 + 2000, content: [{ type: 'text', text: 'run the tests' }] },
    }),
    // 4 — assistant message with thinking + toolCall + text blocks → 3 events
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: T0 + 3000,
        content: [
          { type: 'thinking', thinking: 'plan the run' },
          { type: 'toolCall', id: 'call_1', name: 'exec', arguments: { command: 'npm test' } },
          { type: 'text', text: 'Running now' },
        ],
      },
    }),
    // 5 — toolResult carrying details (exitCode/durationMs/cwd + heavy aggregated)
    JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'exec',
        timestamp: T0 + 4000,
        content: [{ type: 'text', text: 'all green' }],
        details: { status: 'passed', exitCode: 0, durationMs: 1234, cwd: '/tmp/proj', aggregated: { big: 'payload' } },
      },
    }),
    // 6 — unparsable garbage line (partial-transcript marker)
    'not json at all',
    // 7 — unknown forward-compat line type → generic tick
    JSON.stringify({ type: 'hologram_tick', customType: 'future_widget', data: { timestamp: T0 + 5000 } }),
  ];
}

async function writeFixtureSession(name, lines) {
  await fs.promises.mkdir(SESSIONS_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(SESSIONS_DIR, `${name}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

async function testNormalizeTranscriptEvents() {
  const rawLines = fixtureLines();
  const l1 = JSON.parse(rawLines[0]);
  const l2 = JSON.parse(rawLines[1]);
  const l3 = JSON.parse(rawLines[2]);
  const l4 = JSON.parse(rawLines[3]);
  const l5 = JSON.parse(rawLines[4]);
  // rawLines[5] is intentionally unparsable garbage
  const l7 = JSON.parse(rawLines[6]);

  // Session meta
  const [meta] = reader.normalizeTranscriptEvents(l1, { lineNumber: 1 });
  assert.strictEqual(meta.kind, 'session_meta');
  assert.strictEqual(meta.line, 1);
  assert.strictEqual(meta.ts, T0);
  assert.strictEqual(meta.text, 'cwd /tmp/proj');

  // Model change
  const [model] = reader.normalizeTranscriptEvents(l2, { lineNumber: 2 });
  assert.strictEqual(model.kind, 'model_change');
  assert.strictEqual(model.ts, T0 + 1000);
  assert.strictEqual(model.text, '9router/ox-alpha');

  // User message joins text blocks
  const [user] = reader.normalizeTranscriptEvents(l3, { lineNumber: 3 });
  assert.strictEqual(user.kind, 'user_message');
  assert.strictEqual(user.role, 'user');
  assert.strictEqual(user.text, 'run the tests');

  // Assistant line fans out into thinking + tool_call + text sharing one line number
  const assistantEvents = reader.normalizeTranscriptEvents(l4, { lineNumber: 4 });
  assert.deepStrictEqual(assistantEvents.map((e) => e.kind), ['assistant_thinking', 'tool_call', 'assistant_text']);
  assert.ok(assistantEvents.every((e) => e.line === 4 && e.ts === T0 + 3000));
  assert.strictEqual(assistantEvents[0].text, 'plan the run');
  const call = assistantEvents[1];
  assert.strictEqual(call.tool.toolCallId, 'call_1');
  assert.strictEqual(call.tool.name, 'exec');
  assert.strictEqual(call.tool.argsPreview, '{"command":"npm test"}');
  assert.strictEqual(call.tool.resultLine, null); // back-paired later by readEvents
  assert.strictEqual(assistantEvents[2].text, 'Running now');

  // toolResult keeps slim details (exitCode/durationMs/cwd/status), drops aggregated
  const [result] = reader.normalizeTranscriptEvents(l5, { lineNumber: 5 });
  assert.strictEqual(result.kind, 'tool_result');
  assert.strictEqual(result.role, 'toolResult');
  assert.strictEqual(result.tool.toolCallId, 'call_1');
  assert.strictEqual(result.tool.name, 'exec');
  assert.strictEqual(result.tool.resultPreview, 'all green');
  assert.deepStrictEqual(result.tool.details, { status: 'passed', exitCode: 0, durationMs: 1234, cwd: '/tmp/proj' });

  // Unknown line type passes through as a generic tick (never dropped)
  const [tick] = reader.normalizeTranscriptEvents(l7, { lineNumber: 7 });
  assert.strictEqual(tick.kind, 'other');
  assert.strictEqual(tick.line, 7);
  assert.strictEqual(tick.text, 'future_widget');

  // Unknown type without customType falls back to the raw type string
  const [bare] = reader.normalizeTranscriptEvents({ type: 'mystery_box' }, { lineNumber: 8 });
  assert.strictEqual(bare.kind, 'other');
  assert.strictEqual(bare.text, 'mystery_box');

  // System ticks
  const [thinking] = reader.normalizeTranscriptEvents(
    { type: 'thinking_level_change', thinkingLevel: 'high', data: { timestamp: T0 + 6000 } },
    { lineNumber: 9 }
  );
  assert.strictEqual(thinking.kind, 'other');
  assert.strictEqual(thinking.text, 'thinking:high');

  const [compaction] = reader.normalizeTranscriptEvents(
    { type: 'compaction', summary: 'compacted 500 lines', data: { timestamp: T0 + 7000 } },
    { lineNumber: 10 }
  );
  assert.strictEqual(compaction.kind, 'compaction');
  assert.strictEqual(compaction.text, 'compacted 500 lines');

  // Preview truncation on by default; detail mode keeps full bodies
  const longText = 'x'.repeat(reader.PREVIEW_MAX_CHARS + 50);
  const [truncatedUser] = reader.normalizeTranscriptEvents(
    { type: 'message', message: { role: 'user', content: longText } },
    {}
  );
  assert.strictEqual(truncatedUser.text.length, reader.PREVIEW_MAX_CHARS);
  const [fullUser] = reader.normalizeTranscriptEvents(
    { type: 'message', message: { role: 'user', content: longText } },
    { truncate: false }
  );
  assert.strictEqual(fullUser.text.length, longText.length);

  // Degenerate inputs yield no events
  assert.deepStrictEqual(reader.normalizeTranscriptEvents(null, {}), []);
  assert.deepStrictEqual(reader.normalizeTranscriptEvents('nope', {}), []);
  const [unknownEmpty] = reader.normalizeTranscriptEvents({}, {});
  assert.strictEqual(unknownEmpty.kind, 'other');
  assert.strictEqual(unknownEmpty.text, 'unknown');

  console.log('normalizeTranscriptEvents tests passed');
}

async function testReadEventsPagination() {
  await writeFixtureSession(SESSION, fixtureLines());

  // Page 1: limit=3 stops at line granularity after line 3.
  const p1 = await reader.readEvents(SESSION, AGENT, { limit: 3 });
  assert.strictEqual(p1.notFound, undefined);
  assert.deepStrictEqual(p1.events.map((e) => e.kind), ['session_meta', 'model_change', 'user_message']);
  assert.strictEqual(p1.hasMore, true);
  assert.strictEqual(p1.nextAfterLine, 3);
  assert.strictEqual(p1.totalLines, 7);
  assert.strictEqual(p1.partial, true); // garbage line 6
  assert.strictEqual(p1.truncated, false);

  // Page 2: an assistant line's event group is never split across pages.
  const p2 = await reader.readEvents(SESSION, AGENT, { afterLine: 3, limit: 3 });
  assert.deepStrictEqual(p2.events.map((e) => e.kind), ['assistant_thinking', 'tool_call', 'assistant_text']);
  assert.ok(p2.events.every((e) => e.line === 4));
  // Back-pairing runs over the full scan even though the result lands on a later page.
  assert.strictEqual(p2.events[1].tool.resultLine, 5);
  assert.strictEqual(p2.hasMore, true);
  assert.strictEqual(p2.nextAfterLine, 4);

  // Page 3: tool_result + trailing tick; cursor terminates cleanly.
  const p3 = await reader.readEvents(SESSION, AGENT, { afterLine: 4, limit: 3 });
  assert.deepStrictEqual(p3.events.map((e) => e.kind), ['tool_result', 'other']);
  assert.strictEqual(p3.events[0].tool.details.exitCode, 0);
  assert.strictEqual(p3.hasMore, false);
  assert.strictEqual(p3.nextAfterLine, null);

  // Default/clamped limit returns everything in one page.
  const all = await reader.readEvents(SESSION, AGENT, { limit: 999999 });
  assert.strictEqual(all.events.length, 8);
  assert.strictEqual(all.hasMore, false);
  assert.strictEqual(reader.EVENTS_DEFAULT_LIMIT, 500);
  assert.strictEqual(reader.EVENTS_MAX_LIMIT, 2000);

  console.log('readEvents pagination tests passed');
}

async function testReadEventAtLine() {
  // Detail view: first event of the line plus extras, untruncated, raw source included.
  const detail = await reader.readEventAtLine(SESSION, AGENT, 4);
  assert.strictEqual(detail.found, true);
  assert.strictEqual(detail.event.kind, 'assistant_thinking');
  assert.deepStrictEqual(detail.extraEvents.map((e) => e.kind), ['tool_call', 'assistant_text']);
  assert.strictEqual(detail.extraEvents[0].tool.argsPreview, '{"command":"npm test"}');
  assert.strictEqual(detail.source.message.content[1].arguments.command, 'npm test');
  assert.strictEqual(detail.totalLines, 7);

  // Detail view exposes the raw source line, so heavy toolResult.details
  // (aggregated etc.) stay reachable there — normalized events stay slim.
  const resultDetail = await reader.readEventAtLine(SESSION, AGENT, 5);
  assert.strictEqual(resultDetail.found, true);
  assert.strictEqual(resultDetail.event.tool.details.aggregated, undefined);
  assert.deepStrictEqual(resultDetail.source.message.details.aggregated, { big: 'payload' });

  // Garbage line and out-of-range line report found=false.
  const garbage = await reader.readEventAtLine(SESSION, AGENT, 6);
  assert.strictEqual(garbage.found, false);
  const missing = await reader.readEventAtLine(SESSION, AGENT, 99);
  assert.strictEqual(missing.found, false);
  assert.strictEqual(missing.totalLines, 7);

  console.log('readEventAtLine tests passed');
}

async function testSizeCapTruncation() {
  const bigLines = [
    JSON.stringify({ type: 'session', cwd: '/tmp/proj' }), // ~38 bytes incl newline
    JSON.stringify({
      type: 'message',
      message: { role: 'user', timestamp: T0 + 9000, content: 'y'.repeat(300) },
    }),
  ];
  await writeFixtureSession('sess-big', bigLines);

  const capped = await reader.readEvents('sess-big', AGENT, { maxBytes: 40 });
  assert.strictEqual(capped.truncated, true);
  assert.strictEqual(capped.partial, true); // second line cut mid-bytes fails to parse
  assert.deepStrictEqual(capped.events.map((e) => e.kind), ['session_meta']);
  assert.strictEqual(capped.totalLines, 2);

  // Same file without the cap reads fully.
  const uncapped = await reader.readEvents('sess-big', AGENT, { maxBytes: 1024 * 1024 });
  assert.strictEqual(uncapped.truncated, false);
  assert.strictEqual(uncapped.partial, false);
  assert.strictEqual(uncapped.events.length, 2);

  console.log('size-cap truncation tests passed');
}

async function testMissingFile() {
  const events = await reader.readEvents('missing-session', 'ghost-agent');
  assert.strictEqual(events.notFound, true);
  assert.deepStrictEqual(events.events, []);
  assert.strictEqual(events.totalLines, 0);
  assert.strictEqual(events.truncated, false);

  const detail = await reader.readEventAtLine('missing-session', 'ghost-agent', 1);
  assert.strictEqual(detail.notFound, true);
  assert.strictEqual(detail.found, false);

  console.log('missing-file tests passed');
}

// ── Route wiring ─────────────────────────────────────────────────────────────

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(body) {
      this.body = body || '';
    },
    get json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

function createMockReq(method, url) {
  return { method, url, headers: { host: 'localhost:3876' }, on() {} };
}

async function dispatch(router, method, url) {
  const req = createMockReq(method, url);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, {});
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  return res;
}

async function testRoutes() {
  const Router = require('../routes/router');
  const routesPath = require.resolve('../routes/session-routes');
  const readerPath = require.resolve('../lib/session-jsonl-reader');
  const originalReader = require.cache[readerPath];
  const originalRoutes = require.cache[routesPath];

  function loadWithReader(stub) {
    delete require.cache[routesPath];
    require.cache[readerPath] = { id: readerPath, filename: readerPath, loaded: true, exports: stub };
    const mod = require('../routes/session-routes');
    const router = new Router();
    mod.registerSessionRoutes(router);
    return { router, restore() { delete require.cache[routesPath]; if (originalRoutes) require.cache[routesPath] = originalRoutes; if (originalReader) require.cache[readerPath] = originalReader; else delete require.cache[readerPath]; } };
  }

  // Happy path: query parsing and payload pass-through.
  let eventsArgs = null;
  let detailArgs = null;
  const payload = { sessionId: 's1', agentId: 'replay-agent', events: [], nextAfterLine: null, hasMore: false, totalLines: 3, partial: false, truncated: false };
  const loaded = loadWithReader({
    EVENTS_DEFAULT_LIMIT: 500,
    async readEvents(sessionId, agentId, opts) {
      eventsArgs = { sessionId, agentId, opts };
      return payload;
    },
    async readEventAtLine(sessionId, agentId, line) {
      detailArgs = { sessionId, agentId, line };
      return { sessionId, agentId, line, found: true, event: { kind: 'session_meta' }, extraEvents: [], source: {}, totalLines: 3 };
    },
  });

  for (const [method, route] of [
    ['GET', '/api/oc/sessions/:sessionId/events'],
    ['GET', '/api/oc/sessions/:sessionId/events/:line'],
  ]) {
    assert.ok(
      loaded.router.list().some((r) => r.method === method && r.path === route),
      `${method} ${route} should be registered`
    );
  }

  const okEvents = await dispatch(loaded.router, 'GET', '/api/oc/sessions/s1/events?agent=replay-agent&afterLine=7&limit=25');
  assert.strictEqual(okEvents.statusCode, 200);
  assert.deepStrictEqual(eventsArgs, { sessionId: 's1', agentId: 'replay-agent', opts: { afterLine: 7, limit: 25 } });
  assert.deepStrictEqual(okEvents.json, payload);

  const defaultEvents = await dispatch(loaded.router, 'GET', '/api/oc/sessions/s1/events');
  assert.strictEqual(defaultEvents.statusCode, 200);
  assert.deepStrictEqual(eventsArgs.opts, { afterLine: 0, limit: 500 });

  const okDetail = await dispatch(loaded.router, 'GET', '/api/oc/sessions/s1/events/12?agent=replay-agent');
  assert.strictEqual(okDetail.statusCode, 200);
  assert.deepStrictEqual(detailArgs, { sessionId: 's1', agentId: 'replay-agent', line: 12 });
  assert.deepStrictEqual(okDetail.json.event, { kind: 'session_meta' });

  loaded.restore();

  // Missing session maps to 404 on both endpoints; invalid line maps to 400.
  const notFoundLoaded = loadWithReader({
    async readEvents() {
      return { ...payload, notFound: true };
    },
    async readEventAtLine() {
      return { notFound: true };
    },
  });

  const missEvents = await dispatch(notFoundLoaded.router, 'GET', '/api/oc/sessions/gone/events');
  assert.strictEqual(missEvents.statusCode, 404);
  assert.deepStrictEqual(missEvents.json, { error: 'Session not found' });

  const missDetail = await dispatch(notFoundLoaded.router, 'GET', '/api/oc/sessions/gone/events/5');
  assert.strictEqual(missDetail.statusCode, 404);
  assert.deepStrictEqual(missDetail.json, { error: 'Session not found' });

  const badLine = await dispatch(notFoundLoaded.router, 'GET', '/api/oc/sessions/gone/events/not-a-number');
  assert.strictEqual(badLine.statusCode, 400);
  assert.deepStrictEqual(badLine.json, { error: 'Invalid line number' });

  notFoundLoaded.restore();

  console.log('events route tests passed');
}

async function run() {
  assert.strictEqual(reader.AGENTS_DIR, path.join(FAKE_HOME, '.openclaw', 'agents'));

  await testNormalizeTranscriptEvents();
  await testReadEventsPagination();
  await testReadEventAtLine();
  await testSizeCapTruncation();
  await testMissingFile();
  await testRoutes();

  fs.rmSync(FAKE_HOME, { recursive: true, force: true });
  console.log('Session replay reader tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
