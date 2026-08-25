#!/usr/bin/env node
/**
 * Focused tests for lib/mcp-server.js (slice 2 — full 13-tool catalog; the
 * mutating trio behind OPENCLAW_MCP_MUTATIONS=1, receipt-minted via
 * POST /api/actions/execute, docs/briefs/mcp-exposure.md).
 * Run: node tests/test-mcp-server.js
 *
 * DB-free: all backend calls go through an injected fetch stub. Covers the
 * slice-1 ACs (registry shape AC1, validation-before-fetch AC2, dispatch
 * golden paths incl. Authorization header AC3, structured business failures
 * AC4, protocol conformance + malformed-line survival AC5/AC9, allSettled
 * composition AC8, stdio framing round-trip via the real entry process,
 * no-secret-leakage AC10) plus slice 2: flag-off hides mutations (list AND
 * call — hidden-not-refused invariant), flag-on registers the trio (AC7),
 * and every mutation call mints a receipt envelope through the actions
 * pipeline with honest 503/unavailable mapping.
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const {
  TOOLS,
  MISSION_CONTROL_SECTIONS,
  PROTOCOL_VERSION,
  validateInput,
  dispatch,
  createMcpServer,
  handleMessage,
  handleLine,
} = require('../lib/mcp-server');

const TOKEN = 'test-bearer-token-do-not-leak-9f2c';
const DEPS = { fetchImpl: async () => { throw new Error('no fetch wired for this test'); }, baseUrl: 'http://127.0.0.1:3876', token: TOKEN };

function run(name, fn) {
  pending++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS: ${name}`);
      settle();
    })
    .catch((error) => {
      console.error(`FAIL: ${name}`);
      console.error(error);
      process.exit(1);
    });
}

let pending = 0;
let settledCount = 0;
function settle() {
  settledCount++;
  if (settledCount === pending) {
    console.log('PASS: mcp-server');
  }
}

/** Fetch stub recording calls; responses keyed by URL substring or '*'. */
function makeFetch(responses) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const match = Object.keys(responses).find((key) => key === '*' || url.includes(key));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    const spec = typeof responses[match] === 'function' ? responses[match](calls.length) : responses[match];
    if (spec.throw) throw new Error(spec.throw);
    return {
      status: spec.status || 200,
      json: async () => (spec.body === undefined ? null : spec.body),
    };
  };
  impl.calls = calls;
  return impl;
}

function makeServer(fetchImpl) {
  return createMcpServer({ env: { DASHBOARD_AUTH_TOKEN: TOKEN }, fetchImpl });
}

function makeMutatingServer(fetchImpl) {
  return createMcpServer({ env: { DASHBOARD_AUTH_TOKEN: TOKEN, OPENCLAW_MCP_MUTATIONS: '1' }, fetchImpl });
}

async function callTool(server, name, args, id) {
  const res = await handleMessage(server, {
    jsonrpc: '2.0', id: id || 1, method: 'tools/call', params: { name, arguments: args },
  });
  return res.result;
}

function contentOf(frame) {
  return JSON.parse(frame.content[0].text);
}

// ── Registry shape (AC1 slice-1 profile) ─────────────────────────────────

run('registry: 13 tools — 10 read-only + 3 mutating with correct names', () => {
  const expectedRead = [
    'list_tasks', 'get_task', 'get_costs_summary', 'get_cost_rollup',
    'list_budgets', 'get_budget_ledger', 'list_snapshots', 'get_fleet_status',
    'get_mission_control_summary', 'search_audit',
  ];
  const expectedMutating = ['create_task', 'update_task', 'create_snapshot'];
  assert.strictEqual(TOOLS.length, 13);
  assert.deepStrictEqual(TOOLS.filter((t) => t.class === 'read').map((t) => t.name).sort(), expectedRead.slice().sort());
  assert.deepStrictEqual(TOOLS.filter((t) => t.class === 'mutating').map((t) => t.name).sort(), expectedMutating.slice().sort());
});

run('registry: every tool has description + parseable JSON Schema inputSchema', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} description`);
    assert.strictEqual(tool.inputSchema.type, 'object');
    assert.ok(typeof tool.inputSchema.properties === 'object');
    JSON.stringify(tool); // must serialize cleanly for tools/list
  }
});

run('registry: mutating trio tagged class=mutating with receipt-carrying descriptions', () => {
  for (const name of ['create_task', 'update_task', 'create_snapshot']) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} registered`);
    assert.strictEqual(tool.class, 'mutating');
    assert.ok(tool.description.includes('receipt'), `${name} description mentions receipts`);
  }
  assert.ok(TOOLS.find((t) => t.name === 'create_task').inputSchema.required.includes('project_id'));
  assert.ok(TOOLS.find((t) => t.name === 'update_task').inputSchema.required.includes('patch'));
});

// ── Validation before fetch (AC2) ────────────────────────────────────────

