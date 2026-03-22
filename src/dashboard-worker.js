/**
 * Dashboard Worker
 * 
 * Handles expensive operations off the main thread:
 * - Filtering tasks
 * - Sorting tasks
 * - Searching tasks
 * - Category filtering
 */

// Worker state
let tasks = [];
let categories = [];

/**
 * Handle incoming messages
 */
self.onmessage = function(e) {
  try {
    const { type, data } = e.data || {};

    switch (type) {
      case 'INIT':
        tasks = (data && data.tasks) || [];
        categories = (data && data.categories) || [];
        self.postMessage({ type: 'INIT_COMPLETE' });
        break;

      case 'SET_TASKS':
        tasks = (data && data.tasks) || [];
        self.postMessage({ type: 'TASKS_UPDATED', count: tasks.length });
        break;

      case 'FILTER_AND_SORT':
        try {
          const result = filterAndSort(data);
          self.postMessage({
            type: 'FILTER_SORT_COMPLETE',
            result,
            duration: data?._duration || 0
          });
        } catch (err) {
          console.error('[DashboardWorker] Filter/Sort error:', err);
          self.postMessage({ type: 'ERROR', error: 'filter_sort_failed', message: err.message });
        }
        break;

      case 'SEARCH':
        try {
          const searchResult = search(data);
          self.postMessage({
            type: 'SEARCH_COMPLETE',
            result: searchResult,
            duration: data?._duration || 0
          });
        } catch (err) {
          console.error('[DashboardWorker] Search error:', err);
          self.postMessage({ type: 'ERROR', error: 'search_failed', message: err.message });
        }
        break;

      case 'GET_STATS':
        try {
          const stats = calculateStats();
          self.postMessage({
            type: 'STATS_COMPLETE',
            stats,
            duration: data?._duration || 0
          });
        } catch (err) {
          console.error('[DashboardWorker] Stats error:', err);
          self.postMessage({ type: 'ERROR', error: 'stats_failed', message: err.message });
        }
        break;

      default:
        console.warn('[DashboardWorker] Unknown message type:', type);
    }
  } catch (err) {
    console.error('[DashboardWorker] Unhandled message error:', err);
    // Do not rethrow; just log to prevent worker termination
  }
};

/**
 * Filter and sort tasks based on criteria
 * @param {Object} criteria - Filter and sort criteria
 * @returns {Array} Filtered and sorted tasks
 */
