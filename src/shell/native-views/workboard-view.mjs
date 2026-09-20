/**
 * Native Workboard window — Phase 1 read-only OpenClaw Workboard surface.
 *
 * Columns by status, card detail drawer, board filter. No write-back.
 * Deep-link "Open in Workboard" targets Control UI. Bridge-down degrades
 * to the house-contract gateway-unavailable state.
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';
import {
  WORKBOARD_STATUSES,
  createGatewayRpc,
  createGatewayUnavailableState,
  formatHeartbeatAge,
  groupCardsByStatus,
  heartbeatAgeMs,
  controlUiWorkboardUrl,
} from '../gateway-rpc.mjs';

const CSS_ID = 'wb-native-styles';

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

function injectCSS() {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    .wb{display:flex;flex-direction:column;height:100%;background:var(--win11-surface-solid);font-family:'Segoe UI',system-ui,sans-serif;color:var(--win11-text)}
    .wb-tb{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--win11-border);flex-wrap:wrap}
    .wb-tb__title{font-size:1rem;font-weight:600;margin-right:auto}
    .wb-ctl{padding:5px 10px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);font-size:.82rem}
    .wb-body{display:flex;flex:1;min-height:0}
    .wb-cols{display:flex;flex:1;overflow-x:auto;overflow-y:hidden}
    .wb-col{flex:0 0 240px;display:flex;flex-direction:column;border-right:1px solid var(--win11-border);min-height:0}
    .wb-col-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:.8rem;font-weight:600}
    .wb-col-hd__dot{width:8px;height:8px;border-radius:50%}
    .wb-col-hd__cnt{margin-left:auto;font-size:.7rem;opacity:.7}
    .wb-col-body{flex:1;overflow-y:auto;padding:0 10px 12px;display:flex;flex-direction:column;gap:8px}
    .wb-card{border:1px solid var(--win11-border);border-radius:8px;padding:9px 10px;background:var(--win11-surface);cursor:pointer;text-align:left}
    .wb-card:hover{border-color:var(--win11-accent)}
    .wb-card__title{font-size:.82rem;font-weight:600;line-height:1.3;margin-bottom:4px;word-break:break-word}
    .wb-card__meta{font-size:.72rem;color:var(--win11-text-secondary);display:flex;gap:6px;flex-wrap:wrap}
    .wb-chip{font-size:.68rem;padding:1px 6px;border-radius:999px;border:1px solid var(--win11-border)}
    .wb-empty{padding:16px;text-align:center;color:var(--win11-text-tertiary);font-size:.78rem}
    .wb-drawer{width:320px;border-left:1px solid var(--win11-border);padding:14px;overflow-y:auto;flex-shrink:0}
    .wb-drawer h3{margin:0 0 8px;font-size:.95rem}
    .wb-drawer dl{margin:0;display:grid;grid-template-columns:88px 1fr;gap:6px 8px;font-size:.78rem}
    .wb-drawer dt{color:var(--win11-text-tertiary)}
    .wb-unavailable{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:32px;text-align:center;gap:8px}
    .wb-unavailable h2{margin:0;font-size:1.05rem}
    .wb-link{color:var(--win11-accent);font-size:.8rem}
    .wb-proof a{display:block;font-size:.76rem;margin-top:4px}
  `;
  document.head.appendChild(style);
}

export function collectProofLinks(card) {
  const proof = card?.metadata?.proof || card?.proof || [];
  const artifacts = card?.metadata?.artifacts || card?.artifacts || [];
  const rows = [];
  const push = (item) => {
    if (!item) return;
    const url = item.url || item.href || null;
    const label = item.label || item.title || item.id || url;
    if (url) rows.push({ label: String(label), url: String(url) });
  };
  if (Array.isArray(proof)) proof.forEach(push);
  else push(proof);
  if (Array.isArray(artifacts)) artifacts.forEach(push);
  return rows;
}

export function isGatewayUnavailablePayload(payload) {
  return Boolean(payload && payload.available === false && payload.reason === 'gateway-unavailable');
}

export async function loadWorkboardSnapshot(rpc, { boardId = 'default' } = {}) {
  if (!rpc) {
    return createGatewayUnavailableState('no rpc client');
  }
  try {
    const [cardsPayload, statsPayload, boardsPayload, tasksPayload, automationsPayload] = await Promise.all([
      rpc.cards.list({ boardId }),
      rpc.cards.stats({ boardId }),
      rpc.boards.list(),
      rpc.tasks.list(),
      rpc.automations.list(),
    ]);
    if (
      isGatewayUnavailablePayload(cardsPayload)
      || isGatewayUnavailablePayload(statsPayload)
      || isGatewayUnavailablePayload(boardsPayload)
    ) {
      return createGatewayUnavailableState('bridge down');
    }
    const cards = Array.isArray(cardsPayload?.cards) ? cardsPayload.cards : (Array.isArray(cardsPayload) ? cardsPayload : []);
    const boards = Array.isArray(boardsPayload) ? boardsPayload : (boardsPayload?.boards || []);
    const statuses = Array.isArray(cardsPayload?.statuses) && cardsPayload.statuses.length
      ? cardsPayload.statuses
      : WORKBOARD_STATUSES;
    return {
      available: true,
      boardId,
      cards,
      boards,
      statuses,
      stats: statsPayload || {},
      tasks: tasksPayload?.available === false ? [] : (tasksPayload?.tasks || tasksPayload?.jobs || tasksPayload || []),
      automations: automationsPayload?.available === false ? [] : (automationsPayload?.jobs || automationsPayload?.automations || automationsPayload || []),
      columns: groupCardsByStatus(cards, statuses),
    };
  } catch (error) {
    return createGatewayUnavailableState(error?.message || 'bridge down');
  }
}

export async function refreshWorkboardLive(rpc, snapshot, params = {}) {
  if (!rpc?.notifications?.poll) {
    return snapshot;
  }
  const poll = await rpc.notifications.poll(params);
  if (isGatewayUnavailablePayload(poll) || !poll?.events?.length) {
    return snapshot;
  }
  return loadWorkboardSnapshot(rpc, { boardId: snapshot?.boardId || params.boardId || 'default' });
}

export async function renderWorkboardView({ mountNode, gatewayRpc, boardId = 'default' } = {}) {
  if (!mountNode) {
    return () => {};
  }
  ensureNativeRoot(mountNode, 'workboard-view');
  injectCSS();
  mountNode.innerHTML = '';

  const rpc = gatewayRpc || createGatewayRpc();
  let currentBoard = boardId;
  let selectedId = null;
  let snapshot = { available: true, cards: [], boards: [], columns: {}, statuses: WORKBOARD_STATUSES };
  let disposed = false;
  let pollTimer = null;

  const root = document.createElement('div');
  root.className = 'wb';
  mountNode.appendChild(root);

  const renderUnavailable = (state) => {
    root.innerHTML = `
      <div class="wb-unavailable" data-state="gateway-unavailable">
        <h2>Gateway unavailable</h2>
        <p>Workboard bridge is down. This window is read-only and does not invent a fallback origin.</p>
        <p class="wb-empty">${escapeHtml(state?.detail || state?.reason || 'gateway-unavailable')}</p>
        <button type="button" class="wb-ctl" data-action="retry">Retry</button>
      </div>
    `;
    root.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      loadAndRender();
    });
  };

  const renderDrawer = (card) => {
    if (!card) {
      return '<aside class="wb-drawer"><p class="wb-empty">Select a card</p></aside>';
    }
    const age = formatHeartbeatAge(heartbeatAgeMs(card));
    const labels = Array.isArray(card.labels) ? card.labels : [];
    const proofs = collectProofLinks(card);
    const openUrl = controlUiWorkboardUrl({ cardId: card.id, boardId: currentBoard });
    return `
      <aside class="wb-drawer" data-card-id="${escapeHtml(card.id)}">
        <h3>${escapeHtml(card.title || '(untitled)')}</h3>
        <dl>
          <dt>Status</dt><dd>${escapeHtml(card.status || 'unknown')}</dd>
          <dt>Agent</dt><dd>${escapeHtml(card.agentId || '—')}</dd>
          <dt>Priority</dt><dd>${escapeHtml(card.priority || 'normal')}</dd>
          <dt>Heartbeat</dt><dd>${escapeHtml(age)}</dd>
        </dl>
        <div style="margin-top:10px">${labels.map((label) => `<span class="wb-chip">${escapeHtml(label)}</span>`).join(' ')}</div>
        <div class="wb-proof" style="margin-top:12px">
          ${proofs.length ? proofs.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.label)}</a>`).join('') : '<span class="wb-empty">No proof links</span>'}
        </div>
        <p style="margin-top:14px"><a class="wb-link" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener">Open in Workboard</a></p>
      </aside>
    `;
  };

  const renderBoard = () => {
    const boards = snapshot.boards || [];
    const statuses = snapshot.statuses || WORKBOARD_STATUSES;
    const columns = snapshot.columns || groupCardsByStatus(snapshot.cards, statuses);
    const selected = (snapshot.cards || []).find((card) => card.id === selectedId) || null;
    const boardOptions = boards.map((board) => {
      const id = board.id || board;
      const name = board.name || id;
      return `<option value="${escapeHtml(id)}" ${id === currentBoard ? 'selected' : ''}>${escapeHtml(name)}</option>`;
    }).join('');

    root.innerHTML = `
      <div class="wb-tb">
        <div class="wb-tb__title">Workboard</div>
        <label>Board <select class="wb-ctl" data-role="board-filter">${boardOptions || `<option value="${escapeHtml(currentBoard)}">${escapeHtml(currentBoard)}</option>`}</select></label>
        <button type="button" class="wb-ctl" data-action="refresh">↻ Refresh</button>
        <a class="wb-link" href="${escapeHtml(controlUiWorkboardUrl({ boardId: currentBoard }))}" target="_blank" rel="noopener">Open in Workboard</a>
      </div>
      <div class="wb-body">
        <div class="wb-cols">
          ${statuses.map((status) => {
            const meta = STATUS_META[status] || { color: '#94a3b8', label: status };
            const cards = columns[status] || [];
            return `
              <section class="wb-col" data-status="${escapeHtml(status)}">
                <header class="wb-col-hd">
                  <span class="wb-col-hd__dot" style="background:${meta.color}"></span>
                  ${escapeHtml(meta.label || status)}
                  <span class="wb-col-hd__cnt">${cards.length}</span>
                </header>
                <div class="wb-col-body">
                  ${cards.length ? cards.map((card) => `
                    <article class="wb-card" data-card-id="${escapeHtml(card.id)}" role="button" tabindex="0">
                      <div class="wb-card__title">${escapeHtml(card.title || '(untitled)')}</div>
                      <div class="wb-card__meta">
                        <span>${escapeHtml(card.agentId || 'unassigned')}</span>
                        ${(card.labels || []).slice(0, 3).map((label) => `<span class="wb-chip">${escapeHtml(label)}</span>`).join('')}
                      </div>
                    </article>
                  `).join('') : '<div class="wb-empty">Empty</div>'}
                </div>
              </section>
            `;
          }).join('')}
        </div>
        ${renderDrawer(selected)}
      </div>
    `;

    root.querySelector('[data-role="board-filter"]')?.addEventListener('change', (event) => {
      currentBoard = event.target.value || 'default';
      loadAndRender();
    });
    root.querySelector('[data-action="refresh"]')?.addEventListener('click', () => loadAndRender());
    root.querySelectorAll('[data-card-id]').forEach((node) => {
      if (!node.classList.contains('wb-card')) return;
      node.addEventListener('click', () => {
        selectedId = node.getAttribute('data-card-id');
        renderBoard();
      });
    });
  };

  const loadAndRender = async () => {
    snapshot = await loadWorkboardSnapshot(rpc, { boardId: currentBoard });
    if (disposed) return;
    if (isGatewayUnavailablePayload(snapshot)) {
      renderUnavailable(snapshot);
      return;
    }
    renderBoard();
  };

  await loadAndRender();

  const startLive = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (disposed || isGatewayUnavailablePayload(snapshot)) return;
      const next = await refreshWorkboardLive(rpc, snapshot, { boardId: currentBoard });
      if (!disposed && next && next !== snapshot) {
        snapshot = next;
        if (isGatewayUnavailablePayload(snapshot)) renderUnavailable(snapshot);
        else renderBoard();
      }
    }, 15000);
  };
  startLive();

  return () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}

export default renderWorkboardView;
