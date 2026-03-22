export const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const normalizeCollection = (payload, keys = []) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
};

export const getStateStore = ({ adapter, stateStore }) => stateStore || adapter?.stateStore || null;

export const ensureNativeRoot = (mountNode, className = 'native-view-root') => {
  mountNode.classList.add('native-view-host');
  mountNode.classList.add(className);
  return mountNode;
};

export const setSharedProjectState = (store, project) => {
  if (!store || !project?.id) {
    return null;
  }

  store.setState({
    project_id: project.id,
    project,
  });

  return project.id;
};

export const ensureProjectId = async ({ api, adapter, stateStore }) => {
  const store = getStateStore({ adapter, stateStore });
  const existing = adapter?.getProjectId?.()
    || store?.getState('project.id')
    || store?.getState('project_id');

  if (existing) {
    return existing;
  }

  const payload = await api.projects.getDefault();
  if (!payload?.id) {
    return '';
  }

  setSharedProjectState(store, payload);
  return payload.id;
};

export const subscribeToProject = ({ adapter, stateStore, callback }) => {
  const store = getStateStore({ adapter, stateStore });
  if (!store || typeof callback !== 'function') {
    return () => {};
  }

  const unsubscribeNested = store.subscribe('project.id', callback);
  const unsubscribeFlat = store.subscribe('project_id', callback);

  return () => {
    unsubscribeNested();
    unsubscribeFlat();
  };
};

export const createActionButton = (label, className = '') => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ['native-button', className].filter(Boolean).join(' ');
  button.textContent = label;
  return button;
};

export const createField = ({ label, type = 'text', value = '', placeholder = '', options = [] }) => {
  const wrapper = document.createElement('label');
  wrapper.className = 'native-field';

  const labelEl = document.createElement('span');
  labelEl.className = 'native-field__label';
  labelEl.textContent = label;

  let control;
  if (type === 'select') {
    control = document.createElement('select');
    options.forEach((option) => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      if (option.value === value) {
        optionEl.selected = true;
      }
      control.append(optionEl);
    });
  } else if (type === 'textarea') {
    control = document.createElement('textarea');
    control.value = value;
  } else {
    control = document.createElement('input');
    control.type = type;
    control.value = value;
    control.placeholder = placeholder;
  }

  control.className = 'native-input';
  wrapper.append(labelEl, control);
  return { wrapper, control };
};

export const createStatCard = ({ label, value, tone = 'default', note = '' }) => {
  const card = document.createElement('article');
  card.className = `native-stat-card is-${tone}`;
  card.innerHTML = `
    <div class="native-stat-card__label">${label}</div>
    <div class="native-stat-card__value">${value}</div>
    ${note ? `<div class="native-stat-card__note">${note}</div>` : ''}
  `;
  return card;
};

export const formatCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : String(value ?? '0');
};

export const formatStatusLabel = (value) => String(value || 'unknown')
  .replace(/[_-]+/g, ' ')
  .trim();
