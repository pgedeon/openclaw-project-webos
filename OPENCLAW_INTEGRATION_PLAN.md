# OpenClaw ↔ Dashboard Integration Plan

**Created:** 2026-04-26  
**Status:** Planning  
**Goal:** Make the Project Dashboard a full client for OpenClaw sessions, conversations, and real-time chat.

---
**Last Updated:** 2026-04-26 14:50 CEST

---

## Progress Tracker

### Phase 1: Session Browser (Read-Only) — IN PROGRESS

| Step | Description | Status |
|------|-------------|--------|
| Backend: `lib/session-jsonl-reader.js` | JSONL parser with pagination | ✅ Done |
| Backend: `routes/session-routes.js` | 4 REST endpoints | ✅ Done |
| Backend: Register routes in `task-server.js` | Import + registration | ✅ Done |
| Backend: Fix sessions.json format (flat object) | normalizeSessions() | ✅ Done |
| Frontend: `sessions-view.mjs` | Session list + chat view | ✅ Done |
| Frontend: Register in `app-registry.mjs` | App entry + icon | ✅ Done |
| Frontend: Test in browser | Visual verification | ⬜ Pending |
| Backend: Verify all endpoints | Smoke test | ✅ Done |

**Backend Endpoints Verified:**
- `GET /api/oc/agents` → 58 agents, 24 with sessions ✅
- `GET /api/oc/sessions?agent=main` → 79 sessions ✅
- `GET /api/oc/sessions?all=true` → cross-agent sessions ✅
- `GET /api/oc/sessions/:id?messages=N` → session detail + messages ✅
- `GET /api/oc/sessions/:id/messages?after=N&limit=N` → paginated messages ✅
- Auth blocks unauthenticated requests (401) ✅

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    Browser                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │         Project Dashboard (Win11 Shell)          │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │ │
│  │  │ Sessions │ │  Chat    │ │  Session         │ │ │
│  │  │ Sidebar  │ │  View    │ │  Details Panel   │ │ │
│  │  └──────────┘ └──────────┘ └──────────────────┘ │ │
│  └─────────────────┬───────────────────────────────┘ │
│                    │ SSE + REST                       │
└────────────────────┼─────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │  task-server.js:3876  │
         │  (Dashboard Backend)  │
         │                       │
         │  NEW: /api/sessions/* │
         │  NEW: /api/chat/*     │
         │  NEW: /ws/openclaw    │
         └───────────┬───────────┘
                     │ CLI + JSONL
         ┌───────────┴───────────┐
         │  OpenClaw Gateway     │
         │  (127.0.0.1:18789)    │
         │                       │
         │  - Sessions store     │
         │  - Session JSONL logs │
         │  - Agent routing      │
         └───────────────────────┘
```

### Data Flow

1. **Session List**: Dashboard reads `~/.openclaw/agents/*/sessions/sessions.json` via backend → renders sidebar
2. **Chat History**: Dashboard reads `~/.openclaw/agents/*/sessions/<id>.jsonl` via backend → renders messages
3. **Send Message**: Dashboard POSTs to backend → backend invokes `openclaw sessions send` (or gateway WebSocket) → message routed to agent
4. **Real-time Updates**: Backend watches session JSONL files for changes → pushes via SSE → frontend appends new messages

---

## 2. OpenClaw API Surface

### What's Available

| Source | Method | Description |
|--------|--------|-------------|
| `openclaw sessions --json --agent <id>` | CLI | List all sessions for an agent |
| `openclaw sessions --json --all-agents` | CLI | List sessions across all agents |
| `~/.openclaw/agents/<agent>/sessions/sessions.json` | File | Session metadata (key, updatedAt, model, tokens, kind) |
| `~/.openclaw/agents/<agent>/sessions/<uuid>.jsonl` | File | Full conversation log (messages, tool calls, results) |
| Gateway WebSocket `ws://127.0.0.1:18789` | WS | Real-time message streaming (used by Control UI) |
| `openclaw agent --message "..."` | CLI | Send a message to an agent (creates new turn) |

### Session Data Shape (from sessions.json)

```json
{
  "key": "agent:main:webchat:abc123",
  "updatedAt": 1777207251785,
  "sessionId": "0a6ed333-9514-4a65-a748-85a4d0785b7b",
  "model": "GLM-5.1",
  "modelProvider": "zai",
  "contextTokens": 180000,
  "inputTokens": 206236,
  "outputTokens": 975,
  "totalTokens": 130937,
  "agentId": "main",
  "kind": "direct",
  "systemSent": true,
  "abortedLastRun": false
}
```

### Message Data Shape (from JSONL)

```
L0: { "type": "session", "version": 1, "id": "uuid", "timestamp": ..., "cwd": "..." }
L1: { "type": "model_change", "provider": "zai", "modelId": "GLM-5.1", ... }
L2: { "type": "message", "message": { "role": "user", "content": [...] }, ... }
L3: { "type": "message", "message": { "role": "assistant", "content": [...] }, ... }
L4: { "type": "message", "message": { "role": "toolResult", "content": [...] }, ... }
```

### Sending Messages

Two options:
1. **CLI**: `openclaw agent --agent <id> --message "text"` — creates a new agent turn
2. **Gateway WebSocket**: Connect to `ws://127.0.0.1:18789` and send structured messages — this is how the Control UI works, supports real-time streaming of agent responses

---

## 3. Phase Breakdown

### Phase 1: Session Browser (Read-Only) — ~4 hours

**Goal**: See all OpenClaw sessions in the dashboard sidebar, click to view conversation history.

#### Backend

| File | Changes |
|------|---------|
| `routes/session-routes.js` | **NEW** — 4 endpoints |
| `routes/router.js` | Register session routes |

**New Endpoints**:

```
GET /api/oc/sessions?agent=main&active=60
  → Lists sessions from sessions.json, optionally filtered by agent/recency
  → Returns: [{ key, sessionId, updatedAt, model, agentId, kind, totalTokens, ... }]

GET /api/oc/sessions/:sessionId?agent=main
  → Returns session metadata + last N messages

GET /api/oc/sessions/:sessionId/messages?after=<line>&limit=50&agent=main
  → Streams message history from JSONL file
  → Returns parsed messages with pagination (line-based cursor)
  → Filters to type=message only, includes role + content

GET /api/oc/agents
  → Lists all configured agents with status
  → Reads from ~/.openclaw/agents/*/agent.yaml or openclaw status --json
