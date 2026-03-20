/**
 * Workflow Runs API - REST endpoints for workflow execution management
 *
 * Part of Dashboard Workflow Upgrade Plan Phase 1 Item 1
 *
 * Endpoints:
 *   GET    /api/workflow-runs                    - List workflow runs (with filters)
 *   GET    /api/workflow-runs/:id                - Get workflow run with steps
 *   POST   /api/workflow-runs                    - Create workflow run
 *   PATCH  /api/workflow-runs/:id                - Update workflow run
 *   DELETE /api/workflow-runs/:id                - Cancel/delete workflow run
 *   POST   /api/workflow-runs/:id/start          - Start execution
 *   POST   /api/workflow-runs/:id/heartbeat      - Record heartbeat
 *   POST   /api/workflow-runs/:id/complete       - Mark as completed
 *   POST   /api/workflow-runs/:id/fail           - Mark as failed
 *   POST   /api/workflow-runs/:id/step           - Update current step
 *
 *   GET    /api/workflow-templates               - List workflow templates
 *   GET    /api/workflow-templates/:name         - Get template by name
 *   POST   /api/workflow-templates               - Create template
 *   PATCH  /api/workflow-templates/:name         - Update template
 *
 *   GET    /api/workflow-runs/stuck              - List stuck runs
 *   GET    /api/workflow-runs/active             - List active runs
 */

const { Pool } = require('pg');
const {
  buildGovernancePolicySummary,
  evaluateGovernanceAction,
  normalizeActorContext
} = require('./governance.js');

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeWorkflowStatus(status = 'queued') {
  const normalized = String(status || 'queued');
  const map = {
    queued: { label: 'Queued', tone: 'neutral', stage: 'pending', terminal: false },
    running: { label: 'Running', tone: 'info', stage: 'active', terminal: false },
    waiting_for_approval: { label: 'Waiting for approval', tone: 'warning', stage: 'blocked', terminal: false },
    blocked: { label: 'Blocked', tone: 'warning', stage: 'blocked', terminal: false },
    retrying: { label: 'Retrying', tone: 'warning', stage: 'active', terminal: false },
    completed: { label: 'Completed', tone: 'success', stage: 'done', terminal: true },
    failed: { label: 'Failed', tone: 'danger', stage: 'done', terminal: true },
    cancelled: { label: 'Cancelled', tone: 'muted', stage: 'done', terminal: true }
  };
  const details = map[normalized] || map.queued;
  return {
    code: normalized,
    label: details.label,
    tone: details.tone,
    stage: details.stage,
    terminal: details.terminal
  };
}

function normalizeBlockerType(type = 'other') {
  const code = String(type || 'other');
  const map = {
    no_heartbeat: {
      label: 'No heartbeat',
      severity: 'high',
      tone: 'danger',
      nextAction: 'restart_or_rebind_session'
    },
    stale_step: {
      label: 'Stale step',
      severity: 'high',
      tone: 'warning',
      nextAction: 'inspect_or_reassign'
    },
    repeated_retries: {
      label: 'Repeated retries',
      severity: 'high',
      tone: 'warning',
      nextAction: 'reassign_or_fix_root_cause'
    },
    approval_timeout: {
      label: 'Approval timeout',
      severity: 'high',
      tone: 'warning',
      nextAction: 'escalate_approval'
    },
    active_task_no_session: {
      label: 'Active task with no session',
      severity: 'high',
      tone: 'danger',
      nextAction: 'rebind_or_restart_session'
    },
    waiting_on_approval: {
      label: 'Waiting on approval',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'follow_up_reviewer'
    },
    waiting_on_agent: {
      label: 'Waiting on agent',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'reassign_owner'
    },
    waiting_on_external_service: {
      label: 'Waiting on external service',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'monitor_dependency'
    },
    content_failed_qa: {
      label: 'Content failed QA',
      severity: 'medium',
      tone: 'danger',
      nextAction: 'route_back_to_owner'
    },
    unmet_dependencies: {
      label: 'Unmet dependencies',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'complete_dependencies'
    },
    operator_paused: {
      label: 'Paused by operator',
      severity: 'low',
      tone: 'muted',
      nextAction: 'resume_run'
    },
    other: {
      label: 'Other blocker',
      severity: 'medium',
      tone: 'warning',
      nextAction: 'inspect_run'
    }
  };

  const resolved = map[code] || map.other;
  return {
    code,
    label: resolved.label,
    severity: resolved.severity,
    tone: resolved.tone,
    nextAction: resolved.nextAction
  };
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDepartmentContext(row = {}) {
  const id = row.department_row_id || row.department_id || row.id || null;
  const name = row.department_name || row.name || null;
  if (!id && !name) return null;
  return {
    id,
    name: name || 'Unknown department',
    description: row.department_description || row.description || '',
    color: row.department_color || row.color || null,
    icon: row.department_icon || row.icon || null,
    sortOrder: Number(row.department_sort_order ?? row.sort_order) || 0
  };
}

function normalizeServiceContext(row = {}) {
  const id = row.service_id || row.id || null;
  const slug = row.service_slug || row.slug || null;
  const name = row.service_name || row.name || null;
  if (!id && !slug && !name) return null;
  return {
    id,
    slug: slug || name || id,
    name: name || slug || 'Unknown service',
    description: row.service_description || row.description || ''
  };
}

function normalizeTemplateRow(row = {}) {
  const steps = parseJsonArray(row.template_steps ?? row.steps);
  const requiredApprovals = parseJsonArray(row.template_required_approvals ?? row.required_approvals);
  const successCriteria = parseJsonObject(row.template_success_criteria ?? row.success_criteria);
  const inputSchema = parseJsonObject(row.template_input_schema ?? row.input_schema);
  const artifactContract = parseJsonObject(row.template_artifact_contract ?? row.artifact_contract);
  const blockerPolicy = parseJsonObject(row.template_blocker_policy ?? row.blocker_policy);
  const escalationPolicy = parseJsonObject(row.template_escalation_policy ?? row.escalation_policy);
  const department = normalizeDepartmentContext({
    department_row_id: row.template_department_row_id || row.template_department_id,
    department_id: row.template_department_id,
    department_name: row.template_department_name,
    department_description: row.template_department_description,
    department_color: row.template_department_color,
    department_icon: row.template_department_icon,
    department_sort_order: row.template_department_sort_order
  });
  const service = normalizeServiceContext({
    service_id: row.template_service_id || row.service_id,
    service_slug: row.service_slug,
    service_name: row.service_name,
    service_description: row.service_description
  });
  const id = row.template_id || row.id || null;
  const name = row.template_name || row.name || null;

  return {
    ...(row.template_id || row.id ? row : {}),
    id,
    name,
    template_name: name,
    displayName: row.template_display_name || row.display_name || row.displayName || name || 'Unnamed template',
    display_name: row.template_display_name || row.display_name || row.displayName || name || 'Unnamed template',
    description: row.template_description || row.description || '',
    category: row.template_category || row.category || 'general',
    uiCategory: row.template_ui_category || row.ui_category || 'general',
    ui_category: row.template_ui_category || row.ui_category || 'general',
    defaultOwnerAgent: row.template_default_owner_agent || row.default_owner_agent || null,
    default_owner_agent: row.template_default_owner_agent || row.default_owner_agent || null,
    departmentId: row.template_department_id || row.department_id || department?.id || null,
    department_id: row.template_department_id || row.department_id || department?.id || null,
    serviceId: row.template_service_id || row.service_id || service?.id || null,
    service_id: row.template_service_id || row.service_id || service?.id || null,
    steps,
    stepsCount: steps.length,
    requiredApprovals,
    required_approvals: requiredApprovals,
    successCriteria,
    success_criteria: successCriteria,
    inputSchema,
    input_schema: inputSchema,
    artifactContract,
    artifact_contract: artifactContract,
    blockerPolicy,
    blocker_policy: blockerPolicy,
    escalationPolicy,
    escalation_policy: escalationPolicy,
    runbookRef: row.template_runbook_ref || row.runbook_ref || null,
    runbook_ref: row.template_runbook_ref || row.runbook_ref || null,
    governance: {
      runbookRef: row.template_runbook_ref || row.runbook_ref || null,
      actionPolicy: buildGovernancePolicySummary([
        'launch_workflow',
        'approve',
        'reject',
        'cancel_run',
        'override_failure',
        'reassign_owner'
      ])
    },
    isActive: row.template_is_active ?? row.is_active ?? true,
    is_active: row.template_is_active ?? row.is_active ?? true,
    department,
    service,
    createdAt: row.template_created_at || row.created_at || null,
    created_at: row.template_created_at || row.created_at || null,
    updatedAt: row.template_updated_at || row.updated_at || null,
    updated_at: row.template_updated_at || row.updated_at || null
  };
}

function normalizeWorkflowRunRow(row = {}) {
  const inputPayload = parseJsonObject(row.input_payload);
  const outputSummary = parseJsonObject(row.output_summary);
  const blockerMetadata = parseJsonObject(row.blocker_metadata);
  const department = normalizeDepartmentContext(row);
  const service = normalizeServiceContext(row);
  const template = row.template_id || row.template_name || row.template_display_name
    ? normalizeTemplateRow(row)
    : null;
  const statusInfo = normalizeWorkflowStatus(row.status);
  const serviceRequestId = row.service_request_id || row.serviceRequestId || row.service_request_row_id || null;

  return {
    ...row,
    id: row.id || null,
    workflowType: row.workflow_type || row.workflowType || null,
    workflow_type: row.workflow_type || row.workflowType || null,
    ownerAgentId: row.owner_agent_id || row.ownerAgentId || null,
    owner_agent_id: row.owner_agent_id || row.ownerAgentId || null,
    boardId: row.board_id || row.boardId || null,
    board_id: row.board_id || row.boardId || null,
    taskId: row.task_id || row.taskId || null,
    task_id: row.task_id || row.taskId || null,
    initiator: row.initiator || null,
    status: row.status || 'queued',
    statusInfo,
    currentStep: row.current_step || row.currentStep || null,
    current_step: row.current_step || row.currentStep || null,
    retryCount: Number(row.retry_count ?? row.retryCount) || 0,
    retry_count: Number(row.retry_count ?? row.retryCount) || 0,
    maxRetries: Number(row.max_retries ?? row.maxRetries) || 0,
    max_retries: Number(row.max_retries ?? row.maxRetries) || 0,
    lastError: row.last_error || row.lastError || null,
    last_error: row.last_error || row.lastError || null,
    inputPayload,
    input_payload: inputPayload,
    outputSummary,
    output_summary: outputSummary,
    gatewaySessionId: row.gateway_session_id || row.gatewaySessionId || null,
    gateway_session_id: row.gateway_session_id || row.gatewaySessionId || null,
    gatewaySessionActive: row.gateway_session_active ?? row.gatewaySessionActive ?? false,
    gateway_session_active: row.gateway_session_active ?? row.gatewaySessionActive ?? false,
    serviceRequestId,
    service_request_id: serviceRequestId,
    departmentId: row.department_id || row.departmentId || department?.id || null,
    department_id: row.department_id || row.departmentId || department?.id || null,
    runPriority: row.run_priority || row.runPriority || null,
    run_priority: row.run_priority || row.runPriority || null,
    approvalState: row.approval_state || row.approvalState || null,
    approval_state: row.approval_state || row.approvalState || null,
    blockerType: row.blocker_type || row.blockerType || null,
    blocker_type: row.blocker_type || row.blockerType || null,
    blockerDescription: row.blocker_description || row.blockerDescription || null,
    blocker_description: row.blocker_description || row.blockerDescription || null,
    blockerDetectedAt: row.blocker_detected_at || row.blockerDetectedAt || null,
    blocker_detected_at: row.blocker_detected_at || row.blockerDetectedAt || null,
    blockerSource: row.blocker_source || row.blockerSource || null,
    blocker_source: row.blocker_source || row.blockerSource || null,
    blockerMetadata,
    blocker_metadata: blockerMetadata,
    escalationStatus: row.escalation_status || row.escalationStatus || null,
    escalation_status: row.escalation_status || row.escalationStatus || null,
    escalatedAt: row.escalated_at || row.escalatedAt || null,
    escalated_at: row.escalated_at || row.escalatedAt || null,
    escalatedTo: row.escalated_to || row.escalatedTo || null,
    escalated_to: row.escalated_to || row.escalatedTo || null,
    escalationReason: row.escalation_reason || row.escalationReason || null,
    escalation_reason: row.escalation_reason || row.escalationReason || null,
    pausedAt: row.paused_at || row.pausedAt || null,
    paused_at: row.paused_at || row.pausedAt || null,
    pausedBy: row.paused_by || row.pausedBy || null,
    paused_by: row.paused_by || row.pausedBy || null,
    pauseReason: row.pause_reason || row.pauseReason || null,
    pause_reason: row.pause_reason || row.pauseReason || null,
    resumedAt: row.resumed_at || row.resumedAt || null,
    resumed_at: row.resumed_at || row.resumedAt || null,
    resumedBy: row.resumed_by || row.resumedBy || null,
    resumed_by: row.resumed_by || row.resumedBy || null,
    outcomeCode: row.outcome_code || row.outcomeCode || null,
    outcome_code: row.outcome_code || row.outcomeCode || null,
    operatorNotes: row.operator_notes || row.operatorNotes || null,
    operator_notes: row.operator_notes || row.operatorNotes || null,
    expectedArtifactCount: Number(row.expected_artifact_count ?? row.expectedArtifactCount) || 0,
    expected_artifact_count: Number(row.expected_artifact_count ?? row.expectedArtifactCount) || 0,
    actualArtifactCount: Number(row.actual_artifact_count ?? row.actualArtifactCount) || 0,
    actual_artifact_count: Number(row.actual_artifact_count ?? row.actualArtifactCount) || 0,
    valueScore: row.value_score === null || row.value_score === undefined ? null : Number(row.value_score),
    value_score: row.value_score === null || row.value_score === undefined ? null : Number(row.value_score),
    customerScope: row.customer_scope || row.customerScope || null,
    customer_scope: row.customer_scope || row.customerScope || null,
    taskTitle: row.task_title || row.taskTitle || null,
    task_title: row.task_title || row.taskTitle || null,
    boardName: row.board_name || row.boardName || null,
    board_name: row.board_name || row.boardName || null,
    elapsedSeconds: row.elapsed_seconds === null || row.elapsed_seconds === undefined ? null : Number(row.elapsed_seconds),
    elapsed_seconds: row.elapsed_seconds === null || row.elapsed_seconds === undefined ? null : Number(row.elapsed_seconds),
    heartbeatAgeSeconds: row.heartbeat_age_seconds === null || row.heartbeat_age_seconds === undefined ? null : Number(row.heartbeat_age_seconds),
    heartbeat_age_seconds: row.heartbeat_age_seconds === null || row.heartbeat_age_seconds === undefined ? null : Number(row.heartbeat_age_seconds),
    serviceRequest: serviceRequestId ? {
      id: serviceRequestId,
      title: row.service_request_title || null,
      status: row.service_request_status || null,
      priority: row.service_request_priority || null,
      targetAgentId: row.service_request_target_agent_id || null,
      targetDepartmentId: row.service_request_target_department_id || null
    } : null,
    governance: {
      runbookRef: row.template_runbook_ref || row.runbook_ref || null,
      actionPolicy: buildGovernancePolicySummary([
        'approve',
        'reject',
        'cancel_run',
        'override_failure',
        'reassign_owner',
        'escalate_run',
        'escalate_approval',
        'pause_run',
        'resume_run'
      ])
    },
    department,
    service,
    template,
    startedAt: row.started_at || row.startedAt || null,
    started_at: row.started_at || row.startedAt || null,
    finishedAt: row.finished_at || row.finishedAt || null,
    finished_at: row.finished_at || row.finishedAt || null,
    lastHeartbeatAt: row.last_heartbeat_at || row.lastHeartbeatAt || null,
    last_heartbeat_at: row.last_heartbeat_at || row.lastHeartbeatAt || null,
    createdAt: row.created_at || row.createdAt || null,
    created_at: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    updated_at: row.updated_at || row.updatedAt || null
  };
}

function summarizeBlockerItems(items = []) {
  const summary = {
    total: 0,
    workflowRuns: 0,
    tasks: 0,
    escalated: 0,
    byType: [],
    byDepartment: []
  };

  const typeMap = new Map();
  const departmentMap = new Map();

  items.forEach((item) => {
    if (!item) return;
    summary.total += 1;
    if (item.entityType === 'workflow_run') summary.workflowRuns += 1;
    if (item.entityType === 'task') summary.tasks += 1;
    if (item.escalatedAt || item.escalatedTo || item.escalationStatus === 'escalated') {
      summary.escalated += 1;
    }

    const typeKey = item.blockerType || 'other';
    if (!typeMap.has(typeKey)) {
      const normalized = normalizeBlockerType(typeKey);
      typeMap.set(typeKey, {
        blockerType: typeKey,
        label: normalized.label,
        severity: normalized.severity,
        tone: normalized.tone,
        nextAction: normalized.nextAction,
        count: 0
      });
    }
    typeMap.get(typeKey).count += 1;

    const department = item.department || {
      id: item.departmentId || 'unassigned',
      slug: item.departmentSlug || 'unassigned',
      name: item.departmentName || 'Unassigned'
    };
    const departmentKey = department.slug || department.id || department.name || 'unassigned';
    if (!departmentMap.has(departmentKey)) {
      departmentMap.set(departmentKey, {
        departmentId: department.id || 'unassigned',
        departmentSlug: department.slug || department.id || 'unassigned',
        departmentName: department.name || 'Unassigned',
        total: 0,
        escalated: 0,
        byType: []
      });
    }
    const departmentEntry = departmentMap.get(departmentKey);
    departmentEntry.total += 1;
    if (item.escalatedAt || item.escalatedTo || item.escalationStatus === 'escalated') {
      departmentEntry.escalated += 1;
    }

    const existingType = departmentEntry.byType.find((entry) => entry.blockerType === typeKey);
    if (existingType) {
      existingType.count += 1;
    } else {
      const normalized = normalizeBlockerType(typeKey);
      departmentEntry.byType.push({
        blockerType: typeKey,
        label: normalized.label,
        severity: normalized.severity,
        tone: normalized.tone,
        nextAction: normalized.nextAction,
        count: 1
      });
    }
  });

  const sorter = (left, right) => right.count - left.count || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });

  summary.byType = Array.from(typeMap.values()).sort(sorter);
  summary.byDepartment = Array.from(departmentMap.values())
    .map((entry) => ({
      ...entry,
      byType: entry.byType.sort(sorter)
    }))
    .sort((left, right) => right.total - left.total || left.departmentName.localeCompare(right.departmentName, undefined, { sensitivity: 'base' }));

  return summary;
}

