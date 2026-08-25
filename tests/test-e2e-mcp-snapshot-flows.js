#!/usr/bin/env node
/**
 * End-to-end flow coverage: MCP stdio server + snapshot/restore flow.
 * (quality queue "e2e coverage" — MCP + snapshots after the actions flow.)
 *
 * What the existing suites do NOT cover, and this file does:
 *
 *   - tests/test-mcp-server.js drives the protocol through handleMessage/
 *     handleLine and one spawnSync framing round-trip with NO backend —
 *     no tools/call ever crosses real HTTP. Here the MCP server runs as a
 *     REAL child process (`node mcp-server.js`) pointed at a REAL HTTP
 *     backend (tests/fixtures/snapshot-harness.js serving the real
 *     snapshot routes), and an executed tools/call must round-trip
 *     child → stdio → loopback HTTP → disk registry → result frame.
 *   - tests/test-snapshot-routes.js covers route semantics over synthetic
 *     req/ctx capture objects. Here the same flow runs over real HTTP
 *     stream parsing, real status codes, and a real attachment download.
 *
 * Honest-degradation contract pinned (never forced onto a real database):
 * json_snapshot ships pool=null, so POST /api/snapshots,
 * /api/restore/preview (AFTER artifact validation) and /api/restore/apply
 * answer 503 {available:false, reason:'no_database'} — while registry
 * listing/download keep working disk-only.
 *
 * Run: node tests/test-e2e-mcp-snapshot-flows.js   (DB-free, self-contained)
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startSnapshotHarness, MARKERS } = require('./fixtures/snapshot-harness.js');
const { sha256Canonical } = require('../lib/snapshot-manifest');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'e2e-bearer-token-secret';

/**
 * Drive one real `node mcp-server.js` session over live stdio.
 *
 * Deliberately ASYNC spawn, never spawnSync: the harness HTTP server lives
 * in THIS process, and spawnSync blocks this event loop — the backend would
 * freeze mid-request and deadlock any tools/call against itself (observed:
 * connect succeeds from kernel backlog, request bytes never serviced).
 * Requests are written up front; JSON-RPC replies arrive in order; once all
 * replies are seen stdin is closed so the server takes its clean-shutdown
 * drain path, and the exit code is asserted 0.
 */
