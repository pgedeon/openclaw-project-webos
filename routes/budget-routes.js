/**
 * Budget routes module.
 *
 * Budget Ledger slice 1 (docs/briefs/budget-ledger.md): CRUD + derived ledger
 * read over the migration-022 workflow_runs cost/token columns. Enforcement
 * hooks in the dispatcher are slice 2 and intentionally absent here.
 *
 * Degradation contract copies routes/cost-routes.js verbatim: without
 * PostgreSQL (json_snapshot mode or pool not initialized) every endpoint
 * answers HTTP 200 with `{ available: false, reason: 'no_database' }` instead
 * of erroring; query failures degrade to `{ available: false,
 * reason: 'query_failed' }`. Callers treat `available === false` as the
 * "Budgets unavailable — no database" panel state.
 *
 * The two degrade points resolve through lib/capability-status.js
 * (resolveCapability + toDegradedBody, market-scan 2026-08-30 steal #2
 * pilot): pool absent ⇒ configured:false, thrown query ⇒ verified:false —
 * wire shapes byte-identical to the contract above (pinned by
 * tests/test-budget-routes.js), so this is a refactor with a proof, not a
 * behavior change.
 */
const { decisionFor, pctOfCap } = require('../lib/budget-eval');
const { resolveCapability, toDegradedBody } = require('../lib/capability-status');

const SCOPES = ['agent', 'department', 'project', 'fleet'];
const PERIODS = ['daily', 'weekly', 'monthly'];
const ACTIONS = ['warn', 'pause_new_runs', 'hard_stop'];

