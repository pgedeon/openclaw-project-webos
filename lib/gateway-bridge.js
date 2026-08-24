'use strict';
/**
 * Gateway Bridge v1 — server-side OpenClaw gateway subscriber with SSE fan-out.
 *
 * One long-lived WebSocket connection from the dashboard backend to the OpenClaw
 * gateway (protocol v4 handshake per docs/research/gateway-streaming-spike-2026-08-24.md).
 * Normalizes gateway events into a small internal set and hands them to a
 * broadcaster (routes/sse-routes.js `broadcastStream`) for browser fan-out.
 *
 * Landmine (see spike doc): the gateway must never be exposed browser-direct.
 * The gateway shared secret NEVER leaves this server process; browsers only see
 * the dashboard's own SSE surface.
 *
 * Config resolution (in order):
 *   1. GATEWAY_BRIDGE_URL / GATEWAY_BRIDGE_TOKEN env overrides
 *   2. ~/.openclaw/openclaw.json → gateway.port + gateway.auth.{mode,password,token}
 *   3. Absent/invalid config → bridge disabled cleanly (polling stays the feed)
 *
 * Normalized events: {task-updated, agent-status-changed, run-updated}, deduped
 * by type+id against updatedAt/seq so the gateway's heavy task re-upserts do not
 * reach browsers. Envelope-seq gaps force a `resync` hint broadcast.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

const RECONNECT_BACKOFF_MIN_MS = 800;
const RECONNECT_BACKOFF_MAX_MS = 15000;
const CHALLENGE_FALLBACK_MS = 750;
const CONNECT_TIMEOUT_MS = 10000;

const DEFAULT_OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

/** Gateway events the bridge consumes in v1. Everything else fails soft (ignored). */
const CONSUMED_EVENTS = new Set(['task', 'agent', 'session.tool']);

// ── Pure helpers (unit-tested in tests/test-gateway-bridge.js) ──────────

/**
 * Resolve bridge configuration from env overrides + parsed openclaw.json.
 * Pure: no filesystem access. Returns { enabled, url, auth, source }.
 *
 * @param {object} [options]
 * @param {object} [options.env] - process.env-like object
 * @param {object|null} [options.gatewayConfig] - parsed ~/.openclaw/openclaw.json or null
 * @returns {{enabled: boolean, url: string|null, auth: object|null, source: string}}
 */
function resolveBridgeConfig({ env = {}, gatewayConfig = null } = {}) {
  const gw = gatewayConfig && typeof gatewayConfig === 'object' ? gatewayConfig.gateway || {} : {};

  // Auth: env token override wins, else per gateway.auth.mode.
  let auth = null;
  let authSource = 'none';
  if (env.GATEWAY_BRIDGE_TOKEN) {
    auth = { token: env.GATEWAY_BRIDGE_TOKEN };
    authSource = 'env';
  } else if (gw.auth && gw.auth.mode === 'password' && typeof gw.auth.password === 'string' && gw.auth.password.length > 0) {
    auth = { password: gw.auth.password };
    authSource = 'config';
  } else if (gw.auth && gw.auth.mode === 'token' && typeof gw.auth.token === 'string' && gw.auth.token.length > 0) {
    auth = { token: gw.auth.token };
    authSource = 'config';
  }

  // URL: env override wins, else derive from config port.
  let url = null;
  let source = 'none';
  if (env.GATEWAY_BRIDGE_URL) {
    url = String(env.GATEWAY_BRIDGE_URL);
    source = 'env';
  } else if (gatewayConfig && Number.isFinite(parseInt(gw.port, 10))) {
    url = `ws://127.0.0.1:${parseInt(gw.port, 10)}`;
    source = 'config';
  }

  const enabled = Boolean(url);
  return { enabled, url, auth, source, authSource };
}

/**
 * Load and parse the OpenClaw config file. Returns null (never throws) when
 * missing/unreadable/malformed so the bridge disables cleanly.
 */
