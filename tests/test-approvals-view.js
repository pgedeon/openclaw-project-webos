#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/approvals-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="approvals"'),
    'dashboard toolbar should expose the approvals view button'
  );
  assert.ok(
    js.includes("approvals: { render: renderApprovalsView }"),
    'dashboard integration should register the approvals view in the view registry'
  );
  assert.ok(
    js.includes("import { renderApprovalsView as renderApprovalsViewModule } from './views/approvals-view.mjs';"),
    'dashboard integration should import the extracted approvals module'
  );
  assert.ok(
    js.includes('async function renderApprovalsView(state)'),
    'dashboard integration should define the approvals renderer wrapper'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/approvals/pending'"),
    'approvals renderer should load pending approvals data'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/approvals/${approvalId}`"),
    'approvals renderer should support updating an approval'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/approvals/${approvalId}/escalate`"),
    'approvals renderer should support escalating an approval'
  );
  assert.ok(
    moduleSource.includes('id="approvalsList"'),
    'approvals renderer should expose an approvals list container'
  );

  console.log('PASS: approvals view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: approvals view wiring');
  console.error(error);
  process.exit(1);
}
