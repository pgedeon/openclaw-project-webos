---
layout: default
---

# Design Brief — Session Replay Inspector (Time-Travel Stepper)

**Status:** Draft for build review · **Roadmap:** Phase 1, ordered above one-click actions (roadmap-review-2026-08-24.md intra-phase swap)
**Evidence base:** gateway-streaming-spike-2026-08-24.md (event shapes), market-scan-2026-08-23.md steal #3 (time-travel stepper, AgentOps-pattern; competitor Mission Control ~6.1k★ ships live replay), persisted-transcript survey 2026-08-24 (live files under `~/.openclaw/agents/*/sessions/`)
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit.

---

## 1. Purpose & Value Proposition

An operator watching an agent work today sees either a flat chat log (Sessions view)
or nothing at all. When an agent goes sideways — wrong file edited, command failed,
loop — there is no way to answer **"what exactly did it do, in what order, and what
came back?"**

Session Replay is a **time-travel stepper over a persisted session transcript**:
pick agent → pick session → scrub a timeline → step event-by-event through every
tool call (args in, result out, exitCode badge) while the assistant's text renders
chat-style *as of that point in time*. Temporal-web-style event replay, applied to
OpenClaw sessions.

v1 is **read-only and offline**: it renders entirely from the persisted JSONL
transcript on disk, fetched once. The live WS bridge (separate in-flight item) is
*not* a dependency — live tailing becomes a later enhancement that can reuse this
view's renderer against a growing event array.

---

## 2. UX Flow

Window: `session-replay`, default size **1180×780**, Work category (next to Sessions).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⏪ Session Replay   [agent ▾] [session ▾]          step 214/1039  [←][→][⤒] │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ EVENT RAIL    │  AS-OF-T PANE                                                │
│ (virtualized) │                                                              │
│ ● user msg    │  ┌─ chat transcript as of step 214 ─────────────────────┐    │
│ ● assistant   │  │ 👤 You: fix the mobile nav …                         │    │
│ ▶ 🔧 exec     │  │ 🤖 Agent: Reading the layout first…                  │    │
│   ├ args      │  │ 🤖 Agent: Found it — nav.blade.php line 42…          │    │
│   │ `{cmd…}`  │  └──────────────────────────────────────────────────────┘    │
│   ├ result    │  ┌─ CURRENT STEP DETAIL ────────────────────────────────┐    │
│   │ ✔ 0 (90ms)│  │ 🔧 exec · call_Lp7tpTfSL…        [exitCode 0 ✔]     │    │
│ ● toolResult  │  │ IN  ▸ {"command":"git status --short"}               │    │
│ ● assistant   │  │ OUT ▸ "M public/css/nav.css\n M resources/views/…"   │    │
│ ○ …           │  │ cwd /root/projects/comparesauna · 90ms · completed   │    │
│               │  └──────────────────────────────────────────────────────┘    │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ◄──────●──────────────────────────────────────────────────────►  scrubber    │
│ start                                            step 214 · 05:52:37 · end  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Flow, step by step:

1. **Pick agent** — dropdown mirrors Sessions view (`GET /api/oc/agents`, label
   `id (count)`).
2. **Pick session** — second dropdown (`GET /api/oc/sessions?agent=`), labeled by
   channel kind + relative time; deep-linkable via
   `/?view=session-replay&agent=<id>&session=<sessionId>`.
3. **Timeline scrubber** — horizontal slider across the bottom; position is
   proportional to **event index** (not wall-clock — LLM gaps would dead-zone the
   middle). Dragging jumps the stepper; tick marks color-coded by event kind.
4. **Step through events** — `←`/`→` keys and buttons move one event;
   `Home`/`End` jump to start/end. Each step re-renders the as-of-t pane.
5. **Tool calls expandable** — the current-step detail card shows args (IN),
   result body (OUT), and a badge: green `exitCode 0`, red non-zero, gray
   `status` for non-process tools (`read`, `write`…) where exitCode is absent.
   Result bodies are truncated previews; "load full output" fetches on demand (§3).
