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
      hardening complete: `npm audit` prod-deps gate live in CI since d6a0a22 (critical level; tightening path documented in workflow).
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
- [x] **`npm audit` as CI gate**: shipped 2026-08-24 (d6a0a22) — prod-deps audit at critical level in the `verify` job; tightening path documented in workflow comment.

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
- [x] **Memory browser 2.0**: graph/timeline view of agent memories + cross-agent links
      (semantic search already exists). Graph-first per market scan rec #5; designated
      filler run when DB-dependent items are blocked (working rule 8). FLEX per review
      2026-08-24b: stays a Phase 1 filler box but does NOT block Phase 2 start — lowest
      daily-value item in phase; parity can trail.
      Shipped 2026-08-25 (053adfa): src/shell/native-views/memory-browser-view.mjs —
      timeline mode (client-side dated-entry parsing, newest-first) + cross-agent link
      chips (@mentions / roster names / shared run-task-session ids, click-to-filter)
      + semantic search kept primary + fixed-row virtualized rail reused from session
      replay + zero-throw unavailable/empty/partial states. Registered BESIDE v1 memory
      view (35th app) — v1 keeps the write surface. DB-free suite 51/51; staging-verified
      on :8120. Graph rendering beyond the chip/link model remains open if wanted —
      timeline-first shipped per scheduled brief.

## Phase 2 — Killer Features (things no other dashboard has)

- [x] **Cost & token analytics UI**: per-agent/task/department rollups over the Phase 0 schema. Fleet-level landed as side effect of Mission Control + costs summary; per-agent rollup endpoint (`GET /api/costs/rollup?group_by=`) + sparkline widget shipped 2026-08-24 (32a0a3d). Budget ledger component pulled forward to Phase 1 (market scan 2026-08-24) — shipped separately (023 + slices 1-2).
- [x] **MCP server exposure** (added per market scan 2026-08-23): wrap existing REST
      routes as MCP tools so OpenClaw agents can read tasks/runs/metrics directly in
      their tool loop; read-only tool set first, write actions behind approval gates.
      Shipped through slice 2 2026-08-25: stdio core + 10 read-only tools (ebe3169),
      mutating trio behind OPENCLAW_MCP_MUTATIONS=1 with receipt-minted mutations via
      the actions pipeline (ee17ea0, OQ2 = YES). Staging validation live against
      http://192.168.0.81:8120/ (json_snapshot mode): flag-on initialize → 13 tools →
      create_task → structured 503-mapped isError {error:'unavailable',reason:'no_database'}
      with the loop surviving; flag-off → 10 tools, trio hidden, call → -32601.
- [x] **Natural-language command bar**: type "spawn agent for X, report when done"
      → creates task + dispatches workflow. Extends existing Ctrl+K palette. MANDATORY
      confirmation gate before side-effectful actions (spawn/dispatch/approve); no
      free-form config writes.
      Shipped 2026-08-25 (7f5fd5f) per docs/briefs/nl-command-bar.md: Ctrl+K Ask mode
      (Tab toggle) over a deterministic client-side grammar — five gated intents through
      the UNCHANGED executeAction() registry tiers (NONE/PREVIEW_MODAL/HOLD_CONFIRM),
      mandatory interpretation card before anything executes, inline GET-only query
      answers, named refusals for batch/temporal/config-writes. Flagship utterance
      honestly scoped v1: task creation is not yet a catalog kind, so "spawn agent for
      X" refuses with task_create_unavailable + Tasks deep link until task.create joins
      the registry (brief Q1). Staging-verified live at http://192.168.0.81:8120/
      (health 200 json_snapshot; grammar + palette modules served).
