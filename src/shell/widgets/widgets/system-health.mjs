/* ============================================
   System Health Widget
   ============================================ */

const ACTIVE_AGENT_STATES = new Set(['active', 'running', 'online', 'healthy']);

const STATUS_MAP = {
  ok: { tone: 'ok', label: 'Healthy' },
  healthy: { tone: 'ok', label: 'Healthy' },
  degraded: { tone: 'warning', label: 'Degraded' },
  warning: { tone: 'warning', label: 'Warning' },
  error: { tone: 'error', label: 'Offline' },
  failed: { tone: 'error', label: 'Offline' },
  offline: { tone: 'error', label: 'Offline' },
};

export const manifest = {
  id: 'system-health',
  label: 'System Health',
  description: 'Live API and agent status for the desktop shell.',
  icon: `
    <path d="M12 3.5 5 6.5v5.1c0 4 2.6 7.7 7 8.9 4.4-1.2 7-4.9 7-8.9V6.5l-7-3Z"></path>
    <path d="m9.3 12 1.8 1.8 3.8-4.1"></path>
  `,
  size: 'medium',
  dataKeys: ['healthStatus', 'gatewayAgents'],
  refreshInterval: null,
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const resolveStatus = (status) => STATUS_MAP[String(status || 'unknown').toLowerCase()] || {
  tone: 'unknown',
  label: 'Waiting',
};

export function render(ctx) {
  const escape = ctx.helpers?.escapeHtml || ((value) => String(value ?? ''));
  const { healthStatus, gatewayAgents } = ctx.data || {};
  const status = resolveStatus(healthStatus?.status);
  const agents = Array.isArray(gatewayAgents) ? gatewayAgents : [];
  const activeAgents = agents.filter((agent) => ACTIVE_AGENT_STATES.has(String(agent?.status || '').toLowerCase())).length;
  const totalAgents = agents.length;

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-system-health" aria-label="Open health view">
      <div class="widget-card__header">
        <span class="widget-card__dot is-${status.tone}"></span>
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered">
        <span class="widget-card__status is-${status.tone}">${escape(status.label)}</span>
        <span class="widget-card__meta widget-system-health__agents">
          ${totalAgents > 0 ? `${escape(activeAgents)} / ${escape(totalAgents)} agents active` : 'Waiting for agent status'}
        </span>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('health');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
