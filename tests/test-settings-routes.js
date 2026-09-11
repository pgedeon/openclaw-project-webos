#!/usr/bin/env node
/**
 * Focused tests for routes/settings-routes.js.
 * Run: node tests/test-settings-routes.js
 *
 * Source fixes covered here:
 * - Settings handlers now return `true` through a local registration wrapper so
 *   task-server.js does not fall through after a settings route already wrote a
 *   response.
 * - The optional deps argument now defaults to `{}` so missing external
 *   dependencies degrade through route-level fallback behavior.
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerSettingsRoutes } = require('../routes/settings-routes');

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
  const bodyText = body === undefined
    ? ''
    : typeof body === 'string'
      ? body
      : JSON.stringify(body);

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
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res;
}

function createStore(overrides = {}) {
  const calls = [];
  const store = {
    calls,
    getAll() {
      calls.push({ method: 'getAll', args: [] });
      return {
        general: { PORT: { value: 3876 } },
        database: { STORAGE_TYPE: { value: 'postgres' } },
      };
    },
    getSchema() {
      calls.push({ method: 'getSchema', args: [] });
      return { PORT: { type: 'number', category: 'general' } };
    },
    getSystemInfo(payload) {
      calls.push({ method: 'getSystemInfo', args: [payload] });
      return { uptime: 12, ...payload };
    },
    isRestartRequired() {
      calls.push({ method: 'isRestartRequired', args: [] });
      return { required: false, reasons: [] };
    },
    getChangeLog() {
      calls.push({ method: 'getChangeLog', args: [] });
      return [{ key: 'PORT', oldValue: 3876, newValue: 4000 }];
    },
    exportSettings() {
      calls.push({ method: 'exportSettings', args: [] });
      return { PORT: 3876 };
    },
    importSettings(settings) {
      calls.push({ method: 'importSettings', args: [settings] });
      return Object.keys(settings).map((key) => ({ key }));
    },
    load() {
      calls.push({ method: 'load', args: [] });
    },
    set(key, value) {
      calls.push({ method: 'set', args: [key, value] });
      return { key, newValue: value, hotReload: true };
    },
    setCategory(category, values) {
      calls.push({ method: 'setCategory', args: [category, values] });
      return Object.keys(values).map((key) => ({ key, newValue: values[key] }));
    },
    ...overrides,
  };
  return store;
}

function createRouter(store = createStore(), deps) {
  const router = new Router();
  registerSettingsRoutes(router, store, deps);
  return { router, store };
}

async function withSetTimeoutMock(fn) {
  const original = global.setTimeout;
  const calls = [];
  global.setTimeout = (callback, delay, ...args) => {
    calls.push({ callback, delay, args });
    return { mocked: true };
  };

  try {
    await fn(calls);
  } finally {
    global.setTimeout = original;
  }
}

async function run() {
  const originalConsoleLog = console.log;
  console.log = () => {};

  try {
    {
      const { router } = createRouter();
      const expectedRoutes = [
        ['GET', '/api/settings'],
        ['GET', '/api/settings/schema'],
        ['GET', '/api/settings/system-info'],
        ['GET', '/api/settings/restart-required'],
        ['GET', '/api/settings/changelog'],
        ['POST', '/api/settings/test-db'],
        ['POST', '/api/settings/test-gateway'],
        ['POST', '/api/settings/export'],
        ['POST', '/api/settings/import'],
        ['POST', '/api/settings/reload'],
        ['POST', '/api/settings/restart'],
        ['PUT', '/api/settings/key/:key'],
        ['GET', '/api/settings/:category'],
        ['PUT', '/api/settings/:category'],
      ];

      for (const [method, path] of expectedRoutes) {
        assert.ok(
          router.list().some((route) => route.method === method && route.path === path),
          `${method} ${path} should be registered`
        );
      }
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'GET', '/api/settings');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, {
        ok: true,
        settings: {
          general: { PORT: { value: 3876 } },
          database: { STORAGE_TYPE: { value: 'postgres' } },
        },
      });
    }

    {
      const { router } = createRouter(createStore({
        getAll() {
          throw new Error('settings read failed');
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /settings read failed/);
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'GET', '/api/settings/schema');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json.schema, { PORT: { type: 'number', category: 'general' } });
    }

    {
      const { router } = createRouter(createStore({
        getSchema() {
          throw new Error('schema unavailable');
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings/schema');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /schema unavailable/);
    }

    {
      const store = createStore();
      const deps = {
        startedAt: '2026-03-12T12:00:00.000Z',
        getSSEClientCount: () => 3,
        gatewayClient: { connected: true, url: 'ws://gateway.test' },
      };
      const { router } = createRouter(store, deps);
      const res = await dispatch(router, 'GET', '/api/settings/system-info');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(store.calls.find((call) => call.method === 'getSystemInfo').args[0], {
        startedAt: '2026-03-12T12:00:00.000Z',
        sseClients: 3,
        gatewayConnected: true,
      });
      assert.strictEqual(res.json.system.gatewayConnected, true);
    }

    {
      const { router } = createRouter(createStore(), undefined);
      const res = await dispatch(router, 'GET', '/api/settings/system-info');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.system.sseClients, 0);
      assert.strictEqual(res.json.system.gatewayConnected, false);
    }

    {
      const { router } = createRouter(createStore({
        getSystemInfo() {
          throw new Error('system info failed');
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings/system-info');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /system info failed/);
    }

    {
      const { router } = createRouter(createStore({
        isRestartRequired() {
          return { required: true, reasons: ['PORT'] };
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings/restart-required');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, { required: true, reasons: ['PORT'] });
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'GET', '/api/settings/changelog');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json.changelog, [{ key: 'PORT', oldValue: 3876, newValue: 4000 }]);
    }

    {
      const { router } = createRouter(createStore({
        getChangeLog() {
          throw new Error('changelog failed');
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings/changelog');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /changelog failed/);
    }

    {
      const { router } = createRouter(createStore(), {});
      const res = await dispatch(router, 'POST', '/api/settings/test-db');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, { ok: false, error: 'No database pool configured' });
    }

    {
      let queryText = null;
      let released = false;
      const pool = {
        async connect() {
          return {
            async query(sql) {
              queryText = sql;
            },
            release() {
              released = true;
            },
          };
        },
      };
      const { router } = createRouter(createStore(), { pool });
      const res = await dispatch(router, 'POST', '/api/settings/test-db');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.ok, true);
      assert.strictEqual(typeof res.json.latency, 'number');
      assert.strictEqual(queryText, 'SELECT 1');
      assert.strictEqual(released, true);
    }

    {
      const pool = {
        async connect() {
          throw new Error('connection refused');
        },
      };
      const { router } = createRouter(createStore(), { pool });
      const res = await dispatch(router, 'POST', '/api/settings/test-db');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, { ok: false, error: 'connection refused' });
    }

    {
      const { router } = createRouter(createStore(), {
        gatewayClient: { connected: true, url: 'ws://gateway.test' },
      });
      const res = await dispatch(router, 'POST', '/api/settings/test-gateway');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, {
        ok: true,
        connected: true,
        url: 'ws://gateway.test',
      });
    }

    {
      const { router } = createRouter(createStore(), {});
      const res = await dispatch(router, 'POST', '/api/settings/test-gateway');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, {
        ok: false,
        connected: false,
        url: 'unknown',
      });
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'POST', '/api/settings/export');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.ok, true);
      assert.deepStrictEqual(res.json.settings, { PORT: 3876 });
      assert.match(res.json.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    }

    {
      const { router } = createRouter(createStore({
        exportSettings() {
          throw new Error('export failed');
        },
      }));
      const res = await dispatch(router, 'POST', '/api/settings/export');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /export failed/);
    }

    {
      const store = createStore();
      const { router } = createRouter(store);
      const res = await dispatch(router, 'POST', '/api/settings/import', {
        settings: { PORT: 4000, theme: 'dark' },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(store.calls.find((call) => call.method === 'importSettings').args[0], {
        PORT: 4000,
        theme: 'dark',
      });
      assert.deepStrictEqual(res.json, {
        ok: true,
        imported: 2,
        required: false,
        reasons: [],
      });
    }

    {
      const { router } = createRouter();
      const missing = await dispatch(router, 'POST', '/api/settings/import', { PORT: 4000 });
      assert.strictEqual(missing.statusCode, 400);
      assert.match(missing.json.error, /settings object required/);

      const invalidJson = await dispatch(router, 'POST', '/api/settings/import', '{not json');
      assert.strictEqual(invalidJson.statusCode, 400);
      assert.match(invalidJson.json.error, /settings object required/);
    }

    {
      const { router } = createRouter(createStore({
        importSettings() {
          throw new Error('invalid setting key');
        },
      }));
      const res = await dispatch(router, 'POST', '/api/settings/import', {
        settings: { UNKNOWN_KEY: true },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.json.error, /invalid setting key/);
    }

    {
      const { router } = createRouter();
      for (let i = 0; i < 10; i++) {
        const res = await dispatch(router, 'PUT', `/api/settings/key/KEY_${i}`, { value: i });
        assert.strictEqual(res.statusCode, 200);
      }
      const limited = await dispatch(router, 'PUT', '/api/settings/key/KEY_10', { value: 10 });
      assert.strictEqual(limited.statusCode, 429);
      assert.match(limited.json.error, /Rate limit reached/);
    }

    {
      const { router, store } = createRouter();
      const res = await dispatch(router, 'POST', '/api/settings/reload');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, { ok: true, message: 'Settings reloaded from disk' });
      assert.ok(store.calls.some((call) => call.method === 'load'));
    }

    {
      const { router } = createRouter(createStore({
        load() {
          throw new Error('reload failed');
        },
      }));
      const res = await dispatch(router, 'POST', '/api/settings/reload');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /reload failed/);
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'POST', '/api/settings/restart', {});
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.json.error, /confirm.+restart/);
    }

    await withSetTimeoutMock(async (timeouts) => {
      const { router } = createRouter();
      const res = await dispatch(router, 'POST', '/api/settings/restart', { confirm: 'restart' });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, { ok: true, message: 'Restarting server...' });
      assert.strictEqual(timeouts.length, 1);
      assert.strictEqual(timeouts[0].delay, 500);
    });

    {
      const { router, store } = createRouter();
      const res = await dispatch(router, 'PUT', '/api/settings/key/theme', { value: false });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(store.calls.find((call) => call.method === 'set').args, ['theme', false]);
      assert.deepStrictEqual(res.json, {
        ok: true,
        key: 'theme',
        newValue: false,
        hotReload: true,
        required: false,
        reasons: [],
      });
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'PUT', '/api/settings/key/theme', {});
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.json.error, /value required/);
    }

    {
      const { router } = createRouter(createStore({
        set() {
          throw new Error('invalid value');
        },
      }));
      const res = await dispatch(router, 'PUT', '/api/settings/key/theme', { value: 'huge' });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.json.error, /invalid value/);
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'GET', '/api/settings/general');
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.json, {
        ok: true,
        category: 'general',
        settings: { PORT: { value: 3876 } },
      });
    }

    {
      const { router } = createRouter();
      const res = await dispatch(router, 'GET', '/api/settings/unknown');
      assert.strictEqual(res.statusCode, 404);
      assert.match(res.json.error, /Category 'unknown' not found/);
    }

    {
      const { router } = createRouter(createStore({
        getAll() {
          throw new Error('category read failed');
        },
      }));
      const res = await dispatch(router, 'GET', '/api/settings/general');
      assert.strictEqual(res.statusCode, 500);
      assert.match(res.json.error, /category read failed/);
    }

    {
      const { router, store } = createRouter();
      const res = await dispatch(router, 'PUT', '/api/settings/appearance', {
        theme: 'light',
        accentColor: '#60CDFF',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(store.calls.find((call) => call.method === 'setCategory').args, [
        'appearance',
        { theme: 'light', accentColor: '#60CDFF' },
      ]);
      assert.deepStrictEqual(res.json, {
        ok: true,
        updated: [
          { key: 'theme', newValue: 'light' },
          { key: 'accentColor', newValue: '#60CDFF' },
        ],
        required: false,
        reasons: [],
      });
    }

    {
      const { router } = createRouter(createStore({
        setCategory() {
          throw new Error('category update failed');
        },
      }));
      const res = await dispatch(router, 'PUT', '/api/settings/appearance', { theme: 'light' });
      assert.strictEqual(res.statusCode, 400);
      assert.match(res.json.error, /category update failed/);
    }
  } finally {
    console.log = originalConsoleLog;
  }

  console.log('PASS: settings routes');
}

run().catch((error) => {
  console.error('FAIL: settings routes');
  console.error(error);
  process.exit(1);
});
