/**
 * Agent View for OpenClaw Dashboard
 *
 * Displays tasks assigned to a specific agent with claim/release/execute actions.
 * Includes agent selector, live stats, and heartbeat auto-refresh.
 */

import { skeletonLoader } from './skeleton-loader.mjs';

export class AgentView {
  /**
   * Create an AgentView instance.
   * @param {HTMLElement} container - The task list container element (usually #taskList).
   * @param {Object} options - Optional configuration.
   * @param {Function} options.showNotice - Function to show notices (msg, type).
   */
  constructor(container, options = {}) {
    this.container = container;
    this.showNotice = options.showNotice || ((msg, type) => {
      if (type === 'error') alert(msg);
      else console.log(`[AgentView] ${type || 'info'}: ${msg}`);
    });
    this.onAgentChange = options.onAgentChange || null;
    this.availableAgents = window.availableAgents || [];
    this.agentUIContainer = null;
    this.agentSelect = null;
    this.agentStatsContainer = null;
    this.currentAgent = null;
    this.agentTasks = [];
    this.agentPaused = false;
    this.refreshTimer = null;
    this.options = {
      refreshInterval: 30000,
      ...options
    };
  }

  /**
   * Load the agent view: fetch agents, build UI, select default, load tasks, start heartbeat.
   */
  async load() {
    // Stop any existing heartbeat from a previous instance
    this.stopHeartbeat();

    // Fetch available agents if not already loaded
    if (this.availableAgents.length === 0) {
      try {
        const res = await fetch('/api/agents');
        if (!res.ok) throw new Error('Failed to fetch agents');
        const data = await res.json();
        this.availableAgents = data.agents || [];
        window.availableAgents = this.availableAgents;
      } catch (e) {
        console.error('[AgentView] Failed to fetch agents:', e);
        this.availableAgents = ['openclaw'];
      }
    }

    // Build UI if this is the first load
    if (!this.agentUIContainer) {
      this.buildAgentUI(this.availableAgents);
    } else {
      // Ensure the agent select dropdown reflects any new agents
      this.populateAgentSelect(this.availableAgents);
    }

    // Select default agent if none selected
    if (!this.currentAgent && this.availableAgents.length > 0) {
      this.currentAgent = this.availableAgents[0];
      this.agentSelect.value = this.currentAgent;
    }

    // Load tasks and stats for the current agent
    if (this.currentAgent) {
      await this.loadAgentTasks(this.currentAgent);
      await this.renderAgentStats(this.currentAgent);
      // Notify main module of agent selection
      if (this.onAgentChange) {
        this.onAgentChange(this.currentAgent);
      }
    }

    // Start the auto-refresh heartbeat
    this.startHeartbeat();
  }

  /**
   * Build the agent UI (selector + stats) and insert before the task list container.
   * @param {string[]} agents - List of available agent names.
   */
  buildAgentUI(agents) {
    // Main container that holds selector, stats, and sits above the task list
    this.agentUIContainer = document.createElement('div');
    this.agentUIContainer.id = 'agentUIContainer';
    this.agentUIContainer.style.cssText = 'display: block;';

    // Selector row
    const selectorContainer = document.createElement('div');
    selectorContainer.className = 'agent-selector';
    selectorContainer.style.cssText = 'display: flex; gap: 12px; align-items: center; margin-bottom: 16px;';

    const label = document.createElement('label');
    label.textContent = 'Agent:';
    label.setAttribute('for', 'agentSelect');
    label.style.fontWeight = '600';

    const select = document.createElement('select');
    select.id = 'agentSelect';
    select.className = 'agent-select';
    select.style.cssText = 'padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text);';

    this.populateAgentSelect(agents, select);

    select.addEventListener('change', async (e) => {
      this.currentAgent = e.target.value;
      await this.loadAgentTasks(this.currentAgent);
      await this.renderAgentStats(this.currentAgent);
      if (this.onAgentChange) {
        this.onAgentChange(this.currentAgent);
      }
    });

    selectorContainer.appendChild(label);
    selectorContainer.appendChild(select);

    // Pause/Resume button for heartbeat
    const pauseBtn = document.createElement('button');
    pauseBtn.id = 'agentPauseBtn';
    pauseBtn.className = 'secondary-btn';
    pauseBtn.type = 'button';
    // Load saved pause state
    try {
      this.agentPaused = localStorage.getItem('dashboard_agent_paused') === 'true';
    } catch (error) {
      this.agentPaused = false;
    }
    pauseBtn.textContent = this.agentPaused ? 'Resume' : 'Pause';
    pauseBtn.style.marginLeft = '8px';
    pauseBtn.setAttribute('aria-label', this.agentPaused ? 'Resume agent updates' : 'Pause agent updates');
    pauseBtn.addEventListener('click', async () => {
      this.agentPaused = !this.agentPaused;
      try {
        localStorage.setItem('dashboard_agent_paused', this.agentPaused);
      } catch (error) {
        console.warn('[AgentView] Failed to persist agent pause state:', error);
      }
      this.updatePauseUI(pauseBtn);
      if (this.agentPaused) {
        this.stopHeartbeat();
        this.showNotice('Agent updates paused.', 'info');
      } else {
        await this.startHeartbeat();
        this.showNotice('Agent updates resumed.', 'success');
      }
    });

    selectorContainer.appendChild(pauseBtn);
    this.agentUIContainer.appendChild(selectorContainer);

    // Stats container (grid of stat cards)
    this.agentStatsContainer = document.createElement('div');
    this.agentStatsContainer.id = 'agentStatsContainer';
    this.agentStatsContainer.className = 'stats';
    this.agentStatsContainer.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;';
    this.agentUIContainer.appendChild(this.agentStatsContainer);

    // Insert the agent UI before the task list container (so it appears above the list)
    this.container.parentNode.insertBefore(this.agentUIContainer, this.container);

    // Store references
    this.agentSelect = select;
  }

