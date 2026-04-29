/**
 * Minimal prefix-matching router for task-server.js
 *
 * Supports exact string matches and :param patterns:
 *   '/api/tasks/:id'  →  { id: 'abc123' }
 *   '/api/tasks'      →  exact match (no params)
 */
class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * List all registered routes (for API catalog).
   * @returns {Array<{method: string, path: string}>}
   */
  list() {
    return this.routes.map(r => ({ method: r.method, path: r.pattern }));
  }

  /**
   * Register a route.
   * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
   * @param {string} pattern - URL pattern, e.g. '/api/tasks/:id/move'
   * @param {function} handler - async (req, res, ctx, params) => handled (boolean)
   */
  add(method, pattern, handler) {
    this.routes.push({ method, pattern, handler });
  }

  /**
   * Try to match and dispatch a request.
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} url - URL pathname (no query string)
   * @param {string} method - HTTP method
   * @param {object} context - shared context (sendJSON, asanaStorage, etc.)
   * @returns {Promise<boolean>} true if a route handled the request
   */
  async handle(req, res, url, method, context) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = this._matchRoute(route.pattern, url);
      if (match) {
        req.params = match.params;
        return await route.handler(req, res, context, match.params);
      }
    }
    return false;
  }

  /**
   * Match a pattern against a URL.
   * Supports :param segments.
   * @param {string} pattern
   * @param {string} url
   * @returns {{ params: object } | null}
   */
  _matchRoute(pattern, url) {
    const patternParts = pattern.split('/');
    const urlParts = url.split('/');

    if (patternParts.length !== urlParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];
      const u = urlParts[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = u;
      } else if (p !== u) {
        return null;
      }
    }
    return { params };
  }
}

module.exports = Router;
