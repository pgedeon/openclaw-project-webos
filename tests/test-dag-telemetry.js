#!/usr/bin/env node
/**
 * DB-free tests for scripts/dag-telemetry-counter.js — pure evaluation only:
 *   evaluateDagTelemetry(rows, nowMs)
 *     → {renderDays, opens, helpfulUp, helpfulDown, templates,
 *        branch: 'go'|'no_go'|'middle', daysRemaining}
 *
 * Covers the brief §6 branch rule boundaries (GO ≥8 days AND ≥3 asks;
 * NO-GO <4 days AND 0 asks; middle otherwise), window filtering
 * (since 2026-08-25), pg Date vs ISO-string timestamps, JSONB object vs
 * JSON-string new_value, malformed-row tolerance, and daysRemaining clamping.
 *
 * Run: node tests/test-dag-telemetry.js
 */

const assert = require('assert');
const {
  evaluateDagTelemetry,
  evaluateBranch,
  computeDaysRemaining,
  WINDOW_START_ISO,
  WINDOW_DAYS,
} = require('../scripts/dag-telemetry-counter.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse(WINDOW_START_ISO); // 2026-08-25T00:00:00Z

function openRow(dayOffset, template, extra = {}) {
  return {
    action: 'workflow-graph-open',
    timestamp: new Date(START + dayOffset * DAY_MS + 3600 * 1000),
    new_value: { template },
    ...extra,
  };
}

function feedbackRow(dayOffset, template, helpful) {
  return {
    action: 'workflow-graph-feedback',
    timestamp: new Date(START + dayOffset * DAY_MS + 7200 * 1000),
    new_value: { template, helpful },
  };
}

/** N opens on N distinct UTC days. */
function opensOnDistinctDays(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(openRow(i, `template-${i % 3}`));
  return rows;
}

// ── Branch rule boundaries ──────────────────────────────────────────────────

check('empty rows → zeros, no_go branch, full window remaining at start', () => {
  const r = evaluateDagTelemetry([], START);
  assert.deepStrictEqual(
    { renderDays: r.renderDays, opens: r.opens, helpfulUp: r.helpfulUp, helpfulDown: r.helpfulDown, templates: r.templates, branch: r.branch, daysRemaining: r.daysRemaining },
    { renderDays: 0, opens: 0, helpfulUp: 0, helpfulDown: 0, templates: [], branch: 'no_go', daysRemaining: WINDOW_DAYS }
  );
});

check('null/undefined/non-array rows treated as empty', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const r = evaluateDagTelemetry(bad, START);
    assert.strictEqual(r.opens, 0);
    assert.strictEqual(r.branch, 'no_go');
  }
});

check('GO boundary: exactly 8 distinct render-days AND exactly 3 asks → go', () => {
  const rows = [...opensOnDistinctDays(8), feedbackRow(1, 't-a', true), feedbackRow(2, 't-b', true), feedbackRow(3, 't-c', true)];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.renderDays, 8);
  assert.strictEqual(r.helpfulUp, 3);
  assert.strictEqual(r.branch, 'go');
});

check('7 render-days + 3 asks → middle (days short of GO, not <4)', () => {
  const rows = [...opensOnDistinctDays(7), feedbackRow(0, 't', true), feedbackRow(1, 't', true), feedbackRow(2, 't', true)];
  assert.strictEqual(evaluateDagTelemetry(rows, START).branch, 'middle');
});

check('8 render-days + 2 asks → middle (asks short of GO)', () => {
  const rows = [...opensOnDistinctDays(8), feedbackRow(0, 't', true), feedbackRow(1, 't', true)];
  assert.strictEqual(evaluateDagTelemetry(rows, START).branch, 'middle');
});

check('NO-GO boundary: 3 render-days + 0 asks → no_go (<4 means ≤3)', () => {
  const r = evaluateDagTelemetry(opensOnDistinctDays(3), START);
  assert.strictEqual(r.renderDays, 3);
  assert.strictEqual(r.branch, 'no_go');
});

check('4 render-days + 0 asks → middle (not <4, not GO)', () => {
  assert.strictEqual(evaluateDagTelemetry(opensOnDistinctDays(4), START).branch, 'middle');
});

check('thumbs-down only counts helpfulDown, never as an ask', () => {
  const rows = [...opensOnDistinctDays(2), feedbackRow(0, 't', false), feedbackRow(1, 't', false)];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.helpfulDown, 2);
  assert.strictEqual(r.helpfulUp, 0);
  assert.strictEqual(r.branch, 'no_go');
});

check('non-boolean helpful values ignored (string "true" is not an ask)', () => {
  const rows = [feedbackRow(0, 't', 'true'), feedbackRow(1, 't', 1), feedbackRow(2, 't', null)];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.helpfulUp, 0);
  assert.strictEqual(r.helpfulDown, 0);
});

// ── Window filtering ────────────────────────────────────────────────────────

check('rows before window start excluded (2026-08-24 open does not count)', () => {
  const preWindow = { action: 'workflow-graph-open', timestamp: new Date(START - DAY_MS), new_value: { template: 'old' } };
  const r = evaluateDagTelemetry([preWindow, ...opensOnDistinctDays(1)], START);
  assert.strictEqual(r.opens, 1);
  assert.strictEqual(r.renderDays, 1);
  assert.deepStrictEqual(r.templates, ['template-0']);
});

