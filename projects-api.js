#!/usr/bin/env node
/**
 * Projects API Module
 * Extracted from task-server.js (routes for /api/projects)
 *
 * This module handles all project-related operations:
 * - List projects
 * - Get default project
 * - Get project by ID
 * - Create project
 * - Update project
 * - Archive/delete project
 */

/**
 * Projects API handler
 * @param {Object} req - Node.js request object
 * @param {Object} res - Node.js response object
 * @param {string} url - Request URL path
 * @param {string} method - HTTP method
 * @param {Object} body - Parsed request body (may be undefined for GET/DELETE)
 * @param {Object} context - Shared dependencies
 * @param {any} context.asanaStorage - Storage instance
 * @param {Function} context.sendJSON - Response helper
 * @param {Function} context.parseJSONBody - Body parser
 * @param {Function} context.buildProjectFilters - Filter builder
 * @param {Function} context.isTruthyQueryValue - Query value parser
 * @returns {Promise<boolean>} true if route was handled, false otherwise
 */
async function projectsAPI(req, res, url, method, requestBody, context) {
  const { asanaStorage, sendJSON, parseJSONBody, buildProjectFilters, isTruthyQueryValue } = context;

  if (!asanaStorage) {
    sendJSON(res, 503, { error: 'Asana storage not initialized' });
    return true;
  }

  try {
    // GET /api/projects
    if (url === '/api/projects' && method === 'GET') {
      const searchParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const filters = buildProjectFilters(searchParams);
      const includeMeta = isTruthyQueryValue(searchParams.get('include_meta'));
      if (includeMeta) {
        const result = await asanaStorage.listProjectsPage(filters);
        sendJSON(res, 200, result);
      } else {
        const projects = await asanaStorage.listProjects(filters);
        sendJSON(res, 200, projects);
      }
      return true;
    }

    // GET /api/projects/default
    if (url === '/api/projects/default' && method === 'GET') {
      const searchParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const filters = buildProjectFilters(searchParams);
      const project = await asanaStorage.getDefaultProject(filters);
      if (!project) {
        sendJSON(res, 404, { error: 'No projects available' });
        return true;
      }
      sendJSON(res, 200, project);
      return true;
    }

    // GET /api/projects/:id
    const projectIdMatch = url.match(/^\/api\/projects\/([^/]+)$/);
    if (projectIdMatch && method === 'GET') {
      const id = projectIdMatch[1];
      try {
        const project = await asanaStorage.getProjectView(id);
        sendJSON(res, 200, project);
      } catch (err) {
        sendJSON(res, 404, { error: err.message });
      }
      return true;
    }

    // POST /api/projects
    if (url === '/api/projects' && method === 'POST') {
      // Parse body if not already provided
      let data = requestBody;
      if (data === undefined || data === null) {
        data = await parseJSONBody(req);
      }
      const required = ['name'];
      for (const field of required) {
        if (!data[field]) {
          sendJSON(res, 400, { error: `Missing required field: ${field}` });
          return true;
        }
      }
      const project = await asanaStorage.createProject(data);
      sendJSON(res, 201, project);
      return true;
    }

    // PATCH /api/projects/:id
    if (projectIdMatch && method === 'PATCH') {
      const id = projectIdMatch[1];
      // Parse body if not already provided
      let data = requestBody;
      if (data === undefined || data === null) {
        data = await parseJSONBody(req);
      }
      try {
        const project = await asanaStorage.updateProject(id, data);
        sendJSON(res, 200, project);
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return true;
    }

    // DELETE /api/projects/:id
    if (projectIdMatch && method === 'DELETE') {
      const id = projectIdMatch[1];
      try {
        await asanaStorage.archiveProject(id);
        sendJSON(res, 200, { deleted: true, id });
      } catch (err) {
        const status = err.message.includes('not found') ? 404 : 400;
        sendJSON(res, status, { error: err.message });
      }
      return true;
    }
  } catch (err) {
    console.error('[projects-api] Request error:', err);
    sendJSON(res, 500, { error: 'Internal server error' });
    return true;
  }

  return false; // Route not handled by this module
}

module.exports = {
  projectsAPI
};
