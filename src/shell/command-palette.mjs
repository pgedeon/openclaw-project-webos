/**
 * Command Palette (P1) — Ctrl+K / Cmd+K global search
 * Searches tasks, projects, agents, workflows, memory, spaces
 * and navigates to the relevant view with deep-link params.
 */

const CSS = `
  .cmd-palette-overlay {
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,.4); backdrop-filter: blur(4px);
    display: flex; justify-content: center; padding-top: 15vh;
  }
  .cmd-palette {
    width: 560px; max-height: 420px;
    background: var(--win11-surface-solid, #fff);
    border: 1px solid var(--win11-border, #e0e0e0);
    border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.25);
    display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .cmd-palette-input {
    width: 100%; padding: 14px 18px; font-size: 1rem;
    border: none; border-bottom: 1px solid var(--win11-border, #e0e0e0);
    background: transparent; color: var(--win11-text, #1a1a1a);
    outline: none;
  }
  .cmd-palette-input::placeholder { color: var(--win11-text-tertiary, #999); }
  .cmd-palette-results {
    flex: 1; overflow-y: auto; padding: 4px;
  }
  .cmd-palette-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: 8px; cursor: pointer;
    transition: background 0.1s;
  }
  .cmd-palette-item:hover, .cmd-palette-item.active {
    background: var(--win11-surface-hover, rgba(0,120,212,.08));
  }
  .cmd-palette-icon { font-size: 1.1rem; flex-shrink: 0; width: 24px; text-align: center; }
  .cmd-palette-text { flex: 1; min-width: 0; }
  .cmd-palette-title { font-size: 0.88rem; color: var(--win11-text, #1a1a1a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cmd-palette-subtitle { font-size: 0.73rem; color: var(--win11-text-tertiary, #999); margin-top: 1px; }
  .cmd-palette-type { font-size: 0.68rem; color: var(--win11-accent, #0078d4); background: rgba(0,120,212,.08); padding: 2px 7px; border-radius: 4px; flex-shrink: 0; }
  .cmd-palette-empty { padding: 24px; text-align: center; color: var(--win11-text-tertiary, #999); font-size: 0.85rem; }
  .cmd-palette-hint { padding: 8px 14px; border-top: 1px solid var(--win11-border, #e0e0e0); font-size: 0.72rem; color: var(--win11-text-tertiary, #999); }
`;

let palette = null;
let activeIndex = 0;
let results = [];

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightMatch(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  return esc(text.substring(0, idx)) + '<mark style="background:rgba(0,120,212,.2);color:inherit;border-radius:2px;padding:0 1px;">' + esc(text.substring(idx, idx + query.length)) + '</mark>' + esc(text.substring(idx + query.length));
}

async function searchAll(api, query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const items = [];

  // Search apps/views first (instant)
  const apps = globalThis.__OPENCLAW_WIN11_SHELL__?.windowManager?.appMap;
  if (apps) {
    for (const [id, app] of apps) {
      const label = (app.label || app.id || '').toLowerCase();
      if (label.includes(q) || id.includes(q)) {
        items.push({ type: 'app', icon: app.icon || '📱', title: app.label || id, subtitle: 'Open view', viewId: id, params: {}, score: 10 });
      }
    }
  }

  // Search tasks
  try {
    const res = await api.tasks.list({ limit: 20, sort: 'updated_at', order: 'desc' });
    const tasks = Array.isArray(res) ? res : [];
    for (const t of tasks) {
      const title = (t.title || t.text || '').toLowerCase();
      if (title.includes(q)) {
        items.push({ type: 'task', icon: '✅', title: t.title || t.text || 'Untitled', subtitle: t.project_name || t.status || '', viewId: 'tasks', params: { taskId: t.id }, score: 5 });
      }
    }
  } catch {}

  // Search projects
  try {
    const res = await api.projects.list();
    const projects = Array.isArray(res) ? res : (res?.projects || []);
    for (const p of projects) {
      if ((p.name || '').toLowerCase().includes(q)) {
        items.push({ type: 'project', icon: '📁', title: p.name, subtitle: `${p.active_task_count || 0} tasks`, viewId: 'board', params: { projectId: p.id }, score: 4 });
      }
    }
  } catch {}

  // Search agents
  try {
    const res = await api.org.agents.list();
    const agents = Array.isArray(res) ? res : (res?.agents || []);
    for (const a of agents) {
      const name = (a.displayName || a.name || '').toLowerCase();
      if (name.includes(q)) {
        items.push({ type: 'agent', icon: '🤖', title: a.displayName || a.name, subtitle: a.status || '', viewId: 'agents', params: { agentName: a.name }, score: 3 });
      }
    }
  } catch {}

  // Sort by score then alphabetically
  items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return items.slice(0, 25);
}

function renderResults(items, query) {
  const container = palette.querySelector('.cmd-palette-results');
  if (!items.length) {
    container.innerHTML = '<div class="cmd-palette-empty">No results found. Try a different search.</div>';
    return;
  }
  container.innerHTML = items.map((item, i) => `
    <div class="cmd-palette-item ${i === activeIndex ? 'active' : ''}" data-index="${i}">
      <div class="cmd-palette-icon">${item.icon}</div>
      <div class="cmd-palette-text">
        <div class="cmd-palette-title">${highlightMatch(item.title, query)}</div>
        ${item.subtitle ? `<div class="cmd-palette-subtitle">${esc(item.subtitle)}</div>` : ''}
      </div>
      <div class="cmd-palette-type">${esc(item.type)}</div>
    </div>
  `).join('');
  
  container.querySelectorAll('.cmd-palette-item').forEach(el => {
    el.addEventListener('click', () => selectItem(items[parseInt(el.dataset.index)]));
    el.addEventListener('mouseenter', () => {
      activeIndex = parseInt(el.dataset.index);
      container.querySelectorAll('.cmd-palette-item').forEach((e, j) => e.classList.toggle('active', j === activeIndex));
    });
  });
}

function selectItem(item) {
  if (!item) return;
  const wm = globalThis.__OPENCLAW_WIN11_SHELL__?.windowManager;
  if (wm) wm.openWindow(item.viewId, { params: item.params });
  close();
}

function close() {
  if (palette) { palette.remove(); palette = null; }
  activeIndex = 0;
  results = [];
}

export function initCommandPalette(api) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (palette) { close(); return; }
      
      palette = document.createElement('div');
      palette.className = 'cmd-palette-overlay';
      palette.innerHTML = `
        <style>${CSS}</style>
        <div class="cmd-palette">
          <input class="cmd-palette-input" placeholder="Search tasks, projects, agents, views..." autofocus />
          <div class="cmd-palette-results"><div class="cmd-palette-empty">Start typing to search...</div></div>
          <div class="cmd-palette-hint">↑↓ navigate · Enter select · Esc close</div>
        </div>
      `;
      document.body.appendChild(palette);

      const input = palette.querySelector('.cmd-palette-input');
      let debounce = null;

      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const q = input.value.trim();
          if (!q) { results = []; renderResults([], q); return; }
          results = await searchAll(api, q);
          activeIndex = 0;
          renderResults(results, q);
        }, 200);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, results.length - 1); renderResults(results, input.value.trim()); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); renderResults(results, input.value.trim()); return; }
        if (e.key === 'Enter' && results[activeIndex]) { selectItem(results[activeIndex]); }
      });

      // Close on backdrop click
      palette.addEventListener('click', (e) => { if (e.target === palette) close(); });

      input.focus();
    }
  });
}

export default initCommandPalette;
