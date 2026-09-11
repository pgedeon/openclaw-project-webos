/**
 * Task ↔ Session binding mappers (docs/briefs/task-session-binding.md).
 *
 * Pure functions only — no fs, no network, no DB. The route layer
 * (routes/task-routes.js) resolves workflow_runs rows and builds the
 * sessions index (via lib/session-jsonl-reader.js listAllSessions()), then
 * delegates all shaping here so the join stays fixture-testable DB-free.
 *
 * Key format (docs/AGENT_INTEGRATION.md §API): `gateway_session_id` stores the
 * agent's OpenClaw session KEY — `agent:<agentId>:<kind>:<id>` (legacy 3-part
 * form `agent:main:main`) — not the UUID-style sessionId. Resolution
 * key → sessionId is one lookup in the agent's sessions.json, surfaced here
 * as the plain `sessionsIndex` array.
 */

// Run statuses that mean "still going" (migration 001 ∪ 021 vocabulary).
// queued/dispatched/blocked are pre-terminal even though they usually carry
// no session key yet; rows without a key render as "no session recorded".
const LIVE_RUN_STATUSES = new Set([
  'queued',
  'dispatched',
  'blocked',
  'claimed',
  'running',
  'waiting_for_approval',
  'retrying',
]);

// Terminal-but-not-success outcomes (migration 021 widened the CHECK).
const FAILED_RUN_STATUSES = new Set(['failed', 'cancelled', 'timed_out']);

/**
 * Parse a session key into its components.
 *   'agent:coder:webchat:abc123' → { agentId:'coder', kind:'webchat', id:'abc123', key:'...' }
 *   'agent:main:main'            → { agentId:'main', kind:'main', id:'main', key:'...' }
 * Returns null for anything that is not an `agent:`-prefixed key with at
 * least 3 segments (null/empty/foreign keys are unresolvable, never guessed).
 *
 * @param {string|null} key
 * @returns {{agentId: string, kind: string, id: string, key: string}|null}
 */
function parseSessionKey(key) {
  if (typeof key !== 'string' || !key) return null;
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  const agentId = parts[1];
  const kind = parts[2];
  const id = parts.slice(3).join(':') || parts[2]; // 3-part legacy: id === kind segment
  if (!agentId || !kind) return null;
  return { agentId, kind, id, key };
}

/**
 * Map a workflow_runs.status onto the v1 UI liveness contract:
 *   'live' | 'completed' | 'failed'.
 * Unknown statuses are treated as terminal ('failed') so a bad row can never
 * offer a live-console handoff — the DB CHECK constrains this to a no-op in
 * practice.
 *
 * @param {string|null} runStatus
 * @returns {'live'|'completed'|'failed'}
 */
function deriveLiveness(runStatus) {
  const status = String(runStatus || '').toLowerCase();
  if (status === 'completed') return 'completed';
  if (FAILED_RUN_STATUSES.has(status)) return 'failed';
  if (LIVE_RUN_STATUSES.has(status)) return 'live';
  return 'failed';
}

/**
 * Normalize a pg TIMESTAMPTZ value (Date | ISO string | epoch ms | null) to
 * epoch milliseconds, or null.
 */
function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build the ordered Binding[] list for one task's runs.
 *
 * @param {Array<object>} runs           workflow_runs rows (snake_case pg rows or camelCase)
 * @param {Array<{key:string, sessionId:string|null, agentId:string}>} sessionsIndex
 *        flat index built by the caller from reader.listAllSessions()
 * @param {{activeRunId?: string|null}} [opts]
 * @returns {Array<object>} bindings sorted newest-run-first (started_at, falling
 *                          back to created_at)
 */
function buildTaskSessionBindings(runs, sessionsIndex, opts = {}) {
  const runList = Array.isArray(runs) ? runs : [];
  const index = Array.isArray(sessionsIndex) ? sessionsIndex : [];

  const byKey = new Map();
  for (const entry of index) {
    if (entry && typeof entry.key === 'string' && entry.key && !byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }

  const activeRunId = opts.activeRunId || null;

  const decorated = runList.map((run) => {
    const sessionKey = run.gateway_session_id || run.gatewaySessionId || null;
    const parsed = sessionKey ? parseSessionKey(sessionKey) : null;
    const indexed = sessionKey ? (byKey.get(sessionKey) || null) : null;
    const sessionId = (indexed && indexed.sessionId) || null;
    const runStatus = run.status || null;
    const liveness = deriveLiveness(runStatus);
    const retryCount = Number(run.retry_count ?? run.retryCount ?? 0) || 0;

    // Routing rule (brief §4): live → console (matches by key OR id, key is
    // always present); everything else resolvable → replay (resolves by
    // sessionId). Orphaned/pending rows get NO link — never fabricated.
    let deepLink = null;
    if (parsed && sessionId && liveness === 'live') {
      deepLink = { view: 'console', params: { agent: parsed.agentId, session: sessionKey } };
    } else if (parsed && sessionId) {
      deepLink = { view: 'session-replay', params: { agent: parsed.agentId, session: sessionId } };
    }

    const binding = {
      runId: run.id || null,
      workflowType: run.workflow_type || run.workflowType || null,
      runStatus,
      isActiveRun: !!activeRunId && run.id === activeRunId,
      sessionKey,
      agentId: parsed ? parsed.agentId : null,
      sessionId,
      sessionActive: !!(run.gateway_session_active ?? run.gatewaySessionActive),
      liveness,
      startedAt: toEpochMs(run.started_at ?? run.startedAt),
      finishedAt: toEpochMs(run.finished_at ?? run.finishedAt),
      heartbeatAt: toEpochMs(run.last_heartbeat_at ?? run.lastHeartbeatAt),
      retryCount,
      // R1 honesty: markDispatched/releaseClaimed null earlier session keys on
      // re-queue, so a retried run shows only its latest attempt's session.
      retryCycled: retryCount > 0,
      deepLink,
    };

    return { binding, sortMs: toEpochMs(run.started_at ?? run.startedAt) ?? toEpochMs(run.created_at ?? run.createdAt) ?? 0 };
  });

  decorated.sort((a, b) => b.sortMs - a.sortMs);
  return decorated.map((d) => d.binding);
}

module.exports = {
  LIVE_RUN_STATUSES,
  FAILED_RUN_STATUSES,
  parseSessionKey,
  deriveLiveness,
  toEpochMs,
  buildTaskSessionBindings,
};
