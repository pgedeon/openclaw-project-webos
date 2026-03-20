// Polyfill global.window for Node.js tests
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

// Polyfill navigator
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {
    onLine: true
  };
} else if (globalThis.navigator.onLine === undefined) {
  globalThis.navigator.onLine = true;
}

// Polyfill localStorage for Node.js tests
class LocalStorageMock {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(index) {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

globalThis.localStorage = new LocalStorageMock();

// Polyfill matchMedia if needed
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  });
}

// Polyfill fetch if not provided
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({})
  });
}
