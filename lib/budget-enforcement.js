/**
 * Budget enforcement gate — dispatcher-side budget evaluation (slice 2).
 *
 * Used by gateway-workflow-dispatcher-v2.js between the dispatchCandidates
 * SELECT and markDispatched (and around the stale-dispatch retry path) to
 * enforce ACTIVE budgets from migration 023 against each candidate run.
 * Design: docs/briefs/budget-ledger.md §3 (enforcement points).
 *
 * Cost contract (brief §3.4):
 * - Active budgets + agent→department memberships load once per TTL window
 *   (default 30s = one poll interval), not once per candidate.
 * - Spend derives from the migration-022 workflow_runs columns with the same
 *   COALESCE(reported_at, started_at, created_at) >= date_trunc bucketing as
 *   routes/cost-routes.js and storage/asana.js getBudgetLedger() — one
 *   aggregate query per (scope-hit, period), cached for the TTL. No N+1s.
 *
 * Degradation contract: every method is no-throw. Without PostgreSQL, when
 * the budgets tables are missing (migration unapplied), or on any query
 * failure, checkRun() resolves null and callers fail OPEN — enforcement OFF,
 * dispatch behaves exactly as before. Zero active budgets is equally inert.
 *
 * Event kinds match the shipped migration-023 CHECK:
 * ('warned','paused','hard_stopped','recovered'). Every emission is
 * idempotent via UNIQUE (budget_id, period_key, event_kind) +
 * ON CONFLICT DO NOTHING; insertEvent returns the row only when it actually
 * inserted so callers can latch notifications on it.
 */

const { decisionFor, mostRestrictive, periodKey, periodWindowStartMs } = require('./budget-eval');

const DEFAULT_TTL_MS = 30_000;

// Breach action → budget_events.event_kind (migration 023 CHECK values).
const EVENT_KINDS = Object.freeze({
  warn: 'warned',
  pause_new_runs: 'paused',
  hard_stop: 'hard_stopped',
});

function normalizeBudgetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    scope_id: row.scope_id || null,
    period: row.period,
    cap_usd: row.cap_usd == null ? null : Number(row.cap_usd),
    cap_tokens: row.cap_tokens == null ? null : Number(row.cap_tokens),
    action_on_exceed: row.action_on_exceed,
    active: row.active === true,
    created_at: row.created_at || null,
  };
}

/**
 * SQL scope predicate mapping a budget scope onto workflow_runs — mirrors
 * storage/asana.js _budgetScopePredicate so API-derived spend and dispatcher
 * enforcement can never disagree about who a budget covers.
 * Appends bound parameters to `params`.
 */
function scopePredicate(scopeType, scopeId, params) {
  switch (scopeType) {
    case 'agent':
      params.push(scopeId);
      return `owner_agent_id = $${params.length}`;
    case 'department':
      params.push(scopeId);
      return `owner_agent_id IN (SELECT agent_id FROM agent_profiles WHERE department_id::text = $${params.length})`;
    case 'project':
      params.push(scopeId);
      return `workflow_type = $${params.length}`;
    default: // fleet — all rows
      return 'TRUE';
  }
}

/**
 * Create a budget enforcement gate over a pg pool.
 *
 * @param {object} pool - pg Pool (or pool-like with async query(sql, params))
 * @param {object} [options]
 * @param {number} [options.ttlMs=30000] - cache TTL; the dispatcher passes its
 *   pollIntervalMs so staleness is bounded by one tick (brief §3.4)
 * @param {object} [options.log] - logger with error(); defaults to console
 */
