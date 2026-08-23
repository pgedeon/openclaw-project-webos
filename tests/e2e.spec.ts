import { test, expect } from '@playwright/test';

/**
 * DB-free e2e smoke suite (CI "e2e" job).
 *
 * The previous version of this spec asserted CRUD against a live task storage
 * backend (POST /api/tasks → 201, snapshots, spaces). Those routes require an
 * initialized Asana storage pool; with STORAGE_TYPE=json_snapshot the server
 * intentionally runs without one (storage routes respond 503), so the full
 * suite cannot pass without real PostgreSQL. Replaced (2026-08-23) with this
 * minimal smoke subset that covers what works DB-free:
 *   - dashboard page loads with correct title
 *   - auth token gate appears when DASHBOARD_AUTH_TOKEN is set and no token
 *     is stored (SECURITY-AUDIT-2026-08.md F1 bootstrap flow)
 *   - no uncaught JS errors while the gate is shown
 *   - /api/health + /api/auth/self contract
 *   - shell boots once a valid token is stored
 *
 * Configuration:
 *   E2E_BASE_URL    — server origin (default http://127.0.0.1:3876)
 *   E2E_AUTH_TOKEN  — must equal the server's DASHBOARD_AUTH_TOKEN; tests that
 *                     need an authenticated shell are skipped when unset.
 */

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3876';
const AUTH_TOKEN = process.env.E2E_AUTH_TOKEN || '';
const TOKEN_STORAGE_KEY = 'openclaw.dashboardToken';

test.describe('Desktop shell smoke (DB-free)', () => {

  test('dashboard loads with correct title', async ({ page }) => {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page).toHaveTitle(/OpenClaw/i);
  });

  test('auth token gate appears when no token is stored', async ({ page }) => {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const gate = page.locator('#auth-bootstrap-overlay');
    await expect(gate).toBeVisible({ timeout: 10000 });
    await expect(gate.locator('#auth-bootstrap-token')).toBeVisible();
    await expect(gate.locator('#auth-bootstrap-connect')).toBeVisible();
  });

  test('no uncaught JS errors while auth gate is shown', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await expect(page.locator('#auth-bootstrap-overlay')).toBeVisible({ timeout: 10000 });
    // Give late async failures a moment to surface before asserting.
    await page.waitForTimeout(1500);
    expect(pageErrors).toEqual([]);
  });

  test('GET /api/health responds without a database', async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/health`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('storage_type', 'json_snapshot');
    expect(body).toHaveProperty('status');
  });

  test('GET /api/auth/self rejects missing and bad tokens', async ({ request }) => {
    const anon = await request.get(`${BASE_URL}/api/auth/self`);
    expect(anon.status()).toBe(200);
    expect((await anon.json()).authenticated).toBe(false);

    const bad = await request.get(`${BASE_URL}/api/auth/self`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(bad.status()).toBe(200);
    expect((await bad.json()).authenticated).toBe(false);
  });

  test('GET /api/auth/self accepts the configured token', async ({ request }) => {
    test.skip(!AUTH_TOKEN, 'E2E_AUTH_TOKEN not set');
    const resp = await request.get(`${BASE_URL}/api/auth/self`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.authenticated).toBe(true);
    expect(body).toHaveProperty('mode');
  });

  test('shell boots after a valid token is stored', async ({ page }) => {
    test.skip(!AUTH_TOKEN, 'E2E_AUTH_TOKEN not set');
    await page.addInitScript(
      (args: [string, string]) => localStorage.setItem(args[0], args[1]),
      [TOKEN_STORAGE_KEY, AUTH_TOKEN],
    );
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Gate must never appear for a valid stored token...
    await expect(page.locator('#auth-bootstrap-overlay')).toHaveCount(0, { timeout: 15000 });
    // ...and the desktop shell must come up.
    await expect(page.locator('.win11-taskbar [data-action="start"]')).toBeVisible({ timeout: 20000 });
  });

});
