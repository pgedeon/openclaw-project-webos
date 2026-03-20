import { formatCount, getArray, getEscape } from './widget-utils.mjs';

export const manifest = {
  id: 'approval-queue',
  label: 'Approvals',
  description: 'Pending approval requests waiting for review.',
  icon: `
    <rect x="5" y="4.5" width="14" height="15" rx="2"></rect>
    <path d="M8.5 9.5h7"></path>
    <path d="M8.5 13h4.5"></path>
  `,
  size: 'small',
  dataKeys: ['approvalsPending'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const approvals = getArray(ctx.data?.approvalsPending, 'approvals');
  const count = approvals.length;

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-approval-queue" aria-label="Open approvals view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered widget-approval-queue__body">
        <span class="widget-approval-queue__badge ${count > 0 ? 'is-pending' : 'is-empty'}">
          <span class="widget-approval-queue__count">${escape(formatCount(count))}</span>
        </span>
        <span class="widget-card__meta">${escape(count > 0 ? 'Awaiting review' : 'Queue is clear')}</span>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('approvals');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
