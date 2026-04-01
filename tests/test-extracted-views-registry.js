#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const integrationPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const integration = fs.readFileSync(integrationPath, 'utf8');

  // All heavy views that should be extracted into separate modules
  // wrapperFn is the name of the wrapper function in the main file (may differ from importFn)
  const extractedViews = [
    {
      name: 'departments',
      module: 'departments-view.mjs',
      importFn: 'renderDepartmentsView',
      wrapperFn: 'renderDepartmentOpsView',
      quoted: false,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showNotice', 'showSessionDetails', 'getStateSync', 'formatTimestamp']
    },
    {
      name: 'service-requests',
      module: 'service-requests-view.mjs',
      importFn: 'renderServiceRequestsView',
      wrapperFn: 'renderServiceRequestsView',
      quoted: true,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showNotice', 'getStateSync', 'formatTimestamp']
    },
    {
      name: 'approvals',
      module: 'approvals-view.mjs',
      importFn: 'renderApprovalsView',
      wrapperFn: 'renderApprovalsView',
      quoted: false,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showNotice', 'showSessionDetails', 'formatTimestamp']
    },
    {
      name: 'artifacts',
      module: 'artifacts-view.mjs',
      importFn: 'renderArtifactsView',
      wrapperFn: 'renderArtifactsView',
      quoted: false,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showNotice', 'showSessionDetails', 'formatTimestamp']
    },
    {
      name: 'metrics',
      module: 'metrics-view.mjs',
      importFn: 'renderMetricsView',
      wrapperFn: 'renderMetricsView',
      quoted: false,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showNotice']
    },
    {
      name: 'publish',
      module: 'publish-view.mjs',
      importFn: 'renderPublishView',
      wrapperFn: 'renderPublishView',
      quoted: false,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'showSessionDetails']
    },
    {
      name: 'skills-tools',
      module: 'skills-tools-view.mjs',
      importFn: 'renderSkillsToolsView',
      wrapperFn: 'renderSkillsToolsView',
      quoted: true,
      params: ['mountNode', 'fetchImpl', 'escapeHtml', 'formatTimestamp', 'showNotice']
    }
  ];

  // Verify each extracted view is imported and registered
  extractedViews.forEach((view) => {
    const importPattern = `import { ${view.importFn} as ${view.importFn}Module } from './views/${view.module}';`;
    assert.ok(
      integration.includes(importPattern),
      `dashboard integration should import ${view.name} view module`
    );

    // Check for both quoted and unquoted registry patterns
    const registryPattern = view.quoted
      ? `'${view.name}': { render:`
      : `${view.name}: { render:`;
    assert.ok(
      integration.includes(registryPattern),
      `view registry should register the "${view.name}" view`
    );
  });

  // Verify each extracted view module exists and exports its render function
  extractedViews.forEach((view) => {
    const modulePath = path.resolve(__dirname, `../src/views/${view.module}`);
    assert.ok(
      fs.existsSync(modulePath),
      `extracted module src/views/${view.module} should exist`
    );

    const moduleSource = fs.readFileSync(modulePath, 'utf8');
    assert.ok(
      moduleSource.includes(`export async function ${view.importFn}`),
      `${view.module} should export async function ${view.importFn}`
    );

    // Verify standardized render context interface - check only the params this module actually uses
    view.params.forEach((param) => {
      assert.ok(
        moduleSource.includes(param),
        `${view.module} should accept ${param} parameter`
      );
    });

    // All modules must have mountNode and fetchImpl as the minimum standard interface
    assert.ok(
      moduleSource.includes('mountNode') && moduleSource.includes('fetchImpl'),
      `${view.module} should accept standardized mountNode and fetchImpl parameters`
    );
  });

  // Verify the main integration file delegates to extracted modules
  extractedViews.forEach((view) => {
    // Check that wrapper functions exist in the main file
    const wrapperPattern = `async function ${view.wrapperFn}(state)`;
    assert.ok(
      integration.includes(wrapperPattern),
      `dashboard integration should define wrapper function ${view.wrapperFn} for ${view.name}`
    );

    // Check delegation to module
    const delegationPattern = `${view.importFn}Module({`;
    assert.ok(
      integration.includes(delegationPattern),
      `dashboard integration should delegate ${view.name} rendering to ${view.importFn}Module`
    );
  });

  // Verify main file is shrunk (should be under 4500 lines after extraction)
  const lineCount = integration.split('\n').length;
  assert.ok(
    lineCount < 4500,
    `main integration file should be under 4500 lines after extraction (got ${lineCount})`
  );

  console.log('PASS: extracted view modules registry coverage');
}

try {
  run();
} catch (error) {
  console.error('FAIL: extracted view modules registry coverage');
  console.error(error);
  process.exit(1);
}
