import { escapeHtml } from '../view-adapter.mjs';

/* ============================================
   Widget Host
   ============================================ */

const EMPTY_CLEANUP = () => {};

export class WidgetHost {
  /* --------------------------------------------
     Lifecycle
     -------------------------------------------- */

  constructor(widgetDef, container, shellAPI = {}, userConfig = {}) {
    if (!widgetDef?.manifest || typeof widgetDef?.render !== 'function') {
      throw new Error('WidgetHost requires a valid widget definition.');
    }

    if (!container) {
      throw new Error('WidgetHost requires a container element.');
    }

    this.manifest = widgetDef.manifest;
    this.renderFn = widgetDef.render;
    this.container = container;
    this.shellAPI = shellAPI;
    this.userConfig = { ...(this.manifest.defaults || {}), ...(userConfig || {}) };
    this.currentSize = this.manifest.size;
    this.cleanup = null;
    this.context = null;
    this.mountNode = null;
    this.syncUnsubscribe = null;
    this.themeUnsubscribers = new Set();
    this.configSubscribers = new Set();
    this.resizeSubscribers = new Set();
    this.renderSequence = Promise.resolve();
    this.isMounted = false;
  }

  async mount() {
    this.unmount();

    this.isMounted = true;
    this.container.innerHTML = '';
    this.container.className = `widget-host widget-host--${this.currentSize} widget-host--${this.manifest.id}`;
    this.container.dataset.widgetId = this.manifest.id;

    this.mountNode = document.createElement('div');
    this.mountNode.className = 'widget-host__content';
    this.container.appendChild(this.mountNode);

    this.context = this.createContext(this.mountNode);

    if (Array.isArray(this.manifest.dataKeys) && this.manifest.dataKeys.length > 0 && typeof this.shellAPI.sync?.subscribe === 'function') {
      this.syncUnsubscribe = this.shellAPI.sync.subscribe((data, changedKeys = []) => {
        const hasRelevantChange = Array.isArray(changedKeys)
          && changedKeys.some((key) => this.manifest.dataKeys.includes(key));

        if (!hasRelevantChange) {
          return;
        }

        this.context.data = this.getFilteredData();
        void this.reRender();
      });
    }

    await this.performRender();
  }

  async reRender() {
    if (!this.isMounted) {
      return;
    }

    await this.performRender({ withCleanup: true });
  }

  /* --------------------------------------------
     Context + Rendering
     -------------------------------------------- */

  createContext(mountNode) {
    const themeState = { current: this.shellAPI.getTheme?.() ?? 'dark' };

    return {
      mountNode,
      data: this.getFilteredData(),
      config: this.userConfig,
      helpers: this.shellAPI.helpers || {},
      api: this.shellAPI.api ?? null,
      navigate: this.shellAPI.navigate ?? (() => {}),
      showNotice: this.shellAPI.showNotice ?? (() => {}),
      theme: themeState,
      onThemeChange: (callback) => this.registerThemeChange(themeState, callback),
      onConfigChange: (callback) => this.registerSubscriber(this.configSubscribers, callback),
      onResize: (callback) => this.registerSubscriber(this.resizeSubscribers, callback),
    };
  }

  performRender({ withCleanup = false } = {}) {
    this.renderSequence = this.renderSequence.then(async () => {
      if (!this.isMounted || !this.context || !this.mountNode) {
        return;
      }

      if (withCleanup) {
        this.runCleanup();
      }

      try {
        const result = await this.renderFn(this.context);
        this.cleanup = typeof result === 'function' ? result : null;
        this.container.classList.remove('widget-host--failed');
      } catch (error) {
        console.error(`[WidgetHost] ${this.manifest.id} render error:`, error);
        this.renderError(error);
      }
    });

    return this.renderSequence;
  }

