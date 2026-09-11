---
layout: default
---

# Space Agent Analysis & Feature Proposals for OpenClaw WebOS

**Source analyzed:** [github.com/agent0ai/space-agent](https://github.com/agent0ai/space-agent) v0.36+
**Date:** 2026-04-28
**Purpose:** Identify what Space Agent does exceptionally well, extract actionable improvements, and propose fully documented features for the OpenClaw Desktop / WebOS project.

---

## What Space Agent Does Really Well

### 1. Hierarchical Documentation System (53 AGENTS.md files)
Space Agent uses a **layered AGENTS.md hierarchy** where every directory that owns code also owns a documentation contract. This is not an afterthought — it's a "documentation is top priority" runtime principle.

**Why it works:**
- Root `AGENTS.md` owns repo-wide rules and architecture
- 5 core domain docs (`app/`, `server/`, `commands/`, `packaging/`, root) own their respective trees
- Module-level docs own concrete implementation contracts
- Leaf docs own exact surface-level behavior
- Every doc answers: purpose, ownership, contracts, development guidance
- Cross-references are explicit: "update this file AND the parent AND the supplemental docs in the same session"

**What we can learn:** Our documentation is already strong, but it's flat — all in `docs/`. We lack the hierarchical ownership model where code directories own their own documentation contracts.

### 2. Browser-First Architecture
Space Agent treats the browser as the **primary runtime**. The Node.js server is intentionally thin — just infrastructure for CORS proxying, auth, and file operations.

**Why it works:**
- Agent logic lives in the browser
- The server is "thin infrastructure," not the main application
- Frontend-first is enforced by policy: backend edits require explicit permission
- Skills and prompts are browser-resident

**What we can learn:** Our WebOS already does this well — views run in the browser, servers are API-only. But we could push more intelligence to the frontend (client-side filtering, sorting, optimistic updates).

### 3. Layered Customware Model (L0/L1/L2)
Space Agent uses a three-layer writable inheritance model:
- **L0 (Firmware):** Core app modules, shipped with the product
- **L1 (Group):** Group-level customizations, shared across teams
- **L2 (User):** Per-user customizations, isolated per user

The server resolves module requests through this layer stack, so users can override anything without touching core code.

**Why it works:**
- Users can customize without forking
- Groups can share tools and workflows
- Core stays pristine
- Admin mode clamps to L0 for stability

### 4. Agent-in-the-Frontend Runtime
The onscreen agent runs **inside the browser** and can:
- Build pages, tools, and widgets while the user watches
- Extend the running workspace in real-time
- Write and modify its own skill files (SKILL.md)
- Manipulate the DOM and app state directly

**Why it works:**
- No JSON tool-call overhead — plain text + JavaScript
- Agent can reshape the UI it's operating in
- Skills are just markdown files the agent can write itself
- Token-efficient: stays in text + JS instead of bulky API schemas

### 5. Git-Backed Time Travel
Every change to user/group customware is tracked in Git. Users can:
- Browse commit history with file-level diffs
- "Travel" to any previous commit (hard reset)
- "Revert" a commit (create inverse commit)
- See affected files with preview before confirming

**Why it works:**
- Fearless experimentation — anything can be undone
- Admin has a stable control plane even when users break things
- Git is the backing store, so it's robust and well-understood

### 6. Spaces as Composable Workspaces
Users create named "Spaces" — each with its own widget grid, agent instructions, data, and assets. Spaces are:
- Persisted as YAML files under the user's directory
- Composable: each widget has its own renderer function
- Shareable via ZIP export/import or hosted cloud sharing
- First-class agent context: the agent knows which space is open

### 7. Skill System (24 SKILL.md files)
Skills are metadata-driven markdown files that:
- Auto-load into the agent's system prompt when conditions match
- Can be written and extended by the agent itself
- Use `metadata.when`, `metadata.loaded`, and `metadata.placement` for conditional loading
- Cover everything from memory to file editing to browser control

### 8. Deterministic Module Discovery
Modules are discovered by convention, not configuration:
- Predictable folder structure (`mod/<author>/<repo>/...`)
- Extension points load by naming convention
- No hardcoded feature IDs in runtime code
- New features drop into the right folder and work

### 9. Multi-User with Per-User Isolation
Full authentication system with:
- Password-based login with crypto-backed session keys
- Per-user encrypted storage
- Group-based permissions
- Admin mode for system management
- User folder size limits

### 10. Production-Grade Operations
- Zero-downtime supervisor (`node space supervise`)
- Desktop app packaging (Electron) for Windows/macOS/Linux
- Cross-platform CI/CD with GitHub Actions
- Runtime parameter system (CLI args → stored .env → env vars → defaults)

---

## Proposed Features for OpenClaw WebOS

Based on the analysis above, here are actionable features ranked by impact and feasibility.

---

### Feature 1: Time Travel (Git-Backed Undo History)

**Priority:** High
**Effort:** Medium
**Inspiration:** Space Agent's `time_travel` module

**Description:**
Add a Time Travel view that lets operators browse the full history of changes to the dashboard state (tasks, workflows, projects, configurations) and revert or travel to any point.

**Full Specification:**

#### User Stories
- As an operator, I want to see a timeline of all changes made to the system so I can understand what happened
- As an operator, I want to revert a bad change without manually undoing each edit
- As an operator, I want to see exactly what changed (diffs) before confirming a revert

#### API Endpoints

```
GET  /api/history/commits?path=<scope>&limit=100&offset=0&fileFilter=<pattern>
  → { commits: [{ hash, author, message, timestamp, files[], backend }], total, hasMore }

GET  /api/history/diff?path=<scope>&hash=<commitHash>&file=<filepath>
  → { diff: "<unified diff>", file, added, modified, deleted }

POST /api/history/preview?path=<scope>&hash=<commitHash>
  → { affectedFiles: [{ path, action }], warning?: string }

POST /api/history/rollback?path=<scope>&hash=<commitHash>
  → { success: true, newHead: "<hash>" }

POST /api/history/revert?path=<scope>&hash=<commitHash>
  → { success: true, revertHash: "<hash>" }
```

#### Database Schema

```sql
CREATE TABLE state_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scope TEXT NOT NULL,          -- 'tasks', 'workflows', 'config', etc.
  commit_hash TEXT NOT NULL,
  parent_hash TEXT,
  author TEXT NOT NULL,
  message TEXT,
  diff JSONB NOT NULL,          -- { files: [{ path, action, patch }] }
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_current BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_state_snapshots_scope ON state_snapshots(scope);
CREATE INDEX idx_state_snapshots_hash ON state_snapshots(commit_hash);
CREATE INDEX idx_state_snapshots_timestamp ON state_snapshots(snapshot_at);
```

#### Desktop View
- **Route:** `#/time-travel`
- **Category:** Operations
- **Layout:** Two-panel — commit sidebar (left) + diff detail (right)
- **Features:** Commit list with relative timestamps, file filter, diff viewer, travel/revert buttons with confirmation modal
- **Data Source:** History API endpoints above

#### Offline Behavior
- Commit history cached in IndexedDB
- Diffs fetched on demand (not preloaded)
- Revert/travel requires online connection

#### Documentation Files to Create
- `docs/time-travel-reference.md` — Full feature documentation
- Update `docs/views-reference.md` — Add Time Travel view
- Update `docs/api-reference-complete.md` — Add history endpoints
- Update `docs/schema-reference.md` — Add state_snapshots table

---

### Feature 2: Hierarchical Documentation Ownership

**Priority:** High
**Effort:** Low
**Inspiration:** Space Agent's 53-file AGENTS.md hierarchy

**Description:**
Adopt a hierarchical documentation model where every source directory that owns code also owns an `AGENTS.md` (or equivalent) documentation contract. This makes documentation a runtime concern, not an afterthought.

**Full Specification:**

#### Documentation Hierarchy

```
/AGENTS.md                          — Project-wide rules, architecture, ownership map
/src/shell/AGENTS.md                — Shell module contracts
/src/shell/native-views/AGENTS.md   — View conventions and registry
/src/shell/widgets/AGENTS.md        — Widget system contracts
/src/shell/offline/AGENTS.md        — Offline layer contracts
/storage/AGENTS.md                  — Storage layer contracts
/schema/AGENTS.md                   — Database migration rules
/scripts/AGENTS.md                  — Operational script contracts
```

#### Rules
1. Every directory with >3 source files must have a documentation contract
2. Each doc answers: purpose, ownership, contracts, development guidance
3. Parent docs own architecture and boundaries; child docs own implementation details
4. Cross-references are explicit and bidirectional
5. Documentation updates happen in the same commit as code changes

#### Documentation Files to Create
- One `AGENTS.md` per source directory (8 files)
- Update `README.md` to reference the documentation hierarchy
- Update `DEVELOPER_GUIDE.md` with documentation ownership rules

---

### Feature 3: Persistent Agent Memory System

**Priority:** High
**Effort:** Medium
**Inspiration:** Space Agent's `memory` module with behavior/transient split

**Description:**
Add a persistent memory system where agents can store and recall information across sessions. Memory files are injected into agent prompts automatically.

**Full Specification:**

#### Memory Architecture

```
~/memory/
  behavior.md           — Standing behavior rules and user preferences
  memories.md           — Rolling notes, facts, and context
  <topic>.md            — Topic-specific memory files (auto-created)
```

#### Memory Files
- `behavior.md` — Stable behavior changes (e.g., "Always use dark theme", "Prefer concise responses"). Injected into every agent prompt as a system instruction.
- `memories.md` — Rolling notes that change frequently. Facts, context, recent events.
- `<topic>.md` — Auto-created when a topic deserves its own memory file.

#### API Endpoints

```
GET  /api/memory/files              — List all memory files
GET  /api/memory/file?name=<file>   — Read a memory file
PUT  /api/memory/file               — Update a memory file { name, content }
POST /api/memory/append             — Append to a memory file { name, content }
DELETE /api/memory/file?name=<file>  — Delete a memory file
GET  /api/memory/context            — Get assembled prompt context from all memory files
```

#### Agent Integration
- Memory files are injected into agent system prompts automatically
- Agent can read, write, and append to memory files via the memory API
- `behavior.md` changes persist across all future sessions
- Memory files are scoped per workspace, not per agent

#### Desktop View Updates
- **Memory view** gets file editing capabilities
- New "Memory" section in agent view showing active memory files
- Memory file diff viewer for change tracking

#### Documentation Files to Create
- `docs/memory-system.md` — Full memory architecture and API
- Update `docs/api-reference-complete.md` — Add memory file endpoints
- Update `docs/AGENT_INTEGRATION.md` — Add memory injection rules

---

### Feature 4: Space/Workspace System

**Priority:** Medium
**Effort:** Large
**Inspiration:** Space Agent's `spaces` module with widget grids

**Description:**
Allow operators to create named "Spaces" — custom dashboard layouts with specific widgets, views, filters, and agent instructions. Spaces persist independently and can be switched between.

**Full Specification:**

#### Space Schema

```javascript
{
  id: "uuid",
  name: "Sprint Planning",
  icon: "📋",
  color: "#4A90D9",
  layout: {
    widgets: ["task-pulse", "queue-monitor", "agent-fleet"],
    pinnedViews: ["tasks", "board", "timeline"],
    filters: { project_id: "uuid", status: "in_progress" }
  },
  agentInstructions: "Focus on sprint tasks. Highlight blockers.",
  createdAt: "2026-04-28T10:00:00Z",
  updatedAt: "2026-04-28T10:00:00Z"
}
```

#### API Endpoints

```
GET    /api/spaces                   — List all spaces
POST   /api/spaces                   — Create a space
GET    /api/spaces/:id               — Get space details
PUT    /api/spaces/:id               — Update space
DELETE /api/spaces/:id               — Delete space
POST   /api/spaces/:id/duplicate     — Duplicate a space
GET    /api/spaces/:id/export        — Export space as JSON
POST   /api/spaces/import            — Import space from JSON
```

#### Desktop Integration
- **Space switcher** in the taskbar (dropdown next to clock)
- **Space creation** from start menu or taskbar
- Each space applies its own widget layout, pinned views, and filters
- Spaces integrate with the agent context (agent knows which space is active)

#### Database Schema

```sql
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📐',
  color TEXT DEFAULT '#4A90D9',
  layout JSONB NOT NULL DEFAULT '{}',
  agent_instructions TEXT,
  owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Documentation Files to Create
- `docs/spaces-reference.md` — Full space system documentation
- Update `docs/views-reference.md` — Add space management views
- Update `docs/api-reference-complete.md` — Add space endpoints
- Update `docs/schema-reference.md` — Add spaces table

---

### Feature 5: Agent-as-Capability (In-Browser Agent Execution)

**Priority:** Medium
**Effort:** Large
**Inspiration:** Space Agent's onscreen agent that runs in the browser

**Description:**
Add an in-browser agent chat panel where operators can interact with an AI agent directly from the desktop. The agent can read dashboard state, execute actions via the API, and provide analysis.

**Full Specification:**

#### Agent Chat Panel
- **Location:** Floating panel (right side) or docked sidebar
- **Input:** Natural language text
- **Output:** Markdown responses with embedded dashboard actions
- **Actions the agent can perform:**
  - List/view/create/update/delete tasks
  - Search tasks by text, status, owner, project
  - View agent status and queue
  - Check health and metrics
  - Read memory files
  - Execute safe API calls (GET-only by default)

#### Architecture
- Agent connects to the OpenClaw gateway (via the existing API)
- Prompts include current dashboard context (active view, selected tasks, filters)
- Responses can include embedded action buttons ("Create task", "View details")
- No new server — uses existing task-server API endpoints

#### API Integration
- Uses existing `GET /api/stats`, `/api/tasks`, `/api/agents/status` endpoints
- New endpoint: `POST /api/agent/chat` — proxied to LLM provider
- Agent context built from realtime sync data + current view state

#### Safety
- Agent actions default to read-only
- Write operations require explicit user confirmation via UI prompt
- Action log recorded in audit_log

#### Documentation Files to Create
- `docs/agent-chat-reference.md` — Full agent chat feature documentation
- Update `docs/views-reference.md` — Add agent chat panel
- Update `docs/api-reference-complete.md` — Add chat endpoint

---

### Feature 6: Deterministic Extension/Plugin Discovery

**Priority:** Medium
**Effort:** Medium
**Inspiration:** Space Agent's convention-based module loading

**Description:**
Replace ad-hoc registration with deterministic discovery for views, widgets, and API handlers. New features drop into the right directory and are auto-discovered.

**Full Specification:**

#### View Discovery
```
src/shell/native-views/*-view.mjs    → Auto-registered as view
  Each view exports: { id, label, icon, category, render(container, ctx) }
```

#### Widget Discovery
```
src/shell/widgets/widgets/*-widget.mjs → Auto-registered as widget
  Each widget exports: { manifest, render(ctx) }
```

#### API Handler Discovery
```
api/*-api.js → Auto-mounted as /api/<name> routes
  Each handler exports: { registerRoutes(server) }
```

#### Convention Rules
- File naming determines registration order (alphabetical)
- Each module must export a standard interface (manifest/render or registerRoutes)
- No manual registration files — discovery is pure convention
- Unknown exports are silently skipped with a console warning

#### Documentation Files to Create
- `docs/plugin-system.md` — Full plugin/extension discovery documentation
- Update `docs/shell-architecture.md` — Add discovery section
- Update `DEVELOPER_GUIDE.md` — Add plugin development guide

---

### Feature 7: Optimistic UI Updates

**Priority:** Medium
**Effort:** Medium
**Inspiration:** Space Agent's browser-first approach + our existing offline layer

**Description:**
Make all dashboard mutations (create/update/delete tasks, approvals, etc.) apply instantly in the UI before the server confirms. The offline sync layer already has the queuing infrastructure — extend it to all operations.

**Full Specification:**

#### How It Works
1. User performs action (e.g., drag task to "Completed" column)
2. UI updates immediately (optimistic)
3. State manager queues the mutation
4. API call happens in background
5. On success: queue item marked synced, UI stays
6. On failure: UI reverts to previous state, error notification shown
7. On offline: mutation queued, sync when online

#### Scope
- Task CRUD (create, update status, assign, delete)
- Approval actions (approve, reject)
- Workflow actions (pause, resume, cancel)
- Cron job management (create, update, delete)

#### Conflict Resolution
- Server version wins by default
- UI shows diff and asks user to choose
- Auto-merge for non-conflicting fields

#### Documentation Files to Create
- `docs/optimistic-updates.md` — Full optimistic update documentation
- Update `docs/offline-reference.md` — Extend sync manager docs
- Update `docs/user-guide.md` — Add section on optimistic behavior

---

### Feature 8: Multi-User Support with Role-Based Access

**Priority:** Low (single-user for now)
**Effort:** Large
**Inspiration:** Space Agent's auth system with per-user isolation

**Description:**
Add user authentication, session management, and role-based access control so multiple operators can use the same dashboard instance.

**Full Specification:**

#### User Model
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'operator',  -- 'admin', 'operator', 'viewer'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Roles
| Role | Capabilities |
|------|-------------|
| `admin` | Full access, user management, system config |
| `operator` | CRUD tasks, approve, run workflows, manage cron |
| `viewer` | Read-only access to all views and data |

#### Session Management
- Cookie-based sessions (`openclaw_session`)
- Session timeout (configurable, default 24h)
- CSRF protection on all mutation endpoints

#### API Endpoints
```
POST /api/auth/login      — { username, password } → session cookie
POST /api/auth/logout     — Clear session
GET  /api/auth/self       — Current user info
PUT  /api/auth/password   — Change password
POST /api/admin/users     — Create user (admin only)
GET  /api/admin/users     — List users (admin only)
```

#### Documentation Files to Create
- `docs/auth-reference.md` — Full authentication and RBAC documentation
- Update `docs/schema-reference.md` — Add users table
- Update `docs/admin-guide.md` — Add user management section
- Update `docs/configuration-reference.md` — Add auth-related env vars

---

### Feature 9: Cloud Share / Export-Import

**Priority:** Low
**Effort:** Medium
**Inspiration:** Space Agent's cloud share + ZIP export/import

**Description:**
Allow operators to export dashboard configurations (projects, workflows, saved views) as shareable files and import them into other instances.

**Full Specification:**

#### Export Format
```json
{
  "schema": "openclaw-export-v1",
  "exportedAt": "2026-04-28T10:00:00Z",
  "projects": [...],
  "workflows": [...],
  "savedViews": [...],
  "spaces": [...],
  "cronJobs": [...]
}
```

#### API Endpoints
```
GET  /api/export?scope=<projects|workflows|all>  — Download export JSON
POST /api/import                                  — Upload and apply import JSON
POST /api/import/preview                          — Preview what would be imported
```

#### Safety
- Import preview shows what will be created/modified/deleted
- Conflicting items flagged for user decision
- All imports logged in audit_log
- Rollback available via time travel (Feature 1)

#### Documentation Files to Create
- `docs/export-import-reference.md` — Full export/import documentation
- Update `docs/api-reference-complete.md` — Add export/import endpoints

---

### Feature 10: Desktop App Packaging (Electron)

**Priority:** Low
**Effort:** Medium
**Inspiration:** Space Agent's cross-platform desktop app

**Description:**
Package the WebOS as a native desktop application for Windows, macOS, and Linux using Electron, so operators can run it without a browser.

**Full Specification:**

#### Build Pipeline
- Electron main process wraps task-server + auxiliary servers
- Renderer loads the desktop shell from localhost
- Auto-start servers on launch, auto-stop on quit
- System tray integration for background operation

#### Platform Targets
- Windows: NSIS installer (.exe)
- macOS: DMG + .app bundle
- Linux: AppImage

#### CI/CD
- GitHub Actions workflow triggered on version tags
- Build matrix: 3 platforms × 2 architectures (x64, arm64)
- Auto-publish to GitHub Releases

#### Documentation Files to Create
- `docs/desktop-app-reference.md` — Full packaging and distribution guide
- Update `DEVELOPER_GUIDE.md` — Add desktop build instructions

---

## Priority Matrix

| Feature | Impact | Effort | Priority |
|---------|--------|--------|----------|
| 1. Time Travel | High | Medium | **P0 — Next sprint** |
| 2. Hierarchical Docs | High | Low | **P0 — Do immediately** |
| 3. Persistent Agent Memory | High | Medium | **P0 — Next sprint** |
| 4. Space/Workspace System | Medium | Large | P1 |
| 5. Agent-as-Capability | Medium | Large | P1 |
| 6. Deterministic Plugin Discovery | Medium | Medium | P1 |
| 7. Optimistic UI Updates | Medium | Medium | P1 |
| 8. Multi-User Auth | Low | Large | P2 |
| 9. Cloud Share/Export | Low | Medium | P2 |
| 10. Desktop App Packaging | Low | Medium | P2 |

---

## Summary

Space Agent's strongest innovation is its **documentation-as-runtime-contract** model and its **agent-in-the-browser** architecture. Both are directly applicable to OpenClaw WebOS:

1. **Documentation hierarchy** (Feature 2) is nearly free and transforms how we maintain the project
2. **Time Travel** (Feature 1) gives operators fearless experimentation
3. **Persistent memory** (Feature 3) makes agents actually remember across sessions

The medium-term features (Spaces, Agent Chat, Plugin Discovery) would significantly elevate the WebOS experience. The longer-term features (Multi-User, Cloud Share, Desktop App) become relevant as the product scales beyond single-operator use.
