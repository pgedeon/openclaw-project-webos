/**
 * openclaw-webos — vanilla ES view module (Phase 2 + Phase 2.5 live refresh).
 *
 * Rendered inside the thin Lit wrapper (index.js). Pure DOM + host.request —
 * no framework, no build step. Mirrors the dashboard's native-views contract:
 *   export function render(container, context) -> cleanup function
 *
 * Data comes from the operator's authenticated Control UI socket (Phase 0
 * findings §2c: same-origin tab shares connection scopes; no token gate).
 *
 * Live refresh (Phase 2.5) uses the gateway's own workboard contracts:
 *   1. workboard.notifications.events  (READ)  — new completed/failed/stale
 *      notifications. Cursor is inclusive-exclusive; we advance it with a
 *      SEPARATE workboard.notifications.advance call, never advance:true on
 *      events (gateway rejects that: "notification cursor advancement requires
 *      workboard.notifications.advance").
 *      Live 2026.11.3 note: advance requires a subscriptionId, so we create a
 *      board-scoped subscription first (workboard.notifications.subscribe) when
 *      the operator connection can write; otherwise the cursor is tracked
 *      client-side and nothing is written to the gateway.
 *   2. workboard.cards.list with sinceRevision (READ) — a cheap unchanged
 *      sentinel. Notification kinds do NOT include status/title/updatedAt or
 *      heartbeat changes, so this is what actually proves live freshness for
 *      ordinary card edits. It returns { unchanged: true } when nothing moved.
 *
 * Failure mode is honest, never fake: if the notify RPCs are unsupported the
 * view keeps manual Refresh and shows a "live updates unavailable" chip. No
 * fast-poll fallback, bounded interval (>= 5s), single in-flight request.
 */

const WORKBOARD_STATUSES = ['triage', 'backlog', 'todo', 'scheduled', 'ready', 'running', 'review', 'blocked', 'done'];

const STATUS_META = {
  triage: { color: '#94a3b8', label: 'Triage' },
  backlog: { color: '#6b7280', label: 'Backlog' },
  todo: { color: '#64748b', label: 'Todo' },
  scheduled: { color: '#0ea5e9', label: 'Scheduled' },
  ready: { color: '#f59e0b', label: 'Ready' },
  running: { color: '#3b82f6', label: 'Running' },
  review: { color: '#a855f7', label: 'Review' },
  blocked: { color: '#ef4444', label: 'Blocked' },
  done: { color: '#22c55e', label: 'Done' },
};

const LIVE_INTERVAL_MS = 8000;
const LIVE_MIN_INTERVAL_MS = 5000;
const LIVE_EVENT_LIMIT = 50;
// One durable cursor record per board is reused across mounts, so a reload
// resumes at the right cursor instead of replaying history or leaking a
// subscription per mount.
const LIVE_TARGET = 'openclaw-webos-tab';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const heartbeatAgeMs = (card) => {
  const claim = card?.metadata?.claim || {};
  const at = Number(claim.lastHeartbeatAt || claim.claimedAt || card?.updatedAt || 0);
  return at ? Date.now() - at : null;
};

