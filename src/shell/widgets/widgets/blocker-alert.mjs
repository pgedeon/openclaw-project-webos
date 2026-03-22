import { formatCount, getEscape, toNumber } from './widget-utils.mjs';

export const manifest = {
  id: 'blocker-alert',
  label: 'Blockers',
  description: 'High-visibility alert for current blockers.',
  icon: `
    <path d="M12 4.5 19 18H5l7-13.5Z"></path>
    <path d="M12 9.5v4"></path>
    <circle cx="12" cy="15.8" r=".8" fill="currentColor" stroke="none"></circle>
  `,
  size: 'small',
  dataKeys: ['blockersSummary'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const count = Math.max(0, toNumber(ctx.data?.blockersSummary?.total));
  const hasBlockers = count > 0;

  ctx.mountNode.innerHTML = `
    <style>
      @keyframes widget-blocker-alert-pulse {
        0% { transform: scale(1); opacity: 1; }
        70% { transform: scale(1.45); opacity: 0.35; }
        100% { transform: scale(1); opacity: 1; }
      }
    </style>
    <button type="button" class="widget-card widget-card--interactive widget-blocker-alert" aria-label="Open tasks view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered widget-blocker-alert__body">
        <span class="widget-blocker-alert__dot ${hasBlockers ? 'is-alert' : 'is-clear'}"></span>
        <span class="widget-blocker-alert__count ${hasBlockers ? 'is-alert' : 'is-clear'}">${escape(formatCount(count))}</span>
        <span class="widget-card__meta">${escape(hasBlockers ? 'Needs attention' : 'All clear')}</span>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('tasks');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
