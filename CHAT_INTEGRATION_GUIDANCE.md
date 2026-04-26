# Chat Integration Guidance — Dashboard Sessions View

**Created:** 2026-04-26  
**Author:** Principal engineer investigation  
**Status:** Ready for implementation

---

## Executive Summary

**Recommended approach: Gateway WebSocket RPC (`chat.send`) proxied through the dashboard backend.**

The OpenClaw Gateway exposes a WebSocket RPC API on `ws://127.0.0.1:18789`. The Control UI already uses this for sending messages and streaming responses. The dashboard backend should connect to the gateway as a WebSocket client, proxy `chat.send` requests from the frontend, and stream response events back via SSE.

**Why not the other paths?**
- **CLI (`openclaw agent --session-id`)**: Works but spawns a process per message. No streaming. ~1-2s overhead per invocation. Suitable as a fallback.
- **Direct file manipulation**: Not viable — appending to JSONL doesn't trigger the gateway.
- **REST API**: No REST API on the gateway. WebSocket RPC only.

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Browser                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │         Dashboard Sessions View                  │ │
│  │  [Message Input]  ────POST──→  /api/oc/chat/send│ │
│  │  [Response Stream] ←──SSE───  session:message   │ │
│  └─────────────────────────────────────────────────┘ │
└────────────────────┬─────────────────────────────────┘
                     │ HTTP (REST + SSE)
         ┌───────────┴───────────┐
         │  task-server.js:3876  │
         │                       │
         │  POST /api/oc/chat/send ← frontend calls this
         │  SSE  /api/events     ← streams response back
         │                       │
         │  lib/gateway-client.js│ ← WebSocket client
         └───────────┬───────────┘
                     │ WebSocket RPC
         ┌───────────┴───────────┐
         │  OpenClaw Gateway     │
         │  ws://127.0.0.1:18789│
         │                       │
         │  chat.send  → sends message, returns runId
         │  chat events → streams deltas/final
         │  chat.abort → cancels running turn
         │  chat.history → loads message history
         └───────────────────────┘
```

### Data Flow for Sending a Message

1. User types message → clicks Send
2. Frontend POSTs to `POST /api/oc/chat/send` with `{ sessionKey, message, agentId }`
3. Backend gateway client calls `chat.send` via WebSocket RPC
4. Gateway returns `{ runId }` immediately
5. Gateway emits `chat` events: `delta` (streaming tokens), `final` (complete message), `error`
6. Backend gateway client receives these events, broadcasts them via SSE as `session:chat-delta`, `session:chat-final`, etc.
7. Frontend SSE listener appends tokens to the streaming message bubble

---

## 2. Gateway WebSocket Protocol

### 2.1 Connection

The gateway runs at `ws://127.0.0.1:18789`. The protocol is JSON-based request/response + event streaming.

**Connect handshake:**
```json
→ { "type": "req", "id": "<uuid>", "method": "connect", "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "dashboard-backend",
      "version": "1.0.0",
      "platform": "linux",
      "mode": "backend",
      "instanceId": "<uuid>"
    },
    "role": "operator",
    "scopes": ["operator.admin", "operator.approvals", "operator.pairing", "operator.write", "operator.read"],
    "auth": {
      "token": "<OPENCLAW_GATEWAY_TOKEN or derived from config>"
    },
    "caps": ["tool-events"]
  }
}

← { "type": "res", "id": "<uuid>", "ok": true, "payload": { ... hello payload with snapshot } }
```

**Auth challenge flow (may happen first):**
```json
← { "type": "event", "event": "connect.challenge", "payload": { "nonce": "..." } }
```
When a challenge is received, store the nonce and send the `connect` request.

**Auth options:**
- **Token auth**: Set `auth.token` in connect params. The token comes from `OPENCLAW_GATEWAY_TOKEN` env var or gateway config.
- **Password auth**: Set `auth.password` in connect params.
- **No auth** (loopback): If the gateway is in `trusted-proxy` or `none` auth mode and you're connecting from localhost, no auth may be needed.

