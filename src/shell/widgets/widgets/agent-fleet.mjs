import {
  classifyAgentStatus,
  formatCount,
  getEscape,
  isOnlineAgentStatus,
} from './widget-utils.mjs';

export const manifest = {
  id: 'agent-fleet',
  label: 'Agent Fleet',
  description: 'Live overview of agent availability across the gateway fleet.',
  icon: `
    <circle cx="7.5" cy="10" r="2.5"></circle>
    <circle cx="16.5" cy="10" r="2.5"></circle>
    <path d="M4.5 18c.6-2.1 2.1-3.5 4-3.5s3.4 1.4 4 3.5"></path>
    <path d="M11.5 18c.4-1.6 1.6-2.7 3.2-2.7 1.6 0 2.8 1.1 3.3 2.7"></path>
  `,
  size: 'medium',
  dataKeys: ['gatewayAgents'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const MAX_VISIBLE_DOTS = 12;

export function render(ctx) {
  const escape = getEscape(ctx);
  const agents = Array.isArray(ctx.data?.gatewayAgents) ? ctx.data.gatewayAgents : [];
  const onlineCount = agents.filter((agent) => isOnlineAgentStatus(agent?.status)).length;
  const overflow = Math.max(0, agents.length - MAX_VISIBLE_DOTS);
  const visibleAgents = agents.slice(0, MAX_VISIBLE_DOTS);

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-agent-fleet" aria-label="Open agents view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-agent-fleet__body">
        <div class="widget-agent-fleet__summary">
          <span class="widget-agent-fleet__count">${escape(formatCount(onlineCount))}/${escape(formatCount(agents.length))}</span>
          <span class="widget-card__meta">${escape('online')}</span>
        </div>
        <div class="widget-agent-fleet__grid">
          ${visibleAgents.map((agent) => {
            const tone = classifyAgentStatus(agent?.status);
            const label = `${agent?.name || agent?.id || 'Agent'} — ${agent?.status || 'offline'}`;
            return `<span class="widget-agent-fleet__dot is-${tone}" title="${escape(label)}" aria-label="${escape(label)}"></span>`;
          }).join('')}
          ${overflow > 0 ? `<span class="widget-agent-fleet__overflow">+${escape(formatCount(overflow))}</span>` : ''}
        </div>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('agents');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
