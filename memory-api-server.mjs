#!/usr/bin/env node
/**
 * Memory API server — serves memory system data for the dashboard views.
 * Runs on port 3879 alongside task-server (3876) and cron-manager (3878).
 *
 * Endpoints:
 *   GET /api/memory/list      — List all memory files with metadata
 *   GET /api/memory/file/:name — Read a specific memory file
 *   GET /api/memory/root      — Read MEMORY.md
 *   GET /api/memory/search?q= — Semantic search via unified query script
 *   GET /api/memory/facts     — List all structured facts
 *   GET /api/memory/status    — Memory system status (index, embeddings, etc.)
 *   GET /api/memory/stats     — Aggregate statistics
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, sep } from 'path';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execFile);

const MEMORY_DIR = '/root/.openclaw/workspace/main/memory';
const MEMORY_ROOT = '/root/.openclaw/workspace/main/MEMORY.md';
const FACTS_SCRIPT = '/root/.openclaw/workspace/scripts/facts_db.py';
const UNIFIED_SCRIPT = '/root/.openclaw/workspace/scripts/memory_query_unified.js';
const PORT = process.env.MEMORY_API_PORT || 3879;

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function listMemoryFiles() {
  if (!existsSync(MEMORY_DIR)) return [];
  return readdirSync(MEMORY_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fp = join(MEMORY_DIR, f);
      try {
        const stat = statSync(fp);
        const content = readFileSync(fp, 'utf8');
        const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').substring(0, 120);
        return {
          name: f,
          title: firstLine || f,
          size: stat.size,
          lines: content.split('\n').length,
          modified: stat.mtime,
          isDaily: /^\d{4}-\d{2}-\d{2}\.md$/.test(f),
          isSpecialized: !/^\d{4}-\d{2}-\d{2}\.md$/.test(f) && !f.startsWith('TODAY'),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.modified - a.modified);
}

function getMemoryFile(name) {
  const safeName = basename(name);
  const filePath = join(MEMORY_DIR, safeName);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf8');
  return { name: safeName, content, size: content.length, lines: content.split('\n').length };
}

function getMemoryRoot() {
  if (!existsSync(MEMORY_ROOT)) return null;
  const content = readFileSync(MEMORY_ROOT, 'utf8');
  return { name: 'MEMORY.md', content, size: content.length };
}

function searchMemory(query) {
  return execAsync('node', [UNIFIED_SCRIPT, '--scope', 'all', '--q', query], { timeout: 15000 })
    .then(({ stdout }) => JSON.parse(stdout));
}

function getFacts() {
  return execAsync('python3', [FACTS_SCRIPT, 'stats'], { timeout: 10000 })
    .then(({ stdout }) => {
      const data = JSON.parse(stdout);
      const facts = data.namespaces || [];
      return facts;
    });
}

async function listFacts(namespace) {
  const args = [FACTS_SCRIPT, 'list'];
  if (namespace) args.push('--namespace', namespace);
  const { stdout } = await execAsync('python3', args, { timeout: 10000 });
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

async function addFact({ namespace, subject, predicate, value, source, note, confidence, tags }) {
  const args = [FACTS_SCRIPT, 'upsert', '--namespace', namespace, '--subject', subject, '--predicate', predicate];
  if (value) args.push('--value', value);
  if (source) args.push('--source', source);
  if (note) args.push('--note', note);
  if (confidence) args.push('--confidence', String(confidence));
  if (tags && Array.isArray(tags)) tags.forEach(t => args.push('--tag', t));
  await execAsync('python3', args, { timeout: 10000 });
  return { success: true, namespace, subject, predicate };
}

async function deleteFact({ namespace, subject, predicate }) {
  const args = [FACTS_SCRIPT, 'delete', '--namespace', namespace, '--subject', subject];
  if (predicate) args.push('--predicate', predicate);
  await execAsync('python3', args, { timeout: 10000 });
  return { success: true, namespace, subject, predicate };
}

async function searchFacts(query, namespace) {
  const args = [FACTS_SCRIPT, 'search', '--query', query];
  if (namespace) args.push('--namespace', namespace);
  const { stdout } = await execAsync('python3', args, { timeout: 10000 });
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function getMemoryStatus() {
  return execAsync('openclaw', ['memory', 'status', '--agent', 'main', '--deep', '--json'], { timeout: 10000 })
    .then(({ stdout }) => JSON.parse(stdout));
}

function getMemoryStats() {
  const files = listMemoryFiles();
  const daily = files.filter(f => f.isDaily);
  const specialized = files.filter(f => f.isSpecialized);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const totalLines = files.reduce((s, f) => s + f.lines, 0);

  // Read MEMORY.md stats
  let rootSize = 0, rootLines = 0;
  const root = getMemoryRoot();
  if (root) { rootSize = root.size; rootLines = root.lines; }

  return {
    totalFiles: files.length,
    dailyFiles: daily.length,
    specializedFiles: specialized.length,
    totalSize,
    totalLines,
    rootSize,
    rootLines,
    newestFile: files[0]?.name || null,
    oldestFile: files[files.length - 1]?.name || null,
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    const urlPath = req.url.split('?')[0];
    const method = req.method;

    if (urlPath === '/api/memory/list' && method === 'GET') {
      return sendJSON(res, 200, { files: listMemoryFiles(), total: listMemoryFiles().length });
    }

    if (urlPath.startsWith('/api/memory/file/') && method === 'GET') {
      const name = decodeURIComponent(urlPath.replace('/api/memory/file/', ''));
      const file = getMemoryFile(name);
      if (!file) return sendJSON(res, 404, { error: 'File not found' });
      return sendJSON(res, 200, file);
    }

    if (urlPath === '/api/memory/root' && method === 'GET') {
      const root = getMemoryRoot();
      if (!root) return sendJSON(res, 404, { error: 'MEMORY.md not found' });
      return sendJSON(res, 200, root);
    }

    if (urlPath === '/api/memory/search' && method === 'GET') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const q = parsedUrl.searchParams.get('q') || '';
      if (!q || q.length < 2) return sendJSON(res, 400, { error: 'Query must be at least 2 characters' });
      const result = await searchMemory(q);
      return sendJSON(res, 200, result);
    }

    // GET /api/memory/facts — namespace stats (backward compat)
    if (urlPath === '/api/memory/facts' && method === 'GET') {
      const factsData = await getFacts();
      return sendJSON(res, 200, { namespaces: factsData, total: Array.isArray(factsData) ? factsData.reduce((s,n) => s + (n.count||0), 0) : 0 });
    }

    // GET /api/memory/facts/list — list all facts
    if (urlPath === '/api/memory/facts/list' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const namespace = url.searchParams.get('namespace') || '';
      const facts = await listFacts(namespace || null);
      return sendJSON(res, 200, { facts, total: facts.length });
    }

    // POST /api/memory/facts — add a fact
    if (urlPath === '/api/memory/facts' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.namespace || !body.subject || !body.predicate) {
        return sendJSON(res, 400, { error: 'namespace, subject, and predicate are required' });
      }
      const result = await addFact(body);
      return sendJSON(res, 200, result);
    }

    // DELETE /api/memory/facts — delete a fact
    if (urlPath === '/api/memory/facts' && method === 'DELETE') {
      const body = await parseBody(req);
      if (!body.namespace || !body.subject) {
        return sendJSON(res, 400, { error: 'namespace and subject are required' });
      }
      const result = await deleteFact(body);
      return sendJSON(res, 200, result);
    }

    // GET /api/memory/facts/search — search facts
    if (urlPath === '/api/memory/facts/search' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const query = url.searchParams.get('query') || '';
      const namespace = url.searchParams.get('namespace') || '';
      if (!query) return sendJSON(res, 400, { error: 'query parameter is required' });
      const facts = await searchFacts(query, namespace || null);
      return sendJSON(res, 200, { facts, total: facts.length });
    }

    if (urlPath === '/api/memory/status' && method === 'GET') {
      const status = await getMemoryStatus();
      return sendJSON(res, 200, status);
    }

    if (urlPath === '/api/memory/stats' && method === 'GET') {
      return sendJSON(res, 200, getMemoryStats());
    }

    // PUT /api/memory/file/:name — save/update a memory file
    if (urlPath.startsWith('/api/memory/file/') && method === 'PUT') {
      try {
        const name = decodeURIComponent(urlPath.replace('/api/memory/file/', ''));
        const safeName = basename(name);
        const filePath = join(MEMORY_DIR, safeName);
        // Only allow saving files that already exist
        if (!existsSync(filePath)) return sendJSON(res, 404, { error: 'File not found' });
        const body = await parseBody(req);
        if (typeof body.content !== 'string') return sendJSON(res, 400, { error: 'Missing content field' });
        writeFileSync(filePath, body.content, 'utf8');
        const stat = statSync(filePath);
        return sendJSON(res, 200, { name: safeName, saved: true, size: stat.size, lines: body.content.split('\n').length });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[memory-api]', err.message);
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🧠 Memory API running at http://127.0.0.1:${PORT}`);
});
