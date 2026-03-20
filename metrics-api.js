#!/usr/bin/env node
/**
 * Business metrics and scorecard API for the dashboard.
 *
 * This module starts the Phase 8 metrics surface with date-range-aware
 * endpoints for org, department, agent, service, and site scorecards.
 */

const { DEPARTMENTS, AGENT_PROFILES } = require('./org-bootstrap.js');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, digits = 2) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function normalizeDepartment(department) {
  const metadata = department?.metadata && typeof department.metadata === 'object' && !Array.isArray(department.metadata)
    ? department.metadata
    : {};
  return {
    id: department?.id || department?.slug || null,
    slug: department?.slug || department?.id || null,
    name: department?.name || 'Unassigned',
    description: department?.description || '',
    color: department?.color || '#64748b',
    icon: department?.icon || 'folder',
    metadata
  };
}

function normalizeAgentProfile(profile) {
  const metadata = profile?.metadata && typeof profile.metadata === 'object' && !Array.isArray(profile.metadata)
    ? profile.metadata
    : {};
  return {
    agentId: profile?.agentId || profile?.agent_id || null,
    departmentId: profile?.departmentId || profile?.department_id || null,
    departmentSlug: profile?.departmentSlug || profile?.department_slug || null,
    displayName: profile?.displayName || profile?.display_name || profile?.agentId || profile?.agent_id || 'Unknown agent',
    role: profile?.role || null,
    status: profile?.status || 'active',
    capabilities: Array.isArray(profile?.capabilities) ? profile.capabilities : [],
    metadata
  };
}

function parseDateInput(value, endOfDay = false) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999Z' : '00:00:00.000Z'}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseDateRange(requestUrl) {
  const rawDays = Number.parseInt(requestUrl.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 30));

  const requestedTo = parseDateInput(requestUrl.searchParams.get('to'), true);
  const toDate = requestedTo || new Date();

  const requestedFrom = parseDateInput(requestUrl.searchParams.get('from'));
  const fromDate = requestedFrom || new Date(toDate.getTime() - ((days - 1) * 24 * 60 * 60 * 1000));

  if (fromDate > toDate) {
    return {
      from: toDate.toISOString(),
      to: fromDate.toISOString(),
      days
    };
  }

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    days
  };
}

