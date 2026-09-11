/**
 * Incremental JSONL reader for OpenClaw session files.
 *
 * Supports line-based cursor pagination and efficient tail reads
 * for large session files (3MB+).
 *
 * sessions.json format (v2026.4):
 *   { "agent:main:webchat:abc": { sessionId, updatedAt, model, ... }, ... }
 *   — OR (older format) —
 *   { "sessions": [...] }
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const AGENTS_DIR = path.join(
  process.env.HOME || '/root',
  '.openclaw',
  'agents'
);

// ── Session replay (time-travel stepper) constants ─────────────────────────

// First-cut transcript size ceiling (brief R1). Files larger than this are
// read only up to the cap and flagged `truncated`. Configurable via env.
const MAX_FILE_BYTES = parseInt(process.env.SESSION_REPLAY_MAX_BYTES || '', 10) || 20 * 1024 * 1024;

// Preview truncation for list payloads (~8 MB chunk guardrail, brief §4).
const PREVIEW_MAX_CHARS = 400;

// GET /events pagination: default and hard cap for the `limit` parameter.
const EVENTS_DEFAULT_LIMIT = 500;
const EVENTS_MAX_LIMIT = 2000;

/**
 * Normalize sessions.json into an array of session objects.
 * Handles both formats: flat object keyed by session key, and { sessions: [...] }.
 */
function normalizeSessions(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw.sessions && Array.isArray(raw.sessions)) return raw.sessions;

  // Flat object keyed by session key
  if (typeof raw === 'object') {
    return Object.entries(raw).map(([key, val]) => ({
      key,
      ...val,
    }));
  }

  return [];
}

/**
 * Read sessions.json for a given agent.
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.activeMinutes] - Only return sessions updated within N minutes
 * @returns {Promise<{agentId: string, count: number, sessions: Array}>}
 */
async function listSessions(agentId, opts = {}) {
  const sessionsPath = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
  try {
    const raw = JSON.parse(await fs.promises.readFile(sessionsPath, 'utf8'));
    let sessions = normalizeSessions(raw);

    if (opts.activeMinutes) {
      const cutoff = Date.now() - opts.activeMinutes * 60 * 1000;
      sessions = sessions.filter(s => (s.updatedAt || 0) >= cutoff);
    }

    return { agentId, count: sessions.length, sessions };
  } catch (err) {
    if (err.code === 'ENOENT') return { agentId, count: 0, sessions: [] };
    throw err;
  }
}

/**
 * List sessions across all agents.
 * @param {object} [opts]
 * @param {number} [opts.activeMinutes]
 * @returns {Promise<Array<{agentId, count, sessions}>>}
 */
async function listAllSessions(opts = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(AGENTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionsPath = path.join(AGENTS_DIR, entry.name, 'sessions', 'sessions.json');
    try {
      await fs.promises.access(sessionsPath);
      const data = await listSessions(entry.name, opts);
      if (data.count > 0) results.push(data);
    } catch {
      // No sessions for this agent
    }
  }
  return results;
}

/**
 * Read session metadata by sessionId.
 * @param {string} sessionId
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
async function getSessionMeta(sessionId, agentId) {
  const { sessions } = await listSessions(agentId);
  return sessions.find(s => s.sessionId === sessionId) || null;
}

/**
 * Read messages from a session JSONL file with line-based pagination.
 *
 * @param {string} sessionId
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.after]    - Start after this line number (0-based)
 * @param {number} [opts.limit]    - Max messages to return (default 50)
 * @param {string} [opts.filter]   - Message filter: 'all' | 'messages' (default 'messages')
 * @returns {Promise<{sessionId, messages: Array, nextCursor: number|null, hasMore: boolean}>}
 */
async function readMessages(sessionId, agentId, opts = {}) {
  const after = opts.after || 0;
  const limit = Math.min(opts.limit || 50, 200);
  const filter = opts.filter || 'messages';

  const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);
  try {
    await fs.promises.access(jsonlPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessionId, messages: [], nextCursor: null, hasMore: false };
    }
    throw err;
  }

  const messages = [];
  let lineNum = 0;
  let nextCursor = null;
  let hasMore = false;

  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNum++;

    if (lineNum <= after) continue;

    if (messages.length >= limit) {
      nextCursor = lineNum;
      hasMore = true;
      break;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (filter === 'messages' && parsed.type !== 'message') continue;

    messages.push({
      line: lineNum,
      type: parsed.type,
      id: parsed.id || null,
      timestamp: parsed.timestamp || null,
      ...(parsed.type === 'message' ? { message: parsed.message } : {}),
      ...(parsed.type === 'session' ? { session: { version: parsed.version, cwd: parsed.cwd } } : {}),
      ...(parsed.type === 'model_change' ? { model: { provider: parsed.provider, modelId: parsed.modelId } } : {}),
    });
  }

  rl.close();
  stream.destroy();

  return { sessionId, messages, nextCursor, hasMore };
}

