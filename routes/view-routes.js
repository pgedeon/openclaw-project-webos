/**
 * View route module — /api/views/* endpoints (saved views + built-in views).
 */
const { URL } = require('url');

function registerViewRoutes(router) {
  // GET /api/views — list saved views
  router.add('GET', '/api/views', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const projectId = query.get('project_id');
    if (!projectId) {
      ctx.sendJSON(res, 400, { error: 'project_id query parameter required' });
      return true;
    }
    try {
      const views = await ctx.asanaStorage.listSavedViews(projectId);
      ctx.sendJSON(res, 200, views);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // POST /api/views — create saved view
  router.add('POST', '/api/views', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const data = await ctx.parseJSONBody(req);
      const required = ['project_id', 'name', 'filters', 'created_by'];
      for (const field of required) {
        if (data[field] === undefined) {
          ctx.sendJSON(res, 400, { error: `Missing required field: ${field}` });
          return true;
        }
      }
      const view = await ctx.asanaStorage.createSavedView(
        data.project_id,
        data.name,
        data.filters,
        data.sort || null,
        data.created_by
      );
      ctx.sendJSON(res, 201, view);
    } catch (e) {
      ctx.sendJSON(res, 400, { error: e.message });
    }
    return true;
  });

  // GET /api/views/board — built-in board view
  // Must be registered before /api/views/:id to take priority
  router.add('GET', '/api/views/board', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const projectId = query.get('project_id');
    if (!projectId) {
      ctx.sendJSON(res, 400, { error: 'project_id query parameter required' });
      return true;
    }
    try {
      const board = await ctx.asanaStorage.getBoardView(projectId);
      ctx.sendJSON(res, 200, board);
    } catch (err) {
      ctx.sendJSON(res, 404, { error: err.message });
    }
    return true;
  });

  // GET /api/views/timeline — built-in timeline view
  router.add('GET', '/api/views/timeline', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const projectId = query.get('project_id');
    if (!projectId) {
      ctx.sendJSON(res, 400, { error: 'project_id query parameter required' });
      return true;
    }
    try {
      const timeline = await ctx.asanaStorage.getTimelineView(
        projectId,
        query.get('start'),
        query.get('end')
      );
      ctx.sendJSON(res, 200, timeline);
    } catch (err) {
      ctx.sendJSON(res, 404, { error: err.message });
    }
    return true;
  });

  // GET /api/views/agent — built-in agent queue view
  router.add('GET', '/api/views/agent', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const agentName = query.get('agent_name');
    if (!agentName) {
      ctx.sendJSON(res, 400, { error: 'agent_name query parameter required' });
      return true;
    }
    try {
      const page = parseInt(query.get('page')) || 1;
      const limit = parseInt(query.get('limit')) || 50;
      const queue = await ctx.asanaStorage.getAgentQueue(agentName, ['ready', 'in_progress'], { page, limit });
      ctx.sendJSON(res, 200, { agent: agentName, tasks: queue.tasks, pagination: queue.pagination });
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 500;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // GET /api/views/:id — get saved view (after built-in views so they take priority)
  router.add('GET', '/api/views/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const view = await ctx.asanaStorage.getSavedView(params.id);
      if (!view) {
        ctx.sendJSON(res, 404, { error: 'Saved view not found' });
        return true;
      }
      ctx.sendJSON(res, 200, view);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // PATCH /api/views/:id — update saved view
  router.add('PATCH', '/api/views/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const data = await ctx.parseJSONBody(req);
      const updates = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.filters !== undefined) updates.filters = data.filters;
      if (data.sort !== undefined) updates.sort = data.sort;
      const view = await ctx.asanaStorage.updateSavedView(params.id, updates);
      ctx.sendJSON(res, 200, view);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // DELETE /api/views/:id — delete saved view
  router.add('DELETE', '/api/views/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const deleted = await ctx.asanaStorage.deleteSavedView(params.id);
      if (!deleted) {
        ctx.sendJSON(res, 404, { error: 'Saved view not found' });
        return true;
      }
      ctx.sendJSON(res, 200, { deleted: true, id: params.id });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });
}

module.exports = { registerViewRoutes };
