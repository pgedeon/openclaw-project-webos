/**
 * Workflow Run Monitor (FIXED v2)
 * 
 * Monitors workflow_runs for:
 * 1. Runs in "running" status without active sessions - spawns agents
 * 2. Stale runs that have been running too long - marks as timed out
 * 
 * FIX v2: Use correct 'openclaw agent' command instead of non-existent 'sessions spawn'
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

const POLL_INTERVAL_MS = 30000; // 30 seconds
const STALE_TIMEOUT_MINUTES = 60; // 60 minutes timeout
const OPENCLAW_BIN = '/usr/bin/openclaw';

// Agent mapping for workflow types
const WORKFLOW_AGENT_MAP = {
  'citation-improvement': 'affiliate-editorial',
  'affiliate-article': 'affiliate-editorial',
  'code-change': 'code-change',
  'image-generation': 'comfyui-image-agent',
  'qa-review': 'qa-review',
  'incident-investigation': 'incident-investigation',
  'system-improvement-scan': 'main',
  'improvement-suggestion': 'coder',
};

// Agents with strong models for complex work (not free-tier)
const STRONG_MODEL_AGENTS = ['main', 'coder', 'dashboard-manager'];

class WorkflowRunMonitor {
  constructor(pool, log = console) {
    this.pool = pool;
    this.log = log;
    this.running = false;
    this.interval = null;
    this.spawnedSessions = new Map(); // runId -> { agentId, spawnedAt, pid }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.log.log('[WorkflowMonitor] Starting workflow run monitor (60min timeout)...');
    this.tick();
    this.interval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.log.log('[WorkflowMonitor] Stopped');
  }

  async tick() {
    try {
      // 1. Check for runs needing agents
      const runsNeedingAgents = await this.getRunsNeedingAgents();
      
      if (runsNeedingAgents.length > 0) {
        this.log.log(`[WorkflowMonitor] Found ${runsNeedingAgents.length} runs needing agents`);
        for (const run of runsNeedingAgents) {
          await this.spawnAgentForRun(run);
        }
      }

      // 2. Check for stale runs (only mark as failed, don't respawn)
      const staleRuns = await this.getStaleRuns();
      
      if (staleRuns.length > 0) {
        this.log.log(`[WorkflowMonitor] Found ${staleRuns.length} stale runs`);
        for (const run of staleRuns) {
          await this.handleStaleRun(run);
        }
      }
    } catch (err) {
      this.log.error('[WorkflowMonitor] Error in tick:', err.message);
    }
  }

  async getRunsNeedingAgents() {
    // Only return runs that have NEVER had an agent spawned
    const query = `
      SELECT 
        id, workflow_type, owner_agent_id, 
        input_payload, current_step, status,
        gateway_session_id, gateway_session_active
      FROM workflow_runs
      WHERE status IN ('running', 'in_progress')
        AND gateway_session_active IS NOT TRUE
      ORDER BY created_at ASC
      LIMIT 3
    `;

    const result = await this.pool.query(query);
    
    // Filter out runs we've already spawned (in-memory check)
    const notYetSpawned = result.rows.filter(run => {
      const runId = run.id;
      const alreadySpawned = this.spawnedSessions.has(runId);
      if (alreadySpawned) {
        const sessionInfo = this.spawnedSessions.get(runId);
        const ageMs = Date.now() - sessionInfo.spawnedAt.getTime();
        const ageMin = Math.round(ageMs / 60000);
        // If spawned more than 60 minutes ago, allow respawn
        if (ageMin > STALE_TIMEOUT_MINUTES) {
          this.spawnedSessions.delete(runId);
          return true;
        }
      }
      return !alreadySpawned;
    });
    
    return notYetSpawned;
  }

  async getStaleRuns() {
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
    return result.rows;
  }

  async handleStaleRun(run) {
    const runId = run.id;
    const elapsedMinutes = Math.round(run.elapsed_minutes);
    
    this.log.log(`[WorkflowMonitor] Run ${runId.substring(0, 8)} stale (${elapsedMinutes}min) - marking as timed out`);
    
    // Mark as failed
    await this.markRunTimedOut(runId, `Run exceeded ${STALE_TIMEOUT_MINUTES} minute timeout after ${elapsedMinutes} minutes`);
    
    // Remove from spawned sessions
    this.spawnedSessions.delete(runId);
  }

  async markRunTimedOut(runId, reason) {
    const query = `
      UPDATE workflow_runs
      SET status = 'failed',
          last_error = $2,
          last_error_at = NOW(),
          finished_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND status IN ('running', 'in_progress')
    `;
    await this.pool.query(query, [runId, reason]);
  }

  async spawnAgentForRun(run) {
    const runId = run.id;
    const workflowType = run.workflow_type;
    const ownerAgent = run.owner_agent_id;
    const inputPayload = run.input_payload || {};

    // Determine which agent to spawn
    const agentId = WORKFLOW_AGENT_MAP[workflowType] || ownerAgent;

    if (!agentId) {
      this.log.error(`[WorkflowMonitor] No agent mapping for workflow: ${workflowType}`);
      return false;
    }

    // Build task description
    const title = inputPayload.title || `${workflowType} run`;
    const articleUrl = inputPayload.article_url || inputPayload.url || '';
    
    let task;
    if (workflowType === 'system-improvement-scan') {
      const scanAreas = (inputPayload.scan_areas || []).join(', ');
      task = `Execute a system improvement scan for workflow run ${runId.substring(0, 8)}.

Scan areas: ${scanAreas}
Max suggestions: ${inputPayload.max_suggestions || 10}

## Your Task

Run the improvement scan engine to analyze the current system state:
1. Run: python3 /root/.openclaw/workspace/dashboard/scripts/system-improvement-engine.py
2. Review the output - it will automatically create approval-gated workflow runs
3. If suggestions were created, report the summary
4. If no suggestions were found, report that the system is healthy

## CRITICAL: You MUST mark the run complete when done

After the scan finishes, call this API:

curl -X POST "http://localhost:3876/api/workflow-runs/${runId}/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "suggestions_count": N,
    "approval_runs_created": N,
    "scan_summary": "Brief summary of findings"
  }'

Do NOT skip this step.`;
    } else {
    task = `Work on the ${workflowType} workflow run ${runId.substring(0, 8)}.

Article: ${articleUrl}
Title: ${title}

Run ID: ${runId}
Status: running
Current Step: ${run.current_step || 'starting'}

## Your Task

Process this article for citation improvement:
1. Fetch the article content
2. Analyze current citations and identify improvement opportunities
3. Run fact-checking on claims
4. Add missing citations, comparison tables, FAQ sections
5. Update the article in WordPress

## CRITICAL: You MUST mark the run complete when done

After completing the work, you MUST call this API to mark the run complete with any outputs:

curl -X POST "http://localhost:3876/api/workflow-runs/${runId}/complete" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": "Brief description of what was accomplished",
    "published_url": "https://...",
    "draft_url": "https://...",
    "image_url": "https://...",
    "report_url": "https://..."
  }'

Include any URLs or file paths as top-level keys (published_url, draft_url, image_url, etc).
These will be automatically captured as artifacts. Do NOT skip this step.`;
    }

    this.log.log(`[WorkflowMonitor] Spawning agent ${agentId} for run ${runId.substring(0, 8)}...`);

    try {
      // FIX: Use 'openclaw agent' command (not 'sessions spawn')
      // --timeout: 900 = 60 minutes
      // Use a unique session ID per run to avoid session lock collision
      const sessionId = `wf-${runId}`;
      const args = [
        'agent',
        '--agent', agentId,
        '--session-id', sessionId,
        '--message', task,
        '--timeout', '900'
      ];

      this.log.log(`[WorkflowMonitor] Running: openclaw ${args.join(' ')}`);

      const child = spawn(OPENCLAW_BIN, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      });

      const pid = child.pid;

      child.on('error', (err) => {
        this.log.error(`[WorkflowMonitor] Spawn error for ${runId.substring(0, 8)}: ${err.message}`);
      });

      child.unref();

      // Wait a moment then update the run
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Mark as having an active session
      await this.updateRunSession(runId, true, pid);

      // Track in memory
      this.spawnedSessions.set(runId, {
        agentId: agentId,
        spawnedAt: new Date(),
        pid: pid
      });

      this.log.log(`[WorkflowMonitor] ✅ Spawned agent ${agentId} for run ${runId.substring(0, 8)} (PID: ${pid})`);
      return true;

    } catch (err) {
      this.log.error(`[WorkflowMonitor] Failed to spawn agent: ${err.message}`);
      return false;
    }
  }

  async updateRunSession(runId, active, pid = null) {
    const query = `
      UPDATE workflow_runs
      SET gateway_session_active = $2,
          gateway_session_id = CASE WHEN $2 THEN $3 ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1
    `;
    // Set session ID with PID for tracking
    const sessionId = active ? `spawned-${runId.substring(0, 8)}-pid${pid || 'unknown'}` : null;
    await this.pool.query(query, [runId, active, sessionId]);
  }
}

module.exports = { WorkflowRunMonitor };
