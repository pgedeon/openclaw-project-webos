#!/usr/bin/env node
/**
 * Saved Views API Test
 * Run: node tests/test-saved-views-api.js [project_id]
 *
 * Requires the task server to be running on http://localhost:3876
 */

const http = require('http');

const BASE = 'http://localhost:3876';
const PROJECT_ID = process.argv[2] || '';

if (!PROJECT_ID) {
  console.error('Usage: node tests/test-saved-views-api.js <project_id>');
  process.exit(1);
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log(`Testing Saved Views API with project_id=${PROJECT_ID}`);
  let viewId = null;

  // 1. Create a saved view
  console.log('\n1. POST /api/views');
  const createRes = await request('POST', '/api/views', {
    project_id: PROJECT_ID,
    name: 'My Saved View',
    filters: { filter: 'pending', search: '', categoryFilter: 'all', sort: 'newest' },
    sort: 'newest',
    created_by: 'test'
  });
  console.log('Status:', createRes.status);
  console.log('Response:', JSON.stringify(createRes.body, null, 2));
  if (createRes.status === 201) {
    viewId = createRes.body.id;
    console.log('Created view ID:', viewId);
  }

  // 2. List saved views
  console.log('\n2. GET /api/views?project_id=' + PROJECT_ID);
  const listRes = await request('GET', `/api/views?project_id=${PROJECT_ID}`);
  console.log('Status:', listRes.status);
  console.log('Count:', Array.isArray(listRes.body) ? listRes.body.length : 'N/A');

  // 3. Get saved view
  if (viewId) {
    console.log('\n3. GET /api/views/:id');
    const getRes = await request('GET', `/api/views/${viewId}`);
    console.log('Status:', getRes.status);
    console.log('Response:', JSON.stringify(getRes.body, null, 2));
  }

  // 4. Update saved view
  if (viewId) {
    console.log('\n4. PATCH /api/views/:id');
    const updateRes = await request('PATCH', `/api/views/${viewId}`, {
      name: 'Updated View Name',
      filters: { filter: 'completed', search: '', categoryFilter: 'all', sort: 'oldest' },
      sort: 'oldest'
    });
    console.log('Status:', updateRes.status);
    console.log('Response:', JSON.stringify(updateRes.body, null, 2));
  }

  // 5. Delete saved view
  if (viewId) {
    console.log('\n5. DELETE /api/views/:id');
    const delRes = await request('DELETE', `/api/views/${viewId}`);
    console.log('Status:', delRes.status);
    console.log('Response:', JSON.stringify(delRes.body, null, 2));
  }

  console.log('\nTests completed.');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
