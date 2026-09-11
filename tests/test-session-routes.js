#!/usr/bin/env node
/**
 * Focused tests for routes/session-routes.js.
 * Run: node tests/test-session-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers || {};
    },
    end(body) {
      this.body = body || '';
    },
    get json() {
      return JSON.parse(this.body || '{}');
    },
  };
}

function createMockReq(method, url) {
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on() {},
  };
}

async function dispatch(router, method, url) {
  const req = createMockReq(method, url);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, {});
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  return res;
}

function loadSessionRoutesWithReader(reader) {
  const readerPath = require.resolve('../lib/session-jsonl-reader');
  const routesPath = require.resolve('../routes/session-routes');
  const originalReader = require.cache[readerPath];
  const originalRoutes = require.cache[routesPath];

  delete require.cache[routesPath];
  require.cache[readerPath] = {
    id: readerPath,
    filename: readerPath,
    loaded: true,
    exports: reader,
  };

  const mod = require('../routes/session-routes');

  function restore() {
    delete require.cache[routesPath];
    if (originalRoutes) {
      require.cache[routesPath] = originalRoutes;
    }
    if (originalReader) {
      require.cache[readerPath] = originalReader;
    } else {
      delete require.cache[readerPath];
    }
  }

  return { ...mod, restore };
}

function createRouter(reader) {
  const loaded = loadSessionRoutesWithReader(reader);
  const router = new Router();
  loaded.registerSessionRoutes(router);
  return { router, loaded };
}

async function withFrozenNow(now, fn) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await fn();
  } finally {
    Date.now = originalNow;
  }
}

function assertRouteRegistered(router, method, path) {
  assert.ok(
    router.list().some((route) => route.method === method && route.path === path),
    `${method} ${path} should be registered`
  );
}

async function run() {
  const now = 1_700_000_000_000;

  await withFrozenNow(now, async () => {
    let listAgentsCalled = false;
    const { router, loaded } = createRouter({
      async listAgents() {
        listAgentsCalled = true;
        return [
          { agentId: 'main', sessions: 2 },
          { agentId: 'research', sessions: 1 },
        ];
      },
      async listSessions(agentId, opts) {
        assert.strictEqual(agentId, 'main');
        assert.deepStrictEqual(opts, { activeMinutes: null });
        return {
          agentId,
          count: 3,
          sessions: [
            { sessionId: 'old', key: 'agent:main:cron:old', updatedAt: now - (2 * 60 * 60 * 1000) },
            { sessionId: 'new', key: 'agent:main:webchat:new', updatedAt: now - 60_000 },
            { sessionId: 'recent', key: 'agent:main:subagent:recent', updatedAt: now - (30 * 60 * 1000) },
          ],
        };
      },
    });

    for (const [method, path] of [
      ['GET', '/api/oc/agents'],
      ['GET', '/api/oc/sessions'],
      ['GET', '/api/oc/sessions/:sessionId'],
      ['GET', '/api/oc/sessions/:sessionId/messages'],
    ]) {
      assertRouteRegistered(router, method, path);
    }

    assert.strictEqual(loaded.sessionChannel('agent:main:webchat:abc'), 'webchat');
    assert.strictEqual(loaded.sessionChannel('agent:main:subagent:uuid'), 'subagent');
    assert.strictEqual(loaded.sessionChannel('short-key'), 'unknown');
    assert.strictEqual(loaded.sessionChannel(null), 'unknown');
    assert.strictEqual(loaded.sessionIcon('telegram'), '✈️');
    assert.strictEqual(loaded.sessionIcon('not-real'), '❓');
    assert.strictEqual(loaded.sessionStatusColor({ updatedAt: now - 1_000 }), 'active');
    assert.strictEqual(loaded.sessionStatusColor({ updatedAt: now - (10 * 60 * 1000) }), 'recent');
    assert.strictEqual(loaded.sessionStatusColor({ updatedAt: now - (2 * 60 * 60 * 1000) }), 'idle');
    assert.strictEqual(loaded.sessionStatusColor({}), 'idle');

    const agents = await dispatch(router, 'GET', '/api/oc/agents');
    assert.strictEqual(agents.statusCode, 200);
    assert.deepStrictEqual(agents.json, {
      agents: [
        { agentId: 'main', sessions: 2 },
        { agentId: 'research', sessions: 1 },
      ],
    });
    assert.strictEqual(listAgentsCalled, true);

    const sessions = await dispatch(router, 'GET', '/api/oc/sessions');
    assert.strictEqual(sessions.statusCode, 200);
    assert.deepStrictEqual(sessions.json, {
      agentId: 'main',
      total: 3,
      sessions: [
        {
          sessionId: 'new',
          key: 'agent:main:webchat:new',
          updatedAt: now - 60_000,
          kind: 'webchat',
          channel: 'webchat',
          icon: '💬',
          status: 'active',
        },
        {
          sessionId: 'recent',
          key: 'agent:main:subagent:recent',
          updatedAt: now - (30 * 60 * 1000),
          kind: 'subagent',
          channel: 'subagent',
          icon: '🔧',
          status: 'recent',
        },
        {
          sessionId: 'old',
          key: 'agent:main:cron:old',
          updatedAt: now - (2 * 60 * 60 * 1000),
          kind: 'cron',
          channel: 'cron',
          icon: '⏰',
          status: 'idle',
        },
      ],
    });

    loaded.restore();
  });

  await withFrozenNow(now, async () => {
    let listSessionsArgs = null;
    const { router, loaded } = createRouter({
      async listSessions(agentId, opts) {
        listSessionsArgs = { agentId, opts };
        return {
          agentId,
          count: 2,
          sessions: [
            { sessionId: 'unknown', key: 'legacy', updatedAt: 0 },
            { sessionId: 'signal', key: 'agent:research:signal:abc', updatedAt: now - 1000 },
          ],
        };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions?agent=research&active=15');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(listSessionsArgs, { agentId: 'research', opts: { activeMinutes: 15 } });
    assert.strictEqual(res.json.agentId, 'research');
    assert.strictEqual(res.json.total, 2);
    assert.deepStrictEqual(res.json.sessions.map((s) => s.sessionId), ['signal', 'unknown']);
    assert.strictEqual(res.json.sessions[0].icon, '📱');
    assert.strictEqual(res.json.sessions[1].kind, 'unknown');
    assert.strictEqual(res.json.sessions[1].icon, '❓');

    loaded.restore();
  });

  await withFrozenNow(now, async () => {
    let allOpts = null;
    const { router, loaded } = createRouter({
      async listAllSessions(opts) {
        allOpts = opts;
        return [
          {
            agentId: 'main',
            sessions: [
              { sessionId: 'main-web', key: 'agent:main:webchat:1', updatedAt: now - 1000 },
            ],
          },
          {
            agentId: 'ops',
            sessions: [
              { sessionId: 'ops-discord', key: 'agent:ops:discord:2', updatedAt: now - 2000 },
              { sessionId: 'ops-dreaming', key: 'agent:ops:dreaming:3', updatedAt: now - 3_600_000 },
            ],
          },
        ];
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions?all=true&agent=ignored&active=60');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(allOpts, { activeMinutes: 60 });
    assert.deepStrictEqual(res.json.sessions.map((s) => [s.agentId, s.sessionId, s.kind, s.icon]), [
      ['main', 'main-web', 'webchat', '💬'],
      ['ops', 'ops-discord', 'discord', '🎮'],
      ['ops', 'ops-dreaming', 'dreaming', '💭'],
    ]);
    assert.strictEqual(res.json.total, 3);

    loaded.restore();
  });

  await withFrozenNow(now, async () => {
    let detailMetaArgs = null;
    let detailMessagesArgs = null;
    const { router, loaded } = createRouter({
      async getSessionMeta(sessionId, agentId) {
        detailMetaArgs = { sessionId, agentId };
        return {
          sessionId,
          key: 'agent:research:telegram:detail',
          updatedAt: now - 20_000,
          model: 'gpt-test',
        };
      },
      async readLastMessages(sessionId, agentId, count) {
        detailMessagesArgs = { sessionId, agentId, count };
        return {
          sessionId,
          messages: [{ line: 4, type: 'message', message: { role: 'assistant', content: 'hello' } }],
          totalLines: 8,
          hasOlder: true,
          oldestLine: 4,
        };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions/session-123?agent=research&messages=5');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(detailMetaArgs, { sessionId: 'session-123', agentId: 'research' });
    assert.deepStrictEqual(detailMessagesArgs, { sessionId: 'session-123', agentId: 'research', count: 5 });
    assert.deepStrictEqual(res.json, {
      sessionId: 'session-123',
      key: 'agent:research:telegram:detail',
      updatedAt: now - 20_000,
      model: 'gpt-test',
      kind: 'telegram',
      channel: 'telegram',
      icon: '✈️',
      status: 'active',
      messages: [{ line: 4, type: 'message', message: { role: 'assistant', content: 'hello' } }],
      totalLines: 8,
      hasOlder: true,
      oldestLine: 4,
    });

    loaded.restore();
  });

  await withFrozenNow(now, async () => {
    let defaultMessagesArgs = null;
    const { router, loaded } = createRouter({
      async getSessionMeta(sessionId, agentId) {
        return { sessionId, key: 'agent:main:webchat:default', updatedAt: now };
      },
      async readLastMessages(sessionId, agentId, count) {
        defaultMessagesArgs = { sessionId, agentId, count };
        return { messages: [], totalLines: 0, hasOlder: false, oldestLine: null };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions/default-session');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(defaultMessagesArgs, { sessionId: 'default-session', agentId: 'main', count: 30 });

    loaded.restore();
  });

  await withFrozenNow(now, async () => {
    const { router, loaded } = createRouter({
      async getSessionMeta() {
        return null;
      },
      async readLastMessages() {
        throw new Error('readLastMessages should not run for missing sessions');
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions/missing?agent=research');
    assert.strictEqual(res.statusCode, 404);
    assert.deepStrictEqual(res.json, { error: 'Session not found' });

    loaded.restore();
  });

  {
    let readArgs = null;
    const { router, loaded } = createRouter({
      async readMessages(sessionId, agentId, opts) {
        readArgs = { sessionId, agentId, opts };
        return {
          sessionId,
          messages: [{ line: 11, type: 'message', message: { role: 'user', content: 'next' } }],
          nextCursor: 12,
          hasMore: false,
        };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions/session-abc/messages?agent=ops&after=10&limit=25&filter=all');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(readArgs, {
      sessionId: 'session-abc',
      agentId: 'ops',
      opts: { after: 10, limit: 25, filter: 'all' },
    });
    assert.deepStrictEqual(res.json, {
      sessionId: 'session-abc',
      messages: [{ line: 11, type: 'message', message: { role: 'user', content: 'next' } }],
      nextCursor: 12,
      hasMore: false,
    });

    loaded.restore();
  }

  {
    let readArgs = null;
    const { router, loaded } = createRouter({
      async readMessages(sessionId, agentId, opts) {
        readArgs = { sessionId, agentId, opts };
        return { sessionId, messages: [], nextCursor: null, hasMore: false };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions/default-messages/messages');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(readArgs, {
      sessionId: 'default-messages',
      agentId: 'main',
      opts: { after: 0, limit: 50, filter: 'messages' },
    });

    loaded.restore();
  }

  {
    let invalidActiveArgs = null;
    const { router, loaded } = createRouter({
      async listSessions(agentId, opts) {
        invalidActiveArgs = { agentId, opts };
        return { agentId, count: 0, sessions: [] };
      },
    });

    const res = await dispatch(router, 'GET', '/api/oc/sessions?active=not-a-number');
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(invalidActiveArgs.agentId, 'main');
    assert.ok(Number.isNaN(invalidActiveArgs.opts.activeMinutes));
    assert.deepStrictEqual(res.json, { agentId: 'main', sessions: [], total: 0 });

    loaded.restore();
  }

  {
    const { router, loaded } = createRouter({
      async readMessages() {
        throw new Error('jsonl read failed');
      },
    });

    await assert.rejects(
      () => dispatch(router, 'GET', '/api/oc/sessions/error-session/messages'),
      /jsonl read failed/
    );

    loaded.restore();
  }

  {
    const { router, loaded } = createRouter({});

    await assert.rejects(
      () => dispatch(router, 'GET', '/api/oc/agents'),
      /reader\.listAgents is not a function/
    );

    loaded.restore();
  }

  console.log('Session route tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
