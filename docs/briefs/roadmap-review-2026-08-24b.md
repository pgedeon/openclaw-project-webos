---
layout: default
---

# Roadmap Review 2026-08-24b — Endgame Sequencing

**Status:** Planning audit only. No feature code touched.
**Scope:** Second strategy rotation on UPGRADE_ROADMAP.md. Review #1
(`roadmap-review-2026-08-24.md`) set the sequencing; that sequence is now mostly
EXECUTED — Mission Control shipped + ticked, gateway bridge validated + ticked,
live console shipped + validated + ticked, budget ledger slice 1 + session replay
backend shipped, budget slice 2 + replay view building concurrently.
**Evidence base:** git log `92021f9..HEAD` (22 commits, 01:15–10:21), CHANGELOG
`[Unreleased]`, `docs/briefs/{budget-ledger,session-replay}.md`,
`routes/cost-routes.js`, `scripts/docs-drift-check.js` (exit 0, 0 errors),
DB-free suite 42/42 green at audit time.

---

## 1. Velocity Assessment

Measured since review #1: **22 commits in ~9 hours**, three parallel lanes
(build, validation, docs). Composition:

| Outcome | Count | Items |
|---|---|---|
| Roadmap items fully closed | 3 | Mission Control (112b224, 0a667ab), gateway bridge (6184097, d568a07), live console (83919c4, 1c8acf7) |
| Partial lands on open items | 2 | replay backend part 1 (49eef27), budget slice 1 (0a1ed9b) |
| Design briefs | 3 | session-replay, live-console, budget-ledger |
| Research/spike | 2 | streaming spike (ed3d733), market scan refresh (bfd184e) |
| Security dep fixes | 2 | GHSA-5p4m-2wfm-xmqj (ad1fbc5, PR #19) |

Cadence held at roughly **one roadmap item closed per ~3 hours**, with briefs
landing 2–3 h ahead of their builds. Review #1's "~2× commit overstatement"
rule of thumb continues to hold: of 22 commits, ~11 were bookkeeping/docs.

**Verdict:** velocity is healthy and *increasing in feature density* — Phase 1's
three heaviest integration items (MC, bridge, console) all closed inside this
window, each validated against the live gateway before ticking. No stalled lane.

## 2. Unchecked Inventory — What Genuinely Remains

15 unchecked boxes remain. Honest state per item:

### Phase 0 leftovers (2) — both small, one is a live blocker

| Item | Effort | Notes |
|---|---|---|
| **Cost/token history backfill** | S — ≤1 run | No backfill script exists in the repo (verified). Gates budget slice 2 enforcement AND the Phase 2 analytics residuals. Highest-leverage small item left on the board. |
| **`npm audit` as CI gate** | XS — ≤½ run | Foldable into any run already touching `.github/workflows/ci.yml`; otherwise standalone micro-run. |

### Phase 1 (6 boxes; 2 in flight)

| Item | State | Remaining effort |
|---|---|---|
| **Session replay inspector** | Backend shipped (reader + events routes, 49eef27); view building now | ≤1 run to land + validate. Brief AC1–AC9 ready for qa-auditor. |
| **Budget ledger + auto-pause** | Slice 1 shipped (migration 023, budgets API, pure eval, 0a1ed9b); slice 2 (dispatcher enforcement) building now; slice 3 (MC bars + `budget_breach` flag + SSE) not started | Slice 2 ≤1 run (⚠ see §4 ordering flag); slice 3 = 1 run. |
| **One-click agent actions** | Not started. Brief does not exist — the "write it during bridge/console runs" instruction (review #1 run 7) expired unused when both those runs completed this morning | Brief = 1 docs run (can overlap build lanes); build = 1–2 runs (write paths, idempotency, protected-action preview + receipts per market scan 2026-08-24). Longest remaining pole. |
| **Memory browser 2.0** | Not started; semantic-search foundation live in memory-view | 1 filler run. Lowest daily-value item in phase. |

### Done-by-side-effect verdicts (the "can we tick it?" question)

- **Cost & token analytics UI — PARTIALLY covered, do not tick.** Fleet-level
  aggregate (`GET /api/costs/summary?days=7`) + Mission Control cost panel ship
  today/7d totals with correct degradation states; budget slice 3 adds budget
  bars to the same panel. What does NOT exist anywhere: **per-agent / per-
  department / per-workflow-type rollups** (verified: `cost-routes.js` has no
  `GROUP BY owner_agent_id`-class query) and sparkline feeding. Remaining true
  scope is one rollup endpoint + UI wiring ≈ **1 run**. Annotate the checkbox
  accordingly (done in this commit) rather than tick.
- **Session replay inspector — backend half done-by-side-effect of the console
  work** (session-reader infrastructure), but the checkbox describes the
  stepper view; stays open until the view lands.
- Nothing else qualifies. Snapshot/restore's foundation (`export-routes.js`)
  exists but the item is genuinely unbuilt; MCP exposure has zero code.

### Phase 2 (5) and Phase 3 (4)

No drift found. Phase 3 items remain low-coupling polish. See §5 for Phase 2
readiness verdict.

## 3. Recommended Final Phase 1 Order (endgame queue)

In-flight lanes finish; then:

| Order | Run | Item | Why |
|---|---|---|---|
| 1 | next available | **Cost/token backfill** | Unblocks slice 2 merge + analytics residual; small; zero collision with in-flight lanes |
| 2 | in flight | **Replay view** lands + validates | Closes its box |
| 3 | in flight, after #1 | **Budget slice 2** lands | Enforcement over non-sparse history |
| 4 | +1 run | **Budget slice 3** (MC bars, `budget_breach` flag, SSE typeMap) + fold `npm audit` gate if a CI-touching run is open anyway | Closes budget box |
| 5 | docs lane NOW | **One-click actions brief** (action set, confirmation UX, idempotency, protected-action preview + receipts; also defines the gating machinery NL command bar reuses) | Removes the long pole's blocker; pure docs, no lane collision |
| 6 | after #5 | **One-click actions build** (1–2 runs) | Last big Phase 1 lift |
| — | filler | **Memory browser 2.0** whenever a DB-dependent run blocks (working rule 8) | Explicitly flex (§6) |

## 4. Sequencing Flag — slice 2 vs backfill

`docs/briefs/budget-ledger.md` §4/R2 is explicit: backfill "must land before
Slice 2 (enforcement)" because budgets over sparse history silently
under-enforce. Slice 2 is building **right now** while no backfill exists in
the repo. Two acceptable resolutions, in preference order:

1. Backfill lands before slice 2 merges (it is a ≤1-run job and touches
   disjoint files — no lane collision).
2. If backfill slips, slice 2 merges with the under-enforcement caveat
   documented in CHANGELOG and the budgets API copy, and backfill becomes the
   mandatory next run.

Option 1 costs nothing; take it. Do not let slice 2 sit merged-and-silent.

## 5. Phase 2 Readiness Verdict

**Ready to open in parallel — for two of five items — before Phase 1's box is
fully clear:**

- **MCP server exposure**: zero Phase 1 dependencies; read-only toolset over
  shipped REST routes; still the single most defensible roadmap item (review #1
  slot-protection stance holds). Start once the two in-flight build lanes drain
  (cap: 2 build lanes + 1 docs lane — see risk 3).
- **Snapshot/restore**: builds on existing `export-routes.js`; independent of
  everything in flight. Cheap, operator-valuable, safe interleave.
- **Cost & token analytics UI**: unblocked the moment backfill lands; 1 run at
  its reduced (annotated) scope.
- **NL command bar**: sequenced AFTER one-click actions — it reuses the same
  confirmation/receipt machinery; building it first would fork the gating
  design. This dependency is why the brief (§3 order 5) matters beyond Phase 1.
- **Workflow visual editor Stage 1**: last in phase, first willing-cut (§6).

Phase 1 completion ETA: **functionally complete (replay + budgets + one-click
actions) in ~4–5 further runs ≈ within the next working day** at observed
cadence. Not "next run or two" — that horizon covers only the two in-flight
items. Box-and-all including memory browser: ~5–7 runs, unless memory browser
is flexed out of the exit criteria (recommended, §6).

## 6. Cut / Fold Recommendations

1. **FOLD — cost analytics UI scope**: mark fleet-level coverage as delivered
   by side effect (cost summary API + MC cost panel + upcoming budget bars);
   reduce the checkbox to rollups + sparklines (annotated in this commit).
   Saves ~½ run of rediscovery and prevents a phantom "big" Phase 2 item.
2. **FLEX — memory browser 2.0 out of the Phase 1 exit criteria**: keep the box
   in Phase 1 as designated filler, but explicitly not blocking Phase 2 start
   (annotated). Single-operator daily value is the lowest in phase; market scan
   already ruled memory-graph parity can trail. Prevents a filler item from
   holding the phase gate hostage.
3. **FOLD — gating design, write once**: one-click actions brief owns the
   confirmation/idempotency/receipts machinery; NL command bar consumes it.
   Recorded on both checkboxes (annotated). Prevents duplicate design work in
   Phase 2.
4. **KEEP — one-click actions and MCP exposure**: differentiator core; no cut.
5. **WILLING-CUT — workflow visual editor Stage 1**: if Phase 2 slips behind
   schedule, this is the first item dropped entirely; read-only graph render is
   eye-candy next to MCP depth. No roadmap change yet — decision point at next
   review.
6. **Phase 3 unchanged.**

## 7. Risk Register — Top 3 (delta from review #1)

1. **Slice 2 / backfill ordering violation, in flight.** Self-inflicted
   process drift against the budget brief's own dependency gate (§4).
   Mitigation: backfill takes the next available run; resolution recorded in
   CHANGELOG either way.
2. **One-click actions brief debt.** Its scheduled writing window (during
   bridge/console runs) closed unused; it is now the long pole of Phase 1.
   Every half-day of slip pushes phase completion a half-day. Mitigation:
   docs-lane run for the brief immediately — it collides with nothing.
3. **Concurrent-lane collision surface growing.** Budget slice 2 (dispatcher +
   api-reference docs) and replay view (app-registry + views-reference docs)
   both carry docs-drift gates; a third build lane would create merge friction
   on shared registry/reference files. Mitigation: hard cap 2 build lanes + 1
   docs lane until both in-flight items land.

*Watchlist carried from review #1:* cost-data sparsity keeps anomaly flag 4
quiet until backfill lands (now doubly true — it also gates slice 2);
CHANGELOG `[Unreleased]` backlog (~20 entries) should be folded out at the next
release cut — candidate trigger: Phase 1 completion.

## 8. Actions Taken in This Commit

1. This review document.
2. `UPGRADE_ROADMAP.md`, three annotations, nothing ticked or unticked:
   - **Cost & token analytics UI**: fleet-level marked delivered-by-side-effect;
     remaining scope narrowed to per-agent/department rollups + sparkline
     wiring; backfill dependency restated. *Justification:* §2/done-by-side-
     effect audit — prevents the hourly cron from re-planning shipped scope.
   - **Memory browser 2.0**: marked flex — does not block Phase 2 start.
     *Justification:* §6/fold 2 — keeps the phase gate honest.
   - **One-click agent actions**: brief-overdue note (window expired) +
     shared-gating-machinery link from NL command bar. *Justification:* §4
     risk 2 and §6/fold 3 — the cron picker needs to see the brief as the
     actionable next step for this item.

Review only. No `.js/.mjs/.sql/.yml` changes. `node scripts/docs-drift-check.js`
exit 0 (0 errors, 10 pre-existing warnings); DB-free suite 42/42 at audit time.
