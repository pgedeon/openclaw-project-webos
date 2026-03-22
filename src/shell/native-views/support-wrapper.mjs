import { createSupportViews } from '../../views/support-views.mjs';
import { ensureNativeRoot } from './helpers.mjs';

export function createSupportViewRenderer(methodName) {
  return async function renderSupportView({ mountNode, adapter, state }) {
    ensureNativeRoot(mountNode);
    const supportViews = createSupportViews({
      mountNode,
      resolveProjectId: adapter.resolveProjectId,
      escapeHtml: adapter.escapeHtml,
    });

    const render = supportViews?.[methodName];
    if (typeof render !== 'function') {
      throw new Error(`Unknown support view renderer: ${methodName}`);
    }

    await render(state || adapter.state);

    return () => supportViews.cleanup?.();
  };
}

export default createSupportViewRenderer;
