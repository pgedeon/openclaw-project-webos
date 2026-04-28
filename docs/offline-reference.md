# Offline & IndexedDB Sync Reference

## Overview

The OpenClaw Dashboard includes a client-side offline layer built on IndexedDB. It enables the dashboard to function without network connectivity, queuing mutations locally and replaying them when connectivity is restored.

## Architecture

The offline system is composed of five modules organized by responsibility:

```
┌──────────────────────────────────────────────────┐
│                   Browser                         │
│                                                   │
│  ┌──────────────┐    ┌───────────────────────┐    │
│  │ StateManager  │───▶│     SyncManager       │    │
│  │ (CRUD + UI)  │    │ (queue + replay)      │    │
│  └──────┬───────┘    └─────────┬─────────────┘    │
│         │                      │                   │
│         ▼                      ▼                   │
│  ┌──────────────┐    ┌───────────────────────┐    │
│  │  IDBWrapper  │◀───│   OfflineUIManager     │    │
│  │  (storage)   │    │ (status indicators)    │    │
│  └──────────────┘    └───────────────────────┘    │
│         │                                        │
│         ▼                                        │
│  ┌──────────────┐                                │
│  │ CryptoUtils  │  (AES-GCM, optional)           │
│  └──────────────┘                                │
│                                                   │
└───────────────────────┬──────────────────────────┘
                        │ fetch()
                        ▼
               ┌────────────────┐
               │  Server API    │
               │  /api/tasks    │
               └────────────────┘
```

| Module | File | Responsibility |
|--------|------|----------------|
| IDBWrapper | `src/offline/idb.mjs` | IndexedDB connection, schema, CRUD operations, optional encryption |
| StateManager | `src/offline/state-manager.mjs` | Application state, task CRUD, persistence to IndexedDB + localStorage fallback |
| SyncManager | `src/offline/sync-manager.mjs` | Operation queue, server replay, conflict resolution, periodic sync |
| OfflineUIManager | `src/offline/offline-ui.mjs` | Online/offline badge, sync state indicator, error banners, conflict modals |
| Security | `src/offline/utils/security.mjs` | XSS prevention, input sanitization, validation helpers |

---

## IndexedDB Schema

Database: **`OpenClawDashboardDB`** · Version: **3**

### Object Stores

#### `tasks`

Stores the serialized dashboard state under the key `dashboard_state`, plus individual task objects for backward compatibility.

| Key Path | Type | Description |
|----------|------|-------------|
| `id` | `string` | Primary key (`"dashboard_state"` for the full state object, or a task UUID) |

**Indexes:**

| Index | Key Path | Unique |
|-------|----------|--------|
| `category` | `category` | No |
| `completed` | `completed` | No |
| `updatedAt` | `updatedAt` | No |

#### `syncQueue`

Stores pending mutations to be replayed when connectivity is restored.

| Key Path | Type | Description |
|----------|------|-------------|
| `id` | `string` (auto-increment) | Unique queue item ID (`{timestamp}-{random}`) |

**Indexes:**

| Index | Key Path | Unique |
|-------|----------|--------|
| `timestamp` | `timestamp` | No |
| `operation` | `operation` | No |

#### `apiCache`

Caches API response payloads keyed by URL.

| Key Path | Type | Description |
|----------|------|-------------|
| `url` | `string` | Request URL (primary key) |

**Indexes:**

| Index | Key Path | Unique |
|-------|----------|--------|
| `timestamp` | `timestamp` | No |

---

## State Schema

The dashboard state stored under key `dashboard_state` in the `tasks` object store:

```javascript
{
  version: 3,
  theme: 'dark',
  filter: 'all',
  search: '',
  categoryFilter: 'all',
  sort: 'newest',
  view: 'list',
  agentViewAgent: null,
  project_id: null,
  categories: ['General', ...],       // auto-collected from tasks
  tasks: [],                          // normalized task objects
  lastSyncTime: null,                 // ISO timestamp
  savedViews: [],                     // [{id, project_id, name, filters, sort, ...}]
  activeSavedViewId: null
}
```

---

## Task Object Schema

Tasks are normalized to a consistent shape regardless of source (legacy localStorage, IndexedDB, or Asana server format):

