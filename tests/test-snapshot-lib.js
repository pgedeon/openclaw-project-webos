#!/usr/bin/env node
/**
 * Focused DB-free tests for the snapshot/restore slice-1 pure libraries:
 *   lib/snapshot-manifest.js  — buildManifest / validateManifest / compareSchemaVersions
 *   lib/snapshot-diff.js      — canonicalRowHash / classifyRows
 *   lib/snapshot-redact.js    — redactDeep / redactSettings
 *
 * Covers docs/briefs/snapshot-restore.md acceptance criteria AC1–AC4 + AC13
 * (route-level AC5–AC12 live in tests/test-snapshot-routes.js, slice 2).
 * Run: node tests/test-snapshot-lib.js
 */

const assert = require('assert');
const {
  ARTIFACT_VERSION,
  canonicalJson,
  buildManifest,
  validateManifest,
  compareSchemaVersions,
} = require('../lib/snapshot-manifest');
const { canonicalRowHash, classifyRows } = require('../lib/snapshot-diff');
const { DENY_RE, redactDeep, redactSettings } = require('../lib/snapshot-redact');

let group = 0;
function ok(name, fn) {
  group += 1;
  fn();
  console.log(`PASS [${String(group).padStart(2, '0')}] ${name}`);
}

// ── Shared fixtures ──────────────────────────────────────────────

const T0 = '2026-08-24T12:00:00.000Z';
const OPTS = {
  snapshotId: '11111111-2222-4333-8444-555555555555',
  name: 'snapshot-20260824-1400',
  createdAt: T0,
  generator: 'openclaw-project-webos test',
};

function fixtureRows() {
  return {
    workflows: [{ id: 'wf1', name: 'nightly' }],
    tasks: [
      { id: 't1', workflow_id: 'wf1', title: 'a' },
      { id: 't2', workflow_id: 'wf1', title: 'b' },
      { id: 't3', workflow_id: 'wf1', title: 'c' },
    ],
    workflow_runs: [],
  };
}

/** Grouped getAll()-shaped settings fixture (lib/settings-store.js shape). */
function fixtureGetAll() {
  return {
    general: {
      PORT: { value: 3876, type: 'number', source: 'env' },
      DASHBOARD_AUTH_TOKEN: { value: 'hunter2', type: 'password', source: 'env' },
      REQUIRE_AUTH: { value: true, type: 'toggle', source: 'env' },
    },
    database: {
      POSTGRES_PASSWORD: { value: 'p@ssw0rd-marker', type: 'password', source: 'env' },
    },
    security: {
      CHAT_RATE_LIMIT: { value: 30, type: 'number', source: 'config' },
      MAX_MESSAGE_LENGTH: { value: 10000, type: 'number', source: 'config' },
    },
    appearance: {
      theme: { value: 'dark', type: 'select', source: 'config' },
      accentColor: { value: '#60CDFF', type: 'string', source: 'config' },
    },
  };
}

// ── AC1 — buildManifest emits every §4.2 field; validateManifest rejects gaps ──

ok('AC1 buildManifest: all §4.2 fields present, counts exact', () => {
  const rows = fixtureRows();
  const settings = { theme: 'dark' };
  const m = buildManifest(rows, settings, ['001_add_workflow_runs', '002_more'], OPTS);

  assert.strictEqual(m.artifact_version, ARTIFACT_VERSION);
  assert.strictEqual(m.artifact_version, 1);
  assert.strictEqual(m.snapshot_id, OPTS.snapshotId);
  assert.strictEqual(m.name, OPTS.name);
  assert.strictEqual(m.created_at, T0);
  assert.strictEqual(m.actor, 'dashboard-operator'); // §4.2 default actor
  assert.strictEqual(m.generator, OPTS.generator);
  assert.deepStrictEqual(m.schema_version, { migrations_applied: ['001_add_workflow_runs', '002_more'] });
  assert.deepStrictEqual(m.counts, { workflows: 1, tasks: 3, workflow_runs: 0 }); // exact row counts incl. 0
  assert.match(m.content_hash, /^[0-9a-f]{64}$/);
});

