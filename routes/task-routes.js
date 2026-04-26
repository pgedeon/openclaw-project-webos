/**
 * Task route module — all /api/tasks/* endpoints.
 */
const { URL } = require('url');
const { broadcast } = require('./sse-routes');

function registerTaskRoutes(router) {
  // GET /api/tasks — legacy read tasks.md
  router.add('GET', '/api/tasks', async (req, res, ctx) => {
    const fs = require('fs');
    fs.readFile(ctx.TASKS_FILE, 'utf8', (err, data) => {
      if (err) {
        ctx.sendJSON(res, 500, { error: 'Failed to read tasks.md' });
        return;
      }
      ctx.sendJSON(res, 200, { content: data, path: ctx.TASKS_FILE, format: 'markdown' });
    });
    return true;
  });

  // POST /api/tasks — create task (Asana) or legacy write tasks.md
  router.add('POST', '/api/tasks', async (req, res, ctx) => {
    if (ctx.asanaStorage) {
      try {
        const data = await ctx.parseJSONBody(req);
        const required = ['project_id', 'title'];
        for (const field of required) {
          if (!data[field]) {
            const errMsg = `Missing required field: ${field}`;
            console.log('[task-server]', errMsg);
            ctx.sendJSON(res, 400, { error: errMsg });
            return true;
          }
        }
        const task = await ctx.asanaStorage.createTask(data);
        console.log('[task-server] Task created:', task.id);
        broadcast('task:changed', { action: 'create', task });
        ctx.sendJSON(res, 201, task);
      } catch (e) {
        console.error('[task-server] Error creating task:', e);
        ctx.sendJSON(res, 400, { error: e.message });
      }
      return true;
    }
    // Legacy: no asana storage, write tasks.md
    try {
      const data = await ctx.parseJSONBody(req);
      if (!data.content) {
        ctx.sendJSON(res, 400, { error: 'Missing content field' });
        return true;
      }
      const fs = require('fs');
      fs.writeFile(ctx.TASKS_FILE, data.content, 'utf8', (err) => {
        if (err) {
          ctx.sendJSON(res, 500, { error: 'Failed to write tasks.md' });
          return;
        }
        ctx.sendJSON(res, 200, { success: true, path: ctx.TASKS_FILE });
      });
    } catch (e) {
      ctx.sendJSON(res, 400, { error: e.message });
    }
    return true;
  });

  // GET /api/tasks/all
  router.add('GET', '/api/tasks/all', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const projectId = ctx.normalizeTaskListProjectId(query.get('project_id'));
    const includeArchived = query.get('include_archived') === 'true';
    const includeDeleted = query.get('include_deleted') === 'true';
    const includeChildProjects = query.get('include_child_projects') === 'true';
    const depth = parseInt(query.get('depth')) || undefined;
    const updatedSince = query.get('updated_since') || undefined;

    let tasks;
    if (projectId) {
      tasks = await ctx.asanaStorage.listTasks(projectId, {
        depth,
        include_archived: includeArchived,
        include_deleted: includeDeleted,
        include_child_projects: includeChildProjects,
        updated_since: updatedSince,
      });
    } else {
      tasks = await ctx.asanaStorage.listAllTasks({
        include_archived: includeArchived,
        include_deleted: includeDeleted,
        updated_since: updatedSince,
      });
    }
    ctx.sendJSON(res, 200, tasks);
    return true;
  });

  // GET /api/tasks/:id
  router.add('GET', '/api/tasks/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const includeGraph = query.get('includeGraph') === 'true';
    const includeArchived = query.get('include_archived') === 'true';
    const includeDeleted = query.get('include_deleted') === 'true';
    try {
      const task = await ctx.asanaStorage.getTask(id, {
        includeGraph,
        include_archived: includeArchived,
        include_deleted: includeDeleted,
      });
      ctx.sendJSON(res, 200, task);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // PATCH /api/tasks/:id
  router.add('PATCH', '/api/tasks/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const data = await ctx.parseJSONBody(req);
      console.log(`[TaskServer] PATCH /api/tasks/${id} received data:`, JSON.stringify(data, null, 2));
      const task = await ctx.asanaStorage.updateTask(id, data);
      console.log(`[TaskServer] PATCH /api/tasks/${id} succeeded, updated fields:`, Object.keys(data).join(', '));
      broadcast('task:changed', { action: 'update', task });
      ctx.sendJSON(res, 200, task);
    } catch (err) {
      console.error(`[TaskServer] PATCH /api/tasks/${id} failed`);
      console.error(`[TaskServer] Error message: ${err.message}`);
      console.error(`[TaskServer] Error stack:`, err.stack);
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // DELETE /api/tasks/:id
  router.add('DELETE', '/api/tasks/:id', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const result = await ctx.asanaStorage.deleteTask(id);
      broadcast('task:changed', { action: 'delete', taskId: id });
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/archive
  router.add('POST', '/api/tasks/:id/archive', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const result = await ctx.asanaStorage.archiveTask(id);
      broadcast('task:changed', { action: 'archive', taskId: id });
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/restore
  router.add('POST', '/api/tasks/:id/restore', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const result = await ctx.asanaStorage.restoreTask(id);
      broadcast('task:changed', { action: 'restore', taskId: id });
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/move
  router.add('POST', '/api/tasks/:id/move', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const { status } = await ctx.parseJSONBody(req);
      if (!status) {
        ctx.sendJSON(res, 400, { error: 'Missing status field' });
        return true;
      }
      const task = await ctx.asanaStorage.moveTask(id, status);
      broadcast('task:changed', { action: 'move', task });
      ctx.sendJSON(res, 200, task);
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/dependencies
  router.add('POST', '/api/tasks/:id/dependencies', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const { id } = params;
    try {
      const { add = [], remove = [] } = await ctx.parseJSONBody(req);
      let deps = await ctx.asanaStorage.getDependencies(id);

      for (const depId of add) {
        if (!deps.includes(depId)) {
          await ctx.asanaStorage.addDependency(id, depId);
        }
      }

      for (const depId of remove) {
        await ctx.asanaStorage.removeDependency(id, depId);
      }

      const updatedDeps = await ctx.asanaStorage.getDependencies(id);
      ctx.sendJSON(res, 200, { dependencies: updatedDeps });
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/subtasks
  router.add('POST', '/api/tasks/:id/subtasks', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const parentId = params.id;
    try {
      const { task_id } = await ctx.parseJSONBody(req);
      if (!task_id) {
        ctx.sendJSON(res, 400, { error: 'Missing task_id field' });
        return true;
      }
      const result = await ctx.asanaStorage.addSubtask(parentId, task_id);
      ctx.sendJSON(res, 200, result);
    } catch (err) {
      const statusCode = err.message.includes('not found') || err.message.includes('Circular') ? 400 : 404;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // GET /api/tasks/:id/history
  router.add('GET', '/api/tasks/:id/history', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const taskId = params.id;
    try {
      const history = await ctx.asanaStorage.getAuditLog(taskId, 100);
      ctx.sendJSON(res, 200, { task_id: taskId, history });
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });

  // POST /api/tasks/:id/retry — special: ends with /retry, uses startsWith in original
  // We need a custom pattern match. Router supports exact segments, so we register it.
  // The router _matchRoute requires exact segment count, so /api/tasks/:id/retry works.
  router.add('POST', '/api/tasks/:id/retry', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    try {
      const taskId = params.id;
      if (!taskId) {
        ctx.sendJSON(res, 400, { error: 'task_id required in URL' });
        return true;
      }
      const result = await ctx.asanaStorage.retryTask(taskId);
      const task = await ctx.asanaStorage.getTask(taskId);
      broadcast('task:changed', { action: 'retry', task });
      ctx.sendJSON(res, 200, { ...result, task });
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, statusCode, { error: err.message });
    }
    return true;
  });
}

module.exports = { registerTaskRoutes };