6. **Assistant text streams into the chat pane** — all assistant text blocks up to
   the current step render chat-style (reuse Sessions-view bubble conventions);
   the newest text appears as the stepper crosses its event.

Entry points v1: app-registry window + deep-link URL. A cross-link button from the
Sessions view ("⏪ Replay") is a fast-follow increment (touches `sessions-view.mjs`,
separate build commit).

---

## 3. Time-Travel Model

**Ordered event list, stepper index, cumulative render.**

- The fetched transcript normalizes to an ordered array `events[]` (§4). Line
  number in the JSONL is the tiebreaker/order — replay follows **append order**,
  not the `parentId` tree (known simplification, see R4).
- Stepper state is a single integer `i`. Rendering is a **pure function**
  `computeStateAsOf(events, i)` → `{messages[], openToolCalls[], lastModel, …}`;
  the view layer draws that state. This is what makes the whole feature
  unit-testable DB-free.
- Tool-call pairing: a `toolCall` block inside an assistant message pairs
  **forward** to the next `toolResult` message with the same `toolCallId`.
  Unpaired call (crash/abort) renders "no result recorded" — that gap is signal,
  not noise.
- Compaction markers and model changes render as system ticks on the rail.
- Unknown/forward-compat line types become generic ticks (pass-through, never
  dropped — see R2).
- v1 ships **read-only, client-side, single-fetch**: one normalized transcript in
  memory, no subscriptions, no writes, no server round-trips while scrubbing
  (except on-demand full-output fetches).

---

## 4. Data Contract

### Decision: extend `routes/session-routes.js` — two new GET routes + reader functions

Reusing `GET /api/oc/sessions/:sessionId/messages?filter=all` was considered and
rejected: it caps at `limit ≤ 200`, returns full-fidelity payloads (a 4.7 MB
transcript becomes a multi-request N+1 loop), and leaves normalization to every
client. The v1 model needs **one fetch, normalized, ordered**. The existing
messages endpoint stays untouched (Sessions view depends on it).

New reader functions in `lib/session-jsonl-reader.js` (streaming readline, same
house pattern), surfaced by `registerSessionRoutes`:

| Endpoint | Returns |
|---|---|
| `GET /api/oc/sessions/:sessionId/events?agent=<id>&afterLine=<n>&limit=<n>` | `{ sessionId, agentId, events[], nextAfterLine, hasMore, totalLines, partial }` |
| `GET /api/oc/sessions/:sessionId/events/:line?agent=<id>` | Full-fidelity single event (on-demand "load full output") |

**Normalized event shape** (server-built, compact — signatures stripped, bodies
truncated):

```jsonc
{
  "line": 214,              // JSONL line number = order + scrubber address
  "ts": 1787530620467,      // epoch ms from the source line
  "kind": "tool_result",    // user_message | assistant_text | assistant_thinking |
                            // tool_call | tool_result | model_change |
                            // compaction | session_meta | other
  "role": "toolResult",     // when kind wraps a message
  "text": "…preview…",      // truncated text body (assistant/user/tool output)
  "tool": {                 // tool_call / tool_result only
    "toolCallId": "call_…", "name": "exec",
    "argsPreview": "{…}",           // JSON, truncated
    "resultPreview": "…",           // truncated
    "details": { "status": "completed", "exitCode": 0, "durationMs": 90, "cwd": "…" },
    "resultLine": 215       // back-pairing pointer for tool_call events
  }
}
```

Verified against live persisted transcripts (2026-08-24, schema v3): line types
observed = `session`, `model_change`, `thinking_level_change`, `custom`,
`custom_message`, `compaction`, `message`; roles = `user`, `assistant`
(content blocks: `thinking`, `toolCall{id,name,arguments}`, `text`),
`toolResult` (carries `toolCallId`, `toolName`, `content[]`, and
`details.{status, exitCode, exitSignal, exitReason, durationMs, aggregated, cwd}`
for exec-class tools — so the exitCode badge works **from disk**, no live feed).

**Pagination / limits for huge sessions:**