- [x] **Workflow visual editor — staged**: Stage 1 shipped 2026-08-25 (7769c7a) — read-only SVG chain graph w/ earn-use telemetry (opens + 👍/👎 to audit_log). Brief found NO DAG in data: all 29 templates are linear chains, so vertical chain render is the honest form. Drag-drop GO/NO-GO decision ~2026-09-14 after the 21-day telemetry window.
      Stage 1 SHIPPED 2026-08-25 (7769c7a): read-only SVG chain graph in the
      Workflows trigger panel (Graph toggle; latest-run status colors, node detail
      cards, 32-step cap) + earn-use telemetry POST /api/workflow-graph/events
      (one open event per view-session + 👍/👎 feedback chip → audit_log rows).
      Box ticked for Stage 1 shipping; the GO/NO-GO decision itself remains OPEN
      (review #3 correction — earlier text claimed the box would stay unticked,
      but it was ticked when Stage 1 landed): GO = ≥8 distinct render-days AND
      ≥3 explicit asks for editing; NO-GO (<4 days AND zero asks) closes
      drag-drop and keeps the read-only view (run-mode status coloring retains
      standalone monitoring value). Clock starts at staging deploy; decision
      ~2026-09-14 — see docs/briefs/roadmap-review-2026-08-25.md §5 for the
      telemetry-counter recommendation.
- [x] **Snapshot/restore**: one-click full-state export (tasks + runs + config) and
      restore. Builds on export-routes. Shipped through slice 3 2026-08-24: pure libs
      (0efa391), five endpoints (slice 2), settings-view panel + staging verification
      (f8c1af7) — live at http://192.168.0.81:8120/ (Settings → Snapshots & Restore).
      Debt D3 hardened 2026-08-25 (ea7b21f): deny-regex widened from `\b…\b` to
      lookaround boundaries — underscore-attached secret names (`db_password`,
      `access_token`, `SECRET_KEY`) now redact in JSONB cells too; staging :8120
      re-deployed + health-gated (served lib bytes md5-identical).

## Phase 3 — Polish & Reach

