---
layout: default
---

# Design Brief — Budget Ledger + Auto-Pause Guardrail

**Status:** Implemented — slices 1–3 shipped 2026-08-24 (0a1ed9b model+API, 420758b dispatcher enforcement, d276068 surfacing: SSE breach frames, MC budget bars + budget_breach flag, notification-center entries); slice 4 management window shipped 2026-08-25 (`budgets` app, Operations — create/edit/deactivate + ledger drawer over the shipped API); slice 5 channel alerts shipped 2026-08-25 (`lib/budget-channel-notifier.js` — latched breach events page the operator on WhatsApp/Zulip over the existing gateway WS `send` RPC, env-gated default OFF, see docs/briefs/budget-channel-alerts.md) · **Roadmap:** Phase 1 (pulled forward from Phase 2 per market-scan-2026-08-24.md — Paperclip, 79k★, made per-agent budgets with hard-stop enforcement table stakes; scan scores Impact 9 / Effort 3)
**Evidence base:** market-scan-2026-08-24.md recommendation section; migration `022_add_run_token_cost_tracking.sql` (cost/token columns shipped + accumulating, 88abe97); `routes/cost-routes.js` degradation contract; existing pause/resume/cancel machinery (`workflow-runs-api.js`, `/pause`, `/resume`, `/cancel`); dispatcher v2 tick loop (`gateway-workflow-dispatcher-v2.js`); Mission Control anomaly flags incl. `cost_spike` (`mission-control-view.mjs`); departments + agent_profiles org model (migrations 006/007)
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit. CHANGELOG entry lands with the build commit per house pattern.

---

## 1. Purpose & Value Proposition

Today the operator has **visibility** into spend (Mission Control cost panel, `GET /api/costs/summary`) but **no control**: a runaway agent loop burns budget until a human notices the `cost_spike` flag and manually cancels runs. Paperclip ships "per-agent monthly budgets — when they hit the limit, they stop" as default behavior at 79k★ scale. Expectation has moved; this closes the gap with machinery we already own.

Budget Ledger + Auto-Pause = **named spending rules with automatic enforcement**:

1. Operator defines a **Budget**: scope (agent / department / project / fleet) × period (daily / weekly / monthly) × cap (USD or tokens) × breach action (warn / pause new runs / hard stop).
2. A **ledger** of spend accrual is derived from the migration-022 columns already accumulating on `workflow_runs` — zero new metering instrumentation.
3. The dispatcher checks budgets at dispatch time. On breach: warn (notify only), pause_new_runs (queue holds), or hard_stop (in-flight runs cancelled).
4. Breaches surface through existing surfaces: Mission Control anomaly flags, notification center, run error text.

Everything required exists: cost data accumulates (Phase 0 shipped), approvals/pause/cancel machinery shipped, Mission Control has a cost panel and a flags panel to carry breach state. This brief designs the missing ~30%: the rule model, the enforcement points, and the race-safe recovery semantics.

---

## 2. Concept Model

### 2.1 Budget — a named rule

```
budget {
  id             UUID PK
  name           TEXT NOT NULL                    -- "affiliate-editorial monthly cap"
  scope_type     TEXT CHECK IN ('agent','department','project','fleet')
  scope_id       TEXT NULL                        -- NULL only for fleet
  period_type    TEXT CHECK IN ('daily','weekly','monthly')
  cap_usd        NUMERIC(12,2) NULL               -- XOR with cap_tokens
  cap_tokens     BIGINT NULL                      -- input+output tokens
  action_on_exceed TEXT CHECK IN ('warn','pause_new_runs','hard_stop')
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
  created_by     TEXT NOT NULL DEFAULT 'dashboard-operator'
  created_at / updated_at TIMESTAMPTZ
  metadata       JSONB DEFAULT '{}'
}
```

- **Scope resolution** (how a `workflow_runs` row maps to a budget):
  - `agent` → `workflow_runs.owner_agent_id = scope_id`
  - `department` → `owner_agent_id IN (SELECT agent_id FROM agent_profiles WHERE department_id = :dept)` — reuses the migration-006/007 org model
  - `project` → `workflow_runs.workflow_type = scope_id` for v1. There is no projects table on `workflow_runs`; workflow_type is the closest real grouping. TODO-verify before build: whether the spaces/workspaces model should back this scope instead.
  - `fleet` → all rows (scope_id NULL)
