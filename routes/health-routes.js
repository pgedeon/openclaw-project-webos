/**
 * Health, stats, and citation-queue route module.
 * Enhanced with `openclaw health --json` integration.
 */
const { URL } = require('url');
const oc = require('../lib/openclaw-cli');

function registerHealthRoutes(router) {
  // GET /api/health
  router.add('GET', '/api/health', async (req, res, ctx) => {
    const storageHealth = await ctx.getAsanaStorageHealth();
    ctx.sendJSON(res, 200, {
      status: storageHealth.ready ? (storageHealth.databaseHealthy ? 'ok' : 'degraded') : 'error',
      timestamp: new Date().toISOString(),
      asana_storage: storageHealth.mode,
      storage_type: ctx.STORAGE_TYPE,
      storage_mode: storageHealth.mode,
      storage_label: storageHealth.label,
      storage_note: storageHealth.note,
      db_latency_ms: storageHealth.dbLatencyMs,
      uptime: process.uptime(),
      port: ctx.PORT,
    });
    return true;
  });

  // GET /api/stats
  router.add('GET', '/api/stats', async (req, res, ctx) => {
    if (!ctx.asanaStorage) {
      ctx.sendJSON(res, 503, { error: 'Asana storage not initialized' });
      return true;
    }
    const stats = await ctx.asanaStorage.stats();
    ctx.sendJSON(res, 200, stats);
    return true;
  });

  // GET /api/citation-queue/status
  router.add('GET', '/api/citation-queue/status', async (req, res, ctx) => {
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        'python3 /root/.openclaw/workspace/affiliate-editorial/scripts/citation_queue.py --action status 2>/dev/null',
        { encoding: 'utf-8', timeout: 5000 }
      );
      const data = JSON.parse(result);
      ctx.sendJSON(res, 200, {
        success: true,
        ...data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[CitationQueue] Failed to get status:', err.message);
      ctx.sendJSON(res, 500, { error: 'Failed to get citation queue status', details: err.message });
    }
    return true;
  });

  // GET /api/health-status — unified health (dashboard-local + openclaw gateway)
  router.add('GET', '/api/health-status', async (req, res, ctx) => {
    try {
      const gatewaySnapshot = ctx.readGatewayStatusSnapshot();
      const storageHealth = await ctx.getAsanaStorageHealth();
      const databaseHealthy = storageHealth.databaseHealthy;
      const gatewayHealthy = gatewaySnapshot.healthy;
      const overallStatus = databaseHealthy && gatewayHealthy
        ? 'healthy'
        : storageHealth.ready || gatewayHealthy
          ? 'degraded'
          : 'error';

      const healthData = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        database: {
          status: storageHealth.label,
          healthy: databaseHealthy,
          mode: storageHealth.mode,
          note: storageHealth.note || undefined,
        },
        gateway: {
          status: gatewaySnapshot.status,
          healthy: gatewayHealthy,
          synced_at: gatewaySnapshot.syncedAt,
          age_ms: gatewaySnapshot.ageMs,
          agent_count: gatewaySnapshot.agentCount,
          note: gatewaySnapshot.error || undefined,
        },
        task_server: { healthy: true, status: 'running' },
        checks: {
          database: {
            healthy: databaseHealthy,
            status: storageHealth.label,
            mode: storageHealth.mode,
            note: storageHealth.note || undefined,
          },
          gateway_sync: {
            healthy: gatewayHealthy,
            status: gatewaySnapshot.status,
            note: gatewaySnapshot.error || (gatewaySnapshot.syncedAt
              ? `Last sync ${gatewaySnapshot.syncedAt}`
              : 'Gateway sync has not produced a snapshot yet'),
            count: gatewaySnapshot.agentCount,
          },
          task_server: {
            healthy: true,
            status: 'running',
          },
        },
      };

      // Add cron health data if available
      try {
        const fs = require('fs');
        const cronHealthPath = '/root/.openclaw/workspace/logs/cron-health.json';
        if (fs.existsSync(cronHealthPath)) {
          const cronData = JSON.parse(fs.readFileSync(cronHealthPath, 'utf8'));
          healthData.cron = {
            status: cronData.status,
            total_errors: cronData.total_errors,
            details: cronData.details,
            checked_at: cronData.timestamp,
          };
          healthData.checks.cron_jobs = {
            healthy: cronData.status === 'ok',
            status: cronData.status,
            total_errors: cronData.total_errors,
            note: cronData.total_errors > 0 ? `${cronData.total_errors} errors across ${cronData.details.length} jobs` : 'All cron jobs healthy',
          };
        }
      } catch (_) { /* skip */ }

      ctx.sendJSON(res, 200, healthData);
    } catch (err) {
      ctx.sendJSON(res, 500, { status: 'error', error: err.message });
    }
    return true;
  });

  // GET /api/openclaw/health — direct proxy to `openclaw health --json`
  router.add('GET', '/api/openclaw/health', async (req, res, ctx) => {
    try {
      const data = await oc.health();
      ctx.sendJSON(res, 200, {
        source: 'openclaw-cli',
        timestamp: new Date().toISOString(),
        ok: data.ok || false,
        channels: data.channels || {},
        agents: data.agents || [],
        heartbeatSeconds: data.heartbeatSeconds,
        defaultAgentId: data.defaultAgentId,
      });
    } catch (err) {
      console.error('[Health] CLI health failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to get OpenClaw health', details: err.message });
    }
    return true;
  });

  // GET /api/openclaw/tasks — background tasks from `openclaw tasks list`
  router.add('GET', '/api/openclaw/tasks', async (req, res, ctx) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {};
      if (url.searchParams.get('runtime')) filters.runtime = url.searchParams.get('runtime');
      if (url.searchParams.get('status')) filters.status = url.searchParams.get('status');
      const data = await oc.tasksList(filters);
      ctx.sendJSON(res, 200, {
        source: 'openclaw-cli',
        timestamp: new Date().toISOString(),
        count: data.count || (data.tasks || []).length,
        tasks: data.tasks || [],
      });
    } catch (err) {
      console.error('[Tasks] CLI tasks list failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to list tasks', details: err.message });
    }
    return true;
  });

  // GET /api/openclaw/tasks/audit — stale/broken task audit
  router.add('GET', '/api/openclaw/tasks/audit', async (req, res, ctx) => {
    try {
      const data = await oc.tasksAudit();
      ctx.sendJSON(res, 200, { source: 'openclaw-cli', ...data });
    } catch (err) {
      console.error('[Tasks] CLI audit failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to audit tasks', details: err.message });
    }
    return true;
  });

  // GET /api/openclaw/agents — agent list from `openclaw agents list`
  router.add('GET', '/api/openclaw/agents', async (req, res, ctx) => {
    try {
      const data = await oc.agentsList();
      // CLI returns an array directly
      const agents = Array.isArray(data) ? data : (data.agents || []);
      ctx.sendJSON(res, 200, {
        source: 'openclaw-cli',
        timestamp: new Date().toISOString(),
        agents,
      });
    } catch (err) {
      console.error('[Agents] CLI agents list failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to list agents', details: err.message });
    }
    return true;
  });

  // POST /api/openclaw/memory/index — trigger memory reindex
  router.add('POST', '/api/openclaw/memory/index', async (req, res, ctx) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = url.searchParams.get('agent') || 'main';
      const data = await oc.memoryIndex(agentId);
      ctx.sendJSON(res, 200, { source: 'openclaw-cli', success: true, agentId, result: data });
    } catch (err) {
      console.error('[Memory] CLI reindex failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to reindex memory', details: err.message });
    }
    return true;
  });

  // GET /api/openclaw/memory/promote — preview promotion candidates
  // POST /api/openclaw/memory/promote — apply promotions
  router.add('GET', '/api/openclaw/memory/promote', async (req, res, ctx) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const agentId = url.searchParams.get('agent') || 'main';
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const data = await oc.memoryPromote(agentId, { limit });
      ctx.sendJSON(res, 200, { source: 'openclaw-cli', agentId, ...data });
    } catch (err) {
      console.error('[Memory] CLI promote preview failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to preview promotions', details: err.message });
    }
    return true;
  });

  router.add('POST', '/api/openclaw/memory/promote', async (req, res, ctx) => {
    try {
      let body = {};
      try { body = JSON.parse(await ctx.readBody(req)); } catch (_) {}
      const agentId = body.agent || 'main';
      const data = await oc.memoryPromote(agentId, { apply: true, limit: body.limit });
      ctx.sendJSON(res, 200, { source: 'openclaw-cli', success: true, agentId, ...data });
    } catch (err) {
      console.error('[Memory] CLI promote apply failed:', err);
      ctx.sendJSON(res, 502, { error: 'Failed to apply promotions', details: err.message });
    }
    return true;
  });

  // GET /api/auth/self — returns current auth mode and actor info
  router.add('GET', '/api/auth/self', async (req, res) => {
    const authHeader = req.headers['authorization'] || '';
    const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '').trim();
    const expectedToken = process.env.DASHBOARD_AUTH_TOKEN || '';
    const authenticated = token && token === expectedToken;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated,
      mode: expectedToken ? 'token' : 'open',
      user: authenticated ? 'dashboard-operator' : null,
    }));
    return true;
  });

  // GET /api/routes — Route catalog
  router.add('GET', '/api/routes', async (req, res) => {
    const routes = router.list ? router.list() : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes, total: routes.length }));
    return true;
  });
}

module.exports = { registerHealthRoutes };
