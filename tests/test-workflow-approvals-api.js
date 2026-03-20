#!/usr/bin/env node

const assert = require('assert');
const { WorkflowRunsAPI } = require('../workflow-runs-api.js');

async function run() {
  const auditEntries = [];
  const artifacts = {
    'artifact-1': {
      id: 'artifact-1',
      label: 'Draft article',
      uri: 'https://example.com/draft',
      artifact_type: 'draft',
      status: 'generated'
    }
  };
  const workflowRun = {
    id: 'run-1',
    task_id: 'task-1',
    workflow_type: 'wordpress-publish',
    owner_agent_id: 'blogger-publisher',
    status: 'running',
    approval_state: 'not_required',
    created_at: '2026-03-12T12:00:00.000Z',
    started_at: '2026-03-12T12:05:00.000Z',
    current_step: 'publish',
    task_title: 'Publish affiliate article'
  };
  const approvals = [];

  function hydrateApproval(approval) {
    const artifact = approval.artifact_id ? artifacts[approval.artifact_id] : null;
    return {
      ...approval,
      workflow_type: workflowRun.workflow_type,
      owner_agent_id: workflowRun.owner_agent_id,
      task_id: workflowRun.task_id,
      task_title: workflowRun.task_title,
      service_request_id: null,
      artifact_label: artifact?.label || null,
      artifact_uri: artifact?.uri || null,
      artifact_type: artifact?.artifact_type || null,
      artifact_status: artifact?.status || null
    };
  }

  function buildRunRow() {
    return {
      ...workflowRun,
      board_id: 'project-1',
      task_id: 'task-1',
      task_title: workflowRun.task_title,
      board_name: 'Publishing Board',
      service_request_row_id: null,
      service_request_title: null,
      service_request_status: null,
      service_request_priority: null,
      service_request_target_agent_id: null,
      service_request_target_department_id: null,
      template_id: 'template-publish',
      template_name: 'wordpress-publish',
      template_display_name: 'WordPress Publish',
      template_description: 'Publish approved content',
      template_category: 'publishing',
      template_ui_category: 'publishing',
      template_default_owner_agent: 'blogger-publisher',
      template_steps: [{ name: 'publish' }],
      template_required_approvals: ['publish_approval'],
      template_success_criteria: { live_url: 'required' },
      template_input_schema: { fields: [{ name: 'post_id', type: 'text' }] },
      template_artifact_contract: { expected_artifacts: ['draft', 'live_url'] },
      template_blocker_policy: { block_on_missing_inputs: true },
      template_escalation_policy: { sla_hours: 4 },
      template_runbook_ref: 'RUNBOOK.md',
      template_department_id: 'dept-content',
      template_service_id: 'service-publish',
      service_id: 'service-publish',
      service_slug: 'wordpress-publish',
      service_name: 'WordPress Publish',
      service_description: 'Publish approved content',
      department_row_id: 'dept-content',
      department_name: 'Content & Publishing',
      department_description: 'Editorial and publishing',
      department_color: '#336699',
      department_icon: 'pen',
      department_sort_order: 2,
      elapsed_seconds: 300,
      heartbeat_age_seconds: 20
    };
  }

  async function handleQuery(queryText, values = []) {
    if (queryText === 'BEGIN' || queryText === 'COMMIT' || queryText === 'ROLLBACK') {
      return { rows: [] };
    }

    if (queryText.includes('information_schema.tables')) {
      return { rows: [{ exists: true }] };
    }

    if (queryText.includes('SELECT id, task_id, workflow_type, owner_agent_id') && queryText.includes('FROM workflow_runs')) {
      return { rows: [workflowRun] };
    }

    if (queryText.includes('INSERT INTO workflow_approvals')) {
      const created = {
        id: `approval-${approvals.length + 1}`,
        workflow_run_id: values[0],
        step_name: values[1],
        approval_type: values[2],
        approver_id: values[3],
        requested_by: values[4],
        artifact_id: values[5],
        due_at: values[6],
        expires_at: values[7],
        required_note: values[8],
        status: 'pending',
        metadata: values[9],
        requested_at: '2026-03-12T14:20:00.000Z',
        created_at: '2026-03-12T14:20:00.000Z',
        decided_at: null,
        decided_by: null,
        decision: null,
        escalated_at: null,
        escalated_to: null,
        escalation_reason: null
      };
      approvals.push(created);
      return { rows: [created] };
    }

    if (queryText.includes('SELECT status') && queryText.includes('FROM workflow_approvals')) {
      const runId = values[0];
      return {
        rows: approvals.filter((approval) => approval.workflow_run_id === runId).map((approval) => ({ status: approval.status }))
      };
    }

    if (queryText.includes('UPDATE workflow_runs') && queryText.includes('SET approval_state = $2')) {
      workflowRun.approval_state = values[1];
      if (values[2] && !['completed', 'failed', 'cancelled'].includes(workflowRun.status)) {
        workflowRun.status = values[2];
      }
      return { rows: [workflowRun] };
    }

    if (queryText.includes('INSERT INTO audit_log')) {
      auditEntries.push({
        task_id: values[0],
        actor: values[1],
        action: values[2],
        old_value: values[3],
        new_value: values[4]
      });
      return { rows: [] };
    }

    if (queryText.includes('SELECT a.*, wr.task_id') && queryText.includes('WHERE a.id = $1')) {
      const approval = approvals.find((item) => item.id === values[0]);
      return { rows: approval ? [{ ...approval, task_id: workflowRun.task_id }] : [] };
    }

    if (queryText.includes('UPDATE workflow_approvals') && queryText.includes('SET status = $2')) {
      const approval = approvals.find((item) => item.id === values[0]);
      approval.status = values[1];
      approval.decision = values[2];
      approval.decided_by = values[3];
      approval.decided_at = '2026-03-12T14:35:00.000Z';
      return { rows: [approval] };
    }

    if (queryText.includes('UPDATE workflow_approvals') && queryText.includes('SET escalated_at = NOW()')) {
      const approval = approvals.find((item) => item.id === values[0]);
      approval.escalated_at = '2026-03-12T14:25:00.000Z';
      approval.escalated_to = values[1];
      approval.escalation_reason = values[2];
      return { rows: [approval] };
    }

    if (queryText.includes('FROM workflow_approvals a') && queryText.includes('WHERE a.workflow_run_id = $1')) {
      const runId = values[0];
      return {
        rows: approvals
          .filter((approval) => approval.workflow_run_id === runId)
          .map((approval) => hydrateApproval(approval))
      };
    }

    if (queryText.includes('FROM workflow_approvals a') && queryText.includes("WHERE a.status = 'pending'")) {
      const approverId = values[0] || null;
      return {
        rows: approvals
          .filter((approval) => approval.status === 'pending')
          .filter((approval) => !approverId || approval.approver_id === approverId)
          .map((approval) => hydrateApproval(approval))
      };
    }

    if (queryText.includes('FROM workflow_runs wr') && queryText.includes('WHERE wr.id = $1')) {
      return { rows: [buildRunRow()] };
    }

    if (queryText.includes('FROM workflow_steps')) {
      return { rows: [{ id: 'step-1', step_name: 'publish', step_order: 0, status: workflowRun.status === 'blocked' ? 'blocked' : 'running' }] };
    }

    if (queryText.includes('FROM workflow_artifacts wa')) {
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${queryText} ${JSON.stringify(values)}`);
  }

  const pool = {
    async query(queryText, values = []) {
      return handleQuery(queryText, values);
    },
    async connect() {
      return {
        query: handleQuery,
        release() {}
      };
    }
  };

  const api = new WorkflowRunsAPI(pool);

  const created = await api.createApproval(
    'run-1',
    'publish',
    'editorial-lead',
    'dashboard-operator',
    { channel: 'wordpress' },
    {
      approval_type: 'publish_approval',
      artifact_id: 'artifact-1',
      due_at: '2026-03-12T16:00:00.000Z',
      required_note: true
    }
  );

  assert.strictEqual(created.artifact.id, 'artifact-1', 'created approval should include linked artifact context');
  assert.strictEqual(workflowRun.status, 'waiting_for_approval', 'run should pause while approval is pending');
  assert.strictEqual(workflowRun.approval_state, 'pending', 'run approval state should become pending');

  const pending = await api.getPendingApprovals();
  assert.strictEqual(pending.length, 1, 'pending approvals should be queryable');

  const runDetail = await api.getRun('run-1');
  assert.strictEqual(runDetail.approvalSummary.pending, 1, 'run detail should summarize pending approvals');
  assert.strictEqual(runDetail.approvals[0].artifact.label, 'Draft article', 'run detail should expose artifact-linked approval data');

  const escalated = await api.escalateApproval(created.id, 'content-director', 'Publish window closes soon', 'dashboard-operator');
  assert.strictEqual(escalated.escalatedTo, 'content-director', 'approval escalation should persist the target');

  const approved = await api.updateApproval(created.id, 'approved', 'Content is verified and ready to publish.', 'editorial-lead');
  assert.strictEqual(approved.status, 'approved', 'approval decision should update status');
  assert.strictEqual(workflowRun.status, 'running', 'run should resume after all approvals are approved');
  assert.strictEqual(workflowRun.approval_state, 'approved', 'run approval state should become approved');
  assert.ok(auditEntries.some((entry) => entry.action === 'approval_requested'), 'approval request should be written to the audit trail');
  assert.ok(auditEntries.some((entry) => entry.action === 'approval_escalated'), 'approval escalation should be written to the audit trail');
  assert.ok(auditEntries.some((entry) => entry.action === 'approval_approved'), 'approval decision should be written to the audit trail');

  console.log('PASS: workflow approvals API');
}

run().catch((error) => {
  console.error('FAIL: workflow approvals API');
  console.error(error);
  process.exit(1);
});
