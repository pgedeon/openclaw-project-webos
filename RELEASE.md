# Release Candidate v2.0.0-rc.2 – 2026-03-08

## Summary

This release candidate advances the packaged dashboard beyond the initial standalone export. It adds the new `/agents` workspace, carries over the latest project/task UX improvements, and updates the package metadata so the release artifacts include the full multi-page dashboard.

## Highlights

- Dedicated `/agents` workspace with live agent floor view, focus panel, and presence filters
- Improved project workspace panel and richer task/task-edit UX
- Task composer with agent and preferred-model assignment
- OpenClaw-aware `/api/task-options` and agent heartbeat/status surfaces
- Better filter correctness, subtask visibility, and stats consistency
- Package contents updated to include `agents.html`, `src/agents-page.mjs`, and `sw.js`

## Release Artifacts

- Git tag: `v2.0.0-rc.2`
- Default branch target: `main`
- Repository target: `github.com/pgedeon/openclaw-project-dashboard`

## Validation

- `node --check task-server.js`
- `node --check src/dashboard-integration-optimized.mjs`
- `node --check src/agents-page.mjs`
- `bash -n scripts/dashboard-health.sh`
- `bash -n scripts/restart-task-server.sh`
- `node scripts/dashboard-validation.js`
- Live health check at `http://localhost:3876/api/health`

## Migration Notes

No schema migration was added for this RC. Existing dashboard databases remain compatible.

## Install References

- [docs/install-openclaw.md](docs/install-openclaw.md)
- [docs/install-standalone.md](docs/install-standalone.md)
