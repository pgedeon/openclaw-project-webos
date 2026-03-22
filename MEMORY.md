## Coding Workflow

- Use coding-agent Codex CLI skill for code generation
- Use gemini skill as fallback for complex/uncertain tasks

## Operational Notes

- Dashboard health: `bash scripts/dashboard-health.sh check`
- Restart server: `bash scripts/restart-task-server.sh`
- Smoke test: `bash scripts/smoke-test-dashboard.sh`
- Validate API: `node scripts/dashboard-validation.js`
- Cron manager auto-restarts keepalive servers every 2 minutes
- `heartbeat_cron_guard.py` monitors cron job health and escalates persistent failures

## Lessons Learned

- **Cron logPath resolution**: Relative log paths in cron commands must be resolved against `WORKSPACE`, not `LOGS_DIR` — otherwise double paths like `logs/logs/file.log` occur
- **`.env` parsing**: When `.env` uses `export KEY=value`, parsers must strip the `export ` prefix before key lookup
- **Cron keepalive logs**: Keepalive cron entries that only log on restart (not on health check) will appear stale to the heartbeat guard — always include a "healthy" echo
- **Secret management**: Never commit credentials to git; use `.env.secrets` locally and `git filter-repo` to scrub history
