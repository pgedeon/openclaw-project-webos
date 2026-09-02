# src/offline/ — Offline Support Layer

## Purpose

IndexedDB-backed offline state management, mutation queuing, and conflict resolution for the desktop shell.

## Ownership

| File | Owns |
|------|------|
| `idb.mjs` | IndexedDB wrapper: open/put/get/delete/clear for object stores |
| `state-manager.mjs` | Reactive state with offline cache: get/set/subscribe for tasks, projects, views |
| `sync-manager.mjs` | Mutation queue (create/update/delete/archive/restore) + periodic sync |
| `offline-ui.mjs` | Offline banner, sync status indicator, error notifications |

## Sync Architecture

1. `StateManager` caches data in IndexedDB for offline access
2. `SyncManager` queues mutations when offline, replays when online
3. Conflict resolution: default is **client-wins** (configurable to server-wins or merge)
4. `OfflineUIManager` shows status to user

## Current State

- Only `tasks-view.mjs` fully uses the offline layer
- Most views call `api`/`fetch` directly — migration to MutationManager is tracked in IMPROVEMENT-PLAN.md
- `syncAll()` fetches `/api/tasks/all` (fixed from legacy `/api/tasks`)

## Adding Offline Support to a View

1. Use `StateManager` for reads instead of direct fetch
2. Queue mutations through `SyncManager` instead of direct API calls
3. Subscribe to state changes for reactive UI updates
4. Handle `offline` / `online` events for UI feedback


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
