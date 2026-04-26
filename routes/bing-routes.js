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

  // POST /api/bing/indexnow — Submit via IndexNow protocol
  router.add('POST', '/api/bing/indexnow', async (req, res) => {
    const body = await parseBody(req);
    const { host, urls } = body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return sendJSON(res, 400, { error: 'urls array required' });
    }

    const siteHost = host || '3dput.com';

    try {
      const resp = await fetch(INDEXNOW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: siteHost,
          key: apiKey,
          keyLocation: `https://${siteHost}/${apiKey}.txt`,
          urlList: urls,
        }),
      });

      const status = resp.status;
      let message = 'Unknown response';
      if (status === 200) message = 'URLs submitted successfully';
      else if (status === 202) message = 'URLs accepted for processing';
      else if (status === 400) message = 'Invalid request format';
      else if (status === 403) message = 'Invalid API key';
      else if (status === 429) message = 'Too many requests';
      else if (status === 500) message = 'Bing server error';

      sendJSON(res, status <= 202 ? 200 : status, {
        ok: status <= 202,
        status,
        message,
        submitted: urls.length,
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
