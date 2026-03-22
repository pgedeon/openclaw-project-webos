function clearNode(node) {
  node.innerHTML = '';
}

function createPaddedContainer(mountNode, headingHtml) {
  clearNode(mountNode);
  const container = document.createElement('div');
  container.style.cssText = 'padding:16px;';
  container.innerHTML = headingHtml;
  mountNode.appendChild(container);
  return container;
}

function formatLocalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
}

function renderError(target, message) {
  target.innerHTML = `<p style="color:var(--accent-3);">${message}</p>`;
}

function renderInfo(target, message) {
  target.innerHTML = `<p style="color:var(--muted);">${message}</p>`;
}

export function createSupportViews({
  mountNode,
  resolveProjectId,
  escapeHtml
}) {
  let healthRefreshTimer = null;

  function cleanup() {
    if (healthRefreshTimer) {
      clearInterval(healthRefreshTimer);
      healthRefreshTimer = null;
    }
  }

  async function renderMemorySummaryView(state) {
    const container = createPaddedContainer(
      mountNode,
      '<h2>Memory Summary</h2><div id="memory-summary-content">Loading...</div>'
    );
    const contentDiv = container.querySelector('#memory-summary-content');
    const projectId = resolveProjectId(state);

    if (!projectId) {
      renderInfo(contentDiv, 'Select a project to inspect board memory.');
      return;
    }

    try {
      const resp = await fetch(`/api/board-memory-summary?project_id=${encodeURIComponent(projectId)}`);
      if (!resp.ok) throw new Error('Failed to fetch memory summary');
      const data = await resp.json();
      const summary = data.summary || null;

      if (!summary || summary.total_entries === 0) {
        renderInfo(contentDiv, 'No memory activity found for this board.');
        return;
      }

      let html = `
        <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
          <div class="stat-card" style="background:var(--bg-2); padding:12px; border-radius:8px; min-width:120px;">
            <div style="font-size:1.5em; font-weight:600;">${escapeHtml(summary.total_entries)}</div>
            <div style="color:var(--muted);">Total entries</div>
          </div>
          <div class="stat-card" style="background:var(--bg-2); padding:12px; border-radius:8px; min-width:120px;">
            <div style="font-size:1.5em; font-weight:600;">${escapeHtml(summary.recent_24h)}</div>
            <div style="color:var(--muted);">Last 24h</div>
          </div>
        </div>
        <h3>Recent Activity</h3>
        <ul style="list-style:none; padding:0;">
      `;

      for (const entry of summary.recent_entries || []) {
        html += `
          <li style="padding:8px; border-bottom:1px solid var(--border);">
            <div style="font-weight:600;">${escapeHtml(entry.action)} by ${escapeHtml(entry.actor)}</div>
            <div style="color:var(--muted); font-size:0.9em;">${escapeHtml(formatLocalDate(entry.timestamp))} on task: ${escapeHtml(entry.task_title)}</div>
          </li>
        `;
      }

      html += '</ul>';
      contentDiv.innerHTML = html;
    } catch (error) {
      console.error('[Memory Summary]', error);
      renderError(contentDiv, 'Error loading memory summary.');
    }
  }

  async function renderLeadHandoffsView(state) {
    const container = createPaddedContainer(
      mountNode,
      '<h2>Lead Handoffs</h2><div id="handoffs-content">Loading...</div>'
    );
    const contentDiv = container.querySelector('#handoffs-content');
    const projectId = resolveProjectId(state);

    if (!projectId) {
      renderInfo(contentDiv, 'Select a project to inspect lead handoffs.');
      return;
    }

    try {
      const resp = await fetch(`/api/lead-handoffs?project_id=${encodeURIComponent(projectId)}`);
      if (!resp.ok) throw new Error('Failed to fetch handoffs');
      const data = await resp.json();
      const handoffs = data.handoffs || [];

      if (!handoffs.length) {
        renderInfo(contentDiv, 'No handoff activity found for this board.');
        return;
      }

      let html = '<table style="width:100%; border-collapse:collapse;"><thead><tr style="background:var(--bg-2);"><th style="padding:8px; text-align:left;">Task</th><th>Action</th><th>Actor</th><th>Old Owner</th><th>New Owner</th><th>Time</th></tr></thead><tbody>';
      for (const handoff of handoffs) {
        html += `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px;">${escapeHtml(handoff.task_title)}</td>
            <td style="padding:8px;">${escapeHtml(handoff.action)}</td>
            <td style="padding:8px;">${escapeHtml(handoff.actor)}</td>
            <td style="padding:8px;">${escapeHtml(handoff.old_owner || '-')}</td>
            <td style="padding:8px;">${escapeHtml(handoff.new_owner || '-')}</td>
            <td style="padding:8px;">${escapeHtml(formatLocalDate(handoff.timestamp))}</td>
          </tr>
        `;
      }
      html += '</tbody></table>';
      contentDiv.innerHTML = html;
    } catch (error) {
      console.error('[Lead Handoffs]', error);
      renderError(contentDiv, 'Error loading handoffs.');
    }
  }

  async function renderCrossBoardDepsView() {
    const container = createPaddedContainer(
      mountNode,
      '<h2>Cross-Board Dependencies</h2><p>Tasks that depend on tasks from other boards or projects.</p><div id="deps-content">Loading...</div>'
    );
    const contentDiv = container.querySelector('#deps-content');

    try {
      const resp = await fetch('/api/cross-board-dependencies');
      if (!resp.ok) throw new Error('Failed to fetch cross-board dependencies');
      const data = await resp.json();
      const dependencies = data.cross_board_dependencies || [];

      if (!dependencies.length) {
        renderInfo(contentDiv, 'No cross-board dependencies found.');
        return;
      }

      let html = '<table style="width:100%; border-collapse:collapse;"><thead><tr style="background:var(--bg-2);"><th>Task</th><th>Project</th><th>Dependency Count</th><th>Cross-Board Count</th></tr></thead><tbody>';
      for (const dependency of dependencies) {
        html += `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px;">${escapeHtml(dependency.task_title)}</td>
            <td style="padding:8px;">${escapeHtml(String(dependency.project_id || '').slice(0, 8))}...</td>
            <td style="padding:8px;">${escapeHtml(dependency.dependency_count)}</td>
            <td style="padding:8px;">${escapeHtml(dependency.cross_board_count)}</td>
          </tr>
        `;
      }
      html += '</tbody></table>';
      contentDiv.innerHTML = html;
    } catch (error) {
      console.error('[Cross-Board Dependencies]', error);
      renderError(contentDiv, 'Error loading cross-board dependencies.');
    }
  }

  async function renderHealthView(state) {
    cleanup();

    const container = createPaddedContainer(
      mountNode,
      '<h2>Service Health</h2><div id="health-content">Loading...</div>'
    );
    const contentDiv = container.querySelector('#health-content');

    try {
      const resp = await fetch('/api/health-status');
      if (!resp.ok) throw new Error('Failed to fetch health status');
      const data = await resp.json();
      const statusColor = data.status === 'ok' ? 'green' : data.status === 'degraded' ? 'orange' : 'red';

      let html = `
        <div style="margin-bottom:16px;">
          <strong>Overall Status:</strong> <span style="color:${statusColor}; font-weight:600;">${escapeHtml(String(data.status || '').toUpperCase())}</span>
          <span style="color:var(--muted); font-size:0.9em;"> (checked ${escapeHtml(formatLocalDate(data.timestamp))})</span>
        </div>
        <h3>Checks</h3>
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:var(--bg-2);"><th>Service</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>
      `;

      for (const [name, check] of Object.entries(data.checks || {})) {
        const healthy = check.healthy !== false;
        const detail = check.latency_ms
          ? `Latency: ${check.latency_ms}ms`
          : check.note || (check.count !== undefined ? `Count: ${check.count}` : '');

        html += `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:8px; font-weight:600;">${escapeHtml(name)}</td>
            <td style="padding:8px;">${healthy ? 'Healthy' : 'Unhealthy'}</td>
            <td style="padding:8px; color:var(--muted);">${escapeHtml(detail)}</td>
          </tr>
        `;
      }

      html += '</tbody></table>';
      contentDiv.innerHTML = html;

      healthRefreshTimer = window.setInterval(() => {
        void renderHealthView(state);
      }, 30000);
    } catch (error) {
      console.error('[Health View]', error);
      renderError(contentDiv, 'Error loading service health.');
    }
  }

  async function renderRunbooksView() {
    const container = createPaddedContainer(
      mountNode,
      '<h2>Runbooks</h2><div id="runbooks-content">Loading runbooks...</div>'
    );
    const contentDiv = container.querySelector('#runbooks-content');

    try {
      const templatesRes = await fetch('/api/workflow-templates');
      if (!templatesRes.ok) throw new Error('Failed to fetch workflow templates');
      const templatesData = await templatesRes.json();
      const templates = templatesData.templates || [];

      if (!templates.length) {
        renderInfo(contentDiv, 'No runbooks available.');
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex; gap:16px; height: calc(100vh - 150px);';

      const sidebar = document.createElement('div');
      sidebar.style.cssText = 'flex:0 0 250px; overflow-y:auto; background:var(--bg-2); border-radius:8px; padding:8px;';

      const list = document.createElement('ul');
      list.style.cssText = 'list-style:none; margin:0; padding:0;';

      const contentPane = document.createElement('div');
      contentPane.style.cssText = 'flex:1; overflow-y:auto; background:var(--surface); border-radius:8px; padding:16px; border:1px solid var(--border);';
      contentPane.innerHTML = '<p style="color:var(--muted);">Select a runbook from the list.</p>';

      templates.forEach((template) => {
        const item = document.createElement('li');
        item.textContent = template.display_name || template.name.replace(/-/g, ' ');
        item.style.cssText = 'padding:8px; cursor:pointer; border-radius:4px;';
        item.onclick = () => {
          list.querySelectorAll('li').forEach((element) => {
            element.style.background = '';
            element.style.color = '';
          });
          item.style.background = 'var(--accent)';
          item.style.color = 'var(--bg)';
          void fetchRunbookContent(template.runbookRef || template.name, contentPane);
        };
        list.appendChild(item);
      });

      sidebar.appendChild(list);
      wrapper.appendChild(sidebar);
      wrapper.appendChild(contentPane);

      contentDiv.innerHTML = '';
      contentDiv.appendChild(wrapper);
    } catch (error) {
      console.error('[Runbooks]', error);
      renderError(contentDiv, 'Error loading runbooks.');
    }
  }

  async function fetchRunbookContent(name, container) {
    try {
      const resp = await fetch(`/api/runbook/${encodeURIComponent(name)}`);
      if (!resp.ok) {
        renderError(container, 'Runbook not found.');
        return;
      }

      const text = await resp.text();
      let html = escapeHtml(text)
        .replace(/^# (.*)$/gim, '<h1>$1</h1>')
        .replace(/^## (.*)$/gim, '<h2>$1</h2>')
        .replace(/^### (.*)$/gim, '<h3>$1</h3>')
        .replace(/^> (.*)$/gim, '<blockquote>$1</blockquote>')
        .replace(/^\s*-\s+(.*)$/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br>');

      container.innerHTML = `<div class="runbook-content" style="line-height:1.6;">${html}</div>`;
    } catch (error) {
      console.error('[Runbooks] Failed to load runbook content:', error);
      renderError(container, 'Failed to load runbook.');
    }
  }

  return {
    cleanup,
    renderCrossBoardDepsView,
    renderHealthView,
    renderLeadHandoffsView,
    renderMemorySummaryView,
    renderRunbooksView
  };
}
