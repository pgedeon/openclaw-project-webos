#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const integrationPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const registryPath = path.resolve(__dirname, '../src/view-registry.mjs');
  const supportViewsPath = path.resolve(__dirname, '../src/views/support-views.mjs');

  const integration = fs.readFileSync(integrationPath, 'utf8');
  const registry = fs.readFileSync(registryPath, 'utf8');
  const supportViews = fs.readFileSync(supportViewsPath, 'utf8');

  assert.ok(
    integration.includes("import { createViewRegistry } from './view-registry.mjs';"),
    'dashboard integration should import the view registry helper'
  );
  assert.ok(
    integration.includes("import { createSupportViews } from './views/support-views.mjs';"),
    'dashboard integration should import extracted support views'
  );
  assert.ok(
    registry.includes('export function createViewRegistry'),
    'view registry helper should export createViewRegistry'
  );
  assert.ok(
    integration.includes('const registry = getViewRegistry();'),
    'dashboard integration should dispatch views through the registry'
  );
  assert.ok(
    !integration.includes("} else if (view === 'memory')"),
    'memory routing should no longer be handled by duplicated inline branches'
  );
  assert.ok(
    !integration.includes("} else if (view === 'audit')"),
    'audit routing should no longer be handled by duplicated inline branches'
  );

  ['memory', 'audit', 'health', 'runbooks', 'handoffs', 'dependencies'].forEach((viewId) => {
    assert.ok(
      integration.includes(`${viewId}: { render:`),
      `view registry should register the "${viewId}" view`
    );
  });

  assert.ok(
    supportViews.includes("fetch('/api/health-status')"),
    'support views module should own the health endpoint wiring'
  );
  assert.ok(
    supportViews.includes('/api/board-memory-summary?project_id='),
    'support views module should own the memory summary endpoint wiring'
  );
  assert.ok(
    supportViews.includes('/api/lead-handoffs?project_id='),
    'support views module should own the lead handoffs endpoint wiring'
  );
  assert.ok(
    supportViews.includes('const projectId = resolveProjectId(state);'),
    'support views should resolve the active project through a shared helper'
  );

  console.log('PASS: view router registry and support view extraction');
}

try {
  run();
} catch (error) {
  console.error('FAIL: view router registry and support view extraction');
  console.error(error);
  process.exit(1);
}
