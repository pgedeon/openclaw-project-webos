# v2.0.0 — 2026-08-25

**The 10x upgrade is complete.** v2.0.0 is the semver-major milestone that turns the project dashboard into a **security-hardened, live-streaming, cost-governed, MCP-exposed agent operations platform**. Shipped ~2 days / 100+ commits after v1.1.0 (2026-08-23).

## Highlights

1. **Full security remediation, all 4 servers** — every finding from `SECURITY-AUDIT-2026-08.md` closed across task-server, cron-manager, memory-api, and filesystem-api (bearer-token auth everywhere, loopback/Origin allowlists, secret-redacted exports, write refusals for sensitive trees).
2. **Live gateway streaming** — server-side WebSocket bridge to the OpenClaw gateway with a validated event pipeline; the dashboard UI updates in real time via SSE fan-out instead of polling.
3. **Live agent console** — watch agent tool calls and assistant output stream as they happen.
4. **Budget governance with dispatcher enforcement** — per-period cost/token budgets with warn / pause-new-runs / hard-stop actions wired into the workflow dispatcher, breach events surfaced over SSE into Mission Control and the notification center.
5. **Session replay inspector** — pick an agent + session, scrub the timeline, step through events with expandable tool calls.
6. **Cost/token analytics** — `/api/costs/*` rollups by agent/department/workflow type, Mission Control command center with anomaly flags, sparkline widgets.
7. **Receipted one-click actions** — task.assign, run.dispatch, approval.decide, run.cancel, run.redispatch behind tiered confirmations (preview modal / press-and-hold) with idempotent action receipts and a recent-actions tray.
8. **MCP server exposure** — the dashboard is now an MCP server (`node mcp-server.js`) exposing 13 tools: 10 read-only by default, 3 mutating behind `OPENCLAW_MCP_MUTATIONS=1`, all mutations receipted through the same governed write path as the UI.
9. **Snapshot/restore with checkpoint resume** — redacted state snapshots, preview-first restore diffs, merge vs hold-to-confirm replace, crash-safe resume from per-table checkpoints, full Settings panel.
10. **PWA installability + theme engine** — installable desktop app with hardened auth-gated service worker; five accent packs layered on dark/light themes. Plus: docs site live at [pgedeon.github.io/openclaw-project-webos](https://pgedeon.github.io/openclaw-project-webos/), NL command bar (Ctrl+K), workflow graph Stage 1, Memory Browser 2.0.

## Migration notes

No breaking changes for existing installs, **except**:

- **`DASHBOARD_AUTH_TOKEN` is now required** by cron-manager, memory-api, and filesystem-api (previously optional on some surfaces). Operators must set it in each service's environment before upgrading.
- **PWA / service worker registration requires valid auth** — the SW registers only after the auth bootstrap resolves; unauthenticated sessions never get SW control (by design).
- New **optional** env vars: `GATEWAY_BRIDGE_URL` and `GATEWAY_BRIDGE_TOKEN` (gateway streaming bridge; defaults work for local setups).

## Validation

- DB-free test suite green (`node scripts/ci-db-free-tests.js`)
- Docs drift check green (`node scripts/docs-drift-check.js`)
- Syntax clean (`node --check task-server.js`)

## Artifacts

- Tag: [`v2.0.0`](https://github.com/pgedeon/openclaw-project-webos/releases/tag/v2.0.0)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
