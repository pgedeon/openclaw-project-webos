#!/usr/bin/env node
/**
 * Comprehensive OpenClaw Desktop test runner.
 * Opens each window, checks for errors, validates data.
 * Usage: node tests/comprehensive-test.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3876/index.html';

const windows = [
  { label: 'Tasks', taskbar: true, checks: ['New Task', 'All'] },
  { label: 'Agents', taskbar: true, checks: [], noText: ['.av-status-dot', '.av-status-active', '{ display:', 'background: #'] },
  { label: 'Skills & Tools', taskbar: true, checks: ['Skills', 'Tools'] },
  { label: 'Operations', taskbar: true, checks: ['Agent Status', 'Overview'] },
  { label: 'Workflows', taskbar: true, checks: ['Templates'] },
  { label: 'Health', taskbar: false, checks: [] },
  { label: 'Cron', taskbar: false, checks: [] },
  { label: 'Memory', taskbar: false, checks: ['Browse Files', 'Search', 'Facts', 'System Status'] },
  { label: 'Runbooks', taskbar: false, checks: [] },
  { label: 'Handoffs', taskbar: false, checks: [], expectApi404: true },
  { label: 'Metrics', taskbar: false, checks: [] },
  { label: 'Approvals', taskbar: false, checks: [] },
  { label: 'Artifacts', taskbar: false, checks: [] },
  { label: 'Audit', taskbar: false, checks: [] },
  { label: 'Dependencies', taskbar: false, checks: [] },
  { label: 'Departments', taskbar: false, checks: [] },
  { label: 'Board', taskbar: false, checks: [], expectIframe: true },
];

const results = [];

async function setupPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  return { page, ctx, getErrors: () => [...errors] };
}

async function openWindow(page, label, taskbar) {
  if (taskbar) {
    // Try taskbar button by title attribute first
    const btn = page.locator(`nav button[title="${label}"]`);
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(2000);
      return true;
    }
  }
  // Start menu
  await page.click('button:has-text("Start")');
  await page.waitForTimeout(600);
  const btn = page.locator(`button:has-text("${label}")`).last();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}

async function closeTopWindow(page) {
  // Find the active/top dialog and click its close button
  const dialogs = page.locator('[role="dialog"].is-active');
  const count = await dialogs.count();
  if (count > 0) {
    await dialogs.last().locator('[data-action="close"]').click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function closeAllWindows(page) {
  for (let i = 0; i < 10; i++) {
    const dialogs = page.locator('[role="dialog"]');
    if (await dialogs.count() === 0) break;
    const active = page.locator('[role="dialog"].is-active');
    if (await active.count() > 0) {
      await active.last().locator('[data-action="close"]').click();
    } else {
      await dialogs.last().locator('[data-action="close"]').click();
    }
    await page.waitForTimeout(400);
  }
}

async function testWindow(browser, win) {
  const { page, ctx, getErrors } = await setupPage(browser);
  const result = { window: win.label, passed: true, issues: [] };

  try {
    const opened = await openWindow(page, win.label, win.taskbar);
    if (!opened) {
      result.passed = false;
      result.issues.push('Could not open window');
      return result;
    }

    // Wait for content to settle
    await page.waitForTimeout(1500);

    // Check for native content or iframe
    const nativeContent = page.locator('.win11-window__native-content');
    const hasNative = await nativeContent.first().isVisible({ timeout: 3000 }).catch(() => false);

    if (win.expectIframe) {
      const iframe = page.locator('[role="dialog"] iframe');
      const hasIframe = await iframe.first().isVisible({ timeout: 3000 }).catch(() => false);
      result.hasNative = false;
      result.hasIframe = hasIframe;
      if (!hasIframe) result.issues.push('Expected iframe not found');
    } else if (hasNative) {
      result.hasNative = true;
    } else {
      const iframe = page.locator('[role="dialog"] iframe');
      const hasIframe = await iframe.count().then(c => c > 0);
      result.hasNative = false;
      result.hasIframe = hasIframe;
      if (hasIframe) {
        result.issues.push(`Fell back to iframe (native view failed)`);
        result.passed = false;
      } else {
        result.issues.push(`No native content or iframe found`);
        result.passed = false;
      }
    }

    // Check for leaked CSS in body text
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('.av-status-dot') || bodyText.includes('.av-status-active')) {
      result.issues.push('LEAKED CSS TEXT VISIBLE');
      result.passed = false;
    }

    if (win.noText) {
      for (const text of win.noText) {
        if (bodyText.includes(text)) {
          result.issues.push(`Forbidden text: "${text.substring(0, 30)}"`);
          result.passed = false;
        }
      }
    }

    // Check expected content
    for (const check of win.checks) {
      if (!bodyText.includes(check)) {
        result.issues.push(`Missing text: "${check}"`);
        result.passed = false;
      }
    }

    // Check for real JS errors (filter noise)
    const allErrors = getErrors();
    const realErrors = allErrors.filter(e =>
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('127.0.0.1:3878') &&
      !e.includes('favicon') &&
      !e.includes('Failed to load resource') &&
      !e.includes('manifest.json') &&
      !(win.expectApi404 && e.includes('HandoffsView'))
    );
    if (realErrors.length > 0) {
      result.issues.push(`JS errors: ${realErrors.slice(0, 2).join(' | ')}`);
      result.passed = false;
    }

    // Check window has title bar
    const titleBar = page.locator('[role="dialog"] .win11-window__titlebar');
    const hasTitleBar = await titleBar.first().isVisible({ timeout: 2000 }).catch(() => false);
    if (!hasTitleBar) result.issues.push('Missing window titlebar');

  } catch (err) {
    result.passed = false;
    result.issues.push(`Exception: ${err.message.substring(0, 100)}`);
  } finally {
    await ctx.close();
  }

  return result;
}

async function testDesktop(browser) {
  const { page, ctx, getErrors } = await setupPage(browser);
  const result = { window: 'Desktop Shell', passed: true, issues: [] };

  try {
    // Check dark theme default
    const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const match = bgColor.match(/rgb\((\d+)/);
    if (match && parseInt(match[1]) >= 128) {
      result.issues.push('Not using dark theme by default');
      result.passed = false;
    }

    // Check desktop area exists
    const desktop = page.locator('.win11-desktop');
    if (!await desktop.isVisible({ timeout: 3000 }).catch(() => false)) {
      result.issues.push('Desktop area not visible');
      result.passed = false;
    }

    // Check taskbar exists
    const taskbar = page.locator('nav');
    if (!await taskbar.isVisible({ timeout: 2000 }).catch(() => false)) {
      result.issues.push('Taskbar not visible');
      result.passed = false;
    }

    // No critical JS errors
    await page.waitForTimeout(2000);
    const errors = getErrors();
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('manifest')
    );
    if (critical.length > 0) {
      result.issues.push(`JS errors: ${critical.slice(0, 2).join(' | ')}`);
      result.passed = false;
    }

  } catch (err) {
    result.passed = false;
    result.issues.push(`Exception: ${err.message.substring(0, 100)}`);
  } finally {
    await ctx.close();
  }

  return result;
}

async function testWindowManagement(browser) {
  const { page, ctx, getErrors } = await setupPage(browser);
  const result = { window: 'Window Management', passed: true, issues: [] };

  try {
    // Open Tasks from taskbar
    await openWindow(page, 'Tasks', true);
    let winCount = await page.locator('[role="dialog"]').count();
    if (winCount < 1) { result.issues.push('Tasks window did not open'); result.passed = false; }

    // Open Agents from start menu
    await openWindow(page, 'Agents', false);
    winCount = await page.locator('[role="dialog"]').count();
    if (winCount < 2) { result.issues.push('Second window did not open'); result.passed = false; }

    // Minimize first window
    const minimizeBtn = page.locator('[role="dialog"]').first().locator('[data-action="minimize"]');
    if (await minimizeBtn.count() > 0) {
      await minimizeBtn.click();
      await page.waitForTimeout(400);
    }

    // Close active window
    await closeTopWindow(page);
    await page.waitForTimeout(400);
    winCount = await page.locator('[role="dialog"]:not(.is-minimized)').count();
    // After closing one, at least 1 should remain (minimized one)
    const totalDialogs = await page.locator('[role="dialog"]').count();
    if (totalDialogs >= 2) {
      // One should be minimized
    }

    // Check errors
    const errors = getErrors();
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('Failed to load resource') && !e.includes('ERR_CONNECTION_REFUSED')
    );
    if (critical.length > 0) {
      result.issues.push(`Errors: ${critical.slice(0, 2).join(' | ')}`);
      result.passed = false;
    }

  } catch (err) {
    result.passed = false;
    result.issues.push(`Exception: ${err.message.substring(0, 100)}`);
  } finally {
    await ctx.close();
  }

  return result;
}

async function testDataAccuracy(browser) {
  const { page, ctx, getErrors } = await setupPage(browser);
  const result = { window: 'Data Accuracy', passed: true, issues: [] };

  try {
    // Test Memory view shows 50+ files
    await openWindow(page, 'Memory', false);
    await page.waitForTimeout(3000);
    let bodyText = await page.evaluate(() => document.body.innerText);
    const filesMatch = bodyText.match(/Total Files\s+(\d+)/);
    if (filesMatch && parseInt(filesMatch[1]) < 50) {
      result.issues.push(`Memory: Expected 50+ files, got ${filesMatch[1]}`);
      result.passed = false;
    }
    if (!bodyText.includes('Total Files')) {
      result.issues.push('Memory: Missing "Total Files" stat');
      result.passed = false;
    }
    await closeTopWindow(page);
    await page.waitForTimeout(500);

    // Test Workflows shows template count
    await openWindow(page, 'Workflows', true);
    await page.waitForTimeout(2000);
    bodyText = await page.evaluate(() => document.body.innerText);
    if (!bodyText.includes('Templates')) {
      result.issues.push('Workflows: Missing "Templates" section');
      result.passed = false;
    }
    await closeTopWindow(page);
    await page.waitForTimeout(500);

    // Test Cron shows real jobs (not "no jobs")
    await openWindow(page, 'Cron', false);
    await page.waitForTimeout(3000);
    bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('No cron jobs found') && bodyText.includes('0')) {
      result.issues.push('Cron: Shows "no jobs" — cron-manager may be down');
    }
    await closeTopWindow(page);
    await page.waitForTimeout(500);

    // Test Operations loads agent status
    await openWindow(page, 'Operations', true);
    await page.waitForTimeout(3000);
    bodyText = await page.evaluate(() => document.body.innerText);
    if (!bodyText.includes('Agent Status')) {
      result.issues.push('Operations: Missing "Agent Status" section');
      result.passed = false;
    }

    // Check for leaked CSS
    if (bodyText.includes('.av-status-dot')) {
      result.issues.push('Operations: CSS leaking in agent status');
      result.passed = false;
    }

  } catch (err) {
    result.passed = false;
    result.issues.push(`Exception: ${err.message.substring(0, 100)}`);
  } finally {
    await ctx.close();
  }

  return result;
}

// ==================== MAIN ====================

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     OpenClaw Desktop — Comprehensive Test Suite      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  // Desktop shell
  console.log('── Desktop Shell ──');
  const shellResult = await testDesktop(browser);
  allResults.push(shellResult);
  console.log(`  ${shellResult.passed ? '✅' : '❌'} Desktop: ${shellResult.issues.length ? shellResult.issues.join(', ') : 'OK'}`);

  // Window management
  console.log('\n── Window Management ──');
  const wmResult = await testWindowManagement(browser);
  allResults.push(wmResult);
  console.log(`  ${wmResult.passed ? '✅' : '❌'} Window Mgmt: ${wmResult.issues.length ? wmResult.issues.join(', ') : 'OK'}`);

  // Each window
  console.log('\n── Native Views ──');
  for (const win of windows) {
    const r = await testWindow(browser, win);
    allResults.push(r);
    const mode = r.expectIframe ? 'iframe' : r.hasNative ? 'native' : r.hasIframe ? 'iframe-fallback ⚠️' : 'unknown ❌';
    console.log(`  ${r.passed ? '✅' : '❌'} ${win.label.padEnd(16)} (${mode}): ${r.issues.length ? r.issues.join(', ') : 'OK'}`);
  }

  // Data accuracy
  console.log('\n── Data Accuracy ──');
  const dataResult = await testDataAccuracy(browser);
  allResults.push(dataResult);
  console.log(`  ${dataResult.passed ? '✅' : '❌'} Data Accuracy: ${dataResult.issues.length ? dataResult.issues.join(', ') : 'OK'}`);

  // Summary
  const passed = allResults.filter(r => r.passed).length;
  const failed = allResults.filter(r => !r.passed).length;
  console.log(`\n═════════════════════════════════════`);
  console.log(`  Results: ${passed}/${allResults.length} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n  Failures:');
    for (const r of allResults.filter(r => !r.passed)) {
      console.log(`    ❌ ${r.window}:`);
      for (const issue of r.issues) console.log(`       - ${issue}`);
    }
  }
  console.log('═════════════════════════════════════\n');

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
