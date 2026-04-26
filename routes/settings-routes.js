/**
 * Settings routes — Control Panel API
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

function registerSettingsRoutes(router, settingsStore, deps) {

  // ── Specific routes FIRST ──

  router.add('GET', '/api/settings', async (req, res) => {
    try {
      sendJSON(res, 200, { ok: true, settings: settingsStore.getAll() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  router.add('GET', '/api/settings/schema', async (req, res) => {
    try {
      sendJSON(res, 200, { ok: true, schema: settingsStore.getSchema() });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  router.add('GET', '/api/settings/system-info', async (req, res) => {
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

  router.add('GET', '/api/settings/restart-required', async (req, res) => {
    sendJSON(res, 200, settingsStore.isRestartRequired());
  });

  router.add('POST', '/api/settings/test-db', async (req, res) => {
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

  router.add('POST', '/api/settings/test-gateway', async (req, res) => {
    const gc = deps.gatewayClient;
    sendJSON(res, 200, {
      ok: gc ? gc.connected : false,
      connected: gc ? gc.connected : false,
      url: gc ? (gc.url || 'unknown') : 'unknown',
    });
  });

  router.add('POST', '/api/settings/export', async (req, res) => {
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

  router.add('POST', '/api/settings/import', async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body.settings || typeof body.settings !== 'object') {
        return sendJSON(res, 400, { error: 'settings object required' });
      }
      const results = settingsStore.importSettings(body.settings);
      sendJSON(res, 200, { ok: true, imported: results.length, ...settingsStore.isRestartRequired() });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
  });

  router.add('POST', '/api/settings/reload', async (req, res) => {
    try {
      settingsStore.load();
      sendJSON(res, 200, { ok: true, message: 'Settings reloaded from disk' });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // ── Parameterized routes AFTER specific routes ──

  router.add('PUT', '/api/settings/key/:key', async (req, res, ctx, params) => {
    try {
      const body = await parseBody(req);
      if (body.value === undefined) return sendJSON(res, 400, { error: 'value required' });
      const result = settingsStore.set(params.key, body.value);
      sendJSON(res, 200, { ok: true, ...result, ...settingsStore.isRestartRequired() });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
  });

  router.add('GET', '/api/settings/:category', async (req, res, ctx, params) => {
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

  router.add('PUT', '/api/settings/:category', async (req, res, ctx, params) => {
    try {
      const body = await parseBody(req);
      const results = settingsStore.setCategory(params.category, body);
      sendJSON(res, 200, { ok: true, updated: results, ...settingsStore.isRestartRequired() });
    } catch (err) {
      sendJSON(res, 400, { error: err.message });
    }
  });

  console.log('✅ Settings routes registered');
}

module.exports = { registerSettingsRoutes };