ok('AC1 buildManifest: content_hash deterministic + sensitive to payload', () => {
  const a = buildManifest(fixtureRows(), { theme: 'dark' }, ['001'], OPTS);
  const b = buildManifest(fixtureRows(), { theme: 'dark' }, ['001'], OPTS);
  const c = buildManifest(fixtureRows(), { theme: 'light' }, ['001'], OPTS);
  const d = buildManifest(fixtureRows(), { theme: 'dark' }, ['001', '002'], OPTS);
  assert.strictEqual(a.content_hash, b.content_hash); // same inputs → same hash
  assert.notStrictEqual(a.content_hash, c.content_hash); // settings change → new hash
  // §4.2: content_hash = sha256(canonicalJSON(tables+settings)) ONLY — the
  // migration list is manifest metadata, not hash input.
  assert.strictEqual(a.content_hash, d.content_hash);
});

ok('AC1 buildManifest: rejects malformed inputs (fail-closed)', () => {
  assert.throws(() => buildManifest(null, {}, []), TypeError);
  assert.throws(() => buildManifest({ t: 'not-an-array' }, {}, []), TypeError);
  assert.throws(() => buildManifest({}, null, []), TypeError);
  assert.throws(() => buildManifest({}, {}, '001'), TypeError);
  assert.throws(() => buildManifest({}, {}, [42]), TypeError);
});

ok('AC1 manifest round-trips through JSON and validates clean', () => {
  const rows = fixtureRows();
  const settings = redactSettings(fixtureGetAll());
  const m = buildManifest(rows, settings, ['001_add_workflow_runs'], OPTS);
  // §4.2 artifact shape: manifest + sibling tables/settings — the disk/download form.
  const artifact = JSON.parse(JSON.stringify({ manifest: m, tables: rows, settings }));
  const v = validateManifest(artifact.manifest, artifact);
  assert.strictEqual(v.valid, true, `expected valid, got ${JSON.stringify(v)}`);
  assert.deepStrictEqual(v.missing, []);
  assert.deepStrictEqual(v.errors, []);
});

ok('AC1 validateManifest rejects artifacts missing ANY required field', () => {
  const base = buildManifest(fixtureRows(), { theme: 'dark' }, ['001'], OPTS);
  // §4.2: tables is a SIBLING of the manifest, not a manifest field — the
  // required set is exactly the AC1 list.
  const required = [
    'artifact_version',
    'snapshot_id',
    'name',
    'created_at',
    'actor',
    'generator',
    'schema_version',
    'counts',
    'content_hash',
  ];
  for (const field of required) {
    const broken = JSON.parse(JSON.stringify(base));
    delete broken[field];
    const v = validateManifest(broken);
    assert.strictEqual(v.valid, false, `expected invalid when "${field}" missing`);
    assert.ok(
      v.missing.includes(field) || v.errors.length > 0,
      `expected "${field}" reported, got ${JSON.stringify(v)}`
    );
  }
  // schema_version.migrations_applied specifically (§4.2 path)
  const noMigrations = JSON.parse(JSON.stringify(base));
  delete noMigrations.schema_version.migrations_applied;
  let v = validateManifest(noMigrations);
  assert.strictEqual(v.valid, false);
  assert.ok(v.missing.includes('schema_version.migrations_applied') || v.errors.length > 0);

  // wrong artifact_version
  v = validateManifest({ ...base, artifact_version: 2 });
  assert.strictEqual(v.valid, false);

  // unparseable created_at
  v = validateManifest({ ...base, created_at: 'not-a-timestamp' });
  assert.strictEqual(v.valid, false);

  // content_hash wrong shape
  v = validateManifest({ ...base, content_hash: 'deadbeef' });
  assert.strictEqual(v.valid, false);
});

