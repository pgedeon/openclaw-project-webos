import { ensureNativeRoot } from './helpers.mjs';

export async function renderLegacyView(renderFn, context = {}) {
  ensureNativeRoot(context.mountNode);
  return context.adapter.mount(renderFn, context);
}

export default renderLegacyView;
