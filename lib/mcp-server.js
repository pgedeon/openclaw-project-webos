'use strict';
/**
 * MCP Server core — expose the dashboard AS an MCP tool provider.
 *
 * Per docs/briefs/mcp-exposure.md. Slice 1: protocol core + the 10 read-only
 * tools. The mutating trio (create_task/update_task/create_snapshot) lands in
 * slice 2 behind OPENCLAW_MCP_MUTATIONS=1 and is deliberately NOT registered
 * here yet (hidden-not-refused invariant: a read-only client never sees write
 * affordances).
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
 * Degradation honesty: business-level misses (404) and availability bodies
 * ({available:false, reason:'no_database'}) surface as normal tool results;
 * operational failures (task-server unreachable, auth rejected, upstream 5xx)
 * surface as isError tool results. The server loop itself never crashes on
 * backend failure or malformed input.
 */


const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TASK_SERVER_URL = 'http://127.0.0.1:3876';

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
  // Slice 2 gates the mutating trio on OPENCLAW_MCP_MUTATIONS=1; slice 1
  // registers no mutating tools at all, so the flag is parsed but inert here.
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

/** Promise.allSettled section picker over RAW httpJson outcomes:
 *  rejected / unreachable / non-2xx / empty body → {section:'unavailable'};
 *  otherwise the picked payload. Never throws. */
function settledSection(entry, pick) {
  const okHttp =
    entry.status === 'fulfilled' &&
    entry.value &&
    entry.value.kind === 'http' &&
    entry.value.status >= 200 &&
    entry.value.status < 300 &&
    entry.value.payload !== null &&
    entry.value.payload !== undefined;
  if (!okHttp) return { section: 'unavailable' };
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
    const s =
      outcome.status === 'fulfilled' && outcome.value && outcome.value.kind === 'http' && outcome.value.status >= 200 && outcome.value.status < 300
        ? outcome.value.payload
        : null;
    bySection[section].push(s);
  }

  const sections = {};
  if (has('health')) {
    sections.health = bySection.health[0] ? bySection.health[0] : { section: 'unavailable' };
  }
  if (has('agents')) {
    const cli = bySection.agents[0];
    const org = bySection.agents[1];
    sections.agents =
      cli && org ? { cli_agents: cli, org_agents: org } : { section: 'unavailable' };
  }
  if (has('queue')) {
    const raw = bySection.queue[0];
    let rows = Array.isArray(raw) ? raw : Array.isArray(raw && raw.tasks) ? raw.tasks : null;
    sections.queue =
      rows === null
        ? { section: 'unavailable' }
        : (() => {
            const queued = rows.filter((t) => t && t.status === 'queued').slice(0, 200);
            return { tasks: queued, total: queued.length };
          })();
  }
  if (has('runs')) {
    const [running, stuck, failed] = bySection.runs;
    sections.runs =
      running !== null && stuck !== null && failed !== null
        ? { running, stuck, failed }
        : { section: 'unavailable' };
  }
  if (has('blockers')) sections.blockers = bySection.blockers[0] || { section: 'unavailable' };
  if (has('cron')) sections.cron = bySection.cron[0] || { section: 'unavailable' };
  if (has('costs')) sections.costs = bySection.costs[0] || { section: 'unavailable' };
  if (has('budgets')) sections.budgets = bySection.budgets[0] || { section: 'unavailable' };

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

function publicToolDescriptors() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
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
        return isNotification ? null : rpcResult(id, { tools: publicToolDescriptors() });
      case 'tools/call': {
        if (isNotification) return null;
        const name = params.name;
        if (typeof name !== 'string') {
          return rpcError(id, ERR_INVALID_PARAMS, 'tools/call requires a tool name');
        }
        if (!TOOLS.some((t) => t.name === name)) {
          // Slice 2 adds the mutating trio behind OPENCLAW_MCP_MUTATIONS=1;
          // until then unregistered means unlisted (hidden-not-refused).
          return rpcError(id, ERR_INVALID_PARAMS, `Unknown tool: ${name}`);
        }
        const args = params.arguments === undefined ? {} : params.arguments;
        const outcome = await dispatch(name, args, server.deps);
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
}

module.exports = {
  PROTOCOL_VERSION,
  DEFAULT_TASK_SERVER_URL,
  MISSION_CONTROL_SECTIONS,
  TOOLS,
  resolveMcpConfig,
  validateInput,
  dispatch,
  createMcpServer,
  handleMessage,
  handleLine,
  runStdio,
};
