/**
 * openclaw-webos — vanilla ES view module (Phase 2).
 *
 * Rendered inside the thin Lit wrapper (index.js). Pure DOM + host.request —
 * no framework, no build step. Mirrors the dashboard's native-views contract:
 *   export function render(container, context) -> cleanup function
 *
 * Data comes from the operator's authenticated Control UI socket (Phase 0
 * findings §2c: same-origin tab shares connection scopes; no token gate).
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

  const root = document.createElement('div');
  root.className = 'wb';
  container.replaceChildren(root);

  const load = async () => {
    if (!host || disposed) return;
    const token = ++loadToken;
    try {
      const payload = await host.request('workboard.cards.list', { boardId });
      if (disposed || token !== loadToken || signal?.aborted) return;
      const cards = Array.isArray(payload?.cards) ? payload.cards : [];
      const boards = Array.isArray(payload?.boards) ? payload.boards : [];
      snapshot = { available: true, cards, boards, columns: groupCardsByStatus(cards), statuses: WORKBOARD_STATUSES };
    } catch (error) {
      if (disposed || token !== loadToken) return;
      snapshot = createUnavailableState(error);
    }
    renderDom();
  };

  const selectCard = (id) => {
    selectedId = selectedId === id ? null : id;
    renderDom();
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
      load();
    });
    for (const button of root.querySelectorAll('[data-card-id]')) {
      button.addEventListener('click', () => selectCard(button.dataset.cardId));
    }
  };

  renderDom();
  load();

  return () => {
    disposed = true;
    loadToken += 1;
    root.remove();
  };
}

export default render;
