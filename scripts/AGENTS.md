# scripts/ — Operational Scripts

## Purpose

CLI scripts for validation, diagnostics, and operational tasks. Run with `node scripts/<name>.js`.

## Ownership

| File | Owns |
|------|------|
| `dashboard-validation.js` | Validates config, connections, schema, and data integrity |
| `docs-drift-check.js` | Validates docs match source (app/widget counts, routes, migrations) |
| `schema-drift-check.js` | Two-tier schema drift guard: schema_migrations tracking table (numbered) + information_schema/pg_indexes object probes (date-prefixed + untracked numbered) |
| `seed-sample-data.js` | Seeds database with sample tasks, projects, agents |
| `check-env.js` | Checks environment variables and config |
| `sync-gateway-status.mjs` | Syncs gateway agent status to static JSON |
| `sync-models-catalog.js` | Syncs model providers to catalog JSON |
| `perf-benchmark.mjs` | Manual D5 timing harness (Playwright; boot-to-interactive, tasks-view first render, capped-list load-more). NOT a test, NOT CI-blocking, NOT registered in ci-db-free-tests |

## Conventions

- Scripts exit with code 0 on success, 1 on error
- Scripts should be runnable without arguments (sensible defaults)
- Scripts should NOT require a running server (where possible)
- Output should be human-readable with emoji status indicators


## Workboard & approval rules (CEO seat, 2026-09-02 — BINDING)

> Canonical source: `/root/.openclaw/workspace/AGENTS.md` (WSL) §0 + §6a. This block applies the same rules to every agent/subagent session working in this folder.

- **All work goes through the OpenClaw workboard** (home.3dput.com/openclaw/workboard): card first — claim → heartbeat → proof → complete/block. No card, no work. Check the board for blockers before starting any task, even message-assigned work.
- **Never close a card with a raw status move** (`workboard move --status done` or any script equivalent) — it permanently flags the card "Done card has no proof". Finish through `workboard_complete` (auto-attaches the summary as proof), or attach `workboard_proof` first. Scripts and cron jobs that close their own run cards must use their agent tools, never a shelled-out move-to-done.
- **Executable cards are never parent-linked** to program umbrella cards parked in backlog (they become undispatchable — the board blocks todo→ready while a linked parent isn't done). Program umbrellas keep pointers in notes only. Long-running live-trackers carry the `live-tracker` label.
- **Operational approvals go to the CEO seat** via a `ceo-decision`-labeled workboard card (decision, options, evidence, recommendation) — never WhatsApp the owner, never park a needed ruling silently in a report. If it sits >24h, mark it `waiting:owner` with one line to the owner. Owner-reserved (never agent/CEO-ruled): money & spending, account credentials/invitations, backlink outreach sends, any production write outside the daily release train (Amendment 10), amendment changes, hiring/org structure, new-site GO/no-GO, legal positions.
- **Staging only** — the daily release train is the sole production writer (Amendment 10). Work on staging ports; prod changes ship exclusively via the train.

<!-- ceo-workboard-rules-20260902 -->
