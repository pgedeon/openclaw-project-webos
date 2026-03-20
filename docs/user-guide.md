# Project Dashboard User Guide

A complete walkthrough of the OpenClaw Project Dashboard interface, workflows, and best practices.

## Table of Contents

1. [Overview](#overview)
2. [Views](#views)
3. [Task Operations](#task-operations)
4. [Filtering & Search](#filtering--search)
5. [Archive Workflow](#archive-workflow)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Agent Integration](#agent-integration)
8. [Import / Export](#import--export)
9. [Accessibility](#accessibility)

---

## Overview

The dashboard is a single‑page application served at `http://localhost:3876/`. It connects to a backend API (task‑server.js) which persists data in PostgreSQL (or JSON for lightweight setups).

**Core concepts:**

- **Project / Board**: The dashboard uses a folder-style hierarchy. Parent boards act like folders and child boards roll up into their workspace tree.
- **Task**: Unit of work with title, description, labels, status, priority, owner, preferred OpenClaw model, dates, dependencies, and subtasks.
- **View**: Different visualizations of the same task data: List, Board, Timeline, Agent, Audit.

---

## Views

### List View (Default)

Displays tasks as a vertical list. Supports:

- Hierarchical nesting: subtasks are indented under their parent with a chevron to collapse/expand.
- Quick toggles: checkboxes to mark complete, edit, delete.
- Color‑coded priority badges (low/medium/high/critical) – configurable in CSS.
- Overdue highlighting (red border when `due_date` is past and not completed).

Use the toolbar to sort by newest, oldest, recently updated, or alphabetical.

### Board View (Kanban)

Columns represent workflow states: backlog, ready, in_progress, blocked, review, completed.

- Drag tasks between columns to change status.
- Dropping a task updates its `status` and `updated_at`.
- Undo toast appears briefly; click to revert.

> **Note:** Board view requires the `/api/views/board` endpoint with a `project_id` query parameter. In the current self‑contained version, the placeholder will be replaced once the view module is fully integrated.

### Timeline View (Gantt)

Visualize tasks with `start_date` and `due_date` as bars on a chronological axis.

- Dependencies are drawn as arrows.
- You can drag bars to adjust dates (future enhancement).
- Tasks without dates appear in an “Unscheduled” column.

Endpoint: `/api/views/timeline?project_id=X&start=&end=`

### Agent View

Select an agent from the dropdown to see their assigned tasks (owner field). Shows:

- Total, Ready, In Progress, Completed, Locked by Me.
- Claim and release buttons for task execution.
- Execute button (triggers OpenClaw task execution with pre‑guard).

The agent view polls every 30 s when active (heartbeat). You can pause updates with the “Pause” button.

### Audit View

A full change log of task and project modifications. Each entry shows:

- Timestamp
- Actor (user or agent)
- Action (created, updated, deleted, status changed, etc.)
- Task ID
- Details: old → new values (concise diff)

Supports server‑side filters via query parameters: `task_id`, `actor`, `action`, `start_date`, `end_date`, `limit`, `offset`.

### Cron View

Monitor and control scheduled cron jobs from within the dashboard.

- Click the **⏱️ Cron** button in the toolbar to open the Cron view.
- The view lists all cron jobs defined in the `crontab/` directory:
  - Job ID (filename)
  - Name (optional, from comment)
  - Schedule (cron expression)
  - Last run time and exit status
  - Next scheduled run (if enabled)
- For each job you can:
  - **Run Now** – manually trigger immediate execution (bypasses schedule)
  - **View Logs** – see recent output from the job's last runs (tails stdout/stderr)
- The view refreshes automatically when changes are made.

Endpoints: `GET /api/cron/jobs`, `GET /api/cron/jobs/:id/runs`, `POST /api/cron/jobs/:id/run`.

---

## Task Operations

### Add a Task

1. Open the task composer at the top of the page.
2. Enter a title and optional description.
3. Optionally set labels, status, priority, owner, preferred model, recurrence, start date, and due date.
4. Click `Add Task`.

The task appears at the top of the list (sorted by newest by default).

### Edit a Task

Click the pencil icon on a task card. The inline editor lets you modify:

- Title
- Description
- Labels / category
- Status
- Priority
- Owner
- Preferred OpenClaw model
- Start date and due date
- Recurrence

Press Enter (Save) or Escape (Cancel).

### Delete a Task

Click the trash icon. Confirm the dialog. Deletion is permanent.

### Complete / Undo

Click the check‑circle button to toggle completion. Completed tasks gain a strikethrough and move according to the current filter.

---

## Filtering & Search

### Status Filters

- **All** – all active tasks (excludes archived)
- **Pending** – not completed
- **Completed** – completed tasks (still active, not archived)
- **Archived** – tasks marked as archived (historically completed)

Each button shows a count badge. The active filter is highlighted.

### Category Filter

Select a category from the dropdown to show only tasks belonging to that category.

### Search

Type in the search box to match task title or category (case‑insensitive). The results update as you type (debounced 300 ms).

---

## Archive Workflow

Instead of deleting completed tasks, the dashboard uses a two‑step history preservation:

1. completing a task marks `completed = true` (but `archived = false`).
2. “Archive completed” button (formerly “Clear completed”) moves all completed tasks to the archive by setting `archived = true` for each.

Archived tasks:

- Are excluded from All/Pending/Completed filters.
- Appear only when you select the “Archived” filter.
- Remain searchable (if you include archived in the filter).
- Can be viewed in the Audit view with full history.

This ensures you retain a referenceable history without cluttering daily work.

---

## Keyboard Shortcuts

For power users and accessibility:

| Key | Action |
|-----|--------|
| `N` | Focus the new task input |
| `1` | Switch to List view |
| `2` | Switch to Board view |
| `3` | Switch to Timeline view |
| `4` | Switch to Agent view |
| `5` | Switch to Audit view |
| `J` | Move focus to next task in the list |
| `K` | Move focus to previous task |
| `Esc` | Clear search input and reset filter to “All” |

Shortcuts are ignored when you are typing inside an input, textarea, or select element.

---

## Agent Integration

Tasks can be assigned to an agent directly in the composer or edit form. The Agent view lets an agent:

- See their queue (tasks where `owner = agent_name` and `status` in `[ready, in_progress]`).
- Claim a task (locks it to prevent other agents from taking it).
- Release a task (unlock).
- Execute a task (triggers OpenClaw execution with pre‑execution guard and QMD context).

The heartbeat automatically refreshes the agent’s task list every 30 seconds unless paused.

---

## Import / Export

### Export

- **JSON**: Download the entire task list (including all fields) as a JSON file.
- **CSV**: Download a comma‑separated values file with columns: text, category, completed, archived, createdAt, updatedAt.

### Import

- Click “Import” and select a previously exported `.json` or `.csv` file.
- The import merges tasks; existing tasks are matched by `id` if present, otherwise new tasks are created.

---

## Accessibility

- ARIA labels on interactive elements.
- Keyboard navigation supported throughout.
- Focus styles are visible.
- Color is not the only means of conveying information (e.g., priority badges have text labels when needed).
- High‑contrast friendly CSS variables.

---

## Tips & Best Practices

- Use categories to group related tasks; they are easy to filter.
- Archive completed tasks regularly to keep the active list clean.
- Leverage keyboard shortcuts for fast data entry.
- In the Audit view, filter by actor to track changes made by a specific agent.
- For long‑running tasks, set a due date; overdue tasks are highlighted.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Dashboard fails to load | task‑server.js not running | Start with `dashboard/scripts/dashboard-health.sh start` or `dashboard/scripts/restart-task-server.sh` |
| No tasks appear | Wrong project selected or database empty | Check API `/api/projects` and set a project in the UI (future multi‑project support) |
| 404 on `/api/views/board` | Storage not initialized or missing endpoint | Ensure `STORAGE_TYPE` and DB connection; check server logs |
| Changes not persisting | Browser in incognito/private mode or storage disabled | Enable localStorage; check console for quota errors |

---

## Next Steps

- Multi‑project selection UI
- Owner assignment from task edit panel
- Recurring task generation
- Full Board and Timeline interactivity
