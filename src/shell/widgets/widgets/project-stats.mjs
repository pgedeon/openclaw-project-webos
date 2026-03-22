import { deriveQueueMetrics, formatCount, getEscape } from './widget-utils.mjs';

export const manifest = {
  id: 'project-stats',
  label: 'Project Stats',
  description: 'Compact dashboard counts for projects, agents, tasks, and completed work.',
  icon: `
    <path d="M5 17.5V9.5"></path>
    <path d="M12 17.5V6.5"></path>
    <path d="M19 17.5V12"></path>
  `,
  size: 'wide',
  dataKeys: ['stats', 'orgSummary'],
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const stats = ctx.data?.stats || {};
  const orgSummary = ctx.data?.orgSummary || {};
  const queue = deriveQueueMetrics({ stats, orgSummary });
  const items = [
    { label: 'Projects', value: formatCount(stats.projects) },
    { label: 'Agents', value: formatCount(orgSummary.totalAgents || orgSummary.liveSummary?.totalAgents) },
    { label: 'Tasks', value: formatCount(stats.tasks || stats.total_tasks || stats.task_count) },
    { label: 'Completed', value: formatCount(queue.done) },
  ];

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-project-stats" aria-label="Project statistics">
      <div class="widget-project-stats__grid">
        ${items.map((item) => `
          <div class="widget-project-stats__item">
            <span class="widget-project-stats__label">${escape(item.label)}</span>
            <span class="widget-project-stats__value">${escape(item.value)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return () => {
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
