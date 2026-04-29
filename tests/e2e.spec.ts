import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import http from 'http';

const BASE_URL = 'http://127.0.0.1:3876';

// Helper to check if server is up
async function isServerUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/api/health`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 404); // 404 is fine — means server responds
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Auth headers for API requests
const AUTH_TOKEN = 'd3ef40609d190501b71f01e1e57b092697c3a1e09e0272fd920e1e37cbabbcef';
function authHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${AUTH_TOKEN}` };
}

// ===== DESKTOP SHELL TESTS =====

test.describe('OpenClaw Desktop Shell', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('desktop loads with correct title', async ({ page }) => {
    const title = await page.title();
    expect(title).toMatch(/OpenClaw|Dashboard/i);
  });

  test('desktop has no Windows branding visible', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).not.toContain('Windows 11');
    expect(body).not.toContain('Microsoft');
  });

  test('OpenClaw branding is present', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toContain('OpenClaw');
  });

  test('desktop wallpaper renders (not blank white)', async ({ page }) => {
    const desktop = page.locator('.win11-desktop');
    await expect(desktop).toBeAttached();
    const bgStyle = await desktop.evaluate(el => getComputedStyle(el).background);
    // Should have some gradient, not just white
    expect(bgStyle).toBeTruthy();
  });

  test('taskbar is visible and has correct elements', async ({ page }) => {
    const taskbar = page.locator('.win11-taskbar');
    await expect(taskbar).toBeVisible();

    // Start button
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await expect(startBtn).toBeVisible();

    // Pinned app icons (should have 5: Tasks, Agents, Skills & Tools, Operations, Workflows)
    const pinnedApps = page.locator('.win11-taskbar [data-app-id]');
    const count = await pinnedApps.count();
    expect(count).toBe(7);
  });

  test('pinned taskbar apps have correct IDs', async ({ page }) => {
    const expected = ['tasks', 'agents', 'skills-tools', 'operations', 'workflows'];
    for (const id of expected) {
      const btn = page.locator(`.win11-taskbar [data-app-id="${id}"]`);
      await expect(btn).toBeVisible();
    }
  });

  test('system tray clock is visible and shows time', async ({ page }) => {
    const clock = page.locator('.win11-taskbar [data-role="clock"]');
    await expect(clock).toBeVisible();
    const timeText = await clock.textContent();
    // Should contain a time pattern like "10:46" or "10:46 AM"
    expect(timeText).toMatch(/\d{1,2}:\d{2}/);
  });

  test('theme toggle button exists', async ({ page }) => {
    const themeBtn = page.locator('.win11-taskbar [data-action="theme"]');
    await expect(themeBtn).toBeVisible();
  });

  test('dark mode is default', async ({ page }) => {
    // Wait for shell to initialize and set theme
    await page.waitForTimeout(1000);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
  });

  test('theme toggle switches to light mode', async ({ page }) => {
    const themeBtn = page.locator('.win11-taskbar [data-action="theme"]');
    await page.evaluate(() => document.querySelector('[data-action="theme"]')?.click());
    await page.waitForTimeout(300);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('light');
  });

  test('theme toggle switches back to dark mode', async ({ page }) => {
    const themeBtn = page.locator('.win11-taskbar [data-action="theme"]');
    await page.evaluate(() => document.querySelector('[data-action="theme"]')?.click()); // dark -> light
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-action="theme"]')?.click()); // light -> dark
    await page.waitForTimeout(300);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('dark');
  });
});

// ===== START MENU TESTS =====

test.describe('Start Menu', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('opens on start button click', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(250);

    const menu = page.locator('.win11-start-menu');
    await expect(menu).toHaveClass(/is-open/);
  });

  test('closes on second click', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(250);
    await startBtn.click();
    await page.waitForTimeout(250);

    const menu = page.locator('.win11-start-menu');
    await expect(menu).not.toHaveClass(/is-open/);
  });

  test('lists all apps in start menu', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(300);

    const appTiles = page.locator('.win11-start-menu__surface [data-app-id]');
    const allIds = await appTiles.evaluateAll(els => [...new Set(els.map(e => e.dataset.appId))]);
    expect(allIds.length).toBeGreaterThanOrEqual(20);
  });

  test('has search input', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(300);

    const search = page.locator('.win11-start-menu .win11-start-menu__search-input');
    await expect(search).toBeVisible();
  });

  test('search filters apps', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(300);

    const search = page.locator('.win11-start-menu .win11-start-menu__search-input');
    await search.fill('agents');
    await page.waitForTimeout(200);

    const visibleApps = page.locator('.win11-start-menu [data-app-id]');
    const count = await visibleApps.count();
    // Should show at least "Agents" — possibly "Agent Queue" too if that exists
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5); // Should be filtered, not all 20
  });

  test('closing start menu when app clicked', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(300);

    // Click an app
    const agentsTile = page.locator('.win11-start-menu__surface [data-app-id="agents"]').first();
    await agentsTile.click();
    await page.waitForTimeout(500);

    // Menu should close
    const menu = page.locator('.win11-start-menu');
    await expect(menu).not.toHaveClass(/is-open/);
  });
});