function formatDateOnly(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeMetricDateInput(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = parseDateInput(value);
  const normalized = formatDateOnly(parsed);
  if (!normalized) {
    throw new Error(`Invalid metric date: ${value}`);
  }
  return normalized;
}

function buildMetricDateRange(metricDate) {
  return {
    from: `${metricDate}T00:00:00.000Z`,
    to: `${metricDate}T23:59:59.999Z`,
    days: 1
  };
}

function normalizeSnapshotMetrics(metrics = {}, metricDate = null) {
  const payload = metrics && typeof metrics === 'object' && !Array.isArray(metrics)
    ? metrics
    : {};

  return {
    metricDate: metricDate || payload.metricDate || null,
    departmentId: payload.departmentId || null,
    departmentSlug: payload.departmentSlug || null,
    departmentName: payload.departmentName || 'Unassigned',
    serviceRequestsOpened: toNumber(payload.serviceRequestsOpened),
    serviceRequestsCompleted: toNumber(payload.serviceRequestsCompleted),
    workflowRunsStarted: toNumber(payload.workflowRunsStarted),
    workflowRunsCompleted: toNumber(payload.workflowRunsCompleted),
    workflowRunsFailed: toNumber(payload.workflowRunsFailed),
    workflowSuccessRate: payload.workflowSuccessRate === null || payload.workflowSuccessRate === undefined
      ? null
      : roundNumber(payload.workflowSuccessRate, 1),
    blockedTimeHours: roundNumber(payload.blockedTimeHours, 2) || 0,
    approvalLatencyHours: roundNumber(payload.approvalLatencyHours, 2),
    medianCompletionHours: roundNumber(payload.medianCompletionHours, 2),
    staleRunCount: toNumber(payload.staleRunCount)
  };
}

async function tableExists(pool, tableName) {
  if (!pool || typeof pool.query !== 'function') return false;
  try {
    const result = await pool.query('SELECT to_regclass($1) AS table_ref', [`public.${tableName}`]);
    return Boolean(result.rows?.[0]?.table_ref);
  } catch (_) {
    return false;
  }
}

async function safeQuery(pool, queryText, values = [], fallback = []) {
  if (!pool || typeof pool.query !== 'function') return fallback;
  try {
    const result = await pool.query(queryText, values);
    return Array.isArray(result?.rows) ? result.rows : fallback;
  } catch (error) {
    console.warn('[metrics-api] Query failed:', error.message);
    return fallback;
  }
}

async function listDepartments(context) {
  if (context.asanaStorage && typeof context.asanaStorage.listDepartments === 'function') {
    try {
      const items = await context.asanaStorage.listDepartments();
      if (Array.isArray(items) && items.length) {
        return items.map((item) => normalizeDepartment(item));
      }
    } catch (error) {
      console.warn('[metrics-api] Failed to load departments via storage:', error.message);
    }
  }

  return DEPARTMENTS.map((department) => normalizeDepartment({
    ...department,
    id: department.slug
  }));
}

async function listAgentProfiles(context) {
  const configuredAgents = typeof context.buildConfiguredAgentsCatalog === 'function'
    ? context.buildConfiguredAgentsCatalog()
    : [];

  if (context.asanaStorage && typeof context.asanaStorage.listAgentProfiles === 'function') {
    try {
      const items = await context.asanaStorage.listAgentProfiles(configuredAgents);
      if (Array.isArray(items) && items.length) {
        return items.map((item) => normalizeAgentProfile(item));
      }
    } catch (error) {
      console.warn('[metrics-api] Failed to load agent profiles via storage:', error.message);
    }
  }

  const configuredMap = new Map(configuredAgents.map((agent) => [agent.id, agent]));
  return AGENT_PROFILES.map((profile) => normalizeAgentProfile({
    ...profile,
    departmentSlug: profile.departmentSlug,
    displayName: profile.displayName || configuredMap.get(profile.agentId)?.name || profile.agentId
  }));
}

function computeSuccessRate(completedCount, failedCount) {
  const completed = toNumber(completedCount);
  const failed = toNumber(failedCount);
  const total = completed + failed;
  return total > 0 ? roundNumber((completed / total) * 100, 1) : null;
}

function buildOrgScorecard(row = {}, extra = {}) {
  return {
    serviceRequestsOpened: toNumber(row.service_requests_opened),
    serviceRequestsCompleted: toNumber(row.service_requests_completed),
    workflowRunsStarted: toNumber(row.workflow_runs_started),
    workflowRunsCompleted: toNumber(row.workflow_runs_completed),
    workflowRunsFailed: toNumber(row.workflow_runs_failed),
    workflowSuccessRate: computeSuccessRate(row.workflow_runs_completed, row.workflow_runs_failed),
    blockedTimeHours: roundNumber(row.blocked_time_hours, 2) || 0,
    approvalLatencyHours: roundNumber(row.approval_latency_hours, 2),
    medianCompletionHours: roundNumber(row.median_completion_hours, 2),
    pendingApprovals: toNumber(row.pending_approvals),
    staleRunCount: toNumber(row.stale_run_count),
    activeWorkload: toNumber(row.active_workload),
    departmentsTracked: toNumber(extra.departmentsTracked),
    agentsTracked: toNumber(extra.agentsTracked),
    servicesTracked: toNumber(extra.servicesTracked),
    sitesTracked: toNumber(extra.sitesTracked)
  };
}

function buildDepartmentScorecard(row = {}, department = null) {
  const normalizedDepartment = department ? normalizeDepartment(department) : null;
  return {
    departmentId: normalizedDepartment?.id || row.department_id || 'unassigned',
    departmentSlug: normalizedDepartment?.slug || row.department_slug || row.department_id || 'unassigned',
    departmentName: normalizedDepartment?.name || row.department_name || 'Unassigned',
    serviceRequestsOpened: toNumber(row.service_requests_opened),
    serviceRequestsCompleted: toNumber(row.service_requests_completed),
    workflowRunsStarted: toNumber(row.workflow_runs_started),
    workflowRunsCompleted: toNumber(row.workflow_runs_completed),
    workflowRunsFailed: toNumber(row.workflow_runs_failed),
    workflowSuccessRate: computeSuccessRate(row.workflow_runs_completed, row.workflow_runs_failed),
    blockedTimeHours: roundNumber(row.blocked_time_hours, 2) || 0,
    approvalLatencyHours: roundNumber(row.approval_latency_hours, 2),
    medianCompletionHours: roundNumber(row.median_completion_hours, 2),
    staleRunCount: toNumber(row.stale_run_count)
  };
}

function buildAgentScorecard(row = {}, profile = null, departmentMap = new Map()) {
  const normalizedProfile = profile ? normalizeAgentProfile(profile) : null;
  const departmentId = normalizedProfile?.departmentId || row.department_id || null;
  const departmentSlug = normalizedProfile?.departmentSlug || row.department_slug || null;
  const department = departmentMap.get(departmentId) || departmentMap.get(departmentSlug) || null;

  return {
    agentId: normalizedProfile?.agentId || row.agent_id,
    displayName: normalizedProfile?.displayName || row.display_name || row.agent_id,
    role: normalizedProfile?.role || row.role || null,
    department: department
      ? {
        id: department.id,
        slug: department.slug,
        name: department.name
      }
      : null,
    activeWorkload: toNumber(row.active_workload),
    completionCount: toNumber(row.completion_count),
    failureCount: toNumber(row.failure_count),
    retryCount: toNumber(row.retry_count),
    staleRunCount: toNumber(row.stale_run_count),
    approvalBurden: toNumber(row.approval_burden)
  };
}

function buildServiceScorecard(row = {}, departmentMap = new Map()) {
  const department = departmentMap.get(row.department_id) || null;
  return {
    serviceId: row.service_id,
    serviceSlug: row.service_slug || null,
    serviceName: row.service_name || 'Unknown service',
    department: department
      ? { id: department.id, slug: department.slug, name: department.name }
      : row.department_id
        ? { id: row.department_id, slug: row.department_id, name: row.department_name || row.department_id }
        : null,
    requestsOpened: toNumber(row.requests_opened),
    requestsCompleted: toNumber(row.requests_completed),
    workflowRunsStarted: toNumber(row.workflow_runs_started),
    workflowRunsCompleted: toNumber(row.workflow_runs_completed),
    workflowRunsFailed: toNumber(row.workflow_runs_failed),
    workflowSuccessRate: computeSuccessRate(row.workflow_runs_completed, row.workflow_runs_failed),
    medianCompletionHours: roundNumber(row.median_completion_hours, 2)
  };
}

function buildSiteScorecard(row = {}) {
  const draftsCreated = toNumber(row.drafts_created);
  const draftsApproved = toNumber(row.drafts_approved);
  const totalImages = toNumber(row.total_images);
  const approvedImages = toNumber(row.approved_images);
  const totalVerificationReports = toNumber(row.total_verification_reports);
  const approvedVerificationReports = toNumber(row.approved_verification_reports);
  const rejectedVerificationReports = toNumber(row.rejected_verification_reports);

  return {
    siteKey: row.site_key || 'unknown',
    totalRuns: toNumber(row.total_runs),
    completedRuns: toNumber(row.completed_runs),
    draftsCreated,
    draftsApproved,
    postsPublished: toNumber(row.posts_published),
    imagePassRate: totalImages > 0 ? roundNumber((approvedImages / totalImages) * 100, 1) : null,
    publishVerificationPassRate: totalVerificationReports > 0
      ? roundNumber((approvedVerificationReports / totalVerificationReports) * 100, 1)
      : null,
    publishDefectRate: totalVerificationReports > 0
      ? roundNumber((rejectedVerificationReports / totalVerificationReports) * 100, 1)
      : null
  };
}

async function queryOrgScorecard(pool, range) {
  const rows = await safeQuery(pool, `
    /* metrics:org_scorecard */
    WITH request_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE sr.created_at BETWEEN $1 AND $2)::integer AS service_requests_opened,
        COUNT(*) FILTER (WHERE sr.status = 'completed' AND sr.updated_at BETWEEN $1 AND $2)::integer AS service_requests_completed
      FROM service_requests sr
    ),
    run_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(wr.started_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_started,
        COUNT(*) FILTER (WHERE wr.status = 'completed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_completed,
        COUNT(*) FILTER (WHERE wr.status = 'failed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_failed,
        COUNT(*) FILTER (WHERE COALESCE(wr.retry_count, 0) > 0 AND COALESCE(wr.finished_at, wr.updated_at, wr.started_at, wr.created_at) BETWEEN $1 AND $2)::integer AS retried_runs,
        COUNT(*) FILTER (WHERE wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying'))::integer AS active_workload
      FROM workflow_runs wr
    ),
    completion_stats AS (
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (wr.finished_at - COALESCE(wr.started_at, wr.created_at))) / 3600.0
        ) AS median_completion_hours
      FROM workflow_runs wr
      WHERE wr.status = 'completed'
        AND wr.finished_at IS NOT NULL
        AND COALESCE(wr.started_at, wr.created_at) IS NOT NULL
        AND wr.finished_at BETWEEN $1 AND $2
    ),
    blocker_stats AS (
      SELECT
        COALESCE(
          SUM(
            GREATEST(
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(wr.resumed_at, wr.finished_at, NOW()), $2::timestamptz) - wr.blocker_detected_at
              )),
              0
            )
          ) / 3600.0,
          0
        ) AS blocked_time_hours,
        COUNT(*) FILTER (
          WHERE wr.status IN ('running', 'blocked', 'retrying')
            AND (
              wr.blocker_type IN ('no_heartbeat', 'stale_step', 'active_task_no_session')
              OR (wr.status = 'blocked' AND wr.blocker_type IS NOT NULL)
            )
        )::integer AS stale_run_count
      FROM workflow_runs wr
      WHERE wr.blocker_detected_at IS NOT NULL
        AND wr.blocker_detected_at BETWEEN $1 AND $2
    ),
    approval_stats AS (
      SELECT
        AVG(EXTRACT(EPOCH FROM (a.decided_at - a.requested_at)) / 3600.0)
          FILTER (
            WHERE a.decided_at IS NOT NULL
              AND a.status IN ('approved', 'rejected', 'cancelled')
              AND a.decided_at BETWEEN $1 AND $2
          ) AS approval_latency_hours,
        COUNT(*) FILTER (WHERE a.status = 'pending')::integer AS pending_approvals
      FROM workflow_approvals a
    )
    SELECT
      request_stats.service_requests_opened,
      request_stats.service_requests_completed,
      run_stats.workflow_runs_started,
      run_stats.workflow_runs_completed,
      run_stats.workflow_runs_failed,
      blocker_stats.blocked_time_hours,
      blocker_stats.stale_run_count,
      approval_stats.approval_latency_hours,
      approval_stats.pending_approvals,
      completion_stats.median_completion_hours,
      run_stats.active_workload
    FROM request_stats, run_stats, blocker_stats, approval_stats, completion_stats
  `, [range.from, range.to], []);

  return rows[0] || {};
}

async function queryDepartmentScorecards(pool, range) {
  return safeQuery(pool, `
    /* metrics:department_scorecards */
    WITH request_stats AS (
      SELECT
        COALESCE(sr.target_department_id, sc.department_id) AS department_id,
        COUNT(*) FILTER (WHERE sr.created_at BETWEEN $1 AND $2)::integer AS service_requests_opened,
        COUNT(*) FILTER (WHERE sr.status = 'completed' AND sr.updated_at BETWEEN $1 AND $2)::integer AS service_requests_completed
      FROM service_requests sr
      LEFT JOIN service_catalog sc ON sc.id = sr.service_id
      GROUP BY 1
    ),
    run_stats AS (
      SELECT
        COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) AS department_id,
        COUNT(*) FILTER (WHERE COALESCE(wr.started_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_started,
        COUNT(*) FILTER (WHERE wr.status = 'completed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_completed,
        COUNT(*) FILTER (WHERE wr.status = 'failed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_failed
      FROM workflow_runs wr
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      GROUP BY 1
    ),
    completion_stats AS (
      SELECT
        department_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_hours) AS median_completion_hours
      FROM (
        SELECT
          COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) AS department_id,
          EXTRACT(EPOCH FROM (wr.finished_at - COALESCE(wr.started_at, wr.created_at))) / 3600.0 AS duration_hours
        FROM workflow_runs wr
        LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
        LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
        LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
        WHERE wr.status = 'completed'
          AND wr.finished_at IS NOT NULL
          AND COALESCE(wr.started_at, wr.created_at) IS NOT NULL
          AND wr.finished_at BETWEEN $1 AND $2
      ) completed
      GROUP BY department_id
    ),
    approval_stats AS (
      SELECT
        COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) AS department_id,
        AVG(EXTRACT(EPOCH FROM (a.decided_at - a.requested_at)) / 3600.0)
          FILTER (
            WHERE a.decided_at IS NOT NULL
              AND a.status IN ('approved', 'rejected', 'cancelled')
              AND a.decided_at BETWEEN $1 AND $2
          ) AS approval_latency_hours
      FROM workflow_approvals a
      JOIN workflow_runs wr ON wr.id = a.workflow_run_id
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      GROUP BY 1
    ),
    blocker_stats AS (
      SELECT
        COALESCE(wr.department_id, sr.target_department_id, wt.department_id, sc.department_id) AS department_id,
        COALESCE(
          SUM(
            GREATEST(
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(wr.resumed_at, wr.finished_at, NOW()), $2::timestamptz) - wr.blocker_detected_at
              )),
              0
            )
          ) / 3600.0,
          0
        ) AS blocked_time_hours,
        COUNT(*) FILTER (
          WHERE wr.status IN ('running', 'blocked', 'retrying')
            AND (
              wr.blocker_type IN ('no_heartbeat', 'stale_step', 'active_task_no_session')
              OR (wr.status = 'blocked' AND wr.blocker_type IS NOT NULL)
            )
        )::integer AS stale_run_count
      FROM workflow_runs wr
      LEFT JOIN service_requests sr ON wr.service_request_id = sr.id
      LEFT JOIN workflow_templates wt ON wt.name = wr.workflow_type
      LEFT JOIN service_catalog sc ON COALESCE(sr.service_id, wt.service_id) = sc.id
      WHERE wr.blocker_detected_at IS NOT NULL
        AND wr.blocker_detected_at BETWEEN $1 AND $2
      GROUP BY 1
    ),
    all_departments AS (
      SELECT department_id FROM request_stats
      UNION
      SELECT department_id FROM run_stats
      UNION
      SELECT department_id FROM completion_stats
      UNION
      SELECT department_id FROM approval_stats
      UNION
      SELECT department_id FROM blocker_stats
    )
    SELECT
      all_departments.department_id,
      COALESCE(request_stats.service_requests_opened, 0)::integer AS service_requests_opened,
      COALESCE(request_stats.service_requests_completed, 0)::integer AS service_requests_completed,
      COALESCE(run_stats.workflow_runs_started, 0)::integer AS workflow_runs_started,
      COALESCE(run_stats.workflow_runs_completed, 0)::integer AS workflow_runs_completed,
      COALESCE(run_stats.workflow_runs_failed, 0)::integer AS workflow_runs_failed,
      COALESCE(blocker_stats.blocked_time_hours, 0) AS blocked_time_hours,
      approval_stats.approval_latency_hours,
      completion_stats.median_completion_hours,
      COALESCE(blocker_stats.stale_run_count, 0)::integer AS stale_run_count
    FROM all_departments
    LEFT JOIN request_stats ON request_stats.department_id = all_departments.department_id
    LEFT JOIN run_stats ON run_stats.department_id = all_departments.department_id
    LEFT JOIN completion_stats ON completion_stats.department_id = all_departments.department_id
    LEFT JOIN approval_stats ON approval_stats.department_id = all_departments.department_id
    LEFT JOIN blocker_stats ON blocker_stats.department_id = all_departments.department_id
    ORDER BY all_departments.department_id
  `, [range.from, range.to], []);
}

async function queryAgentScorecards(pool, range) {
  return safeQuery(pool, `
    /* metrics:agent_scorecards */
    WITH run_stats AS (
      SELECT
        wr.owner_agent_id AS agent_id,
        COUNT(*) FILTER (WHERE wr.status IN ('queued', 'running', 'waiting_for_approval', 'retrying'))::integer AS active_workload,
        COUNT(*) FILTER (WHERE wr.status = 'completed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS completion_count,
        COUNT(*) FILTER (WHERE wr.status = 'failed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS failure_count,
        COUNT(*) FILTER (WHERE COALESCE(wr.retry_count, 0) > 0 AND COALESCE(wr.finished_at, wr.updated_at, wr.started_at, wr.created_at) BETWEEN $1 AND $2)::integer AS retry_count
      FROM workflow_runs wr
      WHERE wr.owner_agent_id IS NOT NULL
      GROUP BY 1
    ),
    stale_stats AS (
      SELECT
        wr.owner_agent_id AS agent_id,
        COUNT(*) FILTER (
          WHERE wr.status IN ('running', 'blocked', 'retrying')
            AND (
              wr.blocker_type IN ('no_heartbeat', 'stale_step', 'active_task_no_session')
              OR (wr.status = 'blocked' AND wr.blocker_type IS NOT NULL)
            )
        )::integer AS stale_run_count
      FROM workflow_runs wr
      WHERE wr.owner_agent_id IS NOT NULL
      GROUP BY 1
    ),
    approval_stats AS (
      SELECT
        a.approver_id AS agent_id,
        COUNT(*) FILTER (WHERE a.requested_at BETWEEN $1 AND $2)::integer AS approval_burden
      FROM workflow_approvals a
      WHERE a.approver_id IS NOT NULL
      GROUP BY 1
    ),
    all_agents AS (
      SELECT agent_id FROM run_stats
      UNION
      SELECT agent_id FROM stale_stats
      UNION
      SELECT agent_id FROM approval_stats
    )
    SELECT
      all_agents.agent_id,
      COALESCE(run_stats.active_workload, 0)::integer AS active_workload,
      COALESCE(run_stats.completion_count, 0)::integer AS completion_count,
      COALESCE(run_stats.failure_count, 0)::integer AS failure_count,
      COALESCE(run_stats.retry_count, 0)::integer AS retry_count,
      COALESCE(stale_stats.stale_run_count, 0)::integer AS stale_run_count,
      COALESCE(approval_stats.approval_burden, 0)::integer AS approval_burden
    FROM all_agents
    LEFT JOIN run_stats ON run_stats.agent_id = all_agents.agent_id
    LEFT JOIN stale_stats ON stale_stats.agent_id = all_agents.agent_id
    LEFT JOIN approval_stats ON approval_stats.agent_id = all_agents.agent_id
    ORDER BY all_agents.agent_id
  `, [range.from, range.to], []);
}

async function queryServiceScorecards(pool, range) {
  return safeQuery(pool, `
    /* metrics:service_scorecards */
    WITH completion_stats AS (
      SELECT
        sr.service_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (wr.finished_at - COALESCE(wr.started_at, wr.created_at))) / 3600.0
        ) AS median_completion_hours
      FROM workflow_runs wr
      JOIN service_requests sr ON wr.service_request_id = sr.id
      WHERE wr.status = 'completed'
        AND wr.finished_at IS NOT NULL
        AND COALESCE(wr.started_at, wr.created_at) IS NOT NULL
        AND wr.finished_at BETWEEN $1 AND $2
      GROUP BY sr.service_id
    )
    SELECT
      sc.id AS service_id,
      sc.slug AS service_slug,
      sc.name AS service_name,
      sc.department_id,
      COUNT(DISTINCT sr.id) FILTER (WHERE sr.created_at BETWEEN $1 AND $2)::integer AS requests_opened,
      COUNT(DISTINCT sr.id) FILTER (WHERE sr.status = 'completed' AND sr.updated_at BETWEEN $1 AND $2)::integer AS requests_completed,
      COUNT(DISTINCT wr.id) FILTER (WHERE COALESCE(wr.started_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_started,
      COUNT(DISTINCT wr.id) FILTER (WHERE wr.status = 'completed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_completed,
      COUNT(DISTINCT wr.id) FILTER (WHERE wr.status = 'failed' AND COALESCE(wr.finished_at, wr.updated_at, wr.created_at) BETWEEN $1 AND $2)::integer AS workflow_runs_failed,
      completion_stats.median_completion_hours
    FROM service_catalog sc
    LEFT JOIN service_requests sr ON sr.service_id = sc.id
    LEFT JOIN workflow_runs wr ON wr.service_request_id = sr.id
    LEFT JOIN completion_stats ON completion_stats.service_id = sc.id
    GROUP BY sc.id, sc.slug, sc.name, sc.department_id, completion_stats.median_completion_hours
    ORDER BY sc.name
  `, [range.from, range.to], []);
}

async function querySiteScorecards(pool, range) {
  return safeQuery(pool, `
    /* metrics:site_scorecards */
    WITH normalized_runs AS (
      SELECT
        wr.id,
        wr.workflow_type,
        wr.status,
        COALESCE(NULLIF(wr.customer_scope, ''), NULLIF(wr.input_payload->>'site', ''), NULLIF(wr.input_payload->>'website', '')) AS site_key,
        COALESCE(wr.started_at, wr.created_at) AS effective_started_at,
        COALESCE(wr.finished_at, wr.updated_at, wr.created_at) AS effective_finished_at
      FROM workflow_runs wr
    ),
    run_stats AS (
      SELECT
        site_key,
        COUNT(*) FILTER (WHERE effective_started_at BETWEEN $1 AND $2)::integer AS total_runs,
        COUNT(*) FILTER (WHERE status = 'completed' AND effective_finished_at BETWEEN $1 AND $2)::integer AS completed_runs,
        COUNT(*) FILTER (
          WHERE status = 'completed'
            AND workflow_type ILIKE '%publish%'
            AND effective_finished_at BETWEEN $1 AND $2
        )::integer AS posts_published
      FROM normalized_runs
      WHERE site_key IS NOT NULL AND site_key <> ''
      GROUP BY 1
    ),
    artifact_stats AS (
      SELECT
        nr.site_key,
        COUNT(*) FILTER (WHERE wa.artifact_type = 'draft' AND wa.created_at BETWEEN $1 AND $2)::integer AS drafts_created,
        COUNT(*) FILTER (WHERE wa.artifact_type = 'draft' AND wa.status = 'approved' AND wa.created_at BETWEEN $1 AND $2)::integer AS drafts_approved,
        COUNT(*) FILTER (WHERE wa.artifact_type = 'image' AND wa.created_at BETWEEN $1 AND $2)::integer AS total_images,
        COUNT(*) FILTER (WHERE wa.artifact_type = 'image' AND wa.status = 'approved' AND wa.created_at BETWEEN $1 AND $2)::integer AS approved_images,
        COUNT(*) FILTER (
          WHERE wa.artifact_type IN ('verification', 'verification_report', 'publish_verification')
            AND wa.created_at BETWEEN $1 AND $2
        )::integer AS total_verification_reports,
        COUNT(*) FILTER (
          WHERE wa.artifact_type IN ('verification', 'verification_report', 'publish_verification')
            AND wa.status = 'approved'
            AND wa.created_at BETWEEN $1 AND $2
        )::integer AS approved_verification_reports,
        COUNT(*) FILTER (
          WHERE wa.artifact_type IN ('verification', 'verification_report', 'publish_verification')
            AND wa.status = 'rejected'
            AND wa.created_at BETWEEN $1 AND $2
        )::integer AS rejected_verification_reports
      FROM normalized_runs nr
      JOIN workflow_artifacts wa ON wa.workflow_run_id = nr.id
      WHERE nr.site_key IS NOT NULL AND nr.site_key <> ''
      GROUP BY 1
    ),
    all_sites AS (
      SELECT site_key FROM run_stats
      UNION
      SELECT site_key FROM artifact_stats
    )
    SELECT
      all_sites.site_key,
      COALESCE(run_stats.total_runs, 0)::integer AS total_runs,
      COALESCE(run_stats.completed_runs, 0)::integer AS completed_runs,
      COALESCE(run_stats.posts_published, 0)::integer AS posts_published,
      COALESCE(artifact_stats.drafts_created, 0)::integer AS drafts_created,
      COALESCE(artifact_stats.drafts_approved, 0)::integer AS drafts_approved,
      COALESCE(artifact_stats.total_images, 0)::integer AS total_images,
      COALESCE(artifact_stats.approved_images, 0)::integer AS approved_images,
      COALESCE(artifact_stats.total_verification_reports, 0)::integer AS total_verification_reports,
      COALESCE(artifact_stats.approved_verification_reports, 0)::integer AS approved_verification_reports,
      COALESCE(artifact_stats.rejected_verification_reports, 0)::integer AS rejected_verification_reports
    FROM all_sites
    LEFT JOIN run_stats ON run_stats.site_key = all_sites.site_key
    LEFT JOIN artifact_stats ON artifact_stats.site_key = all_sites.site_key
    ORDER BY all_sites.site_key
  `, [range.from, range.to], []);
}

async function queryDepartmentTrendSnapshots(pool, department, range) {
  if (!(await tableExists(pool, 'department_daily_metrics'))) {
    return [];
  }

  const rows = await safeQuery(pool, `
    /* metrics:department_trend_snapshots */
    SELECT metric_date, metrics
    FROM department_daily_metrics
    WHERE department_id = $1
      AND metric_date BETWEEN $2::date AND $3::date
    ORDER BY metric_date ASC
  `, [
    department.departmentId,
    String(range.from).slice(0, 10),
    String(range.to).slice(0, 10)
  ], []);

  return rows.map((row) => normalizeSnapshotMetrics(row.metrics, formatDateOnly(row.metric_date)));
}

async function buildMetricsPayloads(context, range) {
  const pool = context.asanaStorage?.pool || context.pool || null;
  const departments = await listDepartments(context);
  const departmentMap = new Map();
  departments.forEach((department) => {
    departmentMap.set(department.id, department);
    departmentMap.set(department.slug, department);
  });

  const agentProfiles = await listAgentProfiles(context);
  const profileMap = new Map(agentProfiles.map((profile) => [profile.agentId, profile]));

  const [
    hasServiceRequests,
    hasWorkflowRuns,
    hasWorkflowApprovals,
    hasWorkflowArtifacts,
    hasServiceCatalog
  ] = await Promise.all([
    tableExists(pool, 'service_requests'),
    tableExists(pool, 'workflow_runs'),
    tableExists(pool, 'workflow_approvals'),
    tableExists(pool, 'workflow_artifacts'),
    tableExists(pool, 'service_catalog')
  ]);

  const orgRow = hasServiceRequests && hasWorkflowRuns && hasWorkflowApprovals
    ? await queryOrgScorecard(pool, range)
    : {};

  const departmentRows = hasServiceRequests && hasWorkflowRuns && hasWorkflowApprovals
    ? await queryDepartmentScorecards(pool, range)
    : [];

  const agentRows = hasWorkflowRuns && hasWorkflowApprovals
    ? await queryAgentScorecards(pool, range)
    : [];

  const serviceRows = hasServiceCatalog && hasServiceRequests && hasWorkflowRuns
    ? await queryServiceScorecards(pool, range)
    : [];

  const siteRows = hasWorkflowRuns && hasWorkflowArtifacts
    ? await querySiteScorecards(pool, range)
    : [];

  const departmentsPayload = [];
  const seenDepartments = new Set();
  departmentRows.forEach((row) => {
    const department = departmentMap.get(row.department_id) || null;
    const item = buildDepartmentScorecard(row, department);
    departmentsPayload.push(item);
    seenDepartments.add(item.departmentId);
  });
  departments.forEach((department) => {
    if (!seenDepartments.has(department.id)) {
      departmentsPayload.push(buildDepartmentScorecard({}, department));
    }
  });
  departmentsPayload.sort((left, right) => left.departmentName.localeCompare(right.departmentName, undefined, { sensitivity: 'base' }));

  const agentsPayload = [];
  const seenAgents = new Set();
  agentRows.forEach((row) => {
    const profile = profileMap.get(row.agent_id) || null;
    const item = buildAgentScorecard(row, profile, departmentMap);
    agentsPayload.push(item);
    if (item.agentId) seenAgents.add(item.agentId);
  });
  agentProfiles.forEach((profile) => {
    if (profile.agentId && !seenAgents.has(profile.agentId)) {
      agentsPayload.push(buildAgentScorecard({ agent_id: profile.agentId }, profile, departmentMap));
    }
  });
  agentsPayload.sort((left, right) => (left.displayName || left.agentId).localeCompare((right.displayName || right.agentId), undefined, { sensitivity: 'base' }));

  const servicesPayload = serviceRows
    .map((row) => buildServiceScorecard(row, departmentMap))
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName, undefined, { sensitivity: 'base' }));

  const sitesPayload = siteRows
    .map((row) => buildSiteScorecard(row))
    .sort((left, right) => left.siteKey.localeCompare(right.siteKey, undefined, { sensitivity: 'base' }));

  const orgScorecard = buildOrgScorecard(orgRow, {
    departmentsTracked: departmentsPayload.length,
    agentsTracked: agentsPayload.length,
    servicesTracked: servicesPayload.length,
    sitesTracked: sitesPayload.length
  });

  return {
    dateRange: range,
    orgScorecard,
    departmentsPayload,
    agentsPayload,
    servicesPayload,
    sitesPayload
  };
}

