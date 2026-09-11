#!/usr/bin/env node
/**
 * scripts/backfill-run-costs.js
 *
 * One-shot backfill of the migration-022 token/cost columns on `workflow_runs`
 * from historical OpenClaw gateway session data.
 *
 * ── Data source (chosen 2026-08-24, see docs/scripts-reference.md) ──────────
 * Session JSONL transcripts under `<openclaw-home>/agents/<agentId>/sessions/
 * <sessionId>.jsonl`. Every assistant message line carries an exact per-message
 * `usage` object: { input, output, cacheRead, cacheWrite, totalTokens,
 * cost: { input, output, cacheRead, cacheWrite, total } }.
 *
 * Rejected sources:
 *   - `openclaw status` CLI: human-oriented table, context-size snapshot only
 *     (e.g. "64k/262k (25%) · 93% cached"), no per-run input/output split.
 *   - `~/.openclaw/state/openclaw.sqlite`: no token tables at all (verified —
 *     subagent_runs carries model but no usage numbers).
 *   - `sessions.json`: single `totalTokens` context snapshot per session key,
 *     not a cumulative input/output/cached breakdown.
 *
 * ── Join key ────────────────────────────────────────────────────────────────
 * workflow_runs.gateway_session_id (= claim_session_id when set) holds an
 * OpenClaw session key ("agent:<agentId>:<channel>:<id>"). Resolution:
 *   session key → <agentId>/sessions/sessions.json entry → sessionId (+ the
 *   entry's usageFamilySessionIds for rotated transcripts) → <id>.jsonl files.
 * Values that are not session keys (`spawned-<runId8>-pid<n>` written by
 * workflow-run-monitor.js, test fixtures like `gateway-session-abc123`) are
 * reported as unmatched.
 *
 * Because a session key can outlive many runs (shared sessions like
 * agent:main:main), usage is summed ONLY from assistant messages whose
 * timestamp falls inside the run window [started_at, finished_at] (inclusive;
 * open upper bound when finished_at is NULL; runs without any window bound are
 * skipped rather than attributed a whole shared session).
 *
 * ── Cost policy ─────────────────────────────────────────────────────────────
 * cost_estimate is written ONLY from gateway-reported per-message cost totals
 * greater than zero. On this machine every recorded cost is 0 and no model
 * catalog carries pricing, so cost_estimate stays NULL — prices are never
 * invented here. currency is stamped 'USD' as the column's intended unit.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * Only runs whose token/cost columns are ALL NULL are considered; writes go
 * through storage/asana.js updateWorkflowRunUsage() (slice-1 helper). Rows
 * already carrying values are never selected, so re-runs are no-ops.
 *
 * Usage:
 *   node scripts/backfill-run-costs.js            # dry run (default)
 *   node scripts/backfill-run-costs.js --apply    # write to PostgreSQL
 *   node scripts/backfill-run-costs.js --limit 5 --verbose
 *
 * Exit codes: 0 on success AND on graceful degradation (no DB / no gateway
 * data / unmatched runs — reported honestly); 2 on bad arguments or hard
 * failures (module load errors).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { apply: false, limit: null, runId: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--limit') {
      const n = parseInt(argv[++i], 10);
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit expects a positive integer');
      args.limit = n;
    } else if (a === '--run-id') {
      const v = argv[++i];
      if (!v) throw new Error('--run-id expects a value');
      args.runId = v;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

// ── Pure helpers (exported for DB-free tests) ───────────────────────────────

/**
 * Parse an OpenClaw session key into its agent id.
 * "agent:affiliate-editorial:subagent:<uuid>" → "affiliate-editorial"
 * Returns null for anything that is not a session key (spawned-* pid strings,
 * fixture ids, empty/null).
 */
function parseSessionKey(gatewaySessionId) {
  if (typeof gatewaySessionId !== 'string') return null;
  if (!gatewaySessionId.startsWith('agent:')) return null;
  const parts = gatewaySessionId.split(':');
  // agent:<agentId>:<...rest> — rest must be non-empty
  if (parts.length < 3 || !parts[1] || !parts[2]) return null;
  return parts[1];
}

