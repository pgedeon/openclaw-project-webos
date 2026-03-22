const { Pool } = require('pg');
const { execSync } = require('child_process');

const DEFAULT_OPTIONS = Object.freeze({
  pollIntervalMs: 30_000,
  staleDispatchMs: 5 * 60 * 1000,
  staleClaimMs: 10 * 60 * 1000,
  maxDispatchRetries: 3,
  batchSize: 10
});

const SQL = {
  dispatchCandidates: `
    WITH active_runs AS (
      SELECT
        workflow_type,
        COUNT(*)::int AS active_count
      FROM workflow_runs
      WHERE status IN ('claimed', 'running')
      GROUP BY workflow_type
    ),
    ranked_runs AS (
      SELECT
        wr.*,
        route.agent_id AS routed_agent_id,
        route.priority AS routing_priority,
        route.max_concurrent,
        route.timeout_minutes,
        COALESCE(active_runs.active_count, 0) AS active_count,
        ROW_NUMBER() OVER (
          PARTITION BY wr.workflow_type
          ORDER BY wr.created_at ASC, wr.id ASC
        ) AS queue_rank
      FROM workflow_runs AS wr
      JOIN workflow_agent_routing AS route
        ON route.workflow_type = wr.workflow_type
      LEFT JOIN active_runs
        ON active_runs.workflow_type = wr.workflow_type
      WHERE wr.status = 'queued'
    )
    SELECT *
    FROM ranked_runs
    WHERE queue_rank <= GREATEST(max_concurrent - active_count, 0)
    ORDER BY routing_priority DESC, created_at ASC, id ASC
    LIMIT $1
  `,
  markDispatched: `
    UPDATE workflow_runs
    SET status = 'dispatched',
        owner_agent_id = $2,
        dispatched_at = NOW(),
        claimed_at = NULL,
        claimed_by = NULL,
        claim_session_id = NULL,
        dispatch_attempts = COALESCE(dispatch_attempts, 0) + 1,
        gateway_session_id = NULL,
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status = 'queued'
    RETURNING *
  `,
  staleDispatched: `
    SELECT
      wr.*,
      route.agent_id AS routed_agent_id,
      route.priority AS routing_priority,
      route.max_concurrent,
      route.timeout_minutes
    FROM workflow_runs AS wr
    JOIN workflow_agent_routing AS route
      ON route.workflow_type = wr.workflow_type
    WHERE wr.status = 'dispatched'
      AND wr.dispatched_at IS NOT NULL
      AND wr.claim_session_id IS NULL
      AND wr.dispatched_at <= NOW() - INTERVAL '1 millisecond' * $1
    ORDER BY wr.dispatched_at ASC, wr.id ASC
    LIMIT $2
  `,
  refreshDispatched: `
    UPDATE workflow_runs
    SET owner_agent_id = $2,
        dispatched_at = NOW(),
        claimed_at = NULL,
        claimed_by = NULL,
        claim_session_id = NULL,
        dispatch_attempts = COALESCE(dispatch_attempts, 0) + 1,
        gateway_session_id = NULL,
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status = 'dispatched'
    RETURNING *
  `,
  markTimedOutFromDispatched: `
    UPDATE workflow_runs
    SET status = 'timed_out',
        finished_at = NOW(),
        last_error = $2,
        last_error_at = NOW(),
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status = 'dispatched'
    RETURNING *
  `,
  staleClaimed: `
    SELECT
      wr.*,
      route.agent_id AS routed_agent_id,
      route.priority AS routing_priority,
      route.max_concurrent,
      route.timeout_minutes
    FROM workflow_runs AS wr
    JOIN workflow_agent_routing AS route
      ON route.workflow_type = wr.workflow_type
    WHERE wr.status IN ('claimed', 'running')
      AND COALESCE(wr.last_heartbeat_at, wr.claimed_at) IS NOT NULL
      AND COALESCE(wr.last_heartbeat_at, wr.claimed_at) <= NOW() - INTERVAL '1 millisecond' * $1
      AND COALESCE(wr.claimed_at, wr.started_at, wr.created_at) > NOW() - INTERVAL '1 minute' * route.timeout_minutes
    ORDER BY COALESCE(wr.last_heartbeat_at, wr.claimed_at) ASC, wr.id ASC
    LIMIT $2
  `,
  releaseClaimed: `
    UPDATE workflow_runs
    SET status = 'dispatched',
        owner_agent_id = $2,
        dispatched_at = NOW(),
        claimed_at = NULL,
        claimed_by = NULL,
        claim_session_id = NULL,
        dispatch_attempts = COALESCE(dispatch_attempts, 0) + 1,
        gateway_session_id = NULL,
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('claimed', 'running')
    RETURNING *
  `,
  longRunning: `
    SELECT
      wr.*,
      route.agent_id AS routed_agent_id,
      route.priority AS routing_priority,
      route.max_concurrent,
      route.timeout_minutes
    FROM workflow_runs AS wr
    JOIN workflow_agent_routing AS route
      ON route.workflow_type = wr.workflow_type
    WHERE wr.status IN ('claimed', 'running')
      AND COALESCE(wr.claimed_at, wr.started_at, wr.created_at) <= NOW() - INTERVAL '1 minute' * route.timeout_minutes
    ORDER BY COALESCE(wr.claimed_at, wr.started_at, wr.created_at) ASC, wr.id ASC
    LIMIT $1
  `,
  markTimedOutFromClaimed: `
    UPDATE workflow_runs
    SET status = 'timed_out',
        finished_at = NOW(),
        last_error = $2,
        last_error_at = NOW(),
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('claimed', 'running')
    RETURNING *
  `,
  pendingRunsBase: `
    SELECT
      wr.*,
      route.agent_id AS routed_agent_id,
      route.priority AS routing_priority,
      route.max_concurrent,
      route.timeout_minutes
    FROM workflow_runs AS wr
    JOIN workflow_agent_routing AS route
      ON route.workflow_type = wr.workflow_type
    WHERE wr.status = 'dispatched'
  `,
  getRun: `
    SELECT
      wr.*,
      route.agent_id AS routed_agent_id,
      route.priority AS routing_priority,
      route.max_concurrent,
      route.timeout_minutes
    FROM workflow_runs AS wr
    LEFT JOIN workflow_agent_routing AS route
      ON route.workflow_type = wr.workflow_type
    WHERE wr.id = $1
    LIMIT 1
  `,
  claimRun: `
    UPDATE workflow_runs AS wr
    SET status = 'claimed',
        owner_agent_id = COALESCE($2, route.agent_id),
        claimed_at = NOW(),
        claimed_by = COALESCE($2, route.agent_id),
        claim_session_id = $3,
        gateway_session_id = $3,
        gateway_session_active = TRUE,
        last_heartbeat_at = NOW(),
        started_at = COALESCE(wr.started_at, NOW()),
        updated_at = NOW()
    FROM workflow_agent_routing AS route
    WHERE wr.id = $1
      AND wr.workflow_type = route.workflow_type
      AND wr.status = 'dispatched'
      AND ($2::text IS NULL OR route.agent_id = $2)
    RETURNING wr.*, route.agent_id AS routed_agent_id, route.priority AS routing_priority, route.max_concurrent, route.timeout_minutes
  `,
  heartbeatRun: `
    UPDATE workflow_runs
    SET last_heartbeat_at = NOW(),
        gateway_session_active = TRUE,
        status = CASE
          WHEN status = 'claimed' THEN 'running'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('claimed', 'running')
      AND claim_session_id = $2
    RETURNING *
  `,
  completeRun: `
    UPDATE workflow_runs
    SET status = 'completed',
        output_summary = COALESCE(output_summary, '{}'::jsonb) || $3::jsonb,
        finished_at = NOW(),
        gateway_session_active = FALSE,
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('claimed', 'running')
      AND ($2::text IS NULL OR claim_session_id = $2)
    RETURNING *
  `,
  stats: `
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
      COUNT(*) FILTER (WHERE status = 'dispatched')::int AS pending_count,
      COUNT(*) FILTER (WHERE status = 'claimed')::int AS claimed_count,
      COUNT(*) FILTER (WHERE status = 'running')::int AS running_count,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
      COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out_count,
      COUNT(*) FILTER (
        WHERE status = 'dispatched'
          AND dispatched_at IS NOT NULL
          AND dispatched_at <= NOW() - INTERVAL '1 millisecond' * $1
      )::int AS stale_unclaimed_count,
      COUNT(*) FILTER (
        WHERE status IN ('claimed', 'running')
          AND COALESCE(last_heartbeat_at, claimed_at) IS NOT NULL
          AND COALESCE(last_heartbeat_at, claimed_at) <= NOW() - INTERVAL '1 millisecond' * $2
      )::int AS stale_claimed_count,
      COUNT(*) FILTER (WHERE dispatched_at IS NOT NULL)::int AS dispatch_count,
      COALESCE(
        AVG(EXTRACT(EPOCH FROM (claimed_at - dispatched_at))) FILTER (
          WHERE claimed_at IS NOT NULL
            AND dispatched_at IS NOT NULL
        ),
        0
      )::float AS average_claim_latency_seconds
    FROM workflow_runs
  `,
  routeCount: `
    SELECT COUNT(*)::int AS route_count
    FROM workflow_agent_routing
  `
};

