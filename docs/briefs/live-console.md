---
layout: default
---

# Design Brief — Live Agent Console (Terminal Stream)

**Status:** Draft for build review · **Roadmap:** Phase 1 run 5 (roadmap-review-2026-08-24.md §4) — unblocked by run 3 (gateway streaming spike, findings final) and run 4 (gateway bridge v1, in flight)
**Evidence base:** gateway-streaming-spike-2026-08-24.md (event shapes, volumes, risks), lib/gateway-bridge.js v1 (normalize layer, dedupe, SSE fanout), routes/sse-routes.js (channel + auth conventions), sessions-view.mjs (picker/streaming UI conventions), session-replay.md (sibling brief; its "no live tailing" non-goal is this feature), agent-queue-view.mjs / AgentView (agent-centric entry UX)
**Order:** docs only in THIS commit. No `.js/.mjs/.sql/.yml` changes. Builder work is sequenced behind bridge-v1 validation sign-off (see §7 Coordination).

---

## 1. Purpose & Value Proposition

Watching an agent work today means either the flat Sessions chat log (lagging,
transcript-shaped) or nothing. When an agent goes sideways mid-run — command
spewing errors, tool looping, assistant heading into a wrong edit — the operator
needs the **live firehose**: what it is typing, what its commands are printing,
right now.

Live Console is a **terminal-style window attached to a running agent
session**: pick a running agent → a scrolling stream of command output lines and
assistant text as it happens, with inline tool-call badges (name, duration,
exitCode). It is the live counterpart to Session Replay (history) — same mental
model, opposite direction in time. The spike proved every needed event already
broadcasts; the bridge v1 exists but deliberately drops the chatty streams this
view needs. This brief defines the passthrough contract so coder and builder can
work the two halves without stepping on each other.

v1 is **read-only and attach-only**: no input, no sending, no abort, no history
backfill (Replay owns history).

---

## 2. UX Flow

Window: `live-console`, default size **1180×780**, Work category (next to
Sessions / Session Replay). Icon: terminal glyph (**new SVG path** — builder
adds `appIcon.terminal`; `rewind` stays unique to Session Replay).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▶ Live Console   [running ▾ / agent ▾]   ● LIVE · run 8f3…   [⏸ Pause]       │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  $ git status --short                                                        │
│   M src/shell/app-registry.mjs                                               │
│  ✔ exec · exitCode 0 · 961ms                                                 │
│  ── 🤖 assistant ────────────────────────────────────────────────────────    │
│  Bridge looks clean. Reading the normalize layer before patching…            │
│  ── 🔧 read · lib/gateway-bridge.js ────────────────────────────────────     │
│  ⠋ running… (streaming output)                                               │
│  [stdout] 3 hunks applied                                                    │
│  ✖ exec · exitCode 1 · 2103ms          ← red badge                           │
│                                                                              │
│                              …(scrollback, newest at bottom)…                │
│                                                              [↓ Jump now · 47]│
├──────────────────────────────────────────────────────────────────────────────┤
│ ○ attached 14:32:05 · buffer 2000/2000 lines · scrollback drops oldest        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Flow, step by step:

1. **Pick a running agent.** Left rail mirrors the Sessions view picker
   (`GET /api/oc/agents` for the dropdown, `id (count)` labels) plus a
   **"Running now"** section on top, fed by `task-updated` events on the
   existing state channel (`/api/events/stream`) with an initial fill from
   `GET /api/tasks`. One click attaches.
2. **Attach = open the console stream** for that `agentId + sessionKey`
   (§3). Header shows `● LIVE` + run id prefix while events flow.
3. **Stream renders three line classes**, interleaved in arrival order:
   - **Command output lines** — plain text chunks from a running exec tool,
     monospace, prefixed `[stdout]` when the source block type allows
     distinguishing it (else raw).
   - **Assistant text** — token deltas appended to a single growing paragraph
     per turn, chat-styled divider between turns (reuse Sessions-view bubble
     typography, terminal density).
   - **Tool-call badges inline** — start badge (`🔧 name · args preview`),
     end badge (`✔/✖ name · exitCode N · Xms`); green zero, red non-zero,
     gray `status` word for non-process tools with no exitCode (same badge
     semantics as Session Replay §2.5).
