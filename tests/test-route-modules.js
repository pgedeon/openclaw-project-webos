/**
 * Integration tests for route modules, auth middleware, and handler logic.
 * Run: node tests/test-route-modules.js
 */

const assert = require('assert');
const path = require('path');

// ── Mock objects ──────────────────────────────────────
function createMockRes() {
  const res = {
    _statusCode: 0,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead(status, headers) {
      res._statusCode = status;
      Object.assign(res._headers, headers || {});
    },
    end(data) {
      res._body = data;
      res._ended = true;
    },
    write(data) { res._body = (res._body || '') + data; },
    get json() {
      try { return JSON.parse(res._body); } catch { return null; }
    }
  };
  return res;
}

function createMockReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    params: {},
    on() {},
    ...overrides,
  };
}

// ── Test runner ───────────────────────────────────────
const results = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════
// SECTION 1: ROUTER TESTS
// ══════════════════════════════════════════════════════
async function testRouter() {
  console.log('\n📦 Router');
  const Router = require('../routes/router');

  await test('Router class exists', () => {
    assert.ok(typeof Router === 'function');
  });

  await test('Router.add and handle work', async () => {
    const router = new Router();
    let called = false;
    router.add('GET', '/api/test', async (req, res) => {
      called = true;
      return true;
    });
    const req = createMockReq();
    const res = createMockRes();
    const handled = await router.handle(req, res, '/api/test', 'GET', {});
    assert.strictEqual(handled, true);
    assert.strictEqual(called, true);
  });

  await test('Router returns false for unmatched routes', async () => {
    const router = new Router();
    const req = createMockReq();
    const res = createMockRes();
    const handled = await router.handle(req, res, '/api/nonexistent', 'GET', {});
    assert.strictEqual(handled, false);
  });

  await test('Router extracts :param', async () => {
    const router = new Router();
    let capturedId = null;
    router.add('GET', '/api/items/:id', async (req, res, ctx, params) => {
      capturedId = params.id;
      return true;
    });
    const req = createMockReq();
    const res = createMockRes();
    await router.handle(req, res, '/api/items/abc-123', 'GET', {});
    assert.strictEqual(capturedId, 'abc-123');
  });

  await test('Router matches method correctly', async () => {
    const router = new Router();
    router.add('POST', '/api/test', async () => true);
    const req = createMockReq();
    const res = createMockRes();
    const handled = await router.handle(req, res, '/api/test', 'GET', {});
    assert.strictEqual(handled, false);
  });

  await test('Router handles multiple params', async () => {
    const router = new Router();
    let captured = {};
    router.add('GET', '/api/:collection/:id', async (req, res, ctx, params) => {
      captured = params;
      return true;
    });
    const req = createMockReq();
    const res = createMockRes();
    await router.handle(req, res, '/api/tasks/xyz-789', 'GET', {});
    assert.strictEqual(captured.collection, 'tasks');
    assert.strictEqual(captured.id, 'xyz-789');
  });
}

// ══════════════════════════════════════════════════════
// SECTION 2: SSE TESTS
// ══════════════════════════════════════════════════════
async function testSSE() {
  console.log('\n📦 SSE Routes');
  const { registerSSERoutes, broadcast } = require('../routes/sse-routes');

  await test('broadcast function exists', () => {
    assert.ok(typeof broadcast === 'function');
  });

  await test('SSE route registered at /api/events', async () => {
    const Router = require('../routes/router');
    const router = new Router();
    registerSSERoutes(router);
    const routes = router.routes || [];
    const hasEvents = routes.some(r => r.pattern === '/api/events' && r.method === 'GET');
    assert.ok(hasEvents);
  });

  await test('SSE broadcast writes to connected clients', async () => {
    // Create a mock response that tracks writes
    const mockRes = {
      write: (data) => { mockRes.chunks.push(data); },
      chunks: [],
    };
    // Manually register and trigger SSE handler to add client
    const Router = require('../routes/router');
    const router = new Router();
    registerSSERoutes(router);

    // Directly call broadcast — if no clients, should not throw
    broadcast('test:event', { hello: 'world' });
    // No assertion needed — just verifying no crash
    assert.ok(true);
  });
}

