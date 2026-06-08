#!/usr/bin/env node
/**
 * Focused tests for routes/memory-routes.js.
 * Run: node tests/test-memory-routes.js
 *
 * Source fix covered here: routes/memory-routes.js defined a secret scrubber
 * but streamed memory file write bodies directly upstream. The file write
 * proxy now buffers JSON bodies, redacts the content field, and updates the
 * forwarded Content-Length header before calling the memory API.
 */

const assert = require('assert');
const http = require('http');
const { Readable, Writable } = require('stream');
const Router = require('../routes/router');
const { registerMemoryRoutes } = require('../routes/memory-routes');

function createMockReq(method, url, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: 'localhost:3876',
    authorization: 'Bearer dashboard-token',
    'content-type': 'application/json',
  };
  return req;
}

function createMockRes() {
  const res = new Writable({
    write(chunk, encoding, callback) {
      res.body += chunk.toString();
      callback();
    },
  });
  res.statusCode = null;
  res.headers = {};
  res.body = '';
  res.writeHead = (status, headers) => {
    res.statusCode = status;
    res.headers = headers || {};
  };
  res.json = () => JSON.parse(res.body || '{}');
  return res;
}

async function dispatch(router, method, url, options = {}) {
  const req = createMockReq(method, url, options.body);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, {});
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return { req, res };
}

function createUpstreamResponse(statusCode, headers, body) {
  const upstream = Readable.from([Buffer.from(body)]);
  upstream.statusCode = statusCode;
  upstream.headers = { ...headers };
  return upstream;
}

async function withHttpRequestMock(implementation, fn) {
  const originalRequest = http.request;
  const calls = [];

  http.request = (options, callback) => {
    const call = { options, body: '' };
    calls.push(call);

    const proxyReq = new Writable({
      write(chunk, encoding, done) {
        call.body += chunk.toString();
        done();
      },
    });

    proxyReq.on = function on(event, handler) {
      if (event === 'error') {
        call.errorHandler = handler;
        return proxyReq;
      }
      return Writable.prototype.on.call(proxyReq, event, handler);
    };

    implementation(call, callback);
    return proxyReq;
  };

  try {
    await fn(calls);
  } finally {
    http.request = originalRequest;
  }
}

async function withConsoleErrorSilenced(fn) {
  const originalError = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = originalError;
  }
}

function createRouter() {
  const router = new Router();
  registerMemoryRoutes(router);
  return router;
}

