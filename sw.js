/**
 * OpenClaw Desktop service worker (UPGRADE_ROADMAP Phase 3 — "PWA install").
 *
 * Hardening contract (work order):
 *   - Cache-first ONLY for versioned static assets (/src/, /lib/, /icons/,
 *     /manifest.webmanifest) under a versioned cache name.
 *   - Network-first with cache fallback for navigation requests (the app shell).
 *   - NEVER cache /api/* — auth + dynamic data stay live; the bearer token never
 *     enters any cached response (index.html itself carries no token per
 *     SECURITY-AUDIT-2026-08.md F1, so caching the shell is safe).
 *   - skipWaiting + clients.claim on upgrade; old cache versions purged on activate.
 *   - Registration happens in index.html ONLY after auth bootstrap succeeds, so
 *     an unauthenticated install can never snapshot the auth-gate page into
 *     service-worker control.
 *
 * Classic script (no modules): pure helpers are exported via module.exports when
 * required under Node so tests/test-pwa-install.js can assert the caching policy
 * without a browser. In the SW global scope `module` is undefined and the guard
 * is skipped.
 */

'use strict';

// Bump CACHE_VERSION whenever shipped static assets change semantics; activate
// then deletes every openclaw-desktop-* cache older than this.
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'openclaw-desktop-' + CACHE_VERSION;

// Runtime cache-first allowlist. Deliberately narrow: same-origin prefixes that
// are content-addressed by deploy (whole tree replaced atomically by rsync).
const STATIC_CACHE_PREFIXES = ['/src/', '/lib/', '/icons/'];
const STATIC_CACHE_EXACT = ['/manifest.webmanifest'];
// Precached at install so an installed app has its shell furniture offline.
const PRECACHE_URLS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// Auth + dynamic data: always network, never stored.
const NEVER_CACHE_PREFIXES = ['/api/'];

/** @param {string} pathname @returns {boolean} */
function isNeverCacheUrl(pathname) {
  if (pathname === '/api') return true; // defensive: bare namespace too
  return NEVER_CACHE_PREFIXES.some((p) => pathname.startsWith(p));
}

/** @param {string} pathname @returns {boolean} */
function isStaticAssetUrl(pathname) {
  return (
    STATIC_CACHE_EXACT.indexOf(pathname) !== -1 ||
    STATIC_CACHE_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/** @param {Request} request @returns {boolean} */
function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

if (typeof self !== 'undefined') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.addAll(PRECACHE_URLS))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }
    if (url.origin !== self.location.origin) return; // Google Fonts etc.: pass through
    const pathname = url.pathname;
    if (isNeverCacheUrl(pathname)) return; // /api/*: browser default, zero SW interference

    if (isNavigationRequest(req)) {
      // Network-first: fresh shell wins, cache covers offline/outage.
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() =>
            caches.match(req).then((hit) => hit || new Response('Offline', { status: 503 }))
          )
      );
      return;
    }

    if (isStaticAssetUrl(pathname)) {
      // Cache-first for static assets only.
      event.respondWith(
        caches.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
              }
              return res;
            })
        )
      );
    }
    // Everything else: no respondWith → plain browser default.
  });
}

// Node test hook (never defined inside the service worker global scope).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CACHE_VERSION,
    CACHE_NAME,
    STATIC_CACHE_PREFIXES,
    STATIC_CACHE_EXACT,
    PRECACHE_URLS,
    NEVER_CACHE_PREFIXES,
    isNeverCacheUrl,
    isStaticAssetUrl,
    isNavigationRequest,
  };
}
