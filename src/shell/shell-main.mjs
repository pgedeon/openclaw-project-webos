import APP_REGISTRY, { PINNED_APP_IDS } from './app-registry.mjs';
import { WindowManager, setShellContext } from './window-manager.mjs';
import { Taskbar } from './taskbar.mjs';
import { StartMenu } from './start-menu.mjs';
import {
  createViewAdapter,
  formatRelativeTime,
  formatTimestamp,
  formatTokenLabel,
} from './view-adapter.mjs';
import { createAPIClient } from './api-client.mjs';
import { createViewState } from './view-state.mjs';
import { initCommandPalette } from './command-palette.mjs';
import { buildDashboardContext } from './agent-context.mjs';
import { AgentChatPanel } from './agent-chat-panel.mjs';
import { NotificationCenter } from './notification-center.mjs';
import { RecentActionsTray } from './recent-actions-tray.mjs';
import { createRealtimeSync } from './realtime-sync.mjs';
import { setOnlineStatus } from './mutation-manager.mjs';
import { WidgetRegistry } from './widgets/widget-registry.mjs';
import { WidgetPanel } from './widgets/widget-panel.mjs';
import { applyAccent, readStoredAccent, storeAccent, resolveAccent } from './accent-packs.mjs';

const DEFAULT_THEME_STORAGE_KEY = 'openclaw.win11.theme.v1';
const DEFAULT_WINDOW_STORAGE_KEY = 'openclaw.win11.windows.v1';

// Apply the persisted accent before any shell render (zero-throw; invalid or
// missing values resolve to the default pack, which clears [data-accent]).
applyAccent(readStoredAccent());
const SHELL_INSTANCE_KEY = '__OPENCLAW_WIN11_SHELL__';

const quickLaunchApps = ['tasks', 'agents', 'skills-tools', 'operations', 'workflows'];

const resolvePreferredTheme = () => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const formatCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value ?? '0');
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '<')
  .replaceAll('>', '>')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const createStatCard = ({ label, value, tone = 'default', note = '' }) => {
  const card = document.createElement('article');
  card.className = `native-stat-card is-${tone}`;
  card.innerHTML = `
    <div class="native-stat-card__label">${label}</div>
    <div class="native-stat-card__value">${value}</div>
    ${note ? `<div class="native-stat-card__note">${note}</div>` : ''}
  `;
  return card;
};

