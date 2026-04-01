#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const swPath = path.resolve(__dirname, '../sw.js');
  const dashboardHtmlPath = path.resolve(__dirname, '../dashboard.html');
  const agentsHtmlPath = path.resolve(__dirname, '../agents.html');

  const sw = fs.readFileSync(swPath, 'utf8');
  const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
  const agentsHtml = fs.readFileSync(agentsHtmlPath, 'utf8');

  assert.ok(
    sw.includes("const DISABLE_ON_LOCAL_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';"),
    'service worker should disable itself on local dashboard hosts'
  );
  assert.ok(
    sw.includes("console.log('[ServiceWorker] Local dev detected, unregistering service worker');"),
    'service worker should self-unregister in local dev'
  );
  assert.ok(
    sw.includes("if (DISABLE_ON_LOCAL_DEV) {\n    return;\n  }\n\n  const { request } = event;"),
    'service worker fetch handler should bypass interception in local dev'
  );

  [dashboardHtml, agentsHtml].forEach((html, index) => {
    const label = index === 0 ? 'dashboard' : 'agents';
    assert.ok(
      html.includes("navigator.serviceWorker.getRegistrations()"),
      `${label} page should clear existing service worker registrations on local dev hosts`
    );
    assert.ok(
      html.includes("key.startsWith('openclaw-dashboard-')"),
      `${label} page should clear cached dashboard artifacts on local dev hosts`
    );
  });

  console.log('PASS: local dev service worker cleanup');
}

try {
  run();
} catch (error) {
  console.error('FAIL: local dev service worker cleanup');
  console.error(error);
  process.exit(1);
}
