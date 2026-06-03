#!/usr/bin/env node
/**
 * Focused tests for routes/bing-routes.js.
 * Run: node tests/test-bing-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerBingRoutes } = require('../routes/bing-routes');

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

function createMockReq(method, url, body) {
  const bodyText = body === undefined ? '' : body;
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on(event, handler) {
      if (event === 'data' && bodyText) {
        queueMicrotask(() => handler(Buffer.from(bodyText)));
      }
      if (event === 'end') {
        queueMicrotask(handler);
      }
    },
  };
}

async function dispatch(router, method, url, body) {
  const req = createMockReq(method, url, body);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, {});
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  return res;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function createFetchMock(handler) {
  const calls = [];
  const mock = async (url, options = {}) => {
    const call = { url, options };
    calls.push(call);
    return await handler(call, calls.length - 1);
  };
  mock.calls = calls;
  return mock;
}

function jsonResponse(data, status = 200) {
  return {
    status,
    async json() {
      return data;
    },
  };
}

async function withFetchMock(mockFetch, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
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

async function run() {
  const noKeyRouter = new Router();
  registerBingRoutes(noKeyRouter, '');
  assert.deepStrictEqual(noKeyRouter.list(), [], 'Bing routes should not register without an API key');

  const router = new Router();
  registerBingRoutes(router, 'test-key');

  const expectedRoutes = [
    ['GET', '/api/bing/quota'],
    ['POST', '/api/bing/submit'],
    ['POST', '/api/bing/submit-batch'],
    ['POST', '/api/bing/indexnow'],
    ['GET', '/api/bing/status'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  await withFetchMock(createFetchMock(async (call) => {
    assert.ok(call.url.startsWith('https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota'));
    assert.ok(call.url.includes('apikey=test-key'));
    assert.ok(call.url.includes('siteUrl=https%3A%2F%2Fexample.com'));
    return jsonResponse({ d: { dailyQuota: 100, used: 3 } });
  }), async () => {
    const res = await dispatch(router, 'GET', '/api/bing/quota?siteUrl=https://example.com');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, {
      ok: true,
      quota: { dailyQuota: 100, used: 3 },
    });
  });

  await withFetchMock(createFetchMock(async (call) => {
    assert.ok(call.url.includes('siteUrl=https%3A%2F%2F3dput.com'), 'quota should use default siteUrl');
    return jsonResponse({ dailyQuota: 25 });
  }), async () => {
    const res = await dispatch(router, 'GET', '/api/bing/quota');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, { ok: true, quota: { dailyQuota: 25 } });
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('quota failed');
  }), async () => {
    const res = await dispatch(router, 'GET', '/api/bing/quota');
    assert.strictEqual(res.statusCode, 500);
    assert.match(res.json.error, /quota failed/);
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('submit should not be called');
  }), async () => {
    const missingUrl = await dispatch(router, 'POST', '/api/bing/submit', jsonBody({ siteUrl: 'https://example.com' }));
    assert.strictEqual(missingUrl.statusCode, 400);
    assert.match(missingUrl.json.error, /url required/);

    const invalidJson = await dispatch(router, 'POST', '/api/bing/submit', '{not json');
    assert.strictEqual(invalidJson.statusCode, 400);
    assert.match(invalidJson.json.error, /url required/);
  });

  await withFetchMock(createFetchMock(async (call) => {
    assert.strictEqual(call.url, 'https://ssl.bing.com/webmaster/api.svc/json/SubmitUrl?apikey=test-key');
    assert.strictEqual(call.options.method, 'POST');
    assert.deepStrictEqual(call.options.headers, { 'Content-Type': 'application/json', charset: 'utf-8' });
    assert.deepStrictEqual(JSON.parse(call.options.body), {
      siteUrl: 'https://3dput.com',
      url: 'https://3dput.com/page',
    });
    return jsonResponse({ d: 'submitted' });
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/submit', jsonBody({ url: 'https://3dput.com/page' }));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, { ok: true, result: { d: 'submitted' } });
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('submit failed');
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/submit', jsonBody({ url: 'https://3dput.com/page' }));
    assert.strictEqual(res.statusCode, 500);
    assert.match(res.json.error, /submit failed/);
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('batch should not be called');
  }), async () => {
    const missingUrls = await dispatch(router, 'POST', '/api/bing/submit-batch', jsonBody({ urls: [] }));
    assert.strictEqual(missingUrls.statusCode, 400);
    assert.match(missingUrls.json.error, /urls array required/);

    const tooManyUrls = Array.from({ length: 501 }, (_, i) => `https://3dput.com/${i}`);
    const tooMany = await dispatch(router, 'POST', '/api/bing/submit-batch', jsonBody({ urls: tooManyUrls }));
    assert.strictEqual(tooMany.statusCode, 400);
    assert.match(tooMany.json.error, /Maximum 500 URLs/);
  });

  await withFetchMock(createFetchMock(async (call) => {
    assert.strictEqual(call.url, 'https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=test-key');
    assert.strictEqual(call.options.method, 'POST');
    assert.deepStrictEqual(JSON.parse(call.options.body), {
      siteUrl: 'https://example.com',
      urlList: ['https://example.com/a', 'https://example.com/b'],
    });
    return jsonResponse({ batch: true });
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/submit-batch', jsonBody({
      siteUrl: 'https://example.com',
      urls: ['https://example.com/a', 'https://example.com/b'],
    }));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, { ok: true, submitted: 2, result: { batch: true } });
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('batch failed');
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/submit-batch', jsonBody({ urls: ['https://3dput.com/page'] }));
    assert.strictEqual(res.statusCode, 500);
    assert.match(res.json.error, /batch failed/);
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('indexnow should not be called');
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/indexnow', jsonBody({ url: 'https://3dput.com/page' }));
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.json.error, /urls array required/);
  });

  await withEnv({
    WORDPRESS_API_URL: 'https://wp.example.test/wp-json',
    WORDPRESS_USER: 'operator',
    WORDPRESS_APP_PASS: 'app-pass',
  }, async () => {
    const fetchMock = createFetchMock(async (call, index) => {
      assert.strictEqual(call.url, 'https://wp.example.test/wp-json/indexnow/v_1.0.3/submitUrl');
      assert.strictEqual(call.options.method, 'POST');
      assert.strictEqual(call.options.headers.Authorization, 'Basic b3BlcmF0b3I6YXBwLXBhc3M=');
      const parsedBody = JSON.parse(call.options.body);
      assert.strictEqual(parsedBody.url, index === 0 ? 'https://example.com/a' : 'https://example.com/b');
      return jsonResponse({});
    });

    await withFetchMock(fetchMock, async () => {
      const res = await dispatch(router, 'POST', '/api/bing/indexnow', jsonBody({
        urls: ['https://example.com/a', 'https://example.com/b'],
      }));
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, {
        ok: true,
        submitted: 2,
        results: [
          { url: 'https://example.com/a', status: 200, error: '' },
          { url: 'https://example.com/b', status: 200, error: '' },
        ],
      });
      assert.strictEqual(fetchMock.calls.length, 2);
    });
  });

  await withFetchMock(createFetchMock(async (call, index) => {
    return index === 0
      ? jsonResponse({})
      : jsonResponse({ error: 'indexnow rejected' }, 400);
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/indexnow', jsonBody({
      urls: ['https://3dput.com/a', 'https://3dput.com/b'],
    }));
    assert.strictEqual(res.statusCode, 207);
    assert.strictEqual(res.json.ok, false);
    assert.strictEqual(res.json.submitted, 2);
    assert.strictEqual(res.json.results[1].status, 400);
    assert.strictEqual(res.json.results[1].error, 'indexnow rejected');
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('indexnow failed');
  }), async () => {
    const res = await dispatch(router, 'POST', '/api/bing/indexnow', jsonBody({ urls: ['https://3dput.com/page'] }));
    assert.strictEqual(res.statusCode, 500);
    assert.match(res.json.error, /indexnow failed/);
  });

  await withFetchMock(createFetchMock(async (call) => {
    assert.strictEqual(call.url, 'https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota?apikey=test-key&siteUrl=https://3dput.com');
    return jsonResponse({ d: { remaining: 12 } });
  }), async () => {
    const res = await dispatch(router, 'GET', '/api/bing/status');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, {
      ok: true,
      apiKeyConfigured: true,
      quota: { remaining: 12 },
    });
  });

  await withFetchMock(createFetchMock(async () => {
    throw new Error('status failed');
  }), async () => {
    const res = await dispatch(router, 'GET', '/api/bing/status');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.json, {
      ok: false,
      apiKeyConfigured: true,
      error: 'status failed',
    });
  });

  console.log('Bing route tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
