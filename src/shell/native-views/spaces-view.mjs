/**
 * Spaces View — manage workspaces (create, edit, duplicate, delete, switch)
 */

const COLORS = ['#0078d4', '#107c10', '#c239b3', '#e74856', '#ffb900', '#00b7c3', '#8764b8', '#00cc6a'];
const ICONS = ['📁', '🏠', '💼', '🚀', '🎯', '📊', '🔧', '🎨', '📦', '⚡'];

const CSS = `
  .spc-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 0.85rem; }
  .spc-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--win11-border); flex-shrink: 0; }
  .spc-title { font-size: 1.1rem; font-weight: 600; }
  .spc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 16px; overflow-y: auto; flex: 1; }
  .spc-card { border: 1px solid var(--win11-border); border-radius: 8px; padding: 16px; cursor: pointer; transition: all .15s; position: relative; }
  .spc-card:hover { border-color: var(--win11-accent); box-shadow: 0 2px 8px rgba(0,0,0,.1); }
  .spc-card.active { border-color: var(--win11-accent); background: color-mix(in srgb, var(--win11-accent) 8%, transparent); }
  .spc-card-icon { font-size: 2rem; margin-bottom: 8px; }
  .spc-card-name { font-weight: 600; margin-bottom: 4px; }
  .spc-card-desc { font-size: 0.78rem; color: var(--win11-text-secondary); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spc-card-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: var(--win11-accent); color: #fff; display: inline-block; }
  .spc-card-actions { display: flex; gap: 6px; margin-top: 10px; }
  .spc-btn { padding: 4px 10px; border-radius: 4px; border: 1px solid var(--win11-border); background: var(--win11-surface-solid); cursor: pointer; font-size: 0.75rem; }
  .spc-btn:hover { background: var(--win11-surface-hover); }
  .spc-btn-primary { background: var(--win11-accent); color: #fff; border-color: var(--win11-accent); }
  .spc-btn-danger { color: #e74856; border-color: #e74856; }
  .spc-btn-danger:hover { background: #e7485620; }
  .spc-btn-switch { color: #0078d4; border-color: #0078d4; }
  .spc-btn-switch:hover { background: #0078d420; }
  .spc-add { border: 2px dashed var(--win11-border); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 120px; opacity: .6; }
  .spc-add:hover { opacity: 1; border-color: var(--win11-accent); }
  .spc-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.4); }
  .spc-modal-inner { background: var(--win11-surface-solid); border-radius: 8px; padding: 24px; width: 380px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,.3); }
  .spc-modal h3 { margin: 0 0 16px; }
  .spc-field { margin-bottom: 12px; }
  .spc-field label { display: block; font-size: 0.78rem; color: var(--win11-text-secondary); margin-bottom: 4px; }
  .spc-field input, .spc-field textarea { width: 100%; padding: 6px 10px; border: 1px solid var(--win11-border); border-radius: 4px; font-size: 0.85rem; background: var(--win11-surface-solid); color: var(--win11-text-primary); box-sizing: border-box; }
  .spc-field textarea { resize: vertical; min-height: 60px; }
  .spc-icon-picker { display: flex; gap: 6px; flex-wrap: wrap; }
  .spc-icon-pick { font-size: 1.4rem; padding: 4px; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
  .spc-icon-pick.selected { border-color: var(--win11-accent); background: color-mix(in srgb, var(--win11-accent) 15%, transparent); }
  .spc-color-picker { display: flex; gap: 6px; }
  .spc-color-swatch { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
  .spc-color-swatch.selected { border-color: var(--win11-text-primary); transform: scale(1.2); }
  .spc-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .spc-notice { position: fixed; bottom: 16px; right: 16px; padding: 8px 16px; border-radius: 6px; font-size: 0.82rem; z-index: 10000; transition: opacity .3s; }
  .spc-notice.success { background: #107c10; color: #fff; }
  .spc-notice.error { background: #e74856; color: #fff; }
`;

function showNotice(msg, type = 'success') {
  const n = document.createElement('div');
  n.className = `spc-notice ${type}`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 3000);
}

