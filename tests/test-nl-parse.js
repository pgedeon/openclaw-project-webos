#!/usr/bin/env node
/**
 * Focused tests for the NL command bar grammar + resolution layer (DB-free):
 * lib/nl-parse.js (pure deterministic grammar) and the exported pure helpers
 * of src/shell/command-palette.mjs (createNlResolver / buildInterpretation /
 * refusalCopy). Run: node tests/test-nl-parse.js
 *
 * Covered (docs/briefs/nl-command-bar.md ACs):
 * - AC-G1 mapping-table parity: every §5 mutating row fixture parses to
 *   exactly {kind, slots/params}; every query-row fixture parses to its
 *   queryIntent with NO kind/targetId/params fields on the result object
 *   (structural never-gate guarantee, §6.1).
 * - AC-G2 precedence: query-verb-first utterances containing mutating verbs
 *   resolve to query/find, never to a kind.
 * - AC-G3 fail-safe defaults: unknown verb / missing slots / empty input →
 *   unmatched statuses that never carry an envelope-shaped payload.
 * - AC-G4 batch/temporal refusal with named reasons; flagship "spawn agent…"
 *   parses to a real task.create envelope (title from the utterance, Q1) and
 *   degrades honestly when no title is extractable.
 * - Misparse safety (§6.3): zero fetches during parsing, no actionId/envelope
 *   in any parse result, deterministic re-parse (same utterance → same
 *   interpretation).
 * - Gating parity (AC-I1 DOM-free half): every grammar kind's confirmMode in
 *   the authoritative registry matches the brief's §5 confirmation column.
 * - AC-G5 resolution discipline: ≤4 read endpoints per parse; stale-sequence
 *   guard drops superseded resolutions.
 * - buildInterpretation shapes: ready model is the ONLY shape carrying
 *   kind+targetId+params together; ambiguous carries candidates but no
 *   targetId/params; refusals carry neither.
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const { parseIntent, grammarKinds } = require('../lib/nl-parse.js');
const registry = require('../lib/action-registry');

async function loadPaletteHelpers() {
  return import(pathToFileURL(path.join(__dirname, '..', 'src', 'shell', 'command-palette.mjs')).href);
}

// ── Fixtures ───────────────────────────────────────────────────

const MUTATING_FIXTURES = [
  // [utterance, kind, params, slotsExpect, topExpect]
  ['assign checkout bug to kaya', 'task.assign', { owner: 'kaya' }, { taskRef: 'checkout bug', agentName: 'kaya' }, {}],
  ['give #abc123 to kaya', 'task.assign', { owner: 'kaya' }, { taskRef: '#abc123', agentName: 'kaya' }, { targetId: 'abc123' }],
  ['run nightly backup on task #42', 'run.dispatch', { template: 'nightly backup' }, {}, { targetId: '42' }],
  ['dispatch import for "checkout bug"', 'run.dispatch', { template: 'import' }, { taskRef: 'checkout bug', quoted: true }, {}],
  ['start cleanup on task 77', 'run.dispatch', { template: 'cleanup' }, { taskRef: '77' }, {}],
  ['approve the deployment request', 'approval.decide', { decision: 'approved' }, { approvalRef: 'deployment request' }, {}],
  ['reject deployment request', 'approval.decide', { decision: 'rejected' }, { approvalRef: 'deployment request' }, {}],
  ['cancel run 4f2a', 'run.cancel', {}, { runRef: '4f2a' }, { targetId: '4f2a' }],
  ['stop run run_9c2e', 'run.cancel', {}, { runRef: 'run_9c2e' }, { targetId: 'run_9c2e' }],
  ['kill run 0b6eea52-1a2b-4c3d-8e4f-aabbccddeeff', 'run.cancel', {}, {}, { targetId: '0b6eea52-1a2b-4c3d-8e4f-aabbccddeeff' }],
  ['retry run 4f2a', 'run.redispatch', {}, { runRef: '4f2a' }, { targetId: '4f2a' }],
  ['re-dispatch run 4f2a', 'run.redispatch', {}, { runRef: '4f2a' }, { targetId: '4f2a' }],
  ['rerun 4f2a', 'run.redispatch', {}, { runRef: '4f2a' }, { targetId: '4f2a' }],
  // Flagship create template (Q1): title extracted from the utterance.
  ['spawn agent for checkout bug, report when done', 'task.create', { title: 'checkout bug, report when done' }, { noun: 'agent' }, {}],
  ['create task for invoices', 'task.create', { title: 'invoices' }, { noun: 'task' }, {}],
  ['add agent for "nightly sync"', 'task.create', { title: 'nightly sync' }, { noun: 'agent', title: 'nightly sync' }, {}],
  ['new task deploy pipeline', 'task.create', { title: 'deploy pipeline' }, { noun: 'task' }, {}],
];

const QUERY_FIXTURES = [
  ["what's running", 'fleet_status'],
  ['fleet status', 'fleet_status'],
  ['show failed runs', 'failed_runs'],
  ['what failed', 'failed_runs'],
  ['pending approvals', 'pending_approvals'],
  ['what needs approval', 'pending_approvals'],
  ['budget status', 'budget_status'],
  ['am I over budget', 'budget_status'],
  ['find task payments', 'find'],
];

const PRECEDENCE_FIXTURES = [
  'show me how to cancel runs',
  'how to cancel runs',
  'status of cancel runs',
  'list ways to approve things',
  'show me how to spawn agents',
];

const FAILSAFE_FIXTURES = [
  ['', 'empty'],
  ['   ', 'empty'],
  ['frobnicate the widget', 'unknown_verb'],
  ['assign checkout bug', 'missing_slot'],      // no agent
  ['run nightly backup', 'missing_slot'],       // no task
  ['approve', 'missing_slot'],                  // no approval ref
  ['cancel', 'missing_target'],                 // no run ref
  ['spawn agent', 'missing_slot'],              // flagship honesty: no title → no envelope
  ['create task', 'missing_slot'],              // same, noun-only utterance
  ['spawn runner for cleanup', 'unknown_verb'], // not the task/agent noun template
];

const REFUSAL_FIXTURES = [
  ['cancel all failed runs', 'batch_not_supported'],
  ['retry every failed run', 'batch_not_supported'],
  ['create tasks for all agents', 'batch_not_supported'],   // create obeys the same one-target rule
  ['every day at 9 cancel runs', 'temporal_not_supported'],
  ['schedule daily backup', 'temporal_not_supported'],
  ['create task every day for backups', 'temporal_not_supported'],
];

/** Envelope-shaped payload must be absent from non-executable results. */
function assertNoEnvelopeShape(res) {
  assert.strictEqual(res.kind, undefined, `no kind on ${JSON.stringify(res)}`);
  assert.strictEqual(res.targetId, undefined, `no targetId on ${JSON.stringify(res)}`);
  assert.strictEqual(res.params, undefined, `no params on ${JSON.stringify(res)}`);
}

