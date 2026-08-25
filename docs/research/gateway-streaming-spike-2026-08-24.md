---
layout: default
---

# Gateway Streaming Spike — Feasibility + Recipes

**Date:** 2026-08-24 · **Author:** qa-auditor (spike r2) · **Status:** findings final, no source changes

Read-only recon of the OpenClaw gateway WebSocket surface to answer two questions:

1. Can a **server-side fan-out WS bridge** replace the dashboard's `realtime-sync` polling?
2. Is **live agent console streaming** (tool calls, token deltas, command output) exposed?

Method: dedicated probe (`scripts/probe-gateway-ws.mjs`, read-only by construction) against the
live gateway, plus cross-check against the bundled gateway protocol docs.

---

## TL;DR

| Question | Verdict |
|---|---|
| Fan-out WS bridge replacing `realtime-sync` polling | **Feasible** — everything the pollers fetch arrives push-based, plus richer deltas |
| Live agent console streaming | **Feasible** — full tool lifecycle + token/command-output deltas are broadcast |
| Delivery contract to browser | Keep existing SSE (`routes/sse-routes.js`) as the stable front-door; swap its feed from pollers to the WS bridge incrementally |

The gateway must never be exposed browser-direct (shared-secret landmine, see Risks).

---

## What the gateway exposes

### Transport + framing

- WebSocket, text frames, JSON payloads. Protocol version **v4**.
- Frame shapes:
  - Request: `{type:"req", id, method, params}`
  - Response: `{type:"res", id, ok, payload|error}`
  - Event: `{type:"event", event, payload, seq}` — `seq` is a **per-connection** broadcast counter.
- Pre-connect frames capped at 64 KiB; post-handshake limits come from `hello-ok.policy`.
- Two independent sequence numbers exist on session-class events:
  - envelope `seq` — ordering of broadcasts **to this connection**
  - `payload.seq` — monotonic **per-session** stream sequence (e.g. 2754 → 2755)
  Consumers must not conflate them. Envelope `seq` gaps = missed frames → resync.

### Handshake (verified working)

```
server → {type:"event", event:"connect.challenge", payload:{nonce, ts}}
client → {type:"req", id, method:"connect", params:{
           minProtocol:4, maxProtocol:4,
           client:{id:"gateway-client", version, platform:"linux", mode:"backend"},
           role:"operator", scopes:["operator.read"],
           caps:[], commands:[], permissions:{},
           auth:{password|token},          // per gateway.auth.mode
           locale, userAgent}}
server → {type:"res", ok:true, payload:{ /* hello-ok */ }}
```

`hello-ok` (observed):

```json
{
  "protocol": 4,
  "server": {"version": "2026.7.1-2", "connId": "<uuid>"},
  "features": {"methods": ["…283 entries"], "events": ["…30 entries"]},
  "auth": {"role": "operator", "scopes": ["operator.read"]},
  "policy": {"maxPayload": 26214400, "maxBufferedBytes": 52428800, "tickIntervalMs": 30000}
}
```

Auth mechanism found:

- Shared secret from `~/.openclaw/openclaw.json` → `gateway.auth.mode` = `password` | `token`,
  sent once inside `connect.params.auth`. No challenge-response crypto on this path.
- TLS is self-signed; trust anchor is the pinned fingerprint
  (`gateway.remote.tlsFingerprint`, SHA-256) — probe aborts on mismatch.
- Trusted same-process backend clients (`client.id:"gateway-client"`, `mode:"backend"`) may omit
  the `device` block on loopback connections. Remote/browser/node clients cannot.

### Advertised surface

- **283 methods**, including read-relevant: `health`, `status`, `sessions.list`,
  `sessions.subscribe`, `sessions.messages.subscribe`, `tasks.list`, `chat.history`,
  `logs.tail`, `audit.list`, `agents.list`, `usage.cost`.
- **30 events**: `connect.challenge`, `agent`, `chat`, `session.message`, `session.operation`,
  `session.tool`, `sessions.changed`, `presence`, `tick`, `talk.*`, `shutdown`, `health`,
  `heartbeat`, `cron`, `task`, `node.pair.*`, `node.invoke.request`, `device.pair.*`,
  `voicewake.*`, `exec.approval.*`, `plugin.approval.*`, `terminal.data`, `terminal.exit`,
  `update.available`.

### Observed live traffic (read-only windows)

Window A: 30 s, quiet-ish fleet · Window B: 12 s, busy fleet.

