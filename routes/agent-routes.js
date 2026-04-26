/**
 * Agent route module — /api/agents/*, /api/agent/*, /api/agents/heartbeat, etc.
 */
const { URL } = require('url');

function registerAgentRoutes(router) {
  // GET /api/agents — list agents
  router.add('GET', '/api/agents', async (req, res, ctx) => {
    if (ctx.asanaStorage && ctx.asanaStorage.pool) {
      try {
        const { buildMetricsPayloads } = require('../metrics-api.js');
        const payloads = await buildMetricsPayloads({
          sendJSON: ctx.sendJSON,
          asanaStorage: ctx.asanaStorage,
          pool: ctx.asanaStorage.pool,
        }, { days: 1 });
        const agents = (payloads.agentsPayload || []).map(a => ({
          id: a.agentId,
          name: a.displayName,
          status: a.status || 'idle',
          lastHeartbeat: a.lastHeartbeat,
          department: a.department?.name,
        }));
        ctx.sendJSON(res, 200, { agents });
        return true;
      } catch (err) {
        console.error('/api/agents error:', err.message);
      }
    }
    ctx.sendJSON(res, 200, { agents: [] });
    return true;
  });

  // POST /api/agent/claim
  router.add('POST', '/api/agent/claim', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const { task_id, agent_name } = await ctx.parseJSONBody(req);
      if (!task_id || !agent_name) {
        ctx.sendJSON(res, 400, { error: 'task_id and agent_name required' });
        return true;
      }
      const result = await ctx.asanaStorage.claimTask(task_id, agent_name);
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const statusCode = err.message.includes('locked') ? 409 : 404;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // POST /api/agent/release
  router.add('POST', '/api/agent/release', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const { task_id } = await ctx.parseJSONBody(req);
      if (!task_id) {
        ctx.sendJSON(res, 400, { error: 'task_id required' });
        return true;
      }
      const result = await ctx.asanaStorage.releaseTask(task_id);
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // POST /api/agents/heartbeat
  router.add('POST', '/api/agents/heartbeat', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const { agent_name, status = 'online' } = await ctx.parseJSONBody(req);
      if (!agent_name) {
        ctx.sendJSON(res, 400, { error: 'agent_name required' });
        return true;
      }
      await ctx.asanaStorage.recordAgentHeartbeat(agent_name, status);
      ctx.sendJSON(res, 200, { ok: true });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/agents/status
  router.add('GET', '/api/agents/status', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const statuses = await ctx.asanaStorage.listAgentStatuses();
      ctx.sendJSON(res, 200, { agents: statuses });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/lead-handoffs
  router.add('GET', '/api/lead-handoffs', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const actionFilter = query.get('action');
    const actorFilter = query.get('actor');
    const projectFilter = query.get('project_id');
    const limit = Math.max(1, Math.min(200, parseInt(query.get('limit'), 10) || 50));
    const offset = Math.max(0, parseInt(query.get('offset'), 10) || 0);
    try {
      const result = await ctx.asanaStorage.getLeadHandoffs({ actionFilter, actorFilter, projectFilter, limit, offset });
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/audit
  router.add('GET', '/api/audit', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const filters = {};
    if (query.has('task_id')) filters.task_id = query.get('task_id');
    if (query.has('q')) filters.q = query.get('q');
    if (query.has('actor')) filters.actor = query.get('actor');
    if (query.has('action')) filters.action = query.get('action');
    if (query.has('start_date')) filters.start_date = query.get('start_date');
    if (query.has('end_date')) filters.end_date = query.get('end_date');
    if (query.has('entity_type')) filters.entity_type = query.get('entity_type');
    if (query.has('governance_only')) filters.governance_only = query.get('governance_only') === 'true';
    const limit = Math.max(1, parseInt(query.get('limit'), 10) || 100);
    const offset = Math.max(0, parseInt(query.get('offset'), 10) || 0);
    try {
      const result = await ctx.asanaStorage.queryAuditLog(filters, limit, offset);
      if (Array.isArray(result)) {
        ctx.sendJSON(res, 200, { logs: result, total: result.length, limit, offset });
      } else {
        ctx.sendJSON(res, 200, { logs: result.logs || [], total: result.total || 0, limit, offset });
      }
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });
}

module.exports = { registerAgentRoutes };
