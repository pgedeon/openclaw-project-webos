# Design Brief — Natural-Language Command Bar (NL mode for Ctrl+K)

**Status:** Draft for build review · **Roadmap:** Phase 2 (UPGRADE_ROADMAP.md "Natural-language command bar": type "spawn agent for X, report when done" → creates task + dispatches workflow; extends the existing Ctrl+K palette; MANDATORY confirmation gate before side-effectful actions; no free-form config writes)
**Evidence base:** existing machinery verified in-repo 2026-08-25: `src/shell/command-palette.mjs` (Ctrl+K overlay: debounced multi-source search over apps/tasks/projects/agents, keyboard nav, stale-result guard Fix 14, cleanup return for shell.destroy), `src/shell/action-client.mjs` (one-click actions slice 2: severity-mapped confirm modes NONE/PREVIEW_MODAL/HOLD_CONFIRM, `buildEnvelope()` actionId minting, `executeAction()` gate→execute→toast→receipt pipeline, `describeOutcome()` response table incl. `budget_blocked`, shared receipt store feeding the Recent-actions tray), `lib/action-registry.js` (authoritative catalog: five kinds, paramsSchema per kind, governance actions, budgetProbe flags), `routes/action-routes.js` + migration 024 (`POST /api/actions/execute` latch-first idempotency, `GET /api/actions/recent`), `src/shell/recent-actions-tray.mjs`, `src/shell/api-client.mjs` (`tasks/projects/org/workflows/approvals/agents/budgets` namespaces + `actions.execute/recent`), review pinning in `docs/briefs/roadmap-review-2026-08-24b.md` §5 fold 3 and `docs/briefs/one-click-actions.md` §1/§7 (gating design written ONCE; NL bar is a CONSUMER)
**Order:** this commit is docs only — no `.js/.mjs/.sql/.yml` changes. Concurrent-lane guard: coder is building MCP slice 2 (`mcp-server.js`, `tests/test-mcp-server.js`, `docs/mcp-server.md`) — the build phase of THIS brief must not touch any `.js/.mjs` file it owns, and must coordinate the one small `command-palette.mjs` edit (§6 R2).

---

## 1. Purpose & Positioning

The Ctrl+K palette already answers "where is X?" — it searches tasks, projects, agents, and views and navigates. It cannot *do* anything: an operator who types "cancel the stuck import run" gets zero results and must open Workflows, find the row, and press ⛔ themselves.

The NL command bar closes that gap **without forking the gating design**: the operator types an intent in plain language, the system interprets it into a candidate **action envelope** (or a query answer), shows exactly what it understood, and executes through the **same** governed path every button uses — `action-client.mjs` → `POST /api/actions/execute` → receipt in the Recent-actions tray.

Two hard boundaries, inherited from the roadmap item and review #2:

1. **The NL bar composes envelopes and consumes receipts. It never implements its own confirmation semantics.** Confirmation behavior is derived from `lib/action-registry.js` severity exactly as views derive it (one-click-actions brief §3.2). The NL interpretation preview (§3) is *understanding feedback*, not a parallel confirmation tier.
2. **No free-form config writes.** The bar can only propose actions that exist in the registry. If a verb isn't in the catalog, the honest answer is "I can't map that to an action," never a guess.

### Execution backend decision: direct envelopes, NOT MCP tool calls

The MCP server (docs/briefs/mcp-exposure.md) is a natural-looking backend for NL-derived intents. It is the wrong one for this feature. Recommendation: **the NL bar routes directly through action envelopes via `executeAction()`**, and uses plain REST reads for query intents. Reasons:

