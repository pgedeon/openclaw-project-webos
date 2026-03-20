#!/usr/bin/env node
/**
 * Sync gateway agent status to static JSON for the dashboard.
 * Runs via cron every 30 seconds.
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, 'gateway-status.json');

async function sync() {
  try {
    const { stdout } = await execFileAsync('openclaw', ['status', '--json'], {
      timeout: 10000,
      env: { ...process.env, NO_COLOR: '1' }
    });
    const data = JSON.parse(stdout);
    
    // Extract a lightweight agent status map
    const agents = (data.agents?.agents || []).map(a => ({
      id: a.id,
      name: a.name || a.id,
      lastActiveAgeMs: a.lastActiveAgeMs,
      lastActiveAt: a.lastUpdatedAt ? new Date(a.lastUpdatedAt).toISOString() : null,
      sessionsCount: a.sessionsCount || 0,
      // Derive status from activity age
      status: a.lastActiveAgeMs === null ? 'never' 
        : a.lastActiveAgeMs !== null && a.lastActiveAgeMs < 120000 ? 'active'
        : a.lastActiveAgeMs !== null && a.lastActiveAgeMs < 600000 ? 'recent'
        : 'offline',
    }));

    // Recent sessions summary (top 5)
    const recentSessions = (data.sessions?.recent || []).slice(0, 5).map(s => ({
      agentId: s.agentId,
      model: s.model,
      percentUsed: s.percentUsed,
      age: s.age,
      kind: s.kind,
    }));

    const output = {
      syncedAt: new Date().toISOString(),
      agentCount: agents.length,
      agents,
      recentSessions,
      sessionsTotal: data.sessions?.count || 0,
      heartbeat: data.heartbeat || {},
    };

    writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');
    console.log(`[sync-gateway-status] ${agents.filter(a => a.status === 'active').length} active, ${agents.filter(a => a.status === 'recent').length} recent, ${agents.length} total`);
  } catch (e) {
    console.error(`[sync-gateway-status] Error: ${e.message}`);
    // Write a stale file if exists, or empty
    if (!existsSync(OUTPUT)) {
      writeFileSync(OUTPUT, JSON.stringify({ syncedAt: new Date().toISOString(), error: e.message, agents: [] }), 'utf8');
    }
  }
}

sync();
