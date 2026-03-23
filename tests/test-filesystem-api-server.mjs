#!/usr/bin/env node

import assert from 'assert/strict';
import os from 'os';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { handleFilesystemApiRequest } from '../filesystem-api-server.mjs';

async function run() {
  const rootDir = await mkdtemp(join(os.tmpdir(), 'openclaw-fs-api-'));

  async function request(pathname, { method = 'GET', body = {} } = {}) {
    try {
      return await handleFilesystemApiRequest({
        rootPath: rootDir,
        url: pathname,
        method,
        body,
      });
    } catch (error) {
      return {
        status: error?.statusCode || 500,
        payload: { error: error.message },
      };
    }
  }

  try {
    await mkdir(join(rootDir, 'backend', 'src'), { recursive: true });
    await mkdir(join(rootDir, '.git'), { recursive: true });
    await writeFile(join(rootDir, 'AGENTS.md'), '# root agent instructions\n', 'utf8');
    await writeFile(join(rootDir, 'backend', 'src', 'notes.txt'), 'alpha\nneedle here\nomega\n', 'utf8');
    await writeFile(join(rootDir, 'backend', 'src', 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await writeFile(join(rootDir, '.env'), 'SECRET=value\n', 'utf8');

    const listResult = await request('/api/fs/list?path=backend/src');
    assert.equal(listResult.status, 200, 'list should succeed');
    assert.ok(
      listResult.payload.items.some((item) => item.name === 'notes.txt' && item.isText === true),
      'list should mark text files as editable text'
    );
    assert.ok(
      listResult.payload.items.some((item) => item.name === 'binary.bin' && item.isText === false),
      'list should mark binary files as non-text'
    );

    const readResult = await request('/api/fs/file?path=backend/src/notes.txt');
    assert.equal(readResult.status, 200, 'text file read should succeed');
    assert.equal(readResult.payload.encoding, 'utf8');
    assert.equal(readResult.payload.content, 'alpha\nneedle here\nomega\n');

    const rootRead = await request('/api/fs/file?path=AGENTS.md');
    assert.equal(rootRead.status, 200, 'root-level text file read should succeed');
    assert.equal(rootRead.payload.path, 'AGENTS.md');
    assert.equal(rootRead.payload.name, 'AGENTS.md');
    assert.equal(rootRead.payload.content, '# root agent instructions\n');

    const binaryRead = await request('/api/fs/file?path=backend/src/binary.bin');
    assert.equal(binaryRead.status, 200, 'binary file read should succeed');
    assert.equal(binaryRead.payload.isText, false);
    assert.equal(binaryRead.payload.encoding, 'base64');
    assert.equal(binaryRead.payload.readOnly, true);

    const protectedWrite = await request('/api/fs/file', {
      method: 'PUT',
      body: { path: '.env', content: 'TOKEN=next\n' },
    });
    assert.equal(protectedWrite.status, 403, 'protected writes should be blocked');

    const traversalAttempt = await request('/api/fs/stat?path=../outside');
    assert.equal(traversalAttempt.status, 403, 'path traversal should be rejected');

    const createFile = await request('/api/fs/file', {
      method: 'POST',
      body: { path: 'backend/src/new-file.txt', content: 'draft\n' },
    });
    assert.equal(createFile.status, 201, 'new file create should return 201');
    assert.equal(createFile.payload.saved, true);

    const secretSave = await request('/api/fs/file', {
      method: 'PUT',
      body: { path: 'backend/src/new-file.txt', content: 'API_KEY=value\n' },
    });
    assert.equal(secretSave.status, 200, 'secret scan save should still succeed');
    assert.match(secretSave.payload.warning || '', /secret-scan warning/i);

    const searchResult = await request('/api/fs/search?q=needle&path=backend');
    assert.equal(searchResult.status, 200, 'search should succeed');
    assert.ok(
      searchResult.payload.results.some((result) => result.path === 'backend/src/notes.txt' && result.type === 'content'),
      'search should return content matches'
    );

    console.log('PASS: filesystem api server');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error('FAIL: filesystem api server');
  console.error(error);
  process.exit(1);
});
