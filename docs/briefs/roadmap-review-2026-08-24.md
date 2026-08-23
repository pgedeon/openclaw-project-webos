# Roadmap Review — 2026-08-24

**Status:** Planning audit only. No feature code touched.
**Scope:** UPGRADE_ROADMAP.md health check after Phase 0 shipped in one day (2026-08-23,
v1.1.0 released, CI + e2e green, all 11 security findings closed). Phase 1 starting:
Mission Control part 1 concurrently in build per `docs/briefs/mission-control.md`.
**Evidence base:** git log `7abc8f3..HEAD` (24 commits), CHANGELOG `[1.1.0]`,
`docs/research/market-scan-2026-08-23.md`, `docs/briefs/mission-control.md`.

---

## 1. Velocity Assessment

Measured: **24 commits in ~13.5 hours** (2026-08-23 11:17 → 2026-08-24 00:52),
staggered agent lanes (CI lane, test-triage lane, security lane, docs lane).

Composition matters more than the raw number:

| Type | Count | Notes |
|---|---|---|
| Docs-only (changelog ticks, roadmap ticks, audit doc) | ~10 | bookkeeping, near-zero risk |
| CI/test infrastructure | 4 | pipeline, e2e job, triage, runner fix |
| Security fixes | 6 | F1–F11 + CVE-2026-44240 |
| Schema/feature code | 2 | migration 022, storage helpers |
| Release chore | 2 | 1.1.0 release commit |

**Implication for remaining estimates.** Phase 0 was audit/fix/docs-heavy — the
profile agents parallelize best. The remaining roadmap inverts that mix: Phase 1
items (WS bridge, live console, replay inspector) are single large diffs over
shared files (`routes/router.js`, `src/shell/app-registry.mjs`) that resist
parallel lanes and will collide if staggered naively. Treat day-level estimates
as follows:

- **Phase 1 (6 items):** 2–3 days at observed cadence, *not* 1. Each item needs
  its own brief + qa pass; bridge/console share the streaming prerequisite.
- **Phase 2 (5 items):** 2 days. Cost analytics is mostly UI over an existing
  schema (fast); MCP exposure is the biggest single lift (impact 9 / effort 5).
- **Phase 3 (4 items):** 1 day. Low coupling, safe to interleave when higher
  phases are blocked.

Rule of thumb going forward: **raw commits/day overstates feature throughput
~2×** on this repo because ~40% of Phase 0 volume was bookkeeping. Plan lanes
around briefs-shipped, not commits.

---

## 2. Stale / Risk Audit of Unchecked Items

Checked every unchecked box against what actually shipped. Verdicts:

### Not stale, correctly scoped

- **Mission Control view** — briefed (f562a2d), acceptance criteria testable,
  in build. Current.
- **Session replay inspector** — scope correctly grew to time-travel stepper per
  market scan; session-reader routes already shipped and covered (see §4).
- **Cost & token analytics UI** — schema dependency shipped in Phase 0. Sound.
- **MCP server exposure** — correctly placed in Phase 2 (see §3).
- **Workflow visual editor (staged)** — demotion still correct; Stage 1
  read-only render is the right ceiling under the no-frameworks rule.
- **Snapshot/restore, NL command bar, all Phase 3** — no drift found.

### Underspecified — needs a brief or sub-step before build

