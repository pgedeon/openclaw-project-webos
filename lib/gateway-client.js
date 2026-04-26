/**
 * OpenClaw Gateway WebSocket Client
 *
 * Connects to the gateway at ws://127.0.0.1:18789 and provides
 * RPC methods for the dashboard backend.
 *
 * Protocol: JSON-based request/response + event streaming
 * Auth: Token-based (reads from OPENCLAW_GATEWAY_TOKEN env)
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || null;
const RECONNECT_BACKOFF_MIN = 800;
const RECONNECT_BACKOFF_MAX = 15000;

class GatewayClient {
  constructor(opts = {}) {
    this.url = opts.url || GATEWAY_URL;
    this.token = opts.token || GATEWAY_TOKEN;
    this.password = opts.password || process.env.OPENCLAW_GATEWAY_PASSWORD || null;
    this.ws = null;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.connected = false;
    this.helloPayload = null;
    this.closed = false;
    this.backoffMs = RECONNECT_BACKOFF_MIN;
    this.connectNonce = null;
    this.connectSent = false;
    this.connectTimer = null;

    this.onConnected = opts.onConnected || null;
    this.onDisconnected = opts.onDisconnected || null;
  }

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

  async chatSend({ sessionKey, message }) {
    return this._request('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async chatAbort(sessionKey, runId) {
    return this._request('chat.abort', { sessionKey, runId });
  }

  async chatHistory(sessionKey, limit = 200) {
    return this._request('chat.history', { sessionKey, limit });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
  }

  off(event, handler) {
    this.eventHandlers.get(event)?.delete(handler);
  }

  // ── Connection ────────────────────────────────

  _connect() {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(this.url, { headers: { Origin: "http://localhost:18789" } });
    } catch (err) {
      console.error('[gateway-client] WebSocket creation failed:', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      // Wait for potential challenge, then send connect
      this.connectNonce = null;
      this.connectSent = false;
      if (this.connectTimer !== null) clearTimeout(this.connectTimer);
      this.connectTimer = setTimeout(() => this._sendConnect(), 750);
    });

    this.ws.addEventListener('message', (event) => {
      this._handleMessage(String(event.data || ''));
    });

    this.ws.addEventListener('close', (event) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      this._flushPending(new Error(`gateway closed (${event.code})`));
      if (this.onDisconnected && wasConnected) this.onDisconnected();
      if (!this.closed) this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      // close handler will deal with reconnection
    });
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
        id: 'openclaw-control-ui',
        version: '1.0.0',
        platform: 'linux',
        mode: 'ui',
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
      auth: this.password ? { password: this.password } : (this.token ? { token: this.token } : undefined),
    };

    try {
      const result = await this._request('connect', connectParams);
      this.connected = true;
      this.helloPayload = result;
      this.backoffMs = RECONNECT_BACKOFF_MIN;
      console.log('✅ Gateway client connected');
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

  // ── RPC ───────────────────────────────────────

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
    try { msg = JSON.parse(raw); } catch { return; }

    // Handle connect.challenge event
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      if (msg.payload?.nonce) {
        this.connectNonce = msg.payload.nonce;
      }
      this._sendConnect();
      return;
    }

    // Handle events
    if (msg.type === 'event') {
      if (msg.event === 'chat' || msg.event?.startsWith('chat')) {
        console.log('[gw-raw] chat event:', JSON.stringify({ event: msg.event, state: msg.payload?.state, sessionKey: msg.payload?.sessionKey }));
      }
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
        pending.reject(err);
      }
    }
  }

  _emit(event, payload) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(payload); } catch (err) {
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
