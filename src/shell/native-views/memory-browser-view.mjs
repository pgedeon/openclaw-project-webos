/**
 * Memory Browser 2.0 view — timeline + cross-agent links over agent memories
 * (UPGRADE_ROADMAP.md "Memory browser 2.0", flex item scheduled 2026-08-25).
 *
 * Registered BESIDE v1 (`memory`) rather than replacing it: v1 owns the write
 * surface (file editing, facts CRUD, reindex/promote actions) that 2.0 does not
 * reimplement; 2.0 is the read/analyze surface — chronological timeline with
 * agent + date-range filters, cross-agent link chips, and the existing semantic
 * search kept prominent. Both live under Operations.
 *
 * Data sources (all proxied through task-server, no new backend):
 *   GET /api/memory/list        — memory files w/ metadata
 *   GET /api/memory/file/:name  — file content (timeline entry extraction)
 *   GET /api/memory/search?q=   — semantic search (existing, kept prominent)
 *   GET /api/agents             — agent roster for the known-agent heuristic
 *
 * Cross-agent link heuristic (pure helper `extractAgentRefs`): a memory entry
 * references another agent when it (a) @mentions a name, (b) names a roster
 * agent on a word boundary, or (c) cites a shared run/task/session/wf
 * identifier (`run_1a2b3c`, `task-42f0ab`, `session ab12cd34…`). Chips render
 * per entry; clicking one filters the timeline to that agent at that point.
 *
 * Performance guardrail: fixed-row virtualized rail reused from the
 * session-replay pattern (`visibleWindow` imported from session-replay-view.mjs)
 * — DOM stays ~50 rows regardless of entry count.
 *
 * Zero-throw degradation: memory API unreachable → named unavailable state with
 * retry; empty directory → empty state; filter/search misses → named empty
 * states; partial content-fetch failures degrade to what loaded (amber banner).
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';
import { visibleWindow } from './session-replay-view.mjs';

// ── Constants ─────────────────────────────────────────────────────────────

const MEMORY_API_BASE = '/api/memory';
// Fixed rail row height (px) — virtualization math depends on this.
export const ROW_HEIGHT = 64;
// Extra rows rendered above/below the viewport so scrolling never shows gaps.
const RAIL_OVERSCAN = 10;
// Content-fetch cap: newest N files are parsed into the timeline (the list
// endpoint already returns newest-first). Keeps worst-case payload bounded and
// is surfaced honestly via an amber banner when hit.
export const MAX_FILES = 150;
// Parallel content fetches per batch.
const FETCH_BATCH = 8;

const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
// A dated bullet starts a new timeline block ("2026-08-23: …" after -, *, +).
const DATED_BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(\d{4}-\d{2}-\d{2})\b/;
const HEADING_RE = /^#{1,6}\s+/;
// Shared run/task/session identifiers cited inside memory text (`run_1a2b3c`,
// `task-42f0ab`, `session ab12cd34`, `wf9a1b2c`). A single space counts as a
// separator; the 6+ hex-char requirement keeps prose like "run the tests" inert.
const SHARED_ID_RE = /\b(run|task|session|wf)[\s_-]?([0-9a-f]{6,40})\b/gi;
// @mention — must not be part of an email address (no word char directly before @).
const MENTION_RE = /(?<![A-Za-z0-9._%+-])@([a-z0-9][\w-]{1,38})/gi;

// ── Pure helpers (DB-free tested in tests/test-memory-browser-view.js) ────

function dayToTs(day) {
  const t = Date.parse(`${day}T12:00:00Z`); // noon UTC avoids DST/TZ edges
  return Number.isFinite(t) ? t : null;
}

function utcDayOf(ts) {
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function cleanTitle(line) {
  return String(line || '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s*/, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s*[:—–-]?\s*/, '')
    .trim();
}

/**
 * Parse fetched memory files into dated timeline entries.
 *
 * Block rules (deterministic, order-stable):
 *   - a markdown heading OR a dated bullet starts a new block;
 *   - undated lines join the current block;
 *   - block day = dated-bullet capture > first YYYY-MM-DD inside a heading >
 *     daily-file name day > null;
 *   - entries without any derivable date fall back to the file's `modified`
 *     timestamp; files with neither yield ts=0 (sort last, "Unknown" bucket).
 *
 * @param {Array<{name:string,title?:string,modified?:string|number|Date,content:string}>} files
 * @returns {Array<{id,file,line,title,text,day,ts}>}
 */
