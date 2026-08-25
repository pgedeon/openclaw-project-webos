---
layout: default
---

# Roadmap Review 2026-08-25 — Post-2.0 Assessment

**Status:** Planning audit only. No feature code touched.
**Scope:** Review #3. The roadmap board is EMPTY — all 23 boxes ticked, 2.0.0
released and tagged (4829970, release notes d0635d4). This review audits what
"done" actually means, scores the "10x upgrade" claim honestly per dimension,
registers the debt the sprint leaves behind, and proposes the 2.1 chapter.
**Evidence base:** git log through d0635d4; CHANGELOG `[2.0.0]`;
`UPGRADE_ROADMAP.md` (23/23 `[x]`, 0 unchecked); live runs at audit time —
DB-free suite **57/57 PASS**, `node scripts/docs-drift-check.js` exit 0
(0 errors, 10 baseline warnings); `package.json` version 2.0.0; file-level
existence checks on every claimed deliverable (below).

---

## 1. Completion Audit — Spot-Checks

Every roadmap box is ticked. Spot-checked claimed deliverables against the tree:

| Claimed | Artifact check | Verdict |
|---|---|---|
| Mission Control | `src/shell/native-views/mission-control-view.mjs`, `routes/cost-routes.js` | ✅ present |
| Gateway bridge + console | `lib/gateway-bridge.js`, `routes/sse-routes.js`, console view | ✅ present |
| Budget ledger slices 1–3 | `lib/budget-enforcement.js`, migration 023, MC budget bars | ✅ present; slice 4 open by design |
| One-click actions | `lib/action-registry.js`, `routes/action-routes.js`, migration 024, tray | ✅ present; slice 3 surfacing open |
| Session replay inspector | `session-replay-view.mjs` + reader routes | ✅ present |
| Memory Browser 2.0 | `memory-browser-view.mjs` (35th app) | ✅ present |
| MCP server | root `mcp-server.js` + `lib/mcp-server.js`, 13 tools, flag-gated trio | ✅ present |
| NL command bar | `lib/nl-parse.js`, `command-palette.mjs` Ask mode | ✅ present |
| Snapshot/restore | `routes/snapshot-routes.js`, `lib/snapshot-{manifest,diff,redact}.js`, settings panel | ✅ present |
| Visual editor Stage 1 | `lib/workflow-graph-layout.js`, graph routes + toggle | ✅ present; GO/NO-GO pending 2026-09-14 |
| PWA install | `manifest.webmanifest`, `sw.js`, icons/ | ✅ present |
| Theme engine | `src/styles/win11-accents.css`, accent-packs helper | ✅ present |
| Perf pass | `src/shell/list-window.mjs`, caps in tasks/board views | ✅ present; no benchmarks (see §3/D5) |
| Docs site | `.github/workflows/docs-pages.yml`, committed generated index | ✅ present |

Audit-time verification: DB-free suite 57/57 green, docs-drift-check exit 0,
CHANGELOG `[Unreleased]` empty (release fold done), version bumped.

**Findings (3):**

1. **Visual-editor box contradiction.** Line 181 is `- [x]` while its own body
   says "Checkbox stays UNTICKED on purpose — GO/NO-GO is the brief §6 21-day
   metric". The tick records Stage 1 shipped (true); the GO/NO-GO decision
   (~2026-09-14) is still open and now has no unchecked box to keep it visible.
   Fixed in this commit's roadmap edit (see §6).
2. **MCP mutations never exercised against a live database.** Staging validation
   ran in json_snapshot mode — writes correctly refused with structured 503s,
   but no receipt-minted mutation has ever executed against real PostgreSQL.
   The receipt pipeline's happy path (latch → execute → finalize tx) is
   test-covered, not staging-proven. Carry as 2.1 validation run.
3. **Cost backfill is an honest zero.** First `--apply` matched 0 of 22 runs
   (transcripts predate retention). Cost analytics therefore render from new
   data only; anomaly flag thresholds stay quiet until history accumulates.
   Correctly documented, but "cost-governed" claims rest on ~1 day of data.

## 2. "10x Upgrade" — Honest Scoring Per Dimension

The release notes claim: security-hardened, live-streaming, cost-governed,
MCP-exposed agent operations platform. Scored 0–5 against evidence:

