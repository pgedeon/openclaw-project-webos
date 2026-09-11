/**
 * Cron route module — /api/cron/* endpoints.
 * Now backed by `openclaw cron` CLI instead of manual .cron file parsing.
 */
const oc = require('../lib/openclaw-cli');

function assertCliSuccess(data) {
  if (data && typeof data.error === 'string' && data.error.trim()) {
    throw new Error(data.error);
  }
}

function registerCronRoutes(router) {
  // GET /api/cron/jobs — list all cron jobs from gateway scheduler
  router.add('GET', '/api/cron/jobs', async (req, res, ctx) => {
    try {
      const data = await oc.cronList();
      assertCliSuccess(data);
      // Normalize: CLI returns { jobs: [...] }, keep that shape
      const jobs = (data.jobs || []).map(j => ({
        id: j.id,
        name: j.name || j.id,
        description: j.description || '',
        schedule: j.schedule?.expr || j.schedule?.kind || '',
        enabled: j.enabled !== false,
        status: j.state?.lastRunStatus || 'unknown',
        lastRun: j.state?.lastRunAtMs ? new Date(j.state.lastRunAtMs).toISOString() : null,
        nextRun: j.state?.nextRunAtMs ? new Date(j.state.nextRunAtMs).toISOString() : null,
        agentId: j.payload?.agentId || j.agentId || null,
        model: j.payload?.model || null,
        // Preserve the full job for the frontend to access any field
        _raw: j,
      }));
      ctx.sendJSON(res, 200, { jobs });
    } catch (err) {
      console.error('[Cron] Failed to list jobs:', err);
      ctx.sendJSON(res, 500, { error: 'Failed to list cron jobs', details: err.message });
    }
    return true;
  });

  // GET /api/cron/jobs/:id/runs — get run history for a job
  router.add('GET', '/api/cron/jobs/:id/runs', async (req, res, ctx, params) => {
    try {
      const data = await oc.cronRuns(params.id, 10);
      assertCliSuccess(data);
      const runs = data.runs || data || [];
      ctx.sendJSON(res, 200, { runs });
    } catch (err) {
      console.error(`[Cron] Failed to get runs for ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to get job runs', details: err.message });
    }
    return true;
  });

  // POST /api/cron/jobs/:id/run — trigger a job manually
  router.add('POST', '/api/cron/jobs/:id/run', async (req, res, ctx, params) => {
    try {
      const data = await oc.cronRun(params.id);
      assertCliSuccess(data);
      ctx.sendJSON(res, 202, { success: true, message: 'Job triggered', data });
    } catch (err) {
      console.error(`[Cron] Failed to run job ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to start job', details: err.message });
    }
    return true;
  });

  // POST /api/cron/jobs/:id/enable — enable a disabled job
  router.add('POST', '/api/cron/jobs/:id/enable', async (req, res, ctx, params) => {
    try {
      const data = await oc.cronEnable(params.id);
      assertCliSuccess(data);
      ctx.sendJSON(res, 200, { success: true, data });
    } catch (err) {
      console.error(`[Cron] Failed to enable job ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to enable job', details: err.message });
    }
    return true;
  });

  // POST /api/cron/jobs/:id/disable — disable a job
  router.add('POST', '/api/cron/jobs/:id/disable', async (req, res, ctx, params) => {
    try {
      const data = await oc.cronDisable(params.id);
      assertCliSuccess(data);
      ctx.sendJSON(res, 200, { success: true, data });
    } catch (err) {
      console.error(`[Cron] Failed to disable job ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to disable job', details: err.message });
    }
    return true;
  });

  // ── Legacy file-based routes (kept for backward compat) ──────
  // POST /api/cron/jobs — create new cron job (still file-based)
  router.add('POST', '/api/cron/jobs', async (req, res, ctx) => {
    try {
      const body = await ctx.readBody(req).then(b => JSON.parse(b));
      const { id, description, minute, hour, dom, month, dow, command } = body;
      if (!id || !command) {
        ctx.sendJSON(res, 400, { error: 'id and command are required' });
        return true;
      }
      const fs = require('fs');
      const path = require('path');
      const cronDir = path.join(process.env.WORKSPACE_ROOT || process.cwd(), '.cron');
      if (!fs.existsSync(cronDir)) fs.mkdirSync(cronDir, { recursive: true });
      const filePath = path.join(cronDir, `${id}.cron`);
      let fileContent = '';
      if (description) fileContent += `# ${description}\n`;
      fileContent += `${minute || '*'} ${hour || '*'} ${dom || '*'} ${month || '*'} ${dow || '*'} ${command}\n`;
      fs.writeFileSync(filePath, fileContent);
      ctx.sendJSON(res, 201, { success: true, id });
    } catch (err) {
      console.error('[Cron] Failed to create job:', err);
      ctx.sendJSON(res, 500, { error: 'Failed to create cron job' });
    }
    return true;
  });

  // DELETE /api/cron/jobs/:id — delete cron job (file-based)
  router.add('DELETE', '/api/cron/jobs/:id', async (req, res, ctx, params) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const cronDir = path.join(process.env.WORKSPACE_ROOT || process.cwd(), '.cron');
      const filePath = path.join(cronDir, `${params.id}.cron`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        ctx.sendJSON(res, 200, { success: true });
      } else {
        ctx.sendJSON(res, 404, { error: 'Job not found' });
      }
    } catch (err) {
      console.error(`[Cron] Failed to delete job ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to delete cron job' });
    }
    return true;
  });
}

module.exports = { registerCronRoutes };
