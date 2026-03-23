# OpenClaw Desktop File Explorer + Notepad Implementation Brief

## Objective

Add two new native apps to the standalone OpenClaw desktop shell in `~/.openclaw/workspace/dashboard`:

- `Explorer`: browse and search files under the OpenClaw root directory.
- `Notepad`: open, edit, and save text files from that directory.

The goal is to let an operator work with files in `/root/.openclaw` from the desktop shell without leaving the browser UI.

## Important Context

The target is the standalone WebOS dashboard, not the main Next.js frontend.

Relevant files:

- `src/shell/app-registry.mjs`
- `src/shell/shell-main.mjs`
- `src/shell/window-manager.mjs`
- `src/shell/native-views/`
- `task-server.js`
- `memory-api-server.mjs`

Current shell behavior:

- Apps are registered in `src/shell/app-registry.mjs`.
- Native apps render through `src/shell/window-manager.mjs`.
- The window manager currently supports one window per `app.id`.
- Re-clicking the same app focuses the existing window instead of opening a second instance.

Because of that, `Notepad` should be implemented as a single app window with internal tabs, not as many independent editor windows.

## Hard Constraints

### 1. Do not add repo-wide file editing directly to `task-server.js`

`task-server.js` currently:

- documents no auth by default,
- uses permissive CORS,
- listens on `0.0.0.0`,
- serves the desktop shell publicly on the configured port.

Do not expose `/root/.openclaw` read/write endpoints from that server.

### 2. Use a separate local-only filesystem API server

Create a new server, for example:

- `filesystem-api-server.mjs`

Requirements:

- bind to `127.0.0.1` only,
- default root: `/root/.openclaw`,
- configurable via env,
- only serve filesystem APIs,
- return JSON only.

Suggested env vars:

- `FILESYSTEM_API_PORT=3880`
- `OPENCLAW_FS_ROOT=/root/.openclaw`

### 3. Never trust raw paths from the client

Do not use `basename()` as the main path safety mechanism for this feature because nested folders are required.

Instead:

1. Resolve the requested path against `OPENCLAW_FS_ROOT`.
2. Normalize with `path.resolve`.
3. If needed, use `fs.realpath` for final verification.
4. Reject any request whose resolved path escapes the allowed root.

### 4. Default to text editing only

This feature is for source files and docs, not arbitrary binary editing.

Rules:

- detect binary files and open them read-only,
- preview images if useful,
- refuse to edit large binary assets,
- treat very large text files cautiously.

## Product Direction

### Explorer app

Build a native view:

- `src/shell/native-views/explorer-view.mjs`

Register it in:

- `src/shell/app-registry.mjs`

Core UX:

- left sidebar tree for folders,
- breadcrumb bar,
- quick roots:
  - `/root/.openclaw/backend`
  - `/root/.openclaw/frontend`
  - `/root/.openclaw/workspace/dashboard`
  - `/root/.openclaw/extensions`
  - `/root/.openclaw/agents`
  - `/root/.openclaw/docs`
- center file list,
- sort by name / modified / size,
- search box powered by `rg`,
- double-click file opens it in Notepad,
- right-click or action menu for:
  - Open
  - Rename
  - Delete
  - New file
  - New folder
  - Copy path

### Notepad app

Build a native view:

- `src/shell/native-views/notepad-view.mjs`

Register it in:

- `src/shell/app-registry.mjs`

Core UX:

- one app window,
- internal tabs for multiple open files,
- textarea or code-editor-style surface,
- unsaved indicator per tab,
- `Ctrl+S` / `Cmd+S` save,
- close-tab guard for unsaved changes,
- status bar showing:
  - path
  - line count
  - dirty state
  - save status

Phase 1 editor can be plain textarea. Fancy syntax highlighting is optional.

## Recommended Architecture

### Backend

Create `filesystem-api-server.mjs` modeled after `memory-api-server.mjs`, but for the full OpenClaw root.

Suggested endpoints:

- `GET /api/fs/list?path=...`
- `GET /api/fs/file?path=...`
- `PUT /api/fs/file`
- `POST /api/fs/file`
- `POST /api/fs/mkdir`
- `POST /api/fs/rename`
- `DELETE /api/fs/path`
- `GET /api/fs/search?q=...&path=...`
- `GET /api/fs/stat?path=...`

Suggested response shapes:

### list

```json
{
  "path": "frontend/src",
  "parent": "frontend",
  "items": [
    {
      "name": "app",
      "path": "frontend/src/app",
      "type": "directory",
      "size": 4096,
      "modified": "2026-03-23T08:00:00.000Z"
    },
    {
      "name": "page.tsx",
      "path": "frontend/src/app/page.tsx",
      "type": "file",
      "size": 8123,
      "modified": "2026-03-23T08:01:00.000Z",
      "isText": true
    }
  ]
}
```

