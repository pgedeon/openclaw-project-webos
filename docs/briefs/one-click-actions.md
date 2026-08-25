---
layout: default
---

# Design Brief — One-Click Agent Actions (Catalog, Gating Design, Receipts)

**Status:** Draft for build review · **Roadmap:** Phase 1 (UPGRADE_ROADMAP.md "One-click agent actions" — last unchecked Phase 1 interaction feature; review 2026-08-24b §3 order 5/6: brief now, build after)
**Evidence base:** market-scan-2026-08-24.md top-5 #4 (LoopX protected-action preview + receipts, Impact 7 / Effort 2, "mandatory UX" for this brief); roadmap-review-2026-08-24b.md §6 fold 3 (gating design written ONCE here — the Phase 2 NL command bar consumes it); existing machinery verified in-repo 2026-08-24: `workflow-runs-api.js` (create/start/cancel/pause/resume/reassign/override-failure/approvals), `gateway-workflow-dispatcher-v2.js` (budget gate + `last_tick_summary.budgetEnforcement`), `lib/budget-enforcement.js`, `routes/budget-routes.js`, `governance.js` (`GOVERNANCE_ACTION_RULES`), `routes/sse-routes.js` (`/api/events/stream`), `src/shell/mutation-manager.mjs` (in-flight dedupe only), `src/shell/native-views/{approvals-view,workflows-view,tasks-view,publish-view,mission-control-view,audit-view}.mjs`, `src/agent-view.mjs` (claim/release/execute/retry)
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit. Concurrent-lane guard: coder is building cost backfill (`scripts/backfill-run-costs.js` + tests) — the build phase of THIS brief must not touch those files.

---

## 1. Purpose & Value Proposition

The dashboard can *show* everything and *do* almost nothing safely. Today an operator who spots a failed run must mentally assemble a curl command or hunt through three views whose buttons all behave differently: Approvals' single-click **Approve** has no preview, its red **Cancel** actually DELETEs the run (`approvals-view.mjs` `.apv-delete-trigger` → `DELETE /api/workflow-runs/:id`), Workflows view lists runs with no cancel at all, and `mutation-manager.mjs` dedupes only *in-flight* clicks — a double-click that lands after the first request resolves fires twice. There is no record anywhere of *who pressed what, when, with what result* beyond scattered `writeTaskAudit` rows.

LoopX (5,049★ in <3 months, market scan 2026-08-24) ships the pattern this brief adopts: **protected-action preview with typed confirmation + receipts**. Paperclip's immutable audit log raised the same expectation at 79k★ scale.

One-click actions = **one governed path for every consequential operator action**:

1. An **action catalog** (v1: five actions) replaces ad-hoc buttons.
2. A **gating core** — typed schema → preview → confirmation → idempotent execution → receipt — sits between every button and every side effect.
3. **Receipts** persist per action and surface in a Recent-actions tray + the existing Audit log.
4. The gating core is designed **once**: the Phase 2 NL command bar composes the same typed envelope and receives the same receipts; it never gets its own confirmation semantics (review 2026-08-24b §5: building NL first would fork this design).

Everything the gating core needs exists server-side: governance permission checks (`ensureGovernancePermission` on approval decisions + escalations), status-guarded run transitions (idempotent by construction), budget evaluation (`checkRun`), SSE fan-out, `audit_log`. What's missing is the ~30% in front of them: the envelope, the idempotency key, the receipts table, and consistent UX.

---

## 2. Action Catalog v1

Five actions, prioritized by operator frequency × consequence. Each row names where the button lives today vs where it lands in the build (all placements are existing windows or shell chrome — **no new windowed app**, keeping the app-registry count and docs-drift surface frozen).

