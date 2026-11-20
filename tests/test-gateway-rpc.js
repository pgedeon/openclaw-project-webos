#!/usr/bin/env node
/**
 * Fake-RPC harness for src/shell/gateway-rpc.mjs + workboard-view helpers.
 * Pattern mirrors tests/test-mcp-server.js (injected transport, no network).
 *
 * Run: node tests/test-gateway-rpc.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed += 1; console.log(`  ✔ ${name}`); },
        (err) => { failed += 1; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed += 1;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed += 1;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

function makeTransport(handler) {
  const calls = [];
  return {
    calls,
    async request(frame) {
      calls.push(frame);
      return handler(frame, calls.length);
    },
  };
}

(async () => {
  const rpcPath = path.join(__dirname, '..', 'src', 'shell', 'gateway-rpc.mjs');
  const viewPath = path.join(__dirname, '..', 'src', 'shell', 'native-views', 'workboard-view.mjs');
  const rpcMod = await import(pathToFileURL(rpcPath).href);
  const viewMod = await import(pathToFileURL(viewPath).href);

  const {
    GOVERNED_MOVE_TARGETS,
    allowedMoveTargets,
    buildConnectFrame,
    buildRequestFrame,
    compareNotifications,
    controlUiWorkboardUrl,
    createGatewayRpc,
    createGatewayUnavailableState,
    filterEventsAfterCursor,
    formatHeartbeatAge,
    groupCardsByStatus,
    heartbeatAgeMs,
    isAtOrBeforeCursor,
    nextNotificationCursor,
    selectGatewayConnectAuth,
    WORKBOARD_STATUSES,
  } = rpcMod;
  const { collectProofLinks, isGatewayUnavailablePayload, loadWorkboardSnapshot, refreshWorkboardLive } = viewMod;

  console.log('gateway-rpc: connect + auth');

  await check('connect frame carries own credential, never piggybacks Control UI', () => {
    const frame = buildConnectFrame({
      id: 'c1',
      auth: { token: 'tok-from-8120' },
      client: { id: 'webos-dashboard' },
    });
    assert.strictEqual(frame.type, 'req');
    assert.strictEqual(frame.method, 'connect');
    assert.strictEqual(frame.params.minProtocol, 4);
    assert.strictEqual(frame.params.maxProtocol, 4);
    assert.strictEqual(frame.params.admission.credential.token, 'tok-from-8120');
    assert.strictEqual(frame.params.client.id, 'webos-dashboard');
  });

  await check('selectGatewayConnectAuth prefers token over deviceToken/password', () => {
    const selected = selectGatewayConnectAuth({
      token: 't',
      deviceToken: 'd',
      password: 'p',
    });
    assert.strictEqual(selected.token, 't');
    assert.strictEqual(selected.deviceToken, undefined);
    assert.strictEqual(selected.password, undefined);
  });

  await check('device token used when no explicit token (own connect)', () => {
    const selected = selectGatewayConnectAuth({ deviceToken: 'dev-1' });
    assert.strictEqual(selected.deviceToken, 'dev-1');
    assert.strictEqual(selected.token, undefined);
  });

  console.log('gateway-rpc: notification cursor (mismatch #3/#4)');

  await check('events RPC rejects advance:true', async () => {
    const transport = makeTransport(async () => ({ ok: true, payload: { events: [] } }));
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    await rpc.connect();
    let threw = false;
    try {
      await rpc.notifications.events({ advance: true });
    } catch (error) {
      threw = /workboard.notifications.advance/.test(error.message);
    }
    assert.strictEqual(threw, true);
    assert.strictEqual(
      transport.calls.some((frame) => frame.method === 'workboard.notifications.events' && frame.params?.advance === true),
      false,
      'advance:true must never be sent on events',
    );
  });

  await check('poll issues events THEN advance as two RPCs and tracks cursor exactly', async () => {
    const events = [
      { id: 'e1', kind: 'completed', createdAt: 100, sequence: 100000 },
      { id: 'e2', kind: 'stale', createdAt: 200, sequence: 200000 },
    ];
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: { sessionId: 's' } };
      if (frame.method === 'workboard.notifications.events') {
        assert.strictEqual(frame.params.advance, undefined);
        return { ok: true, payload: { events } };
      }
      if (frame.method === 'workboard.notifications.advance') {
        return { ok: true, payload: { events, subscription: { lastEventId: 'e2', lastEventSequence: 200000 } } };
      }
      throw new Error(`unexpected ${frame.method}`);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const result = await rpc.notifications.poll();
    const methods = transport.calls.map((frame) => frame.method);
    assert.deepStrictEqual(methods, [
      'connect',
      'workboard.notifications.events',
      'workboard.notifications.advance',
    ]);
    assert.strictEqual(result.advanced, true);
    assert.strictEqual(rpc.cursor.lastEventId, 'e2');
    assert.strictEqual(rpc.cursor.lastEventSequence, 200000);
    assert.strictEqual(rpc.cursor.lastEventAt, 200);
  });

  await check('inclusive-exclusive: events at-or-before cursor are dropped', () => {
    const cursor = { lastEventId: 'e1', lastEventSequence: 100000, lastEventAt: 100 };
    const events = [
      { id: 'e1', createdAt: 100, sequence: 100000 },
      { id: 'e2', createdAt: 200, sequence: 200000 },
    ];
    assert.strictEqual(isAtOrBeforeCursor(events[0], cursor), true);
    assert.strictEqual(isAtOrBeforeCursor(events[1], cursor), false);
    assert.deepStrictEqual(filterEventsAfterCursor(events, cursor).map((e) => e.id), ['e2']);
  });

  await check('compareNotifications orders createdAt then sequence then id', () => {
    const a = { id: 'a', createdAt: 1, sequence: 2 };
    const b = { id: 'b', createdAt: 1, sequence: 3 };
    assert.ok(compareNotifications(a, b) < 0);
    const next = nextNotificationCursor([a, b]);
    assert.strictEqual(next.lastEventId, 'b');
    assert.strictEqual(next.lastEventSequence, 3);
  });

  console.log('gateway-rpc: read methods + degrade');

  await check('lists cards/stats/boards + durable tasks + automations', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.cards.list') return { ok: true, payload: { cards: [{ id: 'c1', status: 'ready', title: 'T' }], statuses: WORKBOARD_STATUSES } };
      if (frame.method === 'workboard.cards.stats') return { ok: true, payload: { total: 1 } };
      if (frame.method === 'workboard.boards.list') return { ok: true, payload: [{ id: 'default', name: 'Default' }] };
      if (frame.method === 'tasks.list') return { ok: true, payload: { tasks: [{ id: 't1' }] } };
      if (frame.method === 'cron.list') return { ok: true, payload: { jobs: [{ id: 'j1' }] } };
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const snap = await loadWorkboardSnapshot(rpc, { boardId: 'default' });
    assert.strictEqual(snap.available, true);
    assert.strictEqual(snap.cards[0].id, 'c1');
    assert.strictEqual(snap.stats.total, 1);
    assert.strictEqual(snap.boards[0].id, 'default');
    assert.strictEqual(snap.tasks[0].id, 't1');
    assert.strictEqual(snap.automations[0].id, 'j1');
    assert.ok(snap.columns.ready.length === 1);
    const methods = transport.calls.map((f) => f.method).filter((m) => m !== 'connect').sort();
    assert.deepStrictEqual(methods, [
      'cron.list',
      'tasks.list',
      'workboard.boards.list',
      'workboard.cards.list',
      'workboard.cards.stats',
    ]);
  });

  await check('missing transport degrades to gateway-unavailable (house contract)', async () => {
    const rpc = createGatewayRpc({ auth: { token: 't' } });
    const snap = await loadWorkboardSnapshot(rpc);
    assert.strictEqual(isGatewayUnavailablePayload(snap), true);
    assert.strictEqual(snap.reason, 'gateway-unavailable');
    assert.strictEqual(snap.available, false);
  });

  await check('transport throw maps to gateway-unavailable', async () => {
    const transport = makeTransport(async () => {
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'gateway-unavailable', reason: 'gateway-unavailable' });
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const snap = await loadWorkboardSnapshot(rpc);
    assert.strictEqual(snap.available, false);
    assert.strictEqual(snap.reason, 'gateway-unavailable');
  });

  await check('live refresh reloads only after events+advance poll', async () => {
    let listed = 0;
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.notifications.events') {
        return { ok: true, payload: { events: [{ id: 'n1', createdAt: 9, sequence: 9 }] } };
      }
      if (frame.method === 'workboard.notifications.advance') {
        return { ok: true, payload: { events: [{ id: 'n1', createdAt: 9, sequence: 9 }] } };
      }
      if (frame.method === 'workboard.cards.list') {
        listed += 1;
        return { ok: true, payload: { cards: [{ id: 'c1', status: 'running', title: `n${listed}` }] } };
      }
      if (frame.method === 'workboard.cards.stats') return { ok: true, payload: {} };
      if (frame.method === 'workboard.boards.list') return { ok: true, payload: [] };
      if (frame.method === 'tasks.list') return { ok: true, payload: [] };
      if (frame.method === 'cron.list') return { ok: true, payload: [] };
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const first = await loadWorkboardSnapshot(rpc);
    const second = await refreshWorkboardLive(rpc, first);
    assert.strictEqual(second.cards[0].title, 'n2');
    assert.ok(transport.calls.filter((f) => f.method === 'workboard.notifications.events').length >= 1);
    assert.ok(transport.calls.filter((f) => f.method === 'workboard.notifications.advance').length >= 1);
  });

  console.log('workboard-view: helpers');

  await check('groupCardsByStatus uses official status enum', () => {
    const columns = groupCardsByStatus([
      { id: '1', status: 'running' },
      { id: '2', status: 'blocked' },
      { id: '3', status: 'mystery' },
    ]);
    assert.strictEqual(columns.running[0].id, '1');
    assert.strictEqual(columns.blocked[0].id, '2');
    assert.strictEqual(columns.triage[0].id, '3');
    assert.deepStrictEqual(Object.keys(columns), WORKBOARD_STATUSES);
  });

  await check('heartbeat age + proof links + Control UI deep-link', () => {
    const now = 1_000_000;
    const card = {
      id: 'card-9',
      updatedAt: now - 120_000,
      metadata: {
        claim: { lastHeartbeatAt: now - 180_000 },
        proof: [{ label: 'ci', url: 'https://example.test/ci' }],
      },
    };
    assert.strictEqual(heartbeatAgeMs(card, now), 180_000);
    assert.strictEqual(formatHeartbeatAge(180_000), '3m ago');
    assert.deepStrictEqual(collectProofLinks(card), [{ label: 'ci', url: 'https://example.test/ci' }]);
    const url = controlUiWorkboardUrl({ cardId: 'card-9', boardId: 'ops' });
    assert.ok(url.startsWith('https://home.3dput.com/openclaw?'));
    assert.ok(url.includes('card=card-9'));
    assert.ok(url.includes('board=ops'));
    assert.ok(url.endsWith('#workboard'));
  });

  await check('request frame shape matches gateway req protocol', () => {
    const frame = buildRequestFrame('r1', 'workboard.cards.list', { boardId: 'default' });
    assert.deepStrictEqual(frame, {
      type: 'req',
      id: 'r1',
      method: 'workboard.cards.list',
      params: { boardId: 'default' },
    });
  });

  await check('createGatewayUnavailableState is house-contract shaped', () => {
    const state = createGatewayUnavailableState('bridge down');
    assert.deepStrictEqual(
      { available: state.available, reason: state.reason },
      { available: false, reason: 'gateway-unavailable' },
    );
  });

  console.log('gateway-rpc: phase 3a governed card move');

  await check('allowedMoveTargets matrix: done/running/unknown sources never movable', () => {
    assert.deepStrictEqual(allowedMoveTargets('ready'), ['todo', 'blocked', 'review']);
    assert.deepStrictEqual(allowedMoveTargets('todo'), ['ready', 'blocked', 'review']);
    assert.deepStrictEqual(allowedMoveTargets('blocked'), ['todo', 'ready', 'review']);
    assert.deepStrictEqual(allowedMoveTargets('review'), ['todo', 'ready', 'blocked']);
    assert.deepStrictEqual(allowedMoveTargets('running'), []);
    assert.deepStrictEqual(allowedMoveTargets('done'), []);
    assert.deepStrictEqual(allowedMoveTargets('mystery'), []);
    assert.deepStrictEqual(allowedMoveTargets(''), []);
    for (const from of WORKBOARD_STATUSES) {
      const targets = allowedMoveTargets(from);
      assert.strictEqual(targets.includes('done'), false, `${from} must never target done`);
      assert.strictEqual(targets.includes('running'), false, `${from} must never target running`);
      for (const target of targets) {
        assert.ok(GOVERNED_MOVE_TARGETS.includes(target), `${target} must be governed`);
        assert.notStrictEqual(target, from, 'self-move must not be offered');
      }
    }
  });

  await check('moveCard sends ONE workboard.cards.move frame with id+status (no retry)', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.cards.move') {
        return { ok: true, payload: { card: { id: 'c1', status: 'ready' } } };
      }
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const result = await rpc.cards.moveCard({ id: 'c1', status: 'ready', fromStatus: 'todo' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.moved, true);
    assert.strictEqual(result.card.status, 'ready');
    const moves = transport.calls.filter((frame) => frame.method === 'workboard.cards.move');
    assert.strictEqual(moves.length, 1, 'exactly one move frame, never a retry loop');
    assert.deepStrictEqual(moves[0].params, { id: 'c1', status: 'ready' });
    assert.deepStrictEqual(transport.calls.map((frame) => frame.method), ['connect', 'workboard.cards.move']);
  });

  await check('moveCard passes position only when finite', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.cards.move') return { ok: true, payload: { card: { id: 'c1', status: 'todo' } } };
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    await rpc.cards.moveCard({ id: 'c1', status: 'todo', position: 1500, fromStatus: 'ready' });
    const move = transport.calls.find((frame) => frame.method === 'workboard.cards.move');
    assert.deepStrictEqual(move.params, { id: 'c1', status: 'todo', position: 1500 });
  });

  await check('done move is refused client-side with a typed error and zero frames', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      throw new Error('must not send a move frame');
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    let error = null;
    try {
      await rpc.cards.moveCard({ id: 'c1', status: 'done', fromStatus: 'review' });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'done move must throw');
    assert.strictEqual(error.code, 'move-refused');
    assert.strictEqual(error.reason, 'done-requires-complete');
    assert.strictEqual(transport.calls.some((frame) => frame.method === 'workboard.cards.move'), false);
  });

  await check('unknown / running / intake statuses are refused client-side', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      throw new Error('must not send a move frame');
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const cases = [
      [{ id: 'c1', status: 'mystery' }, 'unknown-status'],
      [{ id: 'c1', status: 'running' }, 'target-not-allowed'],
      [{ id: 'c1', status: 'triage' }, 'target-not-allowed'],
      [{ id: 'c1', status: 'backlog' }, 'target-not-allowed'],
      [{ id: 'c1', status: 'scheduled' }, 'target-not-allowed'],
      [{ id: 'c1', status: 'ready', fromStatus: 'running' }, 'source-not-movable'],
      [{ id: 'c1', status: 'ready', fromStatus: 'done' }, 'source-not-movable'],
      [{ id: '', status: 'ready' }, 'missing-card-id'],
    ];
    for (const [params, reason] of cases) {
      let error = null;
      try {
        await rpc.cards.moveCard(params);
      } catch (caught) {
        error = caught;
      }
      assert.ok(error, `expected refusal for ${JSON.stringify(params)}`);
      assert.strictEqual(error.code, 'move-refused');
      assert.strictEqual(error.reason, reason);
    }
    assert.strictEqual(transport.calls.some((frame) => frame.method === 'workboard.cards.move'), false);
  });

  await check('scope/auth rejection degrades to typed state with reason, no retry', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.cards.move') {
        return { ok: false, error: { code: 'forbidden', message: 'missing scope workboard:write' } };
      }
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    const result = await rpc.cards.moveCard({ id: 'c1', status: 'ready', fromStatus: 'todo' });
    assert.strictEqual(result.available, false);
    assert.strictEqual(result.moved, false);
    assert.strictEqual(result.reason, 'gateway-scope-rejected');
    assert.ok(/scope/i.test(result.detail));
    assert.strictEqual(transport.calls.filter((frame) => frame.method === 'workboard.cards.move').length, 1);
  });

  await check('non-scope gateway failure throws so the drawer can show the real reason', async () => {
    const transport = makeTransport(async (frame) => {
      if (frame.method === 'connect') return { ok: true, payload: {} };
      if (frame.method === 'workboard.cards.move') {
        return { ok: false, error: { code: 'invalid-params', message: 'bad position' } };
      }
      throw new Error(frame.method);
    });
    const rpc = createGatewayRpc({ transport, auth: { token: 't' } });
    let error = null;
    try {
      await rpc.cards.moveCard({ id: 'c1', status: 'ready', fromStatus: 'todo' });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.strictEqual(error.code, 'invalid-params');
    assert.ok(/bad position/.test(error.message));
  });

  await check('drawer exposes only governed targets behind an explicit confirm (static)', () => {
    const source = fs.readFileSync(viewPath, 'utf8');
    assert.ok(source.includes('allowedMoveTargets(card.status)'), 'drawer must derive targets from the matrix');
    assert.ok(source.includes('data-move-target='), 'drawer must render explicit move buttons');
    assert.ok(source.includes('data-action="move-confirm"'), 'second click confirm required');
    assert.ok(source.includes('data-action="move-cancel"'));
    assert.ok(source.includes('fromStatus: card.status'), 'RPC call must pass the real source status');
    assert.strictEqual(/card\.status\s*=\s*['"]/.test(source), false, 'no optimistic status assignment');
    assert.strictEqual(source.includes("status: 'done'"), false, 'view must not hardcode a done move');
    assert.ok(!/'done'/.test(source.split('STATUS_META')[1]?.split('};')[0] || ''), 'done is display-only metadata');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