async function persistDepartmentDailyMetrics(context, metricDateInput = new Date()) {
  const pool = context?.asanaStorage?.pool || context?.pool || null;
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('Metrics persistence requires a PostgreSQL pool');
  }

  if (!(await tableExists(pool, 'department_daily_metrics'))) {
    throw new Error('department_daily_metrics table is not available yet');
  }

  const metricDate = normalizeMetricDateInput(metricDateInput);
  const range = buildMetricDateRange(metricDate);
  const payloads = await buildMetricsPayloads(context, range);
  const generatedAt = new Date().toISOString();
  const snapshots = [];

  for (const department of payloads.departmentsPayload) {
    if (!department?.departmentId) continue;

    const snapshot = {
      metricDate,
      generatedAt,
      departmentId: department.departmentId,
      departmentSlug: department.departmentSlug,
      departmentName: department.departmentName,
      serviceRequestsOpened: toNumber(department.serviceRequestsOpened),
      serviceRequestsCompleted: toNumber(department.serviceRequestsCompleted),
      workflowRunsStarted: toNumber(department.workflowRunsStarted),
      workflowRunsCompleted: toNumber(department.workflowRunsCompleted),
      workflowRunsFailed: toNumber(department.workflowRunsFailed),
      workflowSuccessRate: department.workflowSuccessRate === null || department.workflowSuccessRate === undefined
        ? null
        : roundNumber(department.workflowSuccessRate, 1),
      blockedTimeHours: roundNumber(department.blockedTimeHours, 2) || 0,
      approvalLatencyHours: roundNumber(department.approvalLatencyHours, 2),
      medianCompletionHours: roundNumber(department.medianCompletionHours, 2),
      staleRunCount: toNumber(department.staleRunCount)
    };

    await pool.query(`
      INSERT INTO department_daily_metrics (department_id, metric_date, metrics)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (department_id, metric_date)
      DO UPDATE SET
        metrics = EXCLUDED.metrics,
        updated_at = NOW()
    `, [
      department.departmentId,
      metricDate,
      JSON.stringify(snapshot)
    ]);

    snapshots.push(snapshot);
  }

  return {
    metricDate,
    dateRange: range,
    departmentsWritten: snapshots.length,
    snapshots
  };
}