ok('AC1 validateManifest: counts must match artifact.tables exactly (anti hand-edit)', () => {
  const base = buildManifest(fixtureRows(), {}, [], OPTS);
  const artifactOf = (manifest, tables) => ({ manifest, tables });

  // count drift vs actual payload
  let v = validateManifest(
    { ...base, counts: { ...base.counts, tasks: 99 } },
    artifactOf({ ...base, counts: { ...base.counts, tasks: 99 } }, fixtureRows())
  );
  assert.strictEqual(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes('tasks')));

  // count without table
  v = validateManifest(base, artifactOf(base, { ...fixtureRows(), ghost_table: [] }));
  assert.strictEqual(v.valid, false);

  // negative count
  v = validateManifest({ ...base, counts: { ...base.counts, tasks: -1 } });
  assert.strictEqual(v.valid, false);

  // non-array table payload in the artifact
  v = validateManifest(base, artifactOf(base, { ...fixtureRows(), tasks: 'three rows' }));
  assert.strictEqual(v.valid, false);

  // manifest-only call still validates clean (tables check skipped)
  assert.strictEqual(validateManifest(base).valid, true);
});

// ── AC2 — compareSchemaVersions verdicts (§4.3 refuse-newer / warn-older) ──

ok('AC2 compareSchemaVersions: identical sets → ok', () => {
  assert.deepStrictEqual(compareSchemaVersions(['001_a', '002_b'], ['002_b', '001_a']), {
    verdict: 'ok',
    missing: [],
  });
  assert.deepStrictEqual(compareSchemaVersions([], []), { verdict: 'ok', missing: [] });
});

ok('AC2 compareSchemaVersions: artifact ahead → too_new with missing[] list', () => {
  const r = compareSchemaVersions(
    ['001_add_workflow_runs', '002_add_budgets', '003_add_snapshots'],
    ['001_add_workflow_runs', '002_add_budgets']
  );
  assert.strictEqual(r.verdict, 'too_new');
  assert.deepStrictEqual(r.missing, ['003_add_snapshots']); // drives the 409 schema_too_new body
});

ok('AC2 compareSchemaVersions: target ahead → target_newer (preview warning)', () => {
  const r = compareSchemaVersions(['001_add_workflow_runs'], ['001_add_workflow_runs', '002_add_budgets']);
  assert.strictEqual(r.verdict, 'target_newer'); // preview surfaces warnings:['target_newer']
  assert.deepStrictEqual(r.missing, []);
});

ok('AC2 compareSchemaVersions: refusal dominates when both sides are ahead', () => {
  const r = compareSchemaVersions(['001', '002_artifact_only'], ['001', '003_target_only']);
  assert.strictEqual(r.verdict, 'too_new'); // never restore into an older-schema target
  assert.deepStrictEqual(r.missing, ['002_artifact_only']);
});

ok('AC2 compareSchemaVersions: tolerates nullish inputs', () => {
  assert.strictEqual(compareSchemaVersions(null, null).verdict, 'ok');
  assert.strictEqual(compareSchemaVersions(['001'], null).verdict, 'too_new');
  assert.strictEqual(compareSchemaVersions(null, ['001']).verdict, 'target_newer');
});

// ── AC3 — redactDeep deny-regex walk (word boundaries; keyboard/monkey survive) ──

ok('AC3 redactDeep: matching keys lose values, keep names, recurse everywhere', () => {
  const input = {
    api_key: 'sk-live-TESTMARKER123',
    PASSWORD: 'hunter2',
    authToken: 'bearer-value',
    'auth-token': 'bearer-value-2',
    credential: { nested: { even: { deeper: true } } }, // whole subtree dies
    tokens: ['a', 'b'], // plural does NOT match \btoken\b → walked, kept
    nested: {
      secret: 'die',
      keyboard: 'stays',
      monkey: 'also stays',
      arr: [{ passwd: 'die', keepme: 'ok' }, 'plain'],
    },
  };
  const original = JSON.parse(JSON.stringify(input));
  const out = redactDeep(input);

  // values die
  assert.strictEqual(out.api_key, '[REDACTED]');
  assert.strictEqual(out.PASSWORD, '[REDACTED]'); // case-insensitive
  assert.strictEqual(out.authToken, '[REDACTED]');
  assert.strictEqual(out['auth-token'], '[REDACTED]');
  assert.deepStrictEqual(out.credential, '[REDACTED]'); // object value replaced wholesale
  assert.strictEqual(out.nested.secret, '[REDACTED]');
  assert.strictEqual(out.nested.arr[0].passwd, '[REDACTED]');

  // keys keep their names (structure restorable)
  assert.ok(Object.prototype.hasOwnProperty.call(out, 'api_key'));
  assert.ok(Object.prototype.hasOwnProperty.call(out.nested, 'secret'));

  // word boundaries: near-miss words must NOT trip
  assert.strictEqual(out.nested.keyboard, 'stays');
  assert.strictEqual(out.nested.monkey, 'also stays');

  // non-matching structures pass through
  assert.strictEqual(out.nested.arr[1], 'plain');
  assert.strictEqual(out.nested.arr[0].keepme, 'ok');
  assert.deepStrictEqual(out.tokens, ['a', 'b']);

  // pure: input untouched
  assert.deepStrictEqual(input, original);
});

