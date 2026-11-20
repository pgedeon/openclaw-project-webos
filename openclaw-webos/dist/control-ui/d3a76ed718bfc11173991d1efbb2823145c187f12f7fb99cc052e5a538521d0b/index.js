/**
 * openclaw-webos — native Control UI page entry (Phase 2 fixed for 2026.11.3).
 *
 * Single vanilla ES module. NO repo build step and NO bare package imports
 * (B4): the served Control UI index.html has no importmap and no bare "lit"
 * alias, so this entry uses the documented `ControlUiView` contract — a plain
 * DOM mount function — instead of importing `lit`.
 *
 * Host contract (OpenClaw 2026.11.3):
 *  - `controlUi.entry` must default-export `{ id, activate(host) }`
 *    (`defineControlUiPlugin` shape).
 *  - `activate()` registers a page with the SAME id as the gateway
 *    surface:tab descriptor id ("desktop"). The Control UI resolves a native
 *    page registration key `${pluginId}/${pageId}`; a mismatched id falls back
 *    to loading/spinner forever.
 *  - Plugin asset route serves only .js/.css; the view module is imported
 *    relatively from this file's own asset URL.
 */

const VIEW_MODULE_URL = new URL('./webos-desktop-view.js', import.meta.url).href;

function mountWebosView(container, context) {
  const root = document.createElement('div');
  root.className = 'wb-host';
  root.dataset.webosViewRoot = '';
  container.replaceChildren(root);

  let disposed = false;
  let cleanup = null;
  let current = context;

  import(VIEW_MODULE_URL)
    .then((module) => {
      if (disposed) return;
      const render = module.render || module.default;
      if (typeof render !== 'function') {
        throw new Error('webos-desktop-view.js must export render()');
      }
      const result = render(root, {
        host: current.host,
        signal: current.signal,
        props: current.props,
        presented: current.presented,
      });
      const dispose =
        typeof result === 'function' ? result : result?.dispose;
      if (typeof dispose === 'function') {
        cleanup = dispose;
        if (disposed) cleanup();
      }
    })
    .catch((error) => {
      if (disposed || !root.isConnected) return;
      root.textContent = error?.message || String(error);
      root.dataset.state = 'mount-error';
    });

  return {
    update(next) {
      current = next;
    },
    dispose() {
      disposed = true;
      if (cleanup) {
        try {
          cleanup();
        } catch {
          /* view already gone */
        }
        cleanup = null;
      }
      root.remove();
    },
  };
}

export default {
  id: 'openclaw-webos',
  activate(host) {
    return host.ui.registerPage({
      id: 'desktop',
      label: 'OpenClaw Desktop',
      mount: mountWebosView,
    });
  },
};
