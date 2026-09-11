#!/usr/bin/env node
/**
 * Focused tests for routes/space-routes.js.
 * Run: node tests/test-space-routes.js
 *
 * Source fixes covered here:
 * - Database-unavailable responses now return `true` to the router so task-server
 *   does not continue into legacy fallback handlers after sending a 503 response.
 * - registerSpaceRoutes now treats a deps object with `pool: null` as unavailable,
 *   matching task-server's lazy settingsDeps shape.
 * - Body parser errors now preserve their intended HTTP status codes instead of
 *   being converted to generic 500 responses.
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const Router = require('../routes/router');

const sseRoutesPath = require.resolve('../routes/sse-routes');
const spaceRoutesPath = require.resolve('../routes/space-routes');

function loadSpaceRoutesWithMockBroadcast(broadcasts) {
  const originalSSE = require.cache[sseRoutesPath];
  delete require.cache[spaceRoutesPath];

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

  const { registerSpaceRoutes } = require('../routes/space-routes');
  return {
    registerSpaceRoutes,
    restore() {
      delete require.cache[spaceRoutesPath];
      if (originalSSE) {
        require.cache[sseRoutesPath] = originalSSE;
      } else {
        delete require.cache[sseRoutesPath];
      }
    },
  };
}

function createResponseCapture() {
  return {
    result: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload) {
      this.result = {
        status: this.status,
        headers: this.headers,
        payload: payload ? JSON.parse(payload) : undefined,
      };
    },
  };
}

function createRequest(url, method = 'GET', body = undefined) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3876' };

  process.nextTick(() => {
    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });

  return req;
}

async function dispatch(router, method, url, context, body = undefined) {
  const req = createRequest(url, method, body);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  return res.result;
}

function createRouter(registerSpaceRoutes, deps = { pool: {} }) {
  const router = new Router();
  registerSpaceRoutes(router, deps);
  return router;
}

async function run() {
  const broadcasts = [];
  const loaded = loadSpaceRoutesWithMockBroadcast(broadcasts);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const router = createRouter(loaded.registerSpaceRoutes);
    const expectedRoutes = [
      ['GET', '/api/spaces'],
      ['GET', '/api/spaces/:id'],
      ['POST', '/api/spaces'],
      ['PUT', '/api/spaces/:id'],
      ['DELETE', '/api/spaces/:id'],
      ['POST', '/api/spaces/:id/duplicate'],
      ['POST', '/api/spaces/:id/set-default'],
      ['GET', '/api/spaces/:id/projects'],
      ['PUT', '/api/spaces/:id/projects'],
      ['GET', '/api/spaces/:id/stats'],
    ];

    for (const [method, path] of expectedRoutes) {
      assert.ok(
        router.list().some((route) => route.method === method && route.path === path),
        `${method} ${path} should be registered`
      );
    }

    const spaces = [{ id: 'space-1', name: 'Core', slug: 'core' }];
    const listSuccess = await dispatch(router, 'GET', '/api/spaces', {
      asanaStorage: {
        async listWorkspaces() {
          return spaces;
        },
      },
    });
    assert.deepStrictEqual(listSuccess, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      payload: { spaces },
    });

    const unavailableRouter = createRouter(loaded.registerSpaceRoutes, {
      get pool() {
        return null;
      },
    });
    let unavailableStorageCalled = false;
    const unavailable = await dispatch(unavailableRouter, 'GET', '/api/spaces', {
      asanaStorage: {
        async listWorkspaces() {
          unavailableStorageCalled = true;
        },
      },
    });
    assert.strictEqual(unavailable.status, 503);
    assert.match(unavailable.payload.error, /Database not available/);
    assert.strictEqual(unavailableStorageCalled, false);

    const listError = await dispatch(router, 'GET', '/api/spaces', {
      asanaStorage: {
        async listWorkspaces() {
          throw new Error('list failed');
        },
      },
    });
    assert.strictEqual(listError.status, 500);
    assert.match(listError.payload.error, /Failed to list spaces/);

    let getId = null;
    const getSuccess = await dispatch(router, 'GET', '/api/spaces/space-1', {
      asanaStorage: {
        async getWorkspace(id) {
          getId = id;
          return { id, name: 'Core' };
        },
      },
    });
    assert.strictEqual(getId, 'space-1');
    assert.deepStrictEqual(getSuccess.payload, { id: 'space-1', name: 'Core' });

    const getNotFound = await dispatch(router, 'GET', '/api/spaces/missing', {
      asanaStorage: {
        async getWorkspace() {
          return null;
        },
      },
    });
    assert.strictEqual(getNotFound.status, 404);
    assert.match(getNotFound.payload.error, /Workspace not found/);

    const getError = await dispatch(router, 'GET', '/api/spaces/space-1', {
      asanaStorage: {
        async getWorkspace() {
          throw new Error('get failed');
        },
      },
    });
    assert.strictEqual(getError.status, 500);

    let createData = null;
    const createSuccess = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {
        async createWorkspace(data) {
          createData = { ...data };
          return { id: 'space-created', ...data };
        },
      },
    }, {
      name: 'Cafe\u0301 Space!!',
      color: '#A1b2C3',
      description: 'A managed workspace',
    });
    assert.deepStrictEqual(createData, {
      name: 'Cafe\u0301 Space!!',
      color: '#A1b2C3',
      description: 'A managed workspace',
      slug: 'cafe-space',
    });
    assert.strictEqual(createSuccess.status, 201);
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'create', space: { id: 'space-created', ...createData } },
    });

    const createMissingName = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {
        async createWorkspace() {
          throw new Error('missing name should not reach storage');
        },
      },
    }, { slug: 'no-name' });
    assert.strictEqual(createMissingName.status, 400);
    assert.match(createMissingName.payload.error, /name is required/);

    const createInvalidColor = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {
        async createWorkspace() {
          throw new Error('invalid color should not reach storage');
        },
      },
    }, { name: 'Bad Color', color: 'blue' });
    assert.strictEqual(createInvalidColor.status, 400);
    assert.match(createInvalidColor.payload.error, /Invalid color format/);

    const createLongDescription = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {
        async createWorkspace() {
          throw new Error('long description should not reach storage');
        },
      },
    }, { name: 'Verbose', description: 'x'.repeat(1001) });
    assert.strictEqual(createLongDescription.status, 400);
    assert.match(createLongDescription.payload.error, /Description too long/);

    const createInvalidJSON = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {},
    }, '{');
    assert.strictEqual(createInvalidJSON.status, 400);
    assert.match(createInvalidJSON.payload.error, /Invalid JSON/);

    const createTooLarge = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {},
    }, 'x'.repeat(64 * 1024 + 1));
    assert.strictEqual(createTooLarge.status, 413);
    assert.match(createTooLarge.payload.error, /Payload too large/);

    const createDuplicateSlug = await dispatch(router, 'POST', '/api/spaces', {
      asanaStorage: {
        async createWorkspace() {
          const err = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        },
      },
    }, { name: 'Duplicate', slug: 'duplicate' });
    assert.strictEqual(createDuplicateSlug.status, 409);
    assert.match(createDuplicateSlug.payload.error, /Slug already exists/);

    let updateArgs = null;
    const updateSuccess = await dispatch(router, 'PUT', '/api/spaces/space-1', {
      asanaStorage: {
        async updateWorkspace(id, data, expectedUpdatedAt) {
          updateArgs = { id, data, expectedUpdatedAt };
          return { id, name: data.name };
        },
      },
    }, { name: 'Renamed', _expected_updated_at: '2026-03-22T12:00:00.000Z' });
    assert.deepStrictEqual(updateArgs, {
      id: 'space-1',
      data: { name: 'Renamed', _expected_updated_at: '2026-03-22T12:00:00.000Z' },
      expectedUpdatedAt: '2026-03-22T12:00:00.000Z',
    });
    assert.deepStrictEqual(updateSuccess, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      payload: { id: 'space-1', name: 'Renamed' },
    });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'update', space: { id: 'space-1', name: 'Renamed' } },
    });

    const updateNotFound = await dispatch(router, 'PUT', '/api/spaces/missing', {
      asanaStorage: {
        async updateWorkspace() {
          return null;
        },
      },
    }, { name: 'Missing' });
    assert.strictEqual(updateNotFound.status, 404);

    const updateInvalidJSON = await dispatch(router, 'PUT', '/api/spaces/space-1', {
      asanaStorage: {},
    }, '{');
    assert.strictEqual(updateInvalidJSON.status, 400);

    const updateError = await dispatch(router, 'PUT', '/api/spaces/space-1', {
      asanaStorage: {
        async updateWorkspace() {
          throw new Error('update failed');
        },
      },
    }, { name: 'Broken' });
    assert.strictEqual(updateError.status, 500);
    assert.match(updateError.payload.error, /Failed to update space/);

    const deleteSuccess = await dispatch(router, 'DELETE', '/api/spaces/space-1', {
      asanaStorage: {
        async deleteWorkspace(id) {
          assert.strictEqual(id, 'space-1');
          return true;
        },
      },
    });
    assert.deepStrictEqual(deleteSuccess.payload, { deleted: true });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'delete', spaceId: 'space-1' },
    });

    const deleteNotFound = await dispatch(router, 'DELETE', '/api/spaces/missing', {
      asanaStorage: {
        async deleteWorkspace() {
          return false;
        },
      },
    });
    assert.strictEqual(deleteNotFound.status, 404);

    const deleteDefault = await dispatch(router, 'DELETE', '/api/spaces/default', {
      asanaStorage: {
        async deleteWorkspace() {
          throw new Error('cannot delete default workspace');
        },
      },
    });
    assert.strictEqual(deleteDefault.status, 403);

    const deleteNonEmpty = await dispatch(router, 'DELETE', '/api/spaces/non-empty', {
      asanaStorage: {
        async deleteWorkspace() {
          throw new Error('workspace is non-empty');
        },
      },
    });
    assert.strictEqual(deleteNonEmpty.status, 409);
    assert.match(deleteNonEmpty.payload.error, /non-empty/);

    const deleteError = await dispatch(router, 'DELETE', '/api/spaces/space-1', {
      asanaStorage: {
        async deleteWorkspace() {
          throw new Error('delete failed');
        },
      },
    });
    assert.strictEqual(deleteError.status, 500);

    let duplicateArgs = null;
    const duplicateSuccess = await dispatch(router, 'POST', '/api/spaces/space-1/duplicate', {
      asanaStorage: {
        async duplicateWorkspace(id, slug) {
          duplicateArgs = { id, slug };
          return { id: 'space-copy', slug };
        },
      },
    }, { slug: 'space-copy' });
    assert.deepStrictEqual(duplicateArgs, { id: 'space-1', slug: 'space-copy' });
    assert.strictEqual(duplicateSuccess.status, 201);
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'duplicate', space: { id: 'space-copy', slug: 'space-copy' } },
    });

    const duplicateNotFound = await dispatch(router, 'POST', '/api/spaces/missing/duplicate', {
      asanaStorage: {
        async duplicateWorkspace() {
          throw new Error('workspace not found');
        },
      },
    }, {});
    assert.strictEqual(duplicateNotFound.status, 404);

    const duplicateInvalidJSON = await dispatch(router, 'POST', '/api/spaces/space-1/duplicate', {
      asanaStorage: {},
    }, '{');
    assert.strictEqual(duplicateInvalidJSON.status, 400);

    const duplicateError = await dispatch(router, 'POST', '/api/spaces/space-1/duplicate', {
      asanaStorage: {
        async duplicateWorkspace() {
          throw new Error('duplicate failed');
        },
      },
    }, {});
    assert.strictEqual(duplicateError.status, 500);

    const setDefaultSuccess = await dispatch(router, 'POST', '/api/spaces/space-1/set-default', {
      asanaStorage: {
        async setDefaultWorkspace(id) {
          assert.strictEqual(id, 'space-1');
          return { id, is_default: true };
        },
      },
    });
    assert.deepStrictEqual(setDefaultSuccess.payload, { id: 'space-1', is_default: true });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'set_default', space: { id: 'space-1', is_default: true } },
    });

    const setDefaultNotFound = await dispatch(router, 'POST', '/api/spaces/missing/set-default', {
      asanaStorage: {
        async setDefaultWorkspace() {
          return null;
        },
      },
    });
    assert.strictEqual(setDefaultNotFound.status, 404);

    const setDefaultError = await dispatch(router, 'POST', '/api/spaces/space-1/set-default', {
      asanaStorage: {
        async setDefaultWorkspace() {
          throw new Error('default failed');
        },
      },
    });
    assert.strictEqual(setDefaultError.status, 500);

    let projectFilters = null;
    const projects = [{ id: 'project-1' }];
    const projectsSuccess = await dispatch(router, 'GET', '/api/spaces/space-1/projects', {
      asanaStorage: {
        async listProjects(filters) {
          projectFilters = filters;
          return projects;
        },
      },
    });
    assert.deepStrictEqual(projectFilters, { workspace_id: 'space-1' });
    assert.deepStrictEqual(projectsSuccess.payload, { projects });

    const projectsError = await dispatch(router, 'GET', '/api/spaces/space-1/projects', {
      asanaStorage: {
        async listProjects() {
          throw new Error('projects failed');
        },
      },
    });
    assert.strictEqual(projectsError.status, 500);

    let assignArgs = null;
    const assignSuccess = await dispatch(router, 'PUT', '/api/spaces/space-1/projects', {
      asanaStorage: {
        async assignProjectsToWorkspace(id, projectIds) {
          assignArgs = { id, projectIds };
          return { assigned: 2 };
        },
      },
    }, { project_ids: ['project-1', 'project-2'] });
    assert.deepStrictEqual(assignArgs, { id: 'space-1', projectIds: ['project-1', 'project-2'] });
    assert.deepStrictEqual(assignSuccess.payload, { assigned: 2 });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'space:changed',
      data: { action: 'projects_updated', spaceId: 'space-1' },
    });

    const assignInvalidBody = await dispatch(router, 'PUT', '/api/spaces/space-1/projects', {
      asanaStorage: {
        async assignProjectsToWorkspace() {
          throw new Error('invalid body should not reach storage');
        },
      },
    }, { project_ids: 'project-1' });
    assert.strictEqual(assignInvalidBody.status, 400);
    assert.match(assignInvalidBody.payload.error, /project_ids array required/);

    const assignInvalidJSON = await dispatch(router, 'PUT', '/api/spaces/space-1/projects', {
      asanaStorage: {},
    }, '{');
    assert.strictEqual(assignInvalidJSON.status, 400);

    const assignError = await dispatch(router, 'PUT', '/api/spaces/space-1/projects', {
      asanaStorage: {
        async assignProjectsToWorkspace() {
          throw new Error('assign failed');
        },
      },
    }, { project_ids: [] });
    assert.strictEqual(assignError.status, 500);

    const stats = { project_count: 2, task_count: 10 };
    const statsSuccess = await dispatch(router, 'GET', '/api/spaces/space-1/stats', {
      asanaStorage: {
        async getWorkspaceStats(id) {
          assert.strictEqual(id, 'space-1');
          return stats;
        },
      },
    });
    assert.deepStrictEqual(statsSuccess.payload, stats);

    const statsError = await dispatch(router, 'GET', '/api/spaces/space-1/stats', {
      asanaStorage: {
        async getWorkspaceStats() {
          throw new Error('stats failed');
        },
      },
    });
    assert.strictEqual(statsError.status, 500);
  } finally {
    console.error = originalConsoleError;
    loaded.restore();
  }
}

run()
  .then(() => {
    console.log('test-space-routes: ok');
  })
  .catch((err) => {
    console.error('test-space-routes: failed');
    console.error(err);
    process.exit(1);
  });
