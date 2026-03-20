import { createViewState } from './view-state.mjs';

export const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const formatTimestamp = (dateString, fallback = 'Unknown') => {
  if (!dateString) {
    return fallback;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString();
};

export const formatRelativeTime = (dateString, fallback = 'just now') => {
  if (!dateString) {
    return fallback;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 45) {
    return diffSeconds >= 0 ? 'in a few seconds' : 'just now';
  }

  const units = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const unit = units.find(([, seconds]) => absSeconds >= seconds) || ['second', 1];
  const value = Math.round(diffSeconds / unit[1]);
  return formatter.format(value, unit[0]);
};

export const formatTokenLabel = (value) => String(value ?? '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (match) => match.toUpperCase());

const resolveRenderFunction = (viewModule, preferredRender = null) => {
  if (typeof preferredRender === 'function') {
    return preferredRender;
  }

  if (typeof viewModule === 'function') {
    return viewModule;
  }

  if (typeof preferredRender === 'string' && typeof viewModule?.[preferredRender] === 'function') {
    return viewModule[preferredRender];
  }

  if (typeof viewModule?.default === 'function') {
    return viewModule.default;
  }

  const renderKey = Object.keys(viewModule || {}).find((key) => /^render[A-Z]/.test(key) && typeof viewModule[key] === 'function');
  if (renderKey) {
    return viewModule[renderKey];
  }

  throw new Error('Could not resolve a render function for the native view module.');
};

const normalizeCleanup = (result) => {
  if (typeof result === 'function') {
    return result;
  }

  if (typeof result?.destroy === 'function') {
    return () => result.destroy();
  }

  if (typeof result?.cleanup === 'function') {
    return () => result.cleanup();
  }

  if (typeof result?.unmount === 'function') {
    return () => result.unmount();
  }

  return null;
};

export function createViewAdapter(windowContentDiv, shellAPI = {}) {
  if (!windowContentDiv) {
    throw new Error('createViewAdapter requires a mount node.');
  }

  const stateStore = shellAPI.viewState || createViewState(shellAPI.initialState || {});
  const reactiveState = stateStore.state || stateStore.getState();
  let currentCleanup = null;

  const getProjectId = () => {
    const storedProjectId = stateStore.getState('project.id')
      || stateStore.getState('project_id')
      || reactiveState?.project?.id
      || reactiveState?.project_id;

    return storedProjectId || shellAPI.getProjectId?.() || '';
  };

  const navigateTo = (viewId, payload = {}) => {
    if (payload?.projectId) {
      stateStore.setState({
        project_id: payload.projectId,
        project: {
          ...(stateStore.getState('project') || {}),
          id: payload.projectId,
        },
      });
    }

    if (payload?.runId) {
      stateStore.setState({
        selection: {
          ...(stateStore.getState('selection') || {}),
          workflowRunId: payload.runId,
        },
        workflow: {
          ...(stateStore.getState('workflow') || {}),
          selectedRunId: payload.runId,
        },
      });
    }

    return shellAPI.navigateTo?.(viewId, payload) || null;
  };

  const showNotice = (message, type = 'info') => shellAPI.showNotice?.(message, type);

  const showSessionDetails = (runId) => {
    if (!runId) {
      return null;
    }
    return navigateTo('workflows', { runId });
  };

  const openVerificationModal = (runId, taskTitle = 'Task') => {
    stateStore.setState({
      verification: {
        runId,
        taskTitle,
        requestedAt: new Date().toISOString(),
      },
    });

    if (typeof shellAPI.openVerificationModal === 'function') {
      return shellAPI.openVerificationModal(runId, taskTitle);
    }

    showNotice(`Verification requested for ${taskTitle}.`, 'info');
    return navigateTo('publish', { runId });
  };

  const resolveProjectId = (stateLike = reactiveState) => stateLike?.project?.id
    || stateLike?.project_id
    || getProjectId();

  const fetchImpl = (input, init) => {
    if (shellAPI.api?.raw) {
      return shellAPI.api.raw(input, init);
    }

    return globalThis.fetch(input, init);
  };

  const adapter = {
    state: reactiveState,
    stateStore,
    escapeHtml,
    formatTimestamp,
    formatRelativeTime,
    formatTokenLabel,
    fetchImpl,
    getProjectId,
    getTheme: () => shellAPI.getTheme?.() || 'dark',
    navigateTo,
    openVerificationModal,
    resolveProjectId,
    showNotice,
    showSessionDetails,
    async mount(viewModule, options = {}) {
      await adapter.unmount({ clear: false });

      const render = resolveRenderFunction(viewModule, options.render);
      const renderOptions = {
        mountNode: options.mountNode || windowContentDiv,
        fetchImpl,
        escapeHtml,
        showNotice,
        showSessionDetails,
        formatTimestamp,
        formatRelativeTime,
        formatTokenLabel,
        resolveProjectId,
        navigateToView: navigateTo,
        openVerificationModal,
        state: options.state || reactiveState,
        stateStore,
        api: options.api || shellAPI.api || null,
        adapter,
        ...options,
      };

      const result = await render(renderOptions);
      currentCleanup = normalizeCleanup(result);
      return result;
    },
    async unmount({ clear = true } = {}) {
      if (typeof currentCleanup === 'function') {
        await currentCleanup();
      }

      currentCleanup = null;
      if (clear) {
        windowContentDiv.innerHTML = '';
      }
    },
  };

  return adapter;
}

export default createViewAdapter;
