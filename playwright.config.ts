import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/e2e.spec.ts',
  timeout: 30000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5000,
    navigationTimeout: 15000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  expect: {
    timeout: 5000,
  },
  reporter: [['list', { printSteps: true }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
