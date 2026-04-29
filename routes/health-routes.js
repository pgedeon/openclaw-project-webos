/**
 * Health, stats, and citation-queue route module.
 */
const { URL } = require('url');

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

  // GET /api/health-status
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
      } catch (_) {
        // cron health file not available — skip silently
      }

      ctx.sendJSON(res, 200, healthData);
    } catch (err) {
      ctx.sendJSON(res, 500, { status: 'error', error: err.message });
    }
    return true;
  });

  // GET /api/auth/self — returns current auth mode and actor info
  // Excluded from token auth in task-server.js middleware
  router.add('GET', '/api/auth/self', async (req, res, ctx) => {
    const hasToken = !!(process.env.DASHBOARD_AUTH_TOKEN);
    ctx.sendJSON(res, 200, {
      mode: hasToken ? 'token' : 'none',
      actor: 'dashboard-operator',
      role: 'operator',
      authenticated: true,
    });
    return true;
  });

  // GET /api/routes — Route catalog (auto-generated from router)
  router.add('GET', '/api/routes', async (req, res) => {
    const routes = router.list ? router.list() : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes, total: routes.length }));
    return true;
  });
}

module.exports = { registerHealthRoutes };
