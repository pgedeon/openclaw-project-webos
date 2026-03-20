import { formatCount, getArray, getEscape } from './widget-utils.mjs';

export const manifest = {
  id: 'workflow-pulse',
  label: 'Workflow Pulse',
  description: 'Shows how many workflow runs are actively moving.',
  icon: `
    <path d="M7 7h7.5a4.5 4.5 0 1 1 0 9H8"></path>
    <path d="m7 7 2.5-2.5"></path>
    <path d="M7 7 9.5 9.5"></path>
  `,
  size: 'small',
  dataKeys: ['activeWorkflowRuns'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const runs = getArray(ctx.data?.activeWorkflowRuns, 'runs');
  const count = runs.length;

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-workflow-pulse" aria-label="Open workflows view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered widget-workflow-pulse__body">
        <span class="widget-workflow-pulse__spinner ${count > 0 ? 'is-spinning' : ''}" aria-hidden="true"></span>
        <span class="widget-workflow-pulse__count">${escape(formatCount(count))}</span>
        <span class="widget-card__meta">${escape(count > 0 ? 'Active runs' : 'No active runs')}</span>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('workflows');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
