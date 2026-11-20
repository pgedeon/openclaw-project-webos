# openclaw-webos — Phase 2.5 live-refresh proof (2026-11-20, dev gateway)

Card: `599744ce-27d8-4771-98d8-b3b96a6d2216`
Task key: `webos:openclaw-native-integration:phase2.5:tab-live-refresh:v1`
Commit: `0509233` (pushed to `origin/main`)
Gateway: `openclaw-gateway.service` active, OpenClaw 2026.11.3 (847611d)
Plugin generation after reload: 6, revision `27edaabf4b7a…`

## What changed

`openclaw-webos/dist/control-ui/<hash>/webos-desktop-view.js` — after the
initial `workboard.cards.list` the view runs a bounded refresh loop through the
Control UI `host.request`:

1. `workboard.notifications.events` `{ boardId, limit }` — completed/failed/stale
2. `workboard.notifications.advance` `{ subscriptionId }` — **separate RPC**
   (gateway rejects `advance: true` on `events`)
3. `workboard.cards.list` `{ boardId, sinceRevision }` — `{ unchanged: true }`
   sentinel; this is what surfaces status/title/updatedAt/heartbeat edits,
   because the notify kinds do not cover them

Bounds: 8s interval (floor 5s), single in-flight, `setTimeout` + `unref`
(no `setInterval`), abort on `context.signal` or cleanup.

## Contract drift found live (2026.11.3)

Phase 0 §3 pinned `advance` as cursor-only. Live 2026.11.3 requires a
`subscriptionId`:

```
$ openclaw gateway call workboard.notifications.advance --params '{"boardId":"default"}' --json
{"ok": false, "error": {"code": "workboard_error",
 "message": "subscriptionId is required to advance notification events."}}
```

So the view keeps ONE board-scoped cursor record
(`workboard.notifications.subscribe`, `target: "openclaw-webos-tab"`) when the
operator connection can write. On mount it calls
`workboard.notifications.list`, reuses the existing record, prunes duplicates,
and creates one only when absent. Keeping it (rather than deleting on cleanup)
means a reload resumes at the right cursor instead of replaying history.
Read-only operators skip the record entirely and keep the cursor client-side —
nothing is written to the gateway.

Also confirmed live: `workboard.notifications.events` returns only
`completed`/`failed`/`stale` (`WORKBOARD_NOTIFICATION_KINDS`), so a heartbeat or
status edit produces **no** notification event. The `sinceRevision` sentinel is
therefore required, not optional.

## Acceptance — live, headless Chrome over CDP

Harness: `scripts/live-refresh-acceptance.mjs` (committed). Auth via
`openclaw dashboard --json` → `browserUrl` bootstrap, then `/openclaw/desktop`.
No throwaway cards were created; the observed card is this running card.

```
baselineText : "... high coder 8m ago"
observedText : "... high coder just now"
observedAtIso: 2026-11-20T06:43:07.796Z
liveChip     : "live"
```

The change was produced by a real `workboard_heartbeat` on the running card
(`lastHeartbeatAt` 1795156978711) with **no Refresh click**. Screenshots:
`01-baseline.png`, `02-live-updated.png`.

Unmount / cleanup:

```
notifyRpcFrames: { beforeLeave: 5, afterLeave: 5, afterIdle: 5 }
pollingStoppedAfterUnmount: true
errorsAfterUnmount: ["Failed to load resource: ... 404 (Not Found)"]
```

Zero further `workboard.notifications.events` frames after navigating away
(5/5/5). The one post-unmount 404 and the 401/404 entries in `consoleErrors` are
core Control UI bootstrap paths, not the tab:

```
401 /openclaw/control-ui-config.json
404 /openclaw/api/users/gateway-owner/avatar?v=…
404 /openclaw/__openclaw__/workspace-icon/agent%3Amain%3Amain
```

(Same residual class already recorded in `install/proof-2026-11-20/EVIDENCE.md`.)

## Degrade path (unit-proven)

`tests/test-openclaw-webos-extension.js` — "unsupported notify RPC degrades to a
chip and keeps manual Refresh": an `unknown method` error on
`workboard.notifications.events` stops the loop, leaves
`data-action="refresh"` in the DOM, renders `data-live="unavailable"` /
"live updates unavailable" chip text, and schedules nothing further (no fast-poll
fallback).

## Gates

```
node tests/test-openclaw-webos-extension.js   -> 19/19 passed
node scripts/ci-db-free-tests.js              -> 72/72 passed
node scripts/docs-drift-check.js              -> Errors: 0, Warnings: 0
curl http://localhost:8120/api/health         -> 200
```

## Install state (dev)

Files synced to `/root/.openclaw/extensions/openclaw-webos/` and byte-identical
to the repo (`webos-desktop-view.js`, `index.css`, `README.md`).
`openclaw plugins reload openclaw-webos` → generation 6. No gateway restart, no
config change.

Asset route (bearer auth):

```
index.js              200 2555
index.css             200 2909   (contains .wb-live)
webos-desktop-view.js 200 16806  (contains sinceRevision)
```
