/**
 * Action registry — one-click actions slice 1 (docs/briefs/one-click-actions.md §3).
 *
 * Pure data + pure validation helpers. NO database imports, NO route wiring —
 * DB-free tests exercise validateActionEnvelope() directly. The registry is
 * the single place a future action (or the Phase 2 NL command bar's verb
 * mapping) plugs in: one entry per catalog kind declaring severity tier,
 * confirmation mode, backing executor reference name, and governance rule.
 *
 * Confirmation modes (brief §3.2) are picked per severity and DERIVED by
 * consumers (Slice 2 UI, NL bar) — never hardcoded client-side:
 *   NONE          single click                       (LOW only)
 *   PREVIEW_MODAL typed preview card + Confirm       (MEDIUM / MEDIUM-HIGH)
 *   HOLD_CONFIRM  press-and-hold ≥1.2 s              (HIGH: run.cancel)
 */

const { createHash } = require('crypto');

const CONFIRM_MODES = Object.freeze(['NONE', 'PREVIEW_MODAL', 'HOLD_CONFIRM']);
const SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'MEDIUM-HIGH', 'HIGH']);

/** Catalog kinds in registry order (brief §2; mcp-exposure slice 2 appends
 *  the MCP receipt-minted trio — task.create / task.update / snapshot.create). */
const ACTION_KINDS = Object.freeze([
  'task.assign',
  'run.dispatch',
  'approval.decide',
  'run.cancel',
  'run.redispatch',
  'task.create',
  'task.update',
  'snapshot.create',
]);

/**
 * The registry. `executor` is a REFERENCE NAME resolved against the executor
 * map wired in routes/action-routes.js — this module stays DB-free and
 * function-free so tests can assert on data alone.
 *
 * paramsSchema: { field: { type: 'string'|'object', required?: bool,
 *                          enum?: [...] } } — validated by validateParams().
 * budgetProbe: dispatch-class actions probe budget headroom before executing
 * (brief §3.5); all other kinds skip the probe.
 */
const ACTION_REGISTRY = {
  'task.assign': {
    kind: 'task.assign',
    targetType: 'task',
    severity: 'LOW',
    confirmMode: 'NONE',
    executor: 'assignTaskOwner',
    governanceAction: 'reassign_owner',
    budgetProbe: false,
    paramsSchema: {
      owner: { type: 'string', required: true },
    },
    rollbackHint: 'Re-assign to <previous owner>',
  },
  'run.dispatch': {
    kind: 'run.dispatch',
    targetType: 'task',
    severity: 'MEDIUM',
    confirmMode: 'PREVIEW_MODAL',
    executor: 'dispatchRun',
    governanceAction: 'launch_workflow',
    budgetProbe: true,
    paramsSchema: {
      template: { type: 'string', required: true },
      input_payload: { type: 'object', required: false },
    },
    rollbackHint: 'Cancel run {new_run_id} if unwanted',
  },
  'approval.decide': {
    kind: 'approval.decide',
    targetType: 'approval',
    severity: 'MEDIUM-HIGH',
    confirmMode: 'PREVIEW_MODAL',
    executor: 'decideApproval',
    governanceAction: 'approve', // rejected decisions map to 'reject' at execution
    budgetProbe: false,
    paramsSchema: {
      decision: { type: 'string', required: true, enum: ['approved', 'rejected'] },
      notes: { type: 'string', required: false },
    },
    rollbackHint: 'Rejection path: escalate_approval or re-create approval',
  },
  'run.cancel': {
    kind: 'run.cancel',
    targetType: 'run',
    severity: 'HIGH',
    confirmMode: 'HOLD_CONFIRM',
    executor: 'cancelRun',
    governanceAction: 'cancel_run',
    budgetProbe: false,
    paramsSchema: {
      reason: { type: 'string', required: false },
    },
    rollbackHint: 'Re-dispatch via run.redispatch',
  },
  'run.redispatch': {
    kind: 'run.redispatch',
    targetType: 'run',
    severity: 'MEDIUM',
    confirmMode: 'PREVIEW_MODAL',
    executor: 'redispatchRun',
    governanceAction: 'override_failure',
    budgetProbe: true,
    paramsSchema: {},
    rollbackHint: 'Cancel again via run.cancel',
  },

  // ── MCP slice 2 kinds (docs/briefs/mcp-exposure.md §8 OQ2, resolved YES):
  // every agent-side mutation mints a receipt through the same pipeline the
  // dashboard UI uses. Not referenced by any UI button — the MCP server's
  // OPENCLAW_MCP_MUTATIONS=1 flag is the enablement gate.
  'task.create': {
    kind: 'task.create',
    targetType: 'project', // targetId = project_id the task lands in
    severity: 'LOW',
    confirmMode: 'NONE',
    executor: 'createTask',
    governanceAction: 'create_task',
    budgetProbe: false,
    paramsSchema: {
      title: { type: 'string', required: true },
      description: { type: 'string', required: false },
      owner_agent: { type: 'string', required: false },
      status: { type: 'string', required: false },
      due_date: { type: 'string', required: false },
    },
    rollbackHint: 'Archive task {new_task_id} if unwanted',
  },
  'task.update': {
    kind: 'task.update',
    targetType: 'task',
    severity: 'MEDIUM',
    confirmMode: 'PREVIEW_MODAL',
    executor: 'updateTask',
    governanceAction: 'update_task',
    budgetProbe: false,
    paramsSchema: {
      patch: { type: 'object', required: true },
    },
    rollbackHint: 'Re-apply previous values to task {target_id}',
  },
  'snapshot.create': {
    kind: 'snapshot.create',
    targetType: 'snapshot', // targetId = snapshot name (additive-only artifact)
    severity: 'LOW',
    confirmMode: 'NONE',
    executor: 'createSnapshot',
    governanceAction: 'create_snapshot',
    budgetProbe: false,
    paramsSchema: {},
    rollbackHint: 'Snapshots are additive-only; delete the artifact file to reclaim space',
  },
};

