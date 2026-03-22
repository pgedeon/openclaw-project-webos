#!/usr/bin/env python3
"""
Add session UI component to dashboard-integration-optimized.mjs
This adds a session badge to task cards showing active workflow runs
"""

with open('dashboard-integration-optimized.mjs', 'r') as f:
    content = f.read()

# Step 1: Add sessionBadge to the element structure (around line 2365)
element_structure_marker = "    const runtimeBadge = document.createElement('span');\n    runtimeBadge.className = 'runtime-chip';"

session_badge_element = """    const runtimeBadge = document.createElement('span');
    runtimeBadge.className = 'runtime-chip';

    const sessionBadge = document.createElement('span');
    sessionBadge.className = 'session-badge';
    sessionBadge.style.cssText = 'margin-left:8px; font-size:0.85em; padding:2px 6px; border-radius:4px; background:var(--accent-3); color:var(--bg); cursor:pointer;';

"""

content = content.replace(element_structure_marker, session_badge_element)

# Step 2: Add sessionBadge to the element object (around line 2375)
element_object_marker = "      runtimeBadge,\n      dependencyBadge,"

element_object_with_session = """      runtimeBadge,
      sessionBadge,
      dependencyBadge,
"""

content = content.replace(element_object_marker, element_object_with_session)

# Step 3: Add session badge display logic (after dependency badge logic, around line 2520)
dependency_badge_marker = """  // Dependency badge (shows count of dependencies)
  if (task.dependency_ids && task.dependency_ids.length > 0) {
    element.dependencyBadge.textContent = `📎 ${task.dependency_ids.length}`;
    element.dependencyBadge.title = `${task.dependency_ids.length} dependency${task.dependency_ids.length>1?'s':''}`;
    element.meta.appendChild(element.dependencyBadge);
  }"""

session_badge_logic = """  // Dependency badge (shows count of dependencies)
  if (task.dependency_ids && task.dependency_ids.length > 0) {
    element.dependencyBadge.textContent = `📎 ${task.dependency_ids.length}`;
    element.dependencyBadge.title = `${task.dependency_ids.length} dependency${task.dependency_ids.length>1?'s':''}`;
    element.meta.appendChild(element.dependencyBadge);
  }

  // Session badge (shows active workflow run with session binding)
  if (task.active_workflow_run_id && !completed && !archived) {
    fetchAndDisplaySession(task.active_workflow_run_id, element.sessionBadge);
  } else {
    // Clear badge if no active run
    element.sessionBadge.textContent = '';
  }"""

content = content.replace(dependency_badge_marker, session_badge_logic)

# Step 4: Add helper function to fetch and display session info (before createActionButton function)
create_action_button_marker = "/**\n * Create an action button\n */\nfunction createActionButton(text, className, onClick, ariaPressed = false) {"

session_fetch_function = """/**
 * Fetch and display session information for active workflow run
 */
async function fetchAndDisplaySession(workflowRunId, badgeElement) {
  try {
    const response = await fetch(\`/api/workflow-runs/\${workflowRunId}\`);
    if (!response.ok) {
      badgeElement.textContent = '';
      return;
    }

    const run = await response.json();

    // Check if there's an active gateway session
    if (run.gateway_session_id && run.gateway_session_active) {
      const sessionIcon = '🤖';
      const statusEmoji = run.status === 'running' ? '▶️' : '⏸️';
      const stepInfo = run.current_step ? \` • \${run.current_step.replace(/_/g, ' ')}\` : '';

      badgeElement.textContent = \`\${sessionIcon} \${statusEmoji} Session\${stepInfo}\`;
      badgeElement.title = \`Active session: \${run.gateway_session_id}\\nWorkflow: \${run.workflow_type}\\nStatus: \${run.status}\`;

      // Add click handler to show session details
      badgeElement.onclick = () => showSessionDetails(workflowRunId);

      // Pulse animation for active sessions
      badgeElement.style.animation = 'pulse 2s infinite';
    } else if (run.status === 'running' || run.status === 'queued') {
      // Workflow is active but no session bound yet
      badgeElement.textContent = \`⏳ \${run.status}\`;
      badgeElement.title = \`Workflow: \${run.workflow_type}\\nStatus: \${run.status}\\nNo active session\`;
      badgeElement.style.background = 'var(--muted)';
    }
  } catch (error) {
    console.error('[Session Badge] Failed to fetch workflow run:', error);
    badgeElement.textContent = '';
  }
}

/**
 * Show session details in a modal or panel
 */
async function showSessionDetails(workflowRunId) {
  try {
    const response = await fetch(\`/api/workflow-runs/\${workflowRunId}\`);
    if (!response.ok) return;

    const run = await response.json();

    // Create a simple modal with session info
    const modal = document.createElement('div');
    modal.className = 'session-modal';
    modal.style.cssText = \`
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      box-shadow: var(--shadow);
      z-index: 1000;
    \`;

    const stepsList = run.steps && run.steps.length > 0
      ? run.steps.map(s => \`
          <div style="margin: 8px 0; padding: 8px; background: var(--bg-2); border-radius: 4px;">
            <strong>\${s.step_name.replace(/_/g, ' ')}</strong><br/>
            <span style="color: var(--muted);">Status: \${s.status}</span>
            \${s.started_at ? \`<br/><span style="color: var(--muted);">Started: \${formatDate(s.started_at)}</span>\` : ''}
          </div>
        \`).join('')
      : '<p style="color: var(--muted);">No steps recorded</p>';

    modal.innerHTML = \`
      <h3 style="margin-top:0;">Workflow Run Details</h3>
      <div style="margin: 16px 0;">
        <p><strong>Workflow:</strong> \${run.workflow_type}</p>
        <p><strong>Status:</strong> \${run.status}</p>
        <p><strong>Session:</strong> \${run.gateway_session_id || 'None'}</p>
        <p><strong>Session Active:</strong> \${run.gateway_session_active ? 'Yes' : 'No'}</p>
        \${run.current_step ? \`<p><strong>Current Step:</strong> \${run.current_step.replace(/_/g, ' ')}</p>\` : ''}
        <p><strong>Owner:</strong> \${run.owner_agent_id}</p>
        \${run.started_at ? \`<p><strong>Started:</strong> \${formatDate(run.started_at)}</p>\` : ''}
      </div>
      <h4>Workflow Steps</h4>
      \${stepsList}
      <button onclick="this.parentElement.remove()" style="margin-top: 16px; padding: 8px 16px; border-radius: 4px; border: none; background: var(--accent); color: var(--bg); cursor: pointer;">
        Close
      </button>
    \`;

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    };

    document.body.appendChild(modal);
  } catch (error) {
    console.error('[Session Modal] Failed to show session details:', error);
  }
}

/**\n * Create an action button\n */\nfunction createActionButton(text, className, onClick, ariaPressed = false) {"""

content = content.replace(create_action_button_marker, session_fetch_function)

# Step 5: Add CSS animation for pulse effect in the HTML head
style_marker = "        [data-theme=\"dark\"] {"

pulse_animation_css = """        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        [data-theme="dark"] {"""

content = content.replace(style_marker, pulse_animation_css)

with open('dashboard-integration-optimized.mjs', 'w') as f:
    f.write(content)

print("✅ Session UI components added to dashboard-integration-optimized.mjs")
print("  - Added sessionBadge element")
print("  - Added fetchAndDisplaySession function")
print("  - Added showSessionDetails modal")
print("  - Added pulse animation for active sessions")
