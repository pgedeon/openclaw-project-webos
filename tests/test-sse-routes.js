#!/usr/bin/env node
/**
 * Focused tests for routes/sse-routes.js.
 * Run: node tests/test-sse-routes.js
 *
 * No source fixes were required while adding these tests.
 */

const assert = require('assert');
const Router = require('../routes/router');

function createMockReq(method = 'GET', url = '/api/events') {
  const listeners = {};
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event) {
      if (listeners[event]) listeners[event]();
    },
  };
}

function createMockRes(options = {}) {
  const listeners = {};
  let writeCallCount = 0;
  return {
    statusCode: null,
    headers: {},
    writes: [],
    writeCalls: 0,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    write(payload) {
      this.writeCalls++;
      writeCallCount++;
      if (options.writeReturnsFalse && options.writeReturnsFalse(payload, writeCallCount)) {
        return false;
      }
      if (options.throwOnWrite && options.throwOnWrite(payload, this.writeCalls)) {
        throw new Error('mock write failed');
      }
      this.writes.push(payload);
      return true;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    emit(event) {
      if (listeners[event]) listeners[event]();
    },
  };
}

async function withFreshSSEModule(fn) {
  const modulePath = require.resolve('../routes/sse-routes');
  const previousCache = require.cache[modulePath];
  const originalSetInterval = global.setInterval;
  const intervals = [];

  delete require.cache[modulePath];
  global.setInterval = (handler, ms) => {
    const interval = {
      handler,
      ms,
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
      },
    };
    intervals.push(interval);
    return interval;
  };

  try {
    const sse = require('../routes/sse-routes');
    await fn(sse, intervals);
  } finally {
    global.setInterval = originalSetInterval;
    delete require.cache[modulePath];
    if (previousCache) {
      require.cache[modulePath] = previousCache;
    }
  }
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

async function connect(router, options = {}) {
  const req = createMockReq('GET', options.url || '/api/events');
  const res = createMockRes(options.resOptions);
  const pathname = req.url.split('?')[0];
  const handled = await router.handle(req, res, pathname, 'GET', options.context);
  assert.strictEqual(handled, true, `GET ${options.url || '/api/events'} should be handled`);
  return { req, res };
}

async function run() {
  await withFreshSSEModule(async ({ registerSSERoutes }) => {
    const router = new Router();
    registerSSERoutes(router);

    assert.ok(
      router.list().some((route) => route.method === 'GET' && route.path === '/api/events'),
      'GET /api/events should be registered'
    );
    assert.ok(
      router.list().some((route) => route.method === 'GET' && route.path === '/api/events/stream'),
      'GET /api/events/stream should be registered'
    );

    const req = createMockReq('POST', '/api/events/stream');
    const res = createMockRes();
    const handled = await router.handle(req, res, '/api/events/stream', 'POST', undefined);
    assert.strictEqual(handled, false, 'POST /api/events/stream should not match the SSE route');
  });

  await withEnv({ PORT: '4999' }, async () => {
    await withFreshSSEModule(async ({ registerSSERoutes }, intervals) => {
      const router = new Router();
      registerSSERoutes(router);
      const { res } = await connect(router, { context: undefined });

      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.headers, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': 'http://localhost:4999',
      });
      assert.deepStrictEqual(res.writes, [': connected\n\n']);
      assert.strictEqual(intervals.length, 1, 'heartbeat should start on first connection');
      assert.strictEqual(intervals[0].ms, 30_000);
      assert.strictEqual(intervals[0].unrefCalled, true, 'heartbeat should not keep the process alive');
    });
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast }, intervals) => {
    const router = new Router();
    registerSSERoutes(router);
    const first = await connect(router);
    const second = await connect(router);

    assert.strictEqual(intervals.length, 1, 'multiple clients should share one heartbeat interval');

    broadcast('task:changed', { action: 'update', taskId: 'task-1' });

    const expected = 'event: task:changed\ndata: {"action":"update","taskId":"task-1"}\n\n';
    assert.strictEqual(first.res.writes.at(-1), expected);
    assert.strictEqual(second.res.writes.at(-1), expected);
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast }) => {
    const router = new Router();
    registerSSERoutes(router);
    const { req, res } = await connect(router);

    req.emit('close');
    broadcast('task:changed', { action: 'delete', taskId: 'closed-client-task' });

    assert.deepStrictEqual(res.writes, [': connected\n\n'], 'closed clients should be removed before later broadcasts');
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast }) => {
    const router = new Router();
    registerSSERoutes(router);
    const failing = await connect(router, {
      resOptions: {
        throwOnWrite: (payload) => payload.startsWith('event:'),
      },
    });
    const healthy = await connect(router);

    broadcast('project:changed', { action: 'create', projectId: 'project-1' });
    broadcast('project:changed', { action: 'update', projectId: 'project-1' });

    assert.strictEqual(failing.res.writeCalls, 2, 'failed client should be tried once for the first broadcast only');
    assert.strictEqual(
      healthy.res.writes.filter((payload) => payload.startsWith('event: project:changed')).length,
      2,
      'healthy client should receive both broadcasts'
    );
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast }, intervals) => {
    const router = new Router();
    registerSSERoutes(router);
    const healthy = await connect(router);
    const failing = await connect(router, {
      resOptions: {
        throwOnWrite: (payload) => payload.startsWith(': heartbeat'),
      },
    });

    intervals[0].handler();
    assert.match(healthy.res.writes.at(-1), /^: heartbeat \d{4}-\d{2}-\d{2}T/);

    broadcast('space:changed', { action: 'set_default', spaceId: 'space-1' });

    assert.strictEqual(failing.res.writeCalls, 2, 'heartbeat failure should remove the dead client');
    assert.strictEqual(healthy.res.writes.at(-1), 'event: space:changed\ndata: {"action":"set_default","spaceId":"space-1"}\n\n');
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast }) => {
    const router = new Router();
    registerSSERoutes(router);
    const { res } = await connect(router);

    const circular = {};
    circular.self = circular;
    assert.throws(() => broadcast('task:changed', circular), /circular/i);
    assert.deepStrictEqual(res.writes, [': connected\n\n'], 'unserializable payloads should not write partial SSE frames');

    broadcast('task:changed', null);
    assert.strictEqual(res.writes.at(-1), 'event: task:changed\ndata: null\n\n');
  });

  // ── Bridge-fed stream channel (/api/events/stream) ────────────────────

  await withEnv({ PORT: '4999' }, async () => {
    await withFreshSSEModule(async ({ registerSSERoutes, getStreamClientCount }) => {
      const router = new Router();
      registerSSERoutes(router);
      const { res } = await connect(router, { url: '/api/events/stream' });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['Content-Type'], 'text/event-stream');
      assert.deepStrictEqual(res.writes, [': connected\n\n']);
      assert.strictEqual(getStreamClientCount(), 1, 'stream client should be tracked');
    });
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcast, broadcastStream }) => {
    const router = new Router();
    registerSSERoutes(router);
    const legacy = await connect(router);
    const streamA = await connect(router, { url: '/api/events/stream' });
    const streamB = await connect(router, { url: '/api/events/stream' });

    broadcastStream('task-updated', { id: 't-1', updatedAt: 100, status: 'running' });

    const expected = 'event: task-updated\ndata: {"id":"t-1","updatedAt":100,"status":"running"}\n\n';
    assert.strictEqual(streamA.res.writes.at(-1), expected);
    assert.strictEqual(streamB.res.writes.at(-1), expected);
    assert.deepStrictEqual(legacy.res.writes, [': connected\n\n'], 'bridge events must not reach legacy clients');

    broadcast('task:changed', { action: 'update', taskId: 't-1' });
    const legacyFrame = 'event: task:changed\ndata: {"action":"update","taskId":"t-1"}\n\n';
    assert.strictEqual(legacy.res.writes.at(-1), legacyFrame);
    assert.strictEqual(streamA.res.writes.at(-1), expected, 'legacy broadcasts must not reach stream clients');
    assert.strictEqual(streamB.res.writes.at(-1), expected);
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcastStream, getStreamClientCount }) => {
    const router = new Router();
    registerSSERoutes(router);
    // Socket buffers everything (write always returns false): frames queue up.
    let bufferMode = true;
    const buffered = await connect(router, {
      url: '/api/events/stream',
      resOptions: { writeReturnsFalse: () => bufferMode },
    });

    for (let n = 1; n <= 105; n++) {
      broadcastStream('task-updated', { n });
    }
    assert.strictEqual(buffered.res.writes.length, 0, 'nothing reaches the socket while it is buffered');

    // Socket recovers: drain flushes the queue in order.
    bufferMode = false;
    buffered.res.emit('drain');

    const flushed = buffered.res.writes;
    const resyncFrames = flushed.filter((f) => f.startsWith('event: resync'));
    assert.strictEqual(resyncFrames.length, 1, 'exactly one resync hint after overflow');
    assert.strictEqual(resyncFrames[0], 'event: resync\ndata: {"reason":"overflow"}\n\n');
    const firstFrame = 'event: task-updated\ndata: {"n":1}\n\n';
    const lastFrame = 'event: task-updated\ndata: {"n":105}\n\n';
    assert.ok(!flushed.includes(firstFrame), 'oldest frame dropped on overflow');
    assert.ok(flushed.includes(lastFrame), 'newest frame survives');
    assert.ok(flushed.length <= 101, `queue stays bounded (max 100 + resync hint; got ${flushed.length})`);

    buffered.req.emit('close');
    assert.strictEqual(getStreamClientCount(), 0, 'closed stream clients are removed');
  });

  await withFreshSSEModule(async ({ registerSSERoutes, broadcastStream }) => {
    const router = new Router();
    registerSSERoutes(router);
    const circular = {};
    circular.self = circular;
    assert.throws(() => broadcastStream('task-updated', circular), /circular/i,
      'unserializable bridge payloads throw at the sink, before any client write');
  });

  console.log('PASS: sse routes');
}

run().catch((error) => {
  console.error('FAIL: sse routes');
  console.error(error);
  process.exit(1);
});
