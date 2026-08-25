/**
 * Accent pack engine — pure helpers + DOM application.
 *
 * Accent packs are CSS custom-property overrides layered ON TOP of the base
 * dark/light theme (see src/styles/win11-accents.css). The base "default"
 * pack is Win11 blue and needs no override block — applying it simply clears
 * the data-accent attribute so the base theme variables win again.
 *
 * Persistence follows the shell storage key conventions
 * (`openclaw.win11.theme.v1`, `openclaw.win11.windows.v1`, …) with the key
 * `openclaw.accent`. All readers/writers are zero-throw: any failure
 * (storage unavailable, invalid stored value, non-string garbage) resolves
 * to the default pack silently.
 */

export const ACCENT_STORAGE_KEY = 'openclaw.accent';

export const DEFAULT_ACCENT = 'default';

/**
 * Built-in accent packs. `color` is the light-mode swatch, `darkColor` the
 * dark-mode swatch (both used for picker UI only — the actual page colors
 * live in win11-accents.css).
 */
export const ACCENT_PACKS = [
  { id: 'default', label: 'Blue', color: '#0067c0', darkColor: '#60cdff' },
  { id: 'teal', label: 'Teal', color: '#038387', darkColor: '#45d1d6' },
  { id: 'violet', label: 'Violet', color: '#8661c5', darkColor: '#c3a6ff' },
  { id: 'amber', label: 'Amber', color: '#ca5010', darkColor: '#f7a95d' },
  { id: 'rose', label: 'Rose', color: '#c4314b', darkColor: '#ff8fa8' },
];

const ACCENT_IDS = new Set(ACCENT_PACKS.map((pack) => pack.id));

/**
 * Validate a raw value against the built-in accent list.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAccent(value) {
  if (typeof value !== 'string') return false;
  return ACCENT_IDS.has(value.trim().toLowerCase());
}

/**
 * Resolve any stored/raw value to a valid accent id, falling back to the
 * default pack for anything invalid. Never throws.
 * @param {unknown} storedValue
 * @returns {string} a valid accent id (member of ACCENT_PACKS ids)
 */
export function resolveAccent(storedValue) {
  try {
    const normalized = typeof storedValue === 'string'
      ? storedValue.trim().toLowerCase()
      : '';
    return ACCENT_IDS.has(normalized) ? normalized : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Apply an accent to the document by toggling the `data-accent` attribute
 * on <html>. The default pack removes the attribute so base theme vars win.
 * Safe to call in non-DOM environments (returns the resolved id untouched).
 * @param {unknown} accentId
 * @param {Document} [doc] injectable document for tests
 * @returns {string} the resolved accent id that was applied
 */
export function applyAccent(accentId, doc = typeof document !== 'undefined' ? document : null) {
  const resolved = resolveAccent(accentId);
  if (!doc || !doc.documentElement) return resolved;

  if (resolved === DEFAULT_ACCENT) {
    doc.documentElement.removeAttribute('data-accent');
  } else {
    doc.documentElement.setAttribute('data-accent', resolved);
  }
  return resolved;
}

/**
 * Read + validate the persisted accent preference. Zero-throw: missing key,
 * storage errors, or invalid values all resolve to the default pack.
 * @param {{getItem?: Function}} [storage] injectable storage for tests
 * @param {string} [storageKey]
 * @returns {string} a valid accent id
 */
export function readStoredAccent(storage = typeof localStorage !== 'undefined' ? localStorage : null, storageKey = ACCENT_STORAGE_KEY) {
  try {
    const raw = storage && typeof storage.getItem === 'function'
      ? storage.getItem(storageKey)
      : null;
    return resolveAccent(raw);
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Persist an accent preference. Zero-throw: storage failures are swallowed
 * (the in-memory application still works for the session).
 * @param {unknown} accentId
 * @param {{setItem?: Function}} [storage] injectable storage for tests
 * @param {string} [storageKey]
 * @returns {string} the resolved accent id that was persisted
 */
export function storeAccent(accentId, storage = typeof localStorage !== 'undefined' ? localStorage : null, storageKey = ACCENT_STORAGE_KEY) {
  const resolved = resolveAccent(accentId);
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(storageKey, resolved);
    }
  } catch {
    // Storage unavailable — session-only accent is fine.
  }
  return resolved;
}
