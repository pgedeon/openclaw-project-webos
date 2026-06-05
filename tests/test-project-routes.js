#!/usr/bin/env node
/**
 * Focused tests for routes/project-routes.js.
 * Run: node tests/test-project-routes.js
 *
 * Source fix covered here: GET /api/projects now catches listProjects failures
 * and returns a JSON 500 response, matching the other project route handlers.
 */

const assert = require('assert');
const Router = require('../routes/router');

const sseRoutesPath = require.resolve('../routes/sse-routes');
const projectRoutesPath = require.resolve('../routes/project-routes');

function loadProjectRoutesWithMockBroadcast(broadcasts) {
  const originalSSE = require.cache[sseRoutesPath];
  delete require.cache[projectRoutesPath];

  require.cache[sseRoutesPath] = {
    id: sseRoutesPath,
    filename: sseRoutesPath,
    loaded: true,
    exports: {
      broadcast(event, data) {
        broadcasts.push({ event, data });
      },
    },
  };

  const { registerProjectRoutes } = require('../routes/project-routes');
  return {
    registerProjectRoutes,
    restore() {
      delete require.cache[projectRoutesPath];
      if (originalSSE) {
        require.cache[sseRoutesPath] = originalSSE;
      } else {
        delete require.cache[sseRoutesPath];
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
  const broadcasts = [];
  const loaded = loadProjectRoutesWithMockBroadcast(broadcasts);

  try {
    const router = new Router();
    loaded.registerProjectRoutes(router);

    const expectedRoutes = [
      ['GET', '/api/projects'],
      ['GET', '/api/projects/default'],
      ['GET', '/api/projects/:id'],
      ['POST', '/api/projects'],
      ['PATCH', '/api/projects/:id'],
      ['DELETE', '/api/projects/:id'],
    ];

    for (const [method, path] of expectedRoutes) {
      assert.ok(
        router.list().some((route) => route.method === method && route.path === path),
        `${method} ${path} should be registered`
      );
    }

    const routeList = router.list();
    const defaultIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === '/api/projects/default');
    const idIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === '/api/projects/:id');
    assert.ok(defaultIndex > -1 && idIndex > -1 && defaultIndex < idIndex, 'default route should be registered before :id');

    let listFilters = null;
    const projects = [{ id: 'project-1', name: 'Core Platform' }];
    const listSuccess = await dispatch(
      router,
      'GET',
      '/api/projects?status=active&workspace_id=space-1&search=core&include_test=true&limit=25&offset=5',
      createContext({
        asanaStorage: {
          async listProjects(filters) {
            listFilters = filters;
            return projects;
          },
        },
      })
    );
    assert.deepStrictEqual(listFilters, {
      status: 'active',
      workspace_id: 'space-1',
      search: 'core',
      include_test: 'true',
      limit: '25',
      offset: '5',
    });
    assert.deepStrictEqual(listSuccess, { status: 200, payload: projects });

    const listEmptyQuery = await dispatch(router, 'GET', '/api/projects', createContext({
      asanaStorage: {
        async listProjects(filters) {
          assert.deepStrictEqual(filters, {});
          return [];
        },
      },
    }));
    assert.deepStrictEqual(listEmptyQuery, { status: 200, payload: [] });

    const listMissingStorage = await dispatch(router, 'GET', '/api/projects', createContext());
    assert.strictEqual(listMissingStorage.status, 503);
    assert.match(listMissingStorage.payload.error, /not initialized/);

    const listStorageError = await dispatch(router, 'GET', '/api/projects', createContext({
      asanaStorage: {
        async listProjects() {
          throw new Error('project list failed');
        },
      },
    }));
    assert.strictEqual(listStorageError.status, 500);
    assert.match(listStorageError.payload.error, /project list failed/);

    let defaultFilters = null;
    const defaultProject = { id: 'project-default', name: 'Default Project' };
    const defaultSuccess = await dispatch(router, 'GET', '/api/projects/default?status=active&workspace_id=ignored', createContext({
      asanaStorage: {
        async getDefaultProject(filters) {
          defaultFilters = filters;
          return defaultProject;
        },
        async getProject() {
          throw new Error('default route should not fall through to :id');
        },
      },
    }));
    assert.deepStrictEqual(defaultFilters, { status: 'active' });
    assert.deepStrictEqual(defaultSuccess, { status: 200, payload: defaultProject });

    const defaultNoStatus = await dispatch(router, 'GET', '/api/projects/default', createContext({
      asanaStorage: {
        async getDefaultProject(filters) {
          assert.deepStrictEqual(filters, {});
          return defaultProject;
        },
      },
    }));
    assert.strictEqual(defaultNoStatus.status, 200);

    const defaultMissingStorage = await dispatch(router, 'GET', '/api/projects/default', createContext());
    assert.strictEqual(defaultMissingStorage.status, 503);

    const defaultNotFound = await dispatch(router, 'GET', '/api/projects/default', createContext({
      asanaStorage: {
        async getDefaultProject() {
          return null;
        },
      },
    }));
    assert.strictEqual(defaultNotFound.status, 404);
    assert.match(defaultNotFound.payload.error, /No default project found/);

    const defaultStorageError = await dispatch(router, 'GET', '/api/projects/default', createContext({
      asanaStorage: {
        async getDefaultProject() {
          throw new Error('default lookup failed');
        },
      },
    }));
    assert.strictEqual(defaultStorageError.status, 500);
    assert.match(defaultStorageError.payload.error, /default lookup failed/);

    let requestedProjectId = null;
    const getSuccess = await dispatch(router, 'GET', '/api/projects/project-1', createContext({
      asanaStorage: {
        async getProject(id) {
          requestedProjectId = id;
          return { id, name: 'Project One' };
        },
      },
    }));
    assert.strictEqual(requestedProjectId, 'project-1');
    assert.deepStrictEqual(getSuccess, { status: 200, payload: { id: 'project-1', name: 'Project One' } });

    const getMissingStorage = await dispatch(router, 'GET', '/api/projects/project-1', createContext());
    assert.strictEqual(getMissingStorage.status, 503);

    const getNotFound = await dispatch(router, 'GET', '/api/projects/missing', createContext({
      asanaStorage: {
        async getProject() {
          throw new Error('project not found');
        },
      },
    }));
    assert.strictEqual(getNotFound.status, 404);
    assert.match(getNotFound.payload.error, /project not found/);

    let createData = null;
    const createPayload = { name: 'Created Project', status: 'active', workspace_id: 'space-1' };
    const createSuccess = await dispatch(router, 'POST', '/api/projects', createContext({
      parseJSONBody: async () => createPayload,
      asanaStorage: {
        async createProject(data) {
          createData = data;
          return { id: 'project-created', ...data };
        },
      },
    }));
    assert.deepStrictEqual(createData, createPayload);
    assert.deepStrictEqual(createSuccess, { status: 201, payload: { id: 'project-created', ...createPayload } });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'project:changed',
      data: { action: 'create', project: { id: 'project-created', ...createPayload } },
    });

    const createMissingStorage = await dispatch(router, 'POST', '/api/projects', createContext());
    assert.strictEqual(createMissingStorage.status, 503);

    let createCalledForMissingName = false;
    const createMissingName = await dispatch(router, 'POST', '/api/projects', createContext({
      parseJSONBody: async () => ({ status: 'active' }),
      asanaStorage: {
        async createProject() {
          createCalledForMissingName = true;
        },
      },
    }));
    assert.strictEqual(createMissingName.status, 400);
    assert.match(createMissingName.payload.error, /Missing required field: name/);
    assert.strictEqual(createCalledForMissingName, false);

    const createBlankName = await dispatch(router, 'POST', '/api/projects', createContext({
      parseJSONBody: async () => ({ name: '' }),
      asanaStorage: {
        async createProject() {
          throw new Error('blank names should be rejected before storage');
        },
      },
    }));
    assert.strictEqual(createBlankName.status, 400);
    assert.match(createBlankName.payload.error, /Missing required field: name/);

    const createParseError = await dispatch(router, 'POST', '/api/projects', createContext({
      parseJSONBody: async () => {
        throw new Error('invalid json');
      },
      asanaStorage: {},
    }));
    assert.strictEqual(createParseError.status, 400);
    assert.match(createParseError.payload.error, /invalid json/);

    const createMissingParser = await dispatch(router, 'POST', '/api/projects', {
      sendJSON,
      asanaStorage: {},
    });
    assert.strictEqual(createMissingParser.status, 400);
    assert.match(createMissingParser.payload.error, /parseJSONBody/);

    const createStorageError = await dispatch(router, 'POST', '/api/projects', createContext({
      parseJSONBody: async () => ({ name: 'Storage Error Project' }),
      asanaStorage: {
        async createProject() {
          throw new Error('create failed');
        },
      },
    }));
    assert.strictEqual(createStorageError.status, 400);
    assert.match(createStorageError.payload.error, /create failed/);

    let updateArgs = null;
    const updateSuccess = await dispatch(router, 'PATCH', '/api/projects/project-1', createContext({
      parseJSONBody: async () => ({ name: 'Updated Project', status: 'paused' }),
      asanaStorage: {
        async updateProject(id, data) {
          updateArgs = { id, data };
          return { id, ...data };
        },
      },
    }));
    assert.deepStrictEqual(updateArgs, { id: 'project-1', data: { name: 'Updated Project', status: 'paused' } });
    assert.deepStrictEqual(updateSuccess, { status: 200, payload: { id: 'project-1', name: 'Updated Project', status: 'paused' } });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'project:changed',
      data: { action: 'update', project: { id: 'project-1', name: 'Updated Project', status: 'paused' } },
    });

    const updateMissingStorage = await dispatch(router, 'PATCH', '/api/projects/project-1', createContext());
    assert.strictEqual(updateMissingStorage.status, 503);

    const updateNotFound = await dispatch(router, 'PATCH', '/api/projects/missing', createContext({
      parseJSONBody: async () => ({ name: 'Missing' }),
      asanaStorage: {
        async updateProject() {
          throw new Error('project not found');
        },
      },
    }));
    assert.strictEqual(updateNotFound.status, 404);
    assert.match(updateNotFound.payload.error, /project not found/);

    const updateInvalidBody = await dispatch(router, 'PATCH', '/api/projects/project-1', createContext({
      parseJSONBody: async () => {
        throw new Error('invalid patch body');
      },
      asanaStorage: {},
    }));
    assert.strictEqual(updateInvalidBody.status, 400);
    assert.match(updateInvalidBody.payload.error, /invalid patch body/);

    const updateStorageError = await dispatch(router, 'PATCH', '/api/projects/project-1', createContext({
      parseJSONBody: async () => ({ status: 'archived' }),
      asanaStorage: {
        async updateProject() {
          throw new Error('cannot archive active project');
        },
      },
    }));
    assert.strictEqual(updateStorageError.status, 400);
    assert.match(updateStorageError.payload.error, /cannot archive active project/);

    let archivedProjectId = null;
    const deleteSuccess = await dispatch(router, 'DELETE', '/api/projects/project-1', createContext({
      asanaStorage: {
        async archiveProject(id) {
          archivedProjectId = id;
        },
      },
    }));
    assert.strictEqual(archivedProjectId, 'project-1');
    assert.deepStrictEqual(deleteSuccess, { status: 200, payload: { deleted: true, id: 'project-1' } });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'project:changed',
      data: { action: 'delete', projectId: 'project-1' },
    });

    const deleteMissingStorage = await dispatch(router, 'DELETE', '/api/projects/project-1', createContext());
    assert.strictEqual(deleteMissingStorage.status, 503);

    const deleteNotFound = await dispatch(router, 'DELETE', '/api/projects/missing', createContext({
      asanaStorage: {
        async archiveProject() {
          throw new Error('project not found');
        },
      },
    }));
    assert.strictEqual(deleteNotFound.status, 404);
    assert.match(deleteNotFound.payload.error, /project not found/);

    const deleteStorageError = await dispatch(router, 'DELETE', '/api/projects/project-1', createContext({
      asanaStorage: {
        async archiveProject() {
          throw new Error('archive blocked');
        },
      },
    }));
    assert.strictEqual(deleteStorageError.status, 400);
    assert.match(deleteStorageError.payload.error, /archive blocked/);

    assert.deepStrictEqual(broadcasts, [], 'failed create/update/delete requests should not broadcast');
    console.log('PASS: project routes');
  } finally {
    loaded.restore();
  }
}

run().catch((error) => {
  console.error('FAIL: project routes');
  console.error(error);
  process.exit(1);
});
