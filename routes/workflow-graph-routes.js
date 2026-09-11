/**
 * Workflow Graph telemetry routes (workflow visual editor Stage 1,
 * docs/briefs/workflow-graph-events contract; work order: additive POST
 * /api/workflow-graph/events).
 *
 * ONE write endpoint, instrumentation only: appends an audit_log row per
 * earn-use event (brief §4/§6). Never touches workflow state — the graph view
 * itself stays read-only.
 *
 * Contract (work order data shape):
 *   POST /api/workflow-graph/events
 *   { event: 'open' | 'feedback', template: '<a-z0-9-]+>', helpful?: bool, note?: string }
 *   - 'open'      → audit action `workflow-graph-open`     (helpful ignored)
 *   - 'feedback'  → audit action `workflow-graph-feedback` (helpful REQUIRED boolean)
 *
 * Degradation (graceful by design — telemetry must never bother the operator):
 *   no DB pool            → 200 {stored:false, reason:'no_database'}
 *   audit_log table absent→ 200 {stored:false, reason:'audit_log_missing'}
 *   other write failure   → 500 {error:'query_failed'} (server log carries detail)
 * Validation failures are honest 400s with named reasons.
 *
 * task_id is written NULL (same precedent as routes/export-routes.js import
 * marker rows); actor is the dashboard operator.
 */

const { TEMPLATE_NAME_RE } = require('../lib/workflow-graph-layout.js');

const NOTE_MAX_CHARS = 500;

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
 * Returns { ok:true, event, template, helpful, note } or { ok:false, error }.
 */
function validateGraphEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_body' };
  }
  const event = body.event;
  if (event !== 'open' && event !== 'feedback') {
    return { ok: false, error: 'invalid_event' };
  }
  const template = body.template;
  if (typeof template !== 'string' || !TEMPLATE_NAME_RE.test(template)) {
    return { ok: false, error: 'invalid_template' };
  }
  let helpful = null;
  if (event === 'feedback') {
    if (typeof body.helpful !== 'boolean') {
      return { ok: false, error: 'invalid_helpful' };
    }
    helpful = body.helpful;
  }
  let note = null;
  if (typeof body.note === 'string' && body.note.trim()) {
    note = body.note.trim().slice(0, NOTE_MAX_CHARS);
  }
  return { ok: true, event, template, helpful, note };
}

function registerWorkflowGraphRoutes(router, deps) {
  // Pool resolution: explicit deps.pool, deps-as-pool, or ctx.asanaStorage.pool.
  // Anything without a callable query() counts as "no DB" (graceful degradation).
  const resolvePool = (ctx) => {
    const candidate = ctx?.asanaStorage?.pool || deps?.pool
      || (deps && typeof deps.query === 'function' ? deps : null);
    return candidate && typeof candidate.query === 'function' ? candidate : null;
  };

  // POST /api/workflow-graph/events — earn-use telemetry append (brief §6).
  router.add('POST', '/api/workflow-graph/events', async (req, res, ctx) => {
    // Validate BEFORE the pool check: validation is DB-independent, so bad
    // payloads get their named 400 even in json_snapshot/no-DB mode (pinned by
    // test — degradation must not mask client bugs).
    const body = await parseBody(req);
    const verdict = validateGraphEvent(body);
    if (!verdict.ok) {
      sendJSON(res, 400, { error: verdict.error });
      return true;
    }

    const pool = resolvePool(ctx);
    if (!pool) {
      // Graceful degradation: staging/json_snapshot mode keeps the UI silent.
      sendJSON(res, 200, { stored: false, reason: 'no_database' });
      return true;
    }

    const action = verdict.event === 'open' ? 'workflow-graph-open' : 'workflow-graph-feedback';
    const detail = { template: verdict.template };
    if (verdict.event === 'feedback') detail.helpful = verdict.helpful;
    if (verdict.note) detail.note = verdict.note;

    try {
      await pool.query(
        `INSERT INTO audit_log (task_id, actor, action, old_value, new_value)
         VALUES (NULL, $1, $2, NULL, $3::jsonb)`,
        ['dashboard-operator', action, JSON.stringify(detail)]
      );
      sendJSON(res, 200, { stored: true, action });
    } catch (err) {
      if (err && err.code === '42P01') {
        // undefined_table — audit_log migration not applied on this instance.
        sendJSON(res, 200, { stored: false, reason: 'audit_log_missing' });
      } else {
        console.error(`[workflow-graph-events] insert failed: ${err?.message || err}`);
        sendJSON(res, 500, { error: 'query_failed' });
      }
    }
    return true;
  });
}

module.exports = { registerWorkflowGraphRoutes, validateGraphEvent };
