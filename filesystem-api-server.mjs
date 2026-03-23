#!/usr/bin/env node
/**
 * Filesystem API server — serves local-only filesystem data for the desktop views.
 * Runs on port 3880 alongside task-server (3876), cron-manager (3878), and memory-api (3879).
 *
 * Endpoints:
 *   GET /api/fs/list?path=...   — List directory contents with metadata
 *   GET /api/fs/file?path=...   — Read a file (text or base64 preview for binary files)
 *   PUT /api/fs/file            — Save or update a text file
 *   POST /api/fs/file           — Create a new text file
 *   POST /api/fs/mkdir          — Create a directory
 *   POST /api/fs/rename         — Rename or move a file/directory
 *   DELETE /api/fs/path         — Delete a file or empty directory
 *   GET /api/fs/search?q=...    — Search filenames and file contents with rg
 *   GET /api/fs/stat?path=...   — Fetch metadata for a single path
 */

import { promises as fs } from 'fs';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { isIP } from 'net';
import { promisify } from 'util';
import { resolve, relative, dirname, basename, extname, isAbsolute, sep, posix } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(execFile);

export const DEFAULT_FS_ROOT = process.env.OPENCLAW_FS_ROOT || '/root/.openclaw';
export const DEFAULT_FS_PORT = Number(process.env.FILESYSTEM_API_PORT || 3880);
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 50;
const ROOT_REAL_CACHE = new Map();

const SECRET_ASSIGNMENT_RE = /\b([A-Z0-9_]*?(?:API_KEY|SECRET|PASSWORD|TOKEN)[A-Z0-9_]*)\s*=/gi;
const PROTECTED_EXTENSIONS = new Set(['.pem', '.key', '.crt', '.p12']);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function parseHeaderHostname(value) {
  const rawValue = String(value || '').split(',')[0].trim();
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = rawValue.includes('://')
      ? new URL(rawValue)
      : new URL(`http://${rawValue}`);
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1') {
    return true;
  }

  return isIP(normalized) === 4 && normalized.startsWith('127.');
}

export function isAllowedCorsOrigin(origin, headers = {}) {
  if (!origin) {
    return true;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
    return false;
  }

  const originHostname = normalizeHostname(parsedOrigin.hostname);
  if (!originHostname) {
    return false;
  }

  if (isLoopbackHostname(originHostname)) {
    return true;
  }

  const forwardedHost = parseHeaderHostname(headers['x-forwarded-host']);
  const requestHost = parseHeaderHostname(headers.host);
  return originHostname === forwardedHost || originHostname === requestHost;
}

function buildCorsHeaders(req) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };

  const origin = req.headers.origin;
  if (!origin) {
    return headers;
  }

  if (!isAllowedCorsOrigin(origin, req.headers || {})) {
    throw createHttpError(403, 'CORS origin not allowed for filesystem API.');
  }

  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = 'GET, PUT, POST, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  headers['Vary'] = 'Origin';
  return headers;
}

function sendJSON(res, status, data, headers = {}) {
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        rejectBody(createHttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', rejectBody);
  });
}

function parseRequestedPath(value) {
  if (value == null || value === '') {
    return { normalized: '', isAbsolutePath: false };
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, 'path must be a string');
  }

  if (value.includes('\0')) {
    throw createHttpError(400, 'Path contains invalid null bytes');
  }

  const trimmed = value.replaceAll('\\', '/').trim();
  if (!trimmed || trimmed === '.' || trimmed === '/') {
    return { normalized: '', isAbsolutePath: false };
  }

  const isAbsolutePath = trimmed.startsWith('/');
  const normalized = posix.normalize(trimmed).replace(/\/+$/, '');
  if (normalized === '.' || normalized === '/') {
    return { normalized: '', isAbsolutePath: false };
  }

  return { normalized, isAbsolutePath };
}

function toClientPath(pathValue) {
  const normalized = String(pathValue || '').split(sep).join('/');
  return normalized === '.' ? '' : normalized;
}

function getParentPath(pathValue) {
  if (!pathValue) {
    return null;
  }

  const parentPath = posix.dirname(pathValue);
  return parentPath === '.' ? '' : parentPath;
}

function isWithinRoot(rootReal, candidatePath) {
  const pathRelative = relative(rootReal, candidatePath);
  return pathRelative === '' || (!pathRelative.startsWith('..') && !isAbsolute(pathRelative));
}

