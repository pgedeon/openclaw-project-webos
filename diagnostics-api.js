/**
 * Diagnostics API — System Operations Center
 *
 * Monitors cron jobs, skills, and scripts for failures, provides
 * log inspection, and orchestrates repair actions.
 *
 * Integrated into task-server.js as a route handler module.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || '~/.openclaw/workspace';
const CRONTAB_DIR = path.join(WORKSPACE, 'crontab');
const LOGS_DIR = path.join(WORKSPACE, 'logs');
const STATE_FILE = '/tmp/openclaw-heartbeat-cron-guard-state.json';

const FAILURE_KEYWORDS = [
  'traceback', 'fatal', 'exception', 'command timed out',
  'status: failed', 'status=failed'
];
// Single-word "error" only matched as \berror\b in classifyFailure, not here.
const SUCCESS_KEYWORDS = [
  'all checks passed', 'completed successfully',
  'status: success', 'status=success', 'published:', 'validation passed'
];

// ─── Helpers ──────────────────────────────────────────────────────

function loadGuardState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) { /* ignore */ }
  return {};
}

function saveGuardState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2, sort_keys ? undefined : undefined));
  } catch (_) { /* ignore */ }
}

function sendJSON(res, status, data) {
  const json = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCronFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const comments = [];
    const cronLines = [];
    let cronLine = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#')) comments.push(trimmed.slice(1).trim());
        continue;
      }
      cronLine = trimmed;
      cronLines.push({ lineNum: lines.indexOf(line) + 1, line: trimmed });
      break;
    }

    if (!cronLine) return null;

    const cronMatch = cronLine.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!cronMatch) return null;

    const [, minute, hour, dom, month, dow, command] = cronMatch;
    const schedule = [minute, hour, dom, month, dow].join(' ');

    let logPath = null;
    const redirMatch = command.match(/(?:>>|>)\s*(\S+)/);
    if (redirMatch) {
      logPath = redirMatch[1];
      if (!path.isAbsolute(logPath)) logPath = path.join(WORKSPACE, logPath);
    }

    const id = path.basename(filePath, '.cron');
    const description = comments.length > 0 ? comments.join(' ') : id;

    return { id, name: description, schedule, command, description, logPath, filePath, cronLines };
  } catch (err) {
    console.error(`[Diagnostics] Error parsing ${filePath}:`, err.message);
    return null;
  }
}

function inferIntervalSeconds(schedule) {
  const [minute, hour] = schedule.split(' ');
  if (hour === '*' && minute.startsWith('*/')) {
    const val = parseInt(minute.slice(2));
    if (!isNaN(val)) return val * 60;
  }
  if (hour === '*' && minute === '*') return 60;
  if (hour.match(/^\d+$/) && minute.match(/^\d+$/)) return 24 * 3600;
  return null;
}

function readLogTail(logPath, maxLines = 200) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    return content.split('\n').filter(l => l.trim());
  } catch (_) { return []; }
}

function classifyFailure(logTail, recentLines = 10) {
  // Only classify from the most recent lines to avoid old failures
  const lines = logTail.split('\n').filter(l => l.trim());
  const recent = lines.slice(-recentLines).join('\n');
  const lower = recent.toLowerCase();
  if (!lower.trim()) return null;

  const hasKeywordFailure = FAILURE_KEYWORDS.some(k => lower.includes(k));
  // Check for standalone "error" but exclude benign patterns
  const hasError = /\berror[^s_a-z]/.test(lower) && !lower.includes('error rate') && !lower.includes('error-rate');
  const hasFailure = hasKeywordFailure || hasError;
  const hasSuccess = SUCCESS_KEYWORDS.some(k => lower.includes(k));

  // Success overrides failure
  if (hasSuccess && !lower.includes('0 error')) return null;
  if (hasSuccess && lower.includes('0 error')) return null;

  if (lower.includes('permission denied') || lower.includes('eperm') || lower.includes('eacces'))
    return 'permission';
  if (lower.includes('enoent') || lower.includes('no such file') || lower.includes('not found'))
    return 'missing_file';
  if (lower.includes('etimedout') || lower.includes('econnrefused') || lower.includes('econnreset'))
    return 'network';
  if (lower.includes('status: failed') || lower.includes('status=failed'))
    return 'pipeline_failed';
  if (lower.includes('traceback') || lower.includes('exception'))
    return 'crash';
  if (hasFailure)
    return 'generic_failure';
  return null;
}

