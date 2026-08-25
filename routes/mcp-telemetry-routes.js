/**
 * MCP tool-call telemetry routes (improvement-loop queue: "did anything
 * actually call our tools?" — answered with data, not guesses).
 *
 * ONE write endpoint, instrumentation only: appends an audit_log row per MCP
 * tools/call reported by lib/mcp-server.js (fire-and-forget emission after
 * the call completes). Never touches task/workflow state.
 *
 * Contract (work-order data shape):
 *   POST /api/mcp/telemetry
 *   { tool: '<registered tool name>', outcome: 'ok'|'error', durationMs: int }
 *   → audit action `mcp-tool-call`, actor 'openclaw' (same privileged system
 *     actor the receipts pipeline stamps — the MCP process IS the operator's
 *     agent), task_id NULL (non-task precedent: workflow-graph events /
 *     export-routes import markers), new_value JSONB {tool, outcome, durationMs}.
 *
 * Degradation (graceful by design — telemetry must never bother anyone):
 *   no DB pool             → 200 {stored:false, reason:'no_database'}
 *   audit_log table absent → 200 {stored:false, reason:'audit_log_missing'}
 *   other write failure    → 500 {error:'query_failed'} (server log carries detail)
 * Validation failures are honest 400s with named reasons, checked BEFORE the
 * pool resolution so bad payloads get named errors even in json_snapshot /
 * no-DB mode (degradation must not mask client bugs — same pin as
 * routes/workflow-graph-routes.js).
 *
 * Tool names validate against the live registry in lib/mcp-server.js so the
 * audit trail cannot fill with junk names from a misbehaving client.
 */

const { TOOLS } = require('../lib/mcp-server');

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const DURATION_MAX_MS = 60 * 60 * 1000; // 1 h — generous; calls are loopback reads

function sendJSON(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

/**
 * Pure validation — exported for DB-free tests.
 * Returns { ok:true, tool, outcome, durationMs } or { ok:false, error }.
 */
function validateMcpTelemetry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const tool = body.tool;
  if (typeof tool !== 'string' || !TOOL_NAMES.has(tool)) {
    return { ok: false, error: 'invalid_tool' };
  }
  const outcome = body.outcome;
  if (outcome !== 'ok' && outcome !== 'error') {
    return { ok: false, error: 'invalid_outcome' };
  }
  const rawDuration = body.durationMs;
  const durationMs = typeof rawDuration === 'number' && Number.isInteger(rawDuration)
    ? rawDuration
    : NaN;
  if (Number.isNaN(durationMs) || durationMs < 0 || durationMs > DURATION_MAX_MS) {
    return { ok: false, error: 'invalid_duration' };
  }
  return { ok: true, tool, outcome, durationMs };
}

function registerMcpTelemetryRoutes(router, deps) {
  // Pool resolution: explicit deps.pool, deps-as-pool, or ctx.asanaStorage.pool.
  // Anything without a callable query() counts as "no DB" (graceful degradation).
  const resolvePool = (ctx) => {
    const candidate = ctx?.asanaStorage?.pool || deps?.pool
      || (deps && typeof deps.query === 'function' ? deps : null);
    return candidate && typeof candidate.query === 'function' ? candidate : null;
  };

  // POST /api/mcp/telemetry — MCP tool-call adoption append.
  router.add('POST', '/api/mcp/telemetry', async (req, res, ctx) => {
    const body = await parseBody(req);
    const verdict = validateMcpTelemetry(body);
    if (!verdict.ok) {
      sendJSON(res, 400, { error: verdict.error });
      return true;
    }

    const pool = resolvePool(ctx);
    if (!pool) {
      // Graceful degradation: staging/json_snapshot mode keeps the MCP
      // client's fire-and-forget POST silent.
      sendJSON(res, 200, { stored: false, reason: 'no_database' });
      return true;
    }

    try {
      await pool.query(
        `INSERT INTO audit_log (task_id, actor, action, old_value, new_value)
         VALUES (NULL, $1, $2, NULL, $3::jsonb)`,
        ['openclaw', 'mcp-tool-call',
         JSON.stringify({ tool: verdict.tool, outcome: verdict.outcome, durationMs: verdict.durationMs })]
      );
      sendJSON(res, 200, { stored: true, action: 'mcp-tool-call' });
    } catch (err) {
      if (err && err.code === '42P01') {
        // undefined_table — audit_log migration not applied on this instance.
        sendJSON(res, 200, { stored: false, reason: 'audit_log_missing' });
      } else {
        console.error(`[mcp-telemetry] insert failed: ${err?.message || err}`);
        sendJSON(res, 500, { error: 'query_failed' });
      }
    }
    return true;
  });
}

module.exports = { registerMcpTelemetryRoutes, validateMcpTelemetry };
