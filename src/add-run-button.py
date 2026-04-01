#!/usr/bin/env python3
"""
Add "Run with OpenClaw" button to task cards in dashboard
"""

with open('dashboard-integration-optimized.mjs', 'r') as f:
    content = f.read()

# Step 1: Add runOpenClawBtn to element structure (after deleteBtn)
button_structure_marker = """    const deleteBtn = createActionButton('Delete', 'delete-btn', null);

    actions.append(completeBtn, editBtn, manageBtn, deleteBtn);"""

button_structure_new = """    const deleteBtn = createActionButton('Delete', 'delete-btn', null);

    const runOpenClawBtn = createActionButton('Run with OpenClaw', 'run-openclaw-btn', null);
    actions.append(completeBtn, editBtn, manageBtn, deleteBtn, runOpenClawBtn);"""

content = content.replace(button_structure_marker, button_structure_new)

# Step 2: Add runOpenClawBtn to element object
element_object_marker = """      deleteBtn
    };

    container.style.display = 'contents';
    container.append(main, actions);"""

element_object_new = """      deleteBtn,
      runOpenClawBtn
    };

    container.style.display = 'contents';
    container.append(main, actions);"""

content = content.replace(element_object_marker, element_object_new)

# Step 3: Add click handler for runOpenClawBtn in the button event handlers section
button_handlers_marker = """  // Update button event handlers
  element.completeBtn.onclick = () => handleToggleTask(task.id);
  element.editBtn.onclick = () => startEdit(task.id);
  element.deleteBtn.onclick = () => deleteTaskById(task.id);

  // Configure manage button (archive/restore) based on task state
  if (archived) {
    element.manageBtn.textContent = 'Restore';
    element.manageBtn.onclick = () => restoreTaskById(task.id);
  } else {
    element.manageBtn.textContent = 'Archive';
    element.manageBtn.onclick = () => archiveTaskById(task.id);
  }"""

button_handlers_new = """  // Update button event handlers
  element.completeBtn.onclick = () => handleToggleTask(task.id);
  element.editBtn.onclick = () => startEdit(task.id);
  element.deleteBtn.onclick = () => deleteTaskById(task.id);

  // Run with OpenClaw button
  element.runOpenClawBtn.onclick = (e) => {
    e.stopPropagation();
    openWorkflowLauncher(task);
  };

  // Configure manage button (archive/restore) based on task state
  if (archived) {
    element.manageBtn.textContent = 'Restore';
    element.manageBtn.onclick = () => restoreTaskById(task.id);
  } else {
    element.manageBtn.textContent = 'Archive';
    element.manageBtn.onclick = () => archiveTaskById(task.id);
  }"""

content = content.replace(button_handlers_marker, button_handlers_new)

# Step 4: Add openWorkflowLauncher function and modal functions before createActionButton
create_action_marker = "/**\n * Create an action button\n */\nfunction createActionButton(text, className, onClick, ariaPressed = false) {"