const createWelcomeWidget = (desktop, sync) => {
  const widget = document.createElement('section');
  widget.className = 'win11-desktop__welcome win11-glass';
  
  // Initial static content
  widget.innerHTML = `
    <div class="win11-desktop__welcome-badge">OpenClaw Desktop</div>
    <h1 class="win11-desktop__welcome-title">OpenClaw Project Dashboard</h1>
    <p class="win11-desktop__welcome-copy">Launch existing dashboard views in floating windows with a Start menu, taskbar, and persistent window state.</p>
    <div class="win11-desktop__welcome-stats" style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;"></div>
    <div class="win11-desktop__welcome-actions">
      ${quickLaunchApps.map((appId) => {
        const app = APP_REGISTRY.find((entry) => entry.id === appId);
        if (!app) {
          return '';
        }

        return `
          <button type="button" class="win11-desktop__welcome-action" data-app-id="${app.id}">
            <span class="win11-app-icon">${app.icon}</span>
            <span>${app.label}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;

  desktop.append(widget);

  // Live stats rendering
  const statsContainer = widget.querySelector('.win11-desktop__welcome-stats');
  
  const renderStats = () => {
    const stats = sync.stats;
    const healthStatus = sync.healthStatus;
    const blockersSummary = sync.blockersSummary;
    const orgSummary = sync.orgSummary;
    const approvalsPending = sync.approvalsPending;
    const activeWorkflowRuns = sync.activeWorkflowRuns;
    const gatewayAgents = sync.gatewayAgents;

    // Determine system health
    const systemStatus = healthStatus?.status || 'unknown';
    const isHealthy = systemStatus === 'ok' || systemStatus === 'healthy';
    const statusTone = isHealthy ? 'success' : systemStatus === 'degraded' ? 'warning' : 'error';

    // Calculate active agents from gateway status
    const activeAgents = gatewayAgents 
      ? gatewayAgents.filter(a => ['active', 'running', 'online'].includes(a.status)).length 
      : 0;
    const totalAgents = gatewayAgents?.length || orgSummary?.totalAgents || 0;

    // Get pending approvals count
    const pendingApprovals = approvalsPending?.approvals?.length || 0;

    // Get active workflow runs count
    const activeRuns = activeWorkflowRuns?.runs?.length || 0;

    // Get blockers count
    const blockersCount = blockersSummary?.total || 0;

    statsContainer.innerHTML = `
      ${createStatCard({ 
        label: 'System', 
        value: systemStatus.toUpperCase(), 
        tone: statusTone 
      }).outerHTML}
      ${createStatCard({ 
        label: 'Projects', 
        value: formatCount(stats?.projects || 0) 
      }).outerHTML}
      ${createStatCard({ 
        label: 'Tasks', 
        value: formatCount(stats?.tasks || 0) 
      }).outerHTML}
      ${createStatCard({ 
        label: 'Agents', 
        value: totalAgents > 0 ? `${activeAgents}/${totalAgents}` : '—',
        tone: activeAgents > 0 ? 'success' : 'default'
      }).outerHTML}
      ${createStatCard({ 
        label: 'Workflows', 
        value: formatCount(activeRuns),
        tone: activeRuns > 0 ? 'success' : 'default',
        note: activeRuns > 0 ? 'running' : ''
      }).outerHTML}
      ${createStatCard({ 
        label: 'Approvals', 
        value: formatCount(pendingApprovals),
        tone: pendingApprovals > 0 ? 'warning' : 'default'
      }).outerHTML}
      ${createStatCard({ 
        label: 'Blockers', 
        value: formatCount(blockersCount),
        tone: blockersCount > 0 ? 'error' : 'default'
      }).outerHTML}
    `;
  };

  // Initial render with loading state
  statsContainer.innerHTML = '<div style="color:var(--win11-text-tertiary);font-size:0.85rem;">Loading stats...</div>';

  // Subscribe to sync updates
  const unsubscribe = sync.subscribe((data, changedKeys) => {
    renderStats();
  });

  // Initial render after a short delay
  setTimeout(renderStats, 500);

  // Cleanup function stored on widget for later use
  widget._cleanupWelcome = unsubscribe;

  return widget;
};

const ensureDesktopScaffold = (desktop) => {
  desktop.classList.add('win11-desktop');

  if (!desktop.querySelector('.win11-desktop__window-layer')) {
    const windowLayer = document.createElement('div');
    windowLayer.className = 'win11-desktop__window-layer';
    desktop.append(windowLayer);
  }
};

