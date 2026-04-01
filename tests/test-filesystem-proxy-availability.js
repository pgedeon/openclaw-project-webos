#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const serverPath = path.resolve(__dirname, '../task-server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const routeIndex = source.indexOf("if (url.startsWith('/api/fs/') && !url.includes('..'))");

  assert.ok(routeIndex >= 0, 'task-server should handle /api/fs/* requests');
  assert.ok(
    source.includes('function loadFilesystemApiModule() {'),
    'task-server should lazy-load the shared filesystem module'
  );
  assert.ok(
    source.includes('async function handleFilesystemApiInProcess(url, method, body) {'),
    'task-server should expose an in-process filesystem request helper'
  );
  assert.ok(
    source.includes("!url.startsWith('/api/fs/')"),
    'workflow request parsing should skip filesystem API routes'
  );
  assert.ok(
    source.includes('return module.handleFilesystemApiRequest({'),
    'task-server should delegate filesystem requests to the shared handler module'
  );

  const routeBlock = source.slice(routeIndex, routeIndex + 1600);
  assert.ok(
    routeBlock.includes('let requestBody = requestBodyCache.get(req);'),
    'filesystem route should reuse cached parsed request bodies when available'
  );
  assert.ok(
    routeBlock.includes('requestBody = await parseJSONBody(req);'),
    'filesystem route should parse mutation request bodies once'
  );
  assert.ok(
    routeBlock.includes('const result = await handleFilesystemApiInProcess(req.url, method, requestBody || {});'),
    'filesystem route should call the in-process handler with parsed JSON bodies'
  );
  assert.ok(
    routeBlock.includes("sendJSON(res, result.status, result.payload);"),
    'filesystem route should send the shared handler response back through task-server JSON responses'
  );
  assert.ok(
    routeBlock.includes('sendJSON(res, statusCode, { error: error.message });'),
    'filesystem route should surface shared handler errors through normal JSON responses'
  );

  console.log('PASS: filesystem route uses in-process handler');
}

try {
  run();
} catch (error) {
  console.error('FAIL: filesystem route uses in-process handler');
  console.error(error);
  process.exit(1);
}