### file read

```json
{
  "path": "frontend/src/app/page.tsx",
  "name": "page.tsx",
  "content": "...",
  "encoding": "utf8",
  "size": 8123,
  "lines": 240,
  "isText": true,
  "modified": "2026-03-23T08:01:00.000Z"
}
```

### file write

```json
{
  "path": "frontend/src/app/page.tsx",
  "saved": true,
  "size": 8300,
  "lines": 245,
  "modified": "2026-03-23T08:05:00.000Z"
}
```

## Passing file-open requests between apps

Do not change the shell to support multi-instance window payloads in phase 1.

Use the existing shared shell state instead:

- Explorer writes an `editor` or `notepad` request into shared state.
- Explorer then opens the `notepad` app.
- Notepad subscribes to shared state and opens the requested file in a tab.

This matches the current shell better than rewriting the window manager first.

Suggested state shape:

```json
{
  "notepad": {
    "openRequest": {
      "path": "frontend/src/app/page.tsx",
      "requestedAt": "2026-03-23T08:05:00.000Z"
    }
  }
}
```

## Security Requirements

### Protected paths

Some paths should be read-only by default or require a strong confirmation before write operations:

- `.git/`
- `credentials/`
- `browser/**/user-data/`
- `.env`
- `*.pem`
- `*.key`
- `*.crt`
- `*.p12`
- `openclaw.json`

Recommended rule:

- allow read access,
- block normal writes,
- or require an explicit "I understand" confirmation step before save.

### Secret-aware save guard

Before saving:

1. inspect file path against protected patterns,
2. scan content for obvious secrets,
3. warn before writing sensitive material,
4. log the save event without logging secret contents.

If existing secret-scanning utilities can be reused, prefer reuse over inventing a second scanner.

### Binary and size safeguards

Suggested guardrails:

- if file contains null bytes, mark as binary,
- if file exceeds a configured size threshold, open read-only or require explicit force-open,
- do not attempt full inline editing of giant log files or databases.

## Implementation Plan

### Phase 1: Filesystem API

Create:

- `filesystem-api-server.mjs`

Add:

- env handling in `.env.example`
- startup documentation in `docs/install-openclaw.md`
- optional helper script updates if the dashboard startup flow should launch this server automatically

### Phase 2: Notepad

Create:

- `src/shell/native-views/notepad-view.mjs`

Add to:

- `src/shell/app-registry.mjs`

Requirements:

- open file by path,
- edit text,
- save text,
- keyboard shortcut save,
- tabs,
- dirty-state guard.

Use the existing Memory app as a reference for basic text editing and saving flow, but do not reuse its flat-file path assumptions.

### Phase 3: Explorer

Create:

- `src/shell/native-views/explorer-view.mjs`

Add to:

- `src/shell/app-registry.mjs`

Requirements:

- browse directories,
- open files into Notepad,
- search by filename and content,
- create / rename / delete,
- quick roots,
- breadcrumbs.

### Phase 4: Polish

Add:

- readonly badge,
- binary preview handling,
- modified timestamp refresh after save,
- better empty / loading / error states,
- optional git status badges.

### Phase 5: Tests and docs

Update:

- `docs/api.md`
- `README.md` if the new apps should be visible in feature lists

Add tests for:

- path traversal rejection,
- protected path handling,
- file read,
- file save,
- Explorer open-in-Notepad flow,
- Notepad dirty-state behavior.

## Acceptance Criteria

The feature is complete when all of the following are true:

1. The desktop shell shows two new apps: `Explorer` and `Notepad`.
2. Explorer can browse nested directories under `/root/.openclaw`.
3. Explorer can search for files and content.
4. Double-clicking a text file opens it in Notepad.
5. Notepad can keep multiple files open as tabs.
6. `Ctrl+S` / `Cmd+S` saves the active file.
7. Path traversal attempts are rejected server-side.
8. Sensitive paths are not silently writable.
9. Binary files are not treated like editable text.
10. The feature works without changing the shell into a multi-instance window manager.

## Nice-to-Have After Phase 1

- syntax highlighting,
- markdown preview,
- diff view before save,
- git status badges,
- recent files list,
- drag-and-drop between Explorer and Notepad,
- split-pane editing.

## Summary For OpenClaw

Implement this as a local-only, security-conscious desktop file tool for the standalone dashboard.

Do this:

- add a separate filesystem API server bound to `127.0.0.1`,
- add `Explorer` and `Notepad` as native shell apps,
- keep Notepad single-window with tabs,
- use shared shell state to send file-open requests,
- protect sensitive paths and block traversal,
- ship tests and docs with the feature.

Do not do this:

- do not expose repo-wide filesystem writes from `task-server.js`,
- do not rely on `basename()` for nested path security,
- do not treat binary files as editable text,
- do not rewrite the window manager for multi-instance support in phase 1.
