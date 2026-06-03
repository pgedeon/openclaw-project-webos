#!/usr/bin/env node
/**
 * Focused tests for routes/workflow-routing-routes.js.
 * Run: node tests/test-workflow-routing-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerWorkflowRoutingRoutes } = require('../routes/workflow-routing-routes');

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
  const chunks = Array.isArray(body) ? body : body === undefined ? [] : [body];
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on(event, handler) {
      if (event === 'data') {
        chunks.forEach((chunk) => {
          queueMicrotask(() => handler(Buffer.from(chunk)));
        });
      }
      if (event === 'end') {
        queueMicrotask(handler);
      }
    },
  };
}

async function dispatch(router, method, url, body, context = {}) {
  const req = createMockReq(method, url, body);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function createPool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const call = { sql, params };
      calls.push(call);
      return await handler(call, calls.length - 1);
    },
  };
}

async function run() {
  const router = new Router();
  registerWorkflowRoutingRoutes(router);

  const expectedRoutes = [
    ['GET', '/api/workflow-routing'],
    ['PUT', '/api/workflow-routing'],
    ['DELETE', '/api/workflow-routing/:type'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  const rows = [
    { workflow_type: 'publish_article', agent_id: 'agent-editorial', priority: 10 },
    { workflow_type: 'qa_review', agent_id: 'agent-qa', priority: 5 },
  ];
  const listPool = createPool(async (call) => {
    assert.strictEqual(call.params, undefined);
    assert.match(call.sql, /SELECT \* FROM workflow_agent_routing ORDER BY priority DESC/);
    return { rows };
  });
  const listRes = await dispatch(router, 'GET', '/api/workflow-routing', undefined, {
    asanaStorage: { pool: listPool },
  });
  assert.strictEqual(listRes.statusCode, 200);
  assert.deepStrictEqual(listRes.headers, { 'Content-Type': 'application/json' });
  assert.deepStrictEqual(listRes.json, { routes: rows });
  assert.strictEqual(listPool.calls.length, 1);

  const noDbList = await dispatch(router, 'GET', '/api/workflow-routing');
  assert.strictEqual(noDbList.statusCode, 503);
  assert.deepStrictEqual(noDbList.json, { error: 'DB not available' });

  const directDepsPool = createPool(async () => ({ rows: [] }));
  const directDepsRouter = new Router();
  registerWorkflowRoutingRoutes(directDepsRouter, directDepsPool);
  const directDepsRes = await dispatch(directDepsRouter, 'GET', '/api/workflow-routing');
  assert.strictEqual(directDepsRes.statusCode, 200);
  assert.deepStrictEqual(directDepsRes.json, { routes: [] });
  assert.strictEqual(directDepsPool.calls.length, 1, 'direct deps object should be used as pool');

  const nestedDepsPool = createPool(async () => ({ rows: [{ workflow_type: 'from-deps' }] }));
  const ctxPool = createPool(async () => ({ rows: [{ workflow_type: 'from-context' }] }));
  const nestedDepsRouter = new Router();
  registerWorkflowRoutingRoutes(nestedDepsRouter, { pool: nestedDepsPool });
  const contextPreferredRes = await dispatch(nestedDepsRouter, 'GET', '/api/workflow-routing', undefined, {
    asanaStorage: { pool: ctxPool },
  });
  assert.deepStrictEqual(contextPreferredRes.json, { routes: [{ workflow_type: 'from-context' }] });
  assert.strictEqual(ctxPool.calls.length, 1, 'ctx.asanaStorage.pool should be preferred');
  assert.strictEqual(nestedDepsPool.calls.length, 0, 'registered deps pool should not be used when context pool exists');

  const listFailurePool = createPool(async () => {
    throw new Error('select failed');
  });
  const listFailure = await dispatch(router, 'GET', '/api/workflow-routing', undefined, {
    asanaStorage: { pool: listFailurePool },
  });
  assert.strictEqual(listFailure.statusCode, 500);
  assert.deepStrictEqual(listFailure.json, { error: 'select failed' });

  const upserted = {
    workflow_type: 'publish_article',
    agent_id: 'agent-editorial',
    priority: 9,
    max_concurrent: 2,
    timeout_minutes: 45,
  };
  const upsertPool = createPool(async (call) => {
    assert.match(call.sql, /INSERT INTO workflow_agent_routing/);
    assert.match(call.sql, /ON CONFLICT \(workflow_type\) DO UPDATE/);
    assert.match(call.sql, /RETURNING \*/);
    assert.deepStrictEqual(call.params, ['publish_article', 'agent-editorial', 9, 2, 45]);
    return { rows: [upserted] };
  });
  const upsertRes = await dispatch(router, 'PUT', '/api/workflow-routing', jsonBody(upserted), {
    asanaStorage: { pool: upsertPool },
  });
  assert.strictEqual(upsertRes.statusCode, 200);
  assert.deepStrictEqual(upsertRes.json, upserted);

  const defaultedPool = createPool(async (call) => {
    assert.deepStrictEqual(call.params, ['qa_review', 'agent-qa', 5, 1, 60]);
    return {
      rows: [{
        workflow_type: 'qa_review',
        agent_id: 'agent-qa',
        priority: 5,
        max_concurrent: 1,
        timeout_minutes: 60,
      }],
    };
  });
  const defaultedRes = await dispatch(
    router,
    'PUT',
    '/api/workflow-routing',
    ['{"workflow_type":"qa_', 'review","agent_id":"agent-qa","priority":0,"max_concurrent":0,"timeout_minutes":0}'],
    { asanaStorage: { pool: defaultedPool } }
  );
  assert.strictEqual(defaultedRes.statusCode, 200);
  assert.deepStrictEqual(defaultedRes.json, {
    workflow_type: 'qa_review',
    agent_id: 'agent-qa',
    priority: 5,
    max_concurrent: 1,
    timeout_minutes: 60,
  });

  const noDbUpsert = await dispatch(router, 'PUT', '/api/workflow-routing', jsonBody(upserted));
  assert.strictEqual(noDbUpsert.statusCode, 503);
  assert.deepStrictEqual(noDbUpsert.json, { error: 'DB not available' });

  const invalidJson = await dispatch(router, 'PUT', '/api/workflow-routing', '{not json', {
    asanaStorage: { pool: createPool(async () => { throw new Error('query should not be called'); }) },
  });
  assert.strictEqual(invalidJson.statusCode, 400);
  assert.deepStrictEqual(invalidJson.json, { error: 'workflow_type and agent_id required' });

  const missingWorkflowType = await dispatch(router, 'PUT', '/api/workflow-routing', jsonBody({ agent_id: 'agent-qa' }), {
    asanaStorage: { pool: createPool(async () => { throw new Error('query should not be called'); }) },
  });
  assert.strictEqual(missingWorkflowType.statusCode, 400);
  assert.deepStrictEqual(missingWorkflowType.json, { error: 'workflow_type and agent_id required' });

  const missingAgentId = await dispatch(router, 'PUT', '/api/workflow-routing', jsonBody({ workflow_type: 'qa_review' }), {
    asanaStorage: { pool: createPool(async () => { throw new Error('query should not be called'); }) },
  });
  assert.strictEqual(missingAgentId.statusCode, 400);
  assert.deepStrictEqual(missingAgentId.json, { error: 'workflow_type and agent_id required' });

  const upsertFailurePool = createPool(async () => {
    throw new Error('insert failed');
  });
  const upsertFailure = await dispatch(router, 'PUT', '/api/workflow-routing', jsonBody(upserted), {
    asanaStorage: { pool: upsertFailurePool },
  });
  assert.strictEqual(upsertFailure.statusCode, 500);
  assert.deepStrictEqual(upsertFailure.json, { error: 'insert failed' });

  const deletePool = createPool(async (call) => {
    assert.strictEqual(call.sql, 'DELETE FROM workflow_agent_routing WHERE workflow_type = $1 RETURNING *');
    assert.deepStrictEqual(call.params, ['publish_article']);
    return { rows: [{ workflow_type: 'publish_article' }] };
  });
  const deleteRes = await dispatch(router, 'DELETE', '/api/workflow-routing/publish_article', undefined, {
    asanaStorage: { pool: deletePool },
  });
  assert.strictEqual(deleteRes.statusCode, 200);
  assert.deepStrictEqual(deleteRes.json, { deleted: true });

  const noDbDelete = await dispatch(router, 'DELETE', '/api/workflow-routing/publish_article');
  assert.strictEqual(noDbDelete.statusCode, 503);
  assert.deepStrictEqual(noDbDelete.json, { error: 'DB not available' });

  const notFoundDeletePool = createPool(async (call) => {
    assert.deepStrictEqual(call.params, ['missing']);
    return { rows: [] };
  });
  const notFoundDelete = await dispatch(router, 'DELETE', '/api/workflow-routing/missing', undefined, {
    asanaStorage: { pool: notFoundDeletePool },
  });
  assert.strictEqual(notFoundDelete.statusCode, 404);
  assert.deepStrictEqual(notFoundDelete.json, { error: 'Route not found' });

  const encodedDeletePool = createPool(async (call) => {
    assert.deepStrictEqual(call.params, ['citation%2Fimprovement']);
    return { rows: [{ workflow_type: 'citation%2Fimprovement' }] };
  });
  const encodedDelete = await dispatch(router, 'DELETE', '/api/workflow-routing/citation%2Fimprovement', undefined, {
    asanaStorage: { pool: encodedDeletePool },
  });
  assert.strictEqual(encodedDelete.statusCode, 200);
  assert.deepStrictEqual(encodedDelete.json, { deleted: true });

  const deleteFailurePool = createPool(async () => {
    throw new Error('delete failed');
  });
  const deleteFailure = await dispatch(router, 'DELETE', '/api/workflow-routing/publish_article', undefined, {
    asanaStorage: { pool: deleteFailurePool },
  });
  assert.strictEqual(deleteFailure.statusCode, 500);
  assert.deepStrictEqual(deleteFailure.json, { error: 'delete failed' });
}

run()
  .then(() => {
    console.log('test-workflow-routing-routes: ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