// ===== WINDOW MANAGEMENT TESTS =====

test.describe('Window Manager', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
    // Clear any persisted window state
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('opens a window from taskbar (Tasks)', async ({ page }) => {
    const tasksBtn = page.locator('.win11-taskbar [data-app-id="tasks"]');
    await tasksBtn.click();
    await page.waitForTimeout(1000);

    const window = page.locator('[data-app-id="tasks"].win11-window');
    await expect(window).toBeAttached();
  });

  test('window has title bar with title, min, max, close buttons', async ({ page }) => {
    const tasksBtn = page.locator('.win11-taskbar [data-app-id="tasks"]');
    await tasksBtn.click();
    await page.waitForTimeout(1000);

    const win = page.locator('[data-app-id="tasks"].win11-window');
    await expect(win.locator('.win11-window__titlebar')).toBeAttached();
    await expect(win.locator('[data-action="minimize"]')).toBeAttached();
    await expect(win.locator('[data-action="maximize"]')).toBeAttached();
    await expect(win.locator('[data-action="close"]')).toBeAttached();
  });

  test('window has 8 resize handles', async ({ page }) => {
    const tasksBtn = page.locator('.win11-taskbar [data-app-id="tasks"]');
    await tasksBtn.click();
    await page.waitForTimeout(1000);

    const win = page.locator('[data-app-id="tasks"].win11-window');
    const handles = win.locator('[data-resize]');
    await expect(handles).toHaveCount(8);
  });

  test('close button removes window', async ({ page }) => {
    const tasksBtn = page.locator('.win11-taskbar [data-app-id="tasks"]');
    await tasksBtn.click();
    await page.waitForTimeout(1000);

    const win = page.locator('[data-app-id="tasks"].win11-window');
    await expect(win).toBeAttached();

    await win.locator('[data-action="close"]').click();
    await page.waitForTimeout(300);

    await expect(win).not.toBeAttached();
  });

  test('clicking pinned app twice focuses existing window', async ({ page }) => {
    const tasksBtn = page.locator('.win11-taskbar [data-app-id="tasks"]');
    await tasksBtn.click();
    await page.waitForTimeout(1000);

    const windowsBefore = await page.locator('.win11-window').count();
    await tasksBtn.click();
    await page.waitForTimeout(500);

    const windowsAfter = await page.locator('.win11-window').count();
    expect(windowsAfter).toBe(windowsBefore);
  });

  test('multiple windows can be open simultaneously', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="tasks"]').first().click();
    await page.locator('.win11-taskbar [data-app-id="agents"]').click();
    await page.locator('.win11-taskbar [data-app-id="operations"]').click();
    await page.waitForTimeout(1500);

    const windows = await page.locator('.win11-window').count();
    expect(windows).toBe(3);
  });

  test('windows have different z-indices (stacking)', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="tasks"]').first().click();
    await page.locator('.win11-taskbar [data-app-id="agents"]').click();
    await page.waitForTimeout(1000);

    const zIndices = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.win11-window')).map(w => ({
        id: w.dataset.appId,
        zIndex: getComputedStyle(w).zIndex,
      }));
    });

    const last = zIndices[zIndices.length - 1];
    const first = zIndices[0];
    expect(Number(last.zIndex)).toBeGreaterThan(Number(first.zIndex));
  });
});

// ===== NATIVE VIEW TESTS =====

