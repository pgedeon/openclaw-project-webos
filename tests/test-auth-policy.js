/**
 * Focused tests for the intentionally deferred full-auth policy.
 * Run: node tests/test-auth-policy.js
 */

const assert = require('assert');
const Router = require('../routes/router');
const { registerHealthRoutes } = require('../routes/health-routes');
const {
  extractBearerToken,
  timingSafeTokenEqual,
  getAuthPolicy,
  getSelfAuthState,
} = require('../routes/auth-policy');

function createMockReq(headers = {}) {
  return {
    method: 'GET',
    url: '/api/auth/self',
    headers,
  };
}

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
      return JSON.parse(this.body);
    },
  };
}

async function run() {
  assert.strictEqual(extractBearerToken('Bearer abc123'), 'abc123');
  assert.strictEqual(extractBearerToken('Basic abc123'), '');
  assert.strictEqual(timingSafeTokenEqual('secret', 'secret'), true);
  assert.strictEqual(timingSafeTokenEqual('secret', 'different'), false);

  const tokenPolicy = getAuthPolicy('secret');
  assert.strictEqual(tokenPolicy.mode, 'token');
  assert.strictEqual(tokenPolicy.actor, 'dashboard-operator');
  assert.strictEqual(tokenPolicy.role, 'operator');
  assert.strictEqual(tokenPolicy.tokenRequired, true);
  assert.strictEqual(tokenPolicy.capabilities.singleOperator, true);
  assert.strictEqual(tokenPolicy.capabilities.sessions, false);
  assert.strictEqual(tokenPolicy.capabilities.rbac, false);
  assert.strictEqual(tokenPolicy.capabilities.multiOperator, false);
  assert.strictEqual(tokenPolicy.deferred.fullAuth, true);
  assert.match(tokenPolicy.deferred.reason, /multi-operator/);

  const openPolicy = getAuthPolicy('');
  assert.strictEqual(openPolicy.mode, 'open');
  assert.strictEqual(openPolicy.tokenRequired, false);
  assert.deepStrictEqual(openPolicy.supportedSchemes, ['open-local-dev']);

  const authedSelf = getSelfAuthState(createMockReq({ authorization: 'Bearer secret' }), 'secret');
  assert.strictEqual(authedSelf.authenticated, true);
  assert.strictEqual(authedSelf.actor, 'dashboard-operator');
  assert.strictEqual(authedSelf.role, 'operator');
  assert.strictEqual(authedSelf.capabilities.sessions, false);

  const unauthSelf = getSelfAuthState(createMockReq({ authorization: 'Bearer nope' }), 'secret');
  assert.strictEqual(unauthSelf.authenticated, false);
  assert.strictEqual(unauthSelf.actor, null);
  assert.strictEqual(unauthSelf.role, null);
  assert.strictEqual(unauthSelf.deferred.fullAuth, true);

  const openSelf = getSelfAuthState(createMockReq(), '');
  assert.strictEqual(openSelf.authenticated, true);
  assert.strictEqual(openSelf.mode, 'open');
  assert.strictEqual(openSelf.actor, 'dashboard-operator');

  const router = new Router();
  registerHealthRoutes(router);
  const routes = router.list();
  assert.ok(routes.some(route => route.method === 'GET' && route.path === '/api/auth/self'));
  assert.ok(!routes.some(route => route.path === '/api/auth/login'));
  assert.ok(!routes.some(route => route.path === '/api/auth/logout'));
  assert.ok(!routes.some(route => route.path === '/api/admin/users'));

  const previousToken = process.env.DASHBOARD_AUTH_TOKEN;
  process.env.DASHBOARD_AUTH_TOKEN = 'secret';
  try {
    const req = createMockReq({ authorization: 'Bearer secret' });
    const res = createMockRes();
    const handled = await router.handle(req, res, '/api/auth/self', 'GET', {});
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.authenticated, true);
    assert.strictEqual(res.json.mode, 'token');
    assert.strictEqual(res.json.deferred.fullAuth, true);
  } finally {
    if (previousToken === undefined) {
      delete process.env.DASHBOARD_AUTH_TOKEN;
    } else {
      process.env.DASHBOARD_AUTH_TOKEN = previousToken;
    }
  }

  console.log('Auth policy tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
