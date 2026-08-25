# Design Brief — Workflow Visual Editor, Stage 1 (Read-Only Graph Render)

**Status:** Draft for build review · **Roadmap:** Phase 2 (UPGRADE_ROADMAP.md "Workflow visual editor — staged", demoted per advisory): Stage 1 = read-only graph render of existing workflows; drag-drop editing ONLY if Stage 1 earns use. Hardest item under the no-frameworks rule — this brief's job is to make Stage 1 cheap, honest, and measurable so the earn-use decision is data-driven, not vibes.
**Evidence base:** verified in-repo and against the live `mission_control` Postgres 2026-08-25: `src/shell/native-views/workflows-view.mjs` (template cards + trigger panel + recent-runs list, deep-link `params.runId`, cancel/redispatch row actions), `src/shell/native-views/workflow-routing-view.mjs` (agent-routing admin table — separate concern, not graph data), `workflow-runs-api.js` (GET `/api/workflow-runs?workflow_type=&limit=` filters; GET `/api/workflow-runs/:id` returns run + `template_steps` + ordered `workflow_steps` rows + artifacts + approvals; GET `/api/workflow-templates/:name`; template regex `[a-z0-9-]+`), `src/shell/api-client.mjs` (`workflows.runs/get/template/templates` already cover every read), `src/shell/native-views/session-replay-view.mjs` (house pattern: pure exported helpers unit-tested DB-free in `tests/test-session-replay-view.js`, fixed-row virtualization, zero-throw named empty states), `schema/migrations/001_add_workflow_runs.sql` (`workflow_templates.steps` JSONB array; `workflow_steps.step_order`), live DB inspection (queries + results quoted in §1). Review pinning: `docs/briefs/roadmap-review-2026-08-24.md` ("Stage 1 read-only render is the right ceiling under the no-frameworks rule") and `-24b.md` §6.5 ("WILLING-CUT … read-only graph render is eye-candy next to MCP depth").
**Order:** this commit is docs only — no `.js/.mjs/.sql/.yml` changes. Concurrent-lane guard: coder is building the NL command bar (`lib/nl-parse.js`, `command-palette.mjs`, `tests/test-nl-parse.js`) — the build phase of THIS brief must not touch any of those files; its only shared-file edits are `app-registry.mjs` (+1 entry) and a small `workflows-view.mjs` cross-link (§7 R2).

---

## 1. Honest Assessment First — What Real Stored Workflows Actually Look Like

The roadmap calls this item "hardest under no-frameworks" because it implies a DAG renderer. **The data does not contain a DAG.** Verified directly against the live database:

| Question | Answer (evidence) |
|---|---|
| How many active templates? | **29** (`SELECT count(*) FROM workflow_templates WHERE is_active`) |
| Steps per template? | min **3** (wordpress-publish), max **10** (citation-improvement), median **5** |
| What keys do step objects have? | **Exactly three**: `name`, `display_name`, `required` — `SELECT DISTINCT k FROM workflow_templates, jsonb_array_elements(steps) step, jsonb_object_keys(step) k` returns nothing else. Zero `depends_on`, zero branch/condition/parallel fields anywhere in schema or data |
| Do all templates even use objects? | **No — 14 of 29 templates store steps as plain strings** (e.g. topic-discovery: `["Analyze existing content inventory", "Identify content gaps", …]`). Any renderer must accept `string \| {name,…}` entries |
| Are runs linear? | Yes. `workflow_steps.step_order` is dense 0..N−1 per run (largest runs: exactly 10 rows, orders 0–9). Execution model is "current step pointer walks an ordered list" (`workflow_runs.current_step`), not a scheduler over edges |
| Run volume? | **53 runs total**, 376 step rows. This is a low-traffic, single-operator system |
| Status vocabulary quirks? | Observed run statuses include **`timed_out`, which violates the table's own CHECK constraint** (001 lists 8 legal values). Renderers must tolerate unknown status strings as a fact of life, not an edge case |

**Conclusion the brief commits to:** every real workflow is a **linear chain of 3–10 steps**. A general-purpose DAG renderer with force layout, edge routing, or pan/zoom would be over-engineering for data that cannot express an edge. Stage 1 should render an honest vertical step chain — which is what the data IS — while keeping the door open for edges at near-zero cost (§4). If someone wants branching workflows later, the honest sequencing is: add `depends_on` to the template schema FIRST, then extend the renderer — never build layout machinery ahead of storage.

## 2. Render Approach Under No-Frameworks

