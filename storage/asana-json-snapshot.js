const fs = require('fs');

const DEFAULT_WORKFLOW_STATES = [
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'review',
  'completed',
  'archived'
];

const READ_ONLY_MESSAGE = 'Task storage is running in read-only JSON snapshot mode because PostgreSQL is unavailable';
const EMPTY_SNAPSHOT_VERSION = '1.0';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function byMostRecent(left, right) {
  const leftDate = parseDate(left?.updated_at || left?.created_at)?.getTime() || 0;
  const rightDate = parseDate(right?.updated_at || right?.created_at)?.getTime() || 0;
  return rightDate - leftDate;
}

function priorityRank(priority) {
  const map = { critical: 0, high: 1, medium: 2, low: 3 };
  return Object.prototype.hasOwnProperty.call(map, priority) ? map[priority] : 4;
}

function isDeletedTask(task) {
  return Boolean(task?.deleted_at || task?.deleted === true);
}

function isArchivedTask(task) {
  return task?.status === 'archived' || Boolean(task?.archived_at || task?.archived === true);
}

function taskMatchesUpdatedSince(task, updatedSince) {
  if (!updatedSince) return true;
  const updatedAt = parseDate(task?.updated_at || task?.created_at);
  const cutoff = parseDate(updatedSince);
  if (!updatedAt || !cutoff) return true;
  return updatedAt >= cutoff;
}

function makeReadOnlyError() {
  const error = new Error(READ_ONLY_MESSAGE);
  error.code = 'READ_ONLY_SNAPSHOT';
  return error;
}

function makeEmptySnapshot(filePath, storageNote = null) {
  return {
    version: EMPTY_SNAPSHOT_VERSION,
    created_at: null,
    updated_at: new Date().toISOString(),
    projects: [],
    tasks: [],
    workflows: [],
    audit_log: [],
    file_path: filePath,
    storage_note: storageNote,
    snapshot_available: false,
  };
}

class AsanaJsonSnapshotStorage {
  constructor(filePath) {
    this.filePath = filePath;
    this.readOnly = true;
    this.mode = 'json_snapshot';
    this.pool = null;
    this._lastWarning = null;
  }

  async init() {
    this._loadSnapshot();
  }

  _warnOnce(message) {
    if (!message || this._lastWarning === message) {
      return;
    }
    this._lastWarning = message;
    console.warn(`[AsanaJsonSnapshotStorage] ${message}`);
  }