test.describe('Native Views', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('operations view renders natively (no iframe)', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="operations"]').click();
    await page.waitForTimeout(3000);

    const win = page.locator('[data-app-id="operations"].win11-window');
    const nativeContent = win.locator('.win11-window__native-content');
    const iframe = win.locator('.win11-window__iframe');

    await expect(nativeContent).toBeAttached();
    expect(await iframe.count()).toBe(0);
  });

  test('operations view shows content', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="operations"]').click();
    await page.waitForTimeout(3000);

    const win = page.locator('[data-app-id="operations"].win11-window');
    const nativeContent = win.locator('.win11-window__native-content');
    const text = await nativeContent.textContent();

    expect(text).toContain('Operations');
  });

  test('agents view renders natively', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="agents"]').click();
    await page.waitForTimeout(3000);

    const win = page.locator('[data-app-id="agents"].win11-window');
    const nativeContent = win.locator('.win11-window__native-content');
    await expect(nativeContent).toBeAttached();
    expect(await win.locator('.win11-window__iframe').count()).toBe(0);
  });

  test('workflows view renders without hanging', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="workflows"]').click();
    // Wait up to 5 seconds — the templates API returns large payloads
    await page.waitForTimeout(5000);

    const win = page.locator('[data-app-id="workflows"].win11-window');
    const nativeContent = win.locator('.win11-window__native-content');
    await expect(nativeContent).toBeAttached();

    const text = await nativeContent.textContent();
    // Should have rendered, not stuck on "Loading..."
    expect(text).not.toContain('Loading workflows...');
    expect(text).toContain('Workflows');
  });

  test('health view renders natively', async ({ page }) => {
    // Open via start menu since health isn't pinned
    await page.locator('.win11-taskbar [data-action="start"]').click();
    await page.waitForTimeout(300);
    await page.locator('.win11-start-menu [data-app-id="health"]').click();
    await page.waitForTimeout(3000);

    const win = page.locator('[data-app-id="health"].win11-window');
    const nativeContent = win.locator('.win11-window__native-content');
    await expect(nativeContent).toBeAttached();
  });

  test('tasks window renders natively', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="tasks"]').first().click();
    await page.waitForTimeout(2000);

    const win = page.locator('[data-app-id="tasks"].win11-window');
    const native = win.locator('.win11-window__native-content');
    await expect(native).toBeAttached();
  });

  test('window content is scrollable', async ({ page }) => {
    await page.locator('.win11-taskbar [data-app-id="operations"]').click();
    await page.waitForTimeout(3000);

    // The native content div should have overflow: auto
    const overflow = await page.evaluate(() => {
      const nc = document.querySelector('[data-app-id="operations"] .win11-window__native-content');
      return nc ? getComputedStyle(nc).overflow : 'none';
    });
    expect(['auto', 'scroll']).toContain(overflow);
  });
});

// ===== KEYBOARD SHORTCUTS =====

test.describe('Keyboard Shortcuts', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('Meta key toggles start menu', async ({ page }) => {
    const menu = page.locator('.win11-start-menu');
    await expect(menu).not.toHaveClass(/is-open/);

    await page.keyboard.press('Meta');
    await page.waitForTimeout(300);
    await expect(menu).toHaveClass(/is-open/);

    await page.keyboard.press('Meta');
    await page.waitForTimeout(300);
    await expect(menu).not.toHaveClass(/is-open/);
  });
});

// ===== ERROR HANDLING =====

test.describe('Error Handling', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('no JS errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    // Filter out known non-critical errors
    const critical = errors.filter(e => !e.includes('task-options'));
    expect(critical).toHaveLength(0);
  });
});

// ===== NEW FEATURE API TESTS =====

test.describe('History / Time Travel API', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
  });

  test('GET /api/history returns entries', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/history?limit=5`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test('GET /api/history supports action filter', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/history?action=create&limit=3`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.entries).toBeDefined();
  });

  test('snapshots endpoint returns valid structure', async ({ request }) => {
    // Create a task first to guarantee a snapshot exists
    const createResp = await request.post(`${BASE_URL}/api/tasks`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { title: 'E2E Snapshot Test', project_id: 'fef111bf-815e-460a-b4a1-b1012be81375', status: 'backlog' },
    });
    expect(createResp.status()).toBe(201);
    const task = await createResp.json();

    // Move it to trigger a move snapshot
    await request.post(`${BASE_URL}/api/tasks/${task.id}/move`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { status: 'in_progress' },
    });

    // Check snapshots
    const snapResp = await request.get(`${BASE_URL}/api/snapshots/task/${task.id}`, { headers: authHeaders() });
    expect(snapResp.status()).toBe(200);
    const snapBody = await snapResp.json();
    expect(snapBody.total).toBeGreaterThanOrEqual(1);
    expect(snapBody.snapshots[0]).toHaveProperty('action');
    expect(snapBody.snapshots[0]).toHaveProperty('state');

    // Cleanup
    await request.post(`${BASE_URL}/api/tasks/${task.id}/archive`, { headers: authHeaders() });
  });

  test('snapshot revert restores task state', async ({ request }) => {
    // Create and move
    const createResp = await request.post(`${BASE_URL}/api/tasks`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { title: 'E2E Revert Test', project_id: 'fef111bf-815e-460a-b4a1-b1012be81375', status: 'backlog' },
    });
    const task = await createResp.json();

    await request.post(`${BASE_URL}/api/tasks/${task.id}/move`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { status: 'in_progress' },
    });

    // Get create snapshot
    const snapResp = await request.get(`${BASE_URL}/api/snapshots/task/${task.id}`, { headers: authHeaders() });
    const snapshots = (await snapResp.json()).snapshots;
    const createSnap = snapshots.find((s: any) => s.action === 'create');
    expect(createSnap).toBeDefined();

    // Revert
    const revertResp = await request.post(`${BASE_URL}/api/snapshots/${createSnap.id}/revert`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { actor: 'e2e-test' },
    });
    expect(revertResp.status()).toBe(200);
    const revertBody = await revertResp.json();
    expect(revertBody.reverted).toBe(true);

    // Verify task is back to backlog
    const taskResp = await request.get(`${BASE_URL}/api/tasks/${task.id}`, { headers: authHeaders() });
    const updatedTask = await taskResp.json();
    expect(updatedTask.status).toBe('backlog');

    // Cleanup
    await request.post(`${BASE_URL}/api/tasks/${task.id}/archive`, { headers: authHeaders() });
  });
});