| Dimension | Score | Evidence for | Evidence against / gap |
|---|---|---|---|
| Security hardening | **4** | All 11 audit findings closed (2 critical incl.); bearer auth on all 4 servers; npm-audit CI gate live; export secret leak hotfixed same-day | Gate at `critical` only — 5 HIGH advisories open in prod tree (ws 8.20.0 ×2, extract-zip via puppeteer-core); tightening needs breaking puppeteer-core@25 bump |
| Live streaming | **4.5** | WS bridge validated against live gateway; SSE fan-out; live console confirmed tool frames + redaction; session replay rides it | Multi-tab/multi-view load behavior untested at scale; single-operator reality means low concurrent-client risk |
| Cost governance | **3** | Schema 022 + budgets enforced at dispatch (fail-open probe, dispatcher backstop), breach latching + SSE + MC bars; honest-zero backfill documented | Backfill matched 0 — history starts ~now; slice 4 management window missing (budgets not editable from UI); probe fails OPEN by design |
| MCP exposure | **4** | 13 tools, hidden-not-refused mutation gating, receipts via same governed path as UI, protocol conformance + spawnSync tests | Never validated against live DB (finding 2); stdio-only — no HTTP/SSE transport; consumer adoption unproven |
| UX breadth / polish | **4** | 35 apps, one-click gated actions w/ receipts, NL command bar w/ interpretation cards, replay stepper, memory timeline, themes, PWA | Flagship NL utterance ("spawn agent for X") honestly refuses — task.create not a kind yet; actions slice 3 surfacing open; 27-image screenshot grid predates the new shell features |
| Performance | **2.5** | Lazy loading verified predating pass; two largest lists virtualized; boot module count static at 20 | Zero measurements — docs explicitly say "no synthetic benchmarks"; "faster" is unproven, only "structured for speed" |
| Engineering hygiene | **4.5** | 57/57 DB-free suite, drift gate 0 errors, sequential migrations, briefs-before-builds discipline held, honest degradation contracts everywhere | Full legacy `npm test` still carries CI-excluded remainder; e2e is chromium-only smoke |

**Weighted verdict: ~3.8/5.** Genuinely transformed platform — the delta from
v1.0.0-rc.4 (last push July 6) is real and evidenced. "10x" holds as marketing
for breadth (features × integration depth × safety machinery all multiplied),
not as a measured claim on any single axis. Perf is the weakest dimension and
the only one where the claim outruns the evidence entirely.

## 3. Debt Register — Ranked

1. **D1 — Workflow status/steps schema rot** (`workflow_runs`/`workflow_steps`):
   observed `timed_out` status violates migration 021's own CHECK constraint;
   14/29 active templates store steps as plain strings (no display_name/required
   metadata). Live data already breaks its schema; any strict driver, future
   status migration, or editor Stage 2 hits this first. *Fix shape:* normalization
   migration (widen CHECK or map legacy statuses; string→object step lift).
   Blocks: visual editor GO path, honest status monitoring, MCP run tooling.
2. **D2 — Shared-tree attribution tangles.** Concurrent agent lanes commit to
   one `main`; the MCP suite registration line landed inside qa-auditor's
   unrelated 053adfa memory-browser commit. Provenance and revertability decay
   as lane count grows; blame-based archaeology already misleads. *Fix shape:*
   agent trailer convention (`Assisted-by: <agent>`), or lane-scoped branches
   with fast-forward merges when lanes touch shared files
   (`scripts/ci-db-free-tests.js`, app-registry).
3. **D3 — Redact deny-regex snake_case gap.** `DENY_RE` in
   `lib/snapshot-redact.js` uses `\b`, which never fires after underscores —
   `db_password`-style keys are caught only by layer 1 structural exclusion.
   Documented spec-as-written, but any future flat-map/provenance-less source
   reintroduces plaintext-secret exposure with no second net. *Fix shape:*
   widen regex to `(^|[^a-z])(password|...)[-_]?` class or add lookbehind
   variant; re-run keyboard/monkey survivor fixtures.
4. **D4 — snapshot.create receipt drops structured failure body.** The executor
   attaches `err.snapshotBody` (`{available:false,…}` / `{error:…}`) but the
   catch handler in `routes/action-routes.js` special-cases only
   `err.runCreatedId` — failed snapshot receipts record the generic
   "snapshot capture failed (503)" and lose the reason. Audit-fidelity bug,
   ~3-line fix. Related-by-design: snapshot.create always records
   `audit_skipped` (no task identity) — acceptable, but worth a receipt field
   if receipts ever gain per-actor attribution (one-click brief Q3).