ok('AC3 redactDeep: camelCase apiKey trips, keyboard_shortcut survives, snake_case limitation pinned', () => {
  const out = redactDeep({
    apiKey: 'x', // \b fires at string start/end → matches
    keyboard_shortcut: 'F5', // 'keyboard' contains no alternative; shortcut safe
    secretSanta: 'visible', // trailing word char kills \b → stays (spec-as-written)
    postgres_password: 'structural-exclusion-handles-me', // see §5.1 comment in lib
  });
  assert.strictEqual(out.apiKey, '[REDACTED]');
  assert.strictEqual(out.keyboard_shortcut, 'F5');
  assert.strictEqual(out.secretSanta, 'visible');
  // Pinned limitation: \b does not fire after '_' (word char). The five
  // password-type SETTINGS keys are excluded structurally by redactSettings()
  // — this regex is the second net, not the first. Widening the regex is a
  // brief change (§5.2), not a local tweak.
  assert.strictEqual(out.postgres_password, 'structural-exclusion-handles-me');
});

ok('AC3 redactDeep: arrays, depth cap, primitives', () => {
  assert.deepStrictEqual(
    redactDeep([{ token: 'x' }, 1, null, 's']),
    [{ token: '[REDACTED]' }, 1, null, 's']
  );
  assert.strictEqual(redactDeep('plain string'), 'plain string');
  assert.strictEqual(redactDeep(42), 42);
  // pathological nesting fails closed past MAX_DEPTH instead of blowing the stack
  let deep = { leaf: 'value' };
  for (let i = 0; i < 500; i += 1) deep = { wrapper: deep };
  const capped = redactDeep(deep);
  assert.ok(capped === '[REDACTED]' || typeof capped === 'object');
});

// ── AC4 — classifyRows buckets (added/updated/conflict/unchanged boundaries) ──

ok('AC4 classifyRows: all four buckets, exact boundary rules', () => {
  const createdAt = T0;
  const artifactRows = [
    { id: 'pk1', title: 'artifact-newer-edit', updated_at: '2026-08-24T10:00:00.000Z' }, // hash differs, live ≤ snapshot → updated
    { id: 'pk2', title: 'same', updated_at: '2026-08-24T09:00:00.000Z' }, // identical → unchanged
    { id: 'pk3', title: 'brand-new', updated_at: T0 }, // absent live → added
    { id: 'pk4', title: 'diverged', updated_at: '2026-08-24T11:00:00.000Z' }, // live moved AFTER snapshot → conflict
  ];
  const currentRows = [
    { id: 'pk1', title: 'live-old-edit', updated_at: '2026-08-24T10:30:00.000Z' },
    { id: 'pk2', title: 'same', updated_at: '2026-08-24T09:00:00.000Z' },
    { id: 'pk4', title: 'live-changed-after-snapshot', updated_at: '2026-08-24T13:00:00.000Z' },
  ];

  const r = classifyRows(artifactRows, currentRows, 'id', createdAt);
  assert.deepStrictEqual(r.added.map((x) => x.id), ['pk3']);
  assert.deepStrictEqual(r.updated.map((x) => x.id), ['pk1']);
  assert.deepStrictEqual(r.conflicts.map((x) => x.id), ['pk4']);
  assert.deepStrictEqual(r.unchanged.map((x) => x.id), ['pk2']);
  // buckets hold the artifact-side row (what merge would upsert)
  assert.strictEqual(r.updated[0].title, 'artifact-newer-edit');
});

