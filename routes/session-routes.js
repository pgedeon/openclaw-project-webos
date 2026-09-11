/**
 * OpenClaw Session routes — Phase 1 Integration
 *
 * Provides read-only access to OpenClaw sessions and conversation history.
 * All endpoints require Bearer token auth (handled by main middleware).
 */

const Router = require('./router');
const reader = require('../lib/session-jsonl-reader');

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Parse query string from the full URL.
 * The router strips query strings, so we parse from req.url.
 */
function getQuery(req) {
  const fullUrl = req.url || '';
  const qIdx = fullUrl.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(fullUrl.slice(qIdx));
}

/**
 * Extract the channel/kind from a session key.
 * e.g. "agent:main:webchat:abc" → "webchat"
 *      "agent:main:subagent:uuid" → "subagent"
 */
function sessionChannel(key) {
  if (!key) return 'unknown';
  const parts = key.split(':');
  if (parts.length >= 3) return parts[2];
  return 'unknown';
}

function sessionIcon(kind) {
  const icons = {
    webchat: '💬', subagent: '🔧', signal: '📱', telegram: '✈️',
    discord: '🎮', cron: '⏰', dreaming: '💭', unknown: '❓',
  };
  return icons[kind] || '❓';
}

function sessionStatusColor(session) {
  const ageMs = Date.now() - (session.updatedAt || 0);
  if (ageMs < 5 * 60 * 1000) return 'active';
  if (ageMs < 60 * 60 * 1000) return 'recent';
  return 'idle';
}

/**
 * Register all OpenClaw session routes.
 * @param {Router} router
 */
function registerSessionRoutes(router) {

  // GET /api/oc/agents — list all agents with session counts
  router.add('GET', '/api/oc/agents', async (req, res) => {
    const agents = await reader.listAgents();
    sendJSON(res, 200, { agents });
  });

  // GET /api/oc/sessions — list sessions (optionally filtered)
  router.add('GET', '/api/oc/sessions', async (req, res) => {
    const query = getQuery(req);
    const agentId = query.get('agent') || 'main';
    const activeMinutes = query.get('active') ? parseInt(query.get('active'), 10) : null;

    if (query.get('all') === 'true') {
      const allData = await reader.listAllSessions({ activeMinutes });
      const sessions = [];
      for (const agentData of allData) {
        for (const s of agentData.sessions) {
          const kind = sessionChannel(s.key);
          sessions.push({
            ...s,
            agentId: agentData.agentId,
            kind,
            channel: kind,
            icon: sessionIcon(kind),
            status: sessionStatusColor(s),
          });
        }
      }
      sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      sendJSON(res, 200, { sessions, total: sessions.length });
    } else {
      const data = await reader.listSessions(agentId, { activeMinutes });
      const sessions = data.sessions.map(s => ({
        ...s,
        kind: sessionChannel(s.key),
        channel: sessionChannel(s.key),
        icon: sessionIcon(sessionChannel(s.key)),
        status: sessionStatusColor(s),
      }));
      sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      sendJSON(res, 200, { agentId, sessions, total: sessions.length });
    }
  });

  // GET /api/oc/sessions/:sessionId — session metadata + last messages
  router.add('GET', '/api/oc/sessions/:sessionId', async (req, res, ctx, params) => {
    const query = getQuery(req);
    const { sessionId } = params;
    const agentId = query.get('agent') || 'main';
    const msgCount = parseInt(query.get('messages') || '30', 10);

    const meta = await reader.getSessionMeta(sessionId, agentId);
    if (!meta) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }

    const messages = await reader.readLastMessages(sessionId, agentId, msgCount);
    const kind = sessionChannel(meta.key);

    sendJSON(res, 200, {
      ...meta,
      kind,
      channel: kind,
      icon: sessionIcon(kind),
      status: sessionStatusColor(meta),
      messages: messages.messages,
      totalLines: messages.totalLines,
      hasOlder: messages.hasOlder,
      oldestLine: messages.oldestLine,
    });
  });

  // GET /api/oc/sessions/:sessionId/messages — paginated message history
  router.add('GET', '/api/oc/sessions/:sessionId/messages', async (req, res, ctx, params) => {
    const query = getQuery(req);
    const { sessionId } = params;
    const agentId = query.get('agent') || 'main';
    const after = parseInt(query.get('after') || '0', 10);
    const limit = parseInt(query.get('limit') || '50', 10);
    const filter = query.get('filter') || 'messages';

    const result = await reader.readMessages(sessionId, agentId, { after, limit, filter });
    sendJSON(res, 200, result);
  });

  // GET /api/oc/sessions/:sessionId/events — cursor-paginated normalized replay events
  router.add('GET', '/api/oc/sessions/:sessionId/events', async (req, res, ctx, params) => {
    const query = getQuery(req);
    const { sessionId } = params;
    const agentId = query.get('agent') || 'main';
    const afterLine = parseInt(query.get('afterLine') || '0', 10);
    const limit = parseInt(query.get('limit') || String(reader.EVENTS_DEFAULT_LIMIT || 500), 10);

    const result = await reader.readEvents(sessionId, agentId, {
      afterLine: Number.isNaN(afterLine) ? 0 : afterLine,
      limit,
    });
    if (result.notFound) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }
    sendJSON(res, 200, result);
  });

  // GET /api/oc/sessions/:sessionId/events/:line — full-body detail for one event
  router.add('GET', '/api/oc/sessions/:sessionId/events/:line', async (req, res, ctx, params) => {
    const query = getQuery(req);
    const { sessionId } = params;
    const agentId = query.get('agent') || 'main';
    const line = parseInt(params.line, 10);

    if (Number.isNaN(line) || line < 1) {
      return sendJSON(res, 400, { error: 'Invalid line number' });
    }

    const result = await reader.readEventAtLine(sessionId, agentId, line);
    if (result.notFound) {
      return sendJSON(res, 404, { error: 'Session not found' });
    }
    if (!result.found) {
      return sendJSON(res, 404, { error: 'Event not found' });
    }
    sendJSON(res, 200, result);
  });
}

module.exports = { registerSessionRoutes, sessionChannel, sessionIcon, sessionStatusColor };
