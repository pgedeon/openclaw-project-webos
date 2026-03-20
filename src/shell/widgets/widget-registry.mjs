/* ============================================
   Widget Registry
   ============================================ */

const VALID_WIDGET_SIZES = new Set(['small', 'medium', 'large', 'wide', 'tall']);

// Widget index — add new widgets here.
export const WIDGET_INDEX = [
  { id: 'agent-fleet', module: './widgets/agent-fleet.mjs' },
  { id: 'approval-queue', module: './widgets/approval-queue.mjs' },
  { id: 'blocker-alert', module: './widgets/blocker-alert.mjs' },
  { id: 'clock-widget', module: './widgets/clock-widget.mjs' },
  { id: 'command-runner', module: './widgets/command-runner.mjs' },
  { id: 'cron-countdown', module: './widgets/cron-countdown.mjs' },
  { id: 'department-status', module: './widgets/department-status.mjs' },
  { id: 'error-feed', module: './widgets/error-feed.mjs' },
  { id: 'mini-sparkline', module: './widgets/mini-sparkline.mjs' },
  { id: 'motd-widget', module: './widgets/motd-widget.mjs' },
  { id: 'project-stats', module: './widgets/project-stats.mjs' },
  { id: 'queue-monitor', module: './widgets/queue-monitor.mjs' },
  { id: 'quick-notes', module: './widgets/quick-notes.mjs' },
  { id: 'session-timer', module: './widgets/session-timer.mjs' },
  { id: 'system-health', module: './widgets/system-health.mjs' },
  { id: 'system-uptime', module: './widgets/system-uptime.mjs' },
  { id: 'task-pulse', module: './widgets/task-pulse.mjs' },
  { id: 'workflow-pulse', module: './widgets/workflow-pulse.mjs' },
];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeManifest = (manifest) => ({
  ...manifest,
  dataKeys: Array.isArray(manifest?.dataKeys) ? [...manifest.dataKeys] : [],
  capabilities: isPlainObject(manifest?.capabilities) ? { ...manifest.capabilities } : {},
  defaults: isPlainObject(manifest?.defaults) ? { ...manifest.defaults } : {},
});

const validateManifest = (indexEntry, manifest, render) => {
  if (!manifest || typeof render !== 'function') {
    return 'missing manifest or render export';
  }

  if (manifest.id !== indexEntry.id) {
    return `index id "${indexEntry.id}" does not match manifest.id "${manifest.id}"`;
  }

  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    return 'manifest.id must match ^[a-z][a-z0-9-]*$';
  }

  if (typeof manifest.label !== 'string' || !manifest.label.trim()) {
    return 'manifest.label must be a non-empty string';
  }

  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    return 'manifest.description must be a non-empty string';
  }

  if (typeof manifest.icon !== 'string') {
    return 'manifest.icon must be a string';
  }

  if (!VALID_WIDGET_SIZES.has(manifest.size)) {
    return `manifest.size must be one of: ${[...VALID_WIDGET_SIZES].join(', ')}`;
  }

  if (!Array.isArray(manifest.dataKeys)) {
    return 'manifest.dataKeys must be an array';
  }

  return null;
};

export class WidgetRegistry {
  /* --------------------------------------------
     Lifecycle
     -------------------------------------------- */

  constructor({
    sync = null,
    api = null,
    navigate = () => {},
    showNotice = () => {},
    getTheme = () => 'dark',
    index = WIDGET_INDEX,
  } = {}) {
    this.sync = sync;
    this.api = api;
    this.navigate = navigate;
    this.showNotice = showNotice;
    this.getTheme = getTheme;
    this.index = Array.isArray(index) ? [...index] : [];
    this.widgets = new Map();
    this.loaded = false;
  }

  async loadAll() {
    this.widgets.clear();

    const seenIds = new Set();
    const entries = await Promise.allSettled(this.index.map(async (entry) => {
      if (!entry?.id || !entry?.module) {
        console.warn('[WidgetRegistry] Skipping invalid index entry:', entry);
        return null;
      }

      if (seenIds.has(entry.id)) {
        console.warn(`[WidgetRegistry] Duplicate widget id "${entry.id}" in WIDGET_INDEX.`);
        return null;
      }
      seenIds.add(entry.id);

      try {
        const moduleUrl = new URL(entry.module, import.meta.url).href;
        const mod = await import(moduleUrl);
        const manifest = normalizeManifest(mod?.manifest);
        const render = mod?.render;
        const validationError = validateManifest(entry, manifest, render);

        if (validationError) {
          console.warn(`[WidgetRegistry] ${entry.id}: ${validationError}`);
          return null;
        }

        return {
          id: entry.id,
          manifest,
          render,
          module: mod,
          modulePath: entry.module,
        };
      } catch (error) {
        console.warn(`[WidgetRegistry] Failed to load "${entry.id}":`, error);
        return null;
      }
    }));

    entries.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        this.widgets.set(result.value.id, result.value);
      }
    });

    this.loaded = true;
    return this.widgets;
  }

  /* --------------------------------------------
     Accessors
     -------------------------------------------- */

  get(id) {
    return this.widgets.get(id) ?? null;
  }

  list() {
    return [...this.widgets.values()].map((widget) => ({ ...widget.manifest }));
  }
}

export default WidgetRegistry;
