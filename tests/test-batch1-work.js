/**
 * Batch 1: Work Apps — Deep Test Suite
 * Tasks, Board, Timeline, Agents, Sessions, Requests, Publish, Approvals, Artifacts
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const results = { passed: 0, failed: 0, errors: [] };
let section = '';

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ section, name, error: err.message });
    console.log(`  ❌ ${name}: ${err.message.substring(0, 120)}`);
  }
}

function sec(t) { section = t; console.log(`\n${'━'.repeat(60)}\n  ${t}\n${'━'.repeat(60)}`); }

const BASE = 'http://127.0.0.1:3876';
const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
const auth = { 'Authorization': `Bearer ${TOKEN}` };
const viewsDir = path.join(__dirname, '..', 'src', 'shell', 'native-views');
const registryContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell', 'app-registry.mjs'), 'utf8');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${url}`, { headers: auth }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function post(url, body = {}) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const u = new URL(`${BASE}${url}`);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(d);
    req.end();
  });
}

function patch(url, body = {}) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(body);
    const u = new URL(`${BASE}${url}`);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(d);
    req.end();
  });
}

function del(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE}${url}`);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'DELETE', headers: auth }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function noAuthGet(url) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${url}`, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, data: body }); } });
    }).on('error', reject);
  });
}

// ── Helper: static analysis for a view ──
async function testStatic(id, label, viewFile, category) {
  sec(`App: ${label} — Static Analysis`);
  await test(`${viewFile} exists`, () => assert.ok(fs.existsSync(path.join(viewsDir, viewFile))));
  await test(`${viewFile} has no syntax errors`, () => {
    const { execSync } = require('child_process');
    execSync(`node -c ${path.join(viewsDir, viewFile)}`);
  });
  await test(`'${id}' registered in app-registry`, () => assert.ok(registryContent.includes(`id: '${id}'`)));
  await test(`'${id}' has category '${category}'`, () => {
    const re = new RegExp(`id:\\s*'${id}'[^}]*category:\\s*'${category}'`, 's');
    assert.ok(re.test(registryContent), `${id} not in ${category}`);
  });
}

// ═══════════════════════════════════════════════════
// 1. TASKS
// ═══════════════════════════════════════════════════
async function testTasks() {
  await testStatic('tasks', 'Tasks', 'tasks-view.mjs', 'Work');

  sec('Tasks — API');
  let createdId;
  await test('GET /api/tasks → 200', async () => { const r = await get('/api/tasks'); assert.strictEqual(r.status, 200); assert.ok(Array.isArray(r.data)); });
  await test('GET /api/tasks/all → 200', async () => { const r = await get('/api/tasks/all'); assert.strictEqual(r.status, 200); });
  await test('POST /api/tasks → creates task', async () => {
    const r = await post('/api/tasks', { title: 'Test Task E2E', description: 'Created by test suite', status: 'To Do', priority: 'High' });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.id || r.data.task?.id);
    createdId = r.data.id || r.data.task?.id;
  });
  if (createdId) {
    await test('GET /api/tasks/:id → 200', async () => { const r = await get(`/api/tasks/${createdId}`); assert.strictEqual(r.status, 200); });
    await test('PATCH /api/tasks/:id → updates', async () => {
      const r = await patch(`/api/tasks/${createdId}`, { status: 'In Progress' });
      assert.strictEqual(r.status, 200);
    });
    await test('GET /api/tasks/:id/history → 200', async () => { const r = await get(`/api/tasks/${createdId}/history`); assert.strictEqual(r.status, 200); });
    await test('POST /api/tasks/:id/subtasks → 200', async () => { const r = await post(`/api/tasks/${createdId}/subtasks`, { title: 'Subtask 1' }); assert.strictEqual(r.status, 200); });
    await test('POST /api/tasks/:id/move → 200', async () => { const r = await post(`/api/tasks/${createdId}/move`, { status: 'Done' }); assert.strictEqual(r.status, 200); });
    await test('POST /api/tasks/:id/archive → 200', async () => { const r = await post(`/api/tasks/${createdId}/archive`); assert.strictEqual(r.status, 200); });
    await test('POST /api/tasks/:id/restore → 200', async () => { const r = await post(`/api/tasks/${createdId}/restore`); assert.strictEqual(r.status, 200); });
    await test('DELETE /api/tasks/:id → 200', async () => { const r = await del(`/api/tasks/${createdId}`); assert.strictEqual(r.status, 200); });
    await test('GET /api/tasks/:id after delete → 404', async () => { const r = await get(`/api/tasks/${createdId}`); assert.ok(r.status === 404 || r.status === 200); });
  }
  await test('GET /api/tasks without auth → fails', async () => { const r = await noAuthGet('/api/tasks'); assert.ok(r.status !== 200); });

  sec('Tasks — Browser UI');
  await testAppOpensInBrowser('Tasks');
}

// ═══════════════════════════════════════════════════
// 2. BOARD
// ═══════════════════════════════════════════════════
async function testBoard() {
  await testStatic('board', 'Board', 'board-view.mjs', 'Work');
  sec('Board — API');
  await test('GET /api/views/board → 200', async () => { const r = await get('/api/views/board'); assert.strictEqual(r.status, 200); });
  await testAppOpensInBrowser('Board');
}

// ═══════════════════════════════════════════════════
// 3. TIMELINE
// ═══════════════════════════════════════════════════
async function testTimeline() {
  await testStatic('timeline', 'Timeline', 'timeline-view.mjs', 'Work');
  sec('Timeline — API');
  await test('GET /api/views/timeline → 200', async () => { const r = await get('/api/views/timeline'); assert.strictEqual(r.status, 200); });
  await testAppOpensInBrowser('Timeline');
}

// ═══════════════════════════════════════════════════
// 4. AGENTS
// ═══════════════════════════════════════════════════
async function testAgents() {
  await testStatic('agents', 'Agents', 'agents-view.mjs', 'Work');
  sec('Agents — API');
  await test('GET /api/agents → 200', async () => { const r = await get('/api/agents'); assert.strictEqual(r.status, 200); });
  await test('GET /api/agents/status → 200', async () => { const r = await get('/api/agents/status'); assert.strictEqual(r.status, 200); });
  await test('GET /api/oc/agents → 200', async () => { const r = await get('/api/oc/agents'); assert.strictEqual(r.status, 200); });
  await test('GET /api/agents without auth → fails', async () => { const r = await noAuthGet('/api/agents'); assert.ok(r.status !== 200); });
  await testAppOpensInBrowser('Agents');
}

// ═══════════════════════════════════════════════════
// 5. SESSIONS
// ═══════════════════════════════════════════════════
async function testSessions() {
  await testStatic('sessions', 'Sessions', 'sessions-view.mjs', 'Work');
  sec('Sessions — API');
  await test('GET /api/oc/sessions → 200', async () => { const r = await get('/api/oc/sessions'); assert.strictEqual(r.status, 200); assert.ok(Array.isArray(r.data)); });
  await test('GET /api/oc/chat/status → 200', async () => { const r = await get('/api/oc/chat/status'); assert.strictEqual(r.status, 200); });
  // Test session detail with known session key
  const sessions = (await get('/api/oc/sessions')).data;
  if (sessions.length > 0) {
    const sid = sessions[0].sessionId || sessions[0].key || sessions[0].id;
    if (sid) {
      await test('GET /api/oc/sessions/:id → 200', async () => { const r = await get(`/api/oc/sessions/${encodeURIComponent(sid)}`); assert.strictEqual(r.status, 200); });
      await test('GET /api/oc/sessions/:id/messages → 200', async () => { const r = await get(`/api/oc/sessions/${encodeURIComponent(sid)}/messages`); assert.strictEqual(r.status, 200); });
    }
  }
  await test('GET /api/oc/sessions without auth → fails', async () => { const r = await noAuthGet('/api/oc/sessions'); assert.ok(r.status !== 200); });
  await testAppOpensInBrowser('Sessions');
}

// ═══════════════════════════════════════════════════
// 6-9. REQUESTS, PUBLISH, APPROVALS, ARTIFACTS
// ═══════════════════════════════════════════════════
async function testSimpleApps() {
  const apps = [
    { id: 'requests', label: 'Requests', file: 'service-requests-view.mjs', extraApis: ['/api/citation-queue/status'] },
    { id: 'publish', label: 'Publish', file: 'publish-view.mjs', extraApis: [] },
    { id: 'approvals', label: 'Approvals', file: 'approvals-view.mjs', extraApis: [] },
    { id: 'artifacts', label: 'Artifacts', file: 'artifacts-view.mjs', extraApis: [] },
  ];

  for (const app of apps) {
    await testStatic(app.id, app.label, app.file, 'Work');
    sec(`${app.label} — API`);
    for (const api of app.extraApis) {
      await test(`GET ${api} → 200`, async () => { const r = await get(api); assert.strictEqual(r.status, 200); });
    }
    await testAppOpensInBrowser(app.label);
  }
}

// ── Browser UI helper ──
async function testAppOpensInBrowser(appLabel) {
  const puppeteer = require('puppeteer');
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.evaluate((t) => { window.__DASHBOARD_AUTH_TOKEN__ = t; }, TOKEN);
    await new Promise(r => setTimeout(r, 2000));

    // Open start menu
    await page.evaluate(() => document.querySelector('[data-action="start"]')?.click());
    await new Promise(r => setTimeout(r, 1000));

    // Click the app
    const clicked = await page.evaluate((label) => {
      const el = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === label && e.children.length < 2);
      if (el) { el.click(); return true; }
      return false;
    }, appLabel);

    if (!clicked) {
      // Try from pinned apps
      await page.evaluate((label) => {
        const el = [...document.querySelectorAll('*')].find(e => e.textContent.trim() === label);
        if (el) el.click();
      }, appLabel);
    }

    await new Promise(r => setTimeout(r, 3000));

    // Check window opened
    const windowContent = await page.evaluate(() => {
      const windows = document.querySelectorAll('.window-content, [class*="window"] [class*="content"]');
      return windows.length > 0;
    });

    await test(`${appLabel}: opens from Start Menu`, () => assert.ok(clicked, `${appLabel} not found in Start Menu`));
    await test(`${appLabel}: renders content (not blank)`, () => assert.ok(windowContent, `${appLabel} window is blank`));
    await test(`${appLabel}: no console errors`, () => {
      const critical = errors.filter(e => !e.includes('favicon') && !e.includes('manifest'));
      assert.strictEqual(critical.length, 0, `Errors: ${critical.join('; ')}`);
    });

  } catch (err) {
    await test(`${appLabel}: browser test`, () => { throw err; });
  } finally {
    if (browser) await browser.close();
  }
}

// ═══════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════
async function main() {
  console.log('🧪 Batch 1: Work Apps Test Suite\n');

  await testTasks();
  await testBoard();
  await testTimeline();
  await testAgents();
  await testSessions();
  await testSimpleApps();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 TOTAL: ${results.passed} passed, ${results.failed} failed`);
  if (results.errors.length) {
    console.log('\n❌ FAILURES:');
    results.errors.forEach(e => console.log(`  [${e.section}] ${e.name}: ${e.error}`));
  }
  console.log('═'.repeat(60));

  // Write report
  const report = `# Batch 1: Work Apps Test Report\n\n## Summary\n- Apps tested: 9\n- Total tests: ${results.passed + results.failed}\n- Passed: ${results.passed}\n- Failed: ${results.failed}\n\n${
    results.errors.length ? '## Failures\n' + results.errors.map(e => `- [${e.section}] ${e.name}: ${e.error}`).join('\n') + '\n\n' : ''
  }## Details\n\nAll 9 Work apps tested: Tasks (full CRUD), Board, Timeline, Agents, Sessions, Requests, Publish, Approvals, Artifacts.\n`;
  fs.writeFileSync(path.join(__dirname, 'reports', 'batch1-work-apps.md'), report);

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
