/**
 * Recent-actions tray — one-click actions slice 2 (docs/briefs/one-click-actions.md §3.4).
 *
 * Shell-chrome popover (taskbar sibling of the notification center — NOT a
 * windowed app; the app-registry count stays frozen). Lists the last 10
 * receipts newest-first from GET /api/actions/recent, polled on tray open
 * ONLY (slice 1 ships no `action-update` SSE topic; slice 3 adds live
 * fan-out). Executions made through action-client.mjs ingest into the open
 * tray immediately via the shared receipt store.
 *
 * Per receipt: outcome icon, kind label, target short id, relative time,
 * rollback hint on expand. Click navigates to the owning view when a target
 * route exists (run → workflows ?runId=, task → tasks ?taskId=, approval →
 * approvals). Degradation: available:false → named empty state.
 */

import { loadRecentReceipts, subscribeReceipts } from './action-client.mjs';

const TRAY_LIMIT = 10;

const CSS = `
  .rat-panel {
    position: fixed; right: 0; top: 48px; bottom: 48px; width: 340px;
    background: var(--win11-surface-solid); border-left: 1px solid var(--win11-border);
    display: flex; flex-direction: column; z-index: 9000;
    box-shadow: -4px 0 16px rgba(0,0,0,.15);
    transform: translateX(100%); transition: transform .2s ease;
    font-size: 0.85rem;
  }
  .rat-panel.open { transform: translateX(0); }
  .rat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0;
  }
  .rat-title { font-weight: 600; font-size: 0.95rem; }
  .rat-refresh {
    background: none; border: none; color: var(--win11-text-secondary);
    cursor: pointer; font-size: 0.85rem; padding: 4px 8px;
  }
  .rat-refresh:hover { color: var(--win11-accent); }
  .rat-list { flex: 1; overflow-y: auto; padding: 8px; }
  .rat-item {
    padding: 9px 12px; border-radius: 6px; margin-bottom: 4px;
    border: 1px solid var(--win11-border); cursor: pointer; transition: background .1s;
  }
  .rat-item:hover { background: var(--win11-surface-hover); }
  .rat-item-row { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .rat-icon { flex-shrink: 0; font-size: 0.8rem; }
  .rat-kind { font-weight: 600; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rat-time { margin-left: auto; font-size: 0.68rem; color: var(--win11-text-tertiary); white-space: nowrap; }
  .rat-target { font-size: 0.72rem; color: var(--win11-text-secondary); margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rat-detail {
    margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--win11-border);
    font-size: 0.73rem; color: var(--win11-text-secondary); white-space: pre-wrap;
  }
  .rat-outcome--executed .rat-icon { color: #22c55e; }
  .rat-outcome--duplicate .rat-icon { color: var(--win11-text-tertiary); }
  .rat-outcome--blocked_budget .rat-icon { color: #f59e0b; }
  .rat-outcome--rejected_governance .rat-icon,
  .rat-outcome--failed .rat-icon { color: #ef4444; }
  .rat-empty { text-align: center; padding: 40px 20px; color: var(--win11-text-tertiary); }
`;

const OUTCOME_ICONS = {
  executed: '✓',
  duplicate: '⟲',
  blocked_budget: '⛔',
  rejected_governance: '🚫',
  failed: '✕',
};

const KIND_LABELS = {
  'task.assign': 'Assign task',
  'run.dispatch': 'Dispatch run',
  'approval.decide': 'Decide approval',
  'run.cancel': 'Cancel run',
  'run.redispatch': 'Re-dispatch run',
};

function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTime(iso) {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!Number.isFinite(diff)) return '';
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ''; }
}

/** Receipt → navigation target ({view, params} | null). */
export function navigateTargetFor(receipt) {
  if (!receipt) return null;
  switch (receipt.kind) {
    case 'task.assign':
    case 'run.dispatch':
      return { view: 'tasks', params: { taskId: receipt.target_id } };
    case 'run.cancel':
    case 'run.redispatch':
      return { view: 'workflows', params: { runId: receipt.target_id } };
    case 'approval.decide':
      return { view: 'approvals', params: {} };
    default:
      return null;
  }
}

export class RecentActionsTray {
  constructor({ api = null, navigateToView = null } = {}) {
    this.api = api;
    this.isOpen = false;
    this.receipts = [];
    this.available = null;
    this.reason = null;
    this.expandedId = null;
    this._navigate = navigateToView;
    this._unsubscribe = subscribeReceipts((receipt) => this.ingest(receipt));

    this.el = document.createElement('div');
    this.el.className = 'rat-panel';
    document.body.appendChild(this.el);
    this.render();
  }