```

**Implementation notes**:
- Read session files directly from filesystem (no gateway dependency for reads)
- Cache `sessions.json` for 5 seconds to avoid hammering disk
- Parse JSONL incrementally (don't load 3MB files into memory)
- Use line-based pagination: `?after=150` returns lines 151-200

#### Frontend

| File | Changes |
|------|---------|
| `src/shell/native-views/sessions-view.mjs` | **NEW** — Session list + chat view |
| `src/shell/realtime-sync.mjs` | Add session polling |
| `src/shell/api-client.mjs` | Add OC session methods |

**Sessions View Layout**:
```
┌─────────────────────────────────────────────────────┐
│ 🤖 OpenClaw Sessions                    [Refresh]   │
├──────────────┬──────────────────────────────────────┤
│ Agent: main  │ 💬 agent:main:webchat:abc123         │
│              │ ─────────────────────────────         │
│ ▸ Sessions   │ 👤 User: Can you check the blog...   │
│   🟢 webchat │ 🤖 Agent: Let me look at the...      │
│   🟡 subagent│ 🔧 Tool: web_search("blog...")       │
│   ⚪ cron    │ 🤖 Agent: Found 3 issues...          │
│   🟢 codex   │ 👤 User: Fix them                    │
│              │ 🤖 Agent: Working on it...            │
│ Agent: 3dput │                                      │
│   ⚪ webchat │ ┌──────────────────────────────────┐ │
│              │ │ Type a message...         [Send]  │ │
│              │ └──────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────┘
```

**Message rendering**:
- `role=user` → Right-aligned blue bubble
- `role=assistant` → Left-aligned dark bubble, markdown rendered
- `role=toolResult` → Collapsible gray block with tool name + result preview
- Show timestamps, token counts in session details panel

---

### Phase 2: Real-Time Message Streaming — ~3 hours

**Goal**: New messages appear instantly without polling when an agent is actively responding.

#### Backend

| File | Changes |
|------|---------|
| `routes/session-routes.js` | Add JSONL file watcher |
| `routes/sse-routes.js` | Broadcast session events |

**Approach**: Watch active session JSONL files for changes using `fs.watch()`:

```js
// When a session becomes "active" (agent is running):
// 1. fs.watch() the session's .jsonl file
// 2. On change, read new lines from last known offset
// 3. Parse and broadcast via SSE: { event: 'session:message', data: { sessionId, message } }
```

**SSE Events**:
```
event: session:updated     → { sessionId, agentId, updatedAt }
event: session:message     → { sessionId, message: { role, content, timestamp } }
event: session:started     → { sessionId, agentId, key }
event: session:completed   → { sessionId, agentId, totalTokens }
```

#### Frontend

- `sessions-view.mjs` subscribes to SSE events for the active session
- Auto-scrolls to bottom on new messages
- Shows typing indicator when `session:started` and no assistant message yet
- Updates session list badges on `session:updated`

---

### Phase 3: Send Messages (Chat) — ~4 hours

**Goal**: Send messages to any session from the dashboard and see responses stream back.

#### Backend

| File | Changes |
|------|---------|
| `routes/session-routes.js` | Add message sending endpoint |
| `routes/sse-routes.js` | Wire up response streaming |

**New Endpoint**:
```
POST /api/oc/sessions/:sessionId/messages
  Body: { message: "text", agentId: "main" }
  → Invokes: openclaw agent --agent <agentId> --message "text" --session <sessionId>
  → Returns: { ok: true, runId: "..." }
