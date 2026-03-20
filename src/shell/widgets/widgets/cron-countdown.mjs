import { formatCount, getEscape, toNumber } from './widget-utils.mjs';

export const manifest = {
  id: 'cron-countdown',
  label: 'Cron',
  description: 'Background cron status with next-run countdown.',
  icon: `
    <circle cx="12" cy="12" r="8"></circle>
    <path d="M12 7.5v5l3 1.5"></path>
  `,
  size: 'small',
  dataKeys: ['stats'],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const formatCountdownText = (status = {}) => {
  const runningCount = Math.max(0, toNumber(status.runningCount || status.running));
  if (runningCount > 0) {
    return `${formatCount(runningCount)} cron jobs running`;
  }

  const nextRunInMs = toNumber(status.nextRunInMs, 0);
  if (nextRunInMs > 0) {
    const minutes = Math.max(1, Math.ceil(nextRunInMs / 60000));
    return `Next run in ${formatCount(minutes)}m`;
  }

  const jobCount = Math.max(0, toNumber(status.totalJobs || status.total));
  return jobCount > 0 ? 'Waiting for next cron run' : 'No cron jobs configured';
};

export function render(ctx) {
  const escape = getEscape(ctx);
  let disposed = false;
  let intervalId = null;
  let requestInFlight = false;

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-cron-countdown" aria-label="Open cron view">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-card__body--centered widget-cron-countdown__body">
        <span class="widget-cron-countdown__value" data-role="cron-value">${escape('Checking status…')}</span>
        <span class="widget-card__meta" data-role="cron-meta">${escape('Polling every 5 seconds')}</span>
      </div>
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const valueEl = ctx.mountNode.querySelector('[data-role="cron-value"]');
  const metaEl = ctx.mountNode.querySelector('[data-role="cron-meta"]');

  const paintStatus = (text, meta) => {
    if (valueEl) {
      valueEl.textContent = text;
    }
    if (metaEl) {
      metaEl.textContent = meta;
    }
  };

  const fetchStatus = async () => {
    if (disposed || requestInFlight || typeof ctx.api?.cron?.status !== 'function') {
      return;
    }

    requestInFlight = true;
    try {
      const status = await ctx.api.cron.status();
      if (disposed) {
        return;
      }

      const label = formatCountdownText(status);
      const totalJobs = Math.max(0, toNumber(status.totalJobs || status.total));
      paintStatus(label, totalJobs > 0 ? `${formatCount(totalJobs)} configured jobs` : 'Cron idle');
    } catch (error) {
      if (!disposed) {
        paintStatus('Cron status unavailable', error?.message || 'Unable to reach cron status');
      }
    } finally {
      requestInFlight = false;
    }
  };

  const handleClick = () => ctx.navigate?.('cron');
  button?.addEventListener('click', handleClick);
  void fetchStatus();
  intervalId = window.setInterval(() => {
    void fetchStatus();
  }, 5000);

  return () => {
    disposed = true;
    button?.removeEventListener('click', handleClick);
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