run('validateInput: list_tasks defaults applied and ranges enforced', () => {
  const ok = validateInput('list_tasks', {});
  assert.ok(ok.ok);
  assert.strictEqual(ok.value.limit, 50);
  assert.strictEqual(ok.value.include_archived, false);

  assert.strictEqual(validateInput('list_tasks', { limit: 0 }).ok, false);
  assert.strictEqual(validateInput('list_tasks', { limit: 201 }).ok, false);
  assert.strictEqual(validateInput('list_tasks', { limit: 'ten' }).ok, false);
  assert.strictEqual(validateInput('list_tasks', { include_archived: 'yes' }).ok, false);
});

run('validateInput: get_task requires task_id', () => {
  assert.strictEqual(validateInput('get_task', {}).ok, false);
  assert.strictEqual(validateInput('get_task', { task_id: '' }).ok, false);
  assert.strictEqual(validateInput('get_task', { task_id: 't-1' }).value.task_id, 't-1');
});

run('validateInput: days > 90 rejected at boundary (mirrored MAX_DAYS clamp)', () => {
  assert.strictEqual(validateInput('get_costs_summary', { days: 91 }).ok, false);
  assert.strictEqual(validateInput('get_costs_summary', { days: 0 }).ok, false);
  assert.strictEqual(validateInput('get_costs_summary', { days: 90 }).value.days, 90);
  assert.strictEqual(validateInput('get_costs_summary', {}).value.days, 7);
});

run('validateInput: unknown group_by enum rejected naming legal values', () => {
  const bad = validateInput('get_cost_rollup', { group_by: 'banana' });
  assert.strictEqual(bad.ok, false);
  for (const legal of ['agent', 'department', 'workflow_type']) {
    assert.ok(bad.error.includes(legal), `error names ${legal}`);
  }
  assert.strictEqual(validateInput('get_cost_rollup', {}).value.group_by, 'agent');
});

run('validateInput: budget ledger period format enforced', () => {
  assert.strictEqual(validateInput('get_budget_ledger', {}).ok, false, 'budget_id required');
  assert.strictEqual(validateInput('get_budget_ledger', { budget_id: 'b1' }).value.period, 'current');
  assert.strictEqual(validateInput('get_budget_ledger', { budget_id: 'b1', period: '2026-08' }).value.period, '2026-08');
  assert.strictEqual(validateInput('get_budget_ledger', { budget_id: 'b1', period: 'August' }).ok, false);
  assert.strictEqual(validateInput('get_budget_ledger', { budget_id: 'b1', period: '2026-13' }).ok, false);
});

run('validateInput: mission control sections enum enforced', () => {
  const bad = validateInput('get_mission_control_summary', { sections: ['health', 'banana'] });
  assert.strictEqual(bad.ok, false);
  for (const legal of MISSION_CONTROL_SECTIONS) assert.ok(bad.error.includes(legal));
  const good = validateInput('get_mission_control_summary', { sections: ['costs', 'budgets'] });
  assert.deepStrictEqual(good.value.sections, ['costs', 'budgets']);
});

run('validateInput: search_audit ranges + date formats', () => {
  assert.strictEqual(validateInput('search_audit', { limit: 501 }).ok, false);
  assert.strictEqual(validateInput('search_audit', { offset: -1 }).ok, false);
  assert.strictEqual(validateInput('search_audit', { start_date: '08/01/2026' }).ok, false);
  const ok = validateInput('search_audit', {});
  assert.strictEqual(ok.value.limit, 100);
  assert.strictEqual(ok.value.offset, 0);
  assert.strictEqual(ok.value.governance_only, false);
});

run('validateInput: unknown parameters rejected naming allowed keys', () => {
  const bad = validateInput('get_costs_summary', { days: 7, banana: true });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.error.includes('banana'));
});

run('validation rejection issues ZERO business fetches (telemetry-aware zero-call assertion)', async () => {
  const fetchImpl = makeFetch({ '*': { body: {} } });
  const server = makeServer(fetchImpl);
  const frame = await callTool(server, 'get_cost_rollup', { group_by: 'banana' });
  // The fire-and-forget adoption telemetry POST is expected here (the attempt
  // reached the tool boundary and errored); what must stay at zero is any
  // BUSINESS upstream call.
  const businessCalls = fetchImpl.calls.filter((c) => !c.url.includes('/api/mcp/telemetry'));
  assert.strictEqual(businessCalls.length, 0, 'no business HTTP call on validation failure');
  const telemetryCall = fetchImpl.calls.find((c) => c.url.includes('/api/mcp/telemetry'));
  assert.ok(telemetryCall, 'validation rejection still emits an error-outcome telemetry event');
  assert.strictEqual(JSON.parse(telemetryCall.options.body).outcome, 'error');
  assert.strictEqual(frame.isError, true);
  const payload = contentOf(frame);
  assert.strictEqual(payload.error, 'invalid_params');
  assert.ok(payload.message.includes('workflow_type'));
});

// ── Dispatch golden paths (AC3) ──────────────────────────────────────────

