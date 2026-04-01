#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const serverPath = path.resolve(__dirname, '../task-server.js');
  const integrationPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');

  const server = fs.readFileSync(serverPath, 'utf8');
  const integration = fs.readFileSync(integrationPath, 'utf8');

  assert.ok(
    server.includes("if (url === '/skills-tools' || url === '/skills-tools/')"),
    'task server should expose a dedicated /skills-tools route'
  );
  assert.ok(
    server.includes("sendFile(res, 'dashboard/skills-tools.html');"),
    'task server should serve the dedicated skills-tools HTML document'
  );
  assert.ok(
    server.includes("headers['Cache-Control'] = 'no-store, max-age=0';"),
    'task server should disable stale caching for HTML and JS assets'
  );
  assert.ok(
    integration.includes('function getRequestedDashboardView() {'),
    'dashboard integration should define a startup view resolver'
  );
  assert.ok(
    integration.includes("const pathnameView = requestUrl.pathname === '/skills-tools' ? 'skills-tools' : null;"),
    'dashboard integration should map /skills-tools to the skills-tools view'
  );
  assert.ok(
    integration.includes("const queryView = requestUrl.searchParams.get('view');"),
    'dashboard integration should support query-based deep links for views'
  );
  assert.ok(
    integration.includes('await renderViewSwitch(initialView, newState);'),
    'dashboard initialization should render the requested startup view'
  );

  console.log('PASS: skills-tools entrypoint wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: skills-tools entrypoint wiring');
  console.error(error);
  process.exit(1);
}
