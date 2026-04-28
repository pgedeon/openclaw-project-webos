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
