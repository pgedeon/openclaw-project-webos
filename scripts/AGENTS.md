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
