#!/usr/bin/env node
/**
 * Adapter-path tests for lib/mcp-server.js — the list_tasks/get_task seam
 * between httpJson() and mapUpstream() that shipped the 2026-08-29 staging
 * failure: GET /api/tasks/all 500'd on the drifted staging DB and the MCP
 * list_tasks tool errored 8/8 in adoption telemetry, with no DB-free test
 * catching it because nothing exercised httpJson error propagation THROUGH
 * the list_tasks composition.
 *
 * Split of responsibilities vs the neighboring suites (no duplication):
 *   - tests/test-mcp-server.js — registry/validation/protocol/telemetry,
 *     ONE list_tasks golden path (array payload, truncated=true), and the
 *     generic upstream 401/404/500/unreachable mapping via OTHER tools.
 *   - tests/test-e2e-mcp-snapshot-flows.js — real child process + real HTTP.
 *   - THIS file — fake-fetch harness over the list_tasks/get_task adapter
 *     paths themselves: every upstream outcome shape × the local
 *     composition (status filter, limit, truncated, query building), with
 *     the error-BODY-preservation assertions the generic tests don't make.
 *
 * DB-free: no sockets, no database — upstream is an injected fetch stub.
 * Run: node tests/test-mcp-adapter.js
 */

const assert = require('assert');
const {
  dispatch,
  createMcpServer,
  handleMessage,
} = require('../lib/mcp-server');

const TOKEN = 'adapter-test-bearer-token-7c41';
const BASE = 'http://127.0.0.1:3876';

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

const deps = (fetchImpl) => ({ fetchImpl, baseUrl: BASE, token: TOKEN });