| Event | A (30 s) | B (12 s) |
|---|---|---|
| `task` | 424 | 1592 |
| `agent` | 128 | 249 |
| `session.tool` | 28 | 37 |
| `chat` | 20 | 4 |
| `session.message` | 12 | 13 |
| `health` | 2 | 1 |
| `sessions.changed` | 1 | 2 |
| `tick` | 1 | 1 |

RPC results: `sessions.subscribe` → `{subscribed:true}`; `health` → 24 KB snapshot;
`sessions.list` → 143 KB, `count:100, totalCount:729, hasMore:true` (offset pagination).

### Event shapes (verbatim field maps)

**`session.tool`** — full tool-call lifecycle, three phases on one `toolCallId`:

```jsonc
{
  "type": "event", "event": "session.tool",
  "payload": {
    "runId": "<uuid>",
    "stream": "tool",
    "data": {
      "phase": "start | update | result",
      "name": "exec",
      "toolCallId": "<id>",
      // phase=start:
      "args": {"command": "…"},
      // phase=update:
      "partialResult": {"content": [{"type": "text", "text": "…"}]},
      // phase=result:
      "result": {"content": [{"type": "text", "text": "…"}],
                 "details": {"status": "completed", "exitCode": 0, "exitSignal": null,
                              "exitReason": "exit", "durationMs": 961,
                              "aggregated": "", "noOutputTimedOut": false, "cwd": "…"}},
      "meta": "human-readable one-liner"
    },
    "sessionKey": "agent:<agent>:<session>", "agentId": "<agent>",
    "seq": 2754, "ts": 1787530620467,
    "session": { /* embedded session row snapshot */ }
  },
  "seq": 7   // envelope (per-connection)
}
```

**`agent`** — three `stream` values:

```jsonc
// stream="item" — structured item start/end (tool + command twins share toolCallId)
{"data": {"itemId": "tool:<callId> | command:<callId>", "phase": "start|end",
          "kind": "tool|command", "title": "exec run …", "status": "running|completed",
          "name": "exec", "meta": "…", "toolCallId": "<id>",
          "startedAt": …, "endedAt": …}}

// stream="assistant" — LLM token streaming
{"data": {"text": "cumulative text so far", "delta": "new tokens only"}}

// stream="command_output" — exec process output/completion
{"data": {"itemId": "command:<callId>", "phase": "end", "title": "command run …",
          "toolCallId": "<id>", "name": "exec", "status": "completed",
          "exitCode": 0, "durationMs": 961, "cwd": "…"}}
```

**`chat`** — transcript deltas (cumulative text + increment):

```jsonc
{"payload": {"runId": "<uuid>", "sessionKey": "…", "agentId": "coder",
             "seq": 797, "state": "delta", "deltaText": "uing. Read docs targets…",
             "message": {"role": "assistant",
                         "content": [{"type": "text", "text": "<full cumulative>"}],
                         "timestamp": …}}}
```

**`task`** — upsert snapshots only (`action:"upserted"` observed; no tombstones seen):

```jsonc
{"payload": {"action": "upserted",
             "task": {"id": "<uuid>", "taskId": "<same>", "kind": "cli", "runtime": "cli",
                      "status": "running", "title": "…", "agentId": "…",
                      "sessionKey": "…", "childSessionKey": "…", "ownerKey": "…",
                      "runId": "<uuid>", "sourceId": "<uuid>",
                      "createdAt": …, "updatedAt": …, "startedAt": …}},
 "seq": 2}
```

⚠️ **Heavy duplication:** the same task id is re-upserted many times with only `updatedAt`
bumped (one id emitted 10× within seconds; 1592 `task` events in 12 s fleet-wide).
Consumers must dedupe by `task.id` + `updatedAt` and coalesce before fanning out.

**Minor events:** `health` = periodic full snapshot (~24 KB), `tick` = keepalive,
`sessions.changed` = index-dirty nudge (re-fetch via `sessions.list`).

---

## Working connection recipe

Probe: `scripts/probe-gateway-ws.mjs` (untracked companion of this spike, read-only by
construction — requests `operator.read` only, sends no mutating RPC).

```bash
node scripts/probe-gateway-ws.mjs [--ms 30000] [--url wss://host:port] [--out FILE.jsonl] [--quiet]
# exit 0 = handshake + observation ok; 1 = connect/auth/TLS failure; 2 = usage/config error
# writes /tmp/gateway-ws-probe-summary.json (hello-ok, rpc previews, event counts, sample frames)
```

Steps performed: TLS fingerprint pin check → wait `connect.challenge` → send `connect`
(protocol 4, role operator, `scopes:["operator.read"]`) → receive `hello-ok` →
`sessions.subscribe` + `health` + `sessions.list` → log frames for the window → close(1000).

