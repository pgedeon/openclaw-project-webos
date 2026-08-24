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
const { URL, pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { createWorkflowRunsHandler } = require('./workflow-runs-api.js');
const { GatewayWorkflowDispatcher } = require('./gateway-workflow-dispatcher.js');
const { createGatewayWorkflowDispatcherV2Handler } = require('./gateway-workflow-dispatcher-v2.js');
const { catalogAPI } = require('./catalog-api.js');
const { metricsAPI } = require('./metrics-api.js');
const { serviceRequestsAPI } = require('./service-requests-api.js');
const { orgAPI } = require('./org-api.js');
const { createDiagnosticsHandler } = require('./diagnostics-api.js');

// ── ROUTER MODULE IMPORTS (Phase 4A) ──────────────────────
const Router = require('./routes/router');
const { registerHealthRoutes } = require('./routes/health-routes');
const { registerTaskRoutes } = require('./routes/task-routes');
const { registerProjectRoutes } = require('./routes/project-routes');
const { registerViewRoutes } = require('./routes/view-routes');
const { registerCronRoutes } = require('./routes/cron-routes');
const { registerAgentRoutes } = require('./routes/agent-routes');
const { registerSSERoutes, broadcast, broadcastStream } = require('./routes/sse-routes');
const { registerSessionRoutes } = require('./routes/session-routes');
const { registerChatRoutes } = require('./routes/chat-routes');
const { registerBingRoutes } = require('./routes/bing-routes');
const { registerSettingsRoutes } = require('./routes/settings-routes');
const { registerMemoryRoutes } = require('./routes/memory-routes');
const { registerHistoryRoutes } = require('./routes/history-routes');
const { registerExportRoutes } = require('./routes/export-routes');
const { registerSpaceRoutes } = require('./routes/space-routes');
const { registerWorkflowRoutingRoutes } = require('./routes/workflow-routing-routes');
const { registerCostRoutes } = require('./routes/cost-routes');
const { registerBudgetRoutes } = require('./routes/budget-routes');
const { registerActionRoutes } = require('./routes/action-routes');
const { timingSafeTokenEqual } = require('./routes/auth-policy');
const { createGatewayBridge } = require('./lib/gateway-bridge');
const { createGatewayConsoleFeed } = require('./lib/gateway-console-feed');
const SettingsStore = require('./lib/settings-store');

function loadDashboardEnv() {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const rawLine of envLines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) {
        continue;
      }

      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    console.error(`⚠️  Failed to load dashboard .env: ${error.message}`);
  }
}

