#!/usr/bin/env node
/**
 * Focused tests for the shared list virtualization math
 * (src/shell/list-window.mjs):
 *   - visibleWindow — fixed-row rail window (reused by session-replay-view)
 *   - cappedWindow  — capped-render window (tasks-view, board-view)
 *   - growCap       — "load more" cap growth
 *
 * Run: node tests/test-list-window.js
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
  const modPath = path.join(__dirname, '..', 'src', 'shell', 'list-window.mjs');
  const mod = await import(pathToFileURL(modPath).href);
  const { visibleWindow, cappedWindow, growCap, RAIL_OVERSCAN } = mod;

  console.log('list-window: visibleWindow (fixed-row rail)');
  await check('basic window with overscan', () => {
    const w = visibleWindow({ total: 1000, viewport: 260, scrollTop: 0, rowHeight: 26 });
    assert.strictEqual(w.start, 0);
    // ceil(260/26)=10 rows + 2*6 overscan = 22
    assert.strictEqual(w.end, 10 + 2 * RAIL_OVERSCAN);
  });
  await check('mid-scroll window', () => {
    const w = visibleWindow({ total: 1000, viewport: 260, scrollTop: 520, rowHeight: 26 });
    assert.strictEqual(w.start, Math.floor(520 / 26) - RAIL_OVERSCAN);
    assert.strictEqual(w.end, Math.min(1000, w.start + Math.ceil(260 / 26) + 2 * RAIL_OVERSCAN));
  });
  await check('clamps end at total', () => {
    const w = visibleWindow({ total: 15, viewport: 100000, scrollTop: 0, rowHeight: 26 });
    assert.deepStrictEqual(w, { start: 0, end: 15 });
  });
  await check('empty list', () => {
    assert.deepStrictEqual(visibleWindow({ total: 0, viewport: 100, scrollTop: 0, rowHeight: 26 }), { start: 0, end: 0 });
  });
  await check('degenerate geometry renders everything', () => {
    assert.deepStrictEqual(visibleWindow({ total: 7, viewport: 100, scrollTop: 0, rowHeight: 0 }), { start: 0, end: 7 });
    assert.deepStrictEqual(visibleWindow({ total: 7, viewport: NaN, scrollTop: NaN, rowHeight: NaN }), { start: 0, end: 7 });
  });
  await check('negative scroll treated as 0', () => {
    const w = visibleWindow({ total: 500, viewport: 260, scrollTop: -50, rowHeight: 26 });
    assert.strictEqual(w.start, 0);
  });

  console.log('list-window: cappedWindow (capped render)');
  await check('under cap → nothing hidden', () => {
    assert.deepStrictEqual(cappedWindow({ total: 42, shown: 100 }), { start: 0, end: 42, hidden: 0 });
  });
  await check('over cap → cut at shown', () => {
    assert.deepStrictEqual(cappedWindow({ total: 250, shown: 100 }), { start: 0, end: 100, hidden: 150 });
  });
  await check('exact boundary', () => {
    assert.deepStrictEqual(cappedWindow({ total: 100, shown: 100 }), { start: 0, end: 100, hidden: 0 });
  });
  await check('empty list', () => {
    assert.deepStrictEqual(cappedWindow({ total: 0, shown: 100 }), { start: 0, end: 0, hidden: 0 });
  });
  await check('non-finite inputs are safe', () => {
    assert.deepStrictEqual(cappedWindow({ total: NaN, shown: 5 }), { start: 0, end: 0, hidden: 0 });
    assert.deepStrictEqual(cappedWindow({ total: 9, shown: undefined }), { start: 0, end: 0, hidden: 9 });
  });
  await check('fractional/negative inputs floor/clamp', () => {
    assert.deepStrictEqual(cappedWindow({ total: 10.9, shown: 3.7 }), { start: 0, end: 3, hidden: 7 });
    assert.deepStrictEqual(cappedWindow({ total: 10, shown: -4 }), { start: 0, end: 0, hidden: 10 });
  });

  console.log('list-window: growCap ("load more")');
  await check('grows by step', () => {
    assert.strictEqual(growCap({ shown: 100, total: 250, step: 100 }), 200);
  });
  await check('clamps at total', () => {
    assert.strictEqual(growCap({ shown: 200, total: 250, step: 100 }), 250);
  });
  await check('already full stays full', () => {
    assert.strictEqual(growCap({ shown: 250, total: 250, step: 100 }), 250);
  });
  await check('missing step falls back to current cap', () => {
    assert.strictEqual(growCap({ shown: 100, total: 250 }), 200);
  });
  await check('non-finite shown is safe', () => {
    assert.strictEqual(growCap({ shown: NaN, total: 250, step: 100 }), 100);
  });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
