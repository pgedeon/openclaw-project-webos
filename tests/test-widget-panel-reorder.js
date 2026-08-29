#!/usr/bin/env node
/**
 * DB-free tests for the widget panel keyboard-reorder pure helpers
 * (src/shell/widgets/widget-panel.mjs):
 *   - computeMoveTargets — ordered list of OTHER enabled widget ids
 *   - applyKeyboardReorder — next ordered array, or null when nothing
 *     would change / inputs invalid
 *
 * These power the keyboard + touch "move menu" reorder path (the
 * drag-handle button opens a Before/After menu; commit funnels through
 * applyKeyboardReorder, shared with the HTML5 drag path).
 *
 * Run: node tests/test-widget-panel-reorder.js
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => { passed++; console.log(`  ✔ ${name}`); },
        (err) => { failed++; console.error(`  ✘ ${name}\n    ${err?.message || err}`); });
    }
    passed++;
    console.log(`  ✔ ${name}`);
    return Promise.resolve();
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
    return Promise.resolve();
  }
}

(async () => {
  const modPath = path.join(__dirname, '..', 'src', 'shell', 'widgets', 'widget-panel.mjs');
  const mod = await import(pathToFileURL(modPath).href);
  const { computeMoveTargets, applyKeyboardReorder } = mod;

  const W = ['fleet-status', 'cost-rollup', 'agent-queue', 'notifications'];

  console.log('widget-panel-reorder: computeMoveTargets');
  await check('excludes the source widget, preserves order', () => {
    assert.deepStrictEqual(computeMoveTargets(W, 'cost-rollup'), [
      'fleet-status', 'agent-queue', 'notifications'
    ]);
  });
  await check('first widget: rest of the panel in order', () => {
    assert.deepStrictEqual(computeMoveTargets(W, 'fleet-status'), [
      'cost-rollup', 'agent-queue', 'notifications'
    ]);
  });
  await check('last widget: everything before it', () => {
    assert.deepStrictEqual(computeMoveTargets(W, 'notifications'), [
      'fleet-status', 'cost-rollup', 'agent-queue'
    ]);
  });
  await check('single-widget panel yields no targets (menu shows empty state)', () => {
    assert.deepStrictEqual(computeMoveTargets(['solo'], 'solo'), []);
  });
  await check('non-array input degrades to empty list', () => {
    assert.deepStrictEqual(computeMoveTargets(null, 'x'), []);
    assert.deepStrictEqual(computeMoveTargets(undefined, 'x'), []);
  });

  console.log('widget-panel-reorder: applyKeyboardReorder');
  await check('move before a middle target', () => {
    assert.deepStrictEqual(
      applyKeyboardReorder(W, 'notifications', 'agent-queue', 'before'),
      ['fleet-status', 'cost-rollup', 'notifications', 'agent-queue']
    );
  });
  await check('move after a middle target', () => {
    assert.deepStrictEqual(
      applyKeyboardReorder(W, 'fleet-status', 'agent-queue', 'after'),
      ['cost-rollup', 'agent-queue', 'fleet-status', 'notifications']
    );
  });
  await check('move before the first widget', () => {
    assert.deepStrictEqual(
      applyKeyboardReorder(W, 'cost-rollup', 'fleet-status', 'before'),
      ['cost-rollup', 'fleet-status', 'agent-queue', 'notifications']
    );
  });
  await check('move after the last widget', () => {
    assert.deepStrictEqual(
      applyKeyboardReorder(W, 'fleet-status', 'notifications', 'after'),
      ['cost-rollup', 'agent-queue', 'notifications', 'fleet-status']
    );
  });
  await check('no-op move (already directly before target) returns null', () => {
    // notifications is already directly after agent-queue; "after agent-queue" = unchanged
    assert.strictEqual(applyKeyboardReorder(W, 'notifications', 'agent-queue', 'after'), null);
  });
  await check('source === target returns null', () => {
    assert.strictEqual(applyKeyboardReorder(W, 'cost-rollup', 'cost-rollup', 'before'), null);
  });
  await check('unknown source or target returns null', () => {
    assert.strictEqual(applyKeyboardReorder(W, 'ghost', 'agent-queue', 'before'), null);
    assert.strictEqual(applyKeyboardReorder(W, 'agent-queue', 'ghost', 'before'), null);
  });
  await check('invalid position returns null', () => {
    assert.strictEqual(applyKeyboardReorder(W, 'fleet-status', 'agent-queue', 'left'), null);
    assert.strictEqual(applyKeyboardReorder(W, 'fleet-status', 'agent-queue', ''), null);
  });
  await check('non-array input returns null', () => {
    assert.strictEqual(applyKeyboardReorder(null, 'a', 'b', 'before'), null);
  });
  await check('original array is never mutated', () => {
    const original = [...W];
    applyKeyboardReorder(W, 'fleet-status', 'notifications', 'after');
    assert.deepStrictEqual(W, original);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})().catch((err) => {
  console.error('test harness crashed:', err);
  process.exit(1);
});
