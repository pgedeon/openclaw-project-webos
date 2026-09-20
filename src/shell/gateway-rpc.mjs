/**
 * Browser-side OpenClaw Gateway WS RPC client.
 *
 * Phase 1 (openclaw-native-integration): WebOS :8120 is a different origin
 * from Control UI, so this tab MUST open its own connect (device token /
 * shared secret). It cannot piggyback the Control UI socket (Phase 0 #6).
 *
 * Live refresh: workboard.notifications.events THEN
 * workboard.notifications.advance as TWO RPCs (Phase 0 #3: events rejects
 * advance:true). Cursor is inclusive-exclusive (Phase 0 #4).
 *
 * Transport is injectable so tests can use a fake RPC harness.
 */

export const GATEWAY_PROTOCOL = 4;
export const DEFAULT_CONTROL_UI_ORIGIN = 'https://home.3dput.com';
export const DEFAULT_CONTROL_UI_BASE_PATH = '/openclaw';

export const WORKBOARD_STATUSES = Object.freeze([
  'triage',
  'backlog',
  'todo',
  'scheduled',
  'ready',
  'running',
  'review',
  'blocked',
  'done',
]);

export const GATEWAY_UNAVAILABLE = Object.freeze({
  available: false,
  reason: 'gateway-unavailable',
});

const STORAGE_DEVICE_IDENTITY = 'openclaw-device-identity-v1';
const STORAGE_DEVICE_AUTH_PREFIX = 'openclaw.device.auth.v1:';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function compareNotifications(left, right) {
  const leftAt = Number(left?.createdAt ?? 0);
  const rightAt = Number(right?.createdAt ?? 0);
  if (leftAt !== rightAt) {
    return leftAt - rightAt;
  }
  const leftSeq = Number(left?.sequence ?? 0);
  const rightSeq = Number(right?.sequence ?? 0);
  if (leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

export function isAtOrBeforeCursor(event, cursor) {
  if (!cursor || (cursor.lastEventId == null && cursor.lastEventSequence == null && cursor.lastEventAt == null)) {
    return false;
  }
  return compareNotifications(event, {
    id: cursor.lastEventId,
    createdAt: cursor.lastEventAt,
    sequence: cursor.lastEventSequence,
  }) <= 0;
}

export function nextNotificationCursor(events, previous = {}) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) {
    return {
      lastEventId: previous.lastEventId ?? null,
      lastEventSequence: previous.lastEventSequence ?? null,
      lastEventAt: previous.lastEventAt ?? null,
    };
  }
  const newest = [...list].sort(compareNotifications).at(-1);
  return {
    lastEventId: newest?.id ?? previous.lastEventId ?? null,
    lastEventSequence: newest?.sequence ?? previous.lastEventSequence ?? null,
    lastEventAt: newest?.createdAt ?? previous.lastEventAt ?? null,
  };
}

export function filterEventsAfterCursor(events, cursor) {
  return (Array.isArray(events) ? events : []).filter((event) => !isAtOrBeforeCursor(event, cursor));
}

export function selectGatewayConnectAuth(params = {}) {
  const token = String(params.token || '').trim() || undefined;
  const deviceToken = String(params.deviceToken || '').trim() || undefined;
  const password = String(params.password || '').trim() || undefined;
  const bootstrapToken = String(params.bootstrapToken || '').trim() || undefined;
  return {
    token,
    deviceToken: token ? undefined : deviceToken,
    password: token || deviceToken ? undefined : password,
    bootstrapToken: token || deviceToken || password ? undefined : bootstrapToken,
  };
}

export function buildConnectFrame({
  id,
  auth = {},
  client = {},
  minProtocol = GATEWAY_PROTOCOL,
  maxProtocol = GATEWAY_PROTOCOL,
} = {}) {
  const selected = selectGatewayConnectAuth(auth);
  const credential = {};
  if (selected.token) credential.token = selected.token;
  if (selected.deviceToken) credential.deviceToken = selected.deviceToken;
  if (selected.password) credential.password = selected.password;
  if (selected.bootstrapToken) credential.bootstrapToken = selected.bootstrapToken;

  return {
    type: 'req',
    id: id || `connect-${Date.now()}`,
    method: 'connect',
    params: {
      minProtocol,
      maxProtocol,
      client: {
        id: client.id || 'webos-dashboard',
        version: client.version || 'phase1',
        platform: client.platform || 'web',
        mode: client.mode || 'operator',
      },
      role: 'operator',
      admission: {
        credential,
      },
    },
  };
}