/** Governance action actually evaluated for a given envelope params. */
function governanceActionFor(kind, params) {
  if (kind === 'approval.decide' && params && params.decision === 'rejected') return 'reject';
  const entry = ACTION_REGISTRY[kind];
  return entry ? entry.governanceAction : null;
}

/**
 * Static rollback hint per kind; dynamic ids interpolated from detail
 * (brief §3.4). Pure string work — receipts carry hints ONLY.
 */
function rollbackHintFor(kind, detail = {}) {
  const entry = ACTION_REGISTRY[kind];
  if (!entry) return null;
  return entry.rollbackHint.replace(/\{(\w+)\}/g, (m, key) => (
    detail[key] !== undefined && detail[key] !== null ? String(detail[key]) : m
  ));
}

/** Stable stringify: object keys sorted recursively, arrays order-preserving. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** sha256(canonicalJSON(params)) — the envelope paramsHash (brief §3.1). */
function hashParams(params) {
  return createHash('sha256').update(canonicalJson(params ?? {})).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate params against one kind's paramsSchema. Returns error strings. */
function validateParams(kind, params) {
  const errors = [];
  const schema = ACTION_REGISTRY[kind].paramsSchema;
  for (const [field, rule] of Object.entries(schema)) {
    const value = params[field];
    if (value === undefined || value === null || value === '') {
      if (rule.required) errors.push(`params.${field} is required`);
      continue;
    }
    if (rule.type === 'string' && typeof value !== 'string') {
      errors.push(`params.${field} must be a string`);
      continue;
    }
    if (rule.type === 'object' && !isPlainObject(value)) {
      errors.push(`params.${field} must be an object`);
      continue;
    }
    if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
      errors.push(`params.${field} must be one of: ${rule.enum.join(', ')}`);
    }
  }
  return errors;
}

/**
 * Validate a raw ActionEnvelope against the registry (brief §3.1/AC1).
 * Runs BEFORE any permission check or execution. DB-free.
 *
 * @returns {{ok: true, envelope: {actionId, kind, targetId, params,
 *                               paramsHash, actor}} |
 *           {ok: false, errors: string[]}}
 */
function validateActionEnvelope(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['envelope must be an object'] };
  }

  const actionId = typeof raw.actionId === 'string' ? raw.actionId.trim() : '';
  if (!actionId) errors.push('actionId is required');
  else if (/\s/.test(actionId)) errors.push('actionId must not contain whitespace');
  else if (actionId.length > 200) errors.push('actionId must be at most 200 characters');

  const kind = raw.kind;
  if (!ACTION_REGISTRY[kind]) {
    errors.push(`unknown_kind: '${kind}' is not in the action catalog`);
    return { ok: false, errors }; // nothing else is checkable without a registry entry
  }

  const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : '';
  if (!targetId) errors.push(`targetId is required for ${kind}`);
  else if (/\s/.test(targetId)) errors.push('targetId must not contain whitespace');

  let params = raw.params;
  if (params === undefined || params === null) params = {};
  if (!isPlainObject(params)) {
    errors.push('params must be an object');
  } else {
    errors.push(...validateParams(kind, params));
  }

  if (errors.length) return { ok: false, errors };

  const actor = typeof raw.actor === 'string' && raw.actor.trim()
    ? raw.actor.trim()
    : 'dashboard-operator';

  return {
    ok: true,
    envelope: {
      actionId,
      kind,
      targetId,
      params,
      paramsHash: hashParams(params),
      actor,
    },
  };
}

module.exports = {
  ACTION_KINDS,
  ACTION_REGISTRY,
  CONFIRM_MODES,
  SEVERITIES,
  canonicalJson,
  governanceActionFor,
  hashParams,
  rollbackHintFor,
  validateActionEnvelope,
};
