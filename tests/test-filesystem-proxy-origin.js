#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const serverPath = path.resolve(__dirname, '../task-server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const routeIndex = source.indexOf("if (url.startsWith('/api/fs/') && !url.includes('..'))");

  assert.ok(routeIndex >= 0, 'task-server should handle /api/fs/* requests');

  const routeBlock = source.slice(routeIndex, routeIndex + 1600);

  assert.ok(
    source.includes('function loadFilesystemApiModule() {'),
    'task-server should load the shared filesystem module directly'
  );
  assert.ok(
    source.includes('pathToFileURL(FILESYSTEM_API_SCRIPT).href'),
    'task-server should import the shared filesystem module via file URL'
  );
  assert.ok(
    routeBlock.includes('const result = await handleFilesystemApiInProcess(req.url, method, requestBody || {});'),
    'filesystem route should pass requests directly to the shared filesystem handler'
  );

  console.log('PASS: filesystem route is in-process');
}

try {
  run();
} catch (error) {
  console.error('FAIL: filesystem route is in-process');
  console.error(error);
  process.exit(1);
}
