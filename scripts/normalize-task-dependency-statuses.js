#!/usr/bin/env node
/**
 * Normalize dashboard tasks that are still marked in_progress even though one or more
 * dependencies are incomplete.
 *
 * Usage:
 *   node scripts/normalize-task-dependency-statuses.js --dry-run
 *   node scripts/normalize-task-dependency-statuses.js
 *   node scripts/normalize-task-dependency-statuses.js --limit 25
 */

const AsanaStorage = require('../storage/asana');

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      options.limit = Number.parseInt(argv[index + 1] || '', 10);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000)) {
    throw new Error(`Invalid --limit value: ${options.limit}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log([
      'Usage: node scripts/normalize-task-dependency-statuses.js [options]',
      '',
      'Options:',
      '  --dry-run           List tasks that would be normalized without writing changes',
      '  --limit N           Only inspect the first N matching tasks',
      '  -h, --help          Show this help output'
    ].join('\n'));
    return;
  }

  const storage = new AsanaStorage({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'openclaw_dashboard',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD 
  });

  await storage.init();

  try {
    const result = await storage.normalizeTasksBlockedByDependencies({
      actor: 'dependency-status-normalizer',
      dryRun: options.dryRun,
      limit: options.limit
    });

    if (result.tasks.length === 0) {
      console.log('[normalize-task-dependency-statuses] No dependency-blocked in_progress tasks found.');
      return;
    }

    for (const task of result.tasks) {
      if (result.dryRun) {
        const blockers = (task.incomplete_dependencies || [])
          .map((dependency) => `${dependency.title || dependency.id} [${dependency.status}]`)
          .join(', ');
        console.log(`DRY RUN: ${task.id} | ${task.title} | ${blockers}`);
      } else {
        console.log(`NORMALIZED: ${task.id} | ${task.title} -> ${task.status}`);
      }
    }

    if (result.dryRun) {
      console.log(`[normalize-task-dependency-statuses] ${result.tasks.length} task(s) would be moved to blocked.`);
    } else {
      console.log(`[normalize-task-dependency-statuses] Normalized ${result.normalizedCount} task(s).`);
    }
  } finally {
    await storage.pool.end();
  }
}

main().catch((error) => {
  console.error('[normalize-task-dependency-statuses] Failed:', error.message);
  process.exit(1);
});
