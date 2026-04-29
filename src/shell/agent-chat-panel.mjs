/**
 * Agent Chat Panel — floating sidebar for dashboard agent interaction.
 *
 * Shows a chat interface with the dashboard-scoped agent.
 * Supports confirmation prompts for write actions.
 */

const CSS = `
  .acp-panel {
    position: fixed; right: 0; top: 48px; bottom: 48px; width: 380px;
    background: var(--win11-surface-solid); border-left: 1px solid var(--win11-border);
    display: flex; flex-direction: column; z-index: 9000;
    box-shadow: -4px 0 16px rgba(0,0,0,.15);
    transform: translateX(100%); transition: transform .2s ease;
    font-size: 0.85rem;
  }
  .acp-panel.open { transform: translateX(0); }
  .acp-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--win11-border);
    flex-shrink: 0;
  }
  .acp-header-title { font-weight: 600; font-size: 0.95rem; }
  .acp-close {
    background: none; border: none; font-size: 1.2rem; cursor: pointer;
    color: var(--win11-text-secondary); padding: 4px 8px; border-radius: 4px;
  }
  .acp-close:hover { background: var(--win11-surface-hover); }
  .acp-messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .acp-msg { max-width: 90%; padding: 8px 12px; border-radius: 8px; line-height: 1.5; word-break: break-word; }
  .acp-msg.user { align-self: flex-end; background: var(--win11-accent); color: #fff; border-bottom-right-radius: 2px; }
  .acp-msg.agent { align-self: flex-start; background: var(--win11-surface-hover); border-bottom-left-radius: 2px; }
  .acp-msg.system { align-self: center; font-size: 0.75rem; color: var(--win11-text-tertiary); background: none; }
  .acp-confirm {
    padding: 10px; background: #f59e0b15; border: 1px solid #f59e0b40;
    border-radius: 8px; align-self: flex-start; max-width: 90%;
  }
  .acp-confirm-label { font-weight: 600; margin-bottom: 6px; color: #f59e0b; }
  .acp-confirm-actions { display: flex; gap: 8px; margin-top: 8px; }
  .acp-confirm-btn {
    padding: 4px 14px; border-radius: 4px; border: 1px solid var(--win11-border);
    cursor: pointer; font-size: 0.8rem;
  }
  .acp-confirm-btn.approve { background: #107c10; color: #fff; border-color: #107c10; }
  .acp-confirm-btn.reject { background: transparent; color: #e74856; border-color: #e74856; }
  .acp-input-row {
    display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--win11-border);
    flex-shrink: 0;
  }
  .acp-input {
    flex: 1; padding: 8px 12px; border: 1px solid var(--win11-border);
    border-radius: 6px; font-size: 0.85rem; background: var(--win11-surface-solid);
    color: var(--win11-text-primary); outline: none;
  }
  .acp-input:focus { border-color: var(--win11-accent); }
  .acp-send {
    padding: 8px 16px; border-radius: 6px; border: none;
    background: var(--win11-accent); color: #fff; cursor: pointer;
    font-size: 0.85rem;
  }
  .acp-send:hover { opacity: .9; }
  .acp-send:disabled { opacity: .5; cursor: not-allowed; }
`;

export class AgentChatPanel {
  constructor({ onSend, onConfirm, onReject }) {
    this.onSend = onSend;
    this.onConfirm = onConfirm;
    this.onReject = onReject;
    this.messages = [];
    this.isOpen = false;

    this.el = document.createElement('div');
    this.el.className = 'acp-panel';
    this.el.innerHTML = `<style>${CSS}</style>
      <div class="acp-header">
        <span class="acp-header-title">🤖 Dashboard Agent</span>
        <button class="acp-close" title="Close">✕</button>
      </div>
      <div class="acp-messages"></div>
      <div class="acp-input-row">
        <input class="acp-input" placeholder="Ask about your dashboard..." />
        <button class="acp-send">Send</button>
      </div>
    `;

    document.body.appendChild(this.el);

    // Wire events
    this.el.querySelector('.acp-close').addEventListener('click', () => this.close());
    this.el.querySelector('.acp-send').addEventListener('click', () => this._send());
    this.el.querySelector('.acp-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
  }

  open() {
    this.isOpen = true;
    this.el.classList.add('open');
    this.el.querySelector('.acp-input')?.focus();
  }

  close() {
    this.isOpen = false;
    this.el.classList.remove('open');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  addMessage(role, content) {
    const msgContainer = this.el.querySelector('.acp-messages');
    const div = document.createElement('div');
    div.className = `acp-msg ${role}`;
    div.textContent = content;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    this.messages.push({ role, content, ts: Date.now() });
  }

  addConfirmation(actionLabel, params, actionId) {
    const msgContainer = this.el.querySelector('.acp-messages');
    const div = document.createElement('div');
    div.className = 'acp-confirm';

    // Safe DOM construction — no innerHTML with untrusted data (#5 XSS fix)
    const label = document.createElement('div');
    label.className = 'acp-confirm-label';
    label.textContent = '⚠️ ' + (actionLabel || 'Action');

    const paramsEl = document.createElement('div');
    paramsEl.style.cssText = 'font-size:0.78rem;color:var(--win11-text-secondary)';
    paramsEl.textContent = JSON.stringify(params, null, 2).slice(0, 200);

    const actions = document.createElement('div');
    actions.className = 'acp-confirm-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'acp-confirm-btn approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => { this.onConfirm?.(actionId); div.remove(); });

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'acp-confirm-btn reject';
    rejectBtn.textContent = 'Cancel';
    rejectBtn.addEventListener('click', () => {
      this.onReject?.(actionId);
      const cancelled = document.createElement('div');
      cancelled.style.cssText = 'color:var(--win11-text-tertiary);font-size:0.78rem;';
      cancelled.textContent = 'Action cancelled';
      div.innerHTML = '';
      div.appendChild(cancelled);
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    div.appendChild(label);
    div.appendChild(paramsEl);
    div.appendChild(actions);
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  setLoading(loading) {
    const btn = this.el.querySelector('.acp-send');
    const input = this.el.querySelector('.acp-input');
    if (btn) btn.disabled = loading;
    if (input) input.disabled = loading;
  }

  /**
   * Update agent config from the active Space settings.
   */
  updateSpaceConfig(agentConfig) {
    this._spaceConfig = agentConfig;
    // Show indicator if custom model or prompt is set
    const indicator = this.el.querySelector('.acp-space-indicator');
    if (agentConfig.defaultModel || agentConfig.systemPrompt) {
      if (!indicator) {
        const badge = document.createElement('div');
        badge.className = 'acp-space-indicator';
        badge.style.cssText = 'font-size:0.7rem;padding:2px 8px;border-radius:8px;background:var(--win11-accent-light);color:var(--win11-accent);margin:4px 8px;';
        badge.textContent = agentConfig.name ? `🤖 ${agentConfig.name}` : '🤖 Space Agent';
        const header = this.el.querySelector('.acp-header');
        header?.appendChild(badge);
      } else {
        indicator.textContent = agentConfig.name ? `🤖 ${agentConfig.name}` : '🤖 Space Agent';
      }
    } else if (indicator) {
      indicator.remove();
    }
  }

  get spaceConfig() { return this._spaceConfig || {}; }

  _send() {
    const input = this.el.querySelector('.acp-input');
    const msg = input?.value?.trim();
    if (!msg) return;
    input.value = '';
    this.addMessage('user', msg);
    this.setLoading(true);
    this.onSend?.(msg).finally(() => this.setLoading(false));
  }
}

export default AgentChatPanel;
