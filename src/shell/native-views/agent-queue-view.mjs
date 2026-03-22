import AgentView from '../../agent-view.mjs';
import { ensureNativeRoot } from './helpers.mjs';

export async function renderAgentQueueView({ mountNode, adapter }) {
  ensureNativeRoot(mountNode, 'agent-queue-view');
  mountNode.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'native-view-root';
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;';
  mountNode.appendChild(root);

  try {
    const agentView = new AgentView(root, {
      showNotice: adapter?.showNotice || (() => {}),
      refreshInterval: 30000,
    });

    await agentView.load();
    return () => agentView.destroy();
  } catch (err) {
    console.error('[AgentQueueView]', err);
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--win11-text-secondary);padding:24px;text-align:center;">
        <div>
          <div style="font-size:2rem;margin-bottom:12px;">📋</div>
          <h3 style="margin:0 0 8px;color:var(--win11-text);">Agent Queue</h3>
          <p style="margin:0;font-size:0.85rem;max-width:320px;">
            The agent queue view failed to load.
            <br><span style="color:var(--win11-text-tertiary);font-size:0.8rem;">${err.message}</span>
          </p>
        </div>
      </div>
    `;
    return () => {};
  }
}

export default renderAgentQueueView;
