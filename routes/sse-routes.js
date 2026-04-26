/**
 * SSE (Server-Sent Events) route module
 *
 * Provides a real-time event stream at GET /api/events.
 * Other route modules can call broadcast() to push updates to all connected clients.
 */

const clients = new Set();
let heartbeatInterval = null;

/**
 * Broadcast an event to all connected SSE clients.
 * @param {string} event - Event name (e.g. 'task:changed')
 * @param {object} data - Payload to send
 */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (event.startsWith('session:chat') || event.startsWith('gateway:')) {
    console.log(`[SSE-broadcast] ${event} to ${clients.size} clients, keys: ${Object.keys(data || {}).join(',')}`);
  }
  for (const res of clients) {
    try {
      res.write(payload);
    } catch (_) {
      // Client disconnected; will be cleaned up on next heartbeat
      clients.delete(res);
    }
  }
}

/**
 * Start the heartbeat interval that keeps SSE connections alive.
 */
function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const now = new Date().toISOString();
    const dead = [];
    for (const res of clients) {
      try {
        res.write(`: heartbeat ${now}\n\n`);
      } catch (_) {
        dead.push(res);
      }
    }
    for (const r of dead) clients.delete(r);
  }, 30_000);
  // Don't prevent process exit
  if (heartbeatInterval.unref) heartbeatInterval.unref();
}

/**
 * Register SSE routes on the router.
 * @param {Router} router
 */
function registerSSERoutes(router) {
  // GET /api/events — SSE stream
  router.add('GET', '/api/events', async (req, res, ctx) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': 'http://localhost:' + (process.env.PORT || 3876),
    });
    res.write(`: connected\n\n`);
    clients.add(res);

    // Clean up on close
    req.on('close', () => {
      clients.delete(res);
    });

    startHeartbeat();
    // Return true — we handled it (but the connection stays open)
    return true;
  });
}

module.exports = { registerSSERoutes, broadcast };