function isLogger(value) {
  return Boolean(value) && typeof value.log === 'function' && typeof value.error === 'function';
}

function createDefaultPool() {
  return new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'openclaw_dashboard',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD
  });
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampLimit(value, fallback = DEFAULT_OPTIONS.batchSize) {
  const numeric = Math.trunc(toNumber(value, fallback));
  return Math.min(Math.max(numeric, 1), 100);
}

function normalizeRunRow(row) {
  if (!row || row === undefined) return null;

  const inputPayload = parseJson(row.input_payload ?? row.inputPayload, {});
  const outputSummary = parseJson(row.output_summary ?? row.outputSummary, {});
  const workflowType = row.workflow_type ?? row.workflowType ?? null;
  const ownerAgentId = row.owner_agent_id ?? row.ownerAgentId ?? null;
  const targetAgentId = row.target_agent_id ?? row.targetAgentId ?? row.routed_agent_id ?? row.routedAgentId ?? row.agent_id ?? null;
  const currentStep = row.current_step ?? row.currentStep ?? null;
  const dispatchAttempts = toNumber(row.dispatch_attempts ?? row.dispatchAttempts, 0);
  const routingPriority = toNumber(row.routing_priority ?? row.routingPriority, 0);
  const maxConcurrent = toNumber(row.max_concurrent ?? row.maxConcurrent, 1);
  const timeoutMinutes = toNumber(row.timeout_minutes ?? row.timeoutMinutes, 60);
  const claimedBy = row.claimed_by ?? row.claimedBy ?? null;
  const claimSessionId = row.claim_session_id ?? row.claimSessionId ?? null;
  const dispatchedAt = row.dispatched_at ?? row.dispatchedAt ?? null;
  const claimedAt = row.claimed_at ?? row.claimedAt ?? null;
  const lastHeartbeatAt = row.last_heartbeat_at ?? row.lastHeartbeatAt ?? null;
  const createdAt = row.created_at ?? row.createdAt ?? null;
  const updatedAt = row.updated_at ?? row.updatedAt ?? null;
  const startedAt = row.started_at ?? row.startedAt ?? null;
  const finishedAt = row.finished_at ?? row.finishedAt ?? null;
  const gatewaySessionId = row.gateway_session_id ?? row.gatewaySessionId ?? null;
  const gatewaySessionActive = row.gateway_session_active ?? row.gatewaySessionActive ?? false;

  return {
    ...row,
    workflowType,
    workflow_type: workflowType,
    ownerAgentId,
    owner_agent_id: ownerAgentId,
    targetAgentId,
    target_agent_id: targetAgentId,
    currentStep,
    current_step: currentStep,
    inputPayload,
    input_payload: inputPayload,
    outputSummary,
    output_summary: outputSummary,
    dispatchAttempts,
    dispatch_attempts: dispatchAttempts,
    routingPriority,
    routing_priority: routingPriority,
    maxConcurrent,
    max_concurrent: maxConcurrent,
    timeoutMinutes,
    timeout_minutes: timeoutMinutes,
    claimedBy,
    claimed_by: claimedBy,
    claimSessionId,
    claim_session_id: claimSessionId,
    dispatchedAt,
    dispatched_at: dispatchedAt,
    claimedAt,
    claimed_at: claimedAt,
    lastHeartbeatAt,
    last_heartbeat_at: lastHeartbeatAt,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    startedAt,
    started_at: startedAt,
    finishedAt,
    finished_at: finishedAt,
    gatewaySessionId,
    gateway_session_id: gatewaySessionId,
    gatewaySessionActive,
    gateway_session_active: gatewaySessionActive
  };
}

