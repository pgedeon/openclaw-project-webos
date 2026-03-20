/**
 * State Manager for OpenClaw Dashboard
 * 
 * Unified state management with:
 * - Primary storage: IndexedDB
 * - Fallback: localStorage
 * - Automatic migration from localStorage to IndexedDB
 * - Same API as existing localStorage-based system
 */

import { idb, STORES } from './idb.mjs';
import { syncManager, OPERATION } from './sync-manager.mjs';

const STORAGE_KEY = 'projectDashboardState';
const LEGACY_KEY = 'projectTasks';
const STORAGE_VERSION = 3;
const DEFAULT_CATEGORIES = [];

// State schema
const defaultState = () => ({
  version: STORAGE_VERSION,
  theme: getPreferredTheme(),
  filter: 'all',
  search: '',
  categoryFilter: 'all',
  sort: 'newest',
  view: 'list',
  agentViewAgent: null,
  project_id: null, // Asana project ID
  categories: [...DEFAULT_CATEGORIES],
  tasks: [],
  lastSyncTime: null, // ISO timestamp for incremental sync
  savedViews: [], // Array of saved view objects {id, project_id, name, filters, sort, created_by, created_at, updated_at}
  activeSavedViewId: null // Currently applied saved view ID (or null)
});

// State change listeners
const listeners = new Set();

// Backup storage key for recovery
const STORAGE_BACKUP_KEY = STORAGE_KEY + '.backup';

// Debounced persistence
let saveTimeout = null;
let pendingResolvers = [];
let pendingState = null;

/**
 * Debounced save to IndexedDB and localStorage.
 * @param {Object} state - State to persist.
 * @returns {Promise<void>}
 */
function debouncedSave(state) {
  return new Promise((resolve, reject) => {
    pendingResolvers.push({ resolve, reject });
    pendingState = state;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      saveTimeout = null;
      const stateToSave = pendingState;
      pendingState = null;
      try {
        await saveToIDB(stateToSave);
        saveToLocalStorage(stateToSave);
        resolvers.forEach(r => r.resolve());
      } catch (error) {
        console.error('[StateManager] IndexedDB save failed, falling back to localStorage:', error);
        try {
          saveToLocalStorage(stateToSave);
          resolvers.forEach(r => r.resolve());
        } catch (fallbackError) {
          console.error('[StateManager] LocalStorage fallback also failed:', fallbackError);
          resolvers.forEach(r => r.reject(fallbackError));
        }
      }
    }, 1000); // 1 second debounce
  });
}

/**
 * Get preferred theme based on system preference
 * @returns {string}
 */
function getPreferredTheme() {
  // Default to dark mode (was: system preference)
  return 'dark';
}

/**
 * Initialize state manager
 * @param {Object} options - Configuration options
 */
async function init(options = {}) {
  console.log('[StateManager] Initializing...');

  try {
    // Initialize IndexedDB
    await idb.init();
    console.log('[StateManager] IndexedDB initialized');

    // Try to load from IndexedDB
    let state = await loadFromIDB();
    if (!state) {
      console.log('[StateManager] No IndexedDB state found, loading from localStorage');
      state = await loadFromLocalStorage();
      if (state) {
        // Migrate to IndexedDB
        await saveToIDB(state);
        console.log('[StateManager] Migrated localStorage state to IndexedDB');
      } else {
        console.log('[StateManager] No existing state found, using defaults');
        state = defaultState();
        await saveToIDB(state);
      }
    }

    // Initialize sync manager if online
    if (navigator.onLine && options.enableSync !== false) {
      await syncManager.init();
    }

    // Notify listeners
    notifyListeners('load', state);
    console.log('[StateManager] Initialized successfully');

    return state;
  } catch (error) {
    console.error('[StateManager] Initialization failed:', error);
    // Fall back to localStorage
    const state = await loadFromLocalStorage() || defaultState();
    notifyListeners('load', state);
    return state;
  }
}

/**
 * Load state from IndexedDB
 */
async function loadFromIDB() {
  try {
    const data = await idb.get(STORES.TASKS, 'dashboard_state');
    if (data && data.state) {
      return hydrateState(data.state);
    }
    // Check for legacy task-only storage
    const tasks = await idb.getAll(STORES.TASKS);
    if (tasks.length > 0) {
      return hydrateState({
        ...defaultState(),
        tasks: tasks.map(t => normalizeTask(t)).filter(Boolean)
      });
    }
  } catch (error) {
    console.warn('[StateManager] Failed to load from IndexedDB:', error);
  }
  return null;
}

