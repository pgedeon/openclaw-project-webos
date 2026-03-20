#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const scriptPath = path.resolve(__dirname, '../scripts/aggregate-department-metrics.js');
  const cronPath = path.resolve(__dirname, '../../crontab/department-metrics-snapshot.cron');

  const script = fs.readFileSync(scriptPath, 'utf8');
  const cron = fs.readFileSync(cronPath, 'utf8');

  assert.ok(
    script.includes('persistDepartmentDailyMetrics'),
    'aggregation script should use the shared metrics persistence helper'
  );
  assert.ok(
    script.includes('--backfill-days') && script.includes('--yesterday'),
    'aggregation script should support backfill and yesterday targeting'
  );
  assert.ok(
    cron.includes('aggregate-department-metrics.js --yesterday'),
    'cron definition should schedule the department metrics aggregation script'
  );
  assert.ok(
    cron.includes('~/.openclaw/workspace/logs/department-metrics-snapshot.log'),
    'cron definition should write to the department metrics snapshot log'
  );

  console.log('PASS: metrics snapshot job wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: metrics snapshot job wiring');
  console.error(error);
  process.exit(1);
}
