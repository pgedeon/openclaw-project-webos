#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const filePath = path.resolve(__dirname, '../src/agents-page.mjs');
  const source = fs.readFileSync(filePath, 'utf8');

  const forbiddenSnippets = [
    'LEGACY_ZONE_ORDER',
    'LEGACY_ZONES',
    'buildLegacyAgentZone',
    '/api/agents/overview',
    "/workflows/feature-dev/",
    "/workflows/bug-fix/",
    "/workflows/security-audit/"
  ];

  forbiddenSnippets.forEach((snippet) => {
    assert.ok(
      !source.includes(snippet),
      `agents page should not contain legacy heuristic snippet: ${snippet}`
    );
  });

  assert.ok(
    source.includes("fetchJson('/api/org/agents?queue_limit=5')") || source.includes("fetch('/api/org/agents?queue_limit=5'"),
    'agents page should load org agents from backend'
  );
  assert.ok(source.includes('function groupAgents(agents = [])'), 'agents page should still define grouping logic');
  assert.ok(source.includes('getAgentDepartment(agent) || {'), 'grouping should be driven by explicit department metadata');

  console.log('PASS: agents page uses explicit org grouping');
}

try {
  run();
} catch (error) {
  console.error('FAIL: agents page uses explicit org grouping');
  console.error(error);
  process.exit(1);
}