  renderError(error) {
    this.runCleanup();
    this.container.classList.add('widget-host--failed');

    if (!this.mountNode) {
      return;
    }

    this.mountNode.innerHTML = `
      <div class="widget-card widget-card--error" role="status" aria-live="polite">
        <div class="widget-card__header">
          <span class="widget-card__title">${escapeHtml(this.manifest.label)}</span>
        </div>
        <div class="widget-card__body widget-card__body--column">
          <span class="widget-card__error">Failed to load widget</span>
          <span class="widget-card__meta">${escapeHtml(error?.message || 'Unknown error')}</span>
        </div>
      </div>
    `;
  }

  /* --------------------------------------------
     Data + Events
     -------------------------------------------- */

  getFilteredData() {
    const syncData = this.shellAPI.sync?.getData?.() || {};
    const filtered = {};

    for (const key of this.manifest.dataKeys || []) {
      if (Object.prototype.hasOwnProperty.call(syncData, key)) {
        filtered[key] = syncData[key];
      }
    }

    return filtered;
  }

  registerThemeChange(themeState, callback) {
    if (typeof callback !== 'function') {
      return EMPTY_CLEANUP;
    }

    if (typeof this.shellAPI.onThemeChange !== 'function') {
      return EMPTY_CLEANUP;
    }

    const shellUnsubscribe = this.shellAPI.onThemeChange((theme) => {
      themeState.current = theme;
      try {
        callback(theme);
      } catch (error) {
        console.warn(`[WidgetHost] ${this.manifest.id} theme subscriber error:`, error);
      }
    });

    return this.trackUnsubscribe(this.themeUnsubscribers, shellUnsubscribe);
  }

  registerSubscriber(collection, callback) {
    if (typeof callback !== 'function') {
      return EMPTY_CLEANUP;
    }

    collection.add(callback);
    let active = true;

    return () => {
      if (!active) {
        return;
      }
      active = false;
      collection.delete(callback);
    };
  }

  trackUnsubscribe(collection, unsubscribe) {
    if (typeof unsubscribe !== 'function') {
      return EMPTY_CLEANUP;
    }

    let active = true;
    const wrapped = () => {
      if (!active) {
        return;
      }

      active = false;
      collection.delete(wrapped);

      try {
        unsubscribe();
      } catch (error) {
        console.warn(`[WidgetHost] ${this.manifest.id} unsubscribe error:`, error);
      }
    };

    collection.add(wrapped);
    return wrapped;
  }

  updateConfig(newConfig = {}) {
    this.userConfig = { ...(this.manifest.defaults || {}), ...(newConfig || {}) };

    if (this.context) {
      this.context.config = this.userConfig;
    }

    this.configSubscribers.forEach((callback) => {
      try {
        callback(this.userConfig);
      } catch (error) {
        console.warn(`[WidgetHost] ${this.manifest.id} config subscriber error:`, error);
      }
    });

    void this.reRender();
  }

  resize(newSize) {
    if (!newSize) {
      return;
    }

    this.currentSize = newSize;
    this.container.className = `widget-host widget-host--${newSize} widget-host--${this.manifest.id}`;

    this.resizeSubscribers.forEach((callback) => {
      try {
        callback(newSize);
      } catch (error) {
        console.warn(`[WidgetHost] ${this.manifest.id} resize subscriber error:`, error);
      }
    });
  }

  /* --------------------------------------------
     Cleanup
     -------------------------------------------- */

  runCleanup() {
    if (typeof this.cleanup !== 'function') {
      this.cleanup = null;
      return;
    }

    try {
      this.cleanup();
    } catch (error) {
      console.warn(`[WidgetHost] ${this.manifest.id} cleanup error:`, error);
    } finally {
      this.cleanup = null;
    }
  }

  unmount() {
    this.isMounted = false;
    this.syncUnsubscribe?.();
    this.syncUnsubscribe = null;

    this.themeUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.themeUnsubscribers.clear();

    this.runCleanup();
    this.configSubscribers.clear();
    this.resizeSubscribers.clear();
    this.context = null;
    this.mountNode = null;
    this.container.innerHTML = '';
  }
}

export default WidgetHost;
