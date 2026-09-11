/**
 * Settings routes — Control Panel API
 *
 * Phase 2 additions:
 *   - Rate limiting on writes (10 writes/min)
 *   - Changelog endpoint (GET /api/settings/changelog)
 *   - Graceful restart endpoint (POST /api/settings/restart)
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

function registerSettingsRoutes(router, settingsStore, deps = {}) {

  // ── Rate limiter: 10 write operations per 60 seconds ──
  const writeTimestamps = [];
  const WRITE_LIMIT = 10;
  const WRITE_WINDOW_MS = 60 * 1000;

  function checkRateLimit() {
    const now = Date.now();
    // Prune old entries
    while (writeTimestamps.length > 0 && writeTimestamps[0] < now - WRITE_WINDOW_MS) {
      writeTimestamps.shift();
    }
    if (writeTimestamps.length >= WRITE_LIMIT) {
      const oldest = writeTimestamps[0];
      const waitSecs = Math.ceil((oldest + WRITE_WINDOW_MS - now) / 1000);
      throw new Error(`Rate limit reached (${WRITE_LIMIT} writes/min). Try again in ${waitSecs}s.`);
    }
    writeTimestamps.push(now);
  }

  function addRoute(method, path, handler) {
    router.add(method, path, async (...args) => {
      await handler(...args);
      return true;
    });
  }

  // ── Specific routes FIRST ──

  addRoute('GET', '/api/settings', async (req, res) => {
    try {
      sendJSON(res, 200, { ok: true, settings: settingsStore.getAll() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('GET', '/api/settings/schema', async (req, res) => {
    try {
      sendJSON(res, 200, { ok: true, schema: settingsStore.getSchema() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('GET', '/api/settings/system-info', async (req, res) => {
    try {
      const info = settingsStore.getSystemInfo({
        startedAt: deps.startedAt,
        sseClients: deps.getSSEClientCount ? deps.getSSEClientCount() : 0,
        gatewayConnected: deps.gatewayClient ? deps.gatewayClient.connected : false,
      });
      sendJSON(res, 200, { ok: true, system: info });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('GET', '/api/settings/restart-required', async (req, res) => {
    sendJSON(res, 200, settingsStore.isRestartRequired());
  });

  addRoute('GET', '/api/settings/changelog', async (req, res) => {
    try {
      const log = settingsStore.getChangeLog();
      sendJSON(res, 200, { ok: true, changelog: log });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('POST', '/api/settings/test-db', async (req, res) => {
    const pool = deps.pool;
    if (!pool) {
      return sendJSON(res, 200, { ok: false, error: 'No database pool configured' });
    }
    try {
      const start = Date.now();
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      sendJSON(res, 200, { ok: true, latency: Date.now() - start });
    } catch (err) {
      sendJSON(res, 200, { ok: false, error: err.message });
    }
  });

  addRoute('POST', '/api/settings/test-gateway', async (req, res) => {
    const gc = deps.gatewayClient;
    sendJSON(res, 200, {
      ok: gc ? gc.connected : false,
      connected: gc ? gc.connected : false,
      url: gc ? (gc.url || 'unknown') : 'unknown',
    });
  });

  addRoute('POST', '/api/settings/export', async (req, res) => {
    try {
      sendJSON(res, 200, {
        ok: true,
        settings: settingsStore.exportSettings(),
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('POST', '/api/settings/import', async (req, res) => {
    try {
      checkRateLimit();
      const body = await parseBody(req);
      if (!body.settings || typeof body.settings !== 'object') {
        return sendJSON(res, 400, { error: 'settings object required' });
      }
      const results = settingsStore.importSettings(body.settings);
      sendJSON(res, 200, { ok: true, imported: results.length, ...settingsStore.isRestartRequired() });
    } catch (err) {
      const status = err.message.includes('Rate limit') ? 429 : 400;
      sendJSON(res, status, { error: err.message });
    }
  });

  addRoute('POST', '/api/settings/reload', async (req, res) => {
    try {
      settingsStore.load();
      sendJSON(res, 200, { ok: true, message: 'Settings reloaded from disk' });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('POST', '/api/settings/restart', async (req, res) => {
    try {
      const body = await parseBody(req);
      const confirm = body.confirm;
      if (confirm !== 'restart') {
        return sendJSON(res, 400, { error: 'Body must include { "confirm": "restart" }' });
      }
      // Respond before shutting down
      sendJSON(res, 200, { ok: true, message: 'Restarting server...' });
      // Graceful restart: close server, let process manager restart it
      setTimeout(() => {
        console.log('⚙️ Settings-triggered graceful restart');
        process.emit('SIGTERM');
      }, 500);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // ── Parameterized routes AFTER specific routes ──

  addRoute('PUT', '/api/settings/key/:key', async (req, res, ctx, params) => {
    try {
      checkRateLimit();
      const body = await parseBody(req);
      if (body.value === undefined) return sendJSON(res, 400, { error: 'value required' });
      const result = settingsStore.set(params.key, body.value);
      sendJSON(res, 200, { ok: true, ...result, ...settingsStore.isRestartRequired() });
    } catch (err) {
      const status = err.message.includes('Rate limit') ? 429 : 400;
      sendJSON(res, status, { error: err.message });
    }
  });

  addRoute('GET', '/api/settings/:category', async (req, res, ctx, params) => {
    try {
      const all = settingsStore.getAll();
      if (!all[params.category]) {
        return sendJSON(res, 404, { error: `Category '${params.category}' not found` });
      }
      sendJSON(res, 200, { ok: true, category: params.category, settings: all[params.category] });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  addRoute('PUT', '/api/settings/:category', async (req, res, ctx, params) => {
    try {
      checkRateLimit();
      const body = await parseBody(req);
      const results = settingsStore.setCategory(params.category, body);
      sendJSON(res, 200, { ok: true, updated: results, ...settingsStore.isRestartRequired() });
    } catch (err) {
      const status = err.message.includes('Rate limit') ? 429 : 400;
      sendJSON(res, status, { error: err.message });
    }
  });

  console.log('✅ Settings routes registered');
}

module.exports = { registerSettingsRoutes };