/**
 * Save state to IndexedDB
 */
async function saveToIDB(state) {
  try {
    await idb.put(STORES.TASKS, {
      id: 'dashboard_state',
      state,
      timestamp: Date.now()
    }, false);
    notifyListeners('save', state);
  } catch (error) {
    console.error('[StateManager] Failed to save to IndexedDB:', error);
    throw error;
  }
}

/**
 * Load state from localStorage (legacy)
 */
async function loadFromLocalStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          if (Number(parsed.version) === STORAGE_VERSION) {
            return hydrateState(parsed);
          }
          return migrateState(parsed);
        }
      } catch (parseError) {
        console.warn('[StateManager] Failed to parse primary localStorage, trying backup:', parseError);
        const backup = localStorage.getItem(STORAGE_BACKUP_KEY);
        if (backup) {
          try {
            const parsedBackup = JSON.parse(backup);
            if (parsedBackup && typeof parsedBackup === 'object') {
              console.log('[StateManager] Recovered state from backup');
              if (Number(parsedBackup.version) === STORAGE_VERSION) {
                return hydrateState(parsedBackup);
              }
              return migrateState(parsedBackup);
            }
          } catch (backupParseError) {
            console.warn('[StateManager] Failed to parse backup:', backupParseError);
          }
        }
      }
    }

    // Check legacy key
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      try {
        const legacyTasks = JSON.parse(legacy);
        if (Array.isArray(legacyTasks)) {
          return migrateState({ tasks: legacyTasks });
        }
      } catch (error) {
        console.warn('[StateManager] Failed to parse legacy data:', error);
      }
    }
  } catch (error) {
    console.warn('[StateManager] localStorage unavailable:', error);
  }
  return null;
}

/**
 * Save state to localStorage (backup)
 */
