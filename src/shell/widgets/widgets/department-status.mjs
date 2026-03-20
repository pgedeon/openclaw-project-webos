import { formatCount, getEscape, toNumber } from './widget-utils.mjs';

export const manifest = {
  id: 'department-status',
  label: 'Departments',
  description: 'Compact health snapshot for department activity and blockers.',
  icon: `
    <path d="M5.5 19V7.5h13V19"></path>
    <path d="M9 19v-4.5h6V19"></path>
    <path d="M8.5 10.5h1"></path>
    <path d="M11.5 10.5h1"></path>
    <path d="M14.5 10.5h1"></path>
  `,
  size: 'medium',
  dataKeys: ['orgSummary'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const MAX_VISIBLE_DEPARTMENTS = 6;

const resolveDepartmentTone = (department = {}) => {
  const agentCount = Math.max(0, toNumber(department.agentCount));
  const onlineCount = Math.max(0, toNumber(department.onlineCount));
  const blockedTasks = Math.max(0, toNumber(department.blockedTasks));
  const workingCount = Math.max(0, toNumber(department.workingCount));
  const readyTasks = Math.max(0, toNumber(department.readyTasks));

  if (agentCount === 0) {
    return 'unknown';
  }
  if (onlineCount === 0) {
    return 'error';
  }
  if (blockedTasks > 0) {
    return 'warning';
  }
  if (workingCount > 0 || readyTasks > 0) {
    return 'ok';
  }
  return 'unknown';
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const departments = Array.isArray(ctx.data?.orgSummary?.departments) ? ctx.data.orgSummary.departments : [];
  const visibleDepartments = departments.slice(0, MAX_VISIBLE_DEPARTMENTS);
  const overflow = Math.max(0, departments.length - visibleDepartments.length);

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-department-status" aria-label="Open departments view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-department-status__body">
        <div class="widget-department-status__list">
          ${visibleDepartments.map((department) => {
            const tone = resolveDepartmentTone(department);
            return `
              <div class="widget-department-status__row">
                <span class="widget-department-status__name">${escape(department.name || department.slug || 'Department')}</span>
                <span class="widget-card__dot is-${tone}"></span>
              </div>
            `;
          }).join('')}
          ${overflow > 0 ? `<div class="widget-department-status__overflow">+${escape(formatCount(overflow))} more</div>` : ''}
          ${visibleDepartments.length === 0 ? `<div class="widget-department-status__empty">${escape('No departments')}</div>` : ''}
        </div>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('departments');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