function loadGatewayConfigFile(cfgPath = DEFAULT_OPENCLAW_CONFIG_PATH) {
  try {
    if (!fs.existsSync(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Normalize a raw gateway event into the internal event set, or null when the
 * event is not relevant to v1. Pure.
 *
 * Normalized shape: { type, id, updatedAt, data } where `updatedAt` is the
 * task row's updatedAt for tasks and the per-session payload.seq for
 * agent/session.tool streams (monotonic per stream — sufficient for dedupe).
 *
 * @param {string} eventName - gateway envelope event name
 * @param {object} payload - gateway event payload
 * @returns {{type: string, id: string, updatedAt: number, data: object}|null}
 */
function normalizeGatewayEvent(eventName, payload) {
  if (!CONSUMED_EVENTS.has(eventName) || !payload || typeof payload !== 'object') {
    return null;
  }

  if (eventName === 'task') {
    const task = payload.task;
    if (!task || !task.id) return null;
    return {
      type: 'task-updated',
      id: String(task.id),
      updatedAt: Number(task.updatedAt || 0),
      data: {
        taskId: task.taskId || task.id,
        kind: task.kind || null,
        runtime: task.runtime || null,
        status: task.status || null,
        title: task.title || null,
        agentId: task.agentId || null,
        sessionKey: task.sessionKey || null,
        runId: task.runId || null,
      },
    };
  }

  const seq = Number(payload.seq || 0);

  if (eventName === 'agent') {
    const data = payload.data;
    // Assistant token deltas are far too chatty for fan-out v1; ignore.
    if (!data || payload.stream === 'assistant') return null;
    const itemId = data.itemId || (data.toolCallId ? `tool:${data.toolCallId}` : null);
    if (!itemId) return null;
    return {
      type: 'agent-status-changed',
      id: `${payload.sessionKey || payload.agentId || 'unknown'}/${itemId}`,
      updatedAt: seq,
      data: {
        sessionKey: payload.sessionKey || null,
        agentId: payload.agentId || null,
        runId: payload.runId || null,
        itemId,
        stream: payload.stream || null,
        phase: data.phase || null,
        name: data.name || null,
        status: data.status || null,
        title: data.title || null,
      },
    };
  }

  if (eventName === 'session.tool') {
    const data = payload.data;
    if (!data || !data.toolCallId) return null;
    return {
      type: 'run-updated',
      id: `${payload.runId || payload.sessionKey || 'unknown'}/${data.toolCallId}`,
      updatedAt: seq,
      data: {
        runId: payload.runId || null,
        sessionKey: payload.sessionKey || null,
        agentId: payload.agentId || null,
        toolCallId: data.toolCallId,
        phase: data.phase || null,
        name: data.name || null,
        meta: typeof data.meta === 'string' ? data.meta : null,
        exitCode: data.result && data.result.details ? data.result.details.exitCode ?? null : null,
      },
    };
  }

  return null;
}

/**
 * Create an empty dedupe cache (Map of `${type}:${id}` → last updatedAt/seq).
 */
function createDedupeCache() {
  return new Map();
}

/**
 * Dedupe gate. Returns true when the event is new (should fan out), false when
 * it is a duplicate or older than what was already seen for its key. Pure
 * aside from cache mutation.
 */
function dedupeEvent(cache, evt) {
  if (!evt || !evt.type || !evt.id) return false;
  const key = `${evt.type}:${evt.id}`;
  const stamp = Number(evt.updatedAt || 0);
  const prev = cache.get(key);
  if (prev !== undefined && stamp <= prev) return false;
  cache.set(key, stamp);
  return true;
}

/**
 * Envelope-seq gap detector for the per-connection broadcast counter.
 * Returns 'init' (first observation), 'ok', or 'gap' (missed frames → resync).
 * Pure.
 */
function detectSeqGap(prevSeq, nextSeq) {
  if (!Number.isFinite(nextSeq)) return 'ok';
  if (prevSeq === null || prevSeq === undefined) return 'init';
  if (nextSeq > prevSeq + 1) return 'gap';
  return 'ok';
}

// ── Bridge ───────────────────────────────────────────────────────────────

class GatewayBridge {
  /**
   * @param {object} options
   * @param {{enabled: boolean, url: string|null, auth: object|null}} options.config - pre-resolved config
   * @param {Function} options.onBroadcast - (event: string, data: object) => void, the SSE fanout sink
   * @param {Console} [options.logger]
   */
  constructor({ config, onBroadcast, logger = console }) {
    this.config = config || { enabled: false, url: null, auth: null };
    this.onBroadcast = typeof onBroadcast === 'function' ? onBroadcast : () => {};
    this.log = logger;

    this.ws = null;
    this.closed = false;
    this.connected = false;
    this.backoffMs = RECONNECT_BACKOFF_MIN_MS;
    this.dedupeCache = createDedupeCache();
    this.lastEnvelopeSeq = null;
    this.challengeSeen = false;
    this.connectSent = false;
    this.connectFallbackTimer = null;
    this.reconnectTimer = null;
    this.rpcCounter = 0;
    this.pending = new Map();
  }

  start() {
    if (!this.config.enabled) {
      this.log.log('[gateway-bridge] disabled (no gateway URL resolved) — SSE stream stays poller-fed');
      return;
    }
    this.closed = false;
    this._connect();
  }

  stop() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectFallbackTimer) clearTimeout(this.connectFallbackTimer);
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
      lastEnvelopeSeq: this.lastEnvelopeSeq,
    };
  }

  _connect() {
    if (this.closed) return;
    let ws;
    try {
      // Self-signed TLS is expected on wss:// endpoints; trust is the operator's
      // pinned fingerprint (gateway.remote.tlsFingerprint) per the spike doc.
      ws = new WebSocket(this.config.url, { rejectUnauthorized: false });
    } catch (err) {
      this.log.warn(`[gateway-bridge] WebSocket creation failed (${err.message}) — disabling bridge`);
      this.config = { ...this.config, enabled: false };
      return;
    }
    this.ws = ws;
    this.challengeSeen = false;
    this.connectSent = false;

    ws.on('open', () => {
      // Send connect after the challenge, or after a short fallback delay.
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
      this._flushConnectTimeout();
      if (wasConnected) this.log.warn('[gateway-bridge] gateway connection lost');
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

  _flushConnectTimeout() {
    if (this.connectFallbackTimer) {
      clearTimeout(this.connectFallbackTimer);
      this.connectFallbackTimer = null;
    }
  }

  _sendConnect() {
    if (this.connectSent || !this.ws) return;
    this.connectSent = true;
    this._flushConnectTimeout();
    this._request('connect', {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'linux',
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.read'],
      caps: [],
      commands: [],
      permissions: {},
      auth: this.config.auth || {},
      locale: 'en-US',
      userAgent: 'webos-gateway-bridge/1.0',
    }, CONNECT_TIMEOUT_MS)
      .then((helloOk) => {
        this.connected = true;
        this.backoffMs = RECONNECT_BACKOFF_MIN_MS;
        this.dedupeCache = createDedupeCache();
        this.lastEnvelopeSeq = null;
        this.log.log(`[gateway-bridge] connected protocol=${helloOk?.protocol ?? '?'} server=${helloOk?.server?.version ?? '?'}`);
        // Session-index change nudges; read-only subscription.
        this._request('sessions.subscribe', {}).catch(() => {});
        // Fresh state after (re)connect: ask browsers to resync once.
        this.onBroadcast('resync', { reason: 'bridge-connected' });
      })
      .catch((err) => {
        this.log.warn(`[gateway-bridge] connect failed: ${err.message}`);
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
      const id = `bridge-${++this.rpcCounter}-${crypto.randomUUID()}`;
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

    if (msg.type === 'event') {
      // Envelope seq is a per-connection broadcast counter; gaps mean missed
      // frames → clear dedupe state and ask browsers to resync.
      const gap = detectSeqGap(this.lastEnvelopeSeq, msg.seq);
      if (Number.isFinite(msg.seq)) this.lastEnvelopeSeq = msg.seq;
      if (gap === 'gap') {
        this.dedupeCache = createDedupeCache();
        this.onBroadcast('resync', { reason: 'seq-gap' });
      }
      if (!CONSUMED_EVENTS.has(msg.event)) return;
      const evt = normalizeGatewayEvent(msg.event, msg.payload);
      if (!evt) return;
      if (dedupeEvent(this.dedupeCache, evt)) {
        this.onBroadcast(evt.type, { id: evt.id, updatedAt: evt.updatedAt, ...evt.data });
      }
    }
  }
}

/**
 * Create and wire a bridge instance. Resolves config (env + config file) and
 * returns an unstarted bridge. Never throws for missing config — the bridge
 * simply reports enabled=false.
 *
 * @param {object} [options]
 * @param {Function} [options.broadcastStream] - SSE fanout sink
 * @param {object} [options.env] - env override source (default process.env)
 * @param {object|null} [options.gatewayConfig] - pre-parsed openclaw.json (skips file read)
 * @param {string} [options.cfgPath] - openclaw.json path override
 * @param {Console} [options.logger]
 */
function createGatewayBridge(options = {}) {
  const env = options.env || process.env;
  const gatewayConfig = options.gatewayConfig !== undefined
    ? options.gatewayConfig
    : loadGatewayConfigFile(options.cfgPath);
  const config = resolveBridgeConfig({ env, gatewayConfig });
  return new GatewayBridge({
    config,
    onBroadcast: options.broadcastStream || (() => {}),
    logger: options.logger || console,
  });
}

module.exports = {
  GatewayBridge,
  createGatewayBridge,
  resolveBridgeConfig,
  loadGatewayConfigFile,
  normalizeGatewayEvent,
  createDedupeCache,
  dedupeEvent,
  detectSeqGap,
};
