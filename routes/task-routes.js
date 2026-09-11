/**
 * Task route module — all /api/tasks/* endpoints.
 */
const { URL } = require('url');
const { broadcast } = require('./sse-routes');
const reader = require('../lib/session-jsonl-reader');
const { buildTaskSessionBindings } = require('../lib/task-session-binding');

// v1 constant (brief §3 size discipline): cap the response at the 20 most
// recent runs per task.
const MAX_SESSION_RUNS = 20;

function registerTaskRoutes(router) {
  // Snapshot helper — uses ctx from route handler scope
  async function _snapshot(pool, taskId, action, actor = 'dashboard') {
    try {
      if (!pool) return;
      const r = await pool.query('SELECT row_to_json(t) as state FROM tasks t WHERE id = $1', [taskId]);
      if (r.rows[0]?.state) {
        await pool.query(
          `INSERT INTO state_snapshots (entity_type, entity_id, action, state, actor) VALUES ('task', $1, $2, $3, $4)`,
          [taskId, action, JSON.stringify(r.rows[0].state), actor]
        );
      }
    } catch (_) {}
  }

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
        await _snapshot(ctx.asanaStorage?.pool, task.id, 'create');
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
    const workspaceId = query.get('workspace_id') || undefined;

    let tasks;
    if (projectId) {
      tasks = await ctx.asanaStorage.listTasks(projectId, {
        depth,
        include_archived: includeArchived,
        include_deleted: includeDeleted,
        include_child_projects: includeChildProjects,
        updated_since: updatedSince,
        workspace_id: workspaceId,
      });
    } else {
      tasks = await ctx.asanaStorage.listAllTasks({
        include_archived: includeArchived,
        include_deleted: includeDeleted,
        updated_since: updatedSince,
        workspace_id: workspaceId,
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
      await _snapshot(ctx.asanaStorage?.pool, id, 'archive');
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
      await _snapshot(ctx.asanaStorage?.pool, id, 'restore');
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
      await _snapshot(ctx.asanaStorage?.pool, id, 'move');
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
      const statusCode = err.message.includes('not found') ? 404 : 400;
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

  // GET /api/tasks/:id/sessions — task↔session binding (read-time join,
  // docs/briefs/task-session-binding.md). Resolves the task's workflow_runs,
  // joins gateway_session_id (= session KEY) against sessions.json via the
  // reader, and returns compact bindings with replay/console deep-links.
  // Read-only; no transcript bodies ever cross this endpoint.
  router.add('GET', '/api/tasks/:id/sessions', async (req, res, ctx, params) => {
    if (!ctx.asanaStorage || !ctx.asanaStorage.pool) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const taskId = params.id;
    try {
      // Unknown task → 404 (same wording family as getTask's 'not found').
      await ctx.asanaStorage.getTask(taskId);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      ctx.sendJSON(res, status, { error: err.message });
      return true;
    }
    try {
      const runsResult = await ctx.asanaStorage.pool.query(
        `SELECT id, workflow_type, status, gateway_session_id, gateway_session_active,
                started_at, finished_at, last_heartbeat_at, retry_count, created_at
           FROM workflow_runs WHERE task_id = $1
          ORDER BY created_at DESC LIMIT ${MAX_SESSION_RUNS}`,
        [taskId]
      );
      let activeRunId = null;
      try {
        const active = await ctx.asanaStorage.pool.query(
          'SELECT active_workflow_run_id FROM tasks WHERE id = $1',
          [taskId]
        );
        activeRunId = active.rows[0]?.active_workflow_run_id || null;
      } catch (_) { /* optional pointer — degrade without it */ }
      const allData = await reader.listAllSessions();
      const sessionsIndex = [];
      for (const agentData of allData) {
        for (const s of agentData.sessions) {
          if (s && s.key) {
            sessionsIndex.push({ key: s.key, sessionId: s.sessionId || null, agentId: agentData.agentId });
          }
        }
      }
      const sessions = buildTaskSessionBindings(runsResult.rows || [], sessionsIndex, { activeRunId });
      ctx.sendJSON(res, 200, { taskId, sessions });
    } catch (err) {
      console.error('[task-server] GET /api/tasks/:id/sessions failed:', err.message);
      ctx.sendJSON(res, 500, { error: err.message });
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
