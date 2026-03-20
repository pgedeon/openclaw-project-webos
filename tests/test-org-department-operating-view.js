#!/usr/bin/env node

const assert = require('assert');
const { orgAPI } = require('../org-api.js');
const { WorkflowRunsAPI } = require('../workflow-runs-api.js');

function createResponseCapture() {
  return { result: null };
}

function sendJSON(res, status, payload) {
  res.result = { status, payload };
}

function buildContext(pool) {
  return {
    pool,
    sendJSON,
    parseJSONBody: async () => {
      throw new Error('parseJSONBody should not be called in this test');
    },
    asanaStorage: {
      async listDepartments() {
        return [
          {
            id: 'dept-content',
            slug: 'content-publishing',
            name: 'Content & Publishing',
            description: 'Editorial workflows',
            color: '#2563eb',
            icon: 'pen',
            sortOrder: 2,
            metadata: {
              lead_agent_id: 'blogger-publisher'
            },
            source: 'database'
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
            modelPrimary: 'openrouter1/openrouter/hunter-alpha',
            capabilities: ['publishing', 'approval-routing'],
            status: 'active',
            workspacePath: '~/.openclaw/workspace/blogger-publisher',
            metadata: {},
            lastHeartbeat: '2026-03-12T15:00:00.000Z',
            source: 'database'
          },
          {
            agentId: 'topic-planner',
            departmentId: 'dept-content',
            departmentSlug: 'content-publishing',
            displayName: 'Topic Planner',
            role: 'Research Specialist',
            modelPrimary: 'openrouter1/openrouter/hunter-alpha',
            capabilities: ['research'],
            status: 'active',
            workspacePath: '~/.openclaw/workspace/topic-planner',
            metadata: {},
            lastHeartbeat: '2026-03-12T15:00:00.000Z',
            source: 'database'
          }
        ];
      }
    },
    buildConfiguredAgentsCatalog: () => ([
      {
        id: 'blogger-publisher',
        name: 'Blogger Publisher',
        workspace: '~/.openclaw/workspace/blogger-publisher',
        default: false,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      },
      {
        id: 'topic-planner',
        name: 'Topic Planner',
        workspace: '~/.openclaw/workspace/topic-planner',
        default: false,
        defaultModel: 'openrouter1/openrouter/hunter-alpha'
      }
    ]),
    buildAgentsOverviewPayload: async () => ({
      generatedAt: '2026-03-12T15:00:00.000Z',
      summary: {
        totalAgents: 2,
        online: 2,
        working: 1,
        queued: 1,
        idle: 0,
        offline: 0,
        readyTasks: 3,
        activeTasks: 2,
        blockedTasks: 1,
        overdueTasks: 1
      },
      agents: [
        {
          id: 'blogger-publisher',
          name: 'Blogger Publisher',
          workspace: '~/.openclaw/workspace/blogger-publisher',
          default: false,
          defaultModel: 'openrouter1/openrouter/hunter-alpha',
          presence: 'working',
          online: true,
          status: 'working',
          lastSeenAt: '2026-03-12T14:59:00.000Z',
          stale: false,
          currentActivity: 'Publishing department ops review',
          queueSummary: {
            total: 3,
            ready: 1,
            backlog: 0,
            inProgress: 2,
            blocked: 0,
            review: 0,
            completed: 0,
            overdue: 1
          },
          runtime: {
            source: 'dashboard-bridge',
            queueReadyCount: 1,
            queueActiveCount: 2
          },
          currentTask: null,
          nextTask: null,
          queue: []
        },
        {
          id: 'topic-planner',
          name: 'Topic Planner',
          workspace: '~/.openclaw/workspace/topic-planner',
          default: false,
          defaultModel: 'openrouter1/openrouter/hunter-alpha',
          presence: 'queued',
          online: true,
          status: 'queued',
          lastSeenAt: '2026-03-12T14:58:00.000Z',
          stale: false,
          currentActivity: 'Research backlog grooming',
          queueSummary: {
            total: 2,
            ready: 2,
            backlog: 0,
            inProgress: 0,
            blocked: 1,
            review: 0,
            completed: 0,
            overdue: 0
          },
          runtime: {
            source: 'dashboard-bridge',
            queueReadyCount: 2,
            queueActiveCount: 0
          },
          currentTask: null,
          nextTask: null,
          queue: []
        }
      ]
    })
  };
}

