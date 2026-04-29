/**
 * Agent Actions — safe, scoped operations the dashboard agent can perform.
 *
 * Read-only actions are always allowed.
 * Write actions require user confirmation in the UI.
 */

// Read-only actions (no confirmation needed)
export const READ_ACTIONS = {
  'tasks.list': (api, params) => api.tasks.list(params),
  'tasks.get': (api, { id }) => api.tasks.get(id),
  'projects.list': (api) => api.projects.list(),
  'workflows.list': (api) => api.workflows.list(),
  'agents.list': (api) => api.org.agents.list(),
  'health.get': (api) => api.health(),
  'history.list': (api, params) => api.history.list(params),
  'history.forTask': (api, { taskId, ...params }) => api.history.forTask(taskId, params),
  'snapshots.list': (api, { entityType, entityId, ...params }) => api.snapshots.list(entityType, entityId, params),
  'snapshots.preview': (api, { snapshotId }) => api.snapshots.previewRevert(snapshotId),
  'spaces.list': (api) => api.spaces.list(),
  'spaces.get': (api, { id }) => api.spaces.get(id),
  'export.bundle': (api) => api.export.bundle(),
  'memory.context': (api, params) => api.memory.context(params),
};

// Write actions (require confirmation)
export const WRITE_ACTIONS = {
  'tasks.create': { label: 'Create Task', confirm: true, fn: (api, data) => api.tasks.create(data) },
  'tasks.update': { label: 'Update Task', confirm: true, fn: (api, { id, ...data }) => api.tasks.update(id, data) },
  'tasks.move': { label: 'Move Task', confirm: true, fn: (api, { id, status }) => api.tasks.move(id, status) },
  'tasks.archive': { label: 'Archive Task', confirm: true, fn: (api, { id }) => api.tasks.archive(id) },
  'tasks.restore': { label: 'Restore Task', confirm: true, fn: (api, { id }) => api.tasks.restore(id) },
  'projects.create': { label: 'Create Project', confirm: true, fn: (api, data) => api.projects.create(data) },
  'snapshots.revert': { label: 'Revert to Snapshot', confirm: true, fn: (api, { snapshotId, actor }) => api.snapshots.revert(snapshotId, actor) },
  'spaces.create': { label: 'Create Space', confirm: true, fn: (api, data) => api.spaces.create(data) },
  'spaces.update': { label: 'Update Space', confirm: true, fn: (api, { id, ...data }) => api.spaces.update(id, data) },
  'import.run': { label: 'Import Data', confirm: true, fn: (api, data) => api.import.run(data) },
};

/**
 * Execute an agent action. Returns { needsConfirm, result } or throws.
 */
export async function executeAction(api, actionName, params, confirmed = false) {
  // Check read-only first
  if (READ_ACTIONS[actionName]) {
    return { needsConfirm: false, result: await READ_ACTIONS[actionName](api, params) };
  }

  // Check write actions
  const writeAction = WRITE_ACTIONS[actionName];
  if (!writeAction) {
    throw new Error(`Unknown action: ${actionName}`);
  }

  if (!confirmed) {
    return {
      needsConfirm: true,
      action: actionName,
      label: writeAction.label,
      params,
    };
  }

  return {
    needsConfirm: false,
    result: await writeAction.fn(api, params),
  };
}

export default { READ_ACTIONS, WRITE_ACTIONS, executeAction };