loadDashboardEnv();

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`❌ Uncaught Exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`❌ Unhandled Rejection: ${reason}`);
});

const PORT = process.env.PORT || 3876;
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const WORKSPACE = '/root/.openclaw/workspace';
const TASKS_FILE = path.join(WORKSPACE, 'tasks.md');
const DASHBOARD_ROOT = path.join(WORKSPACE, 'dashboard');
const GATEWAY_STATUS_FILE = path.join(DASHBOARD_ROOT, 'gateway-status.json');
const GATEWAY_STATUS_STALE_MS = 2 * 60 * 1000;
const FILESYSTEM_API_SCRIPT = process.env.FILESYSTEM_API_SCRIPT || path.join(DASHBOARD_ROOT, 'filesystem-api-server.mjs');
const FILESYSTEM_API_ROOT = process.env.OPENCLAW_FS_ROOT || '/root/.openclaw';
const ASANA_JSON_SNAPSHOT_PATH = process.env.ASANA_JSON_SNAPSHOT_PATH || path.join(WORKSPACE, 'data/asana-db.json');
const DASHBOARD_AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || null;

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
let v2DispatcherHandler = null;
const requestBodyCache = new Map();
let filesystemApiModulePromise = null;

function getAsanaStorageMode() {
  if (!asanaStorage) {
    return 'disabled';
  }
  if (asanaStorage.readOnly === true) {
    return asanaStorage.mode || 'json_snapshot';
  }
  return 'postgres';
}

async function getAsanaStorageHealth() {
  const mode = getAsanaStorageMode();
  if (mode === 'postgres') {
    let dbAlive = false;
    let dbLatencyMs = null;
    try {
      if (asanaStorage && asanaStorage.pool) {
        const start = Date.now();
        const result = await asanaStorage.pool.query('SELECT 1 AS health_check');
        dbAlive = result.rows && result.rows.length > 0;
        dbLatencyMs = Date.now() - start;
      }
    } catch (e) {
      dbAlive = false;
    }
    return {
      mode,
      ready: dbAlive,
      databaseHealthy: dbAlive,
      dbLatencyMs,
      label: dbAlive ? 'connected' : 'unreachable',
      note: dbAlive ? null : 'PostgreSQL connection failed health check',
    };
  }
  if (mode === 'json_snapshot') {
    return {
      mode,
      ready: true,
      databaseHealthy: false,
      label: 'snapshot',
      note: `PostgreSQL unavailable; serving read-only snapshot from ${ASANA_JSON_SNAPSHOT_PATH}`,
    };
  }
  return {
    mode,
    ready: false,
    databaseHealthy: false,
    label: 'disconnected',
    note: 'No task storage backend is available',
  };
}

function normalizeTaskListProjectId(projectId) {
  const normalized = typeof projectId === 'string' ? projectId.trim() : '';
  if (!normalized || normalized.toLowerCase() === 'all') {
    return '';
  }
  return normalized;
}

let settingsPool = null;

async function initAsanaStorage() {
  workflowRunsHandler = null;
  v2DispatcherHandler = null;
  try {
    if (STORAGE_TYPE === 'postgres') {
      const AsanaStorage = require('./storage/asana');
      asanaStorage = new AsanaStorage({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        database: process.env.POSTGRES_DB || 'mission_control',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'postgres',
      });
      await asanaStorage.init();
      console.log('✅ Asana PostgreSQL storage initialized');
// Wire pool into settings routes
settingsPool = asanaStorage.pool || asanaStorage._pool || null;
      // Initialize workflow runs handler
      if (asanaStorage.pool) {
        try {
          workflowRunsHandler = createWorkflowRunsHandler(asanaStorage.pool);
          console.log('✅ Workflow runs API handler initialized');
          
          // V1 dispatcher disabled — replaced by v2 dispatcher below
          // const workflowDispatcher = new GatewayWorkflowDispatcher(asanaStorage.pool, console);
          // workflowDispatcher.start();
          // console.log('✅ Workflow run monitor started (30s poll interval)');
          
          // Start v2 dispatcher (DB-first dispatch queue with atomic claiming)
          v2DispatcherHandler = null;
          try {
            const { GatewayWorkflowDispatcherV2 } = require('./gateway-workflow-dispatcher-v2.js');
            const v2Dispatcher = new GatewayWorkflowDispatcherV2(asanaStorage.pool, {}, console);
            v2Dispatcher.start();
            v2DispatcherHandler = createGatewayWorkflowDispatcherV2Handler(v2Dispatcher);
            console.log('✅ Workflow dispatcher v2 started (DB-first, atomic claiming)');
          } catch (err) {
            console.error('⚠️  Failed to start v2 dispatcher:', err.message);
          }
        } catch (err) {
          console.error('⚠️  Failed to initialize workflow runs handler:', err.message);
        }
      }
    } else {
      const { AsanaJsonSnapshotStorage } = require('./storage/asana-json-snapshot');
      asanaStorage = new AsanaJsonSnapshotStorage(ASANA_JSON_SNAPSHOT_PATH);
      await asanaStorage.init();
      console.log(`✅ Asana JSON snapshot storage initialized (read-only) from ${ASANA_JSON_SNAPSHOT_PATH}`);
    }
  } catch (err) {
    console.error('❌ Failed to initialize Asana storage:', err.message);

    if (STORAGE_TYPE === 'postgres' && fs.existsSync(ASANA_JSON_SNAPSHOT_PATH)) {
      try {
        const { AsanaJsonSnapshotStorage } = require('./storage/asana-json-snapshot');
        asanaStorage = new AsanaJsonSnapshotStorage(ASANA_JSON_SNAPSHOT_PATH);
        await asanaStorage.init();
        console.warn(`⚠️  Falling back to read-only JSON snapshot storage: ${ASANA_JSON_SNAPSHOT_PATH}`);
        return;
      } catch (fallbackErr) {
        console.error('❌ Failed to initialize JSON snapshot fallback:', fallbackErr.message);
      }
    }

    asanaStorage = null;
  }
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost:' + PORT,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
  // Security: reject obvious traversal patterns before joining
  if (filePath.includes('..') || filePath.includes('\x00')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const fullPath = path.resolve(WORKSPACE, filePath);

  // Security: verify resolved path is within workspace (handles symlinks)
  if (!fullPath.startsWith(WORKSPACE + path.sep) && fullPath !== WORKSPACE) {
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
      'Access-Control-Allow-Origin': 'http://localhost:' + PORT
    };
    
    // Cache static assets by type
    if (ext === '.html' || ext === '.js' || ext === '.mjs') {
      // Force clear service worker cache for HTML/JS to prevent stale SW issues
      headers['Clear-Site-Data'] = '"cache"';
      headers['Cache-Control'] = 'no-store, max-age=0';
    } else if (ext === '.css') {
      headers['Cache-Control'] = 'public, max-age=3600';
    } else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=86400';
    } else if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=604800';
    }
    
    res.writeHead(200, headers);
    res.end(data);
  });
}

function parseJSONBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;
    req.on('data', chunk => {
      bodyBytes += chunk.length;
      if (bodyBytes > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
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

function loadFilesystemApiModule() {
  if (!filesystemApiModulePromise) {
    filesystemApiModulePromise = import(pathToFileURL(FILESYSTEM_API_SCRIPT).href);
  }
  return filesystemApiModulePromise;
}

async function handleFilesystemApiInProcess(url, method, body) {
  const module = await loadFilesystemApiModule();
  return module.handleFilesystemApiRequest({
    rootPath: FILESYSTEM_API_ROOT,
    url,
    method,
    body,
  });
}

function readGatewayStatusSnapshot() {
  try {
    const raw = fs.readFileSync(GATEWAY_STATUS_FILE, 'utf8');
    const payload = JSON.parse(raw);
    const syncedAt = typeof payload?.syncedAt === 'string' ? payload.syncedAt : null;
    const syncedAtMs = syncedAt ? Date.parse(syncedAt) : Number.NaN;
    const ageMs = Number.isFinite(syncedAtMs) ? Math.max(0, Date.now() - syncedAtMs) : null;
    const isStale = ageMs == null || ageMs > GATEWAY_STATUS_STALE_MS;
    const hasError = typeof payload?.error === 'string' && payload.error.trim().length > 0;
    const agentCount = Array.isArray(payload?.agents) ? payload.agents.length : 0;

    return {
      status: hasError ? 'error' : isStale ? 'stale' : 'running',
      healthy: !hasError && !isStale,
      syncedAt,
      ageMs,
      agentCount,
      error: hasError ? payload.error.trim() : null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        healthy: false,
        syncedAt: null,
        ageMs: null,
        agentCount: 0,
        error: 'gateway-status.json not found',
      };
    }

    return {
      status: 'error',
      healthy: false,
      syncedAt: null,
      ageMs: null,
      agentCount: 0,
      error: error.message || 'Failed to read gateway status snapshot',
    };
  }
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

// ── ROUTER SETUP (Phase 4A) ──────────────────────────────
const router = new Router();

// Gateway console feed: second gateway subscriber for the Live Agent Console
// (/api/console/stream). Additive sibling of the bridge — own connection, same
// v4 handshake; disabled cleanly when no gateway config resolves. Created
// before route registration so the SSE module gets the started instance.
let gatewayConsoleFeed = null;
try {
  gatewayConsoleFeed = createGatewayConsoleFeed({ logger: console });
  gatewayConsoleFeed.start();
} catch (err) { console.error('⚠️  Gateway console feed not available:', err.message); }

registerSSERoutes(router, { consoleFeed: gatewayConsoleFeed });
registerSessionRoutes(router);

// ── Gateway client for chat ──────────────────────
let gatewayClient = null;
try {
  const GatewayClient = require('./lib/gateway-client');

  // Read gateway password from openclaw.json if not set in env
  let gatewayPassword = process.env.OPENCLAW_GATEWAY_PASSWORD || null;
  if (!gatewayPassword) {
    try {
      const ocConfig = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
      gatewayPassword = ocConfig?.gateway?.auth?.password || null;
    } catch (_) { /* config not readable */ }
  }

  gatewayClient = new GatewayClient({
    url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
    token: process.env.OPENCLAW_GATEWAY_TOKEN || null,
    password: gatewayPassword,
    onConnected: () => broadcast('gateway:status', { connected: true }),
    onDisconnected: () => broadcast('gateway:status', { connected: false }),
  });

  // Extract text from gateway message object
  function extractGatewayText(message) {
    if (!message) return '';
    if (typeof message === 'string') return message;
    const content = message.content;
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.filter(c => c.type === 'text').map(c => c.text || '').join('');
    }
    return '';
  }

  // Forward chat events to SSE clients
  gatewayClient.on('chat', (payload) => {
    console.log('[gateway-chat] event:', JSON.stringify(payload).slice(0, 200));
    const { sessionKey, runId, state } = payload;
    if (state === 'delta') {
      broadcast('session:chat-delta', { sessionKey, runId, text: extractGatewayText(payload.message) });
    } else if (state === 'final') {
      broadcast('session:chat-final', { sessionKey, runId, message: payload.message });
    } else if (state === 'aborted') {
      broadcast('session:chat-aborted', { sessionKey, runId, message: payload.message || null });
    } else if (state === 'error') {
      broadcast('session:chat-error', { sessionKey, runId, error: payload.errorMessage || 'chat error' });
    }
  });

  gatewayClient.start();
} catch (err) {
  console.error('⚠️  Gateway client not available:', err.message);
}

// Gateway bridge v1: server-side subscriber feeding /api/events/stream. Opt-in
// via GATEWAY_BRIDGE_URL env or openclaw.json; disabled cleanly when unset;
// the gateway shared secret never leaves this process.
try { createGatewayBridge({ broadcastStream }).start(); }
catch (err) { console.error('⚠️  Gateway bridge not available:', err.message); }

registerChatRoutes(router, gatewayClient);

// ── Bing Webmaster ──────────────────────────────
const BING_API_KEY = process.env.BING_WEBMASTER_API_KEY || null;
registerBingRoutes(router, BING_API_KEY);

// ── Settings / Control Panel ────────────────────
const settingsStore = new SettingsStore();
settingsStore.load();
const SERVER_STARTED_AT = new Date().toISOString();
// Settings deps - pool will be available after DB init
const settingsDeps = {
  get pool() { return settingsPool; },
  gatewayClient,
  startedAt: SERVER_STARTED_AT,
  getSSEClientCount: () => 0,
};
registerSettingsRoutes(router, settingsStore, settingsDeps);
registerHealthRoutes(router);
registerCronRoutes(router);
registerAgentRoutes(router);
registerTaskRoutes(router);
registerProjectRoutes(router);
registerViewRoutes(router);
registerMemoryRoutes(router);
registerHistoryRoutes(router, settingsDeps);
registerExportRoutes(router, settingsDeps, settingsStore);
registerSpaceRoutes(router, settingsDeps);
registerWorkflowRoutingRoutes(router, settingsDeps);
registerCostRoutes(router);
registerBudgetRoutes(router);
registerActionRoutes(router);
const server = http.createServer(async (req, res) => {
  const timestamp = new Date().toISOString();
  const url = req.url.split('?')[0];
  const method = req.method;

  // Log request — query string intentionally stripped so the legacy `?token=`
  // SSE credential never reaches logs (SECURITY-AUDIT-2026-08.md F7).
  console.log(`[${timestamp}] ${method} ${url}`);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': 'http://localhost:' + PORT,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }


  // ── AUTH MIDDLEWARE ──────────────────────────────────────
  // Require Bearer token for all /api/* routes (except /api/health and /api/auth/self)
  // when DASHBOARD_AUTH_TOKEN is set in environment.
  // Security (SECURITY-AUDIT-2026-08.md F7): prefer the Authorization header.
  // The `?token=` query parameter is kept ONLY as a documented legacy fallback
  // for EventSource clients (which cannot set request headers); it must never
  // be logged — request logging above strips query strings for this reason.
  if (DASHBOARD_AUTH_TOKEN && url.startsWith('/api/') && url !== '/api/health' && url !== '/api/auth/self') {
    const authHeader = req.headers['authorization'] || '';
    let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    // Legacy SSE fallback (documented): accept token as ?token= query param.
    if (!token) {
      const qs = (req.url || '').split('?')[1] || '';
      const tokenParam = qs.split('&').find(p => p.startsWith('token='));
      if (tokenParam) token = decodeURIComponent(tokenParam.split('=')[1]);
    }
    const tokenMatch = timingSafeTokenEqual(token, DASHBOARD_AUTH_TOKEN);
    if (!tokenMatch) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', message: 'Valid Bearer token required' }));
      return;
    }
  }

  try {
    // ── ROUTER DISPATCH (Phase 4A) ─────────────────────────────
    // Try modular route handlers first; fall through to inline handlers if not matched
    const routerCtx = {
      sendJSON,
      parseJSONBody,
      asanaStorage,
      STORAGE_TYPE,
      PORT,
      TASKS_FILE,
      getAsanaStorageHealth,
      normalizeTaskListProjectId,
      readGatewayStatusSnapshot,
      broadcast,
    };
    const routerHandled = await router.handle(req, res, url, method, routerCtx);
    if (routerHandled) return;

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
        const gatewaySnapshot = readGatewayStatusSnapshot();
        const storageHealth = await getAsanaStorageHealth();
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
          const configPath = '/root/.openclaw/openclaw.json';
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
    
    // V2 DISPATCHER ENDPOINTS (pending, claim, heartbeat, complete, stats)
    if (url.startsWith('/api/workflow-runs/pending') || 
        url.match(/^\/api\/workflow-runs\/[^/]+\/(claim|heartbeat|complete)$/) ||
        url === '/api/workflow-runs/dispatcher/stats') {
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
      
      if (v2DispatcherHandler) {
        const handled = await v2DispatcherHandler(req, res, url, requestBody);
        if (handled) return;
      }
    }
    
    if (workflowRunsHandler) {
      // Parse body for POST/PATCH/PUT requests (needed for workflow endpoints)
      let requestBody = requestBodyCache.get(req);
      if (
        requestBody === undefined &&
        !url.startsWith('/api/fs/') &&
        (method === 'POST' || method === 'PATCH' || method === 'PUT')
      ) {
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
    // ============================================
    // FILESYSTEM API: /api/fs/* → shared filesystem handler
    // ============================================
    if (url.startsWith('/api/fs/') && !url.includes('..')) {
      try {
        let requestBody = requestBodyCache.get(req);
        if (
          requestBody === undefined &&
          (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
        ) {
          requestBody = await parseJSONBody(req);
          requestBodyCache.set(req, requestBody);
        }

        const result = await handleFilesystemApiInProcess(req.url, method, requestBody || {});
        sendJSON(res, result.status, result.payload);
      } catch (error) {
        const statusCode = error?.statusCode || 500;
        console.error(`[filesystem-route] ${method} ${url} failed: ${error.stack || error.message}`);
        sendJSON(res, statusCode, { error: error.message });
      }
      return;
    }
    // STATIC FILE SERVING
    // ============================================

    // Serve favicon (return 204 No Content to suppress 404)
    if (url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve webos desktop at root
    // Security (SECURITY-AUDIT-2026-08.md F1): never embed DASHBOARD_AUTH_TOKEN in
    // this unauthenticated response. The bootstrap script in index.html verifies
    // the operator's token against /api/auth/self and attaches it to API calls
    // as a Bearer header (see src/shell/api-client.mjs).
    if (url === '/' || url === '/index.html') {
      const htmlPath = path.join(WORKSPACE, 'dashboard/index.html');
      fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        // Clear-Site-Data evicts any previously cached token-injected page.
        res.writeHead(200, { 'Content-Type': 'text/html', 'Clear-Site-Data': '"cache"', 'Cache-Control': 'no-store' });
        res.end(html);
      });
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

// Security (SECURITY-AUDIT-2026-08.md F8): refuse to serve without a token,
// and refuse unauthenticated (`REQUIRE_AUTH=false`) binds on non-loopback hosts.
if (!DASHBOARD_AUTH_TOKEN && process.env.REQUIRE_AUTH !== 'false') {
  console.error(`❌ FATAL: DASHBOARD_AUTH_TOKEN is not set. Server would bind ${HOST} — set a token or export REQUIRE_AUTH=false to override.`);
  process.exit(1);
}
if (!DASHBOARD_AUTH_TOKEN && !LOOPBACK_HOSTS.has(String(HOST).toLowerCase())) {
  console.error(`❌ FATAL: REQUIRE_AUTH=false serves the dashboard without authentication — refusing to bind non-loopback host "${HOST}". Set HOST=127.0.0.1 (or localhost / ::1), or configure DASHBOARD_AUTH_TOKEN.`);
  process.exit(1);
}

server.listen(PORT, HOST, async () => {
  console.log(`📋 Task Server running at http://${LOOPBACK_HOSTS.has(String(HOST).toLowerCase()) ? 'localhost' : HOST}:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/`);
  console.log(`   Legacy API: http://localhost:${PORT}/api/tasks (markdown)`);
  console.log(`   New API: http://localhost:${PORT}/api/projects`);
  console.log(`   New API: http://localhost:${PORT}/api/tasks/all`);
  console.log(`   New API: http://localhost:${PORT}/api/views/board?project_id=...`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Task file: ${TASKS_FILE}`);
  console.log(`   Storage type: ${STORAGE_TYPE}`);
  console.log(DASHBOARD_AUTH_TOKEN
    ? `   Bound to ${HOST}:${PORT} (auth required)`
    : `   Bound to ${HOST}:${PORT} (no auth — loopback only)`);

  // Initialize Asana storage
  await initAsanaStorage();

  // Periodic gateway status sync — write gateway-status.json for health checks
  async function syncGatewayStatus() {
    try {
      if (!gatewayClient || !gatewayClient.connected) {
        // Write placeholder so health knows we're trying
        fs.writeFileSync(GATEWAY_STATUS_FILE, JSON.stringify({ syncedAt: new Date().toISOString(), agents: [], agentCount: 0 }));
        return;
      }
      const agents = await gatewayClient._request('agents.list', {});
      const status = {
        syncedAt: new Date().toISOString(),
        agents: Array.isArray(agents) ? agents : [],
        agentCount: Array.isArray(agents) ? agents.length : 0,
      };
      fs.writeFileSync(GATEWAY_STATUS_FILE, JSON.stringify(status, null, 2));
      console.log(`[gateway-sync] Wrote status: ${status.agentCount} agents`);
    } catch (e) {
      console.warn('[gateway-sync] Failed:', e.message);
      try {
        fs.writeFileSync(GATEWAY_STATUS_FILE, JSON.stringify({ syncedAt: new Date().toISOString(), error: e.message }));
      } catch {}
    }
  }
  setInterval(syncGatewayStatus, 60000); // every 60s
  setTimeout(syncGatewayStatus, 3000);   // initial sync after 3s
}).on('error', (err) => {
  console.error(`❌ Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`   Port ${PORT} is already in use. Kill existing process or use different port.`);
  }
  process.exit(1);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    if (asanaStorage && asanaStorage.pool) {
      asanaStorage.pool.end().then(() => {
        console.log(' Database pool drained');
        process.exit(0);
      }).catch(() => process.exit(1));
    } else {
      process.exit(0);
    }
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error(' Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