ok('AC4 classifyRows: exactly-at-boundary updated_at == created_at → updated, not conflict', () => {
  const artifactRows = [{ id: 1, v: 'artifact', updated_at: '2026-08-01T00:00:00.000Z' }];
  const currentRows = [{ id: 1, v: 'live', updated_at: T0 }]; // == createdAt → ≤ rule
  const r = classifyRows(artifactRows, currentRows, 'id', T0);
  assert.deepStrictEqual(r.updated.map((x) => x.id), [1]);
  assert.deepStrictEqual(r.conflicts, []);
});

ok('AC4 classifyRows: null/unparseable live updated_at → conservative updated', () => {
  const r = classifyRows(
    [{ id: 1, v: 'artifact' }],
    [{ id: 1, v: 'live', updated_at: null }],
    'id',
    T0
  );
  assert.deepStrictEqual(r.updated.map((x) => x.id), [1]);
  assert.deepStrictEqual(r.conflicts, []);

  const r2 = classifyRows(
    [{ id: 2, v: 'artifact' }],
    [{ id: 2, v: 'live', updated_at: 'garbage' }],
    'id',
    T0
  );
  assert.deepStrictEqual(r2.updated.map((x) => x.id), [2]);
});

ok('AC4 classifyRows: Date objects and ISO strings hash/compare identically', () => {
  const artifactRows = [{ id: 1, v: 'same', updated_at: '2026-08-24T09:00:00.000Z' }];
  const currentRows = [{ id: 1, v: 'same', updated_at: new Date('2026-08-24T09:00:00.000Z') }];
  const r = classifyRows(artifactRows, currentRows, 'id', new Date(T0));
  assert.strictEqual(r.unchanged.length, 1);

  const r2 = classifyRows(
    [{ id: 1, v: 'differs', updated_at: new Date('2026-08-24T10:00:00.000Z') }],
    [{ id: 1, v: 'live-old', updated_at: '2026-08-24T10:00:00.000Z' }],
    'id',
    T0
  );
  assert.deepStrictEqual(r2.updated.map((x) => x.id), [1]);
});

ok('AC4 canonicalRowHash: key order irrelevant, value changes visible', () => {
  assert.strictEqual(canonicalRowHash({ a: 1, b: 2 }), canonicalRowHash({ b: 2, a: 1 }));
  assert.strictEqual(
    canonicalRowHash({ nested: { x: [1, 2], y: null } }),
    canonicalRowHash({ nested: { y: null, x: [1, 2] } })
  );
  assert.notStrictEqual(canonicalRowHash({ a: 1 }), canonicalRowHash({ a: 2 }));
  // undefined properties drop exactly like a JSON round-trip drops them
  assert.strictEqual(canonicalRowHash({ a: 1, b: undefined }), canonicalRowHash({ a: 1 }));
  assert.strictEqual(canonicalJson([3, 1]), '[3,1]'); // arrays keep order
});

ok('AC4 classifyRows: fail-closed on corrupt inputs', () => {
  assert.throws(() => classifyRows('nope', [], 'id', T0), TypeError);
  assert.throws(() => classifyRows([], null, 'id', T0), TypeError);
  assert.throws(() => classifyRows([], [], '', T0), TypeError);
  assert.throws(() => classifyRows([], [], 'id', 'not-a-time'), TypeError);
  // duplicate PKs anywhere = corrupt artifact / impossible live state
  assert.throws(() => classifyRows([{ id: 1 }, { id: 1 }], [], 'id', T0), /duplicate PK/);
  assert.throws(() => classifyRows([{ id: 1 }], [{ id: 1 }, { id: 1 }], 'id', T0), /duplicate PK/);
  // row missing the PK column entirely
  assert.throws(() => classifyRows([{ other: 1 }], [], 'id', T0), /missing PK column/);
});

// ── redactSettings — §5.1 structural exclusion (config-source keys ONLY) ──

