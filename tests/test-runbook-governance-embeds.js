#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const supportViewsPath = path.resolve(__dirname, '../src/views/support-views.mjs');
  const js = fs.readFileSync(jsPath, 'utf8');
  const supportViews = fs.readFileSync(supportViewsPath, 'utf8');

  assert.ok(
    js.includes('Governance & Runbook'),
    'workflow run detail should include a governance and runbook section'
  );
  assert.ok(
    js.includes('Runbook: ${run.governance?.runbookRef') || js.includes('Runbook: ${template.runbookRef'),
    'dashboard integration should surface runbook references from runs or templates'
  );
  assert.ok(
    supportViews.includes('fetchRunbookContent(template.runbookRef || template.name, contentPane)'),
    'runbooks support view should load the linked template runbook into the content pane'
  );
  assert.ok(
    js.includes('Policy: ${escapeHtml(t.governance.actionPolicy.map'),
    'workflow launcher should surface governance policy summaries on template cards'
  );

  console.log('PASS: runbook governance embeds');
}

try {
  run();
} catch (error) {
  console.error('FAIL: runbook governance embeds');
  console.error(error);
  process.exit(1);
}
