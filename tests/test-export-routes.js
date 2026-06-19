#!/usr/bin/env node
/**
 * Focused tests for routes/export-routes.js.
 * Run: node tests/test-export-routes.js
 *
 * Source fixes covered here:
 * - Import preview/import JSON parse errors now reject the body promise instead
 *   of escaping the route handler from inside the request end event.
 * - POST /api/import now validates JSON and bundle version before acquiring a
 *   database client, and wraps pool.connect() failures in a JSON 500 response.
 *   Invalid import requests should not consume a DB connection, and missing
 *   dependency failures should stay handled by the route.
 */

const assert = require('assert');
const EventEmitter = require('events');
const Router = require('../routes/router');
const { registerExportRoutes } = require('../routes/export-routes');

function createResponseCapture() {
  return { result: null, writes: [] };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function createRequest(url, method = 'GET', body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3876' };

  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

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
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  assert.ok(res.result, `${method} ${url} should send a JSON response`);
  return res.result;
}

function sqlIncludes(query, text) {
  return String(query).replace(/\s+/g, ' ').includes(text);
}

function createExportPool(overrides = {}) {
  const calls = [];
  const rowsByTable = {
    projects: [{ id: 'project-1', name: 'Core Platform' }],
    tasks: [{ id: 'task-1', title: 'Export routes' }],
    workflows: [{ id: 'workflow-1', name: 'Default' }],
    audit_log: [{ id: 'audit-1', action: 'created' }],
    ...overrides.rowsByTable,
  };

  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (overrides.failQuery) throw new Error('export query failed');
      if (sqlIncludes(sql, 'FROM projects')) return { rows: rowsByTable.projects };
      if (sqlIncludes(sql, 'FROM tasks')) return { rows: rowsByTable.tasks };
      if (sqlIncludes(sql, 'FROM workflows')) return { rows: rowsByTable.workflows };
      if (sqlIncludes(sql, 'FROM audit_log')) return { rows: rowsByTable.audit_log };
      return { rows: [] };
    },
  };
}