1. **Gateway websocket bridge** — landmine note is right, but transport choice
   is left open. The task-server **already ships an SSE event-stream route**
   (covered since TEST-SSE #7, auth hardened in F7). SSE fanout may satisfy the
   requirement without new WS protocol work. Bridge item must evaluate
   SSE-first vs raw WS before any code. See §4 sequencing.
2. **Live agent console** — "first verify what the gateway exposes" is buried
   in prose. Make the verification an explicit spike run with a written output
   artifact; both console AND bridge depend on it.
3. **One-click agent actions** — no brief exists. Which actions, confirmation
   UX, idempotency, and error paths are undefined. Do not start without one;
   the approval-gate machinery exists but the action set doesn't.

### Hidden open work buried inside checked items (now promoted)

Two leftovers live only as prose inside ticked Phase 0 boxes where the hourly
cron picker ("pick the highest unchecked item") will never see them:

- **Cost/token backfill** from historical gateway data (inside the cost-schema
  box) — without it, Mission Control's cost panel and anomaly flag 4 stay
  near-empty for a week regardless.
- **`npm audit` as CI gate** (inside the security box) — flagged advisory in
  the security-pass closure, trivially automatable.

Both added as explicit unchecked Phase 0 items in this commit. They are small,
single-run clears; expect ≤2 cron runs diverted before Phase 1 resumes.

### Misordered

One intra-phase swap justified (done in this commit): **session replay inspector
moved above one-click agent actions.** Rationale: replay is read-only (no gating
design needed), rides on already-shipped session-reader routes, and is the one
feature where the 6.1k-star competitor has visible traction. One-click actions
need a design brief first anyway.

### Changelog hygiene (noted, not fixed here)

CHANGELOG `[Unreleased]` carries ~18 entries from pre-baseline TEST-lane work
(TEST-AGENT #3 … TEST-TASK #17) that were never folded into a release section.
Not drift — the work exists — but `[Unreleased]` should be emptied into the next
release cut. Out of scope for this commit per task constraints.

---

## 3. Market-Scan Alignment (eec4146 additions)

The three scan-driven additions sit at the **right priority**. Reasoning against
competitor Mission Control (~6.1k stars; live session replay, memory knowledge
graph, per-agent cost):

- **Replay stepper (Phase 1)** — correct phase, now correctly *ordered* within
  the phase. This is the only head-to-head parity race worth running, because
  our session-reader routes make it cheap while competitors needed bespoke
  capture pipelines.
- **Budget ledger + auto-pause (Phase 2)** — correct placement, but it inherits
  the backfill gap: caps and breach detection are meaningless until cost history
  accumulates. Hence backfill promoted to an explicit Phase 0 checkbox.
- **MCP exposure (Phase 2)** — keep exactly where it is. It is the single most
  defensible item in the roadmap (market scan: "no other OpenClaw dashboard does
  this"). Protect its slot: don't let Phase 1 slippage crowd it out, and ship
  read-only tools first.

Strategic frame held: we do not win feature-parity against a 6.1k-star project.
We win on desktop-shell UX + governance pipeline + OpenClaw-native depth (scan
§"Our differentiators"). Replay is the exception because it's cheap for us;
memory-graph and per-agent-cost parity can trail.

---

## 4. Phase 1 Sequencing Proposal

Full queue; **runs 3–7 are the recommended next five after Mission Control
part 1/2**:

| Run | Item | Why this order |
|---|---|---|
| 1 *(in flight)* | **Mission Control part 1** — DB-free panels (Fleet gateway-side, Cron Health, Quick Links), registration, docs counts | Cheap, CI-safe, immediate daily value |
| 2 | **Mission Control part 2** — Postgres panels (Blocked/Stale Runs, Cost), anomaly engine `computeAnomalies()` + AC5 fixtures, small `/api/costs/summary` route | Completes AC1–AC9; anomaly flags need B/D payloads |
| 3 | **Gateway streaming verification spike** — read-only probe: what does the gateway expose for streaming (endpoint, auth shape, event granularity)? Output: short findings doc in `docs/briefs/`. No product code. | Cheapest de-risk in the roadmap; unblocks BOTH runs 4 and 5; prevents building the bridge against an assumed API |
| 4 | **Gateway WS/SSE bridge behind flag** — backend subscribes to gateway server-side, fans out to browsers; evaluate SSE-first (existing SSE route infra, F7-hardened auth) vs raw WS; keep polling fallback; reconnect/backoff; multi-tab fanout; token stays server-side | Landmine-respecting pattern requires the fanout layer to exist before any consumer; Mission Control becomes its first consumer |
| 5 | **Live agent console** — terminal window streaming agent output/tool-calls; mock-first until run 3 confirms the real surface | Depends directly on run 3 findings + run 4 fanout transport |
| 6 | **Session replay inspector** — time-travel stepper over tool-call events; payload inspection per step | Read-only, routes exist, differentiation vs competitor; no gating design needed |
| 7 | **One-click agent actions** — assign → dispatch → approve → publish | Needs its own brief (action set, confirmation UX, idempotency) written during runs 4–6 |

**Memory browser 2.0** stays last in Phase 1 (graph-first scope per market scan
rec #5) and is the designated filler whenever a DB-dependent run is blocked
(working rule 8) — its semantic-search backend is already live.

---

## 5. Risk Register — Top 3

1. **Single-maintainer bus factor.** Entire cadence hangs on one operator plus
   agent lanes; the dead `webos-auto-improve.py` pipeline proved the SPOF
   failure mode (silent halt, cron firing into the void).
   *Mitigation:* working rules 1–10 (already codified); every Phase 1 item gets
   a written brief before build so any fresh agent lane can pick it up cold;
   escalation rule 9 stays non-negotiable; keep diffs single-purpose.
2. **View-layer test coverage gaps.** 19 pre-shell-era view tests were deleted
   in triage; e2e is a chromium-only smoke suite; window-manager/shell
   interactions (multi-window, teardown, poll hygiene) have thin coverage while
   view count grows.
   *Mitigation:* enforce the Mission Control AC pattern (AC1–AC9: registration,
   read-only guarantee, degradation, independent panel failure, teardown) for
   every new view; add one Playwright spec per new window; never push red.
3. **WSL2 loopback deployment assumptions.** Gateway is loopback-bound
   (`wss://127.0.0.1:18789`); direct browser→gateway breaks remotely; servers
   default to `127.0.0.1` binds (F8). Any feature assuming browser-reachable
   gateway silently works locally and breaks deployed.
   *Mitigation:* server-side fanout only (run 4 pattern); tokens never leave
   the backend; run 3 spike documents the real topology before consumers are
   built; deployment notes in the findings doc.

*Watchlist (below top 3):* cost-data sparsity makes anomaly flag 4 silent for
~week one even after backfill lands; CLI-backed endpoints (`/api/cron/jobs`)
have no SLA — per-panel timeouts mandatory (brief R1); CHANGELOG
`[Unreleased]` backlog should be folded out at next release cut.

---

## 6. Actions Taken in This Commit

1. This review document.
2. `UPGRADE_ROADMAP.md`: moved session replay inspector above one-click agent
   actions; annotated Mission Control (build in flight), WS bridge (SSE-first
   evaluation), live console (explicit spike), memory browser (graph-first);
   added two explicit Phase 0 checkboxes promoting the hidden leftovers
   (cost/token backfill, `npm audit` CI gate). Nothing ticked or unticked.
