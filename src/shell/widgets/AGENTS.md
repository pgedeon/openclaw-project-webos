# src/shell/widgets/ — Desktop Widget System

## Purpose

18 always-on desktop widgets that display live data in the widget panel and on the desktop.

## Ownership

| File | Owns |
|------|------|
| `widget-registry.mjs` | `WIDGET_INDEX` — registry of all 18 widgets with manifests |
| `widget-panel.mjs` | Side panel: add/remove widgets, drag reorder, keyboard/touch move menu, size overrides |
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


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
