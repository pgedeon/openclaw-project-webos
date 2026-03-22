#!/usr/bin/env node

const assert = require('assert');
const { serviceRequestsAPI } = require('../service-requests-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function buildContext() {
  const db = {
    requests: [
      {
        id: 'request-1',
        serviceId: 'service-affiliate',
        requestedBy: 'dashboard-operator',
        title: 'Launch affiliate article',
        description: 'Need a new affiliate article',
        status: 'new',
        priority: 'high',
        projectId: 'project-1',
        taskId: null,
        targetDepartmentId: null,
        targetAgentId: null,
        inputPayload: { keyword: 'best resin printers' },
        routingDecision: {},
        service: {
          id: 'service-affiliate',
          slug: 'affiliate-article',
          name: 'Affiliate Article',
          departmentId: 'dept-content',
          defaultAgentId: 'affiliate-editorial',
          workflowTemplateId: null,
          workflowTemplateName: 'affiliate-article'
        }
      }
    ]
  };
  const captures = {
    createRun: null
  };

  return {
    captures,
    pool: {
      async query(queryText, values) {
        if (queryText.includes('SELECT name FROM workflow_templates')) {
          return { rows: [{ name: 'affiliate-article' }] };
        }
        throw new Error(`Unexpected pool query in test: ${queryText} ${JSON.stringify(values || [])}`);
      }
    },
    workflowRunsApi: {
      async getTemplate(name) {
        if (name === 'affiliate-article') {
          return {
            id: 'template-affiliate',
            name: 'affiliate-article',
            display_name: 'Affiliate Article Workflow',
            displayName: 'Affiliate Article Workflow',
            defaultOwnerAgent: 'affiliate-editorial',
            default_owner_agent: 'affiliate-editorial',
            departmentId: 'dept-content',
            inputSchema: { fields: [{ name: 'keyword', type: 'text' }] },
            artifactContract: { expected_artifacts: ['draft', 'brief'] }
          };
        }
        return null;
      },
      async createRun(data) {
        captures.createRun = data;
        return {
          id: 'run-123',
          workflow_type: data.workflow_type,
          owner_agent_id: data.owner_agent_id,
          board_id: data.board_id,
          task_id: data.task_id,
          service_request_id: data.service_request_id,
          department_id: data.department_id,
          run_priority: data.run_priority,
          input_payload: data.input_payload,
          status: 'queued'
        };
      }
    },
    asanaStorage: {
      async listServices() {
        return [{
          id: 'service-affiliate',
          slug: 'affiliate-article',
          name: 'Affiliate Article',
          departmentId: 'dept-content',
          defaultAgentId: 'affiliate-editorial',
          workflowTemplateName: 'affiliate-article',
          intakeFields: [{ name: 'keyword', type: 'text', label: 'Keyword', required: true }]
        }];
      },
      async getService(identifier) {
        if (identifier === 'service-affiliate' || identifier === 'affiliate-article') {
          return {
            id: 'service-affiliate',
            slug: 'affiliate-article',
            name: 'Affiliate Article',
            departmentId: 'dept-content',
            defaultAgentId: 'affiliate-editorial',
            workflowTemplateName: 'affiliate-article',
            intakeFields: [{ name: 'keyword', type: 'text', label: 'Keyword', required: true }]
          };
        }
        return null;
      },
      async listServiceRequests() {
        return db.requests;
      },
      async getServiceRequest(id) {
        return db.requests.find((request) => request.id === id) || null;
      },
      async createServiceRequest(data) {
        const created = {
          id: 'request-2',
          serviceId: 'service-affiliate',
          requestedBy: data.requested_by,
          title: data.title,
          description: data.description || '',
          status: 'new',
          priority: data.priority || 'medium',
          projectId: data.project_id || null,
          taskId: data.task_id || null,
          targetDepartmentId: data.target_department_id || 'dept-content',
          targetAgentId: data.target_agent_id || 'affiliate-editorial',
          inputPayload: data.input_payload || {},
          routingDecision: {},
          service: {
            id: 'service-affiliate',
            slug: 'affiliate-article',
            name: 'Affiliate Article',
            departmentId: 'dept-content',
            defaultAgentId: 'affiliate-editorial',
            workflowTemplateName: 'affiliate-article'
          }
        };
        db.requests.unshift(created);
        return created;
      },
      async updateServiceRequest(id, data) {
        const request = db.requests.find((item) => item.id === id);
        if (!request) {
          throw new Error(`Service request not found: ${id}`);
        }
        if (data.status !== undefined) request.status = data.status;
        if (data.target_agent_id !== undefined) request.targetAgentId = data.target_agent_id;
        if (data.target_department_id !== undefined) request.targetDepartmentId = data.target_department_id;
        if (data.routing_decision !== undefined) request.routingDecision = data.routing_decision;
        return request;
      },
      async routeServiceRequest(id, data) {
        const request = db.requests.find((item) => item.id === id);
        if (!request) {
          throw new Error(`Service request not found: ${id}`);
        }
        request.status = data.status || 'triaged';
        request.targetDepartmentId = data.target_department_id || request.targetDepartmentId || request.service.departmentId;
        request.targetAgentId = data.target_agent_id || request.targetAgentId || request.service.defaultAgentId;
        request.routingDecision = {
          ...request.routingDecision,
          routed_by: data.routed_by || 'system',
          reason: data.reason || 'default-routing'
        };
        return request;
      }
    },
    sendJSON,
    parseJSONBody: async () => {
      throw new Error('parseJSONBody should not be called in this test');
    }
  };
}