export function extractMemoryEntries(files) {
  const list = Array.isArray(files) ? files : [];
  const entries = [];

  for (const f of list) {
    if (!f || typeof f.content !== 'string') continue;
    const name = String(f.name || 'memory.md');
    const fileDay = (DAY_RE.exec(name) || [])[1] || null;
    const modifiedTs = Date.parse(f.modified ?? '') || 0;

    let cur = null; // { startLine, day, lines[] }
    const flush = () => {
      if (!cur) return;
      const text = cur.lines.join('\n').trim();
      if (text) {
        const firstLine = cur.lines.find((l) => l.trim()) || '';
        const day = cur.day || fileDay;
        const ts = dayToTs(day) ?? modifiedTs;
        entries.push({
          id: `${name}#L${cur.startLine}`,
          file: name,
          line: cur.startLine,
          title: cleanTitle(firstLine).slice(0, 120) || name,
          text,
          day,
          ts,
        });
      }
      cur = null;
    };

    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bullet = DATED_BULLET_RE.exec(line);
      if (HEADING_RE.test(line)) {
        flush();
        const headingDay = /(\d{4}-\d{2}-\d{2})/.exec(line);
        cur = { startLine: i + 1, day: headingDay ? headingDay[1] : null, lines: [line] };
      } else if (bullet) {
        flush();
        cur = { startLine: i + 1, day: bullet[1], lines: [line] };
      } else {
        if (!cur) cur = { startLine: i + 1, day: null, lines: [] };
        cur.lines.push(line);
      }
    }
    flush();
  }

  // Newest first; stable tie-break on id so equal-ts blocks keep file order.
  entries.sort((a, b) => (b.ts - a.ts) || (a.id < b.id ? -1 : 1));
  return entries;
}

/**
 * Group sorted entries into day buckets (descending). Entries without any
 * usable date land in the trailing "Unknown" bucket.
 * @returns {Array<{day:string|null, entries:Array<object>}>}
 */
export function groupTimelineByDay(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const groups = [];
  let curDay;
  let curGroup = null;
  for (const e of list) {
    const day = e.day || (Number.isFinite(e.ts) && e.ts > 0 ? utcDayOf(e.ts) : null);
    if (curGroup === null || curDay !== day) {
      curDay = day;
      curGroup = { day, entries: [] };
      groups.push(curGroup);
    }
    curGroup.entries.push(e);
  }
  return groups;
}

/**
 * Cross-agent reference extraction.
 *
 * Signals:
 *   - @mentions (email-safe: no lookalike local-part matches);
 *   - known agent ids/names on word boundaries (case-insensitive);
 *   - shared run/task/session/wf identifiers (`run_1a2b3c`, `task-42f0ab`,
 *     `session ab12cd34`, `wf9a1b2c`).
 *
 * @param {string} text
 * @param {Array<{id?:string,name?:string}|string>} knownAgents roster entries or bare names
 * @returns {{agents:string[], ids:string[]}} agents lowercased+deduped, ids normalized `kind:hex`
 */
export function extractAgentRefs(text, knownAgents = []) {
  const s = typeof text === 'string' ? text : '';
  const agents = new Set();

  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(s))) agents.add(m[1].toLowerCase());

  const roster = (Array.isArray(knownAgents) ? knownAgents : [])
    .map((a) => (typeof a === 'string' ? a : (a && (a.name || a.id)) || ''))
    .filter((n) => n && n.length >= 3);
  for (const name of roster) {
    const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
    if (re.test(s)) agents.add(name.toLowerCase());
  }

  const ids = new Set();
  SHARED_ID_RE.lastIndex = 0;
  while ((m = SHARED_ID_RE.exec(s))) ids.add(`${m[1].toLowerCase()}:${m[2].toLowerCase()}`);

  return { agents: [...agents], ids: [...ids] };
}