/** Extract summable usage from one parsed JSONL transcript line. */
function extractUsageFromLine(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type !== 'message') return null;
  const message = parsed.message;
  if (!message || message.role !== 'assistant') return null;
  const u = message.usage;
  if (!u || typeof u !== 'object') return null;

  const input = Number.isFinite(u.input) ? u.input : 0;
  const output = Number.isFinite(u.output) ? u.output : 0;
  const cachedRead = Number.isFinite(u.cacheRead) ? u.cacheRead : 0;
  const costTotal = u.cost && Number.isFinite(u.cost.total) ? u.cost.total : 0;
  const provider = typeof message.provider === 'string' ? message.provider : null;
  const model = typeof message.model === 'string' ? message.model : null;

  return {
    input,
    output,
    cachedTokens: cachedRead,
    costEstimate: costTotal > 0 ? costTotal : 0,
    modelRef: provider && model ? `${provider}/${model}` : (model || provider || null),
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : null,
  };
}

/** Dominant model ref by first-seen-majority (stable tie-break). */
function pickDominantModel(counts) {
  let best = null;
  let bestCount = 0;
  for (const [ref, count] of counts) {
    if (count > bestCount) {
      best = ref;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Aggregate one transcript file into a usage accumulator.
 * Only messages whose timestamp falls in [windowStartMs, windowEndMs]
 * (either bound may be null = open) are counted.
 * Accumulator shape: { input, output, cachedTokens, costEstimate, messages, modelCounts: Map }.
 */
async function aggregateTranscript(jsonlPath, windowStartMs, windowEndMs, accumulator) {
  try {
    await fs.promises.access(jsonlPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }

  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let matchedAnyLine = false;
  let streamError = null;
  // Read errors (e.g. file truncated mid-read) degrade to a partial scan.
  stream.on('error', (err) => { streamError = err; });

  for await (const line of rl) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // tolerate malformed lines — partial transcripts stay usable
    }
    const usage = extractUsageFromLine(parsed);
    if (!usage) continue;

    if (windowStartMs !== null && (usage.timestamp === null || usage.timestamp < windowStartMs)) continue;
    if (windowEndMs !== null && (usage.timestamp === null || usage.timestamp > windowEndMs)) continue;

    matchedAnyLine = true;
    accumulator.input += usage.input;
    accumulator.output += usage.output;
    accumulator.cachedTokens += usage.cachedTokens;
    accumulator.costEstimate += usage.costEstimate;
    accumulator.messages += 1;
    if (usage.modelRef) {
      accumulator.modelCounts.set(usage.modelRef, (accumulator.modelCounts.get(usage.modelRef) || 0) + 1);
    }
  }

  rl.close();
  stream.destroy();
  if (streamError && !matchedAnyLine) throw streamError;
  return matchedAnyLine;
}

/**
 * Resolve the candidate transcript files for one session key.
 * Reads <agentsDir>/<agentId>/sessions/sessions.json (flat-key format), returns
 * the current sessionId plus all usageFamilySessionIds that exist on disk.
 * Missing sessions.json / missing files degrade to fewer candidates.
 */
function resolveSessionCandidates(agentsDir, sessionKey) {
  const agentId = parseSessionKey(sessionKey);
  if (!agentId) return { reason: 'not_a_session_key', files: [] };

  const sessionsDir = path.join(agentsDir, agentId, 'sessions');
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(sessionsJsonPath, 'utf8'));
  } catch {
    return { reason: 'sessions_json_unreadable', files: [] };
  }

  // Flat object keyed by session key (v2026.4); tolerate { sessions: [...] }.
  let entry = null;
  if (raw && !Array.isArray(raw) && raw[sessionKey]) {
    entry = raw[sessionKey];
  } else if (raw && Array.isArray(raw.sessions)) {
    entry = raw.sessions.find((s) => s && s.key === sessionKey) || null;
  }
  if (!entry) return { reason: 'session_key_not_found', files: [] };

  const ids = new Set();
  if (typeof entry.sessionId === 'string') ids.add(entry.sessionId);
  if (Array.isArray(entry.usageFamilySessionIds)) {
    for (const id of entry.usageFamilySessionIds) {
      if (typeof id === 'string') ids.add(id);
    }
  }

  const files = [];
  for (const id of ids) {
    const p = path.join(sessionsDir, `${id}.jsonl`);
    try {
      fs.accessSync(p);
      files.push(p);
    } catch {
      // rotated/pruned transcript — skip silently, counted by caller
    }
  }
  if (files.length === 0) return { reason: 'transcript_files_missing', files: [] };
  return { reason: null, files };
}