**For the dashboard backend** (runs on same machine): Use the same auth that `openclaw gateway call` uses. The CLI reads the token from config automatically. For the Node.js backend, read from `OPENCLAW_GATEWAY_TOKEN` env var or fall back to loopback trusted connection.

### 2.2 Request/Response Pattern

All RPC calls follow this pattern:
```json
→ { "type": "req", "id": "<uuid>", "method": "<method>", "params": { ... } }
← { "type": "res", "id": "<uuid>", "ok": true, "payload": { ... } }
← { "type": "res", "id": "<uuid>", "ok": false, "error": { "code": "...", "message": "..." } }
```

### 2.3 Event Streaming

After connection, the gateway pushes events:
```json
← { "type": "event", "event": "<event-name>", "seq": 42, "payload": { ... } }
```

The `seq` field is a monotonically increasing sequence number for gap detection.

### 2.4 Key RPC Methods for Chat

#### `chat.send` — Send a message to a session

```json
→ request("chat.send", {
    "sessionKey": "agent:main:webchat:abc123",
    "message": "Hello, what's the status?",
    "deliver": false,
    "idempotencyKey": "<uuid>"
  }
)

← { "ok": true, "runId": "<uuid>" }
```

**Parameters:**
- `sessionKey` (required): The session key, e.g. `agent:main:webchat:abc123`
- `message` (required): Text content of the message
- `deliver` (optional, default false): Whether to also deliver the response to the channel (Telegram, etc.)
- `idempotencyKey` (optional): UUID for deduplication
- `attachments` (optional): Array of `{ type: "image", mimeType, content }` for image attachments

**Response:** `{ runId: "<uuid>" }` — use this runId to correlate streaming events.

#### `chat.history` — Load conversation history

```json
→ request("chat.history", {
    "sessionKey": "agent:main:webchat:abc123",
    "limit": 200
  }
)

← {
    "messages": [
      { "role": "user", "content": [...], "timestamp": 1234 },
      { "role": "assistant", "content": [...], "timestamp": 1235 },
      ...
    ],
    "thinkingLevel": "off"
  }
```

**Note:** The dashboard already reads history from JSONL files. This RPC is an alternative that goes through the gateway. For Phase 3, keep reading from JSONL for history; use gateway only for sending.

#### `chat.abort` — Cancel a running turn

```json
→ request("chat.abort", {
    "sessionKey": "agent:main:webchat:abc123",
    "runId": "<uuid>"         // optional: abort specific run
  }
)

← { "ok": true, "aborted": true }
```

#### `sessions.list` — List sessions

```json
→ request("sessions.list", {})
← { "sessions": [...], "path": "...", "count": 42 }
```

### 2.5 Chat Streaming Events

After `chat.send`, the gateway emits `chat` events:

```json
← { "type": "event", "event": "chat", "payload": {
    "sessionKey": "agent:main:webchat:abc123",
    "runId": "<uuid>",
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello! " }]
    }
  }
}
```

**States:**
| State | Meaning | Payload |
|-------|---------|---------|
| `delta` | Token streamed (incremental text) | `message.content` has partial text |
| `final` | Complete response | `message` is the full message object |
| `aborted` | Turn was cancelled | `message` may have partial response |
| `error` | Error occurred | `errorMessage` field |

**Delta handling:** The `delta` state carries the full accumulated text so far (not incremental). Replace the streaming bubble content with each delta.

**Final handling:** The `final` state carries the complete message. Replace the streaming bubble with the final message.

---

## 3. Backend Implementation

### 3.1 New File: `lib/gateway-client.js`

This is a WebSocket client that connects to the OpenClaw Gateway and provides a programmatic API for the dashboard routes.

