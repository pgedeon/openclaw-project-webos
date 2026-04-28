# src/shell/native-views/ — Windowed App Views

## Purpose

26 windowed applications that render inside the desktop shell. Each view is a self-contained module that creates UI inside a window container.

## Registration

1. Create `<name>-view.mjs` in this directory
2. Export: `export function render(container, context) { ... }` or default export
3. Add to `APP_REGISTRY` in `../app-registry.mjs`:
   ```js
   { id: 'my-view', label: 'My View', icon: appIcon.foo, viewModule: './native-views/my-view-view.mjs', category: 'Work', defaultWidth: 800, defaultHeight: 600 }
   ```
4. Update `docs/views-reference.md`

## View Context

Views receive a `context` object with:
- `api` — API client instance (see `api-client.mjs`)
- `sync` — RealtimeSync instance for live data
- `navigate(viewId, params)` — Navigate to another view
- `showNotice(msg, type)` — Show toast notification

## Categories

| Category | Apps |
|----------|------|
| Work | tasks, board, timeline, agents, sessions, requests, publish, approvals, artifacts, dependencies |
| Operations | health, metrics, runbooks, memory, handoffs, audit, cron, diagnostics, departments, workflows |
| Admin | explorer, notepad, skills-tools, bing, settings |

## Conventions

- Use `context.api.*` for all API calls — never hardcode URLs
- Use `context.sync.subscribe(cb)` for reactive data updates
- Clean up event listeners and intervals when container is removed
- Responsive: views should work at 640×400 and up
