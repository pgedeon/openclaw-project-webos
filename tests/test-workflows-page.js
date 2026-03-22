#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../workflows.html');
  const modulePath = path.resolve(__dirname, '../src/workflows-page.mjs');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('id="activeRunsList"') &&
      html.includes('id="stuckRunsList"') &&
      html.includes('id="recentRunsList"') &&
      html.includes('id="installedList"'),
    'workflows page should expose active, stuck, recent, and installed workflow mounts'
  );
  assert.ok(
    moduleSource.includes("api('/api/workflow-runs?limit=100')") &&
      moduleSource.includes("api('/api/workflow-runs/active')") &&
      moduleSource.includes("api('/api/workflow-runs/stuck')") &&
      moduleSource.includes("api('/api/workflow-templates')"),
    'workflows page should load workflow runs and templates from the live workflow APIs'
  );
  assert.ok(
    moduleSource.includes('run.ownerAgentId') &&
      moduleSource.includes('run.owner_agent_id') &&
      moduleSource.includes('run.workflowType') &&
      moduleSource.includes('run.workflow_type'),
    'workflows page should normalize owner and workflow fields from the API payload'
  );
  assert.ok(
    moduleSource.includes('renderStuckRuns(stuckRuns);'),
    'workflows page should render a dedicated stuck runs panel'
  );

  console.log('PASS: workflows page API wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: workflows page API wiring');
  console.error(error);
  process.exit(1);
}
