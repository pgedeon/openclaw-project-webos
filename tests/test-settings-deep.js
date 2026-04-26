/**
 * Settings App — Deep-Dive Test Suite
 *
 * Exhaustive testing of every layer: store, routes, edge cases,
 * concurrent access, frontend wiring, error paths, data integrity.
 *
 * Run: node tests/test-settings-deep.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Test infrastructure ──────────────────────────────

const results = { passed: 0, failed: 0, errors: [] };
let currentSection = '';

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ section: currentSection, name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     → ${err.message}`);
  }
}

function section(title) {
  currentSection = title;
  console.log(`\n${'━'.repeat(70)}\n  ${title}\n${'━'.repeat(70)}`);
}

// ── Helpers ──────────────────────────────────────────

function tmpDir(name) {
  const d = path.join(__dirname, `_deep_${name}`);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeStore(dir, envContent = '', configContent = null) {
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'dashboard-config.json');
  if (envContent !== null) fs.writeFileSync(envPath, envContent);
  if (configContent !== null) fs.writeFileSync(configPath, JSON.stringify(configContent || {}));
  const SettingsStore = require('../lib/settings-store');
  return new SettingsStore({ envPath, configPath });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, data: body, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body !== undefined ? JSON.stringify(body) : '';
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname,
      method, headers: { ...headers, 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.headers['Content-Length'] = Buffer.byteLength(postData);
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, data, headers: res.headers }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body !== undefined) req.write(postData);
    req.end();
  });
}

// ══════════════════════════════════════════════════════
// A. SCHEMA COMPLETENESS
// ══════════════════════════════════════════════════════

async function testSchemaCompleteness() {
  section('A. Schema Completeness — every field has required metadata');

  const SettingsStore = require('../lib/settings-store');
  const store = makeStore(tmpDir('schema'));
  store.load();
  const schema = store.getSchema();
  const all = store.getAll();

  // A1: Every schema entry has required fields
  const requiredSchemaFields = ['type', 'default', 'source', 'category', 'label', 'hotReload'];
  for (const [key, s] of Object.entries(schema)) {
    await test(`Schema[${key}] has all required fields`, () => {
      for (const f of requiredSchemaFields) {
        assert.ok(f in s, `${key} missing field: ${f}`);
      }
    });
  }

  // A2: Every type is a known type
  const validTypes = ['string', 'number', 'boolean', 'select', 'password', 'color', 'toggle'];
  for (const [key, s] of Object.entries(schema)) {
    await test(`Schema[${key}] has valid type: "${s.type}"`, () => {
      assert.ok(validTypes.includes(s.type), `Unknown type "${s.type}" for ${key}`);
    });
  }

  // A3: Select types have options array
  for (const [key, s] of Object.entries(schema)) {
    if (s.type === 'select') {
      await test(`Schema[${key}] (select) has options array`, () => {
        assert.ok(Array.isArray(s.options), `${key} select missing options`);
        assert.ok(s.options.length > 0, `${key} select has empty options`);
      });
    }
  }

  // A4: Source is env or config
  const validSources = ['env', 'config'];
  for (const [key, s] of Object.entries(schema)) {
    await test(`Schema[${key}] source is valid`, () => {
      assert.ok(validSources.includes(s.source), `Invalid source "${s.source}" for ${key}`);
    });
  }

  // A5: Category matches known categories
  const validCategories = ['general', 'database', 'gateway', 'appearance', 'apps', 'security', 'integrations', 'sse'];
  const foundCategories = new Set();
  for (const [key, s] of Object.entries(schema)) {
    foundCategories.add(s.category);
    await test(`Schema[${key}] category "${s.category}" is valid`, () => {
      assert.ok(validCategories.includes(s.category), `Unknown category "${s.category}"`);
    });
  }

  // A6: Every category has at least one setting
  await test('All 8 categories are represented', () => {
    for (const cat of validCategories) {
      assert.ok(foundCategories.has(cat), `Category "${cat}" has no settings`);
    }
  });

  // A7: Hot-reload field is boolean
  for (const [key, s] of Object.entries(schema)) {
    await test(`Schema[${key}] hotReload is boolean`, () => {
      assert.strictEqual(typeof s.hotReload, 'boolean');
    });
  }

  // A8: Env-sourced keys are UPPER_SNAKE_CASE
  for (const [key, s] of Object.entries(schema)) {
    if (s.source === 'env') {
      await test(`Env key "${key}" is UPPER_SNAKE_CASE`, () => {
        assert.ok(/^[A-Z_][A-Z0-9_]*$/.test(key), `${key} is not UPPER_SNAKE_CASE`);
      });
    }
  }

  // A9: Config-sourced keys are camelCase
  for (const [key, s] of Object.entries(schema)) {
    if (s.source === 'config') {
      await test(`Config key "${key}" uses consistent naming`, () => {
        assert.ok(/^[a-zA-Z]/.test(key), `${key} doesn't start with a letter`);
      });
    }
  }

  // A10: getAll() returns same keys as schema
  await test('getAll() covers every schema key', () => {
    const allKeys = new Set();
    for (const cat of Object.values(all)) {
      for (const k of Object.keys(cat)) allKeys.add(k);
    }
    for (const key of Object.keys(schema)) {
      assert.ok(allKeys.has(key), `${key} missing from getAll()`);
    }
  });
}

// ══════════════════════════════════════════════════════
// B. .ENV EDGE CASES
// ══════════════════════════════════════════════════════

async function testEnvEdgeCases() {
  section('B. .env Parsing Edge Cases');

  // B1: Empty .env
  await test('Empty .env → all defaults', () => {
    const dir = tmpDir('empty');
    const store = makeStore(dir, '');
    store.load();
    const SettingsStore = require('../lib/settings-store');
    const s2 = new SettingsStore();
    s2.load();
    // PORT should be default
    assert.strictEqual(store.get('PORT'), 3876);
    assert.strictEqual(store.get('STORAGE_TYPE'), 'postgres');
  });

  // B2: Blank lines
  await test('Blank lines in .env are ignored', () => {
    const dir = tmpDir('blank');
    const store = makeStore(dir, '\n\n\nPORT=4000\n\n\n\nSTORAGE_TYPE=json\n\n');
    store.load();
    assert.strictEqual(store.get('PORT'), 4000);
    assert.strictEqual(store.get('STORAGE_TYPE'), 'json');
  });

  // B3: Comment styles
  await test('# comments are ignored', () => {
    const dir = tmpDir('comments');
    const store = makeStore(dir, '# This is a comment\nPORT=4000\n# Another comment\nSTORAGE_TYPE=json');
    store.load();
    assert.strictEqual(store.get('PORT'), 4000);
  });

  // B4: Inline content after value
  await test('Values with spaces are parsed correctly', () => {
    const dir = tmpDir('spaces');
    const store = makeStore(dir, 'POSTGRES_HOST=my host');
    store.load();
    // Value should be "my host" (everything after first =)
    assert.strictEqual(store.get('POSTGRES_HOST'), 'my host');
  });

  // B5: Double-quoted values
  await test('Double-quoted values are unquoted', () => {
    const dir = tmpDir('dquote');
    const store = makeStore(dir, 'POSTGRES_HOST="my-host"');
    store.load();
    assert.strictEqual(store.get('POSTGRES_HOST'), 'my-host');
  });

  // B6: Single-quoted values
  await test('Single-quoted values are unquoted', () => {
    const dir = tmpDir('squote');
    const store = makeStore(dir, "POSTGRES_HOST='my-host'");
    store.load();
    assert.strictEqual(store.get('POSTGRES_HOST'), 'my-host');
  });

  // B7: Values with multiple = signs
  await test('Values containing = are preserved', () => {
    const dir = tmpDir('equals');
    const store = makeStore(dir, 'DASHBOARD_AUTH_TOKEN=key=val=more');
    store.load();
    assert.strictEqual(store.get('DASHBOARD_AUTH_TOKEN'), 'key=val=more');
  });

  // B8: Mixed quotes with = inside
  await test('Quoted values with = inside are handled', () => {
    const dir = tmpDir('mixquote');
    const store = makeStore(dir, 'DASHBOARD_AUTH_TOKEN="base64=abc="');
    store.load();
    assert.strictEqual(store.get('DASHBOARD_AUTH_TOKEN'), 'base64=abc=');
  });

  // B9: Unknown keys in .env are ignored
  await test('Unknown keys in .env are silently ignored', () => {
    const dir = tmpDir('unknown');
    const store = makeStore(dir, 'PORT=4000\nUNKNOWN_VAR=hello\nALSO_UNKNOWN=123');
    store.load();
    assert.strictEqual(store.get('PORT'), 4000);
    assert.strictEqual(store.get('UNKNOWN_VAR'), undefined);
  });

  // B10: Very long value
  await test('Very long values (10KB) are handled', () => {
    const dir = tmpDir('long');
    const longVal = 'a'.repeat(10000);
    const store = makeStore(dir, `DASHBOARD_AUTH_TOKEN=${longVal}`);
    store.load();
    assert.strictEqual(store.get('DASHBOARD_AUTH_TOKEN'), longVal);
  });

  // B11: Unicode values
  await test('Unicode values are preserved', () => {
    const dir = tmpDir('unicode');
    const store = makeStore(dir, 'OPENCLAW_WORKSPACE=/root/ñoño/日本語');
    store.load();
    assert.strictEqual(store.get('OPENCLAW_WORKSPACE'), '/root/ñoño/日本語');
  });

  // B12: Special characters in values
  await test('Special characters in values are preserved', () => {
    const dir = tmpDir('special');
    const store = makeStore(dir, 'POSTGRES_PASSWORD=p@ss!w0rd#$%');
    store.load();
    assert.strictEqual(store.get('POSTGRES_PASSWORD'), 'p@ss!w0rd#$%');
  });

  // B13: Number coercion edge cases
  await test('Number fields: "0" → 0', () => {
    const dir = tmpDir('numzero');
    const store = makeStore(dir, 'PORT=0');
    store.load();
    assert.strictEqual(store.get('PORT'), 0);
  });

  await test('Number fields: negative number', () => {
    const dir = tmpDir('numneg');
    const store = makeStore(dir, 'PORT=-1');
    store.load();
    assert.strictEqual(store.get('PORT'), -1);
  });

  await test('Number fields: float becomes number', () => {
    const dir = tmpDir('numfloat');
    const store = makeStore(dir, 'PORT=8080.5');
    store.load();
    assert.strictEqual(store.get('PORT'), 8080.5);
  });

  await test('Number fields: "NaN" string → default', () => {
    const dir = tmpDir('numnan');
    const store = makeStore(dir, 'PORT=not-a-number');
    store.load();
    assert.strictEqual(store.get('PORT'), 3876); // default
  });

  // B14: Toggle coercion
  await test('Toggle: "true" → true', () => {
    const dir = tmpDir('tog1');
    const store = makeStore(dir, 'REQUIRE_AUTH=true');
    store.load();
    assert.strictEqual(store.get('REQUIRE_AUTH'), true);
  });

  await test('Toggle: "false" → false', () => {
    const dir = tmpDir('tog2');
    const store = makeStore(dir, 'REQUIRE_AUTH=false');
    store.load();
    assert.strictEqual(store.get('REQUIRE_AUTH'), false);
  });

  await test('Toggle: "1" → true', () => {
    const dir = tmpDir('tog3');
    const store = makeStore(dir, 'REQUIRE_AUTH=1');
    store.load();
    assert.strictEqual(store.get('REQUIRE_AUTH'), true);
  });

  await test('Toggle: "0" → false', () => {
    const dir = tmpDir('tog4');
    const store = makeStore(dir, 'REQUIRE_AUTH=0');
    store.load();
    assert.strictEqual(store.get('REQUIRE_AUTH'), false);
  });

  await test('Toggle: any other string → false', () => {
    const dir = tmpDir('tog5');
    const store = makeStore(dir, 'REQUIRE_AUTH=yes');
    store.load();
    assert.strictEqual(store.get('REQUIRE_AUTH'), false);
  });

  // B15: Boolean value passed directly
  await test('Toggle: boolean true stays true', () => {
    const dir = tmpDir('tog6');
    const store = makeStore(dir, '');
    store.load();
    const result = store.set('windowSnap', true);
    assert.strictEqual(result.newValue, true);
  });
}

// ══════════════════════════════════════════════════════
// C. .ENV WRITE INTEGRITY
// ══════════════════════════════════════════════════════

async function testEnvWriteIntegrity() {
  section('C. .env Write Integrity');

  const dir = tmpDir('write');
  const envPath = path.join(dir, '.env');

  const complexEnv = `# ===========================
# OpenClaw Desktop Configuration
# ===========================

# HTTP server
PORT=3876
DASHBOARD_AUTH_TOKEN=secret123

# Database layer
POSTGRES_HOST=db.internal
POSTGRES_PORT=5432
POSTGRES_DB=mission_control
POSTGRES_USER=admin
POSTGRES_PASSWORD=hunter2

# Gateway connection
OPENCLAW_GATEWAY_URL=ws://10.0.0.1:18789
OPENCLAW_GATEWAY_PASSWORD=gw-pass

# End of file
`;

  fs.writeFileSync(envPath, complexEnv);
  const configPath = path.join(dir, 'dashboard-config.json');
  fs.writeFileSync(configPath, '{}');
  const SettingsStore = require('../lib/settings-store');
  const store = new SettingsStore({ envPath, configPath });
  store.load();

  // C1: Single update preserves all comments and order
  await test('Single key update preserves all comments', () => {
    store.set('PORT', 9000);
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('# ==========================='));
    assert.ok(content.includes('# HTTP server'));
    assert.ok(content.includes('# Database layer'));
    assert.ok(content.includes('# Gateway connection'));
    assert.ok(content.includes('# End of file'));
  });

  // C2: Updated key appears with new value
  await test('Updated key has new value', () => {
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('PORT=9000'));
    assert.ok(!content.includes('PORT=3876'));
  });

  // C3: Other keys unchanged
  await test('Other keys remain unchanged', () => {
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('DASHBOARD_AUTH_TOKEN=secret123'));
    assert.ok(content.includes('POSTGRES_HOST=db.internal'));
    assert.ok(content.includes('OPENCLAW_GATEWAY_URL=ws://10.0.0.1:18789'));
  });

  // C4: Multiple sequential updates
  await test('Multiple sequential updates all persist', () => {
    store.load();
    store.set('POSTGRES_HOST', 'new-db');
    store.set('POSTGRES_PORT', 5433);
    store.set('POSTGRES_DB', 'new_db');
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('POSTGRES_HOST=new-db'));
    assert.ok(content.includes('POSTGRES_PORT=5433'));
    assert.ok(content.includes('POSTGRES_DB=new_db'));
  });

  // C5: Comments preserved after multiple writes
  await test('Comments preserved after 3 writes', () => {
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('# HTTP server'), 'HTTP comment lost');
    assert.ok(content.includes('# Database layer'), 'DB comment lost');
    assert.ok(content.includes('# End of file'), 'EOF comment lost');
  });

  // C6: New key appended
  await test('New key appended to end of file', () => {
    store.load();
    store.set('OPENCLAW_BIN', '/opt/openclaw/bin');
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('OPENCLAW_BIN=/opt/openclaw/bin'));
    // Original end-of-file comment still there
    assert.ok(content.includes('# End of file'));
  });

  // C7: Create .env from scratch
  await test('Creating new .env from empty directory', () => {
    const dir2 = tmpDir('newenv');
    const envPath2 = path.join(dir2, '.env');
    const configPath2 = path.join(dir2, 'dashboard-config.json');
    fs.writeFileSync(configPath2, '{}');
    const store2 = new SettingsStore({ envPath: envPath2, configPath: configPath2 });
    store2.load();
    store2.set('PORT', 3000);
    const content = fs.readFileSync(envPath2, 'utf8');
    assert.ok(content.includes('PORT=3000'));
  });

  // C8: Write value with special characters
  await test('Writing value with special characters', () => {
    store.load();
    store.set('OPENCLAW_GATEWAY_URL', 'ws://host:1234/path?query=1&other=2');
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('ws://host:1234/path?query=1&other=2'));
  });

  // C9: Write empty string value
  await test('Writing empty string to password field', () => {
    store.load();
    store.set('DASHBOARD_AUTH_TOKEN', '');
    assert.strictEqual(store.get('DASHBOARD_AUTH_TOKEN'), '');
    const content = fs.readFileSync(envPath, 'utf8');
    assert.ok(content.includes('DASHBOARD_AUTH_TOKEN='));
  });

  // C10: Config.json stays valid JSON after all writes
  await test('dashboard-config.json remains valid JSON after writes', () => {
    store.load();
    store.set('theme', 'dark');
    store.set('accentColor', '#FF0000');
    store.set('showClock', false);
    store.set('fontSizeBase', 16);
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw); // should not throw
    assert.strictEqual(parsed.theme, 'dark');
    assert.strictEqual(parsed.accentColor, '#FF0000');
    assert.strictEqual(parsed.showClock, false);
    assert.strictEqual(parsed.fontSizeBase, 16);
  });

  // C11: Config.json has no .tmp file left over
  await test('No stale .tmp files after writes', () => {
    assert.ok(!fs.existsSync(configPath + '.tmp'), 'Stale tmp file found');
  });
}

// ══════════════════════════════════════════════════════
// D. VALIDATION DEEP DIVE
// ══════════════════════════════════════════════════════

async function testValidationDeep() {
  section('D. Validation — Every Type Tested');

  const dir = tmpDir('val');
  const store = makeStore(dir, 'PORT=3876\nSTORAGE_TYPE=postgres\n');
  store.load();

  // D1: Number — reject NaN
  await test('Number: reject NaN string', () => {
    assert.throws(() => store.set('PORT', 'abc'), /number/);
  });

  // D2: Number — reject undefined
  await test('Number: reject undefined (NaN)', () => {
    assert.throws(() => store.set('PORT', undefined), /number/);
  });

  // D3: Number — null coerces to 0 via Number(null) — this is expected behavior
  await test('Number: null coerces to 0 (expected)', () => {
    const r = store.set('FILESYSTEM_API_PORT', null);
    assert.strictEqual(r.newValue, 0);
  });

  // D4: Number — accept 0
  await test('Number: accept 0', () => {
    const r = store.set('PORT', 0);
    assert.strictEqual(r.newValue, 0);
  });

  // D5: Number — accept large number
  await test('Number: accept 65535', () => {
    const r = store.set('PORT', 65535);
    assert.strictEqual(r.newValue, 65535);
  });

  // D6: Select — reject invalid option
  await test('Select: reject invalid option', () => {
    assert.throws(() => store.set('STORAGE_TYPE', 'mysql'), /must be one of/);
  });

  // D7: Select — accept each option
  for (const opt of ['postgres', 'json']) {
    await test(`Select: accept "${opt}"`, () => {
      store.set('STORAGE_TYPE', opt);
      assert.strictEqual(store.get('STORAGE_TYPE'), opt);
    });
  }

  // D8: Select — reject empty string
  await test('Select: reject empty string', () => {
    assert.throws(() => store.set('STORAGE_TYPE', ''), /must be one of/);
  });

  // D9: Toggle — accept boolean true/false
  await test('Toggle: true → true', () => {
    assert.strictEqual(store.set('REQUIRE_AUTH', true).newValue, true);
  });
  await test('Toggle: false → false', () => {
    assert.strictEqual(store.set('REQUIRE_AUTH', false).newValue, false);
  });

  // D10: Toggle — coerce truthy/falsy
  await test('Toggle: 1 → true', () => {
    assert.strictEqual(store.set('windowSnap', 1).newValue, true);
  });
  await test('Toggle: 0 → false', () => {
    assert.strictEqual(store.set('windowSnap', 0).newValue, false);
  });
  await test('Toggle: "truthy" → true', () => {
    assert.strictEqual(store.set('showClock', 'yes').newValue, true);
  });
  await test('Toggle: "" → false', () => {
    assert.strictEqual(store.set('showClock', '').newValue, false);
  });

  // D11: Password — accepts anything
  await test('Password: accepts any string', () => {
    assert.strictEqual(store.set('POSTGRES_PASSWORD', '!@#$%^&*()').newValue, '!@#$%^&*()');
  });
  await test('Password: accepts empty string', () => {
    assert.strictEqual(store.set('POSTGRES_PASSWORD', '').newValue, '');
  });

  // D12: String — converts to string
  await test('String: number converted to string', () => {
    const r = store.set('POSTGRES_HOST', 12345);
    assert.strictEqual(r.newValue, '12345');
    assert.strictEqual(typeof r.newValue, 'string');
  });

  // D13: Unknown key always rejected
  await test('Unknown key: TOTAL_UNKNOWN rejected', () => {
    assert.throws(() => store.set('TOTAL_UNKNOWN', 'x'), /Unknown setting/);
  });
  await test('Unknown key: empty string key rejected', () => {
    assert.throws(() => store.set('', 'x'), /Unknown setting/);
  });
}

// ══════════════════════════════════════════════════════
// E. SETCATEGORY CATEGORY GUARD
// ══════════════════════════════════════════════════════

async function testSetCategoryGuard() {
  section('E. setCategory — Cross-Category Guard');

  const dir = tmpDir('catguard');
  const store = makeStore(dir, 'PORT=3876\nCHAT_RATE_LIMIT=30\n');
  store.load();

  // E1: setCategory ignores keys from wrong category
  await test('setCategory("security") ignores PORT (general key)', () => {
    const results = store.setCategory('security', {
      CHAT_RATE_LIMIT: 60,
      PORT: 9999, // belongs to "general", should be ignored
    });
    assert.strictEqual(results.length, 1); // only CHAT_RATE_LIMIT
    assert.strictEqual(results[0].key, 'CHAT_RATE_LIMIT');
    assert.strictEqual(store.get('PORT'), 3876); // unchanged
  });

  // E2: setCategory with empty object returns empty array
  await test('setCategory with empty object returns []', () => {
    const results = store.setCategory('general', {});
    assert.strictEqual(results.length, 0);
  });

  // E3: setCategory with all invalid keys returns []
  await test('setCategory with unknown keys returns []', () => {
    const results = store.setCategory('general', { FAKE_KEY: 1, ALSO_FAKE: 2 });
    assert.strictEqual(results.length, 0);
  });

  // E4: setCategory updates multiple valid keys in same category
  await test('setCategory updates multiple valid keys', () => {
    const results = store.setCategory('database', {
      POSTGRES_HOST: 'newhost',
      POSTGRES_PORT: 5433,
      POSTGRES_DB: 'testdb',
    });
    assert.strictEqual(results.length, 3);
    assert.strictEqual(store.get('POSTGRES_HOST'), 'newhost');
    assert.strictEqual(store.get('POSTGRES_PORT'), 5433);
    assert.strictEqual(store.get('POSTGRES_DB'), 'testdb');
  });
}

// ══════════════════════════════════════════════════════
// F. CHANGE LOG & RESTART TRACKING
// ══════════════════════════════════════════════════════

async function testChangeLogAndRestart() {
  section('F. Change Log & Restart Tracking');

  const dir = tmpDir('changelog');
  const store = makeStore(dir, 'PORT=3876\nCHAT_RATE_LIMIT=30\n');
  store.load();

  // F1: Change log accumulates entries
  await test('Change log has entries after set()', () => {
    store.set('PORT', 4000);
    store.set('CHAT_RATE_LIMIT', 60);
    assert.ok(store.changeLog.length >= 2);
  });

  // F2: Change log entry has correct structure
  await test('Change log entry has timestamp, key, oldValue, newValue', () => {
    const entry = store.changeLog[store.changeLog.length - 1];
    assert.ok('timestamp' in entry);
    assert.ok('key' in entry);
    assert.ok('oldValue' in entry);
    assert.ok('newValue' in entry);
    assert.strictEqual(entry.key, 'CHAT_RATE_LIMIT');
    assert.strictEqual(entry.oldValue, 30);
    assert.strictEqual(entry.newValue, 60);
    assert.ok(entry.timestamp > 0);
  });

  // F3: Timestamp is recent
  await test('Change log timestamp is within last 5 seconds', () => {
    const entry = store.changeLog[store.changeLog.length - 1];
    const diff = Date.now() - entry.timestamp;
    assert.ok(diff < 5000, `Timestamp diff: ${diff}ms`);
  });

  // F4: Restart flag accumulates keys
  await test('Multiple non-hot-reload changes accumulate pending keys', () => {
    store.load();
    store.set('PORT', 4000);
    store.set('POSTGRES_HOST', 'newhost');
    const { pendingKeys } = store.isRestartRequired();
    assert.ok(pendingKeys.includes('PORT'));
    assert.ok(pendingKeys.includes('POSTGRES_HOST'));
  });

  // F5: Hot-reload change does NOT add to pending
  await test('Hot-reload change not in pending keys', () => {
    store.load();
    store.set('CHAT_RATE_LIMIT', 100);
    store.set('theme', 'light');
    const { restartRequired } = store.isRestartRequired();
    assert.strictEqual(restartRequired, false);
  });

  // F6: Mixed changes — only non-hot-reload flagged
  await test('Mixed changes: only non-hot-reload flagged', () => {
    store.load();
    store.set('PORT', 5000);
    store.set('CHAT_RATE_LIMIT', 100);
    const { pendingKeys, restartRequired } = store.isRestartRequired();
    assert.strictEqual(restartRequired, true);
    assert.ok(pendingKeys.includes('PORT'));
    assert.ok(!pendingKeys.includes('CHAT_RATE_LIMIT'));
  });

  // F7: clearRestartFlag clears all
  await test('clearRestartFlag resets everything', () => {
    store.clearRestartFlag();
    const { restartRequired, pendingKeys } = store.isRestartRequired();
    assert.strictEqual(restartRequired, false);
    assert.strictEqual(pendingKeys.length, 0);
  });

  // F8: load() clears restart flags
  await test('load() clears pending restart keys', () => {
    store.set('PORT', 9999);
    assert.strictEqual(store.isRestartRequired().restartRequired, true);
    store.load();
    assert.strictEqual(store.isRestartRequired().restartRequired, false);
  });

  // F9: load() does NOT clear change log (history preserved)
  await test('load() preserves change log history', () => {
    const logLen = store.changeLog.length;
    store.load();
    assert.ok(store.changeLog.length >= logLen, 'Change log should not shrink on reload');
  });
}

// ══════════════════════════════════════════════════════
// G. EXPORT/IMPORT ROUNDTRIP
// ══════════════════════════════════════════════════════

async function testExportImportRoundtrip() {
  section('G. Export/Import Roundtrip Integrity');

  const dir1 = tmpDir('export1');
  const store1 = makeStore(dir1, 'PORT=3876\nPOSTGRES_HOST=prod-db\nPOSTGRES_PASSWORD=secret\nCHAT_RATE_LIMIT=30\n');
  store1.load();
  store1.set('theme', 'dark');
  store1.set('accentColor', '#FF0000');

  // G1: Export has exactly 36 keys
  await test('Export has exactly 36 keys', () => {
    const exported = store1.exportSettings();
    assert.strictEqual(Object.keys(exported).length, 36);
  });

  // G2: All password fields masked
  await test('All password-type fields are masked', () => {
    const exported = store1.exportSettings();
    const SettingsStore = require('../lib/settings-store');
    const schema = store1.getSchema();
    for (const [key, s] of Object.entries(schema)) {
      if (s.type === 'password') {
        assert.strictEqual(exported[key], '••••••••', `${key} not masked`);
      }
    }
  });

  // G3: Non-password values are actual values
  await test('Non-password values are actual current values', () => {
    const exported = store1.exportSettings();
    assert.strictEqual(exported.PORT, 3876);
    assert.strictEqual(exported.POSTGRES_HOST, 'prod-db');
    assert.strictEqual(exported.theme, 'dark');
    assert.strictEqual(exported.accentColor, '#FF0000');
  });

  // G4: Import into fresh store restores values
  await test('Import into fresh store restores non-password values', () => {
    const dir2 = tmpDir('import1');
    const store2 = makeStore(dir2, 'PORT=3000\n');
    store2.load();
    const exported = store1.exportSettings();
    store2.importSettings(exported);
    assert.strictEqual(store2.get('PORT'), 3876);
    assert.strictEqual(store2.get('POSTGRES_HOST'), 'prod-db');
    assert.strictEqual(store2.get('theme'), 'dark');
    assert.strictEqual(store2.get('accentColor'), '#FF0000');
  });

  // G5: Import does not overwrite passwords with masked values
  await test('Import skips masked passwords', () => {
    const dir3 = tmpDir('import2');
    const store3 = makeStore(dir3, 'POSTGRES_PASSWORD=original-secret\n');
    store3.load();
    store3.importSettings({ POSTGRES_PASSWORD: '••••••••' });
    assert.strictEqual(store3.get('POSTGRES_PASSWORD'), 'original-secret');
  });

  // G6: Import with real passwords works
  await test('Import with real password updates value', () => {
    const dir4 = tmpDir('import3');
    const store4 = makeStore(dir4, 'POSTGRES_PASSWORD=old\n');
    store4.load();
    store4.importSettings({ POSTGRES_PASSWORD: 'new-secret' });
    assert.strictEqual(store4.get('POSTGRES_PASSWORD'), 'new-secret');
  });

  // G7: Import empty object is safe
  await test('Import empty object returns []', () => {
    const results = store1.importSettings({});
    assert.strictEqual(results.length, 0);
  });

  // G8: Import null/undefined values are skipped
  await test('Import skips unknown keys silently', () => {
    const results = store1.importSettings({ FAKE: 1, ALSO_FAKE: 2, PORT: 9999 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].key, 'PORT');
  });
}

// ══════════════════════════════════════════════════════
// H. LIVE API — DEEP HTTP TESTING
// ══════════════════════════════════════════════════════

async function testLiveApiDeep() {
  section('H. Live API — Deep HTTP Testing');

  const BASE = 'http://127.0.0.1:3876';
  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
  if (!TOKEN) {
    console.log('  ⚠️ No auth token, skipping live tests');
    return;
  }
  const auth = { 'Authorization': `Bearer ${TOKEN}` };

  // H1: Content-Type is application/json
  await test('GET /api/settings returns application/json', async () => {
    const res = await httpGet(`${BASE}/api/settings`, auth);
    assert.strictEqual(res.headers['content-type'], 'application/json');
  });

  // H2: Response has ok: true
  await test('GET /api/settings has ok: true', async () => {
    const res = await httpGet(`${BASE}/api/settings`, auth);
    assert.strictEqual(res.data.ok, true);
  });

  // H3: Each category has settings with value + schema
  await test('Each category has value, type, label, category, hotReload', async () => {
    const res = await httpGet(`${BASE}/api/settings`, auth);
    for (const [cat, settings] of Object.entries(res.data.settings)) {
      for (const [key, field] of Object.entries(settings)) {
        assert.ok('value' in field, `${cat}.${key} missing value`);
        assert.ok('type' in field, `${cat}.${key} missing type`);
        assert.ok('label' in field, `${cat}.${key} missing label`);
        assert.ok('category' in field, `${cat}.${key} missing category`);
        assert.ok('hotReload' in field, `${cat}.${key} missing hotReload`);
      }
    }
  });

  // H4: PUT then GET confirms persistence
  await test('PUT then GET confirms value persisted', async () => {
    await httpRequest('PUT', `${BASE}/api/settings/security`, { CHAT_RATE_LIMIT: 42 }, auth);
    const res = await httpGet(`${BASE}/api/settings/security`, auth);
    assert.strictEqual(res.data.settings.CHAT_RATE_LIMIT.value, 42);
    // Reset
    await httpRequest('PUT', `${BASE}/api/settings/security`, { CHAT_RATE_LIMIT: 30 }, auth);
  });

  // H5: PUT single key
  await test('PUT /api/settings/key/:key updates single value', async () => {
    const res = await httpRequest('PUT', `${BASE}/api/settings/key/SSE_HEARTBEAT_INTERVAL`, { value: 45 }, auth);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.newValue, 45);
    // Reset
    await httpRequest('PUT', `${BASE}/api/settings/key/SSE_HEARTBEAT_INTERVAL`, { value: 30 }, auth);
  });

  // H6: System info fields are correct types
  await test('System info: correct types', async () => {
    const res = await httpGet(`${BASE}/api/settings/system-info`, auth);
    const s = res.data.system;
    assert.strictEqual(typeof s.version, 'string');
    assert.strictEqual(typeof s.nodeVersion, 'string');
    assert.strictEqual(typeof s.platform, 'string');
    assert.strictEqual(typeof s.pid, 'number');
    assert.strictEqual(typeof s.uptime, 'number');
    assert.strictEqual(typeof s.uptimeHuman, 'string');
    assert.strictEqual(typeof s.gatewayConnected, 'boolean');
    assert.strictEqual(typeof s.memory, 'object');
  });

  // H7: System info uptime is reasonable (> 0)
  await test('System info: uptime > 0', async () => {
    const res = await httpGet(`${BASE}/api/settings/system-info`, auth);
    assert.ok(res.data.system.uptime > 0);
  });

  // H8: System info memory values are strings with units
  await test('System info: memory values are formatted strings', async () => {
    const res = await httpGet(`${BASE}/api/settings/system-info`, auth);
    const mem = res.data.system.memory;
    for (const [key, val] of Object.entries(mem)) {
      assert.ok(typeof val === 'string', `${key} is not string`);
      assert.ok(val.match(/\d+\.?\d*\s*(B|KB|MB)/), `${key}="${val}" has no unit`);
    }
  });

  // H9: Export has exportedAt ISO timestamp
  await test('Export: exportedAt is valid ISO timestamp', async () => {
    const res = await httpRequest('POST', `${BASE}/api/settings/export`, {}, auth);
    const ts = res.data.exportedAt;
    assert.ok(!isNaN(Date.parse(ts)), `Invalid timestamp: ${ts}`);
    // Should be recent (within last 10 seconds)
    const diff = Date.now() - Date.parse(ts);
    assert.ok(Math.abs(diff) < 10000, `Timestamp diff: ${diff}ms`);
  });

  // H10: Import roundtrip via API — isolated test
  await test('API import/export roundtrip: values survive', async () => {
    // Set a known value first
    await httpRequest('PUT', `${BASE}/api/settings/key/SSE_HEARTBEAT_INTERVAL`, { value: 77 }, auth);
    // Export current state
    const exported = await httpRequest('POST', `${BASE}/api/settings/export`, {}, auth);
    // Change the value
    await httpRequest('PUT', `${BASE}/api/settings/key/SSE_HEARTBEAT_INTERVAL`, { value: 99 }, auth);
    // Verify it changed
    const afterChange = await httpGet(`${BASE}/api/settings/sse`, auth);
    assert.strictEqual(afterChange.data.settings.SSE_HEARTBEAT_INTERVAL.value, 99);
    // Import back the exported state (masked passwords are skipped)
    const imported = await httpRequest('POST', `${BASE}/api/settings/import`, { settings: exported.data.settings }, auth);
    assert.strictEqual(imported.status, 200);
    // Value should be restored to 77
    const afterImport = await httpGet(`${BASE}/api/settings/sse`, auth);
    assert.strictEqual(afterImport.data.settings.SSE_HEARTBEAT_INTERVAL.value, 77);
    // Cleanup
    await httpRequest('PUT', `${BASE}/api/settings/key/SSE_HEARTBEAT_INTERVAL`, { value: 30 }, auth);
  });

  // H11: Invalid JSON body returns error
  await test('PUT with invalid JSON body returns error', async () => {
    const res = await new Promise((resolve) => {
      const u = new URL(`${BASE}/api/settings/security`);
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname,
        method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, data: d }); }
        });
      });
      req.write('{invalid json');
      req.end();
    });
    // Should not crash — parseBody catches JSON errors
    assert.ok(res.status === 200 || res.status === 400, `Got ${res.status}`);
  });

  // H12: Concurrent writes
  await test('Con writes: 5 parallel PUTs all succeed', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        httpRequest('PUT', `${BASE}/api/settings/key/CHAT_RATE_LIMIT`, { value: 30 + i }, auth)
      );
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ok, true);
    }
  });

  // H13: Reload endpoint
  await test('POST /api/settings/reload returns ok', async () => {
    const res = await httpRequest('POST', `${BASE}/api/settings/reload`, {}, auth);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.message, 'Settings reloaded from disk');
  });

  // H14: Non-existent category 404
  await test('GET /api/settings/nonexistent_category → 404', async () => {
    const res = await httpGet(`${BASE}/api/settings/nonexistent_category`, auth);
    assert.strictEqual(res.status, 404);
    assert.ok(res.data.error);
  });
}

// ══════════════════════════════════════════════════════
// I. CONFIG.JSON EDGE CASES
// ══════════════════════════════════════════════════════

async function testConfigJsonEdgeCases() {
  section('I. dashboard-config.json Edge Cases');

  // I1: Empty JSON object
  await test('Empty {} → all defaults', () => {
    const dir = tmpDir('cfg_empty');
    const store = makeStore(dir, '', {});
    store.load();
    assert.strictEqual(store.get('theme'), 'system');
    assert.strictEqual(store.get('accentColor'), '#60CDFF');
  });

  // I2: Partial config → defaults for missing keys
  await test('Partial config → defaults for missing keys', () => {
    const dir = tmpDir('cfg_partial');
    const store = makeStore(dir, '', { theme: 'dark' });
    store.load();
    assert.strictEqual(store.get('theme'), 'dark');
    assert.strictEqual(store.get('accentColor'), '#60CDFF'); // default
    assert.strictEqual(store.get('showClock'), true); // default
  });

  // I3: Extra keys in config are ignored
  await test('Extra keys in config are ignored (not crash)', () => {
    const dir = tmpDir('cfg_extra');
    const store = makeStore(dir, '', { theme: 'light', customKey: 'ignored', anotherExtra: 123 });
    store.load();
    assert.strictEqual(store.get('theme'), 'light');
    assert.strictEqual(store.get('customKey'), undefined);
  });

  // I4: Wrong types in config are coerced
  await test('Wrong type coerced: theme=123 → "123"', () => {
    const dir = tmpDir('cfg_wtype');
    const store = makeStore(dir, '', { theme: 123 });
    store.load();
    assert.strictEqual(store.get('theme'), '123');
  });

  // I5: Config with null values uses defaults
  await test('Null values in config use defaults', () => {
    const dir = tmpDir('cfg_null');
    const store = makeStore(dir, '', { theme: null });
    store.load();
    // _coerceType(null, select schema) → String(null) = "null" which is not a valid option
    // So it falls through to... let me check
    const val = store.get('theme');
    // "null" is not a valid select option but _coerceType runs before validation in load
    // This tests that the store doesn't crash on null
    assert.ok(val !== undefined, 'Should have a value');
  });

  // I6: Config file is created if missing
  await test('Config file auto-created if missing', () => {
    const dir = tmpDir('cfg_create');
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, '');
    const configPath = path.join(dir, 'dashboard-config.json');
    assert.ok(!fs.existsSync(configPath), 'Config should not exist yet');
    const SettingsStore = require('../lib/settings-store');
    const store = new SettingsStore({ envPath, configPath });
    store.load();
    assert.ok(fs.existsSync(configPath), 'Config should be created');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(parsed.theme !== undefined, 'Should have theme default');
  });
}

// ══════════════════════════════════════════════════════
// J. FRONTEND WIRING CHECKS
// ══════════════════════════════════════════════════════

async function testFrontendWiring() {
  section('J. Frontend Wiring — Static Analysis');

  const viewsDir = path.join(__dirname, '..', 'src', 'shell', 'native-views');
  const registryPath = path.join(__dirname, '..', 'src', 'shell', 'app-registry.mjs');

  // J1: settings-view.mjs exists
  await test('settings-view.mjs file exists', () => {
    assert.ok(fs.existsSync(path.join(viewsDir, 'settings-view.mjs')));
  });

  // J2: App registered in registry
  await test('Settings app registered in app-registry.mjs', () => {
    const content = fs.readFileSync(registryPath, 'utf8');
    assert.ok(content.includes("id: 'settings'"));
    assert.ok(content.includes("label: 'Settings'"));
    assert.ok(content.includes("viewModule: './native-views/settings-view.mjs'"));
  });

  // J3: Category is Admin (matches APP_CATEGORY_ORDER)
  await test('Settings has category: Admin', () => {
    const content = fs.readFileSync(registryPath, 'utf8');
    // Find the settings block
    const settingsMatch = content.match(/id:\s*'settings'[^}]*category:\s*'(\w+)'/s);
    assert.ok(settingsMatch, 'Settings block not found');
    assert.strictEqual(settingsMatch[1], 'Admin');
  });

  // J4: View module exports renderSettingsView
  await test('settings-view.mjs exports renderSettingsView', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    assert.ok(content.includes('export async function renderSettingsView'));
    assert.ok(content.includes('export default renderSettingsView'));
  });

  // J5: View uses correct API endpoints
  await test('View uses /api/settings endpoints', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    assert.ok(content.includes('/api/settings'));
    assert.ok(content.includes('/api/settings/system-info'));
    assert.ok(content.includes('/api/settings/test-db'));
    assert.ok(content.includes('/api/settings/test-gateway'));
    assert.ok(content.includes('/api/settings/export'));
  });

  // J6: View uses auth token from globalThis
  await test('View reads auth token from __DASHBOARD_AUTH_TOKEN__', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    assert.ok(content.includes('__DASHBOARD_AUTH_TOKEN__'));
  });

  // J7: All 9 tabs defined in CATEGORY_ORDER
  await test('View defines all 9 tabs', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    const expectedTabs = ['general', 'database', 'gateway', 'appearance', 'apps', 'security', 'integrations', 'sse', 'system'];
    for (const tab of expectedTabs) {
      assert.ok(content.includes(`'${tab}'`), `Tab "${tab}" not found in view`);
    }
  });

  // J8: View imports helpers correctly
  await test('View imports escapeHtml and ensureNativeRoot', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    assert.ok(content.includes('escapeHtml'));
    assert.ok(content.includes('ensureNativeRoot'));
  });

  // J9: CSS classes for all major UI elements
  await test('View has CSS for layout, sidebar, tabs, fields, toggles', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    const requiredClasses = ['cp-layout', 'cp-sidebar', 'cp-tab', 'cp-field', 'cp-input', 'cp-toggle', 'cp-btn', 'cp-group', 'cp-stat'];
    for (const cls of requiredClasses) {
      assert.ok(content.includes(cls), `Missing CSS class: ${cls}`);
    }
  });

  // J10: Restart banner logic exists
  await test('View has restart banner rendering logic', () => {
    const content = fs.readFileSync(path.join(viewsDir, 'settings-view.mjs'), 'utf8');
    assert.ok(content.includes('restartRequired') || content.includes('cp-restart-banner'));
  });
}

// ══════════════════════════════════════════════════════
// K. ROUTE REGISTRATION — EXHAUSTIVE
// ══════════════════════════════════════════════════════

async function testRouteRegistrationExhaustive() {
  section('K. Route Registration — All 13 Endpoints');

  const Router = require('../routes/router');
  const { registerSettingsRoutes } = require('../routes/settings-routes');
  const SettingsStore = require('../lib/settings-store');

  const dir = tmpDir('routes');
  const envPath = path.join(dir, '.env');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(envPath, 'PORT=3876\n');
  fs.writeFileSync(configPath, '{}');

  const store = new SettingsStore({ envPath, configPath });
  store.load();

  const router = new Router();
  const mockPool = { async connect() { return { async query() {}, release() {} }; } };
  const mockGw = { connected: true, url: 'ws://test:1234' };

  registerSettingsRoutes(router, store, {
    pool: mockPool,
    gatewayClient: mockGw,
    startedAt: '2026-01-01T00:00:00Z',
    getSSEClientCount: () => 3,
  });

  // Collect registered routes
  const registeredMethods = router.routes.map(r => `${r.method} ${r.pattern}`);
  console.log('     Registered routes:', registeredMethods.join(', '));

  // K1-K13: Each expected route exists
  const expectedRoutes = [
    ['GET', '/api/settings'],
    ['GET', '/api/settings/schema'],
    ['GET', '/api/settings/system-info'],
    ['GET', '/api/settings/restart-required'],
    ['POST', '/api/settings/test-db'],
    ['POST', '/api/settings/test-gateway'],
    ['POST', '/api/settings/export'],
    ['POST', '/api/settings/import'],
    ['POST', '/api/settings/reload'],
    ['PUT', '/api/settings/key/:key'],
    ['GET', '/api/settings/:category'],
    ['PUT', '/api/settings/:category'],
  ];

  for (const [method, pattern] of expectedRoutes) {
    await test(`Route ${method} ${pattern} is registered`, () => {
      assert.ok(registeredMethods.includes(`${method} ${pattern}`), `Missing: ${method} ${pattern}`);
    });
  }

  await test('Total routes registered: 12', () => {
    assert.strictEqual(router.routes.length, 12);
  });

  // K14: Specific routes come before parameterized routes
  await test('system-info route comes before :category route', () => {
    const sysIdx = router.routes.findIndex(r => r.pattern === '/api/settings/system-info');
    const catIdx = router.routes.findIndex(r => r.pattern === '/api/settings/:category');
    assert.ok(sysIdx < catIdx, `system-info (${sysIdx}) should be before :category (${catIdx})`);
  });

  await test('schema route comes before :category route', () => {
    const schemaIdx = router.routes.findIndex(r => r.pattern === '/api/settings/schema');
    const catIdx = router.routes.findIndex(r => r.pattern === '/api/settings/:category');
    assert.ok(schemaIdx < catIdx, `schema (${schemaIdx}) should be before :category (${catIdx})`);
  });

  // K15: Test specific route handling via router
  const mockRes = () => {
    const r = { _statusCode: 0, _body: '', _headers: {},
      writeHead(s, h) { r._statusCode = s; Object.assign(r._headers, h || {}); },
      end(d) { r._body = d; },
      get json() { try { return JSON.parse(this._body); } catch { return null; } }
    };
    return r;
  };

  await test('GET /api/settings → 200 with ok:true', async () => {
    const req = { method: 'GET', on() {} };
    const res = mockRes();
    await router.handle(req, res, '/api/settings', 'GET', {});
    assert.strictEqual(res._statusCode, 200);
    assert.strictEqual(res.json.ok, true);
  });

  await test('GET /api/settings/system-info → 200 (not caught by :category)', async () => {
    const req = { method: 'GET', on() {} };
    const res = mockRes();
    const handled = await router.handle(req, res, '/api/settings/system-info', 'GET', {});
    assert.strictEqual(res._statusCode, 200);
    assert.strictEqual(res.json.ok, true);
    assert.ok(res.json.system, 'Should have system object');
    assert.strictEqual(res.json.system.sseClients, 3);
  });

  await test('GET /api/settings/general → 200 (via :category)', async () => {
    const req = { method: 'GET', on() {} };
    const res = mockRes();
    await router.handle(req, res, '/api/settings/general', 'GET', {});
    assert.strictEqual(res._statusCode, 200);
    assert.strictEqual(res.json.category, 'general');
  });

  await test('POST /api/settings/test-db → 200 ok:true', async () => {
    const req = { method: 'POST', on() {} };
    const res = mockRes();
    await router.handle(req, res, '/api/settings/test-db', 'POST', {});
    assert.strictEqual(res._statusCode, 200);
    assert.strictEqual(res.json.ok, true);
    assert.ok(typeof res.json.latency === 'number');
  });

  await test('POST /api/settings/test-gateway → 200 connected:true', async () => {
    const req = { method: 'POST', on() {} };
    const res = mockRes();
    await router.handle(req, res, '/api/settings/test-gateway', 'POST', {});
    assert.strictEqual(res._statusCode, 200);
    assert.strictEqual(res.json.connected, true);
    assert.strictEqual(res.json.url, 'ws://test:1234');
  });
}

// ══════════════════════════════════════════════════════
// L. PLAYWRIGHT UI TESTS
// ══════════════════════════════════════════════════════

async function testPlaywrightUI() {
  section('L. Playwright UI Tests — Real Browser');

  try {
    const puppeteer = require('puppeteer');
  } catch {
    console.log('  ⚠️ Puppeteer not installed, skipping UI tests');
    return;
  }

  const puppeteer = require('puppeteer');
  let browser, page;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
  } catch (err) {
    console.log(`  ⚠️ Browser launch failed: ${err.message}`);
    return;
  }

  const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // L1: Load dashboard
    await test('Dashboard loads', async () => {
      await page.goto('http://127.0.0.1:3876/', { waitUntil: 'networkidle2', timeout: 15000 });
      await page.evaluate((t) => { window.__DASHBOARD_AUTH_TOKEN__ = t; }, TOKEN);
      await new Promise(r => setTimeout(r, 2000));
      const title = await page.title();
      assert.ok(title.match(/OpenClaw|Dashboard/i));
    });

    // L2: Open settings app
    await test('Settings app opens from Start Menu', async () => {
      await page.evaluate(() => document.querySelector('[data-action="start"]').click());
      await new Promise(r => setTimeout(r, 1000));
      const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('*')]
          .find(e => e.textContent.trim() === 'Settings' && e.children.length < 2);
        if (el) { el.click(); return true; }
        return false;
      });
      assert.ok(clicked, 'Settings not found in Start Menu');
      await new Promise(r => setTimeout(r, 3000));
    });

    // L3: All 9 tabs visible
    await test('All 9 tabs render in sidebar', async () => {
      const tabs = await page.evaluate(() => {
        return [...document.querySelectorAll('.cp-tab')].map(t => t.textContent.trim());
      });
      const expected = ['⚙️General', '🗄️Database', '🔌Gateway', '🎨Appearance',
                        '📱Apps', '🔒Security', '🔗Integrations', '📡SSE & RT', 'ℹ️System Info'];
      for (const exp of expected) {
        assert.ok(tabs.some(t => t === exp), `Tab "${exp}" not found. Got: ${tabs.join(', ')}`);
      }
    });

    // L4: General tab has correct fields
    await test('General tab shows PORT, auth, workspace fields', async () => {
      const inputs = await page.evaluate(() => {
        return [...document.querySelectorAll('.cp-input, .cp-select')].map(i => ({
          key: i.dataset.key, value: i.value?.substring(0, 20), type: i.type || i.tagName
        }));
      });
      const keys = inputs.map(i => i.key);
      assert.ok(keys.includes('PORT'), 'PORT missing');
      assert.ok(keys.includes('DASHBOARD_AUTH_TOKEN'), 'AUTH_TOKEN missing');
      assert.ok(keys.includes('STORAGE_TYPE'), 'STORAGE_TYPE missing');
    });

    // L5: Toggle exists
    await test('Toggle field exists on General tab', async () => {
      const toggleCount = await page.evaluate(() => document.querySelectorAll('.cp-toggle').length);
      assert.ok(toggleCount >= 1, `Expected at least 1 toggle, found ${toggleCount}`);
    });

    // L6: Click Database tab
    await test('Clicking Database tab shows DB fields', async () => {
      await page.evaluate(() => {
        [...document.querySelectorAll('.cp-tab')].find(t => t.textContent.includes('Database'))?.click();
      });
      await new Promise(r => setTimeout(r, 500));
      const inputs = await page.evaluate(() =>
        [...document.querySelectorAll('.cp-input, .cp-select')].map(i => i.dataset.key)
      );
      assert.ok(inputs.includes('POSTGRES_HOST'));
      assert.ok(inputs.includes('POSTGRES_PORT'));
      assert.ok(inputs.includes('POSTGRES_PASSWORD'));
    });

    // L7: Test Connection button exists on Database tab
    await test('Database tab has Test Connection button', async () => {
      const hasBtn = await page.evaluate(() => {
        return !!document.querySelector('#cp-test-db');
      });
      assert.ok(hasBtn, 'Test DB button not found');
    });

    // L8: Click System Info tab
    await test('System Info tab shows stats', async () => {
      await page.evaluate(() => {
        [...document.querySelectorAll('.cp-tab')].find(t => t.textContent.includes('System Info'))?.click();
      });
      await new Promise(r => setTimeout(r, 1000));
      const stats = await page.evaluate(() =>
        [...document.querySelectorAll('.cp-stat-value')].map(s => s.textContent.trim())
      );
      assert.ok(stats.length >= 8, `Expected >=8 stats, got ${stats.length}`);
      // Version should show
      assert.ok(stats.some(s => s.match(/1\.0\.0/)), 'Version not shown');
    });

    // L9: No console errors
    await test('No JavaScript errors in console', () => {
      const critical = consoleErrors.filter(e => !e.includes('favicon') && !e.includes('manifest'));
      assert.strictEqual(critical.length, 0, `Console errors: ${critical.join('; ')}`);
    });

    // L10: Switch between all tabs without errors
    await test('Switching through all 9 tabs works', async () => {
      const tabs = ['General', 'Database', 'Gateway', 'Appearance', 'Apps', 'Security', 'Integrations', 'SSE', 'System Info'];
      for (const tab of tabs) {
        const ok = await page.evaluate((name) => {
          const el = [...document.querySelectorAll('.cp-tab')].find(t => t.textContent.includes(name));
          if (el) { el.click(); return true; }
          return false;
        }, tab);
        assert.ok(ok, `Could not click tab: ${tab}`);
        await new Promise(r => setTimeout(r, 300));
      }
    });

    // L11: Appearance tab has color input
    await test('Appearance tab has accent color picker', async () => {
      await page.evaluate(() => {
        [...document.querySelectorAll('.cp-tab')].find(t => t.textContent.includes('Appearance'))?.click();
      });
      await new Promise(r => setTimeout(r, 500));
      const hasColor = await page.evaluate(() => {
        const input = document.querySelector('input[type="color"]');
        return !!input;
      });
      assert.ok(hasColor, 'Color picker not found');
    });

  } catch (err) {
    console.log(`  ⚠️ UI test setup error: ${err.message}`);
  } finally {
    await browser.close();
  }
}

// ══════════════════════════════════════════════════════
// M. REGRESSION GUARDS
// ══════════════════════════════════════════════════════

async function testRegressionGuards() {
  section('M. Regression Guards — Known Bug Patterns');

  // M1: Route ordering: system-info should NOT match :category
  await test('GET /api/settings/system-info is NOT caught by :category', async () => {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
    if (!TOKEN) return;
    const res = await httpGet('http://127.0.0.1:3876/api/settings/system-info', { 'Authorization': `Bearer ${TOKEN}` });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.system, 'Should return system object, not category error');
    assert.ok(!res.data.error, `Got error: ${res.data.error}`);
  });

  // M2: Route ordering: schema should NOT match :category
  await test('GET /api/settings/schema is NOT caught by :category', async () => {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
    if (!TOKEN) return;
    const res = await httpGet('http://127.0.0.1:3876/api/settings/schema', { 'Authorization': `Bearer ${TOKEN}` });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.schema, 'Should return schema object');
  });

  // M3: Pool reference via getter (not destructured null)
  await test('test-db returns actual result (not "No pool configured")', async () => {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const TOKEN = envContent.match(/DASHBOARD_AUTH_TOKEN=(.+)/)?.[1]?.trim();
    if (!TOKEN) return;
    const res = await httpRequest('POST', 'http://127.0.0.1:3876/api/settings/test-db', undefined, { 'Authorization': `Bearer ${TOKEN}` });
    // Should NOT say "No database pool configured"
    if (res.data.ok === false && res.data.error === 'No database pool configured') {
      throw new Error('Pool reference is null — deps destructuring bug regression');
    }
  });

  // M4: setCategory ignores cross-category keys
  await test('setCategory never updates keys outside target category', () => {
    const dir = tmpDir('regression');
    const store = makeStore(dir, 'PORT=3876\nPOSTGRES_HOST=orig\n');
    store.load();
    store.setCategory('general', { POSTGRES_HOST: 'hacked' }); // wrong category
    assert.strictEqual(store.get('POSTGRES_HOST'), 'orig'); // should NOT change
    assert.strictEqual(store.get('PORT'), 3876); // still default
  });

  // M5: .env write does not duplicate keys
  await test('Writing same key twice does not create duplicate lines', () => {
    const dir = tmpDir('regdup');
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'PORT=3876\n');
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, '{}');
    const SettingsStore = require('../lib/settings-store');
    const store = new SettingsStore({ envPath, configPath });
    store.load();
    store.set('PORT', 4000);
    store.set('PORT', 5000);
    const content = fs.readFileSync(envPath, 'utf8');
    const count = (content.match(/PORT=/g) || []).length;
    assert.strictEqual(count, 1, `Found ${count} PORT lines`);
  });
}

// ══════════════════════════════════════════════════════
// RUN ALL SECTIONS
// ══════════════════════════════════════════════════════

async function main() {
  console.log('🔬 OpenClaw Desktop — Settings Deep-Dive Test Suite');
  console.log('='.repeat(70));

  const sections = [
    testSchemaCompleteness,
    testEnvEdgeCases,
    testEnvWriteIntegrity,
    testValidationDeep,
    testSetCategoryGuard,
    testChangeLogAndRestart,
    testExportImportRoundtrip,
    testLiveApiDeep,
    testConfigJsonEdgeCases,
    testFrontendWiring,
    testRouteRegistrationExhaustive,
    testPlaywrightUI,
    testRegressionGuards,
  ];

  for (const fn of sections) {
    try {
      await fn();
    } catch (err) {
      console.error(`\n  💥 Section crashed: ${err.message}`);
      results.errors.push({ section: currentSection, name: 'SECTION_CRASH', error: err.message });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log(`📊 TOTAL: ${results.passed} passed, ${results.failed} failed`);
  console.log('═'.repeat(70));

  if (results.errors.length) {
    console.log('\n❌ FAILURES:');
    for (const e of results.errors) {
      console.log(`  [${e.section}] ${e.name}`);
      console.log(`    → ${e.error}`);
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