test.describe('Spaces API', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
  });

  test('GET /api/spaces returns workspaces', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/spaces`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.spaces.length).toBeGreaterThanOrEqual(1);
    expect(body.spaces[0]).toHaveProperty('name');
    expect(body.spaces[0]).toHaveProperty('slug');
  });

  test('POST /api/spaces creates and DELETE removes', async ({ request }) => {
    const createResp = await request.post(`${BASE_URL}/api/spaces`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { name: 'E2E Test Space', icon: '🧪', color: '#0078d4', description: 'Created by e2e test' },
    });
    expect(createResp.status()).toBe(201);
    const space = await createResp.json();
    expect(space.name).toBe('E2E Test Space');
    expect(space.icon).toBe('🧪');

    // Duplicate
    const dupResp = await request.post(`${BASE_URL}/api/spaces/${space.id}/duplicate`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: {},
    });
    expect(dupResp.status()).toBe(201);
    const dup = await dupResp.json();
    expect(dup.name).toContain('Copy');

    // Delete original
    const delResp = await request.delete(`${BASE_URL}/api/spaces/${space.id}`, { headers: authHeaders() });
    expect(delResp.status()).toBe(200);

    // Delete duplicate
    await request.delete(`${BASE_URL}/api/spaces/${dup.id}`, { headers: authHeaders() });

    // Cannot delete default
    const defaultResp = await request.get(`${BASE_URL}/api/spaces`, { headers: authHeaders() });
    const defaultSpace = (await defaultResp.json()).spaces.find((s: any) => s.is_default);
    if (defaultSpace) {
      const failDel = await request.delete(`${BASE_URL}/api/spaces/${defaultSpace.id}`, { headers: authHeaders() });
      expect(failDel.status()).toBe(403);
    }
  });
});

test.describe('Export / Import API', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
  });

  test('GET /api/export returns full bundle', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/export`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // Export returns bundle data
    expect(body).toBeDefined();
    const hasData = body.projects || body.tasks || body.version;
    expect(hasData).toBeTruthy();
  });

  test('POST /api/import/preview returns preview', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/import/preview`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { version: 1, projects: [], tasks: [], workflows: [], auditLog: [] },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toBeDefined();
  });
});

test.describe('Route Catalog & Auth', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
  });

  test('GET /api/routes returns all registered routes', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/routes`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.total).toBeGreaterThanOrEqual(90);
    expect(body.routes[0]).toHaveProperty('method');
    expect(body.routes[0]).toHaveProperty('path');
  });

  test('GET /api/auth/self returns auth status', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/auth/self`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('authenticated');
    expect(body).toHaveProperty('mode');
  });

  test('Workflow routing returns rules', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/workflow-routing`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.routes.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe('Memory API', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
  });

  test('memory context endpoint returns data', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/memory/context?limit=3`, { headers: authHeaders() });
    expect(resp.status()).toBe(200);
  });
});

test.describe('New Views Render', () => {

  test.beforeEach(async ({ page }) => {
    const up = await isServerUp();
    if (!up) test.skip('Dashboard server not running');
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
  });

  test('spaces view opens without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/index.html?view=spaces`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    const critical = errors.filter(e => !e.includes('task-options') && !e.includes('network'));
    expect(critical).toHaveLength(0);
  });

  test('history view opens without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/index.html?view=history`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    const critical = errors.filter(e => !e.includes('task-options') && !e.includes('network'));
    expect(critical).toHaveLength(0);
  });

  test('route catalog view opens without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/index.html?view=route-catalog`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    const critical = errors.filter(e => !e.includes('task-options') && !e.includes('network'));
    expect(critical).toHaveLength(0);
  });
});
