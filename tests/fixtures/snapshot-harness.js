'use strict';
/**
 * Snapshot/restore e2e harness — REAL snapshot routes over REAL HTTP, DB-free.
 *
 * Serves routes/router.js + routes/snapshot-routes.js over an ephemeral
 * http.Server (actions-harness pattern), with json_snapshot parity wiring:
 * ctx.asanaStorage = { pool: null }, so every database-gated path honestly
 * degrades to 503 {available:false, reason:'no_database'} while the
 * disk-only registry/download endpoints keep working.
 *
 * The harness seeds ONE artifact built through the REAL production pipeline
 * pieces (redactSettings → redactDeep → buildManifest), mirroring exactly
 * what createSnapshotArtifact() ships: config-source-only settings section,
 * deny-regex-redacted table cells, content_hash over the shipped bytes.
 *
 * Deliberately unauthenticated like actions-harness: bearer enforcement lives
 * in task-server auth wiring (covered by tests/test-auth-policy.js and the
 * live Playwright smoke), not inside registerSnapshotRoutes.
 *
 * Consumers: tests/test-e2e-mcp-snapshot-flows.js (and reusable by any future
 * Playwright spec needing the same boundary over request-context).
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Router = require('../../routes/router');
const { registerSnapshotRoutes } = require('../../routes/snapshot-routes');
const { buildManifest } = require('../../lib/snapshot-manifest');
const { redactDeep, redactSettings } = require('../../lib/snapshot-redact');

/** Marker secrets — asserted absent from every shipped byte downstream. */
const MARKERS = {
  passwordValue: 'hunter2-e2e-secret',
  apiKeyCell: 'sk-live-e2e-marker',
};

function fixtureSettingsStore() {
  return {
    getAll() {
      return {
        appearance: {
          theme: { value: 'dark', type: 'select', source: 'config' },
          accentColor: { value: '#60CDFF', type: 'string', source: 'config' },
        },
        general: {
          DASHBOARD_AUTH_TOKEN: { value: MARKERS.passwordValue, type: 'password', source: 'env' },
          REQUIRE_AUTH: { value: true, type: 'toggle', source: 'env' },
        },
      };
    },
  };
}

/**
 * Start the harness. Resolves once the server is listening.
 * @returns {Promise<{baseUrl: string, snapshotsDir: string, artifact: object,
 *                     artifactFile: string, requests: string[],
 *                     close: () => Promise<void>}>}
 */
function startSnapshotHarness() {
  const snapshotsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-'));
  const requests = [];

  // Seed one artifact through the same composition the route ships
  // (createSnapshotArtifact): structural exclusion → deny walk → manifest.
  const settingsStore = fixtureSettingsStore();
  const rowsByTable = {
    workflows: [{
      id: 'wf-e2e-1',
      name: 'nightly',
      metadata: { api_key: MARKERS.apiKeyCell, keyboard_hint: 'Ctrl+K' },
    }],
    tasks: [
      { id: 't-e2e-1', title: 'alpha' },
      { id: 't-e2e-2', title: 'beta' },
    ],
  };
  const migrationsApplied = ['001_add_workflow_runs'];
  const settings = redactDeep(redactSettings(settingsStore.getAll()));
  const tables = redactDeep(rowsByTable);
  const manifest = buildManifest(tables, settings, migrationsApplied, {
    name: 'e2e-seeded',
    generator: 'openclaw-project-webos snapshot-harness test',
  });
  const artifact = { manifest, tables, settings };
  const artifactFile = path.join(snapshotsDir, `${manifest.snapshot_id}.json`);
  fs.writeFileSync(artifactFile, JSON.stringify(artifact, null, 2));

  const router = new Router();
  registerSnapshotRoutes(router, { snapshotsDir, settingsStore });

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    requests.push(`${req.method} ${pathname}`);
    const ctx = {
      asanaStorage: { pool: null }, // json_snapshot parity: no database
      sendJSON(res2, status, body) {
        res2.writeHead(status, { 'Content-Type': 'application/json' });
        res2.end(JSON.stringify(body));
      },
    };
    try {
      const handled = await router.handle(req, res, pathname, req.method, ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'harness_error', message: String(err && err.message) }));
      } else {
        res.end();
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        snapshotsDir,
        artifact,
        artifactFile,
        requests,
        close: () => new Promise((done) => {
          server.close(() => {
            try { fs.rmSync(snapshotsDir, { recursive: true, force: true }); } catch { /* best effort */ }
            done();
          });
        }),
      });
    });
  });
}

module.exports = { startSnapshotHarness, MARKERS };
