import { getArray, getEscape } from './widget-utils.mjs';

export const manifest = {
  id: 'error-feed',
  label: 'Error Feed',
  description: 'Scrollable list of the most urgent blocker items.',
  icon: `
    <path d="M6.5 7.5h11"></path>
    <path d="M6.5 12h11"></path>
    <path d="M6.5 16.5h7"></path>
    <circle cx="4.5" cy="7.5" r=".8" fill="currentColor" stroke="none"></circle>
    <circle cx="4.5" cy="12" r=".8" fill="currentColor" stroke="none"></circle>
    <circle cx="4.5" cy="16.5" r=".8" fill="currentColor" stroke="none"></circle>
  `,
  size: 'tall',
  dataKeys: ['blockersSummary'],
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const fallbackItemsFromSummary = (summary = {}) => getArray(summary, 'byType').slice(0, 5).map((item) => ({
  severity: item.severity || 'medium',
  title: item.label || item.blockerType || 'Blocker',
  meta: `${item.count || 0} issue${Number(item.count) === 1 ? '' : 's'}`,
}));

const normalizeBlockerItem = (item = {}) => ({
  severity: item.severity || 'medium',
  title: item.title || item.blockerLabel || item.blockerType || 'Blocker',
  meta: item.blockerLabel && item.blockerLabel !== item.title
    ? item.blockerLabel
    : item.blockerDescription || item.departmentName || '',
});

export async function render(ctx) {
  const escape = getEscape(ctx);
  const summary = ctx.data?.blockersSummary || {};
  let items = [];

  if ((summary.total || 0) > 0 && typeof ctx.api?.blockers?.list === 'function') {
    try {
      const response = await ctx.api.blockers.list({ limit: 5 });
      items = getArray(response, 'blockers').map(normalizeBlockerItem).slice(0, 5);
    } catch (_) {
      items = [];
    }
  }

  if (items.length === 0) {
    items = fallbackItemsFromSummary(summary);
  }

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-error-feed" aria-label="Error feed widget">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-error-feed__body">
        ${items.length > 0 ? `
          <div class="widget-error-feed__list">
            ${items.map((item) => `
              <div class="widget-error-feed__item">
                <span class="widget-error-feed__dot is-${escape(item.severity)}"></span>
                <div class="widget-error-feed__content">
                  <div class="widget-error-feed__title">${escape(item.title)}</div>
                  ${item.meta ? `<div class="widget-error-feed__meta">${escape(item.meta)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="widget-error-feed__empty">${escape('No issues')}</div>
        `}
      </div>
    </div>
  `;

  return () => {
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