4. **Pause / scrollback.** `⏸ Pause` freezes DOM appends (events keep
   buffering in memory, capped); resume flushes the buffer through the cap.
   Scrollback is a bounded ring of the **last 2000 rendered lines** — oldest
   fall off the top, footer counter shows `buffer n/2000`.
5. **Jump now.** Autoscroll stays pinned to bottom only while the viewport is
   at the bottom (±24px threshold). Any scroll-up unpins; new lines accumulate
   behind a `↓ Jump now · N` pill (bottom-right). Click repins and flushes.
   `End` key does the same; `Home` jumps to oldest buffered line.
6. **Idle end-of-stream.** When no console-class event arrives for the idle
   window (§3.5) the server emits `console:end {reason:"idle"}` and closes;
   header flips to `○ idle — stream ended 14:32:05`, banner offers
   **Reattach** (and auto-rearms if the same session starts a new run — §3.5).
   Bridge loss mid-stream ends with `reason:"bridge-disconnected"` → amber
   banner, distinct copy ("dashboard lost the gateway feed").

Entry points v1: app-registry window + deep link
`/?view=live-console&agent=<id>&session=<sessionId>`. Cross-link buttons from
Agents view ("▶ Console") and Sessions view ("▶ Live") are fast-follows
(separate build commits, they touch existing views).

---

## 3. Data Contract

### 3.1 Gateway events feeding the console

All shapes verbatim from the spike doc (server `2026.7.1-2`, protocol v4):

| Gateway event | Used for | Fields consumed |
|---|---|---|
| `agent` `stream:"assistant"` | assistant text deltas | `data.delta` (append), `data.text` (resync/cumulative fallback), `payload.seq`, `sessionKey`, `agentId`, `runId` |
| `agent` `stream:"item"` | tool/command lifecycle badges | `itemId`, `phase`, `kind`, `title`, `name`, `status`, `toolCallId`, `startedAt`, `endedAt` |
| `agent` `stream:"command_output"` | exec completion frame | `exitCode`, `durationMs`, `cwd`, `status`, `toolCallId` |
| `session.tool` | args in, **live output chunks**, result details | phase `start`→`args`; phase `update`→`partialResult.content[].text` (the actual stdout/stderr lines); phase `result`→`result.details.{exitCode,durationMs,cwd,status}` |
| `task` | Running-now picker + idle detection | `task.id`, `status`, `sessionKey`, `agentId`, `runId`, `updatedAt` |

⚠️ Bridge v1 today **drops** `assistant` deltas by design (`normalizeGatewayEvent`
returns null for them) and reduces `session.tool` to start/result metadata —
the live output chunks (`phase:"update"`, `partialResult`) never reach SSE.
The console requires an **additive passthrough layer** beside the normalizer,
not a change to v1's normalized set (§7).

### 3.2 Transport decision: NEW dedicated SSE channel — recommended

Two options were weighed:

- **A. Passthrough on the existing bridge-fed channel** (`/api/events/stream`)
  as new event names.
- **B. New dedicated endpoint** fed by the same bridge, e.g.
  `GET /api/console/stream?agent=<id>&session=<sessionId>` (name final at
  build; must sit under `/api/*` to inherit auth middleware).

**Recommend B.** Justification:

1. **Backpressure domains differ.** The shared channel runs a per-client
   bounded queue of 100 frames with drop-oldest + one `resync` hint — tuned
   for low-rate *state upserts* where any drop demands a full refetch.
   Console traffic is a *stream*: the spike measured ~21 `agent` events/s
   fleet-wide in a busy 12 s window, before output chunks. Sharing the queue
   means one busy agent's deltas evict `task-updated` frames for every open
   dashboard window → resync storms across unrelated views.
2. **Server-side filtering must happen anyway.** `operator.read` is
   fleet-wide; per-session scoping is convention, not enforcement (spike
   Risks). A dedicated endpoint takes `agent`/`session` params and the bridge
   fans out console frames **only while ≥1 console client is attached** to
   that session — token deltas for the other 700+ sessions never leave the
   server process otherwise.