function determineRunBlocker(run = {}, approvals = [], steps = []) {
  const normalizedRun = normalizeWorkflowRunRow(run);
  const currentStep = Array.isArray(steps)
    ? steps.find((step) => (step.step_name || step.stepName) === normalizedRun.currentStep)
    : null;
  const currentStepStartedAt = run.current_step_started_at
    || run.currentStepStartedAt
    || currentStep?.started_at
    || currentStep?.startedAt
    || null;
  const pendingApprovalCount = run.pending_approval_count ?? run.pendingApprovalCount ?? approvals.filter((approval) => approval.status === 'pending').length;
  const overdueApprovalCount = run.overdue_approval_count ?? run.overdueApprovalCount ?? approvals.filter((approval) => {
    if (approval.status !== 'pending' || !approval.dueAt) return false;
    const dueTs = new Date(approval.dueAt).getTime();
    return Number.isFinite(dueTs) && dueTs < Date.now();
  }).length;
  const derivedPendingApprovalDueAt = approvals
    .filter((approval) => approval.status === 'pending' && approval.dueAt)
    .map((approval) => approval.dueAt)
    .sort()[0] || null;
  const pendingApprovalDueAt = run.pending_approval_due_at ?? run.pendingApprovalDueAt ?? derivedPendingApprovalDueAt;

  const blockerPolicy = normalizedRun.template?.blockerPolicy || {};
  const heartbeatThresholdSeconds = Number(blockerPolicy.heartbeat_stale_seconds) || 600;
  const staleStepThresholdSeconds = Number(blockerPolicy.stale_step_seconds) || 3600;
  const retryThreshold = Number(blockerPolicy.retry_threshold) || Math.min(Math.max(normalizedRun.maxRetries || 3, 2), 3);

  let blockerType = normalizedRun.blockerType || null;
  let blockerDescription = normalizedRun.blockerDescription || null;
  let detectedAt = normalizedRun.blockerDetectedAt || null;
  let source = normalizedRun.blockerSource || null;

  if (normalizedRun.pausedAt || blockerType === 'operator_paused') {
    blockerType = 'operator_paused';
    blockerDescription = normalizedRun.pauseReason || blockerDescription || 'Paused by an operator.';
    detectedAt = normalizedRun.pausedAt || detectedAt;
    source = source || 'operator';
  } else if (normalizedRun.status === 'blocked' && blockerType) {
    source = source || 'manual';
  } else if (overdueApprovalCount > 0) {
    blockerType = 'approval_timeout';
    blockerDescription = `Pending approvals overdue: ${overdueApprovalCount}`;
    detectedAt = pendingApprovalDueAt || normalizedRun.updatedAt || normalizedRun.lastHeartbeatAt || normalizedRun.createdAt;
    source = 'detector';
  } else if (normalizedRun.status === 'waiting_for_approval' || (pendingApprovalCount > 0 && normalizedRun.approvalState === 'pending')) {
    blockerType = blockerType || 'waiting_on_approval';
    blockerDescription = blockerDescription || `Waiting on ${pendingApprovalCount || 1} approval${pendingApprovalCount === 1 ? '' : 's'}.`;
    detectedAt = detectedAt || pendingApprovalDueAt || normalizedRun.updatedAt || normalizedRun.createdAt;
    source = source || 'detector';
  } else if (['running', 'retrying'].includes(normalizedRun.status) && normalizedRun.taskId && !normalizedRun.gatewaySessionActive) {
    blockerType = 'active_task_no_session';
    blockerDescription = 'Run is active but no gateway session is bound.';
    detectedAt = normalizedRun.updatedAt || normalizedRun.createdAt;
    source = 'detector';
  } else if (['running', 'retrying'].includes(normalizedRun.status) && !normalizedRun.lastHeartbeatAt) {
    blockerType = 'no_heartbeat';
    blockerDescription = 'Run has not emitted a heartbeat yet.';
    detectedAt = normalizedRun.startedAt || normalizedRun.createdAt;
    source = 'detector';
  } else if (
    ['running', 'retrying'].includes(normalizedRun.status)
    && normalizedRun.heartbeatAgeSeconds !== null
    && normalizedRun.heartbeatAgeSeconds > heartbeatThresholdSeconds
  ) {
    blockerType = 'no_heartbeat';
    blockerDescription = `Last heartbeat ${Math.round(normalizedRun.heartbeatAgeSeconds)}s ago.`;
    detectedAt = normalizedRun.lastHeartbeatAt || normalizedRun.updatedAt || normalizedRun.createdAt;
    source = 'detector';
  } else if (
    ['running', 'retrying'].includes(normalizedRun.status)
    && currentStepStartedAt
    && ((Date.now() - new Date(currentStepStartedAt).getTime()) / 1000) > staleStepThresholdSeconds
  ) {
    blockerType = 'stale_step';
    blockerDescription = `Current step ${normalizedRun.currentStep || 'unknown'} has been running longer than expected.`;
    detectedAt = currentStepStartedAt;
    source = 'detector';
  } else if (
    ['retrying', 'blocked', 'running'].includes(normalizedRun.status)
    && normalizedRun.retryCount >= retryThreshold
  ) {
    blockerType = 'repeated_retries';
    blockerDescription = `Retry count ${normalizedRun.retryCount}/${normalizedRun.maxRetries || retryThreshold}.`;
    detectedAt = normalizedRun.updatedAt || normalizedRun.lastHeartbeatAt || normalizedRun.createdAt;
    source = 'detector';
  } else if (normalizedRun.status === 'blocked') {
    blockerType = blockerType || 'other';
    blockerDescription = blockerDescription || 'Run is blocked without a classified blocker type.';
    detectedAt = detectedAt || normalizedRun.updatedAt || normalizedRun.createdAt;
    source = source || 'manual';
  }

  if (!blockerType) {
    return null;
  }

  const blockerInfo = normalizeBlockerType(blockerType);
  return {
    id: `workflow_run:${normalizedRun.id}`,
    entityType: 'workflow_run',
    entityId: normalizedRun.id,
    workflowRunId: normalizedRun.id,
    taskId: normalizedRun.taskId,
    title: normalizedRun.taskTitle || normalizedRun.workflowType || normalizedRun.id,
    status: normalizedRun.status,
    ownerAgentId: normalizedRun.ownerAgentId,
    workflowType: normalizedRun.workflowType,
    department: normalizedRun.department || {
      id: normalizedRun.departmentId || 'unassigned',
      slug: normalizedRun.departmentId || 'unassigned',
      name: normalizedRun.department?.name || 'Unassigned'
    },
    departmentId: normalizedRun.departmentId || normalizedRun.department?.id || 'unassigned',
    departmentName: normalizedRun.department?.name || 'Unassigned',
    serviceRequestId: normalizedRun.serviceRequestId,
    blockerType,
    blockerLabel: blockerInfo.label,
    blockerDescription,
    severity: blockerInfo.severity,
    tone: blockerInfo.tone,
    nextAction: blockerInfo.nextAction,
    detectedAt: toIsoOrNull(detectedAt) || normalizedRun.updatedAt || normalizedRun.createdAt,
    source: source || 'manual',
    retryCount: normalizedRun.retryCount,
    maxRetries: normalizedRun.maxRetries,
    heartbeatAgeSeconds: normalizedRun.heartbeatAgeSeconds,
    pendingApprovalCount,
    overdueApprovalCount,
    escalatedAt: normalizedRun.escalatedAt,
    escalatedTo: normalizedRun.escalatedTo,
    escalationReason: normalizedRun.escalationReason,
    escalationStatus: normalizedRun.escalationStatus,
    pausedAt: normalizedRun.pausedAt,
    pausedBy: normalizedRun.pausedBy,
    pauseReason: normalizedRun.pauseReason
  };
}

