/**
 * OpenClaw CLI wrapper — thin exec wrapper for `openclaw` CLI commands.
 * All dashboard routes that need CLI data should go through this.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(execFile);

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const DEFAULT_TIMEOUT = 15000;

/**
 * Strip OpenClaw banner/plugin noise from stdout before JSON parsing.
 * Banners look like: [dashboard-bridge] Plugin registered
 * Or: 🦞 OpenClaw 2026.4.24 ...
 * These appear before the actual JSON output.
 */
function stripBanner(stdout) {
  // Strategy: find the first line that is clearly JSON (starts with { or [ followed by JSON-like content)
  const lines = stdout.split('\n');
  let jsonStartIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    // A JSON object start: { with no other text after (or followed by ")
    if (trimmed === '{' || trimmed === '[' || trimmed === '""' || trimmed === 'null' || trimmed === 'true' || trimmed === 'false') {
      jsonStartIdx = i;
      break;
    }
    // JSON starting inline: {"key" or [{"key" or "string"
    if (/^[\{"\[]/.test(trimmed) && !/^\[.*\]/.test(trimmed.replace(/[^a-z\[\]]/g,''))) {
      // But skip lines like [dashboard-bridge] ... (bracket then word)
      if (/^\[[a-zA-Z]/.test(trimmed)) continue;
      jsonStartIdx = i;
      break;
    }
    // Quoted string
    if (trimmed.startsWith('"')) {
      jsonStartIdx = i;
      break;
    }
  }

  if (jsonStartIdx === -1) return stdout;
  return lines.slice(jsonStartIdx).join('\n');
}

async function cli(args, timeout = DEFAULT_TIMEOUT) {
  try {
    const { stdout, stderr } = await execAsync(OPENCLAW_BIN, args, { timeout });
    const cleanStdout = stripBanner(stdout);
    if (cleanStdout.trim()) {
      try {
        return JSON.parse(cleanStdout);
      } catch (_) {
        return { raw: cleanStdout.trim() };
      }
    }
    if (stderr.trim()) {
      return { raw: stderr.trim() };
    }
    return {};
  } catch (err) {
    const msg = err.stderr?.trim() || err.message;
    return { error: msg };
  }
}

// ── Cron ──────────────────────────────────────────────────
async function cronList() {
  return cli(['cron', 'list', '--json']);
}

async function cronRuns(id, limit = 10) {
  return cli(['cron', 'runs', '--id', id, '--limit', String(limit), '--json']);
}

async function cronRun(id) {
  return cli(['cron', 'run', '--id', id, '--json']);
}

async function cronEnable(id) {
  return cli(['cron', 'enable', '--id', id, '--json']);
}

async function cronDisable(id) {
  return cli(['cron', 'disable', '--id', id, '--json']);
}

// ── Health ────────────────────────────────────────────────
async function health() {
  return cli(['health', '--json']);
}

// ── Tasks ─────────────────────────────────────────────────
async function tasksList(filters = {}) {
  const args = ['tasks', 'list', '--json'];
  if (filters.runtime) args.push('--runtime', filters.runtime);
  if (filters.status) args.push('--status', filters.status);
  return cli(args, 20000);
}

async function tasksAudit() {
  return cli(['tasks', 'audit', '--json']);
}

// ── Agents ────────────────────────────────────────────────
async function agentsList() {
  return cli(['agents', 'list', '--json']);
}

// ── Memory ────────────────────────────────────────────────
async function memoryIndex(agentId = 'main') {
  return cli(['memory', 'index', '--agent', agentId]);
}

async function memoryPromote(agentId = 'main', opts = {}) {
  const args = ['memory', 'promote', '--agent', agentId, '--json'];
  if (opts.apply) args.push('--apply');
  if (opts.limit) args.push('--limit', String(opts.limit));
  if (opts.minScore) args.push('--min-score', String(opts.minScore));
  return cli(args, 30000);
}

module.exports = {
  cli,
  cronList, cronRuns, cronRun, cronEnable, cronDisable,
  health,
  tasksList, tasksAudit,
  agentsList,
  memoryIndex, memoryPromote,
};
