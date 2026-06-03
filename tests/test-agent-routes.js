#!/usr/bin/env node
/**
 * Focused tests for routes/agent-routes.js.
 * Run: node tests/test-agent-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerAgentRoutes } = require('../routes/agent-routes');

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
    parseJSONBody: async () => ({}),
    ...overrides,
  };
}

async function dispatch(router, method, url, context) {
  const req = createRequest(url, method);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res.result;
}

async function withMockMetricsPayloads(payloads, fn) {
  const metricsPath = require.resolve('../metrics-api.js');
  const original = require.cache[metricsPath];
  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: {
      buildMetricsPayloads: async () => payloads,
    },
  };

  try {
    await fn();
  } finally {
    if (original) {
      require.cache[metricsPath] = original;
    } else {
      delete require.cache[metricsPath];
    }
  }
}

async function run() {
  const router = new Router();
  registerAgentRoutes(router);

  const expectedRoutes = [
    ['GET', '/api/agents'],
    ['POST', '/api/agent/claim'],
    ['POST', '/api/agent/release'],
    ['POST', '/api/agents/heartbeat'],
    ['GET', '/api/agents/status'],
    ['GET', '/api/lead-handoffs'],
    ['GET', '/api/audit'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  await withMockMetricsPayloads({
    agentsPayload: [
      {
        agentId: 'agent-1',
        displayName: 'Agent One',
        status: 'working',
        lastHeartbeat: '2026-03-12T12:00:00.000Z',
        department: { name: 'Core Platform' },
      },
      {
        agentId: 'agent-2',
        displayName: 'Agent Two',
        lastHeartbeat: null,
        department: null,
      },
    ],
  }, async () => {
    const result = await dispatch(router, 'GET', '/api/agents', createContext({
      asanaStorage: { pool: {} },
    }));
    assert.strictEqual(result.status, 200, 'agent list should return 200');
    assert.deepStrictEqual(result.payload.agents, [
      {
        id: 'agent-1',
        name: 'Agent One',
        status: 'working',
        lastHeartbeat: '2026-03-12T12:00:00.000Z',
        department: 'Core Platform',
      },
      {
        id: 'agent-2',
        name: 'Agent Two',
        status: 'idle',
        lastHeartbeat: null,
        department: undefined,
      },
    ]);
  });

  const emptyAgents = await dispatch(router, 'GET', '/api/agents', createContext());
  assert.deepStrictEqual(emptyAgents, { status: 200, payload: { agents: [] } }, 'agent list should fall back to empty array');

  let claimedArgs = null;
  const claimSuccess = await dispatch(router, 'POST', '/api/agent/claim', createContext({
    parseJSONBody: async () => ({ task_id: 'task-1', agent_name: 'agent-1' }),
    asanaStorage: {
      async claimTask(taskId, agentName) {
        claimedArgs = { taskId, agentName };
        return { id: taskId, locked_by: agentName };
      },
    },
  }));
  assert.deepStrictEqual(claimedArgs, { taskId: 'task-1', agentName: 'agent-1' });
  assert.deepStrictEqual(claimSuccess, { status: 200, payload: { id: 'task-1', locked_by: 'agent-1' } });

  const claimMissingStorage = await dispatch(router, 'POST', '/api/agent/claim', createContext());
  assert.strictEqual(claimMissingStorage.status, 503);
  assert.match(claimMissingStorage.payload.error, /not initialized/);

  const claimMissingBody = await dispatch(router, 'POST', '/api/agent/claim', createContext({
    parseJSONBody: async () => ({ task_id: 'task-1' }),
    asanaStorage: {},
  }));
  assert.strictEqual(claimMissingBody.status, 400);
  assert.match(claimMissingBody.payload.error, /task_id and agent_name required/);

  const claimLocked = await dispatch(router, 'POST', '/api/agent/claim', createContext({
    parseJSONBody: async () => ({ task_id: 'task-1', agent_name: 'agent-2' }),
    asanaStorage: {
      async claimTask() {
        throw new Error('task is locked by another agent');
      },
    },
  }));
  assert.strictEqual(claimLocked.status, 409);

  let releasedTaskId = null;
  const releaseSuccess = await dispatch(router, 'POST', '/api/agent/release', createContext({
    parseJSONBody: async () => ({ task_id: 'task-1' }),
    asanaStorage: {
      async releaseTask(taskId) {
        releasedTaskId = taskId;
        return { released: true };
      },
    },
  }));
  assert.strictEqual(releasedTaskId, 'task-1');
  assert.deepStrictEqual(releaseSuccess, { status: 200, payload: { released: true } });

  const releaseMissingBody = await dispatch(router, 'POST', '/api/agent/release', createContext({
    parseJSONBody: async () => ({}),
    asanaStorage: {},
  }));
  assert.strictEqual(releaseMissingBody.status, 400);
  assert.match(releaseMissingBody.payload.error, /task_id required/);

  const releaseNotFound = await dispatch(router, 'POST', '/api/agent/release', createContext({
    parseJSONBody: async () => ({ task_id: 'missing' }),
    asanaStorage: {
      async releaseTask() {
        throw new Error('task not found');
      },
    },
  }));
  assert.strictEqual(releaseNotFound.status, 404);

  let heartbeatArgs = null;
  const heartbeatSuccess = await dispatch(router, 'POST', '/api/agents/heartbeat', createContext({
    parseJSONBody: async () => ({ agent_name: 'agent-1' }),
    asanaStorage: {
      async recordAgentHeartbeat(agentName, status) {
        heartbeatArgs = { agentName, status };
      },
    },
  }));
  assert.deepStrictEqual(heartbeatArgs, { agentName: 'agent-1', status: 'online' });
  assert.deepStrictEqual(heartbeatSuccess, { status: 200, payload: { ok: true } });

  const heartbeatMissingAgent = await dispatch(router, 'POST', '/api/agents/heartbeat', createContext({
    parseJSONBody: async () => ({ status: 'idle' }),
    asanaStorage: {},
  }));
  assert.strictEqual(heartbeatMissingAgent.status, 400);
  assert.match(heartbeatMissingAgent.payload.error, /agent_name required/);

  const heartbeatStorageError = await dispatch(router, 'POST', '/api/agents/heartbeat', createContext({
    parseJSONBody: async () => ({ agent_name: 'agent-1', status: 'error' }),
    asanaStorage: {
      async recordAgentHeartbeat() {
        throw new Error('heartbeat write failed');
      },
    },
  }));
  assert.strictEqual(heartbeatStorageError.status, 500);
  assert.match(heartbeatStorageError.payload.error, /heartbeat write failed/);

  const statuses = [{ agent_name: 'agent-1', status: 'online' }];
  const statusSuccess = await dispatch(router, 'GET', '/api/agents/status', createContext({
    asanaStorage: {
      async listAgentStatuses() {
        return statuses;
      },
    },
  }));
  assert.deepStrictEqual(statusSuccess, { status: 200, payload: { agents: statuses } });

  const statusMissingStorage = await dispatch(router, 'GET', '/api/agents/status', createContext());
  assert.strictEqual(statusMissingStorage.status, 503);

  let handoffFilters = null;
  const handoffs = [{ id: 'handoff-1' }];
  const handoffSuccess = await dispatch(
    router,
    'GET',
    '/api/lead-handoffs?action=claimed&actor=lead&project_id=project-1&limit=999&offset=-10',
    createContext({
      asanaStorage: {
        async getLeadHandoffs(filters) {
          handoffFilters = filters;
          return { handoffs, total: 1 };
        },
      },
    })
  );
  assert.deepStrictEqual(handoffFilters, {
    actionFilter: 'claimed',
    actorFilter: 'lead',
    projectFilter: 'project-1',
    limit: 200,
    offset: 0,
  });
  assert.deepStrictEqual(handoffSuccess, { status: 200, payload: { handoffs, total: 1 } });

  const handoffError = await dispatch(router, 'GET', '/api/lead-handoffs', createContext({
    asanaStorage: {
      async getLeadHandoffs() {
        throw new Error('handoff query failed');
      },
    },
  }));
  assert.strictEqual(handoffError.status, 500);

  let auditArgs = null;
  const auditSuccess = await dispatch(
    router,
    'GET',
    '/api/audit?task_id=task-1&q=lock&actor=agent-1&action=claim&start_date=2026-03-01&end_date=2026-03-31&entity_type=task&governance_only=true&limit=0&offset=-5',
    createContext({
      asanaStorage: {
        async queryAuditLog(filters, limit, offset) {
          auditArgs = { filters, limit, offset };
          return [{ id: 'audit-1' }, { id: 'audit-2' }];
        },
      },
    })
  );
  assert.deepStrictEqual(auditArgs, {
    filters: {
      task_id: 'task-1',
      q: 'lock',
      actor: 'agent-1',
      action: 'claim',
      start_date: '2026-03-01',
      end_date: '2026-03-31',
      entity_type: 'task',
      governance_only: true,
    },
    limit: 100,
    offset: 0,
  });
  assert.deepStrictEqual(auditSuccess, {
    status: 200,
    payload: {
      logs: [{ id: 'audit-1' }, { id: 'audit-2' }],
      total: 2,
      limit: 100,
      offset: 0,
    },
  });

  const auditObjectResult = await dispatch(router, 'GET', '/api/audit?limit=2&offset=4', createContext({
    asanaStorage: {
      async queryAuditLog(filters, limit, offset) {
        assert.deepStrictEqual(filters, {});
        assert.strictEqual(limit, 2);
        assert.strictEqual(offset, 4);
        return { logs: [{ id: 'audit-3' }], total: 9 };
      },
    },
  }));
  assert.deepStrictEqual(auditObjectResult, {
    status: 200,
    payload: {
      logs: [{ id: 'audit-3' }],
      total: 9,
      limit: 2,
      offset: 4,
    },
  });

  const auditMissingStorage = await dispatch(router, 'GET', '/api/audit', createContext());
  assert.strictEqual(auditMissingStorage.status, 503);

  const auditError = await dispatch(router, 'GET', '/api/audit', createContext({
    asanaStorage: {
      async queryAuditLog() {
        throw new Error('audit query failed');
      },
    },
  }));
  assert.strictEqual(auditError.status, 500);
  assert.match(auditError.payload.error, /audit query failed/);

  console.log('PASS: agent routes');
}

run().catch((error) => {
  console.error('FAIL: agent routes');
  console.error(error);
  process.exit(1);
});
