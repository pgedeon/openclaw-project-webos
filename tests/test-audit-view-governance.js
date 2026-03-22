#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const auditViewPath = path.resolve(__dirname, '../src/audit-view.mjs');
  const taskServerPath = path.resolve(__dirname, '../task-server.js');

  const auditView = fs.readFileSync(auditViewPath, 'utf8');
  const taskServer = fs.readFileSync(taskServerPath, 'utf8');

  assert.ok(
    auditView.includes('entity_type') && auditView.includes('governance_only'),
    'audit view should track entity and governance filters'
  );
  assert.ok(
    auditView.includes('Operator actions only') && auditView.includes('All entities'),
    'audit view should expose governance and entity controls'
  );
  assert.ok(
    auditView.includes('record.entity_type') || auditView.includes("entity_type === 'workflow'"),
    'audit table should render entity metadata'
  );
  assert.ok(
    taskServer.includes("filters.entity_type = query.get('entity_type')") &&
      taskServer.includes("query.get('governance_only') === 'true'"),
    'task server should pass governance audit filters through the API'
  );

  console.log('PASS: audit view governance wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: audit view governance wiring');
  console.error(error);
  process.exit(1);
}