function createBudgetEnforcement(pool, options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) && options.ttlMs >= 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const log = options.log && typeof options.log.error === 'function' ? options.log : console;

  // { budgets, departmentsByAgent|null, expiresAt } — null until first load;
  // failures are never cached so a recovered DB re-enables on the next call.
  let budgetsCache = null;
  // key `${scopeType}:${scopeId||''}:${period}` → { spendUsd, spendTokens, periodKey, expiresAt }
  const spendCache = new Map();

  function warn(message) {
    if (typeof log.warn === 'function') log.warn(message);
    else log.error(message);
  }

  /** Load ACTIVE budgets (+ department memberships when needed), TTL-cached. */
  async function loadActiveBudgets(now) {
    if (budgetsCache && budgetsCache.expiresAt > now) return budgetsCache;

    const budgetsResult = await pool.query(
      `SELECT id, name, scope, scope_id, period, cap_usd, cap_tokens,
              action_on_exceed, active, created_at
       FROM budgets
       WHERE active = TRUE
       ORDER BY created_at DESC, id DESC`
    );
    const budgets = (budgetsResult.rows || []).map(normalizeBudgetRow).filter(Boolean);

    let departmentsByAgent = null;
    if (budgets.some((b) => b.scope === 'department')) {
      // Department membership comes from the migration-006/007 org model.
      // An agent without a profile row escapes department budgets silently
      // (brief R4) — fleet/agent/project scopes still cover it.
      const profiles = await pool.query(
        `SELECT agent_id, department_id::text AS department_id
         FROM agent_profiles
         WHERE department_id IS NOT NULL`
      );
      departmentsByAgent = new Map();
      for (const row of profiles.rows || []) {
        if (row.agent_id != null) {
          departmentsByAgent.set(String(row.agent_id), String(row.department_id));
        }
      }
    }

    budgetsCache = { budgets, departmentsByAgent, expiresAt: now + ttlMs };
    return budgetsCache;
  }

  /**
   * Derived spend for one scope hit over one period bucket, TTL-cached.
   * Same aggregate shape as storage/asana.js getBudgetLedger().
   */
  async function spendForScope(scopeType, scopeId, period, now) {
    const cacheKey = `${scopeType}:${scopeId == null ? '' : scopeId}:${period}`;
    const cached = spendCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached;

    const windowStartMs = periodWindowStartMs(period, now);
    const params = [new Date(windowStartMs).toISOString()];
    const predicate = scopePredicate(scopeType, scopeId, params);
    const result = await pool.query(
      `SELECT COALESCE(SUM(cost_estimate), 0)::float8 AS spend_usd,
              COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS spend_tokens,
              COUNT(*)::int AS run_count
       FROM workflow_runs
       WHERE ${predicate}
         AND COALESCE(reported_at, started_at, created_at) >= $1::timestamptz`,
      params
    );
    const row = result.rows[0] || {};
    const entry = {
      spendUsd: Number(row.spend_usd || 0),
      spendTokens: Number(row.spend_tokens || 0),
      runCount: Number(row.run_count || 0),
      key: periodKey(period, now),
      expiresAt: now + ttlMs,
    };
    spendCache.set(cacheKey, entry);
    return entry;
  }

  /**
   * Idempotent event insert — ON CONFLICT DO NOTHING semantics, same latch as
   * storage/asana.js recordBudgetEvent(). Resolves the inserted row, or null
   * on duplicate / failure / no database (never throws).
   */
  async function insertEvent(budgetId, pk, eventKind, detail) {
    try {
      const result = await pool.query(
        `INSERT INTO budget_events (budget_id, period_key, event_kind, detail)
         VALUES ($1::uuid, $2, $3, $4::jsonb)
         ON CONFLICT (budget_id, period_key, event_kind) DO NOTHING
         RETURNING id, budget_id, period_key, event_kind, detail, created_at`,
        [budgetId, pk, eventKind, detail ? JSON.stringify(detail) : null]
      );
      return (result.rows && result.rows[0]) || null;
    } catch (error) {
      warn(`[budget-enforcement] recordBudgetEvent failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Lazy rollover marker (brief §2.3's period_reset, shipped as 'recovered'):
   * when prior-period enforcement events exist, write one 'recovered' row for
   * the current period before recording new events, keeping the audit chain
   * unbroken across rollovers without a cron job. No-throw.
   */
  async function ensureRecoveredMarker(budget, currentPk) {
    try {
      const prior = await pool.query(
        `SELECT period_key FROM budget_events
         WHERE budget_id = $1::uuid AND period_key <> $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [budget.id, currentPk]
      );
      const previousPk = prior.rows && prior.rows[0] ? prior.rows[0].period_key : null;
      if (!previousPk) return;
      await insertEvent(budget.id, currentPk, 'recovered', {
        previous_period_key: previousPk,
        note: 'period rolled over after prior-period enforcement events',
      });
    } catch (error) {
      warn(`[budget-enforcement] recovered-marker check failed: ${error.message}`);
    }
  }

  /**
   * Record breach events for every breached budget entry, idempotently.
   * @param {Array<{budget, decision, key, spendUsd, spendTokens}>} breached
   * @param {'warn'|'pause_new_runs'|'hard_stop'} action - winning action
   * @param {object} [extraDetail] - merged into every event detail (e.g. run_ids)
   * @returns {number} rows actually inserted (0 when everything was latched)
   */
  async function recordBreachEvents(breached, action, extraDetail = {}) {
    const eventKind = EVENT_KINDS[action];
    if (!eventKind) return 0;
    let inserted = 0;
    for (const entry of breached || []) {
      await ensureRecoveredMarker(entry.budget, entry.key);
      const row = await insertEvent(entry.budget.id, entry.key, eventKind, {
        action: entry.decision,
        spend_usd: Math.round(entry.spendUsd * 1e6) / 1e6,
        spend_tokens: entry.spendTokens,
        cap_usd: entry.budget.cap_usd ?? null,
        cap_tokens: entry.budget.cap_tokens ?? null,
        source: 'dispatcher',
        ...extraDetail,
      });
      if (row) inserted += 1;
    }
    return inserted;
  }

  /**
   * Hard stop: status-guarded bulk cancel of in-flight runs covered by each
   * breached hard_stop budget (brief §3.3). Completed/failed/cancelled runs
   * are untouched by the status guard; re-ticks find nothing to cancel, so
   * the cancel itself is idempotent.
   * @returns {Promise<Array<{budgetId, cancelledRunIds}>>}
   */
  async function hardStopInFlight(breached) {
    const results = [];
    for (const entry of breached || []) {
      if (entry.decision !== 'hard_stop') continue;
      const reason = `Budget hard stop: ${entry.budget.name} (${entry.key})`;
      try {
        const params = [];
        const predicate = scopePredicate(entry.budget.scope, entry.budget.scope_id, params);
        params.push(reason);
        const result = await pool.query(
          `UPDATE workflow_runs
           SET status = 'cancelled',
               finished_at = NOW(),
               last_error = $${params.length},
               last_error_at = NOW(),
               gateway_session_active = FALSE,
               updated_at = NOW()
           WHERE ${predicate}
             AND status IN ('dispatched', 'claimed', 'running')
           RETURNING id`,
          params
        );
        const cancelledRunIds = (result.rows || []).map((r) => r.id);
        results.push({ budgetId: entry.budget.id, cancelledRunIds });
        await ensureRecoveredMarker(entry.budget, entry.key);
        await insertEvent(entry.budget.id, entry.key, 'hard_stopped', {
          action: 'hard_stop',
          spend_usd: Math.round(entry.spendUsd * 1e6) / 1e6,
          spend_tokens: entry.spendTokens,
          cap_usd: entry.budget.cap_usd ?? null,
          cap_tokens: entry.budget.cap_tokens ?? null,
          last_error: reason,
          cancelled_run_ids: cancelledRunIds,
          source: 'dispatcher',
        });
      } catch (error) {
        warn(`[budget-enforcement] hard-stop cancel failed for budget ${entry.budget.id}: ${error.message}`);
      }
    }
    return results;
  }

  /**
   * Evaluate one candidate/retry run against ACTIVE budgets covering its
     scope chain: agent → department → project(workflow_type) → fleet.
   * Overlapping breached budgets resolve to the most restrictive action
   * (hard_stop > pause_new_runs > warn, brief §2.1).
   *
   * @param {{agentId?:string|null, workflowType?:string|null}} runRef -
   *   agentId is the ROUTED agent (routed_agent_id, falling back to
   *   owner_agent_id); queued runs have owner NULL until markDispatched.
   * @returns {null|{action:'ok'|'warn'|'pause_new_runs'|'hard_stop',
   *   breached:Array, evaluated:boolean}} null = enforcement unavailable
   *   (fail open); evaluated:false = zero active budgets (inert fast path)
   */
  async function checkRun(runRef, opts = {}) {
    const now = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    try {
      const cache = await loadActiveBudgets(now);
      const budgets = cache.budgets;
      if (!budgets.length) {
        return { action: 'ok', breached: [], evaluated: false };
      }

      const agentId = runRef && runRef.agentId != null ? String(runRef.agentId) : null;
      const workflowType = runRef && runRef.workflowType != null ? String(runRef.workflowType) : null;
      const departmentId = agentId && cache.departmentsByAgent
        ? cache.departmentsByAgent.get(agentId) || null
        : null;

      // Scope chain in specificity order; only scopes actually covered by an
      // active budget trigger a spend query.
      const scopes = [];
      const consider = (scopeType, scopeId) => {
        const covered = budgets.some((b) => b.scope === scopeType
          && (scopeType === 'fleet' || b.scope_id === scopeId));
        if (!covered) return;
        const key = `${scopeType}:${scopeId == null ? '' : scopeId}`;
        if (!scopes.some((s) => s.key === key)) scopes.push({ scopeType, scopeId, key });
      };
      consider('agent', agentId);
      consider('department', departmentId);
      consider('project', workflowType);
      consider('fleet', null);

      const breached = [];
      for (const scope of scopes) {
        const covering = budgets.filter((b) => b.scope === scope.scopeType
          && (scope.scopeType === 'fleet' || b.scope_id === scope.scopeId));
        // One spend query per distinct period among the covering budgets.
        const spends = new Map();
        for (const budget of covering) {
          if (!spends.has(budget.period)) {
            spends.set(budget.period, await spendForScope(scope.scopeType, scope.scopeId, budget.period, now));
          }
        }
        for (const budget of covering) {
          const spend = spends.get(budget.period);
          const decision = decisionFor(budget, spend.spendUsd, spend.spendTokens);
          if (decision !== 'ok') {
            breached.push({
              budget,
              decision,
              key: spend.key,
              spendUsd: spend.spendUsd,
              spendTokens: spend.spendTokens,
            });
          }
        }
      }

      const action = mostRestrictive(breached.map((b) => b.decision)) || 'ok';
      return { action, breached, evaluated: true };
    } catch (error) {
      // No PostgreSQL / migration missing / transient failure → fail OPEN.
      warn(`[budget-enforcement] checkRun unavailable, enforcement OFF: ${error.message}`);
      return null;
    }
  }

  /** Drop all cached state (budgets + spend aggregates). Test hook. */
  function clearCache() {
    budgetsCache = null;
    spendCache.clear();
  }

  return {
    checkRun,
    recordBreachEvents,
    hardStopInFlight,
    clearCache,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  EVENT_KINDS,
  createBudgetEnforcement,
  normalizeBudgetRow,
  scopePredicate,
};