/**
 * Read the last N messages from a session (for preview/initial load).
 *
 * @param {string} sessionId
 * @param {string} agentId
 * @param {number} [count=30]
 * @returns {Promise<{sessionId, messages: Array, totalLines: number}>}
 */
async function readLastMessages(sessionId, agentId, count = 30) {
  const jsonlPath = path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);

  let totalLines = 0;
  const allMessages = [];

  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.type === 'message') {
      allMessages.push({
        line: totalLines,
        type: parsed.type,
        id: parsed.id || null,
        timestamp: parsed.timestamp || null,
        message: parsed.message,
      });
    }
  }

  rl.close();
  stream.destroy();

  const messages = allMessages.slice(-count);

  return {
    sessionId,
    messages,
    totalLines,
    hasOlder: allMessages.length > count,
    oldestLine: messages.length > 0 ? messages[0].line : 0,
  };
}

/**
 * List all configured agents.
 * @returns {Promise<Array<{id, hasSessions, sessionCount}>>}
 */
async function listAgents() {
  let entries;
  try {
    entries = await fs.promises.readdir(AGENTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionsPath = path.join(AGENTS_DIR, entry.name, 'sessions', 'sessions.json');
    let hasSessions = false;
    let sessionCount = 0;
    try {
      const raw = JSON.parse(await fs.promises.readFile(sessionsPath, 'utf8'));
      hasSessions = true;
      sessionCount = normalizeSessions(raw).length;
    } catch {
      // no sessions
    }

    agents.push({ id: entry.name, hasSessions, sessionCount });
  }

  return agents;
}

/**
 * ── Session replay normalization ────────────────────────────────────────────
 *
 * Verified against live persisted transcripts (2026-08-24, schema v3).
 * Observed line types: session, model_change, thinking_level_change,
 * custom, custom_message, compaction, leaf, message.
 * Message roles: user, assistant (content blocks: thinking | toolCall | text),
 * toolResult (carries toolCallId, toolName, content[], details.*).
 */

function truncateText(value, max = PREVIEW_MAX_CHARS) {
  if (typeof value !== 'string') return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Extract epoch-ms timestamp from a parsed transcript line. */
function toEpochMs(parsed) {
  const inner = parsed && parsed.message && typeof parsed.message.timestamp === 'number'
    ? parsed.message.timestamp
    : null;
  if (inner !== null) return inner;
  if (parsed && parsed.data && typeof parsed.data.timestamp === 'number') return parsed.data.timestamp;
  if (parsed && typeof parsed.timestamp === 'string') {
    const ms = Date.parse(parsed.timestamp);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Join text out of a content field that may be a string or a block array. */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n');
  }
  return '';
}

/**
 * Trim heavy/derived keys from toolResult.details for list payloads.
 * `aggregated` duplicates the result body (can be huge); the full details
 * object stays available through the /events/:line detail endpoint.
 */
function slimDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  const slim = {};
  for (const key of ['status', 'exitCode', 'exitSignal', 'exitReason', 'durationMs', 'cwd']) {
    if (key in details) slim[key] = details[key];
  }
  return slim;
}

/**
 * Normalize ONE parsed JSONL transcript line into zero or more normalized
 * replay events. Pure: no fs/network access, no mutation of the input.
 *
 * Unknown/forward-compat line types pass through as generic `other` ticks —
 * never dropped (brief R2). One line may yield several events when an
 * assistant message carries thinking/toolCall/text blocks; all events share
 * the line's JSONL line number (stamped by the caller via `lineNumber`).
 *
 * @param {object} parsed - Parsed JSONL line object
 * @param {object} [opts]
 * @param {number} [opts.lineNumber] - JSONL line number stamped onto events
 * @param {boolean} [opts.truncate=false] - Truncate preview bodies (list mode)
 * @returns {Array<object>} Normalized events
 */
function normalizeTranscriptEvents(parsed, opts = {}) {
  const lineNumber = Number.isInteger(opts.lineNumber) ? opts.lineNumber : null;
  const truncate = opts.truncate !== false;
  const trim = (value) => (truncate ? truncateText(value) : (typeof value === 'string' ? value : null));

  if (!parsed || typeof parsed !== 'object') return [];

  const base = { line: lineNumber, ts: toEpochMs(parsed) };
  const type = parsed.type;

  // Unknown / forward-compat line types → generic tick (R2: never dropped).
  const KNOWN_TYPES = new Set([
    'session', 'model_change', 'compaction', 'message',
    'custom', 'custom_message', 'thinking_level_change', 'leaf',
  ]);
  if (!KNOWN_TYPES.has(type)) {
    return [{ ...base, kind: 'other', text: trim(String(parsed.customType || type || 'unknown')) }];
  }

  if (type === 'session') {
    return [{ ...base, kind: 'session_meta', text: trim(parsed.cwd ? `cwd ${parsed.cwd}` : parsed.id || null) }];
  }

  if (type === 'model_change') {
    const label = [parsed.provider, parsed.modelId].filter(Boolean).join('/');
    return [{ ...base, kind: 'model_change', text: trim(label || null) }];
  }

  if (type === 'compaction') {
    return [{ ...base, kind: 'compaction', text: trim(typeof parsed.summary === 'string' ? parsed.summary : null) }];
  }

  // System ticks: thinking_level_change, custom, custom_message, leaf.
  if (type !== 'message') {
    const label = parsed.customType
      || (type === 'thinking_level_change' && parsed.thinkingLevel ? `thinking:${parsed.thinkingLevel}` : null)
      || type;
    return [{ ...base, kind: 'other', text: trim(String(label)) }];
  }

  const message = parsed.message || {};
  const role = message.role;

  if (role === 'user') {
    return [{ ...base, kind: 'user_message', role: 'user', text: trim(contentToText(message.content)) }];
  }

  if (role === 'toolResult') {
    const tool = {
      toolCallId: message.toolCallId || null,
      name: message.toolName || null,
      resultPreview: trim(contentToText(message.content)),
    };
    const details = slimDetails(message.details);
    if (details) tool.details = details;
    return [{ ...base, kind: 'tool_result', role: 'toolResult', tool }];
  }

  if (role === 'assistant') {
    const blocks = Array.isArray(message.content) ? message.content : [];
    const events = [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'thinking') {
        events.push({ ...base, kind: 'assistant_thinking', role: 'assistant', text: trim(block.thinking) });
      } else if (block.type === 'toolCall') {
        let argsPreview = null;
        try {
          argsPreview = JSON.stringify(block.arguments ?? null);
        } catch {
          argsPreview = null;
        }
        events.push({
          ...base,
          kind: 'tool_call',
          role: 'assistant',
          tool: {
            toolCallId: block.id || null,
            name: block.name || null,
            argsPreview: truncate ? truncateText(argsPreview) : argsPreview,
            resultLine: null, // back-paired forward by readEvents
          },
        });
      } else if (block.type === 'text') {
        events.push({ ...base, kind: 'assistant_text', role: 'assistant', text: trim(block.text) });
      }
      // Unknown block types inside assistant messages are ignored here; the
      // raw line stays reachable through the detail endpoint's `source`.
    }
    return events;
  }

  // message line with unrecognized role → tick.
  return [{ ...base, kind: 'other', role: role || null, text: null }];
}

