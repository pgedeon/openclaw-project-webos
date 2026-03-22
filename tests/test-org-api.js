#!/usr/bin/env node

const assert = require('assert');
const { orgAPI } = require('../org-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function buildContext() {
  return {
    pool: null,
    sendJSON,
    parseJSONBody: async () => {
      throw new Error('parseJSONBody should not be called in this test');
    },
    buildConfiguredAgentsCatalog: () => ([
      {
        id: 'main',
        name: 'Main Agent',
        workspace: '/root/.openclaw/workspace/main',
        default: true,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      },
      {
        id: 'coder',
        name: 'Coder',
        workspace: '/root/.openclaw/workspace/coding-agent',
        default: false,
        defaultModel: 'zai/glm-5'
      }
    ]),
    buildAgentsOverviewPayload: async () => ({
      generatedAt: '2026-03-12T12:00:00.000Z',
      summary: {
        totalAgents: 2,
        online: 1,
        working: 1,
        queued: 0,
        idle: 0,
        offline: 1,
        readyTasks: 2,
        activeTasks: 1,
        blockedTasks: 0,
        overdueTasks: 0
      },
      agents: [
        {
          id: 'main',
          name: 'Main Agent',
          workspace: '/root/.openclaw/workspace/main',
          default: true,
          defaultModel: 'openrouter1/openrouter/hunter-alpha',
          presence: 'working',
          online: true,
          status: 'working',
          lastSeenAt: '2026-03-12T11:59:59.000Z',
          stale: false,
          currentActivity: 'Reviewing dashboard backlog',
          queueSummary: {
            total: 3,
            ready: 2,
            backlog: 0,
            inProgress: 1,
            blocked: 0,
            review: 0,
            completed: 0,
            overdue: 0
          },
          runtime: {
            source: 'dashboard-bridge',
            queueReadyCount: 2,
            queueActiveCount: 1
          },
          currentTask: null,
          nextTask: null,
          queue: []
        }
      ]
    })
  };
}

async function run() {
  const agentsRes = createResponseCapture();
  const handledAgents = await orgAPI(
    { url: '/api/org/agents?queue_limit=5', headers: { host: 'localhost:3876' } },
    agentsRes,
    '/api/org/agents',
    'GET',
    null,
    buildContext()
  );

  assert.strictEqual(handledAgents, true, 'org agents route should be handled');
  assert.strictEqual(agentsRes.result.status, 200, 'org agents route should return 200');
  assert.ok(Array.isArray(agentsRes.result.payload), 'org agents route should return an array');

  const main = agentsRes.result.payload.find((agent) => agent.agentId === 'main');
  const coder = agentsRes.result.payload.find((agent) => agent.agentId === 'coder');

  assert.ok(main, 'main agent should be present');
  assert.ok(coder, 'coder agent should be present');
  assert.strictEqual(main.department.slug, 'core-platform', 'main should use explicit core-platform department');
  assert.strictEqual(main.role, 'orchestrator', 'main should include bootstrap role metadata');
  assert.ok(main.capabilities.includes('orchestration'), 'main should include bootstrap capabilities');
  assert.strictEqual(main.presence, 'working', 'main should preserve live presence');
  assert.strictEqual(coder.department.slug, 'core-platform', 'coder should use explicit core-platform department');
  assert.strictEqual(coder.presence, 'offline', 'coder should fall back to offline when no live overview exists');

  const summaryRes = createResponseCapture();
  const handledSummary = await orgAPI(
    { url: '/api/org/summary?queue_limit=5', headers: { host: 'localhost:3876' } },
    summaryRes,
    '/api/org/summary',
    'GET',
    null,
    buildContext()
  );

  assert.strictEqual(handledSummary, true, 'org summary route should be handled');
  assert.strictEqual(summaryRes.result.status, 200, 'org summary route should return 200');
  assert.strictEqual(summaryRes.result.payload.totalAgents, 2, 'org summary should report both configured agents');
  assert.ok(
    summaryRes.result.payload.departments.some((department) => department.slug === 'core-platform'),
    'org summary should include the bootstrap department list'
  );

  console.log('PASS: org API bootstrap fallback');
}

run().catch((error) => {
  console.error('FAIL: org API bootstrap fallback');
  console.error(error);
  process.exit(1);
});
