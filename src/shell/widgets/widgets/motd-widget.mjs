import {
  getEscape,
  readStorageText,
  removeStorageValue,
  writeStorageText,
} from './widget-utils.mjs';

const STORAGE_KEY = 'openclaw.win11.widget.motd.v1';
const DEFAULT_QUOTES = [
  'Ship the fix, then sharpen the tool.',
  'Small clean changes beat heroic rewrites.',
  'Measure twice, patch once.',
  'The queue gets lighter one win at a time.',
  'Calm systems make fast teams.',
];

let quoteCursor = 0;

export const manifest = {
  id: 'motd-widget',
  label: 'MOTD',
  description: 'Editable message of the day with a rotating fallback quote.',
  icon: `
    <path d="M6.5 7.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H12l-3.5 3v-3H6.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z"></path>
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

const nextFallbackQuote = () => {
  const quote = DEFAULT_QUOTES[quoteCursor % DEFAULT_QUOTES.length];
  quoteCursor += 1;
  return quote;
};

export function render(ctx) {
  const escape = getEscape(ctx);
  const storedMessage = readStorageText(STORAGE_KEY, '').trim();
  const initialMessage = storedMessage || nextFallbackQuote();

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-motd" aria-label="Message of the day widget">
      <div class="widget-motd__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
        <button type="button" class="widget-motd__edit" data-role="motd-edit" aria-label="Edit message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 5 4 4"></path>
            <path d="M4.5 19.5 8 18.8l10.5-10.6-3.3-3.2L4.5 15.6l-.7 3.9Z"></path>
          </svg>
        </button>
      </div>
      <div class="widget-motd__message" data-role="motd-message" contenteditable="false"></div>
    </div>
  `;

  const editButton = ctx.mountNode.querySelector('[data-role="motd-edit"]');
  const messageEl = ctx.mountNode.querySelector('[data-role="motd-message"]');

  if (messageEl) {
    messageEl.textContent = initialMessage;
  }

  const stopEditing = () => {
    if (!(messageEl instanceof HTMLElement)) {
      return;
    }

    const nextValue = messageEl.textContent?.trim() || '';
    if (nextValue) {
      writeStorageText(STORAGE_KEY, nextValue);
      messageEl.textContent = nextValue;
    } else {
      removeStorageValue(STORAGE_KEY);
      messageEl.textContent = nextFallbackQuote();
    }
    messageEl.contentEditable = 'false';
    messageEl.classList.remove('is-editing');
  };

  const handleEdit = () => {
    if (!(messageEl instanceof HTMLElement)) {
      return;
    }

    messageEl.contentEditable = 'true';
    messageEl.classList.add('is-editing');
    messageEl.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(messageEl);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const handleBlur = () => {
    stopEditing();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      messageEl?.blur();
    }
  };

  editButton?.addEventListener('click', handleEdit);
  messageEl?.addEventListener('blur', handleBlur);
  messageEl?.addEventListener('keydown', handleKeyDown);

  return () => {
    editButton?.removeEventListener('click', handleEdit);
    messageEl?.removeEventListener('blur', handleBlur);
    messageEl?.removeEventListener('keydown', handleKeyDown);
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
