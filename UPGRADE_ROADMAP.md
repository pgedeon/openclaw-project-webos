# WebOS 2.0 Upgrade Roadmap

> Owner: CEO track. Driven by hourly OpenClaw cron. Baseline assessed 2026-08-23.
> Baseline: v1.0.0-rc.4, last push 2026-07-06, 34 stars, ~80 test files.
> Revised 2026-08-23 after advisory memo from OpenClaw main agent (post-mortem of
> the dead webos-auto-improve.py pipeline + codebase landmines).
> Evidence base: docs/research/market-scan-2026-08-23.md (competitive landscape,
> 18 platforms scanned) + docs/research/market-scan-2026-08-24.md (24h delta refresh:
> FleetQ/Mission Control quiet; Paperclip 79k★ ships budget hard-stops + approval
> governance at scale; LoopX receipts pattern).

## Mission

Not a rewrite. Make the existing Win11-style WebOS **10x better** and the deepest
OpenClaw integration of any OpenClaw dashboard. Each phase ships user-visible wins.
Shape that worked (April R2: 12 items shipped in a day): small scoped changes,
test-backed, sequential merges. Reject big-bang items.

## Why the last automation died (never repeat)

`webos-auto-improve.py` v4 died July 2026: `UnboundLocalError` in one script was a
single point of failure; its three-strike halt only wrote a JSON note while the cron
kept firing into August. Lessons baked into Working Rules below:
delegate to agents (no SPOF script), halt must disable the trigger, escalate loudly.

## Phase 0 — Foundations

- [x] **CI pipeline** (`.github/workflows/ci.yml`): lint + `node --test`/route tests on
      every push and PR. Shipped 2026-08-23 (8751775): syntax check + docs drift +
      33 DB-free tests; remaining suite still needs "Fix test suite" below.
- [x] **Fix test suite**: many tests are stubs/skips or reference files missing from
      the repo (31 currently excluded in CI — see ci.yml header). Get `npm test`
      green and meaningful; wire Playwright e2e into CI.
      Shipped 2026-08-23 (6696196): triaged all 31 CI-excluded tests — 3 fixed,
      20 deleted (pre-shell-era/phantom targets), 8 skip gracefully with clear
      `SKIP:` reasons. Shipped 2026-08-23 (a99385b): Playwright e2e wired into
      CI as a separate `e2e` job — chromium-only DB-free smoke suite against
      task-server.js in json_snapshot mode; storage-CRUD e2e replaced by smoke
      suite (CRUD needs real PostgreSQL); restored missing
      `storage/asana-json-snapshot.js`. Fixed 2026-08-23 (86c5ffb): grant the
      runner user traverse access to /root so it can read the staged assets.
- [x] **Cost/token schema now** (advisory: only item where waiting destroys data):
      migration adding per-run token/cost columns + backfill from gateway data where
      available. No UI yet — analytics in Phase 2 needs this history accumulating.
      Shipped 2026-08-23 (88abe97): migration `022_add_run_token_cost_tracking.sql`
      adds token/cost columns to `workflow_runs`; minimal usage helpers in
      `storage/asana.js`. Backfill from historical gateway data still open.
- [x] **Security pass**: audit bearer-token auth across all 4 servers (each has its
      own), path traversal guards in filesystem-api, secrets handling. Add `npm audit`
      to CI. Advisory: no cheapest-model lane for this work; careful agent + review.
      Shipped 2026-08-23: full audit of all 4 servers (2aa7333 →
      SECURITY-AUDIT-2026-08.md; 11 findings: 2 critical, 3 high, 3 medium, 3 low)
      + fixes ba4ffa8 (F1-F4), c11bfba (F6-F8), 758323f (F9-F11), 2a34d1d
      (F5: standalone filesystem API bearer auth, Host/Origin allowlists,
      JSON-only mutations, crontab/.ssh/sessions write refusal); CVE-2026-44240
      dependency fix in 1eb8137. All 11 audit findings closed. Remaining
      hardening (advisory, not an audit finding): `npm audit` not yet a CI gate.
- [x] **Version bump to 1.1.0** once Phase 0 lands. Update CHANGELOG + RELEASE.
      Done 2026-08-23: released 1.1.0 (CHANGELOG section added; RELEASE.md carries
      no version line, nothing to update).