check('exactly at window-start boundary included', () => {
  const atStart = { action: 'workflow-graph-open', timestamp: new Date(START), new_value: { template: 'edge' } };
  const r = evaluateDagTelemetry([atStart], START);
  assert.strictEqual(r.opens, 1);
  assert.deepStrictEqual(r.templates, ['edge']);
});

check('unknown audit actions ignored', () => {
  const noise = [
    { action: 'task.update', timestamp: new Date(START + DAY_MS), new_value: { template: 'noise' } },
    { action: 'workflow-graph-somethingelse', timestamp: new Date(START + DAY_MS), new_value: { template: 'noise' } },
  ];
  const r = evaluateDagTelemetry(noise, START);
  assert.strictEqual(r.opens, 0);
  assert.deepStrictEqual(r.templates, []);
});

// ── Row shape tolerance ─────────────────────────────────────────────────────

check('ISO string timestamps accepted alongside Date objects', () => {
  const rows = [
    { action: 'workflow-graph-open', timestamp: new Date(START + DAY_MS).toISOString(), new_value: { template: 'a' } },
    openRow(2, 'b'),
  ];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.opens, 2);
  assert.strictEqual(r.renderDays, 2);
});

check('new_value as JSON string parsed (raw-driver shape)', () => {
  const rows = [{
    action: 'workflow-graph-feedback',
    timestamp: new Date(START + DAY_MS),
    new_value: JSON.stringify({ template: 'str-shape', helpful: true }),
  }];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.helpfulUp, 1);
  assert.deepStrictEqual(r.templates, ['str-shape']);
});

check('malformed new_value drops template attribution but event still counts', () => {
  const rows = [
    { action: 'workflow-graph-open', timestamp: new Date(START + DAY_MS), new_value: 'not-json{{' },
    { action: 'workflow-graph-open', timestamp: new Date(START + 2 * DAY_MS), new_value: null },
    { action: 'workflow-graph-feedback', timestamp: new Date(START + 3 * DAY_MS), new_value: 12345 },
  ];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.opens, 2);
  assert.strictEqual(r.renderDays, 2); // render-days come from open rows only
  assert.deepStrictEqual(r.templates, []);
});

check('malformed timestamp drops the whole row honestly', () => {
  const rows = [
    { action: 'workflow-graph-open', timestamp: 'garbage', new_value: { template: 'x' } },
    { action: 'workflow-graph-open', timestamp: null, new_value: { template: 'x' } },
    openRow(0, 'good'),
  ];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.opens, 1);
  assert.deepStrictEqual(r.templates, ['good']);
});

// ── Aggregation semantics ───────────────────────────────────────────────────

check('same-day opens collapse to one render-day; templates deduped+sorted', () => {
  const rows = [
    openRow(0, 'zeta'), openRow(0, 'alpha'), // same day, two templates
    openRow(0, 'alpha'),                      // same day again
    openRow(5, 'mid'),
  ];
  const r = evaluateDagTelemetry(rows, START);
  assert.strictEqual(r.opens, 4);
  assert.strictEqual(r.renderDays, 2);
  assert.deepStrictEqual(r.templates, ['alpha', 'mid', 'zeta']);
});

check('templates collected from both open and feedback events', () => {
  const rows = [openRow(0, 'from-open'), feedbackRow(1, 'from-feedback', true)];
  const r = evaluateDagTelemetry(rows, START);
  assert.deepStrictEqual(r.templates, ['from-feedback', 'from-open']);
});

// ── daysRemaining ───────────────────────────────────────────────────────────

check('daysRemaining mid-window: 2026-09-01T12:00Z → 14 (ceil of 13.5)', () => {
  const now = Date.parse('2026-09-01T12:00:00Z');
  assert.strictEqual(evaluateDagTelemetry([], now).daysRemaining, 14);
});

check('daysRemaining on final day 2026-09-14T23:00Z → 1', () => {
  const now = Date.parse('2026-09-14T23:00:00Z');
  assert.strictEqual(evaluateDagTelemetry([], now).daysRemaining, 1);
});

check('daysRemaining after window end clamps to 0', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  assert.strictEqual(evaluateDagTelemetry([], now).daysRemaining, 0);
});

check('daysRemaining before window start clamps to 21', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  assert.strictEqual(evaluateDagTelemetry([], now).daysRemaining, 21);
});

check('invalid nowMs falls back deterministically to window start (21)', () => {
  assert.strictEqual(computeDaysRemaining(undefined), 21);
  assert.strictEqual(computeDaysRemaining(Number.NaN), 21);
});

// ── Unit-level exports ──────────────────────────────────────────────────────

check('evaluateBranch unit: only the three documented branches ever returned', () => {
  for (let d = 0; d <= 10; d++) {
    for (let a = 0; a <= 5; a++) {
      const b = evaluateBranch(d, a);
      assert.ok(['go', 'no_go', 'middle'].includes(b), `branch ${b} for ${d}/${a}`);
      if (d >= 8 && a >= 3) assert.strictEqual(b, 'go');
      else if (d < 4 && a === 0) assert.strictEqual(b, 'no_go');
      else assert.strictEqual(b, 'middle');
    }
  }
});

check('result shape exact (work-order contract keys)', () => {
  const r = evaluateDagTelemetry([], START);
  assert.deepStrictEqual(Object.keys(r).sort(), ['branch', 'daysRemaining', 'helpfulDown', 'helpfulUp', 'opens', 'renderDays', 'templates']);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
