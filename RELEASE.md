# v2.2.0 — 2026-09-06

**Capability honesty and operational truth.** v2.2.0 makes the platform's failure stories provable and legible: every degrade surface now speaks one vocabulary, MCP consumers can tell WHY a section went missing, and the operational validator works again after silently 401-ing for weeks. Shipped ~8 days / 19 commits after v2.1.0 (2026-08-29).

## Highlights

1. **Capability resolver** — new pure `lib/capability-status.js`: `resolveCapability` takes declared / verified / configured legs (each boolean or null), fails closed, names the first failed leg; `toDegradedBody()` mints the house `{available:false, reason}` shape with the existing reason vocabulary byte-identical; `describeForUi()` renders one honest human string per status. Piloted on budget-routes (wire shapes test-pinned byte-identical), then migrated: all six snapshot-route 503 degrade bodies, Mission Control runs/cron/fleet/cost panel strings (the last hand-strings — "Cost unavailable — no database" was dropped because a failed fetch cannot claim which backend is down).
2. **MCP unavailable sections carry a failure-cause `reason` sibling** — `{section:'unavailable', reason}` from `settledSection` and the `get_mission_control_summary` assembly: classes `task_server_unreachable` / `auth_failed` / `not_found` / `upstream_error` (with status) / `empty_payload`. Additive only — the pinned marker key is unchanged, no capability-status import, AC8 intact.
3. **`npm run validate` un-broken** — dashboard-validation.js's `request()` predates the auth layer and sent no headers: every API check 401'd and the run failed since bearer auth landed (CI never runs validate, so the rot survived). Now sends `Authorization: Bearer $DASHBOARD_AUTH_TOKEN`; a 401 without the token logs an operator hint. Live-verified against staging.
4. **Docs-drift checker normalized** — template-string routes (`/api/memory/file/${params.name}`) false-positive-warned on six documented memory routes for weeks; the matcher is now an exported pure `isRouteDocumented()` resolving all candidate forms with a greedy-prefix guard. The four genuinely-undocumented routes got handler-accurate reference docs. Warnings 10 → 0.
5. **Suite green on Windows too** — pathToFileURL for ESM dynamic import, and the libuv win/async.c clean-shutdown exit code is tolerated only under an exact four-condition match. Plus the date-rot fixes: budget-enforcement week/month key assertions now derive from `periodKey()` instead of hardcoded literals that broke at each rollover.
6. **Public changelog page** — CHANGELOG.md mirrors verbatim to `docs/changelog.md` (generated, committed, drift-gated) so the docs site always matches repo truth.
7. **CI audit gate hardened** — retries npm audit ONLY on registry transport errors (exact marker, max 3, backoff); real findings never retried. Born from the npm audit-endpoint deprecation flapping.
8. **Staging fs API root fixed** (staging config, not code) — `OPENCLAW_FS_ROOT` now points at the staging workspace; the code default `/root/.openclaw` stays correct for the real deployment beside the gateway.

## Migration notes

- None. No schema changes since v2.1.0.
- New optional env in practice: `DASHBOARD_AUTH_TOKEN` is now REQUIRED for `npm run validate`'s API checks (it always was for the API itself — the validator just never sent it).

## Validation

- DB-free test suite green, 70/70 (`node scripts/ci-db-free-tests.js`), Windows Node 24 + WSL
- Docs drift check green (`node scripts/docs-drift-check.js`)
- Schema drift check `ok` on staging (`npm run db:drift-check` against staging DB)
- CI green on verify + e2e + docs-pages jobs

## Artifacts

- Tag: [`v2.2.0`](https://github.com/pgedeon/openclaw-project-webos/releases/tag/v2.2.0)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
