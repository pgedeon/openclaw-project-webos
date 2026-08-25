#!/usr/bin/env node
/**
 * Focused DB-free tests for lib/task-session-binding.js — the pure mappers
 * behind GET /api/tasks/:id/sessions (docs/briefs/task-session-binding.md).
 *
 * Covered (brief AC3 mapping matrix + §3 liveness contract):
 * - parseSessionKey: 3-part legacy (`agent:main:main`), 4-part, 5+ part ids,
 *   null/empty/foreign keys → null (never guessed)
 * - deriveLiveness: full migration-001 ∪ 021 status vocabulary →
 *   live | completed | failed; unknown → failed (never offers a live link)
 * - buildTaskSessionBindings: newest-first ordering incl. started_at fallback
 *   to created_at, active-run flag, session-key join against a fixture index
 *   (orphaned rows keep sessionId:null and get NO deepLink), replay vs console
 *   deep-link routing, retry-cycled honesty flag, empty inputs → []
 * - module purity surface: only the documented functions/constants exported
 *
 * Run: node tests/test-task-session-binding.js
 */

const assert = require('assert');
const {
  LIVE_RUN_STATUSES,
  FAILED_RUN_STATUSES,
  parseSessionKey,
  deriveLiveness,
  toEpochMs,
  buildTaskSessionBindings,
} = require('../lib/task-session-binding');

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

const T0 = Date.parse('2026-08-25T12:00:00Z');