function determineTaskBlocker(row = {}) {
  const status = row.status || null;
  const hasUnmetDependencies = Boolean(row.has_unmet_dependencies || row.hasUnmetDependencies);
  const retryCount = Number(row.retry_count ?? row.retryCount) || 0;

  let blockerType = row.blocker_type || row.blockerType || null;
  let blockerDescription = row.blocker_description || row.blockerDescription || null;
  let detectedAt = row.updated_at || row.updatedAt || row.created_at || row.createdAt || null;
  let source = blockerType ? 'manual' : null;

  if (status === 'blocked' && blockerType) {
    source = 'manual';
  } else if (status === 'in_progress' && hasUnmetDependencies) {
    blockerType = 'unmet_dependencies';
    blockerDescription = blockerDescription || 'Task is in progress while upstream dependencies are still incomplete.';
    source = 'detector';
  } else if (status === 'blocked') {
    blockerType = blockerType || 'other';
    blockerDescription = blockerDescription || 'Task is blocked without a classified blocker type.';
    source = source || 'manual';
  } else if (retryCount >= 2 && !['completed', 'archived'].includes(status || '')) {
    blockerType = 'repeated_retries';
    blockerDescription = blockerDescription || `Task has retried ${retryCount} times.`;
    source = 'detector';
  }

  if (!blockerType) {
    return null;
  }

  const blockerInfo = normalizeBlockerType(blockerType);
  return {
    id: `task:${row.id}`,
    entityType: 'task',
    entityId: row.id || null,
    workflowRunId: row.active_workflow_run_id || row.activeWorkflowRunId || null,
    taskId: row.id || null,
    title: row.title || row.id || 'Blocked task',
    status: status || 'blocked',
    ownerAgentId: row.owner || row.owner_agent_id || row.ownerAgentId || null,
    workflowType: null,
    department: normalizeDepartmentContext(row) || {
      id: row.department_id || row.departmentId || 'unassigned',
      slug: row.department_slug || row.departmentSlug || row.department_id || row.departmentId || 'unassigned',
      name: row.department_name || row.departmentName || 'Unassigned'
    },
    departmentId: row.department_id || row.departmentId || 'unassigned',
    departmentName: row.department_name || row.departmentName || 'Unassigned',
    serviceRequestId: null,
    blockerType,
    blockerLabel: blockerInfo.label,
    blockerDescription,
    severity: blockerInfo.severity,
    tone: blockerInfo.tone,
    nextAction: blockerInfo.nextAction,
    detectedAt: toIsoOrNull(detectedAt),
    source: source || 'manual',
    retryCount,
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
  };
}

function normalizeWorkflowArtifactRow(row = {}) {
  const metadata = parseJsonObject(row.metadata);
  return {
    ...row,
    id: row.id || null,
    workflowRunId: row.workflow_run_id || row.workflowRunId || null,
    workflow_run_id: row.workflow_run_id || row.workflowRunId || null,
    taskId: row.task_id || row.taskId || null,
    task_id: row.task_id || row.taskId || null,
    artifactType: row.artifact_type || row.artifactType || 'output',
    artifact_type: row.artifact_type || row.artifactType || 'output',
    label: row.label || 'Untitled artifact',
    uri: row.uri || null,
    mimeType: row.mime_type || row.mimeType || null,
    mime_type: row.mime_type || row.mimeType || null,
    status: row.status || 'generated',
    metadata,
    createdBy: row.created_by || row.createdBy || null,
    created_by: row.created_by || row.createdBy || null,
    createdAt: row.created_at || row.createdAt || null,
    created_at: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    updated_at: row.updated_at || row.updatedAt || null,
    workflowType: row.workflow_type || row.workflowType || null,
    workflow_type: row.workflow_type || row.workflowType || null,
    ownerAgentId: row.owner_agent_id || row.ownerAgentId || null,
    owner_agent_id: row.owner_agent_id || row.ownerAgentId || null,
    serviceRequestId: row.service_request_id || row.serviceRequestId || null,
    service_request_id: row.service_request_id || row.serviceRequestId || null,
    taskTitle: row.task_title || row.taskTitle || null,
    task_title: row.task_title || row.taskTitle || null,
    boardName: row.board_name || row.boardName || null,
    board_name: row.board_name || row.boardName || null,
    customerScope: row.customer_scope || row.customerScope || null,
    customer_scope: row.customer_scope || row.customerScope || null
  };
}

function normalizeApprovalStatus(status = 'pending') {
  const code = String(status || 'pending');
  const map = {
    pending: { label: 'Pending', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'muted' }
  };
  return {
    code,
    label: (map[code] || map.pending).label,
    tone: (map[code] || map.pending).tone
  };
}

function normalizeApprovalRow(row = {}) {
  const metadata = parseJsonObject(row.metadata);
  const artifact = row.artifact_id || row.artifact_uri || row.artifact_label
    ? {
      id: row.artifact_id || null,
      label: row.artifact_label || 'Linked artifact',
      uri: row.artifact_uri || null,
      artifactType: row.artifact_type || null,
      artifact_type: row.artifact_type || null,
      status: row.artifact_status || null
    }
    : null;
  const dueAt = row.due_at || row.dueAt || null;
  const expiresAt = row.expires_at || row.expiresAt || null;
  const now = Date.now();
  const dueTs = dueAt ? new Date(dueAt).getTime() : null;
  const expiresTs = expiresAt ? new Date(expiresAt).getTime() : null;

  return {
    ...row,
    id: row.id || null,
    workflowRunId: row.workflow_run_id || row.workflowRunId || null,
    workflow_run_id: row.workflow_run_id || row.workflowRunId || null,
    stepName: row.step_name || row.stepName || null,
    step_name: row.step_name || row.stepName || null,
    approvalType: row.approval_type || row.approvalType || 'step_gate',
    approval_type: row.approval_type || row.approvalType || 'step_gate',
    approverId: row.approver_id || row.approverId || null,
    approver_id: row.approver_id || row.approverId || null,
    status: row.status || 'pending',
    statusInfo: normalizeApprovalStatus(row.status || 'pending'),
    decision: row.decision || '',
    requestedBy: row.requested_by || row.requestedBy || null,
    requested_by: row.requested_by || row.requestedBy || null,
    requestedAt: row.requested_at || row.requestedAt || null,
    requested_at: row.requested_at || row.requestedAt || null,
    dueAt,
    due_at: dueAt,
    expiresAt,
    expires_at: expiresAt,
    escalatedAt: row.escalated_at || row.escalatedAt || null,
    escalated_at: row.escalated_at || row.escalatedAt || null,
    escalatedTo: row.escalated_to || row.escalatedTo || null,
    escalated_to: row.escalated_to || row.escalatedTo || null,
    escalationReason: row.escalation_reason || row.escalationReason || null,
    escalation_reason: row.escalation_reason || row.escalationReason || null,
    requiredNote: row.required_note ?? row.requiredNote ?? true,
    required_note: row.required_note ?? row.requiredNote ?? true,
    decidedBy: row.decided_by || row.decidedBy || null,
    decided_by: row.decided_by || row.decidedBy || null,
    decidedAt: row.decided_at || row.decidedAt || null,
    decided_at: row.decided_at || row.decidedAt || null,
    metadata,
    artifact,
    workflowType: row.workflow_type || row.workflowType || null,
    workflow_type: row.workflow_type || row.workflowType || null,
    ownerAgentId: row.owner_agent_id || row.ownerAgentId || null,
    owner_agent_id: row.owner_agent_id || row.ownerAgentId || null,
    taskId: row.task_id || row.taskId || null,
    task_id: row.task_id || row.taskId || null,
    taskTitle: row.task_title || row.taskTitle || null,
    task_title: row.task_title || row.taskTitle || null,
    serviceRequestId: row.service_request_id || row.serviceRequestId || null,
    service_request_id: row.service_request_id || row.serviceRequestId || null,
    overdue: Boolean((row.status || 'pending') === 'pending' && dueTs && dueTs < now),
    expired: Boolean((row.status || 'pending') === 'pending' && expiresTs && expiresTs < now)
  };
}