- [x] **Cost/token history backfill** (promoted from prose inside the cost-schema
      box, review 2026-08-24): backfill `workflow_runs` token/cost columns from
      historical gateway data where available. Without it the Mission Control cost
      panel and anomaly flag 4 stay near-empty for a week. Small, one run.
      Shipped 2026-08-24 (12f7115): `scripts/backfill-run-costs.js` reads exact
      per-message usage from session JSONL transcripts (CLI/status and state sqlite
      carry no per-run split), joins via `gateway_session_id` session key →
      sessions.json → transcript files, sums only inside each run's window,
      never invents prices (`cost_estimate` stays NULL without a price source),
      idempotent + dry-run default. First live `--apply` run: considered 22,
      matched 0, updated 0 — honest zero: every session-bound run predates
      gateway transcript retention (oldest surviving transcript 2026-07-25;
      runs are March–May 2026; most bindings were monitor `spawned-*` pid
      strings, never real session keys). Aggregation itself verified end-to-end
      against a live session. Migration 022 was found unapplied on this machine
      and applied before the run.
- [ ] **`npm audit` as CI gate** (promoted from prose inside the security-pass box,
      review 2026-08-24): advisory leftover from the closed security pass; add to
      `.github/workflows/ci.yml`. Small, one run.

## Phase 1 — Live OpenClaw Integration (the "stand out" core)

- [x] **Mission Control view** (pulled forward per advisory): read-only aggregation —
      fleet status, blocked/stale runs, cron health, cost estimate. Cheap, huge daily
      value, watches the hourly automation itself. Ships on polling; upgrades to WS later.
      Market scan 2026-08-23: include run-anomaly flags (stale heartbeat, zero-token
      loops) — top steal across AgentOps/FleetQ. Build per docs/briefs/mission-control.md.
      Done 2026-08-24: part 1 (112b224) — six-panel skeleton + `routes/cost-routes.js`
      `GET /api/costs/summary`; part 2 (0a667ab) — Win11 visual pass (no hscroll at
      1180×780, distinct loading/empty/error states per panel, cost panel separates
      "no data yet" from "no database"), named anomaly-threshold constants with
      justification comments pinned by boundary fixtures in tests/test-cost-routes.js,
      thresholds note in docs/views-reference.md.
- [x] **Gateway websocket bridge**: replace 20s polling (`realtime-sync.mjs`) with live
      push. LANDMINE: gateway is loopback-bound (`wss://127.0.0.1:18789`) inside WSL2 —
      browser-to-gateway direct breaks remotely. Pattern: one backend subscribes to the
      gateway server-side, fans out to browsers over its own WS/SSE. Token stays
      server-side. Replace polling behind a flag; keep fallback; reconnect/backoff;
      multi-tab fanout. Review 2026-08-24: evaluate SSE-first fanout before raw WS —
      task-server already ships an auth-hardened SSE event-stream route (F7);
      run the streaming verification spike (live console item) BEFORE this build.
- [x] **Budget ledger + auto-pause** (pulled forward from Phase 2 per market scan
      2026-08-24: Paperclip made per-agent budgets with hard-stop enforcement table
      stakes at 79k★ scale): per-agent/task budget rows over the shipped cost schema,
      dispatch-time check, pause + notify on breach via existing approvals/pause
      machinery. Depends on the Phase 0 cost/token backfill checkbox landing first.
      Shipped 2026-08-24: slice 1 model+API 0a1ed9b (migration 023, budgets API,
      pure eval), slice 2 dispatcher enforcement 420758b (scope-chain evaluation,
      idempotent events, fail-open), slice 3 surfacing d276068 (latched SSE
      budget:breach fan-out, Mission Control budget bars + budget_breach flag,
      notification-center breach entries). Slice 4 management window stays the
      §6 fast-follow go/no-go.
- [x] **Live agent console**: stream agent output/tool-calls into a terminal window. Shipped 2026-08-24: implementation 83919c4, validated against live gateway (docs/research/console-validation-2026-08-24.md) — tool-start/output/end frames, per-session filtering, secret redaction all confirmed.
- [x] **Session replay inspector**: browse OpenClaw sessions, replay a transcript in a
      window with a time-travel stepper over tool-call events (prev/next/jump, payload
      inspection) — pattern proven by AgentOps/Mission Control (market scan 2026-08-23).
      Promoted above one-click actions (review 2026-08-24): read-only, rides on the
      already-shipped session-reader routes, no gating design needed.
      Shipped 2026-08-24: backend reader + routes 49eef27, inspector view a26c0cc —
      scrubber + ←/→/Home/End stepper, as-of-t chat pane, expandable tool calls with
      exitCode badges from persisted details, cached on-demand full-output fetch,
      virtualized rail (bounded DOM at 10k+ events), partial/truncated banners;
      registered under Work (34 windowed apps).
