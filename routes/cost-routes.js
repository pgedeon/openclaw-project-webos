/**
 * Cost analytics route module.
 *
 * GET /api/costs/summary?days=7 — aggregate workflow_runs token/cost columns
 * (migration 022: cost_estimate, input_tokens, output_tokens, reported_at)
 * into a today / trailing-window summary for the Mission Control view.
 *
 * Degradation contract: without PostgreSQL (json_snapshot mode or pool not
 * initialized) this endpoint answers HTTP 200 with `{ available: false, ... }`
 * instead of erroring. Callers must treat `available === false` as the
 * "Cost unavailable — no database" panel state.
 */
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

function parseDays(raw) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DAYS;
  return Math.min(parsed, MAX_DAYS);
}

function registerCostRoutes(router) {
  // GET /api/costs/summary?days=7
  router.add('GET', '/api/costs/summary', async (req, res, ctx, params) => {
    const query = new URL(req.url, `http://${req.headers?.host || 'localhost'}`).searchParams;
    const days = parseDays(query.get('days'));
    const timestamp = new Date().toISOString();

    const pool = ctx.asanaStorage && ctx.asanaStorage.pool;
    if (!pool || typeof pool.query !== 'function') {
      ctx.sendJSON(res, 200, {
        available: false,
        reason: 'no_database',
        window_days: days,
        timestamp,
      });
      return true;
    }

    try {
      // Daily series over the trailing window (today inclusive).
      // Bucket by reported_at when usage was reported, falling back to
      // started_at then created_at so unreported runs still land in a day.
      const seriesResult = await pool.query(
        `SELECT to_char(bucket, 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS runs,
                COALESCE(SUM(cost_estimate), 0)::float8 AS cost,
                COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
         FROM (
           SELECT date_trunc('day', COALESCE(reported_at, started_at, created_at)) AS bucket,
                  cost_estimate, input_tokens, output_tokens
           FROM workflow_runs
           WHERE COALESCE(reported_at, started_at, created_at)
                 >= date_trunc('day', NOW()) - make_interval(days => $1 - 1)
         ) d
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [days]
      );

      const topRunResult = await pool.query(
        `SELECT id::text AS id, workflow_type, owner_agent_id, status,
                cost_estimate::float8 AS cost, currency
         FROM workflow_runs
         WHERE cost_estimate IS NOT NULL
           AND COALESCE(reported_at, started_at, created_at)
               >= date_trunc('day', NOW()) - make_interval(days => $1 - 1)
         ORDER BY cost_estimate DESC
         LIMIT 1`,
        [days]
      );

      const rows = seriesResult.rows || [];
      const todayKey = new Date().toISOString().slice(0, 10);
      // Server-local "today" key (date_trunc('day', NOW()) is server-local).
      const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10);
      const todayRow = rows.find(r => r.date === localToday) || rows.find(r => r.date === todayKey) || null;

      const totalCost = rows.reduce((sum, r) => sum + Number(r.cost || 0), 0);
      const avgDaily = rows.length > 0 ? totalCost / rows.length : 0;

      ctx.sendJSON(res, 200, {
        available: true,
        window_days: days,
        currency: topRunResult.rows[0]?.currency || 'USD',
        today: {
          cost: todayRow ? Number(todayRow.cost || 0) : 0,
          tokens: {
            input: todayRow ? Number(todayRow.input_tokens || 0) : 0,
            output: todayRow ? Number(todayRow.output_tokens || 0) : 0,
          },
          runs: todayRow ? Number(todayRow.runs || 0) : 0,
        },
        days: rows.map(r => ({
          date: r.date,
          cost: Number(r.cost || 0),
          runs: Number(r.runs || 0),
          tokens: {
            input: Number(r.input_tokens || 0),
            output: Number(r.output_tokens || 0),
          },
        })),
        avg_daily_7d: Math.round(avgDaily * 100) / 100,
        total_window: Math.round(totalCost * 100) / 100,
        top_run: topRunResult.rows[0]
          ? {
              id: topRunResult.rows[0].id,
              workflow_type: topRunResult.rows[0].workflow_type,
              owner_agent_id: topRunResult.rows[0].owner_agent_id,
              status: topRunResult.rows[0].status,
              cost: Number(topRunResult.rows[0].cost || 0),
            }
          : null,
        timestamp,
      });
    } catch (err) {
      // Query failure (table missing, connection dropped mid-request, ...)
      // degrades exactly like no-database: handled JSON, never an error page.
      ctx.sendJSON(res, 200, {
        available: false,
        reason: 'query_failed',
        details: err.message,
        window_days: days,
        timestamp,
      });
    }
    return true;
  });
}

module.exports = { registerCostRoutes };
