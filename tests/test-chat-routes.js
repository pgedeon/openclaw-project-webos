#!/usr/bin/env node
/**
 * Focused tests for routes/chat-routes.js.
 * Run: node tests/test-chat-routes.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerChatRoutes } = require('../routes/chat-routes');

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

function createMockReq(method, url, body) {
  const bodyText = body === undefined ? '' : body;
  return {
    method,
    url,
    headers: { host: 'localhost:3876' },
    on(event, handler) {
      if (event === 'data' && bodyText) {
        queueMicrotask(() => handler(Buffer.from(bodyText)));
      }
      if (event === 'end') {
        queueMicrotask(handler);
      }
    },
  };
}

async function dispatch(router, method, url, body) {
  const req = createMockReq(method, url, body);
  const res = createMockRes();
  const pathname = url.split('?')[0];
  const handled = await router.handle(req, res, pathname, method, {});
  assert.notStrictEqual(handled, false, `${method} ${url} should be handled`);
  return res;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function createRouter(gatewayClient) {
  const router = new Router();
  registerChatRoutes(router, gatewayClient);
  return router;
}

function createGateway(overrides = {}) {
  return {
    connected: true,
    url: 'ws://gateway.test',
    chatSend: async () => ({ runId: 'run-default' }),
    chatAbort: async () => ({ aborted: true }),
    chatHistory: async () => [],
    ...overrides,
  };
}

function gatewayError(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

async function run() {
  const router = createRouter(createGateway());
  const expectedRoutes = [
    ['POST', '/api/oc/chat/send'],
    ['POST', '/api/oc/chat/abort'],
    ['GET', '/api/oc/chat/status'],
    ['POST', '/api/agent/chat'],
    ['GET', '/api/agent/chat/history'],
  ];

  for (const [method, path] of expectedRoutes) {
    assert.ok(
      router.list().some((route) => route.method === method && route.path === path),
      `${method} ${path} should be registered`
    );
  }

  const missingGatewayStatus = await dispatch(createRouter(null), 'GET', '/api/oc/chat/status');
  assert.strictEqual(missingGatewayStatus.statusCode, 200);
  assert.deepStrictEqual(missingGatewayStatus.json, { connected: false, gatewayUrl: null });

  const connectedStatus = await dispatch(router, 'GET', '/api/oc/chat/status');
  assert.strictEqual(connectedStatus.statusCode, 200);
  assert.deepStrictEqual(connectedStatus.json, { connected: true, gatewayUrl: 'ws://gateway.test' });

  for (const gateway of [null, createGateway({ connected: false })]) {
    const res = await dispatch(createRouter(gateway), 'POST', '/api/oc/chat/send', jsonBody({
      sessionKey: 'session-unavailable',
      message: 'hello',
    }));
    assert.strictEqual(res.statusCode, 503);
    assert.deepStrictEqual(res.json, { error: 'Gateway not connected' });
  }

  let sentPayload = null;
  const sendSuccess = await dispatch(createRouter(createGateway({
    async chatSend(payload) {
      sentPayload = payload;
      return { runId: 'run-123' };
    },
  })), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-success',
    message: '  hello agent  ',
  }));
  assert.strictEqual(sendSuccess.statusCode, 200);
  assert.deepStrictEqual(sendSuccess.json, { ok: true, runId: 'run-123' });
  assert.deepStrictEqual(sentPayload, { sessionKey: 'session-success', message: 'hello agent' });

  const sendIdFallback = await dispatch(createRouter(createGateway({
    async chatSend() {
      return { id: 'run-from-id' };
    },
  })), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-id-fallback',
    message: 'hello',
  }));
  assert.deepStrictEqual(sendIdFallback.json, { ok: true, runId: 'run-from-id' });

  const sendNullRunId = await dispatch(createRouter(createGateway({
    async chatSend() {
      return {};
    },
  })), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-null-run',
    message: 'hello',
  }));
  assert.deepStrictEqual(sendNullRunId.json, { ok: true, runId: null });

  const invalidJson = await dispatch(createRouter(createGateway()), 'POST', '/api/oc/chat/send', '{not json');
  assert.strictEqual(invalidJson.statusCode, 400);
  assert.deepStrictEqual(invalidJson.json, { error: 'sessionKey required' });

  const missingSession = await dispatch(createRouter(createGateway()), 'POST', '/api/oc/chat/send', jsonBody({
    message: 'hello',
  }));
  assert.strictEqual(missingSession.statusCode, 400);
  assert.deepStrictEqual(missingSession.json, { error: 'sessionKey required' });

  const missingMessage = await dispatch(createRouter(createGateway()), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-missing-message',
  }));
  assert.strictEqual(missingMessage.statusCode, 400);
  assert.deepStrictEqual(missingMessage.json, { error: 'message required' });

  const blankMessage = await dispatch(createRouter(createGateway()), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-blank-message',
    message: '   ',
  }));
  assert.strictEqual(blankMessage.statusCode, 400);
  assert.deepStrictEqual(blankMessage.json, { error: 'message required' });

  let oversizedCalled = false;
  const oversizedMessage = await dispatch(createRouter(createGateway({
    async chatSend() {
      oversizedCalled = true;
      return {};
    },
  })), 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-too-long',
    message: 'x'.repeat(10001),
  }));
  assert.strictEqual(oversizedMessage.statusCode, 400);
  assert.deepStrictEqual(oversizedMessage.json, { error: 'Message too long (max 10000 chars)' });
  assert.strictEqual(oversizedCalled, false);

  let rateLimitSends = 0;
  const rateRouter = createRouter(createGateway({
    async chatSend() {
      rateLimitSends++;
      return { runId: `run-${rateLimitSends}` };
    },
  }));
  for (let i = 0; i < 30; i++) {
    const res = await dispatch(rateRouter, 'POST', '/api/oc/chat/send', jsonBody({
      sessionKey: 'session-rate-limit',
      message: `message ${i}`,
    }));
    assert.strictEqual(res.statusCode, 200);
  }
  const limited = await dispatch(rateRouter, 'POST', '/api/oc/chat/send', jsonBody({
    sessionKey: 'session-rate-limit',
    message: 'message 31',
  }));
  assert.strictEqual(limited.statusCode, 429);
  assert.deepStrictEqual(limited.json, { error: 'Rate limit exceeded' });
  assert.strictEqual(rateLimitSends, 30);

  for (const [code, status] of [
    ['SESSION_NOT_FOUND', 404],
    ['SESSION_BUSY', 409],
    ['RATE_LIMITED', 429],
    [undefined, 500],
  ]) {
    const errorResult = await dispatch(createRouter(createGateway({
      async chatSend() {
        throw gatewayError(`send failed ${status}`, code);
      },
    })), 'POST', '/api/oc/chat/send', jsonBody({
      sessionKey: `session-error-${status}`,
      message: 'hello',
    }));
    assert.strictEqual(errorResult.statusCode, status);
    assert.deepStrictEqual(errorResult.json, {
      error: `send failed ${status}`,
      code: code || null,
    });
  }

  const abortDisconnected = await dispatch(createRouter(null), 'POST', '/api/oc/chat/abort', jsonBody({
    sessionKey: 'session-abort',
  }));
  assert.strictEqual(abortDisconnected.statusCode, 503);
  assert.deepStrictEqual(abortDisconnected.json, { error: 'Gateway not connected' });

  const abortMissingSession = await dispatch(createRouter(createGateway()), 'POST', '/api/oc/chat/abort', jsonBody({}));
  assert.strictEqual(abortMissingSession.statusCode, 400);
  assert.deepStrictEqual(abortMissingSession.json, { error: 'sessionKey required' });

  let abortArgs = null;
  const abortSuccess = await dispatch(createRouter(createGateway({
    async chatAbort(sessionKey, runId) {
      abortArgs = { sessionKey, runId };
      return { aborted: true, runId };
    },
  })), 'POST', '/api/oc/chat/abort', jsonBody({
    sessionKey: 'session-abort-success',
    runId: 'run-abort',
  }));
  assert.strictEqual(abortSuccess.statusCode, 200);
  assert.deepStrictEqual(abortSuccess.json, { ok: true, aborted: true, runId: 'run-abort' });
  assert.deepStrictEqual(abortArgs, { sessionKey: 'session-abort-success', runId: 'run-abort' });

  const abortError = await dispatch(createRouter(createGateway({
    async chatAbort() {
      throw new Error('abort failed');
    },
  })), 'POST', '/api/oc/chat/abort', jsonBody({
    sessionKey: 'session-abort-error',
  }));
  assert.strictEqual(abortError.statusCode, 500);
  assert.deepStrictEqual(abortError.json, { error: 'abort failed' });

  const agentMissingGateway = await dispatch(createRouter(null), 'POST', '/api/agent/chat', jsonBody({
    message: 'hello',
  }));
  assert.strictEqual(agentMissingGateway.statusCode, 503);
  assert.deepStrictEqual(agentMissingGateway.json, { error: 'Gateway not connected' });

  const agentMissingMessage = await dispatch(createRouter(createGateway()), 'POST', '/api/agent/chat', jsonBody({
    sessionKey: 'agent-session',
  }));
  assert.strictEqual(agentMissingMessage.statusCode, 400);
  assert.deepStrictEqual(agentMissingMessage.json, { error: 'message is required' });

  let agentPayload = null;
  const agentChat = await dispatch(createRouter(createGateway({
    async chatSend(payload) {
      agentPayload = payload;
      return { ok: true, runId: 'agent-run' };
    },
  })), 'POST', '/api/agent/chat', jsonBody({
    message: 'summarize work',
    context: {
      activeView: 'tasks',
      activeSpace: { name: 'Platform' },
      stats: { projects: 3, recentTasks: 8 },
    },
  }));
  assert.strictEqual(agentChat.statusCode, 200);
  assert.deepStrictEqual(agentChat.json, { ok: true, runId: 'agent-run' });
  assert.deepStrictEqual(agentPayload, {
    sessionKey: 'dashboard-agent',
    message: '[Dashboard Context: tasks view, 3 projects, 8 recent tasks, space: Platform]\n\nsummarize work',
    metadata: { source: 'dashboard-chat', context: true },
  });

  let directAgentPayload = null;
  const directAgentChat = await dispatch(createRouter(createGateway({
    async chatSend(payload) {
      directAgentPayload = payload;
      return { id: 'direct-agent-run' };
    },
  })), 'POST', '/api/agent/chat', jsonBody({
    sessionKey: 'custom-agent-session',
    message: 'plain message',
  }));
  assert.strictEqual(directAgentChat.statusCode, 200);
  assert.deepStrictEqual(directAgentChat.json, { id: 'direct-agent-run' });
  assert.deepStrictEqual(directAgentPayload, {
    sessionKey: 'custom-agent-session',
    message: 'plain message',
    metadata: { source: 'dashboard-chat', context: true },
  });

  const agentError = await dispatch(createRouter(createGateway({
    async chatSend() {
      throw new Error('agent failed');
    },
  })), 'POST', '/api/agent/chat', jsonBody({
    message: 'hello',
  }));
  assert.strictEqual(agentError.statusCode, 500);
  assert.deepStrictEqual(agentError.json, { error: 'agent failed' });

  const historyMissingGateway = await dispatch(createRouter(null), 'GET', '/api/agent/chat/history');
  assert.strictEqual(historyMissingGateway.statusCode, 503);
  assert.deepStrictEqual(historyMissingGateway.json, { error: 'Gateway not connected' });

  let historyArgs = null;
  const historySuccess = await dispatch(createRouter(createGateway({
    async chatHistory(sessionKey, limit) {
      historyArgs = { sessionKey, limit };
      return [{ role: 'user', content: 'hello' }];
    },
  })), 'GET', '/api/agent/chat/history?limit=2&unused=true');
  assert.strictEqual(historySuccess.statusCode, 200);
  assert.deepStrictEqual(historySuccess.json, { history: [{ role: 'user', content: 'hello' }] });
  assert.deepStrictEqual(historyArgs, { sessionKey: 'dashboard-agent', limit: 2 });

  let defaultHistoryLimit = null;
  const defaultHistory = await dispatch(createRouter(createGateway({
    async chatHistory(sessionKey, limit) {
      defaultHistoryLimit = limit;
      return [];
    },
  })), 'GET', '/api/agent/chat/history');
  assert.strictEqual(defaultHistory.statusCode, 200);
  assert.deepStrictEqual(defaultHistory.json, { history: [] });
  assert.strictEqual(defaultHistoryLimit, 50);

  const missingHistoryMethod = await dispatch(createRouter(createGateway({
    chatHistory: undefined,
  })), 'GET', '/api/agent/chat/history?limit=5');
  assert.strictEqual(missingHistoryMethod.statusCode, 200);
  assert.deepStrictEqual(missingHistoryMethod.json, { history: [] });

  const historyError = await dispatch(createRouter(createGateway({
    async chatHistory() {
      throw new Error('history failed');
    },
  })), 'GET', '/api/agent/chat/history');
  assert.strictEqual(historyError.statusCode, 500);
  assert.deepStrictEqual(historyError.json, { error: 'history failed' });

  console.log('Chat route tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