```javascript
{
  id: string,                        // UUID v4
  text: string,                      // display text
  title: string,                     // Asana-compatible alias
  description: '',
  category: 'General',
  labels: [],
  completed: false,
  status: 'backlog',                 // backlog | in_progress | review | completed | archived
  priority: 'medium',                // low | medium | high | critical
  owner: null,
  project_id: null,
  parent_task_id: null,
  dependency_ids: [],
  labels: [],
  start_date: null,
  due_date: null,
  estimated_effort: null,
  actual_effort: null,
  completed_at: null,
  recurrence_rule: null,             // daily | weekly | monthly | yearly
  metadata: {},
  execution_lock: false,
  execution_locked_by: null,
  archived_at: null,
  deleted_at: null,
  archived: false,
  deleted: false,
  createdAt: 'ISO-8601',
  updatedAt: null | 'ISO-8601'
}
```

---

## Data Flow

### Initialization

1. `StateManager.init()` opens IndexedDB.
2. Loads state from `tasks` store (key `dashboard_state`).
3. Falls back to `localStorage` if no IndexedDB state exists, then migrates.
4. Falls back to legacy `projectTasks` localStorage key, then migrates.
5. If nothing found, creates default state.
6. If online, initializes `SyncManager`.

### Write Path

1. State change via `addTask()`, `toggleTask()`, `updateTask()`, `deleteTask()`, etc.
2. State is mutated in-memory.
3. `debouncedSave()` batches writes (1-second debounce).
4. Written to IndexedDB (`tasks` store) and localStorage (backup).
5. If online, operation is queued in `syncQueue` via `SyncManager.queueOperation()`.

### Read Path

1. `getState()` reads from IndexedDB first.
2. Falls back to localStorage if IndexedDB read fails.
3. Returns default state if both fail.

### Sync Path

1. `SyncManager.queueOperation()` adds an item to `syncQueue` in IndexedDB.
2. If online and not already syncing, `processQueue()` starts immediately.
3. Items are processed in timestamp order (oldest first).
4. Each item is sent as an HTTP request to `/api/tasks` (or `/api/tasks/:id`).
5. On success, the queue item is deleted.
6. On failure, retry with exponential backoff (up to 5 retries, max 300s delay).
7. On HTTP 409, the item is marked as a conflict.

---

## Action Queue

Each queue item has the following shape:

```javascript
{
  id: '1714320000000-a1b2c3d4e',
  operation: 'create',          // create | update | delete | ARCHIVE | RESTORE
  taskId: 'uuid-or-null',       // task ID for update/delete; null for create
  data: { /* task fields */ },
  timestamp: 1714320000000,
  status: 'pending',            // pending | syncing | synced | conflict | error
  retries: 0,
  retryAt: null                 // ISO timestamp for next retry attempt
}
```

### Operation Mapping

| Operation | HTTP Method | URL | Body |
|-----------|-------------|-----|------|
| `create` | POST | `/api/tasks` | Task data |
| `update` | PATCH | `/api/tasks/:id` | Changed fields |
| `delete` | DELETE | `/api/tasks/:id` | — |
| `ARCHIVE` | POST | `/api/tasks/:id/archive` | — |
| `RESTORE` | POST | `/api/tasks/:id/restore` | — |

### Retry Backoff

```javascript
delay = min(1000 * 2^retries + random(0, 1000), 300_000)
```

| Retry | Approximate Delay |
|-------|-------------------|
| 0 | 1–2 s |
| 1 | 2–3 s |
| 2 | 4–5 s |
| 3 | 8–9 s |
| 4 | 16–17 s |
| 5+ | Marked as failed, removed from queue |

---

## Conflict Resolution

When the server returns HTTP 409 (conflict):

1. The queue item is marked with status `conflict`.
2. `SyncManager` emits a `conflictDetected` event.
3. `OfflineUIManager` auto-resolves using the **client-wins** strategy by default (configurable):
   - Fetches current server state.
   - Replaces local data with server data.
   - Removes the conflicting queue item.
4. Alternative strategies are available: `client-wins` (force push) and `merge` (timestamp-based).

