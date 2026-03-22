#!/usr/bin/env node
/**
 * Organization API Module
 * Handles departments and agent profiles with a bootstrap fallback so the UI
 * can render explicit org metadata even before DB migrations are applied.
 */

const {
  DEPARTMENTS,
  AGENT_PROFILES,
  getDepartmentBySlug,
  getAgentProfileById
} = require('./org-bootstrap.js');
const { WorkflowRunsAPI } = require('./workflow-runs-api.js');

function normalizeMetadataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCapabilityList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch (_) {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function createEmptyQueueSummary() {
  return {
    total: 0,
    ready: 0,
    backlog: 0,
    inProgress: 0,
    blocked: 0,
    review: 0,
    completed: 0,
    overdue: 0
  };
}

function buildFallbackLiveAgent(agent) {
  return {
    id: agent.id,
    agentId: agent.id,
    name: agent.name,
    workspace: agent.workspace || null,
    default: Boolean(agent.default),
    defaultModel: agent.defaultModel || null,
    presence: 'offline',
    online: false,
    status: 'offline',
    lastSeenAt: null,
    stale: true,
    currentActivity: null,
    queueSummary: createEmptyQueueSummary(),
    runtime: {
      source: null,
      currentTaskId: null,
      currentTaskTitle: null,
      currentTaskStatus: null,
      currentActivity: null,
      queueReadyCount: 0,
      queueActiveCount: 0,
      lastSyncedAt: null
    },
    currentTask: null,
    nextTask: null,
    queue: []
  };
}

function normalizeDepartmentRow(row) {
  const metadata = normalizeMetadataObject(row?.metadata);
  const slug = row?.slug || metadata.slug || slugify(row?.name || row?.id || 'department');
  return {
    id: row?.id || slug,
    slug,
    name: row?.name || 'Unassigned',
    description: row?.description || '',
    color: row?.color || '#64748b',
    icon: row?.icon || 'folder',
    sortOrder: Number(row?.sort_order) || 0,
    metadata,
    source: row?.source || 'database'
  };
}

function normalizeProfileRow(row) {
  return {
    agentId: row?.agent_id || row?.agentId || '',
    departmentId: row?.department_id || row?.departmentId || null,
    departmentSlug: row?.department_slug || row?.departmentSlug || null,
    displayName: row?.display_name || row?.displayName || row?.agent_id || row?.agentId || 'Unknown agent',
    role: row?.role || null,
    modelPrimary: row?.model_primary || row?.modelPrimary || null,
    capabilities: normalizeCapabilityList(row?.capabilities),
    status: row?.status || 'active',
    workspacePath: row?.workspace_path || row?.workspacePath || null,
    metadata: normalizeMetadataObject(row?.metadata),
    lastHeartbeat: row?.last_heartbeat || row?.lastHeartbeat || null,
    source: row?.source || 'database'
  };
}

async function tableExists(pool, tableName) {
  if (!pool) return false;
  try {
    const result = await pool.query('SELECT to_regclass($1) AS table_ref', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.table_ref);
  } catch (_) {
    return false;
  }
}

async function listStoredDepartments(pool) {
  if (!(await tableExists(pool, 'departments'))) {
    return [];
  }
  try {
    const result = await pool.query(`
      SELECT id, name, description, color, icon, sort_order, metadata
      FROM departments
      WHERE COALESCE(is_active, true) = true
      ORDER BY sort_order, name
    `);
    return result.rows.map((row) => normalizeDepartmentRow({ ...row, source: 'database' }));
  } catch (error) {
    console.warn('[org-api] Failed to load departments from database:', error.message);
    return [];
  }
}

async function listStoredAgentProfiles(pool) {
  if (!(await tableExists(pool, 'agent_profiles'))) {
    return [];
  }
  try {
    const result = await pool.query(`
      SELECT agent_id, department_id, display_name, role, model_primary, capabilities,
             status, workspace_path, metadata, last_heartbeat
      FROM agent_profiles
      WHERE COALESCE(status, 'active') != 'deprecated'
      ORDER BY display_name, agent_id
    `);
    return result.rows.map((row) => normalizeProfileRow({ ...row, source: 'database' }));
  } catch (error) {
    console.warn('[org-api] Failed to load agent profiles from database:', error.message);
    return [];
  }
}

async function listAvailableDepartments(context) {
  const { asanaStorage, pool } = context;
  if (asanaStorage && typeof asanaStorage.listDepartments === 'function') {
    try {
      return await asanaStorage.listDepartments();
    } catch (error) {
      console.warn('[org-api] Failed to load departments via storage layer:', error.message);
    }
  }
  return listStoredDepartments(pool);
}

async function listAvailableAgentProfiles(context, configuredAgents) {
  const { asanaStorage, pool } = context;
  if (asanaStorage && typeof asanaStorage.listAgentProfiles === 'function') {
    try {
      return await asanaStorage.listAgentProfiles(configuredAgents);
    } catch (error) {
      console.warn('[org-api] Failed to load agent profiles via storage layer:', error.message);
    }
  }
  return listStoredAgentProfiles(pool);
}

function buildDepartmentDirectory(storedDepartments = []) {
  const byId = new Map();
  const bySlug = new Map();
  const items = [];

  const register = (department) => {
    if (!department || bySlug.has(department.slug)) return;
    items.push(department);
    bySlug.set(department.slug, department);
    byId.set(department.id, department);
  };

  storedDepartments.forEach(register);
  DEPARTMENTS.forEach((department) => {
    register(normalizeDepartmentRow({
      ...department,
      id: department.slug,
      sort_order: department.sortOrder,
      metadata: {},
      source: 'bootstrap'
    }));
  });

  items.sort((left, right) => {
    const sortDelta = (left.sortOrder || 0) - (right.sortOrder || 0);
    if (sortDelta !== 0) return sortDelta;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  return { items, byId, bySlug };
}

function buildProfileDirectory(storedProfiles = []) {
  const byAgentId = new Map();
  storedProfiles.forEach((profile) => {
    if (profile.agentId) byAgentId.set(profile.agentId, profile);
  });
  return byAgentId;
}

function resolveDepartment(profile, departmentDirectory) {
  if (!profile) return null;
  if (profile.departmentId && departmentDirectory.byId.has(profile.departmentId)) {
    return departmentDirectory.byId.get(profile.departmentId);
  }
  if (profile.departmentSlug && departmentDirectory.bySlug.has(profile.departmentSlug)) {
    return departmentDirectory.bySlug.get(profile.departmentSlug);
  }
  const metadataSlug = profile.metadata?.department_slug;
  if (typeof metadataSlug === 'string' && departmentDirectory.bySlug.has(metadataSlug)) {
    return departmentDirectory.bySlug.get(metadataSlug);
  }
  return null;
}

function deriveLiveSummary(agents = []) {
  return agents.reduce((summary, agent) => {
    summary.totalAgents += 1;
    summary.readyTasks += Number(agent.queueSummary?.ready) || 0;
    summary.activeTasks += Number(agent.queueSummary?.inProgress) || 0;
    summary.blockedTasks += Number(agent.queueSummary?.blocked) || 0;
    summary.overdueTasks += Number(agent.queueSummary?.overdue) || 0;

    if (agent.presence === 'working') summary.working += 1;
    if (agent.presence === 'queued') summary.queued += 1;
    if (agent.presence === 'idle') summary.idle += 1;
    if (agent.online) summary.online += 1;
    if (agent.presence === 'offline') summary.offline += 1;

    return summary;
  }, {
    totalAgents: 0,
    online: 0,
    working: 0,
    queued: 0,
    idle: 0,
    offline: 0,
    readyTasks: 0,
    activeTasks: 0,
    blockedTasks: 0,
    overdueTasks: 0
  });
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chooseDepartmentLead(department, agents = []) {
  if (!Array.isArray(agents) || !agents.length) return null;

  const preferredLeadId = department?.metadata?.lead_agent_id || department?.metadata?.leadAgentId || null;
  if (preferredLeadId) {
    const preferred = agents.find((agent) => agent.agentId === preferredLeadId || agent.id === preferredLeadId);
    if (preferred) {
      return {
        agentId: preferred.agentId || preferred.id,
        name: preferred.displayName || preferred.name || preferred.agentId || preferred.id,
        role: preferred.role || null,
        presence: preferred.presence || 'offline'
      };
    }
  }

  const rankRole = (role) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized.includes('lead')) return 0;
    if (normalized.includes('manager')) return 1;
    if (normalized.includes('director')) return 2;
    if (normalized.includes('orchestrator')) return 3;
    return 9;
  };
  const rankPresence = (presence) => {
    switch (presence) {
      case 'working':
        return 0;
      case 'queued':
        return 1;
      case 'idle':
        return 2;
      default:
        return 3;
    }
  };

  const lead = agents
    .slice()
    .sort((left, right) => {
      const roleDelta = rankRole(left.role) - rankRole(right.role);
      if (roleDelta !== 0) return roleDelta;
      const presenceDelta = rankPresence(left.presence) - rankPresence(right.presence);
      if (presenceDelta !== 0) return presenceDelta;
      return String(left.displayName || left.name || left.agentId || left.id)
        .localeCompare(String(right.displayName || right.name || right.agentId || right.id), undefined, { sensitivity: 'base' });
    })[0];

  return lead
    ? {
      agentId: lead.agentId || lead.id,
      name: lead.displayName || lead.name || lead.agentId || lead.id,
      role: lead.role || null,
      presence: lead.presence || 'offline'
    }
    : null;
}

function buildDepartmentOverviewAgent(agent) {
  return {
    agentId: agent.agentId || agent.id,
    name: agent.displayName || agent.name || agent.agentId || agent.id,
    role: agent.role || null,
    presence: agent.presence || 'offline',
    readyTasks: Number(agent.queueSummary?.ready) || 0,
    activeTasks: Number(agent.queueSummary?.inProgress) || 0,
    blockedTasks: Number(agent.queueSummary?.blocked) || 0,
    overdueTasks: Number(agent.queueSummary?.overdue) || 0
  };
}

function createEmptyDepartmentOperatingView(department, agents = []) {
  const staffedAgents = agents.map((agent) => buildDepartmentOverviewAgent(agent));
  return {
    department,
    overview: {
      lead: chooseDepartmentLead(department, agents),
      staffedAgents,
      staffedCount: staffedAgents.length,
      serviceLines: [],
      currentWorkload: {
        openServiceRequests: 0,
        activeRuns: 0,
        blockedWork: 0,
        overdueItems: 0
      }
    },
    workQueue: {
      openServiceRequests: [],
      activeRuns: [],
      blockedWork: [],
      overdueItems: []
    },
    blockerSummary: {
      total: 0,
      workflowRuns: 0,
      tasks: 0,
      escalated: 0,
      byType: [],
      byDepartment: []
    },
    approvals: {
      pending: 0,
      expired: 0,
      averageDecisionHours: null,
      items: []
    },
    artifacts: {
      recentOutputs: [],
      failedOutputs: [],
      verificationReports: []
    },
    reliability: {
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      successRate: null,
      retryRate: null,
      staleRunCount: 0,
      failureReasons: []
    }
  };
}

async function safeQuery(pool, queryText, values = [], fallback = []) {
  if (!pool || typeof pool.query !== 'function') return fallback;
  try {
    const result = await pool.query(queryText, values);
    return Array.isArray(result?.rows) ? result.rows : fallback;
  } catch (error) {
    console.warn('[org-api] Query failed:', error.message);
    return fallback;
  }
}

function mapServiceLineRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    defaultAgentId: row.default_agent_id || null,
    workflowTemplateName: row.workflow_template_name || null,
    slaHours: toNumber(row.sla_hours, 72),
    activeRequestCount: toNumber(row.active_request_count),
    runningRunCount: toNumber(row.running_run_count)
  };
}

function mapDepartmentRequestRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    requestedBy: row.requested_by || null,
    targetAgentId: row.target_agent_id || null,
    serviceName: row.service_name || null,
    workflowRunId: row.workflow_run_id || null,
    workflowRunStatus: row.workflow_run_status || null,
    updatedAt: row.updated_at || row.created_at || null
  };
}

function mapDepartmentRunRow(row) {
  return {
    id: row.id,
    workflowType: row.workflow_type,
    status: row.status,
    currentStep: row.current_step || null,
    ownerAgentId: row.owner_agent_id || null,
    retryCount: toNumber(row.retry_count),
    runPriority: row.run_priority || null,
    taskTitle: row.task_title || null,
    boardName: row.board_name || null,
    serviceRequestTitle: row.service_request_title || null,
    updatedAt: row.updated_at || row.created_at || null
  };
}

function mapOverdueItemRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    ownerAgentId: row.owner || null,
    projectName: row.project_name || null,
    dueDate: row.due_date || null
  };
}

function mapDepartmentApprovalRow(row) {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    workflowType: row.workflow_type || null,
    stepName: row.step_name || null,
    approvalType: row.approval_type || 'step_gate',
    approverId: row.approver_id || null,
    status: row.status,
    requestedBy: row.requested_by || null,
    requestedAt: row.requested_at || null,
    dueAt: row.due_at || null,
    expiresAt: row.expires_at || null,
    taskTitle: row.task_title || null,
    escalatedTo: row.escalated_to || null
  };
}

