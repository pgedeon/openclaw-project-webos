import { formatCount, getEscape, toNumber } from './widget-utils.mjs';

export const manifest = {
  id: 'cost-rollup',
  label: 'Cost Rollup',
  description: 'Top agents by estimated spend over the trailing week, with daily sparklines.',
  icon: `
    <path d="M4.5 19.5h15"></path>
    <path d="M7.5 16V9"></path>
    <path d="M12 16V5"></path>
    <path d="M16.5 16v-4"></path>
  `,
  size: 'medium',
  dataKeys: [],
  capabilities: {
    clickable: true,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const ROLLUP_PATH = '/costs/rollup?group_by=agent&days=7';
const MAX_ROWS = 5;
const SPARK_HEIGHT = 24;

const formatUsd = (value) => {
  const cost = Math.max(0, toNumber(value));
  if (cost >= 1000) {
    return `$${(cost / 1000).toFixed(1)}k`;
  }
  return `$${cost.toFixed(2)}`;
};

// Sparkline geometry over a group's daily series (cost per day). Normalized to
// the group's own min/max so small-but-rising spend still reads as rising.
const buildSparklinePoints = (values = []) => {
  const numeric = values.map((value) => Math.max(0, toNumber(value)));
  if (numeric.length === 0) {
    return '0,30 100,30';
  }
  const max = Math.max(...numeric);
  const min = Math.min(...numeric);
  const span = max - min;
  return numeric.map((value, index) => {
    const x = numeric.length === 1 ? 50 : (index / (numeric.length - 1)) * 100;
    const y = span === 0 ? 28 : 28 - ((value - min) / span) * SPARK_HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

export async function render(ctx) {
  const escape = getEscape(ctx);

  let payload = null;
  let fetchFailed = false;
  if (typeof ctx.api?.request === 'function') {
    try {
      payload = await ctx.api.request(ROLLUP_PATH);
    } catch (_) {
      fetchFailed = true;
    }
  }

  let bodyHtml;
  let footerHtml = '';

  if (fetchFailed || payload === null) {
    bodyHtml = `
      <div class="widget-cost-rollup__state">${escape('Cost data unavailable')}</div>
    `;
  } else if (payload.available === false) {
    // Matches the Mission Control cost panel degradation language.
    bodyHtml = `
      <div class="widget-cost-rollup__state">${escape('Cost unavailable — no database')}</div>
    `;
  } else {
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const visible = groups.slice(0, MAX_ROWS);
    const overflow = Math.max(0, groups.length - visible.length);

    if (visible.length === 0) {
      bodyHtml = `
        <div class="widget-cost-rollup__state">${escape('No cost data recorded yet')}</div>
      `;
    } else {
      bodyHtml = `
        <div class="widget-cost-rollup__list">
          ${visible.map((group) => {
            const series = Array.isArray(group.series) ? group.series : [];
            const points = buildSparklinePoints(series.map((point) => point?.cost));
            const polygonPoints = `0,30 ${points} 100,30`;
            return `
              <div class="widget-cost-rollup__row">
                <span class="widget-cost-rollup__name">${escape(group.key || 'Unknown')}</span>
                <svg class="widget-cost-rollup__spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
                  <polygon class="widget-cost-rollup__spark-fill" points="${polygonPoints}"></polygon>
                  <polyline class="widget-cost-rollup__spark-line" points="${points}" fill="none"></polyline>
                </svg>
                <span class="widget-cost-rollup__cost">${escape(formatUsd(group.cost))}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
      footerHtml = `
        <div class="widget-cost-rollup__footer">
          <span>${escape(`${formatCount(payload.group_count ?? groups.length)} agents · 7d`)}</span>
          ${overflow > 0 ? `<span>+${escape(formatCount(overflow))} more</span>` : ''}
          <span class="widget-cost-rollup__total">${escape(formatUsd(payload.total_window))}</span>
        </div>
      `;
    }
  }

  ctx.mountNode.innerHTML = `
    <button type="button" class="widget-card widget-card--interactive widget-cost-rollup" aria-label="Open mission control">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-cost-rollup__body">
        ${bodyHtml}
      </div>
      ${footerHtml ? `<div class="widget-cost-rollup__footer-wrap">${footerHtml}</div>` : ''}
    </button>
  `;

  const button = ctx.mountNode.querySelector('button');
  const handleClick = () => ctx.navigate?.('mission-control');
  button?.addEventListener('click', handleClick);

  return () => {
    button?.removeEventListener('click', handleClick);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
