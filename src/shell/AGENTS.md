# src/shell/ — Desktop Shell

## Purpose

The Win11-style desktop shell that users interact with. Manages windows, taskbar, start menu, realtime sync, widgets, and view rendering.

## Ownership

| File | Owns |
|------|------|
| `shell-main.mjs` | Bootstrap: wires all shell modules, restores state, starts sync |
| `window-manager.mjs` | Window creation, dragging, resizing, z-order, minimize/maximize/close |
| `taskbar.mjs` | Bottom taskbar: clock, running apps, system tray, theme toggle |
| `start-menu.mjs` | Start menu: searchable app grid organized by category |
| `app-registry.mjs` | `APP_REGISTRY` array — all 26 registered apps with metadata |
| `view-adapter.mjs` | View rendering adapter: creates containers, manages lifecycle |
| `api-client.mjs` | Centralized API client with auth token injection |
| `realtime-sync.mjs` | Polls 7 data sources + SSE push, notifies subscribers |
| `view-state.mjs` | Reactive state management for active view context |

## Contracts

- All shell modules are ES modules (`.mjs`)
- `shell-main.mjs` is the entry point — loaded by `dashboard.html`
- Views receive `(container, context)` where context includes `api`, `sync`, `navigate`, `showNotice`
- SSE is enabled via `connectSSE()` — triggers `sync.refresh()` on push events
- Widget registry loads widgets asynchronously after shell bootstrap

## Adding a New Shell Module

1. Create `.mjs` file in `src/shell/`
2. Import in `shell-main.mjs`
3. Wire into the bootstrap sequence
4. Keep it vanilla JS — no framework dependencies


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