| Criterion | SVG | Canvas | Positioned divs |
|---|---|---|---|
| Click/hover per node | Native DOM events per element ✅ | Manual hit-testing (bbox math per node) ❌ | Native ✅ |
| Text rendering & wrapping | Native `<text>`, crisp at any zoom ✅ | Manual metrics, blurry without DPR handling ❌ | Native ✅ |
| Edges/arrows | `<path>` + marker, same coordinate space ✅ | Full manual draw ❌ | Needs an SVG overlay anyway → two coordinate systems ❌ |
| A11y / tooltips / focus | Real elements, title/focus work ✅ | One opaque bitmap ❌ | Real elements ✅ |
| DOM cost at large N | Degrades past ~hundreds of nodes ⚠️ | Excellent ✅ | Degrades similarly ⚠️ |
| Code size, no libraries | Small (~100 lines view-side) ✅ | Medium (hit-test + DPR + redraw loop) ❌ | Small but connector math duplicated ❌ |

**Pick: SVG for v1.** Decisive factors: N is ≤10 nodes per workflow (§1), the UX spec requires click→detail-card semantics (§5), and edges must coexist with text in one coordinate space. Canvas wins only at N in the hundreds+, which this dataset will not reach (53 runs total since inception). Positioned divs lose because connectors force an SVG layer regardless — paying for both worlds. This is browser-native SVG via DOM APIs; no library, charter-compliant.

## 3. Layout Algorithm

One pure function covers today's reality and tomorrow's possibility:

- **`layoutLayered(graph)`** — longest-path layering: `rank(n) = 0` for sources, else `1 + max(rank(pred))`. Ranks stack top→bottom; nodes within a rank spread horizontally. A **linear chain degenerates to one node per rank = a plain vertical list** — so there is no separate "linear fallback code path"; the fallback IS the algorithm's output on linear input. Cycle guard (visited set → cycle edges ignored, flagged in output) keeps it total.
- Estimated ~60 lines, pure (no DOM/network/fs), exported for DB-free tests like session-replay's helpers.
- Node geometry: fixed box size (e.g. 220×44 px) so the math stays closed-form, mirroring session-replay's fixed-row-height discipline.
- Viewport handling: the graph sits in a scroll container. **No zoom/pan in v1** — at ≤10 nodes nothing overflows a 1120×760 default window; if a future template exceeds ~14 steps, scrolling beats zoom for honesty (you can't miss the bottom of a scroll).

## 4. Data Contract

**No new read endpoints.** Everything needed exists:

| Need | Endpoint (existing) | Notes |
|---|---|---|
| Template structure | `GET /api/workflow-templates/:name` → `{steps:[…]}` | Client `api.workflows.template(name)` exists |
| Latest run for status colors | `GET /api/workflow-runs?workflow_type=<name>&limit=1` | Filter verified at workflow-runs-api.js:3295 |
| Run-mode full detail | `GET /api/workflow-runs/:id` → run + `template_steps` + ordered `workflow_steps` rows | Client `api.workflows.get(id)` exists |
| Template picker | `GET /api/workflow-templates` | Already loaded by workflows-view |

Client-side assembly (pure, tested): `buildGraph(template)` normalizes steps — accepting object entries `{name, display_name?, required?}` AND plain strings (14/29 real templates require this, §1); unknown-shaped entries become `(unnamed step N)` nodes rather than exceptions. Edges are consecutive pairs `i → i+1`. If a future schema adds `depends_on`, `buildGraph` prefers explicit deps over consecutive order — one `if`, specified now so Stage 2 doesn't redesign the contract.

**Merging run status:** key `workflow_steps` rows by `step_name` onto template structure (`mergeRunStatus(templateSteps, runSteps)`); missing rows → `pending`; unknown statuses (observed: `timed_out`) → neutral gray badge with the raw string shown verbatim — never guessed into a legal bucket.

**Size caps:** render capped at 32 nodes (largest real = 10; cap is 3× headroom); beyond it, truncate with an honest amber banner "showing first 32 of N steps". Run detail card truncates `output` previews at ~400 chars with "load full" deferred (v1: no loader — show truncated honestly).

**Graceful degradation matrix (house contract):**

| Condition | Behavior |
|---|---|
| Template 404 / empty steps | Named empty state ("Template has no steps"), never blank |
| API unreachable | Error state with Retry; graph frame still renders |
| Steps are strings / mixed shapes | Normalized per §4 — this is the COMMON case, not the edge case |
| Unknown run status string | Neutral badge, raw text preserved |
| Instrumentation endpoint absent (staging/no-DB) | Open/feedback events fail silently (fire-and-forget), UI unaffected |

**One optional new write endpoint (instrumentation only):** `POST /api/workflow-graph/events` body `{kind:'open'|'feedback', workflow_ref?, mode?, verdict?, note?}` appending an `audit_log` row (actor `dashboard-operator`, action `workflow-graph-open` / `workflow-graph-feedback`, pattern per export-routes.js INSERT). ~30 server lines; fire-and-forget from the client; feeds §6 metrics. Without it, earn-use has no signal and the go/no-go defaults back to vibes — that is why it is in-scope despite "read-only": it writes an audit row, it never touches workflow state.

## 5. UX

Two modes, one view:

1. **Template mode** (default): pick template (searchable dropdown fed by `workflows.templates()`) → vertical chain renders top→bottom in execution order. Node = rounded rect: type icon + `display_name` (or normalized string) + `required` dot (accent = required, gray = optional, matching workflows-view's existing convention). Edges = simple vertical connectors with arrowheads. Neutral node fill — a template has no runtime truth to colorize.
2. **Run mode** (deep-link `#runId=…`, and cross-linked from workflows-view run rows): same chain, nodes colorized from the latest/most-recent matching run's step rows — green completed, blue in_progress, red failed, gray pending/skipped, neutral+raw-text unknown (e.g. `timed_out`). Header shows run id, status badge, owner agent, started/finished. Reuses workflows-view's badge palette for visual continuity.
3. **Click node → detail card** docked beside/below the graph (no modal): step config summary — name, display name, required, order position; run mode adds status, started/finished timestamps, `error_message` (full, red block), truncated `output` preview.
4. **Type icons:** derived from step-name keyword table (publish→🚀, review/qa→🔍, image→🖼, test→✅, fetch/download→⬇, fix/deploy→🔧…); unmatched → generic ◇. Table lives in the pure helper `stepIcon(name)` so mapping is testable and honest (no pretending an icon implies semantics the schema doesn't carry).
5. Entry points: app-registry window ("Workflow Graph"); workflows-view template card gains a small "graph" affordance; workflows-view run row click currently navigates to agent/task — ADD a secondary graph affordance rather than changing existing behavior.

Non-interaction invariant: nothing in the view mutates workflow state. The only POST is the §4 instrumentation event.

## 6. Earn-Use Metrics (the Stage 2 go/no-go is THIS, not vibes)

Instrumentation: one `open` event per view-session (first successful render), plus the explicit feedback chip in the view footer: "Should editing happen here? 👍 / 👎 + optional note" writing `workflow-graph-feedback` audit rows. Review #2 called Stage 1 potential eye-candy; these numbers settle it:

| Metric | Source |
|---|---|
| Distinct days with ≥1 graph render | count(distinct date(timestamp)) on `workflow-graph-open` audit rows |
| Template vs run mode split | `mode` field on open events |
| Explicit demand for editing | 👍 feedback rows (+ notes) |

**Decision rule, evaluated 21 days after staging deploy:**

- **GO (build Stage 2 drag-drop editing):** ≥8 distinct days with ≥1 render AND ≥3 explicit 👍/written asks for editing. Two signals required — usage alone can be curiosity; asks alone can be one bad day.
- **NO-GO (close the item):** <4 distinct days with any render AND zero explicit asks → annotate the roadmap checkbox "Stage 1 shipped; editing demand not demonstrated", keep the read-only view (it costs nothing and run-mode status coloring retains standalone value), close drag-drop.
- **Middle:** numbers go to the next roadmap review verbatim; decision recorded there. No re-litigating without new data.

Secondary read (informs Stage 2 SHAPE if GO): if run-mode opens dominate template-mode opens, Stage 2 effort should tilt toward run inspection/re-dispatch affordances rather than structure editing — operators may want graph eyes on executions, not a template editor.

## 7. File Plan

| File | Change | Conflict risk |
|---|---|---|
| `src/shell/native-views/workflow-graph-view.mjs` | **NEW** (~400 lines est.): view + exported pure helpers `buildGraph`, `layoutLayered`, `mergeRunStatus`, `stepIcon` | None (new file) |
| `src/shell/app-registry.mjs` | +1 entry (id `workflow-graph`, category System, 1120×760) — 36th windowed app | Low; coder lane owns command-palette internals, not registry |
| `src/shell/native-views/workflows-view.mjs` | Small cross-link edits: template-card graph affordance + run-row graph button (§5.5) | Low-moderate — file recently touched by one-click actions slice 2; coordinate landing, keep diff <20 lines |
| `tests/test-workflow-graph-view.js` | **NEW**: DB-free suite mirroring test-session-replay-view.js style | None |
| `scripts/ci-db-free-tests.js` | Register suite | Low |
| routes (task-server wiring for `POST /api/workflow-graph/events`) | New route per §4, documented in api docs | Coordinate — routes/ touched by action/export lanes; small isolated handler |
| Docs: `docs/views-reference.md` (+section, TOC), README app count 35→36, api docs (events route), CHANGELOG | Standard | Low |

New-view-over-extend rationale: workflows-view.mjs is already 485 lines with three concurrent lanes touching it; a separate view isolates the experiment that might get cut (review -24b §6.5 willing-cut) — deleting a self-contained view is trivial, unwinding embedded graph code from workflows-view is not. Earn-use counting also benefits: distinct app opens are unambiguous.

## 8. Acceptance Criteria (qa-auditor test script)

- **AC1 — buildGraph totality:** accepts object steps, plain-string steps (fixture: real topic-discovery 6-string array), mixed, empty, null → correct nodes/edges or named empty; NEVER throws. String fixture yields 6 nodes, 5 consecutive edges.
- **AC2 — layoutLayered:** linear chain → single column, ranks 0..n−1 (this is the ALL-REAL-DATA case); synthetic `depends_on` branching fixture → longest-path ranks correct (diamond: ranks 0,1,2,1→max path honored); injected cycle → terminates, cycle flagged, no hang.
- **AC3 — mergeRunStatus:** statuses keyed by step_name onto template order; missing rows → pending; `timed_out` → neutral badge with verbatim label; latest-run-wins on duplicate names.
- **AC4 — caps:** 40-step synthetic template renders 32 + amber truncation banner stating true total.
- **AC5 — degradation:** template 404, API down, empty-steps → each shows its named state; retry works; zero console errors (zero-throw house rule).
- **AC6 — interactions:** click node → detail card with config summary; run mode adds status/error/output-truncated; deep-link `#runId=` lands colored run graph; template↔run switching preserves selection context where sensible.
- **AC7 — read-only invariant:** network monitor across full happy-path session shows GETs only, EXCEPT the single instrumentation POST; no mutation UI anywhere in the view.
- **AC8 — instrumentation:** open event fires once per view-session; feedback chip writes verdict+note; both silently no-op when endpoint absent (staging json_snapshot mode).
- **AC9 — hygiene:** DB-free suite green in ci-db-free-tests; docs-drift-check green (0 errors); `node --check` clean on all edited JS; README/views-reference counts consistent.

## 9. Non-Goals v1

- **NO editing, NO drag-drop, NO add/remove/reorder step UI** — that is Stage 2, gated on §6.
- **NO live status animation / auto-refresh polling** — manual refresh only; runs change slowly (53 total).
- **NO zoom/pan** — scroll container suffices at N≤10 (§3).
- **NO multi-workflow overview canvas** — one workflow per render; a fleet graph is a different (and unjustified-by-data) feature.
- **NO DAG-specific visual language** (swimlanes, edge labels, conditional branches) — data cannot express them (§1).
- **NO new frontend dependencies** — hand-rolled SVG, charter-compliant.
- **NO run-history diffing** (compare run A vs B overlays) — noted as possible Stage 2+ only if §6 secondary signal demands it.

## 10. Risks & Open Questions

**Risks:**
- **R1 — Eye-candy risk is real, not hypothetical:** review -24b §6.5 pre-designated this item first willing-cut. Mitigation: this brief caps Stage 1 at ~1 builder run INCLUDING instrumentation; the §6 rule converts "nice graph" into a falsifiable claim within 21 days.
- **R2 — Shared-file edits during NL-bar lane:** workflows-view.mjs + app-registry.mjs edits must land coordinated; keep diffs minimal and mechanical (§7).
- **R3 — Schema debt surfaced:** `timed_out` violating the CHECK constraint and 14/29 string-only step arrays are pre-existing inconsistencies the renderer tolerates but a Stage 2 editor could NOT (editing requires canonical shapes). Flag to CEO: Stage 2 GO implies a template-schema normalization migration comes first.
- **R4 — Instrumentation endpoint is new write surface:** scoped to audit_log appends, no workflow-state access; still gets auth + drift documentation like every route.

**Open questions (CEO/owner, blocking nothing in Stage 1):**
- **Q1:** If §6 yields NO-GO, is the read-only view retained permanently (recommended: yes — run-mode status coloring has standalone monitoring value) or removed with the roadmap checkbox?
- **Q2:** Should the 21-day evaluation clock start at staging deploy or prod release-batch arrival? (Recommended: staging deploy — matches how memory-browser/NL-bar validation was measured.)
- **Q3:** For Stage 2 GO, is template editing through a graph UI worth a governed action kind (`template.update`) via the existing envelope path, or does template JSON editing in the existing admin surface suffice? Decision deferrable until §6 resolves.
