import { deriveQueueMetrics, formatCount, getEscape } from './widget-utils.mjs';

export const manifest = {
  id: 'queue-monitor',
  label: 'Queue Monitor',
  description: 'Task distribution across ready, active, blocked, and done states.',
  icon: `
    <path d="M4.5 7.5h15"></path>
    <path d="M4.5 12h9"></path>
    <path d="M4.5 16.5h6"></path>
    <path d="M17.5 6v12"></path>
  `,
  size: 'medium',
  dataKeys: ['stats'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const SEGMENTS = [
  { key: 'ready', label: 'Ready', className: 'widget-queue-monitor__segment--ready' },
  { key: 'active', label: 'Active', className: 'widget-queue-monitor__segment--active' },
  { key: 'blocked', label: 'Blocked', className: 'widget-queue-monitor__segment--blocked' },
  { key: 'done', label: 'Done', className: 'widget-queue-monitor__segment--done' },
];

export async function render(ctx) {
  const escape = getEscape(ctx);
  const stats = ctx.data?.stats || {};
  let orgSummary = null;

  if (typeof ctx.api?.org?.summary === 'function') {
    try {
      orgSummary = await ctx.api.org.summary();
    } catch (_) {
      orgSummary = null;
    }
  }

  const queue = deriveQueueMetrics({ stats, orgSummary });
  const total = Math.max(0, queue.total);
  const hasData = total > 0 || SEGMENTS.some((segment) => queue[segment.key] > 0);

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-queue-monitor" aria-label="Open tasks view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-queue-monitor__body">
        <div class="widget-queue-monitor__bar" role="img" aria-label="Task distribution">
          ${hasData
            ? SEGMENTS.map((segment) => {
                const count = Math.max(0, queue[segment.key] || 0);
                return count > 0
                  ? `<span class="widget-queue-monitor__segment ${segment.className}" style="flex:${count} 1 0%"></span>`
                  : '';
              }).join('')
            : '<span class="widget-queue-monitor__segment widget-queue-monitor__segment--empty"></span>'}
        </div>
        <div class="widget-queue-monitor__legend">
          ${SEGMENTS.map((segment) => `
            <div class="widget-queue-monitor__legend-item">
              <span class="widget-queue-monitor__legend-label">
                <span class="widget-queue-monitor__legend-dot ${segment.className}"></span>
                <span>${escape(segment.label)}</span>
              </span>
              <span>${escape(formatCount(queue[segment.key]))}</span>
            </div>
          `).join('')}
        </div>
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