export function bootstrapShell({
  desktop = typeof document !== 'undefined' ? document.getElementById('desktop') : null,
  taskbarRoot = typeof document !== 'undefined' ? document.getElementById('taskbar-root') : null,
  apps = APP_REGISTRY,
  pinnedAppIds = PINNED_APP_IDS,
  windowStorageKey = DEFAULT_WINDOW_STORAGE_KEY,
  themeStorageKey = DEFAULT_THEME_STORAGE_KEY,
} = {}) {
  if (!desktop || !taskbarRoot) {
    return null;
  }

  const existingShell = window[SHELL_INSTANCE_KEY];
  if (existingShell && existingShell.desktop === desktop && existingShell.taskbarRoot === taskbarRoot) {
    return existingShell;
  }

  ensureDesktopScaffold(desktop);

  let widgetPanel = null;
  let widgetRegistry = null;
  let shellDestroyed = false;
  const themeSubscribers = new Set();

  let currentTheme = 'dark';
  try {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored) currentTheme = stored;
  } catch (error) {
    console.warn('Unable to read shell theme preference:', error);
  }

  const currentAccent = readStoredAccent();

  const applyTheme = (theme) => {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch (error) {
      console.warn('Unable to persist shell theme preference:', error);
    }
    taskbar?.setTheme(theme);

    themeSubscribers.forEach((callback) => {
      try {
        callback(theme);
      } catch (error) {
        console.warn('[Shell] Theme subscriber error:', error);
      }
    });
  };

  const onThemeChange = (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    themeSubscribers.add(callback);
    return () => themeSubscribers.delete(callback);
  };

  const _savedSpaceId = (() => { try { return JSON.parse(localStorage.getItem('openclaw.win11.activeSpaceId') || 'null'); } catch { return null; } })();
  const sharedStateStore = createViewState({ project_id: '', activeSpaceId: _savedSpaceId });
  const apiClient = createAPIClient('/api');

  // Create realtime sync module
  const sync = createRealtimeSync({ api: apiClient });

  const windowManager = new WindowManager({
    desktop,
    apps,
    storageKey: windowStorageKey,
  });

  setShellContext({ adapter: null, apiClient, sync });

  let startMenu;
  let viewAdapter = null;

  const shellShowNotice = (message, type = 'info') => {
    console.log(`[Shell Notice] ${type}: ${message}`);
  };

  const shellNavigateTo = (viewId, payload = {}) => {
    const appIdMap = {
      'task-list': 'tasks', 'board': 'board', 'timeline': 'timeline',
      'agent-queue': 'agents', 'departments': 'departments',
    };
    const appId = appIdMap[viewId] || viewId;
    windowManager.openWindow(appId);
  };

  let widgetsReady = Promise.resolve(null);

  const toggleWidgetsPanel = () => {
    if (widgetPanel) {
      widgetPanel.toggle();
      return;
    }

    void widgetsReady.then((panel) => panel?.toggle()).catch((error) => {
      console.warn('[Shell] Unable to toggle widget panel:', error);
    });
  };

  // Create welcome widget with sync
  const welcomeWidget = createWelcomeWidget(desktop, sync);

  const taskbar = new Taskbar({
    root: taskbarRoot,
    apps,
    pinnedAppIds,
    initialTheme: currentTheme,
    initialAccent: currentAccent,
    sync, // Pass sync to taskbar
    onStartToggle: () => startMenu?.toggle(),
    onWidgetsToggle: () => toggleWidgetsPanel(),
    onAppActivate: (appId) => {
      const windowEntry = windowManager.getWindowEntry(appId);
      if (!windowEntry) {
        windowManager.openWindow(appId);
      } else if (windowEntry.state.minimized) {
        windowManager.restoreWindow(appId);
      } else {
        windowManager.focusWindow(appId);
      }

      startMenu?.close();
    },
    onThemeToggle: (theme) => applyTheme(theme),
    onAccentChange: (accentId) => {
      const resolved = applyAccent(accentId);
      storeAccent(resolved);
      taskbar.setAccent(resolved);
    },
  });

  // Notification center toggle
  taskbar.addEventListener('notifications-toggle', () => {
    notifCenter.toggle();
  });

  // Recent-actions tray toggle (taskbar ⚡ button)
  taskbar.addEventListener('actions-tray-toggle', () => {
    actionsTray.toggle();
  });

  // Space switcher: open spaces view on click
  taskbar.addEventListener('space-switch', () => {
    const entry = windowManager.getWindowEntry('spaces');
    if (!entry) {
      windowManager.openWindow('spaces');
    } else if (entry.state.minimized) {
      windowManager.restoreWindow('spaces');
    } else {
      windowManager.focusWindow('spaces');
    }
  });

  // Load spaces on startup and set active space name in taskbar
  try {
    const _api = createAPIClient('/api');
    _api.spaces.list().then(({ spaces }) => {
      if (spaces?.length) {
        const current = sharedStateStore.getState('activeSpaceId');
        if (!current) {
          const def = spaces.find(s => s.is_default) || spaces[0];
          sharedStateStore.setState('activeSpaceId', def.id);
        }
        const activeId = sharedStateStore.getState('activeSpaceId');
        const active = spaces.find(s => s.id === activeId);
        if (active) {
          taskbar.updateSpaceName(active.name);
          // Apply space settings on startup (pinned apps, agent config)
          const settings = typeof active.settings === 'string' ? JSON.parse(active.settings || '{}') : (active.settings || {});
          const desktop = settings.desktop || {};
          const agent = settings.agent || {};
          if (desktop.pinnedApps?.length && taskbar.updatePinnedApps) {
            taskbar.updatePinnedApps(desktop.pinnedApps);
          }
          if (chatPanel && (agent.defaultModel || agent.systemPrompt)) {
            chatPanel.updateSpaceConfig?.(agent);
          }
        }
      }
    }).catch(() => {});
  } catch (e) { /* spaces load failure is non-critical */ }

  // Listen for space changes — restore layout, update taskbar, refresh views
  globalThis.addEventListener('space:changed', (event) => {
    const space = event.detail?.space;
    if (!space) return;
    // Persist active space to localStorage so it survives refresh
    sharedStateStore.setState('activeSpaceId', space.id);
    try { localStorage.setItem('openclaw.win11.activeSpaceId', JSON.stringify(space.id)); } catch {}
    taskbar.updateSpaceName(space.name);

    // Apply space settings: pinned apps, agent config, desktop layout
    const settings = typeof space.settings === 'string' ? JSON.parse(space.settings || '{}') : (space.settings || {});
    const desktop = settings.desktop || {};
    const agent = settings.agent || {};

    // Update taskbar pinned apps if configured
    if (desktop.pinnedApps?.length && taskbar.updatePinnedApps) {
      taskbar.updatePinnedApps(desktop.pinnedApps);
    }

    // Update agent panel defaults if configured
    if (chatPanel && (agent.defaultModel || agent.systemPrompt)) {
      chatPanel.updateSpaceConfig?.(agent);
    }

    // Refresh visible views so they pick up the new activeSpaceId
    sync?.refresh?.();
  });

  // Command palette — Ctrl+K global search (P1)
  const _paletteCleanup = initCommandPalette(apiClient);

  // Notification center — wire navigation (P3)
  const notifCenter = new NotificationCenter();
  globalThis.__notifCenter = notifCenter;
  notifCenter.setNavigator((viewId, options) => windowManager.openWindow(viewId, options));

  // Recent-actions tray — shell chrome sibling of the notification center
  // (one-click actions slice 2; NOT a windowed app — registry count frozen)
  const actionsTray = new RecentActionsTray({
    api: apiClient,
    navigateToView: (viewId, options) => windowManager.openWindow(viewId, options),
  });
  globalThis.__actionsTray = actionsTray;

  // Agent chat panel
  const chatPanel = new AgentChatPanel({
    onSend: async (message) => {
      try {
        const _api = createAPIClient('/api');
        const ctx = await buildDashboardContext(_api, {
          activeSpaceId: sharedStateStore.getState('activeSpaceId'),
          activeViewId: null,
          viewState: sharedStateStore.getState(),
        });
        // Include space agent config if available
        const spaceAgentCfg = chatPanel.spaceConfig || {};
        const resp = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            context: ctx,
            agentConfig: Object.keys(spaceAgentCfg).length ? spaceAgentCfg : undefined,
          }),
        });
        const data = await resp.json();
        if (data.response) chatPanel.addMessage('agent', data.response);
        else if (data.error) chatPanel.addMessage('system', 'Error: ' + data.error);
      } catch (err) {
        chatPanel.addMessage('system', 'Connection error: ' + err.message);
      }
    },
    onConfirm: (actionId) => chatPanel.addMessage('system', 'Action approved: ' + actionId),
    onReject: (actionId) => chatPanel.addMessage('system', 'Action cancelled'),
  });

  viewAdapter = createViewAdapter(document.createElement('div'), {
    viewState: sharedStateStore,
    async loadSpaces() {
      try {
        const { spaces } = await api.spaces.list();
        if (spaces?.length) {
          const current = sharedStateStore.getState('activeSpaceId');
          if (!current) {
            const def = spaces.find(s => s.is_default) || spaces[0];
            sharedStateStore.setState('activeSpaceId', def.id);
          }
          return spaces;
        }
      } catch {}
      return [];
    },
    api: apiClient,
    getProjectId: () => sharedStateStore.getState('project_id') || '',
    getTheme: () => currentTheme,
    showNotice: shellShowNotice,
    navigateTo: shellNavigateTo,
    initialState: { project_id: '' },
  });

  setShellContext({ adapter: viewAdapter, apiClient, sync });

  startMenu = new StartMenu({
    container: document.body,
    apps,
    pinnedAppIds,
    onOpenApp: (appId) => {
      windowManager.openWindow(appId);
      startMenu.close();
    },
    anchorElement: taskbar.getStartButton(),
  });

  const syncWelcomeVisibility = (snapshot) => {
    const hasVisibleWindow = snapshot.windows.some((windowState) => !windowState.minimized);
    welcomeWidget.hidden = hasVisibleWindow;
  };

  const handleWelcomeClick = (event) => {
    const actionButton = event.target.closest('[data-app-id]');
    if (!actionButton) {
      return;
    }

    windowManager.openWindow(actionButton.dataset.appId);
  };

  welcomeWidget.addEventListener('click', handleWelcomeClick);

  windowManager.addEventListener('windowschange', (event) => {
    taskbar.setWindowState(event.detail);
    syncWelcomeVisibility(event.detail);
  });

  startMenu.addEventListener('toggle', (event) => {
    taskbar.setStartMenuOpen(event.detail.open);
  });

  const restoredWindowCount = windowManager.restoreFromStorage();
  taskbar.setWindowState(windowManager.getStateSnapshot());
  syncWelcomeVisibility(windowManager.getStateSnapshot());
  if (!restoredWindowCount) {
    welcomeWidget.hidden = false;
  }

  applyTheme(currentTheme);

  // Start the realtime sync
  sync.start();

  // Enable SSE push updates (falls back to polling if unavailable)
  globalThis.__realtimeSyncForceRefresh = () => sync.refresh();
  import('./realtime-sync.mjs').then(({ connectSSE }) => connectSSE());

  widgetsReady = (async () => {
    try {
      widgetRegistry = new WidgetRegistry({
        sync,
        api: apiClient,
        navigate: shellNavigateTo,
        showNotice: shellShowNotice,
        getTheme: () => currentTheme,
      });

      await widgetRegistry.loadAll();
      if (shellDestroyed) {
        return null;
      }

      widgetPanel = new WidgetPanel({
        desktop,
        registry: widgetRegistry,
        shellAPI: {
          sync,
          api: apiClient,
          navigate: shellNavigateTo,
          showNotice: shellShowNotice,
          getTheme: () => currentTheme,
          onThemeChange,
          helpers: {
            escapeHtml,
            formatRelativeTime,
            formatTimestamp,
            formatTokenLabel,
          },
        },
        taskbar,
        mode: 'panel',
      });

      await widgetPanel.init();

      if (shellDestroyed) {
        widgetPanel.destroy();
        widgetPanel = null;
        return null;
      }

      return widgetPanel;
    } catch (error) {
      console.warn('[Shell] Widget system init failed:', error);
      widgetRegistry = null;
      widgetPanel = null;
      return null;
    }
  })();

  let metaPending = false;
  let metaUsedForShortcut = false;

  const onKeyDown = (event) => {
    if (event.key === 'Meta') {
      metaPending = true;
      metaUsedForShortcut = false;
      return;
    }

    if (metaPending) {
      metaUsedForShortcut = true;
    }

    if (event.metaKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      metaUsedForShortcut = true;
      windowManager.minimizeAll();
      startMenu.close();
      return;
    }

    if (event.metaKey && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      metaUsedForShortcut = true;
      startMenu.close();
      toggleWidgetsPanel();
      return;
    }

    if (event.altKey && event.key === 'F4') {
      event.preventDefault();
      metaUsedForShortcut = true;
      windowManager.closeActiveWindow();
    }
  };

  const onKeyUp = (event) => {
    if (event.key !== 'Meta') {
      return;
    }

    if (!metaUsedForShortcut) {
      startMenu.toggle();
    }

    metaPending = false;
    metaUsedForShortcut = false;
  };

  const onWindowBlur = () => {
    metaPending = false;
    metaUsedForShortcut = false;
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  const shell = {
    desktop,
    taskbarRoot,
    windowManager,
    taskbar,
    startMenu,
    welcomeWidget,
    sync,
    get widgetRegistry() {
      return widgetRegistry;
    },
    get widgetPanel() {
      return widgetPanel;
    },
    widgetsReady,
    applyTheme,
    destroy() {
    if (_paletteCleanup) _paletteCleanup();
      shellDestroyed = true;
      welcomeWidget.removeEventListener('click', handleWelcomeClick);
      if (welcomeWidget._cleanupWelcome) {
        welcomeWidget._cleanupWelcome();
      }
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      themeSubscribers.clear();
      widgetPanel?.destroy();
      widgetPanel = null;
      actionsTray.destroy();
      sync.stop();
      startMenu.destroy();
      taskbar.destroy();
      windowManager.destroy();
      window[SHELL_INSTANCE_KEY] = null;
    },
  };

  window[SHELL_INSTANCE_KEY] = shell;
  return shell;
}

if (typeof document !== 'undefined') {
  const autoBoot = () => bootstrapShell();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoBoot, { once: true });
  } else {
    autoBoot();
  }
}

export default bootstrapShell;