function showModal(html) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'spc-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class="spc-modal-inner">${html}</div>`;
    document.body.appendChild(overlay);
    const inner = overlay.querySelector('.spc-modal-inner');
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    inner.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
    inner.querySelector('[data-confirm]')?.addEventListener('click', () => {
      const form = {};
      inner.querySelectorAll('input, textarea').forEach(el => { form[el.name] = el.value; });
      form.icon = inner.querySelector('.spc-icon-pick.selected')?.textContent || '📁';
      form.color = inner.querySelector('.spc-color-swatch.selected')?.dataset.color || '#0078d4';
      close(form);
    });
    inner.querySelectorAll('.spc-icon-pick').forEach(el => {
      el.addEventListener('click', () => {
        inner.querySelectorAll('.spc-icon-pick').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    inner.querySelectorAll('.spc-color-swatch').forEach(el => {
      el.addEventListener('click', () => {
        inner.querySelectorAll('.spc-color-swatch').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
    // Focus first interactive element (accessibility)
    const first = inner.querySelector('input, textarea, button');
    first?.focus();
  });
}

export async function renderSpacesView({ mountNode, api, adapter, stateStore, sync }) {
  // Instance-scoped state (fixes #16: module-level variable leak)
  let spaces = [];

  mountNode.innerHTML = `<style>${CSS}</style><div class="spc-container"><div style="text-align:center;padding:40px;">Loading spaces...</div></div>`;
  const container = mountNode.querySelector('.spc-container');

  function getActiveSpaceId() {
    return stateStore?.getState?.('activeSpaceId') || null;
  }

  function setActiveSpace(space) {
    stateStore?.setState?.('activeSpaceId', space.id);
    globalThis.dispatchEvent(new CustomEvent('space:changed', { detail: { space } }));
  }

  async function load() {
    try {
      const result = await api.spaces.list();
      spaces = result.spaces || [];
    } catch { spaces = []; }
    render();
  }

  function render() {
    container.innerHTML = '';
    const activeId = getActiveSpaceId();

    // Header
    const header = document.createElement('div');
    header.className = 'spc-header';
    header.innerHTML = `
      <div class="spc-title">📁 Spaces</div>
      <button class="spc-btn spc-btn-primary" id="spc-create-btn">+ New Space</button>
    `;
    container.appendChild(header);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'spc-grid';

    spaces.forEach(space => {
      const card = document.createElement('div');
      card.className = 'spc-card';
      if (space.id === activeId) card.classList.add('active');

      // Safe icon rendering (fixes #6: XSS via innerHTML)
      const iconEl = document.createElement('div');
      iconEl.className = 'spc-card-icon';
      iconEl.textContent = space.icon || '📁';

      const nameEl = document.createElement('div');
      nameEl.className = 'spc-card-name';
      nameEl.textContent = space.name;

      const descEl = document.createElement('div');
      descEl.className = 'spc-card-desc';
      descEl.textContent = space.description || space.slug;

      const metaEl = document.createElement('div');
      metaEl.style.cssText = 'margin-top:6px;font-size:0.72rem;color:var(--win11-text-tertiary);';
      metaEl.textContent = new Date(space.created_at).toLocaleDateString();

      card.appendChild(iconEl);
      card.appendChild(nameEl);
      card.appendChild(descEl);

      if (space.is_default) {
        const badge = document.createElement('span');
        badge.className = 'spc-card-badge';
        badge.textContent = 'Default';
        card.appendChild(badge);
      }

      card.appendChild(metaEl);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'spc-card-actions';

      const isActive = space.id === activeId;

      // Switch button (unless already active)
      if (!isActive) {
        const switchBtn = document.createElement('button');
        switchBtn.className = 'spc-btn spc-btn-switch';
        switchBtn.textContent = 'Switch';
        switchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveSpace(space);
          showNotice(`Switched to ${space.name}`);
          render();
        });
        actions.appendChild(switchBtn);
      } else {
        const activeBtn = document.createElement('button');
        activeBtn.className = 'spc-btn';
        activeBtn.textContent = '✓ Active';
        activeBtn.disabled = true;
        actions.appendChild(activeBtn);
      }

      const editBtn = document.createElement('button');
      editBtn.className = 'spc-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); handleEdit(space.id); });
      actions.appendChild(editBtn);

      const dupBtn = document.createElement('button');
      dupBtn.className = 'spc-btn';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDuplicate(space.id); });
      actions.appendChild(dupBtn);

      if (!space.is_default) {
        const delBtn = document.createElement('button');
        delBtn.className = 'spc-btn spc-btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete(space.id); });
        actions.appendChild(delBtn);
      }

      card.appendChild(actions);

      // Click card to switch (if not already active)
      if (!isActive) {
        card.addEventListener('click', () => {
          setActiveSpace(space);
          showNotice(`Switched to ${space.name}`);
          render();
        });
      }

      grid.appendChild(card);
    });

    // Add card
    const addCard = document.createElement('div');
    addCard.className = 'spc-card spc-add';
    addCard.innerHTML = '<div style="font-size:2rem">+</div><div>New Space</div>';
    addCard.addEventListener('click', handleCreate);
    grid.appendChild(addCard);

    container.appendChild(grid);
    header.querySelector('#spc-create-btn')?.addEventListener('click', handleCreate);
  }

  async function handleCreate() {
    const form = await showModal(`
      <h3>Create Space</h3>
      <div class="spc-field"><label>Name</label><input name="name" placeholder="My Space" maxlength="120"></div>
      <div class="spc-field"><label>Description</label><textarea name="description" placeholder="What's this space for?" maxlength="1000"></textarea></div>
      <div class="spc-field"><label>Icon</label><div class="spc-icon-picker">${ICONS.map(i => `<span class="spc-icon-pick${i === '📁' ? ' selected' : ''}">${i}</span>`).join('')}</div></div>
      <div class="spc-field"><label>Color</label><div class="spc-color-picker">${COLORS.map(c => `<span class="spc-color-swatch${c === '#0078d4' ? ' selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div></div>
      <div class="spc-modal-actions">
        <button class="spc-btn" data-cancel>Cancel</button>
        <button class="spc-btn spc-btn-primary" data-confirm>Create</button>
      </div>
    `);
    if (!form?.name) return;
    try {
      await api.spaces.create(form);
      showNotice('Space created!', 'success');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  async function handleEdit(id) {
    const space = spaces.find(s => s.id === id);
    if (!space) return;
    const form = await showModal(`
      <h3>Edit "${esc(space.name)}"</h3>
      <div class="spc-field"><label>Name</label><input name="name" value="${esc(space.name)}" maxlength="120"></div>
      <div class="spc-field"><label>Description</label><textarea name="description" maxlength="1000">${esc(space.description || '')}</textarea></div>
      <div class="spc-field"><label>Icon</label><div class="spc-icon-picker">${ICONS.map(i => `<span class="spc-icon-pick${i === (space.icon || '📁') ? ' selected' : ''}">${i}</span>`).join('')}</div></div>
      <div class="spc-field"><label>Color</label><div class="spc-color-picker">${COLORS.map(c => `<span class="spc-color-swatch${c === (space.color || '#0078d4') ? ' selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}</div></div>
      <div class="spc-modal-actions">
        <button class="spc-btn" data-cancel>Cancel</button>
        <button class="spc-btn spc-btn-primary" data-confirm>Save</button>
      </div>
    `);
    if (!form?.name) return;
    try {
      await api.spaces.update(id, form);
      showNotice('Updated!', 'success');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  async function handleDuplicate(id) {
    try {
      await api.spaces.duplicate(id);
      showNotice('Space duplicated!');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  async function handleDelete(id) {
    const space = spaces.find(s => s.id === id);
    if (!confirm(`Delete "${space?.name}"? This cannot be undone.`)) return;
    try {
      await api.spaces.delete(id);
      showNotice('Space deleted.');
    } catch (err) { showNotice(`Failed: ${err.message}`, 'error'); }
    load();
  }

  load();

  // Listen for SSE space changes from other tabs/sessions (#14)
  const onSSEChange = (event) => {
    const data = event.data ? JSON.parse(event.data) : null;
    if (data?.action === 'delete') {
      // If active space was deleted, switch to default
      if (data.spaceId === getActiveSpaceId()) {
        const def = spaces.find(s => s.is_default) || spaces[0];
        if (def) setActiveSpace(def);
      }
    }
    load(); // Refresh the list
  };
  globalThis.addEventListener?.('sse:space:changed', onSSEChange);

  // Return cleanup function
  return () => {
    globalThis.removeEventListener?.('sse:space:changed', onSSEChange);
  };
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export default renderSpacesView;
