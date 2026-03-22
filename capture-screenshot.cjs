const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  // Increase timeout for slow networks
  page.setDefaultTimeout(30000);
  await page.goto('http://localhost:3877/workflow-editor.html', { waitUntil: 'domcontentloaded' });
  // Wait for fonts and rendering
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './workflow-editor-screenshot.png', fullPage: true });
  await browser.close();
  console.log('Screenshot saved to workflow-editor-screenshot.png');
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
