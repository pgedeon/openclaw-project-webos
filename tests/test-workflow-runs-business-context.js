#!/usr/bin/env node

const assert = require('assert');
const { WorkflowRunsAPI } = require('../workflow-runs-api.js');

async function run() {
  const pool = {
    async query(queryText) {
      if (queryText.includes('information_schema.tables')) {
        return { rows: [{ exists: true }] };
      }

      if (queryText.includes('FROM workflow_runs wr')) {
        return {
          rows: [{
            id: 'run-1',
            workflow_type: 'affiliate-article',
            owner_agent_id: 'affiliate-editorial',
            board_id: 'project-1',
            task_id: 'task-1',
            initiator: 'dashboard-operator',
            status: 'running',
            current_step: 'drafting',
            gateway_session_active: true,
            last_heartbeat_at: '2026-03-12T13:14:45.000Z',
            retry_count: 0,
            max_retries: 3,
            input_payload: { keyword: 'best resin printers' },
            output_summary: { draft_url: 'https://example.com/draft' },
            service_request_id: 'request-1',
            department_id: 'dept-content',
            run_priority: 'high',
            approval_state: 'not_requested',
            expected_artifact_count: 2,
            actual_artifact_count: 1,
            task_title: 'Write affiliate article',
            board_name: 'Content Board',
            service_request_row_id: 'request-1',
            service_request_title: 'Launch affiliate article',
            service_request_status: 'running',
            service_request_priority: 'high',
            service_request_target_agent_id: 'affiliate-editorial',
            service_request_target_department_id: 'dept-content',
            template_id: 'template-1',
            template_name: 'affiliate-article',
            template_display_name: 'Affiliate Article Workflow',
            template_description: 'Create and publish an affiliate article',
            template_category: 'content',
            template_ui_category: 'content',
            template_default_owner_agent: 'affiliate-editorial',
            template_steps: [{ name: 'drafting' }, { name: 'publish' }],
            template_required_approvals: ['publish_approval'],
            template_success_criteria: { live_url: 'required' },
            template_input_schema: { fields: [{ name: 'keyword', type: 'text' }] },
            template_artifact_contract: { expected_artifacts: ['draft', 'live_url'] },
            template_blocker_policy: { block_on_missing_inputs: true },
            template_escalation_policy: { sla_hours: 72 },
            template_runbook_ref: 'RUNBOOK.md',
            template_department_id: 'dept-content',
            template_service_id: 'service-affiliate',
            service_id: 'service-affiliate',
            service_slug: 'affiliate-article',
            service_name: 'Affiliate Article',
            service_description: 'Affiliate article service',
            department_row_id: 'dept-content',
            department_name: 'Content & Publishing',
            department_description: 'Editorial and publishing',
            department_color: '#336699',
            department_icon: 'pen',
            department_sort_order: 2,
            elapsed_seconds: 120,
            heartbeat_age_seconds: 15
          }]
        };
      }

      if (queryText.includes('FROM workflow_steps')) {
        return {
          rows: [
            { id: 'step-1', step_name: 'drafting', step_order: 0, status: 'completed' },
            { id: 'step-2', step_name: 'publish', step_order: 1, status: 'pending' }
          ]
        };
      }

      if (queryText.includes('FROM workflow_artifacts wa')) {
        return {
          rows: [{
            id: 'artifact-1',
            workflow_run_id: 'run-1',
            task_id: 'task-1',
            artifact_type: 'draft',
            label: 'Draft document',
            uri: 'https://example.com/draft-doc',
            status: 'generated',
            created_by: 'affiliate-editorial',
            workflow_type: 'affiliate-article',
            owner_agent_id: 'affiliate-editorial',
            service_request_id: 'request-1',
            customer_scope: '3dput.com',
            task_title: 'Write affiliate article',
            board_name: 'Content Board'
          }]
        };
      }

      if (queryText.includes('FROM workflow_approvals a')) {
        return {
          rows: [{
            id: 'approval-1',
            workflow_run_id: 'run-1',
            step_name: 'publish',
            approval_type: 'publish_approval',
            approver_id: 'editorial-lead',
            requested_by: 'dashboard-operator',
            status: 'pending',
            requested_at: '2026-03-12T13:15:00.000Z',
            due_at: '2026-03-15T18:00:00.000Z',
            required_note: true,
            task_id: 'task-1',
            workflow_type: 'affiliate-article',
            owner_agent_id: 'affiliate-editorial',
            service_request_id: 'request-1',
            task_title: 'Write affiliate article',
            artifact_id: 'artifact-1',
            artifact_label: 'Draft document',
            artifact_uri: 'https://example.com/draft-doc',
            artifact_type: 'draft',
            artifact_status: 'generated'
          }]
        };
      }

      throw new Error(`Unexpected query: ${queryText}`);
    }
  };

  const api = new WorkflowRunsAPI(pool);
  const runDetail = await api.getRun('run-1');

  assert.strictEqual(runDetail.serviceRequestId, 'request-1', 'run detail should expose service request linkage');
  assert.strictEqual(runDetail.department.name, 'Content & Publishing', 'run detail should expose department context');
  assert.strictEqual(runDetail.service.name, 'Affiliate Article', 'run detail should expose service context');
  assert.strictEqual(runDetail.template.displayName, 'Affiliate Article Workflow', 'run detail should expose template context');
  assert.strictEqual(runDetail.template.stepsCount, 2, 'run detail should expose template step count');
  assert.strictEqual(runDetail.statusInfo.label, 'Running', 'run detail should normalize run status for UI consumers');
  assert.strictEqual(runDetail.steps.length, 2, 'run detail should still include workflow steps');
  assert.strictEqual(runDetail.artifacts.length, 1, 'run detail should include workflow artifacts');
  assert.strictEqual(runDetail.artifacts[0].label, 'Draft document', 'artifact detail should be normalized');
  assert.strictEqual(runDetail.approvals.length, 1, 'run detail should include workflow approvals');
  assert.strictEqual(runDetail.approvalSummary.pending, 1, 'run detail should summarize pending approvals');
  assert.ok(Object.prototype.hasOwnProperty.call(runDetail, 'blocker'), 'run detail should include blocker context');
  assert.strictEqual(runDetail.blockerSummary.total, 0, 'run detail should still provide blocker summary shape when no blocker is active');

  console.log('PASS: workflow runs business context');
}

run().catch((error) => {
  console.error('FAIL: workflow runs business context');
  console.error(error);
  process.exit(1);
});
