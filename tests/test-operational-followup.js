#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const validationPath = path.resolve(__dirname, '../scripts/dashboard-validation.js');
  const normalizerPath = path.resolve(__dirname, '../scripts/normalize-task-dependency-statuses.js');
  const storagePath = path.resolve(__dirname, '../storage/asana.js');

  const validationScript = fs.readFileSync(validationPath, 'utf8');
  const normalizerScript = fs.readFileSync(normalizerPath, 'utf8');
  const storage = fs.readFileSync(storagePath, 'utf8');

  assert.ok(
    validationScript.includes("path.resolve(__dirname, '../../data/qmd')"),
    'dashboard validation should check the real workspace QMD directory'
  );
  assert.ok(
    storage.includes('listTasksWithUnmetDependencies') && storage.includes('normalizeTasksBlockedByDependencies'),
    'asana storage should expose dependency status normalization helpers'
  );
  assert.ok(
    storage.includes('auto_block_unmet_dependencies'),
    'dependency normalization should append a durable history entry'
  );
  assert.ok(
    normalizerScript.includes('--dry-run') && normalizerScript.includes('normalizeTasksBlockedByDependencies'),
    'the remediation script should support dry-run mode and call the shared normalization helper'
  );

  console.log('PASS: dashboard operational follow-up wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: dashboard operational follow-up wiring');
  console.error(error);
  process.exit(1);
}
