#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/publish-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="publish"'),
    'dashboard toolbar should expose the publish view button'
  );
  assert.ok(
    js.includes("publish: { render: renderPublishView }"),
    'dashboard integration should register the publish view in the view registry'
  );
  assert.ok(
    js.includes("import { renderPublishView as renderPublishViewModule } from './views/publish-view.mjs';"),
    'dashboard integration should import the extracted publish module'
  );
  assert.ok(
    js.includes('return renderPublishViewModule({'),
    'dashboard integration should delegate publish rendering to the extracted module'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/tasks/all')"),
    'publish renderer should load task data'
  );
  assert.ok(
    moduleSource.includes('fetchImpl(`/api/workflow-runs/${task.active_workflow_run_id}`)'),
    'publish renderer should load workflow run details for active tasks'
  );
  ['Publish Center', 'Artifacts', 'data-publish-details', 'data-publish-verify-run'].forEach((token) => {
    assert.ok(
      moduleSource.includes(token),
      `publish renderer should include ${token}`
    );
  });

  console.log('PASS: publish view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: publish view wiring');
  console.error(error);
  process.exit(1);
}