3. **Different overflow semantics.** A terminal tail tolerates dropped old
   lines (that's just shorter scrollback) but must NOT trigger resync/refetch.
   State channels invert both rules. One policy per channel keeps both honest.
4. **Contract freeze preserved.** Spike recommendation: keep the existing SSE
   front-door contract frozen. Adding a sibling hub reusing
   `broadcastStream`'s pattern (bounded queue, drain flush, heartbeat, auth
   inheritance) is additive.

Cost: one route + a second fanout registry instance + bridge-side filtered
relay. All house patterns; no new transport (still SSE, still one EventSource
per view).

### 3.3 Dashboard-facing event set (console channel)

Stable names, compact payloads (bridge-built; gateway envelope fields stripped):

| Event | Payload | Source |
|---|---|---|
| `console:text` | `{sessionKey, agentId, runId, seq, delta}` | `agent`/`assistant` |
| `console:tool-start` | `{sessionKey, runId, seq, toolCallId, name, title, argsPreview}` | `session.tool` start (+`agent` item start) |
| `console:tool-output` | `{sessionKey, runId, seq, toolCallId, chunk}` | `session.tool` update `partialResult.content[].text` |
| `console:tool-end` | `{sessionKey, runId, seq, toolCallId, name, status, exitCode, durationMs, cwd}` | `session.tool` result (+`command_output` end frame) |
| `console:end` | `{reason: "idle"\|"bridge-disconnected"\|"unsubscribed"}` | bridge lifecycle |
| `resync` | `{reason}` | overflow/gap hint (same convention as state channel) |

Ordering/dedupe: consumers key on per-session `payload.seq` (monotonic per
session stream — NOT the per-connection envelope `seq`; spike §framing).
Duplicate or `seq ≤ lastSeen` frames are dropped client-side; a detected gap
renders one `⋯ skipped (gap)` marker — **never** a refetch storm (terminal
tolerance; contrast with state-channel resync).

### 3.4 Auth model

- Console endpoint inherits the global `/api/*` bearer-token middleware —
  identical surface to `/api/events/stream`: `Authorization: Bearer` preferred,
  `?token=` legacy fallback for `EventSource`. No new auth code path.
- The gateway shared secret never leaves the bridge process (landmine rule);
  browsers see only dashboard-internal frames.
- Scope stays `operator.read`; the console sends nothing upstream. Read-only
  is enforced socially here and structurally in AC2.
- Known limitation (accepted v1): any authenticated dashboard user can attach
  to any agent's stream — fine under single-operator auth; revisit if
  multi-user auth ever lands (same exposure already true for Sessions view).

### 3.5 Idle behavior

- Server-side idle timer per attached session: **no console-class frame for
  20 s** (first-cut constant; TODO-verify against real inter-command gaps —
  LLM thinking pauses can exceed this, which is why idle ≠ close-on-silence
  alone, see below) **AND** the matching task row observed non-running via
  `task-updated`. Either signal alone showing "quiet" does NOT end the stream;
  both do (LLM gaps are common, task-status flips are authoritative).
- On idle: emit `console:end {reason:"idle"}`, then close the SSE after a
  5 s grace (lets the frame flush). View: `○ idle — stream ended <ts>`
  banner + Reattach button.
- Auto-rearm: while banner shown, view polls `GET /api/tasks` at 30 s
  (house polling cadence, tiny payload); when the same `sessionKey` flips to
  running, the view reattaches automatically and stamps a new segment divider
  (`── reattached 14:41:02 ──`). Manual Reattach does the same immediately.
- Bridge disconnect mid-stream: `console:end {reason:"bridge-disconnected"}`
  → amber banner; reattach is manual until the state channel's `resync` flow
  confirms bridge health (avoids flapping during backoff cycles).

### 3.6 Backfill (explicitly scoped out of MVP)

On attach, v1 shows **live-only from now** with a one-line notice
("attached — earlier output lives in Session Replay"). If the replay reader
(`GET /api/oc/sessions/:id/events?afterLine=`, run 6) has landed first, a
fast-follow prefills the buffer with the last ~100 normalized events before
opening the stream. Sequenced this way so neither feature blocks the other.

---

## 4. Terminal Rendering Approach (no-frameworks constraint)