/** Build the idempotent runs SELECT. Only fully-unreported rows qualify. */
function buildRunsSelectSql(runId) {
  const extra = runId ? ' AND id::text = $1' : '';
  return `
    SELECT id::text, gateway_session_id, claim_session_id, status,
           started_at, finished_at
    FROM workflow_runs
    WHERE input_tokens IS NULL
      AND output_tokens IS NULL
      AND cached_tokens IS NULL
      AND model_id IS NULL
      AND cost_estimate IS NULL
      AND gateway_session_id IS NOT NULL${extra}
    ORDER BY started_at NULLS LAST
  `;
}
const RUNS_SELECT_SQL = buildRunsSelectSql(null);

/** Classify a run row's window in epoch ms; null bounds mean open. */
function runWindowMs(row) {
  const start = row.started_at ? Date.parse(row.started_at) : NaN;
  const end = row.finished_at ? Date.parse(row.finished_at) : NaN;
  return {
    startMs: Number.isFinite(start) ? start : null,
    endMs: Number.isFinite(end) ? end : null,
  };
}

function emptyAccumulator() {
  return { input: 0, output: 0, cachedTokens: 0, costEstimate: 0, messages: 0, modelCounts: new Map() };
}

/** Fold accumulator results into the final usage payload for updateWorkflowRunUsage. */
function accumulatorToPayload(acc) {
  if (acc.messages === 0) return null;
  return {
    input_tokens: acc.input,
    output_tokens: acc.output,
    cached_tokens: acc.cachedTokens,
    ...(acc.costEstimate > 0 ? { cost_estimate: acc.costEstimate } : {}),
    currency: 'USD',
    model_id: pickDominantModel(acc.modelCounts),
  };
}

