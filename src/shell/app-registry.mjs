const iconTemplate = (content) => `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${content}
  </svg>
`;

const appIcon = {
  clipboardCheck: iconTemplate(`
    <path d="M9 4.5h6" />
    <path d="M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="m9.5 13 1.8 1.8L15 11.2" />
  `),
  kanban: iconTemplate(`
    <rect x="4" y="5" width="5" height="14" rx="1.5" />
    <rect x="10.5" y="5" width="4" height="8" rx="1.5" />
    <rect x="16" y="5" width="4" height="11" rx="1.5" />
  `),
  timeline: iconTemplate(`
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M8 3v4M16 3v4M4 9h16" />
    <path d="M8 14h3l2-3h3" />
  `),
  robot: iconTemplate(`
    <rect x="6" y="7" width="12" height="10" rx="3" />
    <path d="M12 3v4M8.5 11h.01M15.5 11h.01" />
    <path d="M9 15h6" />
    <path d="M4 10h2M18 10h2" />
  `),
  envelope: iconTemplate(`
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <path d="m5.5 8 6.5 5 6.5-5" />
  `),
  plane: iconTemplate(`
    <path d="m4 12 15-7-4 14-3.5-5.2L4 12Z" />
    <path d="m11.5 13.8 7.5-8.8" />
  `),
  shieldCheck: iconTemplate(`
    <path d="M12 3 6.5 5v5.5c0 4.1 2.3 7.2 5.5 8.5 3.2-1.3 5.5-4.4 5.5-8.5V5L12 3Z" />
    <path d="m9.5 11.8 1.6 1.6 3.6-3.6" />
  `),
  package: iconTemplate(`
    <path d="m12 3 7 4v10l-7 4-7-4V7l7-4Z" />
    <path d="m12 3 7 4-7 4-7-4" />
    <path d="M12 11v10" />
  `),
  links: iconTemplate(`
    <path d="M9.2 14.8 6.5 17.5a3 3 0 0 1-4.2-4.2L5 10.6" />
    <path d="m14.8 9.2 2.7-2.7a3 3 0 1 1 4.2 4.2L19 13.4" />
    <path d="m8 16 8-8" />
  `),
  heartbeat: iconTemplate(`
    <path d="M4 12h3l2-4 3 8 2-4h6" />
    <path d="M12 20c-4.6-2.8-7.5-5.8-7.5-9.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 3.1C19.5 14.2 16.6 17.2 12 20Z" opacity=".45" />
  `),
  bars: iconTemplate(`
    <path d="M5 19V11" />
    <path d="M10 19V7" />
    <path d="M15 19V13" />
    <path d="M20 19V5" />
  `),
  book: iconTemplate(`
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5V5.5Z" />
    <path d="M5 19h14" />
    <path d="M9 7h6M9 11h6" />
  `),
  brain: iconTemplate(`
    <path d="M9 6.5A3.5 3.5 0 0 1 15.5 5 3.3 3.3 0 0 1 19 8.2c1.2.6 2 1.9 2 3.3 0 1.8-1.2 3.4-2.9 3.8-.2 2-1.9 3.7-4 3.7a4 4 0 0 1-2.1-.6 4 4 0 0 1-2.1.6c-2.1 0-3.8-1.7-4-3.8A3.9 3.9 0 0 1 3 11.6c0-1.5.8-2.8 2.1-3.4A3.5 3.5 0 0 1 9 6.5Z" />
    <path d="M12 7.5v9M9.5 9.5c1 .2 1.8 1 2 2M14.5 9.5c-1 .2-1.8 1-2 2" />
  `),
  handoff: iconTemplate(`
    <path d="M7 8h10l-3-3" />
    <path d="m17 8-3 3" />
    <path d="M17 16H7l3 3" />
    <path d="m7 16 3-3" />
  `),
  eye: iconTemplate(`
    <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  `),
  clock: iconTemplate(`
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5l3 2" />
  `),
  building: iconTemplate(`
    <rect x="5" y="4" width="14" height="16" rx="2" />
    <path d="M9 8h.01M12 8h.01M15 8h.01M9 12h.01M12 12h.01M15 12h.01" />
    <path d="M10 20v-3h4v3" />
  `),
  wrench: iconTemplate(`
    <path d="M14.5 5.5a4 4 0 0 0 4.8 4.8l-6.8 6.8a2.3 2.3 0 1 1-3.2-3.2l6.8-6.8a4 4 0 0 0-1.6-1.6Z" />
    <path d="m8 16-2 2" />
  `),
  bolt: iconTemplate(`
    <path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z" />
  `),
  stethoscope: iconTemplate(`
    <path d="M6 2v6" />
    <path d="M2 8h8" />
    <path d="M6 8c0 4 2 6 6 6" />
    <path d="M12 14a2 2 0 1 1-4 0" />
    <path d="M15 8a4 4 0 0 1 0 8" />
    <path d="M15 16c2 0 3-2 3-4s-1-4-3-4" />
  `),
  gear: iconTemplate(`
    <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
    <path d="M4 12h2.1m11.8 0H20m-3.2-5.6-1.5 1.5M8.7 15.3l-1.5 1.5m0-9.7 1.5 1.5m6.6 6.6 1.5 1.5M12 4v2.1m0 11.8V20" />
  `),
  folder: iconTemplate(`
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z" />
    <path d="M3.5 9h17" />
  `),
  document: iconTemplate(`
    <path d="M8 3.5h6l4 4v13a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20.5v-15A2 2 0 0 1 8 3.5Z" />
    <path d="M14 3.5V8h4" />
    <path d="M9.5 11.5h5M9.5 15h5" />
  `),
};