// ── Stub api factory ───────────────────────────────────────────

function makeStubApi(overrides = {}) {
  const calls = [];
  const deferred = [];
  function track(name) {
    calls.push(name);
    const d = overrides[name];
    if (d && typeof d.then === 'function') { deferred.push(d); return d; }
    if (typeof d === 'function') return d();
    return Promise.resolve([]);
  }
  return {
    calls,
    tasks: { list: (...a) => track('tasks.list') },
    org: { agents: { list: () => track('org.agents.list') } },
    projects: { getDefault: () => track('projects.getDefault') },
    workflows: {
      templates: () => track('workflows.templates'),
      active: () => track('workflows.active'),
      runs: () => track('workflows.runs'),
    },
    approvals: { pending: () => track('approvals.pending') },
    request: (p) => track(`request:${p}`),
  };
}

function makeApiWith(values) {
  const calls = [];
  const val = (k, fallback) => (k in values ? values[k] : fallback);
  return {
    calls,
    tasks: { list: async () => { calls.push('tasks.list'); return val('tasks', []); } },
    org: { agents: { list: async () => { calls.push('org.agents.list'); return val('agents', []); } } },
    projects: { getDefault: async () => { calls.push('projects.getDefault'); return val('project', null); } },
    workflows: {
      templates: async () => { calls.push('workflows.templates'); return val('templates', []); },
      active: async () => { calls.push('workflows.active'); return val('active', []); },
      runs: async () => { calls.push('workflows.runs'); return val('runs', []); },
    },
    approvals: { pending: async () => { calls.push('approvals.pending'); return val('pending', []); } },
    request: async (p) => { calls.push(`request:${p}`); return val('budgets', []); },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Test groups ────────────────────────────────────────────────

function testRegistryParity() {
  // Grammar covers exactly the six gated kinds of the §5 mapping table
  // (Q1: task.create joined via the flagship create template).
  assert.deepStrictEqual(
    [...grammarKinds()].sort(),
    ['approval.decide', 'run.cancel', 'run.dispatch', 'run.redispatch', 'task.assign', 'task.create']
  );
  // Every verb row maps to a kind that exists in the authoritative registry.
  for (const kind of grammarKinds()) {
    assert.ok(registry.ACTION_REGISTRY[kind], `${kind} exists in lib/action-registry.js`);
  }
  // Gating parity (AC-I1 DOM-free half): confirmMode per kind matches the
  // brief's §5 confirmation column — derived from the registry, never local.
  const expectedModes = {
    'task.assign': 'NONE',
    'run.dispatch': 'PREVIEW_MODAL',
    'approval.decide': 'PREVIEW_MODAL',
    'run.cancel': 'HOLD_CONFIRM',
    'run.redispatch': 'PREVIEW_MODAL',
    // Q1 resolution: creation is reversible (archive) → LOW/NONE tier.
    'task.create': 'NONE',
  };
  for (const [kind, mode] of Object.entries(expectedModes)) {
    assert.strictEqual(registry.ACTION_REGISTRY[kind].confirmMode, mode, `${kind} gate tier`);
  }
}

function testMutatingMappingParity() {
  for (const [utterance, kind, params, slotExpect, topExpect] of MUTATING_FIXTURES) {
    const res = parseIntent(utterance);
    assert.ok(!res.unmatched, `'${utterance}' should parse as an action, got ${JSON.stringify(res)}`);
    assert.strictEqual(res.kind, kind, `'${utterance}' kind`);
    for (const [k, v] of Object.entries(params)) {
      assert.deepStrictEqual(res.params?.[k], v, `'${utterance}' params.${k}`);
    }
    for (const [k, v] of Object.entries(slotExpect)) {
      assert.deepStrictEqual(res.slots?.[k], v, `'${utterance}' slots.${k}`);
    }
    for (const [k, v] of Object.entries(topExpect)) {
      assert.deepStrictEqual(res[k], v, `'${utterance}' ${k}`);
    }
  }
}

function testQueryPurity() {
  for (const [utterance, qtype] of QUERY_FIXTURES) {
    const res = parseIntent(utterance);
    assert.ok(res.queryOnly, `'${utterance}' should be a query intent`);
    assert.strictEqual(res.queryOnly.type, qtype, `'${utterance}' query type`);
    // Structural never-gate guarantee (§6.1): no kind field can exist.
    assertNoEnvelopeShape(res);
  }
}

function testPrecedence() {
  for (const utterance of PRECEDENCE_FIXTURES) {
    const res = parseIntent(utterance);
    assert.ok(!res.kind, `'${utterance}' must never map to a mutating kind`);
    assert.ok(res.queryOnly || res.unmatched, `'${utterance}' resolves to query/search`);
  }
  const r = parseIntent('show me how to cancel runs');
  assert.strictEqual(r.queryOnly.type, 'find');
}

function testFailSafeDefaults() {
  for (const [utterance, reason] of FAILSAFE_FIXTURES) {
    const res = parseIntent(utterance);
    assert.strictEqual(res.unmatched, true, `'${utterance}' unmatched`);
    assert.strictEqual(res.reason, reason, `'${utterance}' named reason`);
    assertNoEnvelopeShape(res);
  }
}

function testBatchTemporalAndFlagshipRefusals() {
  for (const [utterance, reason] of REFUSAL_FIXTURES) {
    const res = parseIntent(utterance);
    assert.strictEqual(res.unmatched, true, `'${utterance}' refused`);
    assert.strictEqual(res.reason, reason, `'${utterance}' refusal reason`);
    assertNoEnvelopeShape(res);
  }
}

function testMisparseSafetyZeroFetch() {
  let fetchCalls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { fetchCalls += 1; return origFetch(...args); };
  try {
    // Deliberately wrong-slotted prose: looks like a cancel command but the
    // "ref" is a template name — the honest wrong interpretation renders as a
    // preview only; parsing itself must touch the network ZERO times.
    const wrong = parseIntent('cancel run import batch');
    assert.ok(!wrong.unmatched && wrong.kind === 'run.cancel');
    assert.strictEqual(wrong.slots.targetId, undefined, 'prose ref stays unresolved at grammar level');
    assert.strictEqual(wrong.actionId, undefined, 'no actionId minted at parse time');
    assert.ok(!JSON.stringify(wrong).includes('actionId'), 'serialized parse carries no actionId');
    assert.strictEqual(fetchCalls, 0, 'zero fetches during parsing');

    // Determinism (misparse provability): same utterance → same interpretation.
    assert.deepStrictEqual(parseIntent('cancel run import batch'), wrong);
    assert.deepStrictEqual(parseIntent('assign checkout bug to kaya'), parseIntent('assign checkout bug to kaya'));
    assert.strictEqual(fetchCalls, 0, 'still zero fetches');
  } finally {
    globalThis.fetch = origFetch;
  }
}

async function testResolutionDiscipline(palette) {
  const { createNlResolver } = palette;

  // Endpoint counts per parse kind — every grammar kind stays ≤4 reads.
  const cases = [
    ['task.assign', parseIntent('assign checkout bug to kaya'), ['tasks.list', 'org.agents.list']],
    ['run.dispatch', parseIntent('run nightly backup on task #42'), ['tasks.list', 'workflows.templates']],
    ['approval.decide', parseIntent('approve deployment request'), ['approvals.pending']],
    ['run.cancel', parseIntent('cancel run 4f2a'), ['workflows.active', 'workflows.runs']],
    ['run.redispatch', parseIntent('retry run 4f2a'), ['workflows.runs']],
    ['task.create', parseIntent('create task for invoices'), ['projects.getDefault']],
  ];
  for (const [kind, parse, allowed] of cases) {
    const api = makeStubApi();
    const resolver = createNlResolver(api);
    await resolver.resolve(parse);
    assert.ok(api.calls.length <= 4, `${kind} issues ≤4 read calls (got ${api.calls.length})`);
    for (const call of api.calls) {
      assert.ok(allowed.includes(call), `${kind} unexpected read: ${call}`);
    }
  }

  // Stale-sequence guard: a superseded resolution lands stale:true and the
  // latest one lands stale:false (only the latest may render). ONE resolver
  // instance — the seq guard lives per-resolver.
  let releaseSlow;
  const slowActive = new Promise((res) => { releaseSlow = res; });
  let activeCall = 0;
  const seqApi = makeApiWith({ runs: [] });
  seqApi.workflows.active = async () => {
    activeCall += 1;
    return activeCall === 1 ? slowActive : [{ id: 'run_4f2a', status: 'running', workflow_type: 'import' }];
  };
  const resolver = createNlResolver(seqApi);
  const slow = resolver.resolve(parseIntent('cancel run 4f2a'));
  const fast = resolver.resolve(parseIntent('cancel run 4f2a'));
  const fastRes = await fast;
  assert.strictEqual(fastRes.stale, false);
  assert.strictEqual(fastRes.status, 'resolved');
  releaseSlow([]);
  const slowRes = await slow;
  assert.strictEqual(slowRes.stale, true, 'superseded resolution marked stale');
}

async function testBuildInterpretationShapes(palette) {
  const { buildInterpretation } = palette;

  // Ready model: the ONLY shape carrying kind+targetId+params together.
  const cancelParse = parseIntent('cancel run 4f2a');
  const ready = buildInterpretation(cancelParse, {
    status: 'resolved',
    target: { id: 'run_4f2a99aa', status: 'running', workflow_type: 'Import batch 42' },
    params: {},
  });
  assert.strictEqual(ready.status, 'ready');
  assert.strictEqual(ready.kind, 'run.cancel');
  assert.strictEqual(ready.targetId, 'run_4f2a99aa');
  assert.deepStrictEqual(ready.params, {});
  assert.match(ready.headline, /Will cancel run/);
  assert.match(ready.warning, /destroys paid in-flight work/);
  assert.strictEqual(ready.rollbackHint, registry.ACTION_REGISTRY['run.cancel'].rollbackHint);

  const assignParse = parseIntent('assign checkout bug to kaya');
  const assignReady = buildInterpretation(assignParse, {
    status: 'resolved',
    target: { id: 't1', title: 'Checkout bug' },
    params: { owner: 'Kaya' },
  });
  assert.strictEqual(assignReady.params.owner, 'Kaya');
  assert.match(assignReady.headline, /Kaya/);

  // Create ready model: title preview + default-project context (Q1).
  const createParse = parseIntent('spawn agent for checkout bug, report when done');
  const createReady = buildInterpretation(createParse, {
    status: 'resolved',
    target: { id: 'proj_1', name: 'Ops' },
    params: { title: 'checkout bug, report when done' },
  });
  assert.strictEqual(createReady.status, 'ready');
  assert.strictEqual(createReady.kind, 'task.create');
  assert.strictEqual(createReady.targetId, 'proj_1');
  assert.deepStrictEqual(createReady.params, { title: 'checkout bug, report when done' });
  assert.match(createReady.headline, /Will create “checkout bug, report when done” in Ops/);
  assert.strictEqual(createReady.rollbackHint, registry.ACTION_REGISTRY['task.create'].rollbackHint);

  // Ambiguous model: candidates present, envelope fields absent.
  const ambiguous = buildInterpretation(cancelParse, {
    status: 'ambiguous', noun: 'run',
    candidates: [{ id: 'run_a', label: 'A' }, { id: 'run_b', label: 'B' }],
  });
  assert.strictEqual(ambiguous.status, 'ambiguous');
  assert.strictEqual(ambiguous.candidates.length, 2);
  assert.strictEqual(ambiguous.targetId, undefined);
  assert.strictEqual(ambiguous.params, undefined);

  // Refusal models: no envelope shape at all.
  for (const resolution of [
    { status: 'unmatched', reason: 'unknown_agent', agentName: 'zzz' },
    { status: 'unmatched', reason: 'unknown_template', templateName: 'zzz' },
    { status: 'not_found', noun: 'run' },
    { status: 'error', reason: 'resolution_failed', detail: 'boom' },
  ]) {
    const model = buildInterpretation(cancelParse, resolution);
    assert.strictEqual(model.status, 'refusal');
    assert.strictEqual(model.kind, undefined);
    assert.strictEqual(model.targetId, undefined);
    assert.strictEqual(model.params, undefined);
  }

  // Stale resolutions render nothing.
  assert.strictEqual(buildInterpretation(cancelParse, { status: 'resolved', stale: true }).status, 'stale');

  // Refusal copy names the reasons honestly.
  const { refusalCopy } = palette;
  assert.ok(refusalCopy('batch_not_supported')[0].includes('Batch'));
  assert.ok(refusalCopy('temporal_not_supported')[1].includes('Cron'));
  assert.ok(refusalCopy('unknown_agent', { agentName: 'zzz' })[0].includes('zzz'));
}

async function testStatusGuardsMatchButtonFilters(palette) {
  const { createNlResolver } = palette;

  // Cancel offers running/queued/waiting rows only — failed rows excluded.
  const api = makeApiWith({
    active: [
      { id: 'run_ok', status: 'running', workflow_type: 'alpha' },
      { id: 'run_dead', status: 'failed', workflow_type: 'beta' },
    ],
    runs: [{ id: 'run_q', status: 'queued', workflow_type: 'gamma' }],
  });
  const res = await createNlResolver(api).resolve(parseIntent('cancel run'));
  assert.strictEqual(res.status, 'ambiguous'); // two cancellable rows match ''
  assert.strictEqual(res.candidates.length, 2, 'failed row not offered for cancel');

  // Redispatch offers failed rows only.
  const api2 = makeApiWith({
    runs: [
      { id: 'run_f', status: 'failed', workflow_type: 'alpha' },
      { id: 'run_r', status: 'running', workflow_type: 'beta' },
    ],
  });
  const res2 = await createNlResolver(api2).resolve(parseIntent('retry run alpha'));
  assert.strictEqual(res2.status, 'resolved');
  assert.strictEqual(res2.target.id, 'run_f');
}

// ── Runner ─────────────────────────────────────────────────────

(async function main() {
  let passed = 0;
  let failed = 0;
  let palette;
  try {
    palette = await loadPaletteHelpers();
  } catch (err) {
    console.error('FAIL module import');
    console.error(err);
    process.exit(1);
  }
  const tests = [
    ['registry parity + gating tiers (AC-I1 trace)', () => testRegistryParity()],
    ['AC-G1 mutating mapping-table parity', () => testMutatingMappingParity()],
    ['AC-G1 query purity (no kind field)', () => testQueryPurity()],
    ['AC-G2 query-verb precedence over mutating verbs', () => testPrecedence()],
    ['AC-G3 fail-safe defaults carry no envelope shape', () => testFailSafeDefaults()],
    ['AC-G4 batch/temporal/flagship refusals', () => testBatchTemporalAndFlagshipRefusals()],
    ['misparse safety: zero fetch + determinism (§6.3)', () => testMisparseSafetyZeroFetch()],
    ['AC-G5 resolution discipline + stale guard', () => testResolutionDiscipline(palette)],
    ['interpretation model shapes (§3)', () => testBuildInterpretationShapes(palette)],
    ['status guards match button filters (§5)', () => testStatusGuardsMatchButtonFilters(palette)],
  ];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(err);
    }
  }
  console.log(`\n${passed}/${tests.length} assertion groups passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