export function buildRequestFrame(id, method, params = {}) {
  return {
    type: 'req',
    id,
    method,
    params: params && typeof params === 'object' ? params : {},
  };
}

export function parseGatewayFrame(raw) {
  if (isRecord(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function resolveGatewayUrl(options = {}) {
  if (options.url) {
    return String(options.url);
  }
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  if (env.GATEWAY_BRIDGE_URL) {
    return String(env.GATEWAY_BRIDGE_URL);
  }
  if (typeof globalThis !== 'undefined' && globalThis.__OPENCLAW_GATEWAY_URL__) {
    return String(globalThis.__OPENCLAW_GATEWAY_URL__);
  }
  return 'ws://127.0.0.1:18789';
}

export function resolveGatewayAuth(options = {}) {
  if (options.auth && typeof options.auth === 'object') {
    return selectGatewayConnectAuth(options.auth);
  }
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  if (env.GATEWAY_BRIDGE_TOKEN) {
    return selectGatewayConnectAuth({ token: env.GATEWAY_BRIDGE_TOKEN });
  }
  if (env.GATEWAY_BRIDGE_PASSWORD) {
    return selectGatewayConnectAuth({ password: env.GATEWAY_BRIDGE_PASSWORD });
  }
  if (typeof globalThis !== 'undefined') {
    if (globalThis.__OPENCLAW_GATEWAY_TOKEN__) {
      return selectGatewayConnectAuth({ token: globalThis.__OPENCLAW_GATEWAY_TOKEN__ });
    }
    if (globalThis.__OPENCLAW_GATEWAY_PASSWORD__) {
      return selectGatewayConnectAuth({ password: globalThis.__OPENCLAW_GATEWAY_PASSWORD__ });
    }
  }
  const stored = loadStoredDeviceToken(options.gatewayUrl || resolveGatewayUrl(options), options.storage);
  if (stored) {
    return selectGatewayConnectAuth({ deviceToken: stored });
  }
  return {};
}

export function loadStoredDeviceToken(gatewayUrl, storage) {
  const store = storage
    || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  if (!store || typeof store.getItem !== 'function') {
    return null;
  }
  try {
    const raw = store.getItem(`${STORAGE_DEVICE_AUTH_PREFIX}${gatewayUrl}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const operator = parsed?.tokens?.operator?.token || parsed?.token;
    return operator ? String(operator) : null;
  } catch {
    return null;
  }
}

export function controlUiWorkboardUrl({
  origin = DEFAULT_CONTROL_UI_ORIGIN,
  basePath = DEFAULT_CONTROL_UI_BASE_PATH,
  cardId = '',
  boardId = 'default',
} = {}) {
  const root = `${String(origin).replace(/\/$/, '')}${basePath.startsWith('/') ? basePath : `/${basePath}`}`;
  const params = new URLSearchParams();
  if (boardId) params.set('board', boardId);
  if (cardId) params.set('card', cardId);
  const query = params.toString();
  return `${root}?${query}#workboard`;
}

export function heartbeatAgeMs(card, now = Date.now()) {
  const claim = card?.metadata?.claim || {};
  const stamp = claim.lastHeartbeatAt || card?.updatedAt || card?.startedAt || null;
  if (stamp == null) {
    return null;
  }
  const ms = typeof stamp === 'number' ? stamp : Date.parse(stamp);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return Math.max(0, now - ms);
}

export function formatHeartbeatAge(ageMs) {
  if (ageMs == null) {
    return 'no heartbeat';
  }
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function groupCardsByStatus(cards, statuses = WORKBOARD_STATUSES) {
  const columns = Object.fromEntries(statuses.map((status) => [status, []]));
  for (const card of Array.isArray(cards) ? cards : []) {
    const status = statuses.includes(card?.status) ? card.status : 'triage';
    if (!columns[status]) columns[status] = [];
    columns[status].push(card);
  }
  return columns;
}

export function createGatewayUnavailableState(detail = '') {
  return {
    ...GATEWAY_UNAVAILABLE,
    detail: detail ? String(detail) : '',
  };
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createGatewayRpc(options = {}) {
  const transport = options.transport || null;
  const url = resolveGatewayUrl(options);
  const auth = resolveGatewayAuth({ ...options, gatewayUrl: url });
  const pending = new Map();
  let connected = false;
  let connectError = null;
  let lastEventId = options.lastEventId ?? null;
  let lastEventSequence = options.lastEventSequence ?? null;
  let lastEventAt = options.lastEventAt ?? null;
  let requestSeq = 0;

  const sendRaw = async (frame) => {
    if (!transport || typeof transport.request !== 'function') {
      throw Object.assign(new Error('gateway-unavailable'), {
        code: 'gateway-unavailable',
        available: false,
        reason: 'gateway-unavailable',
      });
    }
    return transport.request(frame);
  };

  const request = async (method, params = {}) => {
    if (method === 'workboard.notifications.events' && params?.advance === true) {
      throw new Error('notification cursor advancement requires workboard.notifications.advance');
    }
    const id = `req-${++requestSeq}`;
    const frame = method === 'connect'
      ? buildConnectFrame({ id, auth, client: options.client })
      : buildRequestFrame(id, method, params);
    const response = await sendRaw(frame);
    const parsed = parseGatewayFrame(response);
    if (!parsed) {
      throw Object.assign(new Error('invalid gateway frame'), {
        code: 'invalid-frame',
        available: false,
        reason: 'gateway-unavailable',
      });
    }
    if (parsed.ok === false || parsed.error) {
      const message = parsed.error?.message || parsed.error || 'gateway request failed';
      throw Object.assign(new Error(String(message)), {
        code: parsed.error?.code || 'rpc-error',
        payload: parsed,
      });
    }
    return parsed.payload !== undefined ? parsed.payload : (parsed.result !== undefined ? parsed.result : parsed);
  };

  const connect = async () => {
    try {
      const hello = await request('connect');
      connected = true;
      connectError = null;
      return hello;
    } catch (error) {
      connected = false;
      connectError = error;
      throw error;
    }
  };

  const ensureConnected = async () => {
    if (connected) return true;
    await connect();
    return true;
  };

  const safeCall = async (method, params) => {
    try {
      await ensureConnected();
      return await request(method, params);
    } catch (error) {
      if (error?.code === 'gateway-unavailable' || error?.reason === 'gateway-unavailable') {
        return createGatewayUnavailableState(error.message);
      }
      throw error;
    }
  };

  const client = {
    url,
    get connected() {
      return connected;
    },
    get connectError() {
      return connectError;
    },
    get cursor() {
      return { lastEventId, lastEventSequence, lastEventAt };
    },
    connect,
    request,
    cards: {
      list(params = {}) {
        return safeCall('workboard.cards.list', params);
      },
      stats(params = {}) {
        return safeCall('workboard.cards.stats', params);
      },
    },
    boards: {
      list(params = {}) {
        return safeCall('workboard.boards.list', params);
      },
    },
    tasks: {
      list(params = {}) {
        return safeCall('tasks.list', params);
      },
    },
    automations: {
      list(params = {}) {
        return safeCall('cron.list', params);
      },
    },
    notifications: {
      async events(params = {}) {
        if (params.advance === true) {
          throw new Error('notification cursor advancement requires workboard.notifications.advance');
        }
        const payload = {
          ...params,
          lastEventId: params.lastEventId ?? lastEventId,
          lastEventSequence: params.lastEventSequence ?? lastEventSequence,
          lastEventAt: params.lastEventAt ?? lastEventAt,
        };
        delete payload.advance;
        return safeCall('workboard.notifications.events', payload);
      },
      async advance(params = {}) {
        const payload = {
          ...params,
          lastEventId: params.lastEventId ?? lastEventId,
          lastEventSequence: params.lastEventSequence ?? lastEventSequence,
          lastEventAt: params.lastEventAt ?? lastEventAt,
        };
        const result = await safeCall('workboard.notifications.advance', payload);
        if (result?.available === false) {
          return result;
        }
        const events = result?.events || [];
        const next = nextNotificationCursor(events, {
          lastEventId,
          lastEventSequence,
          lastEventAt,
        });
        lastEventId = next.lastEventId;
        lastEventSequence = next.lastEventSequence;
        lastEventAt = next.lastEventAt;
        return result;
      },
      async poll(params = {}) {
        const eventsResult = await client.notifications.events(params);
        if (eventsResult?.available === false) {
          return eventsResult;
        }
        const events = filterEventsAfterCursor(eventsResult?.events || eventsResult || [], {
          lastEventId,
          lastEventSequence,
          lastEventAt,
        });
        if (events.length === 0) {
          return { events, cursor: client.cursor, advanced: false };
        }
        const last = [...events].sort(compareNotifications).at(-1);
        await client.notifications.advance({
          ...params,
          lastEventId: last.id,
          lastEventSequence: last.sequence,
          lastEventAt: last.createdAt,
        });
        return { events, cursor: client.cursor, advanced: true };
      },
    },
    controlUiWorkboardUrl,
  };

  return client;
}

export default createGatewayRpc;