function sessionJsonlPath(agentId, sessionId) {
  return path.join(AGENTS_DIR, agentId, 'sessions', `${sessionId}.jsonl`);
}

/**
 * Stream a session transcript and yield { lineNumber, parsed|null } per line.
 * Enforces the size cap by reading only the first MAX_FILE_BYTES when the
 * file is larger (caller sees `truncated`). Parse failures surface as
 * `parsed: null` so callers can flag partial transcripts.
 * @yields {{lineNumber: number, parsed: object|null}}
 */
async function* iterateTranscript(jsonlPath, maxBytes = MAX_FILE_BYTES) {
  let stat;
  try {
    stat = await fs.promises.stat(jsonlPath);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  const truncated = stat.size > maxBytes;
  const stream = fs.createReadStream(jsonlPath, {
    encoding: 'utf8',
    ...(truncated ? { end: maxBytes - 1 } : {}),
  });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const raw of rl) {
    lineNumber++;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    yield { lineNumber, parsed };
  }

  rl.close();
  stream.destroy();
}

/** Pair forward tool_call events with their tool_result lines by toolCallId. */
function pairToolCall(pending, event, lineNumber) {
  if (event.kind === 'tool_call' && event.tool && event.tool.toolCallId) {
    pending.set(event.tool.toolCallId, event);
  } else if (event.kind === 'tool_result' && event.tool && event.tool.toolCallId) {
    const call = pending.get(event.tool.toolCallId);
    if (call) {
      call.tool.resultLine = lineNumber;
      pending.delete(event.tool.toolCallId);
    }
  }
}

