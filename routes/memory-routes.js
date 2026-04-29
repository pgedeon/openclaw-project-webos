/**
 * Memory API proxy routes
 *
 * Proxies /api/memory/* requests to the memory-api-server on port 3879
 * so all dashboard traffic goes through the same origin and auth middleware.
 */

const http = require('http');

const MEMORY_PORT = parseInt(process.env.MEMORY_API_PORT || '3879', 10);
const MEMORY_HOST = '127.0.0.1';

function proxyToMemory(req, res, urlPath) {
  return new Promise((resolve) => {
    const proxyReq = http.request(
      {
        hostname: MEMORY_HOST,
        port: MEMORY_PORT,
        path: urlPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${MEMORY_HOST}:${MEMORY_PORT}`,
        },
      },
      (proxyRes) => {
        proxyRes.headers['access-control-allow-origin'] =
          `http://localhost:${process.env.PORT || 3876}`;
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
        proxyRes.on('end', () => resolve(true));
      }
    );

    proxyReq.on('error', (err) => {
      console.error('[memory-proxy] upstream error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Memory API unavailable', detail: err.message }));
      resolve(true);
    });

    req.pipe(proxyReq, { end: true });
  });
}

function qs(req) {
  return (req.url || '').split('?')[1] || '';
}

function registerMemoryRoutes(router) {
  // Security: scrub sensitive patterns from memory content
  const SECRET_PATTERNS = [
    /(?:password|passwd|pwd|secret|token|api[_-]?key|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"]?([\w\-]{8,})['"]?/gi,
    /Bearer\s+[\w\-]{20,}/gi,
    /(?:sk|pk|ak|ghp|gho|ghs|ghu|github_pat)_[\w]{20,}/gi,
    /[\w.-]+@[\w.-]+\.[a-z]{2,}/gi,
  ];

  function scrubContent(content) {
    if (typeof content !== 'string') return content;
    let cleaned = content;
    for (const pattern of SECRET_PATTERNS) {
      cleaned = cleaned.replace(pattern, (match) => match.slice(0, 4) + '***REDACTED***');
    }
    return cleaned;
  }

  // ── GET routes ──────────────────────────────────────────

  router.add('GET', '/api/memory/list', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/list');
  });

  router.add('GET', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  router.add('GET', '/api/memory/root', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/root');
  });

  router.add('GET', '/api/memory/search', async (req, res) => {
    return proxyToMemory(req, res, `/api/memory/search?${qs(req)}`);
  });

  router.add('GET', '/api/memory/facts', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });

  router.add('GET', '/api/memory/facts/list', async (req, res) => {
    return proxyToMemory(req, res, `/api/memory/facts/list?${qs(req)}`);
  });

  router.add('GET', '/api/memory/facts/search', async (req, res) => {
    return proxyToMemory(req, res, `/api/memory/facts/search?${qs(req)}`);
  });

  router.add('GET', '/api/memory/status', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/status');
  });

  router.add('GET', '/api/memory/stats', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/stats');
  });

  // GET /api/memory/context — assembled prompt context
  router.add('GET', '/api/memory/context', async (req, res) => {
    return proxyToMemory(req, res, `/api/memory/context?${qs(req)}`);
  });

  // ── PUT routes ──────────────────────────────────────────

  router.add('PUT', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  // ── POST routes (more specific patterns first) ──────────

  router.add('POST', '/api/memory/file/:name/append', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}/append`);
  });

  router.add('POST', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  router.add('POST', '/api/memory/facts', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });

  // ── DELETE routes ───────────────────────────────────────

  router.add('DELETE', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  router.add('DELETE', '/api/memory/facts', async (req, res) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });
}

module.exports = { registerMemoryRoutes };
