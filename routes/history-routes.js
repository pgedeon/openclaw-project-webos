/**
 * History / Time-Travel routes
 *
 * Provides read access to the audit_log and state_snapshots tables
 * for task state history, diffs, and point-in-time recovery.
 */

function registerHistoryRoutes(router, deps) {
  const getPool = () => deps?.pool || deps;
  const _ensurePool = (res, ctx) => {
    if (!getPool()) { ctx.sendJSON(res, 503, { error: 'Database not available (running in JSON snapshot mode)' }); return false; }
    return true;
  };

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
      req.on('error', reject);
    });
  }

  // GET /api/history — recent changes across all entities
  router.add('GET', '/api/history', async (req, res, ctx) => {
    if (!_ensurePool(res, ctx)) return;
    try {
      const urlStr = req.url || '';
      const limit = Math.min(parseInt(urlStr.split('limit=')[1]?.split('&')[0] || '30', 10), 100);
      const actor = urlStr.split('actor=')[1]?.split('&')[0];
      const action = urlStr.split('action=')[1]?.split('&')[0];
      const entityType = urlStr.split('entity_type=')[1]?.split('&')[0];

      let query = `
        SELECT a.id, a.task_id, a.actor, a.action, a.old_value, a.new_value, a.timestamp,
               a.entity_type, a.correlation_id, t.title as task_title
        FROM audit_log a LEFT JOIN tasks t ON a.task_id = t.id
        WHERE 1=1`;
      const params = [];
      let idx = 1;

      if (actor) { idx++; query += ` AND a.actor = $${idx}`; params.push(decodeURIComponent(actor)); }
      if (action) { idx++; query += ` AND a.action = $${idx}`; params.push(decodeURIComponent(action)); }
      if (entityType) { idx++; query += ` AND (a.entity_type = $${idx} OR $${idx} = 'all')`; params.push(decodeURIComponent(entityType)); }

      query += ` ORDER BY a.timestamp DESC LIMIT $1`;
      params.unshift(limit);

      const result = await getPool().query(query, params);
      ctx.sendJSON(res, 200, { entries: result.rows, total: result.rows.length });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/history/:taskId — full audit history for a task
  router.add('GET', '/api/history/:taskId', async (req, res, ctx, params) => {
    if (!_ensurePool(res, ctx)) return;
    try {
      const { taskId } = params;
      const limit = Math.min(parseInt(req.url?.split('limit=')[1]?.split('&')[0] || '50', 10), 200);
      const result = await getPool().query(
        `SELECT id, actor, action, old_value, new_value, timestamp, entity_type, correlation_id
         FROM audit_log WHERE task_id = $1
         ORDER BY timestamp DESC LIMIT $2`,
        [taskId, limit]
      );
      ctx.sendJSON(res, 200, {
        taskId,
        entries: result.rows.map(r => ({
          id: r.id, actor: r.actor, action: r.action,
          oldValue: r.old_value, newValue: r.new_value,
          timestamp: r.timestamp, entityType: r.entity_type, correlationId: r.correlation_id,
        })),
        total: result.rows.length,
      });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/history/:taskId/snapshot?at=ISO — point-in-time state from snapshots
  router.add('GET', '/api/history/:taskId/snapshot', async (req, res, ctx, params) => {
    if (!_ensurePool(res, ctx)) return;
    try {
      const { taskId } = params;
      const urlStr = req.url || '';
      const atParam = urlStr.split('at=')[1]?.split('&')[0];
      if (!atParam) return ctx.sendJSON(res, 400, { error: 'Missing ?at=ISO_TIMESTAMP parameter' });
      const at = decodeURIComponent(atParam);

      const result = await getPool().query(
        `SELECT state FROM state_snapshots
         WHERE entity_type = 'task' AND entity_id = $1 AND created_at <= $2
         ORDER BY created_at DESC LIMIT 1`,
        [taskId, at]
      );

      if (result.rows.length === 0) {
        const taskResult = await getPool().query('SELECT * FROM tasks WHERE id = $1', [taskId]);
        if (taskResult.rows.length === 0) return ctx.sendJSON(res, 404, { error: 'Task not found' });
        return ctx.sendJSON(res, 200, { snapshot: taskResult.rows[0], exact: false });
      }

      ctx.sendJSON(res, 200, { snapshot: result.rows[0].state, exact: true });
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
      if (!from || !to) return ctx.sendJSON(res, 400, { error: 'Missing ?from=ISO&to=ISO parameters' });

      const [fromResult, toResult] = await Promise.all([
        getPool().query(
          `SELECT state FROM state_snapshots WHERE entity_type = 'task' AND entity_id = $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 1`,
          [taskId, decodeURIComponent(from)]
        ),
        getPool().query(
          `SELECT state FROM state_snapshots WHERE entity_type = 'task' AND entity_id = $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 1`,
          [taskId, decodeURIComponent(to)]
        ),
      ]);

      const fromState = fromResult.rows[0]?.state || {};
      const toState = toResult.rows[0]?.state || {};

      const allKeys = new Set([...Object.keys(fromState), ...Object.keys(toState)]);
      const changes = [];
      for (const key of allKeys) {
        if (JSON.stringify(fromState[key]) !== JSON.stringify(toState[key])) {
          changes.push({ field: key, from: fromState[key], to: toState[key] });
        }
      }

      ctx.sendJSON(res, 200, { taskId, changes, from: decodeURIComponent(from), to: decodeURIComponent(to) });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/snapshots/:entityType/:entityId — list state snapshots
  router.add('GET', '/api/snapshots/:entityType/:entityId', async (req, res, ctx, params) => {
    if (!_ensurePool(res, ctx)) return;
    try {
      const { entityType, entityId } = params;
      const limit = Math.min(parseInt(req.url?.split('limit=')[1]?.split('&')[0] || '50', 10), 200);
      const result = await getPool().query(
        `SELECT id, entity_type, entity_id, action, state, actor, correlation_id, created_at
         FROM state_snapshots WHERE entity_type = $1 AND entity_id = $2
         ORDER BY created_at DESC LIMIT $3`,
        [entityType, entityId, limit]
      );
      ctx.sendJSON(res, 200, { snapshots: result.rows, total: result.rows.length });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/snapshots/:snapshotId/preview-revert — preview what reverting would do
  router.add('POST', '/api/snapshots/:snapshotId/preview-revert', async (req, res, ctx, params) => {
    if (!_ensurePool(res, ctx)) return;
    try {
      const { snapshotId } = params;
      const snapshot = await getPool().query('SELECT * FROM state_snapshots WHERE id = $1', [snapshotId]);
      if (!snapshot.rows[0]) return ctx.sendJSON(res, 404, { error: 'Snapshot not found' });

      const snap = snapshot.rows[0];
      const state = typeof snap.state === 'string' ? JSON.parse(snap.state) : snap.state;

      let current = null;
      if (snap.entity_type === 'task') {
        const r = await getPool().query('SELECT * FROM tasks WHERE id = $1', [snap.entity_id]);
        current = r.rows[0] || null;
      } else if (snap.entity_type === 'project') {
        const r = await getPool().query('SELECT * FROM projects WHERE id = $1', [snap.entity_id]);
        current = r.rows[0] || null;
      }

      ctx.sendJSON(res, 200, { snapshot: snap, currentState: current, snapshotState: state });
    } catch (err) {
      ctx.sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/snapshots/:snapshotId/revert — revert entity to snapshot state
  router.add('POST', '/api/snapshots/:snapshotId/revert', async (req, res, ctx, params) => {
    if (!_ensurePool(res, ctx)) return;
    const client = await getPool().connect();
    try {
      const { snapshotId } = params;
      const body = await parseBody(req);
      const actor = body.actor || 'dashboard-operator';

      await client.query('BEGIN');

      const snapResult = await client.query('SELECT * FROM state_snapshots WHERE id = $1', [snapshotId]);
      const snap = snapResult.rows[0];
      if (!snap) { await client.query('ROLLBACK'); return ctx.sendJSON(res, 404, { error: 'Snapshot not found' }); }

      const state = typeof snap.state === 'string' ? JSON.parse(snap.state) : snap.state;
      const eid = snap.entity_id;

      // Record pre-revert snapshot
      await client.query(
        `INSERT INTO state_snapshots (entity_type, entity_id, action, state, actor, correlation_id)
         VALUES ($1, $2, 'pre-revert', (SELECT row_to_json(t) FROM (SELECT * FROM ${snap.entity_type === 'task' ? 'tasks' : 'projects'} WHERE id = $2) t), $3, $4)`,
        [snap.entity_type, eid, actor, snapshotId]
      );

      // Apply revert
      if (snap.entity_type === 'task') {
        await client.query(
          `UPDATE tasks SET title=$1, description=$2, status=$3, priority=$4, owner=$5,
           due_date=$6, labels=$7, metadata=$8, updated_at=NOW() WHERE id=$9`,
          [state.title, state.description || '', state.status, state.priority || 'medium',
           state.owner, state.due_date, state.labels || [], state.metadata || {}, eid]
        );
      } else if (snap.entity_type === 'project') {
        await client.query(
          `UPDATE projects SET name=$1, description=$2, status=$3, tags=$4, metadata=$5, updated_at=NOW() WHERE id=$6`,
          [state.name, state.description || '', state.status || 'active', state.tags || [], state.metadata || {}, eid]
        );
      }

      // Record revert action
      await client.query(
        `INSERT INTO state_snapshots (entity_type, entity_id, action, state, actor, correlation_id)
         VALUES ($1, $2, 'revert', $3, $4, $5)`,
        [snap.entity_type, eid, JSON.stringify(state), actor, snapshotId]
      );

      await client.query('COMMIT');
      ctx.sendJSON(res, 200, { reverted: true, entityType: snap.entity_type, entityId: eid });
    } catch (err) {
      await client.query('ROLLBACK');
      ctx.sendJSON(res, 500, { error: err.message });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerHistoryRoutes };
