import APP_REGISTRY, { getAppById } from './app-registry.mjs';

let _sharedAdapter = null;
let _sharedApiClient = null;
let _sharedSync = null;

export function setShellContext({ adapter, apiClient, sync }) {
  _sharedAdapter = adapter;
  _sharedApiClient = apiClient;
  _sharedSync = sync;
}


const DEFAULT_STORAGE_KEY = 'openclaw.win11.windows.v1';
const MIN_WIDTH = 360;
const MIN_HEIGHT = 240;
const EDGE_PADDING = 16;
const MAXIMIZED_MARGIN = 8;
const WINDOW_CASCADE_OFFSET = 28;
const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

const copyBounds = (bounds = {}) => ({
  x: Number(bounds.x) || 0,
  y: Number(bounds.y) || 0,
  width: Number(bounds.width) || MIN_WIDTH,
  height: Number(bounds.height) || MIN_HEIGHT,
});

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const normalizePersistedPayload = (payload) => {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.windows)) {
    return payload.windows;
  }

  return [];
};

export class WindowManager extends EventTarget {
  constructor({
    desktop,
    apps = APP_REGISTRY,
    storageKey = DEFAULT_STORAGE_KEY,
    taskbarHeight = 48,
  } = {}) {
    super();

    if (!desktop) {
      throw new Error('WindowManager requires a desktop element.');
    }

    this.desktop = desktop;
    this.apps = apps;
    this.storageKey = storageKey;
    this.taskbarHeight = taskbarHeight;
    this.appMap = new Map(apps.map((app) => [app.id, app]));
    this.windows = new Map();
    this.activeAppId = null;
    this.zIndexCounter = 40;
    this.openSequence = 0;

    this.windowLayer = this.desktop.querySelector('.win11-desktop__window-layer') ?? document.createElement('div');
    this.windowLayer.classList.add('win11-desktop__window-layer');
    if (!this.windowLayer.parentElement) {
      this.desktop.append(this.windowLayer);
    }

    this.handleViewportResize = this.handleViewportResize.bind(this);
    window.addEventListener('resize', this.handleViewportResize);
  }

  destroy() {
    window.removeEventListener('resize', this.handleViewportResize);
  }

  getWorkspaceBounds() {
    const width = this.desktop.clientWidth || window.innerWidth;
    const fullHeight = this.desktop.clientHeight || window.innerHeight;
    const height = Math.max(MIN_HEIGHT, fullHeight - this.taskbarHeight);
    return { width, height };
  }

  clampStateToWorkspace(state) {
    const workspace = this.getWorkspaceBounds();
    const maxWidth = Math.max(MIN_WIDTH, workspace.width - EDGE_PADDING * 2);
    const maxHeight = Math.max(MIN_HEIGHT, workspace.height - EDGE_PADDING * 2);

    state.width = clamp(state.width, MIN_WIDTH, maxWidth);
    state.height = clamp(state.height, MIN_HEIGHT, maxHeight);
    state.x = clamp(state.x, EDGE_PADDING, Math.max(EDGE_PADDING, workspace.width - state.width - EDGE_PADDING));
    state.y = clamp(state.y, EDGE_PADDING, Math.max(EDGE_PADDING, workspace.height - state.height - EDGE_PADDING));
    return state;
  }

  createInitialState(app, restoredState) {
    const workspace = this.getWorkspaceBounds();
    const offset = WINDOW_CASCADE_OFFSET * (this.openSequence % 6);
    this.openSequence += 1;

    const width = restoredState?.width ?? app.defaultWidth ?? 960;
    const height = restoredState?.height ?? app.defaultHeight ?? 680;
    const centeredX = Math.round((workspace.width - width) / 2) + offset;
    const centeredY = Math.round((workspace.height - height) / 2) + offset;

    const baseState = {
      id: app.id,
      x: Number(restoredState?.x ?? centeredX),
      y: Number(restoredState?.y ?? centeredY),
      width: Number(width),
      height: Number(height),
      minimized: Boolean(restoredState?.minimized),
      maximized: Boolean(restoredState?.maximized),
      zIndex: Number(restoredState?.zIndex ?? (this.zIndexCounter + 1)),
      restoreBounds: restoredState?.restoreBounds ? copyBounds(restoredState.restoreBounds) : null,
    };

    this.zIndexCounter = Math.max(this.zIndexCounter, baseState.zIndex);
    this.clampStateToWorkspace(baseState);
    baseState.restoreBounds = baseState.restoreBounds ?? copyBounds(baseState);
    return baseState;
  }

