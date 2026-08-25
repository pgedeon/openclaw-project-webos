---
layout: default
---

# Design Brief — Task ↔ Session Conversation Binding

**Status:** Draft for build review · **Roadmap:** rank 2.1 candidate, roadmap-review-2026-08-25b.md §3 ("Strongest remaining FEATURE … rides ALREADY-SHIPPED session-reader routes")
**Evidence base:** schema/migrations/001_add_workflow_runs.sql + 021_add_workflow_agent_routing.sql (binding columns), gateway-workflow-dispatcher-v2.js (claim/heartbeat/complete SQL), workflow-runs-api.js (bind/unbind/session queries), docs/AGENT_INTEGRATION.md (claim protocol, `session_id` = OpenClaw session key), routes/session-routes.js + lib/session-jsonl-reader.js (shipped replay surface), src/shell/native-views/tasks-view.mjs (detail panel + P5 cross-nav pattern), src/shell/native-views/console-view.mjs + session-replay-view.mjs (deep-link handling)
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit.

---

## 1. Purpose & Value Proposition

When an OpenClaw agent executes a dashboard task, the gateway session it works in
**is** the work record: every command, tool call, and decision is in the JSONL
transcript. The dashboard already renders that record beautifully — Session
Replay steps through it event-by-event, Live Console attaches to it while it
runs. But the Tasks board and the session views are disconnected lists: an
operator clicking a task sees status fields and an audit trail, not *the
conversations that did the work*.

This feature binds them: **task detail gains a "Sessions" section listing the
gateway sessions bound to the task's workflow runs**, each deep-linking into
replay (terminal sessions) or live console (running sessions). Read-only end to
end; zero new write paths; rides shipped infrastructure.

## 2. The Join Problem

**Question stated precisely:** given task X, which gateway session(s) worked on
it, and how do we address each one in the session-reader surface?

### 2.1 Identifiers on each side

| Side | Identifier | Where it lives |
|---|---|---|
| Task | `tasks.id` (UUID) | PostgreSQL |
| Run ↔ task | `workflow_runs.task_id` (FK, nullable, indexed) | migration 001 |
| Run ↔ session | `workflow_runs.gateway_session_id` (TEXT) + `gateway_session_active` (BOOL) | migration 001 |
| Run ↔ session (owner of claim) | `workflow_runs.claim_session_id` (TEXT, indexed) | migration 021 — *"Gateway session identifier that currently owns the claimed run"* |
| Session file | `<agentId>/sessions/<sessionId>.jsonl` | filesystem, `~/.openclaw/agents/` |
| Session index | `sessions.json` keyed by session **key** (`agent:<agentId>:<kind>:<id>`), each entry carries `sessionId` | filesystem |

**Critical semantic (verified in docs/AGENT_INTEGRATION.md §API):** the
`session_id` posted to `/api/workflow-runs/:id/claim|heartbeat|complete` is the
agent's OpenClaw **session key** (e.g. `agent:main:main`), not the UUID-style
`sessionId`. The dispatcher stores it verbatim:

- `claimRun` (gateway-workflow-dispatcher-v2.js SQL): sets
  `claim_session_id = $3, gateway_session_id = $3, gateway_session_active = TRUE`
- `heartbeatRun`: refreshes `last_heartbeat_at`, keeps `gateway_session_active = TRUE`
- `completeRun` / failure overrides: set `gateway_session_active = FALSE` — **the
  id is kept**, so the producing session stays resolvable after completion
- `timeoutRun` (workflow-runs-api.js): deactivates + writes an audit_log entry
  carrying the session id — id preserved

So the mapping chain is:

```
tasks.id ──< workflow_runs.task_id ── gateway_session_id (= session KEY)
                                              │  resolve via sessions.json
                                              ▼
                              agentId + sessionId ──> replay/console deep-link
```

The session key embeds the agent directory (`agent:<agentId>:<kind>:<id>` —
same parse convention as `sessionChannel()` in routes/session-routes.js), so
key → `{agentId}` is a pure string operation; key → `sessionId` is one lookup
in that agent's `sessions.json`.