async function run() {
  let passed = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (err) {
      console.error(`FAIL ${name}`);
      console.error(err);
      process.exitCode = 1;
      throw err;
    }
  };

  // ── The shipped-bug shape: upstream 500 through list_tasks ──────────

  await step('list_tasks upstream 500 → isError upstream_error with the error body preserved verbatim', async () => {
    const body = { error: 'Internal Server Error', hint: 'relation "tasks" does not exist' };
    const fetchImpl = makeFetch({ '/api/tasks/all': { status: 500, body } });
    const outcome = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(outcome.isError, true, 'operational failure must surface as isError');
    assert.strictEqual(outcome.payload.error, 'upstream_error');
    assert.strictEqual(outcome.payload.status, 500);
    assert.deepStrictEqual(outcome.payload.detail, body, 'upstream error body preserved, not collapsed');
    assert.strictEqual(fetchImpl.calls.length, 1, 'exactly one upstream call');
  });

  await step('list_tasks 500 does not poison the loop — next call on the same deps succeeds', async () => {
    const fetchImpl = makeFetch({
      '/api/tasks/all': (n) => (n === 1 ? { status: 500, body: { error: 'boom' } } : { body: [{ id: 't1', status: 'queued' }] }),
    });
    const first = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(first.isError, true);
    const second = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(second.isError, false);
    assert.strictEqual(second.payload.total, 1);
  });

  await step('list_tasks 500 over the wire: isError frame, body preserved, token-echoing body scrubbed', async () => {
    const body = { error: 'boom', echo: TOKEN };
    const fetchImpl = makeFetch({ '/api/tasks/all': { status: 500, body } });
    const server = createMcpServer({ env: { DASHBOARD_AUTH_TOKEN: TOKEN }, fetchImpl });
    const res = await handleMessage(server, {
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} },
    });
    const frame = res.result;
    assert.strictEqual(frame.isError, true, 'isError flag rides the frame');
    const text = frame.content[0].text;
    assert.ok(text.includes('upstream_error'), 'typed error in frame text');
    assert.ok(text.includes('boom'), 'error body preserved in frame text');
    assert.ok(!text.includes(TOKEN), 'token echoed by upstream must be scrubbed from the frame');
    assert.ok(text.includes('[redacted]'), 'scrub marker present');
  });

  // ── Auth rejection through the shipped-bug tool ─────────────────────

  await step('list_tasks upstream 401 → auth_failed isError, composition never runs', async () => {
    const fetchImpl = makeFetch({ '/api/tasks/all': { status: 401, body: { error: 'unauthorized' } } });
    const outcome = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(outcome.isError, true);
    assert.strictEqual(outcome.payload.error, 'auth_failed');
    assert.ok(outcome.payload.hint.includes('DASHBOARD_AUTH_TOKEN'));
    assert.strictEqual(outcome.payload.tasks, undefined, 'no local composition on auth failure');
  });

  // ── 2xx payload shapes × local composition ──────────────────────────

  await step('list_tasks 200 {tasks:[...]} envelope → filter/limit/total/truncated over envelope rows', async () => {
    const fetchImpl = makeFetch({
      '/api/tasks/all': {
        body: {
          tasks: [
            { id: 't1', status: 'queued' },
            { id: 't2', status: 'in_progress' },
            { id: 't3', status: 'queued' },
          ],
        },
      },
    });
    const outcome = await dispatch('list_tasks', { status: 'queued', limit: 1 }, deps(fetchImpl));
    assert.strictEqual(outcome.isError, false);
    assert.strictEqual(outcome.payload.total, 2);
    assert.strictEqual(outcome.payload.truncated, true);
    assert.deepStrictEqual(outcome.payload.tasks.map((t) => t.id), ['t1']);
  });

  await step('list_tasks 200 unrecognized shape → passthrough verbatim, no keys injected', async () => {
    const body = { weird: 'degradation body', nested: { x: 1 } };
    const fetchImpl = makeFetch({ '/api/tasks/all': { body } });
    const outcome = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(outcome.isError, false);
    assert.deepStrictEqual(outcome.payload, body, 'unrecognized shape passes through byte-identical');
    assert.strictEqual(outcome.payload.tasks, undefined, 'no tasks/total/truncated keys invented');
  });

  await step('list_tasks 200 {available:false, reason:no_database} → passthrough verbatim, not mangled into an empty list', async () => {
    const body = { available: false, reason: 'no_database' };
    const fetchImpl = makeFetch({ '/api/tasks/all': { body } });
    const outcome = await dispatch('list_tasks', {}, deps(fetchImpl));
    assert.strictEqual(outcome.isError, false, 'degradation body is a normal result');
    assert.deepStrictEqual(outcome.payload, body, 'degradation body preserved exactly');
    assert.strictEqual(outcome.payload.tasks, undefined);
  });

  await step('list_tasks truncated=false + exact total when rows fit under the limit', async () => {
    const rows = [
      { id: 't1', status: 'queued' },
      { id: 't2', status: 'queued' },
    ];
    const fetchImpl = makeFetch({ '/api/tasks/all': { body: rows } });
    const outcome = await dispatch('list_tasks', { status: 'queued', limit: 50 }, deps(fetchImpl));
    assert.strictEqual(outcome.isError, false);
    assert.strictEqual(outcome.payload.total, 2);
    assert.strictEqual(outcome.payload.truncated, false, 'no truncation when total ≤ limit');
    assert.deepStrictEqual(outcome.payload.tasks.map((t) => t.id), ['t1', 't2']);
  });

  await step('list_tasks query composition: project_id + include_archived ride the URL, default call is bare', async () => {
    const fetchImpl = makeFetch({ '/api/tasks/all': { body: [] } });
    await dispatch('list_tasks', { project_id: 'web os', include_archived: true }, deps(fetchImpl));
    const url = fetchImpl.calls[0].url;
    assert.ok(url.startsWith(`${BASE}/api/tasks/all?`), `query built: ${url}`);
    const qs = new URLSearchParams(url.split('?')[1]);
    assert.strictEqual(qs.get('project_id'), 'web os', 'project_id URL-encoded');
    assert.strictEqual(qs.get('include_archived'), 'true');
    assert.strictEqual(qs.get('status'), null, 'status filter is applied locally, never sent upstream');

    const bare = makeFetch({ '/api/tasks/all': { body: [] } });
    await dispatch('list_tasks', {}, deps(bare));
    assert.strictEqual(bare.calls[0].url, `${BASE}/api/tasks/all`, 'no query string on default call');
    assert.strictEqual(bare.calls[0].options.method, 'GET');
  });

  await step('list_tasks rows without a status field: filtered out under a status filter, kept unfiltered, no crash', async () => {
    const rows = [
      { id: 't1', status: 'queued' },
      { id: 't2' }, // no status at all
      { id: 't3', status: null }, // null status
    ];
    const filtered = makeFetch({ '/api/tasks/all': { body: rows } });
    const out = await dispatch('list_tasks', { status: 'queued' }, deps(filtered));
    assert.strictEqual(out.payload.total, 1, 'status-less rows excluded under a filter');
    assert.deepStrictEqual(out.payload.tasks.map((t) => t.id), ['t1']);

    const unfiltered = makeFetch({ '/api/tasks/all': { body: rows } });
    const all = await dispatch('list_tasks', {}, deps(unfiltered));
    assert.strictEqual(all.payload.total, 3, 'status-less rows kept without a filter');
  });

  await step('list_tasks limit boundary: 201 rows at limit=200 → 200 tasks, truncated true', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ id: `t${i}`, status: 'queued' }));
    const fetchImpl = makeFetch({ '/api/tasks/all': { body: rows } });
    const outcome = await dispatch('list_tasks', { limit: 200 }, deps(fetchImpl));
    assert.strictEqual(outcome.isError, false);
    assert.strictEqual(outcome.payload.total, 201);
    assert.strictEqual(outcome.payload.tasks.length, 200);
    assert.strictEqual(outcome.payload.truncated, true);
  });

  // ── get_task error path (happy path + 404 live in test-mcp-server.js) ─

  await step('get_task upstream 500 → isError upstream_error with the error body preserved', async () => {
    const body = { error: 'query_failed', details: 'column t.deleted_at does not exist' };
    const fetchImpl = makeFetch({ '/api/tasks/t-42': { status: 500, body } });
    const outcome = await dispatch('get_task', { task_id: 't-42' }, deps(fetchImpl));
    assert.strictEqual(outcome.isError, true);
    assert.strictEqual(outcome.payload.error, 'upstream_error');
    assert.strictEqual(outcome.payload.status, 500);
    assert.deepStrictEqual(outcome.payload.detail, body);
  });

  console.log(`\ntest-mcp-adapter: ${passed} checks passed`);
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});