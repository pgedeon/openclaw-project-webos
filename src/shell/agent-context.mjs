/**
 * Dashboard Context Builder
 *
 * Assembles a rich context object for the agent chat system,
 * giving the agent awareness of the current dashboard state.
 */


/**
 * Build a context snapshot of the current dashboard state.
 * This is sent to the agent chat endpoint so the agent knows
 * what's on screen and what's available.
 *
 * @param {object} options
 * @param {string} options.activeSpaceId - Currently active workspace ID
 * @param {string} options.activeViewId - Currently focused view/window
 * @param {object} options.viewState - Current ViewState snapshot
 * @returns {object} Dashboard context
 */
export async function buildDashboardContext(api, {
  activeSpaceId = null,
  activeViewId = null,
  viewState = {},
} = {}) {
  const context = {
    timestamp: new Date().toISOString(),
    activeSpace: null,
    activeView: activeViewId,
    stats: {},
    recentTasks: [],
    projects: [],
    agents: [],
  };

  try {
    // Parallel fetch for speed — scope by workspace when active
    const [spaces, projects, agents, recentTasks, health] = await Promise.allSettled([
      activeSpaceId ? api.spaces.get(activeSpaceId) : api.spaces.list(),
      api.projects.list(activeSpaceId ? { workspace_id: activeSpaceId } : {}),
      api.org.agents.list().catch(() => []),
      api.tasks.list({ limit: 10, sort: 'updated_at', order: 'desc', ...(activeSpaceId ? { workspace_id: activeSpaceId } : {}) }).catch(() => ({ tasks: [] })),
      api.health?.status ? api.health.status().catch(() => ({})) : (api.health ? api.health().catch(() => ({})) : Promise.resolve({})),
    ]);

    // Active space
    if (spaces.status === 'fulfilled') {
      context.activeSpace = activeSpaceId
        ? spaces.value
        : (spaces.value?.spaces?.[0] || null);
    }

    // Projects
    if (projects.status === 'fulfilled') {
      const pl = projects.value;
      context.projects = Array.isArray(pl) ? pl : pl?.projects || [];
      context.stats.projects = context.projects.length;
    }

    // Agents
    if (agents.status === 'fulfilled') {
      const al = agents.value;
      context.agents = Array.isArray(al) ? al : al?.agents || [];
      context.stats.agents = context.agents.length;
    }

    // Recent tasks
    if (recentTasks.status === 'fulfilled') {
      const rl = recentTasks.value;
      context.recentTasks = Array.isArray(rl) ? rl.slice(0, 10) : rl?.tasks?.slice(0, 10) || [];
      context.stats.recentTasks = context.recentTasks.length;
    }

    // Health
    if (health.status === 'fulfilled') {
      context.health = health.value;
    }
  } catch (err) {
    context.error = err.message;
  }

  return context;
}

export default buildDashboardContext;