**Decision: plain DOM append with a capped ring buffer.** Not virtualized
list, not canvas.

Justification:

- **Volume fits comfortably.** Worst observed fleet-wide rate ≈ 21
  `agent` events/s; a single-session console realistically sees low single
  digits per second with bursts. With the 2000-line cap the DOM holds ≤ ~2–4k
  elements (line divs + badge spans) — trivial for a browser; append cost is
  microseconds. Appends are coalesced: incoming frames queue and flush once
  per animation frame via `DocumentFragment` (one reflow per frame max).
- **Virtualized list buys nothing at a hard-capped 2000 rows** and costs
  row-height measurement, scroll-anchor math, and breaks native Ctrl+F /
  text selection — selection and find-in-page are real operator value in a
  console (copy an error line). Complexity would be pure negative here.
- **Canvas/xterm-style wins only at 10k+ live lines and ANSI fidelity** —
  both out of scope: content chunks are plain text (no ANSI sequences
  observed in `content[].text`; control chars are stripped defensively),
  and inline HTML badges interleaved with text are exactly what canvas makes
  painful. Zero-dependency constraint excludes xterm.js regardless.
- **Non-goal alignment:** sustained 10k-line throughput and zero-throw under
  arbitrary floods are explicit non-goals (§6). The cap converts overload
  into "older lines disappear", which is correct terminal-tail behavior.

House conformance: ES module view, `ensureNativeRoot`, scoped injected
`<style>`, `escapeHtml` on every interpolated string, teardown closing the
EventSource + clearing timers/listeners (sessions-view/replay conventions).

---

## 5. File Plan

THIS commit (docs only): `docs/briefs/live-console.md` (this file) +
CHANGELOG entry. Nothing else.

Builder sequence (later commits, gated per §7):