```javascript
/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to the gateway at ws://127.0.0.1:18789 and provides
 * RPC methods for the dashboard backend.
 *
 * Protocol: JSON-based request/response + event streaming
 * Auth: Token-based (reads from OPENCLAW_GATEWAY_TOKEN env)
 */

const WebSocket = require('ws'); // npm install ws
const crypto = require('crypto');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || null;
const RECONNECT_BACKOFF_MIN = 800;
const RECONNECT_BACKOFF_MAX = 15000;

class GatewayClient {
  constructor(opts = {}) {
    this.url = opts.url || GATEWAY_URL;
    this.token = opts.token || GATEWAY_TOKEN;
    this.ws = null;
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.eventHandlers = new Map(); // event → Set<callback>
    this.connected = false;
    this.helloPayload = null;
    this.closed = false;
    this.backoffMs = RECONNECT_BACKOFF_MIN;
    this.lastSeq = null;
    this.connectNonce = null;
    this.connectSent = false;
    this.connectTimer = null;

    // Callback for connection state changes
    this.onConnected = opts.onConnected || null;
    this.onDisconnected = opts.onDisconnected || null;
  }

  // ── Connection Lifecycle ──────────────────────

  start() {
    this.closed = false;
    this._connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this._flushPending(new Error('gateway client stopped'));
  }

  // ── Public API ────────────────────────────────

  /**
   * Send a chat message to a session.
   * @param {object} params
   * @param {string} params.sessionKey - Session key (e.g. "agent:main:webchat:abc")
   * @param {string} params.message - Text message
   * @param {string} [params.agentId] - Agent ID (for session key derivation)
   * @param {string} [params.sessionId] - Session UUID (alternative to sessionKey)
   * @returns {Promise<{runId: string}>}
   */
  async chatSend({ sessionKey, message, agentId, sessionId }) {
    const key = sessionKey || (agentId && sessionId ? null : null);
    const idempotencyKey = crypto.randomUUID();

    return this._request('chat.send', {
      sessionKey: key,
      message,
      deliver: false,
      idempotencyKey,
    });
  }

  /**
   * Abort a running chat turn.
   * @param {string} sessionKey
   * @param {string} [runId]
   */
  async chatAbort(sessionKey, runId) {
    return this._request('chat.abort', {
      sessionKey,
      runId,
    });
  }

  /**
   * Get chat history for a session.
   * @param {string} sessionKey
   * @param {number} [limit=200]
   */
  async chatHistory(sessionKey, limit = 200) {
    return this._request('chat.history', { sessionKey, limit });
  }

  /**
   * Register an event handler.
   * @param {string} event - Event name (e.g. 'chat')
   * @param {function} handler - (payload) => void
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }

  /**
   * Remove an event handler.
   */
  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  // ── Internal ──────────────────────────────────

  _connect() {
    if (this.closed) return;

    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', () => {
      this._queueConnect();
    });

    this.ws.addEventListener('message', (event) => {
      this._handleMessage(String(event.data || ''));
    });

    this.ws.addEventListener('close', (event) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      this._flushPending(new Error(`gateway closed (${event.code}): ${event.reason}`));
      if (this.onDisconnected && wasConnected) this.onDisconnected();
      if (!this.closed) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // Close handler will deal with reconnection
    });
  }

  _queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => this._sendConnect(), 750);
  }

  async _sendConnect() {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'dashboard-backend',
        version: '1.0.0',
        platform: 'linux',
        mode: 'backend',
        instanceId: crypto.randomUUID(),
      },
      role: 'operator',
      scopes: [
        'operator.admin',
        'operator.approvals',
        'operator.pairing',
        'operator.write',
        'operator.read',
      ],
      caps: ['tool-events'],
      auth: this.token ? { token: this.token } : undefined,
    };

    try {
      const result = await this._request('connect', connectParams);
      this.connected = true;
      this.helloPayload = result;
      this.backoffMs = RECONNECT_BACKOFF_MIN;
      if (this.onConnected) this.onConnected(result);
    } catch (err) {
      console.error('[gateway-client] connect failed:', err.message);
      this.ws?.close(4008, 'connect failed');
    }
  }

  _scheduleReconnect() {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, RECONNECT_BACKOFF_MAX);
    setTimeout(() => this._connect(), delay);
  }

  _request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('gateway not connected'));
        return;
      }

      const id = crypto.randomUUID();
      const msg = { type: 'req', id, method, params };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Handle connect.challenge event
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload?.nonce;
      if (nonce) {
        this.connectNonce = nonce;
        this._sendConnect();
      }
      return;
    }

    // Handle events
    if (msg.type === 'event') {
      const seq = typeof msg.seq === 'number' ? msg.seq : null;
      if (seq !== null) this.lastSeq = seq;
      this._emit(msg.event, msg.payload);
      return;
    }

    // Handle responses
    if (msg.type === 'res') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        const err = new Error(msg.error?.message || 'request failed');
        err.code = msg.error?.code;
        err.details = msg.error?.details;
        pending.reject(err);
      }
    }
  }

  _emit(event, payload) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[gateway-client] event handler error (${event}):`, err);
        }
      }
    }
  }

  _flushPending(error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

module.exports = GatewayClient;
```

### 3.2 New Route: `routes/chat-routes.js`

```javascript
/**
 * Chat routes — Phase 3 Integration
 *
 * Provides endpoints for sending messages to OpenClaw sessions
 * and streaming responses back via SSE.
 */

const Router = require('./router');

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getQuery(req) {
  const fullUrl = req.url || '';
  const qIdx = fullUrl.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(fullUrl.slice(qIdx));
}

function registerChatRoutes(router, gatewayClient) {
  // Only register if gateway client is available

  // POST /api/oc/chat/send — Send a message to a session
  router.add('POST', '/api/oc/chat/send', async (req, res, ctx) => {
    if (!gatewayClient || !gatewayClient.connected) {
      sendJSON(res, 503, { error: 'Gateway not connected' });
      return;
    }

    let body;
    try {
      body = await ctx.parseJSONBody(req);
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const { sessionKey, message, agentId, sessionId } = body;

    if (!sessionKey && !sessionId) {
      sendJSON(res, 400, { error: 'sessionKey or sessionId required' });
      return;
    }

    if (!message || !message.trim()) {
      sendJSON(res, 400, { error: 'message required' });
      return;
    }

    try {
      const result = await gatewayClient.chatSend({
        sessionKey,
        message: message.trim(),
        agentId,
        sessionId,
      });

      sendJSON(res, 200, {
        ok: true,
        runId: result.runId || result.id || null,
      });
    } catch (err) {
      const status = err.code === 'SESSION_NOT_FOUND' ? 404
                   : err.code === 'SESSION_BUSY' ? 409
                   : err.code === 'RATE_LIMITED' ? 429
                   : 500;
      sendJSON(res, status, {
        error: err.message,
        code: err.code || null,
      });
    }
  });

  // POST /api/oc/chat/abort — Abort a running turn
  router.add('POST', '/api/oc/chat/abort', async (req, res, ctx) => {
    if (!gatewayClient || !gatewayClient.connected) {
      sendJSON(res, 503, { error: 'Gateway not connected' });
      return;
    }

    let body;
    try {
      body = await ctx.parseJSONBody(req);
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const { sessionKey, runId } = body;

    if (!sessionKey) {
      sendJSON(res, 400, { error: 'sessionKey required' });
      return;
    }

    try {
      const result = await gatewayClient.chatAbort(sessionKey, runId);
      sendJSON(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  // GET /api/oc/chat/status — Check if gateway is connected
  router.add('GET', '/api/oc/chat/status', async (req, res) => {
    sendJSON(res, 200, {
      connected: gatewayClient?.connected || false,
      gatewayUrl: gatewayClient?.url || null,
    });
  });
}

module.exports = { registerChatRoutes };
```

### 3.3 Integration in `task-server.js`

Add to the server initialization:

```javascript
// ── After existing route registrations ──

// Gateway client for chat
let gatewayClient = null;
try {
  const GatewayClient = require('./lib/gateway-client');
  const { broadcast } = require('./routes/sse-routes');

  gatewayClient = new GatewayClient({
    url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
    token: process.env.OPENCLAW_GATEWAY_TOKEN || null,
    onConnected: () => {
      console.log('✅ Gateway client connected');
      broadcast('gateway:status', { connected: true });
    },
    onDisconnected: () => {
      console.log('⚠️  Gateway client disconnected');
      broadcast('gateway:status', { connected: false });
    },
  });

  // Forward chat events to SSE clients
  gatewayClient.on('chat', (payload) => {
    const { sessionKey, runId, state } = payload;

    if (state === 'delta') {
      // Streaming token delta
      broadcast('session:chat-delta', {
        sessionKey,
        runId,
        text: _extractText(payload.message),
      });
    } else if (state === 'final') {
      // Complete response
      broadcast('session:chat-final', {
        sessionKey,
        runId,
        message: payload.message,
      });
    } else if (state === 'aborted') {
      broadcast('session:chat-aborted', {
        sessionKey,
        runId,
        message: payload.message || null,
      });
    } else if (state === 'error') {
      broadcast('session:chat-error', {
        sessionKey,
        runId,
        error: payload.errorMessage || 'chat error',
      });
    }
  });

  // Forward agent status events
  gatewayClient.on('agent', (payload) => {
    broadcast('session:agent-event', payload);
  });

  gatewayClient.start();
} catch (err) {
  console.error('⚠️  Failed to initialize gateway client:', err.message);
}

// Register chat routes (pass gateway client)
const { registerChatRoutes } = require('./routes/chat-routes');
registerChatRoutes(router, gatewayClient);
```

### 3.4 Helper: Extract Text from Message

```javascript
function _extractText(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  const content = message.content;
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('');
  }
  return '';
}
```

---

## 4. Frontend Implementation

### 4.1 Session Key Resolution

The dashboard currently identifies sessions by `sessionId` (UUID). The gateway API uses `sessionKey` strings like `agent:main:webchat:abc123`.

**Resolution strategy:**
1. Sessions loaded from `sessions.json` already have both `key` and `sessionId`.
2. When sending a message, use `session.key` as the `sessionKey` parameter.
3. Store `session.key` alongside `session.sessionId` in the sessions list state.

```javascript
// In sessions-view.mjs, when selecting a session:
async function selectSession(session) {
  selectedSessionId = session.sessionId;
  selectedSessionKey = session.key; // ← ADD THIS
  // ...
}
```

### 4.2 Chat Input UI

Add to the chat area in `sessions-view.mjs`:

```javascript
// After messagesContainer, add input bar:
const inputBar = document.createElement('div');
inputBar.className = 'sv-input-bar';
inputBar.style.cssText = `
  padding: 10px 16px;
  border-top: 1px solid var(--win11-border);
  display: flex;
  gap: 8px;
  background: var(--win11-surface-solid, #16213e);
`;

const input = document.createElement('input');
input.className = 'sv-chat-input';
input.type = 'text';
input.placeholder = 'Type a message... (Enter to send, Shift+Enter for newline)';
input.style.cssText = `
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--win11-border);
  background: var(--win11-surface);
  color: var(--win11-text);
  font-size: 0.85rem;
`;

const sendBtn = document.createElement('button');
sendBtn.className = 'sv-btn sv-send-btn';
sendBtn.textContent = 'Send';
sendBtn.style.cssText = `
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--win11-accent, #60cdff);
  color: #000;
  border: none;
  font-weight: 600;
  cursor: pointer;
`;

inputBar.appendChild(input);
inputBar.appendChild(sendBtn);
chatArea.appendChild(inputBar);

// Enable/disable based on gateway status
function updateChatInput() {
  const enabled = gatewayConnected && selectedSessionKey;
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  input.placeholder = !gatewayConnected
    ? 'Gateway not connected...'
    : !selectedSessionKey
    ? 'Select a session first...'
    : 'Type a message...';
}
```

### 4.3 Sending Messages

```javascript
async function sendMessage() {
  const text = input.value.trim();
  if (!text || !selectedSessionKey || sending) return;

  sending = true;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  input.value = '';

  // Add user message to UI immediately
  appendMessage('user', text);

  // Create streaming assistant bubble
  const streamBubble = createStreamingBubble();
  messagesContainer.appendChild(streamBubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const resp = await fetch('/api/oc/chat/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        sessionKey: selectedSessionKey,
        message: text,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    const { runId } = await resp.json();
    currentRunId = runId;

    // SSE events will update the streaming bubble
  } catch (err) {
    streamBubble.remove();
    appendSystemMessage(`Error: ${err.message}`);
  } finally {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    updateChatInput();
  }
}

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
```

### 4.4 Streaming Response via SSE

```javascript
// In sessions-view.mjs, add SSE subscription:

let currentRunId = null;
let streamingBubble = null;
let streamingText = '';

function subscribeToSessionEvents() {
  const es = new EventSource(`/api/events?token=${getToken()}`);

  es.addEventListener('session:chat-delta', (event) => {
    const data = JSON.parse(event.data);
    if (data.sessionKey !== selectedSessionKey) return;

    streamingText = data.text; // Full accumulated text, not incremental
    updateStreamingBubble(streamingText);
  });

  es.addEventListener('session:chat-final', (event) => {
    const data = JSON.parse(event.data);
    if (data.sessionKey !== selectedSessionKey) return;

    finalizeStreamingBubble(data.message);
    currentRunId = null;
  });

  es.addEventListener('session:chat-error', (event) => {
    const data = JSON.parse(event.data);
    if (data.sessionKey !== selectedSessionKey) return;

    errorStreamingBubble(data.error);
    currentRunId = null;
  });

  es.addEventListener('session:chat-aborted', (event) => {
    const data = JSON.parse(event.data);
    if (data.sessionKey !== selectedSessionKey) return;

    finalizeStreamingBubble(data.message || { content: [{ type: 'text', text: streamingText }] });
    currentRunId = null;
  });

  es.addEventListener('gateway:status', (event) => {
    const data = JSON.parse(event.data);
    gatewayConnected = data.connected;
    updateChatInput();
  });
}

function createStreamingBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'sv-msg sv-msg-assistant sv-msg-streaming';
  bubble.innerHTML = `
    <div class="sv-msg-role">🤖 Agent <span class="sv-streaming-indicator">●</span></div>
    <div class="sv-msg-content"></div>
  `;
  bubble.querySelector('.sv-streaming-indicator').style.cssText = `
    animation: sv-blink 1s infinite;
    color: var(--win11-accent);
  `;
  streamingBubble = bubble;
  streamingText = '';
  return bubble;
}

function updateStreamingBubble(text) {
  if (!streamingBubble) return;
  const content = streamingBubble.querySelector('.sv-msg-content');
  content.innerHTML = formatMessageContent(text);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function finalizeStreamingBubble(message) {
  if (!streamingBubble) return;
  const text = extractText(message?.content);
  streamingBubble.querySelector('.sv-msg-content').innerHTML =
    formatMessageContent(text || streamingText);
  // Remove streaming indicator
  const indicator = streamingBubble.querySelector('.sv-streaming-indicator');
  if (indicator) indicator.remove();
  streamingBubble.classList.remove('sv-msg-streaming');
  streamingBubble = null;
  streamingText = '';
}

function errorStreamingBubble(error) {
  if (!streamingBubble) return;
  streamingBubble.querySelector('.sv-msg-content').innerHTML =
    `<span style="color:#ef4444;">Error: ${escapeHtml(error)}</span>`;
  const indicator = streamingBubble.querySelector('.sv-streaming-indicator');
  if (indicator) indicator.remove();
  streamingBubble = null;
  streamingText = '';
}
```

### 4.5 CSS Additions

```css
/* Add to the style block in sessions-view.mjs */

.sv-input-bar {
  padding: 10px 16px;
  border-top: 1px solid var(--win11-border);
  display: flex;
  gap: 8px;
  background: var(--win11-surface-solid, #16213e);
}

.sv-chat-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--win11-border);
  background: var(--win11-surface);
  color: var(--win11-text);
  font-size: 0.85rem;
}

.sv-chat-input:focus {
  outline: none;
  border-color: var(--win11-accent);
}

.sv-chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sv-send-btn {
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--win11-accent, #60cdff);
  color: #000;
  border: none;
  font-weight: 600;
  cursor: pointer;
}

.sv-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes sv-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.sv-msg-streaming .sv-msg-content {
  border-left: 2px solid var(--win11-accent);
  padding-left: 8px;
}
```

---

## 5. Session Key Mapping

The dashboard currently uses `sessionId` (UUID) to identify sessions. The gateway uses `sessionKey` (string). The mapping already exists in `sessions.json`:

```json
{
  "agent:main:webchat:abc123": {
    "sessionId": "0a6ed333-9514-4a65-a748-85a4d0785b7b",
    ...
  }
}
```

**Strategy:**
1. When loading sessions, store both `key` and `sessionId` for each session.
2. Use `sessionId` for JSONL file lookups (current backend).
3. Use `key` (sessionKey) for gateway RPC calls (new chat functionality).
4. The `GET /api/oc/sessions/:sessionId` endpoint already returns the `key` field.

No database changes needed.

---

## 6. Error Handling

### 6.1 Gateway Not Connected

```javascript
// Backend
if (!gatewayClient || !gatewayClient.connected) {
  sendJSON(res, 503, { error: 'Gateway not connected' });
  return;
}

// Frontend: Show gateway status indicator
// Fetch /api/oc/chat/status periodically or subscribe to gateway:status SSE
```

### 6.2 Session Busy (Agent Already Running)

The gateway returns an error if you try to send to a session that already has a running turn. The frontend should:
1. Show "Agent is thinking..." with an abort button
2. On `chat.send` error with code `SESSION_BUSY`, show a retry prompt
3. Provide an "Abort" button that calls `POST /api/oc/chat/abort`

### 6.3 Session Not Found

If the session was deleted or expired:
```
POST /api/oc/chat/send → 404 { error: "Session not found", code: "SESSION_NOT_FOUND" }
```
Frontend: Show "Session not found" and refresh the session list.

### 6.4 Timeout

Gateway RPC has a default 30s timeout. Chat responses can take much longer (agent thinking, tool calls). The streaming events arrive asynchronously, so the RPC call (`chat.send`) returns quickly with the `runId`. The actual response comes via events.

If no events arrive within 60 seconds of the last delta, show a timeout warning in the UI.

### 6.5 WebSocket Reconnection

The `GatewayClient` handles reconnection automatically with exponential backoff (800ms → 15s max). On reconnection:
1. The `connect` RPC is re-sent.
2. Event subscriptions are implicit (all events are broadcast).
3. Any in-progress `chat.send` RPCs will have their promises rejected on disconnect.

---

## 7. Security Considerations

### 7.1 Auth

| Layer | Mechanism |
|-------|-----------|
| Dashboard frontend → backend | Bearer token (`DASHBOARD_AUTH_TOKEN`) — already implemented |
| Dashboard backend → gateway | Gateway token (`OPENCLAW_GATEWAY_TOKEN`) or loopback trust |
| Gateway → agents | Internal routing, no additional auth needed |

**Important:** The gateway token must **never** be sent to the browser. It stays in the backend process only.

### 7.2 Input Validation

```javascript
// In chat-routes.js
const MAX_MESSAGE_LENGTH = 10000;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 messages per minute per session

// Validate message length
if (message.length > MAX_MESSAGE_LENGTH) {
  return sendJSON(res, 400, { error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
}

// Rate limiting (simple in-memory)
const rateLimits = new Map(); // sessionKey → { count, resetAt }

function checkRateLimit(sessionKey) {
  const now = Date.now();
  const limit = rateLimits.get(sessionKey);
  if (!limit || now > limit.resetAt) {
    rateLimits.set(sessionKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (limit.count >= RATE_LIMIT_MAX) return false;
  limit.count++;
  return true;
}
```

### 7.3 Session Access Control

The dashboard backend currently reads all sessions from the filesystem. For chat, we trust the gateway to enforce access control. The backend should verify that the `sessionKey` matches a session the user has access to.

For a single-user deployment (current setup), this is not a concern. For multi-user, add session ownership checks.

---

## 8. Fallback: CLI-Based Sending

If the gateway WebSocket is unavailable, fall back to CLI:

```javascript
// In chat-routes.js, add fallback logic
async function sendViaCLI(sessionKey, message, agentId) {
  const { spawn } = require('child_process');
  const args = ['agent', '--agent', agentId || 'main'];

  // If we have a session key, extract session ID or use --to
  // The CLI doesn't have a --session-key flag, but has --session-id
  // Extract sessionId from sessions.json for this key

  args.push('--message', message, '--json');

  return new Promise((resolve, reject) => {
    const proc = spawn('openclaw', args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ ok: true, raw: stdout }); }
      } else {
        reject(new Error(stderr || `exit code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}
```

**Note:** CLI fallback doesn't support streaming. It blocks until the full response is ready. Use only when gateway is down.

---

## 9. New Files Summary

| File | Purpose |
|------|---------|
| `lib/gateway-client.js` | WebSocket client for OpenClaw Gateway |
| `routes/chat-routes.js` | Chat REST endpoints (send, abort, status) |

**Modified files:**

| File | Changes |
|------|---------|
| `task-server.js` | Import GatewayClient, register chat routes, wire up SSE forwarding |
| `src/shell/native-views/sessions-view.mjs` | Add chat input, SSE streaming, send/abort buttons |

**New dependency:**

| Package | Purpose |
|---------|---------|
| `ws` | WebSocket client for Node.js (not built-in) |

---

## 10. Implementation Order

1. **`npm install ws`** in the dashboard directory
2. **Create `lib/gateway-client.js`** — WebSocket client
3. **Create `routes/chat-routes.js`** — REST endpoints
4. **Modify `task-server.js`** — Wire up gateway client + chat routes
5. **Test backend**: `curl -X POST http://localhost:3876/api/oc/chat/send -H 'Content-Type: application/json' -H 'Authorization: Bearer <token>' -d '{"sessionKey":"agent:main:webchat:...","message":"test"}'`
6. **Modify `sessions-view.mjs`** — Add chat input + SSE streaming
7. **Test end-to-end**: Send a message, see streaming response

---

## 11. Gateway RPC Reference (Complete)

These are all the RPC methods available on the gateway (from Control UI source):

| Method | Purpose | Dashboard Use |
|--------|---------|---------------|
| `connect` | Authenticate + get snapshot | ✅ Core |
| `health` | Health check | ✅ Status |
| `chat.send` | Send message to session | ✅ **Core for chat** |
| `chat.abort` | Cancel running turn | ✅ Abort button |
| `chat.history` | Get message history | Optional (JSONL reads work too) |
| `sessions.list` | List sessions | Optional (file reads work too) |
| `sessions.patch` | Update session settings | Future |
| `sessions.delete` | Delete session | Future |
| `sessions.reset` | Reset session context | Future |
| `models.list` | List available models | Future |
| `agents.list` | List configured agents | Optional |
| `tools.catalog` | List available tools | Future |
| `cron.*` | Cron management | Already have via crontab |
| `exec.approval.resolve` | Approve/deny exec requests | Future |

---

## 12. Testing Checklist

- [ ] Gateway client connects successfully on server start
- [ ] `GET /api/oc/chat/status` returns `{ connected: true }`
- [ ] `POST /api/oc/chat/send` with valid sessionKey returns `{ ok: true, runId }`
- [ ] SSE receives `session:chat-delta` events with streaming text
- [ ] SSE receives `session:chat-final` event with complete message
- [ ] Chat input appears only when gateway is connected
- [ ] Multiple concurrent SSE clients receive events
- [ ] Abort button cancels running turn
- [ ] Gateway disconnect is detected and UI updates
- [ ] Gateway reconnection works automatically
- [ ] Error messages display in UI (session not found, busy, etc.)
- [ ] Message appears in JSONL file after sending (verify persistence)