ok('redactSettings: grouped getAll() → flat config-source-only map', () => {
  const out = redactSettings(fixtureGetAll());
  assert.deepStrictEqual(out, {
    CHAT_RATE_LIMIT: 30,
    MAX_MESSAGE_LENGTH: 10000,
    theme: 'dark',
    accentColor: '#60CDFF',
  });
  // password-type env keys structurally ABSENT (no placeholders, §5.1)
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'DASHBOARD_AUTH_TOKEN'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'POSTGRES_PASSWORD'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'PORT'));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, 'REQUIRE_AUTH'));
});

ok('redactSettings: password-type dropped defensively even if marked config-source', () => {
  const out = redactSettings({
    general: {
      FUTURE_PASSWORD_SETTING: { value: 'oops', type: 'password', source: 'config' },
      theme: { value: 'dark', type: 'select', source: 'config' },
    },
  });
  assert.deepStrictEqual(out, { theme: 'dark' });
});

ok('redactSettings: flat provenance-less map falls back to deny-filter', () => {
  assert.deepStrictEqual(
    redactSettings({ theme: 'dark', fontSizeBase: 14, api_key: 'x', gateway_token: 'y' }),
    { theme: 'dark', fontSizeBase: 14 }
  );
  assert.deepStrictEqual(redactSettings(null), {});
  assert.deepStrictEqual(redactSettings(undefined), {});
});

// ── AC13 — generated fixture artifact seeded with markers greps clean ──

ok('AC13 full-artifact composition: hunter2 / sk-live markers grep clean post-redact', () => {
  // Fixture keys stay within what the PINNED §5.2 deny-regex actually catches
  // (boundary-conformant: password / api_key / auth_token / credential).
  // Snake_case-attached variants (db_password, secret_sauce) are NOT caught by
  // the pinned regex — documented limitation in lib/snapshot-redact.js; the
  // five password-type SETTINGS keys die structurally in redactSettings()
  // instead (assertion block below proves that path).
  const rowsByTable = {
    tasks: [
      {
        id: 't1',
        title: 'rotate credentials',
        params: { password: 'hunter2', api_key: 'sk-live-TESTMARKER123', attempts: 2 },
        metadata: { nested: { auth_token: 'super-secret-token-value', label: 'safe text' } },
      },
      { id: 't2', title: 'normal task', keyboard_hint: 'Ctrl+K' },
    ],
    workflows: [{ id: 'wf1', name: 'nightly', credential: { vault_pw: 'hunter2-again' } }],
  };

  const settings = redactSettings(fixtureGetAll());
  const manifest = buildManifest(rowsByTable, settings, ['001_add_workflow_runs'], OPTS);

  // Route-level composition order: redactDeep over tables, settings already filtered.
  const artifact = {
    manifest,
    tables: redactDeep(rowsByTable),
    settings,
  };
  const serialized = JSON.stringify(artifact);

  // §5.4 invariant: NO marker string appears anywhere in the serialized output.
  for (const marker of ['hunter2', 'sk-live', 'sk-live-TESTMARKER123', 'super-secret-token-value', 'p@ssw0rd-marker']) {
    assert.ok(!serialized.includes(marker), `marker leaked into artifact: ${marker}`);
  }

  // Redaction happened (values died) while structure survived (keys kept).
  assert.ok(serialized.includes('[REDACTED]'));
  assert.ok(serialized.includes('"password"')); // key name still present
  assert.ok(serialized.includes('keyboard_hint')); // near-miss words untouched
  assert.ok(serialized.includes('Ctrl+K'));
  assert.ok(serialized.includes('"attempts":2')); // sibling values intact

  // Settings section carries config keys only — secrets structurally absent.
  const parsed = JSON.parse(serialized);
  assert.deepStrictEqual(parsed.settings, {
    CHAT_RATE_LIMIT: 30,
    MAX_MESSAGE_LENGTH: 10000,
    theme: 'dark',
    accentColor: '#60CDFF',
  });

  // Manifest itself validates clean post-composition.
  const v = validateManifest(parsed.manifest);
  assert.strictEqual(v.valid, true, JSON.stringify(v));
});

console.log(`\n${group} assertion groups passed (snapshot slice 1 libs — AC1–AC4, AC13)`);
