/**
 * Offline Sync Manager
 * 
 * Handles:
 * - Queueing mutations (create/update/delete) when offline
 * - Background sync when online
 * - Conflict detection and resolution
 * - Sync state tracking
 */

import { idb, STORES } from './idb.mjs';

// Sync operation types
const OPERATION = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete'
};

// Sync status
const SYNC_STATUS = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error'
};

// API endpoint configuration
const API_ENDPOINT = '/api/tasks'; // Adjust as needed

class SyncManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.eventListeners = new Map();
    this.syncInterval = null;
    this.retryDelay = 5000; // 5 seconds
    this.maxRetries = 5;

    // Bind event handlers
    this.handleOnline = this.handleOnline.bind(this);
    this.handleOffline = this.handleOffline.bind(this);
  }

  /**
   * Initialize the sync manager
   */
  async init() {
    // Set up online/offline listeners
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Start periodic sync check (for handling queued ops when coming online)
    this.startPeriodicSync();

    // If we're online, try to sync any pending operations
    if (this.isOnline) {
      this.syncAll().catch(console.error);
    }

    console.log('[SyncManager] Initialized. Online:', this.isOnline);
  }

  /**
   * Queue an operation for later sync
   * @param {string} operation - Operation type (create/update/delete)
   * @param {Object} data - The task data
   * @param {number} taskId - The task ID (for update/delete)
   */
  async queueOperation(operation, data, taskId = null) {
    const queueItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Unique string ID
      operation,
      taskId,
      data,
      timestamp: Date.now(),
      status: SYNC_STATUS.PENDING,
      retries: 0,
      retryAt: null
    };

    try {
      await idb.add(STORES.SYNC_QUEUE, queueItem);
      this.emit('queueUpdate', { operation, taskId, status: SYNC_STATUS.PENDING });
      console.log(`[SyncManager] Queued ${operation} for task ${taskId || 'new'}`);

      // If online, attempt to sync immediately
      if (this.isOnline && !this.isSyncing) {
        this.processQueue();
      }
    } catch (error) {
      console.error('[SyncManager] Failed to queue operation:', error);
      throw error;
    }
  }

  /**
   * Process all pending operations in the queue
   */
  async processQueue() {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    this.isSyncing = true;
    this.emit('syncStart');

    try {
      // Fetch all items and filter by status client-side (queue is small)
      const allItems = await idb.getAll(STORES.SYNC_QUEUE);
      const now = Date.now();
      const pendingItems = allItems.filter(item => item.status === SYNC_STATUS.PENDING && (!item.retryAt || item.retryAt <= now));

      // Sort by timestamp (oldest first)
      pendingItems.sort((a, b) => a.timestamp - b.timestamp);

      for (const item of pendingItems) {
        try {
          await this.processQueueItem(item);
        } catch (error) {
          console.error(`[SyncManager] Failed to process queue item ${item.id}:`, error);
          // If max retries exceeded, mark as error
          if (item.retries >= this.maxRetries) {
            await this.markItemFailed(item.id, error.message);
            this.emit('syncError', { item, error: error.message });
          }
          // Continue with next item
        }
      }

      this.emit('syncComplete');
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process a single queue item
   * @param {Object} item - The queue item
   */
  async processQueueItem(item) {
    // Update status to syncing
    item.status = SYNC_STATUS.SYNCING;
    await idb.put(STORES.SYNC_QUEUE, item);

    try {
      const result = await this.executeOperation(item.operation, item.data, item.taskId);

      // Success - remove from queue
      await idb.delete(STORES.SYNC_QUEUE, item.id);
      this.emit('queueUpdate', {
        operation: item.operation,
        taskId: item.taskId,
        status: SYNC_STATUS.SYNCED
      });

      console.log(`[SyncManager] Successfully synced ${item.operation} for task ${item.taskId || 'new'}`);
      return result;
    } catch (error) {
      // Check if it's a conflict error
      if (error.status === 409) {
        // Conflict detected
        item.status = SYNC_STATUS.CONFLICT;
        await idb.put(STORES.SYNC_QUEUE, item);
        this.emit('conflictDetected', { item, error });
        throw error; // Re-throw to stop processing
      } else if (error.status >= 500 || error.networkError) {
        // Network/server error - retry
        item.retries++;
        item.retryAt = Date.now() + this.calculateBackoff(item.retries);
        item.status = SYNC_STATUS.PENDING;
        await idb.put(STORES.SYNC_QUEUE, item);
        throw error;
      } else {
        // Other errors - don't retry
        throw error;
      }
    }
  }

  calculateBackoff(retries) {
    const base = 1000;
    const jitter = Math.random() * 1000;
    return Math.min(base * Math.pow(2, retries) + jitter, 300000);
  }

  /**
   * Execute a single operation against the server
   * @param {string} operation - Operation type
   * @param {Object} data - Task data
   * @param {number} taskId - Task ID (if applicable)
   */
  async executeOperation(operation, data, taskId) {
    let url = taskId ? `${API_ENDPOINT}/${taskId}` : API_ENDPOINT;
    let method;

    switch (operation) {
      case OPERATION.DELETE:
        method = 'DELETE';
        break;
      case OPERATION.CREATE:
        method = 'POST';
        break;
      case OPERATION.UPDATE:
        method = 'PATCH';
        break;
      case 'ARCHIVE':
        method = 'POST';
        url = `${API_ENDPOINT}/${taskId}/archive`;
        break;
      case 'RESTORE':
        method = 'POST';
        url = `${API_ENDPOINT}/${taskId}/restore`;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    // Debug: log PATCH payload for UPDATE operations
    if (operation === OPERATION.UPDATE) {
      console.log('[SyncManager] PATCH payload:', data);
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: operation !== OPERATION.DELETE ? JSON.stringify(data) : undefined
    });

    let responseBody;
    try {
      responseBody = await response.text();
    } catch (e) {
      responseBody = '';
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        if (responseBody) {
          const errorJson = JSON.parse(responseBody);
          errorMessage = errorJson.message || errorMessage;
        }
      } catch (e) {}
      console.error(`[SyncManager] ${method} ${url} failed: ${errorMessage}`);
      const error = new Error(errorMessage);
      error.status = response.status;
      error.networkError = false;
      throw error;
    }

    try {
      return JSON.parse(responseBody);
    } catch (e) {
      return responseBody;
    }
  }

  /**
   * Attempt to resolve a conflict
   * Strategy: "server-wins" by default, but can be configured
   * @param {Object} item - The sync queue item with conflict
   * @param {string} strategy - 'server-wins', 'client-wins', or 'merge'
   */
  async resolveConflict(item, strategy = 'client-wins') {
    console.log('[SyncManager] Resolving conflict for task', item.taskId, 'using strategy:', strategy);

    try {
      // Fetch current server state
      const response = await fetch(`${API_ENDPOINT}/${item.taskId}`);
      if (!response.ok) throw new Error('Failed to fetch server state');
      const serverData = await response.json();

      let resolvedData;
      if (strategy === 'server-wins') {
        // Server data wins - we need to update client with server data
        resolvedData = serverData;
      } else if (strategy === 'client-wins') {
        // Client data wins - force update server
        resolvedData = { ...serverData, ...item.data };
      } else if (strategy === 'merge') {
        // Intelligent merge (timestamp-based)
        resolvedData = this.mergeTaskData(serverData, item.data);
      }

      // Remove the failed item from queue
      await idb.delete(STORES.SYNC_QUEUE, item.id);

      // Apply resolved data locally
      // (This will be handled by the state manager - emit event)
      this.emit('conflictResolved', { taskId: item.taskId, resolvedData });

      return resolvedData;
    } catch (error) {
      console.error('[SyncManager] Failed to resolve conflict:', error);
      throw error;
    }
  }

  /**
   * Merge server and client task data intelligently
   * @param {Object} serverData - Data from server
   * @param {Object} clientData - Data from client
   */
  mergeTaskData(serverData, clientData) {
    // Use most recent updatedAt timestamp
    const serverTime = new Date(serverData.updatedAt || serverData.createdAt);
    const clientTime = new Date(clientData.updatedAt || clientData.createdAt);

    if (clientTime > serverTime) {
      return { ...serverData, ...clientData };
    } else {
      return serverData;
    }
  }

  /**
   * Mark a queue item as failed
   * @param {any} itemId - The queue item ID
   * @param {string} errorMessage - Error message
   */
  async markItemFailed(itemId, errorMessage) {
    // Could move to a separate 'failed' store or keep with error details
    await idb.delete(STORES.SYNC_QUEUE, itemId);
    this.emit('syncError', { itemId, error: errorMessage });
  }

  /**
   * Clear all pending operations from the queue
   */
  async clearQueue() {
    await idb.clear(STORES.SYNC_QUEUE);
    this.emit('queueCleared');
  }

  /**
   * Get all pending operations
   */
  async getPendingOperations() {
    const allItems = await idb.getAll(STORES.SYNC_QUEUE);
    return allItems.filter(item => item.status === SYNC_STATUS.PENDING);
  }

  /**
   * Sync all tasks from server (used on initial load or manual refresh)
   * @returns {Promise<Array>} - Synced tasks
   */
  async syncAll() {
    if (!this.isOnline) {
      throw new Error('Cannot sync while offline');
    }

    try {
      this.emit('syncStart');
      const response = await fetch(API_ENDPOINT);
      if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
      const tasks = await response.json();
      this.emit('syncComplete', { tasks });
      return tasks;
    } catch (error) {
      this.emit('syncError', { error: error.message });
      throw error;
    }
  }

  /**
   * Start periodic sync checks
   */
  startPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    // Check every 30 seconds when online
    this.syncInterval = setInterval(async () => {
      if (this.isOnline && !this.isSyncing) {
        const pending = await idb.count(STORES.SYNC_QUEUE);
        if (pending > 0) {
          this.processQueue();
        }
      }
    }, 30000);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Handle online event
   */
  handleOnline() {
    console.log('[SyncManager] Online detected');
    this.isOnline = true;
    this.emit('online');
    // Process any queued operations
    if (!this.isSyncing) {
      this.processQueue();
    }
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    console.log('[SyncManager] Offline detected');
    this.isOnline = false;
    this.emit('offline');
  }

  /**
   * Subscribe to sync events
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Unsubscribe from sync events
   * @param {string} event - Event name
   * @param {Function} callback - Callback to remove
   */
  off(event, callback) {
    if (this.eventListeners.has(event)) {
      const callbacks = this.eventListeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emit(event, data = {}) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[SyncManager] Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Get current sync status
   */
  getStatus() {
    return {
      online: this.isOnline,
      syncing: this.isSyncing,
      pendingCount: this.getPendingOperationsCount(),
      lastSync: this.lastSyncTime
    };
  }

  /**
   * Get count of pending operations
   */
  async getPendingOperationsCount() {
    return idb.count(STORES.SYNC_QUEUE);
  }

  /**
   * Destroy the sync manager and clean up
   */
  destroy() {
    this.stopPeriodicSync();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.eventListeners.clear();
    idb.close();
  }
}

// Create singleton instance
const syncManager = new SyncManager();

// Export classes, constants, and singleton
export { SyncManager, syncManager, OPERATION, SYNC_STATUS };