export const APP_CATEGORY_ORDER = ['Work', 'Operations', 'Admin'];

export const APP_REGISTRY = Object.freeze([
  {
    id: 'tasks',
    label: 'Tasks',
    icon: appIcon.clipboardCheck,
    url: '/?view=tasks',
    category: 'Work',
    defaultWidth: 1080,
    defaultHeight: 720,
    viewModule: './native-views/tasks-view.mjs',
  },
  {
    id: 'board',
    label: 'Board',
    icon: appIcon.kanban,
    url: '/?view=board',
    viewModule: './native-views/board-view.mjs',
    category: 'Work',
    defaultWidth: 1120,
    defaultHeight: 740,
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: appIcon.timeline,
    url: '/?view=timeline',
    viewModule: './native-views/timeline-view.mjs',
    category: 'Work',
    defaultWidth: 1180,
    defaultHeight: 760,
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: appIcon.robot,
    url: '/?view=agents',
    viewModule: './native-views/agents-view.mjs',
    category: 'Work',
    defaultWidth: 1120,
    defaultHeight: 740,
  },
  {
    id: 'requests',
    label: 'Requests',
    icon: appIcon.envelope,
    url: '/?view=service-requests',
    viewModule: './native-views/service-requests-view.mjs',
    category: 'Work',
    defaultWidth: 1060,
    defaultHeight: 720,
  },
  {
    id: 'publish',
    label: 'Publish',
    icon: appIcon.plane,
    url: '/?view=publish',
    viewModule: './native-views/publish-view.mjs',
    category: 'Work',
    defaultWidth: 1060,
    defaultHeight: 700,
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: appIcon.shieldCheck,
    url: '/?view=approvals',
    viewModule: './native-views/approvals-view.mjs',
    category: 'Work',
    defaultWidth: 1040,
    defaultHeight: 700,
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: appIcon.package,
    url: '/?view=artifacts',
    viewModule: './native-views/artifacts-view.mjs',
    category: 'Work',
    defaultWidth: 1040,
    defaultHeight: 700,
  },
  {
    id: 'dependencies',
    label: 'Dependencies',
    icon: appIcon.links,
    url: '/?view=dependencies',
    viewModule: './native-views/dependencies-view.mjs',
    category: 'Operations',
    defaultWidth: 1040,
    defaultHeight: 700,
  },
  {
    id: 'health',
    label: 'Health',
    icon: appIcon.heartbeat,
    url: '/?view=health',
    viewModule: './native-views/health-view.mjs',
    category: 'Operations',
    defaultWidth: 980,
    defaultHeight: 680,
  },
  {
    id: 'metrics',
    label: 'Metrics',
    icon: appIcon.bars,
    url: '/?view=metrics',
    viewModule: './native-views/metrics-view.mjs',
    category: 'Operations',
    defaultWidth: 1040,
    defaultHeight: 700,
  },
  {
    id: 'runbooks',
    label: 'Runbooks',
    icon: appIcon.book,
    url: '/?view=runbooks',
    viewModule: './native-views/runbooks-view.mjs',
    category: 'Operations',
    defaultWidth: 1020,
    defaultHeight: 680,
  },
  {
    id: 'memory',
    label: 'Memory',
    icon: appIcon.brain,
    url: '/?view=memory',
    viewModule: './native-views/memory-view.mjs',
    category: 'Operations',
    defaultWidth: 1040,
    defaultHeight: 720,
  },
  {
    id: 'handoffs',
    label: 'Handoffs',
    icon: appIcon.handoff,
    url: '/?view=handoffs',
    viewModule: './native-views/handoffs-view.mjs',
    category: 'Operations',
    defaultWidth: 1040,
    defaultHeight: 700,
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: appIcon.eye,
    url: '/?view=audit',
    viewModule: './native-views/audit-view.mjs',
    category: 'Operations',
    defaultWidth: 1020,
    defaultHeight: 700,
  },
  {
    id: 'cron',
    label: 'Cron',
    icon: appIcon.clock,
    url: '/?view=cron',
    viewModule: './native-views/cron-view.mjs',
    category: 'Operations',
    defaultWidth: 980,
    defaultHeight: 660,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: appIcon.stethoscope,
    url: '/?view=diagnostics',
    viewModule: './native-views/diagnostics-view.mjs',
    category: 'Operations',
    defaultWidth: 1080,
    defaultHeight: 720,
  },
  {
    id: 'departments',
    label: 'Departments',
    icon: appIcon.building,
    url: '/?view=departments',
    viewModule: './native-views/departments-view.mjs',
    category: 'Admin',
    defaultWidth: 1020,
    defaultHeight: 700,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: appIcon.folder,
    url: '/?view=explorer',
    viewModule: './native-views/explorer-view.mjs',
    category: 'Admin',
    defaultWidth: 1020,
    defaultHeight: 700,
  },
  {
    id: 'notepad',
    label: 'Notepad',
    icon: appIcon.document,
    url: '/?view=notepad',
    viewModule: './native-views/notepad-view.mjs',
    category: 'Admin',
    defaultWidth: 960,
    defaultHeight: 700,
  },
  {
    id: 'skills-tools',
    label: 'Skills & Tools',
    icon: appIcon.wrench,
    url: '/skills-tools',
    viewModule: './native-views/skills-tools-view.mjs',
    category: 'Admin',
    defaultWidth: 1120,
    defaultHeight: 740,
  },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: appIcon.bolt,
    url: '/workflows',
    viewModule: './native-views/workflows-view.mjs',
    category: 'Admin',
    defaultWidth: 1120,
    defaultHeight: 760,
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: appIcon.gear,
    url: '/operations',
    viewModule: './native-views/operations-view.mjs',
    category: 'Admin',
    defaultWidth: 1120,
    defaultHeight: 760,
  },
]);

export const PINNED_APP_IDS = Object.freeze([
  'tasks',
  'explorer',
  'notepad',
  'agents',
  'skills-tools',
  'operations',
  'workflows',
]);

export const APP_MAP = new Map(APP_REGISTRY.map((app) => [app.id, app]));

export function getAppById(appId) {
  return APP_MAP.get(appId) ?? null;
}

export function getAppsByCategory(category) {
  return APP_REGISTRY.filter((app) => app.category === category);
}

export default APP_REGISTRY;
