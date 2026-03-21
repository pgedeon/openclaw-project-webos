#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  DEPARTMENTS,
  AGENT_PROFILES,
  getDepartmentBySlug
} = require('../org-bootstrap.js');

function run() {
  const openclawPath = process.env.OPENCLAW_CONFIG_FILE || 'openclaw.json';
  const config = JSON.parse(fs.readFileSync(openclawPath, 'utf8'));
  const configuredAgents = (config.agents?.list || [])
    .map((agent) => agent?.id)
    .filter(Boolean);

  const configuredSet = new Set(configuredAgents);
  assert.strictEqual(
    configuredSet.size,
    configuredAgents.length,
    'configured agent ids should be unique in openclaw.json'
  );

  const profileCounts = new Map();
  AGENT_PROFILES.forEach((profile) => {
    assert.ok(profile.agentId, 'bootstrap profile must include agentId');
    assert.ok(profile.departmentSlug, `bootstrap profile ${profile.agentId} must include departmentSlug`);
    assert.ok(
      getDepartmentBySlug(profile.departmentSlug),
      `bootstrap profile ${profile.agentId} references unknown department ${profile.departmentSlug}`
    );
    profileCounts.set(profile.agentId, (profileCounts.get(profile.agentId) || 0) + 1);
  });

  const uncoveredAgents = configuredAgents.filter((agentId) => !profileCounts.has(agentId));
  const duplicateProfiles = Array.from(profileCounts.entries())
    .filter(([, count]) => count !== 1)
    .map(([agentId, count]) => ({ agentId, count }));

  assert.deepStrictEqual(uncoveredAgents, [], 'every configured agent should have exactly one bootstrap department mapping');
  assert.deepStrictEqual(duplicateProfiles, [], 'bootstrap agent mappings should be one-to-one');
  assert.ok(DEPARTMENTS.length > 0, 'bootstrap department catalog should not be empty');

  console.log(`PASS: org bootstrap covers ${configuredAgents.length} configured agents exactly once`);
}

try {
  run();
} catch (error) {
  console.error('FAIL: org bootstrap coverage');
  console.error(error);
  process.exit(1);
}
