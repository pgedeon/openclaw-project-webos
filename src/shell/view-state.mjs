const isObject = (value) => value && typeof value === 'object';

const splitPath = (path) => String(path || '')
  .split('.')
  .map((segment) => segment.trim())
  .filter(Boolean);

const cloneValue = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (error) {
      return value;
    }
  }

  if (!isObject(value)) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
};

const getAtPath = (source, path) => {
  const parts = Array.isArray(path) ? path : splitPath(path);
  return parts.reduce((current, part) => (current == null ? undefined : current[part]), source);
};

const setAtPath = (source, path, value) => {
  const parts = Array.isArray(path) ? path : splitPath(path);
  if (!parts.length) {
    return false;
  }

  let cursor = source;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    if (!isObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const leaf = parts[parts.length - 1];
  const previous = cursor[leaf];
  if (Object.is(previous, value)) {
    return false;
  }

  cursor[leaf] = value;
  return true;
};

const deleteAtPath = (source, path) => {
  const parts = Array.isArray(path) ? path : splitPath(path);
  if (!parts.length) {
    return false;
  }

  let cursor = source;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!isObject(cursor)) {
      return false;
    }
  }

  const leaf = parts[parts.length - 1];
  if (!(leaf in cursor)) {
    return false;
  }

  delete cursor[leaf];
  return true;
};

const mergePatch = (target, patch, prefix = '', changes = []) => {
  if (!isObject(patch)) {
    return changes;
  }

  Object.entries(patch).forEach(([key, nextValue]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const currentValue = target[key];

    if (
      isObject(nextValue)
      && !Array.isArray(nextValue)
      && isObject(currentValue)
      && !Array.isArray(currentValue)
    ) {
      mergePatch(currentValue, nextValue, path, changes);
      return;
    }

    if (Object.is(currentValue, nextValue)) {
      return;
    }

    target[key] = nextValue;
    changes.push({ path, previous: currentValue, value: nextValue });
  });

  return changes;
};

const createStateProxy = (rootState, notify, path = [], cache = new WeakMap()) => {
  if (!isObject(rootState)) {
    return rootState;
  }

  if (cache.has(rootState)) {
    return cache.get(rootState);
  }

  const proxy = new Proxy(rootState, {
    get(target, property) {
      if (property === '__raw') {
        return target;
      }

      const value = target[property];
      if (isObject(value)) {
        return createStateProxy(value, notify, path.concat(property), cache);
      }

      return value;
    },

    set(target, property, value) {
      const previous = target[property];
      if (Object.is(previous, value)) {
        return true;
      }

      target[property] = value;
      notify([{ path: path.concat(property).join('.'), previous, value }]);
      return true;
    },

    deleteProperty(target, property) {
      if (!(property in target)) {
        return true;
      }

      const previous = target[property];
      delete target[property];
      notify([{ path: path.concat(property).join('.'), previous, value: undefined }]);
      return true;
    },
  });

  cache.set(rootState, proxy);
  return proxy;
};

export function createViewState(initialState = {}) {
  const rootState = cloneValue(initialState) || {};
  const pathListeners = new Map();
  const changeListeners = new Set();

  const notify = (changes = []) => {
    if (!changes.length) {
      return rootState;
    }

    changes.forEach((change) => {
      const listeners = pathListeners.get(change.path);
      if (!listeners?.size) {
        return;
      }

      const nextValue = getAtPath(rootState, change.path);
      listeners.forEach((callback) => {
        callback(nextValue, change.previous, rootState, change.path);
      });
    });

    changeListeners.forEach((callback) => {
      callback(rootState, changes);
    });

    return rootState;
  };

  const state = createStateProxy(rootState, notify);

  const getState = (path = null) => {
    if (!path) {
      return state;
    }

    return getAtPath(rootState, path);
  };

  const setState = (pathOrPatch, value) => {
    if (typeof pathOrPatch === 'function') {
      return setState(pathOrPatch(state));
    }

    if (typeof pathOrPatch === 'string') {
      const path = splitPath(pathOrPatch);
      if (!path.length) {
        return state;
      }

      const previous = getAtPath(rootState, path);
      const changed = setAtPath(rootState, path, value);
      if (changed) {
        notify([{ path: path.join('.'), previous, value }]);
      }
      return state;
    }

    if (isObject(pathOrPatch)) {
      const changes = mergePatch(rootState, pathOrPatch);
      notify(changes);
      return state;
    }

    return state;
  };

  const subscribe = (path, callback) => {
    const key = splitPath(path).join('.');
    if (!key || typeof callback !== 'function') {
      return () => {};
    }

    if (!pathListeners.has(key)) {
      pathListeners.set(key, new Set());
    }

    const listeners = pathListeners.get(key);
    listeners.add(callback);

    return () => {
      listeners.delete(callback);
      if (!listeners.size) {
        pathListeners.delete(key);
      }
    };
  };

  const onStateChange = (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    changeListeners.add(callback);
    return () => changeListeners.delete(callback);
  };

  return {
    state,
    getState,
    setState,
    subscribe,
    onStateChange,
    deleteState(path) {
      const key = splitPath(path);
      if (!key.length) {
        return false;
      }

      const previous = getAtPath(rootState, key);
      const changed = deleteAtPath(rootState, key);
      if (changed) {
        notify([{ path: key.join('.'), previous, value: undefined }]);
      }
      return changed;
    },
  };
}

export default createViewState;