const formatHeartbeatAge = (card) => {
  const ms = heartbeatAgeMs(card);
  if (ms === null) return '—';
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

const groupCardsByStatus = (cards) => {
  const columns = {};
  for (const status of WORKBOARD_STATUSES) {
    columns[status] = cards.filter((card) => card.status === status);
  }
  return columns;
};

const createUnavailableState = (error) => ({
  available: false,
  reason: 'gateway-unavailable',
  detail: error?.message || String(error || 'gateway-unavailable'),
});

/** Notify RPC gone or method unknown — degrade, never emulate freshness. */
const isUnsupportedError = (error) => /unknown method|not found|unsupported|not implemented|does not exist|no such/i
  .test(String(error?.message || error || ''));

/** Compare notification events in the gateway's own order (createdAt, sequence, id). */
const compareNotifications = (a, b) => {
  const at = Number(a?.createdAt || 0);
  const bt = Number(b?.createdAt || 0);
  if (at !== bt) return at < bt ? -1 : 1;
  const as = Number(a?.sequence ?? 0);
  const bs = Number(b?.sequence ?? 0);
  if (as !== bs) return as < bs ? -1 : 1;
  return String(a?.id || '') < String(b?.id || '') ? -1 : String(a?.id || '') > String(b?.id || '') ? 1 : 0;
};

/**
 * render(container, context) — the vanilla ES module contract the Lit wrapper
 * mounts. Returns a cleanup function.
 */
export function render(container, context = {}) {
  if (!container) return () => {};

  const host = context.host;
  const signal = context.signal;
  let boardId = context.boardId || 'default';
  let snapshot = { available: true, cards: [], boards: [], columns: {}, statuses: WORKBOARD_STATUSES };
  let selectedId = null;
  let disposed = false;
  let loadToken = 0;

  // Live-refresh state. 'off' until the first successful load; then one of
  // 'live' (notify + revision), 'poll' (revision-only, notify unsupported) or
  // 'unavailable' (no live path — manual Refresh only).
  let liveState = 'off';
  let liveReason = '';
  let liveTimer = null;
  let liveInFlight = false;
  let revision = null;
  let subscriptionId = null;
  let eventsSeeded = false;
  let eventCursor = { lastEventAt: 0, lastEventSequence: -1, lastEventId: '' };

  const root = document.createElement('div');
  root.className = 'wb';
  container.replaceChildren(root);

  const stopLive = () => {
    if (liveTimer !== null) {
      clearTimeout(liveTimer);
      liveTimer = null;
    }
  };

  const scheduleLive = () => {
    if (disposed || signal?.aborted || liveState === 'off') return;
    stopLive();
    liveTimer = setTimeout(() => {
      liveTimer = null;
      liveTick();
    }, LIVE_INTERVAL_MS);
    // Node/browser: do not keep an idle process alive in tests.
    if (liveTimer && typeof liveTimer === 'object' && typeof liveTimer.unref === 'function') liveTimer.unref();
  };

  const applyPending = () => {
    const events = Array.isArray(snapshot.pendingEvents) ? snapshot.pendingEvents : [];
    const fresh = events.filter((event) => compareNotifications(event, eventCursor) > 0);
    if (!eventsSeeded) {
      // First read is history, not freshness: seed the cursor, do not refresh.
      eventsSeeded = true;
      if (events.length) {
        const last = [...events].sort(compareNotifications).at(-1);
        eventCursor = {
          lastEventAt: Number(last.createdAt || 0),
          lastEventSequence: Number(last.sequence ?? -1),
          lastEventId: String(last.id || ''),
        };
      }
      return false;
    }
    if (fresh.length === 0) return false;
    const last = [...fresh].sort(compareNotifications).at(-1);
    eventCursor = {
      lastEventAt: Number(last.createdAt || 0),
      lastEventSequence: Number(last.sequence ?? -1),
      lastEventId: String(last.id || ''),
    };
    return true;
  };

  const adoptLiveError = (error) => {
    if (isUnsupportedError(error)) {
      liveState = 'unavailable';
      liveReason = error?.message || String(error || 'unsupported');
      stopLive();
    } else {
      // Transient (scope/network): keep the loop, do not claim freshness.
      liveReason = error?.message || String(error || 'live error');
    }
  };

  const liveTick = async () => {
    if (!host || disposed || signal?.aborted || liveInFlight || liveState === 'off' || liveState === 'unavailable') return;
    liveInFlight = true;
    let changed = false;
    try {
      // 1) Notifications (completed/failed/stale) — the pinned notify contract.
      if (liveState !== 'unavailable') {
        try {
          const params = { boardId, limit: LIVE_EVENT_LIMIT };
          if (subscriptionId) params.subscriptionId = subscriptionId;
          const eventsPayload = await host.request('workboard.notifications.events', params);
          if (disposed || signal?.aborted) return;
          const events = Array.isArray(eventsPayload?.events)
            ? eventsPayload.events
            : Array.isArray(eventsPayload) ? eventsPayload : [];
          snapshot.pendingEvents = events;
          if (applyPending()) changed = true;
          if (subscriptionId) {
            // Cursor advance is a SEPARATE RPC (events rejects advance:true).
            await host.request('workboard.notifications.advance', { subscriptionId });
            if (disposed || signal?.aborted) return;
          }
          liveReason = '';
        } catch (error) {
          adoptLiveError(error);
        }
      }

      // 2) Revision sentinel — catches status/title/updatedAt/heartbeat edits
      //    that never produce a notification event.
      try {
        const params = { boardId };
        if (revision) params.sinceRevision = revision;
        const payload = await host.request('workboard.cards.list', params);
        if (disposed || signal?.aborted) return;
        if (payload && payload.unchanged !== true) {
          const cards = Array.isArray(payload?.cards) ? payload.cards : [];
          const boards = Array.isArray(payload?.boards) ? payload.boards : [];
          if (payload?.revision) revision = payload.revision;
          snapshot = { ...snapshot, available: true, cards, boards, columns: groupCardsByStatus(cards), statuses: WORKBOARD_STATUSES };
          changed = true;
        }
        if (liveState === 'off') liveState = 'live';
      } catch (error) {
        adoptLiveError(error);
      }

      if (!disposed && !signal?.aborted && changed) {
        if (liveState === 'off') liveState = 'live';
        renderDom();
      }
    } finally {
      liveInFlight = false;
      if (!disposed && !signal?.aborted && liveState !== 'off' && liveState !== 'unavailable') scheduleLive();
    }
  };

  const ensureSubscription = async () => {
    // Reuse an existing board-scoped cursor record; prune duplicates left by
    // earlier mounts. Only when none exists do we create one.
    try {
      const listed = await host.request('workboard.notifications.list', { boardId });
      const mine = (Array.isArray(listed?.subscriptions) ? listed.subscriptions : [])
        .filter((sub) => sub?.target === LIVE_TARGET && (sub.boardId || 'default') === boardId)
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      if (mine.length > 0) {
        subscriptionId = mine[0].id;
        for (const extra of mine.slice(1)) {
          try {
            await host.request('workboard.notifications.delete', { id: extra.id });
          } catch {
            /* prune is best-effort */
          }
        }
        return;
      }
    } catch {
      /* list unsupported → try to create one below */
    }
    try {
      const result = await host.request('workboard.notifications.subscribe', {
        boardId,
        target: LIVE_TARGET,
      });
      subscriptionId = result?.subscription?.id ?? null;
    } catch {
      subscriptionId = null;
    }
  };

  const startLive = async () => {
    if (!host || disposed || signal?.aborted || liveState === 'unavailable') return;
    liveState = 'live';
    // Best-effort subscription so advance can move the server cursor. A
    // read-only operator cannot subscribe; we then keep the cursor client-side
    // and never write to the gateway.
    if (host.connection?.canWrite !== false) await ensureSubscription();
    if (disposed || signal?.aborted) return;
    if (liveState === 'live' && snapshot.available) renderDom();
    scheduleLive();
  };

  const load = async () => {
    if (!host || disposed) return;
    const token = ++loadToken;
    try {
      const payload = await host.request('workboard.cards.list', { boardId });
      if (disposed || token !== loadToken || signal?.aborted) return;
      const cards = Array.isArray(payload?.cards) ? payload.cards : [];
      const boards = Array.isArray(payload?.boards) ? payload.boards : [];
      if (payload?.revision) revision = payload.revision;
      snapshot = { available: true, cards, boards, columns: groupCardsByStatus(cards), statuses: WORKBOARD_STATUSES, pendingEvents: snapshot.pendingEvents };
      liveReason = '';
    } catch (error) {
      if (disposed || token !== loadToken) return;
      snapshot = createUnavailableState(error);
    }
    renderDom();
    if (snapshot.available && liveState === 'off') startLive();
  };

  const selectCard = (id) => {
    selectedId = selectedId === id ? null : id;
    renderDom();
  };

  const liveChip = () => {
    if (liveState === 'off') return '';
    if (liveState === 'unavailable') {
      return `<span class="wb-live" data-live="unavailable" title="${escapeHtml(liveReason || 'notify RPC unsupported')}">live updates unavailable</span>`;
    }
    return '<span class="wb-live" data-live="live" title="Workboard notifications + revision polling (8s)">live</span>';
  };

  const renderDom = () => {
    if (!snapshot.available) {
      root.innerHTML = `
        <div class="wb-unavailable" data-state="gateway-unavailable">
          <h2>Gateway unavailable</h2>
          <p>Workboard bridge is down. This tab is read-only and does not invent a fallback origin.</p>
          <p class="wb-empty">${escapeHtml(snapshot.detail || snapshot.reason || 'gateway-unavailable')}</p>
          <button type="button" class="wb-ctl" data-action="retry">Retry</button>
        </div>
      `;
      root.querySelector('[data-action="retry"]')?.addEventListener('click', () => load());
      return;
    }

    const selected = snapshot.cards.find((card) => card.id === selectedId) || null;

    root.innerHTML = `
      <div class="wb-tb">
        <span class="wb-tb__title">OpenClaw Workboard</span>
        ${liveChip()}
        <select class="wb-ctl" data-action="board" aria-label="Board">
          ${snapshot.boards.map((board) => `<option value="${escapeHtml(board.id)}"${board.id === boardId ? ' selected' : ''}>${escapeHtml(board.name || board.id)}</option>`).join('')}
        </select>
        <button type="button" class="wb-ctl" data-action="refresh">Refresh</button>
      </div>
      <div class="wb-body">
        <div class="wb-cols">
          ${WORKBOARD_STATUSES.map((status) => {
            const meta = STATUS_META[status] || { color: '#94a3b8', label: status };
            const cards = snapshot.columns[status] || [];
            return `
              <section class="wb-col">
                <div class="wb-col-hd">
                  <span class="wb-col-hd__dot" style="background:${meta.color}"></span>
                  <span>${escapeHtml(meta.label)}</span>
                  <span class="wb-col-hd__cnt">${cards.length}</span>
                </div>
                <div class="wb-col-body">
                  ${cards.length === 0
                    ? '<div class="wb-empty">No cards</div>'
                    : cards.map((card) => `
                      <button type="button" class="wb-card" data-card-id="${escapeHtml(card.id)}">
                        <div class="wb-card__title">${escapeHtml(card.title || '(untitled)')}</div>
                        <div class="wb-card__meta">
                          <span class="wb-chip">${escapeHtml(card.priority || 'normal')}</span>
                          ${card.agentId ? `<span class="wb-chip">${escapeHtml(card.agentId)}</span>` : ''}
                          <span>${escapeHtml(formatHeartbeatAge(card))}</span>
                        </div>
                      </button>
                    `).join('')}
                </div>
              </section>
            `;
          }).join('')}
        </div>
        <aside class="wb-drawer">
          ${selected ? `
            <h3>${escapeHtml(selected.title || '(untitled)')}</h3>
            <dl>
              <dt>Status</dt><dd>${escapeHtml(selected.status || 'unknown')}</dd>
              <dt>Agent</dt><dd>${escapeHtml(selected.agentId || '—')}</dd>
              <dt>Priority</dt><dd>${escapeHtml(selected.priority || 'normal')}</dd>
              <dt>Heartbeat</dt><dd>${escapeHtml(formatHeartbeatAge(selected))}</dd>
              <dt>Labels</dt><dd>${(selected.labels || []).map((label) => escapeHtml(label)).join(', ') || '—'}</dd>
            </dl>
          ` : '<div class="wb-empty">Select a card</div>'}
        </aside>
      </div>
    `;

    root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => load());
    root.querySelector('[data-action="board"]')?.addEventListener('change', (event) => {
      boardId = event.target.value;
      selectedId = null;
      revision = null;
      eventsSeeded = false;
      eventCursor = { lastEventAt: 0, lastEventSequence: -1, lastEventId: '' };
      load();
    });
    for (const button of root.querySelectorAll('[data-card-id]')) {
      button.addEventListener('click', () => selectCard(button.dataset.cardId));
    }
  };

  const onAbort = () => dispose();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    loadToken += 1;
    stopLive();
    if (signal && typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', onAbort);
    }
    // The board-scoped subscription is a durable cursor, intentionally kept so
    // a reload resumes where it left off; it is reused (and pruned) on mount.
    subscriptionId = null;
    root.remove();
  };

  if (signal && typeof signal.addEventListener === 'function') {
    if (signal.aborted) return () => {};
    signal.addEventListener('abort', onAbort);
  }

  renderDom();
  load();

  return dispose;
}

export default render;

// Keep the pinned bounds visible to the packaging tests.
export const LIVE_REFRESH = { intervalMs: LIVE_INTERVAL_MS, minIntervalMs: LIVE_MIN_INTERVAL_MS };
