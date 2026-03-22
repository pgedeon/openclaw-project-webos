#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/artifacts-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="artifacts"'),
    'dashboard toolbar should expose the artifacts view button'
  );
  assert.ok(
    js.includes("artifacts: { render: renderArtifactsView }"),
    'dashboard integration should register the artifacts view in the view registry'
  );
  assert.ok(
    js.includes("import { renderArtifactsView as renderArtifactsViewModule } from './views/artifacts-view.mjs';"),
    'dashboard integration should import the extracted artifacts module'
  );
  assert.ok(
    js.includes('async function renderArtifactsView(state)'),
    'dashboard integration should define the artifacts renderer wrapper'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/artifacts?limit=250'"),
    'artifacts renderer should load artifact data'
  );
  assert.ok(
    moduleSource.includes('id="artifactsList"'),
    'artifacts renderer should expose an artifacts list container'
  );
  assert.ok(
    moduleSource.includes('id="artifactsFilterWorkflow"'),
    'artifacts renderer should expose workflow filter'
  );
  assert.ok(
    moduleSource.includes('id="artifactsFilterType"'),
    'artifacts renderer should expose type filter'
  );

  console.log('PASS: artifacts view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: artifacts view wiring');
  console.error(error);
  process.exit(1);
}
