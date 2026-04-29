/**
 * Space / Workspace routes
 *
 * CRUD for workspaces (spaces) — list, get, create, update, delete, duplicate.
 */

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function registerSpaceRoutes(router, deps) {
  const getPool = () => deps?.pool || deps;
  const _ok = (res) => {
    if (!getPool()) { sendJSON(res, 503, { error: 'Database not available' }); return false; }
    return true;
  };

  // GET /api/spaces — list all workspaces
  router.add('GET', '/api/spaces', async (req, res, ctx) => {
    if (!_ok(res)) return;
    try {
      const spaces = await ctx.asanaStorage.listWorkspaces();
      sendJSON(res, 200, { spaces });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // GET /api/spaces/:id — get one workspace
  router.add('GET', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return;
    try {
      const space = await ctx.asanaStorage.getWorkspace(params.id);
      if (!space) return sendJSON(res, 404, { error: 'Workspace not found' });
      sendJSON(res, 200, space);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // POST /api/spaces — create workspace
  router.add('POST', '/api/spaces', async (req, res, ctx) => {
    if (!_ok(res)) return;
    try {
      const data = await parseBody(req);
      if (!data.name) return sendJSON(res, 400, { error: 'name is required' });
      if (!data.slug) data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      // Check slug uniqueness
      const existing = await ctx.asanaStorage.getWorkspaceBySlug(data.slug);
      if (existing) return sendJSON(res, 409, { error: 'Slug already exists' });

      const space = await ctx.asanaStorage.createWorkspace(data);
      sendJSON(res, 201, space);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // PUT /api/spaces/:id — update workspace
  router.add('PUT', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return;
    try {
      const data = await parseBody(req);
      const space = await ctx.asanaStorage.updateWorkspace(params.id, data);
      if (!space) return sendJSON(res, 404, { error: 'Workspace not found' });
      sendJSON(res, 200, space);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  });

  // DELETE /api/spaces/:id — delete workspace
  router.add('DELETE', '/api/spaces/:id', async (req, res, ctx, params) => {
    if (!_ok(res)) return;
    try {
      const deleted = await ctx.asanaStorage.deleteWorkspace(params.id);
      if (!deleted) return sendJSON(res, 404, { error: 'Workspace not found' });
      sendJSON(res, 200, { deleted: true });
    } catch (err) {
      const status = err.message.includes('default') ? 403 : 500;
      sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // POST /api/spaces/:id/duplicate — duplicate workspace
  router.add('POST', '/api/spaces/:id/duplicate', async (req, res, ctx, params) => {
    if (!_ok(res)) return;
    try {
      const data = await parseBody(req);
      const space = await ctx.asanaStorage.duplicateWorkspace(params.id, data.slug);
      sendJSON(res, 201, space);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 500;
      sendJSON(res, status, { error: err.message });
    }
    return true;
  });
}

module.exports = { registerSpaceRoutes };