run('dispatch list_tasks → GET /api/tasks/all + local status/limit composition', async () => {
  const rows = [
    { id: 't1', status: 'queued' }, { id: 't2', status: 'in_progress' }, { id: 't3', status: 'queued' },
  ];
  const fetchImpl = makeFetch({ '/api/tasks/all': { body: rows } });
  const outcome = await dispatch('list_tasks', { status: 'queued', limit: 1 }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  assert.strictEqual(outcome.payload.total, 2);
  assert.strictEqual(outcome.payload.truncated, true);
  assert.deepStrictEqual(outcome.payload.tasks.map((t) => t.id), ['t1']);
  const call = fetchImpl.calls[0];
  assert.ok(call.url.startsWith('http://127.0.0.1:3876/api/tasks/all'));
  assert.strictEqual(call.options.headers.Authorization, `Bearer ${TOKEN}`, 'bearer header present');
});

run('dispatch get_task → GET /api/tasks/:id URL-encoded', async () => {
  const fetchImpl = makeFetch({ '/api/tasks/t%201': { body: { id: 't 1', status: 'queued' } } });
  const outcome = await dispatch('get_task', { task_id: 't 1' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.payload.id, 't 1');
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/tasks/t%201'));
});

run('dispatch get_costs_summary → GET /api/costs/summary?days=7 default', async () => {
  const fetchImpl = makeFetch({ '/api/costs/summary': { body: { available: false, reason: 'no_database' } } });
  const outcome = await dispatch('get_costs_summary', {}, { ...DEPS, fetchImpl });
  assert.deepStrictEqual(outcome.payload, { available: false, reason: 'no_database' }, 'degradation passthrough');
  assert.strictEqual(outcome.isError, false);
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/costs/summary?days=7'));
});

run('dispatch get_cost_rollup → GET /api/costs/rollup?group_by=&days=', async () => {
  const fetchImpl = makeFetch({ '/api/costs/rollup': { body: { rollups: [] } } });
  await dispatch('get_cost_rollup', { group_by: 'department', days: 30 }, { ...DEPS, fetchImpl });
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/costs/rollup?group_by=department&days=30'));
});

run('dispatch list_budgets → GET /api/budgets', async () => {
  const fetchImpl = makeFetch({ '/api/budgets': { body: [{ id: 'b1', status: 'breached' }] } });
  const outcome = await dispatch('list_budgets', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.payload[0].status, 'breached');
  assert.strictEqual(fetchImpl.calls[0].url, 'http://127.0.0.1:3876/api/budgets');
});

run("dispatch get_budget_ledger {budget_id:'b1'} → GET /api/budgets/b1/ledger?period=current", async () => {
  const fetchImpl = makeFetch({ '/api/budgets/b1/ledger': { body: { events: [] } } });
  const outcome = await dispatch('get_budget_ledger', { budget_id: 'b1' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/budgets/b1/ledger?period=current'));
  assert.strictEqual(fetchImpl.calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
});

run('dispatch list_snapshots → GET /api/snapshots', async () => {
  const fetchImpl = makeFetch({ '/api/snapshots': { body: [{ snapshot_id: 's1' }] } });
  const outcome = await dispatch('list_snapshots', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.payload[0].snapshot_id, 's1');
  assert.ok(fetchImpl.calls[0].url.endsWith('/api/snapshots'));
});

run('dispatch get_fleet_status composes health+agents+running+stuck', async () => {
  const fetchImpl = makeFetch({
    '/api/health-status': { body: { ok: true } },
    '/api/agents/status': { body: { agents: [{ id: 'coder' }] } },
    '/api/workflow-runs?status=running&limit=5': { body: [{ run_id: 'r1' }] },
    '/api/workflow-runs/stuck': { body: [] },
  });
  const outcome = await dispatch('get_fleet_status', { running_limit: 5 }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  assert.strictEqual(outcome.payload.health.ok, true);
  assert.deepStrictEqual(outcome.payload.agents.agents, [{ id: 'coder' }]);
  assert.strictEqual(outcome.payload.running_runs[0].run_id, 'r1');
  assert.deepStrictEqual(outcome.payload.stuck_runs, []);
  assert.strictEqual(fetchImpl.calls.length, 4);
});

run('dispatch search_audit passes filters as exact URL-encoded query params (AC11)', async () => {
  const fetchImpl = makeFetch({ '/api/audit': { body: { logs: [], total: 0 } } });
  await dispatch(
    'search_audit',
    { q: 'owner reassign & review', actor: 'qa-bot', governance_only: true, start_date: '2026-08-01', end_date: '2026-08-25', limit: 25, offset: 5 },
    { ...DEPS, fetchImpl }
  );
  const url = fetchImpl.calls[0].url;
  assert.ok(url.includes('/api/audit?'));
  const qs = url.split('?')[1];
  const params = new URLSearchParams(qs);
  assert.strictEqual(params.get('q'), 'owner reassign & review', 'URL-encoded free text');
  assert.strictEqual(params.get('actor'), 'qa-bot');
  assert.strictEqual(params.get('governance_only'), 'true');
  assert.strictEqual(params.get('start_date'), '2026-08-01');
  assert.strictEqual(params.get('end_date'), '2026-08-25');
  assert.strictEqual(params.get('limit'), '25');
  assert.strictEqual(params.get('offset'), '5');
  assert.strictEqual(qs, new URLSearchParams([...new URLSearchParams(qs).entries()]).toString(), 'properly encoded');
});

run('dispatch get_mission_control_summary composes all sections server-side', async () => {
  const fetchImpl = makeFetch({
    '/api/health-status': { body: { ok: true } },
    '/api/openclaw/agents': { body: { agents: ['cli-a'] } },
    '/api/agents/status': { body: { agents: ['org-a'] } },
    '/api/tasks/all': { body: [{ id: 't1', status: 'queued' }, { id: 't2', status: 'done' }] },
    '/api/workflow-runs?status=running&limit=50': { body: [{ run_id: 'r-run' }] },
    '/api/workflow-runs/stuck': { body: [{ run_id: 'r-stuck' }] },
    '/api/workflow-runs?status=failed&limit=10': { body: [{ run_id: 'r-fail' }] },
    '/api/blockers/summary': { body: { blockers: [] } },
    '/api/cron/jobs': { body: { jobs: [] } },
    '/api/costs/summary': { body: { available: true } },
    '/api/budgets': { body: [{ id: 'b1' }] },
  });
  const outcome = await dispatch('get_mission_control_summary', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  const s = outcome.payload.sections;
  assert.strictEqual(s.health.ok, true);
  assert.deepStrictEqual(s.agents.cli_agents.agents, ['cli-a']);
  assert.deepStrictEqual(s.agents.org_agents.agents, ['org-a']);
  assert.strictEqual(s.queue.total, 1, 'queued filter applied locally');
  assert.strictEqual(s.queue.tasks[0].id, 't1');
  assert.strictEqual(s.runs.running[0].run_id, 'r-run');
  assert.strictEqual(s.runs.stuck[0].run_id, 'r-stuck');
  assert.strictEqual(s.runs.failed[0].run_id, 'r-fail');
  assert.ok(s.blockers.blockers);
  assert.ok(s.cron.jobs);
  assert.strictEqual(s.costs.available, true);
  assert.strictEqual(s.budgets[0].id, 'b1');
  assert.strictEqual(fetchImpl.calls.length, 11, 'one call per composed endpoint');
});

run('mission control sections subset only fetches requested endpoints', async () => {
  const fetchImpl = makeFetch({
    '/api/costs/summary': { body: { available: true } },
    '/api/budgets': { body: [] },
  });
  const outcome = await dispatch('get_mission_control_summary', { sections: ['costs', 'budgets'] }, { ...DEPS, fetchImpl });
  assert.strictEqual(Object.keys(outcome.payload.sections).length, 2);
  assert.strictEqual(fetchImpl.calls.length, 2);
});

// ── Structured failures (AC4) + unreachable backend ──────────────────────

run('upstream 404 → structured not_found result, not a thrown error', async () => {
  const fetchImpl = makeFetch({ '*': { status: 404, body: { error: 'Task not found' } } });
  const outcome = await dispatch('get_task', { task_id: 'missing' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false, 'business-level miss is a normal result');
  assert.deepStrictEqual(outcome.payload, { error: 'not_found' });
});

run('upstream 401 → auth_failed isError result with env hint', async () => {
  const fetchImpl = makeFetch({ '*': { status: 401, body: { error: 'unauthorized' } } });
  const outcome = await dispatch('list_budgets', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, true);
  assert.strictEqual(outcome.payload.error, 'auth_failed');
  assert.ok(outcome.payload.hint.includes('DASHBOARD_AUTH_TOKEN'));
});

run('task-server unreachable → structured isError result, never throws', async () => {
  const fetchImpl = makeFetch({ '*': { throw: 'connect ECONNREFUSED 127.0.0.1:3876' } });
  const outcome = await dispatch('get_costs_summary', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, true);
  assert.strictEqual(outcome.payload.error, 'task_server_unreachable');
  assert.ok(outcome.payload.detail.includes('ECONNREFUSED'));
});

run('upstream 500 → upstream_error carrying status', async () => {
  const fetchImpl = makeFetch({ '*': { status: 500, body: { error: 'boom' } } });
  const outcome = await dispatch('search_audit', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, true);
  assert.strictEqual(outcome.payload.error, 'upstream_error');
  assert.strictEqual(outcome.payload.status, 500);
});

// ── Protocol conformance (AC5) ───────────────────────────────────────────

run('initialize handshake responds with capabilities + pinned protocol version', async () => {
  const server = makeServer(makeFetch({}));
  const res = await handleMessage(server, {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test' } },
  });
  assert.strictEqual(res.result.protocolVersion, PROTOCOL_VERSION);
  assert.ok(res.result.capabilities.tools);
  assert.strictEqual(res.result.serverInfo.name, 'openclaw-dashboard');
});

run('ping → empty result; notifications get no reply', async () => {
  const server = makeServer(makeFetch({}));
  const pong = await handleMessage(server, { jsonrpc: '2.0', id: 7, method: 'ping' });
  assert.deepStrictEqual(pong.result, {});
  const silent = await handleMessage(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.strictEqual(silent, null, 'notification → no response frame');
  const idNull = await handleMessage(server, { jsonrpc: '2.0', id: null, method: 'ping' });
  assert.strictEqual(idNull.id, null, 'id:null is still a request and is answered');
});

run('unknown method → -32601', async () => {
  const server = makeServer(makeFetch({}));
  const res = await handleMessage(server, { jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert.strictEqual(res.error.code, -32601);
});

run('malformed JSON line → -32700 and loop survives to next line (AC5)', async () => {
  const server = makeServer(makeFetch({}));
  const first = await handleLine(server, '{this is not json');
  assert.strictEqual(JSON.parse(first).error.code, -32700);
  const second = await handleLine(server, '{"jsonrpc":"2.0","id":9,"method":"ping"}');
  assert.deepStrictEqual(JSON.parse(second).result, {});
});

run('invalid request frames → -32600', async () => {
  const server = makeServer(makeFetch({}));
  for (const line of ['"just a string"', '42', '{"method":"ping"}', '{"jsonrpc":"1.0","id":1,"method":"ping"}']) {
    const out = await handleLine(server, line);
    assert.strictEqual(JSON.parse(out).error.code, -32600, `line: ${line}`);
  }
  const blank = await handleLine(server, '   ');
  assert.strictEqual(blank, null, 'blank lines produce no output');
});

run('tools/list flag-off: exactly the 10 read-only tools over the wire', async () => {
  const server = makeServer(makeFetch({}));
  const res = await handleMessage(server, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.strictEqual(res.result.tools.length, 10);
  for (const tool of res.result.tools) {
    assert.ok(tool.name && tool.description && tool.inputSchema);
  }
  const names = res.result.tools.map((t) => t.name);
  for (const m of ['create_task', 'update_task', 'create_snapshot']) {
    assert.ok(!names.includes(m), `${m} hidden from tools/list without the flag`);
  }
});

run('tools/list flag-on: all 13 tools incl. the mutating trio', async () => {
  const server = makeMutatingServer(makeFetch({}));
  const res = await handleMessage(server, { jsonrpc: '2.0', id: 31, method: 'tools/list' });
  assert.strictEqual(res.result.tools.length, 13);
  const names = res.result.tools.map((t) => t.name);
  for (const m of ['create_task', 'update_task', 'create_snapshot']) {
    assert.ok(names.includes(m), `${m} listed with OPENCLAW_MCP_MUTATIONS=1`);
    const tool = res.result.tools.find((t) => t.name === m);
    assert.ok(tool.description && tool.inputSchema);
  }
});

// ── Hidden-not-refused invariant (slice 2 core requirement) ─────────────

run('flag-off: tools/call on a hidden mutation → -32601 method_not_found + ZERO fetches', async () => {
  const fetchImpl = makeFetch({ '*': { body: {} } });
  const server = makeServer(fetchImpl);
  for (const name of ['create_task', 'update_task', 'create_snapshot']) {
    const res = await handleMessage(server, {
      jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name, arguments: {} },
    });
    assert.strictEqual(res.error.code, -32601, `${name} answers method_not_found when hidden`);
    assert.ok(res.error.message.includes(name));
  }
  assert.strictEqual(fetchImpl.calls.length, 0, 'hidden mutations never reach HTTP');
});

run('unknown tools/call name → -32602 (distinct from hidden mutations)', async () => {
  const server = makeServer(makeFetch({}));
  const res = await handleMessage(server, {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nonexistent_tool', arguments: {} },
  });
  assert.strictEqual(res.error.code, -32602);
  assert.ok(res.error.message.includes('nonexistent_tool'));
});

// ── Slice 2: validation before fetch for the mutating trio ─────────────

run('validateInput: create_task requires title + project_id, optional strings enforced', () => {
  assert.strictEqual(validateInput('create_task', {}).ok, false);
  assert.strictEqual(validateInput('create_task', { title: 'x' }).ok, false);
  assert.strictEqual(validateInput('create_task', { project_id: 'p' }).ok, false);
  const ok = validateInput('create_task', { title: ' Fix login ', project_id: ' web ', due_date: '2026-09-01' });
  assert.ok(ok.ok);
  assert.strictEqual(ok.value.title, 'Fix login');
  assert.strictEqual(ok.value.project_id, 'web');
  assert.deepStrictEqual(ok.value.description, undefined);
  assert.strictEqual(validateInput('create_task', { title: 'x', project_id: 'p', status: 7 }).ok, false);
});

run('validateInput: update_task requires task_id + non-empty patch object', () => {
  assert.strictEqual(validateInput('update_task', {}).ok, false);
  assert.strictEqual(validateInput('update_task', { task_id: 't1' }).ok, false);
  assert.strictEqual(validateInput('update_task', { task_id: 't1', patch: 'status=done' }).ok, false);
  assert.strictEqual(validateInput('update_task', { task_id: 't1', patch: [] }).ok, false);
  assert.strictEqual(validateInput('update_task', { task_id: 't1', patch: {} }).ok, false, 'empty patch rejected');
  const ok = validateInput('update_task', { task_id: 't1', patch: { status: 'done', owner_agent: 'coder' } });
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.value.patch, { status: 'done', owner_agent: 'coder' }, 'patch passes through verbatim');
});

run('validateInput: create_snapshot optional name ≤120 chars', () => {
  assert.ok(validateInput('create_snapshot', {}).ok, 'no name → default minted at dispatch');
  assert.strictEqual(validateInput('create_snapshot', { name: 'ok-name' }).value.name, 'ok-name');
  assert.strictEqual(validateInput('create_snapshot', { name: '' }).ok, false);
  assert.strictEqual(validateInput('create_snapshot', { name: 'x'.repeat(121) }).ok, false);
});

// ── Slice 2: receipt-minting dispatch golden paths (AC7 + OQ2=YES) ──────

run('dispatch create_task → POST /api/actions/execute with task.create envelope', async () => {
  const fetchImpl = makeFetch({ '/api/actions/execute': { body: { receipt: { action_id: 'a1', kind: 'task.create', outcome: 'executed' } } } });
  const outcome = await dispatch(
    'create_task',
    { title: 'Ship slice 2', project_id: 'webos', description: 'mutating tools', owner_agent: 'coder' },
    { ...DEPS, fetchImpl }
  );
  assert.strictEqual(outcome.isError, false);
  assert.strictEqual(outcome.payload.receipt.kind, 'task.create');
  assert.strictEqual(outcome.payload.receipt.outcome, 'executed');
  assert.strictEqual(fetchImpl.calls.length, 1, 'exactly one pipeline call');
  const call = fetchImpl.calls[0];
  assert.ok(call.url.endsWith('/api/actions/execute'));
  assert.strictEqual(call.options.method, 'POST');
  assert.strictEqual(call.options.headers.Authorization, `Bearer ${TOKEN}`);
  const envelope = JSON.parse(call.options.body);
  assert.strictEqual(envelope.kind, 'task.create');
  assert.strictEqual(envelope.targetId, 'webos', 'project_id rides as targetId');
  assert.deepStrictEqual(envelope.params, { title: 'Ship slice 2', description: 'mutating tools', owner_agent: 'coder' });
  assert.strictEqual(envelope.actor, 'openclaw');
  assert.ok(typeof envelope.actionId === 'string' && envelope.actionId.length > 0);
  assert.ok(!/\s/.test(envelope.actionId), 'actionId has no whitespace (latch-safe)');
  assert.ok(envelope.actionId.length <= 200, 'actionId within registry length cap');
});

run('dispatch update_task → POST /api/actions/execute with verbatim patch', async () => {
  const fetchImpl = makeFetch({ '/api/actions/execute': { body: { receipt: { action_id: 'a2', kind: 'task.update', outcome: 'executed' } } } });
  const patch = { status: 'in_progress', owner_agent: 'qa-bot', notes: { nested: true } };
  const outcome = await dispatch('update_task', { task_id: 't-42', patch }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  const envelope = JSON.parse(fetchImpl.calls[0].options.body);
  assert.strictEqual(envelope.kind, 'task.update');
  assert.strictEqual(envelope.targetId, 't-42');
  assert.deepStrictEqual(envelope.params.patch, patch, 'validated patch object unchanged (AC7)');
});

run('dispatch create_snapshot → snapshot.create kind; default name minted client-side', async () => {
  const fetchImpl = makeFetch({ '/api/actions/execute': { body: { receipt: { action_id: 'a3', kind: 'snapshot.create', outcome: 'executed' } } } });
  const outcome = await dispatch('create_snapshot', {}, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  const envelope = JSON.parse(fetchImpl.calls[0].options.body);
  assert.strictEqual(envelope.kind, 'snapshot.create');
  assert.match(envelope.targetId, /^snapshot-\d{8}-\d{4}$/, 'default name mirrors server convention');
  assert.deepStrictEqual(envelope.params, {});

  const named = makeFetch({ '/api/actions/execute': { body: { receipt: { action_id: 'a4' } } } });
  await dispatch('create_snapshot', { name: 'pre-refactor' }, { ...DEPS, fetchImpl: named });
  assert.strictEqual(JSON.parse(named.calls[0].options.body).targetId, 'pre-refactor');
});

run('mutation outcomes: 503 no_database → structured unavailable isError (honest write refusal)', async () => {
  const fetchImpl = makeFetch({ '*': { status: 503, body: { available: false, reason: 'no_database' } } });
  const outcome = await dispatch('create_task', { title: 'x', project_id: 'p' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, true);
  assert.strictEqual(outcome.payload.error, 'unavailable');
  assert.strictEqual(outcome.payload.reason, 'no_database');
  assert.ok(outcome.payload.hint.includes('nothing executed'));
});

run('mutation outcomes: 404 execution_failed → not_found normal result carrying receipt', async () => {
  const fetchImpl = makeFetch({ '*': { status: 404, body: { error: 'execution_failed', message: 'Task not found', receipt: { action_id: 'a5', outcome: 'failed' } } } });
  const outcome = await dispatch('update_task', { task_id: 'ghost', patch: { status: 'done' } }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false, 'business-level miss is a normal result');
  assert.strictEqual(outcome.payload.error, 'not_found');
  assert.strictEqual(outcome.payload.receipt.action_id, 'a5', 'failed receipt kept alongside');
});

run('mutation outcomes: 403 rejected_governance → typed passthrough isError with receipt', async () => {
  const body = { error: 'rejected_governance', reason: 'governance denied', receipt: { action_id: 'a6', outcome: 'rejected_governance' } };
  const fetchImpl = makeFetch({ '*': { status: 403, body } });
  const outcome = await dispatch('create_task', { title: 'x', project_id: 'p' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, true);
  assert.strictEqual(outcome.payload.error, 'rejected_governance');
  assert.ok(outcome.payload.receipt);
});

run('mutation outcomes: duplicate replay (200 duplicate:true) is a normal result', async () => {
  const fetchImpl = makeFetch({ '/api/actions/execute': { body: { receipt: { action_id: 'a7', outcome: 'executed' }, duplicate: true } } });
  const outcome = await dispatch('create_snapshot', { name: 'again' }, { ...DEPS, fetchImpl });
  assert.strictEqual(outcome.isError, false);
  assert.strictEqual(outcome.payload.duplicate, true);
});

// ── Handler crash containment (AC9) ──────────────────────────────────────

run('throwing handler → -32603 frame, processor survives next message', async () => {
  const fetchImpl = makeFetch({
    // health ok, agents status THROWS inside json parsing simulation:
    '/api/health-status': { body: { ok: true } },
    '/api/agents/status': { body: { agents: [] } },
    '/api/workflow-runs?status=running&limit=20': { throw: 'socket hang up mid-flight' },
  });
  const server = makeServer(fetchImpl);
  // get_fleet_status without include_stuck hits the throwing third call via
  // allSettled → section unavailable, NOT a crash.
  const frame = await callTool(server, 'get_fleet_status', { include_stuck: false });
  assert.strictEqual(contentOf(frame).stuck_runs, undefined);
  assert.deepStrictEqual(contentOf(frame).running_runs, { section: 'unavailable' });

  // A genuinely throwing handler surfaces as -32603 and the processor lives on.
  const lib = require('../lib/mcp-server');
  const victim = lib.TOOLS.find((t) => t.name === 'list_budgets');
  const originalHandler = victim.handler;
  victim.handler = () => {
    throw new Error(`boom with token ${TOKEN}`);
  };
  let errFrame;
  try {
    const broken = makeServer(makeFetch({}));
    errFrame = await handleMessage(broken, {
      jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'list_budgets', arguments: {} },
    });
  } finally {
    victim.handler = originalHandler;
  }
  assert.strictEqual(errFrame.error.code, -32603);
  assert.ok(!JSON.stringify(errFrame).includes(TOKEN), 'internal error data redacts token');
  const alive = await handleMessage(makeServer(makeFetch({})), { jsonrpc: '2.0', id: 12, method: 'ping' });
  assert.deepStrictEqual(alive.result, {});
});

// ── allSettled semantics (AC8) ───────────────────────────────────────────

run('mission control: one failing section → unavailable marker, rest populated', async () => {
  const fetchImpl = makeFetch({
    '/api/health-status': { throw: 'connection reset' },
    '/api/openclaw/agents': { body: { agents: [] } },
    '/api/agents/status': { body: { agents: [] } },
    '/api/tasks/all': { body: [] },
    '/api/workflow-runs?status=running&limit=50': { body: [] },
    '/api/workflow-runs/stuck': { body: [] },
    '/api/workflow-runs?status=failed&limit=10': { body: [] },
    '/api/blockers/summary': { body: { blockers: [] } },
    '/api/cron/jobs': { body: { jobs: [] } },
    '/api/costs/summary': { body: { available: true } },
    '/api/budgets': { body: [] },
  });
  const outcome = await dispatch('get_mission_control_summary', {}, { ...DEPS, fetchImpl });
  const s = outcome.payload.sections;
  assert.deepStrictEqual(s.health, { section: 'unavailable' });
  assert.strictEqual(s.costs.available, true, 'remaining sections stay populated');
  assert.strictEqual(s.runs.running.length, 0);
});

// ── No secret leakage (AC10) ─────────────────────────────────────────────

run('token never appears in any tool result or error string', async () => {
  const outputs = [];
  const probe = async (fetchSpec, toolName, args) => {
    const fetchImpl = makeFetch(fetchSpec);
    const frame = await callTool(makeServer(fetchImpl), toolName, args);
    outputs.push(frame.content[0].text);
    if (frame.isError) outputs.push(String(frame.isError));
  };

  await probe({ '*': { throw: `fatal with token ${TOKEN} embedded` } }, 'get_costs_summary', {});
  await probe({ '*': { status: 401, body: {} } }, 'list_budgets', {});
  await probe({ '*': { status: 500, body: { echo: TOKEN } } }, 'search_audit', {});
  await probe({ '/api/tasks/all': { body: [{ secret: TOKEN }] } }, 'list_tasks', {});

  // Protocol-layer error paths too.
  const server = makeServer(makeFetch({}));
  outputs.push(JSON.stringify(await handleMessage(server, { jsonrpc: '2.0', id: 1, method: 'nope' })));
  outputs.push(JSON.stringify(await handleLine(server, 'garbage {{{')));

  for (const out of outputs) {
    assert.ok(!out.includes(TOKEN), `token leaked: ${out.slice(0, 200)}`);
  }
});

// ── Adoption telemetry emission (fire-and-forget contract) ──────────────

run('telemetry: successful tools/call fires exactly one POST /api/mcp/telemetry with ok outcome', async () => {
  const fetchImpl = makeFetch({
    '/api/budgets': { body: [] },
    '/api/mcp/telemetry': { body: { stored: true, action: 'mcp-tool-call' } },
  });
  const frame = await callTool(makeServer(fetchImpl), 'list_budgets', {});
  assert.strictEqual(frame.isError, undefined, 'tool result unaffected by telemetry');
  const calls = fetchImpl.calls.filter((c) => c.url.includes('/api/mcp/telemetry'));
  assert.strictEqual(calls.length, 1, 'exactly one telemetry POST per executed call');
  const call = calls[0];
  assert.strictEqual(call.options.method, 'POST');
  assert.strictEqual(call.options.headers.Authorization, `Bearer ${TOKEN}`);
  const event = JSON.parse(call.options.body);
  assert.strictEqual(event.tool, 'list_budgets');
  assert.strictEqual(event.outcome, 'ok');
  assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0, 'durationMs is a non-negative integer');
});

run('telemetry: isError tool result emits error outcome; upstream failure still answers the client', async () => {
  const fetchImpl = makeFetch({
    '/api/budgets': { throw: 'connection reset' },
    '/api/mcp/telemetry': { body: { stored: true } },
  });
  const frame = await callTool(makeServer(fetchImpl), 'list_budgets', {});
  assert.strictEqual(frame.isError, true, 'client still gets its structured isError result');
  const event = JSON.parse(fetchImpl.calls.find((c) => c.url.includes('/api/mcp/telemetry')).options.body);
  assert.strictEqual(event.tool, 'list_budgets');
  assert.strictEqual(event.outcome, 'error');
});

run('telemetry: telemetry endpoint failure is swallowed — tool result byte-identical', async () => {
  const good = makeFetch({ '/api/budgets': { body: [{ id: 'b1' }] } });
  const frameWithoutTelemetry = await callTool(makeServer(makeFetch({ '/api/budgets': { body: [{ id: 'b1' }] } })), 'list_budgets', {});
  // Telemetry POST itself throws (unreachable) — must not alter the result.
  const fetchImpl = makeFetch({
    '/api/budgets': { body: [{ id: 'b1' }] },
    '/api/mcp/telemetry': { throw: 'ECONNREFUSED telemetry sink down' },
  });
  const frame = await callTool(makeServer(fetchImpl), 'list_budgets', {});
  assert.strictEqual(frame.content[0].text, frameWithoutTelemetry.content[0].text,
    'result identical whether or not the telemetry sink is up');
  assert.ok(!JSON.stringify(frame).includes(TOKEN));
});

run('telemetry: protocol-level rejects emit NOTHING (unknown tool -32602, hidden mutation -32601)', async () => {
  const fetchImpl = makeFetch({ '*': { body: {} } });
  const server = makeServer(fetchImpl);
  await handleMessage(server, { jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'nonexistent_tool', arguments: {} } });
  await handleMessage(server, { jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'create_task', arguments: {} } });
  assert.strictEqual(fetchImpl.calls.length, 0, 'probes are not tool usage — no telemetry rows');
});

// ── Stdio framing round-trip through the real entry process ─────────────

run('stdio framing: real mcp-server.js process survives malformed line + answers ping', () => {
  const root = path.resolve(__dirname, '..');
  const input = [
    'not-json-at-all {{{',
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    '',
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
    '',
  ].join('\n');
  const res = spawnSync(process.execPath, [path.join(root, 'mcp-server.js')], {
    input,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, DASHBOARD_AUTH_TOKEN: TOKEN },
  });
  assert.strictEqual(res.status, 0, `exit 0 (stderr: ${res.stderr})`);
  const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 4, 'four frames back (blank lines silent)');
  assert.strictEqual(lines[0].error.code, -32700);
  assert.strictEqual(lines[1].result.protocolVersion, PROTOCOL_VERSION);
  assert.strictEqual(lines[2].result.tools.length, 10, 'flag-off stdio profile is read-only');
  assert.deepStrictEqual(lines[3].result, {});
  assert.ok(!res.stdout.includes(TOKEN), 'no token on stdout');

  // Flag-on spawn: the trio appears over real stdio too.
  const resOn = spawnSync(process.execPath, [path.join(root, 'mcp-server.js')], {
    input,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, DASHBOARD_AUTH_TOKEN: TOKEN, OPENCLAW_MCP_MUTATIONS: '1' },
  });
  assert.strictEqual(resOn.status, 0, `flag-on exit 0 (stderr: ${resOn.stderr})`);
  const linesOn = resOn.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(linesOn[2].result.tools.length, 13, 'flag-on stdio profile lists the trio');
});

// All run() calls above register async assertions; the process stays alive
// until their promises settle, then the final PASS line prints (settle()).
