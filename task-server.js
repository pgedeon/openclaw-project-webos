#!/usr/bin/env node
/**
 * Task Server - Enhanced with Asana-style Storage Support
 *
 * Runs in parallel with existing dashboard functionality.
 *
 * Legacy Endpoints (still active):
 *   GET  /api/tasks         - Read tasks.md (legacy format)
 *   POST /api/tasks         - Write tasks.md
 *
 * New Asana-Style Endpoints:
 *   GET    /api/projects            - List projects
 *   GET    /api/projects/:id        - Get project
 *   POST   /api/projects            - Create project
 *   PATCH  /api/projects/:id        - Update project
 *   DELETE /api/projects/:id        - Delete/archive project
 *
 *   GET    /api/tasks/all           - List tasks (from Asana DB)
 *   GET    /api/tasks/:id           - Get task with optional subtasks/deps
 *   POST   /api/tasks               - Create task
 *   PATCH  /api/tasks/:id           - Update task
 *   DELETE /api/tasks/:id           - Delete task
 *   POST   /api/tasks/:id/move      - Change task status
 *   POST   /api/tasks/:id/dependencies - Add/remove dependencies
 *   POST   /api/tasks/:id/subtasks  - Link subtask
 *
 *   GET    /api/views/board?project_id=X  - Kanban board view
 *   GET    /api/views/timeline?project_id=X - Timeline view
 *   GET    /api/views/agent?agent_name=X   - Agent's task queue
 *
 *   POST   /api/agent/claim         - Claim task for execution
 *   POST   /api/agent/release       - Release claimed task
 *
 *   GET    /api/stats               - Storage statistics
 *   GET    /api/health              - Health check
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const { createWorkflowRunsHandler } = require('./workflow-runs-api.js');
const { WorkflowRunMonitor } = require('./workflow-run-monitor.js');
const { catalogAPI } = require('./catalog-api.js');
const { metricsAPI } = require('./metrics-api.js');
const { serviceRequestsAPI } = require('./service-requests-api.js');
const { orgAPI } = require('./org-api.js');
const { createDiagnosticsHandler } = require('./diagnostics-api.js');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`❌ Uncaught Exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ Unhandled Rejection: ${reason}`);
});

const PORT = process.env.PORT || 3876;
const WORKSPACE = '~/.openclaw/workspace';
const TASKS_FILE = path.join(WORKSPACE, 'tasks.md');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Determine storage type from environment
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'postgres'; // 'postgres' or 'json'

let asanaStorage = null;
let workflowRunsHandler = null;
const requestBodyCache = new Map();

async function initAsanaStorage() {
  try {
    if (STORAGE_TYPE === 'postgres') {
      const AsanaStorage = require('./storage/asana');
      asanaStorage = new AsanaStorage({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'openclaw_dashboard',
        user: process.env.POSTGRES_USER || 'openclaw',
        password: process.env.POSTGRES_PASSWORD || 'openclaw_password',
      });
      await asanaStorage.init();
      console.log('✅ Asana PostgreSQL storage initialized');
      // Initialize workflow runs handler
      if (asanaStorage.pool) {
        try {
          workflowRunsHandler = createWorkflowRunsHandler(asanaStorage.pool);
          console.log('✅ Workflow runs API handler initialized');
          
          // Start workflow run monitor (spawns agents for pending runs)
          const workflowMonitor = new WorkflowRunMonitor(asanaStorage.pool, console);
          workflowMonitor.start();
          console.log('✅ Workflow run monitor started (30s poll interval)');
        } catch (err) {
          console.error('⚠️  Failed to initialize workflow runs handler:', err.message);
        }
      }
    } else {
      // Fallback to JSON storage (legacy)
      const ASANA_DB_PATH = path.join(WORKSPACE, 'data/asana-db.json');
      const AsanaStorage = require('./storage/asana');
      asanaStorage = new AsanaStorage(ASANA_DB_PATH);
      await asanaStorage.init();
      console.log('✅ Asana JSON storage initialized');
    }
  } catch (err) {
    console.error('❌ Failed to initialize Asana storage:', err.message);
    asanaStorage = null;
  }
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
  const fullPath = path.join(WORKSPACE, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(WORKSPACE)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*'
    };
    
    // Force clear service worker cache for HTML/JS to prevent stale SW issues
    if (ext === '.html' || ext === '.js' || ext === '.mjs') {
      headers['Clear-Site-Data'] = '"cache"';
      headers['Cache-Control'] = 'no-store, max-age=0';
    }
    
    res.writeHead(200, headers);
    res.end(data);
  });
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================
// CRON JOBS API HELPERS
// ============================================

/**
 * Parse a cron job definition file.
 * @param {string} filePath - Full path to .cron file.
 * @returns {Object|null} Job object or null if invalid.
 */
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
      // First non-comment non-empty line is the cron command
      cronLine = trimmed;
      break;
    }

    if (!cronLine) return null;

    // Cron format: min hour dom month dow command
    const cronMatch = cronLine.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!cronMatch) {
      console.warn(`[Cron] Invalid cron line in ${filePath}: ${cronLine}`);
      return null;
    }

    const [, minute, hour, dom, month, dow, command] = cronMatch;
    const schedule = [minute, hour, dom, month, dow].join(' ');

    // Extract log path from redirection (>> or >)
    let logPath = null;
    const redirMatch = command.match(/(?:>>|>)\s*(\S+)/);
    if (redirMatch) {
      logPath = redirMatch[1];
      // If relative, assume under WORKSPACE
      if (!path.isAbsolute(logPath)) {
        logPath = path.join(WORKSPACE, logPath);
      }
    }

    // Extract description from comments
    let description = comments.join(' ');
    if (!description) {
      // Use filename as name fallback
      description = path.basename(filePath, '.cron');
    }

    const id = path.basename(filePath, '.cron');

    return { id, name: description, schedule, command, description, logPath };
  } catch (err) {
    console.error(`[Cron] Error parsing ${filePath}:`, err.message);
    return null;
  }
}