  /**
   * Populate the agent select dropdown.
   * @param {string[]} agents
   * @param {HTMLSelectElement} [selectEl] - Optional select element (used for initial build).
   */
  populateAgentSelect(agents, selectEl = null) {
    const sel = selectEl || this.agentSelect;
    if (!sel) return;
    sel.innerHTML = '';
    agents.forEach(agent => {
      const option = document.createElement('option');
      option.value = agent;
      option.textContent = agent;
      sel.appendChild(option);
    });
  }

  /**
   * Update the pause button text and aria-label.
   * @param {HTMLButtonElement} button
   */
  updatePauseUI(button) {
    if (!button) return;
    button.textContent = this.agentPaused ? 'Resume' : 'Pause';
    button.setAttribute('aria-label', this.agentPaused ? 'Resume agent updates' : 'Pause agent updates');
  }

  /**
   * Load agent tasks from the API.
   * @param {string} agentName
   * @param {number} [page=1]
   * @param {number} [limit=50]
   */
  async loadAgentTasks(agentName, page = 1, limit = 50) {
    try {
      const url = `/api/views/agent?agent_name=${encodeURIComponent(agentName)}&page=${page}&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const data = await response.json();
      this.agentTasks = data.tasks || [];
      this.renderAgentTaskList(this.agentTasks, agentName);
    } catch (error) {
      console.error('[AgentView] Failed to load agent tasks:', error);
      this.showNotice('Failed to load agent queue.', 'error');
    }
  }

  /**
   * Render the stats cards for the current agent.
   * @param {string} agentName
   */
  renderAgentStats(agentName) {
    if (!this.agentStatsContainer) return;

    // Show skeleton loading while we compute
    this.agentStatsContainer.innerHTML = '';
    const skeleton = skeletonLoader.createStatsSkeletons(3);
    this.agentStatsContainer.appendChild(skeleton);

    // Compute stats from agentTasks
    const tasks = this.agentTasks;
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed' || t.status === 'archived').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const ready = tasks.filter(t => t.status === 'ready').length;
    const locked = tasks.filter(t => t.lockedBy === agentName).length;

    const stats = [
      { label: 'Total Tasks', value: total },
      { label: 'Ready', value: ready },
      { label: 'In Progress', value: inProgress },
      { label: 'Completed', value: completed },
      { label: 'Locked by Me', value: locked }
    ];

    // Render actual stat cards
    this.agentStatsContainer.innerHTML = '';
    stats.forEach(stat => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <h3 style="color: var(--accent); margin-bottom: 6px; font-size: 2rem;">${stat.value}</h3>
        <p style="color: var(--muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1.2px;">${stat.label}</p>
      `;
      this.agentStatsContainer.appendChild(card);
    });
  }

  /**
   * Render the list of agent tasks inside the task list container.
   * @param {Object[]} tasks
   * @param {string} agentName
   */
  renderAgentTaskList(tasks, agentName) {
    // Clear any existing content
    this.container.innerHTML = '';

    if (tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = `No tasks assigned to ${agentName}.`;
      empty.style.textAlign = 'center';
      empty.style.padding = '40px';
      empty.style.color = 'var(--muted)';
      this.container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    tasks.forEach(task => {
      const el = this.createAgentTaskElement(task, agentName);
      fragment.appendChild(el);
    });
    this.container.appendChild(fragment);
  }

  /**
   * Create a single agent task element.
   * @param {Object} task
   * @param {string} agentName
   * @returns {HTMLElement}
   */
  createAgentTaskElement(task, agentName) {
    const container = document.createElement('div');
    container.className = 'agent-task-item task-item';
    container.dataset.taskId = task.id;

    const isLocked = task.lockedBy === agentName;

    // Status badge
    const statusBadge = document.createElement('span');
    statusBadge.className = 'category-badge';
    statusBadge.textContent = task.status || 'unknown';
    statusBadge.style.cssText = `background: ${this.getStatusColor(task.status)}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;`;

    // Task text
    const textEl = document.createElement('div');
    textEl.className = 'task-text';
    textEl.textContent = task.title || task.text;
    textEl.style.fontSize = '1.05rem';
    textEl.style.marginBottom = '8px';

    // Meta info
    const meta = document.createElement('div');
    meta.className = 'agent-task-meta';
    meta.style.fontSize = '0.85rem';
    meta.style.color = 'var(--muted)';

    if (task.project_name) {
      const projectSpan = document.createElement('span');
      projectSpan.textContent = `📁 ${task.project_name}`;
      meta.appendChild(projectSpan);
    }

    if (task.priority) {
      const prioritySpan = document.createElement('span');
      prioritySpan.textContent = `Priority: ${task.priority}`;
      meta.appendChild(prioritySpan);
    }

    if (isLocked) {
      const lockSpan = document.createElement('span');
      lockSpan.textContent = '🔒 Locked';
      lockSpan.style.color = 'var(--accent-3)';
      lockSpan.style.fontWeight = '600';
      meta.appendChild(lockSpan);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'agent-task-actions';
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '8px';

    if (isLocked) {
      // Release button
      const releaseBtn = document.createElement('button');
      releaseBtn.className = 'action-btn release-btn';
      releaseBtn.textContent = 'Release';
      releaseBtn.setAttribute('aria-label', `Release task: ${task.title}`);
      releaseBtn.onclick = async () => {
        releaseBtn.disabled = true;
        releaseBtn.textContent = 'Releasing...';
        try {
          await this.releaseTask(task.id);
          await this.loadAgentTasks(this.currentAgent);
        } catch (error) {
          this.showNotice('Failed to release task.', 'error');
          releaseBtn.disabled = false;
          releaseBtn.textContent = 'Release';
        }
      };
      actions.appendChild(releaseBtn);

      // Execute button
      const executeBtn = document.createElement('button');
      executeBtn.className = 'action-btn';
      executeBtn.style.background = 'rgba(92, 107, 242, 0.18)';
      executeBtn.style.color = 'var(--accent)';
      executeBtn.textContent = 'Execute';
      executeBtn.setAttribute('aria-label', `Execute task: ${task.title}`);
      executeBtn.onclick = async () => {
        await this.executeTaskWithGuard(task, agentName, executeBtn);
      };
      actions.appendChild(executeBtn);
    } else {
      // Claim button
      const claimBtn = document.createElement('button');
      claimBtn.className = 'action-btn claim-btn';
      claimBtn.textContent = 'Claim';
      claimBtn.setAttribute('aria-label', `Claim task: ${task.title}`);
      claimBtn.onclick = async () => {
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claiming...';
        try {
          const result = await this.claimTask(task.id, agentName);
          if (result.locked) {
            await this.loadAgentTasks(this.currentAgent);
          } else {
            claimBtn.disabled = false;
            claimBtn.textContent = 'Claim';
            this.showNotice(result.error || 'Failed to claim task.', 'error');
          }
        } catch (error) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim';
          this.showNotice('Failed to claim task.', 'error');
        }
      };
      actions.appendChild(claimBtn);
    }

    // Assemble the task element
    container.appendChild(textEl);

    const metaRow = document.createElement('div');
    metaRow.className = 'agent-task-meta-row';
    metaRow.style.display = 'flex';
    metaRow.style.gap = '12px';
    metaRow.style.marginTop = '4px';
    metaRow.appendChild(statusBadge);
    metaRow.appendChild(meta);
    container.appendChild(metaRow);

    // Show last run info and retry count (if available)
    if (task.lastRun) {
      const lastRunEl = document.createElement('div');
      lastRunEl.className = 'last-run-info';
      lastRunEl.style.fontSize = '0.8rem';
      lastRunEl.style.color = 'var(--muted)';
      lastRunEl.style.marginTop = '4px';
      const status = task.lastRun.status;
      const icon = status === 'success' ? '✅' : status === 'failure' ? '❌' : '⏳';
      const timeAgo = this.formatTimeAgo(new Date(task.lastRun.startedAt));
      lastRunEl.textContent = `Last: ${icon} ${status} (${timeAgo})`;
      container.appendChild(lastRunEl);
    }

    if (task.retryCount && task.retryCount > 0) {
      const retryCountEl = document.createElement('div');
      retryCountEl.className = 'retry-count';
      retryCountEl.style.fontSize = '0.8rem';
      retryCountEl.style.color = 'var(--muted)';
      retryCountEl.style.marginTop = '2px';
      retryCountEl.textContent = `Retries: ${task.retryCount}`;
      container.appendChild(retryCountEl);
    }

    // Add retry button to actions if task had a failure and is not locked
    if (!isLocked && task.lastRun && task.lastRun.status === 'failure') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'action-btn retry-btn';
      retryBtn.textContent = 'Retry';
      retryBtn.setAttribute('aria-label', `Retry failed task: ${task.title}`);
      retryBtn.style.background = 'rgba(255, 99, 71, 0.15)';
      retryBtn.style.color = 'var(--accent-3)';
      retryBtn.onclick = async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying...';
        try {
          const res = await fetch(`/api/tasks/${task.id}/retry`, { method: 'POST' });
          if (!res.ok) throw new Error('Retry failed');
          await this.loadAgentTasks(this.currentAgent);
          this.showNotice('Task retried; status reset to ready.', 'success');
        } catch (e) {
          this.showNotice('Retry failed: ' + e.message, 'error');
          retryBtn.disabled = false;
          retryBtn.textContent = 'Retry';
        }
      };
      actions.appendChild(retryBtn);
    }

    container.appendChild(actions);

    return container;
  }

  /**
   * Show pre-execution guard modal and return true if user confirms.
   * @param {Object} task
   * @param {string} agentName
   * @returns {Promise<boolean>}
   */
  showPreExecutionGuardModal(task, agentName) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.style.cssText = 'background: var(--surface); border-radius: 16px; padding: 24px; max-width: 500px; width: 90%; box-shadow: var(--shadow);';

      const title = document.createElement('h3');
      title.textContent = 'Pre-Execution Guard';
      title.style.marginBottom = '12px';

      const checksList = document.createElement('ul');
      checksList.style.cssText = 'margin: 12px 0; padding-left: 20px;';

      // Perform checks
      const checks = [];

      // Check 1: Task status
      if (task.status === 'ready') {
        checks.push({ name: 'Task status is ready', pass: true });
      } else if (task.status === 'in_progress') {
        checks.push({ name: 'Task status is in_progress (already claimed)', pass: true });
      } else {
        checks.push({ name: `Task status is '${task.status}'`, pass: false, msg: 'Task must be ready or in_progress' });
      }

      // Check 2: Dependencies
      if (task.dependency_ids && task.dependency_ids.length > 0) {
        checks.push({ name: `Task has ${task.dependency_ids.length} dependency(s)`, pass: 'warning', msg: 'Ensure all dependencies are completed before execution.' });
      } else {
        checks.push({ name: 'No dependencies', pass: true });
      }

      // Check 3: Secrets (simple client-side keyword check)
      const sensitivePattern = /(password|token|secret|api_key|apikey)\s*=/i;
      const textToCheck = (task.title || '') + ' ' + (task.description || '');
      if (sensitivePattern.test(textToCheck)) {
        checks.push({ name: 'Sensitive keyword detected', pass: false, msg: 'Task contains potential secret; redaction may be required.' });
      } else {
        checks.push({ name: 'No sensitive keywords detected', pass: true });
      }

      // Render checks
      checks.forEach(check => {
        const li = document.createElement('li');
        li.style.marginBottom = '8px';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '8px';

        const icon = document.createElement('span');
        if (check.pass === true) {
          icon.textContent = '✅';
        } else if (check.pass === 'warning') {
          icon.textContent = '⚠️';
          icon.style.color = 'var(--accent-2)';
        } else {
          icon.textContent = '❌';
        }

        const text = document.createElement('span');
        text.textContent = check.name;
        if (!check.pass) text.style.color = 'var(--accent-3)';

        li.appendChild(icon);
        li.appendChild(text);

        if (check.msg) {
          const msg = document.createElement('small');
          msg.textContent = ` (${check.msg})`;
          msg.style.color = 'var(--muted)';
          li.appendChild(msg);
        }

        checksList.appendChild(li);
      });

      const actions = document.createElement('div');
      actions.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'secondary-btn';
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });

      const executeBtn = document.createElement('button');
      executeBtn.textContent = 'Execute';
      executeBtn.className = 'add-btn';
      executeBtn.type = 'button';
      // Disable if any hard fail
      executeBtn.disabled = checks.some(c => c.pass === false);
      executeBtn.addEventListener('click', async () => {
        overlay.remove();
        resolve(true);
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(executeBtn);

      modal.appendChild(title);
      modal.appendChild(checksList);
      modal.appendChild(actions);
      overlay.appendChild(modal);

      document.body.appendChild(overlay);
      executeBtn.focus();

      // Close on Escape
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', escHandler);
          resolve(false);
        }
      };
      document.addEventListener('keydown', escHandler);
    });
  }

  /**
   * Execute task with pre-execution guard.
   * @param {Object} task
   * @param {string} agentName
   * @param {HTMLButtonElement} button
   */
  async executeTaskWithGuard(task, agentName, button) {
    button.disabled = true;
    const originalText = button.textContent;

    try {
      // Show pre-execution guard modal
      const confirmed = await this.showPreExecutionGuardModal(task, agentName);
      if (!confirmed) {
        button.disabled = false;
        button.textContent = originalText;
        return;
      }

      button.textContent = 'Claiming...';

      // Claim the task
      const claimRes = await this.claimTask(task.id, agentName);
      if (!claimRes.locked) {
        throw new Error(claimRes.error || 'Failed to claim task');
      }

      button.textContent = 'Executing...';

      // Execute task (update status to in_progress)
      await this.executeTaskOnServer(task.id, agentName);

      this.showNotice(`Task "${task.title}" execution started.`, 'success');
      button.textContent = 'Running';

      // Refresh task list after a short delay
      setTimeout(async () => {
        await this.loadAgentTasks(this.currentAgent);
      }, 2000);

    } catch (error) {
      this.showNotice(`Execution failed: ${error.message}`, 'error');
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  /**
   * Execute task on server (PATCH status to in_progress).
   * @param {string|number} taskId
   * @param {string} agentName
   * @returns {Promise<Object>}
   */
  async executeTaskOnServer(taskId, agentName) {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });
      if (!response.ok) {
        throw new Error('Failed to update task status');
      }
      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Claim a task for the agent.
   * @param {string|number} taskId
   * @param {string} agentName
   * @returns {Promise<Object>}
   */
  async claimTask(taskId, agentName) {
    const response = await fetch('/api/agent/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, agent_name: agentName })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to claim task');
    }

    return await response.json();
  }

  /**
   * Release a claimed task.
   * @param {string|number} taskId
   * @returns {Promise<Object>}
   */
  async releaseTask(taskId) {
    const response = await fetch('/api/agent/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to release task');
    }

    return await response.json();
  }

  /**
   * Start the heartbeat interval to refresh tasks periodically.
   */
  startHeartbeat() {
    if (this.agentPaused) {
      console.log('[AgentView] Heartbeat is paused');
      return;
    }
    this.stopHeartbeat(); // Clear any existing

    this.refreshTimer = setInterval(async () => {
      if (this.currentAgent) {
        console.log(`[AgentView] Heartbeat: refreshing ${this.currentAgent}'s queue...`);
        await this.loadAgentTasks(this.currentAgent);
        // Record heartbeat on server (fire and forget)
        try {
          await fetch('/api/agents/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_name: this.currentAgent })
          });
        } catch (e) {
          console.warn('[AgentView] Failed to send heartbeat:', e);
        }
      }
    }, this.options.refreshInterval);
  }

  /**
   * Stop the heartbeat interval.
   */
  stopHeartbeat() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Get a status color for badges.
   * @param {string} status
   * @returns {string}
   */
  getStatusColor(status) {
    const colors = {
      'backlog': '#6b7280',
      'ready': '#3b82f6',
      'in_progress': '#f59e0b',
      'blocked': '#ef4444',
      'review': '#8b5cf6',
      'completed': '#20b26c',
      'archived': '#9ca3af'
    };
    return colors[status] || '#6b7280';
  }

  /**
   * Format a date to a human-readable "time ago" string.
   * @param {Date} date
   * @returns {string}
   */
  formatTimeAgo(date) {
    if (!(date instanceof Date) || isNaN(date)) return 'unknown';
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }

  /**
   * Clean up resources when view is destroyed.
   */
  destroy() {
    this.stopHeartbeat();
    if (this.agentUIContainer && this.agentUIContainer.parentNode) {
      this.agentUIContainer.parentNode.removeChild(this.agentUIContainer);
    }
    this.container.innerHTML = '';
    // Close any open modal overlay
    const overlay = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (overlay) overlay.remove();
  }
}

export default AgentView;
