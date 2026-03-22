# Release Notes

## v2.0.0-rc.2 — 2026-03-22

### What's New

- **Win11 Desktop Shell** — Complete rewrite as a desktop-style SPA with draggable windows, taskbar, start menu, and widget panel
- **25 Native Views** — Board, Tasks, Agents, Operations, Workflows, Handoffs, Timeline, Memory, Cron, Approvals, Diagnostics, Metrics, and more
- **Widget System** — Desktop widgets: system health, error feed, cron countdown, agent fleet, approval queue, clock, and more
- **Workflow Engine** — Template-based workflow runs with queue, blocker classification, approvals, and artifact storage
- **Cron Manager** — Dedicated API for monitoring cron jobs with log viewing and manual triggers
- **Offline Support** — IndexedDB-backed state with background sync and retry logic
- **Security** — Secret scanning and redaction pipeline, QMD security module
- **Agent Integration** — Bidirectional OpenClaw gateway bridge for agent heartbeat and task reporting

### Migration from Previous Versions

The dashboard was previously a multi-page app (`dashboard.html`, `agents.html`, `operations.html`). All functionality has been consolidated into the single-page desktop shell.

The main entry point is now `index.html`. The shell loads all views dynamically via ES modules.

### Repository

https://github.com/pgedeon/openclaw-project-webos

### License

MIT
