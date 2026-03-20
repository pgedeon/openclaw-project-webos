/**
 * Offline UI Manager
 * 
 * Adds UI indicators for:
 * - Online/Offline status
 * - Sync state (idle, syncing, synced, error)
 * - Conflict resolution prompts
 */

import { syncManager } from './sync-manager.mjs';

class OfflineUIManager {
  constructor() {
    this.container = null;
    this.statusElement = null;
    this.syncStatusElement = null;
    this.conflictModal = null;
    this.conflictCallback = null;
  }

  /**
   * Initialize the offline UI
   */
  init() {
    this.createStatusIndicator();
    this.createSyncStatusIndicator();
    this.bindEvents();

    // Subscribe to sync events
    syncManager.on('online', () => this.updateStatus('online'));
    syncManager.on('offline', () => this.updateStatus('offline'));
    syncManager.on('syncStart', () => this.setSyncState('syncing'));
    syncManager.on('syncComplete', () => this.setSyncState('synced'));
    syncManager.on('syncError', (data) => {
      this.setSyncState('error');
      this.showErrorBanner(data);
    });
    syncManager.on('conflictDetected', (data) => this.handleConflict(data));
    syncManager.on('queueUpdate', (data) => this.updateQueueStats());

    // Initial status
    this.updateStatus(navigator.onLine ? 'online' : 'offline');

    console.log('[OfflineUI] Initialized');
  }

  /**
   * Create the online/offline status indicator
   */
  createStatusIndicator() {
    this.container = document.createElement('div');
    this.container.id = 'offline-status-container';
    this.container.setAttribute('role', 'status');
    this.container.setAttribute('aria-live', 'polite');
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
    `;

    // Status badge
    this.statusElement = document.createElement('div');
    this.statusElement.id = 'offline-status';
    this.statusElement.style.cssText = `
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      background: #20b26c;
      color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: background 0.3s ease;
    `;
    this.statusElement.innerHTML = `<span></span><span class="status-text">Online</span>`;

    // Sync status badge
    this.syncStatusElement = document.createElement('div');
    this.syncStatusElement.id = 'sync-status';
    this.syncStatusElement.style.cssText = `
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(92, 107, 242, 0.15);
      color: var(--accent);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: none;
    `;
    this.syncStatusElement.textContent = 'Syncing...';

    this.container.appendChild(this.statusElement);
    this.container.appendChild(this.syncStatusElement);

    // Create Sync Now button
    this.syncNowButton = document.createElement('button');
    this.syncNowButton.id = 'sync-now-btn';
    this.syncNowButton.textContent = 'Sync now';
    this.syncNowButton.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: var(--accent, #5c6bf2);
      color: white;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      transition: opacity 0.2s ease;
      margin-top: 4px;
    `;
    this.syncNowButton.disabled = false;
    this.syncNowButton.addEventListener('click', () => {
      if (!syncManager.isOnline || syncManager.isSyncing) return;
      syncManager.syncAll();
    });
    this.container.appendChild(this.syncNowButton);

    document.body.appendChild(this.container);
  }

  /**
   * Create sync status indicator (hidden by default)
   */
  createSyncStatusIndicator() {
    // Already created above in container
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Click on status badge shows details
    this.statusElement.style.cursor = 'pointer';
    this.statusElement.addEventListener('click', () => {
      this.showStatusDetails();
    });

    // Setup error banner button handlers
    const errorRetryBtn = document.getElementById('errorRetryBtn');
    const errorDismissBtn = document.getElementById('errorDismissBtn');
    if (errorRetryBtn && errorDismissBtn) {
      errorRetryBtn.addEventListener('click', () => {
        if (!syncManager.isOnline) {
          showNotice('Cannot sync while offline.', 'error');
          return;
        }
        syncManager.syncAll().finally(() => {
          this.hideErrorBanner();
        });
      });
      errorDismissBtn.addEventListener('click', () => {
        this.hideErrorBanner();
      });
    }
  }

  /**
   * Update the online/offline status display
   * @param {string} status - 'online' or 'offline'
   */
  updateStatus(status) {
    const isOnline = status === 'online';
    const statusEl = this.statusElement;
    const textEl = statusEl.querySelector('.status-text');

    if (isOnline) {
      statusEl.style.background = '#20b26c';
      textEl.textContent = 'Online';
      statusEl.setAttribute('aria-label', 'You are online');
    } else {
      statusEl.style.background = '#ef4444';
      textEl.textContent = 'Offline';
      statusEl.setAttribute('aria-label', 'You are offline - changes will be queued');
    }

    // Show/hide sync status
    if (isOnline && syncManager.isSyncing) {
      this.syncStatusElement.style.display = 'block';
    } else {
      this.syncStatusElement.style.display = 'none';
    }

    // Show/hide Sync Now button
    if (isOnline) {
      this.syncNowButton.style.display = 'block';
    } else {
      this.syncNowButton.style.display = 'none';
    }
  }

  /**
   * Set sync state
   * @param {string} state - 'syncing', 'synced', or 'error'
   */
  setSyncState(state) {
    const syncEl = this.syncStatusElement;

    switch (state) {
      case 'syncing':
        syncEl.style.display = 'block';
        syncEl.textContent = 'Syncing changes...';
        syncEl.style.background = 'rgba(245, 158, 11, 0.15)';
        syncEl.style.color = '#b45309';
        break;
      case 'synced':
        syncEl.style.display = 'block';
        syncEl.textContent = 'All changes synced';
        syncEl.style.background = 'rgba(32, 178, 108, 0.15)';
        syncEl.style.color = '#1f8b4c';
        // Auto-hide after 3 seconds
        setTimeout(() => {
          if (syncManager.isOnline && !syncManager.isSyncing) {
            syncEl.style.display = 'none';
          }
        }, 3000);
        break;
      case 'error':
        syncEl.style.display = 'block';
        syncEl.textContent = 'Sync error occurred';
        syncEl.style.background = 'rgba(239, 68, 68, 0.15)';
        syncEl.style.color = '#ef4444';
        break;
    }

    // Update Sync Now button state
    if (this.syncNowButton) {
      switch (state) {
        case 'syncing':
          this.syncNowButton.disabled = true;
          this.syncNowButton.textContent = 'Syncing...';
          break;
        case 'synced':
        case 'error':
          this.syncNowButton.disabled = false;
          this.syncNowButton.textContent = 'Sync now';
          break;
      }
    }
  }

