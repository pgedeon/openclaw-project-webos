# Changelog

All notable changes to the Project Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.3] – 2026-03-21

### Added
- **Windows 11-style Desktop Shell**: Complete webOS with taskbar, start menu, window manager, draggable/resizable windows, theme toggle (dark/light), system tray clock, and keyboard shortcuts.
- **Native View System**: Operations, Agents, Tasks, Workflows, Health, Approvals, Memory, and Departments views — all render natively inside desktop windows (no iframes).
- **Widget System**: Extensible widget framework with panel, card, and inline variants. Includes department status, MOTD, and health status widgets with a registry for custom widget creation.
- **Approval Workflow UI**: Cards with Approve/Reject actions, notes, agent status tracking, Execute button for approved runs, details panel for completed runs, and follow-up prompt injection. Added delete/dismiss with confirmation for all approval states.
- **Gateway Workflow Dispatcher**: Spawns sub-agents via `sessions_spawn` to execute approved workflow runs, with session tracking and heartbeat monitoring.
- **System Improvement Scanner**: Daily automated scan (6 categories: artifact contracts, workflow health, cron health, site health, template coverage, approval gaps) with 20h dedup and approval-gated workflow creation.
- **Workflow Run Lifecycle**: Input validation, timeout handling, session cleanup, queued→running state transitions, and run artifact management.
- **Playwright E2E Test Suite**: 33 tests covering desktop shell, start menu, window manager, native views, keyboard shortcuts, and error handling.

### Changed
- **Full desktop webOS replaces legacy dashboard**: The monolithic single-page dashboard is gone. The shell, views, and widgets are modular ES6 imports.
- **Approvals view simplified**: Removed escalate, 5-filter dropdown, dense metadata grid, overdue badges. Streamlined to title→description→status→actions. Default filter shows only active items.
- **Artifact contract enforcement**: POST `/api/workflow-templates` auto-injects artifact contracts; `createRun` backfills templates missing contracts.
- **21→29 workflow templates** updated with complete artifact contracts including URL fields for auto-extraction.

### Removed
- Legacy dashboard HTML, backup files, and monolithic integration module.
- Benchmark labs, download-gcode.php, and stale backup artifacts from earlier versions.
- `_legacy-archive/` directory excluded from repo (still available locally).

### Security
- Removed hardcoded database passwords from all source files. PostgreSQL credentials now require `POSTGRES_PASSWORD` environment variable.
- Replaced internal IP addresses in `models-catalog.json` with `localhost` placeholder.
- Runtime state files (`gateway-status.json`, `task-server.pid`) excluded from version control.
- Backup files (`*.bak`, `*.backup`) excluded from version control.

## [1.2.0-rc.1] – 2026-02-28

### Added
- **Frontend-Database Sync Phase 1**: Real-time sync between IndexedDB and PostgreSQL backend with conflict resolution.
- **Memory Query System**: Semantic vector search with local CPU embeddings (all-MiniLM-L6-v2), BM25 hybrid search, and auto-tagging.
- **API Contract Shape Tests**: Verification tests for payload consistency between frontend and backend.

## [1.1.1] – 2026-02-16

### Fixed
- Task edit/toggle 400 errors caused by incorrect sync payload schema.
- Server startup path issues after directory consolidation.
- Duplicate history assignment in PATCH operations.

## [1.1.0] – 2026-02-15

### Added
- Keyboard shortcuts help modal (`?` key) with focus trapping and ARIA attributes.
- Performance monitor panel (`Ctrl+Shift+P` or `#perf`).
- Enhanced toolbar filters: My tasks, Overdue, Blocked, No due date.
- Board View integration with lazy loading.
- Agent View for task queue monitoring with claim/release actions.
- Dashboard health monitoring via cron (`scripts/dashboard-health.sh`).
- Expanded task edit form with status, priority, owner, dates.
- Debounced autosave with backup rotation and corruption recovery.
- Cron Job visibility and management view.

### Improved
- Modular ES6 frontend architecture (replaced 1663-line inline script).
- Persistent sync error banner with retry capability.
- Dashboard UI accessibility: skip links, ARIA labels, focus management.
