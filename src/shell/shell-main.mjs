import APP_REGISTRY, { PINNED_APP_IDS } from './app-registry.mjs';
import { WindowManager, setShellContext } from './window-manager.mjs';
import { Taskbar } from './taskbar.mjs';
import { StartMenu } from './start-menu.mjs';
import { createViewAdapter } from './view-adapter.mjs';
import { createAPIClient } from './api-client.mjs';
import { createViewState } from './view-state.mjs';
import { createRealtimeSync } from './realtime-sync.mjs';

const DEFAULT_THEME_STORAGE_KEY = 'openclaw.win11.theme.v1';
const DEFAULT_WINDOW_STORAGE_KEY = 'openclaw.win11.windows.v1';
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

  let currentTheme = 'dark';
  try {
    const stored = localStorage.getItem(themeStorageKey);
    if (stored) currentTheme = stored;
  } catch (error) {
    console.warn('Unable to read shell theme preference:', error);
  }

  const applyTheme = (theme) => {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch (error) {
      console.warn('Unable to persist shell theme preference:', error);
    }
    taskbar?.setTheme(theme);
  };

  const sharedStateStore = createViewState({ project_id: '' });
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

  // Create welcome widget with sync
  const welcomeWidget = createWelcomeWidget(desktop, sync);

  const taskbar = new Taskbar({
    root: taskbarRoot,
    apps,
    pinnedAppIds,
    initialTheme: currentTheme,
    sync, // Pass sync to taskbar
    onStartToggle: () => startMenu?.toggle(),
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
  });

  viewAdapter = createViewAdapter(document.createElement('div'), {
    viewState: sharedStateStore,
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
    applyTheme,
    destroy() {
      welcomeWidget.removeEventListener('click', handleWelcomeClick);
      if (welcomeWidget._cleanupWelcome) {
        welcomeWidget._cleanupWelcome();
      }
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
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
