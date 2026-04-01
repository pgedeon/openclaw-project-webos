#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const htmlPath = path.resolve(__dirname, '../dashboard.html');
  const jsPath = path.resolve(__dirname, '../src/dashboard-integration-optimized.mjs');
  const modulePath = path.resolve(__dirname, '../src/views/metrics-view.mjs');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');

  assert.ok(
    html.includes('data-view="metrics"'),
    'dashboard toolbar should expose the metrics view button'
  );
  assert.ok(
    js.includes("metrics: { render: renderMetricsView }"),
    'dashboard integration should register the metrics view in the view registry'
  );
  assert.ok(
    js.includes("import { renderMetricsView as renderMetricsViewModule } from './views/metrics-view.mjs';"),
    'dashboard integration should import the extracted metrics module'
  );
  assert.ok(
    js.includes('return renderMetricsViewModule({'),
    'dashboard integration should delegate metrics rendering to the extracted module'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/org?${query}`"),
    'metrics renderer should load the org scorecard endpoint'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/departments?${query}`"),
    'metrics renderer should load the department scorecards endpoint'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/departments/${encodeURIComponent(selectedDepartmentId)}?${query}`"),
    'metrics renderer should load the department detail metrics endpoint for trend snapshots'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/agents?${query}`"),
    'metrics renderer should load the agent scorecards endpoint'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/services?${query}`"),
    'metrics renderer should load the service scorecards endpoint'
  );
  assert.ok(
    moduleSource.includes("fetchImpl(`/api/metrics/sites?${query}`"),
    'metrics renderer should load the site scorecards endpoint'
  );
  assert.ok(
    moduleSource.includes('id="metricsDateFrom"') && moduleSource.includes('id="metricsDateTo"'),
    'metrics renderer should expose date range controls'
  );
  ['Org Scorecard', 'Department Scorecards', 'Agent Scorecards', 'Site Scorecards', 'Service Scorecards'].forEach((heading) => {
    assert.ok(
      moduleSource.includes(heading),
      `metrics renderer should include the "${heading}" section`
    );
  });
  assert.ok(
    moduleSource.includes('Department Trend Snapshots') && moduleSource.includes('metricsDepartmentSelect'),
    'metrics renderer should include the department trend snapshot section and selector'
  );

  console.log('PASS: metrics view wiring');
}

try {
  run();
} catch (error) {
  console.error('FAIL: metrics view wiring');
  console.error(error);
  process.exit(1);
}
