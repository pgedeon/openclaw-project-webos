# WebOS 2.0 Upgrade Roadmap

> Owner: CEO track. Driven by hourly OpenClaw cron. Baseline assessed 2026-08-23.
> Baseline: v1.0.0-rc.4, last push 2026-07-06, 34 stars, no CI, ~80 test files.

## Mission

Not a rewrite. Make the existing Win11-style WebOS **10x better** and the deepest
OpenClaw integration of any OpenClaw dashboard. Each phase ships user-visible wins.

## Phase 0 — Foundations (do first, ~1 week of hourly runs)

- [ ] **CI pipeline** (`.github/workflows/ci.yml`): lint + `node --test`/route tests on
      every push and PR. No CI exists today — nothing protects the codebase.
- [ ] **Fix test suite**: many tests are stubs or skipped. Get `npm test` green and
      meaningful; wire Playwright e2e into CI.
- [ ] **Security pass**: audit bearer-token auth across all 4 servers, path traversal
      guards in filesystem-api, secrets handling. Add `npm audit` to CI.
- [ ] **Version bump to 1.1.0** once Phase 0 lands. Update CHANGELOG + RELEASE.

## Phase 1 — Live OpenClaw Integration (the "stand out" core)

- [ ] **Gateway websocket bridge**: replace 20s polling (`realtime-sync.mjs`) with
      live push. Task moves, agent status, run state update instantly.
- [ ] **Live agent console**: stream agent stdout/tool-calls into a terminal window.
      Watch any OpenClaw agent work in real time from the desktop.
- [ ] **One-click agent actions** from any view: assign task → dispatch run → approve
      → publish, without leaving the window.
- [ ] **Session inspector**: browse OpenClaw sessions (`~/.openclaw`), replay a
      session transcript in a window.
- [ ] **Memory browser 2.0**: graph view of agent memories, semantic search already
      exists — add timeline + cross-agent links.

## Phase 2 — Killer Features (things no other dashboard has)

- [ ] **Mission Control view**: single command center — fleet status, blocked runs,
      stale runs, cron health, cost estimate. One glance = whole system state.
- [ ] **Natural-language command bar**: type "spawn agent for X, report when done"
      → creates task + dispatches workflow. Uses the existing command palette (Ctrl+K).
- [ ] **Workflow visual editor**: drag-and-drop DAG builder for workflow runs
      (extends existing workflows + routing views).
- [ ] **Cost & token analytics**: per-agent, per-task, per-department token/cost
      rollups from run data. Sparkline widgets already exist — feed them this.
- [ ] **Snapshot/restore**: one-click full-state export (tasks + runs + config) and
      restore. Builds on export-routes.

## Phase 3 — Polish & Reach

- [ ] **PWA install**: manifest + service worker hardening. Desktop app feel.
- [ ] **Multi-user presence**: cursors/presence when operators share a dashboard.
- [ ] **Theme engine**: user themes, dark/light already exists — add accent packs.
- [ ] **Perf**: virtualized lists for large boards, lazy view loading.
- [ ] **Docs site**: GitHub Pages from `docs/`, screenshots refreshed.

## Working Rules for the Hourly Cron

1. Pick the highest unchecked item. One coherent change per run.
2. Respect `AGENTS.md` rules: no frameworks, no build step, update matching docs
   in the same change, sequential migrations.
3. Run `npm run validate` + relevant tests before pushing. Never push red.
4. Commit format: `feat|fix|chore: <area> — <what>`. Push straight to `main`.
5. Tick the box here when done, note anything learned in CHANGELOG.
6. If blocked (no DB, no OpenClaw gateway locally), do the offline-safe part
   (tests, docs, frontend with mocks) and note the blocker in CHANGELOG.
