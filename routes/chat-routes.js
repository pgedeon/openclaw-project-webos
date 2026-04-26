/**
 * Chat routes — Phase 3 Integration
 *
 * REST endpoints for sending messages to OpenClaw sessions.
 * Gateway WebSocket client handles the actual message delivery.
 * Responses stream back via SSE events.
 */

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// Simple in-memory rate limiter
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 30;
const MAX_MESSAGE_LENGTH = 10000;

function checkRateLimit(sessionKey) {
  const now = Date.now();
  const limit = rateLimits.get(sessionKey);
  if (!limit || now > limit.resetAt) {
    rateLimits.set(sessionKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (limit.count >= RATE_LIMIT_MAX) return false;
  limit.count++;
  return true;
}

/**
 * Register chat routes.
 * @param {object} router - Router instance
 * @param {object} gatewayClient - GatewayClient instance (or null)
 */
function registerChatRoutes(router, gatewayClient) {

  // POST /api/oc/chat/send — Send a message to a session
  router.add('POST', '/api/oc/chat/send', async (req, res) => {
    if (!gatewayClient || !gatewayClient.connected) {
      sendJSON(res, 503, { error: 'Gateway not connected' });
      return;
    }

    const body = await parseBody(req);
    const { sessionKey, message } = body;

    if (!sessionKey) {
      return sendJSON(res, 400, { error: 'sessionKey required' });
    }
    if (!message || !message.trim()) {
      return sendJSON(res, 400, { error: 'message required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return sendJSON(res, 400, { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
    }
    if (!checkRateLimit(sessionKey)) {
      return sendJSON(res, 429, { error: 'Rate limit exceeded' });
    }

    try {
      const result = await gatewayClient.chatSend({
        sessionKey,
        message: message.trim(),
      });

      sendJSON(res, 200, {
        ok: true,
        runId: result.runId || result.id || null,
      });
    } catch (err) {
      const status = err.code === 'SESSION_NOT_FOUND' ? 404
                   : err.code === 'SESSION_BUSY' ? 409
                   : err.code === 'RATE_LIMITED' ? 429
                   : 500;
      sendJSON(res, status, { error: err.message, code: err.code || null });
    }
  });

  // POST /api/oc/chat/abort — Abort a running turn
  router.add('POST', '/api/oc/chat/abort', async (req, res) => {
    if (!gatewayClient || !gatewayClient.connected) {
      sendJSON(res, 503, { error: 'Gateway not connected' });
      return;
    }

    const body = await parseBody(req);
    const { sessionKey, runId } = body;

    if (!sessionKey) {
      return sendJSON(res, 400, { error: 'sessionKey required' });
    }

    try {
      const result = await gatewayClient.chatAbort(sessionKey, runId);
      sendJSON(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/oc/chat/status — Check gateway connection status
  router.add('GET', '/api/oc/chat/status', async (req, res) => {
    sendJSON(res, 200, {
      connected: gatewayClient?.connected || false,
      gatewayUrl: gatewayClient?.url || null,
    });
  });
}

module.exports = { registerChatRoutes };
