const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3876';
const OUT = path.join(__dirname, 'docs', 'screenshots');

// Apps to screenshot - matching the data-app-id attributes
const APPS = [
  { id: 'tasks',         label: 'Tasks (Board View)' },
  { id: 'agents',        label: 'Agents' },
  { id: 'operations',    label: 'Operations Center' },
  { id: 'workflows',     label: 'Workflows' },
  { id: 'skills-tools',  label: 'Skills & Tools' },
];

async function captureView(page, appId, label) {
  const outFile = path.join(OUT, `${appId}.png`);
  console.log(`  Opening: ${label}...`);

  // Click the taskbar button for this app
  const selector = `.win11-taskbar__button[data-app-id="${appId}"]`;
  await page.click(selector);
  await page.waitForTimeout(2000);

  // Wait for a window to appear
  try {
    await page.waitForSelector('.win11-window', { timeout: 8000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`    No window appeared, waiting longer...`);
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: outFile, fullPage: false });
  const size = fs.statSync(outFile).size;
  console.log(`    ✓ ${label}: ${(size / 1024).toFixed(0)} KB`);

  // Close the window
  try {
    await page.click('.win11-window .win11-window__titlebar-close, .win11-window__close-btn');
    await page.waitForTimeout(500);
  } catch (e) {
    // Try pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  console.log('Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // Load the desktop shell
  console.log('Loading desktop shell...');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Verify shell loaded
  const hasTaskbar = await page.evaluate(() => {
    return !!document.getElementById('taskbar-root')?.children.length;
  });
  console.log(`Taskbar loaded: ${hasTaskbar}`);

  // Screenshot 1: Desktop welcome screen with taskbar
  console.log('\n1. Desktop Welcome');
  await page.screenshot({ path: path.join(OUT, 'desktop-welcome.png'), fullPage: false });
  console.log('   ✓ Saved');

  // Screenshot 2: Start menu open
  console.log('\n2. Start Menu');
  try {
    await page.click('.win11-taskbar__start-btn, [data-action="start-menu"]');
    await page.waitForTimeout(1000);
    await page.waitForSelector('.win11-start-menu', { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'start-menu.png'), fullPage: false });
    console.log('   ✓ Saved');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (e) {
    console.log(`   ✗ Start menu: ${e.message.slice(0, 80)}`);
  }

  // Screenshot 3-7: Each app view
  console.log('\n3. App Views');
  for (const app of APPS) {
    await captureView(page, app.id, app.label);
  }

  // Screenshot 8: Widget panel
  console.log('\n8. Widget Panel');
  try {
    await page.click('.win11-taskbar__widget-btn, [data-action="widgets"]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'widget-panel.png'), fullPage: false });
    console.log('   ✓ Saved');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (e) {
    console.log(`   ✗ Widgets: ${e.message.slice(0, 80)}`);
  }

  // Screenshot 9: Full desktop with a window open (Tasks)
  console.log('\n9. Desktop with Tasks window open');
  try {
    await page.click('.win11-taskbar__button[data-app-id="tasks"]');
    await page.waitForTimeout(2500);
    await page.waitForSelector('.win11-window', { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'desktop-with-tasks.png'), fullPage: false });
    console.log('   ✓ Saved');
  } catch (e) {
    console.log(`   ✗: ${e.message.slice(0, 80)}`);
  }

  await browser.close();

  // List results
  console.log('\n--- Results ---');
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  files.forEach(f => {
    const size = fs.statSync(path.join(OUT, f)).size;
    console.log(`  ${(size / 1024).toFixed(0).padStart(5)} KB  ${f}`);
  });
  console.log(`\nTotal: ${files.length} screenshots in ${OUT}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
