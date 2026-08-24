'use strict';
/**
 * Gateway Console Feed — second gateway subscriber powering the Live Agent Console.
 *
 * Additive sibling of lib/gateway-bridge.js (bridge v1 stays byte-identical per
 * docs/briefs/live-console.md §7): opens its OWN WebSocket to the OpenClaw gateway
 * using the same protocol-v4 handshake recipe, and taps the chatty console-class
 * streams the state bridge deliberately drops (`agent` assistant deltas,
 * `session.tool` update chunks) plus tool/command lifecycle frames.
 *
 * Per-session fanout registry: browser clients attach with a sessionKey; frames
 * are forwarded ONLY while at least one client is attached for that session —
 * token deltas for every other session never leave the server process
 * (operator.read is fleet-wide; filtering happens here, spike doc Risks).
 *
 * Backpressure: bounded per-client queue like the state channel, but CONSOLE
 * semantics — drop-OLDEST WITHOUT any resync hint. A terminal tail tolerates
 * shorter scrollback; it must never trigger a refetch storm (brief §3.2).
 *
 * Idle: no console-class frame for IDLE_TIMEOUT_MS AND the matching task row
 * observed non-running → `console:end {reason:"idle"}` + SSE close after grace.
 * Bridge loss mid-stream → `console:end {reason:"bridge-disconnected"}` (SSE
 * stays open; the view shows an amber banner and reattach stays manual).
 *
 * Landmine (spike doc): the gateway shared secret NEVER leaves this process;
 * frames are sanitized before fan-out as defense in depth.
 *
 * Clean-disable: when no gateway URL resolves (env or openclaw.json), the feed
 * reports enabled=false and attach() returns false — the SSE route then ends
 * the stream with `console:end {reason:"unsubscribed"}`.
 */

const crypto = require('crypto');
const WebSocket = require('ws');
const { resolveBridgeConfig, loadGatewayConfigFile } = require('./gateway-bridge');

const RECONNECT_BACKOFF_MIN_MS = 800;
const RECONNECT_BACKOFF_MAX_MS = 15000;
const CHALLENGE_FALLBACK_MS = 750;
const CONNECT_TIMEOUT_MS = 10000;

/** No console-class frame for this long starts the idle evaluation window. */
const IDLE_TIMEOUT_MS = 20000;
/** After console:end {idle}, keep the SSE open this long so the frame flushes. */
const IDLE_END_GRACE_MS = 5000;
/** Idle scanner cadence (cheap; evaluates timestamps only). */
const IDLE_SCAN_INTERVAL_MS = 5000;
/** Per-client frame queue depth. Drop-oldest, never a resync hint. */
const CLIENT_QUEUE_MAX = 300;

const DEFAULT_OPENCLAW_CONFIG_PATH = require('path').join(require('os').homedir(), '.openclaw', 'openclaw.json');

/** Gateway events the console feed consumes. Everything else fails soft. */
const CONSOLE_EVENTS = new Set(['agent', 'session.tool', 'task']);

// ── Pure helpers (unit-tested in tests/test-console-feed.js) ─────────────

/**
 * Recursively strip secret-bearing keys from a frame (defense in depth — the
 * gateway secret should never appear in console payloads anyway). Returns a
 * new object; never throws. Keys matching /password|token|secret|authorization/i
 * are replaced with '[redacted]'.
 * @param {*} value
 * @returns {*}
 */
function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /password|token|secret|authorization/i.test(k) ? '[redacted]' : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Per-session sequence gate. `seq` is the gateway's per-session payload.seq
 * (NOT the per-connection envelope seq — brief §3.3). Missing/invalid seq
 * passes (fail-open); duplicates and regressions are dropped.
 * @param {number|null} lastSeq
 * @param {*} seq
 * @returns {boolean} true when the frame should forward
 */
function shouldForwardSeq(lastSeq, seq) {
  const n = Number(seq);
  if (!Number.isFinite(n)) return true;
  if (lastSeq === null || lastSeq === undefined) return true;
  return n > lastSeq;
}

