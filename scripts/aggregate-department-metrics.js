#!/usr/bin/env node
/**
 * Persist daily department KPI snapshots into department_daily_metrics.
 *
 * Usage:
 *   node scripts/aggregate-department-metrics.js
 *   node scripts/aggregate-department-metrics.js --yesterday
 *   node scripts/aggregate-department-metrics.js --date 2026-03-12
 *   node scripts/aggregate-department-metrics.js --date 2026-03-12 --backfill-days 7
 */

const fs = require('fs');
const path = require('path');
const AsanaStorage = require('../storage/asana');
const { persistDepartmentDailyMetrics } = require('../metrics-api.js');

const OPENCLAW_ROOT = path.resolve(__dirname, '..', '..', '..');
const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_ROOT, 'openclaw.json');

function normalizeModelRef(modelConfig) {
  if (typeof modelConfig === 'string' && modelConfig.trim()) {
    return modelConfig.trim();
  }
  if (modelConfig && typeof modelConfig === 'object') {
    if (typeof modelConfig.primary === 'string' && modelConfig.primary.trim()) {
      return modelConfig.primary.trim();
    }
    if (typeof modelConfig.id === 'string' && modelConfig.id.trim()) {
      return modelConfig.id.trim();
    }
  }
  return null;
}

function buildConfiguredAgentsCatalog() {
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_FILE, 'utf8'));
    const configuredAgents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    const seen = new Set();

    return configuredAgents
      .map((agent) => {
        const id = String(agent?.id || agent?.name || '').trim();
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return {
          id,
          name: String(agent?.name || agent?.id || 'Unnamed agent').trim(),
          workspace: agent?.workspace || null,
          default: Boolean(agent?.default),
          defaultModel: normalizeModelRef(agent?.model)
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn('[aggregate-department-metrics] Failed to read openclaw.json:', error.message);
    return [];
  }
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(dateString, deltaDays) {
  const base = new Date(`${dateString}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return formatDateOnly(base);
}

function parseArgs(argv) {
  const options = {
    date: formatDateOnly(new Date()),
    backfillDays: 1
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') {
      options.date = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--backfill-days') {
      options.backfillDays = Number.parseInt(argv[index + 1] || '1', 10);
      index += 1;
      continue;
    }
    if (arg === '--yesterday') {
      options.date = shiftDate(formatDateOnly(new Date()), -1);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`Invalid --date value: ${options.date}`);
  }

  if (!Number.isInteger(options.backfillDays) || options.backfillDays < 1 || options.backfillDays > 366) {
    throw new Error(`Invalid --backfill-days value: ${options.backfillDays}`);
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log([
      'Usage: node scripts/aggregate-department-metrics.js [options]',
      '',
      'Options:',
      '  --date YYYY-MM-DD       Snapshot target date (default: today UTC)',
      '  --yesterday             Snapshot yesterday UTC',
      '  --backfill-days N       Persist N consecutive days ending at --date',
      '  -h, --help              Show this help output'
    ].join('\n'));
    return;
  }

  const storage = new AsanaStorage({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'openclaw_webos',
    user: process.env.POSTGRES_USER || 'openclaw',
    password: process.env.POSTGRES_PASSWORD || 'openclaw_password'
  });

  await storage.init();

  const context = {
    asanaStorage: storage,
    buildConfiguredAgentsCatalog
  };

  const results = [];
  try {
    for (let offset = options.backfillDays - 1; offset >= 0; offset -= 1) {
      const metricDate = shiftDate(options.date, -offset);
      const result = await persistDepartmentDailyMetrics(context, metricDate);
      results.push(result);
      console.log(`[aggregate-department-metrics] ${metricDate}: upserted ${result.departmentsWritten} department snapshots`);
    }
  } finally {
    await storage.pool.end();
  }

  const totalSnapshots = results.reduce((sum, result) => sum + result.departmentsWritten, 0);
  console.log(`[aggregate-department-metrics] Completed ${results.length} snapshot run(s), ${totalSnapshots} rows upserted.`);
}

main().catch((error) => {
  console.error('[aggregate-department-metrics] Failed:', error.message);
  process.exit(1);
});