- [x] **PWA install**: manifest + service worker hardening. Desktop app feel.
      Shipped 2026-08-25 (feat 206aaa8): manifest.webmanifest (name "OpenClaw
      Desktop", start_url /, display standalone, theme/background #0f172a = base
      dark desktop gradient color) with real 192px + 512px PNG icons generated by
      the zero-dependency scripts/generate-pwa-icons.mjs (pure-Node PNG encoder);
      sw.js versioned cache openclaw-desktop-v1 — cache-first ONLY for the static
      allowlist (/src/, /lib/, /icons/, manifest), network-first navigation with
      cache fallback, /api/* never cached, skipWaiting + clients.claim + old-cache
      purge on activate; registration in index.html fires only AFTER auth
      bootstrap resolves (unauthenticated installs can never cache the gate page);
      task-server.js explicit routes: manifest application/manifest+json
      max-age=3600, sw.js no-cache + Service-Worker-Allowed:/, icons long cache.
      Tests: tests/test-pwa-install.js 14 DB-free checks registered in
      ci-db-free-tests.js (56/56); node --check clean; docs-drift-check green
      (0 errors). Docs: user-guide "Install as a Desktop App (PWA)". Deployed to
      dashboard staging per DEPLOY-POLICY Amendment 10 via
      scripts/dashboard-staging-deploy.sh — verified live at
      http://192.168.0.81:8120/ (health 200 json_snapshot; manifest 200
      application/manifest+json; sw.js 200 no-cache; icons 192/512 200 image/png;
      served index carries SW registration).
- [x] **Theme engine**: user themes, dark/light already exists — add accent packs.
      Shipped 2026-08-25 (feat 0fd43a7): 5 built-in packs (default blue, teal, violet,
      amber, rose) as CSS custom-property overrides layered ON TOP of the base theme
      (src/styles/win11-accents.css — light `[data-accent]` blocks + higher-specificity
      `[data-theme="dark"][data-accent]` compounds, so every pack is valid in both
      modes); pure helper src/shell/accent-packs.mjs (ACCENT_PACKS/resolveAccent/
      readStoredAccent/storeAccent, zero-throw invalid→default); persistence via
      localStorage `openclaw.accent` applied before first paint (module-eval apply in
      shell-main.mjs + pre-paint inline script in index.html); taskbar tray palette
      icon opens a swatch popover (win11-taskbar__accent-picker). Tests:
      tests/test-accent-packs.js 20 checks registered in ci-db-free-tests.js (55/55);
      docs-drift-check green; staging-verified live at http://192.168.0.81:8120/
      (health 200 json_snapshot; teal click → #60cdff→#45d1d6 dark / #038387 light;
      persists across reload; stored garbage value falls back silently to default).
- [x] **Perf**: virtualized lists for large boards, lazy view loading.
      (feat/perf 5b99efd, 2026-08-25) Verified lazy view loading was already in
      place — app-registry.mjs stores viewModule as static string paths and
      window-manager.mjs dynamic-import()s each on first window mount, so the
      boot graph stays 20 local ES modules regardless of the 35 registered
      views (41 .mjs files under native-views/); no eager→lazy conversion was
      needed. Virtualized the two largest lists with the capped-render +
      "load more" pattern (variable-height rows — wrapping chips/word-break
      titles and a DnD drop zone rule out session-replay's fixed-row rail):
      tasks-view renders the first 100 filtered rows (+100 per click),
      board-view the first 50 cards per column (+50 per click), with dropped/
      rolled-back cards always revealed above their column cap. Shared pure
      math extracted to src/shell/list-window.mjs (visibleWindow moved there
      verbatim from session-replay-view.mjs which re-exports it; cappedWindow/
      growCap new), covered by tests/test-list-window.js 17 checks registered
      in scripts/ci-db-free-tests.js — suite now 57/57; node --check clean;
      docs-drift-check green; import smoke = all 35 registry viewModules +
      shell core import cleanly in Node (no circular-import breakage). Docs:
      development.md "Performance Notes" (static boot-module counts only — no
      synthetic benchmarks), shell-architecture.md "Lazy View Loading" section.
      Deployed to dashboard staging per DEPLOY-POLICY Amendment 10 via
      scripts/dashboard-staging-deploy.sh — verified live at
      http://192.168.0.81:8120/ (health 200 json_snapshot; /src/shell/list-window.mjs
      and the touched view modules serve 200 on demand; served tasks-view
      carries LIST_INITIAL_CAP).
- [x] **Docs site**: LIVE https://pgedeon.github.io/openclaw-project-webos/ — Actions-based Pages deploy from main /docs (Jekyll), generated index (scripts/build-docs-index.mjs, 41 docs grouped), 8 top-level screenshots regenerated against staging :8120. Shipped 2026-08-25 (6ae7bb6+5b99efd).
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
   Attribution trailer (D2 convention, adopted 2026-09-06): when the commit
   author identity does not name the human or agent who did the work (the WSL
   clone shares one git identity across lanes), append an `Assisted-by: <who>`
   trailer to the commit body — e.g. `Assisted-by: coder` for agent-built work
   pushed by the CEO, `Assisted-by: qa-auditor`, or `Assisted-by: CEO` for
   orchestrator-finished items. Agent sessions committing their own work
   append their own agent id. One trailer, plain text, no sign-off syntax —
   the goal is greppable attribution, not ceremony.
7. Tick the box here when done, note anything learned in CHANGELOG `## Unreleased`.
8. If blocked (no DB locally, gateway unreachable, streaming not exposed): do the
   offline-safe part (tests, docs, frontend with mocks) and note the blocker.
9. Escalation: if the same item fails 3 runs in a row, STOP and report to the operator
   in the final message instead of retrying silently. A halted automation must say so
   visibly, not just in a log file.
10. Hygiene: never commit screenshots/binary dumps casually; `npm ci` not `npm install`
    in scripts; never force-push or rebase published history.

## Post-2.0 Candidates (2.1 planning)

> Added by roadmap review #3 (docs/briefs/roadmap-review-2026-08-25.md,
> 2026-08-25): top-3 of five scored candidates. `[candidate]` items are
> proposals, not commitments — CEO picks before any build starts.

- [x] **[candidate] Workflow data normalization migration** — repair the
      `timed_out` CHECK-constraint violation (migration 021) and lift 14/29
      string-only template steps to object steps. Highest leverage debt (review
      #3 D1): unblocks visual-editor Stage 2, fixes live constraint violations,
      makes run-status monitoring and MCP run tooling honest. Pure backend.
      Shipped 2026-08-25 (CHANGELOG Unreleased): migration
      `025_add_workflow_normalization.sql` widens the `workflow_steps.status`
      CHECK to the documented 14-value set (step lifecycle ∪ migration-021 run
      statuses incl. `timed_out`) with matching `updateStep` validation, and
      idempotently backfills string-only `workflow_templates.steps` to the
      canonical object shape (`normalizeTemplateSteps()` also runs on writes so
      rot cannot re-accumulate). Both halves of this candidate are done;
      visual-editor Stage 2's data blocker is cleared pending the telemetry GO.
- [x] **[candidate] NL command bar closes flagship gap** — add `task.create`
      to the action registry (kind + governance rule + executor over existing
      store.createTask) so "spawn agent for X" executes instead of refusing
      with task_create_unavailable. Reuses gating/receipt machinery unchanged.
      Shipped 2026-08-25 (CHANGELOG Unreleased): registry gained task.create in
      the MCP slice 2 work (LOW/NONE tier, governance rule, executor), and
      `lib/nl-parse.js` now maps create-class verbs ("spawn/create/add/new …
      task/agent for …") to a real task.create envelope with verbatim title
      extraction — no-title utterances still degrade honestly to search.
- [x] **[candidate] Budget management window (slice 4)** — create/edit budgets
      UI over the shipped budgets API; completes the cost-governance loop
      (budgets currently exist but are unmanageable from the dashboard).
      §6 fast-follow go/no-go already scheduled this. Shipped 2026-08-25
      (b6ff36a): `budgets` app — 36th windowed app, Operations category
      (`src/shell/native-views/budgets-view.mjs`) with create/edit/deactivate +
      per-budget ledger drawer over the shipped API; tests/test-budgets-view.js
      18 checks (suite 59/59); deployed to staging :8120 with post-verify.
      Candidate CLOSED — budget-ledger brief defines four slices, all shipped;
      no slice 5 exists (roadmap review #4).
- [x] **[candidate] Task ↔ session conversation binding** — added per market
      scan 2026-08-25b steal #2 (Paperclip made chat-style tasks their default
      UX): task detail gains a Conversation tab embedding the bound gateway
      session transcript through the ALREADY-SHIPPED session-reader routes and
      replay-view components. Read-only first; no new write path; rides the
      existing task↔session binding instead of inventing a chat store.
      SHIPPED 2026-08-26 (4805e3e): Sessions rows gained an inline Conversation
      expand/collapse rendering assistant/user bubbles + tool badges through
      GET /api/oc/sessions/:sessionId/events (~200-event initial cap, cursor
      "load more"); pure mappers in lib/task-conversation.js, tests
      test-task-conversation.js 19 checks (ci-db-free-tests 64/64); deployed to
      staging :8120 post-verify (served lib/task-conversation.js md5-identical,
      health 200 storage_type postgres, unauth /api/tasks 401, PWA gates green).
      Candidate CLOSED.
- [x] **[candidate] Remote-access recipe via tailnet HTTPS** — added per market
      scan 2026-08-25b steal #1 (Paperclip v2026.824.0 managed-runtime previews):
      document + optionally script a `tailscale serve` exposure of the dashboard
      (staging slot first) for signed HTTPS phone/remote access — kills the
      loopback landmine for operators away from the LAN with ZERO new network
      binds. Docs/runbook-first; code only if serve proves insufficient.
      Documentation half SHIPPED 2026-08-25 (10a3bdc recipe + 444255a changelog,
      docs/remote-access.md, linked from README): verified-pattern-pending-
      rollout — recon confirms tailscale is NOT yet installed on the dev
      machine. Rollout (install + serve exposure) awaits OWNER order; see
      Post-2.0 Steady State watch-list below.
- [ ] **[candidate] Structured handoff briefs over the task↔session binding** —
      added per market scan 2026-09-05 steal #2 (Mission Control PR #956 proposes a
      `handoff_briefs` object with producer/consumer semantics + MCP trio, unmerged):
      a structured handoff payload (from/to session, decisions made, key context,
      next steps, open questions, consumed_at) written at session end and consumed
      at session start, riding the existing task↔session binding and session-reader
      routes instead of inventing a chat store. TRIGGER-GATED: do not build before
      Mission Control #956 merges to main (design may churn); on merge, the MCP
      create/get/consume trio maps onto our MCP server slice pattern.
      See docs/research/market-scan-2026-09-05.md.
- [ ] **[candidate] MCP approval elicitation via SEP-2322** — added per market
      scan 2026-08-30 steal #3 (FleetQ #148 migrated its approval gate to MRTR
      elicitation, Aug 29): HOLD-tier MCP mutation requests surface a native
      approval prompt in the MCP client (SEP-2322 elicitation round-trip) instead
      of a hidden refusal, while receipts and the envelope path stay unchanged.
      PROPOSAL ONLY — not scheduled; needs a protocol-fit check against our stdio
      JSON-RPC server's hidden-not-refused contract before any build.
      Fit check 2026-08-30: CONDITIONAL — see
      docs/research/sep2322-protocol-fit-2026-08-30.md; do not build before
      OpenClaw's MCP client declares elicitation support and renders prompts to the
      operator (today it auto-answers elicitation/create with -32601), and then only
      with an owner-approved visible-but-gated reshape that revises hidden-not-refused.

## Post-2.0 Steady State

> Added by roadmap review #4 (docs/briefs/roadmap-review-2026-08-25b.md,
> 2026-08-25): the operating mode for the period after the roadmap board
> emptied and debt D1/D3/D4 cleared. This section documents MODE and a
> WATCH-LIST only — no new committed feature promises.

### Operating mode (decided 2026-08-25, pending owner cron switch)

The hourly cron's sprint job is done (127 commits in ~2.5 days; 23/23 items;
2.0.0 released). Recommended steady state: **twice-daily runs** (~08:30 and
~17:30 Europe/Berlin) working a pull-based queue, in order:

1. Sync + gates — pull main; CI/drift green or the red is the run's whole job.
2. DAG telemetry readout — `npm run dag:telemetry`, verdict logged in run
   notes until the 2026-09-14 decision.
3. Community PR review — same-day turnaround for external PRs (anupamme
   cadence).
4. Dependency watch — ONE designated run per week: `npm outdated` + prod-deps
   audit review (first queued outcome: ws ≥8.20.2 non-breaking bump).
5. Scoped work items — only what a review brief or the owner queued.
   **An empty queue is a valid outcome; inventing work is not.**

Restore hourly/higher cadence ONLY on trigger: an approved new-chapter brief,
a DAG **GO** verdict (~2026-09-14), or an external PR backlog >2. Working
rules #1–#10 above carry over verbatim.

Autonomous-vs-owner split at decision time (review #4 §3): security
tightening run (ws bump → puppeteer-core@25 → audit gate to high) and the D5
benchmark harness proceed AUTONOMOUSLY; task↔session conversation binding is
the top remaining FEATURE but needs the owner chapter pick before a planner
brief; NL v2 LLM parsing needs an owner cost/posture call; tailnet rollout
needs an owner order; workflow normalization follow-ups are blocked on the
DAG decision; budget slice 5 does not exist (all four brief slices shipped).

### Watch-list (dated, not promised)

- **DAG GO/NO-GO ~2026-09-14** — mechanical per telemetry counter
  (`scripts/dag-telemetry-counter.js`): GO = ≥8 render-days AND ≥3 asks in
  the 2026-08-25→2026-09-14 window; NO-GO = <4 days AND 0 asks; else middle.
  On GO: visual-editor Stage 2 becomes buildable (normalization data blocker
  already cleared by migration 025). Window opened today at 0 rows.
- **Tailnet rollout pending owner** — docs shipped (docs/remote-access.md);
  tailscale NOT installed on dev machine; install + `tailscale serve`
  exposure is an owner hardware/network call.
- **D5 benchmarks deferred-by-design** — CLOSED 2026-08-29: `scripts/perf-benchmark.mjs` (`npm run perf`) ships the scripted Playwright timing harness per review #3's fix shape — boot-to-interactive, tasks-view first meaningful render, capped-list "load more" growth, median of 3 cold runs, JSON output to gitignored `perf-results.json`. Manual per release, never CI-blocking, not registered in ci-db-free-tests; numbers live only in harness output, never in docs (they rot).
- **Staging deploy-script observation** — restart robustness fixed 2026-08-25
  (5301ce5 detached successor + health gate) after instability; healthy since
  (watch window closed 2026-09-06, no recurrence across ~12 days and many
  redeploys; removed from watch).
- **CHANGELOG `[Unreleased]` lane-collision repair** — duplicated sections
  deduplicated 2026-08-25 (review #4 R1); no duplication recurrence since.
  The D2 `Assisted-by:` trailer convention was ADOPTED 2026-09-06 as
  working rule 6's attribution trailer (see above) — commit-level attribution
  is now greppable even though the WSL clone shares one git identity across
  agent lanes.