```

**Response streaming approach**:
- After sending, the backend watches the session JSONL for new lines
- New lines are broadcast via SSE as `session:message` events
- Frontend appends them in real-time (same as Phase 2)

**Alternative (Gateway WebSocket proxy)**:
- Connect to `ws://127.0.0.1:18789` from the backend
- Proxy messages between dashboard SSE and gateway WebSocket
- More complex but gives true streaming (token-by-token)

**Recommendation**: Start with CLI-based sending + JSONL watching. Simpler, works offline, no gateway dependency for the core flow. Upgrade to WebSocket proxy in Phase 5.

#### Frontend

- Chat input at bottom of session view
- Send button triggers POST, shows loading state
- SSE delivers response messages in real-time
- Support Shift+Enter for multiline, Enter to send

---

### Phase 4: Multi-Agent & Channel Awareness — ~3 hours

**Goal**: Show which channel each session came from (webchat, Signal, Telegram, Discord), support switching between agents.

#### Backend

```
GET /api/oc/agents
  → Lists all agents with: id, enabled, model, heartbeat schedule, session count

GET /api/oc/channels
  → Lists connected channels from openclaw channels list --json
  → Returns: [{ type: "telegram", label: "Personal TG", connected: true }]
```

#### Frontend

- Agent dropdown in sessions sidebar
- Channel badges on sessions (Telegram icon, Discord icon, etc.)
- Filter sessions by agent, channel, or status (active/idle)
- Session search by message content

---

### Phase 5: Gateway WebSocket Integration — ~6 hours

**Goal**: Direct WebSocket connection to the OpenClaw Gateway for true real-time streaming.

#### Architecture