function mapDepartmentArtifactRow(row) {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    workflowType: row.workflow_type || null,
    artifactType: row.artifact_type || 'output',
    label: row.label || 'Untitled artifact',
    status: row.status || 'generated',
    uri: row.uri || null,
    createdBy: row.created_by || null,
    taskTitle: row.task_title || null,
    createdAt: row.created_at || null
  };
}

async function buildDepartmentOperatingView(context, departmentIdentifier, queueLimit = 5) {
  const orgState = await buildOrgState(context, queueLimit);
  const department = orgState.departments.find((item) =>
    item.id === departmentIdentifier || item.slug === departmentIdentifier
  );

  if (!department) {
    return null;
  }

  const departmentAgents = orgState.agents.filter((agent) =>
    agent.department?.id === department.id || agent.department?.slug === department.slug
  );
  const payload = createEmptyDepartmentOperatingView(department, departmentAgents);
  const pool = context.asanaStorage?.pool || context.pool || null;

  if (!pool || department.slug === 'unassigned') {
    return payload;
  }

  const [
    hasServiceCatalog,
    hasServiceRequests,
    hasWorkflowRuns,
    hasWorkflowApprovals,
    hasWorkflowArtifacts,
    hasTasks
  ] = await Promise.all([
    tableExists(pool, 'service_catalog'),
    tableExists(pool, 'service_requests'),
    tableExists(pool, 'workflow_runs'),
    tableExists(pool, 'workflow_approvals'),
    tableExists(pool, 'workflow_artifacts'),
    tableExists(pool, 'tasks')
  ]);

  if (hasServiceCatalog) {
    const serviceLineRows = await safeQuery(pool, `
      SELECT
        sc.id,
        sc.name,
        sc.slug,
        sc.description,
        sc.default_agent_id,
        COALESCE(sc.metadata->>'workflow_template_name', wt.name) AS workflow_template_name,
        sc.sla_hours,
        COUNT(DISTINCT sr.id) FILTER (
          WHERE sr.status NOT IN ('completed', 'failed', 'cancelled')
        )::integer AS active_request_count,
        COUNT(DISTINCT wr.id) FILTER (
          WHERE wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying')
        )::integer AS running_run_count
      FROM service_catalog sc
      LEFT JOIN workflow_templates wt ON wt.id = sc.workflow_template_id
      LEFT JOIN service_requests sr ON sr.service_id = sc.id
      LEFT JOIN workflow_runs wr ON wr.service_request_id = sr.id
      WHERE sc.department_id = $1
        AND COALESCE(sc.is_active, true) = true
      GROUP BY sc.id, sc.name, sc.slug, sc.description, sc.default_agent_id, workflow_template_name, sc.sla_hours
      ORDER BY sc.sort_order, sc.name
    `, [department.id]);
    payload.overview.serviceLines = serviceLineRows.map((row) => mapServiceLineRow(row));
  }

  if (hasServiceRequests) {
    const openRequestRows = await safeQuery(pool, `
      SELECT
        sr.id,
        sr.title,
        sr.status,
        sr.priority,
        sr.requested_by,
        sr.target_agent_id,
        sr.updated_at,
        sr.created_at,
        sc.name AS service_name,
        wr.id AS workflow_run_id,
        wr.status AS workflow_run_status
      FROM service_requests sr
      LEFT JOIN service_catalog sc ON sc.id = sr.service_id
      LEFT JOIN workflow_runs wr ON wr.service_request_id = sr.id
      WHERE COALESCE(sr.target_department_id, sc.department_id) = $1
        AND sr.status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY sr.updated_at DESC, sr.created_at DESC
      LIMIT 12
    `, [department.id]);
    const requestCountRows = await safeQuery(pool, `
      SELECT COUNT(*)::integer AS count
      FROM service_requests sr
      LEFT JOIN service_catalog sc ON sc.id = sr.service_id
      WHERE COALESCE(sr.target_department_id, sc.department_id) = $1
        AND sr.status NOT IN ('completed', 'failed', 'cancelled')
    `, [department.id]);
    payload.workQueue.openServiceRequests = openRequestRows.map((row) => mapDepartmentRequestRow(row));
    payload.overview.currentWorkload.openServiceRequests = toNumber(requestCountRows[0]?.count);
  }

  if (hasWorkflowRuns) {
    const activeRunRows = await safeQuery(pool, `
      SELECT
        wr.id,
        wr.workflow_type,
        wr.status,
        wr.current_step,
        wr.owner_agent_id,
        wr.retry_count,
        wr.run_priority,
        wr.updated_at,
        wr.created_at,
        t.title AS task_title,
        p.name AS board_name,
        sr.title AS service_request_title
      FROM workflow_runs wr
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN projects p ON wr.board_id = p.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying')
      ORDER BY wr.updated_at DESC, wr.created_at DESC
      LIMIT 12
    `, [department.id]);
    const activeRunCountRows = await safeQuery(pool, `
      SELECT COUNT(*)::integer AS count
      FROM workflow_runs wr
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying')
    `, [department.id]);
    payload.workQueue.activeRuns = activeRunRows.map((row) => mapDepartmentRunRow(row));
    payload.overview.currentWorkload.activeRuns = toNumber(activeRunCountRows[0]?.count);
  }

  if (hasTasks) {
    const overdueRows = await safeQuery(pool, `
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.owner,
        t.due_date,
        p.name AS project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN agent_profiles ap ON ap.agent_id = t.owner
      LEFT JOIN service_requests sr ON sr.task_id = t.id
      LEFT JOIN service_catalog sc ON sc.id = sr.service_id
      WHERE t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND t.status NOT IN ('completed', 'archived')
        AND t.due_date IS NOT NULL
        AND t.due_date < NOW()
        AND COALESCE(ap.department_id, sr.target_department_id, sc.department_id) = $1
      ORDER BY t.due_date ASC
      LIMIT 12
    `, [department.id]);
    const overdueCountRows = await safeQuery(pool, `
      SELECT COUNT(*)::integer AS count
      FROM tasks t
      LEFT JOIN agent_profiles ap ON ap.agent_id = t.owner
      LEFT JOIN service_requests sr ON sr.task_id = t.id
      LEFT JOIN service_catalog sc ON sc.id = sr.service_id
      WHERE t.deleted_at IS NULL
        AND t.archived_at IS NULL
        AND t.status NOT IN ('completed', 'archived')
        AND t.due_date IS NOT NULL
        AND t.due_date < NOW()
        AND COALESCE(ap.department_id, sr.target_department_id, sc.department_id) = $1
    `, [department.id]);
    payload.workQueue.overdueItems = overdueRows.map((row) => mapOverdueItemRow(row));
    payload.overview.currentWorkload.overdueItems = toNumber(overdueCountRows[0]?.count);
  }

  if (hasWorkflowRuns) {
    const blockerAPI = new WorkflowRunsAPI(pool);
    const [blockedWork, blockerSummary] = await Promise.all([
      blockerAPI.listBlockers({ department_id: department.id, limit: 50 }),
      blockerAPI.getBlockerSummary({ department_id: department.id, limit: 200 })
    ]);
    payload.workQueue.blockedWork = blockedWork;
    payload.blockerSummary = blockerSummary;
    payload.overview.currentWorkload.blockedWork = toNumber(blockerSummary.total);
    payload.reliability.staleRunCount = blockedWork.filter((item) =>
      item.entityType === 'workflow_run' && ['no_heartbeat', 'stale_step', 'active_task_no_session'].includes(item.blockerType)
    ).length;
  }

  if (hasWorkflowApprovals) {
    const approvalRows = await safeQuery(pool, `
      SELECT
        a.id,
        a.workflow_run_id,
        a.step_name,
        a.approval_type,
        a.approver_id,
        a.status,
        a.requested_by,
        a.requested_at,
        a.due_at,
        a.expires_at,
        a.escalated_to,
        wr.workflow_type,
        t.title AS task_title
      FROM workflow_approvals a
      JOIN workflow_runs wr ON wr.id = a.workflow_run_id
      LEFT JOIN tasks t ON wr.task_id = t.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND a.status = 'pending'
      ORDER BY COALESCE(a.due_at, a.expires_at, a.requested_at) ASC, a.created_at DESC
      LIMIT 12
    `, [department.id]);
    const approvalSummaryRows = await safeQuery(pool, `
      SELECT
        COUNT(*) FILTER (
          WHERE a.status = 'pending'
        )::integer AS pending_count,
        COUNT(*) FILTER (
          WHERE a.status = 'pending' AND a.expires_at IS NOT NULL AND a.expires_at < NOW()
        )::integer AS expired_count,
        AVG(EXTRACT(EPOCH FROM (a.decided_at - a.requested_at)) / 3600.0)
          FILTER (WHERE a.decided_at IS NOT NULL AND a.status IN ('approved', 'rejected', 'cancelled')) AS avg_decision_hours
      FROM workflow_approvals a
      JOIN workflow_runs wr ON wr.id = a.workflow_run_id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
    `, [department.id]);
    payload.approvals.items = approvalRows.map((row) => mapDepartmentApprovalRow(row));
    payload.approvals.pending = toNumber(approvalSummaryRows[0]?.pending_count);
    payload.approvals.expired = toNumber(approvalSummaryRows[0]?.expired_count);
    payload.approvals.averageDecisionHours = approvalSummaryRows[0]?.avg_decision_hours === null || approvalSummaryRows[0]?.avg_decision_hours === undefined
      ? null
      : Number(approvalSummaryRows[0].avg_decision_hours);
  }

  if (hasWorkflowArtifacts) {
    const recentArtifactRows = await safeQuery(pool, `
      SELECT
        wa.id,
        wa.workflow_run_id,
        wa.artifact_type,
        wa.label,
        wa.status,
        wa.uri,
        wa.created_by,
        wa.created_at,
        wr.workflow_type,
        t.title AS task_title
      FROM workflow_artifacts wa
      JOIN workflow_runs wr ON wr.id = wa.workflow_run_id
      LEFT JOIN tasks t ON COALESCE(wa.task_id, wr.task_id) = t.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
      ORDER BY wa.created_at DESC
      LIMIT 12
    `, [department.id]);
    const failedArtifactRows = await safeQuery(pool, `
      SELECT
        wa.id,
        wa.workflow_run_id,
        wa.artifact_type,
        wa.label,
        wa.status,
        wa.uri,
        wa.created_by,
        wa.created_at,
        wr.workflow_type,
        t.title AS task_title
      FROM workflow_artifacts wa
      JOIN workflow_runs wr ON wr.id = wa.workflow_run_id
      LEFT JOIN tasks t ON COALESCE(wa.task_id, wr.task_id) = t.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND wa.status = 'rejected'
      ORDER BY wa.created_at DESC
      LIMIT 12
    `, [department.id]);
    const verificationRows = await safeQuery(pool, `
      SELECT
        wa.id,
        wa.workflow_run_id,
        wa.artifact_type,
        wa.label,
        wa.status,
        wa.uri,
        wa.created_by,
        wa.created_at,
        wr.workflow_type,
        t.title AS task_title
      FROM workflow_artifacts wa
      JOIN workflow_runs wr ON wr.id = wa.workflow_run_id
      LEFT JOIN tasks t ON COALESCE(wa.task_id, wr.task_id) = t.id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND (
          wa.artifact_type IN ('verification', 'verification_report', 'publish_verification')
          OR wa.label ILIKE '%verification%'
          OR COALESCE(wa.metadata->>'report_type', '') = 'verification'
        )
      ORDER BY wa.created_at DESC
      LIMIT 12
    `, [department.id]);
    payload.artifacts.recentOutputs = recentArtifactRows.map((row) => mapDepartmentArtifactRow(row));
    payload.artifacts.failedOutputs = failedArtifactRows.map((row) => mapDepartmentArtifactRow(row));
    payload.artifacts.verificationReports = verificationRows.map((row) => mapDepartmentArtifactRow(row));
  }

  if (hasWorkflowRuns) {
    const reliabilityRows = await safeQuery(pool, `
      SELECT
        COUNT(*)::integer AS total_runs,
        COUNT(*) FILTER (WHERE wr.status = 'completed')::integer AS completed_runs,
        COUNT(*) FILTER (WHERE wr.status = 'failed')::integer AS failed_runs,
        COUNT(*) FILTER (WHERE COALESCE(wr.retry_count, 0) > 0)::integer AS retried_runs
      FROM workflow_runs wr
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
    `, [department.id]);
    const failureReasonRows = await safeQuery(pool, `
      SELECT
        COALESCE(
          NULLIF(wr.blocker_type, ''),
          NULLIF(split_part(wr.last_error, E'\\n', 1), ''),
          'unknown'
        ) AS reason,
        COUNT(*)::integer AS count
      FROM workflow_runs wr
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) = $1
        AND (
          wr.status = 'failed'
          OR wr.last_error IS NOT NULL
          OR wr.blocker_type IS NOT NULL
        )
      GROUP BY reason
      ORDER BY count DESC, reason ASC
      LIMIT 5
    `, [department.id]);

    const totalRuns = toNumber(reliabilityRows[0]?.total_runs);
    const completedRuns = toNumber(reliabilityRows[0]?.completed_runs);
    const failedRuns = toNumber(reliabilityRows[0]?.failed_runs);
    const retriedRuns = toNumber(reliabilityRows[0]?.retried_runs);
    const terminalRuns = completedRuns + failedRuns;

    payload.reliability.totalRuns = totalRuns;
    payload.reliability.completedRuns = completedRuns;
    payload.reliability.failedRuns = failedRuns;
    payload.reliability.successRate = terminalRuns > 0
      ? (completedRuns / terminalRuns) * 100
      : null;
    payload.reliability.retryRate = totalRuns > 0
      ? (retriedRuns / totalRuns) * 100
      : null;
    payload.reliability.failureReasons = failureReasonRows.map((row) => ({
      reason: row.reason,
      count: toNumber(row.count)
    }));
  }

  return payload;
}

