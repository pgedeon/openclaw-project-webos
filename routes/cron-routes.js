/**
 * Cron route module — /api/cron/* endpoints.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKSPACE = '/root/.openclaw/workspace';

function parseCronFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const comments = [];
    let cronLine = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#')) {
          comments.push(trimmed.slice(1).trim());
        }
        continue;
      }
      cronLine = trimmed;
      break;
    }

    if (!cronLine) return null;

    const cronMatch = cronLine.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!cronMatch) {
      console.warn(`[Cron] Invalid cron line in ${filePath}: ${cronLine}`);
      return null;
    }

    const [, minute, hour, dom, month, dow, command] = cronMatch;
    const schedule = [minute, hour, dom, month, dow].join(' ');

    let logPath = null;
    const redirMatch = command.match(/(?:>>|>)\s*(\S+)/);
    if (redirMatch) {
      logPath = redirMatch[1];
      if (!path.isAbsolute(logPath)) {
        logPath = path.join(WORKSPACE, logPath);
      }
    }

    let description = comments.join(' ');
    if (!description) {
      description = path.basename(filePath, '.cron');
    }

    const id = path.basename(filePath, '.cron');

    return { id, name: description, schedule, command, description, logPath };
  } catch (err) {
    console.error(`[Cron] Error parsing ${filePath}:`, err.message);
    return null;
  }
}

async function listCronJobs() {
  const crontabDir = path.join(WORKSPACE, 'crontab');
  const files = fs.readdirSync(crontabDir).filter(f => f.endsWith('.cron'));
  const jobs = [];

  for (const file of files) {
    const fullPath = path.join(crontabDir, file);
    const job = parseCronFile(fullPath);
    if (job) {
      if (job.logPath && fs.existsSync(job.logPath)) {
        try {
          const stat = fs.statSync(job.logPath);
          job.lastRun = stat.mtime.toISOString();
        } catch (e) {
          job.lastRun = null;
        }
      } else {
        job.lastRun = null;
      }
      job.status = 'active';
      jobs.push(job);
    }
  }

  return jobs;
}

async function getCronJobRuns(jobId, lines = 10) {
  const jobs = await listCronJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job || !job.logPath) {
    return [];
  }
  if (!fs.existsSync(job.logPath)) {
    return [];
  }
  const content = fs.readFileSync(job.logPath, 'utf8');
  const allLines = content.split('\n').filter(l => l.trim() !== '');
  const recentLines = allLines.slice(-lines);
  return recentLines.map(line => ({ line }));
}

async function runCronJob(jobId) {
  const jobs = await listCronJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) {
    throw new Error(`Cron job not found: ${jobId}`);
  }
  const child = spawn('bash', ['-c', job.command], {
    cwd: WORKSPACE,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`[Cron] Started manual execution of ${jobId} (PID ${child.pid})`);
}

function registerCronRoutes(router) {
  // GET /api/cron/jobs
  router.add('GET', '/api/cron/jobs', async (req, res, ctx) => {
    try {
      const jobs = await listCronJobs();
      ctx.sendJSON(res, 200, { jobs });
    } catch (err) {
      console.error('[Cron] Failed to list jobs:', err);
      ctx.sendJSON(res, 500, { error: 'Failed to list cron jobs' });
    }
    return true;
  });

  // GET /api/cron/jobs/:id/runs
  router.add('GET', '/api/cron/jobs/:id/runs', async (req, res, ctx, params) => {
    try {
      const runs = await getCronJobRuns(params.id, 10);
      ctx.sendJSON(res, 200, { runs });
    } catch (err) {
      console.error(`[Cron] Failed to get runs for ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to get job runs' });
    }
    return true;
  });

  // POST /api/cron/jobs/:id/run
  router.add('POST', '/api/cron/jobs/:id/run', async (req, res, ctx, params) => {
    try {
      await runCronJob(params.id);
      ctx.sendJSON(res, 202, { success: true, message: 'Job started' });
    } catch (err) {
      console.error(`[Cron] Failed to run job ${params.id}:`, err);
      ctx.sendJSON(res, 500, { error: 'Failed to start job' });
    }
    return true;
  });
}

module.exports = { registerCronRoutes };
