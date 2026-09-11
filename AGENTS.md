# AGENTS.md — OpenClaw Project WebOS

## Purpose

Win11-style desktop environment for managing OpenClaw agent workflows. Served entirely in the browser with vanilla JS, no frameworks, no build step.

## Architecture Constraints

- **No build step.** All frontend code is vanilla ES modules loaded directly by the browser.
- **No framework.** No React, Vue, Svelte, etc. Pure DOM manipulation.
- **PostgreSQL backend.** All persistent data lives in PostgreSQL via `storage/asana.js`.
- **Bearer token auth.** Single `DASHBOARD_AUTH_TOKEN` for all API routes except `/api/health` and `/api/auth/self`.
- **Multiple Node servers.** task-server (3876), cron-manager (3878), memory-api (3879), filesystem-api (3880). All proxy through task-server for browser access.

## Directory Ownership

| Directory | Owns | Doc |
|-----------|------|-----|
| `src/shell/` | Desktop shell (window manager, taskbar, start menu, views) | `src/shell/AGENTS.md` |
| `src/shell/native-views/` | 26 windowed app views | `src/shell/native-views/AGENTS.md` |
| `src/shell/widgets/` | 18 desktop widgets + widget system | `src/shell/widgets/AGENTS.md` |
| `src/offline/` | IndexedDB, sync, offline UI | `src/offline/AGENTS.md` |
| `routes/` | HTTP route handlers | `routes/AGENTS.md` |
| `storage/` | PostgreSQL storage layer | `storage/AGENTS.md` |
| `schema/` | Database migrations | `schema/AGENTS.md` |
| `scripts/` | Operational scripts | `scripts/AGENTS.md` |
| `docs/` | User/developer documentation | — |

## Route Registration

1. Add route handler in `routes/<name>-routes.js`
2. Export `register<Name>Routes(router)` function
3. Require and call in `task-server.js`
4. Route ordering matters — more specific patterns before less specific

## Migration Rules

1. Sequential numbering: `001_<name>.sql`, `002_<name>.sql`, etc.
2. Each migration must be idempotent where possible
3. Update `docs/schema-reference.md` in the same commit
4. Never modify a migration after it's been pushed

## View Registration

1. Create view in `src/shell/native-views/<name>-view.mjs`
2. Export a render function: `render(container, context)`
3. Add entry to `APP_REGISTRY` in `src/shell/app-registry.mjs`
4. Update `docs/views-reference.md` in the same commit

## Widget Registration

1. Create widget in `src/shell/widgets/widgets/<name>-widget.mjs`
2. Add entry to `WIDGET_INDEX` in `src/shell/widgets/widget-registry.mjs`
3. Update `docs/widget-catalog.md` in the same commit

## Documentation Rules

- Every code change that modifies public API, views, widgets, or schema must update the matching docs
- Run `npm run validate` before pushing — it includes docs drift checking
- `scripts/docs-drift-check.js` validates counts and route coverage

## Key Entry Points

- **Shell bootstrap:** `src/shell/shell-main.mjs`
- **API server:** `task-server.js` (port 3876)
- **Storage layer:** `storage/asana.js`
- **App registry:** `src/shell/app-registry.mjs`
- **Widget registry:** `src/shell/widgets/widget-registry.mjs`


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