1. **Gating lives in the envelope path.** Severity-mapped confirmation, latch-first idempotency, receipts, governance pre-check, and the budget probe are all properties of `POST /api/actions/execute`. The MCP mutating trio (`create_task`, `update_task`, `create_snapshot`) bypasses receipts entirely behind the `OPENCLAW_MCP_MUTATIONS` enablement flag — routing NL through it would put side effects on the ungated path, the exact fork review #2 forbids.
2. **Catalog coverage is wrong anyway.** The MCP tool catalog has no `task.assign`, `approval.decide`, `run.cancel`, or `run.redispatch` — four of the five verbs the NL bar exists to speak.
3. **Architecture.** MCP here is stdio JSON-RPC for *external* clients (OpenClaw agents, Claude Desktop) spawned as child processes. A browser cannot speak stdio; bridging it would mean a new HTTP→MCP shim, a second auth surface, and a loopback hop to reach the same task-server the palette already talks to.
4. **Convergence, not divergence.** mcp-exposure §8 R2/OQ2 already designates "route MCP mutations through `POST /api/actions` kinds" as the v1.1 upgrade. When that lands, both surfaces share one governed path. The NL bar is unaffected either way because it never touches MCP.

**Rule for the build:** query-only intents use the same `api.*` read namespaces the palette search already uses; mutating intents call `executeAction({kind, targetId, params, api})` and nothing else. No new fetch paths, no new auth.

---

## 2. UX Flow

Entry point is the existing palette; nothing new is windowed (app-registry count stays frozen at 35 — drift-check asserted in §6).

