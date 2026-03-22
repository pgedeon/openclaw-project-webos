# MEMORY.md - OpenClaw Project Dashboard

## Architecture

- **WebOS Desktop Shell** — Win11-style SPA served from `index.html`
- **API Server** — `task-server.js` on port 3876
- **Storage** — PostgreSQL (`mission_control` database)
- **Cron Manager** — `cron-manager-server.mjs` on port 3878
- **Memory API** — `memory-api-server.mjs` on port 3879
- **Gateway Integration** — `gateway-workflow-dispatcher.js`, `sync-gateway-status.mjs`

## File Structure

```
task-server.js              # Main API server
cron-manager-server.mjs     # Cron monitoring API (:3878)
memory-api-server.mjs       # Memory endpoints (:3879)
gateway-workflow-dispatcher.js
workflow-run-monitor.js
workflow-runs-api.js
schema/openclaw-dashboard.sql
schema/migrations/          # Database migrations
src/shell/                  # Desktop shell (Win11 UI)
  native-views/             # All view modules (board, agents, operations, etc.)
  widgets/                  # Widget system
  offline/                  # IndexedDB + sync
  styles/                   # Win11 CSS theme
scripts/                    # Health, validation, restart scripts
tests/                      # Unit + integration tests
docs/                       # API docs, guides, screenshots
```

## Key Views

| View | File | Description |
|------|------|-------------|
| Board | `board-view.mjs` | Kanban task board |
| Tasks | `tasks-view.mjs` | Full task management |
| Agents | `agents-view.mjs` | Agent fleet status |
| Operations | `operations-view.mjs` | System health, cron, diagnostics |
| Workflows | `workflows-view.mjs` | Workflow engine |
| Handoffs | `handoffs-view.mjs` | Timeline + handoff tracking |
| Cron | `cron-view.mjs` | Cron job management |
| Memory | `memory-view.mjs` | Memory system browser |
| Timeline | `timeline-view.mjs` | Task timeline |
| Approvals | `approvals-view.mjs` | Approval queue |
| Skills & Tools | `skills-tools-view.mjs` | Skill/tool browser |

## Credentials

All credentials stored in `.env.secrets` (not in repo):
- `MOLTBOOK_API_KEY` — Moltbook API for NullPicturesHelper agent
- `MOLTBOOK_CLAIM_URL` — Moltbook claim endpoint
- `MOLTBOOK_VERIFICATION_CODE` — Moltbook verification
- `WP_NULL_APP_PASSWORD` — WordPress null.pictures app password

## External Services

### WordPress — null.pictures
- Username: pgedeon
- Password: see `.env.secrets` (`WP_NULL_APP_PASSWORD`)
- On fail: write article to file, notify user via WhatsApp

### Blogger — Null Pictures
- Address: https://nullpictures-art.blogspot.com/
- Purpose: Promote nullpictures.etsy.com
- Auth: `blogger-oauth-config.json`

### Moltbook — NullPicturesHelper
- Profile: https://moltbook.com/u/NullPicturesHelper
- API Key: see `.env.secrets`
- Tasks: Post Etsy marketing tips, engage community

### 3dput.com — Filament Settings Web App
- Plugin: FSW installed and active
- API: `/wp-json/fsw/v1/selectors`
- Auth: WordPress application password (`WP_APP_PASSWORD` env var)

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