function summarizeApprovals(approvals = []) {
  const summary = {
    total: approvals.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    overdue: 0,
    expired: 0,
    escalated: 0,
    artifactLinked: 0,
    latestDueAt: null
  };

  approvals.forEach((approval) => {
    const normalized = normalizeApprovalRow(approval);
    summary[normalized.status] = (summary[normalized.status] || 0) + 1;
    if (normalized.overdue) summary.overdue += 1;
    if (normalized.expired) summary.expired += 1;
    if (normalized.escalatedAt || normalized.escalatedTo) summary.escalated += 1;
    if (normalized.artifact?.id) summary.artifactLinked += 1;
    if (normalized.dueAt && (!summary.latestDueAt || new Date(normalized.dueAt) > new Date(summary.latestDueAt))) {
      summary.latestDueAt = normalized.dueAt;
    }
  });

  return summary;
}

class WorkflowRunsAPI {
  constructor(pool) {
    this.pool = pool || new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'openclaw_webos',
      user: process.env.POSTGRES_USER || 'openclaw',
      password: process.env.POSTGRES_PASSWORD || 'openclaw_password'
    });
    this.tableAvailability = new Map();
  }

  async tableExists(tableName) {
    if (this.tableAvailability.has(tableName)) {
      return this.tableAvailability.get(tableName);
    }

    const result = await this.pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS exists
    `, [tableName]);

    const exists = Boolean(result.rows[0]?.exists);
    this.tableAvailability.set(tableName, exists);
    return exists;
  }

  async getActorContext(actorId) {
    const normalizedId = String(actorId || '').trim() || 'system';
    if (['system', 'dashboard-operator', 'openclaw'].includes(normalizedId)) {
      return normalizeActorContext(normalizedId);
    }

    if (await this.tableExists('agent_profiles')) {
      try {
        const result = await this.pool.query(`
          SELECT agent_id AS "agentId", display_name AS "displayName", role, capabilities
          FROM agent_profiles
          WHERE agent_id = $1
          LIMIT 1
        `, [normalizedId]);
        if (result.rows.length) {
          return normalizeActorContext(normalizedId, result.rows[0]);
        }
      } catch (error) {
        console.warn('[workflow-runs-api] Failed to resolve actor profile:', error.message);
      }
    }

    return normalizeActorContext(normalizedId);
  }

  async ensureGovernancePermission(action, actorId, options = {}) {
    const actor = await this.getActorContext(actorId);
    const evaluation = evaluateGovernanceAction(action, actor, options);
    if (!evaluation.allowed) {
      throw new Error(evaluation.reason || `Actor ${actor.id} is not allowed to perform ${action}`);
    }
    return actor;
  }

  async refreshArtifactCount(runId, client = this.pool) {
    if (!(await this.tableExists('workflow_artifacts'))) {
      return 0;
    }

    const countResult = await client.query(`
      SELECT COUNT(*)::integer AS count
      FROM workflow_artifacts
      WHERE workflow_run_id = $1
    `, [runId]);

    const count = Number(countResult.rows[0]?.count) || 0;
    await client.query(`
      UPDATE workflow_runs
      SET actual_artifact_count = $2
      WHERE id = $1
    `, [runId, count]);

    return count;
  }

  async writeTaskAudit(taskId, actor, action, oldValue, newValue, client = this.pool) {
    if (!taskId) return;
    await client.query(`
      INSERT INTO audit_log (task_id, actor, action, old_value, new_value, timestamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [
      taskId,
      actor || 'system',
      action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    ]);
  }

  async writeApprovalAudit(taskId, actor, action, oldValue, newValue, client = this.pool) {
    await this.writeTaskAudit(taskId, actor, action, oldValue, newValue, client);
  }

  async listRunBlockers(filters = {}) {
    const {
      owner_agent_id = null,
      department_id = null,
      workflow_run_id = null,
      workflow_type = null
    } = filters;

    const params = [];
    let paramIndex = 1;
    let query = `
      SELECT
        wr.*,
        t.title AS task_title,
        p.name AS board_name,
        sr.id AS service_request_row_id,
        sr.title AS service_request_title,
        sr.status AS service_request_status,
        sr.priority AS service_request_priority,
        sr.target_agent_id AS service_request_target_agent_id,
        sr.target_department_id AS service_request_target_department_id,
        wt.id AS template_id,
        wt.name AS template_name,
        wt.display_name AS template_display_name,
        wt.description AS template_description,
        wt.category AS template_category,
        wt.ui_category AS template_ui_category,
        wt.default_owner_agent AS template_default_owner_agent,
        wt.steps AS template_steps,
        wt.required_approvals AS template_required_approvals,
        wt.success_criteria AS template_success_criteria,
        wt.input_schema AS template_input_schema,
        wt.artifact_contract AS template_artifact_contract,
        wt.blocker_policy AS template_blocker_policy,
        wt.escalation_policy AS template_escalation_policy,
        wt.runbook_ref AS template_runbook_ref,
        wt.department_id AS template_department_id,
        wt.service_id AS template_service_id,
        sc.id AS service_id,
        sc.slug AS service_slug,
        sc.name AS service_name,
        sc.description AS service_description,
        d.id AS department_row_id,
        d.name AS department_name,
        d.description AS department_description,
        d.color AS department_color,
        d.icon AS department_icon,
        d.sort_order AS department_sort_order,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(wr.started_at, wr.created_at))) AS elapsed_seconds,
        CASE
          WHEN wr.last_heartbeat_at IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at))
        END AS heartbeat_age_seconds,
        current_step.started_at AS current_step_started_at,
        approval_stats.pending_approval_count,
        approval_stats.overdue_approval_count,
        approval_stats.pending_approval_due_at
      FROM workflow_runs wr
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN projects p ON wr.board_id = p.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      LEFT JOIN departments d ON COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = d.id
      LEFT JOIN LATERAL (
        SELECT ws.started_at
        FROM workflow_steps ws
        WHERE ws.workflow_run_id = wr.id
          AND ws.step_name = wr.current_step
        ORDER BY ws.step_order ASC
        LIMIT 1
      ) AS current_step ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE a.status = 'pending')::int AS pending_approval_count,
          COUNT(*) FILTER (WHERE a.status = 'pending' AND a.due_at IS NOT NULL AND a.due_at < NOW())::int AS overdue_approval_count,
          MIN(a.due_at) FILTER (WHERE a.status = 'pending' AND a.due_at IS NOT NULL) AS pending_approval_due_at
        FROM workflow_approvals a
        WHERE a.workflow_run_id = wr.id
      ) AS approval_stats ON TRUE
      WHERE wr.status IN ('running', 'waiting_for_approval', 'blocked', 'retrying')
    `;

    if (owner_agent_id) {
      query += ` AND wr.owner_agent_id = $${paramIndex++}`;
      params.push(owner_agent_id);
    }
    if (department_id) {
      query += ` AND COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $${paramIndex++}`;
      params.push(department_id);
    }
    if (workflow_run_id) {
      query += ` AND wr.id = $${paramIndex++}`;
      params.push(workflow_run_id);
    }
    if (workflow_type) {
      query += ` AND wr.workflow_type = $${paramIndex++}`;
      params.push(workflow_type);
    }

    query += ' ORDER BY COALESCE(wr.updated_at, wr.created_at) DESC';

    const result = await this.pool.query(query, params);
    return result.rows
      .map((row) => determineRunBlocker(row))
      .filter(Boolean);
  }

  async listTaskBlockers(filters = {}) {
    const {
      owner_agent_id = null,
      department_id = null,
      task_id = null
    } = filters;

    const params = [];
    let paramIndex = 1;
    let query = `
      SELECT
        t.*,
        p.name AS board_name,
        d.id AS department_row_id,
        d.name AS department_name,
        d.description AS department_description,
        d.color AS department_color,
        d.icon AS department_icon,
        d.sort_order AS department_sort_order,
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(t.dependency_ids, ARRAY[]::uuid[])) AS dep_id
          JOIN tasks dep ON dep.id = dep_id
          WHERE dep.status <> 'completed'
            AND dep.deleted_at IS NULL
            AND dep.archived_at IS NULL
        ) AS has_unmet_dependencies
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN agent_profiles ap ON ap.agent_id = t.owner
      LEFT JOIN departments d ON d.id = ap.department_id
      WHERE t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND (
          t.status = 'blocked'
          OR (t.status = 'in_progress' AND EXISTS (
            SELECT 1
            FROM unnest(COALESCE(t.dependency_ids, ARRAY[]::uuid[])) AS dep_id
            JOIN tasks dep ON dep.id = dep_id
            WHERE dep.status <> 'completed'
              AND dep.deleted_at IS NULL
              AND dep.archived_at IS NULL
          ))
          OR (COALESCE(t.retry_count, 0) >= 2 AND t.status IN ('in_progress', 'ready', 'blocked', 'review'))
        )
    `;

    if (owner_agent_id) {
      query += ` AND t.owner = $${paramIndex++}`;
      params.push(owner_agent_id);
    }
    if (department_id) {
      query += ` AND ap.department_id = $${paramIndex++}`;
      params.push(department_id);
    }
    if (task_id) {
      query += ` AND t.id = $${paramIndex++}`;
      params.push(task_id);
    }

    query += ' ORDER BY t.updated_at DESC';

    const result = await this.pool.query(query, params);
    return result.rows
      .map((row) => determineTaskBlocker(row))
      .filter(Boolean);
  }

  async listBlockers(filters = {}) {
    const [runBlockers, taskBlockers] = await Promise.all([
      this.listRunBlockers(filters),
      this.listTaskBlockers(filters)
    ]);

    const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
    const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };

    return runBlockers
      .concat(taskBlockers)
      .filter((item) => {
        if (filters.blocker_type && item.blockerType !== filters.blocker_type) return false;
        if (filters.entity_type === 'workflow_run' && item.entityType !== 'workflow_run') return false;
        if (filters.entity_type === 'task' && item.entityType !== 'task') return false;
        return true;
      })
      .sort((left, right) => {
        const severityDelta = (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9);
        if (severityDelta !== 0) return severityDelta;
        const leftEscalated = left.escalatedAt || left.escalatedTo ? 1 : 0;
        const rightEscalated = right.escalatedAt || right.escalatedTo ? 1 : 0;
        if (rightEscalated !== leftEscalated) return rightEscalated - leftEscalated;
        return new Date(right.detectedAt || 0) - new Date(left.detectedAt || 0);
      })
      .slice(0, limit);
  }

  async getBlockerSummary(filters = {}) {
    const items = await this.listBlockers({ ...filters, limit: filters.limit || 500 });
    return summarizeBlockerItems(items);
  }

  async syncRunApprovalState(runId, client = this.pool) {
    const approvalsResult = await client.query(`
      SELECT status
      FROM workflow_approvals
      WHERE workflow_run_id = $1
    `, [runId]);

    const statuses = approvalsResult.rows.map((row) => row.status);
    let nextApprovalState = 'not_required';
    let nextStatus = null;

    if (statuses.length === 0) {
      nextApprovalState = 'not_required';
    } else if (statuses.includes('rejected')) {
      nextApprovalState = 'rejected';
      nextStatus = 'blocked';
    } else if (statuses.includes('pending')) {
      nextApprovalState = 'pending';
      nextStatus = 'waiting_for_approval';
    } else if (statuses.every((status) => status === 'approved')) {
      nextApprovalState = 'approved';
      nextStatus = 'running';
    } else {
      nextApprovalState = 'mixed';
    }

    const result = await client.query(`
      UPDATE workflow_runs
      SET approval_state = $2,
          status = CASE
            WHEN $3 IS NULL THEN status
            WHEN status IN ('completed', 'failed', 'cancelled') THEN status
            ELSE $3
          END
      WHERE id = $1
      RETURNING *
    `, [runId, nextApprovalState, nextStatus]);

    return result.rows[0];
  }

  /**
   * List workflow runs with optional filters
   */
  async listRuns(filters = {}) {
    const {
      status,
      workflow_type,
      owner_agent_id,
      board_id,
      task_id,
      service_request_id,
      department_id,
      limit = 50,
      offset = 0
    } = filters;

    let query = `
      SELECT
        wr.*,
        t.title as task_title,
        p.name as board_name,
        sr.id as service_request_row_id,
        sr.title as service_request_title,
        sr.status as service_request_status,
        sr.priority as service_request_priority,
        sr.target_agent_id as service_request_target_agent_id,
        sr.target_department_id as service_request_target_department_id,
        wt.id as template_id,
        wt.name as template_name,
        wt.display_name as template_display_name,
        wt.description as template_description,
        wt.category as template_category,
        wt.ui_category as template_ui_category,
        wt.default_owner_agent as template_default_owner_agent,
        wt.steps as template_steps,
        wt.required_approvals as template_required_approvals,
        wt.success_criteria as template_success_criteria,
        wt.input_schema as template_input_schema,
        wt.artifact_contract as template_artifact_contract,
        wt.blocker_policy as template_blocker_policy,
        wt.escalation_policy as template_escalation_policy,
        wt.runbook_ref as template_runbook_ref,
        wt.department_id as template_department_id,
        wt.service_id as template_service_id,
        sc.id as service_id,
        sc.slug as service_slug,
        sc.name as service_name,
        sc.description as service_description,
        d.id as department_row_id,
        d.name as department_name,
        d.description as department_description,
        d.color as department_color,
        d.icon as department_icon,
        d.sort_order as department_sort_order,
        EXTRACT(EPOCH FROM (NOW() - wr.started_at)) as elapsed_seconds,
        EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at)) as heartbeat_age_seconds
      FROM workflow_runs wr
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN projects p ON wr.board_id = p.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      LEFT JOIN departments d ON COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = d.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND wr.status = $${paramIndex++}`;
      params.push(status);
    }
    if (workflow_type) {
      query += ` AND wr.workflow_type = $${paramIndex++}`;
      params.push(workflow_type);
    }
    if (owner_agent_id) {
      query += ` AND wr.owner_agent_id = $${paramIndex++}`;
      params.push(owner_agent_id);
    }
    if (board_id) {
      query += ` AND wr.board_id = $${paramIndex++}`;
      params.push(board_id);
    }
    if (task_id) {
      query += ` AND wr.task_id = $${paramIndex++}`;
      params.push(task_id);
    }
    if (service_request_id) {
      query += ` AND wr.service_request_id = $${paramIndex++}`;
      params.push(service_request_id);
    }
    if (department_id) {
      query += ` AND wr.department_id = $${paramIndex++}`;
      params.push(department_id);
    }

    query += ` ORDER BY wr.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => normalizeWorkflowRunRow(row));
  }

  /**
   * Get a single workflow run with its steps
   */
  async getRun(id) {
    const runQuery = `
      SELECT
        wr.*,
        t.title as task_title,
        p.name as board_name,
        sr.id as service_request_row_id,
        sr.title as service_request_title,
        sr.status as service_request_status,
        sr.priority as service_request_priority,
        sr.target_agent_id as service_request_target_agent_id,
        sr.target_department_id as service_request_target_department_id,
        wt.id as template_id,
        wt.name as template_name,
        wt.display_name as template_display_name,
        wt.description as template_description,
        wt.category as template_category,
        wt.ui_category as template_ui_category,
        wt.default_owner_agent as template_default_owner_agent,
        wt.steps as template_steps,
        wt.required_approvals as template_required_approvals,
        wt.success_criteria as template_success_criteria,
        wt.input_schema as template_input_schema,
        wt.artifact_contract as template_artifact_contract,
        wt.blocker_policy as template_blocker_policy,
        wt.escalation_policy as template_escalation_policy,
        wt.runbook_ref as template_runbook_ref,
        wt.department_id as template_department_id,
        wt.service_id as template_service_id,
        sc.id as service_id,
        sc.slug as service_slug,
        sc.name as service_name,
        sc.description as service_description,
        d.id as department_row_id,
        d.name as department_name,
        d.description as department_description,
        d.color as department_color,
        d.icon as department_icon,
        d.sort_order as department_sort_order,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(wr.started_at, wr.created_at))) as elapsed_seconds,
        CASE
          WHEN wr.last_heartbeat_at IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (NOW() - wr.last_heartbeat_at))
        END as heartbeat_age_seconds
      FROM workflow_runs wr
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN projects p ON wr.board_id = p.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      LEFT JOIN departments d ON COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = d.id
      WHERE wr.id = $1
    `;
    const runResult = await this.pool.query(runQuery, [id]);

    if (runResult.rows.length === 0) {
      return null;
    }

    const stepsQuery = `
      SELECT * FROM workflow_steps
      WHERE workflow_run_id = $1
      ORDER BY step_order ASC
    `;
    const stepsResult = await this.pool.query(stepsQuery, [id]);
    const artifacts = await this.listWorkflowArtifacts({ workflow_run_id: id, limit: 500, offset: 0 });
    const approvals = await this.listApprovals(id);

    const normalizedRun = normalizeWorkflowRunRow(runResult.rows[0]);
    const blocker = determineRunBlocker(normalizedRun, approvals, stepsResult.rows);
    return {
      ...normalizedRun,
      steps: stepsResult.rows,
      artifacts,
      approvals,
      approvalSummary: summarizeApprovals(approvals),
      blocker,
      blockerSummary: summarizeBlockerItems(blocker ? [blocker] : [])
    };
  }

  /**
   * Create a new workflow run
   */
  async createRun(data) {
    const {
      workflow_type,
      owner_agent_id,
      actor = null,
      board_id = null,
      task_id = null,
      initiator = null,
      input_payload = {},
      gateway_session_id = null,
      service_request_id = null,
      department_id = null,
      run_priority = null,
      approval_state = null,
      outcome_code = null,
      operator_notes = null,
      actual_artifact_count = 0,
      value_score = null,
      customer_scope = null
    } = data;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission(
        'launch_workflow',
        actor || initiator || 'system'
      );

      const templateResult = await client.query(`
        SELECT
          id,
          department_id,
          service_id,
          default_owner_agent,
          steps,
          required_approvals,
          artifact_contract
        FROM workflow_templates
        WHERE name = $1
      `, [workflow_type]);
      const template = templateResult.rows[0] || null;

      let resolvedBoardId = board_id;
      let resolvedTaskId = task_id;
      let resolvedDepartmentId = department_id || template?.department_id || null;
      let resolvedRunPriority = run_priority;
      let resolvedCustomerScope = customer_scope;
      let resolvedApprovalState = approval_state;

      if (service_request_id) {
        const requestResult = await client.query(`
          SELECT
            id,
            project_id,
            task_id,
            priority,
            target_department_id,
            input_payload
          FROM service_requests
          WHERE id = $1
          LIMIT 1
        `, [service_request_id]);

        const request = requestResult.rows[0] || null;
        if (request) {
          resolvedBoardId = resolvedBoardId || request.project_id || null;
          resolvedTaskId = resolvedTaskId || request.task_id || null;
          resolvedDepartmentId = resolvedDepartmentId || request.target_department_id || null;
          resolvedRunPriority = resolvedRunPriority || request.priority || null;
          const requestPayload = parseJsonObject(request.input_payload);
          resolvedCustomerScope = resolvedCustomerScope
            || requestPayload.site
            || requestPayload.website
            || null;
        }
      }

      if (!resolvedApprovalState) {
        const approvals = parseJsonArray(template?.required_approvals);
        resolvedApprovalState = approvals.length ? 'not_requested' : 'not_required';
      }

      const artifactContract = parseJsonObject(template?.artifact_contract);
      const expectedArtifactCount = data.expected_artifact_count !== undefined
        ? Number(data.expected_artifact_count) || 0
        : Array.isArray(artifactContract.expected_artifacts)
          ? artifactContract.expected_artifacts.length
          : 0;

      // Create the workflow run
      const resolvedOwnerAgentId = owner_agent_id || template?.default_owner_agent || null;
      const insertQuery = `
        INSERT INTO workflow_runs (
          workflow_type,
          owner_agent_id,
          board_id,
          task_id,
          initiator,
          input_payload,
          gateway_session_id,
          service_request_id,
          department_id,
          run_priority,
          approval_state,
          outcome_code,
          operator_notes,
          expected_artifact_count,
          actual_artifact_count,
          value_score,
          customer_scope,
          status,
          started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'queued', NOW())
        RETURNING *
      `;
      const result = await client.query(insertQuery, [
        workflow_type,
        resolvedOwnerAgentId,
        resolvedBoardId,
        resolvedTaskId,
        initiator,
        JSON.stringify(input_payload),
        gateway_session_id,
        service_request_id,
        resolvedDepartmentId,
        resolvedRunPriority,
        resolvedApprovalState,
        outcome_code,
        operator_notes,
        expectedArtifactCount,
        Number(actual_artifact_count) || 0,
        value_score,
        resolvedCustomerScope
      ]);

      const run = result.rows[0];
      const templateSteps = parseJsonArray(template?.steps);

      if (templateSteps.length > 0) {
        const steps = templateSteps;

        // Create workflow steps
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepInsertQuery = `
            INSERT INTO workflow_steps (
              workflow_run_id,
              step_name,
              step_order,
              status
            ) VALUES ($1, $2, $3, 'pending')
          `;
          await client.query(stepInsertQuery, [run.id, step.name, i]);
        }
      }

      // Update task if provided
      if (resolvedTaskId) {
        const updateTaskQuery = `
          UPDATE tasks
          SET active_workflow_run_id = $1,
              status = 'in_progress',
              owner = $2
          WHERE id = $3
        `;
        await client.query(updateTaskQuery, [run.id, owner_agent_id, resolvedTaskId]);
      }

      await this.writeTaskAudit(
        resolvedTaskId,
        governanceActor.id,
        'run_launched',
        null,
        {
          workflow_run_id: run.id,
          workflow_type,
          owner_agent_id,
          service_request_id,
          department_id: resolvedDepartmentId
        },
        client
      );

      await client.query('COMMIT');
      return await this.getRun(run.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update a workflow run
   */
  async updateRun(id, data) {
    const allowedFields = [
      'status',
      'current_step',
      'output_summary',
      'last_error',
      'retry_count',
      'gateway_session_id',
      'gateway_session_active'
    ];

    const updates = [];
    const params = [id];
    let paramIndex = 2;

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = $${paramIndex++}`);
        if (field === 'output_summary' && typeof data[field] === 'object') {
          params.push(JSON.stringify(data[field]));
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updates.length === 0) {
      return await this.getRun(id);
    }

    const query = `
      UPDATE workflow_runs
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, params);
    return result.rows[0];
  }

  /**
   * Start a workflow run (transition from queued to running)
   */
  async startRun(id) {
    const query = `
      UPDATE workflow_runs
      SET status = 'running',
          started_at = COALESCE(started_at, NOW()),
          last_heartbeat_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Record a heartbeat for a running workflow
   */
  async heartbeat(id) {
    const query = `
      UPDATE workflow_runs
      SET last_heartbeat_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Complete a workflow run
   */
  async completeRun(id, outputSummary = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update the run
      const runQuery = `
        UPDATE workflow_runs
        SET status = 'completed',
            finished_at = NOW(),
            output_summary = $2
        WHERE id = $1
        RETURNING *
      `;
      const runResult = await client.query(runQuery, [id, JSON.stringify(outputSummary)]);
      const taskId = runResult.rows[0]?.task_id || null;

      // Clear task's active workflow run
      const taskQuery = `
        UPDATE tasks
        SET active_workflow_run_id = NULL,
            status = 'completed',
            completed_at = NOW()
        WHERE active_workflow_run_id = $1
      `;
      await client.query(taskQuery, [id]);

      await this.writeTaskAudit(
        taskId,
        'system',
        'run_completed',
        {
          workflow_run_id: id
        },
        {
          workflow_run_id: id,
          output_summary: outputSummary
        },
        client
      );

      await client.query('COMMIT');
      return runResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Mark a workflow run as failed
   */
  async failRun(id, errorMessage) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const query = `
        UPDATE workflow_runs
        SET status = 'failed',
            finished_at = NOW(),
            last_error = $2,
            last_error_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      const result = await client.query(query, [id, errorMessage]);
      const run = result.rows[0] || null;

      await this.writeTaskAudit(
        run?.task_id || null,
        'system',
        'run_failed',
        {
          workflow_run_id: id
        },
        {
          workflow_run_id: id,
          error: errorMessage
        },
        client
      );

      await client.query('COMMIT');
      return run;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update current step
   */
  async updateStep(runId, stepName, status = 'in_progress', output = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Update the step
      const stepQuery = `
        UPDATE workflow_steps
        SET status = $3,
            started_at = CASE WHEN $3 = 'in_progress' THEN COALESCE(started_at, NOW()) ELSE started_at END,
            finished_at = CASE WHEN $3 IN ('completed', 'failed', 'skipped') THEN NOW() ELSE finished_at END,
            output = $4
        WHERE workflow_run_id = $1 AND step_name = $2
        RETURNING *
      `;
      const stepResult = await client.query(stepQuery, [runId, stepName, status, JSON.stringify(output)]);

      // Update the run's current_step
      const runQuery = `
        UPDATE workflow_runs
        SET current_step = $2
        WHERE id = $1
      `;
      await client.query(runQuery, [runId, stepName]);

      await client.query('COMMIT');
      return stepResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get active runs
   */
  async getActiveRuns() {
    const query = `
      SELECT * FROM active_workflow_runs
      ORDER BY started_at DESC
    `;
    const result = await this.pool.query(query);
    return result.rows.map((row) => normalizeWorkflowRunRow(row));
  }

  /**
   * Get stuck runs
   */
  /**
   * List approvals for a workflow run
   */
  async listApprovals(runId) {
    const query = `
      SELECT
        a.*,
        wr.workflow_type,
        wr.owner_agent_id,
        wr.task_id,
        wr.service_request_id,
        t.title AS task_title,
        wa.label AS artifact_label,
        wa.uri AS artifact_uri,
        wa.artifact_type,
        wa.status AS artifact_status
      FROM workflow_approvals a
      JOIN workflow_runs wr ON a.workflow_run_id = wr.id
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN workflow_artifacts wa ON a.artifact_id = wa.id
      WHERE a.workflow_run_id = $1
      ORDER BY a.created_at DESC
    `;
    const result = await this.pool.query(query, [runId]);
    return result.rows.map((row) => normalizeApprovalRow(row));
  }

  async listWorkflowArtifacts(filters = {}) {
    if (!(await this.tableExists('workflow_artifacts'))) {
      return [];
    }

    const {
      workflow_run_id = null,
      task_id = null,
      workflow_type = null,
      artifact_type = null,
      status = null,
      agent = null,
      site = null,
      limit = 100,
      offset = 0
    } = filters;

    const params = [];
    let paramIndex = 1;
    let query = `
      SELECT
        wa.*,
        wr.workflow_type,
        wr.owner_agent_id,
        wr.service_request_id,
        wr.customer_scope,
        t.title AS task_title,
        p.name AS board_name
      FROM workflow_artifacts wa
      JOIN workflow_runs wr ON wr.id = wa.workflow_run_id
      LEFT JOIN tasks t ON COALESCE(wa.task_id, wr.task_id) = t.id
      LEFT JOIN projects p ON wr.board_id = p.id
      WHERE 1 = 1
    `;

    if (workflow_run_id) {
      query += ` AND wa.workflow_run_id = $${paramIndex++}`;
      params.push(workflow_run_id);
    }
    if (task_id) {
      query += ` AND COALESCE(wa.task_id, wr.task_id) = $${paramIndex++}`;
      params.push(task_id);
    }
    if (workflow_type) {
      query += ` AND wr.workflow_type = $${paramIndex++}`;
      params.push(workflow_type);
    }
    if (artifact_type) {
      query += ` AND wa.artifact_type = $${paramIndex++}`;
      params.push(artifact_type);
    }
    if (status) {
      query += ` AND wa.status = $${paramIndex++}`;
      params.push(status);
    }
    if (agent) {
      query += ` AND COALESCE(wa.created_by, wr.owner_agent_id) = $${paramIndex++}`;
      params.push(agent);
    }
    if (site) {
      query += ` AND COALESCE(wr.customer_scope, wr.input_payload->>'site', wr.input_payload->>'website', '') ILIKE $${paramIndex++}`;
      params.push(`%${site}%`);
    }

    query += ` ORDER BY wa.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
    params.push(Math.max(Number(offset) || 0, 0));

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => normalizeWorkflowArtifactRow(row));
  }

  async createWorkflowArtifact(runId, data = {}) {
    if (!(await this.tableExists('workflow_artifacts'))) {
      throw new Error('Workflow artifacts table is not available yet');
    }

    if (!data.artifact_type) {
      throw new Error('artifact_type is required');
    }
    if (!data.label) {
      throw new Error('label is required');
    }
    if (!data.uri) {
      throw new Error('uri is required');
    }

    const runResult = await this.pool.query(`
      SELECT id, task_id
      FROM workflow_runs
      WHERE id = $1
      LIMIT 1
    `, [runId]);
    if (!runResult.rows.length) {
      throw new Error('Workflow run not found');
    }

    const run = runResult.rows[0];
    const result = await this.pool.query(`
      INSERT INTO workflow_artifacts (
        workflow_run_id,
        task_id,
        artifact_type,
        label,
        uri,
        mime_type,
        status,
        metadata,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      runId,
      data.task_id || run.task_id || null,
      data.artifact_type,
      data.label,
      data.uri,
      data.mime_type || null,
      data.status || 'generated',
      JSON.stringify(parseJsonObject(data.metadata)),
      data.created_by || null
    ]);

    await this.refreshArtifactCount(runId);
    return normalizeWorkflowArtifactRow(result.rows[0]);
  }

  /**
   * Create an approval request
   */
  async createApproval(runId, stepName, approverId, requestedBy, metadata = {}, options = {}) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const runResult = await client.query(`
        SELECT id, task_id, workflow_type, owner_agent_id
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [runId]);

      if (!runResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const run = runResult.rows[0];
      const approvalType = options.approval_type || metadata.approval_type || 'step_gate';
      const dueAt = options.due_at || metadata.due_at || null;
      const expiresAt = options.expires_at || metadata.expires_at || dueAt || null;
      const artifactId = options.artifact_id || metadata.artifact_id || null;
      const requiredNote = options.required_note ?? metadata.required_note ?? true;

      const query = `
        INSERT INTO workflow_approvals (
          workflow_run_id,
          step_name,
          approval_type,
          approver_id,
          requested_by,
          artifact_id,
          due_at,
          expires_at,
          required_note,
          status,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
        RETURNING *
      `;
      const result = await client.query(query, [
        runId,
        stepName,
        approvalType,
        approverId,
        requestedBy,
        artifactId,
        dueAt,
        expiresAt,
        requiredNote,
        JSON.stringify(parseJsonObject(metadata))
      ]);

      await this.syncRunApprovalState(runId, client);
      await this.writeApprovalAudit(
        run.task_id,
        requestedBy,
        'approval_requested',
        null,
        {
          workflow_run_id: runId,
          step_name: stepName,
          approval_type: approvalType,
          approver_id: approverId,
          artifact_id: artifactId,
          due_at: dueAt
        },
        client
      );

      await client.query('COMMIT');
      const approvals = await this.listApprovals(runId);
      return approvals.find((approval) => approval.id === result.rows[0].id) || normalizeApprovalRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update approval decision
   */
  async updateApproval(id, decision, decisionNotes = '', decidedBy = null) {
    if (!decisionNotes || !String(decisionNotes).trim()) {
      throw new Error('Decision note is required');
    }

    const normalizedDecision = decision === 'approved' ? 'approved'
      : decision === 'rejected' ? 'rejected'
        : decision === 'cancelled' ? 'cancelled'
          : null;
    if (!normalizedDecision) {
      throw new Error('Unsupported approval decision');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(`
        SELECT a.*, wr.task_id
        FROM workflow_approvals a
        JOIN workflow_runs wr ON a.workflow_run_id = wr.id
        WHERE a.id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Approval not found');
      }

      const existing = existingResult.rows[0];
      const query = `
        UPDATE workflow_approvals
        SET status = $2,
            decision = $3,
            decided_by = $4,
            decided_at = NOW()
        WHERE id = $1
        RETURNING *
      `;
      const result = await client.query(query, [id, normalizedDecision, decisionNotes.trim(), decidedBy]);

      await this.syncRunApprovalState(existing.workflow_run_id, client);
      await this.writeApprovalAudit(
        existing.task_id,
        decidedBy || existing.approver_id || 'system',
        `approval_${normalizedDecision}`,
        {
          approval_id: existing.id,
          previous_status: existing.status
        },
        {
          workflow_run_id: existing.workflow_run_id,
          step_name: existing.step_name,
          status: normalizedDecision,
          note: decisionNotes.trim()
        },
        client
      );

      await client.query('COMMIT');
      return normalizeApprovalRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async escalateApproval(id, escalatedTo, reason = '', actor = 'system') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(`
        SELECT a.*, wr.task_id
        FROM workflow_approvals a
        JOIN workflow_runs wr ON a.workflow_run_id = wr.id
        WHERE a.id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Approval not found');
      }

      const existing = existingResult.rows[0];
      const result = await client.query(`
        UPDATE workflow_approvals
        SET escalated_at = NOW(),
            escalated_to = $2,
            escalation_reason = $3
        WHERE id = $1
        RETURNING *
      `, [id, escalatedTo || null, reason || null]);

      await this.writeApprovalAudit(
        existing.task_id,
        actor,
        'approval_escalated',
        {
          approval_id: existing.id,
          escalated_to: existing.escalated_to || null
        },
        {
          workflow_run_id: existing.workflow_run_id,
          escalated_to: escalatedTo || null,
          reason: reason || null
        },
        client
      );

      await client.query('COMMIT');
      return normalizeApprovalRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pending approvals for an approver
   */
  async getPendingApprovals(approverId = null) {
    const params = [];
    let paramIndex = 1;
    let query = `
      SELECT
        a.*,
        wr.workflow_type,
        wr.task_id,
        wr.owner_agent_id,
        wr.service_request_id,
        t.title as task_title,
        wa.label AS artifact_label,
        wa.uri AS artifact_uri,
        wa.artifact_type,
        wa.status AS artifact_status
      FROM workflow_approvals a
      JOIN workflow_runs wr ON a.workflow_run_id = wr.id
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN workflow_artifacts wa ON a.artifact_id = wa.id
      WHERE a.status = 'pending'
    `;

    if (approverId) {
      query += ` AND a.approver_id = $${paramIndex++}`;
      params.push(approverId);
    }

    query += ' ORDER BY COALESCE(a.due_at, a.requested_at) ASC, a.created_at DESC';
    const result = await this.pool.query(query, params);
    return result.rows.map((row) => normalizeApprovalRow(row));
  }

  async getStuckRuns() {
    const blockers = await this.listRunBlockers();
    return blockers;
  }

  async escalateRun(id, escalatedTo, reason = '', actor = 'system') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('escalate_run', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, owner_agent_id, status, blocker_type, blocker_description,
               escalation_status, escalated_to, escalation_reason
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      await client.query(`
        UPDATE workflow_runs
        SET escalation_status = 'escalated',
            escalated_at = NOW(),
            escalated_to = $2,
            escalation_reason = $3,
            status = CASE
              WHEN status IN ('completed', 'failed', 'cancelled') THEN status
              WHEN status = 'waiting_for_approval' THEN status
              ELSE 'blocked'
            END,
            blocker_type = COALESCE(blocker_type, 'waiting_on_agent'),
            blocker_description = COALESCE(NULLIF(blocker_description, ''), NULLIF($3, ''), 'Escalated for operator attention'),
            blocker_detected_at = COALESCE(blocker_detected_at, NOW()),
            blocker_source = COALESCE(blocker_source, 'operator')
        WHERE id = $1
      `, [id, escalatedTo || null, reason || null]);

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_escalated',
        {
          owner_agent_id: existing.owner_agent_id,
          escalation_status: existing.escalation_status,
          escalated_to: existing.escalated_to,
          escalation_reason: existing.escalation_reason
        },
        {
          workflow_run_id: id,
          escalated_to: escalatedTo || null,
          escalation_reason: reason || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async pauseRun(id, actor = 'system', reason = '') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('pause_run', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, status, paused_at, paused_by, pause_reason, blocker_type, blocker_description
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      await client.query(`
        UPDATE workflow_runs
        SET status = CASE
              WHEN status IN ('completed', 'failed', 'cancelled') THEN status
              ELSE 'blocked'
            END,
            paused_at = NOW(),
            paused_by = $2,
            pause_reason = $3,
            blocker_type = 'operator_paused',
            blocker_description = COALESCE(NULLIF($3, ''), 'Paused by operator'),
            blocker_detected_at = COALESCE(blocker_detected_at, NOW()),
            blocker_source = 'operator'
        WHERE id = $1
      `, [id, actor, reason || null]);

      if (existing.task_id) {
        await client.query(`
          UPDATE tasks
          SET status = CASE
                WHEN status IN ('completed', 'archived') THEN status
                ELSE 'blocked'
              END,
              blocker_type = 'operator_paused',
              blocker_description = COALESCE(NULLIF($2, ''), 'Paused by operator'),
              updated_at = NOW()
          WHERE id = $1
        `, [existing.task_id, reason || null]);
      }

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_paused',
        {
          status: existing.status,
          blocker_type: existing.blocker_type,
          blocker_description: existing.blocker_description
        },
        {
          workflow_run_id: id,
          status: 'blocked',
          blocker_type: 'operator_paused',
          pause_reason: reason || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resumeRun(id, actor = 'system', note = '') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('resume_run', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, status, paused_at, paused_by, pause_reason, blocker_type, blocker_description, approval_state
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      const pendingApprovalsResult = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM workflow_approvals
        WHERE workflow_run_id = $1
          AND status = 'pending'
      `, [id]);
      const pendingApprovals = Number(pendingApprovalsResult.rows[0]?.count) || 0;
      const resumedStatus = pendingApprovals > 0 || existing.approval_state === 'pending'
        ? 'waiting_for_approval'
        : 'running';

      await client.query(`
        UPDATE workflow_runs
        SET status = $2,
            resumed_at = NOW(),
            resumed_by = $3,
            paused_at = NULL,
            paused_by = NULL,
            pause_reason = NULL,
            blocker_type = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_type END,
            blocker_description = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_description END,
            blocker_detected_at = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_detected_at END,
            blocker_source = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_source END
        WHERE id = $1
      `, [id, resumedStatus, actor]);

      if (existing.task_id) {
        await client.query(`
          UPDATE tasks
          SET status = CASE
                WHEN status IN ('completed', 'archived') THEN status
                ELSE $2
              END,
              blocker_type = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_type END,
              blocker_description = CASE WHEN blocker_type = 'operator_paused' THEN NULL ELSE blocker_description END,
              updated_at = NOW()
          WHERE id = $1
        `, [existing.task_id, resumedStatus === 'running' ? 'in_progress' : 'blocked']);
      }

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_resumed',
        {
          status: existing.status,
          paused_at: existing.paused_at,
          pause_reason: existing.pause_reason
        },
        {
          workflow_run_id: id,
          status: resumedStatus,
          note: note || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reassignRun(id, newOwnerAgentId, actor = 'system', reason = '') {
    if (!newOwnerAgentId || !String(newOwnerAgentId).trim()) {
      throw new Error('new_owner_agent_id is required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('reassign_owner', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, owner_agent_id
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      await client.query(`
        UPDATE workflow_runs
        SET owner_agent_id = $2,
            updated_at = NOW()
        WHERE id = $1
      `, [id, String(newOwnerAgentId).trim()]);

      if (existing.task_id) {
        await client.query(`
          UPDATE tasks
          SET owner = $2,
              updated_at = NOW()
          WHERE id = $1
        `, [existing.task_id, String(newOwnerAgentId).trim()]);
      }

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_reassigned',
        {
          owner_agent_id: existing.owner_agent_id
        },
        {
          workflow_run_id: id,
          owner_agent_id: String(newOwnerAgentId).trim(),
          reason: reason || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelRun(id, actor = 'system', reason = '') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('cancel_run', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, status
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      await client.query(`
        UPDATE workflow_runs
        SET status = 'cancelled',
            finished_at = COALESCE(finished_at, NOW()),
            operator_notes = CASE
              WHEN $2 IS NULL OR $2 = '' THEN operator_notes
              WHEN operator_notes IS NULL OR operator_notes = '' THEN $2
              ELSE operator_notes || E'\\n' || $2
            END,
            updated_at = NOW()
        WHERE id = $1
      `, [id, reason || null]);

      if (existing.task_id) {
        await client.query(`
          UPDATE tasks
          SET active_workflow_run_id = NULL,
              status = CASE
                WHEN status IN ('completed', 'archived') THEN status
                ELSE 'blocked'
              END,
              updated_at = NOW()
          WHERE id = $1
        `, [existing.task_id]);
      }

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_cancelled',
        {
          workflow_run_id: id,
          status: existing.status
        },
        {
          workflow_run_id: id,
          status: 'cancelled',
          reason: reason || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async overrideFailure(id, actor = 'system', note = '', nextStatus = 'queued') {
    const normalizedNextStatus = ['queued', 'running', 'blocked'].includes(nextStatus) ? nextStatus : 'queued';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const governanceActor = await this.ensureGovernancePermission('override_failure', actor);

      const existingResult = await client.query(`
        SELECT id, task_id, status, last_error
        FROM workflow_runs
        WHERE id = $1
        LIMIT 1
      `, [id]);

      if (!existingResult.rows.length) {
        throw new Error('Workflow run not found');
      }

      const existing = existingResult.rows[0];
      if (existing.status !== 'failed') {
        throw new Error('Only failed runs can be overridden');
      }

      await client.query(`
        UPDATE workflow_runs
        SET status = $2,
            finished_at = NULL,
            operator_notes = CASE
              WHEN $3 IS NULL OR $3 = '' THEN operator_notes
              WHEN operator_notes IS NULL OR operator_notes = '' THEN $3
              ELSE operator_notes || E'\\n' || $3
            END,
            updated_at = NOW()
        WHERE id = $1
      `, [id, normalizedNextStatus, note || null]);

      if (existing.task_id) {
        await client.query(`
          UPDATE tasks
          SET status = CASE
                WHEN status IN ('completed', 'archived') THEN status
                ELSE $2
              END,
              updated_at = NOW()
          WHERE id = $1
        `, [existing.task_id, normalizedNextStatus === 'running' ? 'in_progress' : normalizedNextStatus === 'queued' ? 'ready' : 'blocked']);
      }

      await this.writeTaskAudit(
        existing.task_id,
        governanceActor.id,
        'run_failure_overridden',
        {
          workflow_run_id: id,
          status: existing.status,
          last_error: existing.last_error
        },
        {
          workflow_run_id: id,
          status: normalizedNextStatus,
          note: note || null
        },
        client
      );

      await client.query('COMMIT');
      return this.getRun(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Bind a session to a workflow run
   */
  async bindSession(runId, sessionId) {
    const query = `
      UPDATE workflow_runs
      SET gateway_session_id = $2,
          gateway_session_active = true,
          last_heartbeat_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [runId, sessionId]);
    return result.rows[0];
  }

  /**
   * Unbind a session from a workflow run
   */
  async unbindSession(runId) {
    const query = `
      UPDATE workflow_runs
      SET gateway_session_active = false
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.pool.query(query, [runId]);
    return result.rows[0];
  }

  /**
   * Get all active sessions with their workflow runs
   */
  async getActiveSessions() {
    const query = `
      SELECT
        gateway_session_id,
        COUNT(*) as run_count,
        array_agg(id) as run_ids,
        array_agg(workflow_type) as workflow_types,
        MAX(last_heartbeat_at) as last_heartbeat,
        MAX(owner_agent_id) as owner_agent
      FROM workflow_runs
      WHERE gateway_session_id IS NOT NULL
        AND gateway_session_active = true
        AND status IN ('running', 'queued')
      GROUP BY gateway_session_id
      ORDER BY last_heartbeat DESC
    `;
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Record session heartbeat
   */
  async recordSessionHeartbeat(sessionId) {
    const query = `
      UPDATE workflow_runs
      SET last_heartbeat_at = NOW()
      WHERE gateway_session_id = $1
        AND gateway_session_active = true
      RETURNING *
    `;
    const result = await this.pool.query(query, [sessionId]);
    return result.rows;
  }

    /**
   * List workflow templates
   */
  async listTemplates(category = null) {
    let query = `
      SELECT
        wt.*,
        d.id AS template_department_row_id,
        d.name AS template_department_name,
        d.description AS template_department_description,
        d.color AS template_department_color,
        d.icon AS template_department_icon,
        d.sort_order AS template_department_sort_order,
        sc.id AS service_id,
        sc.slug AS service_slug,
        sc.name AS service_name,
        sc.description AS service_description
      FROM workflow_templates wt
      LEFT JOIN departments d ON wt.department_id = d.id
      LEFT JOIN service_catalog sc ON wt.service_id = sc.id
      WHERE wt.is_active = true
    `;
    const params = [];

    if (category) {
      query += ' AND (wt.category = $1 OR wt.ui_category = $1)';
      params.push(category);
    }

    query += ' ORDER BY wt.ui_category ASC, wt.name ASC';

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => normalizeTemplateRow(row));
  }

  /**
   * Get workflow template by name
   */
  async getTemplate(name) {
    const query = `
      SELECT
        wt.*,
        d.id AS template_department_row_id,
        d.name AS template_department_name,
        d.description AS template_department_description,
        d.color AS template_department_color,
        d.icon AS template_department_icon,
        d.sort_order AS template_department_sort_order,
        sc.id AS service_id,
        sc.slug AS service_slug,
        sc.name AS service_name,
        sc.description AS service_description
      FROM workflow_templates wt
      LEFT JOIN departments d ON wt.department_id = d.id
      LEFT JOIN service_catalog sc ON wt.service_id = sc.id
      WHERE wt.name = $1
    `;
    const result = await this.pool.query(query, [name]);
    return result.rows[0] ? normalizeTemplateRow(result.rows[0]) : null;
  }
}

/**
 * HTTP request handler for workflow runs API
 */
function createWorkflowRunsHandler(pool) {
  const api = new WorkflowRunsAPI(pool);

  return async function handleWorkflowRunsRequest(req, res, pathname, body) {
    const method = req.method;

    // Workflow runs endpoints
    if (pathname === '/api/workflow-runs') {
      if (method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const filters = {
          status: url.searchParams.get('status'),
          workflow_type: url.searchParams.get('workflow_type'),
          owner_agent_id: url.searchParams.get('owner_agent_id'),
          board_id: url.searchParams.get('board_id'),
          task_id: url.searchParams.get('task_id'),
          service_request_id: url.searchParams.get('service_request_id'),
          department_id: url.searchParams.get('department_id'),
          limit: parseInt(url.searchParams.get('limit') || '50'),
          offset: parseInt(url.searchParams.get('offset') || '0')
        };
        const runs = await api.listRuns(filters);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ runs }));
        return true;
      }

      if (method === 'POST') {
        try {
          const run = await api.createRun(body);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(run));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
        return true;
      }
    }

    // /api/workflow-runs/stuck
    if (pathname === '/api/workflow-runs/stuck' && method === 'GET') {
      const runs = await api.getStuckRuns();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runs }));
      return true;
    }

    // /api/workflow-runs/active
    if (pathname === '/api/workflow-runs/active' && method === 'GET') {
      const runs = await api.getActiveRuns();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ runs }));
      return true;
    }

    if (pathname === '/api/blockers' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const blockers = await api.listBlockers({
        owner_agent_id: url.searchParams.get('owner_agent_id'),
        department_id: url.searchParams.get('department_id'),
        blocker_type: url.searchParams.get('blocker_type'),
        entity_type: url.searchParams.get('entity_type'),
        limit: url.searchParams.get('limit')
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ blockers }));
      return true;
    }

    if (pathname === '/api/blockers/summary' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const summary = await api.getBlockerSummary({
        owner_agent_id: url.searchParams.get('owner_agent_id'),
        department_id: url.searchParams.get('department_id'),
        blocker_type: url.searchParams.get('blocker_type'),
        entity_type: url.searchParams.get('entity_type'),
        limit: url.searchParams.get('limit')
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
      return true;
    }

    if (pathname === '/api/artifacts' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const artifacts = await api.listWorkflowArtifacts({
        workflow_type: url.searchParams.get('workflow_type'),
        artifact_type: url.searchParams.get('artifact_type'),
        status: url.searchParams.get('status'),
        agent: url.searchParams.get('agent'),
        site: url.searchParams.get('site'),
        task_id: url.searchParams.get('task_id'),
        limit: parseInt(url.searchParams.get('limit') || '100', 10),
        offset: parseInt(url.searchParams.get('offset') || '0', 10)
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artifacts }));
      return true;
    }

    // /api/workflow-runs/:id endpoints
    const runIdMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)$'));
    if (runIdMatch) {
      const id = runIdMatch[1];

      if (method === 'GET') {
        const run = await api.getRun(id);
        if (!run) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Run not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(run));
        }
        return true;
      }

      if (method === 'PATCH') {
        const run = await api.updateRun(id, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
        return true;
      }

      if (method === 'DELETE') {
        await api.cancelRun(id, 'system', 'Cancelled via DELETE endpoint');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'cancelled' }));
        return true;
      }
    }

    // /api/workflow-runs/:id/start
    const startMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/start$'));
    if (startMatch && method === 'POST') {
      const id = startMatch[1];
      const run = await api.startRun(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
      return true;
    }

    // /api/workflow-runs/:id/heartbeat
    const heartbeatMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/heartbeat$'));
    if (heartbeatMatch && method === 'POST') {
      const id = heartbeatMatch[1];
      const run = await api.heartbeat(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
      return true;
    }

    // /api/workflow-runs/:id/complete
    const completeMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/complete$'));
    if (completeMatch && method === 'POST') {
      const id = completeMatch[1];
      const run = await api.completeRun(id, body.output_summary || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
      return true;
    }

    // /api/workflow-runs/:id/fail
    const failMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/fail$'));
    if (failMatch && method === 'POST') {
      const id = failMatch[1];
      const run = await api.failRun(id, body.error || 'Unknown error');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(run));
      return true;
    }

    // /api/workflow-runs/:id/step
    const stepMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/step$'));
    if (stepMatch && method === 'POST') {
      const id = stepMatch[1];
      const step = await api.updateStep(id, body.step_name, body.status || 'in_progress', body.output || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step));
      return true;
    }

    const escalateRunMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/escalate$'));
    if (escalateRunMatch && method === 'POST') {
      const id = escalateRunMatch[1];
      try {
        const run = await api.escalateRun(
          id,
          body.escalated_to || null,
          body.reason || '',
          body.actor || 'system'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const pauseRunMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/pause$'));
    if (pauseRunMatch && method === 'POST') {
      const id = pauseRunMatch[1];
      try {
        const run = await api.pauseRun(id, body.actor || 'system', body.reason || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const resumeRunMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/resume$'));
    if (resumeRunMatch && method === 'POST') {
      const id = resumeRunMatch[1];
      try {
        const run = await api.resumeRun(id, body.actor || 'system', body.note || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const reassignRunMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/reassign$'));
    if (reassignRunMatch && method === 'POST') {
      const id = reassignRunMatch[1];
      try {
        const run = await api.reassignRun(
          id,
          body.new_owner_agent_id || '',
          body.actor || 'system',
          body.reason || ''
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const cancelRunMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/cancel$'));
    if (cancelRunMatch && method === 'POST') {
      const id = cancelRunMatch[1];
      try {
        const run = await api.cancelRun(id, body.actor || 'system', body.reason || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const overrideFailureMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/override-failure$'));
    if (overrideFailureMatch && method === 'POST') {
      const id = overrideFailureMatch[1];
      try {
        const run = await api.overrideFailure(
          id,
          body.actor || 'system',
          body.note || '',
          body.next_status || 'queued'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const artifactsMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/artifacts$'));
    if (artifactsMatch && method === 'GET') {
      const runId = artifactsMatch[1];
      const artifacts = await api.listWorkflowArtifacts({ workflow_run_id: runId, limit: 500, offset: 0 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ artifacts }));
      return true;
    }

    if (artifactsMatch && method === 'POST') {
      const runId = artifactsMatch[1];
      try {
        const artifact = await api.createWorkflowArtifact(runId, body || {});
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(artifact));
      } catch (error) {
        const status = error.message.includes('not available yet') ? 503
          : error.message.includes('not found') ? 404
            : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/workflow-runs/:id/bind-session
    const bindSessionMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/bind-session$'));
    if (bindSessionMatch && method === 'POST') {
      const id = bindSessionMatch[1];
      try {
        const run = await api.bindSession(id, body.session_id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/workflow-runs/:id/unbind-session
    const unbindSessionMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/unbind-session$'));
    if (unbindSessionMatch && method === 'POST') {
      const id = unbindSessionMatch[1];
      try {
        const run = await api.unbindSession(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(run));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/sessions/active
    if (pathname === '/api/sessions/active' && method === 'GET') {
      const sessions = await api.getActiveSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return true;
    }

    // /api/sessions/:id/heartbeat
    const sessionHeartbeatMatch = pathname.match(new RegExp('^/api/sessions/([a-zA-Z0-9_-]+)/heartbeat$'));
    if (sessionHeartbeatMatch && method === 'POST') {
      const sessionId = sessionHeartbeatMatch[1];
      try {
        const runs = await api.recordSessionHeartbeat(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ updated_runs: runs.length, runs }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/workflow-runs/:id/approvals
    const approvalsMatch = pathname.match(new RegExp('^/api/workflow-runs/([a-f0-9-]+)/approvals$'));
    if (approvalsMatch && method === 'GET') {
      const runId = approvalsMatch[1];
      const approvals = await api.listApprovals(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approvals }));
      return true;
    }

    // /api/workflow-runs/:id/approvals (create)
    if (approvalsMatch && method === 'POST') {
      const runId = approvalsMatch[1];
      try {
        const approval = await api.createApproval(
          runId,
          body.step_name,
          body.approver_id,
          body.requested_by || 'system',
          body.metadata || {},
          {
            approval_type: body.approval_type,
            artifact_id: body.artifact_id,
            due_at: body.due_at,
            expires_at: body.expires_at,
            required_note: body.required_note
          }
        );
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(approval));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/approvals/:id (update decision)
    const approvalIdMatch = pathname.match(new RegExp('^/api/approvals/([a-f0-9-]+)$'));
    if (approvalIdMatch && (method === 'PATCH' || method === 'POST')) {
      const id = approvalIdMatch[1];
      try {
        const approvalLookup = await api.pool.query(`
          SELECT approver_id
          FROM workflow_approvals
          WHERE id = $1
          LIMIT 1
        `, [id]);
        const decisionAction = body.decision === 'rejected' ? 'reject' : 'approve';
        await api.ensureGovernancePermission(decisionAction, body.decided_by || null, {
          approverId: approvalLookup.rows[0]?.approver_id || null
        });
        const approval = await api.updateApproval(id, body.decision, body.notes || '', body.decided_by || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(approval));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    const approvalEscalateMatch = pathname.match(new RegExp('^/api/approvals/([a-f0-9-]+)/escalate$'));
    if (approvalEscalateMatch && method === 'POST') {
      const id = approvalEscalateMatch[1];
      try {
        await api.ensureGovernancePermission('escalate_approval', body.actor || 'system');
        const approval = await api.escalateApproval(
          id,
          body.escalated_to || null,
          body.reason || '',
          body.actor || 'system'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(approval));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return true;
    }

    // /api/approvals/pending (list pending for approver)
    if (pathname === '/api/approvals/pending' && method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const approverId = url.searchParams.get('approver_id');
      const approvals = await api.getPendingApprovals(approverId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ approvals }));
      return true;
    }

        // /api/workflow-templates
    if (pathname === '/api/workflow-templates') {
      if (method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const category = url.searchParams.get('category');
        const templates = await api.listTemplates(category);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ templates }));
        return true;
      }
    }

    // /api/workflow-templates/:name
    const templateMatch = pathname.match(new RegExp('^/api/workflow-templates/([a-z0-9-]+)$'));
    if (templateMatch && method === 'GET') {
      const name = templateMatch[1];
      const template = await api.getTemplate(name);
      if (!template) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Template not found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(template));
      }
      return true;
    }

    return false;
  };
}

module.exports = {
  WorkflowRunsAPI,
  createWorkflowRunsHandler
};
