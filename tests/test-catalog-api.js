#!/usr/bin/env node

const assert = require('assert');
const { buildCatalogPayload, catalogAPI } = require('../catalog-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

async function run() {
  const config = {
    agents: {
      list: [
        {
          id: 'main',
          name: 'Main Agent',
          default: true,
          workspace: '~/.openclaw/workspace/main',
          model: { primary: 'openrouter1/openrouter/hunter-alpha' },
          tools: {
            allow: ['read', 'write', 'exec']
          },
          subagents: {
            allowAgents: ['3dput', 'sailboats-fr']
          }
        },
        {
          id: '3dput',
          name: '3dput',
          workspace: '~/.openclaw/workspace/3dput',
          model: { primary: 'zai/glm-4.7' },
          tools: {
            allow: ['read', 'browser']
          }
        }
      ]
    },
    tools: {
      subagents: {
        tools: {
          allow: ['subagents', 'read'],
          deny: ['canvas']
        }
      }
    }
  };

  const listSkills = async () => ({
    workspaceDir: '~/.openclaw/workspace/main',
    managedSkillsDir: '~/.openclaw/skills',
    skills: [
      {
        name: 'openclaw-dashboard-ops',
        description: 'Recover, validate, and operate the local OpenClaw dashboard.',
        eligible: true,
        disabled: false,
        blockedByAllowlist: false,
        source: 'openclaw-managed',
        bundled: false,
        missing: {}
      },
      {
        name: 'ga4',
        description: 'Query Google Analytics 4 data.',
        eligible: false,
        disabled: false,
        blockedByAllowlist: false,
        source: 'openclaw-workspace',
        bundled: false,
        missing: {
          env: ['GA4_PROPERTY_ID']
        }
      }
    ]
  });

  const payload = await buildCatalogPayload({
    listSkills,
    readOpenClawConfig: () => config
  });

  assert.strictEqual(payload.summary.totalSkills, 2, 'catalog should count skills');
  assert.strictEqual(payload.summary.readySkills, 1, 'catalog should count ready skills');
  assert.strictEqual(payload.summary.locallyManagedSkills, 2, 'catalog should count local skills');
  assert.strictEqual(payload.summary.distinctTools, 4, 'catalog should aggregate unique tools');
  assert.strictEqual(payload.summary.agentsWithToolPolicies, 2, 'catalog should count agents with tools');
  assert.deepStrictEqual(
    payload.globalSubagentTools.allow,
    ['read', 'subagents'],
    'catalog should expose the global subagent tool baseline'
  );

  const readTool = payload.tools.find((tool) => tool.name === 'read');
  assert.ok(readTool, 'tool inventory should include read');
  assert.strictEqual(readTool.agentCount, 2, 'read should be shared by both agents');

  const unavailableSkill = payload.skills.find((skill) => skill.name === 'ga4');
  assert.ok(unavailableSkill, 'skills should include unavailable entries');
  assert.strictEqual(unavailableSkill.status, 'unavailable', 'ga4 should be marked unavailable');
  assert.ok(
    unavailableSkill.missingSummary.some((entry) => entry.includes('GA4_PROPERTY_ID')),
    'skill missing requirements should be summarized'
  );

  const response = createResponseCapture();
  const handled = await catalogAPI(
    { url: '/api/catalog/skills-tools', headers: { host: '127.0.0.1' } },
    response,
    '/api/catalog/skills-tools',
    'GET',
    null,
    {
      sendJSON,
      listSkills,
      readOpenClawConfig: () => config
    }
  );

  assert.strictEqual(handled, true, 'catalog API should handle the combined endpoint');
  assert.strictEqual(response.result.status, 200, 'catalog API should respond 200');
  assert.ok(Array.isArray(response.result.payload.skills), 'combined payload should include skills');
  assert.ok(Array.isArray(response.result.payload.tools), 'combined payload should include tools');

  console.log('PASS: catalog API');
}

run().catch((error) => {
  console.error('FAIL: catalog API');
  console.error(error);
  process.exit(1);
});
