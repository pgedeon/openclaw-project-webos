/**
 * list-window.mjs — shared virtualization math for large lists.
 *
 * Two proven patterns live in this shell (roadmap "virtualized lists"):
 *
 * 1. Fixed-row rail  → `visibleWindow()` — closed-form scroll window over
 *    rows of a known constant height (used by session-replay-view.mjs).
 *    Only correct when every row is exactly `rowHeight` px tall.
 *
 * 2. Capped render    → `cappedWindow()` — render the first N rows and
 *    expose a "load more" affordance for the remainder. Used where row
 *    heights are NOT predictable (wrapping chips/labels, word-break
 *    titles) or where absolute positioning would fight other layout
 *    mechanics (kanban drag-and-drop): tasks-view.mjs, board-view.mjs.
 *
 * Both functions are pure and DOM-free so node tests can import them
 * directly (see tests/test-list-window.js).
 */

/** Overscan rows rendered above/below the viewport in the fixed-row rail. */
export const RAIL_OVERSCAN = 6;

/**
 * Visible row window for a fixed-row-height virtualized rail. Closed-form
 * math; `end` is exclusive. Falls back to rendering everything when the
 * geometry is degenerate (rowHeight ≤ 0) — correctness over speed.
 * (Extracted verbatim from session-replay-view.mjs so the capped-render
 * views share one window-math source.)
 *
 * @returns {{start: number, end: number}}
 */
export function visibleWindow({ total, viewport, scrollTop, rowHeight, overscan = RAIL_OVERSCAN }) {
  const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (n === 0) return { start: 0, end: 0 };
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return { start: 0, end: n };
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const vp = Number.isFinite(viewport) ? Math.max(0, viewport) : 0;
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const count = Math.ceil(vp / rowHeight) + 2 * overscan;
  return { start, end: Math.min(n, start + count) };
}

/**
 * Window for the capped-render pattern: always anchored at index 0, sized
 * by how many rows the user has asked to see. `end` is exclusive;
 * `hidden` is what a "load more" control should offer/announce.
 *
 * @param {{total: number, shown: number}} args
 * @returns {{start: number, end: number, hidden: number}}
 */
export function cappedWindow({ total, shown }) {
  const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const want = Number.isFinite(shown) ? Math.max(0, Math.floor(shown)) : 0;
  const end = Math.min(n, want);
  return { start: 0, end, hidden: n - end };
}

/**
 * Next cap after a "load more" click: current cap plus one step, never
 * beyond the list length. Pure so views can compute without mutating.
 *
 * @param {{shown: number, total: number, step?: number}} args
 * @returns {number}
 */
export function growCap({ shown, total, step }) {
  const s = Number.isFinite(shown) ? Math.max(0, Math.floor(shown)) : 0;
  const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const st = Number.isFinite(step) && step > 0 ? Math.floor(step) : s || 1;
  return Math.min(n, s + st);
}