function createImportPool(options = {}) {
  const clientQueries = [];
  const poolQueries = [];
  let connectCount = 0;
  let released = false;

  const existingWorkflows = new Set(options.existingWorkflows || []);
  const existingProjects = new Set(options.existingProjects || []);

  const client = {
    async query(sql, params = []) {
      clientQueries.push({ sql, params });
      if (options.failClientQuery?.(sql, params, clientQueries.length)) {
        throw new Error('transaction write failed');
      }
      if (sqlIncludes(sql, 'SELECT id FROM workflows')) {
        return { rows: existingWorkflows.has(params[0]) ? [{ id: params[0] }] : [] };
      }
      if (sqlIncludes(sql, 'SELECT id FROM projects')) {
        return { rows: existingProjects.has(params[0]) ? [{ id: params[0] }] : [] };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };

  const pool = {
    async connect() {
      connectCount++;
      if (options.failConnect) throw new Error('pool unavailable');
      return client;
    },
    async query(sql, params = []) {
      poolQueries.push({ sql, params });
      if (options.failPostCommitAudit) throw new Error('audit write failed');
      return { rows: [] };
    },
  };

  return {
    pool,
    client,
    clientQueries,
    poolQueries,
    get connectCount() {
      return connectCount;
    },
    get released() {
      return released;
    },
  };
}

async function run() {
  const router = new Router();
  registerExportRoutes(router, null, null);

  const expectedRoutes = [
    ['GET', '/api/export'],
    ['POST', '/api/import/preview'],
    ['POST', '/api/import'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  const exportPool = createExportPool();
  const settingsStore = {
    getAll() {
      return { theme: 'dark', density: 'compact' };
    },
  };
  const exportRouter = new Router();
  registerExportRoutes(exportRouter, { pool: exportPool }, settingsStore);

  const exportSuccess = await dispatch(exportRouter, 'GET', '/api/export', createContext());
  assert.strictEqual(exportSuccess.status, 200);
  assert.strictEqual(exportSuccess.payload.version, 1);
  assert.match(exportSuccess.payload.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepStrictEqual(exportSuccess.payload.projects, [{ id: 'project-1', name: 'Core Platform' }]);
  assert.deepStrictEqual(exportSuccess.payload.tasks, [{ id: 'task-1', title: 'Export routes' }]);
  assert.deepStrictEqual(exportSuccess.payload.workflows, [{ id: 'workflow-1', name: 'Default' }]);
  assert.deepStrictEqual(exportSuccess.payload.auditLog, [{ id: 'audit-1', action: 'created' }]);
  assert.deepStrictEqual(exportSuccess.payload.settings, { theme: 'dark', density: 'compact' });
  assert.deepStrictEqual(exportPool.calls, [
    'SELECT * FROM projects ORDER BY created_at',
    'SELECT * FROM tasks ORDER BY created_at',
    'SELECT * FROM workflows ORDER BY created_at',
    'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 500',
  ]);

  const directPool = createExportPool({
    rowsByTable: {
      projects: [],
      tasks: [],
      workflows: [],
      audit_log: [],
    },
  });
  const throwingSettingsRouter = new Router();
  registerExportRoutes(throwingSettingsRouter, directPool, {
    getAll() {
      throw new Error('settings unavailable');
    },
  });
  const exportWithoutSettings = await dispatch(throwingSettingsRouter, 'GET', '/api/export', createContext());
  assert.strictEqual(exportWithoutSettings.status, 200);
  assert.deepStrictEqual(exportWithoutSettings.payload.settings, {});

  const missingExportDb = await dispatch(router, 'GET', '/api/export', createContext());
  assert.strictEqual(missingExportDb.status, 503);
  assert.match(missingExportDb.payload.error, /Database not available/);

  const failingExportRouter = new Router();
  registerExportRoutes(failingExportRouter, createExportPool({ failQuery: true }), null);
  const exportFailure = await dispatch(failingExportRouter, 'GET', '/api/export', createContext());
  assert.strictEqual(exportFailure.status, 500);
  assert.match(exportFailure.payload.error, /export query failed/);

  const previewSuccess = await dispatch(
    router,
    'POST',
    '/api/import/preview',
    createContext(),
    {
      version: 1,
      projects: [{ name: 'Core Platform' }, { name: 'Agent Workflows' }],
      tasks: [{ id: 'task-1' }],
      workflows: [{ id: 'workflow-1' }],
      auditLog: [{ id: 'audit-1' }, { id: 'audit-2' }],
      settings: { theme: 'dark' },
    }
  );
  assert.deepStrictEqual(previewSuccess, {
    status: 200,
    payload: {
      version: 1,
      projects: 2,
      tasks: 1,
      workflows: 1,
      auditLog: 2,
      hasSettings: true,
      projectNames: ['Core Platform', 'Agent Workflows'],
    },
  });

  const previewEmpty = await dispatch(router, 'POST', '/api/import/preview', createContext(), { version: 1 });
  assert.deepStrictEqual(previewEmpty, {
    status: 200,
    payload: {
      version: 1,
      projects: 0,
      tasks: 0,
      workflows: 0,
      auditLog: 0,
      hasSettings: false,
      projectNames: [],
    },
  });

  const previewInvalidJson = await dispatch(router, 'POST', '/api/import/preview', createContext(), '{bad json');
  assert.strictEqual(previewInvalidJson.status, 400);
  assert.match(previewInvalidJson.payload.error, /Invalid JSON body/);

  const previewMissingVersion = await dispatch(router, 'POST', '/api/import/preview', createContext(), { projects: [] });
  assert.strictEqual(previewMissingVersion.status, 400);
  assert.match(previewMissingVersion.payload.error, /Missing bundle version/);

  const importMissingDb = await dispatch(router, 'POST', '/api/import', createContext(), { version: 1 });
  assert.strictEqual(importMissingDb.status, 503);
  assert.match(importMissingDb.payload.error, /Database not available/);

  const invalidImportPool = createImportPool();
  const invalidImportRouter = new Router();
  registerExportRoutes(invalidImportRouter, invalidImportPool.pool, null);
  const importInvalidJson = await dispatch(invalidImportRouter, 'POST', '/api/import', createContext(), '{bad json');
  assert.strictEqual(importInvalidJson.status, 400);
  assert.match(importInvalidJson.payload.error, /Invalid JSON body/);
  assert.strictEqual(invalidImportPool.connectCount, 0, 'invalid JSON should not acquire a database client');

  const missingVersionPool = createImportPool();
  const missingVersionRouter = new Router();
  registerExportRoutes(missingVersionRouter, missingVersionPool.pool, null);
  const importMissingVersion = await dispatch(missingVersionRouter, 'POST', '/api/import', createContext(), { tasks: [] });
  assert.strictEqual(importMissingVersion.status, 400);
  assert.match(importMissingVersion.payload.error, /Missing bundle version/);
  assert.strictEqual(missingVersionPool.connectCount, 0, 'missing version should not acquire a database client');

  const connectFailurePool = createImportPool({ failConnect: true });
  const connectFailureRouter = new Router();
  registerExportRoutes(connectFailureRouter, connectFailurePool.pool, null);
  const importConnectFailure = await dispatch(connectFailureRouter, 'POST', '/api/import', createContext(), { version: 1 });
  assert.strictEqual(importConnectFailure.status, 500);
  assert.match(importConnectFailure.payload.error, /pool unavailable/);
  assert.strictEqual(connectFailurePool.connectCount, 1);

  const settingsSet = [];
  const mergePool = createImportPool({
    existingWorkflows: ['workflow-existing'],
    existingProjects: ['project-existing'],
  });
  const mergeRouter = new Router();
  registerExportRoutes(mergeRouter, mergePool.pool, {
    async set(key, value) {
      settingsSet.push([key, value]);
    },
  });
  const mergeBody = {
    version: 1,
    workflows: [
      { id: 'workflow-existing', name: 'Existing Workflow' },
      { id: 'workflow-new', name: 'New Workflow', states: ['todo'], project_id: 'project-new' },
    ],
    projects: [
      { id: 'project-existing', name: 'Existing Project' },
      { id: 'project-new', name: 'New Project', metadata: { imported: true } },
    ],
    tasks: [
      { id: 'task-1', project_id: 'project-new', title: 'Imported task', metadata: { source: 'test' } },
    ],
    auditLog: [
      { id: 'audit-1', task_id: 'task-1', actor: 'agent', action: 'created' },
    ],
    settings: { theme: 'dark' },
  };
  const importMerge = await dispatch(mergeRouter, 'POST', '/api/import', createContext(), mergeBody);
  assert.deepStrictEqual(importMerge, {
    status: 200,
    payload: {
      imported: { projects: 1, tasks: 1, workflows: 1, auditLog: 1 },
      mode: 'merge',
    },
  });
  assert.strictEqual(mergePool.connectCount, 1);
  assert.strictEqual(mergePool.released, true);
  assert.ok(mergePool.clientQueries.some((call) => call.sql === 'BEGIN'));
  assert.ok(mergePool.clientQueries.some((call) => call.sql === 'COMMIT'));
  assert.ok(!mergePool.clientQueries.some((call) => call.sql === 'ROLLBACK'));
  assert.strictEqual(
    mergePool.clientQueries.filter((call) => sqlIncludes(call.sql, 'INSERT INTO workflows')).length,
    1
  );
  assert.strictEqual(
    mergePool.clientQueries.filter((call) => sqlIncludes(call.sql, 'INSERT INTO projects')).length,
    1
  );
  assert.strictEqual(
    mergePool.clientQueries.filter((call) => sqlIncludes(call.sql, 'INSERT INTO tasks')).length,
    1
  );
  assert.strictEqual(
    mergePool.clientQueries.filter((call) => sqlIncludes(call.sql, 'INSERT INTO audit_log')).length,
    1
  );
  assert.deepStrictEqual(settingsSet, [['theme', 'dark']]);
  assert.strictEqual(mergePool.poolQueries.length, 2, 'successful imports should record audit and snapshot entries');
  assert.ok(sqlIncludes(mergePool.poolQueries[0].sql, 'INSERT INTO audit_log'));
  assert.ok(sqlIncludes(mergePool.poolQueries[1].sql, 'INSERT INTO state_snapshots'));
  assert.deepStrictEqual(JSON.parse(mergePool.poolQueries[0].params[3]), {
    mode: 'merge',
    counts: { projects: 1, tasks: 1, workflows: 1, auditLog: 1 },
  });

  const replacePool = createImportPool({ existingProjects: ['project-existing'] });
  const replaceRouter = new Router();
  registerExportRoutes(replaceRouter, replacePool.pool, null);
  const importReplace = await dispatch(
    replaceRouter,
    'POST',
    '/api/import',
    createContext(),
    {
      version: 1,
      mode: 'replace',
      projects: [{ id: 'project-existing', name: 'Replacement Project' }],
    }
  );
  assert.deepStrictEqual(importReplace, {
    status: 200,
    payload: {
      imported: { projects: 1, tasks: 0, workflows: 0, auditLog: 0 },
      mode: 'replace',
    },
  });
  assert.deepStrictEqual(
    replacePool.clientQueries.slice(1, 5).map((call) => call.sql),
    [
      'DELETE FROM audit_log',
      'DELETE FROM tasks',
      'DELETE FROM workflows WHERE is_default = false',
      'DELETE FROM projects',
    ]
  );

  const swallowedAuditPool = createImportPool({ failPostCommitAudit: true });
  const swallowedAuditRouter = new Router();
  registerExportRoutes(swallowedAuditRouter, swallowedAuditPool.pool, null);
  const importWithAuditFailure = await dispatch(swallowedAuditRouter, 'POST', '/api/import', createContext(), { version: 1 });
  assert.strictEqual(importWithAuditFailure.status, 200);
  assert.deepStrictEqual(importWithAuditFailure.payload.imported, { projects: 0, tasks: 0, workflows: 0, auditLog: 0 });
  assert.ok(swallowedAuditPool.clientQueries.some((call) => call.sql === 'COMMIT'));
  assert.ok(!swallowedAuditPool.clientQueries.some((call) => call.sql === 'ROLLBACK'));

  const failingTransactionPool = createImportPool({
    failClientQuery(sql) {
      return sqlIncludes(sql, 'INSERT INTO tasks');
    },
  });
  const failingTransactionRouter = new Router();
  registerExportRoutes(failingTransactionRouter, failingTransactionPool.pool, null);
  const importTransactionFailure = await dispatch(
    failingTransactionRouter,
    'POST',
    '/api/import',
    createContext(),
    {
      version: 1,
      tasks: [{ id: 'task-fail', project_id: 'project-1', title: 'Fails' }],
    }
  );
  assert.strictEqual(importTransactionFailure.status, 500);
  assert.match(importTransactionFailure.payload.error, /transaction write failed/);
  assert.ok(failingTransactionPool.clientQueries.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!failingTransactionPool.clientQueries.some((call) => call.sql === 'COMMIT'));
  assert.strictEqual(failingTransactionPool.released, true);
  assert.strictEqual(failingTransactionPool.poolQueries.length, 0);
}

run()
  .then(() => {
    console.log('test-export-routes: all tests passed');
  })
  .catch((err) => {
    console.error('test-export-routes failed:', err);
    process.exit(1);
  });
