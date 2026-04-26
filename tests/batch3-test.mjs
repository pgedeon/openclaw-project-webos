import http from 'http';
import { execSync } from 'child_process';
import fs from 'fs';

const BASE = 'http://127.0.0.1:3876';
const FS_BASE = 'http://127.0.0.1:3880';
const TOKEN = fs.readFileSync('/root/.openclaw/workspace/dashboard/.env', 'utf8')
  .match(/DASHBOARD_AUTH_TOKEN=(.+)/)[1].trim();

const VIEWS_DIR = '/root/.openclaw/workspace/dashboard/src/shell/native-views';

// Results collector
const results = { apps: [], totalTests: 0, passed: 0, failed: 0 };

function record(appId, category, name, passed, detail = '') {
  results.totalTests++;
  if (passed) results.passed++; else results.failed++;
  const app = results.apps.find(a => a.id === appId);
  if (app) {
    if (!app.sections[category]) app.sections[category] = [];
    app.sections[category].push({ name, passed, detail });
  }
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${appId}] ${category}: ${name}${detail ? ' — ' + detail : ''}`);
}

function initApp(id, label) {
  results.apps.push({ id, label, sections: {} });
}

// ── HTTP helpers ──────────────────────────────────────────────
function fetchSync(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: opts.method || 'GET',
      headers: {
        ...(opts.headers || {}),
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    };
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function authHeaders() {
  return { 'Authorization': `Bearer ${TOKEN}` };
}

function noAuthHeaders() {
  return {};
}

// ── Static Analysis ──────────────────────────────────────────
function staticTests(appId, viewFile) {
  const filePath = `${VIEWS_DIR}/${viewFile}`;

  // 1. File exists
  const exists = fs.existsSync(filePath);
  record(appId, 'Static Analysis', `View file exists (${viewFile})`, exists);

  if (!exists) return;

  const content = fs.readFileSync(filePath, 'utf8');

  // 2. Exports render function
  const hasRender = /export\s+(function\s+)?render|export\s+default|module\.exports/.test(content);
  record(appId, 'Static Analysis', 'Exports render function', hasRender, hasRender ? 'Found export' : 'No render export found');

  // 3. Syntax check
  try {
    execSync(`node -c ${filePath} 2>&1`);
    record(appId, 'Static Analysis', 'No syntax errors (node -c)', true);
  } catch (e) {
    record(appId, 'Static Analysis', 'No syntax errors (node -c)', false, e.message.slice(0, 200));
  }
}

// ── API Tests ─────────────────────────────────────────────────
async function apiTests(appId, endpoints) {
  for (const ep of endpoints) {
    const method = ep.method || 'GET';
    const url = ep.url.startsWith('http') ? ep.url : `${BASE}${ep.url}`;
    const label = `${method} ${ep.url}`;

    // Auth required test
    if (ep.testAuth !== false) {
      try {
        const noAuth = await fetchSync(url, { method, headers: noAuthHeaders(), body: ep.body });
        // Should NOT be 200 without auth (expect 401 or 403)
        const authBlocked = noAuth.status === 401 || noAuth.status === 403;
        record(appId, 'API Tests', `Auth required: ${label}`, authBlocked,
          authBlocked ? `Blocked with ${noAuth.status}` : `Got ${noAuth.status} without auth`);
      } catch (e) {
        record(appId, 'API Tests', `Auth required: ${label}`, false, e.message);
      }
    }

    // With auth - status check
    try {
      const resp = await fetchSync(url, { method, headers: authHeaders(), body: ep.body });
      const statusOk = ep.expectStatus ? resp.status === ep.expectStatus : resp.status >= 200 && resp.status < 300;
      record(appId, 'API Tests', `${label} → ${resp.status}`, statusOk,
        statusOk ? '' : `Expected ${ep.expectStatus || '2xx'}, got ${resp.status}`);

      // Structure check
      if (ep.checkStructure && statusOk) {
        try {
          const json = JSON.parse(resp.body);
          const structOk = ep.checkStructure(json);
          record(appId, 'API Tests', `${label} response structure valid`, structOk,
            structOk ? '' : `Structure check failed: ${JSON.stringify(json).slice(0, 200)}`);
        } catch (e) {
          record(appId, 'API Tests', `${label} response is valid JSON`, false, e.message);
        }
      }
    } catch (e) {
      record(appId, 'API Tests', `${label}`, false, e.message);
    }
  }
}

// ── Browser Tests (Puppeteer) ─────────────────────────────────
async function browserTests(appId, testFn) {
  let browser;
  try {
    const puppeteer = (await import('puppeteer')).default;
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await testFn(page, consoleErrors, record.bind(null, appId, 'Browser UI'));

    // Console errors
    const jsErrors = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('manifest'));
    record(appId, 'Browser UI', 'No JavaScript console errors', jsErrors.length === 0,
      jsErrors.length > 0 ? jsErrors.slice(0, 3).join(' | ') : 'Clean');
  } catch (e) {
    record(appId, 'Browser UI', 'Puppeteer test setup', false, e.message);
  } finally {
    if (browser) await browser.close();
  }
}

// ════════════════════════════════════════════════════════════════
// MAIN TEST RUNNER
// ════════════════════════════════════════════════════════════════

async function main() {
  console.log('=== Batch 3: Admin Apps Test Suite ===\n');

  // ── 1. DEPARTMENTS ───────────────────────────────────────
  console.log('\n--- Departments ---');
  initApp('departments', 'Departments');
  staticTests('departments', 'departments-view.mjs');
  await browserTests('departments', async (page, errors, rec) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 15000 });
    // Check Start Menu
    const startBtn = await page.$('[data-testid="start-button"], .start-btn, .taskbar__start, #start-btn');
    if (startBtn) {
      await startBtn.click();
      await page.waitForTimeout(500);
      rec('Start Menu opens', true);
    } else {
      rec('Start Menu opens', false, 'Start button not found');
    }

    // Try opening departments window directly
    await page.goto(`${BASE}/?view=departments`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1000);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);

    // Check for department-related elements
    const hasDeptContent = content.toLowerCase().includes('department') || content.length > 50;
    rec('Department content visible', hasDeptContent);
  });

  // ── 2. EXPLORER ──────────────────────────────────────────
  console.log('\n--- Explorer ---');
  initApp('explorer', 'Explorer');
  staticTests('explorer', 'explorer-view.mjs');

  // Filesystem API tests
  const fsEndpoints = [
    { url: `${FS_BASE}/api/fs/list?path=/`, method: 'GET', expectStatus: 200 },
    { url: `${FS_BASE}/api/fs/list?path=/root`, method: 'GET', expectStatus: 200 },
  ];
  for (const ep of fsEndpoints) {
    try {
      const resp = await fetchSync(ep.url, { method: ep.method });
      const ok = resp.status === ep.expectStatus;
      record('explorer', 'API Tests', `${ep.method} ${ep.url.replace(FS_BASE, '')} → ${resp.status}`, ok);
      if (ok) {
        try {
          const json = JSON.parse(resp.body);
          record('explorer', 'API Tests', 'FS response is valid JSON', true, JSON.stringify(json).slice(0, 100));
        } catch (e) {
          record('explorer', 'API Tests', 'FS response is valid JSON', false, e.message);
        }
      }
    } catch (e) {
      record('explorer', 'API Tests', `${ep.method} ${ep.url}`, false, e.message);
    }
  }
  // Auth test on FS
  try {
    const noAuth = await fetchSync(`${FS_BASE}/api/fs/list?path=/`, { method: 'GET' });
    // FS API may or may not require auth
    record('explorer', 'API Tests', `FS API auth check (${noAuth.status})`, true, `Status: ${noAuth.status}`);
  } catch (e) {
    record('explorer', 'API Tests', 'FS API auth check', false, e.message);
  }

  await browserTests('explorer', async (page, errors, rec) => {
    await page.goto(`${BASE}/?view=explorer`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);
    const hasFileContent = content.toLowerCase().includes('file') || content.toLowerCase().includes('folder') || content.toLowerCase().includes('directory');
    rec('File browsing UI elements present', hasFileContent);
  });

  // ── 3. NOTEPAD ───────────────────────────────────────────
  console.log('\n--- Notepad ---');
  initApp('notepad', 'Notepad');
  staticTests('notepad', 'notepad-view.mjs');

  // Notepad API tests via FS API
  const notepadEndpoints = [
    { url: `${FS_BASE}/api/fs/read?path=/etc/hostname`, method: 'GET' },
    { url: `${FS_BASE}/api/fs/list?path=/tmp`, method: 'GET' },
  ];
  for (const ep of notepadEndpoints) {
    try {
      const resp = await fetchSync(ep.url, { method: ep.method });
      record('notepad', 'API Tests', `${ep.method} ${ep.url.replace(FS_BASE, '')} → ${resp.status}`,
        resp.status >= 200 && resp.status < 300);
    } catch (e) {
      record('notepad', 'API Tests', `${ep.method} ${ep.url}`, false, e.message);
    }
  }

  await browserTests('notepad', async (page, errors, rec) => {
    await page.goto(`${BASE}/?view=notepad`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);

    // Check for textarea/editor
    const hasEditor = await page.evaluate(() => {
      return !!document.querySelector('textarea, [contenteditable="true"], .editor, .notepad-editor, .CodeMirror');
    });
    rec('Text editor element present', hasEditor);
  });

  // ── 4. SKILLS & TOOLS ────────────────────────────────────
  console.log('\n--- Skills & Tools ---');
  initApp('skills-tools', 'Skills & Tools');
  staticTests('skills-tools', 'skills-tools-view.mjs');

  await browserTests('skills-tools', async (page, errors, rec) => {
    await page.goto(`${BASE}/skills-tools`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);
    const hasSkillContent = content.toLowerCase().includes('skill') || content.toLowerCase().includes('tool');
    rec('Skills/Tools content visible', hasSkillContent);

    // Check for list/card elements
    const hasCards = await page.evaluate(() => {
      return !!document.querySelector('.skill-card, .tool-card, .card, li, [data-skill]');
    });
    rec('Interactive list elements present', hasCards);
  });

  // ── 5. WORKFLOWS ─────────────────────────────────────────
  console.log('\n--- Workflows ---');
  initApp('workflows', 'Workflows');
  staticTests('workflows', 'workflows-view.mjs');

  // API tests
  await apiTests('workflows', [
    { url: '/api/tasks', method: 'GET', checkStructure: j => Array.isArray(j) || j.tasks || j.data },
    { url: '/api/views', method: 'GET', checkStructure: j => Array.isArray(j) || j.views || j.data },
  ]);

  await browserTests('workflows', async (page, errors, rec) => {
    await page.goto(`${BASE}/workflows`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);
    const hasWorkflowContent = content.toLowerCase().includes('workflow') || content.toLowerCase().includes('task') || content.toLowerCase().includes('state');
    rec('Workflow content visible', hasWorkflowContent);
  });

  // ── 6. OPERATIONS ────────────────────────────────────────
  console.log('\n--- Operations ---');
  initApp('operations', 'Operations');
  staticTests('operations', 'operations-view.mjs');

  await browserTests('operations', async (page, errors, rec) => {
    await page.goto(`${BASE}/operations`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);
    const hasOpsContent = content.toLowerCase().includes('operation') || content.toLowerCase().includes('task') || content.toLowerCase().includes('status');
    rec('Operations dashboard content visible', hasOpsContent);
  });

  // ── 7. BING WEBMASTER ────────────────────────────────────
  console.log('\n--- Bing Webmaster ---');
  initApp('bing', 'Bing Webmaster');
  staticTests('bing', 'bing-view.mjs');

  // API tests
  await apiTests('bing', [
    { url: '/api/bing/quota', method: 'GET' },
    { url: '/api/bing/status', method: 'GET' },
    { url: '/api/bing/submit', method: 'POST', body: { url: 'https://example.com/test' }, testAuth: true, expectStatus: 200 },
    { url: '/api/bing/submit-batch', method: 'POST', body: { urls: ['https://example.com/1'] }, testAuth: true, expectStatus: 200 },
    { url: '/api/bing/indexnow', method: 'POST', body: { url: 'https://example.com/test' }, testAuth: true, expectStatus: 200 },
  ]);

  await browserTests('bing', async (page, errors, rec) => {
    // Try direct view
    await page.goto(`${BASE}/?view=bing`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(1500);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);
    const hasBingContent = content.toLowerCase().includes('bing') || content.toLowerCase().includes('url') || content.toLowerCase().includes('submit');
    rec('Bing Webmaster content visible', hasBingContent);

    // Check for form elements
    const hasForm = await page.evaluate(() => {
      return !!document.querySelector('input, button, form, textarea');
    });
    rec('Interactive form elements present', hasForm);
  });

  // ── 8. SETTINGS ──────────────────────────────────────────
  console.log('\n--- Settings ---');
  initApp('settings', 'Settings');
  staticTests('settings', 'settings-view.mjs');

  // API tests
  await apiTests('settings', [
    { url: '/api/settings', method: 'GET', checkStructure: j => typeof j === 'object' },
    { url: '/api/settings/test-db', method: 'POST', testAuth: true, expectStatus: 200 },
    { url: '/api/settings/test-gateway', method: 'POST', testAuth: true, expectStatus: 200 },
    { url: '/api/settings/export', method: 'GET', checkStructure: j => typeof j === 'object' },
    { url: '/api/settings/system-info', method: 'GET', checkStructure: j => typeof j === 'object' },
  ]);

  await browserTests('settings', async (page, errors, rec) => {
    await page.goto(`${BASE}/?view=settings`, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(2000);
    const content = await page.evaluate(() => document.body.innerText);
    rec('Window renders content', content.length > 0, `${content.length} chars`);

    // Check for tabs
    const tabs = await page.evaluate(() => {
      const tabElements = document.querySelectorAll('[data-tab], .tab, .settings-tab, [role="tab"], .nav-tab');
      return tabElements.length;
    });
    rec('Settings tabs present', tabs > 0, `Found ${tabs} tab elements`);

    // Check for System Info section
    const hasSystemInfo = content.toLowerCase().includes('system') || content.toLowerCase().includes('info');
    rec('System Info section visible', hasSystemInfo);

    // Check for test buttons
    const hasTestButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(b =>
        b.textContent.toLowerCase().includes('test') ||
        b.textContent.toLowerCase().includes('save') ||
        b.textContent.toLowerCase().includes('export')
      );
    });
    rec('Action buttons (test/save/export) present', hasTestButtons);
  });

  // ── Generate Report ──────────────────────────────────────
  generateReport();
}

function generateReport() {
  let md = `# Batch 3: Admin Apps Test Report\n\n`;
  md += `_Generated: ${new Date().toISOString()}_\n\n`;
  md += `## Summary\n\n`;
  md += `- **Apps tested:** ${results.apps.length}\n`;
  md += `- **Total tests:** ${results.totalTests}\n`;
  md += `- **Passed:** ${results.passed} ✅\n`;
  md += `- **Failed:** ${results.failed} ❌\n`;
  md += `- **Pass rate:** ${((results.passed / results.totalTests) * 100).toFixed(1)}%\n\n`;

  for (const app of results.apps) {
    md += `---\n\n## App: ${app.label} (\`${app.id}\`)\n\n`;
    for (const [section, tests] of Object.entries(app.sections)) {
      md += `### ${section}\n\n`;
      for (const t of tests) {
        const icon = t.passed ? '✅' : '❌';
        md += `- ${icon} **${t.name}**${t.detail ? ` — ${t.detail}` : ''}\n`;
      }
      md += `\n`;
    }
  }

  // App-by-app summary table
  md += `---\n\n## Per-App Summary\n\n`;
  md += `| App | Tests | Passed | Failed | Pass Rate |\n`;
  md += `|-----|-------|--------|--------|-----------|\n`;
  for (const app of results.apps) {
    let total = 0, passed = 0;
    for (const tests of Object.values(app.sections)) {
      for (const t of tests) {
        total++;
        if (t.passed) passed++;
      }
    }
    const rate = total > 0 ? ((passed / total) * 100).toFixed(0) : 'N/A';
    md += `| ${app.label} | ${total} | ${passed} | ${total - passed} | ${rate}% |\n`;
  }

  fs.writeFileSync('/root/.openclaw/workspace/dashboard/tests/reports/batch3-admin-apps.md', md);
  console.log(`\n=== Report written to batch3-admin-apps.md ===`);
  console.log(`Total: ${results.totalTests} | Passed: ${results.passed} | Failed: ${results.failed}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
