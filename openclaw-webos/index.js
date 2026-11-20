/**
 * openclaw-webos runtime entry.
 *
 * Registers a surface:tab descriptor for the OpenClaw 2026.11.3 plugin SDK.
 *
 * Contract notes (installed OpenClaw 2026.11.3):
 *  - Runtime plugin entries import `definePluginEntry` from
 *    `openclaw/plugin-sdk/plugin-entry`; the bare `openclaw/plugin-sdk`
 *    specifier is not exported (B1).
 *  - Tab placement uses `slug` (single-segment Control UI address).
 *    `placement: "route:..."` is reserved for bundled plugins whose native
 *    route matches the plugin id; no HTTP route is registered here (B2).
 *  - A global (non-bundled) extension additionally needs
 *    gateway.controlUi.experimental.customPlugins=true plus plugins.allow /
 *    plugins.entries.openclaw-webos.enabled=true before the Control UI will
 *    grant the native asset route (B3). See README "Install".
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

export default definePluginEntry({
  id: 'openclaw-webos',
  name: 'OpenClaw WebOS',
  description: 'Control UI tab that mounts the OpenClaw Project WebOS desktop.',
  register(api) {
    api.session.controls.registerControlUiDescriptor({
      surface: 'tab',
      id: 'desktop',
      label: 'OpenClaw Desktop',
      slug: 'desktop',
      icon: 'layout',
      group: 'control',
      requiredScopes: ['operator.read'],
    });
  },
});