/**
 * Truncate an args object into a one-line preview for the tool-start badge.
 */
function argsPreview(args, maxLen = 120) {
  if (args === undefined || args === null) return '';
  let text;
  try {
    text = typeof args === 'string' ? args : JSON.stringify(args);
  } catch (_) {
    text = String(args);
  }
  text = String(text).replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

/**
 * Map one raw gateway event to candidate console frames. Pure.
 *
 * @param {string} eventName - 'agent' | 'session.tool'
 * @param {object} payload - gateway event payload (verbatim shapes per spike doc)
 * @param {string|null} prevAssistantText - cumulative assistant text already
 *   emitted for this session (cumulative-only fallback diffing, brief R4)
 * @returns {{frames: Array<object>, nextAssistantText: string|null}}
 *   Frame kinds: 'text' {delta}, 'tool-start' {toolCallId,name,title,argsPreview},
 *   'tool-output' {toolCallId,chunk}, 'tool-end' {toolCallId,name,status,exitCode,durationMs,cwd}.
 *   Common fields on every frame: sessionKey, agentId, runId, seq.
 */
function extractConsoleFrames(eventName, payload, prevAssistantText = null) {
  if (!payload || typeof payload !== 'object') return { frames: [], nextAssistantText: null };
  const base = {
    sessionKey: payload.sessionKey || null,
    agentId: payload.agentId || null,
    runId: payload.runId || null,
    seq: Number(payload.seq) || null,
  };
  const data = payload.data;

  if (eventName === 'agent' && data && typeof data === 'object') {
    if (payload.stream === 'assistant') {
      // Preferred: delta carries only new tokens. Fallback (R4): diff the
      // cumulative text against what we already emitted.
      let delta = typeof data.delta === 'string' ? data.delta : null;
      const cumulative = typeof data.text === 'string' ? data.text : null;
      if (delta === null && cumulative !== null) {
        delta = cumulative.startsWith(prevAssistantText || '')
          ? cumulative.slice((prevAssistantText || '').length)
          : cumulative;
      }
      if (!delta) return { frames: [], nextAssistantText: cumulative || prevAssistantText };
      return { frames: [{ ...base, kind: 'text', delta }], nextAssistantText: cumulative || (prevAssistantText || '') + delta };
    }

    if (payload.stream === 'item' && data.phase === 'start') {
      return {
        frames: [{
          ...base,
          kind: 'tool-start',
          toolCallId: data.toolCallId || data.itemId || null,
          name: data.name || data.kind || null,
          title: data.title || null,
          argsPreview: '',
        }],
        nextAssistantText: null,
      };
    }

    if (payload.stream === 'command_output' && data.phase === 'end') {
      return {
        frames: [{
          ...base,
          kind: 'tool-end',
          toolCallId: data.toolCallId || data.itemId || null,
          name: data.name || null,
          status: data.status || null,
          exitCode: Number.isFinite(data.exitCode) ? data.exitCode : null,
          durationMs: Number.isFinite(data.durationMs) ? data.durationMs : null,
          cwd: data.cwd || null,
        }],
        nextAssistantText: null,
      };
    }
    return { frames: [], nextAssistantText: null };
  }

  if (eventName === 'session.tool' && data && typeof data === 'object' && data.toolCallId) {
    if (data.phase === 'start') {
      return {
        frames: [{
          ...base,
          kind: 'tool-start',
          toolCallId: data.toolCallId,
          name: data.name || null,
          title: typeof data.meta === 'string' ? data.meta : null,
          argsPreview: argsPreview(data.args),
        }],
        nextAssistantText: null,
      };
    }
    if (data.phase === 'update') {
      const chunks = [];
      const content = data.partialResult && Array.isArray(data.partialResult.content)
        ? data.partialResult.content
        : [];
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          chunks.push({ ...base, kind: 'tool-output', toolCallId: data.toolCallId, chunk: block.text });
        }
      }
      return { frames: chunks, nextAssistantText: null };
    }
    if (data.phase === 'result') {
      const details = data.result && data.result.details ? data.result.details : {};
      return {
        frames: [{
          ...base,
          kind: 'tool-end',
          toolCallId: data.toolCallId,
          name: data.name || null,
          status: details.status || null,
          exitCode: Number.isFinite(details.exitCode) ? details.exitCode : null,
          durationMs: Number.isFinite(details.durationMs) ? details.durationMs : null,
          cwd: details.cwd || null,
        }],
        nextAssistantText: null,
      };
    }
  }

  return { frames: [], nextAssistantText: null };
}

