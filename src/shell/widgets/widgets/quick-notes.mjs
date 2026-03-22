import { getEscape, readStorageText, writeStorageText } from './widget-utils.mjs';

const STORAGE_KEY = 'openclaw.win11.widget.quick-notes.v1';

export const manifest = {
  id: 'quick-notes',
  label: 'Quick Notes',
  description: 'A persistent scratchpad saved locally on this desktop.',
  icon: `
    <path d="M7 5.5h10"></path>
    <path d="M7 10h10"></path>
    <path d="M7 14.5h6"></path>
    <path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v14l-3-2.5-3 2.5-3-2.5-3 2.5-3-2.5V5A1.5 1.5 0 0 1 6 3.5Z"></path>
  `,
  size: 'large',
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
  let saveTimeoutId = null;

  ctx.mountNode.innerHTML = `
    <div class="widget-card widget-quick-notes" aria-label="Quick notes widget">
      <div class="widget-quick-notes__header">
        <span class="widget-card__title">${escape(manifest.label)}</span>
      </div>
      <textarea class="widget-quick-notes__textarea" data-role="notes-input" placeholder="Capture an idea, command, or reminder…"></textarea>
    </div>
  `;

  const textarea = ctx.mountNode.querySelector('[data-role="notes-input"]');
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.value = readStorageText(STORAGE_KEY, '');
  }

  const persist = () => {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }
    writeStorageText(STORAGE_KEY, textarea.value);
  };

  const handleInput = () => {
    if (saveTimeoutId !== null) {
      window.clearTimeout(saveTimeoutId);
    }
    saveTimeoutId = window.setTimeout(persist, 500);
  };

  textarea?.addEventListener('input', handleInput);

  return () => {
    textarea?.removeEventListener('input', handleInput);
    if (saveTimeoutId !== null) {
      window.clearTimeout(saveTimeoutId);
      persist();
    }
    ctx.mountNode.innerHTML = '';
  };
}

export default { manifest, render };
