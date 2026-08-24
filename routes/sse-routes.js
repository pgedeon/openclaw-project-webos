/**
 * SSE (Server-Sent Events) route module
 *
 * Provides real-time event streams:
 *   GET /api/events         — legacy poller-fed stream (direct write per client)
 *   GET /api/events/stream  — bridge-fed stream (per-client bounded queue,
                             drop-oldest + `resync` hint on overflow)
 * Other route modules can call broadcast() / broadcastStream() to push updates.
 */

const clients = new Set();

// Bridge-fed channel: res → { queue, overflowed, drainAttached }.
const streamClients = new Map();
const STREAM_QUEUE_MAX = 100;

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
 * Broadcast an event to all bridge-fed (/api/events/stream) clients.
 * Per-client bounded queue: when the socket buffers (res.write === false),
 * frames queue up to STREAM_QUEUE_MAX; on overflow the oldest frame is dropped
 * and a single `resync` hint is queued so the client does one manual refresh.
 * @param {string} event - Event name (e.g. 'task-updated')
 * @param {object} data - Payload to send
 */
function broadcastStream(event, data) {
  // Serialize once so unserializable payloads throw here, before any client write.
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [res, client] of streamClients) {
    try {
      enqueueStreamWrite(res, client, payload);
    } catch (_) {
      // Client disconnected; cleaned up on close/heartbeat
      streamClients.delete(res);
    }
  }
}

function enqueueStreamWrite(res, client, payload) {
  if (client.queue.length > 0) {
    pushStreamQueue(client, payload);
    return;
  }
  const ok = res.write(payload);
  if (ok === false) {
    // Socket buffered: start queuing and flush on drain.
    pushStreamQueue(client, payload);
    attachStreamDrain(res, client);
  }
}

function pushStreamQueue(client, payload) {
  if (client.queue.length >= STREAM_QUEUE_MAX) {
    client.queue.shift(); // drop oldest
    if (!client.overflowed) {
      client.overflowed = true;
      client.queue.push('event: resync\ndata: {"reason":"overflow"}\n\n');
    }
  }
  client.queue.push(payload);
}

function attachStreamDrain(res, client) {
  if (client.drainAttached) return;
  client.drainAttached = true;
  res.on('drain', () => {
    while (client.queue.length > 0) {
      let ok;
      try {
        ok = res.write(client.queue[0]);
      } catch (_) {
        streamClients.delete(res);
        return;
      }
      if (ok === false) return; // keep waiting for drain
      client.queue.shift();
    }
    client.overflowed = false;
  });
}

/**
 * Number of connected bridge-fed stream clients (diagnostics/tests).
 * @returns {number}
 */
function getStreamClientCount() {
  return streamClients.size;
}

/**
 * Start the heartbeat interval that keeps SSE connections alive.
 */
function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const now = new Date().toISOString();
    const frame = `: heartbeat ${now}\n\n`;
    const dead = [];
    for (const res of clients) {
      try {
        res.write(frame);
      } catch (_) {
        dead.push(res);
      }
    }
    for (const r of dead) clients.delete(r);
    for (const [res, client] of streamClients) {
      try {
        // Route through the queue so heartbeats never reorder pending frames.
        enqueueStreamWrite(res, client, frame);
      } catch (_) {
        streamClients.delete(res);
      }
    }
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

  // GET /api/events/stream — bridge-fed SSE stream.
  // Auth is inherited from task-server's /api/* middleware (Bearer preferred,
  // ?token= legacy fallback for EventSource). The gateway shared secret never
  // reaches this surface — frames are normalized dashboard-internal events.
  router.add('GET', '/api/events/stream', async (req, res, ctx) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': 'http://localhost:' + (process.env.PORT || 3876),
    });
    res.write(`: connected\n\n`);
    streamClients.set(res, { queue: [], overflowed: false, drainAttached: false });

    // Clean up on close
    req.on('close', () => {
      streamClients.delete(res);
    });

    startHeartbeat();
    return true;
  });
}

module.exports = { registerSSERoutes, broadcast, broadcastStream, getStreamClientCount };