| # | Action kind | Does | Source views (button location) | Backing endpoint(s) | Governance action | Severity |
|---|---|---|---|---|---|---|
| 1 | `task.assign` | Set/change task owner agent | Tasks view detail edit form (owner select exists, `tasks-view.mjs` `#tvEditOwner`); Board view card context menu (**new placement**) | `PATCH /api/tasks/:id` (`owner`) | `reassign_owner` | LOW |
| 2 | `run.dispatch` | Create + start a workflow run on an existing task | Workflows view trigger panel ("⚡ Trigger Workflow", create+start composed today); Task detail panel "**Run workflow…**" (**new placement**); Publish Center candidate card "**Dispatch**" (**new placement** — publish-view is read-only today) | `POST /api/workflow-runs` + `POST /api/workflow-runs/:id/start` (composed inside one handler server-side — never two HTTP calls from the client) | `launch_workflow` | MEDIUM |
| 3 | `approval.decide` | Approve (or reject) a pending approval | Approvals view cards (Approve/Reject exist as bare single-click — retrofitted behind the gate) | `PATCH /api/approvals/:id` | `approve` / `reject` | MEDIUM-HIGH |
| 4 | `run.cancel` | Cancel a queued/dispatched/claimed/running run | Workflows view run rows (**new placement**); Mission Control blocked/stale panel row action (**new placement**); Approvals view keeps its existing Delete but is relabeled to remove the Cancel/Delete collision (§8 R2) | `POST /api/workflow-runs/:id/cancel` | `cancel_run` | HIGH |
| 5 | `run.redispatch` | Re-queue a failed run (reset to `queued`, dispatcher picks it up) | Workflows view failed-run rows (**new placement**); Approvals view failed state (**new placement**). Distinct from agent-queue Retry (`POST /api/tasks/:id/retry`), which stays as-is | `POST /api/workflow-runs/:id/override-failure` with `next_status:'queued'` (exists, unused by any view) | `override_failure` | MEDIUM |

Explicitly out of catalog v1 (exist already, unchanged): pause/resume/escalate/reassign-run endpoints, snapshot revert, import.run, system-scan run/followup. They retrofit onto the gate in v1.1 using §3 with zero new design.

---

## 3. Gating Design (the reusable core)

This section is the contract the NL command bar consumes. Written once; both UI buttons and NL compose it.

### 3.1 Typed action envelope

```
ActionEnvelope {
  actionId    UUID          // minted client-side ONCE per confirmed intent (modal open)
  kind        ENUM          // 'task.assign' | 'run.dispatch' | 'approval.decide'
                            // | 'run.cancel' | 'run.redispatch'   (registry-checked)
  targetId    TEXT          // task id | approval id | run id — validated per kind
  params      OBJECT        // kind-specific, e.g. {owner} | {template, input_payload}
                            // | {decision, notes} | {reason} | {}
  paramsHash  TEXT          // sha256(canonicalJSON(params)) — sorted keys, stable stringify
  actor       TEXT          // 'dashboard-operator' until multi-operator auth lands
  confirm     { mode, value? }  // see §3.2
}
```

