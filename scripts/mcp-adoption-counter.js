#!/usr/bin/env node
/**
 * mcp-adoption-counter.js
 *
 * MCP tool-call adoption counter (improvement-loop queue: answer "did
 * anything actually call our tools?" with data, not guesses).
 *
 * House precedent: DAG Stage 1 telemetry (scripts/dag-telemetry-counter.js) —
 * fire-and-forget event POST → audit_log rows → counter script. This script
 * reads the audit_log rows written by POST /api/mcp/telemetry
 * (routes/mcp-telemetry-routes.js: action 'mcp-tool-call', actor 'openclaw',
 * new_value JSONB {tool, outcome, durationMs}) since the MCP slice-1 ship
 * date 2026-08-25 and prints per-tool call counts, the ok/error split,
 * days-with-activity, and which registered tools have NEVER been called.
 *
 * Distinct client sessions are NOT derivable: the MCP transport is stdio and
 * carries no session identity — the report says so honestly instead of
 * guessing.
 *
 * Graceful degradation (by design — same contract as dag-telemetry-counter):
 * any database-layer failure (unreachable PostgreSQL, missing database,
 * missing audit_log table, auth failure) prints an HONEST unavailable message
 * and exits 0. Unavailable is never reported as zero — no data was read.
 *
 * Zero new dependencies: uses the already-required `pg` package and the same
 * POSTGRES_* environment variables as scripts/dashboard-validation.js.
 *
 * Usage:
 *   node scripts/mcp-adoption-counter.js
 *   npm run mcp:telemetry
 */

const { Pool } = require('pg');
const { TOOLS } = require('../lib/mcp-server');

// ── Window constant: MCP slice 1 ship date (stdio core + 10 read-only tools)
const WINDOW_START_ISO = '2026-08-25T00:00:00.000Z';

const ACTION = 'mcp-tool-call';

