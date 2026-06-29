#!/usr/bin/env node
/**
 * Focused tests for routes/history-routes.js.
 * Run: node tests/test-history-routes.js
 *
 * Source fixes covered here:
 * - History route handlers now return true after sending JSON so task-server.js
 *   does not fall through to legacy handlers and risk writing a second response.
 * - The dependency resolver now treats { pool: null } as unavailable instead
 *   of treating the dependency wrapper as a pool.
 * - POST /api/snapshots/:snapshotId/revert now catches pool.connect() failures
 *   and returns a JSON 500 response instead of throwing outside the handler.
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerHistoryRoutes } = require('../routes/history-routes');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function createRequest(url, method = 'GET', body) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on(event, handler) {
      if (event === 'data' && body !== undefined) {
        process.nextTick(() => handler(Buffer.from(body)));
      }
      if (event === 'end') {
        process.nextTick(handler);
      }
      return req;
    },
  };
  return req;
}

function createContext(overrides = {}) {
  return {
    sendJSON,
    ...overrides,
  };
}

async function dispatch(router, method, url, context, body) {
  const req = createRequest(url, method, body);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  assert.ok(res.result, `${method} ${url} should send a JSON response`);
  return res.result;
}

function createPool(queryImpl) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return queryImpl(sql, params, calls);
    },
  };
}

function createClient(queryImpl) {
  const calls = [];
  const client = {
    calls,
    released: false,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return queryImpl(sql, params, calls);
    },
    release() {
      client.released = true;
    },
  };
  return client;
}

async function run() {
  const router = new Router();
  registerHistoryRoutes(router, { pool: null });

  const expectedRoutes = [
    ['GET', '/api/history'],
    ['GET', '/api/history/:taskId'],
    ['GET', '/api/history/:taskId/snapshot'],
    ['GET', '/api/history/:taskId/diff'],
    ['GET', '/api/snapshots'],
    ['GET', '/api/snapshots/:entityType/:entityId'],
    ['POST', '/api/snapshots/:snapshotId/preview-revert'],
    ['POST', '/api/snapshots/:snapshotId/revert'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  const missingPool = await dispatch(router, 'GET', '/api/history', createContext());
  assert.strictEqual(missingPool.status, 503);
  assert.match(missingPool.payload.error, /Database not available/);

  let pool = createPool(async () => ({
    rows: [
      {
        id: 'audit-1',
        task_id: 'task-1',
        actor: 'lead one',
        action: 'updated',
        task_title: 'Fix dashboard',
      },
    ],
  }));
  let result = await dispatch(
    router,
    'GET',
    '/api/history?limit=999&actor=lead%20one&action=updated&entity_type=task',
    createContext(),
    undefined
  );
  assert.strictEqual(result.status, 503, 'router registered with null pool should stay unavailable');

  const liveRouter = new Router();
  registerHistoryRoutes(liveRouter, { get pool() { return pool; } });

  result = await dispatch(
    liveRouter,
    'GET',
    '/api/history?limit=999&actor=lead%20one&action=updated&entity_type=task',
    createContext()
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.payload.total, 1);
  assert.deepStrictEqual(pool.calls[0].params, [100, 'lead one', 'updated', 'task']);
  assert.match(pool.calls[0].sql, /LEFT JOIN tasks/);
  assert.match(pool.calls[0].sql, /LIMIT \$1/);

  pool = createPool(async () => {
    throw new Error('history query failed');
  });
  result = await dispatch(liveRouter, 'GET', '/api/history', createContext());
  assert.strictEqual(result.status, 500);
  assert.match(result.payload.error, /history query failed/);

  pool = createPool(async () => ({
    rows: [
      {
        id: 'audit-2',
        actor: 'dashboard',
        action: 'status-change',
        old_value: { status: 'todo' },
        new_value: { status: 'done' },
        timestamp: '2026-03-12T12:00:00.000Z',
        entity_type: 'task',
        correlation_id: 'corr-1',
      },
    ],
  }));
  result = await dispatch(liveRouter, 'GET', '/api/history/task-1?limit=999', createContext());
  assert.deepStrictEqual(pool.calls[0].params, ['task-1', 200]);
  assert.deepStrictEqual(result.payload, {
    taskId: 'task-1',
    entries: [
      {
        id: 'audit-2',
        actor: 'dashboard',
        action: 'status-change',
        oldValue: { status: 'todo' },
        newValue: { status: 'done' },
        timestamp: '2026-03-12T12:00:00.000Z',
        entityType: 'task',
        correlationId: 'corr-1',
      },
    ],
    total: 1,
  });

  pool = createPool(async () => {
    throw new Error('should not query without at');
  });
  result = await dispatch(liveRouter, 'GET', '/api/history/task-1/snapshot', createContext());
  assert.strictEqual(result.status, 400);
  assert.match(result.payload.error, /Missing \?at/);
  assert.strictEqual(pool.calls.length, 0);

  pool = createPool(async () => ({ rows: [{ state: { id: 'task-1', title: 'Past State' } }] }));
  result = await dispatch(
    liveRouter,
    'GET',
    '/api/history/task-1/snapshot?at=2026-03-12T12%3A00%3A00.000Z',
    createContext()
  );
  assert.deepStrictEqual(pool.calls[0].params, ['task-1', '2026-03-12T12:00:00.000Z']);
  assert.deepStrictEqual(result, {
    status: 200,
    payload: { snapshot: { id: 'task-1', title: 'Past State' }, exact: true },
  });

  pool = createPool(async (sql) => {
    if (/state_snapshots/.test(sql)) return { rows: [] };
    if (/FROM tasks/.test(sql)) return { rows: [{ id: 'task-1', title: 'Current State' }] };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  result = await dispatch(liveRouter, 'GET', '/api/history/task-1/snapshot?at=2026-01-01', createContext());
  assert.deepStrictEqual(result, {
    status: 200,
    payload: { snapshot: { id: 'task-1', title: 'Current State' }, exact: false },
  });

  pool = createPool(async () => ({ rows: [] }));
  result = await dispatch(liveRouter, 'GET', '/api/history/missing/snapshot?at=2026-01-01', createContext());
  assert.strictEqual(result.status, 404);
  assert.match(result.payload.error, /Task not found/);

  pool = createPool(async () => {
    throw new Error('should not query without diff params');
  });
  result = await dispatch(liveRouter, 'GET', '/api/history/task-1/diff?from=2026-01-01', createContext());
  assert.strictEqual(result.status, 400);
  assert.match(result.payload.error, /Missing \?from/);
  assert.strictEqual(pool.calls.length, 0);

  pool = createPool(async (sql, params) => {
    if (params[1] === '2026-01-01T00:00:00.000Z') {
      return { rows: [{ state: { title: 'Old', same: 1, deleted: 'gone' } }] };
    }
    return { rows: [{ state: { title: 'New', same: 1, added: true } }] };
  });
  result = await dispatch(
    liveRouter,
    'GET',
    '/api/history/task-1/diff?from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-02T00%3A00%3A00.000Z',
    createContext()
  );
  assert.deepStrictEqual(result.payload, {
    taskId: 'task-1',
    changes: [
      { field: 'title', from: 'Old', to: 'New' },
      { field: 'deleted', from: 'gone', to: undefined },
      { field: 'added', from: undefined, to: true },
    ],
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
  });

  pool = createPool(async () => ({ rows: [{ id: 'snap-1' }, { id: 'snap-2' }] }));
  result = await dispatch(liveRouter, 'GET', '/api/snapshots?limit=999', createContext());
  assert.deepStrictEqual(pool.calls[0].params, [200]);
  assert.deepStrictEqual(result, { status: 200, payload: { snapshots: [{ id: 'snap-1' }, { id: 'snap-2' }], total: 2 } });

  pool = createPool(async () => ({ rows: [{ id: 'snap-entity' }] }));
  result = await dispatch(liveRouter, 'GET', '/api/snapshots/project/project-1?limit=25', createContext());
  assert.deepStrictEqual(pool.calls[0].params, ['project', 'project-1', 25]);
  assert.deepStrictEqual(result, { status: 200, payload: { snapshots: [{ id: 'snap-entity' }], total: 1 } });

  pool = createPool(async (sql) => {
    if (/state_snapshots/.test(sql)) {
      return {
        rows: [
          {
            id: 'snap-task',
            entity_type: 'task',
            entity_id: 'task-1',
            state: JSON.stringify({ id: 'task-1', title: 'Snapshot Title' }),
          },
        ],
      };
    }
    if (/FROM tasks/.test(sql)) return { rows: [{ id: 'task-1', title: 'Current Title' }] };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/snap-task/preview-revert', createContext());
  assert.deepStrictEqual(result.payload.snapshotState, { id: 'task-1', title: 'Snapshot Title' });
  assert.deepStrictEqual(result.payload.currentState, { id: 'task-1', title: 'Current Title' });

  pool = createPool(async () => ({ rows: [] }));
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/missing/preview-revert', createContext());
  assert.strictEqual(result.status, 404);
  assert.match(result.payload.error, /Snapshot not found/);

  pool = createPool(async () => ({
    rows: [{ id: 'snap-bad', entity_type: 'task', entity_id: 'task-1', state: '{bad json' }],
  }));
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/snap-bad/preview-revert', createContext());
  assert.strictEqual(result.status, 500);
  assert.match(result.payload.error, /JSON/);

  let client = createClient(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/SELECT \* FROM state_snapshots/.test(sql)) {
      return {
        rows: [
          {
            id: 'snap-task',
            entity_type: 'task',
            entity_id: 'task-1',
            state: {
              title: 'Reverted Task',
              status: 'done',
              owner: 'agent-1',
            },
          },
        ],
      };
    }
    return { rows: [] };
  });
  pool = {
    async connect() {
      return client;
    },
  };
  result = await dispatch(
    liveRouter,
    'POST',
    '/api/snapshots/snap-task/revert',
    createContext(),
    JSON.stringify({ actor: 'lead-operator' })
  );
  assert.deepStrictEqual(result, {
    status: 200,
    payload: { reverted: true, entityType: 'task', entityId: 'task-1' },
  });
  assert.strictEqual(client.released, true);
  assert.deepStrictEqual(client.calls.map((call) => call.sql === 'BEGIN' || call.sql === 'COMMIT' ? call.sql : call.sql.replace(/\s+/g, ' ').trim()).filter((sql) => sql === 'BEGIN' || sql === 'COMMIT'), ['BEGIN', 'COMMIT']);
  const taskUpdate = client.calls.find((call) => /UPDATE tasks SET/.test(call.sql));
  assert.ok(taskUpdate, 'task revert should update tasks');
  assert.deepStrictEqual(taskUpdate.params, [
    'Reverted Task',
    '',
    'done',
    'medium',
    'agent-1',
    undefined,
    [],
    {},
    'task-1',
  ]);
  assert.ok(
    client.calls.some((call) => /pre-revert/.test(call.sql) && call.params[2] === 'lead-operator'),
    'revert should record a pre-revert snapshot with actor'
  );
  assert.ok(
    client.calls.some((call) => /'revert'/.test(call.sql) && call.params[3] === 'lead-operator'),
    'revert should record the revert action with actor'
  );

  client = createClient(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (/SELECT \* FROM state_snapshots/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  });
  pool = {
    async connect() {
      return client;
    },
  };
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/missing/revert', createContext(), '{}');
  assert.strictEqual(result.status, 404);
  assert.match(result.payload.error, /Snapshot not found/);
  assert.strictEqual(client.released, true);
  assert.ok(client.calls.some((call) => call.sql === 'ROLLBACK'));

  client = createClient(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (/SELECT \* FROM state_snapshots/.test(sql)) {
      return {
        rows: [
          {
            id: 'snap-project',
            entity_type: 'project',
            entity_id: 'project-1',
            state: JSON.stringify({ name: 'Recovered Project' }),
          },
        ],
      };
    }
    return { rows: [] };
  });
  pool = {
    async connect() {
      return client;
    },
  };
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/snap-project/revert', createContext(), '{not json');
  assert.deepStrictEqual(result.payload, { reverted: true, entityType: 'project', entityId: 'project-1' });
  const projectUpdate = client.calls.find((call) => /UPDATE projects SET/.test(call.sql));
  assert.ok(projectUpdate, 'project revert should update projects');
  assert.deepStrictEqual(projectUpdate.params, [
    'Recovered Project',
    '',
    'active',
    [],
    {},
    'project-1',
  ]);
  assert.ok(
    client.calls.some((call) => /pre-revert/.test(call.sql) && call.params[2] === 'dashboard-operator'),
    'malformed JSON body should fall back to the default actor'
  );

  pool = {
    async connect() {
      throw new Error('connect failed');
    },
  };
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/snap-task/revert', createContext(), '{}');
  assert.strictEqual(result.status, 500);
  assert.match(result.payload.error, /connect failed/);

  client = createClient(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
    if (/SELECT \* FROM state_snapshots/.test(sql)) {
      throw new Error('snapshot select failed');
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  pool = {
    async connect() {
      return client;
    },
  };
  result = await dispatch(liveRouter, 'POST', '/api/snapshots/snap-task/revert', createContext(), '{}');
  assert.strictEqual(result.status, 500);
  assert.match(result.payload.error, /snapshot select failed/);
  assert.strictEqual(client.released, true);
  assert.ok(client.calls.some((call) => call.sql === 'ROLLBACK'));

  console.log('test-history-routes: all assertions passed');
}

run().catch((err) => {
  console.error('test-history-routes failed:', err);
  process.exit(1);
});
