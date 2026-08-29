import { escapeHtml } from '../view-adapter.mjs';
import { WidgetHost } from './widget-host.mjs';

/* ============================================
   Widget Panel
   ============================================ */

export const PANEL_STORAGE_KEY = 'openclaw.win11.widgets.v1';
export const DESKTOP_LAYOUT_STORAGE_KEY = 'openclaw.win11.widgets.layout.v1';
export const PANEL_POSITION_STORAGE_KEY = 'openclaw.win11.widgets.position.v1';

const DEFAULT_ENABLED_WIDGETS = ['system-health', 'task-pulse', 'clock-widget'];

const SIZE_OPTIONS = [
  { value: 'small', label: '1×1', name: 'Small' },
  { value: 'medium', label: '2×1', name: 'Medium' },
  { value: 'large', label: '2×2', name: 'Large' },
  { value: 'wide', label: '3×1', name: 'Wide' },
  { value: 'tall', label: '1×2', name: 'Tall' },
];

const SIZE_LABELS = Object.fromEntries(SIZE_OPTIONS.map(({ value, label }) => [value, label]));
const VALID_WIDGET_SIZES = new Set(SIZE_OPTIONS.map(({ value }) => value));
const SLOT_SIZE_CLASS_NAMES = SIZE_OPTIONS.map(({ value }) => `widget-slot--${value}`);

/* Pure move-target + reorder math (exported for DB-free tests).
   computeMoveTargets: ordered list of OTHER enabled widget ids (move candidates).
   applyKeyboardReorder: next ordered array, or null when nothing would change. */

export function computeMoveTargets(enabledWidgets, sourceWidgetId) {
  if (!Array.isArray(enabledWidgets)) {
    return [];
  }

  return enabledWidgets.filter((widgetId) => widgetId !== sourceWidgetId);
}

export function applyKeyboardReorder(enabledWidgets, sourceWidgetId, targetWidgetId, position) {
  if (!Array.isArray(enabledWidgets)) {
    return null;
  }

  if (!enabledWidgets.includes(sourceWidgetId) || !enabledWidgets.includes(targetWidgetId)) {
    return null;
  }

  if (sourceWidgetId === targetWidgetId) {
    return null;
  }

  if (position !== 'before' && position !== 'after') {
    return null;
  }

  const nextEnabledWidgets = enabledWidgets.filter((widgetId) => widgetId !== sourceWidgetId);
  const targetIndex = nextEnabledWidgets.indexOf(targetWidgetId);
  if (targetIndex === -1) {
    return null;
  }

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
  nextEnabledWidgets.splice(insertIndex, 0, sourceWidgetId);

  const hasChanged = nextEnabledWidgets.length !== enabledWidgets.length
    || nextEnabledWidgets.some((widgetId, index) => widgetId !== enabledWidgets[index]);

  return hasChanged ? nextEnabledWidgets : null;
}

const DRAG_HANDLE_ICON = `
  <svg viewBox="0 0 10 14" width="10" height="14" aria-hidden="true">
    <circle cx="3" cy="3" r="1.5" fill="currentColor"></circle>
    <circle cx="7" cy="3" r="1.5" fill="currentColor"></circle>
    <circle cx="3" cy="7" r="1.5" fill="currentColor"></circle>
    <circle cx="7" cy="7" r="1.5" fill="currentColor"></circle>
    <circle cx="3" cy="11" r="1.5" fill="currentColor"></circle>
    <circle cx="7" cy="11" r="1.5" fill="currentColor"></circle>
  </svg>
`;

const RESIZE_HANDLE_ICON = `
  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
    <circle cx="2" cy="8" r="1.5" fill="currentColor"></circle>
    <circle cx="5" cy="5" r="1.5" fill="currentColor"></circle>
    <circle cx="8" cy="2" r="1.5" fill="currentColor"></circle>
  </svg>
`;

const toWidgetIcon = (icon) => `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${icon}
  </svg>
`;

export class WidgetPanel {
  /* --------------------------------------------
     Lifecycle
     -------------------------------------------- */

