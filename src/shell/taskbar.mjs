import APP_REGISTRY, { PINNED_APP_IDS, getAppById } from './app-registry.mjs';
import { ACCENT_PACKS } from './accent-packs.mjs';

const startIcon = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="4" y="4" width="7" height="7" rx="1.4"></rect>
    <rect x="13" y="4" width="7" height="7" rx="1.4"></rect>
    <rect x="4" y="13" width="7" height="7" rx="1.4"></rect>
    <rect x="13" y="13" width="7" height="7" rx="1.4"></rect>
  </svg>
`;

const bellIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 15.5h12l-1.2-1.6a4 4 0 0 1-.8-2.4V10a4 4 0 1 0-8 0v1.5a4 4 0 0 1-.8 2.4L6 15.5Z"></path>
    <path d="M10 18a2 2 0 0 0 4 0"></path>
  </svg>
`;

const widgetsIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5"></rect>
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"></rect>
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"></rect>
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"></rect>
  </svg>
`;

const moonIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19 14.6A7 7 0 0 1 9.4 5a7.5 7.5 0 1 0 9.6 9.6Z"></path>
  </svg>
`;

const sunIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.5"></circle>
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"></path>
  </svg>
`;

const paletteIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 0 18h1.2a2.3 2.3 0 0 0 1.6-3.9 2.3 2.3 0 0 1 1.6-3.9H19A2.9 2.9 0 0 0 21.9 10 9.4 9.4 0 0 0 12 3Z"></path>
    <circle cx="7.6" cy="10.2" r="1.15" fill="currentColor" stroke="none"></circle>
    <circle cx="12" cy="7.4" r="1.15" fill="currentColor" stroke="none"></circle>
    <circle cx="16.4" cy="10.2" r="1.15" fill="currentColor" stroke="none"></circle>
    <circle cx="8.9" cy="14.8" r="1.15" fill="currentColor" stroke="none"></circle>
  </svg>
`;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export class Taskbar extends EventTarget {
  constructor({
    root,
    apps = APP_REGISTRY,
    pinnedAppIds = PINNED_APP_IDS,
    sync = null,
    onStartToggle = () => {},
    onWidgetsToggle = () => {},
    onAppActivate = () => {},
    onThemeToggle = () => {},
    onAccentChange = () => {},
    initialTheme = 'light',
    initialAccent = 'default',
  } = {}) {
    super();

    if (!root) {
      throw new Error('Taskbar requires a root element.');
    }

    this.root = root;
    this.apps = apps;
    this.pinnedApps = pinnedAppIds.map((appId) => getAppById(appId)).filter(Boolean);
    this.sync = sync;
    this.onStartToggle = onStartToggle;
    this.onWidgetsToggle = onWidgetsToggle;
    this.onAppActivate = onAppActivate;
    this.onThemeToggle = onThemeToggle;
    this.onAccentChange = onAccentChange;
    this.theme = initialTheme;
    this.accent = initialAccent;
    this.widgetsOpen = false;
    this.snapshot = { activeAppId: null, windows: [] };
    this.clockInterval = null;
    this.syncUnsubscribe = null;
    this.notificationState = {
      blockers: 0,
      approvals: 0,
      workflows: 0,
    };

    this.render();
    this.startClock();
    this.subscribeToSync();
  }

  subscribeToSync() {
    if (!this.sync) return;
    
    this.syncUnsubscribe = this.sync.subscribe((data, changedKeys) => {
      this.updateNotifications(data);
    });
  }

  updateNotifications(data) {
    const blockersSummary = data.blockersSummary;
    const approvalsPending = data.approvalsPending;
    const activeWorkflowRuns = data.activeWorkflowRuns;

    const blockersCount = blockersSummary?.total || 0;
    const approvalsCount = approvalsPending?.approvals?.length || 0;
    const workflowsCount = activeWorkflowRuns?.runs?.length || 0;

    const changed = 
      this.notificationState.blockers !== blockersCount ||
      this.notificationState.approvals !== approvalsCount ||
      this.notificationState.workflows !== workflowsCount;

    this.notificationState = {
      blockers: blockersCount,
      approvals: approvalsCount,
      workflows: workflowsCount,
    };

    if (changed) {
      this.renderNotificationBadges();
    }
  }

  renderNotificationBadges() {
    const { blockers, approvals, workflows } = this.notificationState;

    // Update blockers badge on taskbar (red badge)
    const blockersBadge = this.root.querySelector('[data-role="blockers-badge"]');
    if (blockersBadge) {
      if (blockers > 0) {
        blockersBadge.style.display = 'flex';
        blockersBadge.textContent = blockers > 99 ? '99+' : blockers;
      } else {
        blockersBadge.style.display = 'none';
      }
    }

    // Update approvals badge (yellow/warning badge)
    const approvalsBadge = this.root.querySelector('[data-role="approvals-badge"]');
    if (approvalsBadge) {
      if (approvals > 0) {
        approvalsBadge.style.display = 'flex';
        approvalsBadge.textContent = approvals > 99 ? '99+' : approvals;
      } else {
        approvalsBadge.style.display = 'none';
      }
    }

    // Update workflows pulse indicator
    const workflowsIndicator = this.root.querySelector('[data-role="workflows-pulse"]');
    if (workflowsIndicator) {
      if (workflows > 0) {
        workflowsIndicator.classList.add('is-active');
        workflowsIndicator.title = `${workflows} active workflow${workflows !== 1 ? 's' : ''}`;
      } else {
        workflowsIndicator.classList.remove('is-active');
      }
    }
  }

  render() {
    const pinnedIcons = this.pinnedApps.map((app) => `
      <button type="button" class="win11-taskbar__button win11-taskbar__app" data-app-id="${app.id}" aria-label="${escapeHtml(app.label)}" title="${escapeHtml(app.label)}">
        <span class="win11-app-icon win11-taskbar__app-icon">${app.icon}</span>
        <span class="win11-taskbar__indicator" aria-hidden="true"></span>
        <span class="win11-taskbar__tooltip">${escapeHtml(app.label)}</span>
      </button>
    `).join('');

    this.root.innerHTML = `
      <nav class="win11-taskbar" aria-label="Desktop taskbar">
        <div class="win11-taskbar__section win11-taskbar__section--left">
          <button type="button" class="win11-taskbar__button win11-taskbar__start-button" data-action="start" aria-label="Open Start menu">
            <span class="win11-taskbar__glyph">${startIcon}</span>
            <span class="win11-taskbar__tooltip">Start</span>
          </button>
          <button type="button" class="win11-taskbar__button win11-taskbar__widgets-button" data-action="widgets" aria-label="Toggle widgets" aria-pressed="false">
            <span class="win11-taskbar__glyph">${widgetsIcon}</span>
            <span class="win11-taskbar__tooltip">Widgets</span>
          </button>
          <div class="win11-taskbar__status-indicators" style="display:flex;align-items:center;gap:4px;margin-left:8px;">
            <div data-role="workflows-pulse" class="win11-taskbar__pulse" title="Active workflows" style="
              width:8px;height:8px;border-radius:50%;background:var(--win11-accent);opacity:0.3;
            "></div>
          </div>
        </div>
        <div class="win11-taskbar__section win11-taskbar__section--center" data-role="pinned-apps">
          ${pinnedIcons}
        </div>
        <div class="win11-taskbar__section win11-taskbar__section--right">
          <div class="win11-taskbar__notifications" style="display:flex;align-items:center;gap:2px;position:relative;">
            <span data-role="blockers-badge" class="win11-taskbar__badge win11-taskbar__badge--error" style="
              display:none;position:absolute;top:-4px;left:-4px;
              min-width:16px;height:16px;border-radius:8px;
              background:#ef4444;color:#fff;font-size:0.65rem;font-weight:600;
              align-items:center;justify-content:center;padding:0 4px;
              z-index:1;
            ">0</span>
            <span data-role="approvals-badge" class="win11-taskbar__badge win11-taskbar__badge--warning" style="
              display:none;position:absolute;top:-4px;left:12px;
              min-width:16px;height:16px;border-radius:8px;
              background:#eab308;color:#000;font-size:0.65rem;font-weight:600;
              align-items:center;justify-content:center;padding:0 4px;
              z-index:1;
            ">0</span>
          </div>
          <button type="button" class="win11-taskbar__button win11-taskbar__tray-button" data-action="space-switcher" aria-label="Switch space" title="Switch Space">
            <span class="win11-taskbar__glyph">📁</span>
            <span class="win11-taskbar__tooltip" data-role="space-name">Default</span>
          </button>
          <button type="button" class="win11-taskbar__button win11-taskbar__tray-button" data-action="theme" aria-label="Toggle theme">
            <span class="win11-taskbar__glyph" data-role="theme-icon"></span>
            <span class="win11-taskbar__tooltip" data-role="theme-tooltip"></span>
          </button>
          <button type="button" class="win11-taskbar__button win11-taskbar__tray-button" data-action="accent" aria-label="Accent color" aria-haspopup="true" aria-expanded="false">
            <span class="win11-taskbar__glyph">${paletteIcon}</span>
            <span class="win11-taskbar__tooltip">Accent color</span>
          </button>
          <button type="button" class="win11-taskbar__button win11-taskbar__tray-button" data-action="notifications" aria-label="Notifications">
            <span class="win11-taskbar__glyph">${bellIcon}</span>
            <span class="win11-taskbar__tooltip">Notifications</span>
          </button>
          <button type="button" class="win11-taskbar__button win11-taskbar__tray-button" data-action="actions-tray" aria-label="Recent actions">
            <span class="win11-taskbar__glyph">⚡</span>
            <span class="win11-taskbar__tooltip">Recent actions</span>
          </button>
          <button type="button" class="win11-taskbar__clock" data-role="clock" aria-label="System clock"></button>
            <div data-role="accent-picker" class="win11-taskbar__accent-picker" hidden>
              <div class="win11-taskbar__accent-title">Accent color</div>
              <div class="win11-taskbar__swatch-row">
                ${ACCENT_PACKS.map((pack) => `
                  <button type="button" class="win11-taskbar__swatch" data-accent-id="${pack.id}" aria-label="${escapeHtml(pack.label)} accent" title="${escapeHtml(pack.label)}">
                    <span class="win11-taskbar__swatch-dot" data-role="swatch-dot"></span>
                    <span class="win11-taskbar__swatch-check" aria-hidden="true">✓</span>
                  </button>
                `).join('')}
              </div>
            </div>
        </div>
      </nav>
      <style>
        .win11-taskbar__pulse.is-active {
          animation: win11-pulse-anim 2s ease-in-out infinite;
        }
        @keyframes win11-pulse-anim {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      </style>
    `;

    this.startButton = this.root.querySelector('[data-action="start"]');
    this.widgetsButton = this.root.querySelector('[data-action="widgets"]');
    this.themeButton = this.root.querySelector('[data-action="theme"]');
    this.themeIcon = this.root.querySelector('[data-role="theme-icon"]');
    this.themeTooltip = this.root.querySelector('[data-role="theme-tooltip"]');
    this.accentButton = this.root.querySelector('[data-action="accent"]');
    this.accentPicker = this.root.querySelector('[data-role="accent-picker"]');
    this.clockElement = this.root.querySelector('[data-role="clock"]');

    this.root.addEventListener('click', (event) => {
      const startButton = event.target.closest('[data-action="start"]');
      if (startButton) {
        this.onStartToggle();
        return;
      }

      const widgetsButton = event.target.closest('[data-action="widgets"]');
      if (widgetsButton) {
        this.onWidgetsToggle();
        return;
      }

      const themeButton = event.target.closest('[data-action="theme"]');
      if (themeButton) {
        const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
        this.onThemeToggle(nextTheme);
        return;
      }

      const accentButton = event.target.closest('[data-action="accent"]');
      if (accentButton) {
        this.toggleAccentPicker();
        return;
      }

      const swatch = event.target.closest('[data-accent-id]');
      if (swatch) {
        this.closeAccentPicker();
        this.onAccentChange(swatch.dataset.accentId);
        return;
      }

      const spaceButton = event.target.closest('[data-action="space-switcher"]');
      if (spaceButton) {
        this.dispatchEvent(new CustomEvent('space-switch'));
        return;
      }

      const notifButton = event.target.closest('[data-action="notifications"]');
      if (notifButton) {
        this.dispatchEvent(new CustomEvent('notifications-toggle'));
        return;
      }

      const actionsTrayButton = event.target.closest('[data-action="actions-tray"]');
      if (actionsTrayButton) {
        this.dispatchEvent(new CustomEvent('actions-tray-toggle'));
        return;
      }

      const appButton = event.target.closest('[data-app-id]');
      if (appButton) {
        this.onAppActivate(appButton.dataset.appId);
      }
    });

    this.setTheme(this.theme);
    this.setAccent(this.accent);
    this.setWindowState(this.snapshot);
    this.setWidgetsOpen(this.widgetsOpen);
    this.updateClock();
    this.renderNotificationBadges();

    // Close the accent picker on outside clicks / Escape.
    this.onDocumentClick = (event) => {
      if (!this.accentPicker || this.accentPicker.hidden) return;
      if (event.target.closest('[data-role="accent-picker"]')) return;
      if (event.target.closest('[data-action="accent"]')) return;
      this.closeAccentPicker();
    };
    this.onRootKeydown = (event) => {
      if (event.key === 'Escape') this.closeAccentPicker();
    };
    document.addEventListener('click', this.onDocumentClick);
    this.root.addEventListener('keydown', this.onRootKeydown);
  }

  startClock() {
    this.stopClock();
    this.clockInterval = window.setInterval(() => this.updateClock(), 1000);
    this.updateClock();
  }

  stopClock() {
    if (this.clockInterval) {
      window.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  destroy() {
    this.stopClock();
    document.removeEventListener('click', this.onDocumentClick);
    this.root.removeEventListener('keydown', this.onRootKeydown);
    if (this.syncUnsubscribe) {
      this.syncUnsubscribe();
      this.syncUnsubscribe = null;
    }
    this.root.innerHTML = "";
  }

  updateSpaceName(name) {
    const el = this.root.querySelector('[data-role="space-name"]');
    if (el) el.textContent = name || 'Default';
    const btn = this.root.querySelector('[data-action="space-switcher"]');
    if (btn) btn.title = 'Switch Space: ' + (name || 'Default');
  }

  updatePinnedApps(appIds) {
    const container = this.root.querySelector('[data-role="pinned-apps"]');
    if (!container) return;
    this.pinnedApps = appIds.map(id => getAppById(id)).filter(Boolean);
    // Re-render using same structure as render() for consistent styling
    const icons = this.pinnedApps.map(app => `
      <button type="button" class="win11-taskbar__button win11-taskbar__app" data-app-id="${app.id}" aria-label="${escapeHtml(app.label)}" title="${escapeHtml(app.label)}">
        <span class="win11-app-icon win11-taskbar__app-icon">${app.icon}</span>
        <span class="win11-taskbar__indicator" aria-hidden="true"></span>
        <span class="win11-taskbar__tooltip">${escapeHtml(app.label)}</span>
      </button>
    `).join('');
    container.innerHTML = icons;
    // Click delegation is already handled by the root click listener in render()
  }

  updateClock() {
    if (this.clockElement) {
      this.clockElement.textContent = timeFormatter.format(new Date());
    }
  }

  setTheme(theme) {
    this.theme = theme;
    if (!this.themeIcon || !this.themeTooltip) {
      return;
    }

    const isDark = theme === 'dark';
    this.themeIcon.innerHTML = isDark ? sunIcon : moonIcon;
    this.themeTooltip.textContent = isDark ? 'Light mode' : 'Dark mode';
    this.themeButton?.setAttribute('aria-label', this.themeTooltip.textContent);
    this.refreshSwatchColors();
  }

  setAccent(accentId) {
    this.accent = accentId;
    if (this.accentPicker) {
      this.accentPicker.querySelectorAll('[data-accent-id]').forEach((swatch) => {
        swatch.classList.toggle('is-active', swatch.dataset.accentId === accentId);
      });
    }
    this.refreshSwatchColors();
  }

  refreshSwatchColors() {
    if (!this.accentPicker) return;
    const isDark = this.theme === 'dark';
    this.accentPicker.querySelectorAll('[data-accent-id]').forEach((swatch) => {
      const pack = ACCENT_PACKS.find((p) => p.id === swatch.dataset.accentId);
      const dot = swatch.querySelector('[data-role="swatch-dot"]');
      if (pack && dot) {
        dot.style.background = isDark ? pack.darkColor : pack.color;
      }
    });
  }

  toggleAccentPicker() {
    if (!this.accentPicker) return;
    this.accentPicker.hidden = !this.accentPicker.hidden;
    this.accentButton?.setAttribute('aria-expanded', this.accentPicker.hidden ? 'false' : 'true');
  }

  closeAccentPicker() {
    if (!this.accentPicker || this.accentPicker.hidden) return;
    this.accentPicker.hidden = true;
    this.accentButton?.setAttribute('aria-expanded', 'false');
  }

  setStartMenuOpen(isOpen) {
    this.startButton?.classList.toggle('is-active', Boolean(isOpen));
  }

  setWidgetsOpen(isOpen) {
    this.widgetsOpen = Boolean(isOpen);
    this.widgetsButton?.classList.toggle('is-active', this.widgetsOpen);
    this.widgetsButton?.setAttribute('aria-pressed', this.widgetsOpen ? 'true' : 'false');
  }

  setWindowState(snapshot = { activeAppId: null, windows: [] }) {
    this.snapshot = snapshot;
    const windowMap = new Map(snapshot.windows.map((windowState) => [windowState.id, windowState]));

    this.root.querySelectorAll('[data-app-id]').forEach((button) => {
      const appId = button.dataset.appId;
      const windowState = windowMap.get(appId);
      const isRunning = Boolean(windowState);
      const isActive = snapshot.activeAppId === appId;
      const isMinimized = Boolean(windowState?.minimized);

      button.classList.toggle('is-running', isRunning);
      button.classList.toggle('is-active', isActive);
      button.classList.toggle('is-minimized', isMinimized);
    });
  }

  getStartButton() {
    return this.startButton ?? null;
  }
}

export default Taskbar;
