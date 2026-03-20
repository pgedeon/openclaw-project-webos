# Development Guide

Architecture, conventions, and extension points for the OpenClaw Project Dashboard.

---

## Architecture Overview

```
┌────────────────────┐
│   dashboard/       │
│   dashboard.html   │  ← Single‑page UI (embedded JS/CSS)
└─────────┬──────────┘
          │
          │ dynamic imports
          ▼
   ┌──────────────┐
   │ /src/*.mjs   │  ← Modular UI renderers & state managers
   └──────┬───────┘
          │
          │ fetch()
          ▼
   ┌──────────────┐
   │  task‑server │  ← Node.js HTTP server, REST API
   │  .js         │
   └──────┬───────┘
          │
          │ uses
          ▼
   ┌──────────────┐
   │ storage/     │  ← AsanaStorage (PostgreSQL or JSON)
   │ asana.js     │
   └──────────────┘
```

- **Frontend** is a single HTML file with inline CSS and JavaScript. Heavy logic lives in ES modules under `src/`. The page uses dynamic imports to load `audit-view.mjs`, `board-view.mjs`, `timeline-view.mjs` only when needed.
- **State Management** is provided by `src/offline/state-manager.mjs`, which persists to IndexedDB for offline resilience and syncs with the server via `sync-manager.mjs`.
- **Backend** is a small custom HTTP server (`task-server.js`) with route handlers for Projects, Tasks, Views, Agent actions, and Audit.
- **Storage** is abstracted in `storage/asana.js`. It supports PostgreSQL (default) and a JSON file fallback.

---

## Extending the API

Add a new endpoint in `task-server.js`:

1. Parse `url` and `method`.
2. If needed, `await asanaStorage.someMethod()`.
3. Return JSON via `sendJSON(res, status, payload)`.

Example:

```js
// GET /api/hello
if (url === '/api/hello' && method === 'GET') {
  sendJSON(res, 200, { message: 'Hello world' });
  return;
}
```

Remember to export any new storage methods from `storage/asana.js`.

---

## Extending the UI

### Adding a New View

1. Create `src/my-view.mjs`:

```js
export default class MyView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
  }
  async load(params) { /* fetch data if needed */ }
  render() { /* render into this.container */ }
}
```

2. In `dashboard.html`, add a button in the view switcher:

```html
<button class="view-btn" data-view="myview" type="button" title="My view">⭐</button>
```

3. Add a case in `renderView()`:

```js
case 'myview':
  await this.renderMyView();
  break;
```

4. Implement `renderMyView()` to dynamically import your module and instantiate:

```js
async function renderMyView() {
  dom.taskList.innerHTML = '';
  try {
    const mod = await import('./src/my-view.mjs');
    const view = new mod.default(dom.taskList, { /* options */ });
    await view.load();
  } catch (e) {
    console.error('[Dashboard] MyView failed:', e);
    dom.taskList.innerHTML = '<div class="empty-state">My view unavailable</div>';
  }
}
```

### Styling

All styles are in the `<style>` block of `dashboard.html`. They use CSS variables:

```css
:root {
  --bg: #f4f1ff;
  --surface: #ffffff;
  --text: #1f1f2b;
  --accent: #5c6bf2;
}
[data-theme="dark"] { ... }
```

To change a color, edit the variable in both `:root` and `[data-theme="dark"]`.

---

## Storage Layer (`storage/asana.js`)

This class implements CRUD for Projects, Tasks, and Views. It is the sole writer to the database.

### Methods (existing)

- `init()` – connect to DB and ensure tables exist.
- `createProject(data)`
- `updateProject(id, data)`
- `archiveProject(id)`
- `listProjects(filters?)`
- `createTask(data)`
- `getTask(id, options?)`
- `updateTask(id, data)`
- `deleteTask(id)`
- `listTasks(projectId, options?)`
- `moveTask(id, newStatus)` – sets status and timestamps.
- `addDependency(taskId, depId)`, `removeDependency(...)`
- `addSubtask(parentId, subId)`
- `getBoardView(projectId)`
- `getTimelineView(projectId, start, end)`
- `getAgentQueue(agentName, statuses, { page, limit })`
- `claimTask(taskId, agentName)`
- `releaseTask(taskId)`
- `getAuditLog(taskId, limit)`

