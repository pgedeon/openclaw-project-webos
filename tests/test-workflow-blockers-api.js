#!/usr/bin/env node

const assert = require('assert');
const { WorkflowRunsAPI } = require('../workflow-runs-api.js');

async function run() {
  const auditEntries = [];
  const workflowRun = {
    id: 'run-1',
    task_id: 'task-1',
    owner_agent_id: 'agent-alpha',
    status: 'running',
    blocker_type: null,
    blocker_description: null,
    escalation_status: null,
    escalated_to: null,
    escalation_reason: null,
    paused_at: null,
    paused_by: null,
    pause_reason: null,
    approval_state: 'approved'
  };
  const taskState = {
    id: 'task-1',
    owner: 'agent-alpha',
    status: 'in_progress',
    blocker_type: null,
    blocker_description: null
  };

  async function handleQuery(queryText, values = []) {
    if (queryText === 'BEGIN' || queryText === 'COMMIT' || queryText === 'ROLLBACK') {
      return { rows: [] };
    }

    if (queryText.includes('information_schema.tables')) {
      return { rows: [{ exists: true }] };
    }

    if (queryText.includes('FROM workflow_runs wr') && queryText.includes('approval_stats.pending_approval_count')) {
      return {
        rows: [{
          ...workflowRun,
          workflow_type: 'affiliate-article',
          task_title: 'Recover stalled affiliate article',
          board_name: 'Content Board',
          template_id: 'template-1',
          template_name: 'affiliate-article',
          template_display_name: 'Affiliate Article Workflow',
          template_steps: [{ name: 'drafting' }],
          template_required_approvals: [],
          template_blocker_policy: {
            heartbeat_stale_seconds: 600,
            stale_step_seconds: 3600,
            retry_threshold: 2
          },
          department_row_id: 'dept-content',
          department_name: 'Content & Publishing',
          department_description: 'Editorial and publishing',
          department_color: '#336699',
          department_icon: 'pen',
          department_sort_order: 2,
          elapsed_seconds: 1800,
          heartbeat_age_seconds: 1801,
          current_step_started_at: '2026-03-12T11:00:00.000Z',
          pending_approval_count: 0,
          overdue_approval_count: 0,
          pending_approval_due_at: null,
          updated_at: '2026-03-12T12:00:00.000Z',
          created_at: '2026-03-12T11:30:00.000Z',
          started_at: '2026-03-12T11:31:00.000Z',
          last_heartbeat_at: '2026-03-12T11:32:00.000Z',
          gateway_session_active: true
        }]
      };
    }

    if (queryText.includes('FROM tasks t') && queryText.includes('has_unmet_dependencies')) {
      return {
        rows: [{
          id: 'task-2',
          title: 'Resolve publishing dependencies',
          status: 'in_progress',
          owner: 'agent-alpha',
          department_id: 'dept-content',
          department_name: 'Content & Publishing',
          department_slug: 'content-publishing',
          has_unmet_dependencies: true,
          retry_count: 0,
          updated_at: '2026-03-12T12:10:00.000Z',
          created_at: '2026-03-12T11:50:00.000Z',
          active_workflow_run_id: 'run-1'
        }]
      };
    }

    if (queryText.includes('SELECT COUNT(*)::int AS count') && queryText.includes('FROM workflow_approvals')) {
      return { rows: [{ count: 0 }] };
    }

    if (queryText.includes('SELECT id, task_id, owner_agent_id, status, blocker_type, blocker_description,')
      && queryText.includes('escalation_status')) {
      return { rows: [{ ...workflowRun }] };
    }

    if (queryText.includes('SELECT id, task_id, status, paused_at, paused_by, pause_reason, blocker_type, blocker_description, approval_state')) {
      return { rows: [{ ...workflowRun }] };
    }

    if (queryText.includes('SELECT id, task_id, status, paused_at, paused_by, pause_reason, blocker_type, blocker_description')) {
      return { rows: [{ ...workflowRun }] };
    }

    if (queryText.includes('SELECT id, task_id, owner_agent_id') && queryText.includes('FROM workflow_runs')) {
      return { rows: [{ id: workflowRun.id, task_id: workflowRun.task_id, owner_agent_id: workflowRun.owner_agent_id }] };
    }

    if (queryText.includes('UPDATE workflow_runs') && queryText.includes("SET escalation_status = 'escalated'")) {
      workflowRun.escalation_status = 'escalated';
      workflowRun.escalated_to = values[1];
      workflowRun.escalation_reason = values[2];
      workflowRun.status = 'blocked';
      workflowRun.blocker_type = workflowRun.blocker_type || 'waiting_on_agent';
      workflowRun.blocker_description = workflowRun.blocker_description || values[2] || 'Escalated for operator attention';
      return { rows: [] };
    }

    if (queryText.includes('UPDATE workflow_runs') && queryText.includes("paused_at = NOW()")) {
      workflowRun.status = 'blocked';
      workflowRun.paused_at = '2026-03-12T12:20:00.000Z';
      workflowRun.paused_by = values[1];
      workflowRun.pause_reason = values[2];
      workflowRun.blocker_type = 'operator_paused';
      workflowRun.blocker_description = values[2] || 'Paused by operator';
      return { rows: [] };
    }

    if (queryText.includes('UPDATE workflow_runs') && queryText.includes('resumed_at = NOW()')) {
      workflowRun.status = values[1];
      workflowRun.paused_at = null;
      workflowRun.paused_by = null;
      workflowRun.pause_reason = null;
      workflowRun.blocker_type = null;
      workflowRun.blocker_description = null;
      return { rows: [] };
    }

    if (queryText.includes('UPDATE workflow_runs') && queryText.includes('SET owner_agent_id = $2')) {
      workflowRun.owner_agent_id = values[1];
      return { rows: [] };
    }

    if (queryText.includes('UPDATE tasks') && queryText.includes('blocker_type = CASE WHEN blocker_type')) {
      taskState.status = values[1];
      taskState.blocker_type = null;
      taskState.blocker_description = null;
      return { rows: [] };
    }

    if (queryText.includes('UPDATE tasks') && queryText.includes("blocker_type = 'operator_paused'")) {
      taskState.status = 'blocked';
      taskState.blocker_type = 'operator_paused';
      taskState.blocker_description = values[1] || 'Paused by operator';
      return { rows: [] };
    }

    if (queryText.includes('UPDATE tasks') && queryText.includes('SET owner = $2')) {
      taskState.owner = values[1];
      return { rows: [] };
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
  api.getRun = async (id) => ({
    id,
    ownerAgentId: workflowRun.owner_agent_id,
    status: workflowRun.status,
    blockerType: workflowRun.blocker_type,
    escalationStatus: workflowRun.escalation_status,
    escalatedTo: workflowRun.escalated_to,
    pauseReason: workflowRun.pause_reason
  });

  const blockers = await api.listBlockers({ limit: 20 });
  assert.strictEqual(blockers.length, 2, 'phase 6 blocker listing should combine run and task blockers');
  assert.ok(
    blockers.some((item) => item.entityType === 'workflow_run' && item.blockerType === 'no_heartbeat'),
    'run blockers should classify stale heartbeats'
  );
  assert.ok(
    blockers.some((item) => item.entityType === 'task' && item.blockerType === 'unmet_dependencies'),
    'task blockers should classify unmet dependencies'
  );

  const summary = await api.getBlockerSummary({ limit: 20 });
  assert.strictEqual(summary.total, 2, 'blocker summary should count all blocker items');
  assert.strictEqual(summary.byDepartment[0].departmentName, 'Content & Publishing', 'blocker summary should group by department');

  await api.pauseRun('run-1', 'ops-controller', 'Investigating session drift');
  assert.strictEqual(workflowRun.status, 'blocked', 'pause should move the run into blocked state');
  assert.strictEqual(taskState.status, 'blocked', 'pause should block the linked task');

  await api.resumeRun('run-1', 'ops-controller', 'Session restored');
  assert.strictEqual(workflowRun.status, 'running', 'resume should reactivate the workflow run');
  assert.strictEqual(taskState.status, 'in_progress', 'resume should reactivate the linked task');

  await api.escalateRun('run-1', 'content-director', 'Manual review required', 'ops-controller');
  assert.strictEqual(workflowRun.escalation_status, 'escalated', 'escalate should persist escalation status');
  assert.strictEqual(workflowRun.escalated_to, 'content-director', 'escalate should persist escalation target');

  await api.reassignRun('run-1', 'qa-auditor', 'ops-controller', 'Routing to a recovery owner');
  assert.strictEqual(workflowRun.owner_agent_id, 'qa-auditor', 'reassign should change run owner');
  assert.strictEqual(taskState.owner, 'qa-auditor', 'reassign should also retarget the task owner');
  assert.ok(auditEntries.some((entry) => entry.action === 'run_paused'), 'pause action should be audited');
  assert.ok(auditEntries.some((entry) => entry.action === 'run_resumed'), 'resume action should be audited');
  assert.ok(auditEntries.some((entry) => entry.action === 'run_escalated'), 'escalate action should be audited');
  assert.ok(auditEntries.some((entry) => entry.action === 'run_reassigned'), 'reassign action should be audited');

  console.log('PASS: workflow blockers api');
}

run().catch((error) => {
  console.error('FAIL: workflow blockers api');
  console.error(error);
  process.exit(1);
});