export function getProtectedPathReason(relativePath) {
  const normalized = String(relativePath || '').toLowerCase();
  if (!normalized) {
    return '';
  }

  const parts = normalized.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || '';

  if (parts.includes('.git')) {
    return '.git paths are read-only';
  }

  if (parts.includes('credentials')) {
    return 'credentials paths are read-only';
  }

  const browserIndex = parts.indexOf('browser');
  if (browserIndex !== -1 && parts.slice(browserIndex + 1).includes('user-data')) {
    return 'browser user-data paths are read-only';
  }

  if (name === '.env') {
    return '.env files are read-only';
  }

  if (name === 'openclaw.json') {
    return 'openclaw.json is read-only';
  }

  if (PROTECTED_EXTENSIONS.has(extname(name))) {
    return `${extname(name)} credential files are read-only`;
  }

  return '';
}

function countLines(content) {
  return String(content ?? '').split('\n').length;
}

function requirePath(value, field = 'path') {
  if (typeof value !== 'string' || !value.trim()) {
    throw createHttpError(400, `${field} is required`);
  }
  return value;
}

function isBinaryBuffer(buffer) {
  return buffer.indexOf(0) !== -1;
}

async function readChunk(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function getFilePreviewBuffer(filePath, size) {
  if (size > MAX_FILE_BYTES) {
    return readChunk(filePath, MAX_FILE_BYTES);
  }

  return fs.readFile(filePath);
}

async function detectTextFile(filePath, size) {
  if (!size) {
    return true;
  }

  const head = await readChunk(filePath, Math.min(4096, size));
  return !isBinaryBuffer(head);
}

function scanSecrets(content) {
  const matches = new Set();
  for (const match of content.matchAll(SECRET_ASSIGNMENT_RE)) {
    if (match[1]) {
      matches.add(match[1].toUpperCase());
    }
  }
  return Array.from(matches);
}

async function resolvePath(rootReal, inputPath, options = {}) {
  const { allowMissing = false, allowRoot = true } = options;
  const parsed = parseRequestedPath(inputPath);
  const candidatePath = parsed.normalized
    ? (parsed.isAbsolutePath ? resolve(parsed.normalized) : resolve(rootReal, parsed.normalized))
    : rootReal;

  if (!allowRoot && candidatePath === rootReal) {
    throw createHttpError(400, 'The filesystem root cannot be modified');
  }

  if (!isWithinRoot(rootReal, candidatePath)) {
    throw createHttpError(403, 'Requested path escapes the configured root');
  }

  try {
    const realPath = await fs.realpath(candidatePath);
    if (!isWithinRoot(rootReal, realPath)) {
      throw createHttpError(403, 'Resolved path escapes the configured root');
    }

    if (!allowRoot && realPath === rootReal) {
      throw createHttpError(400, 'The filesystem root cannot be modified');
    }

    return {
      absolutePath: realPath,
      relativePath: toClientPath(relative(rootReal, realPath)),
      exists: true,
    };
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }

    if (!allowMissing || error?.code !== 'ENOENT') {
      if (error?.code === 'ENOENT') {
        throw createHttpError(404, 'Path not found');
      }
      throw error;
    }

    let parentRealPath;
    try {
      parentRealPath = await fs.realpath(dirname(candidatePath));
    } catch (parentError) {
      if (parentError?.code === 'ENOENT') {
        throw createHttpError(404, 'Parent directory not found');
      }
      throw parentError;
    }

    if (!isWithinRoot(rootReal, parentRealPath)) {
      throw createHttpError(403, 'Requested path escapes the configured root');
    }

    return {
      absolutePath: candidatePath,
      relativePath: toClientPath(relative(rootReal, candidatePath)),
      exists: false,
    };
  }
}

async function buildStatPayload(rootReal, inputPath) {
  const resolved = await resolvePath(rootReal, inputPath);
  const stat = await fs.stat(resolved.absolutePath);
  const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
  const isText = type === 'file' ? await detectTextFile(resolved.absolutePath, stat.size) : false;
  const isProtected = Boolean(getProtectedPathReason(resolved.relativePath));

  return {
    name: basename(resolved.absolutePath) || basename(rootReal),
    path: resolved.relativePath,
    parent: getParentPath(resolved.relativePath),
    type,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    isText,
    isProtected,
    readOnly: type === 'file' ? (isProtected || !isText) : isProtected,
  };
}

