#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../operations.html');
  const modulePath = path.resolve(__dirname, '../src/operations-page.mjs');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('<a href="/skills-tools">Skills &amp; Tools</a>') &&
      html.includes('<a href="/workflows">Workflows</a>'),
    'operations page should keep cross-links to the other dashboard surfaces'
  );
  assert.ok(
    moduleSource.includes("api('/api/health-status')") &&
      moduleSource.includes("api('/api/cron/jobs')") &&
      moduleSource.includes("api('/api/org/agents')") &&
      moduleSource.includes("api('/api/service-requests?limit=25')") &&
      moduleSource.includes("api('/api/metrics/org')"),
    'operations page should load all of its cards from the live dashboard APIs'
  );
  assert.ok(
    moduleSource.includes('request?.requestedBy || request?.requested_by || request?.requester'),
    'operations page should normalize service-request requester fields from the API payload'
  );
  assert.ok(
    moduleSource.includes('agent.lastSeenAt || agent.lastHeartbeat'),
    'operations page should normalize agent heartbeat timestamps from the org API'
  );
  assert.ok(
    moduleSource.includes('class="ops-table"'),
    'operations page should render service requests using the table shell defined in the HTML page styles'
  );

  console.log('PASS: operations page API wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: operations page API wiring');
  console.error(error);
  process.exit(1);
}
