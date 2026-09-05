'use strict';
/**
 * MCP Server core — expose the dashboard AS an MCP tool provider.
 *
 * Per docs/briefs/mcp-exposure.md. Slice 2: full 13-tool catalog. The 10
 * read-only tools are always registered; the mutating trio
 * (create_task/update_task/create_snapshot) registers ONLY when env
 * OPENCLAW_MCP_MUTATIONS=1 (hidden-not-refused invariant: without the flag a
 * client never sees write affordances in tools/list AND tools/call on them
 * answers -32601 method_not_found — indistinguishable from any other absent
 * method; with the flag they execute).
 *
 * Receipt-minted mutations (brief §8 OQ2, resolved YES): create_task and
 * update_task route through POST /api/actions/execute as task.create /
 * task.update kinds; create_snapshot rides the snapshot.create kind. Every
 * agent-side mutation therefore lands in the same action_receipts table the
 * dashboard UI's one-click actions use (idempotency latch, governance
 * pre-check, audit_log mirror) — actor 'openclaw'.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (no SDK, per repo
 * charter). All data reads go to the task-server over loopback HTTP with the
 * operator's bearer token (same credential model as everything else; the
 * secret stays in this process' environment and is attached as an
 * Authorization header — never placed in URLs, never echoed in errors).
 *
 * Exports pure pieces for DB-free tests (tests/test-mcp-server.js):
 *   TOOLS            — read-only tool registry (name/description/inputSchema)
 *   validateInput    — schema validation, pure, no I/O
 *   dispatch         — tool execution with injectable fetch
 *   createMcpServer  — wires config + registry into a message processor
 *   handleMessage     — JSON-RPC 2.0 message → response object (or null)
 *   handleLine       — one stdin line → one stdout line (or null)
 *   runStdio         — the stdin/stdout loop (entry-point concern only)
 *
 * Adoption telemetry (improvement-loop queue): every EXECUTED tools/call —
 * after the call completes — fires a fire-and-forget POST to the task-server
 * /api/mcp/telemetry endpoint (routes/mcp-telemetry-routes.js → audit_log
 * action 'mcp-tool-call'). Emission never blocks or alters the tool response:
 * it is not awaited on the response path, and any telemetry failure is
 * swallowed. Protocol-level rejects (unknown tool -32602, hidden mutation
 * -32601) are NOT emitted — they are probes, not tool usage. The only place
 * emission is waited on is runStdio's shutdown drain, so a chatty session's
 * last events are not killed by process exit.
 *
 * Degradation honesty: business-level misses (404) and availability bodies
 * ({available:false, reason:'no_database'}) surface as normal tool results;
 * operational failures (task-server unreachable, auth rejected, upstream 5xx)
 * surface as isError tool results. The server loop itself never crashes on
 * backend failure or malformed input.
 */


const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TASK_SERVER_URL = 'http://127.0.0.1:3876';

// Actor stamped into every receipt envelope minted by this server. 'openclaw'
// is one of normalizeActorContext()'s privileged system actors — the MCP
// process IS the operator's agent, gated by OPENCLAW_MCP_MUTATIONS=1.
const MCP_ACTOR = 'openclaw';

// JSON-RPC 2.0 error codes (spec) + tooling conventions.
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

// ── Small pure helpers ───────────────────────────────────────────────────

function redactToken(text, token) {
  if (!token || typeof text !== 'string') return text;
  return text.split(token).join('[redacted]');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value, 10);
  return NaN;
}

