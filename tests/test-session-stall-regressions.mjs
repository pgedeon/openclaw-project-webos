#!/usr/bin/env node

import assert from 'assert';
import { createRequire } from 'module';

import { buildTaskListParams } from '../src/shell/native-views/tasks-view.mjs';

const require = createRequire(import.meta.url);
const { GatewayWorkflowDispatcher } = require('../gateway-workflow-dispatcher.js');

function testBuildTaskListParams() {
  assert.deepStrictEqual(buildTaskListParams(null), {
    include_child_projects: 'true',
    include_archived: 'true',
  });

  assert.deepStrictEqual(buildTaskListParams('all'), {
    include_child_projects: 'true',
    include_archived: 'true',
  });

  assert.deepStrictEqual(buildTaskListParams('123e4567-e89b-12d3-a456-426614174000'), {
    project_id: '123e4567-e89b-12d3-a456-426614174000',
    include_child_projects: 'true',
    include_archived: 'true',
  });
}

async function testDispatcherUsesBoundTimeoutPlaceholder() {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const log = { log() {}, error() {} };
  const dispatcher = new GatewayWorkflowDispatcher(pool, log);

  await dispatcher.handleStaleRuns();

  assert.strictEqual(calls.length, 1, 'expected one query when no stale runs exist');
  assert.match(
    calls[0].sql,
    /> \$1/,
    'expected stale-run query to use a placeholder for the timeout threshold'
  );
  assert.deepStrictEqual(
    calls[0].values,
    [60],
    'expected stale-run query to bind the 60 minute timeout as a parameter'
  );
}

async function main() {
  testBuildTaskListParams();
  await testDispatcherUsesBoundTimeoutPlaceholder();
  console.log('PASS: session stall regressions');
}

main().catch((error) => {
  console.error('FAIL: session stall regressions');
  console.error(error);
  process.exit(1);
});
