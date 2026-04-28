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
  return new Promise((resolve, reject) => {
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
        // Inject CORS header for dashboard origin
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

    // Pipe request body through
    req.pipe(proxyReq, { end: true });
  });
}

function registerMemoryRoutes(router) {
  // GET /api/memory/*
  router.add('GET', '/api/memory/list', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/list');
  });

  router.add('GET', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  router.add('GET', '/api/memory/root', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/root');
  });

  router.add('GET', '/api/memory/search', async (req, res, ctx) => {
    const qs = (req.url || '').split('?')[1] || '';
    return proxyToMemory(req, res, `/api/memory/search?${qs}`);
  });

  router.add('GET', '/api/memory/facts', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });

  router.add('GET', '/api/memory/facts/list', async (req, res, ctx) => {
    const qs = (req.url || '').split('?')[1] || '';
    return proxyToMemory(req, res, `/api/memory/facts/list?${qs}`);
  });

  router.add('GET', '/api/memory/facts/search', async (req, res, ctx) => {
    const qs = (req.url || '').split('?')[1] || '';
    return proxyToMemory(req, res, `/api/memory/facts/search?${qs}`);
  });

  router.add('GET', '/api/memory/status', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/status');
  });

  router.add('GET', '/api/memory/stats', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/stats');
  });

  // PUT /api/memory/file/:name
  router.add('PUT', '/api/memory/file/:name', async (req, res, ctx, params) => {
    return proxyToMemory(req, res, `/api/memory/file/${params.name}`);
  });

  // POST /api/memory/facts
  router.add('POST', '/api/memory/facts', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });

  // DELETE /api/memory/facts
  router.add('DELETE', '/api/memory/facts', async (req, res, ctx) => {
    return proxyToMemory(req, res, '/api/memory/facts');
  });
}

module.exports = { registerMemoryRoutes };