- [x] **One-click agent actions** from any view: assign task → dispatch run → approve
      → publish, without leaving the window. Needs its own brief first (action set,
      confirmation UX, idempotency) — none exists yet; the "write it during bridge/console
      runs" window closed 2026-08-24 without producing one, so the brief is now the item's
      critical path (review 2026-08-24b: docs-lane run immediately; collides with nothing).
      Brief must include protected-action preview + receipts per market scan 2026-08-24
      (LoopX pattern: typed preview, explicit confirmation, receipt appended to audit trail)
      AND define the confirmation/idempotency/receipt machinery that the Phase 2 NL command
      bar reuses — gating design is written once, here.
      Shipped 2026-08-24: server core 98efb8d (migration 024 receipts, action registry,
      POST /api/actions/execute latch-first idempotency + budget probe, GET /api/actions/recent)
      + view wiring afa7ba0 (slice 2: src/shell/action-client.mjs severity-mapped confirmations —
      NONE / PREVIEW_MODAL / HOLD_CONFIRM 1.2 s with keyboard Enter-hold parity, budget-blocked
      amber banners, outcome toasts; gated buttons in tasks-view (task.assign), agent queue
      rows (run.dispatch template picker), approvals-view (approval.decide + Cancel→Delete R2
      relabel), workflows-view run rows (run.cancel hold + run.redispatch); Recent-actions
      tray as shell chrome ⚡ taskbar popover polling /recent on open — app count frozen at 34;
      tests/test-action-client.js DB-free suite 47/47). Remaining (non-blocking): slice 3
      surfacing per brief §6 — action-update SSE emission, workflows-view budget strip,
      Mission Control budget-events line.
- [ ] **Memory browser 2.0**: graph/timeline view of agent memories + cross-agent links
      (semantic search already exists). Graph-first per market scan rec #5; designated
      filler run when DB-dependent items are blocked (working rule 8). FLEX per review
      2026-08-24b: stays a Phase 1 filler box but does NOT block Phase 2 start — lowest
      daily-value item in phase; parity can trail.

## Phase 2 — Killer Features (things no other dashboard has)

- [x] **Cost & token analytics UI**: per-agent/task/department rollups over the Phase 0 schema. Fleet-level landed as side effect of Mission Control + costs summary; per-agent rollup endpoint (`GET /api/costs/rollup?group_by=`) + sparkline widget shipped 2026-08-24 (32a0a3d). Budget ledger component pulled forward to Phase 1 (market scan 2026-08-24) — shipped separately (023 + slices 1-2).
- [ ] **MCP server exposure** (added per market scan 2026-08-23): wrap existing REST
      routes as MCP tools so OpenClaw agents can read tasks/runs/metrics directly in
      their tool loop; read-only tool set first, write actions behind approval gates.
- [ ] **Natural-language command bar**: type "spawn agent for X, report when done"
      → creates task + dispatches workflow. Extends existing Ctrl+K palette. MANDATORY
      confirmation gate before side-effectful actions (spawn/dispatch/approve); no
      free-form config writes.
- [ ] **Workflow visual editor — staged** (demoted per advisory): Stage 1 = read-only
      graph render of existing workflows. Drag-drop editing only if Stage 1 earns use.
      Hardest item under the no-frameworks rule.
- [x] **Snapshot/restore**: one-click full-state export (tasks + runs + config) and
      restore. Builds on export-routes. Shipped through slice 3 2026-08-24: pure libs
      (0efa391), five endpoints (slice 2), settings-view panel + staging verification
      (f8c1af7) — live at http://192.168.0.81:8120/ (Settings → Snapshots & Restore).

## Phase 3 — Polish & Reach

- [ ] **PWA install**: manifest + service worker hardening. Desktop app feel.
- [ ] **Theme engine**: user themes, dark/light already exists — add accent packs.
- [ ] **Perf**: virtualized lists for large boards, lazy view loading.
- [ ] **Docs site**: GitHub Pages from `docs/`, screenshots refreshed.
      CUT per advisory: multi-user presence (single-operator reality, high complexity).

## Working Rules for the Hourly Cron

1. Pull latest main first — cron and humans share one branch; never race it.
2. Pick the highest unchecked item. One coherent change per run. Small scoped diffs;
   reject big-bang items.
3. Respect `AGENTS.md` rules: no frameworks, no build step, update matching docs
   in the same commit (CI docs-drift check goes red otherwise), sequential migrations.
4. Any feature touching PostgreSQL must degrade gracefully with no DB reachable,
   or hourly runs go red.
5. Verify before push: `npm run validate` + relevant tests. Never push red (CI now
   enforces).
6. Commit format: `feat|fix|chore|ci|docs: <area> — <what>`. Push straight to `main`.
7. Tick the box here when done, note anything learned in CHANGELOG `## Unreleased`.
8. If blocked (no DB locally, gateway unreachable, streaming not exposed): do the
   offline-safe part (tests, docs, frontend with mocks) and note the blocker.
9. Escalation: if the same item fails 3 runs in a row, STOP and report to the operator
   in the final message instead of retrying silently. A halted automation must say so
   visibly, not just in a log file.
10. Hygiene: never commit screenshots/binary dumps casually; `npm ci` not `npm install`
    in scripts; never force-push or rebase published history.
