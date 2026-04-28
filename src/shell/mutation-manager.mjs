/**
 * MutationManager — optimistic UI updates for the desktop shell.
 *
 * Wraps any async mutation with:
 * 1. Instant optimistic state update
 * 2. Background API call
 * 3. Auto-rollback on failure
 * 4. Queued mutations for offline support
 *
 * Usage:
 *   const result = await mutate({
 *     key: 'task-123-status',
 *     optimisticApply: () => { task.status = 'completed'; render(); },
 *     request: () => api.tasks.update('123', { status: 'completed' }),
 *     rollback: () => { task.status = 'in_progress'; render(); },
 *     onSuccess: (data) => { console.log('saved', data); },
 *   });
 */

const pending = new Map();
let offlineQueue = [];
let isOnline = true;

/**
 * Execute an optimistic mutation.
 * @param {Object} opts
 * @param {string} opts.key - Unique mutation key (deduplicates)
 * @param {Function} opts.optimisticApply - Apply optimistic change immediately
 * @param {Function} opts.request - Async API call
 * @param {Function} opts.rollback - Revert optimistic change on failure
 * @param {Function} [opts.onSuccess] - Called with API response on success
 * @param {Function} [opts.onError] - Called with error on failure
 * @param {boolean} [opts.skipOptimistic] - Skip optimistic apply (for non-UI mutations)
 * @returns {Promise<{ok: boolean, data?: any, error?: Error}>}
 */
export async function mutate({
  key,
  optimisticApply,
  request,
  rollback,
  onSuccess,
  onError,
  skipOptimistic = false,
}) {
  // Deduplicate: if same key is already pending, wait for it
  if (pending.has(key)) {
    return pending.get(key);
  }

  const promise = _executeMutation({ key, optimisticApply, request, rollback, onSuccess, onError, skipOptimistic });
  pending.set(key, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    pending.delete(key);
  }
}

async function _executeMutation({ key, optimisticApply, request, rollback, onSuccess, onError, skipOptimistic }) {
  // 1. Apply optimistic update
  if (!skipOptimistic && isOnline) {
    try {
      optimisticApply();
    } catch (e) {
      console.warn('[MutationManager] optimisticApply failed:', e.message);
    }
  }

  // 2. Queue if offline
  if (!isOnline) {
    offlineQueue.push({ key, request, rollback, onSuccess, onError });
    return { ok: true, queued: true };
  }

  // 3. Execute API call
  try {
    const data = await request();
    if (onSuccess) onSuccess(data);
    return { ok: true, data };
  } catch (err) {
    console.error(`[MutationManager] Mutation "${key}" failed:`, err.message);

    // 4. Rollback optimistic state
    if (!skipOptimistic && rollback) {
      try {
        rollback();
      } catch (rbErr) {
        console.error(`[MutationManager] Rollback failed for "${key}":`, rbErr.message);
      }
    }

    if (onError) onError(err);
    return { ok: false, error: err };
  }
}

/**
 * Process queued mutations when coming back online.
 * @param {Function} apiCall - Function to execute queued requests
 */
export async function flushOfflineQueue() {
  if (offlineQueue.length === 0) return;

  const queue = [...offlineQueue];
  offlineQueue = [];

  for (const item of queue) {
    try {
      const data = await item.request();
      if (item.onSuccess) item.onSuccess(data);
    } catch (err) {
      if (item.rollback) {
        try { item.rollback(); } catch (_) {}
      }
      if (item.onError) item.onError(err);
    }
  }
}

/**
 * Set online/offline state. Triggers queue flush when going online.
 */
export function setOnlineStatus(online) {
  const wasOffline = !isOnline;
  isOnline = online;
  if (wasOffline && online) {
    flushOfflineQueue();
  }
}

/**
 * Get current pending mutation count (for UI indicators).
 */
export function getPendingCount() {
  return pending.size;
}

/**
 * Get offline queue length.
 */
export function getQueueLength() {
  return offlineQueue.length;
}

/**
 * Check if a specific mutation key is pending.
 */
export function isPending(key) {
  return pending.has(key);
}

export default { mutate, flushOfflineQueue, setOnlineStatus, getPendingCount, getQueueLength, isPending };
