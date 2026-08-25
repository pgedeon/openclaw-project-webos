#!/usr/bin/env node
/**
 * Focused DB-free tests for the accent pack engine's pure helpers
 * (src/shell/accent-packs.mjs):
 *   - ACCENT_PACKS       — built-in pack catalog invariants
 *   - isValidAccent      — strict membership validation
 *   - resolveAccent      — zero-throw stored-value resolution
 *   - applyAccent        — data-accent attribute toggling (injectable doc)
 *   - readStoredAccent   — zero-throw localStorage read
 *   - storeAccent        — zero-throw localStorage write
 *
 * Run: node tests/test-accent-packs.js
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

function makeFakeDoc() {
  const root = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  };
  return { documentElement: root };
}

function makeFakeStorage({ failGet = false, failSet = false, initial = {} } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { if (failGet) throw new Error('storage unavailable'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { if (failSet) throw new Error('storage unavailable'); map.set(key, String(value)); },
  };
}

(async () => {
  const modPath = path.join(__dirname, '..', 'src', 'shell', 'accent-packs.mjs');
  const packs = await import(pathToFileURL(modPath).href);
  const { ACCENT_PACKS, ACCENT_STORAGE_KEY, DEFAULT_ACCENT, isValidAccent, resolveAccent, applyAccent, readStoredAccent, storeAccent } = packs;

  // --- Catalog invariants ---
  check('ACCENT_PACKS ships exactly 5 built-in packs', () => {
    assert.strictEqual(ACCENT_PACKS.length, 5);
  });

  check('pack ids are unique and include default', () => {
    const ids = ACCENT_PACKS.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.ok(ids.includes(DEFAULT_ACCENT));
  });

  check('every pack carries label + light/dark swatch colors', () => {
    for (const p of ACCENT_PACKS) {
      assert.ok(p.id && typeof p.label === 'string' && p.label.length > 0, `label missing on ${p.id}`);
      assert.match(p.color, /^#[0-9a-f]{6}$/i, `color missing on ${p.id}`);
      assert.match(p.darkColor, /^#[0-9a-f]{6}$/i, `darkColor missing on ${p.id}`);
    }
  });

  check('storage key follows shell conventions', () => {
    assert.strictEqual(ACCENT_STORAGE_KEY, 'openclaw.accent');
  });

  // --- isValidAccent ---
  check('isValidAccent accepts every built-in id', () => {
    for (const p of ACCENT_PACKS) assert.ok(isValidAccent(p.id), p.id);
  });

  check('isValidAccent rejects non-strings and unknown ids', () => {
    assert.strictEqual(isValidAccent('crimson'), false);
    assert.strictEqual(isValidAccent(''), false);
    assert.strictEqual(isValidAccent(null), false);
    assert.strictEqual(isValidAccent(undefined), false);
    assert.strictEqual(isValidAccent(42), false);
    assert.strictEqual(isValidAccent({}), false);
  });

  // --- resolveAccent ---
  check('resolveAccent passes through every valid id unchanged', () => {
    for (const p of ACCENT_PACKS) assert.strictEqual(resolveAccent(p.id), p.id);
  });

  check('resolveAccent normalizes case + surrounding whitespace', () => {
    assert.strictEqual(resolveAccent('  TEAL '), 'teal');
    assert.strictEqual(resolveAccent('Violet'), 'violet');
  });

  check('resolveAccent falls back to default for invalid values', () => {
    assert.strictEqual(resolveAccent('crimson'), DEFAULT_ACCENT);
    assert.strictEqual(resolveAccent(''), DEFAULT_ACCENT);
    assert.strictEqual(resolveAccent(null), DEFAULT_ACCENT);
    assert.strictEqual(resolveAccent(undefined), DEFAULT_ACCENT);
    assert.strictEqual(resolveAccent(42), DEFAULT_ACCENT);
    assert.strictEqual(resolveAccent({ toString() { throw new Error('boom'); } }), DEFAULT_ACCENT);
  });

  // --- applyAccent (injectable document) ---
  check('applyAccent sets data-accent for a non-default pack', () => {
    const doc = makeFakeDoc();
    const applied = applyAccent('teal', doc);
    assert.strictEqual(applied, 'teal');
    assert.strictEqual(doc.documentElement.getAttribute('data-accent'), 'teal');
  });

  check('applyAccent clears data-accent for the default pack', () => {
    const doc = makeFakeDoc();
    applyAccent('rose', doc);
    const applied = applyAccent('default', doc);
    assert.strictEqual(applied, DEFAULT_ACCENT);
    assert.strictEqual(doc.documentElement.getAttribute('data-accent'), null);
  });

  check('applyAccent resolves invalid values to default silently', () => {
    const doc = makeFakeDoc();
    applyAccent('neon-green', doc);
    assert.strictEqual(doc.documentElement.getAttribute('data-accent'), null);
  });

  check('applyAccent survives a missing document', () => {
    assert.strictEqual(applyAccent('amber', null), 'amber');
    assert.strictEqual(applyAccent('nope', undefined), DEFAULT_ACCENT);
  });

  // --- readStoredAccent ---
  check('readStoredAccent returns a persisted valid accent', () => {
    const storage = makeFakeStorage({ initial: { [ACCENT_STORAGE_KEY]: 'violet' } });
    assert.strictEqual(readStoredAccent(storage), 'violet');
  });

  check('readStoredAccent falls back to default for invalid stored values', () => {
    const storage = makeFakeStorage({ initial: { [ACCENT_STORAGE_KEY]: 'hot-pink' } });
    assert.strictEqual(readStoredAccent(storage), DEFAULT_ACCENT);
  });

  check('readStoredAccent falls back to default when key is missing', () => {
    assert.strictEqual(readStoredAccent(makeFakeStorage()), DEFAULT_ACCENT);
  });

  check('readStoredAccent survives throwing storage', () => {
    assert.strictEqual(readStoredAccent(makeFakeStorage({ failGet: true })), DEFAULT_ACCENT);
    assert.strictEqual(readStoredAccent(null), DEFAULT_ACCENT);
  });

  // --- storeAccent ---
  check('storeAccent persists the resolved id', () => {
    const storage = makeFakeStorage();
    storeAccent('Teal', storage);
    assert.strictEqual(storage.getItem(ACCENT_STORAGE_KEY), 'teal');
  });

  check('storeAccent normalizes invalid input to default before persisting', () => {
    const storage = makeFakeStorage({ initial: { [ACCENT_STORAGE_KEY]: 'rose' } });
    storeAccent('garbage', storage);
    assert.strictEqual(storage.getItem(ACCENT_STORAGE_KEY), DEFAULT_ACCENT);
  });

  check('storeAccent survives throwing storage', () => {
    const storage = makeFakeStorage({ failSet: true });
    assert.doesNotThrow(() => storeAccent('teal', storage));
    assert.strictEqual(storeAccent('teal', null), 'teal');
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