5. **D5 — No performance measurements.** Perf item shipped structure (caps,
   lazy loading) with explicit "no synthetic benchmarks" note. Nothing falsifies
   regressions; the 10x table above scores perf 2.5 partly for this. *Fix shape:*
   small scripted Playwright timing harness (boot-to-interactive, 1k-row board
   scroll) run manually per release — not CI-blocking.

## 4. Next-Chapter Candidates — Top 5 (impact × effort)

Scored 1–5; leverage = impact ÷ effort.

| # | Candidate | Impact | Effort | Why now |
|---|---|---|---|---|
| 1 | **Workflow data normalization migration** (D1: status CHECK repair + string→object steps lift) | 5 | 2 | Highest leverage in the repo: unblocks editor Stage 2, fixes live constraint violations, makes run-status monitoring/MCP tooling honest. Pure backend, zero UI risk. |
| 2 | **NL command bar closes flagship gap** — task.create joins action registry (kind + governance rule + executor + refusal removal) | 4 | 2 | Turns the demo into the advertised product; reuses proven gating/receipt machinery unchanged; small surface (registry entry + executor over existing store.createTask). |
| 3 | **Budget management window (slice 4)** — create/edit budgets UI over shipped API | 4 | 3 | Completes cost-governance loop; currently budgets exist but are unmanageable from the dashboard. §6 fast-follow go/no-go already scheduled this. |
| 4 | **Security tightening run** — ws ≥8.20.2 bump + puppeteer-core@25 major + raise npm-audit gate to high | 4 | 2 | Closes 5 open HIGH advisories; breaking bump is cheaper before more code lands on puppeteer APIs; converts the security score's main asterisk. |
| 5 | **One-click actions slice 3 surfacing** — action-update SSE emission, workflows-view budget strip, MC budget-events line | 3 | 1 | Cheap completion of an explicitly-open slice; tray stops polling-only; low collision risk. |

Watchlist (not top-5): visual editor GO/NO-GO decision 2026-09-14 (dated
decision, not a build item); MCP live-DB validation run (fold into candidate 2's
validation); per-actor receipt attribution (blocked on multi-operator auth);
scheduled auto-snapshots (v1 non-goal, revisit on operator pain).

## 5. Operational Recommendations

**Release cadence.**
- 1.1.0 → 2.0.0 in 48h was correct for sprint endgame, but do NOT normalize
  major-per-phase: next release should be **2.1 minor after candidates 1–2
  land**, cut on content not calendar. Keep the current discipline: tag +
  release-notes commit immediately after the version commit (held for 2.0.0).
- Keep `[Unreleased]` folding at each cut — it is empty now; review #2's
  ~20-entry backlog lesson is retired.
- Cosmetic: CHANGELOG historical sections are out of chronological order
  (2.0.0-rc.4 dated 2026-03-23 sits below 2026-08 entries). Fix opportunistically.

**Staging monitoring.**
- Staging :8120 runs json_snapshot mode — every DB-dependent feature is
  staging-validated only in its degraded path (see finding 2). Add ONE
  live-DB smoke environment (even ephemeral docker-postgres on the dev box)
  before 2.1's mutation features ship, or accept that receipt pipelines are
  never pre-proven.
- The per-minute keepalive cron proves liveness but nothing else. Add a daily
  staged health digest (health endpoint + DB-free suite result + drift-check
  exit) to the existing cron output rather than building new infra.
- **GO/NO-GO telemetry needs a counter, not a memory.** The 21-day rule
  (≥8 render-days AND ≥3 asks by ~2026-09-14) is decided by audit_log rows
  nobody will count by hand. Small daily script: query
  `workflow-graph-open`/`workflow-graph-feedback` counts, log the running
  tally beside the keepalive. Decision then reads off numbers, not vibes.

## 6. Actions Taken in This Commit

1. This review document.
2. `UPGRADE_ROADMAP.md`: new bottom section **"Post-2.0 Candidates (2.1
   planning)"** — top-3 from §4 as `[candidate]`-marked unchecked items
   (normalization migration, NL task.create, budget slice 4); visual-editor
   annotation corrected so the pending GO/NO-GO decision is visible despite
   the shipped tick (audit finding 1).
3. `docs/index.md` regenerated for the new brief.

Review only — no `.js/.mjs/.sql/.yml` feature changes. At audit time:
DB-free suite 57/57, docs-drift-check exit 0 (0 errors, 10 baseline warnings).
