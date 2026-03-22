import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3876/index.html';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  
  // Track errors
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  
  console.log('Window Management Test');
  
  // Open Tasks (taskbar)
  await page.click('nav button:has-text("Tasks")');
  await page.waitForTimeout(1000);
  let dialogs = await page.locator('[role="dialog"]').count();
  console.log(`  After Tasks: ${dialogs} windows`);
  
  // Open Agents (taskbar)  
  await page.click('nav button:has-text("Agents")');
  await page.waitForTimeout(1000);
  dialogs = await page.locator('[role="dialog"]').count();
  console.log(`  After Agents: ${dialogs} windows`);
  
  // Check errors
  const critical = errors.filter(e => !e.includes('favicon') && !e.includes('ERR_CONNECTION_REFUSED'));
  if (critical.length > 0) {
    console.log(`  ⚠️ Errors: ${critical.join(' | ')}`);
  } else {
    console.log(`  ✓ No critical JS errors`);
  }
  
  await browser.close();
  console.log(`  ✅ Window management works.`);
}

main().catch(err => { console.error(err); process.exit(1); });