  /**
   * Show persistent error banner for sync failures
   * @param {Object} data - Error data from syncError event
   */
  showErrorBanner(data) {
    const banner = document.getElementById('errorBanner');
    const messageEl = document.getElementById('errorBannerMessage');
    if (!banner || !messageEl) {
      console.warn('[OfflineUI] Error banner elements not found');
      return;
    }
    const { item, error } = data;
    const operation = item.operation;
    const taskId = item.taskId || 'new';
    messageEl.textContent = `Failed to sync ${operation} for task ${taskId}: ${error}`;
    banner.style.display = 'flex';
  }

  /**
   * Hide the error banner
   */
  hideErrorBanner() {
    const banner = document.getElementById('errorBanner');
    if (banner) {
      banner.style.display = 'none';
    }
  }

  /**
   * Show status details modal
   */
  showStatusDetails() {
    // Create simple tooltip/modal
    const existing = document.getElementById('offline-status-details');
    if (existing) {
      existing.remove();
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'offline-status-details';
    modal.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 320px;
      background: var(--surface, white);
      border: 1px solid var(--border, #ddd');
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      z-index: 1001;
      font-family: inherit;
      color: var(--text, #333);
    `;

    const status = navigator.onLine ? '🟢 Online' : '🔴 Offline';
    const syncing = syncManager.isSyncing ? 'Yes' : 'No';

    modal.innerHTML = `
      <h3 style="margin: 0 0 12px 0; font-size: 1rem;">Connection Status</h3>
      <div style="display: grid; gap: 8px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Network:</span>
          <strong>${status}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Syncing:</span>
          <strong>${syncing}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Pending operations:</span>
          <strong id="pending-count">${syncManager.getPendingOperationsCount ? '...' : 'N/A'}</strong>
        </div>
      </div>
      <p style="margin: 12px 0 0 0; font-size: 0.85rem; color: var(--muted, #666);">
        ${navigator.onLine 
          ? 'You are connected. Changes are being synced automatically.' 
          : 'You are offline. Changes will be queued and synced when you reconnect.'}
      </p>
      <button id="close-status-details" style="
        margin-top: 12px;
        width: 100%;
        padding: 8px;
        background: var(--accent, #5c6bf2);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
      ">Close</button>
    `;

    // Close button
    modal.querySelector('#close-status-details').addEventListener('click', () => {
      modal.remove();
    });

    // Close on outside click
    const closeHandler = (e) => {
      if (!modal.contains(e.target)) {
        modal.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    document.body.appendChild(modal);

    // Update pending count
    if (syncManager.getPendingOperationsCount) {
      syncManager.getPendingOperationsCount().then(count => {
        const countEl = modal.querySelector('#pending-count');
        if (countEl) countEl.textContent = count;
      });
    }
  }

  /**
   * Handle conflict detection
   * @param {Object} data - Conflict data from sync manager
   */
  handleConflict(data) {
    const { item, error } = data;

    // Simple alert for now - could be enhanced with a modal
    const message = `Sync conflict detected for task "${item.data.text || item.taskId}". Using server-wins strategy to resolve.`;
    console.warn('[OfflineUI] Conflict:', message);

    // Show notification
    this.showConflictNotification(item);

    // Auto-resolve using server-wins
    syncManager.resolveConflict(item, 'server-wins')
      .then(resolvedData => {
        console.log('[OfflineUI] Conflict resolved:', resolvedData);
        this.showNotice('Conflict resolved using server data.', 'success');
      })
      .catch(err => {
        console.error('[OfflineUI] Conflict resolution failed:', err);
        this.showNotice('Failed to resolve conflict. Please try again.', 'error');
      });
  }

  /**
   * Show conflict notification
   * @param {Object} item - The queue item with conflict
   */
  showConflictNotification(item) {
    // Could integrate with existing notice system
    if (typeof showNotice === 'function') {
      showNotice(`Sync conflict for task. Using server version.`, 'error');
    }
  }

  /**
   * Show a notice message (uses existing showNotice from dashboard)
   * @param {string} message - Message text
   * @param {string} type - 'info', 'success', 'error'
   */
  showNotice(message, type = 'info') {
    // Reuse existing notice function if available
    if (typeof window !== 'undefined' && window.showNotice) {
      window.showNotice(message, type);
    } else {
      console.log(`[OfflineUI] ${type}: ${message}`);
    }
  }

  /**
   * Update queue stats display
   */
  async updateQueueStats() {
    const countEl = document.getElementById('pending-count');
    if (countEl && syncManager.getPendingOperationsCount) {
      const count = await syncManager.getPendingOperationsCount();
      countEl.textContent = count;
    }
  }

  /**
   * Destroy the UI manager
   */
  destroy() {
    if (this.container) {
      this.container.remove();
    }
    if (this.conflictModal) {
      this.conflictModal.remove();
    }
  }
}

// Export class and singleton
export { OfflineUIManager };
export const offlineUI = new OfflineUIManager();

// Also expose on window for backward compatibility
if (typeof window !== 'undefined') {
  window.OfflineUIManager = offlineUI;
}
