/**
 * History / Time-Travel routes
 *
 * Provides read access to the audit_log table for task state history,
 * diffs, and point-in-time snapshots.
 */

function registerHistoryRoutes(router, deps) {
  const getPool = () => deps?.pool || deps;
  const _ensurePool = (res, ctx) => { if (!getPool()) { ctx.sendJSON(res, 503, { error: "Database not available (running in JSON snapshot mode)" }); return false; } return true; };

  // GET /api/history/:taskId — full history for a task
  router.add('GET', '/api/history/:taskId', async (req, res, ctx, params) => {
      if (!_ensurePool(res, ctx)) return;
    try {
      const { taskId } = params;
      const limit = Math.min(parseInt(req.url?.split('limit=')[1]?.split('&')[0] || '50', 10), 200);
      const result = await getPool().query(
        `SELECT id, actor, action, old_value, new_value, timestamp
         FROM audit_log WHERE task_id = $1
         ORDER BY timestamp DESC LIMIT $2`,
        [taskId, limit]
      );
      ctx.sendJSON(res, 200, {
        taskId,
        entries: result.rows.map(r => ({
          id: r.id,
          actor: r.actor,
          action: r.action,
          oldValue: r.old_value,
          newValue: r.new_value,
          timestamp: r.timestamp,
        })),
        total: result.rows.length,
      });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/history/:taskId/snapshot?at=ISO_TIMESTAMP — point-in-time state
  router.add('GET', '/api/history/:taskId/snapshot', async (req, res, ctx, params) => {
      if (!_ensurePool(res, ctx)) return;
    try {
      const { taskId } = params;
      const atParam = req.url?.split('at=')[1]?.split('&')[0];
      if (!atParam) {
        return ctx.sendJSON(res, 400, { error: 'Missing ?at=ISO_TIMESTAMP parameter' });
      }
      const at = decodeURIComponent(atParam);

      // Get the latest audit entry before the given timestamp
      const result = await getPool().query(
        `SELECT new_value FROM audit_log
         WHERE task_id = $1 AND timestamp <= $2
         ORDER BY timestamp DESC LIMIT 1`,
        [taskId, at]
      );

      if (result.rows.length === 0) {
        // Fall back to current task state
        const taskResult = await getPool().query(
          `SELECT * FROM tasks WHERE id = $1`, [taskId]
        );
        if (taskResult.rows.length === 0) {
          return ctx.sendJSON(res, 404, { error: 'Task not found' });
        }
        return ctx.sendJSON(res, 200, { snapshot: taskResult.rows[0], exact: false });
      }

      ctx.sendJSON(res, 200, { snapshot: result.rows[0].new_value, exact: true });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/history/:taskId/diff?from=ISO&to=ISO — diff between two points
  router.add('GET', '/api/history/:taskId/diff', async (req, res, ctx, params) => {
      if (!_ensurePool(res, ctx)) return;
    try {
      const { taskId } = params;
      const urlStr = req.url || '';
      const from = urlStr.split('from=')[1]?.split('&')[0];
      const to = urlStr.split('to=')[1]?.split('&')[0];

      if (!from || !to) {
        return ctx.sendJSON(res, 400, { error: 'Missing ?from=ISO&to=ISO parameters' });
      }

      const [fromResult, toResult] = await Promise.all([
        getPool().query(
          `SELECT new_value FROM audit_log WHERE task_id = $1 AND timestamp <= $2 ORDER BY timestamp DESC LIMIT 1`,
          [taskId, decodeURIComponent(from)]
        ),
        getPool().query(
          `SELECT new_value FROM audit_log WHERE task_id = $1 AND timestamp <= $2 ORDER BY timestamp DESC LIMIT 1`,
          [taskId, decodeURIComponent(to)]
        ),
      ]);

      const fromState = fromResult.rows[0]?.new_value || {};
      const toState = toResult.rows[0]?.new_value || {};

      // Compute field-level diff
      const allKeys = new Set([...Object.keys(fromState), ...Object.keys(toState)]);
      const changes = [];
      for (const key of allKeys) {
        const oldVal = JSON.stringify(fromState[key]);
        const newVal = JSON.stringify(toState[key]);
        if (oldVal !== newVal) {
          changes.push({ field: key, from: fromState[key], to: toState[key] });
        }
      }

      ctx.sendJSON(res, 200, { taskId, changes, from: decodeURIComponent(from), to: decodeURIComponent(to) });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/history — recent changes across all tasks
  router.add('GET', '/api/history', async (req, res, ctx) => {
      if (!_ensurePool(res, ctx)) return;
    try {
      const urlStr = req.url || '';
      const limit = Math.min(parseInt(urlStr.split('limit=')[1]?.split('&')[0] || '30', 10), 100);
      const actor = urlStr.split('actor=')[1]?.split('&')[0];
      const action = urlStr.split('action=')[1]?.split('&')[0];

      let query = `
        SELECT a.id, a.task_id, a.actor, a.action, a.old_value, a.new_value, a.timestamp, t.title as task_title
        FROM audit_log a LEFT JOIN tasks t ON a.task_id = t.id
        WHERE 1=1`;
      const params = [];
      let idx = 1;

      if (actor) {
        idx++;
        query += ` AND a.actor = $${idx}`;
        params.push(decodeURIComponent(actor));
      }
      if (action) {
        idx++;
        query += ` AND a.action = $${idx}`;
        params.push(decodeURIComponent(action));
      }

      query += ` ORDER BY a.timestamp DESC LIMIT $1`;
      params.unshift(limit);

      const result = await getPool().query(query, params);
      ctx.sendJSON(res, 200, { entries: result.rows, total: result.rows.length });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });
}

module.exports = { registerHistoryRoutes };
