---
layout: default
---

# Live Agent Console — Validation Against Live Gateway (2026-08-24)

Verdict: **validated** (validated-with-notes). Console feed v1 works end-to-end against
the production OpenClaw gateway with zero code changes required.

## Setup

Isolated stack: `PORT=13885 STORAGE_TYPE=json_snapshot DASHBOARD_AUTH_TOKEN=console-val-token
node task-server.js` (started by coder attempt r1; server log at /tmp/console-val-server.log).
Production task-server on :3876 untouched throughout; :13885 killed after evidence capture.

## Chain evidence

- Feed connect: `[gateway-console-feed] connected (console tap)` in server log — own v4
  handshake, shared secret resolved from `~/.openclaw/openclaw.json` (mode=password),
  independent of the state bridge which connected alongside it
  (`[gateway-bridge] connected protocol=4`).
- SSE attach: `GET /api/console/stream?session=…` → `200`, `: connected` + `: hb`
  keep-alive frames observed. Unauthenticated request rejected by the shared `/api/*`
  bearer middleware (401 path exercised in tests/test-sse-routes.js).

## Frame evidence (live capture, session agent:qa-auditor:qa-cbb-pumps-g1, ~40s)

- `console:tool-start` ×3 — name + argsPreview (truncated command echo) present.
- `console:tool-output` ×1 — real command stdout chunk (sitemap URL list) streamed mid-run.
- `console:tool-end` ×2 — status=completed, exitCode=0, durationMs=43, cwd present.
- All frames carry sessionKey/agentId/runId/seq as per brief contract.

## Per-session filtering

Second capture against a different session returned only its own frames; grep of the
qa-auditor capture shows **0** frames whose `sessionKey` belongs to any other session.
Fleet-wide traffic (~21 events/s) did not leak across sessions.

## Secret redaction

`grep -ci "password"` on both captures = 0 hits. Gateway secret never appeared in frames.

## Warts found (documented only — no code changes needed)

1. Duplicate `console:tool-end` for the same toolCallId+seq observed back-to-back in the
   raw capture (seq 84 and 87 both terminal for call_07a110fa…). Harmless visually but a
   view-side dedupe on (toolCallId, kind) is worth adding when the view gets polish.
2. First capture attached to a session that had just gone idle → immediate
   `console:end {reason:"idle"}` after `: connected`. Correct behavior, good to confirm
   the idle path fires in production conditions (unit-tested previously).
3. No counters exposed for delivered/dropped frames (same wart as bridge v1; observability
   backlog item for both feeds).

## Verdict

Validated. Roadmap Phase 1 "Live agent console" ticked on this basis
(implementation 83919c4, validation this doc).
