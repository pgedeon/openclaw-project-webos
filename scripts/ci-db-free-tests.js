#!/usr/bin/env node
/**
 * ci-db-free-tests.js
 *
 * CI test runner: executes ONLY the tests verified to run without PostgreSQL,
 * a running server, Playwright browsers, or CLI arguments.
 *
 * Verification method (2026-08-23): each test was executed with PostgreSQL
 * made unreachable (isolated network namespace) on Node v20.20.2 and v22;
 * only tests exiting 0 were included.
 *
 * The full exclusion rationale lives in .github/workflows/ci.yml.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const TEST_TIMEOUT_MS = 45000;

// DB-free test subset (all pass with PostgreSQL unreachable).
const INCLUDED = [
  'test-action-client.js',
  'test-action-routes.js',
  'test-accent-packs.js',
  'test-agent-routes.js',
  'test-auth-policy.js',
  'test-backfill-run-costs.js',
  'test-bing-routes.js',
  'test-budget-enforcement.js',
  'test-budget-notifier.js',
  'test-budget-routes.js',
  'test-budgets-view.js',
  'test-capability-status.js',
  'test-catalog-api.js',
  'test-chat-routes.js',
  'test-console-feed.js',
  'test-cost-routes.js',
  'test-cron-routes.js',
  'test-dag-telemetry.js',
  'test-dispatcher-v2.js',
  'test-e2e-mcp-snapshot-flows.js',
  'test-export-routes.js',
  'test-filesystem-api-auth.mjs',
  'test-filesystem-proxy-availability.js',
  'test-filesystem-proxy-origin.js',
  'test-gateway-bridge.js',
  'test-health-routes.js',
  'test-health-status-gateway-snapshot.js',
  'test-history-routes.js',
  'test-list-window.js',
  'test-memory-browser-view.js',
  'test-memory-routes.js',
  'test-mcp-adapter.js',
  'test-mcp-server.js',
  'test-mcp-telemetry.js',
  'test-metrics-api.js',
  'test-nl-parse.js',
  'test-operational-followup.js',
  'test-org-api-storage.js',
  'test-org-api.js',
  'test-org-department-operating-view.js',
  'test-project-routes.js',
  'test-pwa-install.js',
  'test-route-modules.js',
  'test-schema-drift-check.js',
  'test-service-requests-api.js',
  'test-session-jsonl-reader.js',
  'test-session-routes.js',
  'test-session-replay-view.js',
  'test-settings-routes.js',
  'test-settings.js',
  'test-snapshot-e2e-lite.js',
  'test-snapshot-lib.js',
  'test-snapshot-panel.js',
  'test-snapshot-routes.js',
  'test-space-routes.js',
  'test-sse-routes.js',
  'test-task-conversation.js',
  'test-task-routes.js',
  'test-task-server-storage-fallback.js',
  'test-task-session-binding.js',
  'test-view-routes.js',
  'test-widget-panel-reorder.js',
  'test-workflow-approvals-api.js',
  'test-workflow-artifacts-api.js',
  'test-workflow-blockers-api.js',
  'test-workflow-governance.js',
  'test-workflow-graph.js',
  'test-workflow-routing-routes.js',
  'test-workflow-runs-business-context.js'
];

let failed = 0;

console.log(`Running ${INCLUDED.length} DB-free tests (no PostgreSQL required)...\n`);

for (const name of INCLUDED) {
  const file = path.join(TESTS_DIR, name);
  if (!fs.existsSync(file)) {
    console.error(`FAIL ${name} — file missing`);
    failed++;
    continue;
  }

  const res = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    timeout: TEST_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });

  const timedOut = res.signal === 'SIGTERM';
  if (res.status === 0 && !timedOut) {
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${timedOut ? ` — timed out after ${TEST_TIMEOUT_MS}ms` : ` — exit code ${res.status}`}`);
    const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (output) {
      const tail = output.split('\n').slice(-40).join('\n');
      console.error(tail.replace(/^/gm, '  | '));
    }
  }
}

console.log(`\n${INCLUDED.length - failed}/${INCLUDED.length} passed`);

if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
