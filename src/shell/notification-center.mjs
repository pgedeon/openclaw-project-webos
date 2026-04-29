/**
 * Notification Center — slide-in panel for blockers, approvals, workflow events.
 *
 * Appears when the taskbar bell icon is clicked.
 * Auto-updates via SSE push events.
 */

const CSS = `
  .nc-panel {
    position: fixed; right: 0; top: 48px; bottom: 48px; width: 380px;
    background: var(--win11-surface-solid); border-left: 1px solid var(--win11-border);
    display: flex; flex-direction: column; z-index: 9000;
    box-shadow: -4px 0 16px rgba(0,0,0,.15);
    transform: translateX(100%); transition: transform .2s ease;
    font-size: 0.85rem;
  }
  .nc-panel.open { transform: translateX(0); }
  .nc-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--win11-border);
    flex-shrink: 0;
  }
  .nc-header-title { font-weight: 600; font-size: 0.95rem; }
  .nc-tabs { display: flex; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .nc-tab {
    flex: 1; padding: 8px; text-align: center; cursor: pointer;
    font-size: 0.8rem; color: var(--win11-text-secondary);
    border-bottom: 2px solid transparent; transition: all .15s;
    position: relative;
  }
  .nc-tab.active { color: var(--win11-accent); border-bottom-color: var(--win11-accent); }
  .nc-tab:hover { background: var(--win11-surface-hover); }
  .nc-tab .badge {
    position: absolute; top: 4px; right: 12px;
    background: #e74856; color: #fff; font-size: 0.65rem;
    padding: 1px 5px; border-radius: 8px; min-width: 16px;
  }
  .nc-list { flex: 1; overflow-y: auto; padding: 8px; }
  .nc-item {
    padding: 10px 12px; border-radius: 6px; margin-bottom: 4px;
    border: 1px solid var(--win11-border); cursor: pointer; transition: background .1s;
  }
  .nc-item:hover { background: var(--win11-surface-hover); }
  .nc-item.unread { border-left: 3px solid var(--win11-accent); }
  .nc-item-title { font-weight: 600; font-size: 0.82rem; margin-bottom: 2px; }
  .nc-item-desc { font-size: 0.75rem; color: var(--win11-text-secondary); }
  .nc-item-time { font-size: 0.7rem; color: var(--win11-text-tertiary); margin-top: 4px; }
  .nc-item-tag {
    display: inline-block; font-size: 0.65rem; padding: 1px 6px;
    border-radius: 3px; margin-right: 4px;
  }
  .nc-tag-blocker { background: #e7485620; color: #e74856; }
  .nc-tag-approval { background: #f59e0b20; color: #f59e0b; }
  .nc-tag-workflow { background: #0078d420; color: #0078d4; }
  .nc-tag-system { background: #107c1020; color: #107c10; }
  .nc-empty { text-align: center; padding: 40px 20px; color: var(--win11-text-tertiary); }
  .nc-clear {
    background: none; border: none; font-size: 0.78rem; color: var(--win11-text-secondary);
    cursor: pointer; padding: 4px 8px;
  }
  .nc-clear:hover { color: var(--win11-accent); }
`;

export class NotificationCenter {
  constructor() {
    this.isOpen = false;
    this.activeTab = 'all';
    this.notifications = [];
    this.unreadCount = 0;
    this._navigateToView = null; // Set by shell-main.mjs (P3)

    this.el = document.createElement('div');
    this.el.className = 'nc-panel';
    document.body.appendChild(this.el);

    this.render();
  }

  /** Set the navigation callback (called from shell-main.mjs) */
  setNavigator(fn) { this._navigateToView = fn; }

  open() {
    this.isOpen = true;
    this.el.classList.add('open');
    this.markRead();
  }