function mcpSession(envOverrides, requests, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'mcp-server.js')], {
      env: { ...process.env, DASHBOARD_AUTH_TOKEN: TOKEN, ...envOverrides },
    });
    const frames = [];
    let stdoutAll = '';
    let stderrAll = '';
    let buf = '';
    let finished = false;
    const fail = (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(err);
    };
    const timer = setTimeout(() => {
      fail(new Error(`mcp-session timeout after ${timeoutMs}ms; frames so far: ${JSON.stringify(frames)}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdoutAll += d;
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let frame;
        try { frame = JSON.parse(line); } catch (e) { fail(new Error(`non-JSON stdout frame: ${line}`)); return; }
        frames.push(frame);
        if (frames.length === requests.length && !finished) {
          finished = true;
          clearTimeout(timer);
          child.stdin.end(); // EOF → runStdio drain → clean exit
          child.on('close', (code) => {
            try {
              assert.strictEqual(code, 0, `mcp-server exit 0 (stderr: ${stderrAll})`);
              resolve({ frames, stdout: stdoutAll, stderr: stderrAll });
            } catch (err) { reject(err); }
          });
        }
      }
    });
    child.stderr.on('data', (d) => { stderrAll += d; });
    child.on('error', fail);
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
  });
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

async function run() {
  const harness = await startSnapshotHarness();
  let failures = 0;
  const step = (name, fn) => {
    try { fn(); console.log(`PASS ${name}`); } catch (err) { failures += 1; console.error(`FAIL ${name}\n  ${err.message}`); }
  };

  try {
    // ── [01] MCP flag-on: initialize → tools/list (13) → executed tools/call over real HTTP ──
    {
      const { frames, stdout } = await mcpSession(
        { TASK_SERVER_URL: harness.baseUrl, OPENCLAW_MCP_MUTATIONS: '1' },
        [
          rpc(1, 'initialize', {}),
          rpc(2, 'tools/list'),
          rpc(3, 'tools/call', { name: 'list_snapshots', arguments: {} }),
          rpc(4, 'ping'),
        ]
      );
      step('[01a] initialize pins protocol + serverInfo', () => {
        assert.strictEqual(frames[0].result.protocolVersion, '2024-11-05');
        assert.strictEqual(frames[0].result.serverInfo.name, 'openclaw-dashboard');
      });
      step('[01b] flag-on tools/list exposes all 13 tools incl. mutating trio', () => {
        const tools = frames[1].result.tools;
        assert.strictEqual(tools.length, 13);
        for (const name of ['create_task', 'update_task', 'create_snapshot']) {
          assert.ok(tools.some((t) => t.name === name), `${name} visible with flag on`);
        }
        assert.ok(tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object'));
      });
      step('[01c] tools/call list_snapshots round-trips child → HTTP → disk registry', () => {
        assert.ok(harness.requests.includes('GET /api/snapshots'), 'backend actually hit over HTTP');
        const frame = frames[2].result;
        assert.ok(!frame.isError);
        assert.strictEqual(frame.content[0].type, 'text');
        const payload = JSON.parse(frame.content[0].text);
        assert.ok(payload.available === true && payload.count >= 1);
        const entry = payload.snapshots.find((s) => s.snapshot_id === harness.artifact.manifest.snapshot_id);
        assert.ok(entry, 'seeded snapshot listed');
        assert.strictEqual(entry.name, 'e2e-seeded');
        assert.strictEqual(entry.total_rows, 3); // workflows 1 + tasks 2
        assert.strictEqual(entry.size_bytes, fs.statSync(harness.artifactFile).size, 'honest on-disk size');
      });
      step('[01d] ping answers after the call; bearer token never reaches stdout', () => {
        assert.deepStrictEqual(frames[3].result, {});
        assert.ok(!stdout.includes(TOKEN), 'token leaked to stdout');
      });
    }

    // ── [02] MCP flag-off: read-only profile is hidden-not-refused over real transport ──
    {
      const before = harness.requests.filter((r) => r.startsWith('POST')).length;
      const { frames } = await mcpSession(
        { TASK_SERVER_URL: harness.baseUrl },
        [
          rpc(1, 'initialize', {}),
          rpc(2, 'tools/list'),
          rpc(3, 'tools/call', { name: 'create_task', arguments: { title: 'x', project_id: 'p' } }),
          rpc(4, 'ping'),
        ]
      );
      step('[02a] flag-off tools/list hides the trio (10 tools)', () => {
        const tools = frames[1].result.tools;
        assert.strictEqual(tools.length, 10);
        for (const name of ['create_task', 'update_task', 'create_snapshot']) {
          assert.ok(!tools.some((t) => t.name === name), `${name} hidden with flag off`);
        }
      });
      step('[02b] tools/call create_task → -32601 method_not_found, zero backend writes', () => {
        assert.strictEqual(frames[2].error.code, -32601);
        assert.ok(/Method not found/.test(frames[2].error.message));
        const after = harness.requests.filter((r) => r.startsWith('POST')).length;
        assert.strictEqual(after, before, 'no POST reached the backend for a hidden tool');
      });
      step('[02c] loop survives the refusal (ping still answered)', () => {
        assert.deepStrictEqual(frames[3].result, {});
      });
    }

    // ── [03] MCP honest error propagation when the task-server is down ──
    {
      const { frames } = await mcpSession(
        { TASK_SERVER_URL: 'http://127.0.0.1:9' }, // discard port: connection refused
        [
          rpc(1, 'tools/call', { name: 'get_costs_summary', arguments: { days: 7 } }),
          rpc(2, 'ping'),
        ]
      );
      step('[03a] unreachable backend → isError frame with task_server_unreachable', () => {
        const frame = frames[0].result;
        assert.strictEqual(frame.isError, true, 'operational failure surfaces as isError tool result');
        const payload = JSON.parse(frame.content[0].text);
        assert.strictEqual(payload.error, 'task_server_unreachable');
        assert.ok(!payload.detail || !payload.detail.includes(TOKEN), 'no token in error detail');
      });
      step('[03b] server loop survives backend failure (ping answered, exit 0)', () => {
        assert.deepStrictEqual(frames[1].result, {});
      });
    }

    // ── [04] Snapshot create degrades honestly with ZERO writes ──
    {
      const filesBefore = fs.readdirSync(harness.snapshotsDir).sort();
      const res = await fetch(`${harness.baseUrl}/api/snapshots`, { method: 'POST', body: '{}' });
      const body = await res.json();
      step('[04] POST /api/snapshots → 503 no_database, nothing written to disk', () => {
        assert.strictEqual(res.status, 503);
        assert.deepStrictEqual(body, { available: false, reason: 'no_database' });
        assert.deepStrictEqual(fs.readdirSync(harness.snapshotsDir).sort(), filesBefore);
      });
    }

    // ── [05] Registry listing works disk-only ──
    {
      const res = await fetch(`${harness.baseUrl}/api/snapshots`);
      const body = await res.json();
      step('[05] GET /api/snapshots lists seeded artifact with manifest fields + honest size', () => {
        assert.strictEqual(res.status, 200);
        assert.strictEqual(body.available, true);
        assert.strictEqual(body.count, 1);
        const s = body.snapshots[0];
        assert.strictEqual(s.snapshot_id, harness.artifact.manifest.snapshot_id);
        assert.strictEqual(s.name, 'e2e-seeded');
        assert.ok(s.created_at, 'manifest created_at surfaced');
        assert.strictEqual(s.total_rows, 3);
        assert.strictEqual(s.size_bytes, fs.statSync(harness.artifactFile).size);
      });
    }

    // ── [06] Download returns byte-identical attachment ──
    {
      const id = harness.artifact.manifest.snapshot_id;
      const res = await fetch(`${harness.baseUrl}/api/snapshots/${id}/download`);
      const buf = Buffer.from(await res.arrayBuffer());
      step('[06] download streams the exact artifact bytes as an attachment', () => {
        assert.strictEqual(res.status, 200);
        const cd = res.headers.get('content-disposition') || '';
        assert.ok(cd.includes('attachment'), `content-disposition attachment (got: ${cd})`);
        assert.ok(cd.includes('e2e-seeded.json'));
        assert.strictEqual(Buffer.compare(buf, fs.readFileSync(harness.artifactFile)), 0);
      });
    }

    // ── [07] Preview: valid artifact passes integrity BEFORE the DB gate → 503 ──
    {
      const res = await fetch(`${harness.baseUrl}/api/restore/preview`, {
        method: 'POST',
        body: JSON.stringify({ artifact: harness.artifact }),
      });
      const body = await res.json();
      step('[07] preview of a valid artifact → 503 no_database (validation passed first)', () => {
        assert.strictEqual(res.status, 503);
        assert.deepStrictEqual(body, { available: false, reason: 'no_database' });
      });
    }

    // ── [08] Preview: tampered artifact dies at the integrity gate → 400 ──
    {
      const tampered = structuredClone(harness.artifact);
      tampered.tables.tasks[0].title = 'TAMPERED';
      const res = await fetch(`${harness.baseUrl}/api/restore/preview`, {
        method: 'POST',
        body: JSON.stringify({ artifact: tampered }),
      });
      const body = await res.json();
      step('[08] preview of a tampered artifact → 400 artifact_corrupt BEFORE any DB access', () => {
        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.error, 'artifact_corrupt');
      });
    }

    // ── [09] Preview: structurally invalid manifest → named 400 ──
    {
      const res = await fetch(`${harness.baseUrl}/api/restore/preview`, {
        method: 'POST',
        body: JSON.stringify({ artifact: { tables: {}, settings: {} } }),
      });
      const body = await res.json();
      step('[09] preview without a manifest → 400 invalid_manifest', () => {
        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.error, 'invalid_manifest');
      });
    }

    // ── [10] Apply refuses without a database, zero checkpoint writes ──
    {
      const res = await fetch(`${harness.baseUrl}/api/restore/apply`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'merge', restoreId: 'e2e_restore_1', artifact: harness.artifact }),
      });
      const body = await res.json();
      step('[10] apply → 503 no_database, no .resume.json checkpoint written', () => {
        assert.strictEqual(res.status, 503);
        assert.deepStrictEqual(body, { available: false, reason: 'no_database' });
        assert.ok(!fs.existsSync(path.join(harness.snapshotsDir, 'e2e_restore_1.resume.json')));
      });
    }

    // ── [11] Apply validates restoreId shape before anything else ──
    {
      const res = await fetch(`${harness.baseUrl}/api/restore/apply`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'merge', restoreId: '../evil', artifact: harness.artifact }),
      });
      const body = await res.json();
      step('[11] apply with unsafe restoreId → 400 missing_or_invalid_restore_id', () => {
        assert.strictEqual(res.status, 400);
        assert.strictEqual(body.error, 'missing_or_invalid_restore_id');
      });
    }

    // ── [12] Redaction invariant on the shipped bytes ──
    {
      const raw = fs.readFileSync(harness.artifactFile, 'utf8');
      const shipped = JSON.parse(raw);
      step('[12] artifact carries manifest; settings are config-source-only; secrets absent', () => {
        assert.ok(shipped.manifest && shipped.manifest.content_hash, 'manifest present in artifact');
        assert.deepStrictEqual(Object.keys(shipped.settings).sort(), ['accentColor', 'theme']);
        assert.ok(!raw.includes(MARKERS.passwordValue), 'password-type setting value never ships');
        assert.ok(!raw.includes('DASHBOARD_AUTH_TOKEN'), 'password-type key structurally absent');
        assert.ok(!raw.includes('REQUIRE_AUTH'), 'env-source keys excluded');
        assert.ok(!raw.includes(MARKERS.apiKeyCell), 'deny-regex cell value redacted');
        assert.ok(raw.includes('keyboard_hint') && raw.includes('Ctrl+K'), 'near-miss keys/values survive');
        assert.strictEqual(shipped.tables.workflows[0].metadata.api_key, '[REDACTED]');
      });
      step('[12b] content_hash describes exactly the shipped tables+settings bytes', () => {
        assert.strictEqual(
          sha256Canonical({ tables: shipped.tables, settings: shipped.settings }),
          shipped.manifest.content_hash
        );
      });
    }
  } finally {
    await harness.close();
  }

  if (failures > 0) {
    console.error(`\n${failures} check group(s) failed`);
    process.exit(1);
  }
  console.log('\nAll e2e MCP + snapshot flow checks passed.');
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
