/**
 * Bing Webmaster API Client
 *
 * Provides server-side proxy to Bing Webmaster Tools API.
 * Supports URL submission, quota checking, and IndexNow.
 */

const BING_API_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';
const INDEXNOW_URL = 'https://www.bing.com/indexnow';

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

/**
 * Register Bing Webmaster routes.
 * @param {object} router - Router instance
 * @param {string} apiKey - Bing Webmaster API key
 */
function registerBingRoutes(router, apiKey) {
  if (!apiKey) {
    console.log('⚠️  Bing Webmaster API key not configured');
    return;
  }

  // GET /api/bing/quota — Get URL submission quota
  router.add('GET', '/api/bing/quota', async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const siteUrl = url.searchParams.get('siteUrl') || 'https://3dput.com';

    try {
      const resp = await fetch(`${BING_API_BASE}/GetUrlSubmissionQuota?apikey=${apiKey}&siteUrl=${encodeURIComponent(siteUrl)}`);
      const data = await resp.json();
      sendJSON(res, 200, { ok: true, quota: data.d || data });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/bing/submit — Submit single URL
  router.add('POST', '/api/bing/submit', async (req, res) => {
    const body = await parseBody(req);
    const { siteUrl, url } = body;

    if (!url) return sendJSON(res, 400, { error: 'url required' });

    const site = siteUrl || 'https://3dput.com';

    try {
      const resp = await fetch(`${BING_API_BASE}/SubmitUrl?apikey=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'charset': 'utf-8' },
        body: JSON.stringify({ siteUrl: site, url }),
      });
      const data = await resp.json();
      sendJSON(res, 200, { ok: true, result: data });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/bing/submit-batch — Submit batch of URLs
  router.add('POST', '/api/bing/submit-batch', async (req, res) => {
    const body = await parseBody(req);
    const { siteUrl, urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return sendJSON(res, 400, { error: 'urls array required' });
    }
    if (urls.length > 500) {
      return sendJSON(res, 400, { error: 'Maximum 500 URLs per batch' });
    }

    const site = siteUrl || 'https://3dput.com';

    try {
      const resp = await fetch(`${BING_API_BASE}/SubmitUrlbatch?apikey=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'charset': 'utf-8' },
        body: JSON.stringify({ siteUrl: site, urlList: urls }),
      });
      const data = await resp.json();
      sendJSON(res, 200, { ok: true, submitted: urls.length, result: data });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // POST /api/bing/indexnow — Submit via IndexNow (proxied to WP plugin)
  router.add('POST', '/api/bing/indexnow', async (req, res) => {
    const body = await parseBody(req);
    const { urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return sendJSON(res, 400, { error: 'urls array required' });
    }

    try {
      // Use the WordPress IndexNow plugin which handles key file management
      const wpApiBase = process.env.WORDPRESS_API_URL || 'https://3dput.com/wp-json';
      const wpUser = process.env.WORDPRESS_USER || 'admin';
      const wpPass = process.env.WORDPRESS_APP_PASS || 'V2W3 GbQC Sbgj eeX7 9klH GHLS';
      const wpAuth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');

      const results = [];
      for (const url of urls) {
        const resp = await fetch(`${wpApiBase}/indexnow/v_1.0.3/submitUrl`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${wpAuth}`,
          },
          body: JSON.stringify({ url }),
        });
        const data = await resp.json().catch(() => ({}));
        results.push({ url, status: resp.status, error: data.error || '' });
      }

      const allOk = results.every(r => r.status === 200 && !r.error);
      const status = allOk ? 200 : 207;

      sendJSON(res, allOk ? 200 : 207, {
        ok: allOk,
        submitted: urls.length,
        results,
      });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/bing/status — Check API key validity
  router.add('GET', '/api/bing/status', async (req, res) => {
    try {
      const resp = await fetch(`${BING_API_BASE}/GetUrlSubmissionQuota?apikey=${apiKey}&siteUrl=https://3dput.com`);
      const data = await resp.json();
      sendJSON(res, 200, {
        ok: true,
        apiKeyConfigured: true,
        quota: data.d || data,
      });
    } catch (err) {
      sendJSON(res, 200, {
        ok: false,
        apiKeyConfigured: true,
        error: err.message,
      });
    }
  });

  console.log('✅ Bing Webmaster routes registered');
}

module.exports = { registerBingRoutes };
