#!/usr/bin/env node
/**
 * Focused DB-free tests for the PWA install layer (roadmap Phase 3):
 *   - sw.js pure helpers   — caching policy (static allowlist, /api/ deny,
 *                            navigation detection, versioned cache name)
 *   - manifest.webmanifest — structural invariants (name/start_url/display/
 *                            theme_color/icons parity with generated PNGs)
 *   - icons/               — real PNG signatures at 192 + 512
 *   - index.html           — SW registration present AND auth-gated (appears
 *                            after the bootstrap loop, never before)
 *   - task-server.js       — explicit serving branches for the three PWA paths
 *
 * Run: node tests/test-pwa-install.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sw = require(path.join(ROOT, 'sw.js'));

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

console.log('\nService worker caching policy (sw.js helpers)');

check('cache name is versioned under the openclaw-desktop namespace', () => {
  assert.strictEqual(sw.CACHE_NAME, `openclaw-desktop-${sw.CACHE_VERSION}`);
  assert.match(sw.CACHE_VERSION, /^v\d+$/);
});

check('/api/* is never cacheable — exact and nested paths', () => {
  for (const p of ['/api', '/api/', '/api/tasks', '/api/auth/self', '/api/events/stream']) {
    assert.strictEqual(sw.isNeverCacheUrl(p), true, p);
  }
  assert.strictEqual(sw.isNeverCacheUrl('/apix'), false);
  assert.strictEqual(sw.isNeverCacheUrl('/'), false);
});

check('static allowlist covers /src/, /lib/, /icons/, manifest only', () => {
  for (const p of ['/src/shell/shell-main.mjs', '/src/styles/win11-theme.css', '/lib/nl-parse.js', '/icons/icon-192.png', '/manifest.webmanifest']) {
    assert.strictEqual(sw.isStaticAssetUrl(p), true, p);
  }
  for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifestX', '/srclib/x.js']) {
    assert.strictEqual(sw.isStaticAssetUrl(p), false, p);
  }
});

check('navigation detection keys on request.mode', () => {
  assert.strictEqual(sw.isNavigationRequest({ mode: 'navigate' }), true);
  assert.strictEqual(sw.isNavigationRequest({ mode: 'cors' }), false);
  assert.strictEqual(sw.isNavigationRequest({ mode: 'no-cors' }), false);
});

check('precache list stays inside the static allowlist and outside /api/', () => {
  for (const u of sw.PRECACHE_URLS) {
    assert.strictEqual(sw.isNeverCacheUrl(u), false, u);
    assert.strictEqual(sw.isStaticAssetUrl(u), true, u);
  }
});

check('Node export surface exists but SW global listeners are guarded', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.match(src, /if \(typeof self !== 'undefined'\)/);
  assert.match(src, /self\.addEventListener\('install'/);
  assert.match(src, /skipWaiting\(\)/);
  assert.match(src, /clients\.claim\(\)/);
  assert.match(src, /caches\.delete\(k\)/);
});

console.log('\nmanifest.webmanifest');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

check('identity fields match the work order', () => {
  assert.strictEqual(manifest.name, 'OpenClaw Desktop');
  assert.strictEqual(manifest.start_url, '/');
  assert.strictEqual(manifest.display, 'standalone');
});

check('theme/background colors match the base dark desktop background (#0f172a)', () => {
  assert.strictEqual(manifest.theme_color, '#0f172a');
  assert.strictEqual(manifest.background_color, '#0f172a');
});

check('declared icons exist on disk as valid PNGs at declared sizes', () => {
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  const sizes = new Set();
  for (const icon of manifest.icons) {
    const file = path.join(ROOT, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `${icon.src} missing`);
    const buf = fs.readFileSync(file);
    assert.deepStrictEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${icon.src} not a PNG`);
    // IHDR width/height at bytes 16..24 must equal the declared size.
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    assert.strictEqual(`${w}x${h}`, icon.sizes, `${icon.src} size mismatch`);
    sizes.add(icon.sizes);
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'), '192px + 512px required');
});

console.log('\nindex.html registration');

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

check('SW registration is present, scoped to /, and failure-tolerant', () => {
  assert.match(indexHtml, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
  assert.match(indexHtml, /\.catch\(/);
});

check('registration is auth-gated: appears after the bootstrap loop resolves', () => {
  const loopAt = indexHtml.indexOf("while (check.state !== 'ok')");
  const regAt = indexHtml.indexOf("serviceWorker.register");
  assert.ok(loopAt !== -1 && regAt !== -1 && regAt > loopAt, 'registration must follow successful auth check');
  const tokenAt = indexHtml.indexOf('globalThis.__DASHBOARD_AUTH_TOKEN__ = token;');
  assert.ok(tokenAt !== -1 && regAt > tokenAt);
});

check('manifest link + theme-color meta are wired in <head>', () => {
  assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(indexHtml, /<meta name="theme-color" content="#0f172a">/);
});

console.log('\ntask-server.js serving');

const serverSrc = fs.readFileSync(path.join(ROOT, 'task-server.js'), 'utf8');

check('explicit PWA routes with correct content-type/cache-control', () => {
  assert.match(serverSrc, /'\/manifest\.webmanifest'/);
  assert.match(serverSrc, /'application\/manifest\+json'/);
  assert.match(serverSrc, /url === '\/sw\.js'/);
  assert.match(serverSrc, /'Cache-Control': 'no-cache'/);
  assert.match(serverSrc, /startsWith\('\/icons\/'\)/);
});

check('sw.js branch bypasses the generic .js Clear-Site-Data path', () => {
  const branch = serverSrc.slice(serverSrc.indexOf("url === '/sw.js'"), serverSrc.indexOf("url.startsWith('/icons/')"));
  assert.match(branch, /no-cache/);
  assert.doesNotMatch(branch, /Clear-Site-Data/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