// ── Orchestration ───────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`argument error: ${err.message}`);
    console.error('usage: node scripts/backfill-run-costs.js [--apply] [--limit N] [--run-id <uuid>] [--verbose]');
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    log('backfill workflow_runs token/cost columns from OpenClaw session JSONL transcripts.');
    log('  --apply       write (default: dry run)');
    log('  --limit N     consider at most N runs');
    log('  --run-id ID   restrict to one workflow run id');
    log('  --verbose     per-run detail');
    return;
  }

  const summary = {
    mode: args.apply ? 'apply' : 'dry-run',
    considered: 0,
    matched: 0,
    would_update: 0,
    updated: 0,
    unmatched_not_a_session_key: 0,
    unmatched_sessions_json_unreadable: 0,
    unmatched_session_key_not_found: 0,
    unmatched_transcript_files_missing: 0,
    skipped_no_window: 0,
    skipped_no_usage_in_window: 0,
    write_failures: 0,
  };

  // ── Load runs (PostgreSQL via AsanaStorage pool; graceful without it) ──
  let storage;
  try {
    // Lazy require so --help works without pg installed.
    const AsanaStorage = require('../storage/asana');
    storage = new AsanaStorage();
    await storage.pool.query('SELECT 1'); // fail fast → graceful path below
  } catch (err) {
    log(`PostgreSQL unavailable (${err.message.split('\n')[0]}). Nothing backfilled.`);
    log(JSON.stringify(summary, null, 2));
    return; // exit 0 — graceful degradation
  }

  let rows = [];
  try {
    const result = await storage.pool.query(buildRunsSelectSql(args.runId), args.runId ? [args.runId] : []);
    rows = result.rows;
    if (args.limit) rows = rows.slice(0, args.limit);
  } catch (err) {
    // Migration 022 not applied yet is the common case here.
    log(`workflow_runs query failed (${err.message.split('\n')[0]}). Did migration 022 run? Nothing backfilled.`);
    log(JSON.stringify(summary, null, 2));
    return; // exit 0 — graceful degradation
  }

  summary.considered = rows.length;
  if (rows.length === 0) {
    log('No unreported runs with a gateway session binding. Nothing to do.');
    log(JSON.stringify(summary, null, 2));
    return;
  }

  const agentsDir = path.join(process.env.OPENCLAW_HOME || process.env.HOME || '/root', '.openclaw', 'agents');

  const pendingWrites = [];

  for (const row of rows) {
    const sessionKey = row.claim_session_id || row.gateway_session_id;
    const resolution = resolveSessionCandidates(agentsDir, sessionKey);

    if (resolution.reason) {
      const key = `unmatched_${resolution.reason}`;
      if (key in summary) summary[key] += 1;
      if (args.verbose) log(`· ${row.id} unmatched (${resolution.reason}): ${sessionKey}`);
      continue;
    }

    const { startMs, endMs } = runWindowMs(row);
    if (startMs === null) {
      summary.skipped_no_window += 1;
      if (args.verbose) log(`· ${row.id} skipped: no started_at window`);
      continue;
    }

    const acc = emptyAccumulator();
    for (const file of resolution.files) {
      try {
        await aggregateTranscript(file, startMs, endMs, acc);
      } catch (err) {
        if (args.verbose) log(`· ${row.id} transcript read error ${file}: ${err.message}`);
      }
    }

    const payload = accumulatorToPayload(acc);
    if (!payload) {
      summary.skipped_no_usage_in_window += 1;
      if (args.verbose) log(`· ${row.id} no usage messages in window (${resolution.files.length} transcript files scanned)`);
      continue;
    }

    summary.matched += 1;
    if (args.verbose) {
      log(`• ${row.id} ${sessionKey}: in=${payload.input_tokens} out=${payload.output_tokens} cached=${payload.cached_tokens} model=${payload.model_id} (${acc.messages} msgs, ${resolution.files.length} files)`);
    }
    pendingWrites.push({ runId: row.id, payload });
  }

  summary.would_update = pendingWrites.length;

  if (!args.apply) {
    log(`Dry run: ${summary.would_update} run(s) would be updated. Re-run with --apply to write.`);
  } else {
    // Batched sequential writes through the slice-1 helper (reported_at=NOW()).
    for (const w of pendingWrites) {
      // Idempotency double-check inside the write path: another process may
      // have filled the row between SELECT and UPDATE.
      const existing = await storage.getWorkflowRunUsage(w.runId);
      if (existing && (existing.input_tokens !== null || existing.output_tokens !== null || existing.cost_estimate !== null)) {
        if (args.verbose) log(`· ${w.runId} already reported mid-flight — left untouched`);
        continue;
      }
      const okWrite = await storage.updateWorkflowRunUsage(w.runId, w.payload);
      if (okWrite) summary.updated += 1;
      else summary.write_failures += 1;
    }
    log(`Applied: ${summary.updated} run(s) updated, ${summary.write_failures} write failure(s).`);
  }

  log('');
  log('Summary:');
  log(JSON.stringify(summary, null, 2));

  await storage.pool.end().catch(() => {});
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`fatal: ${err.stack || err.message}`);
    process.exitCode = 2;
  });
}

module.exports = {
  parseArgs,
  parseSessionKey,
  extractUsageFromLine,
  aggregateTranscript,
  resolveSessionCandidates,
  runWindowMs,
  emptyAccumulator,
  accumulatorToPayload,
  pickDominantModel,
  buildRunsSelectSql,
  RUNS_SELECT_SQL,
};
