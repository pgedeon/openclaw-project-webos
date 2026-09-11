/**
 * Space / Workspace routes
 *
 * CRUD for workspaces (spaces) — list, get, create, update, delete, duplicate.
 */

const { broadcast } = require('./sse-routes');


function parseBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        reject(Object.assign(new Error('Payload too large (max 64KB)'), { status: 413 }));
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendRouteError(res, err, fallbackMessage) {
  if (err?.status) {
    sendJSON(res, err.status, { error: err.message });
    return;
  }
  sendJSON(res, 500, { error: fallbackMessage });
}

function registerSpaceRoutes(router, deps) {
  const getPool = () => (deps && 'pool' in Object(deps) ? deps.pool : deps);
  const _ok = (res) => {
    if (!getPool()) { sendJSON(res, 503, { error: 'Database not available' }); return false; }
    return true;
  };

  // GET /api/spaces — list all workspaces
  router.add('GET', '/api/spaces', async (req, res, ctx) => {
    if (!_ok(res)) return true;
    try {
      const spaces = await ctx.asanaStorage.listWorkspaces();
      sendJSON(res, 200, { spaces });
    } catch (err) {
      console.error('[space-routes] list error:', err.message);
      sendJSON(res, 500, { error: 'Failed to list spaces' });
    }
    return true;
  });

  // GET /api/spaces/:id — get one workspace
  router.add('GET', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const space = await ctx.asanaStorage.getWorkspace(params.id);
      if (!space) {
        sendJSON(res, 404, { error: 'Workspace not found' });
        return true;
      }
      sendJSON(res, 200, space);
    } catch (err) {
      console.error('[space-routes] get error:', err.message);
      sendJSON(res, 500, { error: 'Failed to get space' });
    }
    return true;
  });

  // POST /api/spaces — create workspace
  router.add('POST', '/api/spaces', async (req, res, ctx) => {
    if (!_ok(res)) return true;
    try {
      const data = await parseBody(req);
      if (!data.name) {
        sendJSON(res, 400, { error: 'name is required' });
        return true;
      }
      if (!data.slug) {
        data.slug = String(data.name || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
        if (!data.slug) data.slug = 'space-' + Date.now();
      }

      // Validate inputs (#19)
      if (data.color && !/^#[0-9a-fA-F]{6}$/.test(data.color)) {
        sendJSON(res, 400, { error: 'Invalid color format' });
        return true;
      }
      if (data.description && data.description.length > 1000) {
        sendJSON(res, 400, { error: 'Description too long' });
        return true;
      }

      const space = await ctx.asanaStorage.createWorkspace(data);
      broadcast('space:changed', { action: 'create', space });  // #14
      sendJSON(res, 201, space);
    } catch (err) {
      // Handle slug uniqueness violation (#8)
      if (err.code === '23505') {
        sendJSON(res, 409, { error: 'Slug already exists' });
        return true;
      }
      console.error('[space-routes] create error:', err.message);
      sendRouteError(res, err, 'Failed to create space');
    }
    return true;
  });

  // PUT /api/spaces/:id — update workspace
  router.add('PUT', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const data = await parseBody(req);
      const expectedUpdatedAt = data._expected_updated_at || null;
      const space = await ctx.asanaStorage.updateWorkspace(params.id, data, expectedUpdatedAt);
      if (!space) {
        sendJSON(res, 404, { error: 'Workspace not found' });
        return true;
      }
      broadcast('space:changed', { action: 'update', space });  // #14
      sendJSON(res, 200, space);
    } catch (err) {
      console.error('[space-routes] update error:', err.message);
      sendRouteError(res, err, 'Failed to update space');
    }
    return true;
  });

  // DELETE /api/spaces/:id — delete workspace
  router.add('DELETE', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const deleted = await ctx.asanaStorage.deleteWorkspace(params.id);
      if (!deleted) {
        sendJSON(res, 404, { error: 'Workspace not found' });
        return true;
      }
      broadcast('space:changed', { action: 'delete', spaceId: params.id });  // #14
      sendJSON(res, 200, { deleted: true });
    } catch (err) {
      if (err.message.includes('default')) {
        sendJSON(res, 403, { error: 'Cannot delete the default workspace' });
      } else if (err.message.includes('non-empty')) {
        sendJSON(res, 409, { error: err.message });
      } else {
        console.error('[space-routes] delete error:', err.message);
        sendJSON(res, 500, { error: 'Failed to delete space' });
      }
    }
    return true;
  });

  // POST /api/spaces/:id/duplicate — duplicate workspace
  router.add('POST', '/api/spaces/:id/duplicate', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const data = await parseBody(req);
      const space = await ctx.asanaStorage.duplicateWorkspace(params.id, data.slug);
      broadcast('space:changed', { action: 'duplicate', space });  // #14
      sendJSON(res, 201, space);
    } catch (err) {
      if (err.message.includes('not found')) {
        sendJSON(res, 404, { error: err.message });
      } else {
        console.error('[space-routes] duplicate error:', err.message);
        sendRouteError(res, err, 'Failed to duplicate space');
      }
    }
    return true;
  });

  // POST /api/spaces/:id/set-default — set workspace as the default
  router.add('POST', '/api/spaces/:id/set-default', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const space = await ctx.asanaStorage.setDefaultWorkspace(params.id);
      if (!space) {
        sendJSON(res, 404, { error: 'Workspace not found' });
        return true;
      }
      broadcast('space:changed', { action: 'set_default', space });
      sendJSON(res, 200, space);
    } catch (err) {
      console.error('[space-routes] set-default error:', err.message);
      sendJSON(res, 500, { error: 'Failed to set default workspace' });
    }
    return true;
  });

  // GET /api/spaces/:id/projects — list projects in a workspace
  router.add('GET', '/api/spaces/:id/projects', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const projects = await ctx.asanaStorage.listProjects({ workspace_id: params.id });
      sendJSON(res, 200, { projects });
    } catch (err) {
      console.error('[space-routes] list projects error:', err.message);
      sendJSON(res, 500, { error: 'Failed to list projects' });
    }
    return true;
  });

  // PUT /api/spaces/:id/projects — batch assign projects to workspace
  router.add('PUT', '/api/spaces/:id/projects', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const data = await parseBody(req);
      if (!Array.isArray(data.project_ids)) {
        sendJSON(res, 400, { error: 'project_ids array required' });
        return true;
      }
      const result = await ctx.asanaStorage.assignProjectsToWorkspace(params.id, data.project_ids);
      broadcast('space:changed', { action: 'projects_updated', spaceId: params.id });
      sendJSON(res, 200, result);
    } catch (err) {
      console.error('[space-routes] assign projects error:', err.message);
      sendRouteError(res, err, 'Failed to assign projects');
    }
    return true;
  });

  // GET /api/spaces/:id/stats — workspace stats (project/task counts)
  router.add('GET', '/api/spaces/:id/stats', async (req, res, ctx, params) => {
    if (!_ok(res)) return true;
    try {
      const stats = await ctx.asanaStorage.getWorkspaceStats(params.id);
      sendJSON(res, 200, stats);
    } catch (err) {
      console.error('[space-routes] stats error:', err.message);
      sendJSON(res, 500, { error: 'Failed to get stats' });
    }
    return true;
  });
}

module.exports = { registerSpaceRoutes };