function saveToLocalStorage(state) {
  try {
    // Rotate backup: store current primary (if any) as backup before overwriting
    try {
      const currentPrimary = localStorage.getItem(STORAGE_KEY);
      if (currentPrimary) {
        localStorage.setItem(STORAGE_BACKUP_KEY, currentPrimary);
      }
    } catch (e) {
      console.warn('[StateManager] Failed to rotate backup in localStorage:', e);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('[StateManager] Failed to save to localStorage:', error);
    throw error; // Let caller handle
  }
}

/**
 * Hydrate state from raw data (merge with defaults)
 */
function hydrateState(raw) {
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const normalizedTasks = tasks.map(task => normalizeTask(task)).filter(Boolean);
  const savedViews = Array.isArray(raw.savedViews) ? raw.savedViews : [];

  return {
    ...defaultState(),
    ...raw,
    categories: collectCategories(normalizedTasks),
    tasks: normalizedTasks,
    savedViews
  };
}

/**
 * Migrate old state format to current
 */
function migrateState(raw) {
  return hydrateState({
    ...raw,
    view: raw.view || 'list',
    version: STORAGE_VERSION,
    categoryFilter: raw.categoryFilter || 'all',
    categories: [...DEFAULT_CATEGORIES],
    tasks: (raw.tasks || []).map(task => ({
      ...task,
      category: task.category || 'General'
    })),
    savedViews: raw.savedViews || [],
    activeSavedViewId: raw.activeSavedViewId || null
  });
}

/**
 * Normalize a task object
 * Supports both legacy format (completed boolean) and Asana format (status string)
 */
function normalizeTask(task) {
  if (!task) return null;
  
  // Determine text (legacy: text, Asana: title)
  const text = (task.text || task.title || '').trim();
  if (!text) return null;
  
  const id = typeof task.id === 'number' || typeof task.id === 'string' ? task.id : Date.now() + Math.floor(Math.random() * 1000);
  
  const status = typeof task.status === 'string' && task.status.trim()
    ? task.status.trim()
    : (Boolean(task.completed) ? 'completed' : 'backlog');
  const archived = Boolean(task.archived) || Boolean(task.archived_at) || status === 'archived';
  const completed = !archived && (status === 'completed' || (!task.status && Boolean(task.completed)));
  const category = getTaskCategory(task);
  
  return {
    id,
    text,
    description: task.description || '',
    category,
    completed,
    status, // Include for frontend use
    priority: task.priority || 'medium',
    owner: task.owner || null,
    project_id: task.project_id || null,
    dependency_ids: Array.isArray(task.dependency_ids) ? task.dependency_ids : [],
    labels: Array.isArray(task.labels) ? task.labels : [],
    start_date: task.start_date || task.startDate || null,
    due_date: task.due_date || task.dueDate || null,
    estimated_effort: task.estimated_effort || null,
    actual_effort: task.actual_effort || null,
    completed_at: task.completed_at || task.completedAt || null,
    recurrence_rule: task.recurrence_rule || null,
    metadata: task.metadata || {},
    execution_lock: task.execution_lock || false,
    execution_locked_by: task.execution_locked_by || null,
    parent_task_id: task.parent_task_id || null,
    archived_at: task.archived_at || null,
    deleted_at: task.deleted_at || null,
    archived,
    deleted: !!task.deleted_at,
    createdAt: task.createdAt || task.created_at || new Date().toISOString(),
    updatedAt: task.updatedAt || task.updated_at || null
  };
}

function getTaskCategory(task) {
  const category = typeof task?.category === 'string' ? task.category.trim() : '';
  if (category) return sanitizeCategory(category);

  if (Array.isArray(task?.labels)) {
    const firstLabel = task.labels.find(label => typeof label === 'string' && label.trim());
    if (firstLabel) return sanitizeCategory(firstLabel);
  }

  return 'General';
}

/**
 * Sanitize category name
 */
function sanitizeCategory(value) {
  const clean = (value || '').trim();
  if (!clean) return 'General';
  return clean.slice(0, 30);
}

/**
 * Merge categories from existing and tasks
 */
function collectCategories(tasks = []) {
  const set = new Set(DEFAULT_CATEGORIES);
  tasks.forEach(task => {
    if (!task) return;
    set.add(getTaskCategory(task));
  });

  return Array.from(set).sort((a, b) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

/**
 * Subscribe to state changes
 */
function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Notify listeners of state change
 */
function notifyListeners(event, state) {
  listeners.forEach(callback => {
    try {
      callback(event, state);
    } catch (error) {
      console.error('[StateManager] Listener error:', error);
    }
  });
}

// ==================== TASK OPERATIONS ====================

/**
 * Add a new task
 * Supports both legacy quick-add `(text, category)` and a richer task object payload.
 */
async function addTask(taskInput, category = 'General', legacyOptions = {}) {
  const currentState = await getState();
  // Generate a UUID v4 for the task ID (compatible with server)
  const taskId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const inputTask = (taskInput && typeof taskInput === 'object')
    ? taskInput
    : { text: taskInput, category, ...legacyOptions };
  const text = (inputTask.text || inputTask.title || '').trim();
  if (!text) {
    throw new Error('Task text is required');
  }

  const normalizedCategory = sanitizeCategory(inputTask.category || category);
  const metadata = inputTask.metadata && typeof inputTask.metadata === 'object'
    ? inputTask.metadata
    : {};
  const status = typeof inputTask.status === 'string' && inputTask.status.trim()
    ? inputTask.status.trim()
    : 'backlog';

  const task = {
    id: taskId,
    text,
    title: text, // Asana uses title field
    description: inputTask.description || '',
    category: normalizedCategory,
    labels: [normalizedCategory],
    completed: status === 'completed',
    status,
    priority: inputTask.priority || 'medium',
    owner: inputTask.owner || null,
    start_date: inputTask.start_date || null,
    due_date: inputTask.due_date || null,
    estimated_effort: inputTask.estimated_effort || null,
    actual_effort: inputTask.actual_effort || null,
    dependency_ids: Array.isArray(inputTask.dependency_ids) ? inputTask.dependency_ids : [],
    recurrence_rule: inputTask.recurrence_rule || null,
    metadata,
    parent_task_id: inputTask.parent_task_id || null,
    ...(inputTask.project_id || currentState.project_id
      ? { project_id: inputTask.project_id || currentState.project_id }
      : {}),
    createdAt: new Date().toISOString(),
    updatedAt: null
  };

  currentState.tasks.unshift(task);
  currentState.categories = collectCategories(currentState.tasks);

  await setState(currentState);

  // Queue for sync if online
  if (navigator.onLine) {
    syncManager.queueOperation(OPERATION.CREATE, task).catch(console.error);
  }

  return task;
}

/**
 * Toggle task completion
 * Supports both legacy completed boolean and Asana status field
 * @param {number|string} id - Task ID
 */
async function toggleTask(id) {
  const currentState = await getState();
  const task = currentState.tasks.find(t => t.id === id);
  if (!task) return;

  // Determine new completed state
  const newCompleted = !task.completed;
  task.completed = newCompleted;
  
  // Also update status if present for consistency with Asana schema
  if (task.status) {
    task.status = newCompleted ? 'completed' : 'backlog';
  }

  task.completed_at = newCompleted ? new Date().toISOString() : null;
  
  task.updatedAt = new Date().toISOString();

  if (newCompleted && ['daily', 'weekly', 'monthly', 'yearly'].includes(task.recurrence_rule)) {
    const now = new Date().toISOString();
    const newTask = {
      ...task,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      completed: false,
      status: 'backlog',
      completed_at: null,
      actual_effort: null,
      start_date: task.start_date ? adjustDate(task.start_date, task.recurrence_rule) : null,
      due_date: task.due_date ? adjustDate(task.due_date, task.recurrence_rule) : null,
      recurrence_rule: task.recurrence_rule
    };
    currentState.tasks.push(newTask);
  }

  await setState(currentState);

  // Queue for sync
  if (navigator.onLine) {
    syncManager.queueOperation(OPERATION.UPDATE, task, id).catch(console.error);
  }
}

/**
 * Adjust a date string forward based on recurrence rule.
 */
function adjustDate(dateStr, rec) {
  const d = new Date(dateStr);
  if (rec === 'daily') d.setDate(d.getDate() + 1);
  else if (rec === 'weekly') d.setDate(d.getDate() + 7);
  else if (rec === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (rec === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

/**
 * Update a task
 * @param {number} id - Task ID
 * @param {Object} updates - Fields to update
 */
async function updateTask(id, updates) {
  const currentState = await getState();
  const taskIndex = currentState.tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return;

  // Map legacy fields to Asana schema before merging
  const transformedUpdates = { ...updates };
  if (updates.text !== undefined && updates.title === undefined) {
    transformedUpdates.title = updates.text;
  }
  if (updates.completed !== undefined && updates.status === undefined) {
    transformedUpdates.status = updates.completed ? 'completed' : 'backlog';
  }
  // Map category to labels array for backend compatibility
  if (updates.category !== undefined && updates.labels === undefined) {
    transformedUpdates.labels = [updates.category];
  }
  // Map category to labels array for backend compatibility
  if (updates.category !== undefined && updates.labels === undefined) {
    transformedUpdates.labels = [updates.category];
  }

  currentState.tasks[taskIndex] = {
    ...currentState.tasks[taskIndex],
    ...transformedUpdates,
    updatedAt: new Date().toISOString()
  };

  currentState.categories = collectCategories(currentState.tasks);

  await setState(currentState);

  // Queue for sync with only the transformed fields (not the entire task)
  if (navigator.onLine) {
    console.log('[StateManager] updateTask queuing payload:', transformedUpdates);
    syncManager.queueOperation(OPERATION.UPDATE, transformedUpdates, id).catch(console.error);
  }

  return currentState.tasks[taskIndex];
}

/**
 * Delete a task
 * @param {number} id - Task ID
 */
async function deleteTask(id) {
  const currentState = await getState();
  const task = currentState.tasks.find(t => t.id === id);
  if (!task) return;

  currentState.tasks = currentState.tasks.filter(t => t.id !== id);
  await setState(currentState);

  // Queue for sync
  if (navigator.onLine) {
    syncManager.queueOperation(OPERATION.DELETE, { id }, id).catch(console.error);
  }

  return task;
}

/**
 * Archive a task (preserve history, hide from active lists)
 */
async function archiveTask(id) {
  const currentState = await getState();
  const task = currentState.tasks.find(t => t.id === id);
  if (!task) return;

  // Update local task with immediate archive flag (optimistic)
  task.archived_at = new Date().toISOString();
  task.updated_at = new Date().toISOString();
  await setState(currentState);

  // Queue for sync: custom operation ARCHIVE
  if (navigator.onLine) {
    syncManager.queueOperation('ARCHIVE', { id }, id).catch(console.error);
  }

  return task;
}

/**
 * Restore a task from archive or deletion
 */
async function restoreTask(id) {
  const currentState = await getState();
  const task = currentState.tasks.find(t => t.id === id);
  if (!task) return;

  // Clear archival marks
  task.archived_at = null;
  task.deleted_at = null;
  task.updated_at = new Date().toISOString();
  await setState(currentState);

  // Queue for sync: custom operation RESTORE
  if (navigator.onLine) {
    syncManager.queueOperation('RESTORE', { id }, id).catch(console.error);
  }

  return task;
}

/**
 * Clear completed tasks
 */
async function clearCompleted() {
  const currentState = await getState();
  currentState.tasks = currentState.tasks.filter(t => !t.completed);
  await setState(currentState);

  // Note: clear completed is a bulk operation; for simplicity we don't queue individual deletes
  // In production, you might want to track these as separate deletes or implement a bulk sync endpoint
}

/**
 * Get current state
 */
async function getState() {
  try {
    const data = await idb.get(STORES.TASKS, 'dashboard_state');
    if (data && data.state) {
      return hydrateState(data.state);
    }
    // Fallback to localStorage
    return await loadFromLocalStorage() || defaultState();
  } catch (error) {
    console.error('[StateManager] Failed to get state:', error);
    return defaultState();
  }
}

/**
 * Set state (full replacement)
 * @param {Object} newState - The new state object
 */
async function setState(newState) {
  const current = await getState();
  const tasksInput = newState.tasks !== undefined ? newState.tasks : current.tasks;
  const tasks = Array.isArray(tasksInput)
    ? tasksInput.map(task => normalizeTask(task)).filter(Boolean)
    : current.tasks;
  const merged = {
    ...current,
    ...newState,
    tasks,
    categories: collectCategories(tasks)
  };
  await debouncedSave(merged);
  notifyListeners('change', merged);
}

/**
 * Update specific state fields
 * @param {Object} updates - Fields to update
 */
async function updateState(updates) {
  const current = await getState();
  const merged = { ...current, ...updates };
  await setState(merged);
}

/**
 * Clear all state
 */
async function clearState() {
  await idb.clear(STORES.TASKS);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  const empty = defaultState();
  await saveToIDB(empty);
  notifyListeners('clear', empty);
}

// ==================== SAVED VIEWS API ====================

/**
 * Set the entire savedViews array
 * @param {Array} views - Array of saved view objects
 */
async function setSavedViews(views) {
  await updateState({ savedViews: views });
}

/**
 * Set the active saved view ID
 * @param {string|null} viewId - The selected view ID or null
 */
async function setActiveView(viewId) {
  await updateState({ activeSavedViewId: viewId });
}

/**
 * Add a saved view to the list
 * @param {object} view - Saved view object (with id)
 */
async function addSavedView(view) {
  const current = await getState();
  const views = [...current.savedViews, view];
  await setSavedViews(views);
}

/**
 * Update an existing saved view by ID
 * @param {string} id - View ID
 * @param {object} updates - Fields to update
 */
async function updateSavedView(id, updates) {
  const current = await getState();
  const views = current.savedViews.map(v => (v.id === id ? { ...v, ...updates } : v));
  await setSavedViews(views);
}

/**
 * Remove a saved view by ID
 * @param {string} id - View ID
 */
async function removeSavedView(id) {
  const current = await getState();
  const views = current.savedViews.filter(v => v.id !== id);
  await setSavedViews(views);
  // Also clear active if it was this view
  if (current.activeSavedViewId === id) {
    await setActiveView(null);
  }
}

// ==================== EXPORTS ====================

// Export all functions
export {
  init,
  getState,
  setState,
  updateState,
  addTask,
  toggleTask,
  updateTask,
  deleteTask,
  archiveTask,
  restoreTask,
  clearCompleted,
  subscribe,
  clearState,
  normalizeTask,
  syncManager,
  // Saved Views API
  setSavedViews,
  setActiveView,
  addSavedView,
  updateSavedView,
  removeSavedView
};

// Also expose on window for backward compatibility
if (typeof window !== 'undefined') {
  window.StateManager = {
    init,
    getState,
    setState,
    updateState,
    addTask,
    toggleTask,
    updateTask,
    deleteTask,
    archiveTask,
    restoreTask,
    clearCompleted,
    subscribe,
    clearState,
    syncManager,
    // Saved Views
    setSavedViews,
    setActiveView,
    addSavedView,
    updateSavedView,
    removeSavedView
  };
}