  async open() {
    this.isOpen = true;
    this.el.classList.add('open');
    await this.refresh();
  }

  close() {
    this.isOpen = false;
    this.el.classList.remove('open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else void this.open();
  }

  /** Poll /recent — on tray open only (no action-update SSE topic until slice 3). */
  async refresh() {
    const res = await loadRecentReceipts(this.api, TRAY_LIMIT);
    this.available = res.available;
    this.reason = res.reason;
    // Server list wins for fetchable history; in-memory receipts not yet
    // flushed by a poll are preserved on top (newest first).
    const known = new Set(res.receipts.map((r) => r.action_id));
    const pending = this.receipts.filter((r) => !known.has(r.action_id));
    this.receipts = [...pending, ...res.receipts].slice(0, TRAY_LIMIT);
    this.render();
  }

  /** Live ingest from action-client executions while the tray is open/closed. */
  ingest(receipt) {
    if (!receipt || this.receipts.some((r) => r.action_id === receipt.action_id)) return;
    this.receipts = [receipt, ...this.receipts].slice(0, TRAY_LIMIT);
    if (this.isOpen) this.render();
  }

  render() {
    let items = '';
    if (this.available === false) {
      const why = this.reason === 'receipts_unavailable'
        ? 'Actions unavailable — receipts table missing (migration 024 unapplied).'
        : this.reason === 'query_failed'
          ? 'Actions unavailable — query failed.'
          : 'Actions unavailable — no database.';
      items = `<div class="rat-empty">${esc(why)}</div>`;
    } else if (!this.receipts.length) {
      items = '<div class="rat-empty">No actions yet.<br>Gated buttons across Tasks, Agent Queue, Approvals and Workflows record their receipts here.</div>';
    } else {
      items = this.receipts.map((r) => {
        const outcome = r.outcome || 'executed';
        const icon = OUTCOME_ICONS[outcome] || '•';
        const label = KIND_LABELS[r.kind] || r.kind;
        const expanded = this.expandedId === r.action_id;
        const detailBits = [];
        if (r.rollback_hint) detailBits.push(`Recovery: ${r.rollback_hint}`);
        const errText = r.detail?.error || r.detail?.reason;
        if (errText) detailBits.push(String(errText));
        const newRun = r.detail?.result?.new_run_id;
        if (newRun) detailBits.push(`New run: ${String(newRun).slice(0, 8)}`);
        return `
          <div class="rat-item rat-outcome--${esc(outcome)}" data-action-id="${esc(r.action_id)}">
            <div class="rat-item-row">
              <span class="rat-icon">${icon}</span>
              <span class="rat-kind">${esc(label)}${outcome !== 'executed' ? ` · ${esc(outcome)}` : ''}</span>
              <span class="rat-time">${esc(formatTime(r.created_at))}</span>
            </div>
            <div class="rat-target" title="${esc(r.target_id)}">${esc(r.kind)} → ${esc(String(r.target_id).slice(0, 14))}${String(r.target_id).length > 14 ? '…' : ''}</div>
            ${expanded && detailBits.length ? `<div class="rat-detail">${esc(detailBits.join('\n'))}</div>` : ''}
          </div>`;
      }).join('');
    }

    this.el.innerHTML = `<style>${CSS}</style>
      <div class="rat-header">
        <span class="rat-title">⚡ Recent actions</span>
        <button type="button" class="rat-refresh" data-role="rat-refresh" aria-label="Refresh recent actions">↻ Refresh</button>
      </div>
      <div class="rat-list">${items}</div>`;

    this.el.querySelector('[data-role="rat-refresh"]')?.addEventListener('click', () => void this.refresh());
    this.el.querySelectorAll('.rat-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = item.dataset.actionId;
        if (this.expandedId === id) {
          this.expandedId = null;
          this.render();
          return;
        }
        this.expandedId = id;
        this.render();
        const receipt = this.receipts.find((r) => r.action_id === id);
        const target = navigateTargetFor(receipt);
        if (target && typeof this._navigate === 'function') {
          this._navigate(target.view, { params: target.params });
          this.close();
        }
      });
    });
  }

  destroy() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    this.el.remove();
  }
}

export default RecentActionsTray;
