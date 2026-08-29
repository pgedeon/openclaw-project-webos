# v2.1.0 — 2026-08-29

**The platform turns outward: proven adoption, honest assurance, full accessibility.** v2.1.0 makes the v2.0.0 platform's claims provable: agents actually call the MCP tools (with telemetry), the failure classes that slipped through get caught by DB-free end-to-end coverage, schema drift can never silently accumulate again, performance is measured honestly, and the widget panel is fully keyboard/touch operable. Shipped ~4 days / 12 commits after v2.0.0 (2026-08-25).

## Highlights

1. **MCP server registered with OpenClaw + organic agent adoption** — `openclaw mcp add webos-dashboard` (stdio); pilot agent coder, then `main` + `dashboard-manager`, answered live fleet/budget questions through the tool surface with zero hints. Adoption telemetry (`npm run mcp:telemetry`) counts every executed tools/call from the audit log: 21 calls, 6 of 13 tools used, all reads.
2. **Budget breach alerts deliver to chat** (slice 5) — latched breach events page the operator over the authenticated gateway WebSocket; Zulip delivery PROVEN live on staging (latch-exact, exactly-one-message). WhatsApp channel escalated to owner review after 3 infra timeouts.
3. **Conversation tab in task detail** — bound gateway-session transcripts render inline as chat bubbles with tool badges, cursor-paginated, read-only, deep-linking to full Session Replay.
4. **NL command bar creates tasks** — "spawn agent for X" executes end-to-end through the governed action registry (receipted, audited) instead of refusing with task_create_unavailable.
5. **Budgets management window** (36th app) — create/edit/deactivate budgets with per-budget ledger drawer; the cost-governance loop is fully manageable from the dashboard.
6. **Schema drift checker** (`npm run db:drift-check`) — two-tier: tracking-table comparison for numbered migrations + object probes for the date-prefixed ones that never get tracking rows; a CI guard test fails if any future migration lacks probe coverage. Born from the real incident where staging silently missed 8 migrations and 500'd `/api/tasks/all` + `/api/spaces` for days. Migration `026_add_workspaces_base.sql` adds the missing workspaces base DDL.
7. **D5 perf harness** (`npm run perf`) — manual, never CI-blocking: boot-to-interactive ~366ms median, tasks-view first render ~65ms, capped-list "load more" +100 rows ~7ms.
8. **Widget panel keyboard + touch reorder** (a11y) — the drag-handle button opens an accessible Before/After move menu (role=menu, Escape-closable, focus-managed); closed the repo's last code TODO.
9. **DB-free e2e coverage** — MCP adapter with fake fetch (including the shipped-bug shape), snapshot flow through the real action-routes pipeline, the one-click actions flow, and the MCP/snapshot flows suite; suite grew to 68 files, all green.
10. **Dependencies fully current + double-layered alerting** — pg 8.23.0, playwright 1.62.1, puppeteer/puppeteer-core moved to devDependencies; npm audit 0 vulnerabilities; GitHub Dependabot + vulnerability alerts enabled on the repo (CI npm audit + continuous Dependabot).
11. **Docs site search** — client-side search over the GitHub Pages corpus, zero-build generated index.

## Migration notes

- **Migration 026** (`026_add_workspaces_base.sql`) — only needed on databases provisioned without the P3 Spaces table; idempotent, seeds the `default` workspace.
- No new required env vars. `BUDGET_ALERT_CHANNEL`/`BUDGET_ALERT_TARGET` remain optional (default off).

## Validation

- DB-free test suite green, 68/68 (`node scripts/ci-db-free-tests.js`)
- Docs drift check green (`node scripts/docs-drift-check.js`)
- Schema drift check `ok` on staging (`npm run db:drift-check` against staging DB)
- CI green on verify + e2e jobs

## Artifacts

- Tag: [`v2.1.0`](https://github.com/pgedeon/openclaw-project-webos/releases/tag/v2.1.0)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