async function buildOrgState(context, queueLimit = 5) {
  const {
    buildConfiguredAgentsCatalog,
    buildAgentsOverviewPayload
  } = context;

  const configuredAgents = typeof buildConfiguredAgentsCatalog === 'function'
    ? buildConfiguredAgentsCatalog()
    : [];

  let liveOverview = { generatedAt: new Date().toISOString(), summary: null, agents: configuredAgents.map(buildFallbackLiveAgent) };
  if (typeof buildAgentsOverviewPayload === 'function') {
    try {
      liveOverview = await buildAgentsOverviewPayload(queueLimit);
    } catch (error) {
      console.warn('[org-api] Falling back to bootstrap live overview:', error.message);
    }
  }

  const liveById = new Map(
    (Array.isArray(liveOverview?.agents) ? liveOverview.agents : []).map((agent) => [agent.id, agent])
  );

  const [storedDepartments, storedProfiles] = await Promise.all([
    listAvailableDepartments(context),
    listAvailableAgentProfiles(context, configuredAgents)
  ]);

  const departmentDirectory = buildDepartmentDirectory(storedDepartments);
  const profileDirectory = buildProfileDirectory(storedProfiles);
  const configuredById = new Map(configuredAgents.map((agent) => [agent.id, agent]));
  const agentIds = new Set([
    ...configuredAgents.map((agent) => agent.id),
    ...Array.from(liveById.keys()),
    ...Array.from(profileDirectory.keys())
  ]);

  const agents = Array.from(agentIds)
    .sort((left, right) => {
      const leftIndex = configuredAgents.findIndex((agent) => agent.id === left);
      const rightIndex = configuredAgents.findIndex((agent) => agent.id === right);
      if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
      if (leftIndex >= 0) return -1;
      if (rightIndex >= 0) return 1;
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    })
    .map((agentId) => {
      const configuredAgent = configuredById.get(agentId) || {
        id: agentId,
        name: agentId,
        workspace: null,
        default: false,
        defaultModel: null
      };
      const liveAgent = liveById.get(agentId) || buildFallbackLiveAgent(configuredAgent);
      const storedProfile = profileDirectory.get(agentId) || null;
      const bootstrapProfile = getAgentProfileById(agentId);
      const profile = storedProfile || normalizeProfileRow(bootstrapProfile
        ? {
          ...bootstrapProfile,
          departmentSlug: bootstrapProfile.departmentSlug,
          source: 'bootstrap'
        }
        : {
          agentId,
          displayName: configuredAgent.name || liveAgent.name || agentId,
          departmentSlug: null,
          source: 'derived'
        });
      const department = resolveDepartment(profile, departmentDirectory)
        || (bootstrapProfile ? getDepartmentBySlug(bootstrapProfile.departmentSlug) : null)
        || null;
      const normalizedDepartment = department
        ? normalizeDepartmentRow({
          ...department,
          id: department.id || department.slug,
          sort_order: department.sortOrder,
          source: department.source || 'bootstrap'
        })
        : normalizeDepartmentRow({
          id: 'unassigned',
          slug: 'unassigned',
          name: 'Unassigned',
          description: 'Configured agents without explicit org metadata yet.',
          color: '#64748b',
          icon: 'folder',
          sort_order: 999,
          metadata: {},
          source: 'derived'
        });

      return {
        ...liveAgent,
        id: agentId,
        agentId,
        name: liveAgent.name || configuredAgent.name || profile.displayName,
        displayName: profile.displayName || liveAgent.name || configuredAgent.name || agentId,
        workspace: liveAgent.workspace || profile.workspacePath || configuredAgent.workspace || null,
        default: Boolean(liveAgent.default ?? configuredAgent.default),
        defaultModel: liveAgent.defaultModel || configuredAgent.defaultModel || profile.modelPrimary || null,
        modelPrimary: profile.modelPrimary || liveAgent.defaultModel || configuredAgent.defaultModel || null,
        role: profile.role || null,
        capabilities: normalizeCapabilityList(profile.capabilities),
        metadata: normalizeMetadataObject(profile.metadata),
        profileStatus: profile.status || 'active',
        department: normalizedDepartment,
        departmentId: normalizedDepartment.id,
        departmentSlug: normalizedDepartment.slug,
        departmentName: normalizedDepartment.name,
        departmentColor: normalizedDepartment.color
      };
    });

  const byRoleMap = new Map();
  const departmentMap = new Map();

  departmentDirectory.items.forEach((department) => {
    departmentMap.set(department.slug, {
      ...department,
      agentCount: 0,
      onlineCount: 0,
      workingCount: 0,
      readyTasks: 0,
      blockedTasks: 0
    });
  });

  agents.forEach((agent) => {
    const role = agent.role || 'unassigned';
    byRoleMap.set(role, (byRoleMap.get(role) || 0) + 1);

    const department = agent.department || normalizeDepartmentRow({
      id: 'unassigned',
      slug: 'unassigned',
      name: 'Unassigned',
      description: 'Configured agents without explicit org metadata yet.',
      color: '#64748b',
      icon: 'folder',
      sort_order: 999,
      metadata: {},
      source: 'derived'
    });

    if (!departmentMap.has(department.slug)) {
      departmentMap.set(department.slug, {
        ...department,
        agentCount: 0,
        onlineCount: 0,
        workingCount: 0,
        readyTasks: 0,
        blockedTasks: 0
      });
    }

    const departmentSummary = departmentMap.get(department.slug);
    departmentSummary.agentCount += 1;
    departmentSummary.onlineCount += agent.online ? 1 : 0;
    departmentSummary.workingCount += agent.presence === 'working' ? 1 : 0;
    departmentSummary.readyTasks += Number(agent.queueSummary?.ready) || 0;
    departmentSummary.blockedTasks += Number(agent.queueSummary?.blocked) || 0;
  });

  const departments = Array.from(departmentMap.values()).sort((left, right) => {
    const sortDelta = (left.sortOrder || 0) - (right.sortOrder || 0);
    if (sortDelta !== 0) return sortDelta;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  const byRole = Array.from(byRoleMap.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role));

  return {
    generatedAt: liveOverview?.generatedAt || new Date().toISOString(),
    agents,
    departments,
    liveSummary: liveOverview?.summary || deriveLiveSummary(agents),
    byRole
  };
}

async function updateDepartmentRecord(pool, id, data) {
  const allowedFields = ['name', 'description', 'color', 'icon', 'sort_order', 'is_active', 'metadata'];
  const updates = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(typeof data[field] === 'object' ? JSON.stringify(data[field]) : data[field]);
      paramIndex += 1;
    }
  }

  if (!updates.length) {
    return { status: 400, body: { error: 'No valid fields to update' } };
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const result = await pool.query(`
    UPDATE departments
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, description, color, icon, sort_order, metadata
  `, values);

  if (!result.rows.length) {
    return { status: 404, body: { error: 'Department not found' } };
  }

  return { status: 200, body: normalizeDepartmentRow(result.rows[0]) };
}

