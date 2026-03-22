#!/usr/bin/env node

const assert = require('assert');
const { metricsAPI, persistDepartmentDailyMetrics } = require('../metrics-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function buildContext() {
  const savedSnapshots = [];
  return {
    __savedSnapshots: savedSnapshots,
    sendJSON,
    buildConfiguredAgentsCatalog: () => ([
      {
        id: 'blogger-publisher',
        name: 'Blogger Publisher',
        workspace: '/root/.openclaw/workspace/blogger-publisher',
        default: false,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      },
      {
        id: 'topic-planner',
        name: 'Topic Planner',
        workspace: '/root/.openclaw/workspace/topic-planner',
        default: false,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      }
    ]),
    asanaStorage: {
      async listDepartments() {
        return [
          {
            id: 'dept-content',
            slug: 'content-publishing',
            name: 'Content & Publishing',
            description: 'Editorial and publishing',
            color: '#22c55e',
            icon: 'file-text',
            metadata: {}
          },
          {
            id: 'dept-core',
            slug: 'core-platform',
            name: 'Core Platform',
            description: 'Platform engineering',
            color: '#6366f1',
            icon: 'cpu',
            metadata: {}
          }
        ];
      },
      async listAgentProfiles() {
        return [
          {
            agentId: 'blogger-publisher',
            departmentId: 'dept-content',
            departmentSlug: 'content-publishing',
            displayName: 'Blogger Publisher',
            role: 'Publishing Lead',
            metadata: {}
          },
          {
            agentId: 'topic-planner',
            departmentId: 'dept-content',
            departmentSlug: 'content-publishing',
            displayName: 'Topic Planner',
            role: 'Research Specialist',
            metadata: {}
          }
        ];
      },
      pool: {
        async query(queryText, values = []) {
          if (queryText.includes('SELECT to_regclass')) {
            return { rows: [{ table_ref: values[0] }] };
          }

          if (queryText.includes('metrics:org_scorecard')) {
            return {
              rows: [{
                service_requests_opened: 14,
                service_requests_completed: 9,
                workflow_runs_started: 12,
                workflow_runs_completed: 10,
                workflow_runs_failed: 2,
                blocked_time_hours: 6.25,
                approval_latency_hours: 3.5,
                median_completion_hours: 18.75,
                pending_approvals: 4,
                stale_run_count: 2,
                active_workload: 5
              }]
            };
          }

          if (queryText.includes('metrics:department_scorecards')) {
            return {
              rows: [
                {
                  department_id: 'dept-content',
                  service_requests_opened: 11,
                  service_requests_completed: 7,
                  workflow_runs_started: 9,
                  workflow_runs_completed: 8,
                  workflow_runs_failed: 1,
                  blocked_time_hours: 4.5,
                  approval_latency_hours: 2.75,
                  median_completion_hours: 15.5,
                  stale_run_count: 1
                },
                {
                  department_id: 'dept-core',
                  service_requests_opened: 3,
                  service_requests_completed: 2,
                  workflow_runs_started: 3,
                  workflow_runs_completed: 2,
                  workflow_runs_failed: 1,
                  blocked_time_hours: 1.75,
                  approval_latency_hours: 5.25,
                  median_completion_hours: 23.25,
                  stale_run_count: 1
                }
              ]
            };
          }

          if (queryText.includes('metrics:agent_scorecards')) {
            return {
              rows: [
                {
                  agent_id: 'blogger-publisher',
                  active_workload: 3,
                  completion_count: 6,
                  failure_count: 1,
                  retry_count: 2,
                  stale_run_count: 1,
                  approval_burden: 4
                },
                {
                  agent_id: 'topic-planner',
                  active_workload: 2,
                  completion_count: 4,
                  failure_count: 0,
                  retry_count: 1,
                  stale_run_count: 0,
                  approval_burden: 1
                }
              ]
            };
          }

          if (queryText.includes('metrics:service_scorecards')) {
            return {
              rows: [{
                service_id: 'service-affiliate',
                service_slug: 'affiliate-article',
                service_name: 'Affiliate Article',
                department_id: 'dept-content',
                requests_opened: 11,
                requests_completed: 7,
                workflow_runs_started: 9,
                workflow_runs_completed: 8,
                workflow_runs_failed: 1,
                median_completion_hours: 15.5
              }]
            };
          }

          if (queryText.includes('metrics:site_scorecards')) {
            return {
              rows: [
                {
                  site_key: '3dput',
                  total_runs: 7,
                  completed_runs: 6,
                  posts_published: 4,
                  drafts_created: 5,
                  drafts_approved: 4,
                  total_images: 10,
                  approved_images: 9,
                  total_verification_reports: 5,
                  approved_verification_reports: 4,
                  rejected_verification_reports: 1
                },
                {
                  site_key: 'sailboats-fr',
                  total_runs: 3,
                  completed_runs: 2,
                  posts_published: 1,
                  drafts_created: 2,
                  drafts_approved: 1,
                  total_images: 4,
                  approved_images: 3,
                  total_verification_reports: 2,
                  approved_verification_reports: 2,
                  rejected_verification_reports: 0
                }
              ]
            };
          }

          if (queryText.includes('metrics:department_trend_snapshots')) {
            return {
              rows: [
                {
                  metric_date: '2026-03-09',
                  metrics: {
                    metricDate: '2026-03-09',
                    departmentId: 'dept-content',
                    departmentSlug: 'content-publishing',
                    departmentName: 'Content & Publishing',
                    serviceRequestsOpened: 6,
                    serviceRequestsCompleted: 4,
                    workflowRunsStarted: 5,
                    workflowRunsCompleted: 4,
                    workflowRunsFailed: 1,
                    workflowSuccessRate: 80,
                    blockedTimeHours: 1.5,
                    approvalLatencyHours: 2.25,
                    medianCompletionHours: 14.25,
                    staleRunCount: 1
                  }
                },
                {
                  metric_date: '2026-03-10',
                  metrics: {
                    metricDate: '2026-03-10',
                    departmentId: 'dept-content',
                    departmentSlug: 'content-publishing',
                    departmentName: 'Content & Publishing',
                    serviceRequestsOpened: 7,
                    serviceRequestsCompleted: 5,
                    workflowRunsStarted: 6,
                    workflowRunsCompleted: 5,
                    workflowRunsFailed: 1,
                    workflowSuccessRate: 83.3,
                    blockedTimeHours: 1.25,
                    approvalLatencyHours: 2.0,
                    medianCompletionHours: 13.5,
                    staleRunCount: 0
                  }
                }
              ]
            };
          }

          if (queryText.includes('INSERT INTO department_daily_metrics')) {
            savedSnapshots.push({
              departmentId: values[0],
              metricDate: values[1],
              metrics: JSON.parse(values[2])
            });
            return { rows: [] };
          }

          throw new Error(`Unexpected query: ${queryText} ${JSON.stringify(values)}`);
        }
      }
    }
  };
}

