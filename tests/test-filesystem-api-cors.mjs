#!/usr/bin/env node

import assert from 'assert/strict';
import { isAllowedCorsOrigin } from '../filesystem-api-server.mjs';

function run() {
  assert.equal(
    isAllowedCorsOrigin('http://localhost:18789', {}),
    true,
    'localhost origins should be allowed'
  );

  assert.equal(
    isAllowedCorsOrigin('http://[::1]:18789', {}),
    true,
    'IPv6 loopback origins should be allowed'
  );

  assert.equal(
    isAllowedCorsOrigin('https://dashboard.example.test:18789', {
      'x-forwarded-host': 'dashboard.example.test:18789',
    }),
    true,
    'same-origin requests forwarded through a proxy should be allowed'
  );

  assert.equal(
    isAllowedCorsOrigin('https://dashboard.example.test:18789', {
      host: 'dashboard.example.test:3880',
    }),
    true,
    'same-host proxy requests should be allowed even when the backend port differs'
  );

  assert.equal(
    isAllowedCorsOrigin('https://evil.example.test', {
      host: '127.0.0.1:3880',
    }),
    false,
    'unrelated origins should be rejected'
  );

  assert.equal(
    isAllowedCorsOrigin('null', {}),
    false,
    'opaque browser origins should be rejected'
  );

  console.log('PASS: filesystem api CORS origin rules');
}

try {
  run();
} catch (error) {
  console.error('FAIL: filesystem api CORS origin rules');
  console.error(error);
  process.exit(1);
}