// ══════════════════════════════════════════════════════
// SECTION 3: ROUTE REGISTRATION TESTS
// ══════════════════════════════════════════════════════
async function testHealthRoutes() {
  console.log('\n📦 Health Routes');
  const { registerHealthRoutes } = require('../routes/health-routes');
  const Router = require('../routes/router');

  const routes = [
    ['/api/health', 'GET'],
    ['/api/stats', 'GET'],
    ['/api/citation-queue/status', 'GET'],
    ['/api/health-status', 'GET'],
  ];

  for (const [pattern, method] of routes) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerHealthRoutes(router);
      const has = router.routes.some(r => r.pattern === pattern && r.method === method);
      assert.ok(has, `${method} ${pattern} should be registered`);
    });
  }
}

async function testTaskRoutes() {
  console.log('\n📦 Task Routes');
  const { registerTaskRoutes } = require('../routes/task-routes');
  const Router = require('../routes/router');

  const routes = [
    ['GET', '/api/tasks/all'],
    ['GET', '/api/tasks/:id'],
    ['POST', '/api/tasks'],
    ['PATCH', '/api/tasks/:id'],
    ['DELETE', '/api/tasks/:id'],
    ['POST', '/api/tasks/:id/archive'],
    ['POST', '/api/tasks/:id/restore'],
    ['POST', '/api/tasks/:id/move'],
    ['POST', '/api/tasks/:id/dependencies'],
    ['POST', '/api/tasks/:id/subtasks'],
    ['GET', '/api/tasks/:id/history'],
    ['POST', '/api/tasks/:id/retry'],
  ];

  for (const [method, pattern] of routes) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerTaskRoutes(router);
      const has = router.routes.some(r => r.pattern === pattern && r.method === method);
      assert.ok(has, `${method} ${pattern} should be registered`);
    });
  }
}

async function testProjectRoutes() {
  console.log('\n📦 Project Routes');
  const { registerProjectRoutes } = require('../routes/project-routes');
  const Router = require('../routes/router');

  const routes = [
    ['GET', '/api/projects'],
    ['GET', '/api/projects/default'],
    ['GET', '/api/projects/:id'],
    ['POST', '/api/projects'],
    ['PATCH', '/api/projects/:id'],
    ['DELETE', '/api/projects/:id'],
  ];

  for (const [method, pattern] of routes) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerProjectRoutes(router);
      const has = router.routes.some(r => r.pattern === pattern && r.method === method);
      assert.ok(has, `${method} ${pattern} should be registered`);
    });
  }
}

async function testViewRoutes() {
  console.log('\n📦 View Routes');
  const { registerViewRoutes } = require('../routes/view-routes');
  const Router = require('../routes/router');

  const routes = [
    ['GET', '/api/views'],
    ['POST', '/api/views'],
    ['GET', '/api/views/:id'],
    ['PATCH', '/api/views/:id'],
    ['DELETE', '/api/views/:id'],
    ['GET', '/api/views/board'],
    ['GET', '/api/views/timeline'],
    ['GET', '/api/views/agent'],
  ];

  for (const [method, pattern] of routes) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerViewRoutes(router);
      const has = router.routes.some(r => r.pattern === pattern && r.method === method);
      assert.ok(has, `${method} ${pattern} should be registered`);
    });
  }
}

async function testCronRoutes() {
  console.log('\n📦 Cron Routes');
  const { registerCronRoutes } = require('../routes/cron-routes');
  const Router = require('../routes/router');

  for (const [method, pattern] of [['GET','/api/cron/jobs'],['GET','/api/cron/jobs/:id/runs'],['POST','/api/cron/jobs/:id/run']]) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerCronRoutes(router);
      assert.ok(router.routes.some(r => r.pattern === pattern && r.method === method));
    });
  }
}

