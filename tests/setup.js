/**
 * Jest test setup
 */

// Use fake-indexeddb for IndexedDB mock
import 'fake-indexeddb/auto';

// Polyfill for fetch if needed (jsdom provides fetch in newer versions)
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({})
    };
  };
}

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: query === '(prefers-color-scheme: dark)' ? false : false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn()
  }))
});

// Suppress console.error/table spam in tests (optional)
const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Failed to parse saved data')) {
    return; // Suppress expected errors
  }
  originalError.apply(console, args);
};