function normalizeStatsRow(row = {}) {
  const queuedCount = toNumber(row.queued_count ?? row.queuedCount, 0);
  const pendingCount = toNumber(row.pending_count ?? row.pendingCount, 0);
  const claimedCount = toNumber(row.claimed_count ?? row.claimedCount, 0);
  const runningCount = toNumber(row.running_count ?? row.runningCount, 0);
  const completedCount = toNumber(row.completed_count ?? row.completedCount, 0);
  const failedCount = toNumber(row.failed_count ?? row.failedCount, 0);
  const timedOutCount = toNumber(row.timed_out_count ?? row.timedOutCount, 0);
  const staleUnclaimedCount = toNumber(row.stale_unclaimed_count ?? row.staleUnclaimedCount, 0);
  const staleClaimedCount = toNumber(row.stale_claimed_count ?? row.staleClaimedCount, 0);
  const dispatchCount = toNumber(row.dispatch_count ?? row.dispatchCount, 0);
  const averageClaimLatencySeconds = Number(toNumber(
    row.average_claim_latency_seconds ?? row.averageClaimLatencySeconds,
    0
  ).toFixed(3));

  return {
    queuedCount,
    queued_count: queuedCount,
    pendingCount,
    pending_count: pendingCount,
    claimedCount,
    claimed_count: claimedCount,
    runningCount,
    running_count: runningCount,
    completedCount,
    completed_count: completedCount,
    failedCount,
    failed_count: failedCount,
    timedOutCount,
    timed_out_count: timedOutCount,
    staleUnclaimedCount,
    stale_unclaimed_count: staleUnclaimedCount,
    staleClaimedCount,
    stale_claimed_count: staleClaimedCount,
    dispatchCount,
    dispatch_count: dispatchCount,
    averageClaimLatencySeconds,
    average_claim_latency_seconds: averageClaimLatencySeconds
  };
}

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

