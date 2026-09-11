/**
 * Project route module — all /api/projects/* endpoints.
 */
const { URL } = require('url');
const { broadcast } = require('./sse-routes');

function registerProjectRoutes(router) {
  // GET /api/projects
  router.add('GET', '/api/projects', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const filters = Object.fromEntries(query);
      // Pass workspace_id for space-scoped queries (#22)
      const projects = await ctx.asanaStorage.listProjects(filters);
      ctx.sendJSON(res, 200, projects);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/projects/default
  // NOTE: This must be registered BEFORE /api/projects/:id to avoid :id matching "default"
  // The router processes routes in registration order, so this works if registered first.
  router.add('GET', '/api/projects/default', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const filters = {};
    if (query.has('status')) filters.status = query.get('status');
    try {
      const project = await ctx.asanaStorage.getDefaultProject(filters);
      if (!project) {
        ctx.sendJSON(res, 404, { error: 'No default project found' });
        return true;
      }
      ctx.sendJSON(res, 200, project);
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/projects/:id
  router.add('GET', '/api/projects/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const project = await ctx.asanaStorage.getProject(params.id);
      ctx.sendJSON(res, 200, project);
    } catch (err) {
      ctx.sendJSON(res, 404, { error: err.message });
    }
    return true;
  });

  // POST /api/projects
  router.add('POST', '/api/projects', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const data = await ctx.parseJSONBody(req);
      const required = ['name'];
      for (const field of required) {
        if (!data[field]) {
          ctx.sendJSON(res, 400, { error: `Missing required field: ${field}` });
          return true;
        }
      }
      const project = await ctx.asanaStorage.createProject(data);
      broadcast('project:changed', { action: 'create', project });
      ctx.sendJSON(res, 201, project);
    } catch (e) {
      ctx.sendJSON(res, 400, { error: e.message });
    }
    return true;
  });

  // PATCH /api/projects/:id
  router.add('PATCH', '/api/projects/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const data = await ctx.parseJSONBody(req);
      const project = await ctx.asanaStorage.updateProject(params.id, data);
      broadcast('project:changed', { action: 'update', project });
      ctx.sendJSON(res, 200, project);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // DELETE /api/projects/:id
  router.add('DELETE', '/api/projects/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      await ctx.asanaStorage.archiveProject(params.id);
      broadcast('project:changed', { action: 'delete', projectId: params.id });
      ctx.sendJSON(res, 200, { deleted: true, id: params.id });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });
}

module.exports = { registerProjectRoutes };
