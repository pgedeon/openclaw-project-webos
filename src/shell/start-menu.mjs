import APP_REGISTRY, { APP_CATEGORY_ORDER, PINNED_APP_IDS } from './app-registry.mjs';

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const matchesQuery = (app, query) => {
  if (!query) {
    return true;
  }

  const haystack = `${app.label} ${app.category} ${app.id}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
};

export class StartMenu extends EventTarget {
  constructor({
    container = document.body,
    apps = APP_REGISTRY,
    pinnedAppIds = PINNED_APP_IDS,
    onOpenApp = () => {},
    anchorElement = null,
  } = {}) {
    super();

    this.container = container;
    this.apps = apps;
    this.pinnedAppIds = pinnedAppIds;
    this.onOpenApp = onOpenApp;
    this.anchorElement = anchorElement;
    this.isOpen = false;
    this.query = '';

    this.element = document.createElement('aside');
    this.element.className = 'win11-start-menu';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = '<div class="win11-start-menu__surface"></div>';
    this.container.append(this.element);

    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);

    document.addEventListener('mousedown', this.handleDocumentPointerDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);

    this.render();
  }

  destroy() {
    document.removeEventListener('mousedown', this.handleDocumentPointerDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.element.remove();
  }

  setAnchorElement(anchorElement) {
    this.anchorElement = anchorElement;
  }

  handleDocumentPointerDown(event) {
    if (!this.isOpen) {
      return;
    }

    if (this.element.contains(event.target) || this.anchorElement?.contains(event.target)) {
      return;
    }

    this.close();
  }

  handleDocumentKeyDown(event) {
    if (event.key === 'Escape' && this.isOpen) {
      this.close();
    }
  }

  open() {
    if (this.isOpen) {
      return;
    }

    this.isOpen = true;
    this.element.classList.add('is-open');
    this.element.setAttribute('aria-hidden', 'false');
    this.dispatchEvent(new CustomEvent('toggle', { detail: { open: true } }));

    window.setTimeout(() => {
      this.searchInput?.focus();
      this.searchInput?.select();
    }, 40);
  }

  close({ resetQuery = true } = {}) {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');

    if (resetQuery) {
      this.query = '';
      this.render();
    }

    this.dispatchEvent(new CustomEvent('toggle', { detail: { open: false } }));
  }

  toggle() {
    if (this.isOpen) {
      this.close();
      return;
    }

    this.open();
  }

  getPinnedApps() {
    return this.pinnedAppIds
      .map((appId) => this.apps.find((app) => app.id === appId))
      .filter(Boolean)
      .filter((app) => matchesQuery(app, this.query))
      .slice(0, 8);
  }

  getGroupedApps() {
    return APP_CATEGORY_ORDER.map((category) => ({
      category,
      apps: this.apps.filter((app) => app.category === category && matchesQuery(app, this.query)),
    })).filter((group) => group.apps.length > 0);
  }

  render() {
    const pinnedApps = this.getPinnedApps();
    const groupedApps = this.getGroupedApps();
    const hasMatches = pinnedApps.length > 0 || groupedApps.length > 0;

    this.element.innerHTML = `
      <div class="win11-start-menu__surface">
        <div class="win11-start-menu__header">
          <div>
            <div class="win11-start-menu__eyebrow">OpenClaw Desktop</div>
            <h2 class="win11-start-menu__title">Start</h2>
          </div>
          <div class="win11-start-menu__meta">20 apps</div>
        </div>
        <label class="win11-start-menu__search">
          <span class="win11-start-menu__search-icon" aria-hidden="true">⌕</span>
          <input class="win11-start-menu__search-input" type="search" placeholder="Search apps, views, and tools" value="${escapeHtml(this.query)}" />
        </label>
        <section class="win11-start-menu__section">
          <div class="win11-start-menu__section-header">Pinned</div>
          <div class="win11-start-menu__pinned-grid">
            ${pinnedApps.map((app) => `
              <button type="button" class="win11-start-menu__tile is-pinned" data-app-id="${app.id}">
                <span class="win11-app-icon win11-start-menu__tile-icon">${app.icon}</span>
                <span class="win11-start-menu__tile-label">${escapeHtml(app.label)}</span>
              </button>
            `).join('')}
          </div>
        </section>
        <section class="win11-start-menu__section">
          <div class="win11-start-menu__section-header">All Apps</div>
          ${hasMatches ? groupedApps.map((group) => `
            <div class="win11-start-menu__category-group">
              <div class="win11-start-menu__category-header">${escapeHtml(group.category)}</div>
              <div class="win11-start-menu__grid">
                ${group.apps.map((app) => `
                  <button type="button" class="win11-start-menu__tile" data-app-id="${app.id}">
                    <span class="win11-app-icon win11-start-menu__tile-icon">${app.icon}</span>
                    <span class="win11-start-menu__tile-label">${escapeHtml(app.label)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `).join('') : '<div class="win11-start-menu__empty">No apps match your search.</div>'}
        </section>
      </div>
    `;

    this.searchInput = this.element.querySelector('.win11-start-menu__search-input');
    this.searchInput.addEventListener('input', (event) => {
      this.query = event.target.value;
      this.render();
      this.open();
      const input = this.searchInput;
      const cursorPosition = this.query.length;
      input?.focus();
      input?.setSelectionRange(cursorPosition, cursorPosition);
    });

    this.element.querySelectorAll('[data-app-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const appId = button.dataset.appId;
        this.onOpenApp(appId);
        this.close();
      });
    });
  }
}

export default StartMenu;
