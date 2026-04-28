# Widget Catalog

Complete reference for all 18 desktop widgets in the OpenClaw Project WebOS.

> Generated from source in `src/shell/widgets/widgets/`.  
> Shared utilities live in `src/shell/widgets/widgets/widget-utils.mjs`.

---

## Table of Contents

1. [Agent Fleet](#1-agent-fleet) — medium
2. [Approval Queue](#2-approval-queue) — small
3. [Blocker Alert](#3-blocker-alert) — small
4. [Clock](#4-clock) — small
5. [Command Runner](#5-command-runner) — medium
6. [Cron Countdown](#6-cron-countdown) — small
7. [Department Status](#7-department-status) — medium
8. [Error Feed](#8-error-feed) — tall
9. [Mini Sparkline](#9-mini-sparkline) — small
10. [MOTD](#10-motd) — small
11. [Project Stats](#11-project-stats) — wide
12. [Queue Monitor](#12-queue-monitor) — medium
13. [Quick Notes](#13-quick-notes) — large
14. [Session Timer](#14-session-timer) — small
15. [System Health](#15-system-health) — medium
16. [System Uptime](#16-system-uptime) — small
17. [Task Pulse](#17-task-pulse) — small
18. [Workflow Pulse](#18-workflow-pulse) — small

---

## Quick Reference Table

| Widget | Size | Data Keys | Clickable | Configurable | Resizable |
|---|---|---|---|---|---|
| Agent Fleet | medium | `gatewayAgents` | ✅ | ❌ | ❌ |
| Approval Queue | small | `approvalsPending` | ✅ | ❌ | ❌ |
| Blocker Alert | small | `blockersSummary` | ✅ | ❌ | ❌ |
| Clock | small | *(none)* | ❌ | ❌ | ❌ |
| Command Runner | medium | *(none — uses API calls)* | ❌ | ❌ | ❌ |
| Cron Countdown | small | `stats` | ✅ | ❌ | ❌ |
| Department Status | medium | `orgSummary` | ✅ | ❌ | ❌ |
| Error Feed | tall | `blockersSummary` | ❌ | ❌ | ❌ |
| Mini Sparkline | small | `stats` | ❌ | ❌ | ❌ |
| MOTD | small | *(none — uses localStorage)* | ❌ | ❌ | ❌ |
| Project Stats | wide | `stats`, `orgSummary` | ❌ | ❌ | ❌ |
| Queue Monitor | medium | `stats` *(+ API call to `org.summary`)* | ✅ | ❌ | ❌ |
| Quick Notes | large | *(none — uses localStorage)* | ❌ | ❌ | ❌ |
| Session Timer | small | *(none — local timer)* | ❌ | ✅ | ❌ |
| System Health | medium | `healthStatus`, `gatewayAgents` | ✅ | ❌ | ❌ |
| System Uptime | small | *(none — uses `performance.timeOrigin`)* | ❌ | ❌ | ❌ |
| Task Pulse | small | `stats` | ✅ | ❌ | ❌ |
| Workflow Pulse | small | `activeWorkflowRuns` | ✅ | ❌ | ❌ |

---

## Detailed Entries

### 1. Agent Fleet

| Property | Value |
|---|---|
| **Widget ID** | `agent-fleet` |
| **Label** | Agent Fleet |
| **Description** | Live overview of agent availability across the gateway fleet. |
| **Size** | medium |
| **Data Keys** | `gatewayAgents` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
Displays the count of online agents versus total agents (e.g. "3/12 online") alongside a grid of colored status dots. Each dot represents an agent; color indicates status (active/idle/offline via `classifyAgentStatus`). Shows up to 12 dots with an overflow count (e.g. "+5").

**Click action:**  
Navigates to the `agents` view (`ctx.navigate('agents')`).

---

### 2. Approval Queue

| Property | Value |
|---|---|
| **Widget ID** | `approval-queue` |
| **Label** | Approvals |
| **Description** | Pending approval requests waiting for review. |
| **Size** | small |
| **Data Keys** | `approvalsPending` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
Shows a large numeric badge with the count of pending approvals. Badge styling changes between "is-pending" (count > 0) and "is-empty" (clear). Meta text reads "Awaiting review" or "Queue is clear". Data is extracted via `getArray(ctx.data.approvalsPending, 'approvals')`.

**Click action:**  
Navigates to the `approvals` view (`ctx.navigate('approvals')`).

---

### 3. Blocker Alert

| Property | Value |
|---|---|
| **Widget ID** | `blocker-alert` |
| **Label** | Blockers |
| **Description** | High-visibility alert for current blockers. |
| **Size** | small |
| **Data Keys** | `blockersSummary` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A pulsing alert dot and numeric count of blockers (from `blockersSummary.total`). When blockers exist, the dot and count use the "is-alert" style with a CSS pulse animation (`widget-blocker-alert-pulse`). When clear, both use "is-clear". Meta text: "Needs attention" or "All clear".

**Click action:**  
Navigates to the `tasks` view (`ctx.navigate('tasks')`).

---

### 4. Clock

| Property | Value |
|---|---|
| **Widget ID** | `clock-widget` |
| **Label** | Clock |
| **Description** | Large digital clock with the current date. |
| **Size** | small |
| **Data Keys** | *(none)* |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A real-time digital clock showing time (HH:MM:SS) and date (e.g. "Tue, Apr 28"). Updates every second via `setInterval`. Uses `Intl.DateTimeFormat` for locale-aware formatting. Defaults to 24-hour format.

**Interactions:**  
Responds to config changes via `ctx.onConfigChange` — toggles between 12h/24h format at runtime. Not user-clickable (no navigation).

---

### 5. Command Runner

| Property | Value |
|---|---|
| **Widget ID** | `command-runner` |
| **Label** | Command Runner |
| **Description** | Runs safe read-only endpoint checks and shows the raw response. |
| **Size** | medium |
| **Data Keys** | *(none — uses `ctx.api.raw` for API calls)* |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A dropdown (`<select>`) with three pre-approved read-only endpoints and a "Run" button. Results are displayed in a `<pre><code>` block showing the raw JSON or text response.

**Available endpoints:**
| ID | Label | Path |
|---|---|---|
| `health` | Health | `/api/health` |
| `stats` | Stats | `/api/stats` |
| `heartbeat` | Heartbeat | `/api/health-status` |

**Interactions:**  
Select an endpoint, click "Run". Shows loading state, then the response (or HTTP error status). Uses `ctx.api.raw()`.

---

### 6. Cron Countdown

| Property | Value |
|---|---|
| **Widget ID** | `cron-countdown` |
| **Label** | Cron |
| **Description** | Background cron status with next-run countdown. |
| **Size** | small |
| **Data Keys** | `stats` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
Shows cron job status as text. Priority display:
1. If jobs are running → "N cron jobs running"
2. If next run is scheduled → "Next run in Nm"
3. If jobs exist but idle → "Waiting for next cron run"
4. No jobs configured → "No cron jobs configured"

Meta line shows total configured jobs or "Cron idle".

**Polling:**  
Fetches status via `ctx.api.cron.status()` every 5 seconds. Uses in-flight guard to prevent overlapping requests.

**Click action:**  
Navigates to the `cron` view (`ctx.navigate('cron')`).

---

### 7. Department Status

| Property | Value |
|---|---|
| **Widget ID** | `department-status` |
| **Label** | Departments |
| **Description** | Compact health snapshot for department activity and blockers. |
| **Size** | medium |
| **Data Keys** | `orgSummary` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A vertical list of department names with colored status dots. Shows up to 6 departments; overflow displayed as "+N more". Health tone logic:
- No agents → `unknown`
- All agents offline → `error`
- Has blocked tasks → `warning`
- Has working or ready tasks → `ok`

**Click action:**  
Navigates to the `departments` view (`ctx.navigate('departments')`).

---

### 8. Error Feed

| Property | Value |
|---|---|
| **Widget ID** | `error-feed` |
| **Label** | Error Feed |
| **Description** | Scrollable list of the most urgent blocker items. |
| **Size** | tall |
| **Data Keys** | `blockersSummary` |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A scrollable list of up to 5 blocker items, each with a severity dot (color-coded) and title + metadata. Async render — if blockers exist, attempts `ctx.api.blockers.list({ limit: 5 })` first; falls back to summary-level type breakdown if the API call fails.

**Item normalization:**  
Each item shows severity (defaulting to "medium"), title, and meta (description, department name, or issue count).

---

### 9. Mini Sparkline

| Property | Value |
|---|---|
| **Widget ID** | `mini-sparkline` |
| **Label** | Mini Sparkline |
| **Description** | Tiny trendline of completion ratio snapshots stored locally. |
| **Size** | small |
| **Data Keys** | `stats` |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
An inline SVG sparkline chart showing the task completion ratio over time. Each render appends the current ratio (completed / total tasks) to a rolling window of 20 data points, persisted to `localStorage` under key `openclaw.win11.widget.sparkline.v1`. Displays a filled area chart with polyline on top, plus the latest percentage as meta text.

**Storage:**  
`localStorage` key: `openclaw.win11.widget.sparkline.v1` — JSON array of ratio values (0–1), capped at 20 points.

---

### 10. MOTD

| Property | Value |
|---|---|
| **Widget ID** | `motd-widget` |
| **Label** | MOTD |
| **Description** | Editable message of the day with a rotating fallback quote. |
| **Size** | small |
| **Data Keys** | *(none — uses localStorage)* |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A text message with an edit button (pencil icon). Shows a user-written message if one exists; otherwise rotates through built-in fallback quotes.

**Default quotes:**
1. "Ship the fix, then sharpen the tool."
2. "Small clean changes beat heroic rewrites."
3. "Measure twice, patch once."
4. "The queue gets lighter one win at a time."
5. "Calm systems make fast teams."

**Interactions:**  
Click the edit button to enter inline `contentEditable` mode. Press Enter or blur to save. Clearing the text removes the stored message and shows the next fallback quote.

**Storage:**  
`localStorage` key: `openclaw.win11.widget.motd.v1` — plain text.

---

### 11. Project Stats

| Property | Value |
|---|---|
| **Widget ID** | `project-stats` |
| **Label** | Project Stats |
| **Description** | Compact dashboard counts for projects, agents, tasks, and completed work. |
| **Size** | wide |
| **Data Keys** | `stats`, `orgSummary` |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A horizontal grid of four metric cards:

| Metric | Source |
|---|---|
| Projects | `stats.projects` |
| Agents | `orgSummary.totalAgents` or `orgSummary.liveSummary.totalAgents` |
| Tasks | `stats.tasks` / `stats.total_tasks` / `stats.task_count` |
| Completed | derived via `deriveQueueMetrics()` |

Uses the shared `deriveQueueMetrics` utility for the "Completed" count.

---

### 12. Queue Monitor

| Property | Value |
|---|---|
| **Widget ID** | `queue-monitor` |
| **Label** | Queue Monitor |
| **Description** | Task distribution across ready, active, blocked, and done states. |
| **Size** | medium |
| **Data Keys** | `stats` *(+ async API call to `ctx.api.org.summary()`)* |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A stacked horizontal bar chart showing task distribution across four states, plus a legend with counts:

| Segment | Color class |
|---|---|
| Ready | `--ready` |
| Active | `--active` |
| Blocked | `--blocked` |
| Done | `--done` |

Bar segments are sized proportionally using flexbox (`flex: count 1 0%`). Falls back to an empty gray segment when no data is available.

**Click action:**  
Navigates to the `tasks` view (`ctx.navigate('tasks')`).

---

### 13. Quick Notes

| Property | Value |
|---|---|
| **Widget ID** | `quick-notes` |
| **Label** | Quick Notes |
| **Description** | A persistent scratchpad saved locally on this desktop. |
| **Size** | large |
| **Data Keys** | *(none — uses localStorage)* |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
A `<textarea>` with placeholder text "Capture an idea, command, or reminder…". Loads and saves content from/to localStorage with a 500ms debounce on input. Flushes on widget teardown.

**Storage:**  
`localStorage` key: `openclaw.win11.widget.quick-notes.v1` — plain text.

---

### 14. Session Timer

| Property | Value |
|---|---|
| **Widget ID** | `session-timer` |
| **Label** | Session Timer |
| **Description** | Pomodoro-style focus timer with work and break intervals. |
| **Size** | small |
| **Data Keys** | *(none — local timer state)* |
| **Capabilities** | clickable ❌ · **configurable ✅** · resizable ❌ |

**What it renders:**  
A Pomodoro timer showing the current mode ("Work" / "Break"), remaining time in MM:SS format, and three control buttons: Start, Pause, Reset. Automatically alternates between work and break intervals when time expires.

**Configuration options:**

| Key | Default | Description |
|---|---|---|
| `workMinutes` | `25` | Duration of work interval |
| `breakMinutes` | `5` | Duration of break interval |

**Interactions:**  
Uses a module-level `timerState` singleton — only one timer instance at a time.

---

### 15. System Health

| Property | Value |
|---|---|
| **Widget ID** | `system-health` |
| **Label** | System Health |
| **Description** | Live API and agent status for the desktop shell. |
| **Size** | medium |
| **Data Keys** | `healthStatus`, `gatewayAgents` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A status dot in the header (color-coded) and centered body showing:
- Status label: "Healthy" / "Degraded" / "Warning" / "Offline" / "Waiting"
- Agent count: "N / M agents active" (based on active states: `active`, `running`, `online`, `healthy`)

**Status mapping:**

| Status value | Tone | Display label |
|---|---|---|
| `ok` / `healthy` | ok | Healthy |
| `degraded` / `warning` | warning | Degraded / Warning |
| `error` / `failed` / `offline` | error | Offline |
| *(unknown)* | unknown | Waiting |

**Click action:**  
Navigates to the `health` view (`ctx.navigate('health')`).

---

### 16. System Uptime

| Property | Value |
|---|---|
| **Widget ID** | `system-uptime` |
| **Label** | Uptime |
| **Description** | Time elapsed since the desktop shell page loaded. |
| **Size** | small |
| **Data Keys** | *(none — uses `performance.timeOrigin`)* |
| **Capabilities** | clickable ❌ · configurable ❌ · resizable ❌ |

**What it renders:**  
Displays time since page load in `Xd Yh Zm` format (e.g. "2d 3h 15m"). Captures `performance.timeOrigin` at module load time, then updates every 30 seconds.

---

### 17. Task Pulse

| Property | Value |
|---|---|
| **Widget ID** | `task-pulse` |
| **Label** | Task Pulse |
| **Description** | Quick view of task completion progress. |
| **Size** | small |
| **Data Keys** | `stats` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A conic-gradient progress ring showing task completion. The ring fills proportionally to the completion ratio. Center shows the completed task count as a number. Below: "N% complete" or "Waiting for task data".

**Data sources:**  
- Total: `stats.tasks` / `stats.total_tasks` / `stats.task_count`
- Completed: `stats.completed_tasks` / `stats.completed` / `stats.tasks_completed`

**Click action:**  
Navigates to the `tasks` view (`ctx.navigate('tasks')`).

---

### 18. Workflow Pulse

| Property | Value |
|---|---|
| **Widget ID** | `workflow-pulse` |
| **Label** | Workflow Pulse |
| **Description** | Shows how many workflow runs are actively moving. |
| **Size** | small |
| **Data Keys** | `activeWorkflowRuns` |
| **Capabilities** | clickable ✅ · configurable ❌ · resizable ❌ |

**What it renders:**  
A spinning CSS animation indicator (active when runs > 0), a numeric count of active workflow runs, and meta text "Active runs" or "No active runs". Data extracted via `getArray(ctx.data.activeWorkflowRuns, 'runs')`.

**Click action:**  
Navigates to the `workflows` view (`ctx.navigate('workflows')`).

---

## Shared Utilities (`widget-utils.mjs`)

All widgets depend on this shared module. Key exports:

| Utility | Purpose |
|---|---|
| `getEscape(ctx)` | Returns HTML escape function (context helper or fallback) |
| `toNumber(value, fallback)` | Safe numeric parsing with fallback |
| `clamp(value, min, max)` | Numeric clamping |
| `formatCount(value)` | Format as locale-aware integer (min 0) |
| `getArray(payload, key)` | Extract array from payload by key, with fallbacks |
| `deriveQueueMetrics({ stats, orgSummary })` | Compute ready/active/blocked/done totals from multiple possible field names |
| `classifyAgentStatus(status)` | Map agent status to `active` / `idle` / `offline` |
| `isOnlineAgentStatus(status)` | Returns true if agent is active or idle |
| `formatDurationMmSs(seconds)` | Format as `MM:SS` |
| `formatDaysHoursMinutes(ms)` | Format as `Xd Yh Zm` |
| `readStorageText(key, fallback)` / `writeStorageText(key, value)` | localStorage text helpers |
| `readStorageJson(key, fallback)` / `writeStorageJson(key, value)` | localStorage JSON helpers |
| `removeStorageValue(key)` | localStorage delete helper |

---

## Widget Sizes

| Size | Typical use |
|---|---|
| `small` | Compact single-metric or indicator widgets |
| `medium` | Multi-element displays with moderate content |
| `wide` | Horizontal multi-column layouts |
| `tall` | Scrollable list content |
| `large` | Full-textarea or expansive content |

---

## Navigation Targets

Widgets that are clickable link to these shell views:

| View | Navigated from |
|---|---|
| `agents` | Agent Fleet |
| `approvals` | Approval Queue |
| `tasks` | Blocker Alert, Queue Monitor, Task Pulse |
| `cron` | Cron Countdown |
| `departments` | Department Status |
| `health` | System Health |
| `workflows` | Workflow Pulse |

---

## localStorage Keys

| Key | Widget | Content |
|---|---|---|
| `openclaw.win11.widget.sparkline.v1` | Mini Sparkline | JSON array of ratio values |
| `openclaw.win11.widget.motd.v1` | MOTD | Plain text message |
| `openclaw.win11.widget.quick-notes.v1` | Quick Notes | Plain text notes |
