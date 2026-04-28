# scripts/ — Operational Scripts

## Purpose

CLI scripts for validation, diagnostics, and operational tasks. Run with `node scripts/<name>.js`.

## Ownership

| File | Owns |
|------|------|
| `dashboard-validation.js` | Validates config, connections, schema, and data integrity |
| `docs-drift-check.js` | Validates docs match source (app/widget counts, routes, migrations) |
| `seed-sample-data.js` | Seeds database with sample tasks, projects, agents |
| `check-env.js` | Checks environment variables and config |
| `sync-gateway-status.mjs` | Syncs gateway agent status to static JSON |
| `sync-models-catalog.js` | Syncs model providers to catalog JSON |

## Conventions

- Scripts exit with code 0 on success, 1 on error
- Scripts should be runnable without arguments (sensible defaults)
- Scripts should NOT require a running server (where possible)
- Output should be human-readable with emoji status indicators
