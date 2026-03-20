import {
  clamp,
  getEscape,
  readStorageJson,
  toNumber,
  writeStorageJson,
} from './widget-utils.mjs';

const STORAGE_KEY = 'openclaw.win11.widget.sparkline.v1';
const MAX_POINTS = 20;

export const manifest = {
  id: 'mini-sparkline',
  label: 'Mini Sparkline',
  description: 'Tiny trendline of completion ratio snapshots stored locally.',
  icon: `
    <path d="M5 16.5 9 12.5l3 2.5 6-7"></path>
    <path d="M18 8v4h-4"></path>
  `,
  size: 'small',
  dataKeys: ['stats'],
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const sanitizePoints = (points = []) => points
  .map((value) => clamp(toNumber(value, 0), 0, 1))
  .filter((value) => Number.isFinite(value));

const buildPolylinePoints = (values = []) => {
  if (values.length === 0) {
    return '0,30 100,30';
  }

  return values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 28 - (value * 24);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const stats = ctx.data?.stats || {};
  const totalTasks = Math.max(0, toNumber(stats.tasks || stats.total_tasks || stats.task_count));
  const completedTasks = Math.max(0, toNumber(
    stats.completed_tasks
      || stats.completed
      || stats.tasks_completed
      || stats.done,
  ));
  const currentRatio = totalTasks > 0 ? clamp(completedTasks / totalTasks, 0, 1) : 0;
  const existingPoints = sanitizePoints(readStorageJson(STORAGE_KEY, []));
  const points = sanitizePoints([...existingPoints, currentRatio]).slice(-MAX_POINTS);
  const polylinePoints = buildPolylinePoints(points);
  const polygonPoints = `0,30 ${polylinePoints} 100,30`;

  writeStorageJson(STORAGE_KEY, points);

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-mini-sparkline" aria-label="Mini sparkline widget">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-mini-sparkline__body">
        <div class="widget-mini-sparkline__chart">
          <svg class="widget-mini-sparkline__svg" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
            <polygon class="widget-mini-sparkline__fill" points="${polygonPoints}"></polygon>
            <polyline class="widget-mini-sparkline__line" points="${polylinePoints}" fill="none"></polyline>
          </svg>
        </div>
        <span class="widget-card__meta">${escape(`${Math.round(currentRatio * 100)}% latest`)}</span>
      </div>
    </div>
  `;

  return () => {
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