- `limit` default 2000 normalized events, hard cap 5000 per response.
- Cursor pagination via `afterLine` (JSONL line cursor, same convention as the
  existing messages endpoint). The view auto-fetches the next chunk in the
  background; the scrubber shows a "loaded to here" boundary and offers
  "load more" when dragged past it.
- Response byte guardrail ~8 MB per chunk enforced server-side (truncate
  previews harder rather than fail).

**Graceful behavior — missing / partial transcripts:**

| Case | Behavior |
|---|---|
| Unknown sessionId / no `.jsonl` | `404 {error:"Session not found"}` → view shows named empty state with "back to picker" |
| File exists, zero events | `200` with `events:[]` → "Empty session" state |
| Last line fails `JSON.parse` (crash mid-write) | skip bad line(s), set `partial:true` → amber banner "Transcript ends mid-event — session likely crashed or is active" |
| Session grows after fetch | out of scope v1 (no tailing); header shows fetched-at time |

---

## 5. File Plan

| File | Change |
|---|---|
| `src/shell/native-views/session-replay-view.mjs` | **NEW** — exports `renderSessionReplayView({ mountNode, api, adapter, stateStore, sync, params })`; house style: `ensureNativeRoot`, scoped injected `<style>`, `escapeHtml` from `helpers.mjs`, teardown clearing keyboard listeners. Exports pure functions `normalizeTranscriptEvents(lines)` and `computeStateAsOf(events, i)` for DB-free tests |
| `lib/session-jsonl-reader.js` | Add `readEvents(sessionId, agentId, { afterLine, limit })` + `readEventAtLine(...)` — streaming readline, normalization + pairing, truncation constants |
| `routes/session-routes.js` | Register the two GET routes above (bearer-token auth inherited from global middleware) |
| `src/shell/app-registry.mjs` | Entry: `id:'session-replay'`, label `Session Replay`, icon `appIcon.rewind` (**new glyph** — builder adds SVG path; `timeline` icon stays unique to Timeline), `url:'/?view=session-replay'`, `category:'Work'`, `defaultWidth:1180`, `defaultHeight:780` |
| `tests/test-session-replay-events.js` | **NEW** — table-driven fixtures over `normalizeTranscriptEvents` + `computeStateAsOf`: happy path, unpaired toolCall, malformed tail (`partial`), compaction/model ticks, unknown-type passthrough, empty input |
| `tests/test-session-routes.js` | Extend: route-level tests for both endpoints using fixture `.jsonl` files (404, empty, partial, cursor pagination, cap enforcement) |
| `README.md` | Windowed-app count 32 → 33 (docs-drift-check enforces exact match) |
| `docs/views-reference.md` | Work-section entry for Session Replay (drift check requires every registry id documented) |
| `docs/api-reference-complete.md` | Document both endpoints |
| `CHANGELOG.md` | `## Unreleased` → `### Added` entry in the build commit |

Build sequence: (1) reader + routes + route tests → (2) view skeleton with picker +
single-fetch render → (3) stepper/scrubber/virtualization → (4) polish (badges,
deep-link, keyboard) . Each slice lands with its tests green.

---

## 6. Acceptance Criteria

Testable by qa-auditor. DB-free; route tests run against fixture JSONL files.

1. **AC1 Registration & docs** — Start menu shows "Session Replay" under Work;
   opens 1180×780. After the build commit `node scripts/docs-drift-check.js`
   exits 0 (registry count 33, views-reference + api-reference entries present).
2. **AC2 Read-only guarantee** — With fetch spied, a full pick→scrub→step session
   emits **zero** non-GET requests. Hard gate.
3. **AC3 Normalizer purity** — `normalizeTranscriptEvents(lines)` passes
   table-driven fixtures: correct kinds/order; `toolCall`→`toolResult` paired via
   `toolCallId` with `resultLine` back-pointer; unpaired call flagged; malformed
   final line skipped with `partial:true`; unknown type preserved as `other`;
   empty input → `[]`. No fs/network access in the function.