async function run() {
  const originalListBlockers = WorkflowRunsAPI.prototype.listBlockers;
  const originalGetBlockerSummary = WorkflowRunsAPI.prototype.getBlockerSummary;

  WorkflowRunsAPI.prototype.listBlockers = async () => ([
    {
      id: 'workflow_run:run-42',
      entityType: 'workflow_run',
      entityId: 'run-42',
      workflowRunId: 'run-42',
      taskId: 'task-42',
      title: 'Publish buying guide',
      status: 'blocked',
      ownerAgentId: 'blogger-publisher',
      workflowType: 'affiliate-article',
      departmentId: 'dept-content',
      departmentName: 'Content & Publishing',
      blockerType: 'stale_step',
      blockerLabel: 'Stale step',
      blockerDescription: 'The publishing step has not advanced in over an hour.',
      severity: 'high',
      tone: 'warning',
      nextAction: 'Review the stuck step and either resume or reassign it.',
      detectedAt: '2026-03-12T14:45:00.000Z',
      source: 'detector',
      retryCount: 1,
      maxRetries: 3,
      heartbeatAgeSeconds: 3900,
      pendingApprovalCount: 0,
      overdueApprovalCount: 0,
      escalatedAt: null,
      escalatedTo: 'content-director',
      escalationReason: 'Needs operator review',
      escalationStatus: 'escalated',
      pausedAt: null,
      pausedBy: null,
      pauseReason: null
    },
    {
      id: 'task:task-43',
      entityType: 'task',
      entityId: 'task-43',
      workflowRunId: 'run-42',
      taskId: 'task-43',
      title: 'QA checklist follow-up',
      status: 'in_progress',
      ownerAgentId: 'topic-planner',
      workflowType: null,
      departmentId: 'dept-content',
      departmentName: 'Content & Publishing',
      blockerType: 'unmet_dependencies',
      blockerLabel: 'Unmet dependencies',
      blockerDescription: 'Dependencies are incomplete while the task is still marked in progress.',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'Complete upstream dependencies before resuming the task.',
      detectedAt: '2026-03-12T14:40:00.000Z',
      source: 'detector',
      retryCount: 0,
      maxRetries: null,
      heartbeatAgeSeconds: null,
      pendingApprovalCount: 0,
      overdueApprovalCount: 0,
      escalatedAt: null,
      escalatedTo: null,
      escalationReason: null,
      escalationStatus: null,
      pausedAt: null,
      pausedBy: null,
      pauseReason: null
    }
  ]);

  WorkflowRunsAPI.prototype.getBlockerSummary = async () => ({
    total: 2,
    workflowRuns: 1,
    tasks: 1,
    escalated: 1,
    byType: [
      { blockerType: 'stale_step', count: 1, label: 'Stale step' },
      { blockerType: 'unmet_dependencies', count: 1, label: 'Unmet dependencies' }
    ],
    byDepartment: [
      {
        departmentId: 'dept-content',
        departmentName: 'Content & Publishing',
        count: 2,
        byType: [
          { blockerType: 'stale_step', count: 1 },
          { blockerType: 'unmet_dependencies', count: 1 }
        ]
      }
    ]
  });

  const pool = {
    async query(queryText, values = []) {
      if (queryText.includes('SELECT to_regclass')) {
        return { rows: [{ table_ref: values[0] }] };
      }

      if (queryText.includes('FROM service_catalog sc') && queryText.includes('active_request_count')) {
        return {
          rows: [{
            id: 'service-affiliate-article',
            name: 'Affiliate Article',
            slug: 'affiliate-article',
            description: 'Research, draft, and publish affiliate content.',
            default_agent_id: 'benchmark-labs-writer',
            workflow_template_name: 'affiliate-article',
            sla_hours: 48,
            active_request_count: 3,
            running_run_count: 1
          }]
        };
      }

      if (queryText.includes('FROM service_requests sr') && queryText.includes('workflow_run_status')) {
        return {
          rows: [{
            id: 'sr-1',
            title: 'Refresh the best filament printers guide',
            status: 'running',
            priority: 'high',
            requested_by: 'content-director',
            target_agent_id: 'blogger-publisher',
            updated_at: '2026-03-12T14:55:00.000Z',
            created_at: '2026-03-12T13:00:00.000Z',
            service_name: 'Affiliate Article',
            workflow_run_id: 'run-42',
            workflow_run_status: 'running'
          }]
        };
      }

      if (queryText.includes('SELECT COUNT(*)::integer AS count') && queryText.includes('FROM service_requests sr')) {
        return { rows: [{ count: 3 }] };
      }

      if (queryText.includes('FROM workflow_runs wr') && queryText.includes('service_request_title')) {
        return {
          rows: [{
            id: 'run-42',
            workflow_type: 'affiliate-article',
            status: 'running',
            current_step: 'publish',
            owner_agent_id: 'blogger-publisher',
            retry_count: 1,
            run_priority: 'high',
            updated_at: '2026-03-12T14:54:00.000Z',
            created_at: '2026-03-12T13:05:00.000Z',
            task_title: 'Publish buying guide',
            board_name: 'Content Board',
            service_request_title: 'Refresh the best filament printers guide'
          }]
        };
      }

      if (
        queryText.includes('COUNT(*)::integer AS count') &&
        queryText.includes('FROM workflow_runs wr') &&
        queryText.includes("wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying')")
      ) {
        return { rows: [{ count: 1 }] };
      }

      if (queryText.includes('FROM tasks t') && queryText.includes('p.name AS project_name')) {
        return {
          rows: [{
            id: 'task-44',
            title: 'Resolve broken comparison table',
            status: 'ready',
            priority: 'high',
            owner: 'topic-planner',
            due_date: '2026-03-11T18:00:00.000Z',
            project_name: 'Content Board'
          }]
        };
      }

      if (queryText.includes('COUNT(*)::integer AS count') && queryText.includes('FROM tasks t')) {
        return { rows: [{ count: 1 }] };
      }

      if (queryText.includes('pending_count') && queryText.includes('avg_decision_hours')) {
        return {
          rows: [{
            pending_count: 2,
            expired_count: 1,
            avg_decision_hours: 3.5
          }]
        };
      }

      if (queryText.includes('FROM workflow_approvals a') && queryText.includes("a.status = 'pending'") && queryText.includes('task_title')) {
        return {
          rows: [{
            id: 'approval-1',
            workflow_run_id: 'run-42',
            step_name: 'publish',
            approval_type: 'publish_review',
            approver_id: 'content-director',
            status: 'pending',
            requested_by: 'blogger-publisher',
            requested_at: '2026-03-12T14:30:00.000Z',
            due_at: '2026-03-12T16:00:00.000Z',
            expires_at: '2026-03-12T18:00:00.000Z',
            escalated_to: null,
            workflow_type: 'affiliate-article',
            task_title: 'Publish buying guide'
          }]
        };
      }

      if (queryText.includes('FROM workflow_artifacts wa') && queryText.includes("wa.status = 'rejected'")) {
        return {
          rows: [{
            id: 'artifact-2',
            workflow_run_id: 'run-42',
            artifact_type: 'image_pack',
            label: 'Image QA fail',
            status: 'rejected',
            uri: 'https://example.test/artifacts/rejected-image-pack',
            created_by: 'image-qa',
            created_at: '2026-03-12T14:20:00.000Z',
            workflow_type: 'affiliate-article',
            task_title: 'Publish buying guide'
          }]
        };
      }

      if (queryText.includes('FROM workflow_artifacts wa') && queryText.includes("artifact_type IN ('verification', 'verification_report', 'publish_verification')")) {
        return {
          rows: [{
            id: 'artifact-3',
            workflow_run_id: 'run-42',
            artifact_type: 'verification_report',
            label: 'Publish verification report',
            status: 'approved',
            uri: 'https://example.test/artifacts/publish-verification',
            created_by: 'qa-auditor',
            created_at: '2026-03-12T14:25:00.000Z',
            workflow_type: 'affiliate-article',
            task_title: 'Publish buying guide'
          }]
        };
      }

      if (queryText.includes('FROM workflow_artifacts wa') && queryText.includes('ORDER BY wa.created_at DESC')) {
        return {
          rows: [{
            id: 'artifact-1',
            workflow_run_id: 'run-42',
            artifact_type: 'draft',
            label: 'Draft article output',
            status: 'generated',
            uri: 'https://example.test/artifacts/draft-article',
            created_by: 'benchmark-labs-writer',
            created_at: '2026-03-12T14:10:00.000Z',
            workflow_type: 'affiliate-article',
            task_title: 'Publish buying guide'
          }]
        };
      }

      if (queryText.includes('total_runs') && queryText.includes('retried_runs')) {
        return {
          rows: [{
            total_runs: 10,
            completed_runs: 8,
            failed_runs: 2,
            retried_runs: 4
          }]
        };
      }

      if (queryText.includes('split_part(wr.last_error')) {
        return {
          rows: [
            { reason: 'verification_failed', count: 2 },
            { reason: 'publish_timeout', count: 1 }
          ]
        };
      }

      throw new Error(`Unexpected query: ${queryText} ${JSON.stringify(values)}`);
    }
  };

  try {
    const res = createResponseCapture();
    const handled = await orgAPI(
      { url: '/api/org/departments/dept-content/operating-view?queue_limit=10', headers: { host: 'localhost:3876' } },
      res,
      '/api/org/departments/dept-content/operating-view',
      'GET',
      null,
      buildContext(pool)
    );

    assert.strictEqual(handled, true, 'department operating view route should be handled');
    assert.strictEqual(res.result.status, 200, 'department operating view should return 200');

    const payload = res.result.payload;
    assert.strictEqual(payload.department.id, 'dept-content', 'department payload should match the requested department');
    assert.strictEqual(payload.overview.lead.agentId, 'blogger-publisher', 'department lead should resolve from department metadata');
    assert.strictEqual(payload.overview.staffedCount, 2, 'staffed count should reflect staffed agents');
    assert.strictEqual(payload.overview.serviceLines.length, 1, 'service lines should be populated');
    assert.strictEqual(payload.overview.currentWorkload.openServiceRequests, 3, 'workload should include open service request count');
    assert.strictEqual(payload.workQueue.openServiceRequests.length, 1, 'open service request queue should be populated');
    assert.strictEqual(payload.workQueue.activeRuns.length, 1, 'active workflow runs should be populated');
    assert.strictEqual(payload.workQueue.blockedWork.length, 2, 'blocked work should include blocker API results');
    assert.strictEqual(payload.workQueue.overdueItems.length, 1, 'overdue items should be populated');
    assert.strictEqual(payload.blockerSummary.total, 2, 'blocker summary should be included');
    assert.strictEqual(payload.approvals.pending, 2, 'approval summary should be included');
    assert.strictEqual(payload.approvals.expired, 1, 'expired approvals should be counted');
    assert.strictEqual(payload.approvals.averageDecisionHours, 3.5, 'average approval latency should be included');
    assert.strictEqual(payload.artifacts.recentOutputs.length, 1, 'recent outputs should be included');
    assert.strictEqual(payload.artifacts.failedOutputs.length, 1, 'failed outputs should be included');
    assert.strictEqual(payload.artifacts.verificationReports.length, 1, 'verification reports should be included');
    assert.strictEqual(payload.reliability.successRate, 80, 'success rate should be computed from completed and failed runs');
    assert.strictEqual(payload.reliability.retryRate, 40, 'retry rate should be computed from retried and total runs');
    assert.strictEqual(payload.reliability.staleRunCount, 1, 'stale run count should derive from blocked workflow runs');
    assert.deepStrictEqual(
      payload.reliability.failureReasons[0],
      { reason: 'verification_failed', count: 2 },
      'failure reasons should be included in descending count order'
    );

    console.log('PASS: org department operating view');
  } finally {
    WorkflowRunsAPI.prototype.listBlockers = originalListBlockers;
    WorkflowRunsAPI.prototype.getBlockerSummary = originalGetBlockerSummary;
  }
}

run().catch((error) => {
  console.error('FAIL: org department operating view');
  console.error(error);
  process.exit(1);
});