function isLogFresh(logPath, schedule) {
  if (!logPath || !fs.existsSync(logPath)) return false;
  try {
    const mtime = fs.statSync(logPath).mtime;
    const ageMs = Date.now() - mtime.getTime();
    const interval = inferIntervalSeconds(schedule) || 3600;
    return ageMs < interval * 3;
  } catch (_) { return false; }
}

function extractCycles(lines, maxCycles = 10) {
  if (lines.length === 0) return [];

  const cycles = [];
  let currentCycle = { lines: [], startIdx: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect cycle boundaries
    const isCycleStart = /^\[?\d{4}-\d{2}-\d{2}[T ]/.test(line) &&
      (line.includes('Cycle Start') || line.includes('=== ') || line.includes('--- Run'));

    if (isCycleStart && currentCycle.lines.length > 0) {
      cycles.push(currentCycle);
      currentCycle = { lines: [], startIdx: i };
    }

    currentCycle.lines.push({ text: line, idx: i });
  }

  if (currentCycle.lines.length > 0) cycles.push(currentCycle);

  // Return last N cycles
  return cycles.slice(-maxCycles);
}

function highlightFailures(line) {
  const lower = line.toLowerCase();
  const hasKeywordFailure = FAILURE_KEYWORDS.some(k => lower.includes(k));
  const hasError = /\berror[^s_a-z]/.test(lower) && !lower.includes('error rate') && !lower.includes('error-rate');
  const hasFailure = hasKeywordFailure || hasError;
  const hasSuccess = SUCCESS_KEYWORDS.some(k => lower.includes(k));

  if (hasSuccess) return { type: 'success' };
  if (hasFailure) return { type: 'failure' };
  if (lower.includes('warning') || lower.includes('warn')) return { type: 'warning' };
  return { type: 'info' };
}

// ─── Core Functions ──────────────────────────────────────────────

function getAllJobs() {
  const guardState = loadGuardState();
  const jobs = [];

  if (!fs.existsSync(CRONTAB_DIR)) return jobs;

  const files = fs.readdirSync(CRONTAB_DIR).filter(f => f.endsWith('.cron'));

  for (const file of files) {
    const filePath = path.join(CRONTAB_DIR, file);
    const job = parseCronFile(filePath);
    if (!job) continue;

    // Log freshness
    let lastRun = null;
    let lastRunAge = null;
    if (job.logPath && fs.existsSync(job.logPath)) {
      try {
        const stat = fs.statSync(job.logPath);
        lastRun = stat.mtime.toISOString();
        lastRunAge = Date.now() - stat.mtime.getTime();
      } catch (_) { /* ignore */ }
    }

    // Guard state
    const gs = guardState[job.id] || {};
    const tracker = gs.failure_tracker || {};
    const failureCount = tracker.consecutive || 0;
    const firstSeen = tracker.first_seen || null;
    const escalated = tracker.escalated_at || null;
    const isPersistent = (tracker.consecutive || 0) >= 5;

    // Failure analysis from log tail
    const logTail = readLogTail(job.logPath, 40).join('\n');
    const failureType = classifyFailure(logTail);

    // Determine status
    let status = 'healthy';
    if (isPersistent) status = 'persistent';
    else if (failureType) status = 'failing';
    else if (!isLogFresh(job.logPath, job.schedule)) status = 'stale';

    // Extract last error line
    const tailLines = logTail.split('\n').filter(l => l.trim());
    let lastError = null;
    for (let i = tailLines.length - 1; i >= 0; i--) {
      const hl = highlightFailures(tailLines[i]);
      if (hl.type === 'failure') {
        lastError = tailLines[i].substring(0, 200);
        break;
      }
    }

    // Silenced?
    const silencedUntil = gs.silenced_until || null;
    const isSilenced = silencedUntil && new Date(silencedUntil) > new Date();

    jobs.push({
      id: job.id,
      name: job.name || job.id,
      type: 'cron',
      schedule: job.schedule,
      command: job.command,
      logPath: job.logPath,
      lastRun,
      lastRunAge,
      status,
      failureType,
      failureCount,
      firstSeen,
      escalated,
      isPersistent,
      lastError,
      isSilenced,
      silencedUntil,
    });
  }

  return jobs;
}

function getJobDetail(jobId) {
  const jobs = getAllJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) return null;

  // Get log cycles
  const logLines = readLogTail(job.logPath, 500);
  const cycles = extractCycles(logLines, 15);

  // Enrich cycles with analysis
  const enrichedCycles = cycles.map(cycle => {
    const cycleText = cycle.lines.map(l => l.text).join('\n');
    const failure = classifyFailure(cycleText);
    const hasFailure = cycle.lines.some(l => highlightFailures(l.text).type === 'failure');
    const hasSuccess = cycle.lines.some(l => highlightFailures(l.text).type === 'success');

    return {
      lines: cycle.lines.map(l => ({
        text: l.text,
        highlight: highlightFailures(l.text).type
      })),
      failure,
      hasFailure,
      hasSuccess,
      lineCount: cycle.lines.length,
      startLine: cycle.startIdx,
    };
  });

  return {
    ...job,
    cycles: enrichedCycles,
    totalLogLines: logLines.length,
  };
}