4. **AC4 As-of-t correctness** — `computeStateAsOf(events, i)` fixtures assert:
   message list at `i` equals prefix `[0..i]`; crossing a `tool_result` flips the
   paired call's badge state; `i=-1`/beyond-end clamp safely.
5. **AC5 Performance guardrail (10k events)** — Synthetic 10k-event transcript:
   (a) initial normalized fetch + first paint < 2 s on CI hardware;
   (b) 20 random scrub jumps each commit within a 50 ms frame budget;
   (c) **DOM node count stays bounded (< ~300 rendered rows) regardless of event
   count** — proves virtualized rendering of rail + chat pane, not `innerHTML`
   of the full history.
6. **AC6 Graceful degradation** — 404 → named empty state, no uncaught errors;
   `partial:true` → amber banner; chunked load (>5000 events fixture) → boundary
   marker + background continuation loads remaining chunks.
7. **AC7 Keyboard & deep-link** — `←`/`→`/`Home`/`End` step/jump;
   `/?view=session-replay&agent=X&session=Y` opens directly on that transcript.
8. **AC8 On-demand detail** — "load full output" issues exactly one GET to the
   detail endpoint and replaces the preview in place; repeated clicks reuse cache
   (no refetch).
9. **AC9 Vanilla conformance** — No frameworks, no build step, ES modules only;
   `node --check` clean on touched JS/MJS files.

---

## 7. Explicit Non-Goals (v1)

- **No editing / actions.** No resend, abort, retry, delete, fork. Replay looks;
  Sessions view acts.
- **No live tailing.** Renders persisted history only. Live mode arrives later as
  a consumer of the WS bridge feeding the same `events[]` array — the renderer is
  deliberately shaped for that reuse, but nothing in v1 subscribes.
- **No cross-session search.** Single-session scope; search across sessions is a
  separate future item.
- **No execution-graph / DAG visualization.** Linear timeline only (market scan
  places graphs with the Phase 2 visual editor).
- **No wall-clock playback animation.** Scrubber + stepper cover the need;
  timed "play" is a cheap later add if wanted.
- **No `parentId` tree reconstruction.** Append order only (R4).
- **No new auth surface.** Existing bearer-token middleware covers the new routes.

---

## 8. Risks & Open Questions

- **R1 — Transcript size ceiling unknown fleet-wide.** Largest surveyed
  main-agent session: 4.7 MB / 1270 lines; agents dir totals 1.3 GB. Caps
  (2000/5000 events, 8 MB chunk) are first-cut constants pending measurement.
  TODO-verify: max session size across all agents before freezing caps.
- **R2 — Transcript shape drift.** Shapes verified against live files on
  2026-08-24 (schema v3). OpenClaw updates may add line types; the normalizer
  must pass unknown types through as `other` ticks so forward-compat failures
  degrade to "extra dots on the rail", never blank screens.
- **R3 — Client memory at 10k events.** Normalized events with truncated bodies
  stay in the low-MB range; acceptable. Full-output fetches are per-click and
  cached with an LRU-ish cap (builder constant, justified in-code) to avoid
  unbounded growth.
- **R4 — Append order ≠ conversation tree.** Aborted/retried turns may leave
  orphaned branches rendered inline. v1 accepts this (linear tape). TODO-verify:
  whether real aborted sessions produce confusing branch artifacts in practice;
  if yes, branch-hiding heuristic becomes a fast-follow.
- **R5 — `.trajectory.jsonl` sidecars ignored in v1.** A parallel
  `openclaw-trajectory` schema (v1, seq/ts/sourceSeq) exists on disk but with
  sparse/inconsistent coverage (939 trajectory files vs 408 plain sessions for
  `main`). Not a dependable primary source; revisit as enrichment or live-mode
  input later.
- **Q1 — Thinking blocks:** render collapsed-by-default (noise) — confirm CEO
  preference on visibility of reasoning traces at build review.
- **Q2 — Badge semantics for non-process tools** (`read`, `write`): show
  `details.status` ("completed") instead of exitCode — builder confirms which
  tools populate `details` beyond exec-class during build.
