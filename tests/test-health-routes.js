#!/usr/bin/env node
/**
 * Focused tests for routes/health-routes.js.
 * Run: node tests/test-health-routes.js
 *
 * Source fixes covered here:
 * - OpenClaw CLI wrapper dependency failures are returned as `{ error: "..." }`;
 *   health routes now treat that shape as a failed dependency and return 502.
 * - `/api/health` and `/api/stats` now return handled JSON 500 responses when
 *   storage health/stat calls throw instead of letting router dispatch reject.
 */

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const Router = require('../routes/router');

const cliPath = require.resolve('../lib/openclaw-cli');
const healthRoutesPath = require.resolve('../routes/health-routes');

function loadHealthRoutesWithMockCli(mockCli) {
  const originalCli = require.cache[cliPath];
  const originalRoutes = require.cache[healthRoutesPath];
  delete require.cache[healthRoutesPath];

  require.cache[cliPath] = {
    id: cliPath,
    filename: cliPath,
    loaded: true,
    exports: mockCli,
  };

  const { registerHealthRoutes } = require('../routes/health-routes');
  return {
    registerHealthRoutes,
    restore() {
      delete require.cache[healthRoutesPath];
      if (originalRoutes) {
        require.cache[healthRoutesPath] = originalRoutes;
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
  return {
    result: null,
    statusCode: null,
    headers: {},
    body: '',
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    write(data) {
      this.body += data;
    },
    end(data = '') {
      this.body += data;
      this.ended = true;
    },
    json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function createRequest(url, method = 'GET', overrides = {}) {
  return {
    method,
    url,
    headers: { host: 'localhost:3876', ...(overrides.headers || {}) },
    on() {},
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return {
    sendJSON,
    PORT: 3876,
    STORAGE_TYPE: 'postgres',
    readBody: async () => '',
    getAsanaStorageHealth: async () => ({
      ready: true,
      databaseHealthy: true,
      mode: 'postgres',
      label: 'PostgreSQL',
      note: null,
      dbLatencyMs: 7,
    }),
    readGatewayStatusSnapshot: () => ({
      healthy: true,
      status: 'ok',
      syncedAt: '2026-03-12T10:11:12.000Z',
      ageMs: 123,
      agentCount: 2,
      error: null,
    }),
    ...overrides,
  };
}

async function dispatch(router, method, url, context = createContext(), reqOverrides = {}) {
  const req = createRequest(url, method, reqOverrides);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res.result || { status: res.statusCode, payload: res.json(), res };
}

async function withPatchedMethod(object, method, replacement, fn) {
  const original = object[method];
  object[method] = replacement;
  try {
    return await fn();
  } finally {
    object[method] = original;
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

function assertIsoTimestamp(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
}

async function run() {
  await withConsoleErrorSilenced(async () => {
    const calls = [];
    const handlers = {
      health: async () => ({ ok: true, channels: { gateway: true }, agents: [{ id: 'main' }], heartbeatSeconds: 30, defaultAgentId: 'main' }),
      tasksList: async () => ({ tasks: [] }),
      tasksAudit: async () => ({ stale: [], broken: [] }),
      agentsList: async () => ({ agents: [] }),
      memoryIndex: async () => ({ indexed: 1 }),
      memoryPromote: async () => ({ candidates: [] }),
    };
    const mockCli = {
      async health() {
        calls.push({ method: 'health', args: [] });
        return handlers.health();
      },
      async tasksList(filters) {
        calls.push({ method: 'tasksList', args: [filters] });
        return handlers.tasksList(filters);
      },
      async tasksAudit() {
        calls.push({ method: 'tasksAudit', args: [] });
        return handlers.tasksAudit();
      },
      async agentsList() {
        calls.push({ method: 'agentsList', args: [] });
        return handlers.agentsList();
      },
      async memoryIndex(agentId) {
        calls.push({ method: 'memoryIndex', args: [agentId] });
        return handlers.memoryIndex(agentId);
      },
      async memoryPromote(agentId, options) {
        calls.push({ method: 'memoryPromote', args: [agentId, options] });
        return handlers.memoryPromote(agentId, options);
      },
    };

    const loaded = loadHealthRoutesWithMockCli(mockCli);
    try {
      const router = new Router();
      loaded.registerHealthRoutes(router);

      const expectedRoutes = [
        ['GET', '/api/health'],
        ['GET', '/api/stats'],
        ['GET', '/api/citation-queue/status'],
        ['GET', '/api/health-status'],
        ['GET', '/api/openclaw/health'],
        ['GET', '/api/openclaw/tasks'],
        ['GET', '/api/openclaw/tasks/audit'],
        ['GET', '/api/openclaw/agents'],
        ['POST', '/api/openclaw/memory/index'],
        ['GET', '/api/openclaw/memory/promote'],
        ['POST', '/api/openclaw/memory/promote'],
        ['GET', '/api/auth/self'],
        ['GET', '/api/routes'],
      ];

      for (const [method, path] of expectedRoutes) {
        assert.ok(
          router.list().some((route) => route.method === method && route.path === path),
          `${method} ${path} should be registered`
        );
      }

      const healthOk = await dispatch(router, 'GET', '/api/health', createContext());
      assert.strictEqual(healthOk.status, 200);
      assert.strictEqual(healthOk.payload.status, 'ok');
      assert.strictEqual(healthOk.payload.asana_storage, 'postgres');
      assert.strictEqual(healthOk.payload.storage_type, 'postgres');
      assert.strictEqual(healthOk.payload.storage_label, 'PostgreSQL');
      assert.strictEqual(healthOk.payload.db_latency_ms, 7);
      assert.strictEqual(healthOk.payload.port, 3876);
      assert.strictEqual(typeof healthOk.payload.uptime, 'number');
      assertIsoTimestamp(healthOk.payload.timestamp);

      const healthDegraded = await dispatch(router, 'GET', '/api/health', createContext({
        getAsanaStorageHealth: async () => ({
          ready: true,
          databaseHealthy: false,
          mode: 'snapshot',
          label: 'Read-only snapshot',
          note: 'PostgreSQL unavailable',
          dbLatencyMs: null,
        }),
      }));
      assert.strictEqual(healthDegraded.payload.status, 'degraded');
      assert.strictEqual(healthDegraded.payload.storage_note, 'PostgreSQL unavailable');

      const healthNoStorage = await dispatch(router, 'GET', '/api/health', createContext({
        getAsanaStorageHealth: async () => ({
          ready: false,
          databaseHealthy: false,
          mode: 'none',
          label: 'Unavailable',
          note: 'not initialized',
          dbLatencyMs: null,
        }),
      }));
      assert.strictEqual(healthNoStorage.payload.status, 'error');

      const healthStorageFailure = await dispatch(router, 'GET', '/api/health', createContext({
        getAsanaStorageHealth: async () => {
          throw new Error('storage health failed');
        },
      }));
      assert.strictEqual(healthStorageFailure.status, 500);
      assert.match(healthStorageFailure.payload.error, /storage health failed/);

      const statsMissingStorage = await dispatch(router, 'GET', '/api/stats', createContext({ asanaStorage: null }));
      assert.strictEqual(statsMissingStorage.status, 503);
      assert.match(statsMissingStorage.payload.error, /not initialized/);

      const statsSuccess = await dispatch(router, 'GET', '/api/stats', createContext({
        asanaStorage: {
          async stats() {
            return { tasks: 9, projects: 2 };
          },
        },
      }));
      assert.deepStrictEqual(statsSuccess, { status: 200, payload: { tasks: 9, projects: 2 } });

      const statsFailure = await dispatch(router, 'GET', '/api/stats', createContext({
        asanaStorage: {
          async stats() {
            throw new Error('stats query failed');
          },
        },
      }));
      assert.strictEqual(statsFailure.status, 500);
      assert.strictEqual(statsFailure.payload.error, 'Failed to get stats');
      assert.match(statsFailure.payload.details, /stats query failed/);

      await withPatchedMethod(childProcess, 'execSync', (command, options) => {
        assert.match(command, /citation_queue\.py --action status/);
        assert.deepStrictEqual(options, { encoding: 'utf-8', timeout: 5000 });
        return JSON.stringify({ pending: 3, total: 5 });
      }, async () => {
        const citation = await dispatch(router, 'GET', '/api/citation-queue/status');
        assert.strictEqual(citation.status, 200);
        assert.strictEqual(citation.payload.success, true);
        assert.strictEqual(citation.payload.pending, 3);
        assert.strictEqual(citation.payload.total, 5);
        assertIsoTimestamp(citation.payload.timestamp);
      });

      await withPatchedMethod(childProcess, 'execSync', () => '{not-json', async () => {
        const citationInvalid = await dispatch(router, 'GET', '/api/citation-queue/status');
        assert.strictEqual(citationInvalid.status, 500);
        assert.strictEqual(citationInvalid.payload.error, 'Failed to get citation queue status');
      });

      await withPatchedMethod(childProcess, 'execSync', () => {
        throw new Error('python missing');
      }, async () => {
        const citationFailure = await dispatch(router, 'GET', '/api/citation-queue/status');
        assert.strictEqual(citationFailure.status, 500);
        assert.match(citationFailure.payload.details, /python missing/);
      });

      const healthStatusHealthy = await dispatch(router, 'GET', '/api/health-status', createContext());
      assert.strictEqual(healthStatusHealthy.status, 200);
      assert.strictEqual(healthStatusHealthy.payload.status, 'healthy');
      assert.strictEqual(healthStatusHealthy.payload.database.healthy, true);
      assert.strictEqual(healthStatusHealthy.payload.gateway.healthy, true);
      assert.strictEqual(healthStatusHealthy.payload.checks.gateway_sync.count, 2);
      assert.strictEqual(healthStatusHealthy.payload.task_server.status, 'running');

      const healthStatusDegraded = await dispatch(router, 'GET', '/api/health-status', createContext({
        getAsanaStorageHealth: async () => ({
          ready: true,
          databaseHealthy: false,
          mode: 'snapshot',
          label: 'Read-only snapshot',
          note: 'database unavailable',
        }),
        readGatewayStatusSnapshot: () => ({
          healthy: false,
          status: 'stale',
          syncedAt: null,
          ageMs: null,
          agentCount: 0,
          error: 'snapshot stale',
        }),
      }));
      assert.strictEqual(healthStatusDegraded.payload.status, 'degraded');
      assert.strictEqual(healthStatusDegraded.payload.database.mode, 'snapshot');
      assert.strictEqual(healthStatusDegraded.payload.gateway.note, 'snapshot stale');

      const healthStatusError = await dispatch(router, 'GET', '/api/health-status', createContext({
        getAsanaStorageHealth: async () => ({
          ready: false,
          databaseHealthy: false,
          mode: 'none',
          label: 'Unavailable',
          note: 'storage absent',
        }),
        readGatewayStatusSnapshot: () => ({
          healthy: false,
          status: 'missing',
          syncedAt: null,
          ageMs: null,
          agentCount: 0,
          error: null,
        }),
      }));
      assert.strictEqual(healthStatusError.payload.status, 'error');
      assert.match(healthStatusError.payload.checks.gateway_sync.note, /has not produced/);

      await withPatchedMethod(fs, 'existsSync', (filePath) => {
        assert.strictEqual(filePath, '/root/.openclaw/workspace/logs/cron-health.json');
        return true;
      }, async () => {
        await withPatchedMethod(fs, 'readFileSync', () => JSON.stringify({
          status: 'warn',
          total_errors: 2,
          details: [{ id: 'job-1' }, { id: 'job-2' }],
          timestamp: '2026-03-12T10:15:00.000Z',
        }), async () => {
          const withCron = await dispatch(router, 'GET', '/api/health-status', createContext());
          assert.deepStrictEqual(withCron.payload.cron, {
            status: 'warn',
            total_errors: 2,
            details: [{ id: 'job-1' }, { id: 'job-2' }],
            checked_at: '2026-03-12T10:15:00.000Z',
          });
          assert.deepStrictEqual(withCron.payload.checks.cron_jobs, {
            healthy: false,
            status: 'warn',
            total_errors: 2,
            note: '2 errors across 2 jobs',
          });
        });
      });

      const healthStatusFailure = await dispatch(router, 'GET', '/api/health-status', createContext({
        readGatewayStatusSnapshot: () => {
          throw new Error('gateway snapshot unreadable');
        },
      }));
      assert.strictEqual(healthStatusFailure.status, 500);
      assert.strictEqual(healthStatusFailure.payload.status, 'error');
      assert.match(healthStatusFailure.payload.error, /gateway snapshot unreadable/);

      handlers.health = async () => ({ ok: true, channels: { gateway: true }, agents: [{ id: 'agent-1' }], heartbeatSeconds: 15, defaultAgentId: 'agent-1' });
      const openclawHealth = await dispatch(router, 'GET', '/api/openclaw/health');
      assert.strictEqual(openclawHealth.status, 200);
      assert.deepStrictEqual(openclawHealth.payload.channels, { gateway: true });
      assert.deepStrictEqual(openclawHealth.payload.agents, [{ id: 'agent-1' }]);
      assert.strictEqual(openclawHealth.payload.heartbeatSeconds, 15);
      assertIsoTimestamp(openclawHealth.payload.timestamp);

      handlers.health = async () => ({});
      const openclawHealthDefaults = await dispatch(router, 'GET', '/api/openclaw/health');
      assert.deepStrictEqual(openclawHealthDefaults.payload.channels, {});
      assert.deepStrictEqual(openclawHealthDefaults.payload.agents, []);
      assert.strictEqual(openclawHealthDefaults.payload.ok, false);

      handlers.health = async () => ({ error: 'openclaw binary not found' });
      const openclawHealthCliError = await dispatch(router, 'GET', '/api/openclaw/health');
      assert.strictEqual(openclawHealthCliError.status, 502);
      assert.match(openclawHealthCliError.payload.details, /openclaw binary not found/);

      handlers.health = async () => {
        throw new Error('health command failed');
      };
      const openclawHealthThrown = await dispatch(router, 'GET', '/api/openclaw/health');
      assert.strictEqual(openclawHealthThrown.status, 502);
      assert.match(openclawHealthThrown.payload.details, /health command failed/);

      handlers.tasksList = async () => ({ tasks: [{ id: 'task-1' }, { id: 'task-2' }] });
      const tasksList = await dispatch(router, 'GET', '/api/openclaw/tasks?runtime=node&status=running');
      assert.deepStrictEqual(calls.at(-1), { method: 'tasksList', args: [{ runtime: 'node', status: 'running' }] });
      assert.strictEqual(tasksList.status, 200);
      assert.strictEqual(tasksList.payload.count, 2);
      assert.deepStrictEqual(tasksList.payload.tasks, [{ id: 'task-1' }, { id: 'task-2' }]);

      handlers.tasksList = async () => ({ count: 10, tasks: [{ id: 'task-1' }] });
      const tasksCount = await dispatch(router, 'GET', '/api/openclaw/tasks');
      assert.strictEqual(tasksCount.payload.count, 10);

      handlers.tasksList = async () => ({ error: 'tasks list failed' });
      const tasksCliError = await dispatch(router, 'GET', '/api/openclaw/tasks');
      assert.strictEqual(tasksCliError.status, 502);
      assert.match(tasksCliError.payload.details, /tasks list failed/);

      handlers.tasksAudit = async () => ({ stale: ['task-1'], broken: [] });
      const audit = await dispatch(router, 'GET', '/api/openclaw/tasks/audit');
      assert.deepStrictEqual(audit, { status: 200, payload: { source: 'openclaw-cli', stale: ['task-1'], broken: [] } });

      handlers.tasksAudit = async () => ({ error: 'audit failed' });
      const auditCliError = await dispatch(router, 'GET', '/api/openclaw/tasks/audit');
      assert.strictEqual(auditCliError.status, 502);
      assert.match(auditCliError.payload.details, /audit failed/);

      handlers.agentsList = async () => [{ id: 'agent-array' }];
      const agentsArray = await dispatch(router, 'GET', '/api/openclaw/agents');
      assert.deepStrictEqual(agentsArray.payload.agents, [{ id: 'agent-array' }]);

      handlers.agentsList = async () => ({ agents: [{ id: 'agent-object' }] });
      const agentsObject = await dispatch(router, 'GET', '/api/openclaw/agents');
      assert.deepStrictEqual(agentsObject.payload.agents, [{ id: 'agent-object' }]);

      handlers.agentsList = async () => ({ error: 'agents failed' });
      const agentsCliError = await dispatch(router, 'GET', '/api/openclaw/agents');
      assert.strictEqual(agentsCliError.status, 502);
      assert.match(agentsCliError.payload.details, /agents failed/);

      handlers.memoryIndex = async (agentId) => ({ indexed: agentId === 'agent-7' ? 7 : 1 });
      const memoryIndexAgent = await dispatch(router, 'POST', '/api/openclaw/memory/index?agent=agent-7');
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryIndex', args: ['agent-7'] });
      assert.deepStrictEqual(memoryIndexAgent.payload, {
        source: 'openclaw-cli',
        success: true,
        agentId: 'agent-7',
        result: { indexed: 7 },
      });

      const memoryIndexDefault = await dispatch(router, 'POST', '/api/openclaw/memory/index');
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryIndex', args: ['main'] });
      assert.strictEqual(memoryIndexDefault.payload.agentId, 'main');

      handlers.memoryIndex = async () => ({ error: 'index failed' });
      const memoryIndexCliError = await dispatch(router, 'POST', '/api/openclaw/memory/index');
      assert.strictEqual(memoryIndexCliError.status, 502);
      assert.match(memoryIndexCliError.payload.details, /index failed/);

      handlers.memoryPromote = async () => ({ candidates: [{ id: 'fact-1' }] });
      const promotePreview = await dispatch(router, 'GET', '/api/openclaw/memory/promote?agent=agent-2&limit=25');
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryPromote', args: ['agent-2', { limit: 25 }] });
      assert.strictEqual(promotePreview.status, 200);
      assert.strictEqual(promotePreview.payload.agentId, 'agent-2');
      assert.deepStrictEqual(promotePreview.payload.candidates, [{ id: 'fact-1' }]);

      const promoteDefaultLimit = await dispatch(router, 'GET', '/api/openclaw/memory/promote?limit=not-a-number');
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryPromote', args: ['main', { limit: 10 }] });
      assert.strictEqual(promoteDefaultLimit.payload.agentId, 'main');

      const promoteApply = await dispatch(router, 'POST', '/api/openclaw/memory/promote', createContext({
        readBody: async () => JSON.stringify({ agent: 'agent-3', limit: 4 }),
      }));
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryPromote', args: ['agent-3', { apply: true, limit: 4 }] });
      assert.strictEqual(promoteApply.payload.success, true);
      assert.strictEqual(promoteApply.payload.agentId, 'agent-3');

      const promoteInvalidBody = await dispatch(router, 'POST', '/api/openclaw/memory/promote', createContext({
        readBody: async () => '{not-json',
      }));
      assert.deepStrictEqual(calls.at(-1), { method: 'memoryPromote', args: ['main', { apply: true, limit: undefined }] });
      assert.strictEqual(promoteInvalidBody.payload.agentId, 'main');

      handlers.memoryPromote = async () => ({ error: 'promotion failed' });
      const promoteCliError = await dispatch(router, 'GET', '/api/openclaw/memory/promote');
      assert.strictEqual(promoteCliError.status, 502);
      assert.match(promoteCliError.payload.details, /promotion failed/);

      const previousToken = process.env.DASHBOARD_AUTH_TOKEN;
      process.env.DASHBOARD_AUTH_TOKEN = 'secret-token';
      try {
        const authSelf = await dispatch(router, 'GET', '/api/auth/self', createContext(), {
          headers: { authorization: 'Bearer secret-token' },
        });
        assert.strictEqual(authSelf.status, 200);
        assert.strictEqual(authSelf.payload.authenticated, true);
        assert.strictEqual(authSelf.payload.mode, 'token');
        assert.strictEqual(authSelf.payload.actor, 'dashboard-operator');
        assert.deepStrictEqual(authSelf.payload.publicRoutes, ['/api/health', '/api/auth/self']);

        const authSelfUnauthorized = await dispatch(router, 'GET', '/api/auth/self', createContext(), {
          headers: { authorization: 'Bearer wrong-token' },
        });
        assert.strictEqual(authSelfUnauthorized.payload.authenticated, false);
        assert.strictEqual(authSelfUnauthorized.payload.actor, null);
      } finally {
        if (previousToken === undefined) {
          delete process.env.DASHBOARD_AUTH_TOKEN;
        } else {
          process.env.DASHBOARD_AUTH_TOKEN = previousToken;
        }
      }

      const routeCatalog = await dispatch(router, 'GET', '/api/routes');
      assert.strictEqual(routeCatalog.status, 200);
      assert.strictEqual(routeCatalog.payload.total, router.list().length);
      assert.ok(routeCatalog.payload.routes.some((route) => route.method === 'GET' && route.path === '/api/health'));
      assert.ok(routeCatalog.payload.routes.some((route) => route.method === 'POST' && route.path === '/api/openclaw/memory/promote'));
    } finally {
      loaded.restore();
    }
  });

  console.log('PASS: health routes');
}

run().catch((err) => {
  console.error('FAIL: health routes');
  console.error(err);
  process.exit(1);
});