function respond(ctx, res, status, body) {
  if (ctx && typeof ctx.sendJSON === 'function') {
    ctx.sendJSON(res, status, body);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function getStorage(ctx) {
  const store = ctx && ctx.asanaStorage;
  const pool = store && store.pool;
  if (!pool || typeof pool.query !== 'function') return null;
  // Storage helpers live on AsanaStorage; json_snapshot storage has pool=null
  // so it never reaches here, but guard the method surface anyway.
  if (typeof store.listBudgets !== 'function') return null;
  return store;
}

function noDatabase(ctx, res, extra = {}) {
  // Pool absent ⇒ the database leg is not configured; verification never
  // ran (null). Resolves to status 'misconfigured' with the pinned house
  // reason 'no_database' — wire shape byte-identical to the hand-rolled
  // body this replaced.
  const cap = resolveCapability('budgets', { declared: true, verified: null, configured: false });
  respond(ctx, res, 200, {
    ...toDegradedBody(cap),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function queryFailed(ctx, res, err, extra = {}) {
  // Pool present (database configured) but the query threw ⇒ verification
  // failed at runtime. Resolves to status 'unreachable' with the pinned
  // house reason 'query_failed' — wire shape byte-identical.
  const cap = resolveCapability('budgets', { declared: true, verified: false, configured: true });
  respond(ctx, res, 200, {
    ...toDegradedBody(cap),
    details: err && err.message ? err.message : String(err),
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function validationError(ctx, res, details) {
  respond(ctx, res, 400, { available: false, error: 'validation_failed', details });
}

/** Validate POST payload; returns { budget } or { errors }. */
function validateCreatePayload(data) {
  const errors = [];
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) errors.push('name is required');

  if (!SCOPES.includes(data.scope)) {
    errors.push(`scope must be one of: ${SCOPES.join(', ')}`);
  }
  if (!PERIODS.includes(data.period)) {
    errors.push(`period must be one of: ${PERIODS.join(', ')}`);
  }
  if (!ACTIONS.includes(data.action_on_exceed)) {
    errors.push(`action_on_exceed must be one of: ${ACTIONS.join(', ')}`);
  }

  // fleet ⇒ scope_id NULL; every other scope requires a target id.
  let scopeId = typeof data.scope_id === 'string' ? data.scope_id.trim() : null;
  if (data.scope === 'fleet') {
    scopeId = null;
  } else if (SCOPES.includes(data.scope) && !scopeId) {
    errors.push('scope_id is required for non-fleet scopes');
  }

  // Cap XOR: exactly one of cap_usd / cap_tokens, both positive numbers.
  const hasUsd = data.cap_usd !== undefined && data.cap_usd !== null;
  const hasTokens = data.cap_tokens !== undefined && data.cap_tokens !== null;
  if (hasUsd === hasTokens) {
    errors.push('exactly one of cap_usd / cap_tokens is required (XOR)');
  }
  let capUsd = null;
  let capTokens = null;
  if (hasUsd) {
    capUsd = Number(data.cap_usd);
    if (!Number.isFinite(capUsd) || capUsd <= 0) errors.push('cap_usd must be a positive number');
  }
  if (hasTokens) {
    capTokens = Number(data.cap_tokens);
    if (!Number.isInteger(capTokens) || capTokens <= 0) errors.push('cap_tokens must be a positive integer');
  }

  if (errors.length) return { errors };
  return {
    budget: {
      name,
      scope: data.scope,
      scope_id: scopeId,
      period: data.period,
      cap_usd: capUsd,
      cap_tokens: capTokens,
      action_on_exceed: data.action_on_exceed,
      active: true,
    },
  };
}

/** Validate PATCH payload; returns { patch } or { errors }. */
function validatePatchPayload(data) {
  const errors = [];
  const patch = {};

  if (data.name !== undefined) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) errors.push('name must be a non-empty string');
    else patch.name = name;
  }
  if (data.action_on_exceed !== undefined) {
    if (!ACTIONS.includes(data.action_on_exceed)) {
      errors.push(`action_on_exceed must be one of: ${ACTIONS.join(', ')}`);
    } else {
      patch.action_on_exceed = data.action_on_exceed;
    }
  }
  if (data.active !== undefined) {
    if (typeof data.active !== 'boolean') errors.push('active must be a boolean');
    else patch.active = data.active;
  }

  // Caps: provide one numeric cap to switch/raise it; the sibling cap is
  // cleared automatically so the table-level XOR CHECK stays satisfied.
  const hasUsd = data.cap_usd !== undefined && data.cap_usd !== null;
  const hasTokens = data.cap_tokens !== undefined && data.cap_tokens !== null;
  if (hasUsd && hasTokens) {
    errors.push('provide at most one of cap_usd / cap_tokens (XOR); the sibling cap is cleared automatically');
  }
  if (hasUsd) {
    const capUsd = Number(data.cap_usd);
    if (!Number.isFinite(capUsd) || capUsd <= 0) errors.push('cap_usd must be a positive number');
    else patch.cap_usd = capUsd;
  }
  if (hasTokens) {
    const capTokens = Number(data.cap_tokens);
    if (!Number.isInteger(capTokens) || capTokens <= 0) errors.push('cap_tokens must be a positive integer');
    else patch.cap_tokens = capTokens;
  }

  if ((data.cap_usd === null || data.cap_tokens === null) && !hasUsd && !hasTokens) {
    errors.push('caps cannot be nulled directly; provide the replacement cap instead');
  }

  if (errors.length) return { errors };
  if (Object.keys(patch).length === 0) {
    return { errors: ['no updatable fields provided (name, action_on_exceed, active, cap_usd, cap_tokens)'] };
  }
  return { patch };
}

/** Derived status string from an evaluate-style decision (brief §3.6). */
function statusFromDecision(decision) {
  if (decision === 'warn') return 'warned';
  if (decision === 'pause_new_runs' || decision === 'hard_stop') return 'breached';
  return 'under';
}

function registerBudgetRoutes(router) {
  // GET /api/budgets — list budgets with derived current-spend + pct-of-cap.
  router.add('GET', '/api/budgets', async (req, res, ctx) => {
    const store = getStorage(ctx);
    if (!store) {
      noDatabase(ctx, res);
      return true;
    }
    try {
      const budgets = await store.listBudgets();
      if (budgets === null) {
        queryFailed(ctx, res, new Error('budgets table unavailable'));
        return true;
      }
      const nowMs = Date.now();
      const items = [];
      for (const budget of budgets) {
        const ledger = await store.getBudgetLedger(budget, { nowMs });
        const spendUsd = ledger ? ledger.spendUsd : 0;
        const spendTokens = ledger ? ledger.spendTokens : 0;
        const decision = decisionFor(budget, spendUsd, spendTokens);
        items.push({
          id: budget.id,
          name: budget.name,
          scope: budget.scope,
          scope_id: budget.scope_id,
          period: budget.period,
          cap_usd: budget.cap_usd,
          cap_tokens: budget.cap_tokens,
          action_on_exceed: budget.action_on_exceed,
          active: budget.active,
          created_at: budget.created_at,
          period_key: ledger ? ledger.periodKey : null,
          current_spend: {
            usd: Math.round(spendUsd * 100) / 100,
            tokens: spendTokens,
            runs: ledger ? ledger.runCount : 0,
          },
          pct_of_cap: pctOfCap(budget, spendUsd, spendTokens),
          status: statusFromDecision(decision),
        });
      }
      respond(ctx, res, 200, { available: true, budgets: items, timestamp: new Date().toISOString() });
    } catch (err) {
      queryFailed(ctx, res, err);
    }
    return true;
  });

  // POST /api/budgets — create; validates enums, cap XOR, fleet ⇒ scope_id NULL.
  router.add('POST', '/api/budgets', async (req, res, ctx) => {
    const data = await parseBody(req);
    const validated = validateCreatePayload(data);
    if (validated.errors) {
      validationError(ctx, res, validated.errors);
      return true;
    }
    const store = getStorage(ctx);
    if (!store) {
      noDatabase(ctx, res);
      return true;
    }
    try {
      const created = await store.createBudget(validated.budget);
      if (!created) {
        queryFailed(ctx, res, new Error('budget create unavailable'));
        return true;
      }
      respond(ctx, res, 201, { available: true, budget: created, timestamp: new Date().toISOString() });
    } catch (err) {
      queryFailed(ctx, res, err);
    }
    return true;
  });

  // PATCH /api/budgets/:id — raise/lower cap, rename, active toggle.
  // These PATCH moves are the only sanctioned "un-pause" actions (brief §2.4):
  // pause state is derived, so recovery is rollover, cap-raise, or deactivate.
  router.add('PATCH', '/api/budgets/:id', async (req, res, ctx, params) => {
    const data = await parseBody(req);
    const validated = validatePatchPayload(data);
    if (validated.errors) {
      validationError(ctx, res, validated.errors);
      return true;
    }
    const store = getStorage(ctx);
    if (!store) {
      noDatabase(ctx, res);
      return true;
    }
    try {
      const updated = await store.updateBudget(params.id, validated.patch);
      if (!updated) {
        respond(ctx, res, 404, { available: false, reason: 'not_found', timestamp: new Date().toISOString() });
        return true;
      }
      respond(ctx, res, 200, { available: true, budget: updated, timestamp: new Date().toISOString() });
    } catch (err) {
      queryFailed(ctx, res, err);
    }
    return true;
  });

  // GET /api/budgets/:id/ledger?period=current — derived current-period spend
  // plus the append-only enforcement event trail for the budget.
  router.add('GET', '/api/budgets/:id/ledger', async (req, res, ctx, params) => {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const period = url.searchParams.get('period') || 'current';
    if (period !== 'current') {
      validationError(ctx, res, [`unsupported period '${period}'; only 'current' is supported in slice 1`]);
      return true;
    }
    const store = getStorage(ctx);
    if (!store) {
      noDatabase(ctx, res);
      return true;
    }
    try {
      const budget = await store.getBudget(params.id);
      if (!budget) {
        respond(ctx, res, 404, { available: false, reason: 'not_found', timestamp: new Date().toISOString() });
        return true;
      }
      const nowMs = Date.now();
      const ledger = await store.getBudgetLedger(budget, { nowMs });
      const events = await store.listBudgetEvents(budget.id, 100);
      const spendUsd = ledger ? ledger.spendUsd : 0;
      const spendTokens = ledger ? ledger.spendTokens : 0;
      const decision = decisionFor(budget, spendUsd, spendTokens);
      respond(ctx, res, 200, {
        available: true,
        budget: {
          id: budget.id,
          name: budget.name,
          scope: budget.scope,
          scope_id: budget.scope_id,
          period: budget.period,
          cap_usd: budget.cap_usd,
          cap_tokens: budget.cap_tokens,
          action_on_exceed: budget.action_on_exceed,
          active: budget.active,
        },
        period_key: ledger ? ledger.periodKey : null,
        window_start: ledger ? ledger.windowStartIso : null,
        spend: {
          usd: Math.round(spendUsd * 100) / 100,
          tokens: spendTokens,
          runs: ledger ? ledger.runCount : 0,
        },
        pct_of_cap: pctOfCap(budget, spendUsd, spendTokens),
        status: statusFromDecision(decision),
        events,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      queryFailed(ctx, res, err);
    }
    return true;
  });
}

module.exports = { registerBudgetRoutes };
