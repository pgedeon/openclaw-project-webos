/**
 * Workflow Routing Admin routes
 *
 * CRUD for the workflow_agent_routing table.
 */

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function registerWorkflowRoutingRoutes(router, deps) {
  const getPool = () => deps?.pool || deps;

  // GET /api/workflow-routing — list all routing rules
  router.add('GET', '/api/workflow-routing', async (req, res, ctx) => {
    const pool = ctx.asanaStorage?.pool || getPool();
    if (!pool) {
      sendJSON(res, 503, { error: 'DB not available' });
      return true;
    }
    try {
      const result = await pool.query('SELECT * FROM workflow_agent_routing ORDER BY priority DESC');
      sendJSON(res, 200, { routes: result.rows });
    } catch (err) { sendJSON(res, 500, { error: err.message }); }
    return true;
  });

  // PUT /api/workflow-routing — upsert a routing rule
  router.add('PUT', '/api/workflow-routing', async (req, res, ctx) => {
    const pool = ctx.asanaStorage?.pool || getPool();
    if (!pool) {
      sendJSON(res, 503, { error: 'DB not available' });
      return true;
    }
    try {
      const data = await parseBody(req);
      if (!data.workflow_type || !data.agent_id) {
        sendJSON(res, 400, { error: 'workflow_type and agent_id required' });
        return true;
      }
      const result = await pool.query(
        `INSERT INTO workflow_agent_routing (workflow_type, agent_id, priority, max_concurrent, timeout_minutes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workflow_type) DO UPDATE SET agent_id = $2, priority = $3, max_concurrent = $4, timeout_minutes = $5
         RETURNING *`,
        [data.workflow_type, data.agent_id, data.priority || 5, data.max_concurrent || 1, data.timeout_minutes || 60]
      );
      sendJSON(res, 200, result.rows[0]);
    } catch (err) { sendJSON(res, 500, { error: err.message }); }
    return true;
  });

  // DELETE /api/workflow-routing/:type — delete a routing rule
  router.add('DELETE', '/api/workflow-routing/:type', async (req, res, ctx, params) => {
    const pool = ctx.asanaStorage?.pool || getPool();
    if (!pool) {
      sendJSON(res, 503, { error: 'DB not available' });
      return true;
    }
    try {
      const result = await pool.query('DELETE FROM workflow_agent_routing WHERE workflow_type = $1 RETURNING *', [params.type]);
      if (result.rows.length === 0) {
        sendJSON(res, 404, { error: 'Route not found' });
        return true;
      }
      sendJSON(res, 200, { deleted: true });
    } catch (err) { sendJSON(res, 500, { error: err.message }); }
    return true;
  });
}

module.exports = { registerWorkflowRoutingRoutes };