### 2.2 Recommended mechanism v1 — derive from existing data

**Derive the binding at read time from `workflow_runs`; add no write-time
bookkeeping.**

Rationale:

1. The dispatcher already maintains the binding with correct lifecycle
   semantics (active during claim/run, deactivated on completion/failure,
   preserved for history). Re-deriving costs one indexed query.
2. Every alternative investigated adds machinery for no v1 gain:
   - *Audit-trail reconstruction*: audit_log only records session ids on
     timeout paths (`run_timed_out`) — not on normal claim/complete. Not a
     dependable source.
   - *Transcript content scan* (grep task id out of session JSONL): O(all
     transcripts), fuzzy, and useless as a list index.
   - *New join table written at claim time*: duplicates state the runs table
     already holds; second write path to keep consistent.
3. `tasks.active_workflow_run_id` (migration 001) gives the "live now" pointer
   for free when present.

Known limitation accepted for v1 (see §7 R1): `markDispatched` /
`refreshDispatched` / `releaseClaimed` reset `gateway_session_id = NULL` when a
run goes back to the queue, so **only the latest attempt's session survives a
retry cycle**. Completed runs keep their final session indefinitely.

## 3. Data Contract

### Decision: one new read-only endpoint — `GET /api/tasks/:id/sessions`

Client-side composition was considered first (`GET /api/workflow-runs?task_id=X`
+ `GET /api/oc/sessions?all=true`, join in the browser) and rejected:
it ships the entire fleet-wide session list to every task-detail open, duplicates
the key-resolution join in view code, and needs three round trips where one
suffices. One server-side endpoint keeps the join pure, testable, and centrally
degradable.

| Endpoint | Returns |
|---|---|
| `GET /api/tasks/:id/sessions` | `{ taskId, sessions: Binding[], degraded?: true }` |

`Binding` shape (server-built, compact — no transcript bodies):

```jsonc
{
  "runId": "uuid",
  "workflowType": "code-change",
  "runStatus": "completed",        // workflow_runs.status verbatim
  "isActiveRun": false,            // tasks.active_workflow_run_id === runId
  "sessionKey": "agent:coder:main",// gateway_session_id (may be null)
  "agentId": "coder",              // parsed from key; null when unresolvable
  "sessionId": "abc123",           // resolved from sessions.json; null = orphaned
  "sessionActive": false,          // gateway_session_active column
  "liveness": "terminal",          // running | stale | terminal | pending | orphaned
  "startedAt": 1787530620467,      // run started_at (epoch ms)
  "finishedAt": 1787530999999,
  "heartbeatAt": 1787530990000,
  "retryCount": 0,
  "deepLink": {                    // view-routing hint for the client
    "view": "session-replay",      // or "console" when liveness = running
    "params": { "agent": "coder", "session": "abc123" }
  }
}
```

**Liveness derivation (pure function, fixture-tested):**

| Condition | liveness |
|---|---|
| run status ∈ {queued, dispatched} or no sessionKey | `pending` |
| sessionKey set, no sessions.json match | `orphaned` |
| `gateway_session_active` ∧ run status ∈ {claimed, running, waiting_for_approval, retrying} ∧ heartbeat age < 10 min (dispatcher stale-claim constant) | `running` |
| same but heartbeat age ≥ 10 min | `stale` |
| otherwise (completed / failed / cancelled / timed_out / deactivated) | `terminal` |

**Graceful degradation without PostgreSQL:** the handler returns
`503 { error: "Asana storage not initialized" }` exactly like the rest of
routes/task-routes.js; the Tasks view hides the Sessions section on non-200 and
renders nothing — no error toast, no broken layout. Session-file absence
(reader ENOENT) is *not* an error: affected rows surface as `orphaned`.

**Size discipline:** the response carries metadata only. Transcript bodies are
never fetched here; the replay view already enforces its own caps
(`MAX_FILE_BYTES` 20 MB read ceiling, `EVENTS_MAX_LIMIT` pagination — reused
as-is). Response is naturally bounded: capped at the 20 most recent runs per
task (v1 constant; §8 Q2).