Server-side registry (`lib/action-registry.js`, build phase): one entry per kind declaring `{kind, targetType, paramsSchema, governanceAction, severity, confirmMode, handler}`. Unknown kind, unknown target, or params failing the schema → `400 {error:'invalid_action', details}` **before any permission check or execution**. The registry is the single place a future action (or the NL bar's verb mapping) plugs in.

### 3.2 Confirmation modal pattern — severity-mapped

| Mode | UX | When |
|---|---|---|
| `NONE` | Single click; toast confirms with rollback hint | LOW severity only (`task.assign` — reversible by re-assigning) |
| `PREVIEW_MODAL` | Typed preview card (LoopX pattern): exactly what will happen, on which target, with which params, plus current budget headroom for dispatch-class actions; explicit Confirm button | MEDIUM / MEDIUM-HIGH (`run.dispatch`, `approval.decide`, `run.redispatch`) |
| `HOLD_CONFIRM` | Press-and-hold ≥1.2 s with progress ring; release early = nothing fires | HIGH / irreversible (`run.cancel` on non-queued runs) |

Picked per action severity, recorded in the registry so UI and future consumers derive behavior instead of hardcoding:

- `run.cancel`: **HOLD_CONFIRM chosen over typed-confirm.** Cancelling destroys paid in-flight work, but it is frequent during incident response — hold-to-confirm is fast, unambiguous, and works under stress; typed confirm is reserved for rarer, higher-blast-radius operations (none in v1).
- Queued-run cancels downgrade to PREVIEW_MODAL (nothing paid is lost yet).
- Keyboard/accessibility path for HOLD_CONFIRM: focus the button, press and hold `Enter` (keydown→keyup timing identical to pointer), or fall back to typed confirm via the modal's accessible alternative — AC11 pins this.
- Every PREVIEW_MODAL shows the **rollbackHint** from §3.4 before confirming, so the operator knows the recovery move *before* acting, not after.

### 3.3 Idempotency — double-clicks and network retries never duplicate side effects

Three layers; each is testable in isolation:

1. **Client intent binding.** `actionId` is minted when the operator opens the confirmation modal (or presses a `NONE`-mode button). All retries of that intent reuse the same `actionId`. A deliberate second execution requires opening the modal again → fresh `actionId`. This is the semantic difference between *a retry* and *a repeat*, encoded in one UUID.
2. **Server receipt latch.** `action_receipts.action_id` is the PRIMARY KEY. Execution inserts the receipt in the SAME transaction as the side effect. A replayed `actionId` hits the unique constraint, returns the stored receipt with `{duplicate:true}`, and performs nothing. This covers double-clicks (second click races the first), network retries (client re-POSTs after timeout), and offline-queue flushes (`mutation-manager.mjs` replays carry the original `actionId`).
3. **paramsHash staleness guard.** Replay with the same `actionId` but a different `paramsHash` → `409 {error:'stale_retry'}` — an edited-then-resubmitted form can never masquerade as a retry of the old intent.

What idempotency does NOT do: two different `actionId`s with identical kind/target/params both execute. That is a legitimate repeat (e.g., dispatching the same runbook twice) and must stay possible. Documented in the tray UI copy ("executed again" badge when a duplicate-by-intent follows within 5 min).

Existing `mutate({key})` in-flight dedupe stays — it collapses concurrent clicks pre-network; the receipt latch is the durable backstop.

### 3.4 Receipt — persisted record

```
action_receipts (migration 024_add_action_receipts.sql, build phase) {
  action_id     UUID PK
  kind          TEXT NOT NULL            -- catalog enum
  target_id     TEXT NOT NULL
  actor         TEXT NOT NULL DEFAULT 'dashboard-operator'
  ts            TIMESTAMPTZ DEFAULT NOW()
  outcome       TEXT CHECK IN ('executed','rejected_governance','blocked_budget',
                               'failed','duplicate')
  rollback_hint TEXT NULL                -- human-readable recovery move
  detail        JSONB DEFAULT '{}'       -- governance verdict, budget verdict,
                                         // resulting entity ids (e.g. new run_id), error text
}
```

- **Audit log integration:** every receipt insert also writes one `audit_log` row via the existing `writeTaskAudit` path (`action: 'action.'+kind`, `old_value` null, `new_value` = receipt summary). The Audit view then shows actions with zero view changes — filterable by actor, searchable, expandable detail, exactly like every other entry.
- **Recent-actions tray:** shell-chrome popover (taskbar icon, like notification-center — NOT a windowed app) listing the last 50 receipts newest-first: outcome icon, kind label, target title, relative time, rollbackHint on hover/expand. Fed by `GET /api/actions/recent`; live-updated by SSE (§3.6).
- **rollbackHint content** per kind (v1 static strings + dynamic ids): `task.assign` → "Re-assign to <previous owner>"; `run.dispatch` → "Cancel run <new_run_id> if unwanted"; `approval.decide` → "Rejection path: escalate_approval or re-create approval"; `run.cancel` → "Re-dispatch via run.redispatch"; `run.redispatch` → "Cancel again via run.cancel". Receipts carry hints ONLY — executing them is a non-goal (§7).

### 3.5 Budget interplay — what the UI shows when an action trips a budget

The dispatcher already enforces budgets between candidate SELECT and markDispatched (`gateway-workflow-dispatcher-v2.js` `dispatchQueuedRuns()`): `pause_new_runs` holds the row queued with no attempt marked, `hard_stop` bulk-cancels in-flight scope rows + cancels the queued candidate, `warn` passes through; counts land in `GET /api/workflow-runs/dispatcher/stats` → `last_tick_summary.budgetEnforcement {held, stopped, warned}`; breach events persist idempotently in `budget_events` (readable via `GET /api/budgets/:id/ledger`). Fail-open degradation is shipped behavior (enforcement OFF without PostgreSQL).

One-click actions add the **pre-execution probe** so the operator learns about the wall *before* pressing Confirm, not after the dispatcher silently holds their run:

- For `run.dispatch` (and `run.redispatch`), the PREVIEW_MODAL fetches headroom via existing `GET /api/budgets` (derived `status`, `pct_of_cap`, `current_spend` per budget) filtered to the target's scope chain (agent → department → project/workflow_type → fleet — same chain `lib/budget-enforcement.js` `checkRun()` walks). Green/amber/red strip in the modal.
- On Confirm, the server re-checks through the same gate before executing. If breached: NO side effect, receipt written with `outcome:'blocked_budget'`, response carries the structured verdict:
  `{error:'budget_blocked', action:'pause_new_runs'|'hard_stop', budgets:[{name, scope, period_key, spend_usd|spend_tokens, cap_usd|cap_tokens, pct_of_cap}]}`.
- Modal/banner rendering rules:
  - `pause_new_runs`: amber banner — "Dispatch held: <budget name> at <pct>% of <period> cap. Queue drains automatically at rollover, cap raise, or deactivation (no un-pause button exists — derived state, budget-ledger.md §2.4)." Confirm button disabled while the block stands.
  - `hard_stop`: red banner — same plus "in-flight runs in scope were cancelled by the dispatcher."
  - Blocked ≠ error toast: the tray records it (`blocked_budget`), Mission Control's cost panel remains the deep-link target for cap raises (`PATCH /api/budgets/:id`).
- **Dispatcher-level surfacing (read-only strips, additive):**
  - Workflows view header: "⏸ N runs held · ⛔ M stopped by budgets (last tick)" when `budgetEnforcement.held+stopped > 0`, linking to Mission Control cost panel. Hidden entirely when stats unavailable.
  - Mission Control cost panel gains a budget-events line fed by `/api/budgets/:id/ledger` `events[]` (slice 3 territory per budget-ledger.md §6 — this brief only CONSUMES those endpoints, it does not modify them).
- Degradation inherits the shipped contracts verbatim: budgets endpoints answer `200 {available:false, reason:'no_database'|'query_failed'}` → modal renders NO budget strip (never a fake green), dispatch proceeds exactly as today (fail-open), stats strip hidden.

### 3.6 Data contract — new vs reused

New (build phase):

| Endpoint | Purpose |
|---|---|
| `POST /api/actions` | The only write path for catalog actions. Validates envelope against registry → governance check (`evaluateGovernanceAction`) → budget probe (dispatch-class) → execute via existing storage/api functions IN-PROCESS (never HTTP self-calls) → receipt insert + audit mirror in one transaction → emit SSE. Responses: `200 {receipt}` / `200 {receipt, duplicate:true}` / `409 stale_retry` / structured blocks per §3.5 |
| `GET /api/actions/recent?limit=50` | Tray feed. Same degradation family as budgets routes: `200 {available:false, reason:'no_database'}` without PostgreSQL |
| SSE event `action-update` | Emitted on `/api/events/stream` fan-out after every receipt insert (payload = receipt). Additive to the bridge-fed channel; clients that ignore it lose nothing (tray falls back to 30 s polling, house pattern) |

Reused unchanged: every backing endpoint in §2's table (the new route calls their internal functions directly, so raw endpoints keep working for scripts/agents — the gate is additive, not a breaking cordon), `GET /api/budgets`, `GET /api/budgets/:id/ledger`, `GET /api/workflow-runs/dispatcher/stats`, `audit_log` writes, governance helpers.

Degrade-gracefully rules (binding for build):

1. No PostgreSQL → `POST /api/actions` refuses ALL actions with `200 {available:false, reason:'no_database'}`-shaped refusal. **Audit-first principle: no receipt persistence, no side effect** — an action that executes but leaves no receipt breaks the invariant the whole design exists for. (Deliberately stricter than read-endpoint degradation; called out as D1 in §9.)
2. Receipts table missing (migration unapplied) → same refusal, `reason:'receipts_unavailable'`.
3. SSE down → tray polls `GET /api/actions/recent` every 30 s; no reconnect storms (reuse realtime-sync's capped-attempt pattern conceptually, tray-side it's just polling).
4. Governance helper unavailable → fail CLOSED (`rejected_governance` receipt), never execute unprompted.
5. Budget probe fails → hide strip, proceed (dispatcher remains the enforcement backstop — matches shipped fail-open semantics).

---

## 4. Data Model & Sources of Truth

| Field/data | Source | Freshness |
|---|---|---|
| Envelope fields | Client intent + registry validation | Per interaction |
| Governance permission | `governance.js` `GOVERNANCE_ACTION_RULES` + `normalizeActorContext` (privileged actors: system/dashboard-operator/openclaw/ops-*) | Static config + org bootstrap |
| Run/task/approval state | Existing `workflow_runs` / tasks / `workflow_approvals` tables via current handlers | Live at execution |
| Budget headroom | `GET /api/budgets` derived spend (migration-022 columns, TTL-cached) | ≤30 s stale (shipped contract) |
| Dispatcher holds/stops | `GET /api/workflow-runs/dispatcher/stats` `last_tick_summary.budgetEnforcement` | One tick (30 s default) |
| Breach history | `budget_events` via `/api/budgets/:id/ledger` | Append-only |
| Receipts | `action_receipts` (NEW, migration 024) | Written once per actionId, immutable |
| Audit mirror | `audit_log` (existing) | Written with receipt, same transaction |

Dependency note: cost-headroom display quality depends on the Phase 0 cost/token backfill landing (sparse history → understated spend → greener-than-truth strips). Same gate budget slice 2 already carries (budget-ledger.md §4/R2). Strip ships regardless; accuracy note lands with it if backfill hasn't merged.

---

## 5. UX Flows

1. **Assign** (LOW): Board card menu → "Assign to…" → pick agent → click → toast "Assigned to <agent>. Undo: re-assign." Receipt lands in tray.
2. **Dispatch** (MEDIUM): Task detail → "Run workflow…" → template picker → PREVIEW_MODAL (target agent, input payload digest, budget strip, rollbackHint "Cancel run <id> if unwanted") → Confirm → button shows spinner → toast with new run id → tray receipt → run appears in Workflows view via existing `run-updated` sync.
3. **Decide** (MEDIUM-HIGH): Approvals card → Approve → PREVIEW_MODAL (what was requested by whom, note field carried over) → Confirm → existing approve path → card flips to approved state on next sync.
4. **Cancel** (HIGH): Workflows run row ⛔ → HOLD_CONFIRM ring completes → cancel fires → row flips to cancelled with existing `last_error` rendering → tray receipt with rollbackHint "Re-dispatch via run.redispatch".
5. **Re-dispatch** (MEDIUM): Failed run row ↻ → PREVIEW_MODAL (shows `last_error` being cleared, reset-to-queued semantics) → Confirm → run returns to queue; if a budget is breached the §3.5 banner replaces the confirm button.
6. **Cross-links:** tray receipt → click opens the target (run → Workflows deep link exists via `?runId=`; approval → Approvals view; task → Tasks view param navigation — patterns all present in `workflows-view.mjs` P7 handler). Audit view rows for actions render through the existing table untouched.

Degradation matrix:

| Condition | Behavior |
|---|---|
| No database | Actions refuse with structured reason; tray shows "Actions unavailable — no database" empty state; all read-only views unaffected |
| Migration 024 unapplied | Same refusal, `receipts_unavailable` |
| SSE down | Tray polls 30 s; buttons work normally |
| Budget endpoints `available:false` | No budget strip; dispatcher still enforces server-side |
| Legacy raw endpoint used by script/agent | Works unchanged, bypasses receipts (documented escape hatch, not a UI path) |

---

## 6. Build Sequence & Acceptance Criteria

Three slices, DB-free tests per house pattern (`tests/test-action-routes.js`: fake pool, scripted results, plain `assert`). Docs gates per build commit: `docs/api-reference-complete.md` entries for the two new endpoints + SSE event; CHANGELOG `### Added`; `node scripts/docs-drift-check.js` exit 0 (no app-registry change expected — assert explicitly since the tray is shell chrome, not a windowed app).

**Slice 1 — Server core: registry, routes, receipts, idempotency.**
Migration 024; `lib/action-registry.js`; `routes/action-routes.js`; transactional receipt+side-effect+audit writes; budget probe wiring.
- **AC1 (schema):** unknown kind / bad target format / params-schema violation → 400 `invalid_action` BEFORE governance or execution; fixture per kind.
- **AC2 (idempotency — double-click):** two concurrent POSTs, same `actionId` → exactly ONE side effect (fixture counts handler invocations = 1), one receipt, second response `duplicate:true`.
- **AC3 (idempotency — retry-after-success):** sequential replay of a completed `actionId` → stored receipt returned, `duplicate:true`, zero additional side effects.
- **AC4 (staleness):** same `actionId`, different `paramsHash` → 409 `stale_retry`, no execution.
- **AC5 (deliberate repeat):** two distinct `actionId`s, identical kind/target/params → both execute, both receipted (pins the retry-vs-repeat semantic).
- **AC6 (transactionality):** forced handler failure mid-execute → NO receipt row AND no partial side effect (rollback fixture).
- **AC7 (governance):** non-privileged actor lacking `cancel_run` capability → receipt `outcome:'rejected_governance'`, no side effect; privileged actors pass (existing `normalizeActorContext` fixtures).
- **AC8 (budget block):** breached `pause_new_runs` probe → `blocked_budget` receipt with full verdict payload, no run created; `warn` proceeds with receipt `executed`.
- **AC9 (degradation):** pool=null → refusal payload per §3.6 rule 1; zero writes asserted.

**Slice 2 — Client gating module + catalog retrofit.**
`src/shell/action-gating.mjs` (envelope minting, canonical JSON + sha256, modal components, hold-confirm widget); retrofit the five catalog buttons across §2 views; relabel Approvals Cancel→Delete disambiguation.
- **AC10 (confirm modes):** NONE fires immediately with toast; PREVIEW_MODAL blocks POST until Confirm; HOLD_CONFIRM releases early → zero network requests fired (spy fixture).
- **AC11 (hold accessibility):** keyboard hold (`Enter` down/up) drives the same threshold; typed-confirm fallback reachable via keyboard alone.
- **AC12 (offline queue):** mutation queued offline replays with ORIGINAL `actionId` on reconnect; server dedupes (integration fixture with Slice 1 fakes).
- **AC13 (labels):** Approvals view exposes no control labeled "Cancel" that deletes; grep-level fixture on rendered strings.

**Slice 3 — Tray, SSE, budget surfacing.**
Taskbar tray popover; `action-update` emission + client handling; workflows-view budget strip; Mission Control budget-events line (consumes `/ledger` only).
- **AC14 (tray):** last-50 newest-first render from `GET /api/actions/recent`; `available:false` → named empty state; receipt click navigates to target view.
- **AC15 (SSE):** `action-update` frame arrives <2 s after receipt insert in the fan-out fixture; clients ignoring the event degrade to polling with no errors.
- **AC16 (audit mirror):** every executed receipt produces exactly one matching `audit_log` row (`action='action.'+kind`); Audit view filters/search render them (existing view, fixture on data shape only).
- **AC17 (budget strip):** `held/stopped > 0` renders counts + deep link; stats unavailable → strip absent; zero counts → strip absent.
- **AC18 (regression):** with the feature inert (no envelopes sent), byte-identical behavior of all five underlying endpoints (house regression-guard pattern from budget slice 2).

Success metrics (wired to the impact-measurement loop):

- **Duplicate-side-effect rate:** receipts with `duplicate:true` that followed a *completed* prior execution (true accidents) — target ~0 after launch; measured from `action_receipts` directly.
- **Time-to-decision:** median pending→decided span for approvals before vs after gated Approve (from `workflow_approvals` timestamps) — the one-click thesis is this number dropping.
- **Cancel regret rate:** `run.cancel` receipts followed by `run.redispatch` on the same target within 10 min — proxy for hold-confirm friction being correctly calibrated (too high = gate too loose, operators yoyo; reviewed biweekly).
- **Gated-path share:** fraction of catalog-kind side effects arriving via `POST /api/actions` vs raw endpoints (server logs) — adoption metric; raw-endpoint share should trend to scripts-only.
- **NL-bar readiness (binary):** Phase 2 NL command bar composes envelopes + consumes receipts WITHOUT reopening this design — the review-2026-08-24b fold-3 success criterion.

---

## 7. Explicit Non-Goals (v1)

- **No undo/rollback execution.** Receipts carry `rollbackHint` strings only; nothing auto-reverts. Snapshot-revert stays a separate governed action outside this catalog.
- **No batch actions.** One envelope = one target. Multi-select cancel/dispatch is a v1.1 registry extension (envelope already supports it via repeated sends), not v1.
- **No NL interface.** The Phase 2 NL command bar is a future CONSUMER of §3 — it composes envelopes, receives receipts, and inherits confirmation semantics verbatim. Zero NL parsing lands here.
- **No new windowed app.** Tray is shell chrome (taskbar popover, notification-center sibling). App-registry count, README count, and views-reference app table stay frozen.
- **No cordon on raw endpoints.** Scripts and agents keep direct API access; the gate governs the operator surfaces. Server-side enforcement for non-UI callers is a separate future decision (needs an actor model beyond 'dashboard-operator').
- **No RBAC changes.** `governance.js` rules are consumed as-is; multi-operator roles remain out of scope per roadmap.
- **No mobile/touch layout work** beyond HOLD_CONFIRM's existing pointer events.

---

## 8. Risks & Open Questions

- **R1 — Audit-first refusal may annoy snapshot-mode users.** Rule 1 (§3.6) blocks ALL actions without PostgreSQL even though some handlers could technically run. Accepted: silent unaudited writes would defeat the receipts mandate from market scan #2. Mitigation: refusal payloads name the exact missing piece; docs state it in the api reference entry.
- **R2 — Cancel/Delete naming collision (found during study).** Approvals view's red "Cancel" button currently DELETEs the run (`DELETE /api/workflow-runs/:id`) while `run.cancel` is a distinct status transition. Slice 2 relabels it "Delete" and moves deletion behind a PREVIEW_MODAL; otherwise operators will believe they cancelled when they destroyed.
- **R3 — Concurrent-lane file collisions.** Coder owns cost-backfill `.js` files right now; this brief is docs-only. Build sequencing guard: Slice 1 touches NEW files (`lib/action-registry.js`, `routes/action-routes.js`, migration 024, tests) + registration lines in `task-server.js`; zero overlap with `scripts/backfill-run-costs.js`. Registration-line edits are the only shared-file risk — coordinate landing order.
- **R4 — HOLD_CONFIRM on precision pointers / motor-impaired operators.** Hold gestures are hard for some users. Mitigation pinned as AC11 (keyboard-hold parity + typed-confirm fallback); flag for the QA pass rather than deferring to a11y debt.
- **R5 — Budget-strip truthfulness depends on backfill.** Sparse cost history → understated spend → optimistic strips. Same dependency budget slice 2 carries; strip ships with an accuracy footnote if backfill hasn't landed (§4).
- **Q1 — Approve-then-auto-execute:** approvals-view currently requires a second manual ▶ Execute after approval. Should `approval.decide` optionally chain the start (one click fewer) or keep the two-step deliberately? CEO call at build review; envelope design supports either (chaining = one more registry flag, receipts would show both steps).
- **Q2 — Receipt retention:** `action_receipts` grows unbounded; propose 90-day prune in the same cron sweep that handles other housekeeping, audit_log mirrors persist independently. Needs owner.
- **Q3 — Actor identity for receipts:** everything is 'dashboard-operator' under single-operator auth. Fine for v1; revisit the moment multi-operator auth lands (receipts are the natural per-actor attribution point — schema already carries `actor`).

---

## Related

- [Budget ledger brief](budget-ledger.md) — enforcement semantics this brief surfaces (§3.5)
- [Roadmap review 2026-08-24b](roadmap-review-2026-08-24b.md) — sequencing + write-once gating mandate
- [Market scan 2026-08-24](../research/market-scan-2026-08-24.md) — LoopX receipts pattern (#4), Paperclip audit-log pressure
