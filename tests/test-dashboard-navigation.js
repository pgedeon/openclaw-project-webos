#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const agentsHtmlPath = path.resolve(__dirname, '../agents.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const agentsHtml = fs.readFileSync(agentsHtmlPath, 'utf8');

  ['Work', 'Operations', 'Admin'].forEach((group) => {
    assert.ok(
      html.includes(`>${group}</p>`),
      `dashboard navigation should expose the ${group} group label`
    );
  });

  [
    'Task List',
    'Board',
    'Timeline',
    'Agents',
    'Requests',
    'Publish',
    'Approvals',
    'Artifacts',
    'Dependencies',
    'Health',
    'Metrics',
    'Runbooks',
    'Memory',
    'Handoffs',
    'Audit',
    'Cron',
    'Departments',
    'Skills &amp; Tools'
  ].forEach((label) => {
    assert.ok(
      html.includes(`<span class="view-btn-label">${label}</span>`),
      `dashboard navigation should expose a readable label for ${label}`
    );
  });

  [
    'list',
    'board',
    'timeline',
    'agent',
    'service-requests',
    'publish',
    'approvals',
    'artifacts',
    'dependencies',
    'health',
    'metrics',
    'runbooks',
    'memory',
    'handoffs',
    'audit',
    'cron',
    'departments',
    'skills-tools'
  ].forEach((viewId) => {
    assert.ok(
      html.includes(`data-view="${viewId}"`),
      `dashboard navigation should keep the ${viewId} routing hook`
    );
  });

  assert.ok(
    html.includes('.view-switcher {\n            display: grid;'),
    'dashboard navigation should use the responsive grouped switcher layout'
  );
  assert.ok(
    html.includes('.view-group-buttons {\n                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));'),
    'dashboard navigation should keep grouped buttons usable on narrow widths'
  );
  assert.ok(
    html.includes('<a href="/skills-tools">Skills &amp; Tools</a>'),
    'dashboard page nav should expose a direct Skills & Tools entry point'
  );
  assert.ok(
    agentsHtml.includes('<a href="/skills-tools">Skills &amp; Tools</a>'),
    'agents page nav should expose a direct Skills & Tools entry point'
  );

  console.log('PASS: dashboard navigation readability');
}

try {
  run();
} catch (error) {
  console.error('FAIL: dashboard navigation readability');
  console.error(error);
  process.exit(1);
}
