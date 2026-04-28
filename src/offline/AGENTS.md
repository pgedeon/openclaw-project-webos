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
