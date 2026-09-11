#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const serverPath = path.resolve(__dirname, '../task-server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  // Health endpoints moved from task-server.js into the router (routes/health-routes.js).
  const healthRoutesPath = path.resolve(__dirname, '../routes/health-routes.js');
  const healthRoutes = fs.readFileSync(healthRoutesPath, 'utf8');

  assert.ok(
    source.includes("const ASANA_JSON_SNAPSHOT_PATH = process.env.ASANA_JSON_SNAPSHOT_PATH || path.join(WORKSPACE, 'data/asana-db.json');"),
    'task-server should declare the JSON snapshot storage path'
  );
  assert.ok(
    source.includes("require('./storage/asana-json-snapshot')"),
    'task-server should load the JSON snapshot storage adapter'
  );
  assert.ok(
    source.includes('Falling back to read-only JSON snapshot storage'),
    'task-server should fall back to JSON snapshot storage when PostgreSQL init fails'
  );
  assert.ok(
    source.includes('function getAsanaStorageHealth()'),
    'task-server should compute storage health state for health endpoints'
  );
  assert.ok(
    healthRoutes.includes('storage_mode: storageHealth.mode'),
    '/api/health should expose the active storage mode'
  );
  assert.ok(
    healthRoutes.includes('mode: storageHealth.mode'),
    '/api/health-status should expose the active storage mode'
  );

  console.log('PASS: task-server storage fallback');
}

try {
  run();
} catch (error) {
  console.error('FAIL: task-server storage fallback');
  console.error(error);
  process.exit(1);
}
