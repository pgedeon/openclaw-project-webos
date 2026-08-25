---
layout: default
---

# Gateway Bridge v1 — Live Validation

**Date:** 2026-08-24 · **Scope:** end-to-end run of shipped bridge (6184097) against live gateway
**Stack:** isolated `task-server.js` :13883, `STORAGE_TYPE=json_snapshot`, `GATEWAY_BRIDGE_URL=wss://127.0.0.1:18789`, auth from `~/.openclaw/openclaw.json` (`gateway.auth.mode=password`). Production :3876 untouched.

## Results

| Check | Evidence |
|---|---|
| Bridge connects live gateway | `[gateway-bridge] connected protocol=4 server=2026.7.1-2` at startup |
| SSE headers | `200`, `text/event-stream`, `no-cache`, `keep-alive`; unauthenticated request → `401` |
| Heartbeats | 2× `: heartbeat` comments in 70s window (30s interval) |
| Real gateway events | 70s window: 495 `task-updated` + 118 `agent-status-changed` + 63 `run-updated`; rows match live fleet tasks incl. this validation session's own tool calls |
| Dedupe under load | Raw gateway 30s window (probe): 905 `task` + 88 `agent` + 30 `session.tool`. Same-window SSE delivery: 813/62/32 normalized. **0 duplicate `event+id+updatedAt` frames forwarded** across both capture windows (1583 delivered total); heavy gateway re-upserts collapsed as designed |
| Seq-gap/resync | 0 envelope-seq gaps, 0 `resync` hints (path exercised only by unit tests) |
| Client cleanup | Abrupt SIGKILL of one SSE client → second client uninterrupted (377 events after kill), server log clean |

## Warts (no code changes)

- No bridge-side raw-vs-delivered counters; comparison required the external probe (`scripts/probe-gateway-ws.mjs`). Nice-to-have for ops.
- Reconnect/backoff and seq-gap→resync paths not observable on a healthy connection; covered by tests/test-gateway-bridge.js only.

## VERDICT: validated
