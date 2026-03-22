#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const filePath = path.resolve(__dirname, '../src/agents-page.mjs');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.ok(
    source.includes("fetchJson('/api/blockers?limit=200')"),
    'agents page should load blocker items from the blocker API'
  );
  assert.ok(
    source.includes("fetchJson('/api/blockers/summary?limit=200')"),
    'agents page should load blocker summary data from the blocker API'
  );
  assert.ok(
    source.includes('Blocker radar'),
    'org view should expose a blocker radar panel'
  );
  assert.ok(
    source.includes('Blocker console'),
    'agent detail should expose a blocker console panel'
  );
  assert.ok(
    source.includes('data-run-action="reassign"'),
    'blocker console should expose run reassignment controls'
  );
  assert.ok(
    source.includes('data-run-action="escalate"'),
    'blocker console should expose escalation controls'
  );
  assert.ok(
    source.includes('data-run-action="pause"'),
    'blocker console should expose pause controls'
  );
  assert.ok(
    source.includes('data-run-action="resume"'),
    'blocker console should expose resume controls'
  );
  assert.ok(
    source.includes('/api/workflow-runs/${runId}/reassign'),
    'blocker console should call the reassign endpoint'
  );
  assert.ok(
    source.includes('/api/workflow-runs/${runId}/escalate'),
    'blocker console should call the escalate endpoint'
  );
  assert.ok(
    source.includes('/api/workflow-runs/${runId}/pause'),
    'blocker console should call the pause endpoint'
  );
  assert.ok(
    source.includes('/api/workflow-runs/${runId}/resume'),
    'blocker console should call the resume endpoint'
  );
  assert.ok(
    source.includes('getDepartmentBlockerSummary(group)'),
    'department cards should include department-level blocker summaries'
  );

  console.log('PASS: agents page blocker wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: agents page blocker wiring');
  console.error(error);
  process.exit(1);
}
