---
layout: default
---

# Roadmap Review 2026-08-25b — Steady-State Assessment & Next Chapter

**Status:** Planning audit only. No feature code touched.
**Scope:** Review #4. First assessment of the POST-RELEASE operating mode. All
23 original roadmap items remain ticked (a382e92); v2.0.0 released; debt
register nearly clear — D1 ✓ (migration 025), D3 ✓ (redact lookarounds),
D4 ✓ (receipt detail) — with D5 benchmarks deferred by design. This review
audits whether the project is maintainable at reduced cadence, recommends the
honest operating mode now that the hourly cron has emptied its own roadmap,
re-ranks next-chapter candidates after the D1/D3/D4 clearance, and checks for
rot.
**Evidence base:** git log through 444255a; live runs at audit time — DB-free
suite **59/59 PASS** (wall ≈26.5 s locally on /mnt/c), Playwright e2e list
**7 tests / 1 spec**, `node scripts/docs-drift-check.js` exit 0 (**0 errors,
10 baseline warnings**, unchanged set since review #3),
`node scripts/dag-telemetry-counter.js` (day 0 of 21, verdict `no_go`, 0 rows
— window opened today), staging health probe `http://192.168.0.81:8120/api/health`
(HTTP 200, `json_snapshot` degraded mode as designed, uptime ≈90 min at
08:17 UTC), `gh pr list` / `gh issue list` (0 open each), CI run history
(latest `verify` + `e2e` + Pages all green, CI wall 48–54 s).

---

## 1. Steady-State Audit — Repo Health Snapshot

| Dimension | Reading at audit time | Verdict |
|---|---|---|
| Tree | HEAD 444255a, clean, `core.autocrlf=true`, up to date with origin | ✅ |
| Version | 2.0.0 released + tagged; `[Unreleased]` carries post-release work (D1/D3/D4 fixes, budgets slice 4, NL task.create, DAG counter, remote-access docs) | ✅ |
| DB-free unit suite | **59/59 PASS**, ≈26.5 s wall (was 57/57 at review #3; grew test-workflow-graph.js, test-budgets-view.js, test-dag-telemetry.js along with shipped features) | ✅ fast enough to run every run |
| E2E | 7-test chromium smoke (DB-free shell boot + auth + health), separate CI job so it never blocks unit gates | ✅ honest scope |
| CI | 2 workflows: `ci.yml` (verify job: npm-audit critical gate → syntax check → docs-drift → DB-free tests; e2e job: Playwright chromium) + `docs-pages.yml`. Latest pushes all green, CI wall 48–54 s | ✅ |
| Docs gate | drift-check exit 0, 0 errors, 10 baseline warnings — **same warning set as review #3**, not growing | ✅ |
| Open PRs / issues | **0 / 0** | ✅ nothing queuing |
| External contributors | anupamme: **5 merged PRs** (#18–22, CVE/dep upgrades + child_process sanitization + hardcoded-secret removal), #22 merged 2026-08-25T01:19Z — bursty ~2/day cadence, same-day merges, all security-flavored | ✅ healthy loop |
| Commit velocity | 08-23: 21 · 08-24: 61 · 08-25: 45 (through mid-morning) — the hourly cron's breakneck signature | ⚠️ pace, not problem |
| Staging slot | :8120 live, health 200, `json_snapshot` degraded mode (expected — no PostgreSQL on staging), uptime ≈90 min consistent with the 06:49Z slice-4 deploy + post-verify | ✅ |

**Maintainability verdict: YES — reduced cadence is safe.** Every quality gate
that mattered during the sprint is now automated (audit gate, syntax sweep,
drift check, 59-test suite, e2e smoke, Pages deploy). A maintainer returning
cold gets a green/red signal in under a minute. The one thing automation does
NOT cover is cross-lane coordination — see §4 finding R1, which is itself an
argument for fewer concurrent runs.

## 2. Cadence Recommendation

The hourly cron was the right engine for a 23-item sprint: 127 commits in
~2.5 days, roadmap emptied, 2.0.0 shipped. It is the WRONG default now:

- The board is empty. An hourly run with no scoped item either idles or
  **invents scope** — and invention under time pressure is exactly what
  produced today's concurrent-lane CHANGELOG collision (§4 R1).
- Every remaining dated item is a *waiting* item, not a *building* item:
  DAG GO/NO-GO accrues telemetry until 2026-09-14; tailnet rollout waits on
  an owner order; D5 waits for unhurried measurement.

**Recommendation: drop to TWICE-DAILY steady-state runs** (suggest ~08:30 and
~17:30 Europe/Berlin, off the release-batch hour), replacing the hourly cron.
Each run works a pull-based queue, in priority order:

1. **Sync + gates** — pull main; confirm CI/drift green; anything red is the
   run's entire job (working rule #9 escalation unchanged).
2. **DAG telemetry readout** — `npm run dag:telemetry`; log the verdict line
   in the run notes until the 2026-09-14 decision. Zero-cost, keeps the
   decision honest.
3. **Community PR review** — anupamme merges in bursts; same-day review is
   the whole external-contributor experience. Twice daily covers it.
4. **Dependency watch** — ONE designated run per week (say Friday AM):
   `npm outdated` + prod-deps audit review; the known ws ≥8.20.2 non-breaking
   bump is the first queued outcome (see §3 rank 1).
5. **Scoped work items** — only what a review brief (this document's §3) or
   the owner queued. If the queue is empty, the run is a 5-minute health
   check and stops. **An empty queue is a valid outcome; inventing work is
   not.**

**Restore higher cadence only on trigger:** an approved new-chapter brief,
a DAG **GO** verdict on 2026-09-14 (editor Stage 2 becomes buildable), or an
external PR backlog >2. The hourly mode's working rules (#1–#10) carry over
verbatim otherwise.

This change requires OWNER execution (cron config is operator infrastructure);
everything else in §3 marked autonomous proceeds inside whatever cadence lands.

## 3. Next-Chapter Shortlist — Re-Ranked Post-D1/D3/D4

Review #3's top candidate (normalization, D1) shipped; D3/D4 cleared same-day.
Re-scored with fresh evidence. Impact/effort 1–5, leverage = impact ÷ effort.

| Rank | Candidate | Impact | Effort | Mode | Notes |
|---|---|---|---|---|---|
| 1 | **Security tightening run** — ws ≥8.20.2 (non-breaking, closes GHSA-58qx-3vcg-4xpx + GHSA-96hv-2xvq-fx4p), then puppeteer-core@25 major (closes GHSA-jmr9-qjv8-65gv), then raise npm-audit gate critical→high | 4 | 2 | **AUTONOMOUS** | Only remaining item that converts a scored asterisk (security 4→5 path in review #3's table). Split it: ws bump any run; puppeteer major + gate raise as one coherent change with the full suite green. Flag in changelog, no owner sign-off needed — CI gates protect the move. |
| 2 | **Task ↔ session conversation binding** (market-scan steal #2, already a roadmap candidate) | 4 | 2 | **OWNER picks the chapter** | Strongest remaining FEATURE: read-only Conversation tab riding ALREADY-SHIPPED session-reader routes + replay components; no new write path. Needs a planner brief before build per house rules — owner go-ahead converts it to brief. |
| 3 | **D5 benchmark harness** (deferred-by-design debt) | 3 | 2 | **AUTONOMOUS** | Deferral reason was sprint pressure; pressure is gone. Small scripted Playwright timing harness (boot-to-interactive, capped-list scroll) run manually per release, per review #3's fix shape. Not CI-blocking. |
| 4 | **MCP tool adoption telemetry** | 2.5 | 1.5 | **AUTONOMOUS, low priority** | Mirrors dag-telemetry-counter pattern (audit_log-based read-only script). Honest caveat: with zero external consumers, adoption data measures one operator. Build when an exposure/consumer push exists, not before. |
| 5 | **NL bar v2 server-side LLM parsing** (brief §4 v2 sketch: `POST /api/nl/parse`, default-off kill switch, token bucket) | 3 | 3 | **OWNER** | The brief's own §4 argues v1 determinism IS the safety property; v2 makes misparse-safety statistical and bills operator gateway tokens per parse. Both the cost policy and the posture call are owner decisions. Defer unless grammar-miss friction shows up in real use. |
| 6 | **Workflow template normalization follow-ups** | — | — | **BLOCKED by design** | Core D1 shipped (migration 025 + write-path normalization). The follow-up IS editor Stage 2, gated on the DAG GO/NO-GO telemetry (~2026-09-14). Nothing to build now; revisit with numbers. |
| 7 | **Tailnet rollout** | 3 | 1 | **OWNER order pending** | Recipe + topology docs shipped (444255a); recon confirms tailscale NOT installed on the dev machine. Zero autonomous work possible — installing/running tailscaled on owner hardware is explicitly an owner call. |
| 8 | **Budget slice 5** | n/a | n/a | **CLOSE — does not exist** | budget-ledger.md defines FOUR slices; slices 1–4 all shipped (slice 4 deployed 06:46Z today). There is no slice 5 to build. Do not invent scope; cost-governance loop is complete per its brief. |

Net: **two autonomous engineering items** (ranks 1, 3 — plus optional rank 4),
**one owner chapter pick** (rank 2), **two owner-gated waits** (ranks 5, 7),
**one dated decision** (rank 6), **one closed non-candidate** (rank 8).

## 4. Risk Check — What's Rotting?

**R1 — CHANGELOG `[Unreleased]` concurrent-lane duplication (REAL, fixed in
this commit).** The section contained TWO `### Added`, TWO `### Fixed`, and
TWO `### Changed` blocks; the migration-025 Fixed entry and the 025-backfill
Changed entry appeared **twice verbatim** (grep-confirmed). Cause: parallel
agent lanes appending to one file between pulls — review #3's debt D2
(shared-tree attribution tangles) manifesting in content, not just blame.
Fixed here by merging to single canonical sections. Mitigation going forward
is cadence (fewer concurrent lanes) plus the D2 trailer convention
(`Assisted-by:`) still recommended, not yet adopted.

**R2 — Staging deploy-script stability: watch, not rot.** Two hardening
commits in 24 h (c926d52 created the deploy script 08-24 evening; 5301ce5
"robust staging restart — detached successor + health gate" 05:11 today after
restart instability; b6ff36a added post-verify). Current state healthy: clean
deploy this morning, post-verify hooks standard, uptime continuous since.
Observation window is ~1 day — keep it on the watch-list one more week before
calling it solved.

**R3 — Test flake watch-list: does not exist.** Searched docs/ — no flake
watch-list file anywhere; nearest artifact is the ci.yml triage comment block
(2026-08-23, 31 excluded tests re-triaged, phantom tests deleted). Flake
signal at audit time: zero (suite green across repeated local runs including
timing rerun; CI streak green). Honest position: don't pre-build flake
infrastructure; create the watch-list entry when the FIRST flake is observed,
with the run ID and repro.

**R4 — Docs drift: stable, not growing.** Baseline 10 warnings, identical set
since review #3. The drift gate held through 45 commits today — the
update-docs-in-same-commit rule is being obeyed under cron pressure. No rot.

**R5 — Known-open, deliberately carried (not new rot):**
- Historical CHANGELOG sections out of chronological order (2.0.0-rc.4 dated
  2026-03-23 below 1.1.0) — cosmetic, flagged review #3, still unfixed.
- npm audit gate at `critical`: 5 HIGH advisories open in the prod tree —
  this is §3 rank 1's whole reason to exist.
- Receipt/MCP mutation paths never validated against live PostgreSQL
  (review #3 finding 2) — staging is json_snapshot-only; carried as a 2.1
  validation-run requirement, unchanged.

## 5. Actions Taken in This Commit

1. This review document (`docs/briefs/roadmap-review-2026-08-25b.md`).
2. `UPGRADE_ROADMAP.md`: new bottom section **"Post-2.0 Steady State"** —
   operating mode (twice-daily pull-based runs, empty-queue-is-valid, restore
   triggers) + dated watch-list (DAG GO/NO-GO 2026-09-14, tailnet rollout
   pending owner order, D5 deferred-until-measurable, staging deploy-script
   observation). No new committed promises beyond the operating mode.
   Bookkeeping in the same edit: budget slice 4 candidate ticked SHIPPED with
   evidence; tailnet candidate annotated docs-shipped/rollout-pending-owner.
3. `CHANGELOG.md`: deduplicated `[Unreleased]` (R1) — single Added/Fixed/
   Changed sections, verbatim duplicates removed, zero content lost.
4. `docs/index.md` regenerated for the new brief.

Review only — no `.js/.mjs/.sql/.yml` feature changes. At audit time:
DB-free suite 59/59 (≈26.5 s), docs-drift-check exit 0 (0 errors, 10 baseline
warnings).