async function metricsAPI(req, res, url, method, requestBody, context) {
  const { sendJSON } = context;

  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const range = parseDateRange(requestUrl);

    if (method !== 'GET') {
      return false;
    }

    if (url === '/api/metrics/org') {
      const payloads = await buildMetricsPayloads(context, range);
      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        scorecard: payloads.orgScorecard
      });
      return true;
    }

    if (url === '/api/metrics/departments') {
      const payloads = await buildMetricsPayloads(context, range);
      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        departments: payloads.departmentsPayload
      });
      return true;
    }

    const departmentMatch = url.match(/^\/api\/metrics\/departments\/([^/]+)$/);
    if (departmentMatch) {
      const departmentIdentifier = decodeURIComponent(departmentMatch[1]);
      const payloads = await buildMetricsPayloads(context, range);
      const department = payloads.departmentsPayload.find((item) =>
        item.departmentId === departmentIdentifier || item.departmentSlug === departmentIdentifier
      );

      if (!department) {
        sendJSON(res, 404, { error: 'Department metrics not found' });
        return true;
      }

      const pool = context?.asanaStorage?.pool || context?.pool || null;
      const trend = pool
        ? await queryDepartmentTrendSnapshots(pool, department, payloads.dateRange)
        : [];

      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        department: {
          id: department.departmentId,
          slug: department.departmentSlug,
          name: department.departmentName
        },
        scorecard: department,
        trend,
        agents: payloads.agentsPayload.filter((agent) =>
          agent.department?.id === department.departmentId || agent.department?.slug === department.departmentSlug
        ),
        services: payloads.servicesPayload.filter((service) =>
          service.department?.id === department.departmentId || service.department?.slug === department.departmentSlug
        )
      });
      return true;
    }

    if (url === '/api/metrics/agents') {
      const payloads = await buildMetricsPayloads(context, range);
      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        agents: payloads.agentsPayload
      });
      return true;
    }

    if (url === '/api/metrics/services') {
      const payloads = await buildMetricsPayloads(context, range);
      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        services: payloads.servicesPayload
      });
      return true;
    }

    if (url === '/api/metrics/sites') {
      const payloads = await buildMetricsPayloads(context, range);
      sendJSON(res, 200, {
        dateRange: payloads.dateRange,
        sites: payloads.sitesPayload
      });
      return true;
    }
  } catch (error) {
    console.error('[metrics-api] Request error:', error);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }

  return false;
}

module.exports = {
  buildMetricsPayloads,
  metricsAPI,
  persistDepartmentDailyMetrics
};
