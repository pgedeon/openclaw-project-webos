import { getEscape } from './widget-utils.mjs';

const SAFE_ENDPOINTS = [
  { id: 'health', label: 'Health', path: '/api/health' },
  { id: 'stats', label: 'Stats', path: '/api/stats' },
  { id: 'heartbeat', label: 'Heartbeat (/api/health-status)', path: '/api/health-status' },
];

export const manifest = {
  id: 'command-runner',
  label: 'Command Runner',
  description: 'Runs safe read-only endpoint checks and shows the raw response.',
  icon: `
    <path d="M5.5 7.5 9 11l-3.5 3.5"></path>
    <path d="M11 15.5h7.5"></path>
  `,
  size: 'medium',
  dataKeys: [],
  capabilities: {
    clickable: false,
    configurable: false,
    resizable: false,
  },
  defaults: {},
};

const prettyPrintResponse = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    return JSON.stringify(payload, null, 2);
  }
  return response.text();
};

export function render(ctx) {
  const escape = getEscape(ctx);

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-command-runner" aria-label="Command runner widget">
      <div class="widget-card__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <div class="widget-card__body widget-card__body--column widget-command-runner__body">
        <div class="widget-command-runner__controls">
          <select class="widget-command-runner__select" data-role="runner-select">
            ${SAFE_ENDPOINTS.map((endpoint) => `<option value="${escape(endpoint.id)}">${escape(endpoint.label)}</option>`).join('')}
          </select>
          <button type="button" class="widget-command-runner__button" data-role="runner-button">${escape('Run')}</button>
        </div>
        <pre class="widget-command-runner__response"><code data-role="runner-output"></code></pre>
      </div>
    </div>
  `;

  const selectEl = ctx.mountNode.querySelector('[data-role="runner-select"]');
  const buttonEl = ctx.mountNode.querySelector('[data-role="runner-button"]');
  const outputEl = ctx.mountNode.querySelector('[data-role="runner-output"]');

  if (outputEl) {
    outputEl.textContent = 'Select an endpoint and run it.';
  }

  const handleRun = async () => {
    if (!(selectEl instanceof HTMLSelectElement) || !(buttonEl instanceof HTMLButtonElement) || !outputEl) {
      return;
    }

    const choice = SAFE_ENDPOINTS.find((endpoint) => endpoint.id === selectEl.value) || SAFE_ENDPOINTS[0];
    selectEl.disabled = true;
    buttonEl.disabled = true;
    outputEl.textContent = `Running ${choice.path}…`;

    try {
      const response = await ctx.api.raw(choice.path, { method: 'GET' });
      const responseText = await prettyPrintResponse(response.clone());
      outputEl.textContent = response.ok
        ? responseText
        : `HTTP ${response.status}\n${responseText}`;
    } catch (error) {
      outputEl.textContent = error?.message || 'Request failed';
    } finally {
      selectEl.disabled = false;
      buttonEl.disabled = false;
    }
  };

  buttonEl?.addEventListener('click', handleRun);

  return () => {
    buttonEl?.removeEventListener('click', handleRun);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