/**
 * Idle evaluator. Pure. The stream may end only when BOTH signals agree:
 * quiet for >= IDLE_TIMEOUT_MS AND the task row observed non-running.
 * @param {number} nowMs
 * @param {number|null} lastActivityMs
 * @param {string|null} taskStatus - latest task.status observed for the session
 * @param {boolean} taskStatusKnown - false when no task row seen yet
 * @returns {boolean} true when the stream should end idle
 */
function isIdleStream(nowMs, lastActivityMs, taskStatus, taskStatusKnown) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastActivityMs)) return false;
  if (nowMs - lastActivityMs < IDLE_TIMEOUT_MS) return false;
  if (!taskStatusKnown) return false;
  return taskStatus !== 'running';
}

// ── Feed ──────────────────────────────────────────────────────────────────

class GatewayConsoleFeed {
  /**
   * @param {object} options
   * @param {{enabled: boolean, url: string|null, auth: object|null}} [options.config]
   * @param {Console} [options.logger]
   * @param {object} [options.env] - env override source (default process.env)
   * @param {object|null} [options.gatewayConfig] - pre-parsed openclaw.json
   * @param {string} [options.cfgPath] - openclaw.json path override
   */
  constructor(options = {}) {
    const env = options.env || process.env;
    const gatewayConfig = options.gatewayConfig !== undefined
      ? options.gatewayConfig
      : loadGatewayConfigFile(options.cfgPath || DEFAULT_OPENCLAW_CONFIG_PATH);
    this.config = options.config || resolveBridgeConfig({ env, gatewayConfig });
    this.log = options.logger || console;

    this.ws = null;
    this.closed = false;
    this.connected = false;
    this.backoffMs = RECONNECT_BACKOFF_MIN_MS;
    this.challengeSeen = false;
    this.connectSent = false;
    this.connectFallbackTimer = null;
    this.reconnectTimer = null;
    this.rpcCounter = 0;
    this.pending = new Map();
    this.lastEnvelopeSeq = null;

    /** sessionId (sessionKey) → Set<client>; client = {res, sessionKey, queue, overflowed, drainAttached, ending}. */
    this.clientsBySession = new Map();
    /** res → client index for O(1) detach. */
    this.clientByRes = new Map();
    /** sessionKey → last forwarded per-session payload.seq. */
    this.lastSeqBySession = new Map();
    /** sessionKey → latest task.status observed via `task` events. */
    this.taskStatusBySession = new Map();
    /** sessionKey → last console-class activity timestamp (ms). */
    this.lastActivityBySession = new Map();
    /** sessions currently in idle-end grace (no double ends). */
    this.endingSessions = new Set();

    this.idleTimer = null;
  }

