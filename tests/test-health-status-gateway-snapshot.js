#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const serverPath = path.resolve(__dirname, '../task-server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const healthStatusIndex = source.indexOf("if (url === '/api/health-status' && method === 'GET')");

  assert.ok(healthStatusIndex >= 0, 'task-server should expose /api/health-status');

  const healthStatusBlock = source.slice(healthStatusIndex, healthStatusIndex + 2200);

  assert.ok(
    source.includes("const GATEWAY_STATUS_FILE = path.join(DASHBOARD_ROOT, 'gateway-status.json');"),
    'health status should read the cached gateway snapshot file'
  );
  assert.ok(
    source.includes('function readGatewayStatusSnapshot()'),
    'task-server should define a helper for cached gateway status'
  );
  assert.ok(
    !healthStatusBlock.includes('openclaw gateway status'),
    '/api/health-status should not shell out to openclaw gateway status'
  );
  assert.ok(
    healthStatusBlock.includes('gateway_sync'),
    '/api/health-status should expose a gateway_sync check for the dashboard UI'
  );

  console.log('PASS: health-status gateway snapshot');
}

try {
  run();
} catch (error) {
  console.error('FAIL: health-status gateway snapshot');
  console.error(error);
  process.exit(1);
}
