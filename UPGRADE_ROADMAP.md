# WebOS 2.0 Upgrade Roadmap

> Owner: CEO track. Driven by hourly OpenClaw cron. Baseline assessed 2026-08-23.
> Baseline: v1.0.0-rc.4, last push 2026-07-06, 34 stars, ~80 test files.
> Revised 2026-08-23 after advisory memo from OpenClaw main agent (post-mortem of
> the dead webos-auto-improve.py pipeline + codebase landmines).

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
- [ ] **Fix test suite**: many tests are stubs/skips or reference files missing from
      the repo (31 currently excluded in CI — see ci.yml header). Get `npm test`
      green and meaningful; wire Playwright e2e into CI.
- [x] **Cost/token schema now** (advisory: only item where waiting destroys data):
      migration adding per-run token/cost columns + backfill from gateway data where
      available. No UI yet — analytics in Phase 2 needs this history accumulating.
      Shipped 2026-08-23 (88abe97): migration `022_add_run_token_cost_tracking.sql`
      adds token/cost columns to `workflow_runs`; minimal usage helpers in
      `storage/asana.js`. Backfill from historical gateway data still open.
- [ ] **Security pass**: audit bearer-token auth across all 4 servers (each has its
      own), path traversal guards in filesystem-api, secrets handling. Add `npm audit`
      to CI. Advisory: no cheapest-model lane for this work; careful agent + review.
- [ ] **Version bump to 1.1.0** once Phase 0 lands. Update CHANGELOG + RELEASE.

## Phase 1 — Live OpenClaw Integration (the "stand out" core)

- [ ] **Mission Control view** (pulled forward per advisory): read-only aggregation —
      fleet status, blocked/stale runs, cron health, cost estimate. Cheap, huge daily
      value, watches the hourly automation itself. Ships on polling; upgrades to WS later.
- [ ] **Gateway websocket bridge**: replace 20s polling (`realtime-sync.mjs`) with live
      push. LANDMINE: gateway is loopback-bound (`wss://127.0.0.1:18789`) inside WSL2 —
      browser-to-gateway direct breaks remotely. Pattern: one backend subscribes to the
      gateway server-side, fans out to browsers over its own WS/SSE. Token stays
      server-side. Replace polling behind a flag; keep fallback; reconnect/backoff;
      multi-tab fanout.
- [ ] **Live agent console**: stream agent output/tool-calls into a terminal window.
      First verify what the gateway actually exposes for streaming (likely
      permission-gated); mock-first until confirmed.
- [ ] **One-click agent actions** from any view: assign task → dispatch run → approve
      → publish, without leaving the window.
- [ ] **Session inspector**: browse OpenClaw sessions, replay a transcript in a window.
- [ ] **Memory browser 2.0**: graph/timeline view of agent memories + cross-agent links
      (semantic search already exists).

## Phase 2 — Killer Features (things no other dashboard has)

- [ ] **Cost & token analytics UI**: per-agent/task/department rollups over the Phase 0
      schema. Sparkline widgets already exist — feed them this.
- [ ] **Natural-language command bar**: type "spawn agent for X, report when done"
      → creates task + dispatches workflow. Extends existing Ctrl+K palette. MANDATORY
      confirmation gate before side-effectful actions (spawn/dispatch/approve); no
      free-form config writes.
- [ ] **Workflow visual editor — staged** (demoted per advisory): Stage 1 = read-only
      graph render of existing workflows. Drag-drop editing only if Stage 1 earns use.
      Hardest item under the no-frameworks rule.
- [ ] **Snapshot/restore**: one-click full-state export (tasks + runs + config) and
      restore. Builds on export-routes.

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
