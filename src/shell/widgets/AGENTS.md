# src/shell/widgets/ — Desktop Widget System

## Purpose

18 always-on desktop widgets that display live data in the widget panel and on the desktop.

## Ownership

| File | Owns |
|------|------|
| `widget-registry.mjs` | `WIDGET_INDEX` — registry of all 18 widgets with manifests |
| `widget-panel.mjs` | Side panel: add/remove widgets, drag reorder, size overrides |
| `widgets/*.mjs` | Individual widget implementations |

## Widget Contract

Each widget must export a manifest:
```js
export const manifest = {
  id: 'my-widget',
  name: 'My Widget',
  description: 'Shows stuff',
  defaultCols: 2,
  defaultRows: 1,
};
```

And a render function:
```js
export function render(ctx) {
  // ctx.element — the DOM element to render into
  // ctx.sync — RealtimeSync instance
  // ctx.api — API client instance
  // ctx.getTheme() — current theme
}
```

## Registration

1. Create widget in `widgets/<name>-widget.mjs`
2. Add to `WIDGET_INDEX` in `widget-registry.mjs`
3. Update `docs/widget-catalog.md`

## Storage

- Enabled widgets and panel position persist in localStorage
- Per-widget size overrides persist in localStorage
- Widget state is NOT persisted — widgets derive from sync data
