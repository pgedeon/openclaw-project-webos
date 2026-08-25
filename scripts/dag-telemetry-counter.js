#!/usr/bin/env node
/**
 * dag-telemetry-counter.js
 *
 * DAG GO/NO-GO telemetry counter (workflow visual editor Stage 1 earn-use rule,
 * docs/briefs/workflow-visual-editor-stage1.md §6; roadmap review #3 decision
 * lands ~2026-09-14).
 *
 * Reads audit_log rows written by POST /api/workflow-graph/events
 * (routes/workflow-graph-routes.js: action 'workflow-graph-open' /
 * 'workflow-graph-feedback', actor 'dashboard-operator', new_value JSONB
 * {template, helpful?, note?}) since the staging deploy date 2026-08-25 and
 * prints the decision inputs plus the current GO/NO-GO branch:
 *
 *   GO    = ≥8 distinct render-days AND ≥3 explicit edit asks (👍)
 *   NO-GO = <4 distinct render-days AND zero asks
 *   middle = everything else → review with numbers
 *
 * Graceful degradation (by design — this is an ops convenience, not a gate):
 * any database-layer failure (unreachable PostgreSQL, missing database,
 * missing audit_log table, auth failure) prints an HONEST unavailable message
 * and exits 0. Unavailable is never reported as zero — no data was read.
 *
 * Zero new dependencies: uses the already-required `pg` package and the same
 * POSTGRES_* environment variables as scripts/dashboard-validation.js.
 *
 * Usage:
 *   node scripts/dag-telemetry-counter.js
 *   npm run dag:telemetry
 */

const { Pool } = require('pg');

// ── Window constants (brief §6: 21-day rule evaluated from staging deploy) ──
const WINDOW_START_ISO = '2026-08-25T00:00:00.000Z'; // staging deploy date
const WINDOW_DAYS = 21;                              // ends 2026-09-14 inclusive
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Branch thresholds ───────────────────────────────────────────────────────
const RENDER_DAYS_GO = 8;    // GO needs ≥8 distinct render-days …
const ASKS_GO = 3;           // … AND ≥3 explicit edit asks (👍)
const RENDER_DAYS_NO_GO = 4; // NO-GO hits <4 distinct render-days …

const OPEN_ACTION = 'workflow-graph-open';
const FEEDBACK_ACTION = 'workflow-graph-feedback';

const QUERY = `
  SELECT action, timestamp, new_value
  FROM audit_log
  WHERE action IN ($1, $2)
    AND timestamp >= $3::timestamptz
  ORDER BY timestamp ASC`;

function pgConfig() {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'mission_control',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    connectionTimeoutMillis: 5000, // fail fast in DB-less contexts
  };
}

