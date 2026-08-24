/**
 * Cost analytics route module.
 *
 * GET /api/costs/summary?days=7 — aggregate workflow_runs token/cost columns
 * (migration 022: cost_estimate, input_tokens, output_tokens, reported_at)
 * into a today / trailing-window summary for the Mission Control view.
 *
 * Degradation contract: without PostgreSQL (json_snapshot mode or pool not
 * initialized) these endpoints answer HTTP 200 with `{ available: false, ... }`
 * instead of erroring. Callers must treat `available === false` as the
 * "Cost unavailable — no database" panel state.
 */
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

// Rollup dimensions for GET /api/costs/rollup. Each entry maps to a GROUP BY
// expression over the shared bucketing subquery; department resolves through
// agent_profiles (migration 007) and falls back to 'Unassigned' for agents
// without a profile or department mapping.
const ROLLUP_DIMENSIONS = {
  agent: {
    groupExpr: 'wr.owner_agent_id',
    joins: '',
  },
  department: {
    groupExpr: "COALESCE(d.name, 'Unassigned')",
    joins: `
         LEFT JOIN agent_profiles ap ON ap.agent_id = wr.owner_agent_id
         LEFT JOIN departments d ON d.id = ap.department_id`,
  },
  workflow_type: {
    groupExpr: 'wr.workflow_type',
    joins: '',
  },
};

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

  // GET /api/costs/rollup?group_by=agent|department|workflow_type&days=7
  router.add('GET', '/api/costs/rollup', async (req, res, ctx, params) => {
    const query = new URL(req.url, `http://${req.headers?.host || 'localhost'}`).searchParams;
    const rawGroupBy = query.get('group_by');
    // Default to agent rollups when the parameter is absent; reject unknown
    // values explicitly so typos fail loudly instead of silently returning
    // agent data.
    const groupBy = rawGroupBy === null || rawGroupBy === '' ? 'agent' : rawGroupBy;
    if (!Object.prototype.hasOwnProperty.call(ROLLUP_DIMENSIONS, groupBy)) {
      ctx.sendJSON(res, 400, {
        error: 'validation_failed',
        message: `group_by must be one of: ${Object.keys(ROLLUP_DIMENSIONS).join(', ')}`,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    const days = parseDays(query.get('days'));
    const dimension = ROLLUP_DIMENSIONS[groupBy];
    const timestamp = new Date().toISOString();

    const pool = ctx.asanaStorage && ctx.asanaStorage.pool;
    if (!pool || typeof pool.query !== 'function') {
      ctx.sendJSON(res, 200, {
        available: false,
        reason: 'no_database',
        group_by: groupBy,
        window_days: days,
        timestamp,
      });
      return true;
    }

    try {
      // Same COALESCE(reported_at, started_at, created_at) bucketing as the
      // summary endpoint; one row per (group key, day). Series per group is
      // assembled in JS so clients get sparkline-ready arrays.
      const rollupResult = await pool.query(
        `SELECT ${dimension.groupExpr} AS key,
                to_char(bucket, 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS runs,
                COALESCE(SUM(cost_estimate), 0)::float8 AS cost,
                COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens
         FROM (
           SELECT date_trunc('day', COALESCE(reported_at, started_at, created_at)) AS bucket,
                  cost_estimate, input_tokens, output_tokens,
                  owner_agent_id, workflow_type
           FROM workflow_runs
           WHERE COALESCE(reported_at, started_at, created_at)
                 >= date_trunc('day', NOW()) - make_interval(days => $1 - 1)
         ) wr
         ${dimension.joins}
         GROUP BY key, bucket
         ORDER BY key ASC, bucket ASC`,
        [days]
      );

      const currencyResult = await pool.query(
        `SELECT currency
         FROM workflow_runs
         WHERE currency IS NOT NULL
           AND COALESCE(reported_at, started_at, created_at)
               >= date_trunc('day', NOW()) - make_interval(days => $1 - 1)
         ORDER BY reported_at DESC NULLS LAST
         LIMIT 1`,
        [days]
      );

      const rows = rollupResult.rows || [];
      const groupsByKey = new Map();
      for (const row of rows) {
        let group = groupsByKey.get(row.key);
        if (!group) {
          group = {
            key: row.key,
            cost: 0,
            runs: 0,
            tokens: { input: 0, output: 0 },
            series: [],
          };
          groupsByKey.set(row.key, group);
        }
        group.cost += Number(row.cost || 0);
        group.runs += Number(row.runs || 0);
        group.tokens.input += Number(row.input_tokens || 0);
        group.tokens.output += Number(row.output_tokens || 0);
        group.series.push({ date: row.date, cost: Number(row.cost || 0) });
      }

      const groups = [...groupsByKey.values()]
        .map((group) => ({
          ...group,
          cost: Math.round(group.cost * 100) / 100,
        }))
        .sort((a, b) => b.cost - a.cost);

      const totalWindow = Math.round(groups.reduce((sum, g) => sum + g.cost, 0) * 100) / 100;

      ctx.sendJSON(res, 200, {
        available: true,
        group_by: groupBy,
        window_days: days,
        currency: currencyResult.rows[0]?.currency || 'USD',
        group_count: groups.length,
        groups,
        total_window: totalWindow,
        timestamp,
      });
    } catch (err) {
      // Degrades exactly like /summary: handled JSON, never an error page.
      ctx.sendJSON(res, 200, {
        available: false,
        reason: 'query_failed',
        details: err.message,
        group_by: groupBy,
        window_days: days,
        timestamp,
      });
    }
    return true;
  });
}

module.exports = { registerCostRoutes };