workflow_launcher_functions = """/**
 * Launch workflow launcher modal for a task
 */
async function openWorkflowLauncher(task) {
  // Fetch available workflow templates
  try {
    const response = await fetch('/api/workflow-templates');
    if (!response.ok) throw new Error('Failed to fetch workflow templates');

    const data = await response.json();
    const templates = data.templates || [];

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'workflow-launcher-modal';
    modal.style.cssText = \`
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    \`;

    const panel = document.createElement('div');
    panel.className = 'workflow-launcher-panel';
    panel.style.cssText = \`
      background: var(--surface);
      border-radius: 12px;
      max-width: 600px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow);
    \`;

    const title = document.createElement('h2');
    title.textContent = 'Run with OpenClaw';
    title.style.cssText = 'margin: 0 0 8px 0; padding: 24px 24px 0 24px;';

    const subtitle = document.createElement('p');
    subtitle.textContent = \`Task: \${task.text}\`;
    subtitle.style.cssText = 'color: var(--muted); margin: 0 0 20px 0; padding: 0 24px;';

    const templateList = document.createElement('div');
    templateList.style.cssText = 'padding: 0 24px 24px;';

    if (templates.length === 0) {
      templateList.innerHTML = '<p style="color: var(--muted);">No workflow templates available.</p>';
    } else {
      templateList.innerHTML = templates.map(t => \`
        <div class="workflow-template-item" data-template="\${t.name}" style="
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s;
        " onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-weight: 600; margin-bottom: 8px;">\${t.name.replace(/-/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase())}</div>
          <div style="color: var(--muted); font-size: 0.9em; margin-bottom: 8px;">\${t.description || 'No description'}</div>
          <div style="display: flex; gap: 12px; font-size: 0.85em; color: var(--muted);">
            <span>Category: \${t.category}</span>
            <span>Steps: \${t.steps ? t.steps.length : 0}</span>
            \${t.estimated_duration ? \`<span>Est: \${t.estimated_duration}</span>\` : ''}
          </div>
        </div>
      \`).join('');

      // Add click handlers for template selection
      templateList.querySelectorAll('.workflow-template-item').forEach(item => {
        item.onclick = () => {
          const templateName = item.dataset.template;
          modal.remove();
          launchWorkflow(task, templateName);
        };
      });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'position: absolute; top: 24px; right: 24px; background: none; border: none; font-size: 1.5em; cursor: pointer; color: var(--muted);';
    cancelBtn.onclick = () => modal.remove();

    panel.appendChild(title);
    panel.appendChild(subtitle);
    panel.appendChild(templateList);
    panel.appendChild(cancelBtn);
    modal.appendChild(panel);

    // Close on background click
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);

    // Focus first template item
    setTimeout(() => {
      const first = templateList.querySelector('.workflow-template-item');
      if (first) first.focus();
    }, 100);

  } catch (error) {
    console.error('[Workflow Launcher] Failed:', error);
    alert('Failed to load workflow templates. Please try again.');
  }
}

/**
 * Launch a workflow for a task with selected template
 */
async function launchWorkflow(task, workflowType) {
  try {
    // Create workflow run with session binding
    const sessionId = \`session-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`;

    const createResponse = await fetch('/api/workflow-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_type: workflowType,
        owner_agent_id: getTaskOwnerAgent(task), // Determine appropriate agent
        board_id: task.project_id || null,
        task_id: task.id,
        initiator: 'user',
        input_payload: {
          task_id: task.id,
          task_text: task.text,
          task_description: task.description,
          task_category: task.category,
          ...task.metadata || {}
        },
        gateway_session_id: sessionId
      })
    });

    if (!createResponse.ok) {
      throw new Error(\`Failed to create workflow run: \${createResponse.status}\`);
    }

    const run = await createResponse.json();

    // Bind session to run
    await fetch(\`/api/workflow-runs/\${run.id}/bind-session\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    });

    // Start the workflow
    await fetch(\`/api/workflow-runs/\${run.id}/start\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    // Show success notification
    showSnackbar(\`Started \${workflowType} workflow for task\`, 5000);

    // Refresh task list to show session badge
    fetchLatestState();

  } catch (error) {
    console.error('[Workflow Launch] Failed:', error);
    alert(\`Failed to launch workflow: \${error.message}\`);
  }
}

/**
 * Get appropriate agent ID for a task based on category or task properties
 */
function getTaskOwnerAgent(task) {
  // Simple routing logic - can be enhanced
  const category = task.category ? task.category.toLowerCase() : 'general';

  if (category.includes('affiliate') || category.includes('content') || category.includes('blog')) {
    return 'affiliate-editorial';
  }
  if (category.includes('image') || category.includes(' graphic')) {
    return 'image-generator';
  }
  if (category.includes('publish') || category.includes('wordpress') || category.includes('wp')) {
    return 'wordpress-publisher';
  }
  if (category.includes('site') || category.includes('fix') || category.includes('bug')) {
    return 'site-fixer';
  }
  if (category.includes('incident') || category.includes('investigation')) {
    return 'incident-investigator';
  }
  if (category.includes('code') || category.includes('development') || category.includes('programming')) {
    return 'coder';
  }
  if (category.includes('review') || category.includes('quality') || category.includes('qa')) {
    return 'qa-reviewer';
  }

  // Default agent (could be configured)
  return 'main-agent';
}

/**
 * Show a snackbar notification
 */
function showSnackbar(message, duration = 3000) {
  const snackbar = document.getElementById('snackbar');
  const messageEl = document.getElementById('snackbarMessage');

  if (snackbar && messageEl) {
    messageEl.textContent = message;
    snackbar.style.display = 'flex';
    snackbar.style.animation = 'slideIn 0.3s ease-out';

    setTimeout(() => {
      snackbar.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => snackbar.style.display = 'none', 300);
    }, duration);
  } else {
    // Fallback to alert if snackbar not available
    console.log('[Snackbar]', message);
  }
}

"""

content = content.replace(create_action_marker, workflow_launcher_functions)

# Step 5: Add CSS for run button and modal
create_action_marker = "/**\n * Create an action button\n */\nfunction createActionButton(text, className, onClick, ariaPressed = false) {"

# Check if we already added the CSS injection
# If not, add it before the createActionButton function definition
if "function createActionButton(text, className, onClick, ariaPressed = false) {" not in content.split(workflow_launcher_functions)[1].replace(create_action_marker, "", 1):
    pass  # Already handled above

with open('dashboard-integration-optimized.mjs', 'w') as f:
    f.write(content)

print("✅ 'Run with OpenClaw' button added to dashboard")
print("   - Added button to task actions")
print("   - Added workflow launcher modal")
print("   - Added workflow launch API integration")
print("   - Added agent routing logic (getTaskOwnerAgent)")