### Client API surface

One addition to `src/shell/api-client.mjs` inside `tasks:`:
`sessions(id) { return request(\`/tasks/${encodeURIComponent(id)}/sessions\"); }`
(build commit; listed here for completeness).

## 4. UX Flow

Entry point: the existing task detail panel (`#tvDetail` in
src/shell/native-views/tasks-view.mjs). A **"Sessions"** section renders below
the action buttons, beside the P5 cross-nav row, only when the endpoint returns
≥ 1 binding.

```
┌─ Task detail ────────────────────────────────────────────────┐
│ Fix mobile nav overflow            ✕                         │
│ Status: running · Priority: high · Owner: coder …            │
│ [Edit] [Archive] [Delete]                                    │
│ [📋 Board] [🤖 Agent] [📜 History] [🧠 Memory]                │
│ ── Sessions ──────────────────────────────────────────────── │
│ ▶ agent:coder:main · code-change · running 12m   [Live →]    │
│ ✔ agent:coder:main · code-change · completed     [Replay →]  │
│   └ retried once · failed attempt not retained (see note)    │
│ ? no session recorded · queued run                           │
└──────────────────────────────────────────────────────────────┘
```

Row anatomy: liveness glyph (`▶` running, `⚠` stale, `✔`/`✕` terminal,
`?` pending, `∅` orphaned) + session key + workflow type + relative time +
one action button.

**Routing rule:** `liveness = running` → Live Console
(`navigateToView('console', { params: { agent, session } })`, URL form
`/?view=console&agent=<agentId>&session=<sessionKey>` — console-view.mjs
already auto-attaches from these params). Everything else → Session Replay
(`navigateToView('session-replay', { params: { agent, session } })`, URL form
`/?view=session-replay&agent=<agentId>&session=<sessionId>` — replay resolves
by `sessionId || id`, already shipped). Both targets are registered apps;
no registry changes, so docs-drift-check's app-count gate is untouched.

Interaction rules:

1. Section issues exactly **one GET** per detail render; zero non-GET requests
   ever (read-only hard gate, mirrors session-replay AC2).
2. Endpoint failure / 503 / empty list → section absent. Silent, by design:
   most tasks have no runs.
3. `stale` rows link to replay (history is inspectable even while the run row
   is stuck) and show a warning chip, not an error.
4. `orphaned` rows render disabled with tooltip "transcript no longer on disk".

## 5. File Plan

| File | Change |
|---|---|
| `lib/task-session-binding.js` | **NEW** — pure mapping functions, no fs/network: `parseSessionKey(key)` → `{agentId, kind, key}` (handles 3-part legacy `agent:main:main` and 4-part forms), `deriveLiveness(run, opts)` → enum per §3 table, `buildTaskSessionBindings(runs, sessionsIndex, opts)` → `Binding[]` sorted newest-run-first. `sessionsIndex` = plain array of `{key, sessionId, agentId}` built by the caller |
| `routes/task-routes.js` | Register `GET /api/tasks/:id/sessions`: pool query (`SELECT … FROM workflow_runs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 20` + `tasks.active_workflow_run_id`), build index via `reader.listAllSessions()`, delegate to `buildTaskSessionBindings` |
| `src/shell/api-client.mjs` | `tasks.sessions(id)` (§3) |
| `src/shell/native-views/tasks-view.mjs` | Sessions section in `renderDetail()`: fetch-on-select, row rendering per §4, `navigateToView` wiring reusing the existing `.tv-nav-btn` handler pattern |
| `tests/test-task-session-binding.js` | **NEW** — table-driven fixtures over the three pure functions (§6 AC3 matrix) |
| task route test coverage (existing route-test module) | Route-level cases: 200 happy path with fixture index, 404 unknown task, 503 without storage, orphaned-row shape |
| `docs/api-reference-complete.md` | Document `GET /api/tasks/:id/sessions` |
| `CHANGELOG.md` | `## Unreleased` → `### Added` entry in the build commit |

Build sequence: (1) pure module + unit tests → (2) route + route tests →
(3) view section + navigation → (4) polish (tooltips, stale chips). Each slice
lands green.