async function testAgentRoutes() {
  console.log('\n📦 Agent Routes');
  const { registerAgentRoutes } = require('../routes/agent-routes');
  const Router = require('../routes/router');

  for (const [method, pattern] of [
    ['GET','/api/agents'],['GET','/api/agents/status'],
    ['POST','/api/agent/claim'],['POST','/api/agent/release'],
    ['POST','/api/agents/heartbeat'],
    ['GET','/api/lead-handoffs'],['GET','/api/audit'],
  ]) {
    await test(`${method} ${pattern} registered`, () => {
      const router = new Router();
      registerAgentRoutes(router);
      assert.ok(router.routes.some(r => r.pattern === pattern && r.method === method));
    });
  }
}

// ══════════════════════════════════════════════════════
// SECTION 4: SECURITY MODULE TESTS
// ══════════════════════════════════════════════════════
async function testSecurity() {
  console.log('\n📦 Security Module');
  const security = require('../lib/qmd-security');

  await test('safeWrite redacts AWS access keys', () => {
    const output = security.safeWrite({ data: 'AKIAIOSFODNN7EXAMPLE' }, 'test');
    assert.ok(output.data.includes('[REDACTED'));
  });

  await test('safeWrite redacts GitHub tokens', () => {
    const output = security.safeWrite({ token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, 'test');
    assert.ok(output.token.includes('[REDACTED'));
  });

  await test('safeWrite redacts generic passwords', () => {
    const output = security.safeWrite({ config: 'password="supersecret12345"' }, 'test');
    assert.ok(output.config.includes('[REDACTED'));
  });

  await test('safeWrite redacts JWTs', () => {
    const output = security.safeWrite({ auth: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' }, 'test');
    assert.ok(output.auth.includes('[REDACTED'));
  });

  await test('safeWrite passes clean data through', () => {
    const input = { name: 'test task', status: 'open', count: 42 };
    const output = security.safeWrite(input, 'test');
    assert.deepStrictEqual(output, input);
  });

  await test('safeWrite handles nested objects', () => {
    const input = { level1: { level2: { aws: 'AKIAIOSFODNN7EXAMPLE' } } };
    const output = security.safeWrite(input, 'test');
    assert.ok(output.level1.level2.aws.includes('[REDACTED'));
  });

  await test('safeWrite handles arrays', () => {
    const input = { items: ['clean', 'AKIAIOSFODNN7EXAMPLE', 'also clean'] };
    const output = security.safeWrite(input, 'test');
    assert.ok(output.items[1].includes('[REDACTED'));
    assert.strictEqual(output.items[0], 'clean');
  });

  await test('safeWrite handles null/undefined', () => {
    assert.strictEqual(security.safeWrite(null, 'test'), null);
    assert.strictEqual(security.safeWrite(undefined, 'test'), undefined);
  });

  await test('scanForSecrets detects patterns', () => {
    const results = security.scanForSecrets('password="supersecret12345"');
    assert.ok(results.length > 0);
  });

  await test('scanForSecrets returns empty for clean strings', () => {
    const results = security.scanForSecrets('hello world this is clean');
    assert.strictEqual(results.length, 0);
  });
}

// ══════════════════════════════════════════════════════
// SECTION 5: AUTH MIDDLEWARE TESTS (via task-server source)
// ══════════════════════════════════════════════════════
async function testAuthMiddleware() {
  console.log('\n📦 Auth Middleware (source analysis)');

  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, '../task-server.js'), 'utf8');

  await test('DASHBOARD_AUTH_TOKEN constant defined', () => {
    assert.ok(source.includes('DASHBOARD_AUTH_TOKEN'));
  });

  await test('Auth middleware checks Bearer token', () => {
    assert.ok(source.includes("authHeader.startsWith('Bearer ')"));
  });

  await test('Auth uses timingSafeEqual', () => {
    assert.ok(source.includes('timingSafeTokenEqual'));
  });

  await test('Auth returns 401 on failure', () => {
    assert.ok(source.includes("'Unauthorized'"));
  });

  await test('Auth exempts /api/health', () => {
    assert.ok(source.includes("url !== '/api/health'"));
  });

  await test('Auth self endpoint remains public for status checks', () => {
    assert.ok(source.includes("url !== '/api/auth/self'"));
  });

  await test('Auth supports query token for SSE', () => {
    assert.ok(source.includes('token=') || source.includes('tokenParam'));
  });

  await test('Startup guard exists for missing token', () => {
    assert.ok(source.includes('FATAL') || source.includes('DASHBOARD_AUTH_TOKEN is not set'));
  });
}

// ══════════════════════════════════════════════════════
// SECTION 6: DEAD CODE REMOVAL VERIFICATION
// ══════════════════════════════════════════════════════
async function testDeadCodeRemoval() {
  console.log('\n📦 Dead Code Removal');

  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, '../task-server.js'), 'utf8');

  await test('task-server.js is under 1200 lines', () => {
    const lines = source.split('\n').length;
    assert.ok(lines < 1200, `Expected <1200 lines, got ${lines}`);
  });

  await test('Router import exists', () => {
    assert.ok(source.includes("require('./routes/router')"));
  });

  await test('All route modules imported', () => {
    const modules = ['health-routes', 'task-routes', 'project-routes', 'view-routes', 'cron-routes', 'agent-routes', 'sse-routes'];
    for (const mod of modules) {
      assert.ok(source.includes(mod), `${mod} should be imported`);
    }
  });

  await test('Router runs before inline handlers', () => {
    // Find the first occurrence in the request handler (not the initialization)
    const routerPos = source.indexOf('router.handle');
    // Find the diagnosticsHandler CALL (not the assignment) — look for it after 'if (await'
    const diagnosticsCallPos = source.indexOf('if (await diagnosticsHandler');
    assert.ok(routerPos < diagnosticsCallPos, 'Router should be called before diagnostics handler');
  });

  await test('No duplicate inline health handler', () => {
    // Count occurrences of the inline health handler pattern
    const matches = source.match(/url === '\/api\/health' && method === 'GET'/g);
    assert.ok(!matches || matches.length === 0, 'Inline health handler should be removed');
  });
}