async function run() {
  const router = createRouter();

  const expectedRoutes = [
    ['GET', '/api/memory/list'],
    ['GET', '/api/memory/file/:name'],
    ['GET', '/api/memory/root'],
    ['GET', '/api/memory/search'],
    ['GET', '/api/memory/facts'],
    ['GET', '/api/memory/facts/list'],
    ['GET', '/api/memory/facts/search'],
    ['GET', '/api/memory/status'],
    ['GET', '/api/memory/stats'],
    ['GET', '/api/memory/context'],
    ['PUT', '/api/memory/file/:name'],
    ['POST', '/api/memory/file/:name/append'],
    ['POST', '/api/memory/file/:name'],
    ['POST', '/api/memory/facts'],
    ['DELETE', '/api/memory/file/:name'],
    ['DELETE', '/api/memory/facts'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  await withHttpRequestMock((call, callback) => {
    queueMicrotask(() => {
      callback(createUpstreamResponse(200, { 'content-type': 'application/json' }, '{"files":[]}'));
    });
  }, async (calls) => {
    const { res } = await dispatch(router, 'GET', '/api/memory/list');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json(), { files: [] });
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].options, {
      hostname: '127.0.0.1',
      port: 3879,
      path: '/api/memory/list',
      method: 'GET',
      headers: {
        host: '127.0.0.1:3879',
        authorization: 'Bearer dashboard-token',
        'content-type': 'application/json',
      },
    });
    assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:3876');
  });

  const proxyCases = [
    ['GET', '/api/memory/file/behavior.md', '/api/memory/file/behavior.md'],
    ['GET', '/api/memory/root', '/api/memory/root'],
    ['GET', '/api/memory/search?q=alpha&limit=3', '/api/memory/search?q=alpha&limit=3'],
    ['GET', '/api/memory/facts', '/api/memory/facts'],
    ['GET', '/api/memory/facts/list?namespace=core', '/api/memory/facts/list?namespace=core'],
    ['GET', '/api/memory/facts/search?query=theme', '/api/memory/facts/search?query=theme'],
    ['GET', '/api/memory/status', '/api/memory/status'],
    ['GET', '/api/memory/stats', '/api/memory/stats'],
    ['GET', '/api/memory/context?scope=all&limit=5', '/api/memory/context?scope=all&limit=5'],
    ['PUT', '/api/memory/file/behavior.md', '/api/memory/file/behavior.md'],
    ['POST', '/api/memory/file/behavior.md/append', '/api/memory/file/behavior.md/append'],
    ['POST', '/api/memory/file/behavior.md', '/api/memory/file/behavior.md'],
    ['POST', '/api/memory/facts', '/api/memory/facts'],
    ['DELETE', '/api/memory/file/behavior.md', '/api/memory/file/behavior.md'],
    ['DELETE', '/api/memory/facts', '/api/memory/facts'],
  ];

  for (const [method, url, expectedPath] of proxyCases) {
    await withHttpRequestMock((call, callback) => {
      queueMicrotask(() => {
        callback(createUpstreamResponse(202, { 'x-upstream': 'memory-api' }, '{"ok":true}'));
      });
    }, async (calls) => {
      const { res } = await dispatch(router, method, url);
      assert.strictEqual(res.statusCode, 202, `${method} ${url} should forward upstream status`);
      assert.strictEqual(res.headers['x-upstream'], 'memory-api');
      assert.strictEqual(calls[0].options.method, method);
      assert.strictEqual(calls[0].options.path, expectedPath);
    });
  }

  await withHttpRequestMock((call, callback) => {
    queueMicrotask(() => {
      callback(createUpstreamResponse(201, { 'content-type': 'application/json' }, '{"saved":true}'));
    });
  }, async (calls) => {
    const body = JSON.stringify({ content: 'Remember auth_token=abcd1234 stays upstream-owned' });
    const { res } = await dispatch(router, 'POST', '/api/memory/file/secrets.md', { body });
    assert.strictEqual(res.statusCode, 201);
    assert.deepStrictEqual(res.json(), { saved: true });
    const forwarded = JSON.parse(calls[0].body);
    assert.match(forwarded.content, /\*\*\*REDACTED\*\*\*/);
    assert.ok(!forwarded.content.includes('abcd1234'), 'secret value should not be forwarded upstream');
    assert.strictEqual(calls[0].options.headers['content-length'], Buffer.byteLength(calls[0].body));
  });

  await withHttpRequestMock((call, callback) => {
    queueMicrotask(() => {
      callback(createUpstreamResponse(404, { 'content-type': 'application/json' }, '{"error":"missing"}'));
    });
  }, async () => {
    const { res } = await dispatch(router, 'GET', '/api/memory/file/missing.md');
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.json(), { error: 'missing' });
  });

  await withConsoleErrorSilenced(async () => {
    await withHttpRequestMock((call) => {
      queueMicrotask(() => {
        call.errorHandler(new Error('connect ECONNREFUSED 127.0.0.1:3879'));
      });
    }, async () => {
      const { res } = await dispatch(router, 'GET', '/api/memory/status');
      assert.strictEqual(res.statusCode, 502);
      assert.deepStrictEqual(res.headers, { 'Content-Type': 'application/json' });
      assert.deepStrictEqual(res.json(), {
        error: 'Memory API unavailable',
        detail: 'connect ECONNREFUSED 127.0.0.1:3879',
      });
    });
  });

  await withHttpRequestMock((call, callback) => {
    queueMicrotask(() => {
      callback(createUpstreamResponse(200, {}, '{"results":[]}'));
    });
  }, async (calls) => {
    const { res } = await dispatch(router, 'GET', '/api/memory/search');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(calls[0].options.path, '/api/memory/search?');
  });

  const unhandled = await router.handle(
    createMockReq('PATCH', '/api/memory/file/behavior.md'),
    createMockRes(),
    '/api/memory/file/behavior.md',
    'PATCH',
    {}
  );
  assert.strictEqual(unhandled, false, 'unregistered memory methods should not be handled');

  console.log('test-memory-routes: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