  close() {
    this.isOpen = false;
    this.el.classList.remove('open');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  /**
   * Add a notification
   */
  push(notification) {
    const entry = {
      id: notification.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: notification.type || 'system', // blocker, approval, workflow, system
      title: notification.title || 'Notification',
      description: notification.description || '',
      timestamp: notification.timestamp || new Date().toISOString(),
      read: false,
      data: notification.data || {},
    };
    this.notifications.unshift(entry);
    this.unreadCount++;
    this.render();
    return entry;
  }

  /**
   * Push an SSE event as a notification
   */
  pushSSE(event) {
    const typeMap = {
      'task:blocked': 'blocker',
      'approval:pending': 'approval',
      'workflow:status': 'workflow',
      'task:changed': 'system',
      'space:changed': 'system',
    };
    const type = typeMap[event.type] || 'system';
    const d = typeof event.data === 'object' ? (event.data || {}) : {};
    // Better titles (P3)
    const titleMap = {
      'task:blocked': () => `Task blocked: ${d.title || d.task_title || d.task_id?.substring(0,8) || 'Unknown'}`,
      'approval:pending': () => `Approval needed: ${d.title || d.action || d.task_title || 'Action required'}`,
      'workflow:status': () => `Workflow ${d.status || 'update'}: ${d.name || d.run_id?.substring(0,8) || 'Run'}`,
      'task:changed': () => `Task updated: ${d.title || d.task_title || d.name || 'Task'}`,
      'space:changed': () => `Space changed: ${d.name || d.space?.name || 'Workspace'}`,
    };
    const title = (titleMap[event.type] || (() => event.type))();
    const desc = d.description || d.message || (typeof event.data === 'string' ? event.data.slice(0, 120) : '');
    return this.push({ type, title, description: desc, data: d });
  }

  markRead() {
    this.notifications.forEach(n => n.read = true);
    this.unreadCount = 0;
    this.render();
  }

  clearAll() {
    this.notifications = [];
    this.unreadCount = 0;
    this.render();
  }

  getFiltered() {
    if (this.activeTab === 'all') return this.notifications;
    return this.notifications.filter(n => n.type === this.activeTab);
  }

  getCounts() {
    const counts = { all: this.notifications.length, blocker: 0, approval: 0, workflow: 0, system: 0 };
    this.notifications.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });
    return counts;
  }

  render() {
    const counts = this.getCounts();
    const filtered = this.getFiltered();

    this.el.innerHTML = `<style>${CSS}</style>
      <div class="nc-header">
        <span class="nc-header-title">🔔 Notifications</span>
        <button class="nc-clear" id="nc-clear">Clear all</button>
      </div>
      <div class="nc-tabs">
        <div class="nc-tab ${this.activeTab === 'all' ? 'active' : ''}" data-tab="all">
          All${counts.all ? ` (${counts.all})` : ''}
        </div>
        <div class="nc-tab ${this.activeTab === 'blocker' ? 'active' : ''}" data-tab="blocker">
          Blockers${counts.blocker ? `<span class="badge">${counts.blocker}</span>` : ''}
        </div>
        <div class="nc-tab ${this.activeTab === 'approval' ? 'active' : ''}" data-tab="approval">
          Approvals${counts.approval ? `<span class="badge">${counts.approval}</span>` : ''}
        </div>
        <div class="nc-tab ${this.activeTab === 'workflow' ? 'active' : ''}" data-tab="workflow">
          Workflows
        </div>
      </div>
      <div class="nc-list">
        ${filtered.length === 0 ? '<div class="nc-empty">No notifications</div>' : ''}
        ${filtered.map(n => `
          <div class="nc-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
            <div class="nc-item-title">
              <span class="nc-item-tag nc-tag-${n.type}">${n.type}</span>
              ${esc(n.title)}
            </div>
            <div class="nc-item-desc">${esc(n.description)}</div>
            <div class="nc-item-time">${formatTime(n.timestamp)}</div>
          </div>
        `).join('')}
      </div>
    `;

    // Wire events
    this.el.querySelectorAll('.nc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.render();
      });
    });
    this.el.querySelector('#nc-clear')?.addEventListener('click', () => this.clearAll());

    // Click handler for notification items — navigate to entity (P3)
    this.el.querySelectorAll('.nc-item').forEach(item => {
      item.addEventListener('click', () => {
        const n = this.notifications.find(x => x.id === item.dataset.id);
        if (!n) return;
        this._handleClick(n);
      });
    });
  }

  /** Navigate to the entity referenced by a notification (P3) */
  _handleClick(notification) {
    const nav = this._navigateToView;
    if (!nav) return;

    const data = notification.data || {};
    const type = notification.type;

    // Route based on notification type and available data
    if (data.task_id || data.taskId) {
      nav('tasks', { params: { taskId: data.task_id || data.taskId } });
    } else if (data.agent_name || data.agentName || data.agent_id) {
      nav('agents', { params: { agentName: data.agent_name || data.agentName || data.agent_id } });
    } else if (data.run_id || data.runId) {
      nav('workflows', { params: { runId: data.run_id || data.runId } });
    } else if (data.project_id || data.projectId) {
      nav('board', { params: { projectId: data.project_id || data.projectId } });
    } else if (type === 'approval' && data.approval_id) {
      nav('operations', { params: { tab: 'approvals' } });
    } else if (type === 'blocker') {
      nav('operations', { params: { tab: 'health' } });
    }

    this.close();
  }
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch { return iso; }
}

export default NotificationCenter;
