#!/usr/bin/env node
/**
 * sync-models-catalog.js
 * Reads ~/.openclaw/openclaw.json model providers and writes a flat catalog
 * to the dashboard directory for the task view to consume.
 *
 * Usage: node sync-models-catalog.js [--watch]
 */

const fs = require('fs');
const path = require('path');

const OPENCLAW_CONFIG = path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');
const OUTPUT_DIR = __dirname;
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'models-catalog.json');

function loadModels() {
  if (!fs.existsSync(OPENCLAW_CONFIG)) {
    console.warn('[sync-models-catalog] Config not found:', OPENCLAW_CONFIG);
    return { models: [], providers: [], syncedAt: new Date().toISOString() };
  }

  const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
  const providersConfig = config?.models?.providers || {};

  const models = [];
  const providers = [];

  for (const [providerId, provider] of Object.entries(providersConfig)) {
    const providerModels = provider.models || [];
    providers.push({
      id: providerId,
      baseUrl: provider.baseUrl || '',
      api: provider.api || 'openai-completions',
      modelCount: providerModels.length,
    });

    for (const model of providerModels) {
      models.push({
        id: model.id,
        name: model.name || model.id,
        provider: providerId,
        providerBaseUrl: provider.baseUrl || '',
        reasoning: model.reasoning === true,
        input: model.input || ['text'],
        contextWindow: model.contextWindow || null,
        maxTokens: model.maxTokens || null,
        // Build a display-friendly label
        displayName: buildDisplayName(model, providerId),
      });
    }
  }

  // Deduplicate by id (same model may appear in multiple providers)
  const seen = new Set();
  const deduped = models.filter(m => {
    const key = m.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    models: deduped,
    providers,
    syncedAt: new Date().toISOString(),
  };
}

function buildDisplayName(model, providerId) {
  const id = model.id || '';
  // If the name looks like a human-readable label already, use it
  if (model.name && model.name !== model.id && !model.name.includes('/')) {
    return `${model.name} · ${providerId}`;
  }
  // Parse provider/model format: "stepfun/step-3.5-flash:free"
  if (id.includes('/')) {
    const parts = id.split('/');
    const modelName = parts.slice(-1)[0];
    const shortName = modelName.split(':')[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${shortName} · ${providerId}`;
  }
  // Simple model name
  return id;
}

function sync() {
  try {
    const catalog = loadModels();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`[sync-models-catalog] Synced ${catalog.models.length} models from ${catalog.providers.length} providers`);
    return catalog;
  } catch (err) {
    console.error('[sync-models-catalog] Sync failed:', err.message);
    return null;
  }
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--watch')) {
  console.log(`[sync-models-catalog] Watching ${OPENCLAW_CONFIG} for changes...`);
  let lastMtime = 0;
  setInterval(() => {
    try {
      const stat = fs.statSync(OPENCLAW_CONFIG);
      if (stat.mtimeMs !== lastMtime) {
        lastMtime = stat.mtimeMs;
        sync();
      }
    } catch (e) { /* config might not exist yet */ }
  }, 5000);
} else {
  const result = sync();
  if (result) process.exit(0);
  else process.exit(1);
}