function filterAndSort(criteria) {
  const {
    filter = 'all',
    categoryFilter = 'all',
    search = '',
    sort = 'newest',
    tasks: inputTasks = tasks,
    categories: inputCategories = categories,
    currentAgent = null // for my_tasks filter
  } = criteria;

  let filtered = [...inputTasks];

  // Filter by status - support both legacy completed boolean and new status field
  if (filter === 'pending') {
    filtered = filtered.filter(task => {
      if (task.status) {
        return !['completed', 'archived'].includes(task.status);
      }
      return !task.completed;
    });
  } else if (filter === 'completed') {
    filtered = filtered.filter(task => {
      if (task.status) {
        return task.status === 'completed';
      }
      return task.completed;
    });
  } else if (filter === 'archived') {
    filtered = filtered.filter(task => task.archived);
  } else if (filter === 'my_tasks') {
    if (currentAgent) {
      filtered = filtered.filter(task => task.owner === currentAgent);
    } else {
      filtered = [];
    }
  } else if (filter === 'overdue') {
    const now = new Date();
    filtered = filtered.filter(task => {
      const isCompleted = task.status ? ['completed','archived'].includes(task.status) : task.completed;
      if (isCompleted) return false;
      if (!task.due_date) return false;
      try {
        return new Date(task.due_date) < now;
      } catch (e) {
        return false;
      }
    });
  } else if (filter === 'blocked') {
    // Build map for dependencies
    const taskById = new Map();
    inputTasks.forEach(t => taskById.set(t.id, t));
    filtered = filtered.filter(task => {
      if (task.status === 'blocked') return true;
      if (task.dependency_ids && task.dependency_ids.length > 0) {
        for (const depId of task.dependency_ids) {
          const dep = taskById.get(depId);
          if (dep) {
            const depCompleted = dep.status ? ['completed','archived'].includes(dep.status) : dep.completed;
            if (!depCompleted) return true;
          }
        }
      }
      return false;
    });
  } else if (filter === 'no_due_date') {
    filtered = filtered.filter(task => !task.due_date);
  }

  // Filter by category
  if (categoryFilter !== 'all') {
    filtered = filtered.filter(task => task.category === categoryFilter);
  }

  // Filter by search
  if (search && search.trim()) {
    const query = search.toLowerCase().trim();
    filtered = filtered.filter(task =>
      task.text.toLowerCase().includes(query) ||
      (task.category || '').toLowerCase().includes(query)
    );
  }

  // Sort
  const sorted = [...filtered];
  switch (sort) {
    case 'oldest':
      sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case 'updated':
      sorted.sort((a, b) => {
        const dateA = a.updatedAt || a.createdAt;
        const dateB = b.updatedAt || b.createdAt;
        return new Date(dateB) - new Date(dateA);
      });
      break;
    case 'alpha':
      sorted.sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
      break;
    case 'status':
      const statusOrder = ['backlog','ready','in_progress','blocked','review','completed','archived'];
      sorted.sort((a,b) => {
        const idxA = statusOrder.indexOf(a.status || 'backlog');
        const idxB = statusOrder.indexOf(b.status || 'backlog');
        const safeA = idxA === -1 ? 999 : idxA;
        const safeB = idxB === -1 ? 999 : idxB;
        return safeA - safeB;
      });
      break;
    case 'owner':
      sorted.sort((a,b) => {
        const nameA = (a.owner || '').toLowerCase();
        const nameB = (b.owner || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;
    case 'dependencies':
      sorted.sort((a,b) => {
        const depsA = a.dependency_ids ? a.dependency_ids.length : 0;
        const depsB = b.dependency_ids ? b.dependency_ids.length : 0;
        return depsA - depsB;
      });
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return sorted;
}

/**
 * Search tasks
 * @param {Object} criteria - Search criteria
 * @returns {Array} Matching tasks
 */
function search(criteria) {
  const { query, tasks: inputTasks = tasks } = criteria;

  if (!query || !query.trim()) {
    return inputTasks;
  }

  const searchQuery = query.toLowerCase().trim();

  return inputTasks.filter(task =>
    task.text.toLowerCase().includes(searchQuery) ||
    (task.category || '').toLowerCase().includes(searchQuery)
  );
}

/**
 * Calculate statistics about tasks
 * @returns {Object} Statistics object
 */
function calculateStats() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;

  // Category distribution
  const categoryCounts = {};
  tasks.forEach(task => {
    const cat = task.category || 'General';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  // Most recently updated
  const sortedByUpdate = [...tasks].sort((a, b) => {
    const dateA = a.updatedAt || a.createdAt;
    const dateB = b.updatedAt || b.createdAt;
    return new Date(dateB) - new Date(dateA);
  });

  return {
    total,
    completed,
    pending,
    completionRate: total > 0 ? ((completed / total) * 100).toFixed(1) : 0,
    categoryCounts,
    recentTasks: sortedByUpdate.slice(0, 5).map(t => t.id)
  };
}

/**
 * Initialize worker with data
 * @param {Array} initialTasks - Initial task list
 * @param {Array} initialCategories - Initial categories
 */
function init(initialTasks, initialCategories) {
  tasks = initialTasks || [];
  categories = initialCategories || [];
}

// Auto-initialize if data provided in self scope
if (typeof tasks === 'undefined') {
  tasks = [];
  categories = [];
}