/**
 * Read cursor-paginated normalized replay events for one session.
 *
 * Cursor = JSONL line offset (`afterLine` is exclusive, same convention as
 * readMessages). The `limit` bounds collected events; a single line's event
 * group is never split across pages, so a page may exceed `limit` by the
 * extra events of its last line. Scanning always runs to EOF (bounded by the
 * size cap) so tool_call→tool_result back-pairing works across chunk edges.
 *
 * @returns {Promise<{sessionId, agentId, events: Array, nextAfterLine: number|null,
 *   hasMore: boolean, totalLines: number, partial: boolean, truncated: boolean,
 *   notFound?: boolean}>}
 */
async function readEvents(sessionId, agentId, opts = {}) {
  const afterLine = Number.isInteger(opts.afterLine) && opts.afterLine > 0 ? opts.afterLine : 0;
  const limit = Math.min(
    Math.max(Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : EVENTS_DEFAULT_LIMIT, 1),
    EVENTS_MAX_LIMIT
  );
  const maxBytes = Number.isInteger(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : MAX_FILE_BYTES;

  const jsonlPath = sessionJsonlPath(agentId, sessionId);
  try {
    await fs.promises.access(jsonlPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessionId, agentId, events: [], nextAfterLine: null, hasMore: false, totalLines: 0, partial: false, truncated: false, notFound: true };
    }
    throw err;
  }

  const stat = await fs.promises.stat(jsonlPath);
  const truncated = stat.size > maxBytes;

  const events = [];
  const pending = new Map();
  let totalLines = 0;
  let partial = false;
  let pageFull = false;
  let lastPageLine = null;

  for await (const { lineNumber, parsed } of iterateTranscript(jsonlPath, maxBytes)) {
    totalLines = lineNumber;
    if (!parsed) {
      partial = true;
      continue;
    }

    const lineEvents = normalizeTranscriptEvents(parsed, { lineNumber });
    for (const event of lineEvents) pairToolCall(pending, event, lineNumber);

    if (pageFull || lineNumber <= afterLine) continue;

    if (events.length + lineEvents.length > limit && events.length > 0) {
      // Page boundary at line granularity: this whole line goes to the next page.
      pageFull = true;
      continue;
    }
    events.push(...lineEvents);
    lastPageLine = lineNumber;
  }

  const hasMore = lastPageLine !== null && lastPageLine < totalLines;
  const nextAfterLine = hasMore ? lastPageLine : null;

  return { sessionId, agentId, events, nextAfterLine, hasMore, totalLines, partial, truncated };
}

/**
 * Read the full-fidelity event(s) at one JSONL line (on-demand "load full
 * output"). Bodies are NOT truncated; the raw parsed source line is included
 * so exec-class `details.aggregated` etc. stay reachable.
 *
 * @returns {Promise<{sessionId, agentId, line, found: boolean, event: object|null,
 *   extraEvents: Array, source: object|null, totalLines: number, notFound?: boolean}>}
 */
async function readEventAtLine(sessionId, agentId, line, opts = {}) {
  const maxBytes = Number.isInteger(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : MAX_FILE_BYTES;
  const jsonlPath = sessionJsonlPath(agentId, sessionId);
  try {
    await fs.promises.access(jsonlPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { sessionId, agentId, line, found: false, event: null, extraEvents: [], source: null, totalLines: 0, notFound: true };
    }
    throw err;
  }

  const pending = new Map();
  let matched = null;
  let extraEvents = [];
  let source = null;
  let totalLines = 0;

  for await (const { lineNumber, parsed } of iterateTranscript(jsonlPath, maxBytes)) {
    totalLines = lineNumber;
    if (!parsed) continue;

    const lineEvents = normalizeTranscriptEvents(parsed, { lineNumber, truncate: false });
    for (const event of lineEvents) pairToolCall(pending, event, lineNumber);

    if (lineNumber === line && !matched) {
      matched = lineEvents[0] || null;
      extraEvents = lineEvents.slice(1);
      source = parsed;
    }
  }

  if (!matched) {
    return { sessionId, agentId, line, found: false, event: null, extraEvents: [], source: null, totalLines };
  }
  return { sessionId, agentId, line, found: true, event: matched, extraEvents, source, totalLines };
}

module.exports = {
  listSessions,
  listAllSessions,
  getSessionMeta,
  readMessages,
  readLastMessages,
  listAgents,
  normalizeSessions,
  normalizeTranscriptEvents,
  readEvents,
  readEventAtLine,
  AGENTS_DIR,
  MAX_FILE_BYTES,
  PREVIEW_MAX_CHARS,
  EVENTS_DEFAULT_LIMIT,
  EVENTS_MAX_LIMIT,
};
