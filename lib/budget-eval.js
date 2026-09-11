/**
 * Budget evaluation — pure, DB-free functions for the budget ledger.
 *
 * Used by routes/budget-routes.js (derived spend/status) and, in slice 2,
 * by the dispatcher enforcement gate. No PostgreSQL, no I/O: everything is
 * a pure function of its arguments so period-key derivation and breach
 * boundaries are table-driven testable (tests/test-budget-routes.js).
 *
 * Bucketing contract matches routes/cost-routes.js and the SQL date_trunc
 * usage in storage/asana.js getBudgetLedger(): server-local calendar buckets
 * (daily = local day, weekly = ISO week starting Monday, monthly = calendar
 * month). Cost panel and budget math can never disagree about what day it is.
 */

const ACTIONS = ['warn', 'pause_new_runs', 'hard_stop'];

// Most-restrictive ordering for overlapping breached budgets
// (brief §2.1): hard_stop > pause_new_runs > warn.
const ACTION_RANK = { warn: 1, pause_new_runs: 2, hard_stop: 3 };

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Local calendar day key, e.g. '2026-08-24' (matches date_trunc('day', NOW())). */
function dailyKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO-8601 week key, e.g. '2026-W35' (matches to_char(date_trunc('week', ...), 'IYYY-"W"IW')). */
function isoWeekKey(d) {
  // Thursday of the ISO week containing d determines the ISO year/week.
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7; // Mon=0 .. Sun=6
  t.setDate(t.getDate() - dow + 3); // shift to Thursday
  const isoYear = t.getFullYear();
  // Week 1 is the week containing the first Thursday of the ISO year,
  // i.e. the week containing Jan 4.
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Dow = (jan4.getDay() + 6) % 7;
  const week1Thursday = new Date(isoYear, 0, 4 - jan4Dow + 3);
  const week = Math.round((t.getTime() - week1Thursday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${pad2(week)}`;
}

/** Calendar month key, e.g. '2026-08' (matches date_trunc('month', NOW())). */
function monthlyKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/**
 * Derive the period key for a budget period at a point in time.
 * @param {'daily'|'weekly'|'monthly'} period
 * @param {number} nowMs epoch milliseconds
 * @returns {string} e.g. '2026-08-24' | '2026-W35' | '2026-08'
 */
function periodKey(period, nowMs) {
  const d = new Date(nowMs);
  if (period === 'daily') return dailyKey(d);
  if (period === 'weekly') return isoWeekKey(d);
  if (period === 'monthly') return monthlyKey(d);
  throw new Error(`Invalid budget period: ${period}`);
}

/**
 * Inclusive window start (epoch ms) of the current period bucket — the JS
 * mirror of date_trunc('<period>', NOW()) so SQL aggregates and pure eval
 * agree on where the window begins.
 * @returns {number} epoch ms of the bucket start (local midnight / Monday / 1st)
 */
function periodWindowStartMs(period, nowMs) {
  const d = new Date(nowMs);
  if (period === 'daily') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === 'weekly') {
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday.getTime();
  }
  if (period === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  throw new Error(`Invalid budget period: ${period}`);
}

/**
 * Most restrictive action among breached budgets (hard_stop > pause_new_runs > warn).
 * @param {string[]} actions
 * @returns {string|null} winning action, or null when none qualify
 */
function mostRestrictive(actions) {
  let best = null;
  for (const a of actions || []) {
    if (!Object.prototype.hasOwnProperty.call(ACTION_RANK, a)) continue;
    if (best === null || ACTION_RANK[a] > ACTION_RANK[best]) best = a;
  }
  return best;
}

/** Percent of cap used (0-100+, rounded to 2 decimals); null when no cap set. */
function pctOfCap(budget, spendUsd, spendTokens) {
  const capUsd = budget.cap_usd == null ? null : Number(budget.cap_usd);
  const capTokens = budget.cap_tokens == null ? null : Number(budget.cap_tokens);
  if (capUsd != null && capUsd > 0) {
    return Math.round((spendUsd / capUsd) * 10000) / 100;
  }
  if (capTokens != null && capTokens > 0) {
    return Math.round((spendTokens / capTokens) * 10000) / 100;
  }
  return null;
}

/**
 * Breach decision for an already-aggregated spend figure.
 * Breach boundary is >= cap (exactly-at-cap counts as breached, brief §2.4:
 * breached(budget, now) = spend >= cap && active). An inactive or uncapped
 * budget never breaches.
 * @returns {'ok'|'warn'|'pause_new_runs'|'hard_stop'}
 */
function decisionFor(budget, spendUsd, spendTokens) {
  if (!budget.active) return 'ok';
  const capUsd = budget.cap_usd == null ? null : Number(budget.cap_usd);
  const capTokens = budget.cap_tokens == null ? null : Number(budget.cap_tokens);
  if (capUsd != null && capUsd > 0 && spendUsd >= capUsd) return budget.action_on_exceed;
  if (capTokens != null && capTokens > 0 && spendTokens >= capTokens) return budget.action_on_exceed;
  return 'ok';
}

/**
 * Evaluate a budget against raw ledger entries within its current period.
 *
 * @param {object} budget - row-shaped budget: { period, cap_usd, cap_tokens,
 *   action_on_exceed, active }
 * @param {Array<{ts:number, usd?:number, tokens?:number}>} ledgerEntries -
 *   derived run-level accruals (ts = epoch ms inside the entry's bucket)
 * @param {number} nowMs - evaluation instant (epoch ms)
 * @returns {{spendUsd:number, spendTokens:number, pctOfCap:number|null,
 *            decision:'ok'|'warn'|'pause_new_runs'|'hard_stop',
 *            periodKey:string, windowStartMs:number}}
 */
function evaluateBudget(budget, ledgerEntries, nowMs) {
  const key = periodKey(budget.period, nowMs);
  const startMs = periodWindowStartMs(budget.period, nowMs);
  let spendUsd = 0;
  let spendTokens = 0;
  for (const entry of ledgerEntries || []) {
    const ts = Number(entry.ts ?? entry.timestampMs ?? 0);
    if (!(ts >= startMs && ts <= nowMs)) continue; // outside current bucket
    spendUsd += Number(entry.usd ?? entry.costUsd ?? 0);
    spendTokens += Number(entry.tokens ?? 0);
  }
  const decision = decisionFor(budget, spendUsd, spendTokens);
  return {
    spendUsd: Math.round(spendUsd * 1e6) / 1e6,
    spendTokens,
    pctOfCap: pctOfCap(budget, spendUsd, spendTokens),
    decision,
    periodKey: key,
    windowStartMs: startMs,
  };
}

module.exports = {
  ACTIONS,
  ACTION_RANK,
  evaluateBudget,
  decisionFor,
  pctOfCap,
  mostRestrictive,
  periodKey,
  periodWindowStartMs,
};
