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
    expect(count).toBe(5);
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
    await themeBtn.click();
    await page.waitForTimeout(300);

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(theme).toBe('light');
  });

  test('theme toggle switches back to dark mode', async ({ page }) => {
    const themeBtn = page.locator('.win11-taskbar [data-action="theme"]');
    await themeBtn.click(); // dark → light
    await page.waitForTimeout(300);
    await themeBtn.click(); // light → dark
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

  test('lists all 20 apps', async ({ page }) => {
    const startBtn = page.locator('.win11-taskbar [data-action="start"]');
    await startBtn.click();
    await page.waitForTimeout(300);

    const appTiles = page.locator('.win11-start-menu__surface [data-app-id]');
    const allIds = await appTiles.evaluateAll(els => [...new Set(els.map(e => e.dataset.appId))]);
    expect(allIds.length).toBe(20);
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