/**
 * Filter timeline entries. `agent` matches extracted refs (case-insensitive).
 * `from`/`to` are inclusive YYYY-MM-DD bounds; entries without any derivable
 * date cannot be placed and are EXCLUDED once a range is set (documented,
 * pinned behavior — honest omission beats wrong placement).
 */
export function filterTimeline(entries, { agent, from, to } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const agentLc = typeof agent === 'string' ? agent.trim().toLowerCase() : '';
  const fromTs = from ? dayToTs(from) : null;
  const toTs = to ? dayToTs(to) : null;
  return list.filter((e) => {
    if (agentLc && !(e.refs || { agents: [] }).agents.includes(agentLc)) return false;
    if (fromTs != null || toTs != null) {
      if (e.ts == null || !Number.isFinite(e.ts)) return false;
      if (fromTs != null && e.ts < fromTs) return false;
      if (toTs != null && e.ts > toTs + 24 * 3600 * 1000 - 1) return false; // inclusive end-of-day
    }
    return true;
  });
}

/** Decorate entries with their cross-agent refs (mutates copies, returns new array). */
export function withAgentRefs(entries, knownAgents) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((e) => ({ ...e, refs: extractAgentRefs(`${e.title}\n${e.text}`, knownAgents) }));
}

// ── View ──────────────────────────────────────────────────────────────────

