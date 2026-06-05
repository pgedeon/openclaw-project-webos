#!/usr/bin/env node
/**
 * Focused tests for routes/cron-routes.js.
 * Run: node tests/test-cron-routes.js
 *
 * Source fix covered here: OpenClaw CLI wrapper failures are returned as
 * `{ error: "..." }`; cron routes now treat that shape as a failed dependency
 * instead of returning successful empty/success responses.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Router = require('../routes/router');

const cliPath = require.resolve('../lib/openclaw-cli');
const cronRoutesPath = require.resolve('../routes/cron-routes');

function loadCronRoutesWithMockCli(mockCli) {
  const originalCli = require.cache[cliPath];
  const originalRoutes = require.cache[cronRoutesPath];
  delete require.cache[cronRoutesPath];

  require.cache[cliPath] = {
    id: cliPath,
    filename: cliPath,
    loaded: true,
    exports: mockCli,
  };

  const { registerCronRoutes } = require('../routes/cron-routes');
  return {
    registerCronRoutes,
    restore() {
      delete require.cache[cronRoutesPath];
      if (originalRoutes) {
        require.cache[cronRoutesPath] = originalRoutes;
      }
      if (originalCli) {
        require.cache[cliPath] = originalCli;
      } else {
        delete require.cache[cliPath];
      }
    },
  };
}

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function createRequest(url, method = 'GET') {
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on() {},
  };
}

function createContext(overrides = {}) {
  return {
    sendJSON,
    readBody: async () => '',
    ...overrides,
  };
}

async function dispatch(router, method, url, context = createContext()) {
  const req = createRequest(url, method);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res.result;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function withWorkspaceRoot(fn) {
  const previousRoot = process.env.WORKSPACE_ROOT;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-routes-'));
  process.env.WORKSPACE_ROOT = root;

  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => {
      if (previousRoot === undefined) {
        delete process.env.WORKSPACE_ROOT;
      } else {
        process.env.WORKSPACE_ROOT = previousRoot;
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
}

async function run() {
  const originalConsoleError = console.error;
  console.error = () => {};

  const calls = [];
  const handlers = {
    cronList: async () => ({ jobs: [] }),
    cronRuns: async () => ({ runs: [] }),
    cronRun: async () => ({}),
    cronEnable: async () => ({}),
    cronDisable: async () => ({}),
  };
  const mockCli = {
    async cronList() {
      calls.push({ method: 'cronList', args: [] });
      return handlers.cronList();
    },
    async cronRuns(id, limit) {
      calls.push({ method: 'cronRuns', args: [id, limit] });
      return handlers.cronRuns(id, limit);
    },
    async cronRun(id) {
      calls.push({ method: 'cronRun', args: [id] });
      return handlers.cronRun(id);
    },
    async cronEnable(id) {
      calls.push({ method: 'cronEnable', args: [id] });
      return handlers.cronEnable(id);
    },
    async cronDisable(id) {
      calls.push({ method: 'cronDisable', args: [id] });
      return handlers.cronDisable(id);
    },
  };

  const loaded = loadCronRoutesWithMockCli(mockCli);

  try {
    const router = new Router();
    loaded.registerCronRoutes(router);

    const expectedRoutes = [
      ['GET', '/api/cron/jobs'],
      ['GET', '/api/cron/jobs/:id/runs'],
      ['POST', '/api/cron/jobs/:id/run'],
      ['POST', '/api/cron/jobs/:id/enable'],
      ['POST', '/api/cron/jobs/:id/disable'],
      ['POST', '/api/cron/jobs'],
      ['DELETE', '/api/cron/jobs/:id'],
    ];

    for (const [method, routePath] of expectedRoutes) {
      assert.ok(
        router.list().some((route) => route.method === method && route.path === routePath),
        `${method} ${routePath} should be registered`
      );
    }

    handlers.cronList = async () => ({
      jobs: [
        {
          id: 'nightly-sync',
          name: 'Nightly Sync',
          description: 'Refresh project metrics',
          schedule: { expr: '*/5 * * * *' },
          enabled: false,
          state: {
            lastRunStatus: 'success',
            lastRunAtMs: Date.UTC(2026, 2, 12, 10, 11, 12),
            nextRunAtMs: Date.UTC(2026, 2, 12, 10, 16, 12),
          },
          payload: { agentId: 'agent-sync', model: 'openai/gpt-5' },
        },
        {
          id: 'daily-report',
          schedule: { kind: 'daily' },
          agentId: 'agent-report',
        },
      ],
    });
    const listSuccess = await dispatch(router, 'GET', '/api/cron/jobs');
    assert.strictEqual(listSuccess.status, 200);
    assert.strictEqual(listSuccess.payload.jobs.length, 2);
    assert.deepStrictEqual(listSuccess.payload.jobs[0], {
      id: 'nightly-sync',
      name: 'Nightly Sync',
      description: 'Refresh project metrics',
      schedule: '*/5 * * * *',
      enabled: false,
      status: 'success',
      lastRun: '2026-03-12T10:11:12.000Z',
      nextRun: '2026-03-12T10:16:12.000Z',
      agentId: 'agent-sync',
      model: 'openai/gpt-5',
      _raw: {
        id: 'nightly-sync',
        name: 'Nightly Sync',
        description: 'Refresh project metrics',
        schedule: { expr: '*/5 * * * *' },
        enabled: false,
        state: {
          lastRunStatus: 'success',
          lastRunAtMs: Date.UTC(2026, 2, 12, 10, 11, 12),
          nextRunAtMs: Date.UTC(2026, 2, 12, 10, 16, 12),
        },
        payload: { agentId: 'agent-sync', model: 'openai/gpt-5' },
      },
    });
    assert.deepStrictEqual(listSuccess.payload.jobs[1], {
      id: 'daily-report',
      name: 'daily-report',
      description: '',
      schedule: 'daily',
      enabled: true,
      status: 'unknown',
      lastRun: null,
      nextRun: null,
      agentId: 'agent-report',
      model: null,
      _raw: {
        id: 'daily-report',
        schedule: { kind: 'daily' },
        agentId: 'agent-report',
      },
    });

    handlers.cronList = async () => ({});
    const listEmpty = await dispatch(router, 'GET', '/api/cron/jobs');
    assert.deepStrictEqual(listEmpty, { status: 200, payload: { jobs: [] } });

    handlers.cronList = async () => {
      throw new Error('cron list failed');
    };
    const listThrown = await dispatch(router, 'GET', '/api/cron/jobs');
    assert.strictEqual(listThrown.status, 500);
    assert.match(listThrown.payload.details, /cron list failed/);

    handlers.cronList = async () => ({ error: 'openclaw binary missing' });
    const listDependencyError = await dispatch(router, 'GET', '/api/cron/jobs');
    assert.strictEqual(listDependencyError.status, 500);
    assert.match(listDependencyError.payload.details, /openclaw binary missing/);

    calls.length = 0;
    const runs = [{ id: 'run-1', status: 'success' }];
    handlers.cronRuns = async () => ({ runs });
    const runsSuccess = await dispatch(router, 'GET', '/api/cron/jobs/nightly-sync/runs');
    assert.deepStrictEqual(calls.at(-1), { method: 'cronRuns', args: ['nightly-sync', 10] });
    assert.deepStrictEqual(runsSuccess, { status: 200, payload: { runs } });

    const rawRuns = [{ id: 'run-raw' }];
    handlers.cronRuns = async () => rawRuns;
    const rawRunsSuccess = await dispatch(router, 'GET', '/api/cron/jobs/raw-job/runs');
    assert.deepStrictEqual(rawRunsSuccess, { status: 200, payload: { runs: rawRuns } });

    handlers.cronRuns = async () => ({ error: 'runs dependency failed' });
    const runsDependencyError = await dispatch(router, 'GET', '/api/cron/jobs/nightly-sync/runs');
    assert.strictEqual(runsDependencyError.status, 500);
    assert.match(runsDependencyError.payload.details, /runs dependency failed/);

    handlers.cronRun = async () => ({ runId: 'run-2' });
    const runSuccess = await dispatch(router, 'POST', '/api/cron/jobs/nightly-sync/run');
    assert.deepStrictEqual(calls.at(-1), { method: 'cronRun', args: ['nightly-sync'] });
    assert.deepStrictEqual(runSuccess, {
      status: 202,
      payload: { success: true, message: 'Job triggered', data: { runId: 'run-2' } },
    });

    handlers.cronRun = async () => {
      throw new Error('manual run failed');
    };
    const runThrown = await dispatch(router, 'POST', '/api/cron/jobs/nightly-sync/run');
    assert.strictEqual(runThrown.status, 500);
    assert.match(runThrown.payload.details, /manual run failed/);

    handlers.cronEnable = async () => ({ enabled: true });
    const enableSuccess = await dispatch(router, 'POST', '/api/cron/jobs/daily-report/enable');
    assert.deepStrictEqual(calls.at(-1), { method: 'cronEnable', args: ['daily-report'] });
    assert.deepStrictEqual(enableSuccess, { status: 200, payload: { success: true, data: { enabled: true } } });

    handlers.cronEnable = async () => ({ error: 'enable dependency failed' });
    const enableDependencyError = await dispatch(router, 'POST', '/api/cron/jobs/daily-report/enable');
    assert.strictEqual(enableDependencyError.status, 500);
    assert.match(enableDependencyError.payload.details, /enable dependency failed/);

    handlers.cronDisable = async () => ({ enabled: false });
    const disableSuccess = await dispatch(router, 'POST', '/api/cron/jobs/daily-report/disable');
    assert.deepStrictEqual(calls.at(-1), { method: 'cronDisable', args: ['daily-report'] });
    assert.deepStrictEqual(disableSuccess, { status: 200, payload: { success: true, data: { enabled: false } } });

    handlers.cronDisable = async () => {
      throw new Error('disable failed');
    };
    const disableThrown = await dispatch(router, 'POST', '/api/cron/jobs/daily-report/disable');
    assert.strictEqual(disableThrown.status, 500);
    assert.match(disableThrown.payload.details, /disable failed/);

    await withWorkspaceRoot(async (root) => {
      const createSuccess = await dispatch(router, 'POST', '/api/cron/jobs', createContext({
        readBody: async () => jsonBody({
          id: 'metrics-refresh',
          description: 'Refresh metrics',
          minute: '1',
          hour: '2',
          dom: '3',
          month: '4',
          dow: '5',
          command: 'node scripts/refresh.js',
        }),
      }));
      assert.deepStrictEqual(createSuccess, { status: 201, payload: { success: true, id: 'metrics-refresh' } });
      assert.strictEqual(
        fs.readFileSync(path.join(root, '.cron', 'metrics-refresh.cron'), 'utf8'),
        '# Refresh metrics\n1 2 3 4 5 node scripts/refresh.js\n'
      );

      const createDefaults = await dispatch(router, 'POST', '/api/cron/jobs', createContext({
        readBody: async () => jsonBody({ id: 'default-schedule', command: 'echo ok' }),
      }));
      assert.deepStrictEqual(createDefaults, { status: 201, payload: { success: true, id: 'default-schedule' } });
      assert.strictEqual(
        fs.readFileSync(path.join(root, '.cron', 'default-schedule.cron'), 'utf8'),
        '* * * * * echo ok\n'
      );

      const createMissingFields = await dispatch(router, 'POST', '/api/cron/jobs', createContext({
        readBody: async () => jsonBody({ id: 'missing-command' }),
      }));
      assert.strictEqual(createMissingFields.status, 400);
      assert.match(createMissingFields.payload.error, /id and command are required/);
      assert.strictEqual(fs.existsSync(path.join(root, '.cron', 'missing-command.cron')), false);

      const createInvalidJson = await dispatch(router, 'POST', '/api/cron/jobs', createContext({
        readBody: async () => '{not json',
      }));
      assert.strictEqual(createInvalidJson.status, 500);
      assert.match(createInvalidJson.payload.error, /Failed to create cron job/);

      const createMissingReader = await dispatch(router, 'POST', '/api/cron/jobs', { sendJSON });
      assert.strictEqual(createMissingReader.status, 500);
      assert.match(createMissingReader.payload.error, /Failed to create cron job/);

      const deletePath = path.join(root, '.cron', 'metrics-refresh.cron');
      assert.strictEqual(fs.existsSync(deletePath), true);
      const deleteSuccess = await dispatch(router, 'DELETE', '/api/cron/jobs/metrics-refresh');
      assert.deepStrictEqual(deleteSuccess, { status: 200, payload: { success: true } });
      assert.strictEqual(fs.existsSync(deletePath), false);

      const deleteMissing = await dispatch(router, 'DELETE', '/api/cron/jobs/missing');
      assert.deepStrictEqual(deleteMissing, { status: 404, payload: { error: 'Job not found' } });

      fs.writeFileSync(path.join(root, '.cron', 'unlink-error.cron'), 'test');
      const originalUnlinkSync = fs.unlinkSync;
      fs.unlinkSync = () => {
        throw new Error('unlink failed');
      };
      try {
        const deleteError = await dispatch(router, 'DELETE', '/api/cron/jobs/unlink-error');
        assert.strictEqual(deleteError.status, 500);
        assert.match(deleteError.payload.error, /Failed to delete cron job/);
      } finally {
        fs.unlinkSync = originalUnlinkSync;
      }
    });
  } finally {
    loaded.restore();
    console.error = originalConsoleError;
  }
}

run().then(() => {
  console.log('PASS: cron routes');
}).catch((error) => {
  console.error('FAIL: cron routes');
  console.error(error);
  process.exit(1);
});
