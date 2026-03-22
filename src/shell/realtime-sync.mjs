/**
 * RealtimeSync - Unified real-time data synchronization module
 * 
 * Provides a singleton-like sync module that fetches all key data sources
 * in parallel at regular intervals, caches results with timestamps, and
 * notifies subscribers when data changes.
 */

const SYNC_INTERVAL_MS = 20000; // 20 seconds
const DEBOUNCE_MS = 2000; // 2 seconds minimum between refreshes

/**
 * @typedef {Object} SyncState
 * @property {Object|null} stats - System stats from /api/stats
 * @property {Object|null} healthStatus - Health status from /api/health-status
 * @property {Object|null} blockersSummary - Blockers summary from /api/blockers/summary
 * @property {Object|null} orgSummary - Org summary from /api/org/summary
 * @property {Object|null} approvalsPending - Pending approvals from /api/approvals/pending
 * @property {Object|null} activeWorkflowRuns - Active workflow runs from /api/workflow-runs/active
 * @property {Array|null} gatewayAgents - Agent status from /gateway-status.json
 */

/**
 * @typedef {Object} FetchTimestamps
 * @property {number} stats
 * @property {number} healthStatus
 * @property {number} blockersSummary
 * @property {number} orgSummary
 * @property {number} approvalsPending
 * @property {number} activeWorkflowRuns
 * @property {number} gatewayAgents
 */

/**
 * @typedef {Object} FetchErrors
 * @property {Error|null} stats
 * @property {Error|null} healthStatus
 * @property {Error|null} blockersSummary
 * @property {Error|null} orgSummary
 * @property {Error|null} approvalsPending
 * @property {Error|null} activeWorkflowRuns
 * @property {Error|null} gatewayAgents
 */

/**
 * Creates a unified real-time data synchronization module
 * @param {Object} options
 * @param {Object} options.api - The API client instance
 * @param {number} [options.interval] - Sync interval in milliseconds (default: 20000)
 * @returns {Object} The sync module instance
 */
