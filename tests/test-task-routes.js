#!/usr/bin/env node
/**
 * Focused tests for routes/task-routes.js.
 * Run: node tests/test-task-routes.js
 *
 * Source fix covered here: POST /api/tasks/:id/subtasks now returns 404 for
 * missing parent/child tasks and 400 for circular/validation failures. The
 * previous ternary mapped "not found" to 400 and unrelated errors to 404.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Router = require('../routes/router');

const sseRoutesPath = require.resolve('../routes/sse-routes');
const taskRoutesPath = require.resolve('../routes/task-routes');

function loadTaskRoutesWithMockBroadcast(broadcasts) {
  const originalSSE = require.cache[sseRoutesPath];
  delete require.cache[taskRoutesPath];

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

  const { registerTaskRoutes } = require('../routes/task-routes');
  return {
    registerTaskRoutes,
    restore() {
      delete require.cache[taskRoutesPath];
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
    normalizeTaskListProjectId: (projectId) => projectId,
    TASKS_FILE: path.join(os.tmpdir(), 'openclaw-test-tasks.md'),
    ...overrides,
  };
}

async function waitForResult(res, label) {
  const started = Date.now();
  while (!res.result && Date.now() - started < 250) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(res.result, `${label} should send a JSON response`);
}

async function dispatch(router, method, url, context) {
  const req = createRequest(url, method);
  const res = createResponseCapture();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, context);
  assert.strictEqual(handled, true, `${method} ${url} should be handled`);
  if (!res.result) await waitForResult(res, `${method} ${url}`);
  return res.result;
}

async function quiet(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function run() {
  const broadcasts = [];
  const loaded = loadTaskRoutesWithMockBroadcast(broadcasts);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-routes-'));

  try {
    const router = new Router();
    loaded.registerTaskRoutes(router);

    const expectedRoutes = [
      ['GET', '/api/tasks'],
      ['POST', '/api/tasks'],
      ['GET', '/api/tasks/all'],
      ['GET', '/api/tasks/:id'],
      ['PATCH', '/api/tasks/:id'],
      ['DELETE', '/api/tasks/:id'],
      ['POST', '/api/tasks/:id/archive'],
      ['POST', '/api/tasks/:id/restore'],
      ['POST', '/api/tasks/:id/move'],
      ['POST', '/api/tasks/:id/dependencies'],
      ['POST', '/api/tasks/:id/subtasks'],
      ['GET', '/api/tasks/:id/history'],
      ['POST', '/api/tasks/:id/retry'],
    ];

    for (const [method, routePath] of expectedRoutes) {
      assert.ok(
        router.list().some((route) => route.method === method && route.path === routePath),
        `${method} ${routePath} should be registered`
      );
    }

    const routeList = router.list();
    const allIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === '/api/tasks/all');
    const idIndex = routeList.findIndex((route) => route.method === 'GET' && route.path === '/api/tasks/:id');
    assert.ok(allIndex > -1 && idIndex > -1 && allIndex < idIndex, '/api/tasks/all should be registered before /api/tasks/:id');

    const missingStorageCases = [
      ['GET', '/api/tasks/all'],
      ['GET', '/api/tasks/task-1'],
      ['PATCH', '/api/tasks/task-1'],
      ['DELETE', '/api/tasks/task-1'],
      ['POST', '/api/tasks/task-1/archive'],
      ['POST', '/api/tasks/task-1/restore'],
      ['POST', '/api/tasks/task-1/move'],
      ['POST', '/api/tasks/task-1/dependencies'],
      ['POST', '/api/tasks/task-1/subtasks'],
      ['GET', '/api/tasks/task-1/history'],
      ['POST', '/api/tasks/task-1/retry'],
    ];
    for (const [method, url] of missingStorageCases) {
      const result = await dispatch(router, method, url, createContext());
      assert.strictEqual(result.status, 503, `${method} ${url} should require asanaStorage`);
      assert.match(result.payload.error, /not initialized/);
    }

    const tasksFile = path.join(tmpDir, 'tasks.md');
    fs.writeFileSync(tasksFile, '- [ ] legacy task\n', 'utf8');
    const legacyRead = await dispatch(router, 'GET', '/api/tasks', createContext({ TASKS_FILE: tasksFile }));
    assert.deepStrictEqual(legacyRead, {
      status: 200,
      payload: { content: '- [ ] legacy task\n', path: tasksFile, format: 'markdown' },
    });

    const legacyReadMissing = await dispatch(router, 'GET', '/api/tasks', createContext({
      TASKS_FILE: path.join(tmpDir, 'missing.md'),
    }));
    assert.strictEqual(legacyReadMissing.status, 500);
    assert.match(legacyReadMissing.payload.error, /Failed to read/);

    const legacyWriteMissingContent = await dispatch(router, 'POST', '/api/tasks', createContext({
      TASKS_FILE: tasksFile,
      parseJSONBody: async () => ({}),
    }));
    assert.strictEqual(legacyWriteMissingContent.status, 400);
    assert.match(legacyWriteMissingContent.payload.error, /Missing content/);

    const legacyWrite = await dispatch(router, 'POST', '/api/tasks', createContext({
      TASKS_FILE: tasksFile,
      parseJSONBody: async () => ({ content: '- [x] rewritten\n' }),
    }));
    assert.deepStrictEqual(legacyWrite, { status: 200, payload: { success: true, path: tasksFile } });
    assert.strictEqual(fs.readFileSync(tasksFile, 'utf8'), '- [x] rewritten\n');

    const legacyWriteParseError = await dispatch(router, 'POST', '/api/tasks', createContext({
      parseJSONBody: async () => {
        throw new Error('invalid json');
      },
    }));
    assert.strictEqual(legacyWriteParseError.status, 400);
    assert.match(legacyWriteParseError.payload.error, /invalid json/);

    let createdTaskInput = null;
    const poolQueries = [];
    const createdTask = { id: 'task-created', title: 'Created Task' };
    const createSuccess = await quiet(() => dispatch(router, 'POST', '/api/tasks', createContext({
      parseJSONBody: async () => ({ project_id: 'project-1', title: 'Created Task', priority: 'high' }),
      asanaStorage: {
        pool: {
          async query(sql, args) {
            poolQueries.push({ sql, args });
            if (sql.startsWith('SELECT row_to_json')) {
              return { rows: [{ state: { id: 'task-created', title: 'Created Task' } }] };
            }
            return { rows: [] };
          },
        },
        async createTask(data) {
          createdTaskInput = data;
          return createdTask;
        },
      },
    })));
    assert.deepStrictEqual(createdTaskInput, { project_id: 'project-1', title: 'Created Task', priority: 'high' });
    assert.deepStrictEqual(createSuccess, { status: 201, payload: createdTask });
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'create', task: createdTask } });
    assert.strictEqual(poolQueries.length, 2, 'create should snapshot the created task');
    assert.match(poolQueries[1].sql, /INSERT INTO state_snapshots/);
    assert.deepStrictEqual(poolQueries[1].args, [
      'task-created',
      'create',
      JSON.stringify({ id: 'task-created', title: 'Created Task' }),
      'dashboard',
    ]);

    const createMissingProject = await quiet(() => dispatch(router, 'POST', '/api/tasks', createContext({
      parseJSONBody: async () => ({ title: 'No Project' }),
      asanaStorage: {},
    })));
    assert.strictEqual(createMissingProject.status, 400);
    assert.match(createMissingProject.payload.error, /project_id/);

    const createMissingTitle = await quiet(() => dispatch(router, 'POST', '/api/tasks', createContext({
      parseJSONBody: async () => ({ project_id: 'project-1' }),
      asanaStorage: {},
    })));
    assert.strictEqual(createMissingTitle.status, 400);
    assert.match(createMissingTitle.payload.error, /title/);

    const createStorageError = await quiet(() => dispatch(router, 'POST', '/api/tasks', createContext({
      parseJSONBody: async () => ({ project_id: 'project-1', title: 'Bad Task' }),
      asanaStorage: {
        async createTask() {
          throw new Error('create failed');
        },
      },
    })));
    assert.strictEqual(createStorageError.status, 400);
    assert.match(createStorageError.payload.error, /create failed/);

    let normalizedProject = null;
    let listTasksArgs = null;
    const listByProject = await dispatch(
      router,
      'GET',
      '/api/tasks/all?project_id=raw-project&include_archived=true&include_deleted=true&include_child_projects=true&depth=3&updated_since=2026-03-01T00:00:00Z&workspace_id=space-1',
      createContext({
        normalizeTaskListProjectId(projectId) {
          normalizedProject = projectId;
          return 'project-1';
        },
        asanaStorage: {
          async listTasks(projectId, options) {
            listTasksArgs = { projectId, options };
            return [{ id: 'task-1' }];
          },
        },
      })
    );
    assert.strictEqual(normalizedProject, 'raw-project');
    assert.deepStrictEqual(listTasksArgs, {
      projectId: 'project-1',
      options: {
        depth: 3,
        include_archived: true,
        include_deleted: true,
        include_child_projects: true,
        updated_since: '2026-03-01T00:00:00Z',
        workspace_id: 'space-1',
      },
    });
    assert.deepStrictEqual(listByProject, { status: 200, payload: [{ id: 'task-1' }] });

    let listAllOptions = null;
    const listAll = await dispatch(router, 'GET', '/api/tasks/all?include_archived=false&include_deleted=true', createContext({
      asanaStorage: {
        async listAllTasks(options) {
          listAllOptions = options;
          return [{ id: 'task-2' }];
        },
      },
    }));
    assert.deepStrictEqual(listAllOptions, {
      include_archived: false,
      include_deleted: true,
      updated_since: undefined,
      workspace_id: undefined,
    });
    assert.deepStrictEqual(listAll, { status: 200, payload: [{ id: 'task-2' }] });

    let getTaskArgs = null;
    const getSuccess = await dispatch(router, 'GET', '/api/tasks/task-1?includeGraph=true&include_archived=true&include_deleted=true', createContext({
      asanaStorage: {
        async getTask(id, options) {
          getTaskArgs = { id, options };
          return { id, title: 'Task One' };
        },
      },
    }));
    assert.deepStrictEqual(getTaskArgs, {
      id: 'task-1',
      options: { includeGraph: true, include_archived: true, include_deleted: true },
    });
    assert.deepStrictEqual(getSuccess, { status: 200, payload: { id: 'task-1', title: 'Task One' } });

    const getNotFound = await dispatch(router, 'GET', '/api/tasks/missing', createContext({
      asanaStorage: {
        async getTask() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(getNotFound.status, 404);

    const getBadRequest = await dispatch(router, 'GET', '/api/tasks/bad', createContext({
      asanaStorage: {
        async getTask() {
          throw new Error('invalid includeGraph');
        },
      },
    }));
    assert.strictEqual(getBadRequest.status, 400);

    let updateArgs = null;
    const updatedTask = { id: 'task-1', title: 'Updated' };
    const patchSuccess = await quiet(() => dispatch(router, 'PATCH', '/api/tasks/task-1', createContext({
      parseJSONBody: async () => ({ title: 'Updated' }),
      asanaStorage: {
        async updateTask(id, data) {
          updateArgs = { id, data };
          return updatedTask;
        },
      },
    })));
    assert.deepStrictEqual(updateArgs, { id: 'task-1', data: { title: 'Updated' } });
    assert.deepStrictEqual(patchSuccess, { status: 200, payload: updatedTask });
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'update', task: updatedTask } });

    const patchNotFound = await quiet(() => dispatch(router, 'PATCH', '/api/tasks/missing', createContext({
      parseJSONBody: async () => ({ title: 'Updated' }),
      asanaStorage: {
        async updateTask() {
          throw new Error('task not found');
        },
      },
    })));
    assert.strictEqual(patchNotFound.status, 404);

    const patchParseError = await quiet(() => dispatch(router, 'PATCH', '/api/tasks/task-1', createContext({
      parseJSONBody: async () => {
        throw new Error('bad patch json');
      },
      asanaStorage: {},
    })));
    assert.strictEqual(patchParseError.status, 400);
    assert.match(patchParseError.payload.error, /bad patch json/);

    let deletedTaskId = null;
    const deleteSuccess = await dispatch(router, 'DELETE', '/api/tasks/task-1', createContext({
      asanaStorage: {
        async deleteTask(id) {
          deletedTaskId = id;
          return { deleted: true, id };
        },
      },
    }));
    assert.strictEqual(deletedTaskId, 'task-1');
    assert.deepStrictEqual(deleteSuccess, { status: 200, payload: { deleted: true, id: 'task-1' } });
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'delete', taskId: 'task-1' } });

    const deleteNotFound = await dispatch(router, 'DELETE', '/api/tasks/missing', createContext({
      asanaStorage: {
        async deleteTask() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(deleteNotFound.status, 404);

    let archivedTaskId = null;
    const archiveSuccess = await dispatch(router, 'POST', '/api/tasks/task-1/archive', createContext({
      asanaStorage: {
        async archiveTask(id) {
          archivedTaskId = id;
          return { id, archived_at: '2026-03-12T12:00:00.000Z' };
        },
      },
    }));
    assert.strictEqual(archivedTaskId, 'task-1');
    assert.strictEqual(archiveSuccess.status, 200);
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'archive', taskId: 'task-1' } });

    const archiveNotFound = await dispatch(router, 'POST', '/api/tasks/missing/archive', createContext({
      asanaStorage: {
        async archiveTask() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(archiveNotFound.status, 404);

    let restoredTaskId = null;
    const restoreSuccess = await dispatch(router, 'POST', '/api/tasks/task-1/restore', createContext({
      asanaStorage: {
        async restoreTask(id) {
          restoredTaskId = id;
          return { id, restored: true };
        },
      },
    }));
    assert.strictEqual(restoredTaskId, 'task-1');
    assert.strictEqual(restoreSuccess.status, 200);
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'restore', taskId: 'task-1' } });

    const restoreBadRequest = await dispatch(router, 'POST', '/api/tasks/task-1/restore', createContext({
      asanaStorage: {
        async restoreTask() {
          throw new Error('cannot restore active task');
        },
      },
    }));
    assert.strictEqual(restoreBadRequest.status, 400);

    let moveArgs = null;
    const movedTask = { id: 'task-1', status: 'review' };
    const moveSuccess = await dispatch(router, 'POST', '/api/tasks/task-1/move', createContext({
      parseJSONBody: async () => ({ status: 'review' }),
      asanaStorage: {
        async moveTask(id, status) {
          moveArgs = { id, status };
          return movedTask;
        },
      },
    }));
    assert.deepStrictEqual(moveArgs, { id: 'task-1', status: 'review' });
    assert.deepStrictEqual(moveSuccess, { status: 200, payload: movedTask });
    assert.deepStrictEqual(broadcasts.pop(), { event: 'task:changed', data: { action: 'move', task: movedTask } });

    const moveMissingStatus = await dispatch(router, 'POST', '/api/tasks/task-1/move', createContext({
      parseJSONBody: async () => ({}),
      asanaStorage: {},
    }));
    assert.strictEqual(moveMissingStatus.status, 400);
    assert.match(moveMissingStatus.payload.error, /Missing status/);

    const moveNotFound = await dispatch(router, 'POST', '/api/tasks/missing/move', createContext({
      parseJSONBody: async () => ({ status: 'ready' }),
      asanaStorage: {
        async moveTask() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(moveNotFound.status, 404);

    const dependencyCalls = [];
    const dependencySuccess = await dispatch(router, 'POST', '/api/tasks/task-1/dependencies', createContext({
      parseJSONBody: async () => ({ add: ['dep-existing', 'dep-new'], remove: ['dep-old'] }),
      asanaStorage: {
        async getDependencies(id) {
          dependencyCalls.push(['getDependencies', id]);
          return dependencyCalls.length === 1 ? ['dep-existing'] : ['dep-existing', 'dep-new'];
        },
        async addDependency(id, depId) {
          dependencyCalls.push(['addDependency', id, depId]);
        },
        async removeDependency(id, depId) {
          dependencyCalls.push(['removeDependency', id, depId]);
        },
      },
    }));
    assert.deepStrictEqual(dependencyCalls, [
      ['getDependencies', 'task-1'],
      ['addDependency', 'task-1', 'dep-new'],
      ['removeDependency', 'task-1', 'dep-old'],
      ['getDependencies', 'task-1'],
    ]);
    assert.deepStrictEqual(dependencySuccess, { status: 200, payload: { dependencies: ['dep-existing', 'dep-new'] } });

    const dependencyNotFound = await dispatch(router, 'POST', '/api/tasks/missing/dependencies', createContext({
      parseJSONBody: async () => ({ add: ['dep-1'] }),
      asanaStorage: {
        async getDependencies() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(dependencyNotFound.status, 404);

    let subtaskArgs = null;
    const subtaskSuccess = await dispatch(router, 'POST', '/api/tasks/parent-1/subtasks', createContext({
      parseJSONBody: async () => ({ task_id: 'child-1' }),
      asanaStorage: {
        async addSubtask(parentId, taskId) {
          subtaskArgs = { parentId, taskId };
          return { id: taskId, parent_task_id: parentId };
        },
      },
    }));
    assert.deepStrictEqual(subtaskArgs, { parentId: 'parent-1', taskId: 'child-1' });
    assert.deepStrictEqual(subtaskSuccess, { status: 200, payload: { id: 'child-1', parent_task_id: 'parent-1' } });

    const subtaskMissingBody = await dispatch(router, 'POST', '/api/tasks/parent-1/subtasks', createContext({
      parseJSONBody: async () => ({}),
      asanaStorage: {},
    }));
    assert.strictEqual(subtaskMissingBody.status, 400);
    assert.match(subtaskMissingBody.payload.error, /task_id/);

    const subtaskCircular = await dispatch(router, 'POST', '/api/tasks/parent-1/subtasks', createContext({
      parseJSONBody: async () => ({ task_id: 'child-1' }),
      asanaStorage: {
        async addSubtask() {
          throw new Error('Circular subtask relationship detected');
        },
      },
    }));
    assert.strictEqual(subtaskCircular.status, 400);

    const subtaskNotFound = await dispatch(router, 'POST', '/api/tasks/missing/subtasks', createContext({
      parseJSONBody: async () => ({ task_id: 'child-1' }),
      asanaStorage: {
        async addSubtask() {
          throw new Error('Parent task not found: missing');
        },
      },
    }));
    assert.strictEqual(subtaskNotFound.status, 404);

    const subtaskGenericError = await dispatch(router, 'POST', '/api/tasks/parent-1/subtasks', createContext({
      parseJSONBody: async () => ({ task_id: 'child-1' }),
      asanaStorage: {
        async addSubtask() {
          throw new Error('subtask write failed');
        },
      },
    }));
    assert.strictEqual(subtaskGenericError.status, 400);

    let historyArgs = null;
    const historySuccess = await dispatch(router, 'GET', '/api/tasks/task-1/history', createContext({
      asanaStorage: {
        async getAuditLog(taskId, limit) {
          historyArgs = { taskId, limit };
          return [{ id: 'audit-1' }];
        },
      },
    }));
    assert.deepStrictEqual(historyArgs, { taskId: 'task-1', limit: 100 });
    assert.deepStrictEqual(historySuccess, {
      status: 200,
      payload: { task_id: 'task-1', history: [{ id: 'audit-1' }] },
    });

    const historyNotFound = await dispatch(router, 'GET', '/api/tasks/missing/history', createContext({
      asanaStorage: {
        async getAuditLog() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(historyNotFound.status, 404);

    const retryCalls = [];
    const retrySuccess = await dispatch(router, 'POST', '/api/tasks/task-1/retry', createContext({
      asanaStorage: {
        async retryTask(taskId) {
          retryCalls.push(['retryTask', taskId]);
          return { retried: true, retry_count: 2 };
        },
        async getTask(taskId) {
          retryCalls.push(['getTask', taskId]);
          return { id: taskId, status: 'ready' };
        },
      },
    }));
    assert.deepStrictEqual(retryCalls, [
      ['retryTask', 'task-1'],
      ['getTask', 'task-1'],
    ]);
    assert.deepStrictEqual(retrySuccess, {
      status: 200,
      payload: { retried: true, retry_count: 2, task: { id: 'task-1', status: 'ready' } },
    });
    assert.deepStrictEqual(broadcasts.pop(), {
      event: 'task:changed',
      data: { action: 'retry', task: { id: 'task-1', status: 'ready' } },
    });

    const retryNotFound = await dispatch(router, 'POST', '/api/tasks/missing/retry', createContext({
      asanaStorage: {
        async retryTask() {
          throw new Error('task not found');
        },
      },
    }));
    assert.strictEqual(retryNotFound.status, 404);

    console.log('PASS: task routes');
  } finally {
    loaded.restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('FAIL: task routes');
  console.error(error);
  process.exit(1);
});
