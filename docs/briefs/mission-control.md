# Design Brief — Mission Control View

**Status:** Approved for build planning · **Roadmap:** UPGRADE_ROADMAP.md Phase 1, item 1
**Evidence base:** market-scan-2026-08-23.md (top steal #1: run-anomaly flags), migration `022_add_run_token_cost_tracking.sql`
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit.

---

## 1. Purpose & Value Proposition

The operator opens **one window** and knows the system state in under five seconds:

> **Is anything broken, blocked, or burning money?**

Mission Control is a **read-only command-center aggregation** of the signals already
exposed by the platform: fleet status, blocked/stale workflow runs, cron health,
cost burn, and derived anomaly flags. Every competitor scanned ships this as a
generic web console page-scroll; ours lands as a native desktop window in the
Operations category, next to Health and Diagnostics.

It watches the hourly automation itself — cheap to build, huge daily value, and it
ships on plain HTTP polling (websocket bridge is a separate Phase 1 item that lands
behind it, not before it).

---

## 2. Panel Layout Sketch

Window: `mission-control`, default size **1180×780**, Operations category.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  🛰 Mission Control                              ● polled 30s   [↻ Refresh] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ FLEET STATUS ────────────────┐  ┌─ ANOMALY FLAGS ────────────────────┐  │
│  │ Overall: ● healthy            │  │ ⚠ 2 active                          │  │
│  │ Gateway: ● running   DB: ● ok │  │ ┌────────────────────────────────┐  │  │
│  │ Agents: 6 total · 4 active    │  │ │ STALE RUN  publish-daily (23m) │  │  │
│  │  ▇▇▇▇▇░░  idle:1 offline:1    │  │ ├────────────────────────────────┤  │  │
│  │ Queue: 3 pending              │  │ │ CRASH-LOOP  seo-audit (2x)     │  │  │
│  │                               │  │ └────────────────────────────────┘  │  │
│  └───────────────────────────────┘  └────────────────────────────────────┘  │
│                                                                              │
│  ┌─ BLOCKED / STALE RUNS ────────┐  ┌─ COST ─────────────────────────────┐  │
│  │ Running: 2   Blocked: 1       │  │ Today:      $4.12  (▲ spike 2.3x)  │  │
│  │ Failed 24h: 1                 │  │ 7-day total: $61.80                │  │
│  │ • publish-daily  running 23m⚠ │  │ 7-day avg/day: $8.83               │  │
│  │ • fix-auth       blocked      │  │ Top run: crawl-site $1.90          │  │
│  └───────────────────────────────┘  └────────────────────────────────────┘  │
│                                                                              │
│  ┌─ CRON HEALTH ─────────────────────────┐  ┌─ QUICK LINKS ──────────────┐  │
│  │ Jobs: 12 enabled · 0 failing          │  │ Health · Diagnostics       │  │
│  │ Next: hourly-ingest in 14m            │  │ Cron · Workflows           │  │
│  │ ⚠ seo-audit: failed 2x consecutive    │  │ Agents · Sessions          │  │
│  │ stale: 0   silenced: 0                │  │ Approvals · Audit          │  │
│  └───────────────────────────────────────┘  └────────────────────────────┘  │
│                                                                              │
│  Last full sweep 23:47:12 · all panels degrade independently                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

Layout rule: CSS grid, two columns top row (Fleet | Anomalies), two columns middle
(Blocked/Stale | Cost), bottom row (Cron spans wide | Quick Links narrow). Each
panel is an independent module with its own load/render/error path — one panel's
failure never blanks the window.

---

## 3. Data Contracts Per Panel

All calls go through `fetch` with the existing bearer-token header pattern
(`globalThis.__DASHBOARD_AUTH_TOKEN__`), matching `health-view.mjs` /
`diagnostics-view.mjs`. No new auth surface.

### Panel A — Fleet Status
| Field | Value |
|---|---|
| Endpoints (existing) | `GET /api/health-status` (overall, database, gateway, checks); `GET /api/openclaw/agents` (CLI-backed agent list, DB-free); `GET /api/agents/status` (org statuses — **Postgres only**); queue depth from `GET /api/tasks?status=queued` (**Postgres only**) |
| Poll interval | 30 s |
| No-DB behavior | `/api/agents/status` and `/api/tasks` return 503 → show gateway-side agent list only; DB-derived counters render `—`. `/api/health-status` itself always answers (reports `degraded`) |
| Notes | Active/idle classification mirrors agents-view dot logic (active/recent/offline) |

### Panel B — Blocked & Stale Runs
| Field | Value |
|---|---|
| Endpoints (existing) | `GET /api/workflow-runs?status=running&limit=50`; `GET /api/workflow-runs/stuck` (blocker list); `GET /api/blockers/summary` (counts); `GET /api/workflow-runs?status=failed&limit=10` for 24 h failures |
| Poll interval | 20 s (aligned with `realtime-sync.mjs` `SYNC_INTERVAL_MS = 20000`) |
| No-DB behavior | All four are Postgres-backed → panel shows explicit "Runs unavailable — no database" empty state; window stays alive |
| Notes | Staleness computed client-side from run `updated_at`/heartbeat age (see §4 flag 1). Rows link out to Workflows view |

### Panel C — Cron Health
| Field | Value |
|---|---|
| Endpoints (existing) | `GET /api/cron/jobs` (openclaw CLI-backed — **DB-free**: id, name, schedule, enabled, status=lastRunStatus, lastRun, nextRun); `GET /api/diagnostics/summary` (file-based job health: healthy/failing/stale/persistent/silenced — **DB-free**); `GET /api/diagnostics/failures` for failing-job detail incl. classification |
| Poll interval | 60 s |
| No-DB behavior | Fully functional without Postgres — this panel is the CI smoke anchor |
| Notes | Consecutive-failure counting for crash-loop flag uses `GET /api/cron/jobs/:id/runs` only for jobs already flagged failed (lazy detail fetch, max 3 lookups per sweep) |

### Panel D — Cost Today / 7d
| Field | Value |
|---|---|
| Endpoint (needs-new, small) | `GET /api/costs/summary?days=7` → `{ today: {cost, tokens}, days: [{date, cost, tokens}], avg_daily_7d }` — single SQL aggregate over `workflow_runs.cost_estimate / input_tokens / output_tokens` (columns shipped in migration 022; read helper pattern exists in `storage/asana.js getWorkflowRunUsage`). Suggested home: new `routes/cost-routes.js` registered in `routes/router.js` |
| Fallback (v1, no new endpoint yet) | Client-side aggregate over `GET /api/workflow-runs?limit=200` — `listRuns` selects `wr.*`, so cost/token columns ride along on every run row |
| Poll interval | 120 s |
| No-DB behavior | Postgres-only → "Cost unavailable — no database"; never blocks other panels |
| Notes | Display-only. Currency from `currency` column (default USD). Spike badge driven by §4 flag 4 |

### Panel E — Anomaly Flags
| Field | Value |
|---|---|
| Endpoints | None of its own — pure client-side derivation from Panels A–D payloads |
| Poll cadence | Recomputed on every runs poll (20 s) |
| No-DB behavior | Flags whose inputs are missing are skipped silently; panel shows "No anomalies detectable (inputs unavailable)" only when ALL inputs are down |
| Notes | Pure function `computeAnomalies({fleet, runs, cron, cost}) → Flag[]` exported for unit testing; max 5 flag types (§4) |

### Panel F — Quick Links
| Field | Value |
|---|---|
| Endpoints | None |
| Behavior | Static grid of buttons navigating via the shell's existing view-open mechanism (`/?view=<id>` / adapter navigation used by other views). Targets: Health, Diagnostics, Cron, Workflows, Agents, Sessions, Approvals, Audit |
| No-DB behavior | Always available |

---

## 4. Anomaly Flags — v1 Definition (max 5)

Pure client-side heuristics over polled data. Each flag: `{type, severity, subject, detail, since}`.

| # | Flag | Trigger (exact) | Inputs | Severity |
|---|---|---|---|---|
| 1 | **Stale run** | Run `status='running'` whose last heartbeat/`updated_at` is older than **15 min** (configurable const `STALE_RUN_MINUTES = 15`) | Panel B runs payload | warn |
| 2 | **Zero-token loop** | Run `status='running'` for **> 10 min** with `reported_at IS NULL` or `input_tokens + output_tokens = 0` — catches AgentOps-style recursive loops that consume wall-clock but report no usage | Panel B runs payload (cost columns from migration 022) | warn |
| 3 | **Crash-looping cron** | Cron job with `status='failed'` on **≥ 2 consecutive** runs (per `/api/cron/jobs/:id/runs`), OR a diagnostics job whose failure classification is `crash`/`pipeline_failed` recurring within one schedule interval | Panel C | error |
| 4 | **Cost burn spike** | Today's cumulative `cost_estimate` > **2×** the mean daily cost of the trailing 7 days (today excluded); requires ≥ 3 days of history | Panel D | error |
| 5 | **Idle agent, non-empty queue** | Agent in `idle`/`offline` state while ≥ 1 task assigned to them sits in `queued`/`pending` | Panel A (org statuses + task query) | warn |

Out of scope for v1 (deliberately): repeated identical tool-call detection (needs
session transcript access — session replay inspector territory), trust scoring,
secret detection (security pass territory).

---

## 5. File Plan

| File | Change |
|---|---|
| `src/shell/native-views/mission-control-view.mjs` | **NEW** — exports `renderMissionControlView({ mountNode, api, sync })`, resolves via the standard `render[A-Z]*` adapter lookup; follows house style: `ensureNativeRoot`, injected scoped `<style>`, `createStatCard`/`escapeHtml` from `helpers.mjs`, teardown function clearing all poll timers |
| `src/shell/app-registry.mjs` | Add entry: `id: 'mission-control'`, label `Mission Control`, icon `appIcon.eye` (or new satellite glyph), `url: '/?view=mission-control'`, `viewModule: './native-views/mission-control-view.mjs'`, `category: 'Operations'`, `defaultWidth: 1180`, `defaultHeight: 780` |
| `routes/cost-routes.js` + `routes/router.js` | **NEW (small)** — `GET /api/costs/summary` aggregate; can ship after the view (view has client-side fallback) |
| `README.md` | Windowed-app count 31 → 32 (docs-drift-check enforces exact match) |
| `docs/views-reference.md` | Count update + Operations section entry for Mission Control (drift check requires every registry id documented) |
| `docs/api-reference-complete.md` | Document `GET /api/costs/summary` when the route lands |
| `docs/user-guide.md` | Optional short Mission Control subsection |
| `CHANGELOG.md` | Entry under `## Unreleased` → `### Added` in the same commit as the build |

Docs constraint honored by this brief itself: **zero source files touched until the
build order is placed.**

---

## 6. Acceptance Criteria

Testable by qa-auditor. DB-free tests run in CI's `STORAGE_TYPE=json_snapshot` mode.

1. **AC1 Registration** — Start menu shows "Mission Control" under Operations;
   clicking opens an 1180×780 window rendering all six panels.
2. **AC2 Read-only guarantee** — With fetch spied, opening and letting the view run
   three poll cycles emits **zero** non-GET requests. (Hard gate: any POST/PUT/PATCH/
   DELETE fails the test.)
3. **AC3 Graceful no-DB degradation** — In json_snapshot mode (runs/costs/org-agent
   endpoints 503): Panels B/D show their named unavailable states, Fleet shows
   gateway-side data only, Cron panel remains fully populated, **no uncaught JS
   errors**, remaining panels keep polling.
4. **AC4 Independent panel failure** — Stubbing any single endpoint with a rejected
   promise blanks only its own panel; all others still render (one rejection ≠ blank
   window).
5. **AC5 Anomaly engine** — `computeAnomalies()` is exported and passes table-driven
   unit fixtures: one deterministic fixture per flag type (stale-run timestamps,
   zero-token run, double-failed cron, 2.3× cost day, idle-agent-with-queue) plus
   negative fixtures producing zero flags. Max 5 flag types enumerable.
6. **AC6 Poll hygiene** — Poll intervals match contract (20/30/60/120 s ±10%);
   closing the window clears every timer (teardown asserted — no post-close fetches).
7. **AC7 Quick links** — Each quick-link button opens its target view via the shell
   navigation path (spy asserts correct `/?view=` target).
8. **AC8 Docs drift** — After the build commit, `node scripts/docs-drift-check.js`
   exits 0 (registry count, views-reference coverage, API doc for the new route).
9. **AC9 Vanilla conformance** — No frameworks, no build step, ES modules only;
   file passes `node --check`.

---

## 7. Explicit Non-Goals (v1)

- **No editing actions.** No retry, approve, disable, kill, or assign buttons —
  Mission Control looks, other windows act. One-click actions are a separate
  Phase 1 item.
- **No websocket dependency.** Plain HTTP polling only; WS bridge lands later
  behind a flag with this view as a consumer, not a prerequisite.
- **No session replay / tool-call inspection.** Separate Phase 1 item; flag 2 stops
  at the zero-token heuristic.
- **No historical charts.** Today/7d numbers only; sparklines come with Phase 2
  cost analytics.
- **No budget ledger / auto-pause.** Phase 2 (FleetQ-pattern guardrail).
- **No layout customization or persistence.** Fixed grid v1.
- **No multi-user/RBAC surface.** Single-operator reality, per market scan.
- **No new auth.** Reuses the existing bearer-token header convention.

---

## 8. Risks & Open Questions

- **R1 — CLI-backed endpoints have no SLA.** `/api/cron/jobs` shells out to the
  openclaw CLI; a slow CLI stalls the cron panel. Mitigation: per-panel fetch
  timeout (5 s) and last-good-data caching in the view.
- **R2 — Cost data sparsity.** Migration 022 shipped 2026-08-23; 7-day averages are
  meaningless until history accumulates. Flag 4 requires ≥ 3 days history — expect
  it silent in week one. TODO-verify: confirm gateway actually populates
  `cost_estimate` on real runs before trusting the spike flag.
- **R3 — Heartbeat field naming.** Stale-run detection depends on the actual
  freshness column on `workflow_runs` (`updated_at` vs dedicated heartbeat
  timestamp). Builder must confirm against schema before implementing flag 1.
  TODO-verify.
- **Q1 — Should Mission Control become the start-menu pinned default for operators
  (add to `PINNED_APP_IDS`)?** CEO call at build review.
- **Q2 — Queue-depth source for flag 5:** `/api/tasks` filter vs a future
  queue-summary endpoint. Client-side filter is fine for v1; revisit if task counts
  grow past a few hundred.
