/* ============================================
   Clock Widget
   ============================================ */

export const manifest = {
  id: 'clock-widget',
  label: 'Clock',
  description: 'Large digital clock with the current date.',
  icon: `
    <circle cx="12" cy="12" r="8"></circle>
    <path d="M12 7.5v4.8l3 1.8"></path>
  `,
  size: 'small',
  dataKeys: [],
  refreshInterval: null,
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {
    format: '24h',
  },
};

const createFormatters = (format = '24h') => ({
  time: new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: format === '12h',
  }),
  date: new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }),
});

export function render(ctx) {
  const escape = ctx.helpers?.escapeHtml || ((value) => String(value ?? ''));
  let format = ctx.config?.format === '12h' ? '12h' : '24h';
  let formatters = createFormatters(format);
  let configUnsubscribe = null;

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-clock" aria-label="Current time and date">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered">
        <span class="widget-clock__time" data-role="clock-time"></span>
        <span class="widget-clock__date" data-role="clock-date"></span>
      </div>
    </div>
  `;

  const timeEl = ctx.mountNode.querySelector('[data-role="clock-time"]');
  const dateEl = ctx.mountNode.querySelector('[data-role="clock-date"]');

  const paint = () => {
    const now = new Date();
    if (timeEl) {
      timeEl.textContent = formatters.time.format(now);
    }
    if (dateEl) {
      dateEl.textContent = formatters.date.format(now);
    }
  };

  const intervalId = window.setInterval(paint, 1000);
  paint();

  if (typeof ctx.onConfigChange === 'function') {
    configUnsubscribe = ctx.onConfigChange((nextConfig = {}) => {
      format = nextConfig?.format === '12h' ? '12h' : '24h';
      formatters = createFormatters(format);
      paint();
    });
  }

  return () => {
    window.clearInterval(intervalId);
    configUnsubscribe?.();
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
