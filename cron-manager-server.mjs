#!/usr/bin/env node
/**
 * Lightweight cron job management API server.
 * Runs alongside task-server on port 3878.
 * 
 * Endpoints:
 *   GET    /api/cron-admin/jobs          - List all cron jobs
 *   GET    /api/cron-admin/jobs/:id       - Get single job
 *   POST   /api/cron-admin/jobs          - Create a new cron job
 *   PUT    /api/cron-admin/jobs/:id       - Update an existing cron job
 *   DELETE /api/cron-admin/jobs/:id       - Delete a cron job
 *   POST   /api/cron-admin/jobs/:id/run   - Trigger a job run
 *   GET    /api/cron-admin/jobs/:id/logs  - Get recent log entries
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createServer } from 'http';
import { spawn } from 'child_process';

const CRONTAB_DIR = process.env.WORKSPACE
  ? join(process.env.WORKSPACE, 'crontab')
  : '/root/.openclaw/workspace/crontab';
const LOGS_DIR = process.env.WORKSPACE
  ? join(process.env.WORKSPACE, 'logs')
  : '/root/.openclaw/workspace/logs';
const WORKSPACE = process.env.WORKSPACE || '/root/.openclaw/workspace';
const PORT = process.env.CRON_MANAGER_PORT || 3878;

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
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
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const comments = [];
    let cronLine = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#')) comments.push(trimmed.slice(1).trim());
        continue;
      }
      cronLine = trimmed;
      break;
    }
    if (!cronLine) return null;
    const match = cronLine.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) return null;
    const [, minute, hour, dom, month, dow, command] = match;
    let logPath = null;
    const redir = command.match(/(?:>>|>)\s*(\S+)/);
    if (redir) {
      logPath = redir[1];
      if (!logPath.startsWith('/')) logPath = join(WORKSPACE, logPath);
    }
    const id = basename(filePath, '.cron');
    let description = comments.join(' ');
    if (!description) description = id;
    return { id, name: description, description, schedule: `${minute} ${hour} ${dom} ${month} ${dow}`, minute, hour, dom, month, dow, command, logPath };
  } catch (e) { return null; }
}

function listJobs() {
  if (!existsSync(CRONTAB_DIR)) return [];
  return readdirSync(CRONTAB_DIR)
    .filter(f => f.endsWith('.cron'))
    .map(f => parseCronFile(join(CRONTAB_DIR, f)))
    .filter(Boolean)
    .map(j => {
      if (j.logPath && existsSync(j.logPath)) {
        try { j.lastRun = statSync(j.logPath).mtime.toISOString(); } catch (e) { j.lastRun = null; }
      } else { j.lastRun = null; }
      j.status = 'active';
      return j;
    });
}

function getJob(id) {
  const filePath = join(CRONTAB_DIR, `${id}.cron`);
  if (!existsSync(filePath)) return null;
  return parseCronFile(filePath);
}

function createJob(data) {
  const { id, name, description, minute = '*', hour = '*', dom = '*', month = '*', dow = '*', command } = data;
  if (!id || !command) throw new Error('id and command are required');
  if (/\s/.test(id)) throw new Error('id cannot contain spaces');
  const filePath = join(CRONTAB_DIR, `${id}.cron`);
  if (existsSync(filePath)) throw new Error(`Cron job "${id}" already exists`);
  const desc = description || name || id;
  const content = `# ${desc}\n${minute} ${hour} ${dom} ${month} ${dow} ${command}\n`;
  writeFileSync(filePath, content, 'utf8');
  return parseCronFile(filePath);
}

function updateJob(id, data) {
  const filePath = join(CRONTAB_DIR, `${id}.cron`);
  if (!existsSync(filePath)) throw new Error(`Cron job "${id}" not found`);
  const existing = parseCronFile(filePath);
  if (!existing) throw new Error(`Failed to parse existing job "${id}"`);
  const desc = data.description ?? data.name ?? existing.description;
  const minute = data.minute ?? existing.minute;
  const hour = data.hour ?? existing.hour;
  const dom = data.dom ?? existing.dom;
  const month = data.month ?? existing.month;
  const dow = data.dow ?? existing.dow;
  const command = data.command ?? existing.command;
  const content = `# ${desc}\n${minute} ${hour} ${dom} ${month} ${dow} ${command}\n`;
  writeFileSync(filePath, content, 'utf8');
  return parseCronFile(filePath);
}

function deleteJob(id) {
  const filePath = join(CRONTAB_DIR, `${id}.cron`);
  if (!existsSync(filePath)) throw new Error(`Cron job "${id}" not found`);
  unlinkSync(filePath);
  return { success: true, deleted: id };
}

function getJobLogs(id, lines = 50) {
  const job = getJob(id);
  if (!job || !job.logPath) return { logs: [], logPath: null };
  if (!existsSync(job.logPath)) return { logs: [], logPath: job.logPath };
  const content = readFileSync(job.logPath, 'utf8');
  const allLines = content.split('\n').filter(l => l.trim());
  return { logs: allLines.slice(-lines), logPath: job.logPath };
}

function runJob(id) {
  const job = getJob(id);
  if (!job) throw new Error(`Cron job "${id}" not found`);
  const child = spawn('bash', ['-c', job.command], { cwd: WORKSPACE, detached: true, stdio: 'ignore' });
  child.unref();
  return { success: true, pid: child.pid, job: id };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  try {
    const url = req.url.split('?')[0];
    const method = req.method;

    // GET /api/cron-admin/jobs
    if (url === '/api/cron-admin/jobs' && method === 'GET') {
      return sendJSON(res, 200, { jobs: listJobs() });
    }

    // POST /api/cron-admin/jobs
    if (url === '/api/cron-admin/jobs' && method === 'POST') {
      const data = await parseBody(req);
      const job = createJob(data);
      return sendJSON(res, 201, job);
    }

    // GET /api/cron-admin/jobs/:id
    if (url.match(/^\/api\/cron-admin\/jobs\/([^/]+)$/) && method === 'GET') {
      const id = url.split('/')[4];
      const job = getJob(id);
      if (!job) return sendJSON(res, 404, { error: 'Not found' });
      return sendJSON(res, 200, job);
    }

    // PUT /api/cron-admin/jobs/:id
    if (url.match(/^\/api\/cron-admin\/jobs\/([^/]+)$/) && method === 'PUT') {
      const id = url.split('/')[4];
      const data = await parseBody(req);
      const job = updateJob(id, data);
      return sendJSON(res, 200, job);
    }

    // DELETE /api/cron-admin/jobs/:id
    if (url.match(/^\/api\/cron-admin\/jobs\/([^/]+)$/) && method === 'DELETE') {
      const id = url.split('/')[4];
      const result = deleteJob(id);
      return sendJSON(res, 200, result);
    }

    // POST /api/cron-admin/jobs/:id/run
    if (url.match(/^\/api\/cron-admin\/jobs\/([^/]+)\/run$/) && method === 'POST') {
      const id = url.split('/')[4];
      const result = runJob(id);
      return sendJSON(res, 202, result);
    }

    // GET /api/cron-admin/jobs/:id/logs
    if (url.match(/^\/api\/cron-admin\/jobs\/([^/]+)\/logs$/) && method === 'GET') {
      const id = url.split('/')[4];
      const result = getJobLogs(id);
      return sendJSON(res, 200, result);
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[cron-manager]', err.message);
    sendJSON(res, 400, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`⏰ Cron Manager API running at http://127.0.0.1:${PORT}`);
});