async function listDirectory(rootReal, inputPath = '') {
  const resolved = await resolvePath(rootReal, inputPath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isDirectory()) {
    throw createHttpError(400, 'Path is not a directory');
  }

  const entries = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (entry) => {
    const childPath = resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name;

    try {
      return await buildStatPayload(rootReal, childPath);
    } catch (error) {
      if (error?.statusCode === 403 || error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }));

  return {
    path: resolved.relativePath,
    parent: getParentPath(resolved.relativePath),
    items: items
      .filter(Boolean)
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'directory' ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
      }),
  };
}

async function readFilePayload(rootReal, inputPath) {
  const resolved = await resolvePath(rootReal, inputPath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) {
    throw createHttpError(400, 'Path is not a file');
  }

  const isText = await detectTextFile(resolved.absolutePath, stat.size);
  const buffer = await getFilePreviewBuffer(resolved.absolutePath, stat.size);
  const truncated = stat.size > MAX_FILE_BYTES;
  const isProtected = Boolean(getProtectedPathReason(resolved.relativePath));
  const warning = truncated
    ? `File exceeds ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB. Returned content is truncated and read-only.`
    : (!isText ? 'Binary file returned as base64 and opened read-only.' : '');

  if (!isText) {
    return {
      path: resolved.relativePath,
      name: basename(resolved.absolutePath),
      content: buffer.toString('base64'),
      encoding: 'base64',
      size: stat.size,
      lines: 0,
      isText: false,
      modified: stat.mtime.toISOString(),
      truncated,
      warning: warning || undefined,
      isProtected,
      readOnly: true,
    };
  }

  const content = buffer.toString('utf8');
  return {
    path: resolved.relativePath,
    name: basename(resolved.absolutePath),
    content,
    encoding: 'utf8',
    size: stat.size,
    lines: countLines(content),
    isText: true,
    modified: stat.mtime.toISOString(),
    truncated,
    warning: warning || undefined,
    isProtected,
    readOnly: isProtected || truncated,
  };
}

function assertWritablePath(relativePath) {
  const protectionReason = getProtectedPathReason(relativePath);
  if (protectionReason) {
    throw createHttpError(403, `Writes are blocked for protected path "${relativePath || '/'}": ${protectionReason}`);
  }
}

async function writeFilePayload(rootReal, inputPath, content, options = {}) {
  const { createOnly = false } = options;
  requirePath(inputPath);
  if (typeof content !== 'string') {
    throw createHttpError(400, 'content must be a string');
  }

  if (content.includes('\0')) {
    throw createHttpError(400, 'Binary content is not allowed');
  }

  const byteSize = Buffer.byteLength(content, 'utf8');
  if (byteSize > MAX_FILE_BYTES) {
    throw createHttpError(413, 'File content exceeds the 2MB write limit');
  }

  const resolved = await resolvePath(rootReal, inputPath, { allowMissing: true, allowRoot: false });
  assertWritablePath(resolved.relativePath);

  if (resolved.exists) {
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) {
      throw createHttpError(400, 'Path is not a writable file');
    }
    if (createOnly) {
      throw createHttpError(409, 'File already exists');
    }
  }

  const secretMatches = scanSecrets(content);
  await fs.writeFile(resolved.absolutePath, content, 'utf8');
  const savedStat = await fs.stat(resolved.absolutePath);

  if (secretMatches.length) {
    console.warn(`[filesystem-api] Secret-like assignment saved in ${resolved.relativePath}: ${secretMatches.join(', ')}`);
  }

  const warning = secretMatches.length
    ? `Saved with secret-scan warning: detected ${secretMatches.join(', ')} assignment${secretMatches.length === 1 ? '' : 's'}.`
    : undefined;

  return {
    path: resolved.relativePath,
    saved: true,
    size: savedStat.size,
    lines: countLines(content),
    modified: savedStat.mtime.toISOString(),
    warning,
  };
}

async function makeDirectory(rootReal, inputPath) {
  requirePath(inputPath);
  const resolved = await resolvePath(rootReal, inputPath, { allowMissing: true, allowRoot: false });
  assertWritablePath(resolved.relativePath);

  if (resolved.exists) {
    throw createHttpError(409, 'Path already exists');
  }

  await fs.mkdir(resolved.absolutePath);
  const stat = await fs.stat(resolved.absolutePath);

  return {
    path: resolved.relativePath,
    created: true,
    type: 'directory',
    modified: stat.mtime.toISOString(),
  };
}

