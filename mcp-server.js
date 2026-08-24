#!/usr/bin/env node
'use strict';
/**
 * MCP server entry — `node mcp-server.js`
 *
 * Thin executable wrapper around lib/mcp-server.js (protocol core + tool
 * registry). Speaks newline-delimited JSON-RPC 2.0 over stdio so any MCP
 * client (OpenClaw, Claude Desktop, …) can spawn it locally; see
 * docs/mcp-server.md for registration.
 *
 * Environment:
 *   DASHBOARD_AUTH_TOKEN   required for data reads — operator's bearer token
 *                          for the task-server (never minted or proxied here)
 *   TASK_SERVER_URL        optional, default http://127.0.0.1:3876
 *   OPENCLAW_MCP_MUTATIONS reserved for slice 2 (mutating trio); inert today
 *
 * stdout carries protocol frames exclusively; logs go to stderr.
 */

const { createMcpServer, runStdio } = require('./lib/mcp-server');

const server = createMcpServer({ env: process.env });

runStdio(server)
  .then(() => {
    process.stderr.write('[mcp-server] stdin closed — exiting cleanly\n');
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write(`[mcp-server] fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
