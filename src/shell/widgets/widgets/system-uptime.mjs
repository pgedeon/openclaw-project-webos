import { formatDaysHoursMinutes, getEscape } from './widget-utils.mjs';

const PAGE_LOAD_AT = typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
  ? performance.timeOrigin
  : Date.now();

export const manifest = {
  id: 'system-uptime',
  label: 'Uptime',
  description: 'Time elapsed since the desktop shell page loaded.',
  icon: `
    <path d="M12 5v7l4 2"></path>
    <circle cx="12" cy="12" r="8"></circle>
  `,
  size: 'small',
  dataKeys: [],
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

export function render(ctx) {
  const escape = getEscape(ctx);

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-system-uptime" aria-label="System uptime widget">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered">
        <span class="widget-system-uptime__value" data-role="uptime-value"></span>
      </div>
    </div>
  `;

  const valueEl = ctx.mountNode.querySelector('[data-role="uptime-value"]');
  const paint = () => {
    if (valueEl) {
      valueEl.textContent = formatDaysHoursMinutes(Date.now() - PAGE_LOAD_AT);
    }
  };

  paint();
  const intervalId = window.setInterval(paint, 30000);

  return () => {
    window.clearInterval(intervalId);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