Since r2 the probe redacts `password`/`token`/`deviceToken`/`secret` keys from every logged
frame (r1 echoed the connect-frame password into local sample logs — see Risks).

---

## Feasibility verdicts

### (a) Server-side fan-out WS bridge replacing `realtime-sync` polling — FEASIBLE

`src/shell/realtime-sync.mjs` polls 7 endpoints (`/api/stats`, `/api/health-status`,
`/api/blockers/summary`, `/api/org/summary`, `/api/approvals/pending`,
`/api/workflow-runs/active`, `/gateway-status.json`) every 20 s. All of that state arrives
push-based over one gateway connection (`health`, `task`, `agent`, `session.*`, `tick`) with
strictly better latency and granularity, plus `sessions.list` / `tasks.list` for initial +
reconnect snapshots.

Bridge shape (recommended):

1. One long-lived gateway WS connection inside the dashboard backend, `role:"operator"`,
   `scopes:["operator.read"]`. Secret never leaves the server process.
2. Normalize + dedupe: tasks keyed by `task.id` (+`updatedAt` guard), coalesce bursts
   (≥130 events/s observed), drop embedded `session` rows unless needed.
3. Fan out over the existing SSE hub (`routes/sse-routes.js` `broadcast()`), preserving the
   current browser-facing event names where possible.
4. Resilience: on disconnect, exponential backoff; on reconnect, re-run `sessions.list` /
   `tasks.list` to rebuild state; detect envelope-`seq` gaps → force resync.
5. Roll out per data type: `health` first (low volume), workflow runs next, `task` firehose
   last (needs throttling).

### (b) Live agent console streaming — FEASIBLE

Everything needed already broadcasts:

- Tool calls: `session.tool` `start`(args) → `update`(partialResult) → `result`(exitCode,
  durationMs, cwd) — enough for a live tool-call timeline without polling transcripts.
- Assistant text: `agent` `stream:"assistant"` token deltas (+ cumulative `text`).
- Command output: `agent` `stream:"command_output"` with `exitCode`/`durationMs`.
- Transcript-level messages: `chat` deltas; subscribe via `sessions.messages.subscribe` for the
  message-class events, `chat.history` for backfill.

Per-session filtering is client-side (every payload carries `sessionKey`/`agentId`/`runId`);
the bridge should filter server-side before fan-out (see Risks — `operator.read` is fleet-wide).

---

## Risks / gaps

- **bind lan:** gateway currently listens beyond loopback (`gateway.bind:"lan"` in live
  config). Combined with shared-secret auth this makes "browser connects directly to the
  gateway" a hard anti-pattern — any browser client would need the master secret. The bridge
  must be the only gateway client; browsers only ever see the dashboard's own SSE/HTTP surface.
- **Secret handling:** `operator.read` still sees *all* agents' sessions fleet-wide; there is
  no per-session scope. Filtering is convention, not enforcement — do it in the bridge.
- **Volume/backpressure:** 1592 `task` events in 12 s was a normal busy window; sustained-load
  behavior, slow-consumer buffering (`maxBufferedBytes` 50 MB), and burst drops are untested.
  Coalesce before fan-out; measure before trusting.
- **Dupes without tombstones:** only `upserted` actions observed; deleted/cancelled task
  semantics need confirmation against `tasks.list` diffs during a real cancel.
- **Protocol drift:** shapes captured against server `2026.7.1-2`, protocol v4. Validate
  `helloOk.features.events` at connect and fail soft on unknown events.
- **Credential hygiene incident (fixed):** the r1 probe logged the outbound connect frame —
  including the gateway password — into `/tmp/gateway-ws-probe-summary.json` and a local
  session transcript. Redaction is now enforced inside the probe's `record()` path and the
  `/tmp` artifact was regenerated clean. If pre-fix logs were synced off-host, rotate the
  gateway secret.

## SSE-first fallback recommendation

Keep `routes/sse-routes.js` (F7-hardened) as the **only** browser-facing stream. It already
provides multi-client fan-out + heartbeat and survives gateway outages. Recommended sequence:
SSE contract frozen → bridge feeds it internally → pollers demote to fallback when the WS
bridge is down (degraded mode), not before. Do not attempt direct browser↔gateway WS.

---

## Repro

1. `node scripts/probe-gateway-ws.mjs --ms 30000` → check exit 0, pin `match=true`,
   `hello-ok` scopes `["operator.read"]`.
2. Inspect `/tmp/gateway-ws-probe-summary.json`: `inboundByEvent` counts, `sampleFrames`
   shapes above, zero plaintext secrets (`grep '"password":"***"'`).
3. Optional: `--out capture.jsonl` for full-frame analysis (redacted since r2).