export function createRealtimeSync({ api, interval = SYNC_INTERVAL_MS }) {
  /** @type {SyncState} */
  const data = {
    stats: null,
    healthStatus: null,
    blockersSummary: null,
    orgSummary: null,
    approvalsPending: null,
    activeWorkflowRuns: null,
    gatewayAgents: null,
  };

  /** @type {FetchTimestamps} */
  const lastFetched = {
    stats: 0,
    healthStatus: 0,
    blockersSummary: 0,
    orgSummary: 0,
    approvalsPending: 0,
    activeWorkflowRuns: 0,
    gatewayAgents: 0,
  };

  /** @type {FetchErrors} */
  const errors = {
    stats: null,
    healthStatus: null,
    blockersSummary: null,
    orgSummary: null,
    approvalsPending: null,
    activeWorkflowRuns: null,
    gatewayAgents: null,
  };

  /** @type {Set<Function>} */
  const subscribers = new Set();

  /** @type {number|null} */
  let intervalId = null;

  /** @type {number} */
  let lastRefreshTime = 0;

  /** @type {boolean} */
  let isRefreshing = false;

  /** @type {boolean} */
  let pendingRefresh = false;

  /**
   * Subscribes to sync updates
   * @param {Function} callback - Called with (data, changedKeys) when data changes
   * @returns {Function} Unsubscribe function
   */
  function subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  /**
   * Notifies all subscribers of data changes
   * @param {string[]} changedKeys - Array of keys that changed
   */
  function notifySubscribers(changedKeys) {
    subscribers.forEach(callback => {
      try {
        callback(data, changedKeys);
      } catch (e) {
        console.warn('[RealtimeSync] Subscriber error:', e);
      }
    });
  }

  /**
   * Fetches gateway status from the static JSON file
   * @returns {Promise<Array>} Array of agent status objects
   */
  async function fetchGatewayStatus() {
    try {
      const response = await fetch('/gateway-status.json', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      return Array.isArray(json.agents) ? json.agents : [];
    } catch (e) {
      console.warn('[RealtimeSync] Failed to fetch gateway-status.json:', e);
      throw e;
    }
  }

  /**
   * Fetches all data sources in parallel
   * @returns {Promise<string[]>} Array of keys that changed
   */
  async function fetchAllData() {
    const now = Date.now();
    const changedKeys = [];

    const results = await Promise.allSettled([
      api.stats().catch(e => { throw e; }),
      api.health.status().catch(e => { throw e; }),
      api.blockers.summary().catch(e => { throw e; }),
      api.org.summary().catch(e => { throw e; }),
      api.approvals.pending().catch(e => { throw e; }),
      api.workflows.active().catch(e => { throw e; }),
      fetchGatewayStatus(),
    ]);

    // Process stats
    if (results[0].status === 'fulfilled') {
      const newStats = results[0].value;
      if (JSON.stringify(data.stats) !== JSON.stringify(newStats)) {
        data.stats = newStats;
        changedKeys.push('stats');
      }
      lastFetched.stats = now;
      errors.stats = null;
    } else {
      errors.stats = results[0].reason;
    }

    // Process health status
    if (results[1].status === 'fulfilled') {
      const newHealth = results[1].value;
      if (JSON.stringify(data.healthStatus) !== JSON.stringify(newHealth)) {
        data.healthStatus = newHealth;
        changedKeys.push('healthStatus');
      }
      lastFetched.healthStatus = now;
      errors.healthStatus = null;
    } else {
      errors.healthStatus = results[1].reason;
    }

    // Process blockers summary
    if (results[2].status === 'fulfilled') {
      const newBlockers = results[2].value;
      if (JSON.stringify(data.blockersSummary) !== JSON.stringify(newBlockers)) {
        data.blockersSummary = newBlockers;
        changedKeys.push('blockersSummary');
      }
      lastFetched.blockersSummary = now;
      errors.blockersSummary = null;
    } else {
      errors.blockersSummary = results[2].reason;
    }

    // Process org summary
    if (results[3].status === 'fulfilled') {
      const newOrg = results[3].value;
      if (JSON.stringify(data.orgSummary) !== JSON.stringify(newOrg)) {
        data.orgSummary = newOrg;
        changedKeys.push('orgSummary');
      }
      lastFetched.orgSummary = now;
      errors.orgSummary = null;
    } else {
      errors.orgSummary = results[3].reason;
    }

    // Process approvals pending
    if (results[4].status === 'fulfilled') {
      const newApprovals = results[4].value;
      if (JSON.stringify(data.approvalsPending) !== JSON.stringify(newApprovals)) {
        data.approvalsPending = newApprovals;
        changedKeys.push('approvalsPending');
      }
      lastFetched.approvalsPending = now;
      errors.approvalsPending = null;
    } else {
      errors.approvalsPending = results[4].reason;
    }

    // Process active workflow runs
    if (results[5].status === 'fulfilled') {
      const newRuns = results[5].value;
      if (JSON.stringify(data.activeWorkflowRuns) !== JSON.stringify(newRuns)) {
        data.activeWorkflowRuns = newRuns;
        changedKeys.push('activeWorkflowRuns');
      }
      lastFetched.activeWorkflowRuns = now;
      errors.activeWorkflowRuns = null;
    } else {
      errors.activeWorkflowRuns = results[5].reason;
    }

    // Process gateway agents
    if (results[6].status === 'fulfilled') {
      const newAgents = results[6].value;
      if (JSON.stringify(data.gatewayAgents) !== JSON.stringify(newAgents)) {
        data.gatewayAgents = newAgents;
        changedKeys.push('gatewayAgents');
      }
      lastFetched.gatewayAgents = now;
      errors.gatewayAgents = null;
    } else {
      errors.gatewayAgents = results[6].reason;
    }

    return changedKeys;
  }

  /**
   * Performs a refresh with debouncing
   * @param {boolean} force - Force refresh even if recently refreshed
   * @returns {Promise<string[]>} Array of keys that changed
   */
  async function refresh(force = false) {
    const now = Date.now();
    
    // Debounce: don't refresh if recently refreshed (unless forced)
    if (!force && now - lastRefreshTime < DEBOUNCE_MS) {
      return [];
    }

    // If already refreshing, mark pending and return
    if (isRefreshing) {
      pendingRefresh = true;
      return [];
    }

    isRefreshing = true;
    lastRefreshTime = now;

    try {
      const changedKeys = await fetchAllData();
      if (changedKeys.length > 0) {
        notifySubscribers(changedKeys);
      }
      return changedKeys;
    } catch (e) {
      console.error('[RealtimeSync] Refresh failed:', e);
      return [];
    } finally {
      isRefreshing = false;
      
      // Handle pending refresh
      if (pendingRefresh) {
        pendingRefresh = false;
        // Schedule a new refresh after debounce period
        setTimeout(() => refresh(), DEBOUNCE_MS);
      }
    }
  }

  /**
   * Starts the automatic sync interval
   */
  function start() {
    if (intervalId !== null) {
      return; // Already started
    }
    
    // Initial refresh
    refresh(true);
    
    // Set up interval
    intervalId = setInterval(() => {
      refresh();
    }, interval);
  }

  /**
   * Stops the automatic sync interval
   */
  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  /**
   * Gets the current data state
   */
  function getData() {
    return { ...data };
  }

  /**
   * Gets the last fetch timestamps
   */
  function getLastFetched() {
    return { ...lastFetched };
  }

  /**
   * Gets the current errors
   */
  function getErrors() {
    return { ...errors };
  }

  /**
   * Checks if any data is stale (older than given age in ms)
   * @param {number} maxAge - Maximum age in milliseconds
   * @param {string} [key] - Specific key to check, or all if omitted
   * @returns {boolean}
   */
  function isStale(maxAge, key) {
    const now = Date.now();
    if (key) {
      return (now - lastFetched[key]) > maxAge;
    }
    // Check if any key is stale
    return Object.values(lastFetched).some(ts => (now - ts) > maxAge);
  }

  // Expose getters for each data type
  return {
    // Lifecycle
    start,
    stop,
    refresh,
    
    // Subscription
    subscribe,
    
    // Getters for cached data
    get stats() { return data.stats; },
    get healthStatus() { return data.healthStatus; },
    get blockersSummary() { return data.blockersSummary; },
    get orgSummary() { return data.orgSummary; },
    get approvalsPending() { return data.approvalsPending; },
    get activeWorkflowRuns() { return data.activeWorkflowRuns; },
    get gatewayAgents() { return data.gatewayAgents; },
    
    // Batch getters
    getData,
    getLastFetched,
    getErrors,
    
    // Utility
    isStale,
    
    // Direct access to data for advanced use
    _data: data,
    _lastFetched: lastFetched,
    _errors: errors,
  };
}

export default createRealtimeSync;
