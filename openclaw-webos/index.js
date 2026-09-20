/**
 * openclaw-webos runtime entry.
 *
 * Registers a surface:tab descriptor with placement route:desktop so Control UI
 * would expose /openclaw/desktop once this tree is installed under
 * ~/.openclaw/extensions/ (OWNER-APPROVAL GATE — this card does not install).
 *
 * Mirrors the in-tree workboard plugin (api.session.controls.registerControlUiDescriptor),
 * NOT dashboard-bridge (backend-only — Phase 0 mismatch #5).
 */

import { definePluginEntry } from 'openclaw/plugin-sdk';

export default definePluginEntry({
  id: 'openclaw-webos',
  name: 'OpenClaw WebOS',
  description: 'Control UI tab that mounts the OpenClaw Project WebOS desktop.',
  register(api) {
    api.session.controls.registerControlUiDescriptor({
      surface: 'tab',
      id: 'desktop',
      label: 'OpenClaw Desktop',
      placement: 'route:desktop',
      icon: 'layout',
      group: 'control',
      requiredScopes: ['operator.read'],
    });
  },
});