- **Cap is XOR**: exactly one of `cap_usd` / `cap_tokens` non-null (CHECK constraint). An operator wanting both creates two budgets. One row, one trigger condition, no precedence puzzles.
- **Token cap semantics**: `input_tokens + output_tokens`. `cached_tokens` is a subset of input (migration-022 comment) and is never added on top.
- **One active budget per (scope_type, scope_id, period_type)**: enforced by a partial unique index `WHERE is_active`. Overlapping scopes across *different* rows (e.g., an agent budget inside a breached department budget) are allowed; enforcement takes the **most restrictive action** among all breached budgets covering a candidate run (hard_stop > pause_new_runs > warn).

### 2.2 Periods — calendar-fixed, derived keys

| Period | Key | Window |
|---|---|---|
| daily | `YYYY-MM-DD` | server-local day, `date_trunc('day', NOW())` |
| weekly | `IYYY-"W"IW` | ISO week, `date_trunc('week', NOW())` |
| monthly | `YYYY-MM` | calendar month, `date_trunc('month', NOW())` |

Server-local bucketing deliberately matches `cost-routes.js` (its "today" is `date_trunc('day', NOW())` with a client-side local fallback) so the cost panel and budget math can never disagree about what day it is. Timezone caveat logged as R3.

### 2.3 Ledger — derived spend + append-only enforcement events

Two distinct things, kept separate on purpose:

1. **Spend accrual is DERIVED, never stored twice.** Spend for `(budget, period_key)` is a single aggregate over `workflow_runs`:

```sql
SELECT COALESCE(SUM(cost_estimate), 0)::float8 AS spend_usd,
       COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0)::bigint AS spend_tokens,
       COUNT(*)::int AS run_count
FROM workflow_runs
WHERE <scope predicate>
  AND COALESCE(reported_at, started_at, created_at)
      >= date_trunc('<period>', NOW())
```

   Same `COALESCE(reported_at, started_at, created_at)` bucketing rule as the cost summary, so unreported runs still land. No metering pipeline, no double-count risk, no backfill of the ledger itself. This is the "no new metering needed" property from the scan recommendation.
2. **Enforcement events are append-only rows** in a small `budget_events` table — the audit trail operators actually replay ("what did the system do and when"):

```
budget_event {
  id          UUID PK
  budget_id   UUID REFERENCES budgets(id)
  period_key  TEXT NOT NULL              -- e.g. '2026-08' — which period breached
  event_kind  TEXT CHECK IN ('warned','paused_new_runs','hard_stop',
                             'period_reset','budget_modified')
  detail      JSONB                      -- spend at breach, affected run ids, actor
  created_at  TIMESTAMPTZ DEFAULT NOW()
  UNIQUE (budget_id, period_key, event_kind)   -- idempotency latch
}
```

   The unique key makes every emission `ON CONFLICT DO NOTHING` idempotent: the dispatcher ticks every 30 s and must not spam notifications or re-cancel. `period_reset` rows are written lazily on first evaluation of a new period after a breach, giving an unbroken audit chain across rollovers without a cron job.

### 2.4 Pause state is DERIVED — the core race-safety decision

There is **no `is_paused` flag on budgets and no stored fleet-wide pause switch**. "Paused" is a pure function: `breached(budget, now) = spend(budget, current_period) >= cap && is_active`.

Why this kills the classic un-pause race: operator lifts a pause mid-period while spend is still ≥ cap → next dispatch evaluation recomputes spend from the ledger, still ≥ cap, dispatch stays blocked. There is no toggle to fight with, no stale cached state, no second writer. Recovery from a breach is one of exactly three deliberate acts:

1. **Wait for period rollover** — new empty window drops spend below cap automatically; evaluation self-heals with zero operator action (Paperclip's monthly-reset semantic).
2. **Raise the cap** (`PATCH /api/budgets/:id`) — effective immediately on next evaluation.
3. **Deactivate the budget** (`PATCH` `is_active:false`) — removes the rule entirely; recorded as a `budget_modified` event so the audit trail shows who disabled the guardrail.

Because evaluation happens at dispatch time against live aggregates, there is no un-pause endpoint to race, and no path where a paused fleet stays paused after the condition clears (bounded by one poll interval, see §3.4).

---

## 3. Enforcement Points (design, not build)

### 3.1 Primary gate — dispatcher tick, pre-markDispatched

`gateway-workflow-dispatcher-v2.js` → `dispatchQueuedRuns()`: candidates come back from `SQL.dispatchCandidates`; today each is immediately `markDispatched`-ed. The budget check slots between the two, per candidate:

```
for (const candidate of result.rows) {
  const verdict = await evaluateBudgets(pool, candidate.owner_agent_id /* routed */,
                                        candidate.workflow_type);   // §3.4
  if (verdict.action === 'pause_new_runs' || verdict.action === 'hard_stop') {
    skip candidate (row stays 'queued'); record event once per period; notify once;
    continue;
  }
  if (verdict.action === 'warn') { proceed; ensure warned-event emitted; }
  ...existing markDispatched + wakeAgent...
}
```

The same check wraps the retry path (`retryStaleDispatchedRuns()` → `refreshDispatched`): a stale-dispatch retry is a fresh dispatch attempt and must not tunnel past a breached budget.

The dispatcher's tick loop is a single sequential `setInterval` worker (`tick()` awaits each phase) — it is the natural serialization point. No intra-loop concurrency means no lock ordering problems; the only cross-writer concern is handled in §3.5.

### 3.2 Action semantics

| Action | Queued runs | Dispatched/claimed/running runs | Notification |
|---|---|---|---|
| `warn` | dispatch normally | untouched | once per period |
| `pause_new_runs` | held in `queued` (not failed — queue drains in order when window resets) | **run to completion** — their cost is already committed; killing them wastes paid work without capping anything | once per period |
| `hard_stop` | held in `queued` | **cancelled at detection time** (§3.3) | once per period |

`pause_new_runs` vs `hard_stop` differ exactly in the in-flight column — that distinction is the whole point of having both, and matches Paperclip's "hit limit → stop" plus FleetQ's softer ledger-pause patterns.

### 3.3 Hard stop on in-flight runs

Reuse the existing cancel transition rather than inventing one. On detecting a `hard_stop` breach during a tick, the dispatcher issues a status-guarded bulk cancel for runs covered by the budget scope:

```sql
UPDATE workflow_runs
SET status='cancelled', finished_at=NOW(),
    last_error=$reason, last_error_at=NOW(), gateway_session_active=FALSE,
    updated_at=NOW()
WHERE <scope predicate> AND status IN ('dispatched','claimed','running')
RETURNING id
```

Properties:
- Status-guarded `WHERE ... RETURNING` is idempotent — re-ticks find nothing to cancel, no double-cancel, no racing a completion that already landed.
- After cancellation, in-flight `claim`/`heartbeat`/`complete` calls fail naturally with the existing 409 paths (`GatewayWorkflowDispatcherV2.handleHttpRequest` already answers 409 when the run is no longer claimable/completable). No new rejection code needed at the HTTP layer.
- `last_error` carries `"Budget hard stop: <budget name> (<period_key>)"` — visible in every existing run-detail/error surface, so a cancelled run is never mistaken for a crash.
- Affected run ids land in the `budget_events.detail` JSONB for the audit trail.

### 3.4 Evaluation cost & bounded staleness

- Evaluation runs **once per tick, only when candidates exist**, as one batched query evaluating all active budgets (spend aggregates joined against the candidate's scope memberships), not one query per candidate.
- Result cached in-memory with TTL = one `pollIntervalMs` (30 s default). Worst-case staleness: spend crosses cap up to 30 s after evaluation → enforced on the next tick. For a guardrail measured in dollars-per-period, 30 s lag is acceptable and is called out in the AC set rather than hidden.
- In-flight spend is invisible by design (usage reports land at completion via `reported_at`; see Non-goals). Hard stop therefore reacts to *reported* spend crossing the cap, not projected spend. Documented consequence: one wave of in-flight runs can complete above the cap before hard_stop fires. Mitigation considered and rejected for v1: projecting in-flight accrual from heartbeats (requires per-run token streaming — explicit non-goal).

### 3.5 Race safety inventory

| Race | Defense |
|---|---|
| Operator "un-pauses" while breach still true | No un-pause exists; state derived per §2.4 |
| Two dispatcher instances / tick overlap | Single interval loop; `dispatchCandidates` already uses `FOR UPDATE SKIP LOCKED` so two ticks never grab the same row; budget eval sits inside the locked window |
| Duplicate notifications/events on re-ticks | `UNIQUE (budget_id, period_key, event_kind)` + `ON CONFLICT DO NOTHING` |
| Concurrent budget creation duplicates | Partial unique index on active (scope_type, scope_id, period_type) |
| Cap raised while hard_stop cancel batch in flight | Cancel batch is status-guarded; newly dispatched runs were evaluated under the raised cap; worst case one extra cancelled run, never a stuck state |
| Budget eval vs concurrent run completion moving spend | Aggregate read is a snapshot; staleness bounded by one tick (§3.4) |

### 3.6 API surface

All under existing bearer-token middleware. Degradation contract copies `cost-routes.js` verbatim: without PostgreSQL answer `200 {available:false, reason:'no_database'}` — never an error page.

| Endpoint | Purpose |
|---|---|
| `GET /api/budgets` | List budgets with computed `current_spend`, `period_key`, derived `status` (`under`\|`warned`\|`breached`), `action_on_exceed` |
| `POST /api/budgets` | Create; validates scope/period enums, cap XOR, fleet ⇒ scope_id NULL |
| `GET /api/budgets/:id` | Detail + last N `budget_events` |
| `PATCH /api/budgets/:id` | Raise/lower cap, rename, `is_active` toggle (the only sanctioned "un-pause" moves, §2.4); writes `budget_modified` event |
| `GET /api/budgets/:id/ledger?limit=&after=` | Append-only event list, cursor-paginated (house `afterLine`-style cursor convention) |

No DELETE in v1 — `is_active:false` preserves the audit trail. Route module follows the `routes/cost-routes.js` shape (`registerBudgetRoutes(router)`, pool via `ctx.asanaStorage.pool`).

### 3.7 Surfacing (all existing surfaces, additive)

- **Mission Control cost panel**: budget rows under the today/7d block — name, spend/cap bar, color state (green/amber/red), action badge. Reuses panel polling; no new window, no app-registry churn (keeps docs-drift-check app count untouched).
- **Anomaly flags**: sixth flag type `budget_breach` (severity `error`, subject = budget name, detail = spend/cap/action). `ANOMALY_FLAG_TYPES` is currently frozen at five "by construction"; this is a deliberate extension in the build commit with boundary fixtures alongside the existing threshold constants.
- **Notification center**: server emits `budget:breach` on the existing SSE fan-out (same channel family as `task:blocked` / `approval:pending`); `NotificationCenter.pushSSE` typeMap gains one entry. Once per period via the event-latch — SSE emission happens only when the `budget_events` insert actually inserted.
- **Run views**: hard-stopped runs show the budget reason via existing `last_error` rendering; nothing new to build.

---

## 4. Data Contract Summary

New objects (build phase): `schema/migrations/023_add_budget_ledger.sql` creating `budgets` + `budget_events` (naming: singular-purpose migrations, `IF NOT EXISTS` throughout, `schema_migrations` bookkeeping row — house style per 003/006/007).

Sources of truth per field:

| Field | Source | Freshness |
|---|---|---|
| Spend USD/tokens | `workflow_runs.cost_estimate`, `input_tokens`, `output_tokens` (migration 022) | On usage report (`reported_at`); accumulates continuously since 88abe97 |
| Scope membership | `workflow_runs.owner_agent_id`, `workflow_type`; `agent_profiles.department_id` (007) | Static config + run creation |
| Budget rules | `budgets` table (new) | Operator CRUD |
| Enforcement audit | `budget_events` (new) | Append-only, written by dispatcher/API only |

Dependency gate: the roadmap's open Phase 0 item **"Cost/token history backfill"** must land before Slice 2 (enforcement) — budgets over sparse history under-count spend and would silently under-enforce. Slice 1 (model + API) is not blocked.

---

## 5. UX Flows

1. **Define**: operator opens Mission Control → cost panel → "Budgets" affordance (v1: settings-route driven; full management window is a fast-follow, §7 slice 4) → names rule, picks scope → period → cap → action. Validation errors inline (enum/XOR/scope-id-required).
2. **Normal operation**: cost panel shows green bars. Nothing else changes; zero overhead when no budgets defined (feature is inert until first POST).
3. **Warn**: amber bar + one notification-center entry. Runs unaffected.
4. **Pause_new_runs breach**: red bar, `budget_breach` flag appears in the anomalies panel, queued runs visibly accumulate in the blocked/stale panel with dispatcher stats showing held dispatches. Queue drains automatically at rollover — the empty-window reset is stated in the UI copy so operators don't hunt for an un-pause button that doesn't exist.
5. **Hard_stop breach**: as above, plus in-flight runs flip to `cancelled` with the budget reason string; top_run/cost panel reflects final numbers as reports land.
6. **Recovery**: raise cap or deactivate via PATCH (settings route v1); audit trail queryable via `/ledger`.
7. **Cross-links**: anomaly flag subject deep-links to the cost panel; run error links back to the budget detail.

Degradation matrix:

| Condition | Behavior |
|---|---|
| No PostgreSQL (json_snapshot mode) | APIs answer `{available:false}`; cost panel budget section renders the existing "no database" state; dispatcher has nothing to dispatch anyway — feature silently inert, never crashes |
| Migration not yet applied | Query failure branch → `{available:false, reason:'query_failed'}` (cost-routes precedent), UI shows budgets unavailable |
| Zero budgets defined | Cost panel omits budget section entirely; anomaly computation unchanged |
| DB dies mid-period | Derived state recomputes on reconnect; `budget_events` latch prevents duplicate notifications across the gap |

---

## 6. Build Sequence & Acceptance Criteria

Four slices, each landing tests-green. Tests are DB-free per house pattern (`tests/test-cost-routes.js`: fake pool with scripted query results, plain `assert`).

**Slice 1 — Model + API (no enforcement).**
Migration 023; `lib/budget-ledger.js` exporting pure functions `periodKey(periodType, date)`, `mostRestrictive(actions)`, `resolveScopePredicate(scope)`; `routes/budget-routes.js` GET/POST/PATCH + ledger; degradation contract.
AC1: pure-function fixtures — period keys across month/ISO-week boundaries; XOR validation rejects dual-cap and zero-cap payloads; most-restrictive ordering `hard_stop > pause_new_runs > warn`.
AC2: route tests against fake pool — create/list/patch happy paths; enum violations → 400; no-database → `200 {available:false, reason:'no_database'}`; ledger cursor pagination.
AC3: partial unique index present in migration DDL (fixture asserts index SQL text) preventing duplicate active scope+period rows.

**Slice 2 — Dispatcher enforcement.**
Hook in `dispatchQueuedRuns` + retry path; hard_stop bulk cancel; `budget_events` writes; SSE `budget:breach` emission on latch insert.
AC4: breached `pause_new_runs` leaves candidate `queued`, marks no dispatch attempt, writes exactly one `paused_new_runs` event across repeated ticks (idempotency fixture).
AC5: breached `hard_stop` cancels dispatched/claimed/running rows in scope with the reason string; completed runs untouched; second tick cancels nothing (status-guard fixture).
AC6: `warn` dispatches normally, emits exactly one `warned` event per period.
AC7: overlapping budgets (agent + department both breached) resolve to most restrictive action.
AC8: evaluation cache TTL — second dispatch within one poll interval issues no repeat aggregate query (query-count fixture).
AC9: no budgets defined → byte-identical dispatch behavior to today (regression guard).

**Slice 3 — Mission Control + notifications.**
Cost-panel budget bars; `budget_breach` flag type with named constant + justification comment + boundary fixtures; `pushSSE` typeMap entry.
AC10: panel states — green/amber/red bars track injected summary payloads; budgets-absent payload renders no section; `available:false` inherits existing panel error state.
AC11: `budget_breach` fixtures pin severity/subject/detail shape and the max-flags cap interaction (sixth type included in `MAX_ANOMALY_FLAGS` slicing).
AC12: SSE `budget:breach` maps to a notification-center entry titled from budget name; latch guarantees single entry per period.

**Slice 4 (fast-follow, separate go/no-go) — Budgets management window.**
CRUD windowed app if operator volume justifies leaving settings-routes. Touches app registry → README count + views-reference + drift-check gates apply in its own build commit. Not scheduled in v1.

Docs gates for Slices 1–3 build commits: `docs/api-reference-complete.md` entries for all five endpoints; thresholds note for the new flag constant in `docs/views-reference.md`; `CHANGELOG.md` `### Added` entries per house pattern; `node scripts/docs-drift-check.js` exit 0 (no registry change expected — assert explicitly since route coverage grows).

Success metrics (wired to the impact-measurement loop):

- **Guardrail efficacy**: count of breaches caught + estimated overrun dollars prevented (spend at breach moment vs trailing daily mean × remaining days) — reported from `budget_events`, reviewed in weekly ops retro.
- **False-positive rate**: operator cap-raises/deactivations within 24 h of a breach (proxy for wrongly-tuned caps).
- **Latency tax**: dispatch tick duration p95 before/after enablement (target: no measurable regression beyond the one aggregate query).
- **Coverage**: share of active agents falling under at least one budget (adoption metric for the rollout itself).

---

## 7. Explicit Non-Goals (v1)

- **No per-token real-time metering.** Usage lands at report/completion time; no streaming accrual, no mid-run projection. Hard stop reacts to reported spend (§3.4).
- **No multi-currency.** Budgets are USD against `cost_estimate` (column carries ISO currency but fleet reports USD; conversion out of scope). Token caps are the currency-free alternative.
- **No budget-change approval workflow.** Single-operator bearer auth; cap changes are direct PATCH actions, audited but not gated. Revisit if multi-operator auth lands.
- **No historical restatement.** Retroactive cap changes don't rewrite past periods; the ledger derives from immutable run rows.
- **No email/push delivery.** Breach notification is dashboard-native (flag + notification center + SSE) consistent with every existing alert path.
- **No new windowed app in v1** (Slice 4 deferred) — keeps app-registry count and docs-drift surface frozen.
- **No drag-drop policy editor / RBAC scoping UI** — remains a Phase 2+ analytics-UI concern per roadmap.

---

## 8. Risks & Open Questions

- **R1 — Reporting lag bounds hard-stop precision.** `cost_estimate` arrives at completion; a burst of long in-flight runs can overshoot the cap before hard_stop fires (§3.4). Accepted for v1; the overshoot magnitude is measurable from `budget_events.detail` and should be reviewed after two weeks of live data. TODO-verify actual gateway reporting cadence from the `storage/asana.js` usage helpers before freezing the staleness copy in the UI.
- **R2 — Backfill dependency.** Until the Phase 0 history backfill lands, early-period spend is under-counted and budgets under-enforce. Slice 2 gated on it (§4); Slice 1 can ship and accumulate rules meanwhile.
- **R3 — Server-local day buckets.** Matching `cost-routes.js` keeps panel and budgets consistent, but an operator far from server TZ sees shifted daily windows. Consistency chosen over absolute correctness; revisit only if the cost panel ever moves to UTC/operator-TZ buckets (change would touch both, one commit).
- **R4 — Department scope completeness.** `agent_profiles` is seeded from `openclaw.json`; an agent missing a profile row escapes department budgets silently. TODO-verify whether a sync/refresh job maintains the table; if not, Slice 2 should log a warn-level anomaly when a dispatching agent has no profile row.
- **R5 — Project scope is workflow_type today.** Honest naming in the UI ("workflow type") until a real project entity exists; renaming later is a label change, not a migration.
- **Q1 — Default budgets:** should the build ship with a conservative fleet-level monthly `warn` budget pre-created (safety-on-by-default) or fully inert until the operator opts in? CEO call at build review; the inert-until-defined property makes either defensible.
- **Q2 — Cap units display:** token caps shown raw or normalized to $ via recent avg cost/token? Defer to Slice 3 polish; raw counts are unambiguous.
