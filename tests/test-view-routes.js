#!/usr/bin/env node
/**
 * Focused tests for routes/view-routes.js.
 * Run: node tests/test-view-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerViewRoutes } = require('../routes/view-routes');

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

async function run() {
  const router = new Router();
  registerViewRoutes(router);

  const expectedRoutes = [
    ['GET', '/api/views'],
    ['POST', '/api/views'],
    ['GET', '/api/views/board'],
    ['GET', '/api/views/timeline'],
    ['GET', '/api/views/agent'],
    ['GET', '/api/views/:id'],
    ['PATCH', '/api/views/:id'],
    ['DELETE', '/api/views/:id'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  const routeList = router.list();
  for (const builtInPath of ['/api/views/board', '/api/views/timeline', '/api/views/agent']) {
    const builtInIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === builtInPath);
    const idIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === '/api/views/:id');
    assert.ok(
      builtInIndex > -1 && idIndex > -1 && builtInIndex < idIndex,
      `${builtInPath} should be registered before /api/views/:id`
    );
  }

  let listProjectId = null;
  const savedViews = [{ id: 'view-1', name: 'My Tasks' }];
  const listSuccess = await dispatch(router, 'GET', '/api/views?project_id=project%201', createContext({
    asanaStorage: {
      async listSavedViews(projectId) {
        listProjectId = projectId;
        return savedViews;
      },
    },
  }));
  assert.strictEqual(listProjectId, 'project 1');
  assert.deepStrictEqual(listSuccess, { status: 200, payload: savedViews });

  const listMissingStorage = await dispatch(router, 'GET', '/api/views?project_id=project-1', createContext());
  assert.strictEqual(listMissingStorage.status, 503);
  assert.match(listMissingStorage.payload.error, /not initialized/);

  const listMissingProject = await dispatch(router, 'GET', '/api/views', createContext({ asanaStorage: {} }));
  assert.strictEqual(listMissingProject.status, 400);
  assert.match(listMissingProject.payload.error, /project_id query parameter required/);

  const listStorageError = await dispatch(router, 'GET', '/api/views?project_id=project-1', createContext({
    asanaStorage: {
      async listSavedViews() {
        throw new Error('saved view list failed');
      },
    },
  }));
  assert.strictEqual(listStorageError.status, 500);
  assert.match(listStorageError.payload.error, /saved view list failed/);

  let createArgs = null;
  const createSuccess = await dispatch(router, 'POST', '/api/views', createContext({
    parseJSONBody: async () => ({
      project_id: 'project-1',
      name: 'Blocked Tasks',
      filters: { status: 'blocked' },
      sort: 'updated',
      created_by: 'operator',
    }),
    asanaStorage: {
      async createSavedView(projectId, name, filters, sort, createdBy) {
        createArgs = { projectId, name, filters, sort, createdBy };
        return { id: 'view-2', name, filters, sort, created_by: createdBy };
      },
    },
  }));
  assert.deepStrictEqual(createArgs, {
    projectId: 'project-1',
    name: 'Blocked Tasks',
    filters: { status: 'blocked' },
    sort: 'updated',
    createdBy: 'operator',
  });
  assert.deepStrictEqual(createSuccess, {
    status: 201,
    payload: {
      id: 'view-2',
      name: 'Blocked Tasks',
      filters: { status: 'blocked' },
      sort: 'updated',
      created_by: 'operator',
    },
  });

  let createNoSortArgs = null;
  const createNoSort = await dispatch(router, 'POST', '/api/views', createContext({
    parseJSONBody: async () => ({
      project_id: 'project-1',
      name: 'No Sort',
      filters: {},
      created_by: 'operator',
    }),
    asanaStorage: {
      async createSavedView(projectId, name, filters, sort, createdBy) {
        createNoSortArgs = { projectId, name, filters, sort, createdBy };
        return { id: 'view-3', sort };
      },
    },
  }));
  assert.deepStrictEqual(createNoSortArgs, {
    projectId: 'project-1',
    name: 'No Sort',
    filters: {},
    sort: null,
    createdBy: 'operator',
  });
  assert.deepStrictEqual(createNoSort, { status: 201, payload: { id: 'view-3', sort: null } });

  const createMissingStorage = await dispatch(router, 'POST', '/api/views', createContext());
  assert.strictEqual(createMissingStorage.status, 503);

  for (const [field, body] of [
    ['project_id', { name: 'Missing Project', filters: {}, created_by: 'operator' }],
    ['name', { project_id: 'project-1', filters: {}, created_by: 'operator' }],
    ['filters', { project_id: 'project-1', name: 'Missing Filters', created_by: 'operator' }],
    ['created_by', { project_id: 'project-1', name: 'Missing Creator', filters: {} }],
  ]) {
    const result = await dispatch(router, 'POST', '/api/views', createContext({
      parseJSONBody: async () => body,
      asanaStorage: {
        async createSavedView() {
          throw new Error('create should not be called');
        },
      },
    }));
    assert.strictEqual(result.status, 400);
    assert.match(result.payload.error, new RegExp(`Missing required field: ${field}`));
  }

  const createParseError = await dispatch(router, 'POST', '/api/views', createContext({
    parseJSONBody: async () => {
      throw new Error('invalid json');
    },
    asanaStorage: {},
  }));
  assert.strictEqual(createParseError.status, 400);
  assert.match(createParseError.payload.error, /invalid json/);

  const createStorageError = await dispatch(router, 'POST', '/api/views', createContext({
    parseJSONBody: async () => ({ project_id: 'project-1', name: 'Fail', filters: {}, created_by: 'operator' }),
    asanaStorage: {
      async createSavedView() {
        throw new Error('create failed');
      },
    },
  }));
  assert.strictEqual(createStorageError.status, 400);
  assert.match(createStorageError.payload.error, /create failed/);

  let boardProjectId = null;
  const boardSuccess = await dispatch(router, 'GET', '/api/views/board?project_id=project-1', createContext({
    asanaStorage: {
      async getBoardView(projectId) {
        boardProjectId = projectId;
        return { columns: { ready: [] } };
      },
      async getSavedView() {
        throw new Error('built-in board route should not fall through to :id');
      },
    },
  }));
  assert.strictEqual(boardProjectId, 'project-1');
  assert.deepStrictEqual(boardSuccess, { status: 200, payload: { columns: { ready: [] } } });

  const boardMissingStorage = await dispatch(router, 'GET', '/api/views/board?project_id=project-1', createContext());
  assert.strictEqual(boardMissingStorage.status, 503);

  const boardMissingProject = await dispatch(router, 'GET', '/api/views/board', createContext({ asanaStorage: {} }));
  assert.strictEqual(boardMissingProject.status, 400);

  const boardError = await dispatch(router, 'GET', '/api/views/board?project_id=missing', createContext({
    asanaStorage: {
      async getBoardView() {
        throw new Error('project not found');
      },
    },
  }));
  assert.strictEqual(boardError.status, 404);
  assert.match(boardError.payload.error, /project not found/);

  let timelineArgs = null;
  const timelineSuccess = await dispatch(
    router,
    'GET',
    '/api/views/timeline?project_id=project-1&start=2026-03-01&end=2026-03-31',
    createContext({
      asanaStorage: {
        async getTimelineView(projectId, start, end) {
          timelineArgs = { projectId, start, end };
          return { tasks: [], range: { start, end } };
        },
      },
    })
  );
  assert.deepStrictEqual(timelineArgs, {
    projectId: 'project-1',
    start: '2026-03-01',
    end: '2026-03-31',
  });
  assert.deepStrictEqual(timelineSuccess, {
    status: 200,
    payload: { tasks: [], range: { start: '2026-03-01', end: '2026-03-31' } },
  });

  const timelineNoRange = await dispatch(router, 'GET', '/api/views/timeline?project_id=project-1', createContext({
    asanaStorage: {
      async getTimelineView(projectId, start, end) {
        assert.strictEqual(projectId, 'project-1');
        assert.strictEqual(start, null);
        assert.strictEqual(end, null);
        return { tasks: [] };
      },
    },
  }));
  assert.deepStrictEqual(timelineNoRange, { status: 200, payload: { tasks: [] } });

  const timelineMissingStorage = await dispatch(router, 'GET', '/api/views/timeline?project_id=project-1', createContext());
  assert.strictEqual(timelineMissingStorage.status, 503);

  const timelineMissingProject = await dispatch(router, 'GET', '/api/views/timeline', createContext({ asanaStorage: {} }));
  assert.strictEqual(timelineMissingProject.status, 400);

  const timelineError = await dispatch(router, 'GET', '/api/views/timeline?project_id=missing', createContext({
    asanaStorage: {
      async getTimelineView() {
        throw new Error('timeline unavailable');
      },
    },
  }));
  assert.strictEqual(timelineError.status, 404);
  assert.match(timelineError.payload.error, /timeline unavailable/);

  let agentQueueArgs = null;
  const agentSuccess = await dispatch(router, 'GET', '/api/views/agent?agent_name=agent-1&page=3&limit=25', createContext({
    asanaStorage: {
      async getAgentQueue(agentName, statuses, pagination) {
        agentQueueArgs = { agentName, statuses, pagination };
        return {
          tasks: [{ id: 'task-1' }],
          pagination: { page: pagination.page, limit: pagination.limit, total: 1, pages: 1 },
        };
      },
    },
  }));
  assert.deepStrictEqual(agentQueueArgs, {
    agentName: 'agent-1',
    statuses: ['ready', 'in_progress'],
    pagination: { page: 3, limit: 25 },
  });
  assert.deepStrictEqual(agentSuccess, {
    status: 200,
    payload: {
      agent: 'agent-1',
      tasks: [{ id: 'task-1' }],
      pagination: { page: 3, limit: 25, total: 1, pages: 1 },
    },
  });

  const agentDefaultPagination = await dispatch(router, 'GET', '/api/views/agent?agent_name=agent-1&page=0&limit=not-a-number', createContext({
    asanaStorage: {
      async getAgentQueue(agentName, statuses, pagination) {
        assert.strictEqual(agentName, 'agent-1');
        assert.deepStrictEqual(statuses, ['ready', 'in_progress']);
        assert.deepStrictEqual(pagination, { page: 1, limit: 50 });
        return { tasks: [], pagination };
      },
    },
  }));
  assert.deepStrictEqual(agentDefaultPagination, {
    status: 200,
    payload: { agent: 'agent-1', tasks: [], pagination: { page: 1, limit: 50 } },
  });

  const agentMissingStorage = await dispatch(router, 'GET', '/api/views/agent?agent_name=agent-1', createContext());
  assert.strictEqual(agentMissingStorage.status, 503);

  const agentMissingName = await dispatch(router, 'GET', '/api/views/agent', createContext({ asanaStorage: {} }));
  assert.strictEqual(agentMissingName.status, 400);
  assert.match(agentMissingName.payload.error, /agent_name query parameter required/);

  const agentNotFound = await dispatch(router, 'GET', '/api/views/agent?agent_name=missing', createContext({
    asanaStorage: {
      async getAgentQueue() {
        throw new Error('agent not found');
      },
    },
  }));
  assert.strictEqual(agentNotFound.status, 404);

  const agentStorageError = await dispatch(router, 'GET', '/api/views/agent?agent_name=agent-1', createContext({
    asanaStorage: {
      async getAgentQueue() {
        throw new Error('queue query failed');
      },
    },
  }));
  assert.strictEqual(agentStorageError.status, 500);
  assert.match(agentStorageError.payload.error, /queue query failed/);

  let requestedViewId = null;
  const getSuccess = await dispatch(router, 'GET', '/api/views/view-1', createContext({
    asanaStorage: {
      async getSavedView(id) {
        requestedViewId = id;
        return { id, name: 'Saved View' };
      },
    },
  }));
  assert.strictEqual(requestedViewId, 'view-1');
  assert.deepStrictEqual(getSuccess, { status: 200, payload: { id: 'view-1', name: 'Saved View' } });

  const getMissingStorage = await dispatch(router, 'GET', '/api/views/view-1', createContext());
  assert.strictEqual(getMissingStorage.status, 503);

  const getNotFound = await dispatch(router, 'GET', '/api/views/missing', createContext({
    asanaStorage: {
      async getSavedView() {
        return null;
      },
    },
  }));
  assert.strictEqual(getNotFound.status, 404);
  assert.match(getNotFound.payload.error, /Saved view not found/);

  const getStorageError = await dispatch(router, 'GET', '/api/views/view-1', createContext({
    asanaStorage: {
      async getSavedView() {
        throw new Error('saved view lookup failed');
      },
    },
  }));
  assert.strictEqual(getStorageError.status, 500);
  assert.match(getStorageError.payload.error, /saved view lookup failed/);

  let updateArgs = null;
  const patchSuccess = await dispatch(router, 'PATCH', '/api/views/view-1', createContext({
    parseJSONBody: async () => ({
      name: 'Updated',
      filters: { status: 'ready' },
      sort: null,
      ignored: true,
    }),
    asanaStorage: {
      async updateSavedView(id, updates) {
        updateArgs = { id, updates };
        return { id, ...updates };
      },
    },
  }));
  assert.deepStrictEqual(updateArgs, {
    id: 'view-1',
    updates: { name: 'Updated', filters: { status: 'ready' }, sort: null },
  });
  assert.deepStrictEqual(patchSuccess, {
    status: 200,
    payload: { id: 'view-1', name: 'Updated', filters: { status: 'ready' }, sort: null },
  });

  let emptyUpdateArgs = null;
  const patchEmptyUpdate = await dispatch(router, 'PATCH', '/api/views/view-1', createContext({
    parseJSONBody: async () => ({ ignored: 'value' }),
    asanaStorage: {
      async updateSavedView(id, updates) {
        emptyUpdateArgs = { id, updates };
        return { id, updates };
      },
    },
  }));
  assert.deepStrictEqual(emptyUpdateArgs, { id: 'view-1', updates: {} });
  assert.deepStrictEqual(patchEmptyUpdate, { status: 200, payload: { id: 'view-1', updates: {} } });

  const patchMissingStorage = await dispatch(router, 'PATCH', '/api/views/view-1', createContext());
  assert.strictEqual(patchMissingStorage.status, 503);

  const patchParseError = await dispatch(router, 'PATCH', '/api/views/view-1', createContext({
    parseJSONBody: async () => {
      throw new Error('invalid json');
    },
    asanaStorage: {},
  }));
  assert.strictEqual(patchParseError.status, 400);

  const patchNotFound = await dispatch(router, 'PATCH', '/api/views/missing', createContext({
    parseJSONBody: async () => ({ name: 'Missing' }),
    asanaStorage: {
      async updateSavedView() {
        throw new Error('saved view not found');
      },
    },
  }));
  assert.strictEqual(patchNotFound.status, 404);

  const patchStorageError = await dispatch(router, 'PATCH', '/api/views/view-1', createContext({
    parseJSONBody: async () => ({ name: 'Updated' }),
    asanaStorage: {
      async updateSavedView() {
        throw new Error('update failed');
      },
    },
  }));
  assert.strictEqual(patchStorageError.status, 400);
  assert.match(patchStorageError.payload.error, /update failed/);

  let deletedViewId = null;
  const deleteSuccess = await dispatch(router, 'DELETE', '/api/views/view-1', createContext({
    asanaStorage: {
      async deleteSavedView(id) {
        deletedViewId = id;
        return true;
      },
    },
  }));
  assert.strictEqual(deletedViewId, 'view-1');
  assert.deepStrictEqual(deleteSuccess, { status: 200, payload: { deleted: true, id: 'view-1' } });

  const deleteMissingStorage = await dispatch(router, 'DELETE', '/api/views/view-1', createContext());
  assert.strictEqual(deleteMissingStorage.status, 503);

  const deleteNotFound = await dispatch(router, 'DELETE', '/api/views/missing', createContext({
    asanaStorage: {
      async deleteSavedView() {
        return false;
      },
    },
  }));
  assert.strictEqual(deleteNotFound.status, 404);
  assert.match(deleteNotFound.payload.error, /Saved view not found/);

  const deleteStorageError = await dispatch(router, 'DELETE', '/api/views/view-1', createContext({
    asanaStorage: {
      async deleteSavedView() {
        throw new Error('delete failed');
      },
    },
  }));
  assert.strictEqual(deleteStorageError.status, 500);
  assert.match(deleteStorageError.payload.error, /delete failed/);

  console.log('PASS: view routes');
}

run().catch((error) => {
  console.error('FAIL: view routes');
  console.error(error);
  process.exit(1);
});
