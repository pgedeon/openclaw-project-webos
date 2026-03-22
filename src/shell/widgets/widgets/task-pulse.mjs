/* ============================================
   Task Pulse Widget
   ============================================ */

export const manifest = {
  id: 'task-pulse',
  label: 'Task Pulse',
  description: 'Quick view of task completion progress.',
  icon: `
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5"></path>
    <path d="M12 3.5v8.5l6 3"></path>
  `,
  size: 'small',
  dataKeys: ['stats'],
  refreshInterval: null,
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function render(ctx) {
  const escape = ctx.helpers?.escapeHtml || ((value) => String(value ?? ''));
  const stats = ctx.data?.stats || {};
  const totalTasks = Math.max(0, toNumber(stats.tasks || stats.total_tasks || stats.task_count));
  const completedTasks = clamp(
    Math.max(0, toNumber(stats.completed_tasks || stats.completed || stats.tasks_completed)),
    0,
    totalTasks || Number.MAX_SAFE_INTEGER,
  );
  const completionRatio = totalTasks > 0 ? completedTasks / totalTasks : 0;
  const progressDegrees = Math.round(completionRatio * 360);
  const completionPercent = Math.round(completionRatio * 100);

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-task-pulse" aria-label="Open tasks view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered">
        <div class="widget-task-pulse__ring" style="background:conic-gradient(var(--win11-accent) ${progressDegrees}deg, var(--win11-widget-ring-track) ${progressDegrees}deg 360deg);">
          <div class="widget-task-pulse__ring-center">
            <span class="widget-task-pulse__count">${escape(completedTasks.toLocaleString())}</span>
          </div>
        </div>
        <span class="widget-card__meta">${totalTasks > 0 ? `${escape(completionPercent)}% complete` : 'Waiting for task data'}</span>
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
