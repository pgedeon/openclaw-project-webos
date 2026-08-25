#!/usr/bin/env node
/**
 * Focused DB-free tests for workflow visual editor Stage 1
 * (docs/briefs/workflow-visual-editor-stage1.md; work order scope):
 *   - lib/workflow-graph-layout.js pure helpers:
 *       layoutLayered  — linear chain degenerates to a single column;
 *                        synthetic depends_on branching honors longest path;
 *                        CYCLE INPUT THROWS (work-order contract)
 *       buildGraph     — string | object | mixed | unknown shapes, cap/truncation
 *       mergeRunStatus — keyed by step_name, missing → pending,
 *                        unknown statuses verbatim (timed_out), latest-run-wins
 *       stepIcon       — keyword table
 *   - routes/workflow-graph-routes.js:
 *       validateGraphEvent pure validation +
 *       endpoint degradation (no DB / missing table / write failure) via Router
 *
 * Run: node tests/test-workflow-graph.js
 */

const assert = require('assert');
const EventEmitter = require('events');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✔ ${name}`); },
        (err) => { failed++; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed++;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// Real-world shape: topic-discovery stores plain strings (brief §1 — 14/29
// templates are string-only; this fixture mirrors its 6-string array).
const TOPIC_DISCOVERY_STRINGS = [
  'Analyze existing content inventory',
  'Identify content gaps',
  'Research keyword opportunities',
  'Score candidate topics',
  'Rank topics by value',
  'Publish shortlist'
];

function mockReq(body) {
  const req = new EventEmitter();
  process.nextTick(() => {
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
  req.url = '/api/workflow-graph/events';
  req.headers = { host: 'localhost' };
  return req;
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    writeHead(status) { res.statusCode = status; },
    end(payload) { res.body = payload ? JSON.parse(payload) : null; }
  };
  return res;
}

function makeStubPool(queryImpl) {
  let calls = 0;
  return {
    get callCount() { return calls; },
    async query(...args) { calls++; return queryImpl(...args); }
  };
}

(async () => {
  // lib module loads dual-target (CJS require here; browser uses globalThis).
  const libPath = path.join(__dirname, '..', 'lib', 'workflow-graph-layout.js');
  const lib = require(libPath);
  const routesMod = require(path.join(__dirname, '..', 'routes', 'workflow-graph-routes.js'));
  const Router = require(path.join(__dirname, '..', 'routes', 'router.js'));

  console.log('workflow-graph-layout: layoutLayered (linear — ALL real data)');

  await check('linear string chain → single column, ranks 0..n−1, consecutive edges', () => {
    const g = lib.layoutLayered(TOPIC_DISCOVERY_STRINGS);
    assert.strictEqual(g.nodes.length, 6);
    assert.strictEqual(g.edges.length, 5);
    assert.deepStrictEqual(g.laidOut.map((n) => n.rank), [0, 1, 2, 3, 4, 5]);
    // Single column: every node shares the same x.
    assert.deepStrictEqual([...new Set(g.laidOut.map((n) => n.x))].length, 1);
    // Edges are consecutive pairs i → i+1.
    assert.deepStrictEqual(g.edges.map((e) => `${e.from}->${e.to}`),
      ['step-0->step-1', 'step-1->step-2', 'step-2->step-3', 'step-3->step-4', 'step-4->step-5']);
    // Geometry closed-form: height = ranks*H + (ranks-1)*gap.
    assert.strictEqual(g.height, 6 * lib.NODE_HEIGHT + 5 * lib.RANK_GAP);
    assert.ok(g.width >= lib.NODE_WIDTH);
  });

  await check('object steps preserve name/display_name/required', () => {
    const g = lib.layoutLayered([
      { name: 'drafting', display_name: 'Content Drafting', required: true },
      { name: 'review', display_name: 'QA Review', required: false }
    ]);
    assert.deepStrictEqual(g.nodes.map((n) => [n.name, n.display_name, n.required]), [
      ['drafting', 'Content Drafting', true],
      ['review', 'QA Review', false]
    ]);
  });

  await check('mixed shapes + unknown entries normalize without throwing (AC1 totality)', () => {
    const g = lib.layoutLayered([
      'plain string step',
      { name: 'object step' },
      42,
      null,
      { display_name: 'nameless object' }
    ]);
    assert.strictEqual(g.nodes.length, 5);
    assert.strictEqual(g.nodes[0].name, 'plain string step');
    assert.strictEqual(g.nodes[2].name, '(unnamed step 3)');
    assert.strictEqual(g.nodes[3].name, '(unnamed step 4)');
    assert.strictEqual(g.nodes[4].name, '(unnamed step 5)');
    assert.strictEqual(g.nodes[4].display_name, 'nameless object');
  });

  await check('empty/null/non-array inputs degrade to empty graph, never throw', () => {
    for (const input of [[], undefined, null, 'nope', 7]) {
      const g = lib.layoutLayered(input);
      assert.strictEqual(g.nodes.length, 0);
      assert.strictEqual(g.edges.length, 0);
      assert.strictEqual(g.total, Array.isArray(input) ? 0 : 0);
    }
  });

  console.log('workflow-graph-layout: layoutLayered (branching via depends_on)');

  await check('diamond honors longest-path ranks (A=0, B=C=1, D=2)', () => {
    const g = lib.layoutLayered([
      { name: 'a' },
      { name: 'b', depends_on: ['a'] },
      { name: 'c', depends_on: ['a'] },
      { name: 'd', depends_on: ['b', 'c'] }
    ]);
    const rankOf = Object.fromEntries(g.laidOut.map((n) => [n.name, n.rank]));
    assert.deepStrictEqual(rankOf, { a: 0, b: 1, c: 1, d: 2 });
    // Same-rank nodes spread horizontally (different x), centered per rank.
    const b = g.laidOut.find((n) => n.name === 'b');
    const c = g.laidOut.find((n) => n.name === 'c');
    assert.notStrictEqual(b.x, c.x);
    assert.strictEqual(b.y, c.y);
    assert.strictEqual(g.edges.length, 4);
  });

  await check('explicit deps win over consecutive order for that step', () => {
    const g = lib.layoutLayered([
      { name: 'a' },
      { name: 'b' },
      { name: 'c', depends_on: ['a'] } // skips b
    ]);
    assert.strictEqual(g.edges.length, 2);
    assert.ok(g.edges.some((e) => e.from === 'step-0' && e.to === 'step-2'));
    assert.ok(!g.edges.some((e) => e.from === 'step-1' && e.to === 'step-2'));
  });

  await check('depends_on naming unknown steps is ignored honestly (no crash, no phantom edge)', () => {
    const g = lib.layoutLayered([
      { name: 'a' },
      { name: 'b', depends_on: ['ghost-step'] }
    ]);
    assert.strictEqual(g.nodes.length, 2);
    assert.ok(!g.edges.some((e) => e.to === 'step-1'));
  });

  console.log('workflow-graph-layout: layoutLayered (cycle guard — work-order contract: THROW)');

  await check('two-node depends_on cycle throws Error(/cycle/)', () => {
    assert.throws(
      () => lib.layoutLayered([
        { name: 'a', depends_on: ['b'] },
        { name: 'b', depends_on: ['a'] }
      ]),
      /cycle/i
    );
  });

  await check('three-node cycle throws; self-reference stays tolerated (trivial loop skipped)', () => {
    assert.throws(
      () => lib.layoutLayered([
        { name: 'a', depends_on: ['c'] },
        { name: 'b', depends_on: ['a'] },
        { name: 'c', depends_on: ['b'] }
      ]),
      /cycle/i
    );
    // Self-dep is a degenerate no-op edge, not a renderable cycle.
    const g = lib.layoutLayered([{ name: 'a', depends_on: ['a'] }]);
    assert.strictEqual(g.nodes.length, 1);
    assert.strictEqual(g.edges.length, 0);
  });

  console.log('workflow-graph-layout: buildGraph caps');

  await check('40-step input caps at GRAPH_MAX_NODES=32 with honest total (AC4 math)', () => {
    const big = Array.from({ length: 40 }, (_, i) => `step ${i + 1}`);
    const g = lib.buildGraph(big);
    assert.strictEqual(lib.GRAPH_MAX_NODES, 32);
    assert.strictEqual(g.nodes.length, 32);
    assert.strictEqual(g.total, 40);
    assert.strictEqual(g.truncated, true);
    const full = lib.layoutLayered(big);
    assert.strictEqual(full.laidOut.length, 32);
  });

  console.log('workflow-graph-layout: mergeRunStatus');

  await check('statuses key by step_name onto template order; missing → pending', () => {
    const g = lib.buildGraph(['alpha', 'beta', 'gamma']);
    const merged = lib.mergeRunStatus(g.nodes, [
      { step_name: 'alpha', status: 'completed', started_at: 't1', finished_at: 't2' },
      { step_name: 'beta', status: 'in_progress' }
    ]);
    assert.deepStrictEqual(merged.map((n) => [n.name, n.status, n.tone]), [
      ['alpha', 'completed', 'success'],
      ['beta', 'in_progress', 'info'],
      ['gamma', 'pending', 'neutral']
    ]);
    assert.strictEqual(merged[0].started_at, 't1');
  });

  await check('unknown status strings pass through VERBATIM with neutral-unknown tone (timed_out)', () => {
    const g = lib.buildGraph(['alpha']);
    const merged = lib.mergeRunStatus(g.nodes, [{ step_name: 'alpha', status: 'timed_out' }]);
    assert.strictEqual(merged[0].status, 'timed_out'); // raw label preserved
    assert.strictEqual(merged[0].tone, 'unknown');     // never guessed into a legal bucket
  });

  await check('duplicate step_names: latest row wins', () => {
    const g = lib.buildGraph(['alpha']);
    const merged = lib.mergeRunStatus(g.nodes, [
      { step_name: 'alpha', status: 'failed' },
      { step_name: 'alpha', status: 'completed' }
    ]);
    assert.strictEqual(merged[0].status, 'completed');
  });

  await check('null/non-array run steps degrade to all-pending', () => {
    const g = lib.buildGraph(['alpha', 'beta']);
    for (const rows of [null, undefined, 'x']) {
      const merged = lib.mergeRunStatus(g.nodes, rows);
      assert.deepStrictEqual(merged.map((n) => n.status), ['pending', 'pending']);
    }
  });

  console.log('workflow-graph-layout: stepIcon');

  await check('keyword table maps families; unmatched → generic ◇', () => {
    assert.strictEqual(lib.stepIcon('wordpress-publish'), '🚀');
    assert.strictEqual(lib.stepIcon('qa-review'), '🔍');
    assert.strictEqual(lib.stepIcon('image-generation'), '🖼');
    assert.strictEqual(lib.stepIcon('validate-schema'), '✅');
    assert.strictEqual(lib.stepIcon('download-assets'), '⬇');
    assert.strictEqual(lib.stepIcon('deploy-fix'), '🔧');
    assert.strictEqual(lib.stepIcon('mystery-step'), '◇');
    assert.strictEqual(lib.stepIcon(null), '◇');
  });

  console.log('workflow-graph-routes: validateGraphEvent (pure)');

  await check('open event valid; helpful ignored; note trimmed + capped at 500', () => {
    const v = routesMod.validateGraphEvent({ event: 'open', template: 'topic-discovery', helpful: 'junk' });
    assert.deepStrictEqual([v.ok, v.event, v.template, v.helpful], [true, 'open', 'topic-discovery', null]);

    const longNote = 'x'.repeat(600);
    const v2 = routesMod.validateGraphEvent({ event: 'feedback', template: 'abc', helpful: true, note: `  ${longNote}  ` });
    assert.strictEqual(v2.ok, true);
    assert.strictEqual(v2.note.length, 500);
  });

  await check('feedback requires boolean helpful', () => {
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'feedback', template: 'abc' }).error, 'invalid_helpful');
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'feedback', template: 'abc', helpful: 'yes' }).error, 'invalid_helpful');
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'feedback', template: 'abc', helpful: false }).ok, true);
  });

  await check('named rejections: bad event, bad template shape, bad body', () => {
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'ping', template: 'abc' }).error, 'invalid_event');
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'open' }).error, 'invalid_template');
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'open', template: 'Topic Discovery' }).error, 'invalid_template');
    assert.strictEqual(routesMod.validateGraphEvent({ event: 'open', template: 'ABC' }).error, 'invalid_template');
    assert.strictEqual(routesMod.validateGraphEvent(null).error, 'invalid_body');
    assert.strictEqual(routesMod.validateGraphEvent('open').error, 'invalid_body');
    assert.strictEqual(routesMod.validateGraphEvent([]).error, 'invalid_body');
  });

  console.log('workflow-graph-routes: endpoint degradation + persistence');

  await check('registered route answers POST /api/workflow-graph/events', async () => {
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    assert.ok(router.list().some((r) => r.method === 'POST' && r.path === '/api/workflow-graph/events'));
  });

  await check('no DB pool → graceful 200 {stored:false, reason:no_database}', async () => {
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    const handled = await router.handle(mockReq({ event: 'open', template: 'topic-discovery' }), res, '/api/workflow-graph/events', 'POST', {});
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: false, reason: 'no_database' });
  });

  await check('with pool: open writes workflow-graph-open audit row', async () => {
    const seen = [];
    const pool = makeStubPool(async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; });
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ event: 'open', template: 'citation-improvement' }),
      res, '/api/workflow-graph/events', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: true, action: 'workflow-graph-open' });
    assert.strictEqual(pool.callCount, 1);
    assert.match(seen[0].sql, /INSERT INTO audit_log/);
    assert.strictEqual(seen[0].params[0], 'dashboard-operator');
    assert.strictEqual(seen[0].params[1], 'workflow-graph-open');
    assert.deepStrictEqual(JSON.parse(seen[0].params[2]), { template: 'citation-improvement' });
  });

  await check('with pool: feedback carries verdict + optional note', async () => {
    const seen = [];
    const pool = makeStubPool(async (sql, params) => { seen.push({ params }); return { rows: [] }; });
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ event: 'feedback', template: 'topic-discovery', helpful: false, note: 'keep it read-only' }),
      res, '/api/workflow-graph/events', 'POST',
      { asanaStorage: { pool } }
    );
    assert.deepStrictEqual(res.body, { stored: true, action: 'workflow-graph-feedback' });
    assert.deepStrictEqual(JSON.parse(seen[0].params[2]),
      { template: 'topic-discovery', helpful: false, note: 'keep it read-only' });
  });

  await check('audit_log table absent (42P01) → 200 {stored:false, reason:audit_log_missing}', async () => {
    const pool = makeStubPool(async () => { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; });
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ event: 'open', template: 'abc' }),
      res, '/api/workflow-graph/events', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { stored: false, reason: 'audit_log_missing' });
  });

  await check('unexpected write failure → honest 500 query_failed', async () => {
    const pool = makeStubPool(async () => { throw new Error('connection refused'); });
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq({ event: 'open', template: 'abc' }),
      res, '/api/workflow-graph/events', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { error: 'query_failed' });
  });

  await check('malformed JSON body → 400 invalid_body (never crashes route)', async () => {
    const pool = makeStubPool(async () => ({ rows: [] }));
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    const res = mockRes();
    await router.handle(
      mockReq('{not json'),
      res, '/api/workflow-graph/events', 'POST',
      { asanaStorage: { pool } }
    );
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid_body' });
    assert.strictEqual(pool.callCount, 0); // validation precedes any write
  });

  await check('validation precedes degradation: invalid body → named 400 even with NO pool', async () => {
    const router = new Router();
    routesMod.registerWorkflowGraphRoutes(router, {});
    for (const badBody of [
      { event: 'open', template: 'Bad Template!' },
      { event: 'feedback', template: 'abc' },
      { event: 'nope', template: 'abc' }
    ]) {
      const res = mockRes();
      await router.handle(mockReq(badBody), res, '/api/workflow-graph/events', 'POST', {});
      assert.strictEqual(res.statusCode, 400, JSON.stringify(badBody));
      assert.match(res.body.error, /^invalid_/);
    }
    // Valid body without a pool still degrades gracefully AFTER validation.
    const ok = mockRes();
    await router.handle(
      mockReq({ event: 'open', template: 'topic-discovery' }),
      ok, '/api/workflow-graph/events', 'POST', {}
    );
    assert.deepStrictEqual(ok.body, { stored: false, reason: 'no_database' });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
