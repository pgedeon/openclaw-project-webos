/**
 * OpenClaw Sessions View — Phase 1 + 3 Integration
 *
 * Browse all OpenClaw sessions, read conversation history, and send messages.
 * Split layout: session list (left) + chat messages with input (right).
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

export async function renderSessionsView({ mountNode, api, adapter, stateStore, sync }) {
  ensureNativeRoot(mountNode, 'sessions-view');
  mountNode.innerHTML = '';

  // ── State ──────────────────────────────────────
  let sessions = [];
  let agents = [];
  let selectedAgentId = 'main';
  let selectedSessionId = null;
  let selectedSessionKey = null;
  let messages = [];
  let sessionMeta = null;
  let isLoading = false;
  let isLoadingMessages = false;
  let hasOlder = false;
  let oldestLine = 0;
  let searchQuery = '';
  let gatewayConnected = false;
  let chatSending = false;
  let currentRunId = null;
  let streamingText = '';

  // ── Styles ─────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .sv-layout { display:flex; height:100%; background:var(--win11-bg, #1a1a2e); color:var(--win11-text); }
    .sv-sidebar {
      width:280px; min-width:220px; border-right:1px solid var(--win11-border);
      display:flex; flex-direction:column; background:var(--win11-surface-solid, #16213e);
    }
    .sv-sidebar-header {
      padding:12px 14px; border-bottom:1px solid var(--win11-border);
      display:flex; justify-content:space-between; align-items:center; gap:8px;
    }
    .sv-sidebar-title { font-size:0.88rem; font-weight:600; display:flex; align-items:center; gap:6px; }
    .sv-sidebar-controls { display:flex; gap:6px; align-items:center; }
    .sv-agent-select {
      padding:3px 8px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.78rem;
    }
    .sv-search {
      padding:5px 10px; border-radius:5px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.78rem;
      width:100%; box-sizing:border-box;
    }
    .sv-search:focus { outline:none; border-color:var(--win11-accent); }
    .sv-session-list { flex:1; overflow-y:auto; padding:4px 0; }
    .sv-session-item {
      padding:8px 14px; cursor:pointer; border-left:3px solid transparent;
      transition:background 0.1s, border-color 0.1s;
    }
    .sv-session-item:hover { background:var(--win11-surface-active, rgba(255,255,255,0.04)); }
    .sv-session-item.selected {
      background:rgba(96,205,255,0.08); border-left-color:var(--win11-accent);
    }
    .sv-session-icon { margin-right:6px; }
    .sv-session-kind { font-size:0.72rem; color:var(--win11-text-secondary); }
    .sv-session-time { font-size:0.68rem; color:var(--win11-text-tertiary); float:right; }
    .sv-status-dot {
      display:inline-block; width:7px; height:7px; border-radius:50%;
      margin-right:5px; vertical-align:middle;
    }
    .sv-status-active { background:#22c55e; }
    .sv-status-recent { background:#eab308; }
    .sv-status-idle { background:var(--win11-text-tertiary, #555); }
    .sv-chat { flex:1; display:flex; flex-direction:column; min-width:0; }
    .sv-chat-header {
      padding:10px 16px; border-bottom:1px solid var(--win11-border);
      display:flex; justify-content:space-between; align-items:center;
      background:var(--win11-surface-solid, #16213e);
    }
    .sv-chat-title { font-size:0.85rem; font-weight:600; }
    .sv-chat-meta { font-size:0.72rem; color:var(--win11-text-secondary); }
    .sv-messages {
      flex:1; overflow-y:auto; padding:12px 16px;
      display:flex; flex-direction:column; gap:8px;
    }
    .sv-msg {
      max-width:85%; padding:8px 12px; border-radius:8px;
      font-size:0.82rem; line-height:1.5; word-break:break-word;
    }
    .sv-msg-user {
      align-self:flex-end; background:rgba(96,205,255,0.15);
      border:1px solid rgba(96,205,255,0.2);
    }
    .sv-msg-assistant {
      align-self:flex-start; background:var(--win11-surface-active, rgba(255,255,255,0.06));
      border:1px solid var(--win11-border);
    }
    .sv-msg-tool {
      align-self:flex-start; background:rgba(255,255,255,0.03);
      border:1px solid var(--win11-border); font-size:0.76rem;
      max-height:120px; overflow:hidden;
    }
    .sv-msg-role {
      font-size:0.68rem; font-weight:600; margin-bottom:3px;
      color:var(--win11-text-secondary);
    }
    .sv-msg-content { white-space:pre-wrap; }
    .sv-msg-content code {
      background:rgba(0,0,0,0.2); padding:1px 4px; border-radius:3px;
      font-family:'Cascadia Code','Fira Code',monospace; font-size:0.78rem;
    }
    .sv-msg-content pre {
      background:rgba(0,0,0,0.3); padding:8px; border-radius:5px;
      overflow-x:auto; margin:4px 0;
    }
    .sv-load-more { text-align:center; padding:8px; font-size:0.78rem; }
    .sv-load-more button {
      background:none; border:1px solid var(--win11-border);
      color:var(--win11-accent); padding:4px 16px; border-radius:5px;
      cursor:pointer; font-size:0.78rem;
    }
    .sv-load-more button:hover { background:var(--win11-surface-active); }
    .sv-empty {
      flex:1; display:flex; align-items:center; justify-content:center;
      color:var(--win11-text-tertiary); font-size:0.88rem;
    }
    .sv-empty-icon { font-size:3rem; margin-bottom:12px; opacity:0.4; }
    .sv-btn {
      padding:3px 10px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface-solid); color:var(--win11-text);
      cursor:pointer; font-size:0.76rem;
    }
    .sv-btn:hover { background:var(--win11-surface-active); }
    .sv-model-badge {
      font-size:0.68rem; padding:1px 6px; border-radius:3px;
      background:rgba(96,205,255,0.08); color:var(--win11-accent);
    }
    .sv-token-bar { height:3px; border-radius:2px; background:var(--win11-surface-active); margin-top:4px; overflow:hidden; }
    .sv-token-fill { height:100%; background:var(--win11-accent); border-radius:2px; }

    /* ── Chat Input ─────────────────────────────── */
    .sv-chat-input-area {
      padding:10px 16px; border-top:1px solid var(--win11-border);
      background:var(--win11-surface-solid, #16213e);
      display:flex; gap:8px; align-items:flex-end;
    }
    .sv-chat-input {
      flex:1; padding:8px 12px; border-radius:8px;
      border:1px solid var(--win11-border); background:var(--win11-surface);
      color:var(--win11-text); font-size:0.82rem; font-family:inherit;
      resize:none; min-height:36px; max-height:120px;
      line-height:1.4;
    }
    .sv-chat-input:focus { outline:none; border-color:var(--win11-accent); }
    .sv-chat-input::placeholder { color:var(--win11-text-tertiary); }
    .sv-send-btn {
      padding:8px 16px; border-radius:8px; border:none;
      background:var(--win11-accent); color:#fff;
      cursor:pointer; font-size:0.82rem; font-weight:600;
      white-space:nowrap; min-width:70px;
      transition:opacity 0.15s;
    }
    .sv-send-btn:hover { opacity:0.9; }
    .sv-send-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .sv-send-btn.stop {
      background:#ef4444;
    }
    .sv-chat-status {
      font-size:0.68rem; color:var(--win11-text-tertiary);
      padding:2px 16px 6px; text-align:right;
    }
    .sv-chat-status.connected { color:#22c55e; }
    .sv-streaming-cursor {
      display:inline-block; width:6px; height:14px;
      background:var(--win11-accent); border-radius:1px;
      margin-left:2px; vertical-align:text-bottom;
      animation: sv-blink 0.8s ease-in-out infinite;
    }
    @keyframes sv-blink {
      0%, 50% { opacity:1; }
      51%, 100% { opacity:0; }
    }
  `;

  mountNode.appendChild(style);

  // ── Layout ─────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'sv-layout';

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'sv-sidebar';

  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'sv-sidebar-header';
  sidebarHeader.innerHTML = `
    <span class="sv-sidebar-title">🤖 Sessions</span>
    <div class="sv-sidebar-controls">
      <select class="sv-agent-select" id="sv-agent-select" aria-label="Select agent"></select>
      <button class="sv-btn" id="sv-refresh-btn" aria-label="Refresh sessions">↻</button>
    </div>
  `;

  const searchBox = document.createElement('div');
  searchBox.style.cssText = 'padding:8px 14px;';
  searchBox.innerHTML = '<input class="sv-search" placeholder="Search sessions..." aria-label="Search sessions">';

  const sessionList = document.createElement('div');
  sessionList.className = 'sv-session-list';

  sidebar.appendChild(sidebarHeader);
  sidebar.appendChild(searchBox);
  sidebar.appendChild(sessionList);

  // Chat area
  const chatArea = document.createElement('div');
  chatArea.className = 'sv-chat';

  const chatHeader = document.createElement('div');
  chatHeader.className = 'sv-chat-header';
  chatHeader.id = 'sv-chat-header';

  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'sv-messages';
  messagesContainer.id = 'sv-messages';

  // Chat input area
  const chatInputArea = document.createElement('div');
  chatInputArea.className = 'sv-chat-input-area';
  chatInputArea.id = 'sv-chat-input-area';

  const chatInput = document.createElement('textarea');
  chatInput.className = 'sv-chat-input';
  chatInput.id = 'sv-chat-input';
  chatInput.placeholder = 'Type a message...';
  chatInput.rows = 1;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'sv-send-btn';
  sendBtn.id = 'sv-send-btn';
  sendBtn.textContent = 'Send';
  sendBtn.disabled = true;

  chatInputArea.appendChild(chatInput);
  chatInputArea.appendChild(sendBtn);

  // Status bar
  const chatStatus = document.createElement('div');
  chatStatus.className = 'sv-chat-status';
  chatStatus.id = 'sv-chat-status';

  chatArea.appendChild(chatHeader);
  chatArea.appendChild(messagesContainer);
  chatArea.appendChild(chatStatus);
  chatArea.appendChild(chatInputArea);

  layout.appendChild(sidebar);
  layout.appendChild(chatArea);
  mountNode.appendChild(layout);

  // ── Helper functions ───────────────────────────

  function getAuthHeaders() {
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || localStorage.getItem('dashboard_token') || '';
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    return headers;
  }

  async function apiGet(url) {
    const resp = await fetch(url, {
      headers: { 'Authorization': getAuthHeaders()['Authorization'] }
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function apiPost(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const d = await resp.json(); errMsg = d.error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    return resp.json();
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const ms = Date.now() - ts;
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function extractText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join('\n')
        .slice(0, 2000);
    }
    return String(content).slice(0, 2000);
  }

  function formatMessageContent(content) {
    const text = extractText(content);
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--win11-accent)">$1</a>');
    return html;
  }

  function tokenPercent(session) {
    if (!session.contextTokens || !session.totalTokens) return 0;
    return Math.min(100, Math.round((session.totalTokens / session.contextTokens) * 100));
  }

  function updateInputState() {
    const hasSession = !!selectedSessionKey;
    const canSend = hasSession && gatewayConnected && !chatSending;
    const text = chatInput.value.trim();

    if (chatSending) {
      sendBtn.textContent = '■ Stop';
      sendBtn.className = 'sv-send-btn stop';
      sendBtn.disabled = false;
    } else {
      sendBtn.textContent = 'Send';
      sendBtn.className = 'sv-send-btn';
      sendBtn.disabled = !canSend || !text;
    }

    chatInput.disabled = !hasSession || !gatewayConnected;
    chatInput.placeholder = !hasSession ? 'Select a session first...'
                           : !gatewayConnected ? 'Gateway not connected...'
                           : 'Type a message...';
  }

  function updateChatStatus() {
    const el = document.getElementById('sv-chat-status');
    if (!el) return;
    if (chatSending) {
      el.textContent = '⏳ Agent is responding...';
      el.className = 'sv-chat-status';
    } else if (gatewayConnected) {
      el.textContent = '● Gateway connected';
      el.className = 'sv-chat-status connected';
    } else {
      el.textContent = '○ Gateway disconnected';
      el.className = 'sv-chat-status';
    }
  }

  // ── SSE streaming ──────────────────────────────

  let sseCleanup = null;

  function setupSSE() {
    if (sseCleanup) return; // Already listening

    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || '';
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

    const onDelta = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!selectedSessionKey || data.sessionKey !== selectedSessionKey) return;

        if (data.runId && currentRunId && data.runId !== currentRunId) return;

        streamingText = data.text || '';
        renderStreamingBubble();
      } catch {}
    };

    const onFinal = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!selectedSessionKey || data.sessionKey !== selectedSessionKey) return;

        chatSending = false;
        currentRunId = null;

        // Remove streaming bubble, add final message
        removeStreamingBubble();
        if (data.message) {
          messages.push({ message: data.message });
        } else if (streamingText.trim()) {
          messages.push({
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: streamingText }],
            }
          });
        }
        streamingText = '';
        appendLastMessage();
        updateInputState();
        updateChatStatus();
      } catch {}
    };

    const onAborted = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!selectedSessionKey || data.sessionKey !== selectedSessionKey) return;

        chatSending = false;
        currentRunId = null;
        removeStreamingBubble();
        if (streamingText.trim()) {
          messages.push({
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: streamingText + '\n\n_(aborted)_' }],
            }
          });
          appendLastMessage();
        }
        streamingText = '';
        updateInputState();
        updateChatStatus();
      } catch {}
    };

    const onError = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!selectedSessionKey || data.sessionKey !== selectedSessionKey) return;

        chatSending = false;
        currentRunId = null;
        removeStreamingBubble();
        const errMsg = data.error || 'Unknown error';
        messages.push({
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `⚠️ Error: ${errMsg}` }],
          }
        });
        appendLastMessage();
        streamingText = '';
        updateInputState();
        updateChatStatus();
      } catch {}
    };

    const onGatewayStatus = (e) => {
      try {
        const data = JSON.parse(e.data);
        gatewayConnected = data.connected === true;
        updateInputState();
        updateChatStatus();
      } catch {}
    };

    es.addEventListener('session:chat-delta', onDelta);
    es.addEventListener('session:chat-final', onFinal);
    es.addEventListener('session:chat-aborted', onAborted);
    es.addEventListener('session:chat-error', onError);
    es.addEventListener('gateway:status', onGatewayStatus);

    sseCleanup = () => {
      es.removeEventListener('session:chat-delta', onDelta);
      es.removeEventListener('session:chat-final', onFinal);
      es.removeEventListener('session:chat-aborted', onAborted);
      es.removeEventListener('session:chat-error', onError);
      es.removeEventListener('gateway:status', onGatewayStatus);
      es.close();
      sseCleanup = null;
    };
  }

  // ── Streaming bubble ───────────────────────────

  function renderStreamingBubble() {
    let bubble = document.getElementById('sv-streaming-bubble');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'sv-streaming-bubble';
      bubble.className = 'sv-msg sv-msg-assistant';
      messagesContainer.appendChild(bubble);
    }
    bubble.innerHTML = `
      <div class="sv-msg-role">🤖 Agent <span style="font-weight:normal;font-size:0.66rem;opacity:0.6;">streaming...</span></div>
      <div class="sv-msg-content">${formatMessageContent(streamingText)}<span class="sv-streaming-cursor"></span></div>
    `;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeStreamingBubble() {
    const bubble = document.getElementById('sv-streaming-bubble');
    if (bubble) bubble.remove();
  }

  function appendLastMessage() {
    if (messages.length === 0) return;
    const msg = messages[messages.length - 1];
    const msgEl = createMessageElement(msg);
    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function createMessageElement(msg) {
    const msgEl = document.createElement('div');
    const role = msg.message?.role || msg.type;
    let cssClass = 'sv-msg';

    if (role === 'user') {
      cssClass += ' sv-msg-user';
    } else if (role === 'assistant') {
      cssClass += ' sv-msg-assistant';
    } else {
      cssClass += ' sv-msg-tool';
    }

    msgEl.className = cssClass;

    const roleLabel = role === 'user' ? '👤 You' :
                      role === 'assistant' ? '🤖 Agent' :
                      role === 'toolResult' ? '🔧 Tool' :
                      role;

    const content = formatMessageContent(msg.message?.content);

    msgEl.innerHTML = `
      <div class="sv-msg-role">${roleLabel}</div>
      <div class="sv-msg-content">${content || '<em style="opacity:0.5">no content</em>'}</div>
    `;

    return msgEl;
  }

  // ── Render functions ───────────────────────────

  function renderEmpty() {
    chatHeader.innerHTML = '<span class="sv-chat-title">Select a session</span>';
    messagesContainer.innerHTML = `
      <div class="sv-empty">
        <div style="text-align:center">
          <div class="sv-empty-icon">💬</div>
          <div>Select a session to view conversation history</div>
        </div>
      </div>
    `;
    updateInputState();
  }

  function renderSessionList() {
    sessionList.innerHTML = '';
    let filtered = sessions;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = sessions.filter(s =>
        (s.key || '').toLowerCase().includes(q) ||
        (s.kind || '').toLowerCase().includes(q) ||
        (s.model || '').toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      sessionList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--win11-text-tertiary);font-size:0.8rem;">No sessions found</div>';
      return;
    }

    for (const session of filtered) {
      const item = document.createElement('div');
      item.className = 'sv-session-item' + (selectedSessionId === session.sessionId ? ' selected' : '');

      const statusClass = session.status === 'active' ? 'sv-status-active' :
                          session.status === 'recent' ? 'sv-status-recent' : 'sv-status-idle';

      const kind = session.kind || session.channel || 'unknown';
      const icon = session.icon || '❓';
      const model = session.model ? `<span class="sv-model-badge">${session.model}</span>` : '';

      let label = session.key || session.sessionId || 'Unknown';
      if (label.length > 45) label = '...' + label.slice(-42);

      const pct = tokenPercent(session);

      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;">
          <span class="sv-status-dot ${statusClass}"></span>
          <span class="sv-session-icon">${icon}</span>
          <span class="sv-session-kind">${escapeHtml(kind)}</span>
          <span class="sv-session-time">${timeAgo(session.updatedAt)}</span>
        </div>
        <div style="font-size:0.78rem;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(session.key || '')}">
          ${escapeHtml(label)}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
          ${model}
          ${pct > 0 ? `<div class="sv-token-bar" style="flex:1;"><div class="sv-token-fill" style="width:${pct}%;${pct > 80 ? 'background:#ef4444;' : ''}"></div></div>` : ''}
        </div>
      `;

      item.addEventListener('click', () => selectSession(session));
      sessionList.appendChild(item);
    }
  }

  async function selectSession(session) {
    selectedSessionId = session.sessionId;
    selectedSessionKey = session.key || `agent:${selectedAgentId}:${session.sessionId}`;
    sessionMeta = session;
    messages = [];
    hasOlder = false;
    oldestLine = 0;
    chatSending = false;
    currentRunId = null;
    streamingText = '';
    removeStreamingBubble();

    renderSessionList();
    renderChatLoading();

    try {
      const data = await apiGet(`/api/oc/sessions/${session.sessionId}?agent=${selectedAgentId}&messages=30`);
      sessionMeta = data;
      messages = data.messages || [];
      hasOlder = data.hasOlder || false;
      oldestLine = data.oldestLine || 0;
      renderChat();
    } catch (err) {
      renderChatError(err.message);
    }

    updateInputState();
  }

  function renderChatLoading() {
    const session = sessionMeta;
    chatHeader.innerHTML = `
      <div>
        <span class="sv-chat-title">${session?.icon || '❓'} ${escapeHtml(session?.kind || 'Loading...')}</span>
        <span class="sv-chat-meta" style="margin-left:8px;">${session?.model || ''}</span>
      </div>
    `;
    messagesContainer.innerHTML = '<div class="sv-empty"><div>Loading messages...</div></div>';
  }

  function renderChatError(msg) {
    messagesContainer.innerHTML = `<div class="sv-empty"><div style="color:#ef4444;">Error: ${escapeHtml(msg)}</div></div>`;
  }

  function renderChat() {
    const session = sessionMeta;
    if (!session) { renderEmpty(); return; }

    const pct = tokenPercent(session);
    const totalTokens = session.totalTokens ? `${Math.round(session.totalTokens / 1000)}k` : '';
    const contextSize = session.contextTokens ? `${Math.round(session.contextTokens / 1000)}k` : '';

    chatHeader.innerHTML = `
      <div>
        <span class="sv-chat-title">${session.icon || '❓'} ${escapeHtml(session.kind || 'Session')}</span>
        <span class="sv-chat-meta" style="margin-left:8px;">${session.model || ''}</span>
        ${totalTokens ? `<span class="sv-chat-meta" style="margin-left:8px;">${totalTokens}/${contextSize} tokens</span>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span class="sv-chat-meta">${timeAgo(session.updatedAt)}</span>
      </div>
    `;

    messagesContainer.innerHTML = '';

    if (hasOlder) {
      const loadMore = document.createElement('div');
      loadMore.className = 'sv-load-more';
      loadMore.innerHTML = '<button id="sv-load-older">↑ Load older messages</button>';
      messagesContainer.appendChild(loadMore);
      document.getElementById('sv-load-older')?.addEventListener('click', loadOlderMessages);
    }

    for (const msg of messages) {
      messagesContainer.appendChild(createMessageElement(msg));
    }

    if (messages.length === 0) {
      messagesContainer.innerHTML += '<div style="text-align:center;color:var(--win11-text-tertiary);padding:20px;">No messages in this session</div>';
    }

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function loadOlderMessages() {
    if (!selectedSessionId || !oldestLine) return;
    try {
      const data = await apiGet(`/api/oc/sessions/${selectedSessionId}/messages?agent=${selectedAgentId}&after=0&limit=30&filter=messages`);
      const olderMsgs = data.messages.filter(m => m.line < oldestLine);
      if (olderMsgs.length > 0) {
        messages = [...olderMsgs, ...messages];
        oldestLine = olderMsgs[0].line;
        hasOlder = olderMsgs.length >= 30;
        renderChat();
      } else {
        hasOlder = false;
        renderChat();
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    }
  }

  // ── Send message ───────────────────────────────

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || !selectedSessionKey || chatSending) return;

    // Add user message to UI immediately
    messages.push({
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      }
    });
    appendLastMessage();

    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatSending = true;
    streamingText = '';
    updateInputState();
    updateChatStatus();

    try {
      const result = await apiPost('/api/oc/chat/send', {
        sessionKey: selectedSessionKey,
        message: text,
      });
      currentRunId = result.runId;
    } catch (err) {
      chatSending = false;
      messages.push({
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `⚠️ Failed to send: ${err.message}` }],
        }
      });
      appendLastMessage();
      updateInputState();
      updateChatStatus();
    }
  }

  async function abortChat() {
    if (!selectedSessionKey) return;
    try {
      await apiPost('/api/oc/chat/abort', {
        sessionKey: selectedSessionKey,
        runId: currentRunId,
      });
    } catch {}
    chatSending = false;
    currentRunId = null;
    removeStreamingBubble();
    if (streamingText.trim()) {
      messages.push({
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: streamingText }],
        }
      });
      appendLastMessage();
    }
    streamingText = '';
    updateInputState();
    updateChatStatus();
  }

  // ── Data loading ───────────────────────────────

  async function loadAgents() {
    try {
      const data = await apiGet('/api/oc/agents');
      agents = data.agents || [];
      const select = document.getElementById('sv-agent-select');
      if (!select) return;
      select.innerHTML = '';
      for (const agent of agents) {
        if (agent.sessionCount > 0) {
          const opt = document.createElement('option');
          opt.value = agent.id;
          opt.textContent = `${agent.id} (${agent.sessionCount})`;
          if (agent.id === selectedAgentId) opt.selected = true;
          select.appendChild(opt);
        }
      }
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  }

  async function loadSessions() {
    try {
      const data = await apiGet(`/api/oc/sessions?agent=${selectedAgentId}`);
      sessions = data.sessions || [];
      renderSessionList();
    } catch (err) {
      console.error('Failed to load sessions:', err);
      sessionList.innerHTML = '<div style="padding:16px;color:#ef4444;">Failed to load sessions</div>';
    }
  }

  async function loadGatewayStatus() {
    try {
      const data = await apiGet('/api/oc/chat/status');
      gatewayConnected = data.connected === true;
    } catch {
      gatewayConnected = false;
    }
    updateInputState();
    updateChatStatus();
  }

  // ── Event handlers ─────────────────────────────

  setTimeout(() => {
    document.getElementById('sv-agent-select')?.addEventListener('change', (e) => {
      selectedAgentId = e.target.value;
      selectedSessionId = null;
      selectedSessionKey = null;
      sessionMeta = null;
      loadSessions();
      renderEmpty();
    });

    document.getElementById('sv-refresh-btn')?.addEventListener('click', () => {
      loadAgents();
      loadSessions();
      loadGatewayStatus();
    });

    const searchInput = searchBox.querySelector('.sv-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderSessionList();
      });
    }

    // Chat input handlers
    chatInput.addEventListener('input', () => {
      // Auto-resize textarea
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
      updateInputState();
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatSending) {
          abortChat();
        } else {
          sendMessage();
        }
      }
    });

    sendBtn.addEventListener('click', () => {
      if (chatSending) {
        abortChat();
      } else {
        sendMessage();
      }
    });
  }, 50);

  // ── Initialize ─────────────────────────────────
  setupSSE();
  renderEmpty();
  await loadAgents();
  await loadSessions();
  await loadGatewayStatus();
}

export { renderSessionsView as render };
export default renderSessionsView;
