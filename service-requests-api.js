#!/usr/bin/env node
/**
 * Service Requests API Module
 * Handles service catalog and business request intake/routing.
 */

const { WorkflowRunsAPI } = require('./workflow-runs-api.js');

const WORKFLOW_TEMPLATE_FALLBACKS = {
  'affiliate-article': 'affiliate-article',
  'bug-report': 'site-fix',
  'code-change': 'code-change',
  'content-creation': 'affiliate-article',
  'feature-request': 'code-change',
  'general-request': 'incident-investigation',
  'image-generation': 'image-generation',
  'image-pack': 'image-generation',
  'incident-investigation': 'incident-investigation',
  'qa-review': 'qa-review',
  'security-issue': 'incident-investigation',
  'site-fix': 'site-fix',
  'website-update': 'site-fix',
  'wordpress-publish': 'wordpress-publish'
};

function normalizeListQuery(urlString, req) {
  return new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`).searchParams;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function buildServiceFilters(searchParams) {
  return {
    activeOnly: searchParams.get('active') !== 'false',
    department: searchParams.get('department') || null,
    search: searchParams.get('search') || null,
    limit: parsePositiveInt(searchParams.get('limit'), 100),
    offset: parsePositiveInt(searchParams.get('offset'), 0)
  };
}

function buildServiceRequestFilters(searchParams) {
  return {
    status: searchParams.get('status') || null,
    service: searchParams.get('service') || null,
    department: searchParams.get('department') || null,
    owner: searchParams.get('owner') || null,
    project_id: searchParams.get('project_id') || null,
    limit: parsePositiveInt(searchParams.get('limit'), 100),
    offset: parsePositiveInt(searchParams.get('offset'), 0)
  };
}

async function parseBody(requestBody, parseJSONBody, req) {
  if (requestBody !== undefined && requestBody !== null) {
    return requestBody;
  }
  return parseJSONBody(req);
}

async function resolveTemplateName(pool, workflowRunsApi, service, explicitTemplateName = null) {
  const candidates = [];
  if (explicitTemplateName) candidates.push(explicitTemplateName);
  if (service?.workflowTemplateName) candidates.push(service.workflowTemplateName);

  if (service?.workflowTemplateId && pool) {
    try {
      const result = await pool.query(
        'SELECT name FROM workflow_templates WHERE id = $1 LIMIT 1',
        [service.workflowTemplateId]
      );
      if (result.rows[0]?.name) {
        candidates.push(result.rows[0].name);
      }
    } catch (error) {
      console.warn('[service-requests-api] Failed to resolve workflow template id:', error.message);
    }
  }

  if (service?.slug) candidates.push(service.slug);
  if (service?.slug && WORKFLOW_TEMPLATE_FALLBACKS[service.slug]) {
    candidates.push(WORKFLOW_TEMPLATE_FALLBACKS[service.slug]);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const template = await workflowRunsApi.getTemplate(candidate);
    if (template) return template;
  }
  return null;
}

function isActiveWorkflowStatus(status) {
  return ['queued', 'running', 'waiting_for_approval', 'blocked', 'retrying'].includes(status);
}

async function serviceRequestsAPI(req, res, url, method, requestBody, context) {
  const {
    asanaStorage,
    pool,
    sendJSON,
    parseJSONBody,
    workflowRunsApi: injectedWorkflowRunsApi
  } = context;

  if (!asanaStorage) {
    sendJSON(res, 503, { error: 'Asana storage not initialized' });
    return true;
  }

  try {
    if (url === '/api/services' && method === 'GET') {
      const filters = buildServiceFilters(normalizeListQuery(url, req));
      const services = await asanaStorage.listServices(filters);
      sendJSON(res, 200, { services, total: services.length });
      return true;
    }

    const serviceMatch = url.match(/^\/api\/services\/([^/]+)$/);
    if (serviceMatch && method === 'GET') {
      const service = await asanaStorage.getService(decodeURIComponent(serviceMatch[1]));
      if (!service) {
        sendJSON(res, 404, { error: 'Service not found' });
        return true;
      }
      sendJSON(res, 200, service);
      return true;
    }

    if (url === '/api/service-requests' && method === 'GET') {
      const filters = buildServiceRequestFilters(normalizeListQuery(url, req));
      const serviceRequests = await asanaStorage.listServiceRequests(filters);
      sendJSON(res, 200, { serviceRequests, total: serviceRequests.length });
      return true;
    }

    if (url === '/api/service-requests' && method === 'POST') {
      const data = await parseBody(requestBody, parseJSONBody, req);
      if (!data?.service_id && !data?.service_slug) {
        sendJSON(res, 400, { error: 'Missing required field: service_id or service_slug' });
        return true;
      }
      if (!data?.title) {
        sendJSON(res, 400, { error: 'Missing required field: title' });
        return true;
      }
      if (!data?.requested_by) {
        sendJSON(res, 400, { error: 'Missing required field: requested_by' });
        return true;
      }
      const serviceRequest = await asanaStorage.createServiceRequest(data);
      sendJSON(res, 201, serviceRequest);
      return true;
    }

    const requestMatch = url.match(/^\/api\/service-requests\/([^/]+)$/);
    if (requestMatch && method === 'GET') {
      const serviceRequest = await asanaStorage.getServiceRequest(decodeURIComponent(requestMatch[1]));
      if (!serviceRequest) {
        sendJSON(res, 404, { error: 'Service request not found' });
        return true;
      }
      sendJSON(res, 200, serviceRequest);
      return true;
    }

    if (requestMatch && method === 'PATCH') {
      const data = await parseBody(requestBody, parseJSONBody, req);
      try {
        const serviceRequest = await asanaStorage.updateServiceRequest(
          decodeURIComponent(requestMatch[1]),
          data
        );
        sendJSON(res, 200, serviceRequest);
      } catch (error) {
        const message = error.message || 'Failed to update service request';
        const status = message.includes('not found') ? 404
          : message.includes('Missing required field') ? 400
            : message.includes('not available yet') ? 503
              : 400;
        sendJSON(res, status, { error: message });
      }
      return true;
    }

    const routeMatch = url.match(/^\/api\/service-requests\/([^/]+)\/route$/);
    if (routeMatch && method === 'POST') {
      const data = await parseBody(requestBody, parseJSONBody, req);
      try {
        const serviceRequest = await asanaStorage.routeServiceRequest(
          decodeURIComponent(routeMatch[1]),
          data || {}
        );
        sendJSON(res, 200, serviceRequest);
      } catch (error) {
        const message = error.message || 'Failed to route service request';
        const status = message.includes('not found') ? 404
          : message.includes('not available yet') ? 503
            : 400;
        sendJSON(res, status, { error: message });
      }
      return true;
    }

    const launchMatch = url.match(/^\/api\/service-requests\/([^/]+)\/launch$/);
    if (launchMatch && method === 'POST') {
      const requestId = decodeURIComponent(launchMatch[1]);
      const data = await parseBody(requestBody, parseJSONBody, req);
      const workflowRunsApi = injectedWorkflowRunsApi || new WorkflowRunsAPI(pool);

      const existingRequest = await asanaStorage.getServiceRequest(requestId);
      if (!existingRequest) {
        sendJSON(res, 404, { error: 'Service request not found' });
        return true;
      }

      if (existingRequest.currentWorkflowRunId && isActiveWorkflowStatus(existingRequest.currentWorkflowRun?.status)) {
        sendJSON(res, 409, {
          error: 'This service request already has an active workflow run',
          workflowRunId: existingRequest.currentWorkflowRunId
        });
        return true;
      }

      const routedRequest = (existingRequest.targetAgentId || existingRequest.targetDepartmentId)
        ? existingRequest
        : await asanaStorage.routeServiceRequest(requestId, {
          routed_by: data?.requested_by || data?.launched_by || 'system',
          reason: 'launch-routing'
        });

      const template = await resolveTemplateName(
        pool,
        workflowRunsApi,
        routedRequest.service,
        data?.workflow_template_name
      );

      if (!template) {
        sendJSON(res, 400, { error: 'No workflow template is available for this service request' });
        return true;
      }

      const ownerAgentId =
        data?.owner_agent_id ||
        routedRequest.targetAgentId ||
        routedRequest.service?.defaultAgentId ||
        template.defaultOwnerAgent ||
        template.default_owner_agent;

      if (!ownerAgentId) {
        sendJSON(res, 400, { error: 'Could not determine an owner agent for this service request' });
        return true;
      }

      const templateInputSchema = template.inputSchema || template.input_schema || {};
      const templateArtifactContract = template.artifactContract || template.artifact_contract || {};
      const templateExpectedArtifacts = Array.isArray(templateArtifactContract.expected_artifacts)
        ? templateArtifactContract.expected_artifacts.length
        : 0;
      const resolvedDepartmentId =
        data?.department_id ||
        routedRequest.targetDepartmentId ||
        template.departmentId ||
        template.department_id ||
        routedRequest.service?.departmentId ||
        null;

      const workflowRun = await workflowRunsApi.createRun({
        workflow_type: template.name,
        owner_agent_id: ownerAgentId,
        actor: data?.launched_by || data?.requested_by || 'system',
        board_id: routedRequest.projectId || null,
        task_id: routedRequest.taskId || null,
        initiator: routedRequest.requestedBy,
        service_request_id: routedRequest.id,
        department_id: resolvedDepartmentId,
        run_priority: data?.run_priority || routedRequest.priority || null,
        approval_state: data?.approval_state || null,
        operator_notes: data?.operator_notes || null,
        expected_artifact_count: templateExpectedArtifacts,
        customer_scope:
          data?.customer_scope ||
          routedRequest.inputPayload?.site ||
          routedRequest.inputPayload?.website ||
          null,
        input_payload: {
          ...routedRequest.inputPayload,
          service_request_id: routedRequest.id,
          service_slug: routedRequest.service?.slug || null,
          service_name: routedRequest.service?.name || null,
          template_name: template.name,
          template_display_name: template.displayName || template.display_name || template.name,
          template_input_schema: templateInputSchema,
          title: routedRequest.title,
          description: routedRequest.description
        },
        gateway_session_id: null
      });

      const updatedRequest = await asanaStorage.updateServiceRequest(requestId, {
        status: 'running',
        target_agent_id: ownerAgentId,
        routing_decision: {
          ...routedRequest.routingDecision,
          launched_at: new Date().toISOString(),
          launched_by: data?.launched_by || data?.requested_by || 'system',
          workflow_run_id: workflowRun.id,
          workflow_template_name: template.name,
          owner_agent_id: ownerAgentId
        }
      });

      sendJSON(res, 200, {
        serviceRequest: updatedRequest,
        workflowRun: workflowRun,
        workflowTemplate: template
      });
      return true;
    }
  } catch (error) {
    console.error('[service-requests-api] Request error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }

  return false;
}

module.exports = {
  serviceRequestsAPI
};