function runRepair(jobId, action) {
  const filePath = path.join(CRONTAB_DIR, `${jobId}.cron`);

  switch (action) {
    case 'run': {
      const job = parseCronFile(filePath);
      if (!job) return { success: false, error: 'Job not found' };

      const child = spawn('bash', ['-c', job.command], {
        cwd: WORKSPACE,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      return { success: true, message: `Started (PID ${child.pid})`, pid: child.pid };
    }

    case 'reset_failure': {
      const guardState = loadGuardState();
      if (guardState[jobId]) {
        delete guardState[jobId].failure_tracker;
        saveGuardState(guardState);
      }
      return { success: true, message: 'Failure counter reset' };
    }

    case 'disable': {
      if (!fs.existsSync(filePath)) return { success: false, error: 'Cron file not found' };
      let content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const newLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        // Check if it looks like a cron line (5 fields + command)
        const match = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
        if (match) return `# [DISABLED] ${line}`;
        return line;
      });
      fs.writeFileSync(filePath, newLines.join('\n'));
      return { success: true, message: 'Cron job disabled' };
    }

    case 'enable': {
      if (!fs.existsSync(filePath)) return { success: false, error: 'Cron file not found' };
      let content = fs.readFileSync(filePath, 'utf8');
      content = content.replace(/^# \[DISABLED\] /gm, '');
      fs.writeFileSync(filePath, content);
      return { success: true, message: 'Cron job enabled' };
    }

    default:
      return { success: false, error: `Unknown repair action: ${action}` };
  }
}

function silenceJob(jobId, hours) {
  const guardState = loadGuardState();
  const until = new Date(Date.now() + hours * 3600000).toISOString();
  if (!guardState[jobId]) guardState[jobId] = {};
  guardState[jobId].silenced_until = until;
  saveGuardState(guardState);
  return { success: true, silenced_until: until };
}

function getSummary() {
  const jobs = getAllJobs();
  const healthy = jobs.filter(j => j.status === 'healthy').length;
  const failing = jobs.filter(j => j.status === 'failing').length;
  const stale = jobs.filter(j => j.status === 'stale').length;
  const persistent = jobs.filter(j => j.status === 'persistent').length;
  const silenced = jobs.filter(j => j.isSilenced).length;

  return {
    total: jobs.length,
    healthy,
    failing,
    stale,
    persistent,
    silenced,
    issues: failing + stale + persistent - silenced,
    timestamp: new Date().toISOString()
  };
}

// ─── Route Handler ──────────────────────────────────────────────

function createDiagnosticsHandler() {

  return async function handleDiagnosticsRoute(url, method, req, res) {
    const ts = new Date().toISOString();

    // GET /api/diagnostics/summary
    if (url === '/api/diagnostics/summary' && method === 'GET') {
      try {
        sendJSON(res, 200, getSummary());
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] summary error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /api/diagnostics/jobs
    if (url === '/api/diagnostics/jobs' && method === 'GET') {
      try {
        sendJSON(res, 200, { jobs: getAllJobs() });
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] jobs error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /api/diagnostics/failures
    if (url === '/api/diagnostics/failures' && method === 'GET') {
      try {
        const jobs = getAllJobs().filter(j => j.status !== 'healthy');
        sendJSON(res, 200, { failures: jobs, count: jobs.length });
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] failures error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /api/diagnostics/jobs/:id
    const detailMatch = url.match(/^\/api\/diagnostics\/jobs\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      try {
        const jobId = decodeURIComponent(detailMatch[1]);
        const detail = getJobDetail(jobId);
        if (!detail) {
          sendJSON(res, 404, { error: 'Job not found' });
        } else {
          sendJSON(res, 200, detail);
        }
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] detail error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /api/diagnostics/jobs/:id/logs
    const logsMatch = url.match(/^\/api\/diagnostics\/jobs\/([^/]+)\/logs$/);
    if (logsMatch && method === 'GET') {
      try {
        const jobId = decodeURIComponent(logsMatch[1]);
        const detail = getJobDetail(jobId);
        if (!detail) {
          sendJSON(res, 404, { error: 'Job not found' });
        } else {
          // Return raw log with cycle grouping
          const urlObj = new URL(req.url, 'http://localhost');
          const lines = parseInt(urlObj.searchParams.get('lines')) || 200;
          const logLines = readLogTail(detail.logPath, lines);
          const cycles = extractCycles(logLines);

          sendJSON(res, 200, {
            jobId,
            logPath: detail.logPath,
            totalLines: logLines.length,
            cycles: cycles.map(c => ({
              lines: c.lines.map(l => ({
                text: l.text,
                highlight: highlightFailures(l.text).type
              })),
              lineCount: c.lines.length
            }))
          });
        }
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] logs error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/diagnostics/jobs/:id/repair
    const repairMatch = url.match(/^\/api\/diagnostics\/jobs\/([^/]+)\/repair$/);
    if (repairMatch && method === 'POST') {
      try {
        const jobId = decodeURIComponent(repairMatch[1]);
        const body = await parseBody(req);
        const action = body.action || 'run';
        const result = runRepair(jobId, action);
        sendJSON(res, result.success ? 200 : 400, result);
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] repair error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /api/diagnostics/jobs/:id/silence
    const silenceMatch = url.match(/^\/api\/diagnostics\/jobs\/([^/]+)\/silence$/);
    if (silenceMatch && method === 'POST') {
      try {
        const jobId = decodeURIComponent(silenceMatch[1]);
        const body = await parseBody(req);
        const hours = body.hours || 24;
        const result = silenceJob(jobId, hours);
        sendJSON(res, 200, result);
      } catch (err) {
        console.error(`[${ts}] [Diagnostics] silence error:`, err);
        sendJSON(res, 500, { error: err.message });
      }
      return true;
    }

    // Not a diagnostics route
    return false;
  };
}

module.exports = { createDiagnosticsHandler, getAllJobs, getSummary };