  getWindowEntry(appId) {
    return this.windows.get(appId) ?? null;
  }

  isWindowOpen(appId) {
    return this.windows.has(appId);
  }

  getActiveWindow() {
    return this.activeAppId ? this.windows.get(this.activeAppId) ?? null : null;
  }

  getStateSnapshot() {
    const windows = Array.from(this.windows.values())
      .map(({ app, state }) => ({
        id: app.id,
        label: app.label,
        category: app.category,
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        minimized: state.minimized,
        maximized: state.maximized,
        zIndex: state.zIndex,
      }))
      .sort((left, right) => left.zIndex - right.zIndex);

    return {
      activeAppId: this.activeAppId,
      windows,
    };
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('windowschange', { detail: this.getStateSnapshot() }));
  }

  persistState() {
    try {
      const windows = Array.from(this.windows.values())
        .map(({ state }) => ({
          id: state.id,
          x: state.x,
          y: state.y,
          width: state.width,
          height: state.height,
          minimized: state.minimized,
          maximized: state.maximized,
          zIndex: state.zIndex,
          restoreBounds: state.restoreBounds ? copyBounds(state.restoreBounds) : null,
        }))
        .sort((left, right) => left.zIndex - right.zIndex);

      localStorage.setItem(this.storageKey, JSON.stringify({ version: 1, windows }));
    } catch (error) {
      console.warn('Unable to persist shell windows:', error);
    }
  }

  clearPersistedState() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.warn('Unable to clear shell window state:', error);
    }
  }

  restoreFromStorage() {
    let persistedWindows = [];

    try {
      const rawValue = localStorage.getItem(this.storageKey);
      if (rawValue) {
        persistedWindows = normalizePersistedPayload(JSON.parse(rawValue));
      }
    } catch (error) {
      console.warn('Unable to restore shell windows:', error);
    }

    if (!persistedWindows.length) {
      return 0;
    }

    persistedWindows
      .filter((savedWindow) => this.appMap.has(savedWindow.id))
      .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
      .forEach((savedWindow) => {
        this.openWindow(savedWindow.id, {
          state: savedWindow,
          skipPersist: true,
          skipEmit: true,
          skipFocus: true,
        });
      });

    const topmostVisible = Array.from(this.windows.values())
      .filter(({ state }) => !state.minimized)
      .sort((left, right) => right.state.zIndex - left.state.zIndex)[0];

    if (topmostVisible) {
      this.focusWindow(topmostVisible.app.id, { skipPersist: true, skipEmit: true });
    } else {
      this.activeAppId = null;
    }

    this.persistState();
    this.emitChange();
    return this.windows.size;
  }

  openWindow(appId, options = {}) {
    const app = this.appMap.get(appId) ?? getAppById(appId);
    if (!app) {
      throw new Error(`Unknown app id: ${appId}`);
    }

    const existingWindow = this.windows.get(appId);
    if (existingWindow) {
      if (existingWindow.state.minimized) {
        this.restoreWindow(appId, { skipEmit: true, skipPersist: true });
      }
      this.focusWindow(appId, { skipEmit: options.skipEmit, skipPersist: options.skipPersist });
      return existingWindow;
    }

    const state = this.createInitialState(app, options.state);
    const entry = this.createWindowEntry(app, state);
    this.windows.set(appId, entry);
    this.windowLayer.append(entry.element);

    if (state.maximized) {
      this.applyMaximizedBounds(entry, { updateRestoreBounds: false, persist: false, emit: false });
    } else {
      this.applyStateToElement(entry);
    }

    if (state.minimized) {
      entry.element.classList.add('is-minimized');
    }

    if (!options.skipFocus && !state.minimized) {
      this.focusWindow(appId, { skipPersist: true, skipEmit: true });
    } else {
      entry.element.style.zIndex = String(state.zIndex);
    }

    nextFrame().then(() => {
      entry.element.classList.add('is-open');
      entry.element.classList.remove('is-opening');
    });

    if (!options.skipPersist) {
      this.persistState();
    }

    if (!options.skipEmit) {
      this.emitChange();
    }

    return entry;
  }

  createWindowEntry(app, state) {
    const element = document.createElement('article');
    element.className = 'win11-window is-opening';
    element.dataset.appId = app.id;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', `${app.label} window`);

    const resizeHandles = RESIZE_DIRECTIONS
      .map((direction) => `<div class="win11-window__resize-handle is-${direction}" data-resize="${direction}" aria-hidden="true"></div>`)
      .join('');

    element.innerHTML = `
      <header class="win11-window__titlebar">
        <div class="win11-window__identity">
          <span class="win11-app-icon win11-window__icon">${app.icon}</span>
          <span class="win11-window__title">${escapeHtml(app.label)}</span>
        </div>
        <div class="win11-window__actions" role="group" aria-label="Window actions">
          <button type="button" class="win11-window__action" data-action="minimize" aria-label="Minimize window">
            <span aria-hidden="true">—</span>
          </button>
          <button type="button" class="win11-window__action" data-action="maximize" aria-label="Maximize window">
            <span aria-hidden="true">▢</span>
          </button>
          <button type="button" class="win11-window__action is-close" data-action="close" aria-label="Close window">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </header>
      <div class="win11-window__content">
        ${app.viewModule
          ? '<div class="win11-window__native-content"></div>'
          : `<iframe class="win11-window__iframe" title="${escapeHtml(app.label)}" src="${app.url}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`
        }
      </div>
      ${resizeHandles}
    `;

    const entry = {
      app,
      state,
      element,
      titleBar: element.querySelector('.win11-window__titlebar'),
      iframe: element.querySelector('.win11-window__iframe'),
      nativeContent: element.querySelector('.win11-window__native-content'),
      actionBar: element.querySelector('.win11-window__actions'),
      _cleanup: null,
      _viewLoading: false,
    };

    this.attachWindowListeners(entry);
    return entry;
  }

  async loadNativeView(entry) {
    if (entry._viewLoading || !entry.nativeContent) return;
    entry._viewLoading = true;

    try {
      // Show loading state
      entry.nativeContent.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--win11-text-tertiary);font-size:0.9rem;">Loading...</div>';

      const viewModule = await import(entry.app.viewModule);
      const renderFn = viewModule.default || viewModule.render || viewModule;

      if (typeof renderFn !== 'function') {
        throw new Error(`View module ${entry.app.viewModule} has no render function`);
      }

      const cleanup = await renderFn({
        mountNode: entry.nativeContent,
        api: _sharedApiClient,
        adapter: _sharedAdapter,
        stateStore: _sharedAdapter?.stateStore,
        state: _sharedAdapter?.state,
        sync: _sharedSync,
        navigateToView: (viewId, options = {}) => this.openWindow(viewId, options),
      });

      entry._cleanup = typeof cleanup === 'function' ? cleanup : (cleanup?.destroy || cleanup?.cleanup || cleanup?.unmount || null);
    } catch (error) {
      console.error(`Failed to load native view for ${entry.app.id}:`, error);
      entry.nativeContent.innerHTML = `
        <div style="padding:24px;color:var(--win11-text-secondary);">
          <strong>Failed to load ${escapeHtml(entry.app.label)}</strong>
          <div style="margin-top:8px;font-size:0.85rem;color:var(--win11-text-tertiary);">${escapeHtml(error.message)}</div>
          <button onclick="this.closest('.win11-window').querySelector('[data-action=close]').click()"
            style="margin-top:12px;padding:6px 14px;border-radius:6px;border:1px solid var(--win11-border);background:var(--win11-surface);color:var(--win11-text);cursor:pointer;">
            Close
          </button>
        </div>
      `;
    } finally {
      entry._viewLoading = false;
    }
  }

  attachWindowListeners(entry) {
    entry.element.addEventListener('mousedown', () => {
      this.focusWindow(entry.app.id);
    });

    entry.titleBar.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.win11-window__action')) {
        return;
      }

      if (event.detail === 2) {
        return;
      }

      this.beginDrag(entry, event);
    });

    entry.titleBar.addEventListener('dblclick', (event) => {
      if (event.target.closest('.win11-window__action')) {
        return;
      }

      this.toggleMaximize(entry.app.id);
    });

    entry.actionBar.addEventListener('click', (event) => {
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) {
        return;
      }

      const action = actionButton.dataset.action;
      if (action === 'minimize') {
        this.minimizeWindow(entry.app.id);
      }

      if (action === 'maximize') {
        this.toggleMaximize(entry.app.id);
      }

      if (action === 'close') {
        this.closeWindow(entry.app.id);
      }
    });

    entry.element.querySelectorAll('[data-resize]').forEach((handle) => {
      handle.addEventListener('mousedown', (event) => {
        if (event.button !== 0) {
          return;
        }

        this.beginResize(entry, event, handle.dataset.resize);
      });
    });

    if (entry.iframe) {
      entry.iframe.addEventListener('load', () => {
        try {
          const iframeDocument = entry.iframe.contentDocument;
          iframeDocument?.addEventListener('mousedown', () => this.focusWindow(entry.app.id), true);
        } catch (error) {
          console.debug('Unable to bridge iframe focus:', error);
        }
      });
    }

    if (entry.nativeContent && entry.app.viewModule && _sharedAdapter) {
      this.loadNativeView(entry);
    }
  }

  applyStateToElement(entry) {
    entry.element.style.left = `${entry.state.x}px`;
    entry.element.style.top = `${entry.state.y}px`;
    entry.element.style.width = `${entry.state.width}px`;
    entry.element.style.height = `${entry.state.height}px`;
    entry.element.style.zIndex = String(entry.state.zIndex);
    entry.element.classList.toggle('is-maximized', Boolean(entry.state.maximized));
    entry.element.classList.toggle('is-minimized', Boolean(entry.state.minimized));
  }

  beginDrag(entry, event) {
    if (entry.state.maximized || entry.state.minimized) {
      return;
    }

    event.preventDefault();
    this.focusWindow(entry.app.id, { skipPersist: true, skipEmit: true });

    const originState = copyBounds(entry.state);
    const startX = event.clientX;
    const startY = event.clientY;

    entry.element.classList.add('is-dragging');
    document.body.classList.add('win11-no-select');

    const onMouseMove = (moveEvent) => {
      entry.state.x = originState.x + (moveEvent.clientX - startX);
      entry.state.y = originState.y + (moveEvent.clientY - startY);
      this.clampStateToWorkspace(entry.state);
      this.applyStateToElement(entry);
    };

    const onMouseUp = () => {
      entry.element.classList.remove('is-dragging');
      document.body.classList.remove('win11-no-select');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      entry.state.restoreBounds = copyBounds(entry.state);
      this.persistState();
      this.emitChange();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  beginResize(entry, event, direction) {
    if (entry.state.maximized || entry.state.minimized) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.focusWindow(entry.app.id, { skipPersist: true, skipEmit: true });

    const originState = copyBounds(entry.state);
    const startX = event.clientX;
    const startY = event.clientY;

    entry.element.classList.add('is-resizing');
    document.body.classList.add('win11-no-select');

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const workspace = this.getWorkspaceBounds();

      const nextState = {
        ...entry.state,
        x: originState.x,
        y: originState.y,
        width: originState.width,
        height: originState.height,
      };

      if (direction.includes('e')) {
        nextState.width = clamp(originState.width + deltaX, MIN_WIDTH, workspace.width - originState.x - EDGE_PADDING);
      }

      if (direction.includes('s')) {
        nextState.height = clamp(originState.height + deltaY, MIN_HEIGHT, workspace.height - originState.y - EDGE_PADDING);
      }

      if (direction.includes('w')) {
        const nextX = clamp(originState.x + deltaX, EDGE_PADDING, originState.x + originState.width - MIN_WIDTH);
        nextState.x = nextX;
        nextState.width = originState.width - (nextX - originState.x);
      }

      if (direction.includes('n')) {
        const nextY = clamp(originState.y + deltaY, EDGE_PADDING, originState.y + originState.height - MIN_HEIGHT);
        nextState.y = nextY;
        nextState.height = originState.height - (nextY - originState.y);
      }

      Object.assign(entry.state, nextState);
      this.clampStateToWorkspace(entry.state);
      this.applyStateToElement(entry);
    };

    const onMouseUp = () => {
      entry.element.classList.remove('is-resizing');
      document.body.classList.remove('win11-no-select');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      entry.state.restoreBounds = copyBounds(entry.state);
      this.persistState();
      this.emitChange();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  focusWindow(appId, { skipPersist = false, skipEmit = false } = {}) {
    const entry = this.windows.get(appId);
    if (!entry) {
      return null;
    }

    this.activeAppId = appId;
    this.zIndexCounter += 1;
    entry.state.zIndex = this.zIndexCounter;

    this.windows.forEach((windowEntry, windowAppId) => {
      const isActive = windowAppId === appId;
      windowEntry.element.classList.toggle('is-active', isActive);
      if (isActive) {
        windowEntry.element.style.zIndex = String(entry.state.zIndex);
      }
    });

    if (!skipPersist) {
      this.persistState();
    }

    if (!skipEmit) {
      this.emitChange();
    }

    return entry;
  }

  focusTopmostVisibleWindow({ skipPersist = false, skipEmit = false } = {}) {
    const nextEntry = Array.from(this.windows.values())
      .filter(({ state }) => !state.minimized)
      .sort((left, right) => right.state.zIndex - left.state.zIndex)[0];

    if (!nextEntry) {
      this.activeAppId = null;
      this.windows.forEach(({ element }) => element.classList.remove('is-active'));
      if (!skipPersist) {
        this.persistState();
      }
      if (!skipEmit) {
        this.emitChange();
      }
      return null;
    }

    return this.focusWindow(nextEntry.app.id, { skipPersist, skipEmit });
  }

  minimizeWindow(appId, { skipPersist = false, skipEmit = false } = {}) {
    const entry = this.windows.get(appId);
    if (!entry || entry.state.minimized) {
      return null;
    }

    entry.state.minimized = true;
    entry.element.classList.add('is-minimizing');
    entry.element.classList.remove('is-active');

    window.setTimeout(() => {
      entry.element.classList.add('is-minimized');
      entry.element.classList.remove('is-minimizing');
    }, 150);

    if (this.activeAppId === appId) {
      this.activeAppId = null;
      this.focusTopmostVisibleWindow({ skipPersist: true, skipEmit: true });
    }

    if (!skipPersist) {
      this.persistState();
    }

    if (!skipEmit) {
      this.emitChange();
    }

    return entry;
  }

  restoreWindow(appId, { skipPersist = false, skipEmit = false } = {}) {
    const entry = this.windows.get(appId);
    if (!entry) {
      return null;
    }

    entry.state.minimized = false;
    entry.element.classList.remove('is-minimized');
    entry.element.classList.add('is-restoring');

    window.setTimeout(() => {
      entry.element.classList.remove('is-restoring');
    }, 180);

    if (entry.state.maximized) {
      this.applyMaximizedBounds(entry, { updateRestoreBounds: false, persist: false, emit: false });
    } else {
      this.applyStateToElement(entry);
    }

    this.focusWindow(appId, { skipPersist: true, skipEmit: true });

    if (!skipPersist) {
      this.persistState();
    }

    if (!skipEmit) {
      this.emitChange();
    }

    return entry;
  }

  maximizeWindow(appId) {
    const entry = this.windows.get(appId);
    if (!entry || entry.state.maximized) {
      return entry;
    }

    entry.state.restoreBounds = copyBounds(entry.state);
    entry.state.maximized = true;
    entry.state.minimized = false;
    this.applyMaximizedBounds(entry, { updateRestoreBounds: false, persist: true, emit: true });
    this.focusWindow(appId, { skipPersist: true, skipEmit: true });
    return entry;
  }

  restoreFromMaximize(appId) {
    const entry = this.windows.get(appId);
    if (!entry || !entry.state.maximized) {
      return entry;
    }

    entry.state.maximized = false;
    const restoreBounds = entry.state.restoreBounds ? copyBounds(entry.state.restoreBounds) : this.createInitialState(entry.app);
    Object.assign(entry.state, restoreBounds);
    this.clampStateToWorkspace(entry.state);
    entry.element.classList.remove('is-maximized');
    this.applyStateToElement(entry);
    this.focusWindow(appId, { skipPersist: true, skipEmit: true });
    this.persistState();
    this.emitChange();
    return entry;
  }

  toggleMaximize(appId) {
    const entry = this.windows.get(appId);
    if (!entry) {
      return null;
    }

    if (entry.state.maximized) {
      return this.restoreFromMaximize(appId);
    }

    return this.maximizeWindow(appId);
  }

  applyMaximizedBounds(entry, { updateRestoreBounds = false, persist = true, emit = true } = {}) {
    if (updateRestoreBounds) {
      entry.state.restoreBounds = copyBounds(entry.state);
    }

    const workspace = this.getWorkspaceBounds();
    entry.state.maximized = true;
    entry.state.minimized = false;
    entry.state.x = MAXIMIZED_MARGIN;
    entry.state.y = MAXIMIZED_MARGIN;
    entry.state.width = Math.max(MIN_WIDTH, workspace.width - MAXIMIZED_MARGIN * 2);
    entry.state.height = Math.max(MIN_HEIGHT, workspace.height - MAXIMIZED_MARGIN * 2);
    entry.element.classList.add('is-maximized');
    this.applyStateToElement(entry);

    if (persist) {
      this.persistState();
    }

    if (emit) {
      this.emitChange();
    }
  }

  closeWindow(appId, { skipPersist = false, skipEmit = false } = {}) {
    const entry = this.windows.get(appId);
    if (!entry) {
      return Promise.resolve(false);
    }

    entry.element.classList.add('is-closing');

    return new Promise((resolve) => {
      window.setTimeout(() => {
        entry.element.remove();
        this.windows.delete(appId);

        if (this.activeAppId === appId) {
          this.activeAppId = null;
          this.focusTopmostVisibleWindow({ skipPersist: true, skipEmit: true });
        }

        if (!skipPersist) {
          this.persistState();
        }

        if (!skipEmit) {
          this.emitChange();
        }

        resolve(true);
      }, 170);
    });
  }

  async closeActiveWindow() {
    if (!this.activeAppId) {
      return false;
    }

    return this.closeWindow(this.activeAppId);
  }

  minimizeAll() {
    this.windows.forEach((_, appId) => {
      this.minimizeWindow(appId, { skipPersist: true, skipEmit: true });
    });

    this.activeAppId = null;
    this.persistState();
    this.emitChange();
  }

  restoreAll() {
    this.windows.forEach((entry, appId) => {
      if (entry.state.minimized) {
        this.restoreWindow(appId, { skipPersist: true, skipEmit: true });
      }
    });

    this.focusTopmostVisibleWindow({ skipPersist: true, skipEmit: true });
    this.persistState();
    this.emitChange();
  }

  handleViewportResize() {
    this.windows.forEach((entry) => {
      if (entry.state.maximized) {
        this.applyMaximizedBounds(entry, { updateRestoreBounds: false, persist: false, emit: false });
        return;
      }

      this.clampStateToWorkspace(entry.state);
      this.applyStateToElement(entry);
    });

    this.persistState();
    this.emitChange();
  }
}

export default WindowManager;