  start() {
    if (!this.config.enabled) {
      this.log.log('[gateway-console-feed] disabled (no gateway URL resolved) — /api/console/stream answers unsubscribed');
      return;
    }
    this.closed = false;
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => this._scanIdle(), IDLE_SCAN_INTERVAL_MS);
      if (this.idleTimer.unref) this.idleTimer.unref();
    }
    this._connect();
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectFallbackTimer) clearTimeout(this.connectFallbackTimer);
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  status() {
    return {
      enabled: this.config.enabled,
      connected: this.connected,
      url: this.config.url,
      clients: this.clientCount(),
      sessions: this.attachedSessionKeys().size,
    };
  }

  // ── Client registry ────────────────────────────────────────────────────

  /**
   * Attach an SSE response to a session stream.
   * @param {string} sessionKey - e.g. "agent:coder:main"
   * @param {object} res - ServerResponse (or mock) supporting write()/on()
   * @returns {boolean} false when the feed is disabled (route answers unsubscribed)
   */
  attach(sessionKey, res) {
    if (!sessionKey) return false;
    if (!this.config.enabled) return false;
    const client = { res, sessionKey, queue: [], overflowed: false, drainAttached: false, ending: false };
    if (!this.clientsBySession.has(sessionKey)) this.clientsBySession.set(sessionKey, new Set());
    this.clientsBySession.get(sessionKey).add(client);
    this.clientByRes.set(res, client);
    this.lastActivityBySession.set(sessionKey, Date.now());
    this.endingSessions.delete(sessionKey);
    return true;
  }

  /** Detach by res (client disconnect or route teardown). */
  detach(res) {
    const client = this.clientByRes.get(res);
    if (!client) return;
    this.clientByRes.delete(res);
    const set = this.clientsBySession.get(client.sessionKey);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        // Last client left: stop tracking the session entirely.
        this.clientsBySession.delete(client.sessionKey);
        this.lastSeqBySession.delete(client.sessionKey);
        this.lastActivityBySession.delete(client.sessionKey);
        this.endingSessions.delete(client.sessionKey);
      }
    }
  }

  clientCount() {
    return this.clientByRes.size;
  }

  attachedSessionKeys() {
    return new Set(this.clientsBySession.keys());
  }

  /**
   * Heartbeat hook: write a comment frame to every attached client.
   * Registered with routes/sse-routes.js startHeartbeat().
   */
  pingClients() {
    const frame = `: hb ${new Date().toISOString()}\n\n`;
    for (const client of this.clientByRes.values()) {
      try {
        if (client.queue.length > 0) { client.queue.push(frame); continue; }
        const ok = client.res.write(frame);
        if (ok === false) client.queue.push(frame);
      } catch (_) {
        this.detach(client.res);
      }
    }
  }

  /**
   * Fan a console event out to every client attached to its session.
   * Bounded queue per client: drop-OLDEST, NO resync hint (terminal semantics).
   */
  broadcastToSession(sessionKey, event, data) {
    let payload;
    try {
      payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    } catch (_) {
      return; // unserializable — drop, never throw (zero-throw surface)
    }
    const set = this.clientsBySession.get(sessionKey);
    if (!set || set.size === 0) return;
    for (const client of set) {
      this._enqueue(client, payload);
    }
  }

  _enqueue(client, payload) {
    if (client.queue.length > 0) {
      this._pushQueue(client, payload);
      return;
    }
    let ok;
    try {
      ok = client.res.write(payload);
    } catch (_) {
      this.detach(client.res);
      return;
    }
    if (ok === false) {
      this._pushQueue(client, payload);
      this._attachDrain(client);
    }
  }

  _pushQueue(client, payload) {
    if (client.queue.length >= CLIENT_QUEUE_MAX) {
      client.queue.shift(); // drop oldest — deliberately NO resync frame here
    }
    client.queue.push(payload);
  }

  _attachDrain(client) {
    if (client.drainAttached) return;
    client.drainAttached = true;
    client.res.on('drain', () => {
      while (client.queue.length > 0) {
        let ok;
        try {
          ok = client.res.write(client.queue[0]);
        } catch (_) {
          this.detach(client.res);
          return;
        }
        if (ok === false) return;
        client.queue.shift();
      }
      client.overflowed = false;
    });
  }

  // ── Gateway connection (same v4 recipe as bridge v1, own socket) ──────

  _connect() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(this.config.url, { rejectUnauthorized: false });
    } catch (err) {
      this.log.warn(`[gateway-console-feed] WebSocket creation failed (${err.message}) — disabling feed`);
      this.config = { ...this.config, enabled: false };
      return;
    }
    this.ws = ws;
    this.challengeSeen = false;
    this.connectSent = false;

    ws.on('open', () => {
      if (this.connectFallbackTimer) clearTimeout(this.connectFallbackTimer);
      this.connectFallbackTimer = setTimeout(() => this._sendConnect(), CHALLENGE_FALLBACK_MS);
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch (_) { return; }
      this._handleMessage(msg);
    });

    ws.on('error', () => {
      // close handler owns reconnection
    });

    ws.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      if (this.connectFallbackTimer) { clearTimeout(this.connectFallbackTimer); this.connectFallbackTimer = null; }
      if (wasConnected) {
        this.log.warn('[gateway-console-feed] gateway connection lost');
        this._notifyBridgeDisconnected();
      }
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, RECONNECT_BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _sendConnect() {
    if (this.connectSent || !this.ws) return;
    this.connectSent = true;
    if (this.connectFallbackTimer) { clearTimeout(this.connectFallbackTimer); this.connectFallbackTimer = null; }
    this._request('connect', {
      minProtocol: 4,
      maxProtocol: 4,
      client: { id: 'gateway-client', version: '1.0.0', platform: 'linux', mode: 'backend' },
      role: 'operator',
      scopes: ['operator.read'],
      caps: [],
      commands: [],
      permissions: {},
      auth: this.config.auth || {},
      locale: 'en-US',
      userAgent: 'webos-gateway-console-feed/1.0',
    }, CONNECT_TIMEOUT_MS)
      .then(() => {
        this.connected = true;
        this.backoffMs = RECONNECT_BACKOFF_MIN_MS;
        this.lastEnvelopeSeq = null;
        this.log.log('[gateway-console-feed] connected (console tap)');
        this._request('sessions.subscribe', {}).catch(() => {});
      })
      .catch((err) => {
        this.log.warn(`[gateway-console-feed] connect failed: ${err.message}`);
        if (this.ws) {
          try { this.ws.close(4008, 'connect failed'); } catch (_) { /* ignore */ }
        }
      });
  }

  _request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('gateway not connected'));
        return;
      }
      const id = `console-${++this.rpcCounter}-${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`gateway request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  _handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this.challengeSeen = true;
      this._sendConnect();
      return;
    }

    if (msg.type === 'res' && this.pending) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.ok) pending.resolve(msg.payload);
      else {
        const err = new Error(msg.error?.message || 'request failed');
        err.code = msg.error?.code;
        pending.reject(err);
      }
      return;
    }

    if (msg.type !== 'event') return;

    // Envelope-seq gap on OUR connection → missed gateway frames. Terminal
    // tolerance: one resync marker renders client-side, never a refetch.
    if (Number.isFinite(msg.seq)) {
      if (this.lastEnvelopeSeq !== null && msg.seq > this.lastEnvelopeSeq + 1) {
        for (const sessionKey of this.attachedSessionKeys()) {
          this.broadcastToSession(sessionKey, 'resync', { reason: 'seq-gap' });
        }
      }
      this.lastEnvelopeSeq = msg.seq;
    }

    if (!CONSOLE_EVENTS.has(msg.event)) return;
    try {
      this._handleGatewayEvent(msg.event, msg.payload || {});
    } catch (_) {
      // Zero-throw surface: a malformed gateway frame must never kill the feed.
    }
  }

  _handleGatewayEvent(eventName, payload) {
    if (eventName === 'task') {
      const task = payload && payload.task;
      if (!task || !task.sessionKey) return;
      // Dedupe heavy re-upserts: only newer updatedAt updates the status map.
      const stamp = Number(task.updatedAt || 0);
      const cacheKey = `task:${task.id}`;
      this._taskStamps = this._taskStamps || new Map();
      const prev = this._taskStamps.get(cacheKey);
      if (prev !== undefined && stamp <= prev) return;
      this._taskStamps.set(cacheKey, stamp);
      this.taskStatusBySession.set(task.sessionKey, task.status || null);
      return;
    }

    const sessionKey = payload && payload.sessionKey;
    if (!sessionKey) return;
    // Server-side per-session filtering: nothing leaves unless a console
    // client is attached to THIS session (fleet-wide operator.read containment).
    const set = this.clientsBySession.get(sessionKey);
    if (!set || set.size === 0) return;

    const prevText = this._assistantTextBySession && this._assistantTextBySession.get(sessionKey) || null;
    const { frames, nextAssistantText } = extractConsoleFrames(eventName, payload, prevText);
    this._assistantTextBySession = this._assistantTextBySession || new Map();
    if (nextAssistantText !== null) this._assistantTextBySession.set(sessionKey, nextAssistantText);

    if (frames.length === 0) return;
    this.lastActivityBySession.set(sessionKey, Date.now());

    const lastSeq = this.lastSeqBySession.has(sessionKey)
      ? this.lastSeqBySession.get(sessionKey)
      : null;
    let forwardedAny = false;
    let newestSeq = lastSeq;
    for (const frame of frames) {
      if (!shouldForwardSeq(lastSeq, frame.seq)) continue;
      if (Number.isFinite(Number(frame.seq))) newestSeq = Math.max(newestSeq === null ? -Infinity : newestSeq, Number(frame.seq));
      const { kind, ...rest } = frame;
      const eventName2 = kind === 'text' ? 'console:text'
        : kind === 'tool-start' ? 'console:tool-start'
          : kind === 'tool-output' ? 'console:tool-output'
            : 'console:tool-end';
      this.broadcastToSession(sessionKey, eventName2, redactSecrets(rest));
      forwardedAny = true;
    }
    if (forwardedAny) {
      this.lastSeqBySession.set(sessionKey, newestSeq === -Infinity ? lastSeq : newestSeq);
    }
  }

  _notifyBridgeDisconnected() {
    for (const sessionKey of this.attachedSessionKeys()) {
      this.broadcastToSession(sessionKey, 'console:end', { reason: 'bridge-disconnected' });
    }
  }

  _scanIdle() {
    const now = Date.now();
    for (const [sessionKey, lastActivity] of this.lastActivityBySession) {
      if (this.endingSessions.has(sessionKey)) continue;
      if (!isIdleStream(now, lastActivity, this.taskStatusBySession.get(sessionKey), this.taskStatusBySession.has(sessionKey))) continue;
      this.endingSessions.add(sessionKey);
      this.broadcastToSession(sessionKey, 'console:end', { reason: 'idle' });
      // Grace: keep the SSE open briefly so the end frame flushes, then close.
      setTimeout(() => {
        const set = this.clientsBySession.get(sessionKey);
        if (!set) return;
        for (const client of [...set]) {
          try { client.res.end(); } catch (_) { /* ignore */ }
          this.detach(client.res);
        }
      }, IDLE_END_GRACE_MS).unref?.();
    }
  }
}

/**
 * Create a console feed. Resolves config exactly like the bridge (env overrides,
 * then openclaw.json). Never throws for missing config — feed reports enabled=false.
 * @param {object} [options]
 */
function createGatewayConsoleFeed(options = {}) {
  return new GatewayConsoleFeed(options);
}

/** Lazy shared singleton for callers that don't get an injected instance. */
let sharedFeed = null;
function getSharedConsoleFeed() {
  if (!sharedFeed) sharedFeed = createGatewayConsoleFeed({});
  return sharedFeed;
}

module.exports = {
  GatewayConsoleFeed,
  createGatewayConsoleFeed,
  getSharedConsoleFeed,
  redactSecrets,
  shouldForwardSeq,
  extractConsoleFrames,
  argsPreview,
  isIdleStream,
  CLIENT_QUEUE_MAX,
  IDLE_TIMEOUT_MS,
  IDLE_END_GRACE_MS,
};