/** Build `<path>?<query>` with URL-encoded params; skips null/undefined/'' . */
function buildPath(path, query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// ── Adoption telemetry (fire-and-forget) ─────────────────────────────────

// In-flight emission promises, tracked ONLY so shutdown can drain them.
const inflightTelemetry = new Set();

/**
 * Fire-and-forget adoption event: POST /api/mcp/telemetry on the same
 * task-server base URL the tools already use (same bearer credential).
 * NEVER throws, NEVER rejects unhandled, NEVER affects the tool result —
 * failures are swallowed by contract (telemetry must stay invisible to the
 * MCP client). Not awaited on the response path; tracked in inflightTelemetry
 * so runStdio can drain before exit.
 * @param {object} deps - {fetchImpl, baseUrl, token}
 * @param {{tool: string, outcome: 'ok'|'error', durationMs: number}} event
 */
function emitToolTelemetry(deps, event) {
  try {
    const p = httpJson(deps, 'POST', '/api/mcp/telemetry', event);
    const tracked = p
      .catch(() => { /* telemetry failure is silently irrelevant */ })
      .finally(() => { inflightTelemetry.delete(tracked); });
    inflightTelemetry.add(tracked);
  } catch (_) {
    // Even constructing the request must never break the tool loop.
  }
}

/**
 * Shutdown-only flush: resolves when in-flight emissions settle or after
 * maxWaitMs, whichever comes first. Never used on the response path.
 */
async function drainTelemetry(maxWaitMs = 1000) {
  if (inflightTelemetry.size === 0) return;
  await Promise.race([
    Promise.allSettled([...inflightTelemetry]),
    new Promise((resolve) => setTimeout(resolve, maxWaitMs)),
  ]);
}

// ── Config resolution ────────────────────────────────────────────────────

/**
 * Resolve MCP server config from env. Pure.
 * @param {object} env - process.env-like object
 * @returns {{baseUrl: string, token: string, mutationsEnabled: boolean}}
 */
function resolveMcpConfig(env) {
  const rawUrl = (env.TASK_SERVER_URL || DEFAULT_TASK_SERVER_URL).trim();
  const baseUrl = rawUrl.replace(/\/+$/, '');
  const token = (env.DASHBOARD_AUTH_TOKEN || '').trim();
  // Slice 2: the flag gates the mutating trio. Off (default) → read-only
  // profile; the three M tools are absent from tools/list and tools/call on
  // them answers -32601 like any other absent method.
  const mutationsEnabled = env.OPENCLAW_MCP_MUTATIONS === '1';
  return { baseUrl, token, mutationsEnabled };
}

// ── HTTP adapter ─────────────────────────────────────────────────────────

/**
 * One loopback HTTP call to the task-server. Never throws.
 * @param {object} deps - {fetchImpl, baseUrl, token}
 * @param {string} method - GET | POST | PATCH
 * @param {string} pathWithQuery - e.g. /api/budgets/b1/ledger?period=current
 * @param {object|null} body - JSON body for POST/PATCH
 * @returns {{kind:'http', status:number, payload:object|null}
 *          |{kind:'unreachable', message:string}}
 */
async function httpJson(deps, method, pathWithQuery, body) {
  const { fetchImpl, baseUrl, token } = deps;
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${pathWithQuery}`, {
      method,
      headers: Object.assign(
        { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}
      ),
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { kind: 'unreachable', message: String((err && err.message) || err) };
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null; // non-JSON body (proxy error page etc.) — status still maps below
  }
  return { kind: 'http', status: res.status, payload };
}

/**
 * Map an upstream outcome to a tool payload + isError flag.
 * Business-level answers (2xx incl. degradation bodies, 404) are normal
 * results; operational failures are isError results. Never includes the token.
 */
function mapUpstream(outcome, token) {
  if (outcome.kind === 'unreachable') {
    return {
      isError: true,
      payload: {
        error: 'task_server_unreachable',
        hint: 'Task-server must be running locally (TASK_SERVER_URL, default http://127.0.0.1:3876).',
        detail: redactToken(outcome.message, token),
      },
    };
  }
  const { status, payload } = outcome;
  if (status === 401 || status === 403) {
    return {
      isError: true,
      payload: {
        error: 'auth_failed',
        hint: 'Bearer token rejected by task-server — check DASHBOARD_AUTH_TOKEN.',
      },
    };
  }
  if (status === 404) {
    return { isError: false, payload: { error: 'not_found' } };
  }
  if (status < 200 || status >= 300) {
    return {
      isError: true,
      payload: { error: 'upstream_error', status, detail: payload },
    };
  }
  // 2xx — passthrough verbatim (incl. {available:false, reason:'no_database'}).
  return { isError: false, payload: payload === undefined ? null : payload };
}

/**
 * Failure class for an unavailable allSettled section, derived from the raw
 * httpJson outcome already in hand. Additive sibling to the pinned
 * {section:'unavailable'} marker — the class tells the operator WHY a section
 * is missing: transport down vs auth rejected vs missing route vs 5xx vs an
 * empty/unusable body. Never throws.
 */
function sectionFailureReason(entry) {
  if (!entry || entry.status === 'rejected') return 'task_server_unreachable';
  const value = entry.value;
  if (!value || value.kind === 'unreachable') return 'task_server_unreachable';
  if (value.kind === 'http') {
    if (value.status === 401 || value.status === 403) return 'auth_failed';
    if (value.status === 404) return 'not_found';
    if (value.status >= 200 && value.status < 300) return 'empty_payload';
    return 'upstream_error';
  }
  return 'task_server_unreachable';
}

/**
 * Unavailable-section body: the pinned {section:'unavailable'} marker plus an
 * additive reason sibling; upstream_error also carries the HTTP status when
 * known (mirrors mapUpstream's {error, status} pairing).
 */
function unavailableSection(entry) {
  const reason = sectionFailureReason(entry);
  const body = { section: 'unavailable', reason };
  if (
    reason === 'upstream_error' &&
    entry &&
    entry.status === 'fulfilled' &&
    entry.value &&
    typeof entry.value.status === 'number'
  ) {
    body.status = entry.value.status;
  }
  return body;
}

/** Promise.allSettled section picker over RAW httpJson outcomes:
 *  rejected / unreachable / non-2xx / empty body → {section:'unavailable'}
 *  with a failure-cause reason sibling; otherwise the picked payload.
 *  Never throws. */
function settledSection(entry, pick) {
  const okHttp =
    entry.status === 'fulfilled' &&
    entry.value &&
    entry.value.kind === 'http' &&
    entry.value.status >= 200 &&
    entry.value.status < 300 &&
    entry.value.payload !== null &&
    entry.value.payload !== undefined;
  if (!okHttp) return unavailableSection(entry);
  return pick ? pick(entry.value.payload) : entry.value.payload;
}

// ── Input validation (pure, BEFORE any fetch — AC2) ─────────────────────

function fail(error) {
  return { ok: false, error };
}

// Helper contract: each validator MUTATES the accumulating `value` object on
// success and returns null; on failure it returns {ok:false, error} untouched.

function reqString(params, key) {
  const v = params[key];
  if (typeof v !== 'string' || v.trim() === '') {
    return fail(`Missing required field: ${key} (string)`);
  }
  return { ok: true, value: v.trim() };
}

function optString(params, key, value) {
  if (params[key] === undefined) return null;
  if (typeof params[key] !== 'string' || params[key].trim() === '') {
    return fail(`${key} must be a non-empty string`);
  }
  value[key] = params[key].trim();
  return null;
}

function intInRange(params, key, min, max, defaultValue, value) {
  const raw = params[key];
  if (raw === undefined) {
    value[key] = defaultValue;
    return null;
  }
  const n = asInt(raw);
  if (Number.isNaN(n) || n < min || n > max) {
    return fail(`${key} must be an integer between ${min} and ${max} (got ${JSON.stringify(raw)})`);
  }
  value[key] = n;
  return null;
}

function boolDefault(params, key, defaultValue, value) {
  const raw = params[key];
  if (raw === undefined) {
    value[key] = defaultValue;
    return null;
  }
  if (typeof raw !== 'boolean') {
    return fail(`${key} must be a boolean`);
  }
  value[key] = raw;
  return null;
}

function enumValue(params, key, legal, defaultValue, value) {
  const raw = params[key];
  if (raw === undefined) {
    if (defaultValue !== undefined) value[key] = defaultValue;
    return null;
  }
  if (!legal.includes(raw)) {
    return fail(`${key} must be one of: ${legal.join(' | ')} (got ${JSON.stringify(raw)})`);
  }
  value[key] = raw;
  return null;
}

function rejectUnknownKeys(params, toolName) {
  const schema = TOOLS.find((t) => t.name === toolName);
  const allowed = new Set(Object.keys((schema && schema.inputSchema.properties) || {}));
  const unknown = Object.keys(params).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    return fail(`Unknown parameter(s): ${unknown.join(', ')}. Allowed: ${[...allowed].join(', ') || '(none)'}`);
  }
  return null;
}

const AUDIT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^(current|\d{4}-(0[1-9]|1[0-2]))$/;

/**
 * Validate tool input against its schema. Pure — issues no fetches.
 * @param {string} toolName
 * @param {object} params
 * @returns {{ok:true, value:object}|{ok:false, error:string}}
 */
function validateInput(toolName, params) {
  if (!TOOLS.some((t) => t.name === toolName)) {
    return fail(`Unknown tool: ${toolName}`);
  }
  if (params === undefined || params === null) params = {};
  if (!isPlainObject(params)) {
    return fail('Tool arguments must be an object');
  }
  const unknown = rejectUnknownKeys(params, toolName);
  if (unknown) return unknown;

  const value = {};

  switch (toolName) {
    case 'list_tasks': {
      let r = optString(params, 'status', value);
      if (r) return r;
      r = optString(params, 'project_id', value);
      if (r) return r;
      r = intInRange(params, 'limit', 1, 200, 50, value);
      if (r) return r;
      r = boolDefault(params, 'include_archived', false, value);
      if (r) return r;
      return { ok: true, value };
    }
    case 'get_task': {
      const r = reqString(params, 'task_id');
      if (r.ok === false) return r;
      value.task_id = r.value;
      return { ok: true, value };
    }
    case 'create_task': {
      let r = reqString(params, 'title');
      if (r.ok === false) return r;
      value.title = r.value;
      r = reqString(params, 'project_id');
      if (r.ok === false) return r;
      value.project_id = r.value;
      for (const key of ['description', 'owner_agent', 'status', 'due_date']) {
        r = optString(params, key, value);
        if (r) return r;
      }
      return { ok: true, value };
    }
    case 'update_task': {
      const r = reqString(params, 'task_id');
      if (r.ok === false) return r;
      value.task_id = r.value;
      // Patch passes through verbatim after the shape check — raw PATCH
      // semantics apply (owner reassignment included; governed task.assign
      // routing stays a UI-side concern in v1).
      if (!isPlainObject(params.patch)) {
        return fail('patch must be an object of field:value updates');
      }
      if (Object.keys(params.patch).length === 0) {
        return fail('patch must contain at least one field to update');
      }
      value.patch = params.patch;
      return { ok: true, value };
    }
    case 'create_snapshot': {
      if (params.name === undefined) return { ok: true, value }; // default minted at dispatch
      const r = optString(params, 'name', value);
      if (r) return r;
      if (value.name.length > 120) return fail('name must be at most 120 characters');
      return { ok: true, value };
    }
    case 'get_costs_summary': {
      // Mirrors cost-routes MAX_DAYS=90; rejects instead of clamping so the
      // model sees the boundary at the tool level (pinned by test fixture).
      const r = intInRange(params, 'days', 1, 90, 7, value);
      if (r) return r;
      return { ok: true, value };
    }
    case 'get_cost_rollup': {
      let r = enumValue(params, 'group_by', ['agent', 'department', 'workflow_type'], 'agent', value);
      if (r) return r;
      r = intInRange(params, 'days', 1, 90, 7, value);
      if (r) return r;
      return { ok: true, value };
    }
    case 'list_budgets':
    case 'list_snapshots':
      return { ok: true, value };
    case 'get_budget_ledger': {
      const r = reqString(params, 'budget_id');
      if (r.ok === false) return r;
      value.budget_id = r.value;
      const rawPeriod = params.period;
      if (rawPeriod === undefined) {
        value.period = 'current';
      } else if (typeof rawPeriod !== 'string' || !PERIOD_RE.test(rawPeriod)) {
        return fail('period must be "current" or a YYYY-MM month (got ' + JSON.stringify(rawPeriod) + ')');
      } else {
        value.period = rawPeriod;
      }
      return { ok: true, value };
    }
    case 'get_fleet_status': {
      let r = boolDefault(params, 'include_stuck', true, value);
      if (r) return r;
      r = intInRange(params, 'running_limit', 1, 100, 20, value);
      if (r) return r;
      return { ok: true, value };
    }
    case 'get_mission_control_summary': {
      const raw = params.sections;
      if (raw === undefined) return { ok: true, value };
      if (!Array.isArray(raw)) return fail('sections must be an array of section names');
      const legal = MISSION_CONTROL_SECTIONS;
      for (const item of raw) {
        if (!legal.includes(item)) {
          return fail(`sections entries must be one of: ${legal.join(' | ')} (got ${JSON.stringify(item)})`);
        }
      }
      value.sections = raw.slice();
      return { ok: true, value };
    }
    case 'search_audit': {
      for (const key of ['q', 'actor', 'action', 'task_id', 'start_date', 'end_date', 'entity_type']) {
        const r = optString(params, key, value);
        if (r) return r;
      }
      for (const key of ['start_date', 'end_date']) {
        if (value[key] !== undefined && !AUDIT_DATE_RE.test(value[key])) {
          return fail(`${key} must be an ISO date YYYY-MM-DD (got ${JSON.stringify(value[key])})`);
        }
      }
      let r = boolDefault(params, 'governance_only', false, value);
      if (r) return r;
      r = intInRange(params, 'limit', 1, 500, 100, value);
      if (r) return r;
      r = intInRange(params, 'offset', 0, Number.MAX_SAFE_INTEGER, 0, value);
      if (r) return r;
      return { ok: true, value };
    }
    default:
      return fail(`Unknown tool: ${toolName}`);
  }
}

// ── Tool handlers ────────────────────────────────────────────────────────

/**
 * list_tasks — brief sketches `GET /api/tasks?status=&limit=`; the actual
 * server splits legacy-markdown GET /api/tasks from the DB-backed list at
 * GET /api/tasks/all (which supports project_id/include_archived but no
 * status/limit). Adapter-layer composition: fetch /api/tasks/all, apply the
 * status filter + limit locally, return {tasks, total, truncated}.
 */
async function listTasks(value, deps) {
  const query = {};
  if (value.project_id) query.project_id = value.project_id;
  if (value.include_archived) query.include_archived = 'true';
  const outcome = await httpJson(deps, 'GET', buildPath('/api/tasks/all', query));
  const mapped = mapUpstream(outcome, deps.token);
  if (mapped.isError) return mapped;

  const payload = mapped.payload;
  let rows;
  if (Array.isArray(payload)) rows = payload;
  else if (Array.isArray(payload && payload.tasks)) rows = payload.tasks;
  else return mapped; // unrecognized shape (degradation/error body) — pass through verbatim
  if (value.status) rows = rows.filter((t) => t && t.status === value.status);
  const total = rows.length;
  const tasks = rows.slice(0, value.limit);
  return {
    isError: false,
    payload: { tasks, total, truncated: total > tasks.length, include_archived: value.include_archived },
  };
}

async function getTask(value, deps) {
  const outcome = await httpJson(deps, 'GET', `/api/tasks/${encodeURIComponent(value.task_id)}`);
  return mapUpstream(outcome, deps.token);
}

async function getCostsSummary(value, deps) {
  const outcome = await httpJson(deps, 'GET', buildPath('/api/costs/summary', { days: value.days }));
  return mapUpstream(outcome, deps.token);
}

async function getCostRollup(value, deps) {
  const outcome = await httpJson(
    deps,
    'GET',
    buildPath('/api/costs/rollup', { group_by: value.group_by, days: value.days })
  );
  return mapUpstream(outcome, deps.token);
}

async function listBudgets(_value, deps) {
  const outcome = await httpJson(deps, 'GET', '/api/budgets');
  return mapUpstream(outcome, deps.token);
}

async function getBudgetLedger(value, deps) {
  const outcome = await httpJson(
    deps,
    'GET',
    buildPath(`/api/budgets/${encodeURIComponent(value.budget_id)}/ledger`, { period: value.period })
  );
  return mapUpstream(outcome, deps.token);
}

async function listSnapshots(_value, deps) {
  const outcome = await httpJson(deps, 'GET', '/api/snapshots');
  return mapUpstream(outcome, deps.token);
}

/**
 * get_fleet_status — "is anything on fire": health + agent status + running/
 * stuck workflow runs composed into one flat answer. allSettled semantics:
 * a failing section reports {section:'unavailable'}, never blanks the rest.
 */
async function getFleetStatus(value, deps) {
  const calls = [
    httpJson(deps, 'GET', '/api/health-status'),
    httpJson(deps, 'GET', '/api/agents/status'),
    httpJson(deps, 'GET', buildPath('/api/workflow-runs', { status: 'running', limit: value.running_limit })),
  ];
  if (value.include_stuck) calls.push(httpJson(deps, 'GET', '/api/workflow-runs/stuck'));
  const settled = await Promise.allSettled(calls);
  const payload = {
    health: settledSection(settled[0]),
    agents: settledSection(settled[1], (p) => p),
    running_runs: settledSection(settled[2], (p) => p),
  };
  if (value.include_stuck) payload.stuck_runs = settledSection(settled[3]);
  return { isError: false, payload };
}

const MISSION_CONTROL_SECTIONS = ['health', 'agents', 'queue', 'runs', 'blockers', 'cron', 'costs', 'budgets'];

/**
 * get_mission_control_summary — flagship depth tool: composes the endpoints
 * Mission Control polls (src/shell/native-views/mission-control-view.mjs)
 * SERVER-side with allSettled semantics. Queue section note: the view's raw
 * `/api/tasks?status=queued&limit=200` hits the legacy markdown reader, so the
 * adapter uses the DB-backed /api/tasks/all and applies the queued filter +
 * cap locally — same intended semantics, honest data.
 */
async function getMissionControlSummary(value, deps) {
  const wanted = value.sections || MISSION_CONTROL_SECTIONS;
  const has = (name) => wanted.includes(name);

  const jobs = {};
  if (has('health')) jobs.health = [buildPath('/api/health-status')];
  if (has('agents'))
    jobs.agents = ['/api/openclaw/agents', '/api/agents/status'];
  if (has('queue')) jobs.queue = ['/api/tasks/all']; // queued filter applied locally below
  if (has('runs'))
    jobs.runs = [
      buildPath('/api/workflow-runs', { status: 'running', limit: 50 }),
      '/api/workflow-runs/stuck',
      buildPath('/api/workflow-runs', { status: 'failed', limit: 10 }),
    ];
  if (has('blockers')) jobs.blockers = ['/api/blockers/summary'];
  if (has('cron')) jobs.cron = ['/api/cron/jobs'];
  if (has('costs')) jobs.costs = [buildPath('/api/costs/summary', { days: 7 })];
  if (has('budgets')) jobs.budgets = ['/api/budgets'];

  const flat = [];
  const index = new Map(); // jobKey -> {section, i}
  for (const [section, paths] of Object.entries(jobs)) {
    for (const path of paths) {
      index.set(flat.length, { section });
      flat.push(httpJson(deps, 'GET', path));
    }
  }
  const settled = await Promise.allSettled(flat);

  const bySection = {};
  for (const section of Object.keys(jobs)) bySection[section] = [];
  for (const [pos, outcome] of settled.entries()) {
    const { section } = index.get(pos);
    const okHttp =
      outcome.status === 'fulfilled' &&
      outcome.value &&
      outcome.value.kind === 'http' &&
      outcome.value.status >= 200 &&
      outcome.value.status < 300;
    // Keep the failure class alongside the payload-or-null so an unavailable
    // section can say WHY (additive reason sibling; pinned marker unchanged).
    bySection[section].push({
      value: okHttp ? outcome.value.payload : null,
      fail: okHttp ? null : unavailableSection(outcome),
    });
  }

  // Slot resolved falsy without a transport failure (2xx null/empty/unusable
  // payload) → honest empty_payload class.
  const unavailableOr = (slot) => slot.fail || { section: 'unavailable', reason: 'empty_payload' };

  const sections = {};
  if (has('health')) {
    const h = bySection.health[0];
    sections.health = h.value ? h.value : unavailableOr(h);
  }
  if (has('agents')) {
    const cli = bySection.agents[0];
    const org = bySection.agents[1];
    sections.agents =
      cli.value && org.value
        ? { cli_agents: cli.value, org_agents: org.value }
        : unavailableOr(cli.value ? org : cli);
  }
  if (has('queue')) {
    const slot = bySection.queue[0];
    const raw = slot.value;
    let rows = Array.isArray(raw) ? raw : Array.isArray(raw && raw.tasks) ? raw.tasks : null;
    sections.queue =
      rows === null
        ? unavailableOr(slot)
        : (() => {
            const queued = rows.filter((t) => t && t.status === 'queued').slice(0, 200);
            return { tasks: queued, total: queued.length };
          })();
  }
  if (has('runs')) {
    const [running, stuck, failed] = bySection.runs;
    sections.runs =
      running.value !== null && stuck.value !== null && failed.value !== null
        ? { running: running.value, stuck: stuck.value, failed: failed.value }
        : unavailableOr([running, stuck, failed].find((s) => s.value === null) || { fail: null });
  }
  if (has('blockers')) sections.blockers = bySection.blockers[0].value || unavailableOr(bySection.blockers[0]);
  if (has('cron')) sections.cron = bySection.cron[0].value || unavailableOr(bySection.cron[0]);
  if (has('costs')) sections.costs = bySection.costs[0].value || unavailableOr(bySection.costs[0]);
  if (has('budgets')) sections.budgets = bySection.budgets[0].value || unavailableOr(bySection.budgets[0]);

  return { isError: false, payload: { generated_at: new Date().toISOString(), sections } };
}

/**
 * search_audit — accountability tool. Filters pass through as URL-encoded
 * query params exactly (AC11).
 */
async function searchAudit(value, deps) {
  const query = {};
  for (const key of ['q', 'actor', 'action', 'task_id', 'start_date', 'end_date', 'entity_type']) {
    if (value[key] !== undefined) query[key] = value[key];
  }
  if (value.governance_only) query.governance_only = 'true';
  query.limit = value.limit;
  query.offset = value.offset;
  const outcome = await httpJson(deps, 'GET', buildPath('/api/audit', query));
  return mapUpstream(outcome, deps.token);
}

// ── Mutating tools (slice 2) — receipt-minted via POST /api/actions/execute ─

/** Client-minted idempotency key for the receipt latch (no whitespace, ≤200). */
function mintActionId(nowMs) {
  const crypto = require('crypto');
  return `mcp-${(nowMs || Date.now()).toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

/** snapshot-YYYYMMDD-HHmm — mirrors the server/UI default naming convention. */
function defaultSnapshotName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `snapshot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Execute one action-kind envelope through the governed write path. The
 * pipeline (routes/action-routes.js) validates the envelope, refuses without
 * a database (503 audit-first), latches on actionId, runs the governance
 * pre-check, executes the backing storage method in-process, and finalizes a
 * receipt + audit_log mirror — exactly what dashboard UI actions get.
 */
async function executeMutation({ kind, targetId, params }, deps) {
  const envelope = { actionId: mintActionId(), kind, targetId, params, actor: MCP_ACTOR };
  const outcome = await httpJson(deps, 'POST', '/api/actions/execute', envelope);
  return mapActionOutcome(outcome, deps.token);
}

/**
 * Map an /api/actions/execute outcome. Receipts are audit evidence, so error
 * payloads pass through VERBATIM (typed error + receipt) instead of being
 * collapsed into generic upstream_error shapes:
 *   200            → normal result ({receipt, duplicate?})
 *   404            → business miss: {error:'not_found', receipt?} as a NORMAL result
 *   503            → isError {error:'unavailable', …} — honest write-refusal mapping
 *   other non-2xx  → isError with the pipeline's typed body passthrough
 *                    (invalid_action / rejected_governance / execution_failed /
 *                    budget_blocked / stale_retry)
 */
function mapActionOutcome(outcome, token) {
  if (outcome.kind === 'unreachable') {
    return mapUpstream(outcome, token);
  }
  const { status, payload } = outcome;
  if (status === 401) return mapUpstream(outcome, token); // auth_failed
  if (status >= 200 && status < 300) {
    return { isError: false, payload: payload === undefined ? null : payload };
  }
  if (status === 404) {
    // Executor-reported miss (e.g. update_task on an unknown task id) is a
    // business-level answer; keep the failed receipt alongside it.
    const receipt = payload && payload.receipt ? payload.receipt : undefined;
    return { isError: false, payload: receipt ? { error: 'not_found', receipt } : { error: 'not_found' } };
  }
  if (status === 503) {
    return {
      isError: true,
      payload: {
        error: 'unavailable',
        status,
        reason: (payload && payload.reason) || null,
        hint: 'Task-server storage unavailable — mutation refused, nothing executed.',
        detail: payload,
      },
    };
  }
  return { isError: true, payload: payload === undefined ? { error: 'upstream_error', status } : payload };
}

async function createTask(value, deps) {
  const params = { title: value.title };
  for (const key of ['description', 'owner_agent', 'status', 'due_date']) {
    if (value[key] !== undefined) params[key] = value[key];
  }
  return executeMutation({ kind: 'task.create', targetId: value.project_id, params }, deps);
}

async function updateTask(value, deps) {
  return executeMutation({ kind: 'task.update', targetId: value.task_id, params: { patch: value.patch } }, deps);
}

async function createSnapshot(value, deps) {
  const name = value.name !== undefined ? value.name : defaultSnapshotName();
  return executeMutation({ kind: 'snapshot.create', targetId: name, params: {} }, deps);
}

// ── Tool registry (slice 1: read-only profile — 10 tools) ────────────────

const OBJECT = { type: 'object', additionalProperties: false };

const TOOLS = [
  {
    name: 'list_tasks',
    class: 'read',
    description:
      'List project tasks from the dashboard database. Ordering follows GET /api/tasks/all ' +
      '(newest activity first). Archived tasks are EXCLUDED unless include_archived=true. ' +
      'Status values follow the tasks.status CHECK set (e.g. backlog, ready, in_progress, ' +
      'blocked, review, completed, drafting, qa_pending, ready_to_publish, published, ' +
      'retrying, failed, cancelled, archived).',
    inputSchema: {
      ...OBJECT,
      properties: {
        status: { type: 'string', description: 'Filter by exact task status.' },
        project_id: { type: 'string', description: 'Restrict to one project.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        include_archived: { type: 'boolean', default: false },
      },
    },
    handler: listTasks,
  },
  {
    name: 'get_task',
    class: 'read',
    description:
      'Get one task by id — full row incl. dependencies and history pointer. ' +
      'Unknown ids return {error:"not_found"} as a normal result.',
    inputSchema: {
      ...OBJECT,
      required: ['task_id'],
      properties: { task_id: { type: 'string' } },
    },
    handler: getTask,
  },
  {
    name: 'get_costs_summary',
    class: 'read',
    description:
      'Aggregate token/cost series over the trailing window (today inclusive). Degrades ' +
      'honestly to {available:false, reason:"no_database"} without PostgreSQL.',
    inputSchema: {
      ...OBJECT,
      properties: { days: { type: 'integer', minimum: 1, maximum: 90, default: 7 } },
    },
    handler: getCostsSummary,
  },
  {
    name: 'get_cost_rollup',
    class: 'read',
    description: 'Per-group cost/token rollup over the trailing window.',
    inputSchema: {
      ...OBJECT,
      properties: {
        group_by: { type: 'string', enum: ['agent', 'department', 'workflow_type'], default: 'agent' },
        days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
      },
    },
    handler: getCostRollup,
  },
  {
    name: 'list_budgets',
    class: 'read',
    description:
      'List spending budgets with derived status (breached included) — the exact payload ' +
      'Mission Control budget bars consume.',
    inputSchema: { ...OBJECT, properties: {} },
    handler: listBudgets,
  },
  {
    name: 'get_budget_ledger',
    class: 'read',
    description: 'Budget ledger events for one budget: breach latches, warnings, rollovers.',
    inputSchema: {
      ...OBJECT,
      required: ['budget_id'],
      properties: {
        budget_id: { type: 'string' },
        period: { type: 'string', pattern: '^(current|\\d{4}-\\d{2})$', default: 'current' },
      },
    },
    handler: getBudgetLedger,
  },
  {
    name: 'list_snapshots',
    class: 'read',
    description:
      'List full-state snapshots (disk registry, newest-first). Works without PostgreSQL.',
    inputSchema: { ...OBJECT, properties: {} },
    handler: listSnapshots,
  },
  {
    name: 'get_fleet_status',
    class: 'read',
    description:
      '"Is anything on fire": task-server health + agent status + running workflow runs ' +
      '(+ stuck runs unless include_stuck=false) in one flat answer. Sections fail soft.',
    inputSchema: {
      ...OBJECT,
      properties: {
        include_stuck: { type: 'boolean', default: true },
        running_limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    handler: getFleetStatus,
  },
  {
    name: 'get_mission_control_summary',
    class: 'read',
    description:
      'One-call Mission Control digest: health, agents, queued tasks, workflow runs ' +
      '(running/stuck/failed), blockers, cron health, costs (7d), budgets. Server-side ' +
      'allSettled composition — a failing section reports {section:"unavailable"} without ' +
      'blanking the rest.',
    inputSchema: {
      ...OBJECT,
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string', enum: MISSION_CONTROL_SECTIONS },
          description: 'Subset to compose; default: all sections.',
        },
      },
    },
    handler: getMissionControlSummary,
  },
  {
    name: 'search_audit',
    class: 'read',
    description:
      'Search the audit log — who did what to which entity, when. Supports free-text q, ' +
      'actor/action/entity_type filters, task_id scoping, date bounds, governance_only.',
    inputSchema: {
      ...OBJECT,
      properties: {
        q: { type: 'string', description: 'Free-text search.' },
        actor: { type: 'string' },
        action: { type: 'string' },
        task_id: { type: 'string' },
        start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        end_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        entity_type: { type: 'string' },
        governance_only: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
    },
    handler: searchAudit,
  },

  // ── Mutating trio (slice 2) — registered ONLY when OPENCLAW_MCP_MUTATIONS=1.
  // Every call mints an action receipt through POST /api/actions/execute
  // (kind task.create / task.update / snapshot.create, actor 'openclaw'), so
  // agent-side mutations are auditable in the same action_receipts table the
  // dashboard UI uses — idempotency latch, governance pre-check, audit mirror.
  {
    name: 'create_task',
    class: 'mutating',
    description:
      'Create a task in a project. Mints a governed action receipt (kind task.create) via ' +
      'the dashboard actions pipeline — auditable, idempotency-latched. Without database ' +
      'storage the write is refused with a structured unavailable error; nothing half-executes.',
    inputSchema: {
      ...OBJECT,
      required: ['title', 'project_id'],
      properties: {
        title: { type: 'string' },
        project_id: { type: 'string', description: 'Project the task lands in.' },
        description: { type: 'string' },
        owner_agent: { type: 'string' },
        status: { type: 'string', description: 'Defaults to the storage layer default (queued).' },
        due_date: { type: 'string', description: 'ISO date.' },
      },
    },
    handler: createTask,
  },
  {
    name: 'update_task',
    class: 'mutating',
    description:
      'Patch one task\'s fields. Mints a governed action receipt (kind task.update) via the ' +
      'dashboard actions pipeline. Patch passes through verbatim (raw PATCH semantics); ' +
      'unknown task ids return {error:"not_found"} as a normal result.',
    inputSchema: {
      ...OBJECT,
      required: ['task_id', 'patch'],
      properties: {
        task_id: { type: 'string' },
        patch: { type: 'object', description: 'Field:value updates, passed through verbatim.', minProperties: 1 },
      },
    },
    handler: updateTask,
  },
  {
    name: 'create_snapshot',
    class: 'mutating',
    description:
      'Capture a full-state snapshot (all tier tables + redacted settings) to the disk ' +
      'registry. Additive-only; mints a receipt (kind snapshot.create). Requires database ' +
      'storage — refused honestly with unavailable otherwise. Restore is deliberately NOT ' +
      'tool-exposed.',
    inputSchema: {
      ...OBJECT,
      properties: {
        name: { type: 'string', maxLength: 120, description: 'Default: snapshot-YYYYMMDD-HHmm.' },
      },
    },
    handler: createSnapshot,
  },
];

/**
 * Execute a tool. Validates FIRST (zero HTTP calls on rejection), then runs
 * the handler against injectable deps. Returns {payload, isError}; throws
 * only on programming errors (the protocol layer converts those to
 * JSON-RPC -32603 frames without dying).
 *
 * @param {string} toolName
 * @param {object} params
 * @param {object} deps - {fetchImpl, baseUrl, token}
 */
async function dispatch(toolName, params, deps) {
  const verdict = validateInput(toolName, params);
  if (!verdict.ok) {
    return { isError: true, payload: { error: 'invalid_params', message: verdict.error } };
  }
  const tool = TOOLS.find((t) => t.name === toolName);
  return tool.handler(verdict.value, deps);
}

// ── JSON-RPC 2.0 protocol layer ──────────────────────────────────────────

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function toolContentFrame(dispatchOutcome, token) {
  // Defense-in-depth (AC10): scrub the bearer token from serialized content —
  // normal payloads never contain it, and degradation bodies still pass
  // through byte-identical because they never carry credentials either.
  const text = redactToken(JSON.stringify(dispatchOutcome.payload), token);
  const frame = { content: [{ type: 'text', text }] };
  if (dispatchOutcome.isError) frame.isError = true;
  return frame;
}

/**
 * Tool descriptors visible to the connected client. Read-only tools are
 * always exposed; the mutating trio appears only when config.mutationsEnabled
 * (OPENCLAW_MCP_MUTATIONS=1) — hidden-not-refused invariant.
 */
function publicToolDescriptors(config = {}) {
  const visible = TOOLS.filter((t) => t.class !== 'mutating' || config.mutationsEnabled);
  return visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/**
 * Create a server instance (pure wiring; no I/O until runStdio).
 * @param {{env?: object, fetchImpl?: Function, now?: Function}} options
 */
function createMcpServer(options = {}) {
  const env = options.env || {};
  const config = resolveMcpConfig(env);
  const fetchImpl = options.fetchImpl || global.fetch;
  const now = options.now || (() => new Date().toISOString());
  return { config, deps: { fetchImpl, baseUrl: config.baseUrl, token: config.token }, now };
}

/**
 * Handle one parsed JSON-RPC message. Returns a response object, or null for
 * notifications (per JSON-RPC 2.0, notifications get no reply). Never throws.
 */
async function handleMessage(server, msg) {
  if (!isPlainObject(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg && typeof msg.id !== 'undefined' ? msg.id : null, ERR_INVALID_REQUEST, 'Invalid Request');
  }
  // Notifications (JSON-RPC 2.0: a Request WITHOUT an id) get no reply.
  // id === null is still a request and gets a reply with id null.
  const hasId = 'id' in msg;
  const isNotification = !hasId || msg.id === undefined;
  const id = hasId ? msg.id : undefined;
  const { method } = msg;
  const params = isPlainObject(msg.params) ? msg.params : {};

  try {
    switch (method) {
      case 'initialize':
        if (isNotification) return null;
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'openclaw-dashboard', version: serverVersion() },
        });
      case 'ping':
        return isNotification ? null : rpcResult(id, {});
      case 'tools/list':
        return isNotification ? null : rpcResult(id, { tools: publicToolDescriptors(server.config) });
      case 'tools/call': {
        if (isNotification) return null;
        const name = params.name;
        if (typeof name !== 'string') {
          return rpcError(id, ERR_INVALID_PARAMS, 'tools/call requires a tool name');
        }
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) {
          return rpcError(id, ERR_INVALID_PARAMS, `Unknown tool: ${name}`);
        }
        if (tool.class === 'mutating' && !(server.config && server.config.mutationsEnabled)) {
          // Hidden-not-refused invariant (brief AC6, work order slice 2):
          // without the flag the trio never appears in tools/list AND calls
          // answer method_not_found — indistinguishable from any other
          // absent method, so a read-only client sees no write affordance.
          return rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${name}`);
        }
        const args = params.arguments === undefined ? {} : params.arguments;
        const startedAtMs = Date.now();
        let outcome = null;
        let threw = null;
        try {
          outcome = await dispatch(name, args, server.deps);
        } catch (err) {
          threw = err;
        }
        // Fire-and-forget adoption telemetry AFTER the call completed —
        // validation rejections and handler crashes both count as 'error'
        // outcomes; emission itself is neither awaited nor allowed to throw.
        emitToolTelemetry(server.deps, {
          tool: name,
          outcome: threw !== null || outcome === null || outcome.isError ? 'error' : 'ok',
          durationMs: Date.now() - startedAtMs,
        });
        if (threw !== null) throw threw;
        return rpcResult(id, toolContentFrame(outcome, server.deps.token));
      }
      default:
        return isNotification ? null : rpcError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    // A throwing handler must produce an error frame, never kill the loop.
    return isNotification
      ? null
      : rpcError(id, ERR_INTERNAL, 'Internal error', redactToken(String((err && err.message) || err), server.deps.token));
  }
}