/** Parse a new_value cell: pg returns JSONB already-parsed; tolerate strings. */
function parseDetail(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Accept Date objects (pg timestamptz) and ISO strings alike. */
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** UTC calendar-day key — deterministic regardless of viewer timezone. */
function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Branch evaluation per the brief's 21-day rule. Mechanical by design:
 * early-window empties land 'no_go' numerically — the printed report always
 * carries daysRemaining so an in-flight window is never mistaken for a verdict.
 */
function evaluateBranch(renderDays, asks) {
  if (renderDays >= RENDER_DAYS_GO && asks >= ASKS_GO) return 'go';
  if (renderDays < RENDER_DAYS_NO_GO && asks === 0) return 'no_go';
  return 'middle';
}

/** Days left in the window; clamped to [0, WINDOW_DAYS]. Invalid nowMs is
 *  treated deterministically as the window start (full 21 days remaining). */
function computeDaysRemaining(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.parse(WINDOW_START_ISO);
  const endExclusiveMs = Date.parse(WINDOW_START_ISO) + WINDOW_DAYS * DAY_MS;
  const remaining = Math.ceil((endExclusiveMs - now) / DAY_MS);
  return Math.max(0, Math.min(WINDOW_DAYS, remaining));
}

/**
 * Pure evaluation over audit_log rows — exported for DB-free tests.
 * Rows are filtered to the two workflow-graph actions inside the window;
 * malformed timestamps drop the row, malformed new_value drops only the
 * template attribution (the event itself still counts).
 */
function evaluateDagTelemetry(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const startMs = Date.parse(WINDOW_START_ISO);

  const renderDaySet = new Set();
  const templateSet = new Set();
  let opens = 0;
  let helpfulUp = 0;
  let helpfulDown = 0;

  for (const row of list) {
    const action = row?.action;
    if (action !== OPEN_ACTION && action !== FEEDBACK_ACTION) continue;
    const ts = toDate(row?.timestamp);
    if (!ts || ts.getTime() < startMs) continue;

    const detail = parseDetail(row?.new_value);
    if (action === OPEN_ACTION) {
      opens += 1;
      renderDaySet.add(utcDateKey(ts));
    } else if (detail.helpful === true) {
      helpfulUp += 1;
    } else if (detail.helpful === false) {
      helpfulDown += 1;
    }
    if (typeof detail.template === 'string' && detail.template) {
      templateSet.add(detail.template);
    }
  }

  const renderDays = renderDaySet.size;
  return {
    renderDays,
    opens,
    helpfulUp,
    helpfulDown,
    templates: [...templateSet].sort(),
    branch: evaluateBranch(renderDays, helpfulUp),
    daysRemaining: computeDaysRemaining(nowMs),
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function describeBranch(result) {
  const { renderDays, helpfulUp } = result;
  const goGap = [];
  if (renderDays < RENDER_DAYS_GO) goGap.push(`${RENDER_DAYS_GO - renderDays} more render-day(s)`);
  if (helpfulUp < ASKS_GO) goGap.push(`${ASKS_GO - helpfulUp} more ask(s)`);
  const noGoState = renderDays < RENDER_DAYS_NO_GO && helpfulUp === 0;
  return { goGap, noGoState };
}

function printReport(result, rowCount) {
  const elapsed = WINDOW_DAYS - result.daysRemaining;
  const { goGap, noGoState } = describeBranch(result);

  console.log('=== DAG GO/NO-GO telemetry (workflow graph Stage 1) ===');
  console.log(`Window: ${WINDOW_START_ISO.slice(0, 10)} -> 2026-09-14 (${WINDOW_DAYS} days, UTC calendar days)`);
  console.log(`Audit rows evaluated: ${rowCount}`);
  console.log('');
  console.log('Decision inputs');
  console.log(`  Distinct render-days : ${result.renderDays}  (GO needs >=${RENDER_DAYS_GO})`);
  console.log(`  Total opens          : ${result.opens}`);
  console.log(`  Asks (thumbs-up)     : ${result.helpfulUp}  (GO needs >=${ASKS_GO})`);
  console.log(`  Thumbs-down          : ${result.helpfulDown}`);
  console.log(`  Distinct templates   : ${result.templates.length}${result.templates.length ? ` (${result.templates.join(', ')})` : ''}`);
  console.log('');
  console.log('Trajectory');
  console.log(`  Day ${elapsed} of ${WINDOW_DAYS} — ${result.daysRemaining} day(s) remaining until the review window closes.`);
  if (result.daysRemaining > 0) {
    const needDays = Math.max(0, RENDER_DAYS_GO - result.renderDays);
    console.log(`  GO pace check: ${needDays} more render-day(s) needed across ${result.daysRemaining} remaining day(s)` +
      (needDays > result.daysRemaining ? ' — GO no longer reachable on render-days alone.' : ' — still reachable.'));
  } else {
    console.log('  Window closed — this is the final count.');
  }
  console.log('');
  console.log('Branch evaluation (brief §6)');
  console.log(`  GO    (>=${RENDER_DAYS_GO} days AND >=${ASKS_GO} asks)   : ${result.renderDays >= RENDER_DAYS_GO && result.helpfulUp >= ASKS_GO ? 'MET' : `not yet${goGap.length ? ` — needs ${goGap.join(' and ')}` : ''}`}`);
  console.log(`  NO-GO (<${RENDER_DAYS_NO_GO} days AND 0 asks)  : ${noGoState ? 'HITS' : 'not hit'}`);
  console.log(`  VERDICT: ${result.branch}` + (result.branch === 'middle' ? '  (review with numbers)' : ''));
}

function printUnavailable(err) {
  const code = err?.code || '';
  let reason;
  if (code === '42P01') reason = 'audit_log table does not exist on this instance (migration not applied)';
  else if (code === '3D000') reason = `database "${pgConfig().database}" does not exist`;
  else if (code === '28P01' || code === '28000') reason = 'PostgreSQL authentication failed';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) reason = `cannot reach PostgreSQL at ${pgConfig().host}:${pgConfig().port} (${code})`;
  else reason = `${code || 'unknown'} ${err?.message || err}`;

  console.error('=== DAG GO/NO-GO telemetry (workflow graph Stage 1) ===');
  console.error('Database unavailable — telemetry counts CANNOT be produced.');
  console.error(`Reason: ${reason}`);
  console.error('This is NOT a zero: no data was read, so no branch is evaluated.');
  console.error('Re-run when the dashboard PostgreSQL instance is reachable');
  console.error('(env: POSTGRES_HOST/PORT/DB/USER/PASSWORD, same as dashboard-validation.js).');
}

async function safeEnd(pool) {
  try { await pool.end(); } catch { /* already closed */ }
}

async function main() {
  const pool = new Pool(pgConfig());
  let result;
  try {
    const res = await pool.query(QUERY, [OPEN_ACTION, FEEDBACK_ACTION, WINDOW_START_ISO]);
    result = evaluateDagTelemetry(res.rows, Date.now());
    printReport(result, res.rows.length);
  } catch (err) {
    // Graceful no-DB contract: honest message, exit 0 — must work in CI-less,
    // DB-less contexts without failing.
    printUnavailable(err);
  } finally {
    await safeEnd(pool);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[dag-telemetry-counter] unexpected failure: ${err?.message || err}`);
    process.exit(1);
  });
}

module.exports = { evaluateDagTelemetry, evaluateBranch, computeDaysRemaining, WINDOW_START_ISO, WINDOW_DAYS };
