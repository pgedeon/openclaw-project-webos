/**
 * Gateway Workflow Dispatcher
 * 
 * Replaces the CLI-based workflow-run-monitor.js.
 * Instead of spawning `openclaw agent` CLI (which has session lock issues),
 * it writes pending tasks to a pickup file that the main agent checks.
 * 
 * The main agent (running in a gateway session) then uses sessions_spawn
 * to dispatch work to the correct agent — no lock collisions.
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const http = require('http');

const POLL_INTERVAL_MS = 30000;
const STALE_TIMEOUT_MINUTES = 60;
const PICKUP_FILE = '/tmp/dashboard-workflow-pickup.json';

class GatewayWorkflowDispatcher {
  constructor(pool, log = console) {
    this.pool = pool;
    this.log = log;
    this.running = false;
    this.interval = null;
    this.dispatchedRuns = new Map(); // runId -> { dispatchedAt, agentId }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log.log('[Dispatcher] Starting gateway workflow dispatcher...');
    this.tick();
    this.interval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.log.log('[Dispatcher] Stopped');
  }

  async tick() {
    try {
      const runsNeedingDispatch = await this.getRunsNeedingDispatch();
      
      if (runsNeedingDispatch.length > 0) {
        this.log.log(`[Dispatcher] Found ${runsNeedingDispatch.length} runs needing dispatch`);
        for (const run of runsNeedingDispatch) {
          // If run is queued, call start endpoint to transition to running
          if (run.status === 'queued') {
            await this.startQueuedRun(run.id);
          }
          await this.writePickup(run);
        }
      }

      // Mark stale dispatched runs (> 60 min) as timed out
      await this.handleStaleRuns();
    } catch (err) {
      this.log.error('[Dispatcher] Error in tick:', err.message);
    }
  }

  async startQueuedRun(runId) {
    return new Promise((resolve) => {
      const options = {
        hostname: '127.0.0.1',
        port: 3876,
        path: `/api/workflow-runs/${runId}/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.log.log(`[Dispatcher] Started queued run ${runId.substring(0, 8)}`);
          } else {
            this.log.error(`[Dispatcher] Failed to start queued run ${runId.substring(0, 8)}: ${res.statusCode}`);
          }
          resolve();
        });
      });

      req.on('error', (err) => {
        this.log.error(`[Dispatcher] Error starting queued run ${runId.substring(0, 8)}: ${err.message}`);
        resolve();
      });

      req.end();
    });
  }

  async getRunsNeedingDispatch() {
    const query = `
      SELECT 
        id, workflow_type, owner_agent_id, input_payload,
        current_step, status,
        gateway_session_id, gateway_session_active
      FROM workflow_runs
      WHERE status IN ('queued', 'running', 'in_progress')
        AND gateway_session_active IS NOT TRUE
      ORDER BY created_at ASC
      LIMIT 5
    `;

    const result = await this.pool.query(query);
    
    return result.rows.filter(run => {
      const runId = run.id;
      if (this.dispatchedRuns.has(runId)) {
        const info = this.dispatchedRuns.get(runId);
        const ageMin = (Date.now() - info.dispatchedAt.getTime()) / 60000;
        if (ageMin > 60) {
          this.dispatchedRuns.delete(runId);
          return true;
        }
        return false;
      }
      return true;
    });
  }

  async writePickup(run) {
    const inputPayload = typeof run.input_payload === 'string' 
      ? JSON.parse(run.input_payload) 
      : (run.input_payload || {});
    
    // Determine agent
    const agentMap = {
      'citation-improvement': 'affiliate-editorial',
      'affiliate-article': 'affiliate-editorial',
      'code-change': 'coder',
      'image-generation': 'comfyui-image-agent',
      'qa-review': 'qa-review',
      'incident-investigation': 'incident-investigation',
      'system-improvement-scan': 'main',
      'improvement-suggestion': 'coder',
    };
    
    const agentId = agentMap[run.workflow_type] || run.owner_agent_id || 'coder';
    const runId = run.id;

    // Build task based on workflow type
    let task;
    if (run.workflow_type === 'system-improvement-scan') {
      task = `Execute a system improvement scan for workflow run ${runId.substring(0, 8)}.
Run the system improvement scan script
Report findings. Mark run complete via:
curl -X POST "http://localhost:3876/api/workflow-runs/${runId}/complete" -H "Content-Type: application/json" -d '{"suggestions_count": N, "approval_runs_created": N, "scan_summary": "..."}'`;
    } else if (inputPayload.action_prompt) {
      task = `## Task: ${(inputPayload.title || run.workflow_type)}
${inputPayload.action_prompt}
Category: ${inputPayload.category || run.workflow_type}
Priority: ${inputPayload.priority || 'medium'}
Run ID: ${runId}

Execute the improvement. Mark complete via:
curl -X POST "http://localhost:3876/api/workflow-runs/${runId}/complete" -H "Content-Type: application/json" -d '{"summary": "...", "changes_made": "..."}'`;
    } else {
      task = `Execute ${run.workflow_type} workflow run ${runId.substring(0, 8)}.
Title: ${run.title || 'Untitled'}
Mark complete via:
curl -X POST "http://localhost:3876/api/workflow-runs/${runId}/complete" -H "Content-Type: application/json" -d '{"summary": "..."}'`;
    }

    const pickup = {
      run_id: runId,
      workflow_type: run.workflow_type,
      agent_id: agentId,
      task: task,
      title: (inputPayload.title || run.workflow_type),
      dispatched_at: new Date().toISOString(),
      input_payload: inputPayload,
    };

    // Write to pickup file (main agent reads this)
    try {
      let existing = [];
      if (fs.existsSync(PICKUP_FILE)) {
        existing = JSON.parse(fs.readFileSync(PICKUP_FILE, 'utf8'));
      }
      // Dedup by run_id
      if (!existing.some(e => e.run_id === runId)) {
        existing.push(pickup);
        fs.writeFileSync(PICKUP_FILE, JSON.stringify(existing, null, 2));
        this.log.log(`[Dispatcher] Wrote pickup for run ${runId.substring(0, 8)} → agent ${agentId}`);
      }
    } catch (err) {
      this.log.error(`[Dispatcher] Failed to write pickup file: ${err.message}`);
    }

    this.dispatchedRuns.set(runId, { dispatchedAt: new Date(), agentId });
  }

  async handleStaleRuns() {
    const query = `
      SELECT 
        id, workflow_type, status, started_at,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) / 60 AS elapsed_minutes
      FROM workflow_runs
      WHERE status IN ('running', 'in_progress')
        AND gateway_session_active IS TRUE
        AND EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) / 60 > $1
      ORDER BY started_at ASC
    `;
    const result = await this.pool.query(query, [STALE_TIMEOUT_MINUTES]);
    for (const run of result.rows) {
      this.log.log(`[Dispatcher] Run ${run.id.substring(0, 8)} timed out (${Math.round(run.elapsed_minutes)}min)`);
      await this.pool.query(`
        UPDATE workflow_runs
        SET status = 'failed', last_error = $2, last_error_at = NOW(), finished_at = NOW()
        WHERE id = $1 AND status IN ('running', 'in_progress')
      `, [run.id, `Timed out after ${Math.round(run.elapsed_minutes)} minutes`]);
      this.dispatchedRuns.delete(run.id);
    }
  }
}

module.exports = { GatewayWorkflowDispatcher };