async function run() {
  const context = buildContext();

  const servicesRes = createResponseCapture();
  const handledServices = await serviceRequestsAPI(
    { url: '/api/services', headers: { host: 'localhost:3876' } },
    servicesRes,
    '/api/services',
    'GET',
    null,
    context
  );
  assert.strictEqual(handledServices, true, 'services route should be handled');
  assert.strictEqual(servicesRes.result.status, 200, 'services route should return 200');
  assert.ok(Array.isArray(servicesRes.result.payload.services), 'services route should return a services array');

  const createRes = createResponseCapture();
  const handledCreate = await serviceRequestsAPI(
    { url: '/api/service-requests', headers: { host: 'localhost:3876' } },
    createRes,
    '/api/service-requests',
    'POST',
    {
      service_id: 'service-affiliate',
      title: 'Need another article',
      requested_by: 'dashboard-operator',
      input_payload: { keyword: 'best filament dryers' }
    },
    context
  );
  assert.strictEqual(handledCreate, true, 'create route should be handled');
  assert.strictEqual(createRes.result.status, 201, 'create route should return 201');
  assert.strictEqual(createRes.result.payload.title, 'Need another article', 'create route should return the created request');

  const routeRes = createResponseCapture();
  const handledRoute = await serviceRequestsAPI(
    { url: '/api/service-requests/request-1/route', headers: { host: 'localhost:3876' } },
    routeRes,
    '/api/service-requests/request-1/route',
    'POST',
    { routed_by: 'dashboard-operator' },
    context
  );
  assert.strictEqual(handledRoute, true, 'route endpoint should be handled');
  assert.strictEqual(routeRes.result.status, 200, 'route endpoint should return 200');
  assert.strictEqual(routeRes.result.payload.status, 'triaged', 'route endpoint should move request into triaged state');
  assert.strictEqual(routeRes.result.payload.targetAgentId, 'affiliate-editorial', 'route endpoint should assign default agent');

  const launchRes = createResponseCapture();
  const handledLaunch = await serviceRequestsAPI(
    { url: '/api/service-requests/request-1/launch', headers: { host: 'localhost:3876' } },
    launchRes,
    '/api/service-requests/request-1/launch',
    'POST',
    { launched_by: 'dashboard-operator' },
    context
  );
  assert.strictEqual(handledLaunch, true, 'launch endpoint should be handled');
  assert.strictEqual(launchRes.result.status, 200, 'launch endpoint should return 200');
  assert.strictEqual(launchRes.result.payload.workflowRun.workflow_type, 'affiliate-article', 'launch endpoint should create a workflow run');
  assert.strictEqual(launchRes.result.payload.serviceRequest.status, 'running', 'launch endpoint should update request status');
  assert.strictEqual(launchRes.result.payload.serviceRequest.routingDecision.workflow_run_id, 'run-123', 'launch endpoint should persist workflow run id');
  assert.strictEqual(context.captures.createRun.service_request_id, 'request-1', 'launch endpoint should link the service request to the workflow run');
  assert.strictEqual(context.captures.createRun.department_id, 'dept-content', 'launch endpoint should pass department context to the workflow run');
  assert.strictEqual(context.captures.createRun.run_priority, 'high', 'launch endpoint should pass request priority into the workflow run');

  console.log('PASS: service requests API');
}

run().catch((error) => {
  console.error('FAIL: service requests API');
  console.error(error);
  process.exit(1);
});