(async () => {

  console.log('parseSessionKey');

  await check('4-part key parses agentId/kind/id', () => {
    assert.deepStrictEqual(parseSessionKey('agent:coder:webchat:abc123'), {
      agentId: 'coder', kind: 'webchat', id: 'abc123', key: 'agent:coder:webchat:abc123',
    });
  });

  await check('3-part legacy key maps id onto the kind segment', () => {
    assert.deepStrictEqual(parseSessionKey('agent:main:main'), {
      agentId: 'main', kind: 'main', id: 'main', key: 'agent:main:main',
    });
  });

  await check('5-part key keeps the rest as the id (uuid-ish session ids)', () => {
    const parsed = parseSessionKey('agent:coder:subagent:b07a014a-075c');
    assert.strictEqual(parsed.agentId, 'coder');
    assert.strictEqual(parsed.kind, 'subagent');
    assert.strictEqual(parsed.id, 'b07a014a-075c');
  });

  await check('null / empty / non-agent keys are unresolvable, never guessed', () => {
    for (const bad of [null, undefined, '', 'main', 'cron:nightly', 'agentx:main:main', '::']) {
      assert.strictEqual(parseSessionKey(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  console.log('deriveLiveness');

  await check('active statuses map to live', () => {
    for (const s of ['queued', 'dispatched', 'blocked', 'claimed', 'running', 'waiting_for_approval', 'retrying']) {
      assert.strictEqual(deriveLiveness(s), 'live', `${s} should be live`);
    }
  });

  await check('completed maps to completed', () => {
    assert.strictEqual(deriveLiveness('completed'), 'completed');
  });

  await check('terminal failure statuses map to failed', () => {
    for (const s of ['failed', 'cancelled', 'timed_out']) {
      assert.strictEqual(deriveLiveness(s), 'failed', `${s} should be failed`);
    }
  });

  await check('unknown/empty/null status degrades to failed (never live)', () => {
    for (const s of [null, undefined, '', 'weird_status', 'COMPLETED'.toLowerCase() && 'Completed ']) {
      assert.strictEqual(deriveLiveness(s), 'failed');
    }
    // sanity: the literal completed still works after the odd fixture above
    assert.strictEqual(deriveLiveness('completed'), 'completed');
  });

  await check('status sets are disjoint and cover the documented vocabulary', () => {
    const all = new Set([...LIVE_RUN_STATUSES, ...FAILED_RUN_STATUSES, 'completed']);
    for (const expected of ['queued', 'dispatched', 'claimed', 'running', 'waiting_for_approval',
      'blocked', 'retrying', 'completed', 'failed', 'cancelled', 'timed_out']) {
      assert.ok(all.has(expected), `${expected} missing from liveness vocabulary`);
    }
    for (const s of LIVE_RUN_STATUSES) assert.ok(!FAILED_RUN_STATUSES.has(s));
  });

  console.log('buildTaskSessionBindings');

  const INDEX = [
    { key: 'agent:coder:webchat:s-live', sessionId: 'sess-live', agentId: 'coder' },
    { key: 'agent:coder:main:s-done', sessionId: 'sess-done', agentId: 'coder' },
    { key: 'agent:main:main', sessionId: 'legacy-main', agentId: 'main' },
    // duplicate key entry must not shadow the first
    { key: 'agent:coder:webchat:s-live', sessionId: 'SHADOWED', agentId: 'coder' },
  ];

  await check('empty inputs produce []', () => {
    assert.deepStrictEqual(buildTaskSessionBindings([], []), []);
    assert.deepStrictEqual(buildTaskSessionBindings(null, undefined), []);
    // A run row with no fields at all still maps to the full null-shaped binding.
    assert.deepStrictEqual(buildTaskSessionBindings([{ id: 'r1' }], [])[0], {
      runId: 'r1', workflowType: null, runStatus: null, isActiveRun: false,
      sessionKey: null, agentId: null, sessionId: null, sessionActive: false,
      liveness: 'failed', startedAt: null, finishedAt: null, heartbeatAt: null,
      retryCount: 0, retryCycled: false, deepLink: null,
    });
  });

  await check('multi-run task orders newest-run-first with created_at fallback', () => {
    const runs = [
      { id: 'old', workflow_type: 'code-change', status: 'completed', gateway_session_id: 'agent:coder:main:s-done', started_at: new Date(T0 - 3600000).toISOString(), created_at: new Date(T0 - 7200000).toISOString() },
      { id: 'newest', workflow_type: 'code-change', status: 'running', gateway_session_id: 'agent:coder:webchat:s-live', started_at: new Date(T0).toISOString(), created_at: new Date(T0).toISOString() },
      { id: 'no-start', workflow_type: 'code-change', status: 'queued', gateway_session_id: null, created_at: new Date(T0 - 60000).toISOString() },
    ];
    const out = buildTaskSessionBindings(runs, INDEX);
    assert.deepStrictEqual(out.map(b => b.runId), ['newest', 'no-start', 'old']);
  });

  await check('live run joins the index and routes to console by session KEY', () => {
    const [b] = buildTaskSessionBindings(
      [{ id: 'r1', workflow_type: 'code-change', status: 'running', gateway_session_id: 'agent:coder:webchat:s-live', started_at: T0 }],
      INDEX
    );
    assert.strictEqual(b.liveness, 'live');
    assert.strictEqual(b.sessionId, 'sess-live'); // first index entry wins over the shadow
    assert.deepStrictEqual(b.deepLink, { view: 'console', params: { agent: 'coder', session: 'agent:coder:webchat:s-live' } });
  });

  await check('completed run with retained key routes to replay by sessionId', () => {
    const [b] = buildTaskSessionBindings(
      [{ id: 'r2', workflow_type: 'code-change', status: 'completed', gateway_session_id: 'agent:coder:main:s-done', started_at: T0, finished_at: T0 + 1000 }],
      INDEX
    );
    assert.strictEqual(b.liveness, 'completed');
    assert.strictEqual(b.sessionActive, false);
    assert.deepStrictEqual(b.deepLink, { view: 'session-replay', params: { agent: 'coder', session: 'sess-done' } });
  });

  await check('orphaned key (pruned sessions.json entry) keeps sessionId null and gets NO deepLink', () => {
    const [b] = buildTaskSessionBindings(
      [{ id: 'r3', workflow_type: 'code-change', status: 'completed', gateway_session_id: 'agent:gone:main:pruned', started_at: T0 }],
      INDEX
    );
    assert.strictEqual(b.sessionKey, 'agent:gone:main:pruned');
    assert.strictEqual(b.agentId, 'gone');
    assert.strictEqual(b.sessionId, null);
    assert.strictEqual(b.deepLink, null);
  });

  await check('queued run without a key is pending-shaped: no key, no link', () => {
    const [b] = buildTaskSessionBindings(
      [{ id: 'r4', workflow_type: 'code-change', status: 'queued', gateway_session_id: null, created_at: T0 }],
      INDEX
    );
    assert.strictEqual(b.liveness, 'live'); // queued is still an active run
    assert.strictEqual(b.sessionKey, null);
    assert.strictEqual(b.agentId, null);
    assert.strictEqual(b.deepLink, null);
  });

  await check('isActiveRun flags exactly the task pointer target', () => {
    const runs = [
      { id: 'r-active', status: 'running', gateway_session_id: 'agent:coder:webchat:s-live', started_at: T0 },
      { id: 'r-other', status: 'completed', gateway_session_id: 'agent:coder:main:s-done', started_at: T0 - 1 },
    ];
    const out = buildTaskSessionBindings(runs, INDEX, { activeRunId: 'r-active' });
    assert.strictEqual(out.find(b => b.runId === 'r-active').isActiveRun, true);
    assert.strictEqual(out.find(b => b.runId === 'r-other').isActiveRun, false);
  });

  await check('retry-cycled run carries the R1 honesty flag', () => {
    const [retried] = buildTaskSessionBindings(
      [{ id: 'r9', status: 'completed', gateway_session_id: 'agent:coder:main:s-done', retry_count: 2, started_at: T0 }],
      INDEX
    );
    assert.strictEqual(retried.retryCycled, true);
    assert.strictEqual(retried.retryCount, 2);
    const [fresh] = buildTaskSessionBindings(
      [{ id: 'r10', status: 'completed', gateway_session_id: 'agent:coder:main:s-done', retry_count: 0, started_at: T0 }],
      INDEX
    );
    assert.strictEqual(fresh.retryCycled, false);
  });

  await check('camelCase row shapes map identically (defensive parity)', () => {
    const snake = buildTaskSessionBindings(
      [{ id: 'rc', workflow_type: 't', status: 'completed', gateway_session_id: 'agent:main:main', gateway_session_active: true, started_at: T0, last_heartbeat_at: T0 }],
      INDEX
    )[0];
    const camel = buildTaskSessionBindings(
      [{ id: 'rc', workflowType: 't', status: 'completed', gatewaySessionId: 'agent:main:main', gatewaySessionActive: true, startedAt: T0, lastHeartbeatAt: T0 }],
      INDEX
    )[0];
    assert.deepStrictEqual(camel, snake);
  });

  await check('pg Date objects and epoch numbers both normalize via toEpochMs', () => {
    assert.strictEqual(toEpochMs(new Date(T0)), T0);
    assert.strictEqual(toEpochMs(T0), T0);
    assert.strictEqual(toEpochMs(new Date(T0).toISOString()), T0);
    assert.strictEqual(toEpochMs(null), null);
    assert.strictEqual(toEpochMs('not-a-date'), null);
  });

  await check('module exports stay on the documented pure surface', () => {
    const mod = require('../lib/task-session-binding');
    for (const k of ['parseSessionKey', 'deriveLiveness', 'toEpochMs', 'buildTaskSessionBindings', 'LIVE_RUN_STATUSES', 'FAILED_RUN_STATUSES']) {
      assert.ok(k in mod, `missing export ${k}`);
    }
    const src = require('fs').readFileSync(require.resolve('../lib/task-session-binding'), 'utf8');
    assert.ok(!/require\('fs'\)/.test(src), 'module must not touch fs');
    assert.ok(!/fetch|http\.request|net\./.test(src), 'module must not touch network');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