let cachedVersion = null;
function serverVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    // eslint-disable-next-line global-require
    cachedVersion = require('../package.json').version || '0.0.0';
  } catch (_) {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * Handle one raw stdin line. Malformed JSON → -32700 error frame; the loop
 * survives and processes subsequent lines (AC5).
 * @returns {Promise<string|null>} stdout line or null
 */
async function handleLine(server, line) {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (_) {
    return JSON.stringify(rpcError(null, ERR_PARSE, 'Parse error'));
  }
  const response = await handleMessage(server, msg);
  return response ? JSON.stringify(response) : null;
}

/**
 * Stdio loop: newline-delimited JSON-RPC over stdin/stdout. Resolves on EOF.
 * Logs go to stderr only — stdout carries protocol frames exclusively.
 */
async function runStdio(server, io) {
  const stdin = (io && io.stdin) || process.stdin;
  const stdout = (io && io.stdout) || process.stdout;
  const readline = require('readline');
  const rl = readline.createInterface({ input: stdin, terminal: false });
  process.stderr.write('[mcp-server] openclaw-dashboard MCP listening on stdio\n');
  for await (const line of rl) {
    const out = await handleLine(server, line);
    if (out !== null) stdout.write(out + '\n');
  }
  // Shutdown-only telemetry drain (bounded): the response path never waits
  // on emission, but exit must not kill an in-flight fire-and-forget POST.
  await drainTelemetry();
}

module.exports = {
  PROTOCOL_VERSION,
  DEFAULT_TASK_SERVER_URL,
  MISSION_CONTROL_SECTIONS,
  TOOLS,
  resolveMcpConfig,
  validateInput,
  dispatch,
  emitToolTelemetry,
  drainTelemetry,
  createMcpServer,
  handleMessage,
  handleLine,
  runStdio,
};
