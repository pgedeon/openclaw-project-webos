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


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