/**
 * List all cron jobs from crontab directory.
 * @returns {Promise<Array>} Array of job objects.
 */
async function listCronJobs() {
  const crontabDir = path.join(WORKSPACE, 'crontab');
  const files = fs.readdirSync(crontabDir).filter(f => f.endsWith('.cron'));
  const jobs = [];

  for (const file of files) {
    const fullPath = path.join(crontabDir, file);
    const job = parseCronFile(fullPath);
    if (job) {
      // Determine last run from log file mtime if available
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

/**
 * Get recent runs (log lines) for a specific cron job.
 * @param {string} jobId - Job ID (cron file name without extension)
 * @param {number} [lines=10] - Number of recent lines to return
 * @returns {Promise<Array>} Array of { line, timestamp? }
 */
async function getCronJobRuns(jobId, lines = 10) {
  // Find the job to get logPath
  const jobs = await listCronJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job || !job.logPath) {
    return [];
  }

  if (!fs.existsSync(job.logPath)) {
    return [];
  }

  // Read entire file and take last N lines (simple approach)
  const content = fs.readFileSync(job.logPath, 'utf8');
  const allLines = content.split('\n').filter(l => l.trim() !== '');
  const recentLines = allLines.slice(-lines);
  // Return with index; timestamp not available from line itself
  return recentLines.map(line => ({ line }));
}

/**
 * Execute a cron job manually (run now).
 * @param {string} jobId - Job ID
 * @returns {Promise<void>}
 */
async function runCronJob(jobId) {
  const jobs = await listCronJobs();
  const job = jobs.find(j => j.id === jobId);
  if (!job) {
    throw new Error(`Cron job not found: ${jobId}`);
  }

  // Spawn a detached shell to run the command
  const child = spawn('bash', ['-c', job.command], {
    cwd: WORKSPACE,
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
  console.log(`[Cron] Started manual execution of ${jobId} (PID ${child.pid})`);
}

const diagnosticsHandler = createDiagnosticsHandler();
const server = http.createServer(async (req, res) => {
  const timestamp = new Date().toISOString();
  const url = req.url.split('?')[0];
  const method = req.method;

  // Log request
  console.log(`[${timestamp}] ${method} ${url}`);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    // ============================================
    // DIAGNOSTICS API
    // ============================================
    // Route to diagnostics API (returns true if handled)
    if (await diagnosticsHandler(url, method, req, res)) return;

    // ============================================
    // LEGACY ENDPOINTS (always available for human UI)
    // ============================================

    // GET /api/tasks - read tasks.md
    if (url === '/api/tasks' && method === 'GET') {
      fs.readFile(TASKS_FILE, 'utf8', (err, data) => {
        if (err) {
          sendJSON(res, 500, { error: 'Failed to read tasks.md' });
          return;
        }
        sendJSON(res, 200, { content: data, path: TASKS_FILE, format: 'markdown' });
      });
      return;
    }

    // POST /api/tasks - write tasks.md (legacy) or delegate to Asana if enabled
    if (url === '/api/tasks' && method === 'POST') {
      // If Asana storage is enabled, skip to allow Asana handler to process
      if (asanaStorage) {
        // Do nothing, let Asana handler (which appears later) take over
      } else {
        try {
          const body = await parseJSONBody(req);
          if (!body.content) {
            sendJSON(res, 400, { error: 'Missing content field' });
            return;
          }
          fs.writeFile(TASKS_FILE, body.content, 'utf8', (err) => {
            if (err) {
              sendJSON(res, 500, { error: 'Failed to write tasks.md' });
              return;
            }
            sendJSON(res, 200, { success: true, path: TASKS_FILE });
          });
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
        return;
      }
    }

    // ============================================
    // HEALTH & STATS
    // ============================================

    // GET /api/health
    if (url === '/api/health' && method === 'GET') {
      sendJSON(res, 200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        asana_storage: asanaStorage ? 'initialized' : 'disabled',
        storage_type: STORAGE_TYPE,
        port: PORT
      });
      return;
    }

    // GET /api/stats
    if (url === '/api/stats' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const stats = await asanaStorage.stats();
      sendJSON(res, 200, stats);
      return;
    }


    // ============================================
    // CITATION QUEUE API
    // ============================================

    // GET /api/citation-queue/status
    if (url === '/api/citation-queue/status' && method === 'GET') {
      try {
        const { execSync } = require('child_process');
        const result = execSync(
          'python3 ~/.openclaw/workspace/affiliate-editorial/scripts/citation_queue.py --action status 2>/dev/null',
          { encoding: 'utf-8', timeout: 5000 }
        );
        const data = JSON.parse(result);
        sendJSON(res, 200, {
          success: true,
          ...data,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('[CitationQueue] Failed to get status:', err.message);
        sendJSON(res, 500, { error: 'Failed to get citation queue status', details: err.message });
      }
      return;
    }

    // ============================================
    // CRON API
    // ============================================

    // GET /api/cron/jobs
    if (url === '/api/cron/jobs' && method === 'GET') {
      try {
        const jobs = await listCronJobs();
        sendJSON(res, 200, { jobs });
      } catch (err) {
        console.error('[Cron] Failed to list jobs:', err);
        sendJSON(res, 500, { error: 'Failed to list cron jobs' });
      }
      return;
    }

    // GET /api/cron/jobs/:id/runs
    if (url.match(/^\/api\/cron\/jobs\/([^/]+)\/runs$/) && method === 'GET') {
      const id = url.split('/')[4];
      try {
        const runs = await getCronJobRuns(id, 10);
        sendJSON(res, 200, { runs });
      } catch (err) {
        console.error(`[Cron] Failed to get runs for ${id}:`, err);
        sendJSON(res, 500, { error: 'Failed to get job runs' });
      }
      return;
    }

    // POST /api/cron/jobs/:id/run
    if (url.match(/^\/api\/cron\/jobs\/([^/]+)\/run$/) && method === 'POST') {
      const id = url.split('/')[4];
      try {
        await runCronJob(id);
        sendJSON(res, 202, { success: true, message: 'Job started' });
      } catch (err) {
        console.error(`[Cron] Failed to run job ${id}:`, err);
        sendJSON(res, 500, { error: 'Failed to start job' });
      }
      return;
    }

    // ============================================
    // AGENTS API
    // ============================================

    // GET /api/agents - list available agents
    if (url === '/api/agents' && method === 'GET') {
      // Return agents from metrics API which has the right format
      // The Operations page expects { agents: [...] } with heartbeat data
      if (asanaStorage && asanaStorage.pool) {
        try {
          const { buildMetricsPayloads } = require('./metrics-api.js');
          const payloads = await buildMetricsPayloads({
            sendJSON,
            asanaStorage,
            pool: asanaStorage.pool
          }, { days: 1 });
          const agents = (payloads.agentsPayload || []).map(a => ({
            id: a.agentId,
            name: a.displayName,
            status: a.status || 'idle',
            lastHeartbeat: a.lastHeartbeat,
            department: a.department?.name
          }));
          sendJSON(res, 200, { agents });
          return;
        } catch (err) {
          console.error('/api/agents error:', err.message);
        }
      }
      sendJSON(res, 200, { agents: [] });
      return;
    }

    // ============================================
    // PROJECTS API
    // ============================================

    // GET /api/projects
    if (url === '/api/projects' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const projects = await asanaStorage.listProjects(query);
      sendJSON(res, 200, projects);
      return;
    }
    // GET /api/projects/default
    if (url === '/api/projects/default' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const filters = {};
      if (query.has('status')) filters.status = query.get('status');
      try {
        const project = await asanaStorage.getDefaultProject(filters);
        if (!project) {
          sendJSON(res, 404, { error: 'No default project found' });
          return;
        }
        sendJSON(res, 200, project);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }


    // GET /api/projects/:id
    if (url.match(/^\/api\/projects\/[^/]+$/) && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const project = await asanaStorage.getProject(id);
        sendJSON(res, 200, project);
      } catch (err) {
        sendJSON(res, 404, { error: err.message });
      }
      return;
    }

    // POST /api/projects
    if (url === '/api/projects' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const data = await parseJSONBody(req);
        const required = ['name'];
        for (const field of required) {
          if (!data[field]) {
            sendJSON(res, 400, { error: `Missing required field: ${field}` });
            return;
          }
        }
        const project = await asanaStorage.createProject(data);
        sendJSON(res, 201, project);
      } catch (e) {
        sendJSON(res, 400, { error: e.message });
      }
      return;
    }

    // PATCH /api/projects/:id
    if (url.match(/^\/api\/projects\/[^/]+$/) && method === 'PATCH') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const data = await parseJSONBody(req);
        const project = await asanaStorage.updateProject(id, data);
        sendJSON(res, 200, project);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // DELETE /api/projects/:id
    if (url.match(/^\/api\/projects\/[^/]+$/) && method === 'DELETE') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        await asanaStorage.archiveProject(id);
        sendJSON(res, 200, { deleted: true, id });
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // ============================================
    // TASKS API
    // ============================================

    // GET /api/tasks/all (new endpoint to avoid conflict with legacy /api/tasks)
    if (url === '/api/tasks/all' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const projectId = query.get('project_id');
      const includeGraph = query.get('includeGraph') === 'true';
      const includeArchived = query.get('include_archived') === 'true';
      const includeDeleted = query.get('include_deleted') === 'true';
      const includeChildProjects = query.get('include_child_projects') === 'true';
      const depth = parseInt(query.get('depth')) || undefined;
      const updatedSince = query.get('updated_since') || undefined;

      let tasks;
      if (projectId) {
        tasks = await asanaStorage.listTasks(projectId, {
          depth,
          include_archived: includeArchived,
          include_deleted: includeDeleted,
          include_child_projects: includeChildProjects,
          updated_since: updatedSince
        });
      } else {
        tasks = await asanaStorage.listAllTasks({
          include_archived: includeArchived,
          include_deleted: includeDeleted,
          updated_since: updatedSince
        });
      }
      sendJSON(res, 200, tasks);
      return;
    }

    // GET /api/tasks/:id
    if (url.match(/^\/api\/tasks\/[^/]+$/) && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const includeGraph = query.get('includeGraph') === 'true';
      const includeArchived = query.get('include_archived') === 'true';
      const includeDeleted = query.get('include_deleted') === 'true';
      try {
        const task = await asanaStorage.getTask(id, {
          includeGraph,
          include_archived: includeArchived,
          include_deleted: includeDeleted
        });
        sendJSON(res, 200, task);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // POST /api/tasks
    if (url === '/api/tasks' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const data = await parseJSONBody(req);
        const required = ['project_id', 'title'];
        for (const field of required) {
          if (!data[field]) {
            const errMsg = `Missing required field: ${field}`;
            console.log('[task-server]', errMsg);
            sendJSON(res, 400, { error: errMsg });
            return;
          }
        }
        const task = await asanaStorage.createTask(data);
        console.log('[task-server] Task created:', task.id);
        sendJSON(res, 201, task);
      } catch (e) {
        console.error('[task-server] Error creating task:', e);
        sendJSON(res, 400, { error: e.message });
      }
      return;
    }

    // PATCH /api/tasks/:id
    if (url.match(/^\/api\/tasks\/[^/]+$/) && method === 'PATCH') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const data = await parseJSONBody(req);
        // Detailed debug logging
        console.log(`[TaskServer] PATCH /api/tasks/${id} received data:`, JSON.stringify(data, null, 2));
        const task = await asanaStorage.updateTask(id, data);
        console.log(`[TaskServer] PATCH /api/tasks/${id} succeeded, updated fields:`, Object.keys(data).join(', '));
        sendJSON(res, 200, task);
      } catch (err) {
        // Capture full error details including stack for debugging
        console.error(`[TaskServer] PATCH /api/tasks/${id} failed`);
        console.error(`[TaskServer] Error message: ${err.message}`);
        console.error(`[TaskServer] Error stack:`, err.stack);
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // DELETE /api/tasks/:id
    if (url.match(/^\/api\/tasks\/[^/]+$/) && method === 'DELETE') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const result = await asanaStorage.deleteTask(id);
        sendJSON(res, 200, result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/archive
    if (url.match(/^\/api\/tasks\/[^/]+\/archive$/) && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const result = await asanaStorage.archiveTask(id);
        sendJSON(res, 200, result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/restore
    if (url.match(/^\/api\/tasks\/[^/]+\/restore$/) && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const result = await asanaStorage.restoreTask(id);
        sendJSON(res, 200, result);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/move
    if (url.match(/^\/api\/tasks\/[^/]+\/move$/) && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const { status } = await parseJSONBody(req);
        if (!status) {
          sendJSON(res, 400, { error: 'Missing status field' });
          return;
        }
        const task = await asanaStorage.moveTask(id, status);
        sendJSON(res, 200, task);
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/dependencies
    if (url.match(/^\/api\/tasks\/[^/]+\/dependencies$/) && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const { add = [], remove = [] } = await parseJSONBody(req);
        let deps = await asanaStorage.getDependencies(id);

        for (const depId of add) {
          if (!deps.includes(depId)) {
            await asanaStorage.addDependency(id, depId);
          }
        }

        for (const depId of remove) {
          await asanaStorage.removeDependency(id, depId);
        }

        const updatedDeps = await asanaStorage.getDependencies(id);
        sendJSON(res, 200, { dependencies: updatedDeps });
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/subtasks
    if (url.match(/^\/api\/tasks\/[^/]+\/subtasks$/) && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const parentId = url.split('/')[3];
      try {
        const { task_id } = await parseJSONBody(req);
        if (!task_id) {
          sendJSON(res, 400, { error: 'Missing task_id field' });
          return;
        }
        const result = await asanaStorage.addSubtask(parentId, task_id);
        sendJSON(res, 200, result);
      } catch (err) {
        const statusCode = err.message.includes('not found') || err.message.includes('Circular') ? 400 : 404;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // GET /api/tasks/:id/history
    if (url.match(/^\/api\/tasks\/[^/]+\/history$/) && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const taskId = url.split('/')[3];
      try {
        const history = await asanaStorage.getAuditLog(taskId, 100);
        sendJSON(res, 200, { task_id: taskId, history });
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // ============================================
    // VIEWS API
    // ============================================

    // SAVED VIEWS CRUD

    // GET /api/views?project_id=X
    if (url === '/api/views' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const projectId = query.get('project_id');
      if (!projectId) {
        sendJSON(res, 400, { error: 'project_id query parameter required' });
        return;
      }
      try {
        const views = await asanaStorage.listSavedViews(projectId);
        sendJSON(res, 200, views);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // POST /api/views
    if (url === '/api/views' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const data = await parseJSONBody(req);
        const required = ['project_id', 'name', 'filters', 'created_by'];
        for (const field of required) {
          if (data[field] === undefined) {
            sendJSON(res, 400, { error: `Missing required field: ${field}` });
            return;
          }
        }
        const view = await asanaStorage.createSavedView(
          data.project_id,
          data.name,
          data.filters,
          data.sort || null,
          data.created_by
        );
        sendJSON(res, 201, view);
      } catch (e) {
        sendJSON(res, 400, { error: e.message });
      }
      return;
    }

    // GET /api/views/:id (exclude built-in views: board, timeline, agent)
    if (url.match(/^\/api\/views\/(?!board$|timeline$|agent$)[^/]+$/) && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const view = await asanaStorage.getSavedView(id);
        if (!view) {
          sendJSON(res, 404, { error: 'Saved view not found' });
          return;
        }
        sendJSON(res, 200, view);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // PATCH /api/views/:id (exclude built-in views: board, timeline, agent)
    if (url.match(/^\/api\/views\/(?!board$|timeline$|agent$)[^/]+$/) && method === 'PATCH') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const data = await parseJSONBody(req);
        // Only allow updating name, filters, sort
        const updates = {};
        if (data.name !== undefined) updates.name = data.name;
        if (data.filters !== undefined) updates.filters = data.filters;
        if (data.sort !== undefined) updates.sort = data.sort;
        const view = await asanaStorage.updateSavedView(id, updates);
        sendJSON(res, 200, view);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return;
    }

    // DELETE /api/views/:id (exclude built-in views: board, timeline, agent)
    if (url.match(/^\/api\/views\/(?!board$|timeline$|agent$)[^/]+$/) && method === 'DELETE') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const id = url.split('/')[3];
      try {
        const deleted = await asanaStorage.deleteSavedView(id);
        if (!deleted) {
          sendJSON(res, 404, { error: 'Saved view not found' });
          return;
        }
        sendJSON(res, 200, { deleted: true, id });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // ============================================
    // BUILT-IN VIEWS (board, timeline, agent)
    // ============================================

    // GET /api/views/board
    if (url === '/api/views/board' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const projectId = query.get('project_id');
      if (!projectId) {
        sendJSON(res, 400, { error: 'project_id query parameter required' });
        return;
      }
      try {
        const board = await asanaStorage.getBoardView(projectId);
        sendJSON(res, 200, board);
      } catch (err) {
        sendJSON(res, 404, { error: err.message });
      }
      return;
    }

    // GET /api/views/timeline
    if (url === '/api/views/timeline' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const projectId = query.get('project_id');
      if (!projectId) {
        sendJSON(res, 400, { error: 'project_id query parameter required' });
        return;
      }
      try {
        const timeline = await asanaStorage.getTimelineView(
          projectId,
          query.get('start'),
          query.get('end')
        );
        sendJSON(res, 200, timeline);
      } catch (err) {
        sendJSON(res, 404, { error: err.message });
      }
      return;
    }

    // GET /api/views/agent
    if (url === '/api/views/agent' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const agentName = query.get('agent_name');
      if (!agentName) {
        sendJSON(res, 400, { error: 'agent_name query parameter required' });
        return;
      }
      try {
        const page = parseInt(query.get('page')) || 1;
        const limit = parseInt(query.get('limit')) || 50;
        const queue = await asanaStorage.getAgentQueue(agentName, ['ready', 'in_progress'], { page, limit });
        sendJSON(res, 200, { agent: agentName, tasks: queue.tasks, pagination: queue.pagination });
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 500;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // ============================================
    // AGENT EXECUTION API
    // ============================================

    // POST /api/agent/claim
    if (url === '/api/agent/claim' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const { task_id, agent_name } = await parseJSONBody(req);
        if (!task_id || !agent_name) {
          sendJSON(res, 400, { error: 'task_id and agent_name required' });
          return;
        }
        const result = await asanaStorage.claimTask(task_id, agent_name);
        sendJSON(res, 200, result);
      } catch (err) {
        const statusCode = err.message.includes('locked') ? 409 : 404;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // POST /api/agent/release
    if (url === '/api/agent/release' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const { task_id } = await parseJSONBody(req);
        if (!task_id) {
          sendJSON(res, 400, { error: 'task_id required' });
          return;
        }
        const result = await asanaStorage.releaseTask(task_id);
        sendJSON(res, 200, result);
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // POST /api/agents/heartbeat
    if (url === '/api/agents/heartbeat' && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const { agent_name, status = 'online' } = await parseJSONBody(req);
        if (!agent_name) {
          sendJSON(res, 400, { error: 'agent_name required' });
          return;
        }
        await asanaStorage.recordAgentHeartbeat(agent_name, status);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // GET /api/agents/status
    if (url === '/api/agents/status' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const statuses = await asanaStorage.listAgentStatuses();
        sendJSON(res, 200, { agents: statuses });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // POST /api/tasks/:id/retry
    if (url.startsWith('/api/tasks/') && url.endsWith('/retry') && method === 'POST') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      try {
        const parts = url.split('/');
        const taskId = parts[3];
        if (!taskId) {
          sendJSON(res, 400, { error: 'task_id required in URL' });
          return;
        }
        const result = await asanaStorage.retryTask(taskId);
        // Fetch updated task
        const task = await asanaStorage.getTask(taskId);
        sendJSON(res, 200, { ...result, task });
      } catch (err) {
        const statusCode = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, statusCode, { error: err.message });
      }
      return;
    }

    // GET /api/lead-handoffs - Activity feed with task/project context
    if (url === '/api/lead-handoffs' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const actionFilter = query.get('action'); // comma-separated: claim,release,update,move,create,delete,archive
      const actorFilter = query.get('actor');
      const projectFilter = query.get('project_id');
      const limit = Math.max(1, Math.min(200, parseInt(query.get('limit'), 10) || 50));
      const offset = Math.max(0, parseInt(query.get('offset'), 10) || 0);
      try {
        const result = await asanaStorage.getLeadHandoffs({ actionFilter, actorFilter, projectFilter, limit, offset });
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

        // GET /api/audit - query audit log with optional filters
    if (url === '/api/audit' && method === 'GET') {
      if (!asanaStorage) {
        sendJSON(res, 503, { error: 'Asana storage not initialized' });
        return;
      }
      const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const filters = {};
      if (query.has('task_id')) filters.task_id = query.get('task_id');
      if (query.has('q')) filters.q = query.get('q');
      if (query.has('actor')) filters.actor = query.get('actor');
      if (query.has('action')) filters.action = query.get('action');
      if (query.has('start_date')) filters.start_date = query.get('start_date');
      if (query.has('end_date')) filters.end_date = query.get('end_date');
      if (query.has('entity_type')) filters.entity_type = query.get('entity_type');
      if (query.has('governance_only')) filters.governance_only = query.get('governance_only') === 'true';
      const limit = Math.max(1, parseInt(query.get('limit'), 10) || 100);
      const offset = Math.max(0, parseInt(query.get('offset'), 10) || 0);
      try {
        const result = await asanaStorage.queryAuditLog(filters, limit, offset);
        if (Array.isArray(result)) {
          sendJSON(res, 200, { logs: result, total: result.length, limit, offset });
        } else {
          sendJSON(res, 200, { logs: result.logs || [], total: result.total || 0, limit, offset });
        }
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
      return;
    }

    // ============================================
    // ORG API (Agents, Departments)
    // ============================================
    
    const orgHandled = await orgAPI(req, res, url, method, requestBodyCache.get(req) || {}, {
      sendJSON,
      asanaStorage,
      pool: asanaStorage?.pool
    });
    if (orgHandled) return;

    // ============================================
    // OPERATIONS PAGE APIs
    // ============================================
    
    // Health status endpoint for operations page
    if (url === '/api/health-status' && method === 'GET') {
      try {
        const healthData = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database: { status: asanaStorage ? 'connected' : 'disconnected' },
          gateway: { status: 'unknown' },
          task_server: { healthy: true }
        };
        
        // Check gateway status
        try {
          const { execSync } = require('child_process');
          const result = execSync('openclaw gateway status 2>/dev/null || echo "stopped"', { encoding: 'utf8', timeout: 5000 });
          healthData.gateway.status = result.includes('running') ? 'running' : 'stopped';
        } catch (e) {
          healthData.gateway.status = 'unknown';
        }
        
        sendJSON(res, 200, healthData);
      } catch (err) {
        sendJSON(res, 500, { status: 'error', error: err.message });
      }
      return;
    }
    
    // Metrics API (handles /api/metrics/org, /api/metrics/departments, /api/metrics/agents, etc.)
    const metricsHandled = await metricsAPI(req, res, url, method, requestBodyCache.get(req) || {}, {
      sendJSON,
      asanaStorage,
      pool: asanaStorage?.pool
    });
    if (metricsHandled) return;
    
    // Service requests API (handles /api/services, /api/service-requests)
    const servicesHandled = await serviceRequestsAPI(req, res, url, method, requestBodyCache.get(req) || {}, {
      sendJSON,
      asanaStorage,
      pool: asanaStorage?.pool
    });
    if (servicesHandled) return;

    // ============================================
    // CATALOG API (Skills & Tools)
    // ============================================
    
    const catalogHandled = await catalogAPI(req, res, url, method, requestBodyCache.get(req) || {}, {
      sendJSON,
      openclawBin: 'openclaw',
      listSkills: null, // Will use execFile to call openclaw skills list --json
      readOpenClawConfig: () => {
        try {
          const configPath = process.env.OPENCLAW_CONFIG_FILE || path.join(os.homedir(), ".openclaw", "openclaw.json");
          if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
          }
        } catch (e) {
          console.error('Failed to read openclaw config:', e.message);
        }
        return null;
      }
    });
    if (catalogHandled) return;

    // ============================================
    // WORKFLOW RUNS API
    // ============================================
    
    if (workflowRunsHandler) {
      // Parse body for POST/PATCH/PUT requests (needed for workflow endpoints)
      let requestBody = requestBodyCache.get(req);
      if (requestBody === undefined && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        try {
          requestBody = await parseJSONBody(req);
          requestBodyCache.set(req, requestBody);
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
          return;
        }
      }
      requestBody = requestBody || {};
      
      const handled = await workflowRunsHandler(req, res, url, requestBody);
      if (handled) return;
    }

    // ============================================
    // STATIC FILE SERVING
    // ============================================

    // Serve favicon (return 204 No Content to suppress 404)
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve webos desktop at root
    if (url === '/') {
      sendFile(res, 'dashboard/index.html');
      return;
    }

    // Serve other static files from the dashboard subdirectory
    // (frontend assets: index.html, src/shell/, src/styles/, etc.)
    sendFile(res, path.join('dashboard', url.slice(1)));

  } catch (err) {
    console.error(`❌ Request error ${method} ${url}:`, err);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`📋 Task Server running at http://0.0.0.0:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/`);
  console.log(`   Legacy API: http://localhost:${PORT}/api/tasks (markdown)`);
  console.log(`   New API: http://localhost:${PORT}/api/projects`);
  console.log(`   New API: http://localhost:${PORT}/api/tasks/all`);
  console.log(`   New API: http://localhost:${PORT}/api/views/board?project_id=...`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Task file: ${TASKS_FILE}`);
  console.log(`   Storage type: ${STORAGE_TYPE}`);
  console.log(`   Accessible from network interfaces`);

  // Initialize Asana storage
  await initAsanaStorage();
}).on('error', (err) => {
  console.error(`❌ Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`   Port ${PORT} is already in use. Kill existing process or use different port.`);
  }
  process.exit(1);
});