```
Browser ←SSE→ task-server ←WebSocket→ Gateway (18789)
```

The dashboard backend acts as a WebSocket client to the gateway, proxying events to the browser via SSE (or eventually a direct WebSocket).

**Steps**:
1. Parse the gateway WebSocket protocol (reverse-engineer from Control UI source)
2. Implement WS client in `lib/gateway-client.js`
3. Subscribe to session events: `session:start`, `message:delta`, `session:end`
4. Forward token-by-token streaming deltas to the browser
5. Support sending messages through the gateway WS instead of CLI

**Benefits**:
- True streaming (see each token as it's generated)
- No CLI process spawning for each message
- Lower latency
- Access to gateway events (agent status changes, channel messages)

---

### Phase 6: Polish & UX — ~4 hours

**Goal**: Make it feel like a native chat app.

- Message rendering: Markdown, code blocks with syntax highlighting, image attachments
- Session management: Create new sessions, archive old ones, pin favorites
- Keyboard shortcuts: Ctrl+K to search sessions, Escape to close
- Notifications: Browser notifications for new messages in background sessions
- Mobile responsive: Sessions view works on phone-sized screens
- Dark/light theme support following dashboard theme

---

## 4. New Files Summary

| File | Phase | Purpose |
|------|-------|---------|
| `routes/session-routes.js` | 1 | Session list, history, message endpoints |
| `src/shell/native-views/sessions-view.mjs` | 1 | Session browser + chat UI |
| `lib/gateway-client.js` | 5 | WebSocket client for Gateway |
| `lib/session-jsonl-reader.js` | 1 | Incremental JSONL parser with line cursor |

## 5. Security Considerations

- **Auth**: All `/api/oc/*` endpoints require Bearer token (same as existing auth middleware)
- **File access**: Session file reads are scoped to `~/.openclaw/agents/*/sessions/` — path traversal protection via existing middleware
- **Message sending**: Rate-limited to prevent spamming agents
- **Gateway auth**: WebSocket connection to gateway uses password auth from config
- **No credentials in frontend**: Gateway password stays on the backend, never sent to browser

## 6. Technical Notes

### JSONL Parsing Strategy

Session files can be 3MB+. Loading them entirely into memory is wasteful for pagination.

**Approach**: Line-based cursor pagination:
1. First request: read last N lines (using `fs.read` with offset from end)
2. Return `nextCursor: lineNumber` in response
3. Subsequent requests: `?after=nextCursor` reads forward from that line
4. For real-time: `fs.watch()` triggers reads of new lines only

### Session Kind Mapping

| Session key pattern | Kind | Icon |
|--------------------|------|------|
| `agent:*:webchat:*` | Web chat | 💬 |
| `agent:*:subagent:*` | Sub-agent | 🔧 |
| `agent:*:signal:*` | Signal | 📱 |
| `agent:*:telegram:*` | Telegram | ✈️ |
| `agent:*:discord:*` | Discord | 🎮 |
| `agent:*:cron:*` | Cron/heartbeat | ⏰ |

### Compatibility

- Works with the existing Win11 shell widget system
- Sessions view integrates as a new native view (like board-view, timeline-view)
- No changes to existing task/project management features
- SSE infrastructure already exists — just adding new event types

---

## 7. Effort Estimate

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Session Browser (read-only) | 4 hours |
| 2 | Real-time streaming | 3 hours |
| 3 | Send messages (chat) | 4 hours |
| 4 | Multi-agent & channels | 3 hours |
| 5 | Gateway WebSocket | 6 hours |
| 6 | Polish & UX | 4 hours |
| | **Total** | **~24 hours** |

---

## 8. Recommended Start

**Phase 1 first** — it's the foundation and delivers immediate value (seeing all your conversations in one place). Then Phase 2 for real-time, Phase 3 for chat. Phases 4-6 can be prioritized based on usage patterns.
