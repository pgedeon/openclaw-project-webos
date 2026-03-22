# Batch A Sprint Backlog

## Sprint Goal

Stabilize the dashboard shell before adding more surfaces:

1. replace the brittle inline view switch with a real registry
2. repair broken `memory` and `audit` routing
3. start extracting embedded views out of `src/dashboard-integration-optimized.mjs`
4. add regression checks so future view additions do not silently disappear

## Tickets

### A-01: View Router Stabilization

**Files**
- `dashboard.html`
- `src/dashboard-integration-optimized.mjs`
- `src/view-registry.mjs`
- `tests/test-view-router.js`

**Work**
- Replace the current `if/else` view switching block with a registry-driven dispatcher.
- Remove the duplicate empty `memory` and `audit` branches that currently swallow those views.
- Make view-button state depend on the active routed view instead of trusting stale state.
- Keep existing list, board, timeline, agent, cron, and business views working.

**Acceptance Criteria**
- Clicking `Memory` renders the memory view instead of a blank panel.
- Clicking `Audit` renders the audit view instead of a blank panel.
- Unknown view ids fall back to list view with an operator notice.
- `tests/test-view-router.js` passes.

### A-02: Extract Support Views

**Files**
- `src/dashboard-integration-optimized.mjs`
- `src/views/support-views.mjs`
- `tests/test-view-router.js`

**Work**
- Move the lightweight support views out of the monolith:
  - memory summary
  - lead handoffs
  - cross-board dependencies
  - health
  - runbooks
- Keep rendering behavior intact while fixing the current missing project-id helper issue in memory and handoff views.
- Centralize health-view timer cleanup so background refresh does not survive view switches.

**Acceptance Criteria**
- The extracted support views are rendered through module exports, not inline functions in the main integration file.
- Memory and handoff views resolve the active project from `project_id`.
- Health auto-refresh is cleared on view switch.
- `node --check src/views/support-views.mjs` passes.

### A-03: Navigation Readability Pass

**Files**
- `dashboard.html`
- `src/dashboard-integration-optimized.mjs`

**Work**
- Replace the current icon-only view strip with labeled controls.
- Group views into at least `Work`, `Operations`, and `Admin`.
- Preserve existing `data-view` hooks so tests and routing keep working.

**Acceptance Criteria**
- Every top-level view button is readable without relying on emoji.
- Navigation still routes using existing `data-view` ids.
- The toolbar remains usable on narrow widths.

### A-04: Extract Heavy Embedded Views

**Files**
- `src/dashboard-integration-optimized.mjs`
- `src/views/departments-view.mjs`
- `src/views/service-requests-view.mjs`
- `src/views/approvals-view.mjs`
- `src/views/artifacts-view.mjs`
- `src/views/metrics-view.mjs`
- `src/views/skills-tools-view.mjs`
- `src/views/publish-view.mjs`

**Work**
- Move the large business and operations surfaces out of the main integration file.
- Standardize each extracted module on a small render context interface.
- Keep existing behavior unchanged while shrinking the main file into orchestration logic.

**Acceptance Criteria**
- The main integration file no longer owns the heavy view implementations directly.
- Existing targeted view tests continue to pass.
- New view modules export stable render functions.

### A-05: Batch A Regression and Tracker Update

**Files**
- `tests/test-view-router.js`
- `DASHBOARD_PROGRESS.md`
- `docs/api.md` if endpoint notes need clarification

**Work**
- Add regression checks for registry coverage and support view extraction.
- Record Batch A status and verification commands in the progress tracker.

**Acceptance Criteria**
- Batch A progress is visible in `DASHBOARD_PROGRESS.md`.
- Validation commands used for the implemented slice are recorded.
- No Batch A ticket is marked complete without matching code and tests.