| Slice | Files |
|---|---|
| 1. Bridge passthrough relay | `lib/gateway-console-feed.js` **NEW** — subscribes to the bridge's raw frames beside `normalizeGatewayEvent` (additive module; v1 file untouched except a one-line tap hookup if coder agrees), per-session filtered, idle timer, emits the §3.3 event set |
| 2. Console SSE route | `routes/console-routes.js` **NEW** (`GET /api/console/stream`) + second fanout hub instance reusing `sse-routes.js` patterns (extract shared queue helper rather than copy-paste — builder's call, justify in-code) |
| 3. View | `src/shell/native-views/live-console-view.mjs` **NEW** — exports pure helpers `createLineRing(cap)` and `coalesceAppends()` for DB-free tests |
| 4. Registration + docs | `src/shell/app-registry.mjs` (+1 app → **README count 32→33**, drift check enforces exact match), `docs/views-reference.md` Work entry, `docs/api-reference-complete.md` console endpoint |
| 5. Tests | `tests/test-gateway-console-feed.js` **NEW** (frame fixtures: dedupe, gap, idle transitions, secret redaction), `tests/test-console-routes.js` **NEW** (auth 401, param filter, overflow→drop-oldest-no-resync-storm, `console:end`), view-helper unit tests |

Every slice lands green; `node scripts/docs-drift-check.js` must exit 0 after
slice 4 (registry count, views-reference coverage).

---

## 6. Acceptance Criteria (qa-auditor)

1. **AC1 Registration & docs** — Start menu shows "Live Console" under Work;
   opens 1180×780; deep link `/?view=live-console&agent=X&session=Y` attaches
   directly. After the registration commit `node scripts/docs-drift-check.js`
   exits 0 (count 33, views-reference + api-reference entries present).
2. **AC2 Read-only guarantee** — with network spied, a full pick→watch→idle
   session emits **zero** non-GET requests and zero mutating frames; no input
   element exists in the view. Hard gate.
3. **AC3 Buffer bound** — dev harness injects 10k synthetic lines: DOM node
   count stays ≤ ~2500, oldest lines dropped, footer counter caps at
   `2000/2000`, no uncaught exception. (10k-line retention is a non-goal;
   surviving the flood gracefully is the requirement.)
4. **AC4 Badge correctness** — fixtures drive `tool-start` → `tool-output`×n →
   `tool-end`: badge shows name + duration + exitCode; exitCode 0 green,
   non-zero red, absent exitCode renders gray `status` word; malformed/end-
   less tool call renders "no result recorded" (replay parity).
5. **AC5 Pause / jump-now** — Pause halts DOM growth while buffering continues
   (cap enforced in memory); Resume flushes ≤ cap in arrival order; scrolling
   up unpins and shows `Jump now · N` with correct N; click/End repins.
6. **AC6 Idle & degradation** — simulated quiet+task-flip emits
   `console:end{idle}` within timeout + grace, banner + auto-rearm on next
   running flip; simulated bridge drop yields amber
   `bridge-disconnected` banner, distinct copy, manual reattach only.
7. **AC7 Ordering integrity** — duplicate/out-of-order `seq` frames dropped;
   injected gap renders exactly one skip marker and triggers no fetches.
8. **AC8 Auth & secrecy** — console endpoint returns 401 without token;
   `?token=` works; browser devtools show no gateway secret in any frame,
   URL, or error text (grep the served payloads).
9. **AC9 Smoothness** — synthetic 50 lines/s × 60 s burst: appends coalesced
   to ≤1 layout pass per frame (rAF), no long-task > 100 ms sustained,
   autoscroll pinned throughout unless user scrolls.
10. **AC10 Vanilla conformance** — no frameworks, no build step, ES modules
    only; `node --check` clean on all touched JS/MJS files.

---

## 7. Coordination & Sequencing Guard (bridge concurrency)

Coder is validating bridge v1 concurrently — **no edits to
`lib/gateway-bridge.js` / `routes/sse-routes.js` until that validation signs
off.** Therefore:

- Slice 1 is specified as an **additive sibling module**
  (`lib/gateway-console-feed.js`) consuming the same raw gateway frames via a
  tap, leaving v1's normalize/dedupe paths byte-identical. If coder prefers
  the tap living inside the bridge class, that's a ≤5-line hookup merged
  after sign-off — interface freeze is the §3.3 event set, decided here.
- Slices 2–5 don't touch bridge files at all and can proceed in parallel up
  to integration testing.

## 8. Explicit Non-Goals (v1)

- **No input / sending / abort.** Console watches; Sessions view acts.
- **No history backfill in MVP** (§3.6 fast-follow once replay reader lands).
- **No multi-session tiling / grid.** One attached session per window;
  multiple windows work naturally if wanted.
- **No ANSI/color-parsing, no TUI emulation.** Plain text + HTML badges.
- **No 10k-line retention, no infinite scrollback.** 2000-line ring, by design.
- **No search inside the buffer** beyond native Ctrl+F (which the DOM choice
  preserves for free).
- **No new auth surface, no direct browser↔gateway connection. Ever.**

## 9. Risks & Open Questions

- **R1 — Bridge concurrency.** Mitigated by §7 sequencing; risk is schedule,
  not design.
- **R2 — Sustained volume untested.** Spike measured bursts, not hours-long
  saturation; slow-consumer behavior at 50 MB gateway buffer is unknown.
  Channel constants (queue depth, idle 20 s, grace 5 s) are first-cut.
  TODO-verify: replay a probe capture at 5× speed through the relay before
  freezing constants.
- **R3 — `command_output` partial coverage.** Spike windows captured only
  `phase:"end"` frames; live partial output depends on `session.tool`
  `update`/`partialResult` chunks. TODO-verify against a long-running exec
  (build/log tail) before freezing `console:tool-output`; if chunks prove
  coarse, badges still work (end-frame truth) and lines degrade to
  end-of-call dumps.
- **R4 — Assistant delta shape.** `delta` observed always present alongside
  cumulative `text`; if a gateway update ever sends cumulative-only, view
  falls back to diffing `text` (cheap guard, spec'd in slice 1).
- **R5 — Overlapping runs in one session** (retry/fork): key rendering by
  `runId`; a new runId inserts a segment divider rather than interleaving.
- **Q1 — Idle timeout value** (proposed 20 s): LLM thinking gaps vs. dead-air
  detection tradeoff — confirm at build review with probe data.
- **Q2 — Thinking blocks:** hide by default (noise in a terminal); aligns with
  Replay Q1 — confirm CEO preference once, apply to both views.