class GatewayWorkflowDispatcherV2 {
  constructor(poolOrOptions, optionsOrLog = {}, maybeLog = console) {
    let pool = poolOrOptions;
    let options = {};
    let log = console;
    let ownsPool = false;

    if (!pool || typeof pool.query !== 'function') {
      options = !isLogger(poolOrOptions) && poolOrOptions ? poolOrOptions : {};
      log = isLogger(optionsOrLog) ? optionsOrLog : maybeLog;
      pool = createDefaultPool();
      ownsPool = true;
    } else if (isLogger(optionsOrLog)) {
      log = optionsOrLog;
    } else {
      options = optionsOrLog || {};
      log = isLogger(maybeLog) ? maybeLog : console;
    }

    this.pool = pool;
    this.ownsPool = ownsPool;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(options || {})
    };
    this.log = log || console;
    this.running = false;
    this.interval = null;
    this.lastTickAt = null;
    this.lastTickError = null;
    this.lastTickSummary = null;
  }

  start() {
    if (this.running) return;

    this.running = true;
    this.log.log('[DispatcherV2] Starting gateway workflow dispatcher v2...');
    this.tick().catch((error) => {
      this.log.error('[DispatcherV2] Initial tick failed:', error.message);
    });
    this.interval = setInterval(() => {
      this.tick().catch((error) => {
        this.log.error('[DispatcherV2] Scheduled tick failed:', error.message);
      });
    }, this.options.pollIntervalMs);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.log.log('[DispatcherV2] Stopped');
  }

  async close() {
    this.stop();
    if (this.ownsPool && this.pool && typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }

  async tick() {
    try {
      const dispatched = await this.dispatchQueuedRuns();
      const retryResult = await this.retryStaleDispatchedRuns();
      const timedOutLongRunning = await this.timeoutLongRunningRuns();
      const released = await this.releaseStaleClaimedRuns();

      this.lastTickAt = new Date().toISOString();
      this.lastTickError = null;
      this.lastTickSummary = {
        dispatchedCount: dispatched.length,
        retriedCount: retryResult.retried.length,
        releasedCount: released.length,
        timedOutCount: retryResult.timedOut.length + timedOutLongRunning.length,
        dispatched,
        retried: retryResult.retried,
        released,
        timedOut: [...retryResult.timedOut, ...timedOutLongRunning]
      };

      return this.lastTickSummary;
    } catch (error) {
      this.lastTickAt = new Date().toISOString();
      this.lastTickError = error.message;
      this.log.error('[DispatcherV2] Error in tick:', error.message);
      throw error;
    }
  }

  /**
   * Wake the main agent via openclaw system event.
   * This tells the agent to check for pending workflow runs on its next heartbeat.
   */
  wakeAgent(run) {
    const workflowType = run.workflowType || run.workflow_type || 'unknown';
    const runId = run.id || 'unknown';
    const targetAgent = run.targetAgentId || run.target_agent_id || run.ownerAgentId || 'unknown';
    
    const eventText = [
      `Workflow run ${runId} dispatched`,
      `Type: ${workflowType}`,
      `Target agent: ${targetAgent}`,
      `Claim via: POST /api/workflow-runs/${runId}/claim`,
      `Input: ${JSON.stringify(run.inputPayload || run.input_payload || {}).slice(0, 200)}`,
    ].join('\n');

    try {
      const result = execSync(
        'openclaw system event --mode now --json --text ' + JSON.stringify(eventText),
        { timeout: 15000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
      const parsed = JSON.parse(result.trim());
      if (parsed.ok) {
        this.log.log('[v2] Agent woken for workflow run', runId);
      } else {
        this.log.error('[v2] Warning: system event returned', parsed);
      }
      return parsed.ok;
    } catch (err) {
      // Don't fail the dispatch if wake fails — the agent will pick it up on next heartbeat
      this.log.error('[v2] Warning: could not wake agent for run', runId, err.message?.slice(0, 100));
      return false;
    }
  }

  async dispatchQueuedRuns(limit = this.options.batchSize) {
    const result = await this.pool.query(SQL.dispatchCandidates, [clampLimit(limit, this.options.batchSize)]);
    const dispatched = [];

    for (const candidate of result.rows) {
      const dispatchResult = await this.pool.query(SQL.markDispatched, [candidate.id, candidate.routed_agent_id]);
      if (dispatchResult.rows[0]) {
        const dispatchedRun = normalizeRunRow({
          ...dispatchResult.rows[0],
          routed_agent_id: candidate.routed_agent_id,
          routing_priority: candidate.routing_priority,
          max_concurrent: candidate.max_concurrent,
          timeout_minutes: candidate.timeout_minutes
        });
        dispatched.push(dispatchedRun);
        
        // Wake the main agent to claim this run
        this.wakeAgent(dispatchedRun);
      }
    }

    return dispatched;
  }

  async retryStaleDispatchedRuns(limit = this.options.batchSize) {
    const result = await this.pool.query(SQL.staleDispatched, [
      this.options.staleDispatchMs,
      clampLimit(limit, this.options.batchSize)
    ]);

    const retried = [];
    const timedOut = [];

    for (const row of result.rows) {
      const normalized = normalizeRunRow(row);
      const attempts = normalized.dispatchAttempts;
      const dispatchedAt = normalized.dispatchedAt ? new Date(normalized.dispatchedAt) : null;
      const ageMs = dispatchedAt ? Date.now() - dispatchedAt.getTime() : Number.POSITIVE_INFINITY;
      const nextRetryWindowMs = this.options.staleDispatchMs * Math.max(1, 2 ** Math.max(attempts - 1, 0));
      const retriesExhausted = Math.max(attempts - 1, 0) >= this.options.maxDispatchRetries;

      if (ageMs < nextRetryWindowMs) {
        continue;
      }

      if (retriesExhausted) {
        const timeoutMessage = `Dispatch retries exhausted after ${attempts} attempts`;
        const timeoutResult = await this.pool.query(SQL.markTimedOutFromDispatched, [normalized.id, timeoutMessage]);
        if (timeoutResult.rows[0]) {
          timedOut.push(normalizeRunRow({
            ...timeoutResult.rows[0],
            routed_agent_id: normalized.targetAgentId,
            routing_priority: normalized.routingPriority,
            max_concurrent: normalized.maxConcurrent,
            timeout_minutes: normalized.timeoutMinutes
          }));
        }
        continue;
      }

      const retryResult = await this.pool.query(SQL.refreshDispatched, [normalized.id, normalized.targetAgentId || normalized.ownerAgentId]);
      if (retryResult.rows[0]) {
        retried.push(normalizeRunRow({
          ...retryResult.rows[0],
          routed_agent_id: normalized.targetAgentId,
          routing_priority: normalized.routingPriority,
          max_concurrent: normalized.maxConcurrent,
          timeout_minutes: normalized.timeoutMinutes
        }));
      }
    }

    return { retried, timedOut };
  }

  async releaseStaleClaimedRuns(limit = this.options.batchSize) {
    const result = await this.pool.query(SQL.staleClaimed, [
      this.options.staleClaimMs,
      clampLimit(limit, this.options.batchSize)
    ]);

    const released = [];
    for (const row of result.rows) {
      const normalized = normalizeRunRow(row);
      const releaseResult = await this.pool.query(SQL.releaseClaimed, [normalized.id, normalized.targetAgentId || normalized.ownerAgentId]);
      if (releaseResult.rows[0]) {
        released.push(normalizeRunRow({
          ...releaseResult.rows[0],
          routed_agent_id: normalized.targetAgentId,
          routing_priority: normalized.routingPriority,
          max_concurrent: normalized.maxConcurrent,
          timeout_minutes: normalized.timeoutMinutes
        }));
      }
    }

    return released;
  }

  async timeoutLongRunningRuns(limit = this.options.batchSize) {
    const result = await this.pool.query(SQL.longRunning, [clampLimit(limit, this.options.batchSize)]);
    const timedOut = [];

    for (const row of result.rows) {
      const normalized = normalizeRunRow(row);
      const timeoutMessage = `Run exceeded timeout of ${normalized.timeoutMinutes} minutes`;
      const timeoutResult = await this.pool.query(SQL.markTimedOutFromClaimed, [normalized.id, timeoutMessage]);
      if (timeoutResult.rows[0]) {
        timedOut.push(normalizeRunRow({
          ...timeoutResult.rows[0],
          routed_agent_id: normalized.targetAgentId,
          routing_priority: normalized.routingPriority,
          max_concurrent: normalized.maxConcurrent,
          timeout_minutes: normalized.timeoutMinutes
        }));
      }
    }

    return timedOut;
  }

  async getPendingRuns({ limit = this.options.batchSize, agentId = null } = {}) {
    const params = [clampLimit(limit, this.options.batchSize)];
    let query = SQL.pendingRunsBase;

    if (agentId) {
      params.unshift(agentId);
      query += '\n      AND route.agent_id = $1\n      ORDER BY route.priority DESC, wr.dispatched_at ASC NULLS LAST, wr.created_at ASC, wr.id ASC\n      LIMIT $2';
    } else {
      query += '\n      ORDER BY route.priority DESC, wr.dispatched_at ASC NULLS LAST, wr.created_at ASC, wr.id ASC\n      LIMIT $1';
    }

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => normalizeRunRow(row));
  }

  async getRun(id) {
    const result = await this.pool.query(SQL.getRun, [id]);
    return normalizeRunRow(result.rows[0] || null);
  }

  async claimRun(id, { agentId = null, sessionId } = {}) {
    if (!sessionId) {
      throw new Error('sessionId is required to claim a workflow run');
    }

    const result = await this.pool.query(SQL.claimRun, [id, agentId, sessionId]);
    return normalizeRunRow(result.rows[0] || null);
  }

  async heartbeatRun(id, { sessionId } = {}) {
    if (!sessionId) {
      throw new Error('sessionId is required to heartbeat a workflow run');
    }

    const result = await this.pool.query(SQL.heartbeatRun, [id, sessionId]);
    return normalizeRunRow(result.rows[0] || null);
  }

  async completeRun(id, { sessionId = null, outputSummary = {} } = {}) {
    const result = await this.pool.query(SQL.completeRun, [id, sessionId, JSON.stringify(outputSummary || {})]);
    return normalizeRunRow(result.rows[0] || null);
  }

  async getStats() {
    const [statsResult, routeCountResult] = await Promise.all([
      this.pool.query(SQL.stats, [this.options.staleDispatchMs, this.options.staleClaimMs]),
      this.pool.query(SQL.routeCount)
    ]);

    const stats = normalizeStatsRow(statsResult.rows[0] || {});
    const routeCount = toNumber(routeCountResult.rows[0]?.route_count, 0);
    const failureRate = stats.dispatchCount > 0
      ? Number(((stats.failedCount + stats.timedOutCount) / stats.dispatchCount).toFixed(4))
      : 0;

    return {
      ...stats,
      routeCount,
      route_count: routeCount,
      failureRate,
      failure_rate: failureRate,
      pollIntervalMs: this.options.pollIntervalMs,
      poll_interval_ms: this.options.pollIntervalMs,
      staleDispatchMs: this.options.staleDispatchMs,
      stale_dispatch_ms: this.options.staleDispatchMs,
      staleClaimMs: this.options.staleClaimMs,
      stale_claim_ms: this.options.staleClaimMs,
      maxDispatchRetries: this.options.maxDispatchRetries,
      max_dispatch_retries: this.options.maxDispatchRetries,
      lastTickAt: this.lastTickAt,
      last_tick_at: this.lastTickAt,
      lastTickError: this.lastTickError,
      last_tick_error: this.lastTickError,
      lastTickSummary: this.lastTickSummary,
      last_tick_summary: this.lastTickSummary
    };
  }

  async handleHttpRequest(req, res, pathname, body = {}) {
    const method = req.method;

    if (method === 'OPTIONS') {
      sendJSON(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/workflow-runs/pending' && method === 'GET') {
      const url = new URL(req.url, `http://${(req.headers && req.headers.host) || 'localhost'}`);
      const runs = await this.getPendingRuns({
        limit: url.searchParams.get('limit') || this.options.batchSize,
        agentId: url.searchParams.get('agent_id') || url.searchParams.get('agentId') || null
      });
      sendJSON(res, 200, { runs });
      return true;
    }

    if (pathname === '/api/workflow-runs/dispatcher/stats' && method === 'GET') {
      const stats = await this.getStats();
      sendJSON(res, 200, stats);
      return true;
    }

    const claimMatch = pathname.match(/^\/api\/workflow-runs\/([^/]+)\/claim$/);
    if (claimMatch && method === 'POST') {
      const id = decodeURIComponent(claimMatch[1]);
      try {
        const run = await this.claimRun(id, {
          agentId: body.agent_id || body.agentId || null,
          sessionId: body.session_id || body.sessionId
        });

        if (!run) {
          const existing = await this.getRun(id);
          if (!existing) {
            sendJSON(res, 404, { error: 'Workflow run not found' });
          } else {
            sendJSON(res, 409, { error: 'Workflow run is no longer available to claim', run: existing });
          }
          return true;
        }

        sendJSON(res, 200, run);
      } catch (error) {
        sendJSON(res, 400, { error: error.message });
      }
      return true;
    }

    const heartbeatMatch = pathname.match(/^\/api\/workflow-runs\/([^/]+)\/heartbeat$/);
    if (heartbeatMatch && method === 'POST') {
      const id = decodeURIComponent(heartbeatMatch[1]);
      try {
        const run = await this.heartbeatRun(id, {
          sessionId: body.session_id || body.sessionId
        });

        if (!run) {
          const existing = await this.getRun(id);
          if (!existing) {
            sendJSON(res, 404, { error: 'Workflow run not found' });
          } else {
            sendJSON(res, 409, { error: 'Workflow run heartbeat rejected', run: existing });
          }
          return true;
        }

        sendJSON(res, 200, run);
      } catch (error) {
        sendJSON(res, 400, { error: error.message });
      }
      return true;
    }

    const completeMatch = pathname.match(/^\/api\/workflow-runs\/([^/]+)\/complete$/);
    if (completeMatch && method === 'POST') {
      const id = decodeURIComponent(completeMatch[1]);
      try {
        const run = await this.completeRun(id, {
          sessionId: body.session_id || body.sessionId || null,
          outputSummary: body.output_summary || body.outputSummary || body || {}
        });

        if (!run) {
          const existing = await this.getRun(id);
          if (!existing) {
            sendJSON(res, 404, { error: 'Workflow run not found' });
          } else {
            sendJSON(res, 409, { error: 'Workflow run could not be completed', run: existing });
          }
          return true;
        }

        sendJSON(res, 200, run);
      } catch (error) {
        sendJSON(res, 400, { error: error.message });
      }
      return true;
    }

    return false;
  }
}

function createGatewayWorkflowDispatcherV2Handler(poolOrDispatcher, optionsOrLog = {}, maybeLog = console) {
  const dispatcher = poolOrDispatcher instanceof GatewayWorkflowDispatcherV2
    ? poolOrDispatcher
    : new GatewayWorkflowDispatcherV2(poolOrDispatcher, optionsOrLog, maybeLog);

  const handler = async function handleGatewayWorkflowDispatcherV2Request(req, res, pathname, body) {
    return dispatcher.handleHttpRequest(req, res, pathname, body);
  };

  handler.dispatcher = dispatcher;
  return handler;
}

module.exports = {
  DEFAULT_OPTIONS,
  GatewayWorkflowDispatcherV2,
  createGatewayWorkflowDispatcherV2Handler,
  normalizeRunRow,
  normalizeStatsRow
};