async function renamePath(rootReal, inputPath, nextPath) {
  requirePath(inputPath);
  requirePath(nextPath, 'newPath');
  const source = await resolvePath(rootReal, inputPath, { allowRoot: false });
  const destination = await resolvePath(rootReal, nextPath, { allowMissing: true, allowRoot: false });

  assertWritablePath(source.relativePath);
  assertWritablePath(destination.relativePath);

  if (destination.exists) {
    throw createHttpError(409, 'Destination already exists');
  }

  await fs.rename(source.absolutePath, destination.absolutePath);
  const stat = await fs.stat(destination.absolutePath);

  return {
    path: destination.relativePath,
    previousPath: source.relativePath,
    renamed: true,
    type: stat.isDirectory() ? 'directory' : 'file',
    modified: stat.mtime.toISOString(),
  };
}

async function deletePath(rootReal, inputPath) {
  requirePath(inputPath);
  const resolved = await resolvePath(rootReal, inputPath, { allowRoot: false });
  assertWritablePath(resolved.relativePath);

  const stat = await fs.stat(resolved.absolutePath);
  if (stat.isDirectory()) {
    try {
      await fs.rmdir(resolved.absolutePath);
    } catch (error) {
      if (error?.code === 'ENOTEMPTY') {
        throw createHttpError(400, 'Directory is not empty');
      }
      throw error;
    }
  } else if (stat.isFile()) {
    await fs.unlink(resolved.absolutePath);
  } else {
    throw createHttpError(400, 'Unsupported filesystem entry');
  }

  return {
    path: resolved.relativePath,
    deleted: true,
  };
}

