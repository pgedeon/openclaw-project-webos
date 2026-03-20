#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildGovernancePolicySummary,
  classifyAuditEntity,
  evaluateGovernanceAction,
  normalizeActorContext
} = require('../governance.js');

function run() {
  const workflowApiPath = path.resolve(__dirname, '../workflow-runs-api.js');
  const workflowApi = fs.readFileSync(workflowApiPath, 'utf8');

  const operator = normalizeActorContext('dashboard-operator');
  const qaAuditor = normalizeActorContext('qa-auditor');
  const publisher = normalizeActorContext('blogger-publisher');

  assert.ok(
    evaluateGovernanceAction('cancel_run', operator).allowed,
    'dashboard operator should be allowed to cancel runs'
  );
  assert.ok(
    evaluateGovernanceAction('approve', qaAuditor, { approverId: 'someone-else' }).allowed,
    'QA-capable actors should be allowed to approve'
  );
  assert.ok(
    !evaluateGovernanceAction('cancel_run', publisher).allowed,
    'content specialists should not be allowed to cancel runs by default'
  );
  assert.strictEqual(
    classifyAuditEntity('run_failure_overridden'),
    'workflow',
    'run actions should classify as workflow audit entries'
  );
  assert.strictEqual(
    classifyAuditEntity('task_updated'),
    'task',
    'non-run actions should classify as task audit entries'
  );
  assert.ok(
    buildGovernancePolicySummary(['launch_workflow', 'override_failure']).length === 2,
    'governance summaries should be created for supported actions'
  );
  assert.ok(
    workflowApi.includes('/override-failure') && workflowApi.includes('run_failure_overridden'),
    'workflow runs API should expose override-failure handling and audit logging'
  );
  assert.ok(
    workflowApi.includes('/cancel') && workflowApi.includes('run_cancelled'),
    'workflow runs API should expose cancel handling and audit logging'
  );

  console.log('PASS: workflow governance');
}

try {
  run();
} catch (error) {
  console.error('FAIL: workflow governance');
  console.error(error);
  process.exit(1);
}
