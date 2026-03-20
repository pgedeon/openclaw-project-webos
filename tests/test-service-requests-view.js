#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/service-requests-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="service-requests"'),
    'dashboard toolbar should expose the service requests view button'
  );
  assert.ok(
    js.includes("'service-requests': { render: renderServiceRequestsView }"),
    'dashboard integration should register the service-requests view in the view registry'
  );
  assert.ok(
    js.includes("import { renderServiceRequestsView as renderServiceRequestsViewModule } from './views/service-requests-view.mjs';"),
    'dashboard integration should import the extracted service-requests module'
  );
  assert.ok(
    js.includes('async function renderServiceRequestsView(state)'),
    'dashboard integration should define the service requests renderer wrapper'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/services'"),
    'service requests renderer should load service catalog data'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/workflow-templates'"),
    'service requests renderer should load workflow template metadata'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/service-requests?limit=200"),
    'service requests renderer should load service requests data'
  );
  assert.ok(
    moduleSource.includes('id="serviceRequestDetail"'),
    'service requests renderer should expose a request detail panel'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/service-requests/${requestId}/launch`"),
    'service requests renderer should support launching a request'
  );

  console.log('PASS: service requests view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: service requests view wiring');
  console.error(error);
  process.exit(1);
}