async function searchFileNames(rootReal, searchPath, query) {
  try {
    const { stdout } = await execAsync('rg', ['--files', '--hidden', searchPath || '.'], {
      cwd: rootReal,
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const queryLower = query.toLowerCase();
    return stdout
      .split('\n')
      .filter(Boolean)
      .filter((filePath) => filePath.toLowerCase().includes(queryLower))
      .slice(0, MAX_SEARCH_RESULTS)
      .map((filePath) => ({
        type: 'name',
        path: toClientPath(filePath),
        name: basename(filePath),
        preview: basename(filePath),
      }));
  } catch (error) {
    if (error?.code === 1) {
      return [];
    }
    if (error?.code === 'ENOENT') {
      throw createHttpError(500, 'ripgrep (rg) is required for filesystem search');
    }
    throw error;
  }
}

async function searchFileContents(rootReal, searchPath, query) {
  try {
    const { stdout } = await execAsync('rg', [
      '--json',
      '--line-number',
      '--column',
      '--smart-case',
      '--max-filesize',
      '2M',
      '--hidden',
      query,
      searchPath || '.',
    ], {
      cwd: rootReal,
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    });

    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((record) => record?.type === 'match')
      .slice(0, MAX_SEARCH_RESULTS)
      .map((record) => {
        const resultPath = toClientPath(record.data?.path?.text || '');
        const submatch = record.data?.submatches?.[0];
        return {
          type: 'content',
          path: resultPath,
          name: basename(resultPath),
          line: record.data?.line_number || null,
          column: Number.isFinite(submatch?.start) ? submatch.start + 1 : null,
          preview: String(record.data?.lines?.text || '').trim().slice(0, 240),
        };
      });
  } catch (error) {
    if (error?.code === 1) {
      return [];
    }
    if (error?.code === 'ENOENT') {
      throw createHttpError(500, 'ripgrep (rg) is required for filesystem search');
    }
    throw error;
  }
}

async function searchFilesystem(rootReal, query, inputPath = '') {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    throw createHttpError(400, 'q parameter is required');
  }

  const resolved = await resolvePath(rootReal, inputPath);
  const [nameMatches, contentMatches] = await Promise.all([
    searchFileNames(rootReal, resolved.relativePath, trimmedQuery),
    searchFileContents(rootReal, resolved.relativePath, trimmedQuery),
  ]);

  const seen = new Set();
  const results = [];

  [...nameMatches, ...contentMatches].forEach((result) => {
    const key = `${result.type}:${result.path}:${result.line || 0}:${result.column || 0}`;
    if (seen.has(key) || results.length >= MAX_SEARCH_RESULTS) {
      return;
    }

    seen.add(key);
    results.push(result);
  });

  return {
    query: trimmedQuery,
    path: resolved.relativePath,
    results,
    total: results.length,
  };
}

export async function resolveFilesystemRoot(rootPath = DEFAULT_FS_ROOT) {
  const configuredRoot = resolve(rootPath);

  let cached = ROOT_REAL_CACHE.get(configuredRoot);
  if (!cached) {
    cached = fs.realpath(configuredRoot)
      .catch((error) => {
        ROOT_REAL_CACHE.delete(configuredRoot);
        if (error?.code === 'ENOENT') {
          throw createHttpError(500, `Filesystem root does not exist: ${configuredRoot}`);
        }
        throw error;
      });
    ROOT_REAL_CACHE.set(configuredRoot, cached);
  }

  return cached;
}

function shouldParseRequestBody(pathname, method) {
  if (method === 'PUT' && pathname === '/api/fs/file') {
    return true;
  }

  if (method === 'POST' && (pathname === '/api/fs/file' || pathname === '/api/fs/mkdir' || pathname === '/api/fs/rename')) {
    return true;
  }

  return method === 'DELETE' && pathname === '/api/fs/path';
}

async function dispatchFilesystemRequest(rootReal, requestUrl, method, body = {}) {
  const pathname = requestUrl.pathname;

  if (pathname === '/api/fs/list' && method === 'GET') {
    return { status: 200, payload: await listDirectory(rootReal, requestUrl.searchParams.get('path') || '') };
  }

  if (pathname === '/api/fs/file' && method === 'GET') {
    return { status: 200, payload: await readFilePayload(rootReal, requestUrl.searchParams.get('path') || '') };
  }

  if (pathname === '/api/fs/file' && method === 'PUT') {
    return { status: 200, payload: await writeFilePayload(rootReal, body.path, body.content) };
  }

  if (pathname === '/api/fs/file' && method === 'POST') {
    return { status: 201, payload: await writeFilePayload(rootReal, body.path, body.content, { createOnly: true }) };
  }

  if (pathname === '/api/fs/mkdir' && method === 'POST') {
    return { status: 201, payload: await makeDirectory(rootReal, body.path) };
  }

  if (pathname === '/api/fs/rename' && method === 'POST') {
    if (!body.path || !body.newPath) {
      throw createHttpError(400, 'path and newPath are required');
    }
    return { status: 200, payload: await renamePath(rootReal, body.path, body.newPath) };
  }

  if (pathname === '/api/fs/path' && method === 'DELETE') {
    return { status: 200, payload: await deletePath(rootReal, body.path) };
  }

  if (pathname === '/api/fs/search' && method === 'GET') {
    return {
      status: 200,
      payload: await searchFilesystem(rootReal, requestUrl.searchParams.get('q') || '', requestUrl.searchParams.get('path') || ''),
    };
  }

  if (pathname === '/api/fs/stat' && method === 'GET') {
    return { status: 200, payload: await buildStatPayload(rootReal, requestUrl.searchParams.get('path') || '') };
  }

  return { status: 404, payload: { error: 'Not found' } };
}

export async function handleFilesystemApiRequest({ rootPath = DEFAULT_FS_ROOT, url = '/', method = 'GET', body = {} } = {}) {
  const rootReal = await resolveFilesystemRoot(rootPath);
  const requestUrl = new URL(url || '/', 'http://127.0.0.1');
  return dispatchFilesystemRequest(rootReal, requestUrl, method || 'GET', body || {});
}

export async function createFilesystemServer({ rootPath = DEFAULT_FS_ROOT } = {}) {
  const rootReal = await resolveFilesystemRoot(rootPath);

  return createServer(async (req, res) => {
    let headers;
    try {
      headers = buildCorsHeaders(req);
    } catch (error) {
      console.warn(
        `[filesystem-api] ${req.method || 'GET'} ${req.url || '/'} CORS rejected`,
        `origin=${req.headers?.origin || '-'}`,
        `host=${req.headers?.host || '-'}`,
        `x-forwarded-host=${req.headers?.['x-forwarded-host'] || '-'}`
      );
      sendJSON(res, error.statusCode || 403, { error: error.message }, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const method = req.method || 'GET';
      const body = shouldParseRequestBody(requestUrl.pathname, method) ? await parseBody(req) : {};
      const result = await dispatchFilesystemRequest(rootReal, requestUrl, method, body);
      sendJSON(res, result.status, result.payload, headers);
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      const requestContext = `${req.method || 'GET'} ${req.url || '/'}`;
      if (statusCode >= 500) {
        console.error(`[filesystem-api] ${requestContext}`, error.stack || error.message);
      } else {
        console.warn(`[filesystem-api] ${requestContext}`, error.message);
      }
      sendJSON(res, statusCode, { error: error.message }, headers);
    }
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  const server = await createFilesystemServer();
  server.listen(DEFAULT_FS_PORT, '127.0.0.1', () => {
    console.log(`📁 Filesystem API running at http://127.0.0.1:${DEFAULT_FS_PORT}`);
  });
}