### Merge Strategy

Compares `updatedAt` timestamps on client and server. The more recent version wins. If timestamps are equal, server wins.

---

## Periodic Sync

- Every **30 seconds**, `SyncManager` checks the `syncQueue` count.
- If items are pending and the client is online, `processQueue()` runs.
- On `window.online` event, sync triggers immediately.
- `SyncManager.syncAll()` fetches all tasks from the server (full refresh).

---

## Offline UI Behavior

### Status Badge

A fixed-position pill badge in the bottom-right corner:

| State | Color | Text |
|-------|-------|------|
| Online | Green (`#20b26c`) | "Online" |
| Offline | Red (`#ef4444`) | "Offline" |

The badge is clickable and shows a detail modal with:
- Network status
- Whether syncing is active
- Count of pending operations

### Sync Status Badge

A secondary badge below the status indicator:

| State | Color | Text | Auto-hide |
|-------|-------|------|-----------|
| Syncing | Amber | "Syncing changes..." | No |
| Synced | Green | "All changes synced" | After 3 s |
| Error | Red | "Sync error occurred" | No |

### Sync Now Button

- Visible when online.
- Triggers `syncManager.syncAll()`.
- Disabled during active sync.

### Error Banner

A persistent error banner (requires `#errorBanner` and `#errorBannerMessage` elements in the HTML) displays sync failure details with **Retry** and **Dismiss** buttons.

### Conflict Notification

- Uses `showNotice()` if available.
- Auto-resolves via client-wins strategy (configurable to server-wins or merge).
- Shows success or failure notice after resolution.

---

## localStorage Fallback

The state is simultaneously written to localStorage under key `projectDashboardState`. A rotating backup is kept at `projectDashboardState.backup`.

- **Primary load:** IndexedDB
- **Fallback load:** localStorage → legacy `projectTasks` key → defaults
- **Backup:** localStorage written on every save (rotation: current → backup → overwrite)

---

## Security

### XSS Prevention (`src/offline/utils/security.mjs`)

| Function | Purpose |
|----------|---------|
| `escapeHtml(str)` | Escapes HTML entities using the DOM parser. Use when inserting user content via `innerHTML`. Prefer `textContent` for plain text. |
| `sanitizeCategory(value)` | Trims and limits category names to 30 characters. |
| `isValidPriority(p)` | Validates against `low`, `medium`, `high`, `critical`. |
| `isValidStatus(s)` | Validates against `backlog`, `in_progress`, `review`, `completed`, `blocked`. |
| `sanitizeTaskText(text, max=500)` | Trims and truncates task text to `max` length. |

### Encryption (`CryptoUtils` in `idb.mjs`)

Optional AES-256-GCM encryption using Web Crypto API:

- **Key derivation:** PBKDF2 with 100,000 iterations, SHA-256, fixed salt.
- **Default password:** `'default-dashboard-key'` (not a security boundary — dashboard has no secrets).
- **Available but unused:** The current dashboard stores no sensitive data in IndexedDB.

> **Note:** `initEncryption()` must be called explicitly. Encryption is not enabled by default.

---

## Exported Globals

Both `StateManager` and `OfflineUIManager` are exposed on `window` for backward compatibility:

```javascript
window.StateManager  // all public methods
window.OfflineUIManager  // singleton instance
```

---

## Event System

### SyncManager Events

| Event | Payload | Description |
|-------|---------|-------------|
| `online` | — | Client connected to network |
| `offline` | — | Client lost connectivity |
| `syncStart` | — | Queue processing started |
| `syncComplete` | `{ tasks? }` | All pending items processed |
| `syncError` | `{ item, error }` | Sync failure |
| `queueUpdate` | `{ operation, taskId, status }` | Queue item state changed |
| `conflictDetected` | `{ item, error }` | HTTP 409 received |
| `conflictResolved` | `{ taskId, resolvedData }` | Conflict resolved |
| `queueCleared` | — | All queue items removed |

### StateManager Events

| Event | Payload | Description |
|-------|---------|-------------|
| `load` | state | Initial state loaded |
| `save` | state | State persisted |
| `change` | state | State mutated |
| `clear` | state | State cleared |
