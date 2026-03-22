#!/usr/bin/env node

const assert = require('assert');
const { orgAPI } = require('../org-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

async function run() {
  const calls = {
    listDepartments: 0,
    listAgentProfiles: 0,
    createDepartment: 0,
    updateDepartment: 0,
    updateAgentProfile: 0
  };

  const context = {
    asanaStorage: {
      async listDepartments() {
        calls.listDepartments += 1;
        return [{
          id: 'dept-core',
          slug: 'core-platform',
          name: 'Core Platform',
          description: 'Storage-backed department',
          color: '#6366f1',
          icon: 'cpu',
          sortOrder: 10,
          metadata: { source: 'storage-test' },
          source: 'storage-test'
        }];
      },
      async listAgentProfiles(configuredAgents) {
        calls.listAgentProfiles += 1;
        assert.strictEqual(configuredAgents.length, 1, 'configured agents should be forwarded to storage');
        return [{
          agentId: 'main',
          departmentSlug: 'core-platform',
          displayName: 'Main Agent',
          role: 'orchestrator',
          modelPrimary: 'openrouter1/openrouter/hunter-alpha',
          capabilities: ['orchestration', 'analysis'],
          status: 'active',
          workspacePath: '/root/.openclaw/workspace',
          metadata: { source: 'storage-test' },
          lastHeartbeat: '2026-03-12T13:00:00.000Z',
          source: 'storage-test'
        }];
      },
      async createDepartment(data) {
        calls.createDepartment += 1;
        return {
          id: 'dept-new',
          slug: 'new-department',
          name: data.name,
          description: data.description || '',
          color: data.color || '#64748b',
          icon: data.icon || 'folder',
          sortOrder: Number.parseInt(data.sort_order, 10) || 0,
          metadata: data.metadata || {},
          source: 'storage-test'
        };
      },
      async updateDepartment(id, data) {
        calls.updateDepartment += 1;
        return {
          id,
          slug: 'core-platform',
          name: data.name || 'Core Platform',
          description: data.description || 'Updated',
          color: '#6366f1',
          icon: 'cpu',
          sortOrder: 10,
          metadata: {},
          source: 'storage-test'
        };
      },
      async updateAgentProfile(agentId, data) {
        calls.updateAgentProfile += 1;
        return {
          agentId,
          departmentSlug: data.department_slug || 'core-platform',
          displayName: data.display_name || 'Main Agent',
          role: data.role || 'orchestrator',
          capabilities: data.capabilities || ['orchestration'],
          status: 'active',
          workspacePath: '/root/.openclaw/workspace',
          metadata: {},
          source: 'storage-test'
        };
      }
    },
    pool: null,
    sendJSON,
    parseJSONBody: async () => {
      throw new Error('parseJSONBody should not be called in this test');
    },
    buildConfiguredAgentsCatalog: () => ([
      {
        id: 'main',
        name: 'Main Agent',
        workspace: '/root/.openclaw/workspace',
        default: true,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      }
    ]),
    buildAgentsOverviewPayload: async () => ({
      generatedAt: '2026-03-12T13:05:00.000Z',
      summary: {
        totalAgents: 1,
        online: 1,
        working: 1,
        queued: 0,
        idle: 0,
        offline: 0,
        readyTasks: 1,
        activeTasks: 1,
        blockedTasks: 0,
        overdueTasks: 0
      },
      agents: [
        {
          id: 'main',
          name: 'Main Agent',
          workspace: '/root/.openclaw/workspace',
          default: true,
          defaultModel: 'openrouter1/openrouter/hunter-alpha',
          presence: 'working',
          online: true,
          status: 'working',
          lastSeenAt: '2026-03-12T13:04:00.000Z',
          stale: false,
          currentActivity: 'Reviewing org backlog',
          queueSummary: {
            total: 2,
            ready: 1,
            backlog: 0,
            inProgress: 1,
            blocked: 0,
            review: 0,
            completed: 0,
            overdue: 0
          },
          runtime: {
            source: 'dashboard-bridge',
            queueReadyCount: 1,
            queueActiveCount: 1
          },
          currentTask: null,
          nextTask: null,
          queue: []
        }
      ]
    })
  };

  const agentsRes = createResponseCapture();
  const handledAgents = await orgAPI(
    { url: '/api/org/agents?queue_limit=5', headers: { host: 'localhost:3876' } },
    agentsRes,
    '/api/org/agents',
    'GET',
    null,
    context
  );

  assert.strictEqual(handledAgents, true, 'org agents route should be handled');
  assert.strictEqual(agentsRes.result.status, 200, 'org agents route should return 200');
  assert.strictEqual(calls.listDepartments, 1, 'org API should read departments through storage');
  assert.strictEqual(calls.listAgentProfiles, 1, 'org API should read agent profiles through storage');
  assert.ok(Array.isArray(agentsRes.result.payload), 'org agents should return an array');
  assert.strictEqual(agentsRes.result.payload[0].department.slug, 'core-platform', 'agent should receive normalized department metadata');
  assert.ok(Array.isArray(agentsRes.result.payload[0].capabilities), 'agent capabilities should be normalized to an array');

  const createRes = createResponseCapture();
  const handledCreate = await orgAPI(
    { url: '/api/org/departments', headers: { host: 'localhost:3876' } },
    createRes,
    '/api/org/departments',
    'POST',
    { name: 'New Department', metadata: { priority: 'high' } },
    context
  );
  assert.strictEqual(handledCreate, true, 'org department create route should be handled');
  assert.strictEqual(createRes.result.status, 201, 'org department create should return 201');
  assert.strictEqual(calls.createDepartment, 1, 'department create should use storage layer');

  const patchDeptRes = createResponseCapture();
  const handledPatchDept = await orgAPI(
    { url: '/api/org/departments/dept-core', headers: { host: 'localhost:3876' } },
    patchDeptRes,
    '/api/org/departments/dept-core',
    'PATCH',
    { description: 'Updated description' },
    context
  );
  assert.strictEqual(handledPatchDept, true, 'org department patch route should be handled');
  assert.strictEqual(patchDeptRes.result.status, 200, 'org department patch should return 200');
  assert.strictEqual(calls.updateDepartment, 1, 'department patch should use storage layer');

  const patchAgentRes = createResponseCapture();
  const handledPatchAgent = await orgAPI(
    { url: '/api/org/agents/main', headers: { host: 'localhost:3876' } },
    patchAgentRes,
    '/api/org/agents/main',
    'PATCH',
    { role: 'executive', capabilities: ['orchestration', 'governance'] },
    context
  );
  assert.strictEqual(handledPatchAgent, true, 'org agent patch route should be handled');
  assert.strictEqual(patchAgentRes.result.status, 200, 'org agent patch should return 200');
  assert.strictEqual(calls.updateAgentProfile, 1, 'agent patch should use storage layer');
  assert.deepStrictEqual(
    patchAgentRes.result.payload.capabilities,
    ['orchestration', 'governance'],
    'agent patch response should preserve normalized capabilities'
  );

  console.log('PASS: org API storage integration');
}

run().catch((error) => {
  console.error('FAIL: org API storage integration');
  console.error(error);
  process.exit(1);
});
