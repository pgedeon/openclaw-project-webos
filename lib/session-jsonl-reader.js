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

module.exports = {
  listSessions,
  listAllSessions,
  getSessionMeta,
  readMessages,
  readLastMessages,
  listAgents,
  normalizeSessions,
  AGENTS_DIR,
};