export async function renderMemoryBrowserView({ mountNode, params = {} }) {
  ensureNativeRoot(mountNode, 'memory-browser-view');
  mountNode.innerHTML = '';

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${globalThis.__DASHBOARD_AUTH_TOKEN__ || ''}`,
  });

  async function memFetch(path) {
    const res = await fetch(`${MEMORY_API_BASE}${path}`, { headers: authHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // ── State ──────────────────────────────────────
  let alive = true;
  let loadState = 'loading'; // loading | ready | unavailable | empty
  let errorMessage = '';
  let entries = [];       // decorated timeline entries (with refs)
  let searchHits = [];    // semantic search results
  let searchQuery = '';
  let mode = 'timeline';  // timeline | search
  let agentFilter = typeof params.agent === 'string' ? params.agent : '';
  let fromDate = '';
  let toDate = '';
  let knownAgents = [];
  let selectedId = null;
  let detailHtml = '';
  let flagCapped = false;
  let flagPartial = false;
  let rafHandle = 0;

  // ── Shell ──────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .mb-root { display:flex; flex-direction:column; height:100%; min-height:0; color:var(--win11-text); }
    .mb-header { padding:12px 16px; border-bottom:1px solid var(--win11-border); flex-shrink:0; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
    .mb-title { font-size:1.15rem; font-weight:600; display:flex; align-items:center; gap:8px; }
    .mb-searchbox { display:flex; gap:8px; flex:1; min-width:260px; max-width:520px; }
    .mb-input { flex:1; padding:8px 12px; border-radius:6px; border:1px solid var(--win11-border); background:var(--win11-surface); color:var(--win11-text); font-size:0.85rem; outline:none; }
    .mb-input:focus { border-color:var(--win11-accent); }
    .mb-btn { padding:8px 14px; border-radius:6px; border:1px solid var(--win11-border); background:var(--win11-surface-solid); color:var(--win11-text); cursor:pointer; font-size:0.82rem; white-space:nowrap; }
    .mb-btn:hover { background:var(--win11-surface-active); }
    .mb-btn.primary { background:var(--win11-accent); border-color:var(--win11-accent); color:#fff; }
    .mb-modebar { display:flex; gap:4px; padding:8px 16px 0; flex-shrink:0; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:8px; }
    .mb-modes { display:flex; gap:4px; }
    .mb-mode { padding:6px 14px; border-radius:6px 6px 0 0; border:1px solid transparent; background:transparent; color:var(--win11-text-secondary); cursor:pointer; font-size:0.82rem; }
    .mb-mode:hover { background:var(--win11-surface); color:var(--win11-text); }
    .mb-mode.active { background:var(--win11-surface); color:var(--win11-text); font-weight:600; border-bottom:2px solid var(--win11-accent); }
    .mb-filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding-bottom:6px; }
    .mb-filter-label { font-size:0.75rem; color:var(--win11-text-secondary); }
    .mb-banner { margin:8px 16px 0; padding:7px 12px; border-radius:6px; border:1px solid rgba(234,179,8,0.4); background:rgba(234,179,8,0.08); color:#eab308; font-size:0.78rem; flex-shrink:0; }
    .mb-layout { flex:1; display:flex; min-height:0; padding:12px 16px 16px; gap:12px; }
    .mb-rail { width:380px; flex:none; overflow-y:auto; overflow-x:hidden; position:relative; border:1px solid var(--win11-border); border-radius:8px; background:var(--win11-bg,#11151c); }
    .mb-rail-window { position:absolute; left:0; right:0; top:0; will-change:transform; }
    .mb-row { height:${ROW_HEIGHT}px; box-sizing:border-box; padding:8px 12px; border-bottom:1px solid var(--win11-border); cursor:pointer; overflow:hidden; transition:background 0.12s; }
    .mb-row:hover { background:var(--win11-surface); }
    .mb-row.selected { background:var(--win11-surface-active); box-shadow:inset 3px 0 0 var(--win11-accent); }
    .mb-row-title { font-size:0.84rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .mb-row-meta { margin-top:3px; font-size:0.72rem; color:var(--win11-text-secondary); display:flex; gap:8px; align-items:center; white-space:nowrap; overflow:hidden; }
    .mb-chip { display:inline-block; padding:1px 7px; border-radius:9px; font-size:0.68rem; background:rgba(96,205,255,0.12); color:var(--win11-accent); border:1px solid rgba(96,205,255,0.25); cursor:pointer; white-space:nowrap; }
    .mb-chip:hover { background:rgba(96,205,255,0.22); }
    .mb-chip.id { background:rgba(168,85,247,0.12); color:#a855f7; border-color:rgba(168,85,247,0.25); }
    .mb-detail { flex:1; min-width:0; overflow-y:auto; border:1px solid var(--win11-border); border-radius:8px; background:var(--win11-surface-solid); padding:16px; }
    .mb-detail h3 { margin:0 0 4px; font-size:1rem; }
    .mb-detail-meta { font-size:0.75rem; color:var(--win11-text-secondary); margin-bottom:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .mb-detail-text { white-space:pre-wrap; word-wrap:break-word; font-size:0.84rem; line-height:1.55; font-family:'SF Mono','Consolas',monospace; }
    .mb-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--win11-text-secondary); text-align:center; padding:32px; }
    .mb-state .big { font-size:2rem; }
    .mb-score { color:var(--win11-accent); }
  `;
  const root = document.createElement('div');
  root.className = 'native-view-root mb-root';
  root.appendChild(style);

  root.innerHTML = `
    <div class="mb-header">
      <div class="mb-title">🧠 Memory Browser</div>
      <div class="mb-searchbox">
        <input id="mb-search-input" class="mb-input" placeholder="Semantic search across all memory…" value="${escapeHtml(searchQuery)}">
        <button id="mb-search-btn" class="mb-btn primary">Search</button>
      </div>
      <button id="mb-refresh-btn" class="mb-btn">↻ Refresh</button>
    </div>
    <div class="mb-modebar">
      <div class="mb-modes">
        <div data-mode="timeline" class="mb-mode active">Timeline</div>
        <div data-mode="search" class="mb-mode">Search results</div>
      </div>
      <div class="mb-filters" id="mb-filters">
        <span class="mb-filter-label">Agent</span>
        <select id="mb-agent" class="mb-input" style="flex:0 0 170px;"><option value="">All agents</option></select>
        <span class="mb-filter-label">From</span>
        <input type="date" id="mb-from" class="mb-input" style="flex:0 0 140px;" value="${escapeHtml(fromDate)}">
        <span class="mb-filter-label">To</span>
        <input type="date" id="mb-to" class="mb-input" style="flex:0 0 140px;" value="${escapeHtml(toDate)}">
        <button id="mb-clear-btn" class="mb-btn">Clear</button>
      </div>
    </div>
    <div id="mb-banner-slot"></div>
    <div class="mb-layout">
      <div class="mb-rail" id="mb-rail"><div class="mb-rail-window" id="mb-rail-window"></div></div>
      <div class="mb-detail" id="mb-detail"></div>
    </div>
  `;
  mountNode.appendChild(root);

  const railEl = root.querySelector('#mb-rail');
  const railWindowEl = root.querySelector('#mb-rail-window');
  const detailEl = root.querySelector('#mb-detail');
  const bannerSlot = root.querySelector('#mb-banner-slot');
  const agentSel = root.querySelector('#mb-agent');
  const fromInput = root.querySelector('#mb-from');
  const toInput = root.querySelector('#mb-to');

  // ── Data loading ───────────────────────────────

  async function loadData() {
    loadState = 'loading';
    renderBody();
    try {
      const listResp = await memFetch('/list');
      const files = Array.isArray(listResp?.files) ? listResp.files : [];
      flagCapped = files.length > MAX_FILES;

      let roster = [];
      try {
        const agentsResp = await fetch('/api/agents', { headers: authHeaders() });
        if (agentsResp.ok) roster = (await agentsResp.json())?.agents || [];
      } catch (_) { /* roster optional — heuristic falls back to mentions */ }
      knownAgents = roster.map((a) => a?.name || a?.id).filter(Boolean);

      const slice = files.slice(0, MAX_FILES);
      const loaded = [];
      let failures = 0;
      for (let i = 0; i < slice.length; i += FETCH_BATCH) {
        if (!alive) return;
        const batch = slice.slice(i, i + FETCH_BATCH);
        const settled = await Promise.allSettled(
          batch.map((f) =>
            memFetch(`/file/${encodeURIComponent(f.name)}`).then((d) => ({ ...f, content: String(d.content || '') }))
          )
        );
        for (let j = 0; j < settled.length; j++) {
          if (settled[j].status === 'fulfilled') loaded.push(settled[j].value);
          else failures++;
        }
      }

      if (loaded.length === 0) {
        loadState = files.length === 0 ? 'empty' : 'unavailable';
        errorMessage = files.length === 0 ? '' : 'No memory file contents could be loaded.';
      } else {
        flagPartial = failures > 0;
        entries = withAgentRefs(extractMemoryEntries(loaded), knownAgents);
        loadState = 'ready';
        rebuildAgentOptions();
      }
    } catch (err) {
      loadState = 'unavailable';
      errorMessage = err.message || 'Memory API unreachable';
    }
    renderBody();
  }

  function rebuildAgentOptions() {
    const discovered = new Set(knownAgents.map((a) => String(a).toLowerCase()));
    for (const e of entries) for (const a of e.refs.agents) discovered.add(a);
    const current = agentFilter;
    agentSel.innerHTML =
      '<option value="">All agents</option>' +
      [...discovered].sort().map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    if (current && discovered.has(current.toLowerCase())) agentSel.value = current.toLowerCase();
    else if (current) agentFilter = ''; // deep-linked agent vanished — drop silently
  }

  async function performSearch(q) {
    searchQuery = q;
    if (!q.trim()) { searchHits = []; setMode('timeline'); return; }
    detailEl.innerHTML = '<div class="mb-state"><div>Searching…</div></div>';
    try {
      const data = await memFetch(`/search?q=${encodeURIComponent(q)}`);
      searchHits = Array.isArray(data?.hits) ? data.hits : [];
      setMode('search');
    } catch (err) {
      searchHits = [];
      detailEl.innerHTML = `<div class="mb-state"><div class="big">⚠️</div><div>Search failed: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  // ── Rail rendering (virtualized, fixed rows) ───

  function activeRows() {
    if (mode === 'search') {
      return searchHits.map((h, i) => ({
        key: `hit-${i}`,
        kind: 'hit',
        title: `${h.path || '(unknown path)'}${h.heading ? '#' + h.heading : ''}`,
        meta: `Relevance ${(Number(h.score) * 100 || 0).toFixed(1)}%`,
        scoreText: (h.snippet || h.context || '').slice(0, 160),
        hit: h,
      }));
    }
    const filtered = filterTimeline(entries, { agent: agentFilter, from: fromDate, to: toDate });
    return filtered.map((e) => ({
      key: e.id,
      kind: 'entry',
      title: e.title,
      meta: `${e.day || 'undated'} · ${e.file}:${e.line}`,
      agents: e.refs.agents.slice(0, 3),
      ids: e.refs.ids.slice(0, 2),
      entry: e,
    }));
  }

  function rowHtml(r, idx) {
    const sel = r.key === selectedId ? ' selected' : '';
    if (r.kind === 'hit') {
      return `<div class="mb-row${sel}" data-idx="${idx}">
        <div class="mb-row-title">${escapeHtml(r.title)}</div>
        <div class="mb-row-meta"><span>${escapeHtml(r.scoreText)}</span><span class="mb-score">${escapeHtml(r.meta)}</span></div>
      </div>`;
    }
    const chips = [
      ...(r.agents || []).map((a) => `<span class="mb-chip" data-agent="${escapeHtml(a)}">@${escapeHtml(a)}</span>`),
      ...(r.ids || []).map((id) => `<span class="mb-chip id" data-idref="${escapeHtml(id)}">${escapeHtml(id.replace(':', ' '))}</span>`),
    ].join('');
    return `<div class="mb-row${sel}" data-idx="${idx}">
      <div class="mb-row-title">${escapeHtml(r.title)}</div>
      <div class="mb-row-meta"><span>${escapeHtml(r.meta)}</span>${chips}</div>
    </div>`;
  }

  function renderRail() {
    if (loadState !== 'ready') return;
    const rows = activeRows();
    railEl.style.display = '';
    railWindowEl.style.height = `${rows.length * ROW_HEIGHT}px`;
    const { start, end } = visibleWindow({
      total: rows.length,
      viewport: railEl.clientHeight,
      scrollTop: railEl.scrollTop,
      rowHeight: ROW_HEIGHT,
      overscan: RAIL_OVERSCAN,
    });
    railWindowEl.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    railWindowEl.innerHTML = rows.slice(start, end).map((r, i) => rowHtml(r, start + i)).join('');
  }

  function renderBanners() {
    const bits = [];
    if (flagCapped) bits.push(`Showing the latest ${MAX_FILES} files (older files exist but are not parsed).`);
    if (flagPartial) bits.push('Some memory files could not be loaded — timeline shows what did.');
    bannerSlot.innerHTML = bits.length
      ? `<div class="mb-banner">⚠ ${bits.map(escapeHtml).join(' ')}</div>`
      : '';
  }

  function renderDetail() {
    if (mode === 'search' && searchQuery && searchHits.length === 0) {
      detailEl.innerHTML = `<div class="mb-state"><div class="big">🔍</div><div>No results for “${escapeHtml(searchQuery)}”.</div></div>`;
      return;
    }
    if (!selectedId) {
      detailEl.innerHTML = '<div class="mb-state"><div class="big">🧠</div><div>Select a memory to read it here.<br>Click an agent chip to follow a cross-agent link.</div></div>';
      return;
    }
    const e = entries.find((x) => x.id === selectedId);
    if (!e) { detailEl.innerHTML = '<div class="mb-state"><div>Entry no longer available.</div></div>'; return; }
    const chips = [
      ...e.refs.agents.map((a) => `<span class="mb-chip" data-agent="${escapeHtml(a)}">@${escapeHtml(a)}</span>`),
      ...e.refs.ids.map((id) => `<span class="mb-chip id" data-idref="${escapeHtml(id)}">${escapeHtml(id)}</span>`),
    ].join(' ');
    detailEl.innerHTML = `
      <h3>${escapeHtml(e.title)}</h3>
      <div class="mb-detail-meta">
        <span>${escapeHtml(e.day || 'undated')}</span>
        <span>${escapeHtml(e.file)}:${e.line}</span>
        ${chips}
        <button id="mb-open-file" class="mb-btn" style="margin-left:auto;">Open full file</button>
      </div>
      <div class="mb-detail-text">${escapeHtml(e.text)}</div>
    `;
    detailEl.querySelector('#mb-open-file').addEventListener('click', () => openFullFile(e.file));
  }

  async function openFullFile(name) {
    detailEl.innerHTML = '<div class="mb-state"><div>Loading file…</div></div>';
    try {
      const d = await memFetch(`/file/${encodeURIComponent(name)}`);
      detailEl.innerHTML = `
        <h3>${escapeHtml(d.name || name)}</h3>
        <div class="mb-detail-meta"><button id="mb-back-entry" class="mb-btn">← Back to entry</button></div>
        <div class="mb-detail-text">${escapeHtml(String(d.content || ''))}</div>
      `;
      detailEl.querySelector('#mb-back-entry').addEventListener('click', () => renderDetail());
    } catch (err) {
      detailEl.innerHTML = `<div class="mb-state"><div class="big">⚠️</div><div>Could not load ${escapeHtml(name)}: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  function renderBody() {
    renderBanners();
    if (loadState === 'loading') {
      railEl.style.display = 'none';
      detailEl.innerHTML = '<div class="mb-state"><div>Loading memories…</div></div>';
      return;
    }
    if (loadState === 'unavailable') {
      railEl.style.display = 'none';
      detailEl.innerHTML = `<div class="mb-state"><div class="big">📡</div><div><strong>Memory API unavailable</strong><br>${escapeHtml(errorMessage)}</div><button id="mb-retry-btn" class="mb-btn primary">Retry</button></div>`;
      detailEl.querySelector('#mb-retry-btn').addEventListener('click', loadData);
      return;
    }
    if (loadState === 'empty') {
      railEl.style.display = 'none';
      detailEl.innerHTML = '<div class="mb-state"><div class="big">🗂️</div><div>No memory files yet.<br>Daily notes appear here as agents work.</div></div>';
      return;
    }
    railEl.style.display = '';
    renderRail();
    renderDetail();
  }

  function setMode(m) {
    mode = m;
    root.querySelectorAll('.mb-mode').forEach((el) => el.classList.toggle('active', el.dataset.mode === m));
    selectedId = null;
    railEl.scrollTop = 0;
    renderRail();
    renderDetail();
  }

  function applyFilters({ resetScroll = true } = {}) {
    agentFilter = agentSel.value;
    fromDate = fromInput.value;
    toDate = toInput.value;
    if (resetScroll) railEl.scrollTop = 0;
    if (loadState === 'ready') { renderRail(); renderDetail(); }
  }

  // ── Events ─────────────────────────────────────

  railEl.addEventListener('scroll', () => {
    if (rafHandle || loadState !== 'ready') return;
    rafHandle = requestAnimationFrame(() => { rafHandle = 0; try { renderRail(); } catch (_) {} });
  });

  railEl.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.mb-chip[data-agent]');
    if (chip) {
      ev.stopPropagation();
      agentSel.value = chip.dataset.agent.toLowerCase();
      setMode('timeline');
      applyFilters();
      return;
    }
    const row = ev.target.closest('.mb-row');
    if (!row) return;
    const rows = activeRows();
    const r = rows[Number(row.dataset.idx)];
    if (!r) return;
    selectedId = r.key;
    if (r.kind === 'hit') {
      const filename = String(r.hit.path || '').split('/').pop();
      if (filename && filename.endsWith('.md')) openFullFile(filename);
      else renderDetail();
      row.parentElement.querySelectorAll('.mb-row.selected').forEach((el) => el.classList.remove('selected'));
      row.classList.add('selected');
    } else {
      renderRail();
      renderDetail();
    }
  });

  root.querySelector('#mb-search-btn').addEventListener('click', () => {
    performSearch(root.querySelector('#mb-search-input').value.trim());
  });
  root.querySelector('#mb-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch(e.target.value.trim());
  });
  root.querySelector('#mb-refresh-btn').addEventListener('click', loadData);
  root.querySelectorAll('.mb-mode').forEach((el) => el.addEventListener('click', () => setMode(el.dataset.mode)));
  agentSel.addEventListener('change', () => applyFilters());
  fromInput.addEventListener('change', () => applyFilters());
  toInput.addEventListener('change', () => applyFilters());
  root.querySelector('#mb-clear-btn').addEventListener('click', () => {
    agentSel.value = ''; fromInput.value = ''; toInput.value = '';
    applyFilters();
  });

  // Deep-link: /?view=memory-browser&query=... pre-fills semantic search.
  if (params.query) {
    root.querySelector('#mb-search-input').value = params.query;
    performSearch(params.query);
  }

  await loadData();

  return () => {
    alive = false;
    if (rafHandle) cancelAnimationFrame(rafHandle);
  };
}

export default renderMemoryBrowserView;