1. **Open** — `Ctrl+K` / `Cmd+K` opens the palette exactly as today (search mode default).
2. **Toggle NL mode** — explicit control only, no implicit switching: a footer hint gains `Tab toggles Ask mode`; pressing `Tab` in the input flips mode (preventDefault — the palette input has no other Tab consumer), and a small `Ask`/`Search` chip beside the placeholder mirrors state. Explicit toggle beats verb-sniffing heuristics: predictable, testable, and impossible to misfire while typing a search query that happens to contain a verb.
3. **Type intent** — e.g. `cancel run 4f2a`, `assign checkout bug to kaya`, `what's running`.
4. **Parse + resolve** — client-side grammar (§4) extracts `{verb kind | query intent}` + slot values; target references resolve against live reads (tasks/runs/approvals/agents lists) with a 250 ms debounce and a single resolution fan-out per keystroke burst (§5 rate limits).
5. **Interpreted preview (mandatory)** — the results area renders an interpretation card:
   - **Action intent:** "Will **cancel run** `run_4f2a…` — *Import batch 42* (running). Cancelling destroys paid in-flight work." plus rollback hint. This card is show-not-execute: nothing has been minted, nothing POSTed.
   - **Ambiguous target:** a pick list ("3 runs match 'import'") — selecting one re-renders the card; Enter does nothing while ambiguous.
   - **Unmatched:** "Couldn't map that to an action." + falls back to normal search results for the same text (the palette's existing behavior becomes the degradation path).
   - **Query intent:** answered inline (counts + top rows + deep-link lines); no envelope is ever constructed.
6. **Confirm via the SAME gating tiers** — `Enter` on an unambiguous action card hands off to `executeAction()`, which applies the registry-derived mode verbatim: `NONE` fires on that hand-off click, `PREVIEW_MODAL` opens the typed preview card, `HOLD_CONFIRM` opens the hold ring. For `NONE`-mode kinds the interpretation card's confirm doubles as the single click — the *interpretation* step is inherent to NL (the user typed prose; showing what was understood is mandatory), while the *confirmation tier* applied at execution remains exactly the registry's. No new mode is invented.
7. **Outcome + receipt** — toasts, amber budget banner, duplicate/stale/governance handling all come from `describeOutcome()` unchanged; server-written receipts land in the Recent-actions tray through the shared store. Receipt click-through navigation (run → Workflows, task → Tasks, approval → Approvals) works identically for NL-originated actions.

Degradation matrix (house contract):

| Condition | Behavior |
|---|---|
| No database | Mutating intents: `executeAction()` surfaces the audit-first refusal (`available:false`) toast. Query intents degrade with named empty states. Grammar itself keeps working (pure client-side). |
| Reads unreachable during target resolution | Interpretation card shows "couldn't verify target" — never proposes an unresolved id. |
| Palette closed mid-confirm | Confirm modals are body-level overlays owned by `action-client.mjs`; they complete independently of palette lifetime. |
| Empty utterance / whitespace | No parse, no resolution calls. |

---

## 3. What the interpretation preview is (and is not)

Pinned so qa-auditor can test the boundary:

- It renders BEFORE any confirmation modal and BEFORE any network mutation. Zero envelopes exist while it is visible (`buildEnvelope()` is only reachable inside `executeAction()` after confirmed intent — inherited, §6 AC-ID1).
- It is not skippable for mutating kinds: there is no path from keystroke to `POST /api/actions/execute` that does not pass both the interpretation card AND the registry-tier confirmation.
- It is not a second confirmation semantic: it carries no Confirm-mode authority of its own. Its only job is to make the parsed slots inspectable. All execution behavior (mode, threshold, keyboard parity, rollback hint placement) comes from the registry via `action-client.mjs`.
- Dismissal (`Esc`, backdrop, palette close) leaves nothing behind: no minted `actionId`, no queued mutation, no replayable intent.

---

## 4. Parsing approach — v1 deterministic grammar, v2 LLM endpoint

Constraints: repo charter is no-frameworks (vanilla JS, no npm additions) and **no LLM in the frontend**. Two candidate architectures were weighed:

**(a) Deterministic template/keyword grammar, client-side** — a pure function `parseUtterance(text) → {status, kind?, slots?, queryIntent?}` built on a verb-synonym table mapped to registry kinds, slot patterns (quoted strings, id prefixes, agent names), and a small set of query-intent templates. Target resolution hits existing read endpoints.

**(b) Server-side LLM parse endpoint** — `POST /api/nl/parse` on task-server reusing gateway model access (the `lib/gateway-bridge.js` credential pattern: secret stays server-side), returning candidate envelope(s) validated against `lib/action-registry.js` before preview.

**v1 choice: (a). Justification:**

1. **Safety-critical determinism.** The misparse-safety property (§6 AC-SF2) — a wrong interpretation must fail safe as show-not-execute — is only *provable* when the same utterance always yields the same interpretation. An LLM in the proposal path makes the safety argument statistical; the confirmation gate would be doing all the work, and review #2's whole point is that gating is designed once, not re-argued per frontend.
2. **Zero new server surface.** (b) adds an authenticated costed endpoint, model-access config, token metering, rate limiting, and a new failure mode to task-server — a dependency chain that has nothing to do with the actual v1 problem, which is mapping ~9 intents onto a 5-kind catalog.
3. **Honest coverage.** The v1 intent space is tiny and enumerable (§5 table). A grammar covers it completely and, more importantly, knows what it doesn't know: unmatched input degrades to search instead of hallucinating an envelope. With (b), the "unmatched" case becomes "model guessed something plausible" — the worst possible failure mode next to a HOLD_CONFIRM action.
4. **Offline/degradation parity.** Parsing works with zero network; only target resolution and execution need the server. Consistent with the house pattern that UI structure survives degradation.
5. **Testability.** Pure function + fixture table = DB-free tests in the established `tests/test-action-client.js` style. (b)'s parse quality cannot be pinned DB-free.

Cost of (a), accepted for v1: phrasing rigidity. Utterances must roughly match templates; synonyms are curated, not inferred. The unmatched state is the designed answer to rigidity — and it fails safe.

**v2 sketch (kept out of v1 scope):** add `POST /api/nl/parse` to task-server. Contract: bearer-token auth (existing single-operator policy), request `{text, context:{view}}`, response `{candidates:[{kind, targetId?, params?, confidence}], unmatched_reason?}` where every returned candidate MUST validate against `lib/action-registry.js` server-side before being returned (invalid candidates dropped, never relaxed). The client treats LLM candidates identically to grammar candidates: interpretation card → `executeAction()` → registry tiers. Gating semantics still fork nowhere — parse only proposes; only confirmed intents execute. Operational guards: per-session token bucket (e.g. 10 req/min), per-call token cap, response cache keyed by normalized utterance hash, cost note in api-reference (tokens per parse billed to the operator's gateway access), and a kill switch env (`OPENCLAW_NL_LLM_PARSE=0` default off) with graceful fallback to the grammar. The grammar ships first regardless: v2 uses it as fallback and as the fast path for exact template matches (LLM consulted only on grammar misses).

---

## 5. Intent → Action Mapping (v1 grammar)

Verb tables are data, not code paths: each row's `kind` must exist in `ACTION_CATALOG` at parse time; unknown verbs fall to unmatched. Precedence rule: **query verbs win** — an utterance starting with show/find/list/what/how/status never maps to a mutating kind even if it contains one ("show me how to cancel runs" → search results for "cancel runs"). Pinned by AC-SF4.

### Mutating intents (gated — every row executes through `executeAction()`)

| Example utterances | Kind | Envelope composed | Confirmation (from registry) |
|---|---|---|---|
| "assign <task> to <agent>", "give <task> to <agent>" | `task.assign` | `{targetId:<task id>, params:{owner:<agent name>}}` | NONE (interpretation-card confirm = the click) |
| "run <template> on <task>", "dispatch <template> for <task>", "start <template> on <task>" | `run.dispatch` | `{targetId:<task id>, params:{template:<name>}}` | PREVIEW_MODAL (+ budget headroom lines when available) |
| "approve <approval>", "reject <approval>" | `approval.decide` | `{targetId:<approval id>, params:{decision:'approved'\|'rejected'}}` | PREVIEW_MODAL |
| "cancel run <ref>", "stop run <ref>", "kill run <ref>" | `run.cancel` | `{targetId:<run id>, params:{}}` | HOLD_CONFIRM (1.2 s ring, keyboard parity) |
| "retry run <ref>", "re-dispatch run <ref>", "rerun <run ref>" | `run.redispatch` | `{targetId:<run id>, params:{}}` | PREVIEW_MODAL |

Slot resolution rules:

- **Task refs:** `#<id prefix>` or unique title substring across open tasks (`api.tasks.list`). >1 match → disambiguation list; 0 matches → unmatched.
- **Run refs:** `run_<id>` / UUID prefix / short-id match across active + recently failed runs (`api.workflows.active`, `api.workflows.runs({status:'failed'})`). Cancel offers running/queued/waiting rows only; redispatch offers failed rows only — matching the buttons' own status guards.
- **Approval refs:** unique subject/title match among pending approvals (`api.approvals.pending`).
- **Agent names:** resolved against `api.org.agents.list` display names; unknown agent → unmatched ("no agent named …"), never a free-text owner.
- **Templates:** resolved against `api.workflows.templates()`; unknown template → unmatched listing close matches.
- **Quoted strings** (`"..."`) force literal title matching.

### Query-only intents (answered inline — NEVER gated, NEVER enveloped)

| Example utterances | Answer source (existing reads) | Inline render |
|---|---|---|
| "what's running", "fleet status" | `api.workflows.active` + `api.agents.status` | N running runs / agents busy, deep-link lines |
| "show failed runs", "what failed" | `api.workflows.runs({status:'failed'})` | Top rows + "re-dispatch run <id>" hint chips (chips compose the envelope only when clicked → full flow) |
| "pending approvals", "what needs approval" | `api.approvals.pending` | Count + cards; "approve <x>" chips start the gated flow |
| "budget status", "am I over budget" | budgets read (derived status/pct) | Breached/amber budgets named; no action proposed |
| "find task <q>", any unmatched text | Existing palette search pipeline | Normal search results (today's behavior) |

Hint chips deserve the boundary restated: clicking a chip is equivalent to typing the utterance — it lands on the interpretation card, then the registry tier. A chip never fires directly.

### The flagship utterance, honestly scoped

"spawn agent for X, report when done" decomposes into create-task + dispatch. **Task creation is not a catalog kind** (one-click-actions §2 v1 froze five kinds). v1 behavior: if X resolves to an existing task → `run.dispatch` proposal on it (full flow); if not → interpretation card states plainly that task creation isn't an available action yet, with a deep link to the Tasks view. Proposed fix is Q1 (§9): add `task.create` as a v1.1 registry extension (PREVIEW_MODAL, additive-only, plugs into the registry exactly as one-click-actions §3.1 designed) so the roadmap's headline sentence works end-to-end without touching this brief's gating consumption.

---

## 6. Safety

1. **Query-only intents never gate because they never mutate.** They construct no envelope object at any point — the type-level guarantee, not a runtime check. AC-SF1 pins it structurally (query parse results carry no kind field).
2. **Mutating always gates — twice, by construction.** Interpretation card (show-not-execute) then registry-tier confirmation inside `executeAction()`. There is no code path from the NL bar to `POST /api/actions/execute` that skips either. AC-SF2/AC-SF3.
3. **Misparse safety = show-not-execute.** A wrong interpretation can only ever render a preview the operator dismisses. The catastrophic case — parser maps garbage to a HIGH kind and something auto-fires — is structurally impossible: no execution without confirmed hand-off, and `run.cancel` additionally requires the 1.2 s hold. AC-SF2 fixtures include a deliberately wrong-parse fixture asserting zero fetches.
4. **`budget_blocked` surfacing is inherited, not reimplemented.** Dispatch-class blocks return the structured verdict; `describeOutcome()` routes it to `showBudgetBlockedBanner()` (amber, budget name + period + % of cap, retry-after-cap-raise). The NL bar adds zero budget logic. Preview enrichment: when the target resolves, dispatch-class interpretation cards may include current headroom lines from the budgets read — display only, the authoritative probe stays server-side pre-execution.
5. **Rate limits.** v1 grammar is local and free; the guarded resources are target-resolution reads and operator attention: 250 ms input debounce (palette precedent: 200 ms), max ONE resolution fan-out per burst (stale-sequence guard reused from palette Fix 14 pattern), resolution queries capped (≤4 endpoints per parse). v2 LLM endpoint: per-session token bucket 10 req/min, per-call token cap, cache by normalized-utterance hash, default-off kill switch (§4).
6. **Batch/refused classes.** Multi-target utterances ("cancel all failed runs") are refused at parse with a named reason (one envelope = one target — one-click-actions §7 non-goal, preserved verbatim). Temporal/scheduling utterances ("every day at 9…") refuse pointing at Cron view. Config-write verbs (budgets, settings, snapshots restore) are unmatched by design — not in the catalog, not added here.
7. **Actor/attribution.** Envelopes carry actor `dashboard-operator` exactly like button flows; receipts are indistinguishable by origin. Telemetry to distinguish NL-originated actions is an open question (Q3), not a silent params hack — `validateParams()` ignores unknown keys today, and smuggling an `origin` field into `params` would pollute `paramsHash` semantics.

---

## 7. Data Model & Sources of Truth

| Field/data | Source | Freshness |
|---|---|---|
| Verb/synonym tables, query-intent templates | Static data in `nl-command-bar.mjs`; kinds cross-checked against `ACTION_CATALOG` at parse time | Ships with code |
| Registry metadata (severity, confirmMode, targetType, paramsSchema) | `lib/action-registry.js` via `action-client.mjs` mirror (parity test exists) | Authoritative server-side |
| Task/run/approval/agent/template targets | Existing reads: `/api/tasks/all`, `/api/workflow-runs(/active,/failed via status)`, `/api/approvals/pending`, `/api/org/agents`, `/api/workflow-templates` | Live at parse; stale-resolved targets re-validated server-side by envelope validation + status-guarded executors |
| Query-intent answers | Same reads as above + budgets derived status | Live at render; inline answers marked with fetched-at relative time |
| Receipts | `action_receipts` via `GET /api/actions/recent` + shared in-session store | Unchanged from one-click actions |
| Budget headroom (preview lines) | `GET /api/budgets` derived spend | ≤30 s stale (shipped contract); display-only |

No new tables, no migrations, no new endpoints (v1). Nothing in this brief writes anywhere that `POST /api/actions/execute` doesn't already write.

## UX placement notes (for the build)

- NL mode lives INSIDE the palette overlay — shell chrome, not a windowed app; app-registry count frozen at 35 (README + views-reference asserted by docs-drift-check).
- Interpretation cards render in the palette results area (same container as search results) so palette geometry/scroll behavior is reused.
- Confirm overlays (PREVIEW_MODAL/HOLD_CONFIRM) are `action-client.mjs`'s existing body-level components — palette closure during a confirm must not abort them (they own their lifetime; verified pattern: they already survive view unmounts).
- Footer hints update: `↑↓ navigate · Enter select · Esc close · Tab Ask` (Ask mode swaps to its own hint line).

## Build Sequence & Acceptance Criteria

Docs gates per build commit (house pattern): user-guide section, views-reference shell-chrome note, CHANGELOG `### Added`, `node scripts/docs-drift-check.js` exit 0 with app count explicitly unchanged.

**Slice 1 — Grammar core (pure, DB-free-testable).**
New `src/shell/nl-command-bar.mjs`: `parseUtterance()`, synonym/slot tables, `resolveTargets(api, parse)` fan-out with stale-sequence guard, `buildInterpretation()` rendering model. No palette wiring yet.
- **AC-G1 (mapping table parity):** every §5 mutating row's fixture utterance parses to exactly `{kind, slots}` from the table; every query-row fixture parses to its queryIntent with NO `kind` field present on the result object (structural never-gate guarantee).
- **AC-G2 (precedence):** query-verb-first fixtures containing mutating verbs ("show me how to cancel runs") resolve to search/query, never to a kind.
- **AC-G3 (fail-safe defaults):** unknown verb, unknown agent/template, ambiguous target (2+ matches), empty/whitespace → `unmatched`/`ambiguous` statuses; none of these statuses can carry an envelope-shaped payload (fixture asserts absence of kind+targetId+params triple).
- **AC-G4 (batch/temporal refusal):** "cancel all failed runs", "every day at 9…" → named-refusal statuses with the §6 reasons.
- **AC-G5 (resolution discipline):** resolver issues ≤4 read calls per parse; stale-sequence guard drops superseded resolutions (fixture with racing resolutions asserts only latest renders).

**Slice 2 — Palette integration.**
Small edit to `src/shell/command-palette.mjs`: Tab mode toggle, chip, delegation of Ask-mode input to the grammar, interpretation-card rendering in the results area, Enter hand-off to `executeAction()`. Concurrent-lane note: coder owns no palette files, but coordinate the diff landing (§9 R2).
- **AC-I1 (two-gate invariant):** automated DOM-free trace — for each mutating kind, the path input→execution passes through interpretation render AND the registry confirm mode; a fixture asserting `executeAction` is called exactly once per confirmed hand-off and zero times on dismissal (Esc/backdrop/toggle-away).
- **AC-I2 (misparse fail-safe):** wrong-interpretation fixture (utterance crafted to mis-slot) → interpretation card renders the WRONG-but-honest interpretation, zero non-GET requests fired (spy), dismissal leaves no state.
- **AC-I3 (NONE-mode shape):** `task.assign` utterance → interpretation card confirm fires the assign immediately (single gated click preserved); toast + tray receipt identical to button flow.
- **AC-I4 (HOLD parity):** `run.cancel` utterance → hold ring with 1.2 s threshold and Enter-hold keyboard parity; early release fires nothing (spy fixture).
- **AC-I5 (idempotency reuse):** network-timeout retry of a confirmed NL intent replays the SAME actionId (duplicate:true path, no double side effect — inherits §3.3 layer 1/2); deliberate repeat (re-type + re-confirm) mints a fresh actionId and executes again; same-actionId-different-params replay surfaces `stale_retry`. (These re-pin one-click-actions AC2–AC5 at the NL entry point.)
- **AC-I6 (query purity):** every query-intent fixture produces zero non-GET requests end-to-end.
- **AC-I7 (degradation):** no-database execute refusal surfaces the audit-first unavailable toast; unresolved-target utterance renders "couldn't verify target"; palette Esc during interpret/confirm leaves zero timers/fetches pending.

**Slice 3 — Docs + polish.**
user-guide "Ask bar (NL commands)" section (modes, examples table, safety story), views-reference shell-chrome note, api-reference untouched (no new endpoints), CHANGELOG.
- **AC-D1:** docs-drift-check exit 0; README app count still 35; grep proves no new route registrations in `task-server.js`.

Success metrics (wired to the impact-measurement loop):

- **Gated-path share (inherited metric):** NL bar should push the fraction of catalog-kind side effects arriving via `POST /api/actions` toward 100% — it adds a new front door to the same pipe.
- **Unmatched-rate (client-side debug counter, v1):** % of Ask-mode submissions ending unmatched — the honesty metric for grammar coverage; reviewed after two weeks of staging use to decide whether v2 (§4b) is warranted. Honest limitation: v1 has no server-side telemetry of NL origin (Q3); this counter is session-local diagnostics, not analytics.
- **Misparse-safety (binary, CI-pinned):** zero executions without confirmed interpretation — enforced by AC-I1/I2 forever, not just at launch.
- **Duplicate-side-effect rate (inherited):** must not regress vs button-only baseline; NL adds no new duplicate vector (AC-I5).

## Explicit Non-Goals (v1)

- **No voice input.**
- **No conversation memory / multi-turn context.** Every utterance parses standalone; no "yeah, that one" follow-ups. (Disambiguation within one utterance is in scope; cross-utterance state is not.)
- **No free-form config writes** — no budget edits, settings changes, snapshot restores, cron mutations; not catalog kinds, not proposed.
- **No task creation** until `task.create` joins the registry (Q1) — the flagship utterance degrades honestly until then (§5).
- **No batch/multi-target execution** — one envelope = one target, inherited verbatim.
- **No LLM parsing in v1** — grammar only; v2 endpoint sketched in §4, default-off when it lands.
- **No new windowed app, no new endpoints, no migrations** — palette chrome + existing machinery only.
- **No scheduling/temporal intents** — Cron view's job, refused with a pointer.

## Risks & Open Questions

- **R1 — Grammar rigidity disappoints.** Operators will type sentences the grammar refuses. Mitigation: unmatched state always degrades to useful search (never a dead end); synonym table grows from the unmatched-rate counter; v2 decision point after two weeks of staging data. Accepted risk: v1 under-covers rather than over-promises.
- **R2 — `command-palette.mjs` is shared shell surface.** The edit is small (toggle + delegation) but the file is load-bearing for every view. Mitigation: slice 1 lands grammar as an isolated module with its own DB-free suite first; palette diff is mechanical delegation; coordinate landing with the coder lane to avoid concurrent-edit collisions (their MCP slice 2 touches no shell files — verified against the work order).
- **R3 — Double-gate friction for frequent actions.** Interpretation card + PREVIEW_MODAL is two confirms for dispatch-class NL actions. Deliberate for v1 (misparse safety outranks speed while trust is young). Revisit with the cancel-regret/time-to-decision metrics from one-click-actions §6 before relaxing anything — relaxation would be a registry/one-click-actions revision, NOT an NL-bar local change (write-once rule).
- **Q1 — `task.create` as v1.1 registry extension?** Unlocks the roadmap's headline utterance end-to-end. Sketch: LOW-MEDIUM severity, PREVIEW_MODAL, paramsSchema `{title (required), project_id (required), owner?}`, executor composing existing `POST /api/tasks` + optionally chained `run.dispatch`. Needs CEO sign-off since it widens the frozen v1 catalog; zero changes to this brief's consumption either way.
- **Q2 — Should hint chips in query answers be v1 or v1.1?** Cheap (same hand-off path), but each chip is one more surface to test against AC-I1. Default: ship chips in v1 only if slice 2 lands with suite green in the same run; otherwise defer without ceremony.
- **Q3 — NL-origin telemetry.** Distinguishing NL-originated receipts needs either an envelope extension (origin field → registry change, touches paramsHash discipline) or a client-side SSE diagnostic event. Neither is v1. Owner decision requested before anyone "temporarily" hacks it into params.

## Related

- [One-click actions brief](one-click-actions.md) — §3 gating design consumed verbatim; §7 non-goal "no NL interface" satisfied by this brief being the designated consumer, not a fork
- [MCP exposure brief](mcp-exposure.md) — why MCP is the wrong backend for the bar (§1) and the v1.1 convergence path (§8 R2)
- [Roadmap review 2026-08-24b](roadmap-review-2026-08-24b.md) — fold 3: gating written once, NL consumes
- [UPGRADE_ROADMAP](../../UPGRADE_ROADMAP.md) — Phase 2 "Natural-language command bar"