## 6. Acceptance Criteria

Testable by qa-auditor. Mapping tests are DB-free; route tests run against a
fixture sessions index (no live `~/.openclaw` dependency).

1. **AC1 Endpoint contract** — `GET /api/tasks/:id/sessions` returns the §3
   shape; unknown task → 404; storage uninitialized → 503 `{error}`; response
   contains no transcript text bodies (assert max string length sanity).
2. **AC2 Read-only guarantee** — opening task detail with the section visible
   emits exactly one GET to the new endpoint and zero non-GET requests. Hard gate.
3. **AC3 Mapping purity & correctness** — `parseSessionKey`,
   `deriveLiveness`, `buildTaskSessionBindings` pass table-driven fixtures:
   3-part and 4-part keys; multi-run task ordered newest-first; `running` /
   `stale` boundary flips exactly at the 10-minute heartbeat age; completed run
   with retained sessionKey → `terminal` + replay deep-link; missing
   sessions.json entry → `orphaned` with `sessionId: null`; queued run →
   `pending`; empty inputs → `[]`. No fs/network access in the module.
4. **AC4 Navigation correctness** — running row navigates to console view with
   `agent` + `session` params and console auto-attaches; terminal row navigates
   to session-replay and the transcript opens (replay's existing deep-link
   behavior, unchanged).
5. **AC5 Graceful degradation** — without PostgreSQL the section is absent, no
   console errors, rest of task detail fully functional; orphaned rows render
   disabled with tooltip; a task whose runs all lack `gateway_session_id`
   (pre-migration-021 legacy rows) shows the "no session recorded" row, not an
   empty gap.
6. **AC6 Docs gates** — after the build commit `node scripts/docs-drift-check.js`
   exits 0 (no registry/count changes required; new route documented in
   api-reference-complete.md) and `node --check` is clean on touched JS/MJS files.

## 7. Risks & Open Questions

- **R1 — Retry cycles erase earlier bindings.** `markDispatched` /
  `releaseClaimed` null `gateway_session_id` on re-queue, so v1 shows only the
  latest attempt's session; the UI labels this honestly ("failed attempt not
  retained"). Fast-follow option (out of scope): append superseded keys to
  `output_summary.sessions[]` before reset — that is write-time bookkeeping,
  explicitly deferred per §2.2.
- **R2 — Key ≠ id semantics.** `gateway_session_id` holds a session *key*;
  resolution to a replayable `sessionId` depends on the agent's sessions.json.
  Pruned/rotated transcripts yield `orphaned` rows — permanent, honest dead
  ends, never fabricated links.
- **R3 — Claiming session vs working session.** The protocol lets agents patch
  a child session key onto the run post-spawn (AGENT_INTEGRATION step 4, PATCH
  `gateway_session_id`). We trust the latest written value; if operators observe
  parent/child confusion in practice, surfacing both values becomes a fast-follow.
- **Q1 — Pending visibility:** should queued/dispatched runs render as grayed
  `pending` rows (proposed in §4) or be omitted until a session exists? Builder
  confirms with owner at build review; default is render.
- **Q2 — Run cap:** 20 most recent runs is a first-cut constant; tasks with long
  run histories need a "show all" affordance eventually. TODO-verify real
  max-runs-per-task distribution before freezing.

## 8. Explicit Non-Goals (v1)

- **No editing of bindings by hand.** No UI or API to attach/detach a session
  to a task; the dispatcher remains the sole writer.
- **No cross-task session merging.** A session bound to multiple runs appears
  once per task context; no deduplication or merging across tasks.
- **No changes to dispatcher write paths.** Claim/heartbeat/complete SQL is
  frozen for this feature.
- **No transcript previews in the task panel.** Bodies stay behind the replay/
  console links, which own size caps.
- **No live tailing inside the task detail.** Running rows hand off to Live
  Console; embedding a stream here is a later increment.
- **No historical backfill.** Runs predating session binding stay
  "no session recorded"; no transcript-content scanning to guess links.
- **No new auth surface.** Existing bearer-token middleware covers the new route.