async function updateAgentProfileRecord(pool, agentId, data) {
  const allowedFields = ['display_name', 'role', 'department_id', 'workspace_path', 'status', 'metadata'];
  const updates = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(typeof data[field] === 'object' ? JSON.stringify(data[field]) : data[field]);
      paramIndex += 1;
    }
  }

  if (data.capabilities !== undefined) {
    updates.push(`capabilities = $${paramIndex}`);
    values.push(JSON.stringify(normalizeCapabilityList(data.capabilities)));
    paramIndex += 1;
  }

  if (!updates.length) {
    return { status: 400, body: { error: 'No valid fields to update' } };
  }

  updates.push('updated_at = NOW()');
  values.push(agentId);

  const result = await pool.query(`
    UPDATE agent_profiles
    SET ${updates.join(', ')}
    WHERE agent_id = $${paramIndex}
    RETURNING agent_id, department_id, display_name, role, model_primary, capabilities,
              status, workspace_path, metadata, last_heartbeat
  `, values);

  if (!result.rows.length) {
    return { status: 404, body: { error: 'Agent profile not found' } };
  }

  return { status: 200, body: normalizeProfileRow(result.rows[0]) };
}

async function orgAPI(req, res, url, method, requestBody, context) {
  const { asanaStorage, pool, sendJSON, parseJSONBody } = context;

  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const queueLimit = Math.max(1, Math.min(25, Number.parseInt(requestUrl.searchParams.get('queue_limit') || '5', 10) || 5));

    if (url === '/api/org/departments' && method === 'GET') {
      const orgState = await buildOrgState(context, queueLimit);
      sendJSON(res, 200, orgState.departments);
      return true;
    }

    const deptOperatingMatch = url.match(/^\/api\/org\/departments\/([^/]+)\/operating-view$/);
    if (deptOperatingMatch && method === 'GET') {
      const deptId = decodeURIComponent(deptOperatingMatch[1]);
      const operatingView = await buildDepartmentOperatingView(context, deptId, queueLimit);
      if (!operatingView) {
        sendJSON(res, 404, { error: 'Department not found' });
        return true;
      }
      sendJSON(res, 200, operatingView);
      return true;
    }

    const deptMatch = url.match(/^\/api\/org\/departments\/([^/]+)$/);
    if (deptMatch && method === 'GET') {
      const deptId = decodeURIComponent(deptMatch[1]);
      const orgState = await buildOrgState(context, queueLimit);
      const department = orgState.departments.find((item) =>
        item.id === deptId || item.slug === deptId
      );
      if (!department) {
        sendJSON(res, 404, { error: 'Department not found' });
        return true;
      }
      sendJSON(res, 200, {
        ...department,
        agents: orgState.agents.filter((agent) => agent.department?.slug === department.slug)
      });
      return true;
    }

    if (url === '/api/org/departments' && method === 'POST') {
      const data = requestBody ?? await parseJSONBody(req);
      if (!data?.name) {
        sendJSON(res, 400, { error: 'Missing required field: name' });
        return true;
      }
      if (asanaStorage && typeof asanaStorage.createDepartment === 'function') {
        try {
          const department = await asanaStorage.createDepartment(data);
          sendJSON(res, 201, normalizeDepartmentRow(department));
          return true;
        } catch (error) {
          const message = error.message || 'Failed to create department';
          const status = message.includes('not available yet') ? 503 : 400;
          sendJSON(res, status, { error: message });
          return true;
        }
      }
      if (!(await tableExists(pool, 'departments'))) {
        sendJSON(res, 503, { error: 'Departments table is not available yet' });
        return true;
      }
      const result = await pool.query(`
        INSERT INTO departments (name, description, color, icon, sort_order, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, description, color, icon, sort_order, metadata
      `, [
        data.name,
        data.description || '',
        data.color || '#64748b',
        data.icon || 'folder',
        Number.parseInt(data.sort_order, 10) || 0,
        JSON.stringify(normalizeMetadataObject(data.metadata))
      ]);
      sendJSON(res, 201, normalizeDepartmentRow(result.rows[0]));
      return true;
    }

    if (deptMatch && method === 'PATCH') {
      const data = requestBody ?? await parseJSONBody(req);
      if (asanaStorage && typeof asanaStorage.updateDepartment === 'function') {
        try {
          const department = await asanaStorage.updateDepartment(decodeURIComponent(deptMatch[1]), data);
          sendJSON(res, 200, normalizeDepartmentRow(department));
          return true;
        } catch (error) {
          const message = error.message || 'Failed to update department';
          const status = message.includes('No valid fields') ? 400
            : message.includes('not found') ? 404
              : message.includes('not available yet') ? 503
                : 500;
          sendJSON(res, status, { error: message });
          return true;
        }
      }
      if (!(await tableExists(pool, 'departments'))) {
        sendJSON(res, 503, { error: 'Departments table is not available yet' });
        return true;
      }
      const result = await updateDepartmentRecord(pool, decodeURIComponent(deptMatch[1]), data);
      sendJSON(res, result.status, result.body);
      return true;
    }

    if (url === '/api/org/agents' && method === 'GET') {
      const orgState = await buildOrgState(context, queueLimit);
      sendJSON(res, 200, orgState.agents);
      return true;
    }

    const agentMatch = url.match(/^\/api\/org\/agents\/([^/]+)$/);
    if (agentMatch && method === 'GET') {
      const agentId = decodeURIComponent(agentMatch[1]);
      const orgState = await buildOrgState(context, queueLimit);
      const agent = orgState.agents.find((item) => item.agentId === agentId || item.id === agentId);
      if (!agent) {
        sendJSON(res, 404, { error: 'Agent profile not found' });
        return true;
      }
      sendJSON(res, 200, agent);
      return true;
    }

    if (agentMatch && method === 'PATCH') {
      const data = requestBody ?? await parseJSONBody(req);
      if (asanaStorage && typeof asanaStorage.updateAgentProfile === 'function') {
        try {
          const profile = await asanaStorage.updateAgentProfile(decodeURIComponent(agentMatch[1]), data);
          sendJSON(res, 200, normalizeProfileRow(profile));
          return true;
        } catch (error) {
          const message = error.message || 'Failed to update agent profile';
          const status = message.includes('No valid fields') ? 400
            : message.includes('not found') ? 404
              : message.includes('not available yet') ? 503
                : 500;
          sendJSON(res, status, { error: message });
          return true;
        }
      }
      if (!(await tableExists(pool, 'agent_profiles'))) {
        sendJSON(res, 503, { error: 'Agent profiles table is not available yet' });
        return true;
      }
      const result = await updateAgentProfileRecord(pool, decodeURIComponent(agentMatch[1]), data);
      sendJSON(res, result.status, result.body);
      return true;
    }

    if (url === '/api/org/summary' && method === 'GET') {
      const orgState = await buildOrgState(context, queueLimit);
      sendJSON(res, 200, {
        generatedAt: orgState.generatedAt,
        liveSummary: orgState.liveSummary,
        departments: orgState.departments,
        byRole: orgState.byRole,
        totalAgents: orgState.liveSummary.totalAgents
      });
      return true;
    }
  } catch (error) {
    console.error('[org-api] Request error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }

  return false;
}

module.exports = {
  orgAPI
};