  constructor({
    desktop,
    registry,
    shellAPI,
    taskbar = null,
    mode = 'panel',
  } = {}) {
    if (!desktop) {
      throw new Error('WidgetPanel requires a desktop element.');
    }

    if (!registry) {
      throw new Error('WidgetPanel requires a widget registry.');
    }

    this.desktop = desktop;
    this.registry = registry;
    this.shellAPI = shellAPI || {};
    this.taskbar = taskbar;
    this.mode = mode;
    this.panelPosition = this.loadPanelPosition();
    this.isOpen = mode === 'desktop';
    this.hosts = new Map();
    this.slots = new Map();
    this.widgetConfigs = this.loadWidgetConfigs();
    this.enabledWidgets = this.loadEnabledWidgets();
    this.visibilityObserver = null;
    this.dragState = null;
    this.activeSizePopupWidgetId = null;
    this.activeMoveMenuWidgetId = null;
    this.handlePanelClick = this.handlePanelClick.bind(this);
    this.handleDragStart = this.handleDragStart.bind(this);
    this.handleDragOver = this.handleDragOver.bind(this);
    this.handleDragLeave = this.handleDragLeave.bind(this);
    this.handleDrop = this.handleDrop.bind(this);
    this.handleDragEnd = this.handleDragEnd.bind(this);
    this.handleResizeHandleClick = this.handleResizeHandleClick.bind(this);
    this.handleSizePopupClick = this.handleSizePopupClick.bind(this);
    this.handleMoveMenuClick = this.handleMoveMenuClick.bind(this);
    this.handleMoveMenuKeydown = this.handleMoveMenuKeydown.bind(this);
    this.closeSizePopupOnOutsideClick = this.closeSizePopupOnOutsideClick.bind(this);
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);
  }

  async init() {
    if (!this.registry.loaded && typeof this.registry.loadAll === 'function') {
      await this.registry.loadAll();
    }

    this.sanitizeEnabledWidgets();
    this.createPanelDOM();
    this.createVisibilityObserver();

    for (const widgetId of this.enabledWidgets) {
      this.ensureWidgetSlot(widgetId);
    }

    this.renderPicker();

    if (this.mode === 'desktop') {
      this.panelEl.classList.add('is-open', 'is-desktop-mode');
      this.refreshVisibleWidgets();
    }

    this.applyPanelPosition();

    this.taskbar?.setWidgetsOpen?.(this.isOpen);
  }

  destroy() {
    this.closePicker();
    this.closeSizePopup();
    this.closeMoveMenu();
    this.clearDragState();
    this.unmountAllHosts();
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;

    this.panelEl?.removeEventListener('click', this.handlePanelClick);
    document.removeEventListener('pointerdown', this.closeSizePopupOnOutsideClick);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.panelEl?.remove();
    this.panelEl = null;
    this.gridViewportEl = null;
    this.gridEl = null;

    this.pickerEl = null;
    this.taskbar?.setWidgetsOpen?.(false);
  }

  /* --------------------------------------------
     Public API
     -------------------------------------------- */

  toggle() {
    if (this.isOpen) {
      this.close();
      return;
    }

    this.open();
  }

  open() {
    if (this.mode !== 'desktop') {
      this.isOpen = true;
      this.panelEl?.classList.add('is-open');
      this.panelEl?.setAttribute('aria-hidden', 'false');
      this.taskbar?.setWidgetsOpen?.(true);
    }

    window.requestAnimationFrame(() => this.refreshVisibleWidgets());
  }

  close() {
    if (this.mode !== 'desktop') {
      this.isOpen = false;
      this.panelEl?.classList.remove('is-open');
      this.panelEl?.setAttribute('aria-hidden', 'true');
      this.taskbar?.setWidgetsOpen?.(false);
    }

    this.closePicker();
    this.closeSizePopup();
    this.closeMoveMenu();
    this.clearDragState();
    this.unmountAllHosts();
  }

  async addWidget(widgetId) {
    if (this.slots.has(widgetId)) {
      if (!this.enabledWidgets.includes(widgetId)) {
        this.enabledWidgets.push(widgetId);
        this.saveEnabledWidgets();
      }
      this.renderPicker();
        this.refreshVisibleWidgets();
      return;
    }

    const widgetDef = this.registry.get(widgetId);
    if (!widgetDef) {
      return;
    }

    if (!this.enabledWidgets.includes(widgetId)) {
      this.enabledWidgets.push(widgetId);
      this.saveEnabledWidgets();
    }

    this.ensureWidgetSlot(widgetId);
    this.renderPicker();
    this.refreshVisibleWidgets();
  }

  removeWidget(widgetId) {
    if (this.activeSizePopupWidgetId === widgetId) {
      this.closeSizePopup(widgetId);
    }

    if (this.activeMoveMenuWidgetId === widgetId) {
      this.closeMoveMenu(widgetId);
    }

    if (this.dragState?.sourceWidgetId === widgetId || this.dragState?.targetWidgetId === widgetId) {
      this.clearDragState();
    }

    const slot = this.slots.get(widgetId);
    if (slot) {
      this.visibilityObserver?.unobserve(slot);
      this.unmountWidget(widgetId);
      slot.remove();
      this.slots.delete(widgetId);
    }

    this.enabledWidgets = this.enabledWidgets.filter((id) => id !== widgetId);
    this.saveEnabledWidgets();
    this.renderPicker();
  }

  updateWidgetConfig(widgetId, nextConfig = {}) {
    const widgetDef = this.registry.get(widgetId);
    const fallbackSize = widgetDef?.manifest?.size;
    const previousSize = this.getWidgetSize(widgetId, fallbackSize);
    const sanitizedConfig = { ...(nextConfig || {}) };

    if (Object.prototype.hasOwnProperty.call(sanitizedConfig, 'size') && !this.isValidWidgetSize(sanitizedConfig.size)) {
      delete sanitizedConfig.size;
    }

    this.widgetConfigs[widgetId] = {
      ...(this.widgetConfigs[widgetId] || {}),
      ...sanitizedConfig,
    };

    const nextSize = this.getWidgetSize(widgetId, fallbackSize);
    const slot = this.slots.get(widgetId);

    if (slot && nextSize !== previousSize) {
      this.applySlotSize(slot, nextSize);
      this.updateSizePopupSelection(widgetId);
    }

    this.saveWidgetConfigs();

    const host = this.hosts.get(widgetId);
    host?.updateConfig(this.widgetConfigs[widgetId]);

    if (host && nextSize !== previousSize) {
      host.resize(nextSize);
    }

    if (nextSize !== previousSize) {
      this.renderPicker();
      window.requestAnimationFrame(() => this.refreshVisibleWidgets());
    }
  }

  /* --------------------------------------------
     DOM + UI
     -------------------------------------------- */

  createPanelDOM() {
    this.panelEl = document.createElement('aside');
    this.panelEl.className = `win11-widget-panel win11-widget-panel--${this.mode}`;
    this.panelEl.setAttribute('aria-hidden', this.isOpen ? 'false' : 'true');
    this.panelEl.innerHTML = `
      <div class="win11-widget-panel__surface" role="complementary" aria-label="Widgets panel">
        <div class="win11-widget-panel__header">
          <div>
            <div class="win11-widget-panel__eyebrow">OpenClaw</div>
            <h2 class="win11-widget-panel__title">Widgets</h2>
          </div>
          <div class="win11-widget-panel__header-actions">
            <button type="button" class="win11-widget-panel__position-toggle" data-action="toggle-position" aria-label="Move panel to right" title="Move panel to right">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12h18"></path>
                <path d="M15 6l6 6-6 6"></path>
              </svg>
            </button>
            <button type="button" class="win11-widget-panel__picker-toggle" data-action="toggle-picker" aria-label="Add widgets">
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </div>
        <div class="win11-widget-panel__body" data-role="grid-viewport">
          <div class="win11-widget-panel__grid" data-role="grid"></div>
        </div>
      </div>
      <div class="win11-widget-picker" data-role="picker" hidden>
        <div class="win11-widget-picker__backdrop" data-action="close-picker"></div>
        <div class="win11-widget-picker__dialog" role="dialog" aria-modal="true" aria-label="Add widgets">
          <div class="win11-widget-picker__header">
            <h3 class="win11-widget-picker__title">Add Widgets</h3>
            <button type="button" class="win11-widget-picker__close" data-action="close-picker" aria-label="Close widget picker">×</button>
          </div>
          <div class="win11-widget-picker__list" data-role="picker-list"></div>
        </div>
      </div>
    `;

    this.gridViewportEl = this.panelEl.querySelector('[data-role="grid-viewport"]');
    this.gridEl = this.panelEl.querySelector('[data-role="grid"]');
    this.pickerEl = this.panelEl.querySelector('[data-role="picker"]');
    this.pickerListEl = this.panelEl.querySelector('[data-role="picker-list"]');
    this.panelEl.addEventListener('click', this.handlePanelClick);
    document.addEventListener('pointerdown', this.closeSizePopupOnOutsideClick);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
    this.desktop.append(this.panelEl);
  }

  async handlePanelClick(event) {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) {
      return;
    }

    const { action } = actionElement.dataset;
    if (action === 'toggle-picker') {
      this.togglePicker();
      return;
    }

    if (action === 'close-picker') {
      this.closePicker();
      return;
    }

    if (action === 'toggle-position') {
      const next = this.panelPosition === 'left' ? 'right' : this.panelPosition === 'right' ? 'top' : 'left';
      this.setPanelPosition(next);
      return;
    }

    if (action === 'toggle-widget') {
      const { widgetId } = actionElement.dataset;
      if (!widgetId) {
        return;
      }

      if (this.enabledWidgets.includes(widgetId)) {
        this.removeWidget(widgetId);
      } else {
        await this.addWidget(widgetId);
      }
      this.closePicker();
    }
  }

  renderPicker() {
    if (!this.pickerListEl) {
      return;
    }

    const manifests = this.registry.list();
    this.pickerListEl.innerHTML = manifests.map((manifest) => {
      const isEnabled = this.enabledWidgets.includes(manifest.id);
      const stateLabel = isEnabled ? 'Enabled' : 'Add';
      const currentSize = this.getWidgetSize(manifest.id, manifest.size);

      return `
        <button
          type="button"
          class="win11-widget-picker__item${isEnabled ? ' is-enabled' : ''}"
          data-action="toggle-widget"
          data-widget-id="${escapeHtml(manifest.id)}"
          aria-pressed="${isEnabled ? 'true' : 'false'}"
        >
          <span class="win11-widget-picker__item-icon">${toWidgetIcon(manifest.icon)}</span>
          <span class="win11-widget-picker__item-body">
            <span class="win11-widget-picker__item-title-row">
              <span class="win11-widget-picker__item-title">${escapeHtml(manifest.label)}</span>
              <span class="win11-widget-picker__item-size">${escapeHtml(SIZE_LABELS[currentSize] || currentSize)}</span>
            </span>
            <span class="win11-widget-picker__item-copy">${escapeHtml(manifest.description)}</span>
          </span>
          <span class="win11-widget-picker__item-state">${stateLabel}</span>
        </button>
      `;
    }).join('');
  }

  togglePicker() {
    if (this.pickerEl?.hidden) {
      this.openPicker();
      return;
    }

    this.closePicker();
  }

  openPicker() {
    if (!this.pickerEl) {
      return;
    }

    this.renderPicker();
    this.pickerEl.hidden = false;
    this.pickerEl.classList.add('is-open');
  }

  closePicker() {
    if (!this.pickerEl) {
      return;
    }

    this.pickerEl.hidden = true;
    this.pickerEl.classList.remove('is-open');
  }

  updateEmptyState() { /* no-op: empty state removed */ }

  /* --------------------------------------------
     Slot Controls
     -------------------------------------------- */

  isValidWidgetSize(size) {
    return VALID_WIDGET_SIZES.has(size);
  }

  getWidgetSize(widgetId, fallbackSize = 'small') {
    const configuredSize = this.widgetConfigs?.[widgetId]?.size;

    if (this.isValidWidgetSize(configuredSize)) {
      return configuredSize;
    }

    if (this.isValidWidgetSize(fallbackSize)) {
      return fallbackSize;
    }

    return 'small';
  }

  applySlotSize(slot, size) {
    if (!slot) {
      return 'small';
    }

    const nextSize = this.isValidWidgetSize(size) ? size : 'small';
    slot.classList.remove(...SLOT_SIZE_CLASS_NAMES);
    slot.classList.add(`widget-slot--${nextSize}`);
    slot.dataset.widgetSize = nextSize;
    return nextSize;
  }

  createDragHandle(widgetLabel) {
    const dragHandleEl = document.createElement('button');
    dragHandleEl.type = 'button';
    dragHandleEl.className = 'widget-slot__drag-handle';
    dragHandleEl.setAttribute('aria-label', `Reorder ${widgetLabel} (opens move menu)`);
    dragHandleEl.setAttribute('title', `Reorder ${widgetLabel} (opens move menu)`);
    dragHandleEl.setAttribute('aria-haspopup', 'menu');
    dragHandleEl.setAttribute('aria-expanded', 'false');
    dragHandleEl.draggable = true;
    dragHandleEl.innerHTML = DRAG_HANDLE_ICON;
    dragHandleEl.addEventListener('dragstart', this.handleDragStart);
    dragHandleEl.addEventListener('dragend', this.handleDragEnd);
    dragHandleEl.addEventListener('click', this.handleDragHandleClick);
    return dragHandleEl;
  }

  createResizeHandle(widgetLabel) {
    const resizeHandleEl = document.createElement('button');
    resizeHandleEl.type = 'button';
    resizeHandleEl.className = 'widget-slot__resize-handle';
    resizeHandleEl.setAttribute('aria-label', `Resize ${widgetLabel}`);
    resizeHandleEl.setAttribute('aria-haspopup', 'menu');
    resizeHandleEl.setAttribute('aria-expanded', 'false');
    resizeHandleEl.setAttribute('title', `Resize ${widgetLabel}`);
    resizeHandleEl.innerHTML = RESIZE_HANDLE_ICON;
    resizeHandleEl.addEventListener('click', this.handleResizeHandleClick);
    return resizeHandleEl;
  }

  createSizePopup(widgetLabel) {
    const sizePopupEl = document.createElement('div');
    sizePopupEl.className = 'widget-slot__size-popup';
    sizePopupEl.hidden = true;
    sizePopupEl.setAttribute('role', 'menu');
    sizePopupEl.setAttribute('aria-label', `${widgetLabel} size options`);
    sizePopupEl.addEventListener('click', this.handleSizePopupClick);

    SIZE_OPTIONS.forEach(({ value, label, name }) => {
      const optionEl = document.createElement('button');
      optionEl.type = 'button';
      optionEl.className = 'widget-slot__size-popup-item';
      optionEl.dataset.size = value;
      optionEl.setAttribute('role', 'menuitemradio');
      optionEl.setAttribute('aria-checked', 'false');
      optionEl.innerHTML = `
        <span class="widget-slot__size-popup-item-label">${label}</span>
        <span class="widget-slot__size-popup-item-name">${name}</span>
      `;
      sizePopupEl.appendChild(optionEl);
    });

    return sizePopupEl;
  }

  updateSizePopupSelection(widgetId) {
    const slot = this.slots.get(widgetId);
    const popupEl = slot?.querySelector('.widget-slot__size-popup');
    const widgetDef = this.registry.get(widgetId);
    const activeSize = this.getWidgetSize(widgetId, widgetDef?.manifest?.size);

    popupEl?.querySelectorAll('.widget-slot__size-popup-item').forEach((item) => {
      const isActive = item.dataset.size === activeSize;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  handleResizeHandleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const slot = event.currentTarget.closest('.widget-slot');
    const widgetId = slot?.dataset.widgetId;
    if (!widgetId) {
      return;
    }

    this.openSizePopup(widgetId);
  }

  handleSizePopupClick(event) {
    const sizeOptionEl = event.target.closest('.widget-slot__size-popup-item');
    if (!sizeOptionEl) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const slot = event.currentTarget.closest('.widget-slot');
    const widgetId = slot?.dataset.widgetId;
    const { size } = sizeOptionEl.dataset;
    if (!widgetId || !size) {
      return;
    }

    this.handleSizeChange(widgetId, size);
  }

  openSizePopup(widgetId) {
    const slot = this.slots.get(widgetId);
    const popupEl = slot?.querySelector('.widget-slot__size-popup');
    const resizeHandleEl = slot?.querySelector('.widget-slot__resize-handle');
    if (!slot || !popupEl || !resizeHandleEl) {
      return;
    }

    if (this.activeSizePopupWidgetId === widgetId && !popupEl.hidden) {
      this.closeSizePopup(widgetId);
      return;
    }

    this.closeSizePopup();
    this.updateSizePopupSelection(widgetId);
    slot.classList.add('has-open-size-popup');
    popupEl.hidden = false;
    resizeHandleEl.setAttribute('aria-expanded', 'true');
    this.activeSizePopupWidgetId = widgetId;
  }

  closeSizePopup(widgetId = this.activeSizePopupWidgetId) {
    if (!widgetId) {
      return;
    }

    const slot = this.slots.get(widgetId);
    const popupEl = slot?.querySelector('.widget-slot__size-popup');
    const resizeHandleEl = slot?.querySelector('.widget-slot__resize-handle');

    if (popupEl) {
      popupEl.hidden = true;
    }

    slot?.classList.remove('has-open-size-popup');
    resizeHandleEl?.setAttribute('aria-expanded', 'false');

    if (this.activeSizePopupWidgetId === widgetId) {
      this.activeSizePopupWidgetId = null;
    }
  }

  closeSizePopupOnOutsideClick(event) {
    if (!this.activeSizePopupWidgetId && !this.activeMoveMenuWidgetId) {
      return;
    }

    const activeSlot = this.slots.get(this.activeSizePopupWidgetId || this.activeMoveMenuWidgetId);
    if (activeSlot?.contains(event.target)) {
      return;
    }

    this.closeSizePopup();
    this.closeMoveMenu();
  }

  handleDocumentKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (this.activeSizePopupWidgetId) {
      event.preventDefault();
      this.closeSizePopup();
      return;
    }

    if (this.activeMoveMenuWidgetId) {
      event.preventDefault();
      this.closeMoveMenu();
    }
  }

  handleSizeChange(widgetId, newSize) {
    if (!this.isValidWidgetSize(newSize)) {
      return;
    }

    const widgetDef = this.registry.get(widgetId);
    const currentSize = this.getWidgetSize(widgetId, widgetDef?.manifest?.size);
    if (currentSize === newSize) {
      this.closeSizePopup(widgetId);
      return;
    }

    this.updateWidgetConfig(widgetId, { size: newSize });
    this.closeSizePopup(widgetId);
  }

  /* --------------------------------------------
     Keyboard / Touch Reorder (move menu)
     -------------------------------------------- */

  handleDragHandleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const slot = event.currentTarget.closest('.widget-slot');
    const widgetId = slot?.dataset.widgetId;
    if (!widgetId) {
      return;
    }

    this.openMoveMenu(widgetId);
  }

  createMoveMenu(widgetLabel) {
    const moveMenuEl = document.createElement('div');
    moveMenuEl.className = 'widget-slot__move-menu';
    moveMenuEl.hidden = true;
    moveMenuEl.setAttribute('role', 'menu');
    moveMenuEl.setAttribute('aria-label', `Move ${widgetLabel} relative to another widget`);
    moveMenuEl.addEventListener('click', this.handleMoveMenuClick);
    moveMenuEl.addEventListener('keydown', this.handleMoveMenuKeydown);
    return moveMenuEl;
  }

  renderMoveMenuItems(widgetId) {
    const slot = this.slots.get(widgetId);
    const moveMenuEl = slot?.querySelector('.widget-slot__move-menu');
    if (!moveMenuEl) {
      return;
    }

    const targets = computeMoveTargets(this.enabledWidgets, widgetId);
    moveMenuEl.innerHTML = '';

    if (targets.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'widget-slot__move-menu-empty';
      emptyEl.textContent = 'No other widgets to move relative to.';
      moveMenuEl.appendChild(emptyEl);
      return;
    }

    targets.forEach((targetWidgetId) => {
      const targetDef = this.registry.get(targetWidgetId);
      const targetLabel = targetDef?.manifest?.label || targetWidgetId;

      const beforeEl = document.createElement('button');
      beforeEl.type = 'button';
      beforeEl.className = 'widget-slot__move-menu-item';
      beforeEl.dataset.targetWidgetId = targetWidgetId;
      beforeEl.dataset.position = 'before';
      beforeEl.setAttribute('role', 'menuitem');
      beforeEl.innerHTML = `
        <span class="widget-slot__move-menu-item-label">Before ${escapeHtml(targetLabel)}</span>
      `;
      moveMenuEl.appendChild(beforeEl);

      const afterEl = document.createElement('button');
      afterEl.type = 'button';
      afterEl.className = 'widget-slot__move-menu-item';
      afterEl.dataset.targetWidgetId = targetWidgetId;
      afterEl.dataset.position = 'after';
      afterEl.setAttribute('role', 'menuitem');
      afterEl.innerHTML = `
        <span class="widget-slot__move-menu-item-label">After ${escapeHtml(targetLabel)}</span>
      `;
      moveMenuEl.appendChild(afterEl);
    });
  }

  openMoveMenu(widgetId) {
    const slot = this.slots.get(widgetId);
    const moveMenuEl = slot?.querySelector('.widget-slot__move-menu');
    const dragHandleEl = slot?.querySelector('.widget-slot__drag-handle');
    if (!slot || !moveMenuEl || !dragHandleEl) {
      return;
    }

    if (this.activeMoveMenuWidgetId === widgetId && !moveMenuEl.hidden) {
      this.closeMoveMenu(widgetId);
      return;
    }

    this.closeMoveMenu();
    this.closeSizePopup();
    this.renderMoveMenuItems(widgetId);
    slot.classList.add('has-open-move-menu');
    moveMenuEl.hidden = false;
    dragHandleEl.setAttribute('aria-expanded', 'true');
    this.activeMoveMenuWidgetId = widgetId;

    const firstItemEl = moveMenuEl.querySelector('.widget-slot__move-menu-item');
    firstItemEl?.focus();
  }

  closeMoveMenu(widgetId = this.activeMoveMenuWidgetId) {
    if (!widgetId) {
      return;
    }

    const slot = this.slots.get(widgetId);
    const moveMenuEl = slot?.querySelector('.widget-slot__move-menu');
    const dragHandleEl = slot?.querySelector('.widget-slot__drag-handle');

    if (moveMenuEl && !moveMenuEl.hidden) {
      moveMenuEl.hidden = true;
      dragHandleEl?.focus();
    }

    slot?.classList.remove('has-open-move-menu');
    dragHandleEl?.setAttribute('aria-expanded', 'false');

    if (this.activeMoveMenuWidgetId === widgetId) {
      this.activeMoveMenuWidgetId = null;
    }
  }

  handleMoveMenuClick(event) {
    const moveItemEl = event.target.closest('.widget-slot__move-menu-item');
    if (!moveItemEl) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const slot = event.currentTarget.closest('.widget-slot');
    const widgetId = slot?.dataset.widgetId;
    const { targetWidgetId, position } = moveItemEl.dataset;
    if (!widgetId || !targetWidgetId || !position) {
      return;
    }

    this.commitKeyboardReorder(widgetId, targetWidgetId, position);
  }

  handleMoveMenuKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.closeMoveMenu();
  }

  commitKeyboardReorder(sourceWidgetId, targetWidgetId, position) {
    const nextEnabledWidgets = applyKeyboardReorder(this.enabledWidgets, sourceWidgetId, targetWidgetId, position);

    if (nextEnabledWidgets) {
      this.enabledWidgets = nextEnabledWidgets;
      this.reorderSlotDOM(sourceWidgetId, targetWidgetId, position);
      this.saveEnabledWidgets();
      this.refreshVisibleWidgets();
    }

    this.closeMoveMenu(sourceWidgetId);
  }

  /* --------------------------------------------
     Drag + Drop
     -------------------------------------------- */

  getDropPosition(slot, clientX) {
    const rect = slot.getBoundingClientRect();
    const midpoint = rect.left + (rect.width / 2);
    return clientX <= midpoint ? 'before' : 'after';
  }

  updateDropIndicators(targetWidgetId, position) {
    this.slots.forEach((slot, widgetId) => {
      const isTarget = widgetId === targetWidgetId;
      slot.classList.toggle('is-drag-over', isTarget);
      slot.classList.toggle('is-drop-target-before', isTarget && position === 'before');
      slot.classList.toggle('is-drop-target-after', isTarget && position === 'after');
      slot.classList.toggle('is-drag-before', isTarget && position === 'before');
      slot.classList.toggle('is-drag-after', isTarget && position === 'after');
    });
  }

  clearDropIndicators() {
    this.slots.forEach((slot) => {
      slot.classList.remove(
        'is-drag-over',
        'is-drop-target-before',
        'is-drop-target-after',
        'is-drag-before',
        'is-drag-after',
      );
    });
  }

  clearDragState() {
    this.clearDropIndicators();
    this.slots.forEach((slot) => {
      slot.classList.remove('is-dragging');
    });

    this.dragState = null;
  }

  reorderEnabledWidgets(sourceWidgetId, targetWidgetId, position) {
    const nextEnabledWidgets = applyKeyboardReorder(this.enabledWidgets, sourceWidgetId, targetWidgetId, position);

    if (!nextEnabledWidgets) {
      return false;
    }

    this.enabledWidgets = nextEnabledWidgets;
    return true;
  }

  reorderSlotDOM(sourceWidgetId, targetWidgetId, position) {
    if (!this.gridEl) {
      return;
    }

    const sourceSlot = this.slots.get(sourceWidgetId);
    const targetSlot = this.slots.get(targetWidgetId);
    if (!sourceSlot || !targetSlot || sourceSlot === targetSlot) {
      return;
    }

    const referenceNode = position === 'after' ? targetSlot.nextSibling : targetSlot;
    this.gridEl.insertBefore(sourceSlot, referenceNode);
  }

  handleDragStart(event) {
    const slot = event.currentTarget.closest('.widget-slot');
    const widgetId = slot?.dataset.widgetId;
    if (!slot || !widgetId) {
      event.preventDefault();
      return;
    }

    this.closeSizePopup();
    this.closeMoveMenu();
    this.clearDragState();

    this.dragState = {
      sourceWidgetId: widgetId,
      targetWidgetId: null,
      position: null,
    };

    slot.classList.add('is-dragging');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', widgetId);

      if (typeof event.dataTransfer.setDragImage === 'function') {
        const rect = slot.getBoundingClientRect();
        event.dataTransfer.setDragImage(slot, rect.width / 2, rect.height / 2);
      }
    }
  }

  handleDragOver(event) {
    if (!this.dragState?.sourceWidgetId) {
      return;
    }

    const slot = event.currentTarget;
    const widgetId = slot?.dataset?.widgetId;
    if (!slot || !widgetId) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    if (widgetId === this.dragState.sourceWidgetId) {
      this.clearDropIndicators();
      this.dragState.targetWidgetId = null;
      this.dragState.position = null;
      return;
    }

    const position = this.getDropPosition(slot, event.clientX);
    this.dragState.targetWidgetId = widgetId;
    this.dragState.position = position;
    this.updateDropIndicators(widgetId, position);
  }

  handleDragLeave(event) {
    if (!this.dragState?.sourceWidgetId) {
      return;
    }

    const slot = event.currentTarget;
    const rect = slot?.getBoundingClientRect?.();
    if (!slot || !rect) {
      return;
    }

    const hasLeftSlot = event.clientX < rect.left
      || event.clientX > rect.right
      || event.clientY < rect.top
      || event.clientY > rect.bottom;

    if (!hasLeftSlot) {
      return;
    }

    slot.classList.remove('is-drag-over', 'is-drop-target-before', 'is-drop-target-after', 'is-drag-before', 'is-drag-after');

    if (this.dragState.targetWidgetId === slot.dataset.widgetId) {
      this.dragState.targetWidgetId = null;
      this.dragState.position = null;
    }
  }

  handleDrop(event) {
    if (!this.dragState?.sourceWidgetId) {
      return;
    }

    event.preventDefault();

    const slot = event.currentTarget;
    const targetWidgetId = slot?.dataset?.widgetId;
    const sourceWidgetId = this.dragState.sourceWidgetId;
    const position = targetWidgetId ? this.getDropPosition(slot, event.clientX) : this.dragState.position;

    let didReorder = false;
    if (targetWidgetId && targetWidgetId !== sourceWidgetId && position) {
      didReorder = this.reorderEnabledWidgets(sourceWidgetId, targetWidgetId, position);

      if (didReorder) {
        this.reorderSlotDOM(sourceWidgetId, targetWidgetId, position);
      }
    }

    this.clearDragState();

    if (!didReorder) {
      return;
    }

    this.saveEnabledWidgets();
    this.refreshVisibleWidgets();
  }

  handleDragEnd() {
    this.clearDragState();
  }

  /* --------------------------------------------
     Slots + Lazy Mounting
     -------------------------------------------- */

  createVisibilityObserver() {
    if (typeof IntersectionObserver !== 'function') {
      return;
    }

    this.visibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const widgetId = entry.target.dataset.widgetId;
        if (!widgetId) {
          return;
        }

        const shouldMount = entry.isIntersecting && (this.mode === 'desktop' || this.isOpen);
        if (shouldMount) {
          void this.mountWidget(widgetId);
        } else {
          this.unmountWidget(widgetId);
        }
      });
    }, {
      root: this.gridViewportEl,
      threshold: 0.05,
    });
  }

  ensureWidgetSlot(widgetId) {
    const widgetDef = this.registry.get(widgetId);
    if (!widgetDef || this.slots.has(widgetId) || !this.gridEl) {
      return null;
    }

    const slot = document.createElement('section');
    slot.className = 'widget-slot';
    slot.dataset.widgetId = widgetId;
    this.applySlotSize(slot, this.getWidgetSize(widgetId, widgetDef.manifest.size));

    slot.addEventListener('dragover', this.handleDragOver);
    slot.addEventListener('dragleave', this.handleDragLeave);
    slot.addEventListener('drop', this.handleDrop);

    const hostMount = document.createElement('div');
    hostMount.className = 'widget-slot__host';
    slot.appendChild(hostMount);

    slot.appendChild(this.createDragHandle(widgetDef.manifest.label));
    slot.appendChild(this.createResizeHandle(widgetDef.manifest.label));
    slot.appendChild(this.createSizePopup(widgetDef.manifest.label));
    slot.appendChild(this.createMoveMenu(widgetDef.manifest.label));

    this.gridEl.appendChild(slot);
    this.slots.set(widgetId, slot);
    this.updateSizePopupSelection(widgetId);
    this.visibilityObserver?.observe(slot);

    return slot;
  }

  async mountWidget(widgetId) {
    if (this.hosts.has(widgetId)) {
      return this.hosts.get(widgetId);
    }

    const widgetDef = this.registry.get(widgetId);
    const slot = this.slots.get(widgetId);
    const hostMount = slot?.querySelector('.widget-slot__host');

    if (!widgetDef || !hostMount) {
      return null;
    }

    const host = new WidgetHost(widgetDef, hostMount, this.shellAPI, this.widgetConfigs[widgetId]);
    host.currentSize = this.getWidgetSize(widgetId, widgetDef.manifest.size);
    this.hosts.set(widgetId, host);

    try {
      await host.mount();
      return host;
    } catch (error) {
      console.warn(`[WidgetPanel] Failed to mount widget "${widgetId}":`, error);
      return host;
    }
  }

  unmountWidget(widgetId) {
    const host = this.hosts.get(widgetId);
    if (!host) {
      return;
    }

    host.unmount();
    this.hosts.delete(widgetId);
  }

  unmountAllHosts() {
    [...this.hosts.keys()].forEach((widgetId) => this.unmountWidget(widgetId));
  }

  refreshVisibleWidgets() {
    if (!this.gridViewportEl) {
      return;
    }

    if (!this.visibilityObserver) {
      this.enabledWidgets.forEach((widgetId) => {
        if (this.mode === 'desktop' || this.isOpen) {
          void this.mountWidget(widgetId);
        } else {
          this.unmountWidget(widgetId);
        }
      });
      return;
    }

    const rootRect = this.gridViewportEl.getBoundingClientRect();
    this.slots.forEach((slot, widgetId) => {
      const slotRect = slot.getBoundingClientRect();
      const isVisible = slotRect.bottom >= rootRect.top && slotRect.top <= rootRect.bottom;
      const shouldMount = isVisible && (this.mode === 'desktop' || this.isOpen);

      if (shouldMount) {
        void this.mountWidget(widgetId);
      } else {
        this.unmountWidget(widgetId);
      }
    });
  }

  /* --------------------------------------------
     Panel Position
     -------------------------------------------- */

  loadPanelPosition() {
    try {
      const stored = localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
      const valid = ['left', 'right', 'top'];
      return valid.includes(stored) ? stored : 'left';
    } catch {
      return 'left';
    }
  }

  savePanelPosition() {
    try {
      localStorage.setItem(PANEL_POSITION_STORAGE_KEY, this.panelPosition);
    } catch {
      // ignore
    }
  }

  setPanelPosition(position) {
    const valid = ['left', 'right', 'top'];
    if (!valid.includes(position)) return;
    this.panelPosition = position;
    this.savePanelPosition();
    this.applyPanelPosition();
  }

  applyPanelPosition() {
    if (!this.panelEl) return;
    this.panelEl.classList.remove('win11-widget-panel--pos-left', 'win11-widget-panel--pos-right', 'win11-widget-panel--pos-top');
    this.panelEl.classList.add(`win11-widget-panel--pos-${this.panelPosition}`);
    // Update the position toggle icon
    const posBtn = this.panelEl.querySelector('[data-action="toggle-position"]');
    if (posBtn) {
      posBtn.title = `Move panel to ${this.panelPosition === 'left' ? 'right' : this.panelPosition === 'right' ? 'top' : 'left'}`;
      posBtn.setAttribute('aria-label', posBtn.title);
    }
  }

  /* --------------------------------------------
     Persistence
     -------------------------------------------- */

  sanitizeEnabledWidgets() {
    const availableIds = new Set(this.registry.list().map((manifest) => manifest.id));
    const nextEnabled = this.enabledWidgets.filter((widgetId) => availableIds.has(widgetId));

    if (nextEnabled.length === 0 && this.enabledWidgets.length > 0) {
      this.enabledWidgets = [];
      this.saveEnabledWidgets();
      return;
    }

    if (nextEnabled.length !== this.enabledWidgets.length) {
      this.enabledWidgets = nextEnabled;
      this.saveEnabledWidgets();
    }
  }

  loadEnabledWidgets() {
    try {
      const stored = localStorage.getItem(PANEL_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [...DEFAULT_ENABLED_WIDGETS];
    } catch (error) {
      console.warn('[WidgetPanel] Unable to read widget preferences:', error);
      return [...DEFAULT_ENABLED_WIDGETS];
    }
  }

  saveEnabledWidgets() {
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(this.enabledWidgets));
    } catch (error) {
      console.warn('[WidgetPanel] Unable to persist widget preferences:', error);
    }
  }

  loadWidgetConfigs() {
    try {
      const stored = localStorage.getItem(DESKTOP_LAYOUT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.warn('[WidgetPanel] Unable to read widget config:', error);
      return {};
    }
  }

  saveWidgetConfigs() {
    try {
      localStorage.setItem(DESKTOP_LAYOUT_STORAGE_KEY, JSON.stringify(this.widgetConfigs));
    } catch (error) {
      console.warn('[WidgetPanel] Unable to persist widget config:', error);
    }
  }
}

export default WidgetPanel;