  _loadSnapshot() {
    if (!fs.existsSync(this.filePath)) {
      const storageNote = `Snapshot file missing: ${this.filePath}`;
      this._warnOnce(storageNote);
      return makeEmptySnapshot(this.filePath, storageNote);
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: parsed?.version || EMPTY_SNAPSHOT_VERSION,
        created_at: parsed?.created_at || null,
        updated_at: parsed?.updated_at || null,
        projects: ensureArray(parsed?.projects),
        tasks: ensureArray(parsed?.tasks),
        workflows: ensureArray(parsed?.workflows),
        audit_log: ensureArray(parsed?.audit_log),
        file_path: this.filePath,
        storage_note: null,
        snapshot_available: true,
      };
    } catch (error) {
      const storageNote = `Snapshot load failed for ${this.filePath}: ${error.message}`;
      this._warnOnce(storageNote);
      return makeEmptySnapshot(this.filePath, storageNote);
    }
  }

  _getProjectMap(snapshot) {
    return new Map(snapshot.projects.map((project) => [project.id, project]));
  }

  _getWorkflowStates(project, snapshot) {
    const workflowId = project?.default_workflow_id;
    const workflow = snapshot.workflows.find((item) => item.id === workflowId) || snapshot.workflows.find((item) => item.is_default);
    return Array.isArray(workflow?.states) && workflow.states.length > 0
      ? workflow.states
      : [...DEFAULT_WORKFLOW_STATES];
  }

  _decorateTask(task, projectMap) {
    const project = projectMap.get(task.project_id);
    return {
      ...clone(task),
      project_name: project?.name || task.project_name || '',
      text: task.title,
      category: Array.isArray(task.labels) && task.labels.length > 0 ? task.labels[0] : '',
    };
  }

  _filterTasks(tasks, options = {}) {
    const includeArchived = options.include_archived === true;
    const includeDeleted = options.include_deleted === true;
    return tasks.filter((task) => {
      if (!includeDeleted && isDeletedTask(task)) {
        return false;
      }
      if (!includeArchived && isArchivedTask(task)) {
        return false;
      }
      return taskMatchesUpdatedSince(task, options.updated_since);
    });
  }

  _decorateProjects(snapshot) {
    const tasks = this._filterTasks(snapshot.tasks, {
      include_archived: true,
      include_deleted: false,
    });

    return snapshot.projects
      .map((project) => {
        const projectTasks = tasks.filter((task) => task.project_id === project.id);
        const completedCount = projectTasks.filter((task) => task.status === 'completed').length;
        const archivedCount = projectTasks.filter((task) => task.status === 'archived').length;
        const activeCount = projectTasks.length - completedCount - archivedCount;
        return {
          ...clone(project),
          project_path: project.project_path || project.name,
          child_count: Number(project.child_count || 0),
          task_count: projectTasks.length,
          active_task_count: activeCount,
          completed_task_count: completedCount,
        };
      })
      .sort(byMostRecent);
  }

  _buildAuditEntry(entry, snapshot) {
    const projectMap = this._getProjectMap(snapshot);
    const task = snapshot.tasks.find((item) => item.id === entry.entity_id) || null;
    const project = task ? projectMap.get(task.project_id) : null;
    return {
      ...clone(entry),
      actor: entry.actor || 'system',
      task_id: task?.id || null,
      task_title: task?.title || null,
      project_id: project?.id || null,
      project_name: project?.name || null,
      timestamp: entry.timestamp || null,
    };
  }

  _sortQueue(tasks) {
    return [...tasks].sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDelta !== 0) return priorityDelta;

      const leftDue = parseDate(left.due_date)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightDue = parseDate(right.due_date)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (leftDue !== rightDue) return leftDue - rightDue;

      const leftCreated = parseDate(left.created_at)?.getTime() || 0;
      const rightCreated = parseDate(right.created_at)?.getTime() || 0;
      return leftCreated - rightCreated;
    });
  }

  _throwReadOnly() {
    throw makeReadOnlyError();
  }

  async stats() {
    const snapshot = this._loadSnapshot();
    const visibleTasks = this._filterTasks(snapshot.tasks, {
      include_archived: true,
      include_deleted: false,
    });
    const completedTasks = visibleTasks.filter((task) => task.status === 'completed').length;

    return {
      projects: snapshot.projects.length,
      tasks: visibleTasks.length,
      task_count: visibleTasks.length,
      completed_tasks: completedTasks,
      completed: completedTasks,
      workflows: snapshot.workflows.length,
      audit_entries: snapshot.audit_log.length,
      storage_mode: this.mode,
      read_only: true,
      snapshot_path: this.filePath,
      snapshot_available: snapshot.snapshot_available !== false,
      storage_note: snapshot.storage_note || READ_ONLY_MESSAGE,
      last_updated: snapshot.updated_at || new Date().toISOString(),
    };
  }

  async listProjects(filters = {}) {
    const snapshot = this._loadSnapshot();
    const projects = this._decorateProjects(snapshot);
    if (filters?.status) {
      return projects.filter((project) => project.status === filters.status);
    }
    return projects;
  }

  async getProject(id) {
    const projects = await this.listProjects();
    const project = projects.find((item) => item.id === id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    return project;
  }

  async getDefaultProject(filters = {}) {
    const projects = await this.listProjects(filters);
    return projects.find((project) => project.status !== 'archived') || projects[0] || null;
  }

  async listAllTasks(options = {}) {
    const snapshot = this._loadSnapshot();
    const projectMap = this._getProjectMap(snapshot);
    return this._filterTasks(snapshot.tasks, options)
      .map((task) => this._decorateTask(task, projectMap))
      .sort(byMostRecent);
  }

  async listTasks(projectId, options = {}) {
    const tasks = await this.listAllTasks(options);
    return tasks.filter((task) => task.project_id === projectId);
  }

  async getTask(id, options = {}) {
    const snapshot = this._loadSnapshot();
    const projectMap = this._getProjectMap(snapshot);
    const task = snapshot.tasks.find((item) => item.id === id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (!options.include_deleted && isDeletedTask(task)) {
      throw new Error(`Task not found: ${id}`);
    }
    if (!options.include_archived && isArchivedTask(task)) {
      throw new Error(`Task not found: ${id}`);
    }

    const decorated = this._decorateTask(task, projectMap);
    if (options.includeGraph) {
      decorated.subtasks = this._filterTasks(
        snapshot.tasks.filter((item) => item.parent_task_id === id),
        { include_archived: true, include_deleted: false }
      ).map((item) => this._decorateTask(item, projectMap));

      decorated.dependencies = ensureArray(task.dependency_ids)
        .map((dependencyId) => snapshot.tasks.find((item) => item.id === dependencyId))
        .filter(Boolean)
        .map((item) => this._decorateTask(item, projectMap));
    }

    return decorated;
  }

  async getDependencies(id) {
    const task = await this.getTask(id, { include_archived: true, include_deleted: true });
    return ensureArray(task.dependency_ids);
  }

  async getAuditLog(taskId, limit = 100) {
    const snapshot = this._loadSnapshot();
    return snapshot.audit_log
      .filter((entry) => entry.entity_type === 'task' && entry.entity_id === taskId)
      .sort((left, right) => (parseDate(right.timestamp)?.getTime() || 0) - (parseDate(left.timestamp)?.getTime() || 0))
      .slice(0, limit)
      .map((entry) => this._buildAuditEntry(entry, snapshot));
  }

  async queryAuditLog(filters = {}, limit = 100, offset = 0) {
    const snapshot = this._loadSnapshot();
    let entries = snapshot.audit_log.map((entry) => this._buildAuditEntry(entry, snapshot));

    if (filters.task_id) {
      entries = entries.filter((entry) => entry.entity_id === filters.task_id || entry.task_id === filters.task_id);
    }
    if (filters.actor) {
      const actorFilter = String(filters.actor).toLowerCase();
      entries = entries.filter((entry) => String(entry.actor || '').toLowerCase().includes(actorFilter));
    }
    if (filters.action) {
      const actionFilter = String(filters.action).toLowerCase();
      entries = entries.filter((entry) => String(entry.action || '').toLowerCase() === actionFilter);
    }
    if (filters.entity_type) {
      const typeFilter = String(filters.entity_type).toLowerCase();
      entries = entries.filter((entry) => String(entry.entity_type || '').toLowerCase() === typeFilter);
    }
    if (filters.q) {
      const query = String(filters.q).toLowerCase();
      entries = entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query));
    }
    if (filters.start_date) {
      const startDate = parseDate(filters.start_date);
      if (startDate) {
        entries = entries.filter((entry) => {
          const timestamp = parseDate(entry.timestamp);
          return !timestamp || timestamp >= startDate;
        });
      }
    }
    if (filters.end_date) {
      const endDate = parseDate(filters.end_date);
      if (endDate) {
        entries = entries.filter((entry) => {
          const timestamp = parseDate(entry.timestamp);
          return !timestamp || timestamp <= endDate;
        });
      }
    }

    entries.sort((left, right) => (parseDate(right.timestamp)?.getTime() || 0) - (parseDate(left.timestamp)?.getTime() || 0));
    return {
      logs: entries.slice(offset, offset + limit),
      total: entries.length,
    };
  }

  async getLeadHandoffs({ actionFilter, actorFilter, projectFilter, limit = 50, offset = 0 } = {}) {
    const snapshot = this._loadSnapshot();
    const allowedActions = actionFilter
      ? new Set(String(actionFilter).split(',').map((value) => value.trim()).filter(Boolean))
      : null;

    let items = snapshot.audit_log
      .map((entry) => this._buildAuditEntry(entry, snapshot))
      .filter((entry) => entry.entity_type === 'task');

    if (allowedActions) {
      items = items.filter((entry) => allowedActions.has(entry.action));
    }
    if (actorFilter) {
      const actorQuery = String(actorFilter).toLowerCase();
      items = items.filter((entry) => String(entry.actor || '').toLowerCase().includes(actorQuery));
    }
    if (projectFilter) {
      items = items.filter((entry) => entry.project_id === projectFilter);
    }

    items.sort((left, right) => (parseDate(right.timestamp)?.getTime() || 0) - (parseDate(left.timestamp)?.getTime() || 0));
    return {
      handoffs: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
      read_only: true,
    };
  }

  async getBoardView(projectId) {
    const snapshot = this._loadSnapshot();
    const project = await this.getProject(projectId);
    const workflow = this._getWorkflowStates(project, snapshot);
    const projectMap = this._getProjectMap(snapshot);
    const tasks = this._filterTasks(
      snapshot.tasks.filter((task) => task.project_id === projectId),
      { include_archived: false, include_deleted: false }
    ).map((task) => this._decorateTask(task, projectMap));

    const columns = {};
    workflow.forEach((state) => {
      columns[state] = tasks.filter((task) => task.status === state);
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        project_path: project.project_path || project.name,
        aggregated: false,
        child_count: Number(project.child_count || 0),
      },
      workflow,
      columns,
      read_only: true,
    };
  }

  async getTimelineView(projectId, startDate, endDate) {
    const snapshot = this._loadSnapshot();
    const project = await this.getProject(projectId);
    const workflow = this._getWorkflowStates(project, snapshot);
    const projectMap = this._getProjectMap(snapshot);
    const windowStart = parseDate(startDate) || new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const windowEnd = parseDate(endDate) || new Date(Date.now() + (60 * 24 * 60 * 60 * 1000));

    const tasks = this._filterTasks(
      snapshot.tasks.filter((task) => task.project_id === projectId),
      { include_archived: false, include_deleted: false }
    );

    const items = [];
    const unscheduled = [];

    tasks.forEach((task) => {
      const start = parseDate(task.start_date);
      const due = parseDate(task.due_date);
      const decorated = this._decorateTask(task, projectMap);
      const base = {
        id: decorated.id,
        title: decorated.title,
        status: decorated.status,
        priority: decorated.priority,
        owner: decorated.owner,
        start_date: start ? start.toISOString() : null,
        due_date: due ? due.toISOString() : null,
        dependencies: ensureArray(decorated.dependency_ids),
        labels: ensureArray(decorated.labels),
        qmd_namespace: decorated.qmd_namespace || null,
        project_id: decorated.project_id,
        project_name: decorated.project_name,
        completed_at: decorated.completed_at || null,
      };

      if (!start && !due) {
        unscheduled.push(base);
        return;
      }

      const rangeStart = start || due;
      const rangeEnd = due || start;
      if (rangeStart <= windowEnd && rangeEnd >= windowStart) {
        items.push(base);
      }
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        qmd_project_namespace: project.qmd_project_namespace || null,
        workspace_id: project.workspace_id || null,
      },
      workflow,
      range: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      items,
      unscheduled,
      read_only: true,
    };
  }

  async getAgentQueue(agentName, statuses = ['ready', 'in_progress'], options = {}) {
    const snapshot = this._loadSnapshot();
    const projectMap = this._getProjectMap(snapshot);
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const limit = Math.max(1, Number.parseInt(options.limit, 10) || 50);
    const filtered = this._sortQueue(
      this._filterTasks(snapshot.tasks, { include_archived: false, include_deleted: false })
        .filter((task) => task.owner === agentName && statuses.includes(task.status))
    );

    const total = filtered.length;
    const pageItems = filtered.slice((page - 1) * limit, page * limit).map((task) => {
      const decorated = this._decorateTask(task, projectMap);
      return {
        id: decorated.id,
        title: decorated.title,
        description: decorated.description,
        status: decorated.status,
        priority: decorated.priority,
        dueDate: decorated.due_date,
        startDate: decorated.start_date,
        project_id: decorated.project_id,
        lockedBy: decorated.execution_locked_by || null,
        lockedAt: decorated.execution_lock || null,
        retryCount: decorated.retry_count || 0,
        lastRun: null,
      };
    });

    return {
      tasks: pageItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      read_only: true,
    };
  }

  async listAgentStatuses() {
    return [];
  }

  async recordAgentHeartbeat() {
    return { ok: true, read_only: true };
  }

  async listSavedViews() {
    return [];
  }

  async getSavedView() {
    return null;
  }

  async deleteSavedView() {
    return false;
  }

  async listServices() {
    return [];
  }

  async getService() {
    return null;
  }

  async listServiceRequests() {
    return [];
  }

  async getServiceRequest() {
    return null;
  }

  async createSavedView() {
    this._throwReadOnly();
  }

  async updateSavedView() {
    this._throwReadOnly();
  }

  async createProject() {
    this._throwReadOnly();
  }

  async updateProject() {
    this._throwReadOnly();
  }

  async archiveProject() {
    this._throwReadOnly();
  }

  async createTask() {
    this._throwReadOnly();
  }

  async updateTask() {
    this._throwReadOnly();
  }

  async deleteTask() {
    this._throwReadOnly();
  }

  async archiveTask() {
    this._throwReadOnly();
  }

  async restoreTask() {
    this._throwReadOnly();
  }

  async moveTask() {
    this._throwReadOnly();
  }

  async addDependency() {
    this._throwReadOnly();
  }

  async removeDependency() {
    this._throwReadOnly();
  }

  async addSubtask() {
    this._throwReadOnly();
  }

  async claimTask() {
    this._throwReadOnly();
  }

  async releaseTask() {
    this._throwReadOnly();
  }

  async retryTask() {
    this._throwReadOnly();
  }

  async createServiceRequest() {
    this._throwReadOnly();
  }

  async updateServiceRequest() {
    this._throwReadOnly();
  }

  async routeServiceRequest() {
    this._throwReadOnly();
  }
}

module.exports = {
  AsanaJsonSnapshotStorage,
  READ_ONLY_MESSAGE,
};
