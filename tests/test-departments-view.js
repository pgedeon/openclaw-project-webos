#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/departments-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="departments"'),
    'dashboard toolbar should expose the departments view button'
  );
  assert.ok(
    js.includes("departments: { render: renderDepartmentOpsView }"),
    'dashboard integration should register the departments view in the view registry'
  );
  assert.ok(
    js.includes("import { renderDepartmentsView as renderDepartmentsViewModule } from './views/departments-view.mjs';"),
    'dashboard integration should import the extracted departments module'
  );
  assert.ok(
    js.includes('async function renderDepartmentOpsView(state)'),
    'dashboard integration should define the department operations renderer wrapper'
  );
  assert.ok(
    moduleSource.includes("fetchImpl('/api/org/departments'"),
    'department operations renderer should load the department catalog'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/org/departments/${encodeURIComponent(selectedDepartmentId)}/operating-view`"),
    'department operations renderer should load a department operating view payload'
  );
  ['Overview', 'Work Queue', 'Approvals', 'Artifacts', 'Reliability'].forEach((heading) => {
    assert.ok(
      moduleSource.includes(heading),
      `department operations renderer should include the "${heading}" section`
    );
  });

  console.log('PASS: departments view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: departments view wiring');
  console.error(error);
  process.exit(1);
}