### Adding a New Method

1. Implement the function using `this.pool` (pg client) or `this.db` (JSON).
2. For PostgreSQL, use parameterized queries to avoid SQL injection.
3. Return plain objects that match the API response shape.
4. Add a route in `task-server.js` that calls the method.

---

## Testing

### Unit Tests (storage)

Create `storage/__tests__/asana.test.js` using any test runner (Mocha, Jest). Example with Node’s `assert`:

```js
import { strict as assert } from 'node:assert';
import { AsanaStorage } from '../storage/asana.js';

let storage;
beforeAll(async () => {
  storage = new AsanaStorage({ database: 'test_db' });
  await storage.init();
});
afterAll(async () => {
  await storage.pool.end();
});

test('create project', async () => {
  const p = await storage.createProject({ name: 'Test' });
  assert(p.id);
  assert.equal(p.name, 'Test');
});
```

Run with `node --experimental-vm-modules node_modules/.bin/jest` or your preferred runner.

### API Integration Tests

`dashboard/scripts/dashboard-validation.js` performs basic integration checks. Extend it to cover new endpoints.

Run:

```bash
node dashboard/scripts/dashboard-validation.js
```

It exits with `0` on success.

---

## Coding Conventions

- **Node version:** Use ES modules (`.mjs` extension). `type: "module"` is set in `package.json` for the workspace.
- **Async:** All I/O should be `async/await`. Handle errors with try/catch.
- **Error handling:** In storage methods, throw `new Error('message')` with a clear message; the server catches and returns 500.
- **UUIDs:** Use `crypto.randomUUID()` (Node 19+) or import `uuid` package. The storage layer generates UUIDs for new records.
- **SQL:** Use parameterized queries (`pool.query(sql, [params])`). Never interpolate values directly.
- **JSON storage:** When `STORAGE_TYPE=json`, the `AsanaStorage` uses a file (`data/asana-db.json`). You must call `this._save()` after mutations.
- **Frontend modules:** Use ES module syntax. Export a default class or function. Avoid global variables.
- **Styling:** Prefer CSS variables for colors. Support dark mode via `[data-theme="dark"]`.

---

## Debugging

### Server

Set `DEBUG=dashboard:*` and look for `console.debug` statements (add them as needed). Or insert `console.log` in route handlers.

### Frontend

Open browser DevTools → Console. Errors from dynamic imports appear there. Network tab shows API calls.

The `performanceMonitor` module (`src/performance-monitor.mjs`) logs render times if enabled:

```js
performanceMonitor.measure('renderListView', () => {
  // ...
});
```

---

## Deployment Checklist

- [ ] Set `STORAGE_TYPE=postgres` and verify DB connectivity.
- [ ] Run `dashboard/scripts/dashboard-validation.js` and ensure all checks pass.
- [ ] Configure a process manager (systemd/pm2) with restart on failure.
- [ ] Place behind a reverse proxy with TLS (Nginx example in README).
- [ ] Restrict access by IP or add authentication at proxy layer.
- [ ] Set up log rotation for `logs/dashboard-health.log` and systemd journal.
- [ ] Schedule daily PostgreSQL backups.
- [ ] Verify `/api/health` returns `"asana_storage":"enabled"`.

---

## Future Work

- Multi‑project UI (currently single‑project implicit)
- Real‑time updates via WebSocket (currently polling only in Agent view)
- Full Board and Timeline interactions (drag‑and‑drop, resizing)
- Recurring task engine
- Role‑based access control
- CSV import with column mapping UI

---

## Getting Help

- Read the inline code comments; they often explain design decisions.
- Check the GitHub Issues for known problems.
- Reach out on OpenClaw Discord: https://discord.com/invite/clawd