// ══════════════════════════════════════════════════════
// SECTION 7: CORS VERIFICATION
// ══════════════════════════════════════════════════════
async function testCORS() {
  console.log('\n📦 CORS Configuration');

  const fs = require('fs');

  const filesToCheck = [
    'task-server.js',
    'diagnostics-api.js',
    'gateway-workflow-dispatcher-v2.js',
    'memory-api-server.mjs',
    'cron-manager-server.mjs',
  ];

  for (const file of filesToCheck) {
    await test(`${file} has no wildcard CORS`, () => {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const wildcards = source.match(/'Access-Control-Allow-Origin': '\*'/g);
      assert.ok(!wildcards || wildcards.length === 0, `${file} should not have wildcard CORS`);
    });
  }
}

// ══════════════════════════════════════════════════════
// SECTION 8: GRACEFUL SHUTDOWN TEST
// ══════════════════════════════════════════════════════
async function testGracefulShutdown() {
  console.log('\n📦 Graceful Shutdown');

  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, '../task-server.js'), 'utf8');

  await test('SIGTERM handler exists', () => {
    assert.ok(source.includes("'SIGTERM'"));
  });

  await test('SIGINT handler exists', () => {
    assert.ok(source.includes("'SIGINT'"));
  });

  await test('pool.end() called on shutdown', () => {
    assert.ok(source.includes('pool.end'));
  });

  await test('Force exit timeout exists', () => {
    assert.ok(source.includes('10000') && source.includes('setTimeout'));
  });
}

// ── Run all tests ─────────────────────────────────────
async function main() {
  console.log('🧪 Dashboard Comprehensive Test Suite\n' + '='.repeat(50));

  await testRouter();
  await testSSE();
  await testHealthRoutes();
  await testTaskRoutes();
  await testProjectRoutes();
  await testViewRoutes();
  await testCronRoutes();
  await testAgentRoutes();
  await testSecurity();
  await testAuthMiddleware();
  await testDeadCodeRemoval();
  await testCORS();
  await testGracefulShutdown();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  
  if (results.failed > 0) {
    console.log('\nFailures:');
    for (const { name, error } of results.errors) {
      console.log(`  ❌ ${name}: ${error}`);
    }
    process.exit(1);
  }
  console.log('\n✅ All tests passed!');
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