async function callRoute(url, context = buildContext()) {
  const res = createResponseCapture();
  const handled = await metricsAPI(
    { url, headers: { host: 'localhost:3876' } },
    res,
    url.split('?')[0],
    'GET',
    null,
    context
  );
  assert.strictEqual(handled, true, `${url} should be handled`);
  assert.strictEqual(res.result.status, 200, `${url} should return 200`);
  return res.result.payload;
}

async function run() {
  const context = buildContext();

  const org = await callRoute('/api/metrics/org?days=30', context);
  assert.strictEqual(org.dateRange.days, 30, 'org metrics should report the active date range');
  assert.strictEqual(org.scorecard.workflowSuccessRate, 83.3, 'org scorecard should compute success rate');
  assert.strictEqual(org.scorecard.departmentsTracked, 2, 'org scorecard should include tracked department count');

  const departments = await callRoute('/api/metrics/departments?days=30', context);
  assert.strictEqual(departments.departments.length, 2, 'department metrics should list all known departments');
  const contentDept = departments.departments.find((department) => department.departmentId === 'dept-content');
  assert.ok(contentDept, 'content department scorecard should be present');
  assert.strictEqual(contentDept.workflowSuccessRate, 88.9, 'department scorecard should compute success rate');

  const departmentDetail = await callRoute('/api/metrics/departments/dept-content?days=30', context);
  assert.strictEqual(departmentDetail.department.name, 'Content & Publishing', 'department detail should resolve department metadata');
  assert.strictEqual(departmentDetail.agents.length, 2, 'department detail should include filtered agent scorecards');
  assert.strictEqual(departmentDetail.services.length, 1, 'department detail should include filtered service scorecards');
  assert.strictEqual(departmentDetail.trend.length, 2, 'department detail should include daily trend snapshots');
  assert.strictEqual(departmentDetail.trend[1].metricDate, '2026-03-10', 'trend snapshots should preserve metric date');
  assert.strictEqual(departmentDetail.trend[1].workflowSuccessRate, 83.3, 'trend snapshots should expose stored scorecard values');

  const agents = await callRoute('/api/metrics/agents?days=30', context);
  assert.strictEqual(agents.agents.length, 2, 'agent metrics should list staffed agents');
  assert.strictEqual(agents.agents[0].department.name, 'Content & Publishing', 'agent metrics should include department metadata');

  const services = await callRoute('/api/metrics/services?days=30', context);
  assert.strictEqual(services.services.length, 1, 'service metrics should include service scorecards');
  assert.strictEqual(services.services[0].workflowSuccessRate, 88.9, 'service metrics should compute success rate');

  const sites = await callRoute('/api/metrics/sites?days=30', context);
  assert.strictEqual(sites.sites.length, 2, 'site metrics should include per-site scorecards');
  assert.strictEqual(sites.sites[0].imagePassRate, 90, 'site metrics should compute image pass rate');

  const persisted = await persistDepartmentDailyMetrics(context, '2026-03-10');
  assert.strictEqual(persisted.metricDate, '2026-03-10', 'persistence should report the normalized metric date');
  assert.strictEqual(persisted.departmentsWritten, 2, 'persistence should upsert one snapshot per department');
  assert.strictEqual(context.__savedSnapshots.length, 2, 'persistence should write snapshots through the pool');
  assert.strictEqual(context.__savedSnapshots[0].metricDate, '2026-03-10', 'written snapshots should use the target metric date');
  assert.strictEqual(context.__savedSnapshots[0].metrics.departmentId, 'dept-content', 'written snapshot should preserve department id');

  console.log('PASS: metrics api');
}

run().catch((error) => {
  console.error('FAIL: metrics api');
  console.error(error);
  process.exit(1);
});