const QUERY = `
  SELECT action, timestamp, new_value
  FROM audit_log
  WHERE action = $1
    AND timestamp >= $2::timestamptz
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
 * Pure aggregation over audit_log rows — exported for DB-free tests.
 * Rows are filtered to 'mcp-tool-call' actions since the window start;
 * malformed timestamps drop the row, malformed new_value drops only the
 * tool/outcome attribution (the row still counts under tool 'unknown').
 *
 * Returns { windowStartIso, totalCalls, okCalls, errorCalls, otherOutcomeCalls,
 * activeDays, firstCallAt, lastCallAt, registeredToolCount,
 * tools: [{name, calls, ok, error, used}] } — used tools first (calls desc,
 * name asc), then never-called registered tools alphabetically.
 */
function evaluateMcpAdoption(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const startMs = Date.parse(WINDOW_START_ISO);

  const perTool = new Map(); // name -> {calls, ok, error}
  let totalCalls = 0;
  let okCalls = 0;
  let errorCalls = 0;
  let otherOutcomeCalls = 0;
  const daySet = new Set();
  let firstMs = null;
  let lastMs = null;

  const bump = (tool, field) => {
    if (!perTool.has(tool)) perTool.set(tool, { calls: 0, ok: 0, error: 0 });
    const entry = perTool.get(tool);
    entry.calls += 1;
    if (field) entry[field] += 1;
  };

  for (const row of list) {
    if (row?.action !== ACTION) continue;
    const ts = toDate(row?.timestamp);
    if (!ts || ts.getTime() < startMs) continue;

    const detail = parseDetail(row?.new_value);
    const tool = typeof detail.tool === 'string' && detail.tool ? detail.tool : 'unknown';
    let field = null;
    if (detail.outcome === 'ok') { field = 'ok'; okCalls += 1; }
    else if (detail.outcome === 'error') { field = 'error'; errorCalls += 1; }
    else { otherOutcomeCalls += 1; }

    totalCalls += 1;
    bump(tool, field); // unrecognized outcome: row counts as a call, not ok/error
    daySet.add(utcDateKey(ts));
    const ms = ts.getTime();
    if (firstMs === null || ms < firstMs) firstMs = ms;
    if (lastMs === null || ms > lastMs) lastMs = ms;
  }

  const registered = new Map(TOOLS.map((t) => [t.name, { name: t.name, calls: 0, ok: 0, error: 0, used: false }]));
  const observed = [];
  for (const [name, counts] of perTool.entries()) {
    const row = { name, calls: counts.calls, ok: counts.ok, error: counts.error, used: true };
    observed.push(row);
    if (registered.has(name)) registered.set(name, row);
  }
  for (const [name, row] of registered.entries()) {
    if (!row.used) observed.push({ ...row });
  }
  observed.sort((a, b) => {
    if (a.used !== b.used) return a.used ? -1 : 1;
    if (b.calls !== a.calls) return b.calls - a.calls;
    return a.name.localeCompare(b.name);
  });

  return {
    windowStartIso: WINDOW_START_ISO,
    totalCalls,
    okCalls,
    errorCalls,
    otherOutcomeCalls,
    activeDays: daySet.size,
    firstCallAt: firstMs === null ? null : new Date(firstMs).toISOString(),
    lastCallAt: lastMs === null ? null : new Date(lastMs).toISOString(),
    registeredToolCount: TOOLS.length,
    tools: observed,
  };
}

// ── Reporting ───────────────────────────────────────────────────────────────

function printReport(result, rowCount) {
  console.log('=== MCP tool-call adoption telemetry (dashboard MCP server) ===');
  console.log(`Window: since ${result.windowStartIso.slice(0, 10)} (MCP slice-1 ship date, UTC)`);
  console.log(`Audit rows evaluated: ${rowCount}`);
  console.log('');
  console.log('Decision inputs');
  console.log(`  Total tool calls     : ${result.totalCalls}`);
  console.log(`  OK / error split     : ${result.okCalls} ok / ${result.errorCalls} error` +
    (result.otherOutcomeCalls ? ` / ${result.otherOutcomeCalls} unattributed` : ''));
  console.log(`  Tools used           : ${result.tools.filter((t) => t.used).length} of ${result.registeredToolCount} registered`);
  console.log(`  Days with activity   : ${result.activeDays}`);
  console.log(`  First call           : ${result.firstCallAt || '(none yet)'}`);
  console.log(`  Last call            : ${result.lastCallAt || '(none yet)'}`);
  console.log('');
  console.log('Per-tool breakdown');
  const used = result.tools.filter((t) => t.used);
  if (used.length === 0) {
    console.log('  No MCP tool calls recorded since the window start — adoption has not started.');
  } else {
    console.log('  tool                       calls    ok  error');
    for (const t of used) {
      console.log(`  ${t.name.padEnd(26)}${String(t.calls).padStart(6)}${String(t.ok).padStart(6)}${String(t.error).padStart(7)}`);
    }
  }
  const neverCalled = result.tools.filter((t) => !t.used).map((t) => t.name);
  console.log('');
  if (neverCalled.length > 0) {
    console.log(`Never called this window (${neverCalled.length}): ${neverCalled.join(', ')}`);
  } else if (used.length > 0) {
    console.log('Every registered tool was called at least once this window.');
  }
  console.log('Distinct client sessions: not derivable (stdio transport carries no session identity)');
}

function printUnavailable(err) {
  const code = err?.code || '';
  let reason;
  if (code === '42P01') reason = 'audit_log table does not exist on this instance (migration not applied)';
  else if (code === '3D000') reason = `database "${pgConfig().database}" does not exist`;
  else if (code === '28P01' || code === '28000') reason = 'PostgreSQL authentication failed';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) reason = `cannot reach PostgreSQL at ${pgConfig().host}:${pgConfig().port} (${code})`;
  else reason = `${code || 'unknown'} ${err?.message || err}`;

  console.error('=== MCP tool-call adoption telemetry (dashboard MCP server) ===');
  console.error('Database unavailable — telemetry counts CANNOT be produced.');
  console.error(`Reason: ${reason}`);
  console.error('This is NOT a zero: no data was read.');
  console.error('Re-run when the dashboard PostgreSQL instance is reachable');
  console.error('(env: POSTGRES_HOST/PORT/DB/USER/PASSWORD, same as dashboard-validation.js).');
}

async function safeEnd(pool) {
  try { await pool.end(); } catch { /* already closed */ }
}

async function main() {
  const pool = new Pool(pgConfig());
  try {
    const res = await pool.query(QUERY, [ACTION, WINDOW_START_ISO]);
    const result = evaluateMcpAdoption(res.rows);
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
    console.error(`[mcp-adoption-counter] unexpected failure: ${err?.message || err}`);
    process.exit(1);
  });
}

module.exports = { evaluateMcpAdoption, WINDOW_START_ISO, ACTION };
