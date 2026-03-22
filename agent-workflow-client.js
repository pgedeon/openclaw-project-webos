#!/usr/bin/env node
/**
 * Agent Workflow Client — lets OpenClaw agents poll, claim, heartbeat, and complete
 * workflow runs from the v2 dispatcher API.
 *
 * Usage:
 *   node agent-workflow-client.js poll [--limit 3]
 *   node agent-workflow-client.js claim <run-id> --session <session-id>
 *   node agent-workflow-client.js heartbeat <run-id> --session <session-id>
 *   node agent-workflow-client.js complete <run-id> --session <session-id> [--output '{"result":"ok"}']
 *   node agent-workflow-client.js stats
 *
 * Environment:
 *   DASHBOARD_API_BASE — API base URL (default: http://127.0.0.1:3876)
 */

const http = require('http');

const API_BASE = process.env.DASHBOARD_API_BASE || 'http://127.0.0.1:3876';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const data = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 10000,
    };

    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text), raw: text });
        } catch {
          resolve({ status: res.statusCode, body: text, raw: text });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// ─── Commands ──────────────────────────────────────────────────────

async function poll(limit = 3) {
  const { status, body } = await request('GET', `/api/workflow-runs/pending?limit=${limit}`);
  if (status !== 200) {
    console.error(`Error ${status}:`, body);
    process.exit(1);
  }
  const runs = body.runs || [];
  if (runs.length === 0) {
    console.log('No pending workflow runs.');
    return;
  }
  console.log(`Pending workflow runs (${runs.length}):`);
  for (const r of runs) {
    console.log(`  ${r.id} | ${r.workflowType} → ${r.targetAgentId || r.ownerAgentId} | ${r.dispatchAttempts || 0} attempts`);
    if (r.inputPayload && Object.keys(r.inputPayload).length > 0) {
      console.log(`    Input: ${JSON.stringify(r.inputPayload).slice(0, 120)}`);
    }
  }
}

async function claim(runId, sessionId) {
  if (!sessionId) {
    console.error('Error: --session <session-id> required');
    process.exit(1);
  }
  const { status, body } = await request('POST', `/api/workflow-runs/${runId}/claim`, {
    session_id: sessionId,
  });
  if (status === 200) {
    console.log(`Claimed run ${runId}`);
    console.log(`  Status: ${body.status}`);
    console.log(`  Workflow: ${body.workflowType}`);
    console.log(`  Agent: ${body.targetAgentId || body.ownerAgentId}`);
    console.log(`  Input: ${JSON.stringify(body.inputPayload || {})}`);
  } else if (status === 409) {
    console.log(`Run ${runId} already claimed by another agent.`);
    process.exit(2);
  } else {
    console.error(`Error ${status}:`, body);
    process.exit(1);
  }
}

async function heartbeat(runId, sessionId) {
  if (!sessionId) {
    console.error('Error: --session <session-id> required');
    process.exit(1);
  }
  const { status, body } = await request('POST', `/api/workflow-runs/${runId}/heartbeat`, {
    session_id: sessionId,
  });
  if (status === 200) {
    console.log(`Heartbeat sent for run ${runId}`);
  } else if (status === 404 || (status === 200 && !body)) {
    console.error(`Run ${runId} not found or session mismatch.`);
    process.exit(2);
  } else {
    console.error(`Error ${status}:`, body);
    process.exit(1);
  }
}

async function complete(runId, sessionId, outputStr) {
  if (!sessionId) {
    console.error('Error: --session <session-id> required');
    process.exit(1);
  }
  let outputSummary = {};
  if (outputStr) {
    try { outputSummary = JSON.parse(outputStr); }
    catch { outputSummary = { result: outputStr }; }
  }
  const { status, body } = await request('POST', `/api/workflow-runs/${runId}/complete`, {
    session_id: sessionId,
    output_summary: outputSummary,
  });
  if (status === 200) {
    console.log(`Completed run ${runId}`);
    console.log(`  Status: ${body.status}`);
  } else if (status === 404) {
    console.error(`Run ${runId} not found or session mismatch.`);
    process.exit(2);
  } else {
    console.error(`Error ${status}:`, body);
    process.exit(1);
  }
}

async function stats() {
  const { status, body } = await request('GET', '/api/workflow-runs/dispatcher/stats');
  if (status !== 200) {
    console.error(`Error ${status}:`, body);
    process.exit(1);
  }
  console.log('Dispatcher Stats:');
  console.log(`  Queued:      ${body.queuedCount}`);
  console.log(`  Pending:     ${body.pendingCount}`);
  console.log(`  Claimed:     ${body.claimedCount}`);
  console.log(`  Running:     ${body.runningCount}`);
  console.log(`  Completed:   ${body.completedCount}`);
  console.log(`  Failed:      ${body.failedCount}`);
  console.log(`  Timed Out:   ${body.timedOutCount}`);
  console.log(`  Dispatched:  ${body.dispatchCount}`);
  console.log(`  Failure Rate: ${(body.failureRate * 100).toFixed(1)}%`);
  console.log(`  Routes:      ${body.routeCount}`);
  console.log(`  Last Tick:   ${body.lastTickAt || 'never'}`);
  if (body.lastTickError) console.log(`  Last Error:  ${body.lastTickError}`);
}

// ─── CLI ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'poll': {
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 3;
      await poll(limit);
      break;
    }
    case 'claim': {
      const runId = args[1];
      const sessIdx = args.indexOf('--session');
      const sessionId = sessIdx >= 0 ? args[sessIdx + 1] : null;
      if (!runId) { console.error('Usage: claim <run-id> --session <session-id>'); process.exit(1); }
      await claim(runId, sessionId);
      break;
    }
    case 'heartbeat':
    case 'hb': {
      const runId = args[1];
      const sessIdx = args.indexOf('--session');
      const sessionId = sessIdx >= 0 ? args[sessIdx + 1] : null;
      if (!runId) { console.error('Usage: heartbeat <run-id> --session <session-id>'); process.exit(1); }
      await heartbeat(runId, sessionId);
      break;
    }
    case 'complete':
    case 'done': {
      const runId = args[1];
      const sessIdx = args.indexOf('--session');
      const sessionId = sessIdx >= 0 ? args[sessIdx + 1] : null;
      const outIdx = args.indexOf('--output');
      const outputStr = outIdx >= 0 ? args[outIdx + 1] : null;
      if (!runId) { console.error('Usage: complete <run-id> --session <session-id> [--output JSON]'); process.exit(1); }
      await complete(runId, sessionId, outputStr);
      break;
    }
    case 'stats': {
      await stats();
      break;
    }
    default:
      console.log('Agent Workflow Client v2');
      console.log('');
      console.log('Usage:');
      console.log('  node agent-workflow-client.js poll [--limit N]        List pending workflow runs');
      console.log('  node agent-workflow-client.js claim <id> --session S  Claim a run');
      console.log('  node agent-workflow-client.js heartbeat <id> --sess S Send heartbeat');
      console.log('  node agent-workflow-client.js complete <id> --sess S Complete a run');
      console.log('  node agent-workflow-client.js stats                     Show dispatcher stats');
      console.log('');
      console.log('Environment: DASHBOARD_API_BASE (default: http://127.0.0.1:3876)');
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
