#!/usr/bin/env node
/**
 * DB-free tests for the docs-drift checker's route-documentation matcher
 * (scripts/docs-drift-check.js::isRouteDocumented).
 *
 * The matcher resolves route patterns captured from source code — which can
 * carry template-string interpolations (`/api/memory/file/${params.name}`)
 * and query builders (`/api/memory/context?${qs(req)}`) — against a docs
 * corpus that references clean paths, `:param` forms, or parent prefixes.
 * These checks pin that normalization so documented routes never
 * false-positive warn, and genuinely-missing routes still do.
 *
 * Run: node tests/test-docs-drift-check.js
 */

const assert = require('assert');
const path = require('path');

// Requiring the module also RUNS the checker (linear script); its summary
// output is noise for this test but its exit path is suppressed under
// require() (require.main guard), so it cannot fail this process.
const { isRouteDocumented } = require(path.join(__dirname, '..', 'scripts', 'docs-drift-check.js'));

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✘ ${name}\n    ${err?.message || err}`);
  }
}

console.log('docs-drift-check: isRouteDocumented');

const DOCS = [
  '## Memory API\n\n### GET /api/memory/context\n\n### POST /api/memory/file/:name\n\n### POST /api/memory/file/:name/append\n\n### GET /api/tasks'
].join('\n');

check('plain documented route matches verbatim', () => {
  assert.strictEqual(isRouteDocumented('/api/tasks', DOCS), true);
});

check('query-builder template route matches its documented clean path', () => {
  // Source: `/api/memory/context?${qs(req)}` — docs: `/api/memory/context`
  assert.strictEqual(isRouteDocumented('/api/memory/context?${qs(req)}', DOCS), true);
});

check('interpolated param route matches the documented :param form', () => {
  // Source: `/api/memory/file/${params.name}` — docs: `/api/memory/file/:name`
  assert.strictEqual(isRouteDocumented('/api/memory/file/${params.name}', DOCS), true);
});

check('interpolated param route matches the documented :param append variant', () => {
  assert.strictEqual(isRouteDocumented('/api/memory/file/${params.name}/append', DOCS), true);
});

check('interpolated route matches a documented parent prefix (trailing slash)', () => {
  const docs = '### GET /api/memory/file/\n\nlists files';
  assert.strictEqual(isRouteDocumented('/api/memory/file/${params.name}', docs), true);
});

check('genuinely undocumented route does NOT match', () => {
  assert.strictEqual(isRouteDocumented('/api/does-not-exist', DOCS), false);
});

check('template route with no documented form does NOT match', () => {
  assert.strictEqual(isRouteDocumented('/api/ghost/${params.id}', DOCS), false);
});

check('query-suffix route whose clean path is absent does NOT match', () => {
  assert.strictEqual(isRouteDocumented('/api/ghost?${qs(req)}', DOCS), false);
});

check('empty docs corpus matches nothing', () => {
  assert.strictEqual(isRouteDocumented('/api/tasks', ''), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
