/**
 * Session Replay view — time-travel stepper over a persisted session transcript
 * (docs/briefs/session-replay.md, part 2; backend reader shipped in 49eef27).
 *
 * Pick agent → pick session → the transcript is fetched once through the
 * cursor-paginated GET /api/oc/sessions/:sessionId/events endpoint (read-only,
 * GET-only), then scrubbed entirely client-side. A horizontal scrubber + prev/
 * next stepper move a single integer index; the as-of-t pane re-renders the
 * cumulative chat transcript plus a current-step detail card (args in, result
 * out, exitCode badge from persisted toolResult.details). "Load full output"
 * fetches the one event on demand from GET /events/:line and caches it.
 *
 * Performance guardrail (brief AC5): virtualized event rail — only the visible
 * window of rows (plus overscan) exists in the DOM regardless of event count;
 * the chat pane renders a bounded tail. A 10k-event session stays under ~300
 * rendered rows. Plain DOM, no libraries.
 *
 * Zero-throw surface: missing transcript → named empty state; API errors →
 * error state with retry; huge sessions → chunked background loads with a
 * "loaded to here" boundary and honest partial/truncated/capped banners.
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

// ── Constants ─────────────────────────────────────────────────────────────

// Fixed rail row height (px) — the virtualization math depends on this.
const ROW_HEIGHT = 26;
// Extra rows rendered above/below the viewport so scrolling never shows gaps.
const RAIL_OVERSCAN = 10;
// Chat pane renders at most this many most-recent messages (DOM bound).
const CHAT_TAIL = 60;
// Per-request page size (server hard cap is EVENTS_MAX_LIMIT = 2000).
const PAGE_LIMIT = 2000;
// Client memory guardrail (brief R3): stop fetching beyond this many normalized
// events (~10 MB worst case at 400-char previews) and say so honestly.
const MAX_EVENTS = 20000;
// LRU-ish cap on cached full-output detail fetches (brief R3): each entry can
// hold an untruncated tool result; 50 keeps worst-case growth bounded while
// covering any realistic stepping session.
const DETAIL_CACHE_CAP = 50;

// ── Pure helpers (unit-tested DB-free in tests/test-session-replay-view.js) ──

/**
 * Cumulative as-of-t state for stepper index `i` (inclusive prefix [0..i]).
 * Pure: no DOM/fs/network. Clamps safely: i < 0 → empty state, i beyond the
 * end → full history, non-finite → empty state.
 *
 * Tool-call pairing follows append order: a tool_result flips `resolved` on
 * the first unresolved tool_call record carrying the same toolCallId; calls
 * with no result stay `resolved: false` ("no result recorded" is signal).
 *
 * @param {Array<object>} events - Normalized events from the /events endpoint
 * @param {number} i - Stepper index (inclusive)
 * @returns {{index: number, total: number, messages: Array, toolCalls: Array,
 *   lastModel: string|null, currentEvent: object|null}}
 */
export function computeStateAsOf(events, i) {
  const total = Array.isArray(events) ? events.length : 0;
  let index = Number.isFinite(i) ? Math.floor(i) : -1;
  if (index < 0) index = -1;
  if (index > total - 1) index = total - 1;

  const messages = [];
  const toolCalls = [];
  const byId = new Map();
  let lastModel = null;

  for (let k = 0; k <= index; k++) {
    const ev = events[k];
    if (!ev || typeof ev !== 'object') continue;
    switch (ev.kind) {
      case 'user_message':
        messages.push({ role: 'user', kind: 'text', text: ev.text || '', line: ev.line });
        break;
      case 'assistant_text':
        messages.push({ role: 'assistant', kind: 'text', text: ev.text || '', line: ev.line });
        break;
      case 'assistant_thinking':
        messages.push({ role: 'assistant', kind: 'thinking', text: ev.text || '', line: ev.line });
        break;
      case 'model_change':
        lastModel = ev.text || lastModel;
        break;
      case 'tool_call': {
        const rec = {
          toolCallId: ev.tool?.toolCallId || null,
          name: ev.tool?.name || null,
          argsPreview: ev.tool?.argsPreview ?? null,
          resultPreview: null,
          details: null,
          callLine: ev.line ?? null,
          resultLine: ev.tool?.resultLine ?? null,
          resolved: false,
        };
        toolCalls.push(rec);
        if (rec.toolCallId) byId.set(rec.toolCallId, rec);
        break;
      }
      case 'tool_result': {
        const payload = {
          resultPreview: ev.tool?.resultPreview ?? null,
          details: ev.tool?.details ?? null,
          resultLine: ev.line ?? null,
          resolved: true,
        };
        const id = ev.tool?.toolCallId || null;
        const rec = id ? byId.get(id) : null;
        if (rec) {
          Object.assign(rec, payload);
        } else {
          // Result without a seen call (page edge / aborted branch): keep it —
          // dropping results would silently falsify the tape.
          toolCalls.push({
            toolCallId: id, name: ev.tool?.name || null, argsPreview: null,
            callLine: null, ...payload,
          });
        }
        break;
      }
      default:
        break; // ticks (session_meta/compaction/other) carry no chat content
    }
  }

  return {
    index,
    total,
    messages,
    toolCalls,
    lastModel,
    currentEvent: index >= 0 ? events[index] : null,
  };
}

/**
 * Visible row window for the virtualized rail. Fixed row heights make the
 * math closed-form; `end` is exclusive. Falls back to rendering everything
 * when the geometry is degenerate (rowHeight ≤ 0) — correctness over speed.
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
 * Badge tone for a tool event: green on exitCode 0, red on any other finite
 * exitCode, gray (status word) when the tool carries no exitCode — read/write-
 * class tools report `details.status` instead (brief Q2).
 * @param {object|null} tool
 * @returns {'good'|'bad'|'neutral'}
 */
export function toolBadgeState(tool) {
  const code = tool?.details?.exitCode;
  if (Number.isFinite(code)) return code === 0 ? 'good' : 'bad';
  return 'neutral';
}

/**
 * Append one fetched page onto the accumulated event list, defensively
 * dropping any prefix that repeats lines already accepted (the server's
 * line-granular cursor makes overlap impossible in practice; this guards
 * against cursor regressions without ever splitting a line's event group —
 * same-line fan-out siblings arrive together and all pass the cut).
 * Pure: returns a new array.
 */
export function appendPage(loaded, incoming) {
  const base = Array.isArray(loaded) ? loaded : [];
  if (!Array.isArray(incoming) || incoming.length === 0) return base;
  const lastLine = base.length ? (Number(base[base.length - 1].line) || 0) : 0;
  let cut = 0;
  while (cut < incoming.length) {
    const ln = Number(incoming[cut]?.line);
    if (Number.isFinite(ln) && ln > lastLine) break;
    cut++;
  }
  return [...base, ...incoming.slice(cut)];
}

// ── View ──────────────────────────────────────────────────────────────────

export async function renderSessionReplayView({ mountNode, api, params = {} }) {
  ensureNativeRoot(mountNode, 'session-replay-view-root');
  mountNode.innerHTML = '';

  // ── State ──────────────────────────────────────
  let alive = true;
  let agents = [];
  let sessions = [];
  let selectedAgentId = typeof params.agent === 'string' ? params.agent : 'main';
  let selectedSessionId = null;
  let events = [];
  let stepIdx = -1;
  let loadState = 'idle'; // idle | loading | ready | error | notfound | empty
  let errorMessage = '';
  let flagPartial = false;
  let flagTruncated = false;
  let flagCapped = false;
  let fetchedAt = null;
  let loadingMore = false;
  let userMoved = false;   // operator stepped manually — stop auto-landing
  let rafHandle = 0;
  let abortCtl = null;
  const detailCache = new Map(); // line → { event, extraEvents }

  // ── Styles ─────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .sr-layout { display:flex; flex-direction:column; height:100%; min-height:0;
      background:var(--win11-bg,#11151c); color:var(--win11-text,#e6edf3);
      font-family:var(--win11-font,'Segoe UI',sans-serif); font-size:0.8rem; }
    .sr-header { display:flex; align-items:center; gap:8px; padding:8px 12px; flex-wrap:wrap;
      background:var(--win11-surface-solid,#16213e); border-bottom:1px solid var(--win11-border); }
    .sr-title { font-weight:600; white-space:nowrap; }
    .sr-select { padding:3px 8px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.75rem; max-width:230px; }
    .sr-btn { padding:3px 10px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.75rem; cursor:pointer; }
    .sr-btn:hover:not(:disabled) { background:var(--win11-surface-active,rgba(255,255,255,0.06)); }
    .sr-btn:disabled { opacity:0.4; cursor:default; }
    .sr-count { margin-left:auto; font-size:0.75rem; color:var(--win11-text-secondary,#9aa7b8); white-space:nowrap; }
    .sr-banner { display:none; padding:5px 12px; font-size:0.75rem; border-bottom:1px solid transparent; }
    .sr-banner.show { display:block; }
    .sr-banner.warn { background:rgba(234,179,8,0.12); color:#eab308; border-color:rgba(234,179,8,0.3); }
    .sr-banner.error { background:rgba(239,68,68,0.15); color:#ef4444; border-color:rgba(239,68,68,0.35); }
    .sr-main { flex:1; display:flex; min-height:0; }
    .sr-rail { width:270px; flex:none; overflow-y:auto; overflow-x:hidden; position:relative;
      border-right:1px solid var(--win11-border); background:rgba(0,0,0,0.15); outline:none; }
    .sr-spacer { position:relative; width:100%; }
    .sr-row { position:absolute; left:0; right:0; height:${ROW_HEIGHT}px; line-height:${ROW_HEIGHT}px;
      padding:0 10px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      font-size:0.74rem; color:var(--win11-text-secondary,#9aa7b8); box-sizing:border-box; }
    .sr-row:hover { background:rgba(255,255,255,0.05); }
    .sr-row.current { background:rgba(96,205,255,0.14); color:var(--win11-text,#e6edf3);
      box-shadow:inset 2px 0 0 var(--win11-accent,#60cdff); }
    .sr-row .sr-rowkind { margin-right:6px; }
    .sr-boundary { position:absolute; left:0; right:0; height:${ROW_HEIGHT}px; line-height:${ROW_HEIGHT}px;
      padding:0 10px; font-size:0.72rem; color:#eab308; font-style:italic; }
    .sr-right { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; }
    .sr-chat { flex:1.4; overflow-y:auto; padding:10px 14px; min-height:0; }
    .sr-more { text-align:center; color:var(--win11-text-tertiary,#55607080); font-size:0.72rem; margin:4px 0 10px; }
    .sr-bubble { max-width:88%; margin:0 0 8px; padding:6px 10px; border-radius:8px;
      white-space:pre-wrap; word-break:break-word; line-height:1.45; }
    .sr-bubble.user { margin-left:auto; background:rgba(96,205,255,0.10); border:1px solid rgba(96,205,255,0.25); }
    .sr-bubble.assistant { background:rgba(255,255,255,0.04); border:1px solid var(--win11-border); }
    .sr-bubble .sr-who { display:block; font-size:0.68rem; color:var(--win11-text-tertiary,#55607080); margin-bottom:2px; }
    .sr-thinking { margin:0 0 8px; max-width:88%; }
    .sr-thinking summary { cursor:pointer; color:var(--win11-text-tertiary,#55607080); font-size:0.72rem; }
    .sr-thinking .sr-bubble { margin-top:4px; opacity:0.75; font-style:italic; }
    .sr-detail { flex:1; overflow-y:auto; border-top:1px solid var(--win11-border);
      padding:8px 14px; min-height:0; background:rgba(0,0,0,0.12); }
    .sr-dhead { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px; }
    .sr-dtitle { font-weight:600; }
    .sr-dmeta { font-size:0.7rem; color:var(--win11-text-tertiary,#55607080); }
    .sr-badge { display:inline-block; border-radius:4px; padding:0 6px; font-size:0.72rem; }
    .sr-badge-good { background:rgba(34,197,94,0.15); color:#22c55e; }
    .sr-badge-bad { background:rgba(239,68,68,0.18); color:#ef4444; }
    .sr-badge-neutral { background:rgba(148,163,184,0.15); color:#94a3b8; }
    .sr-io { margin:6px 0; border:1px solid var(--win11-border); border-radius:6px; overflow:hidden; }
    .sr-io-head { display:flex; align-items:center; gap:6px; padding:4px 8px; cursor:pointer;
      background:rgba(255,255,255,0.03); font-size:0.72rem; color:var(--win11-text-secondary,#9aa7b8);
      white-space:nowrap; overflow:hidden; }
    .sr-io-head:hover { background:rgba(255,255,255,0.06); }
    .sr-io-head code { overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .sr-io-body { display:none; margin:0; padding:8px; max-height:180px; overflow:auto;
      white-space:pre-wrap; word-break:break-word; font-size:0.72rem; line-height:1.4;
      font-family:'Cascadia Code','Consolas',monospace; border-top:1px solid var(--win11-border); }
    .sr-io.open .sr-io-body { display:block; }
    .sr-io-foot { display:flex; gap:8px; align-items:center; padding:3px 8px; border-top:1px solid var(--win11-border); }
    .sr-loadbtn { font-size:0.68rem; padding:1px 8px; }
    .sr-loadnote { font-size:0.68rem; color:var(--win11-text-tertiary,#55607080); }
    .sr-state { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:10px; color:var(--win11-text-secondary,#9aa7b8); text-align:center; padding:24px; }
    .sr-state h3 { margin:0; color:var(--win11-text,#e6edf3); }
    .sr-footer { padding:6px 12px 8px; background:var(--win11-surface-solid,#16213e);
      border-top:1px solid var(--win11-border); }
    .sr-scrubber { width:100%; accent-color:var(--win11-accent,#60cdff); cursor:pointer; }
    .sr-flabels { display:flex; justify-content:space-between; gap:10px; margin-top:3px;
      font-size:0.68rem; color:var(--win11-text-secondary,#9aa7b8); }
  `;
  mountNode.appendChild(style);

  // ── DOM skeleton ───────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'sr-layout';
  layout.innerHTML = `
    <div class="sr-header">
      <span class="sr-title">⏪ Session Replay</span>
      <select class="sr-select" data-sr="agent" title="Agent"></select>
      <select class="sr-select" data-sr="session" title="Session"></select>
      <button class="sr-btn" data-sr="reload" title="Refetch the transcript from disk">⟳ Reload</button>
      <span class="sr-count" data-sr="count">no session</span>
    </div>
    <div class="sr-banner" data-sr="banner"></div>
    <div class="sr-main" data-sr="main">
      <div class="sr-state" data-sr="state">
        <h3>Pick a session to replay</h3>
        <div>Choose an agent and session above — the persisted transcript loads<br>
        once, then every scrub/step runs offline in memory.</div>
      </div>
      <div class="sr-rail" data-sr="rail" hidden></div>
      <div class="sr-right" data-sr="right" hidden>
        <div class="sr-chat" data-sr="chat"></div>
        <div class="sr-detail" data-sr="detail"></div>
      </div>
    </div>
    <div class="sr-footer" data-sr="footer" hidden>
      <input class="sr-scrubber" data-sr="scrubber" type="range" min="0" max="0" value="0" step="1" />
      <div class="sr-flabels">
        <span data-sr="foot-left">start</span>
        <span data-sr="foot-mid"></span>
        <span data-sr="foot-right"></span>
      </div>
    </div>
  `;
  mountNode.appendChild(layout);

  const $ = (name) => layout.querySelector(`[data-sr="${name}"]`);
  const agentSelect = $('agent');
  const sessionSelect = $('session');
  const reloadBtn = $('reload');
  const countEl = $('count');
  const bannerEl = $('banner');
  const mainEl = $('main');
  const stateEl = $('state');
  const railEl = $('rail');
  const spacerEl = document.createElement('div');
  spacerEl.className = 'sr-spacer';
  railEl.appendChild(spacerEl);
  const rightEl = $('right');
  const chatEl = $('chat');
  const detailEl = $('detail');
  const footerEl = $('footer');
  const scrubber = $('scrubber');
  const footLeft = $('foot-left');
  const footMid = $('foot-mid');
  const footRight = $('foot-right');

  // ── Small utils ────────────────────────────────
  const clockOf = (ms) => {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return '';
    try { return new Date(t).toTimeString().slice(0, 8); } catch (_) { return ''; }
  };

  const relTime = (ms) => {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  const oneLine = (text, max = 90) => {
    const s = String(text ?? '').replaceAll(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
  };

  async function apiGet(path, { signal } = {}) {
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || localStorage.getItem('dashboard_token') || '';
    const headers = { 'Authorization': `Bearer ${token}` };
    // Only attach a signal when the caller owns one — a stale aborted
    // controller from a previous transcript load must not kill picker calls.
    const opts = { headers, ...(signal ? { signal } : {}) };
    const resp = await fetch(path, opts);
    if (!resp.ok) {
      let body = null;
      try { body = await resp.json(); } catch (_) { /* non-JSON error body */ }
      const err = new Error(body?.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  // ── Banners / states ───────────────────────────
  function renderBanner() {
    const bits = [];
    if (flagPartial) bits.push('⚠ Transcript ends mid-event — session likely crashed or is still active.');
    if (flagTruncated) bits.push('⚠ Transcript larger than the server size cap — older history not loaded.');
    if (flagCapped) bits.push(`⚠ Showing the first ${MAX_EVENTS.toLocaleString()} events (session larger than the replay guardrail).`);
    if (bits.length) {
      bannerEl.className = 'sr-banner warn show';
      bannerEl.textContent = bits.join(' ');
    } else {
      bannerEl.className = 'sr-banner';
      bannerEl.textContent = '';
    }
  }

  function showError(message) {
    loadState = 'error';
    errorMessage = String(message || 'unknown error');
    mainEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sr-state';
    box.innerHTML = `
      <h3>Could not load the transcript</h3>
      <div>${escapeHtml(errorMessage)}</div>`;
    const retry = document.createElement('button');
    retry.className = 'sr-btn';
    retry.textContent = '⟳ Retry';
    retry.addEventListener('click', () => { if (selectedSessionId) openSession(selectedSessionId); });
    box.appendChild(retry);
    mainEl.appendChild(box);
    railEl.hidden = true;
    rightEl.hidden = true;
    footerEl.hidden = true;
    countEl.textContent = 'error';
  }

  function showNotFound(sessionId) {
    loadState = 'notfound';
    mainEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sr-state';
    box.innerHTML = `
      <h3>No transcript on disk</h3>
      <div>Session <code>${escapeHtml(sessionId)}</code> has no persisted .jsonl transcript<br>
      (unknown id, or the session never wrote history). Pick another session above.</div>`;
    mainEl.appendChild(box);
    railEl.hidden = true;
    rightEl.hidden = true;
    footerEl.hidden = true;
    countEl.textContent = 'not found';
  }

  function showEmpty() {
    loadState = 'empty';
    mainEl.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'sr-state';
    box.innerHTML = `
      <h3>Empty session</h3>
      <div>The transcript exists but contains no replayable events.</div>`;
    mainEl.appendChild(box);
    railEl.hidden = true;
    rightEl.hidden = true;
    footerEl.hidden = true;
    countEl.textContent = 'empty';
  }

  function showReplayPane() {
    // Rebuild main content in the ready layout (state box removed).
    if (!stateEl.parentNode) {
      mainEl.innerHTML = '';
      mainEl.appendChild(railEl);
      mainEl.appendChild(rightEl);
    }
    stateEl.hidden = true;
    railEl.hidden = false;
    rightEl.hidden = false;
    footerEl.hidden = false;
    loadState = 'ready';
  }

  // ── Rendering ──────────────────────────────────
  function scheduleRender() {
    if (rafHandle || !alive) return;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0;
      try { renderAll(); } catch (_) { /* zero-throw: a bad frame never kills the view */ }
    });
  }

  function kindGlyph(ev) {
    switch (ev.kind) {
      case 'user_message': return '👤';
      case 'assistant_text': return '🤖';
      case 'assistant_thinking': return '💭';
      case 'tool_call': return '🔧';
      case 'tool_result': return '↳';
      case 'model_change': return '⚙';
      case 'compaction': return '🗜';
      case 'session_meta': return '●';
      default: return '·';
    }
  }

  function rowText(ev) {
    switch (ev.kind) {
      case 'tool_call': return `${ev.tool?.name || 'tool'} · ${oneLine(ev.tool?.argsPreview, 60)}`;
      case 'tool_result': return `${ev.tool?.name || 'tool'} · ${oneLine(ev.tool?.resultPreview, 60)}`;
      case 'model_change':
      case 'compaction':
      case 'session_meta':
      case 'other': return oneLine(ev.text, 70) || ev.kind;
      default: return oneLine(ev.text, 90);
    }
  }

  function buildRow(ev, idx) {
    const row = document.createElement('div');
    row.className = 'sr-row' + (idx === stepIdx ? ' current' : '');
    row.style.top = `${idx * ROW_HEIGHT}px`;
    row.dataset.idx = String(idx);
    let badge = '';
    if (ev.kind === 'tool_call' || ev.kind === 'tool_result') {
      const tone = toolBadgeState(ev.tool);
      const mark = tone === 'good' ? '✔' : tone === 'bad' ? '✖' : '●';
      badge = ` <span class="sr-badge sr-badge-${tone}">${mark}</span>`;
    }
    row.innerHTML = `<span class="sr-rowkind">${kindGlyph(ev)}</span>${escapeHtml(rowText(ev))}${badge}`;
    return row;
  }

  function renderRail() {
    const total = events.length;
    spacerEl.style.height = `${total * ROW_HEIGHT}px`;
    const { start, end } = visibleWindow({
      total,
      viewport: railEl.clientHeight,
      scrollTop: railEl.scrollTop,
      rowHeight: ROW_HEIGHT,
    });
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.appendChild(buildRow(events[i], i));
    if (loadingMore) {
      const b = document.createElement('div');
      b.className = 'sr-boundary';
      b.style.top = `${total * ROW_HEIGHT}px`;
      b.textContent = '⏳ loaded to here — fetching remaining chunks…';
      frag.appendChild(b);
    }
    spacerEl.replaceChildren(frag);
  }

  function renderChat(state) {
    const frag = document.createDocumentFragment();
    const msgs = state.messages;
    const hidden = Math.max(0, msgs.length - CHAT_TAIL);
    if (hidden > 0) {
      const more = document.createElement('div');
      more.className = 'sr-more';
      more.textContent = `⋯ ${hidden.toLocaleString()} earlier message${hidden === 1 ? '' : 's'} below step ${state.index + 1}`;
      frag.appendChild(more);
    }
    const tail = msgs.slice(-CHAT_TAIL);
    for (const m of tail) {
      if (m.kind === 'thinking') {
        const det = document.createElement('details');
        det.className = 'sr-thinking';
        det.innerHTML = `<summary>💭 thinking</summary>`;
        const bubble = document.createElement('div');
        bubble.className = 'sr-bubble assistant';
        bubble.textContent = m.text || '(empty)';
        det.appendChild(bubble);
        frag.appendChild(det);
        continue;
      }
      const bubble = document.createElement('div');
      bubble.className = `sr-bubble ${m.role === 'user' ? 'user' : 'assistant'}`;
      const who = document.createElement('span');
      who.className = 'sr-who';
      who.textContent = m.role === 'user' ? '👤 You' : '🤖 Agent';
      bubble.appendChild(who);
      bubble.appendChild(document.createTextNode(m.text || '(empty)'));
      frag.appendChild(bubble);
    }
    if (msgs.length === 0) {
      const none = document.createElement('div');
      none.className = 'sr-more';
      none.textContent = stepIdx < 0 ? 'At the start — press → or drag the scrubber.' : 'No chat text up to this step.';
      frag.appendChild(none);
    }
    chatEl.replaceChildren(frag);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function ioBlock(label, body, { mono = true } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'sr-io';
    const head = document.createElement('div');
    head.className = 'sr-io-head';
    head.innerHTML = `<span>${label} ▸</span>`;
    const code = document.createElement('code');
    code.textContent = oneLine(body, 120) || '(empty)';
    head.appendChild(code);
    const pre = document.createElement('pre');
    pre.className = 'sr-io-body';
    pre.textContent = String(body ?? '');
    wrap.appendChild(head);
    wrap.appendChild(pre);
    head.addEventListener('click', () => wrap.classList.toggle('open'));
    return { wrap, pre };
  }

  function badgeHtml(tool, resolved) {
    if (!resolved) return '<span class="sr-badge sr-badge-neutral">⟳ no result recorded</span>';
    const tone = toolBadgeState(tool);
    const d = tool?.details || {};
    if (tone === 'neutral') {
      return `<span class="sr-badge sr-badge-neutral">● ${escapeHtml(String(d.status || 'completed'))}</span>`;
    }
    const mark = tone === 'good' ? '✔' : '✖';
    return `<span class="sr-badge sr-badge-${tone}">${mark} exitCode ${d.exitCode}</span>`;
  }

  function cacheGet(line) {
    if (!detailCache.has(line)) return null;
    const val = detailCache.get(line);
    detailCache.delete(line); // refresh recency
    detailCache.set(line, val);
    return val;
  }

  function cachePut(line, val) {
    detailCache.set(line, val);
    while (detailCache.size > DETAIL_CACHE_CAP) {
      const oldest = detailCache.keys().next().value;
      detailCache.delete(oldest);
    }
  }

  async function loadFullOutput(line, targets) {
    const cached = cacheGet(line);
    let detail = cached;
    if (!detail) {
      const data = await apiGet(
        `/api/oc/sessions/${encodeURIComponent(selectedSessionId)}/events/${line}?agent=${encodeURIComponent(selectedAgentId)}`
      );
      if (!data.found) throw new Error('Event not found');
      detail = { event: data.event, extraEvents: data.extraEvents || [] };
      cachePut(line, detail);
    }
    const tool = detail.event?.tool;
    for (const t of targets) {
      if (t.kind === 'args' && tool?.argsPreview != null) t.pre.textContent = tool.argsPreview;
      if (t.kind === 'result' && tool?.resultPreview != null) t.pre.textContent = tool.resultPreview;
      if (t.kind === 'text' && detail.event?.text != null) t.pre.textContent = detail.event.text;
      if (t.note) t.note.textContent = 'full output loaded';
    }
  }

  function renderDetail(ev) {
    const frag = document.createDocumentFragment();
    if (!ev) {
      const none = document.createElement('div');
      none.className = 'sr-more';
      none.textContent = 'Current step detail — press → to begin.';
      frag.appendChild(none);
      detailEl.replaceChildren(frag);
      return;
    }

    const head = document.createElement('div');
    head.className = 'sr-dhead';

    if (ev.kind === 'tool_call' || ev.kind === 'tool_result') {
      const tool = ev.tool || {};
      // Badge reflects the as-of state: a bare tool_call step shows pending
      // unless its result already appeared earlier (out-of-order tapes).
      const st = computeStateAsOf(events, stepIdx);
      const rec = (ev.tool?.toolCallId
        ? st.toolCalls.find((t) => t.toolCallId === ev.tool.toolCallId)
        : null) || null;
      head.innerHTML = `
        <span class="sr-dtitle">🔧 ${escapeHtml(tool.name || 'tool')}</span>
        <span class="sr-dmeta">${escapeHtml(String(tool.toolCallId || ''))}</span>
        ${badgeHtml(tool, rec ? rec.resolved : ev.kind === 'tool_result')}`;
      frag.appendChild(head);

      const meta = [];
      const d = rec?.details || tool.details || {};
      if (d.cwd) meta.push(`cwd ${d.cwd}`);
      if (Number.isFinite(d.durationMs)) meta.push(`${d.durationMs}ms`);
      if (d.exitSignal) meta.push(`signal ${d.exitSignal}`);
      if (d.exitReason) meta.push(String(d.exitReason));
      if (meta.length) {
        const m = document.createElement('div');
        m.className = 'sr-dmeta';
        m.textContent = meta.join(' · ');
        frag.appendChild(m);
      }

      const argsBody = rec?.argsPreview ?? tool.argsPreview ?? '(args unavailable)';
      const resBody = rec?.resolved
        ? (rec.resultPreview ?? tool.resultPreview ?? '(no output)')
        : 'no result recorded';
      const argIo = ioBlock('IN', argsBody);
      const resIo = ioBlock('OUT', resBody);
      frag.appendChild(argIo.wrap);
      frag.appendChild(resIo.wrap);

      const foot = document.createElement('div');
      foot.className = 'sr-io-foot';
      const btn = document.createElement('button');
      btn.className = 'sr-btn sr-loadbtn';
      btn.textContent = '⤓ load full output';
      const note = document.createElement('span');
      note.className = 'sr-loadnote';
      note.textContent = `fetches line ${ev.line} untruncated (cached)`;
      foot.appendChild(btn);
      foot.appendChild(note);
      frag.appendChild(foot);
      btn.addEventListener('click', () => {
        btn.disabled = true;
        loadFullOutput(ev.line, [
          { kind: 'args', pre: argIo.pre },
          { kind: 'result', pre: resIo.pre },
          { note },
        ]).catch((err) => {
          note.textContent = `load failed: ${err?.message || 'error'}`;
          btn.disabled = false;
        });
      });
    } else {
      const titles = {
        user_message: '👤 user message',
        assistant_text: '🤖 assistant',
        assistant_thinking: '💭 thinking',
        model_change: '⚙ model change',
        compaction: '🗜 compaction',
        session_meta: '● session meta',
        other: '· event',
      };
      head.innerHTML = `
        <span class="sr-dtitle">${titles[ev.kind] || 'event'}</span>
        <span class="sr-dmeta">line ${ev.line ?? '?'}</span>`;
      frag.appendChild(head);
      const io = ioBlock('BODY', ev.text ?? '(no text)');
      frag.appendChild(io.wrap);
      if (ev.line != null) {
        const foot = document.createElement('div');
        foot.className = 'sr-io-foot';
        const btn = document.createElement('button');
        btn.className = 'sr-btn sr-loadbtn';
        btn.textContent = '⤓ load full text';
        const note = document.createElement('span');
        note.className = 'sr-loadnote';
        note.textContent = 'fetches untruncated body (cached)';
        foot.appendChild(btn);
        foot.appendChild(note);
        frag.appendChild(foot);
        btn.addEventListener('click', () => {
          btn.disabled = true;
          loadFullOutput(ev.line, [{ kind: 'text', pre: io.pre, note }])
            .catch((err) => { note.textContent = `load failed: ${err?.message || 'error'}`; btn.disabled = false; });
        });
      }
    }
    detailEl.replaceChildren(frag);
  }

  function renderFooter() {
    const n = events.length;
    scrubber.max = String(Math.max(0, n - 1));
    scrubber.value = String(Math.min(Math.max(stepIdx, 0), Math.max(0, n - 1)));
    scrubber.disabled = n === 0;
    const cur = events[stepIdx];
    footLeft.textContent = `start${n ? ` · line ${events[0]?.line ?? '?'}` : ''}`;
    footMid.textContent = cur
      ? `step ${stepIdx + 1}/${n}${cur.ts ? ` · ${clockOf(cur.ts)}` : ''}`
      : `step 0/${n}`;
    const bits = [`${n.toLocaleString()} events`];
    if (fetchedAt) bits.push(`fetched ${clockOf(fetchedAt)}`);
    if (loadingMore) bits.push('loading more…');
    footRight.textContent = bits.join(' · ');
  }

  function renderCount() {
    countEl.textContent = events.length
      ? `step ${stepIdx + 1}/${events.length}`
      : 'no events';
  }

  function renderAll() {
    renderBanner();
    renderFooter();
    renderCount();
    if (loadState !== 'ready') return;
    const state = computeStateAsOf(events, stepIdx);
    renderRail();
    renderChat(state);
    renderDetail(state.currentEvent);
  }

  // ── Stepper ────────────────────────────────────
  function setStep(i) {
    const n = events.length;
    if (!n) return;
    userMoved = true;
    let next = Number.isFinite(i) ? Math.floor(i) : 0;
    if (next < 0) next = 0;
    if (next > n - 1) next = n - 1;
    stepIdx = next;
    // Keep the current row visible without fighting the scroll handler.
    const target = stepIdx * ROW_HEIGHT - railEl.clientHeight / 2 + ROW_HEIGHT / 2;
    const clamped = Math.max(0, Math.min(target, Math.max(0, n * ROW_HEIGHT - railEl.clientHeight)));
    if (Math.abs(railEl.scrollTop - clamped) > 1) railEl.scrollTop = clamped;
    scheduleRender();
  }

  // ── Transcript loading (chunked, read-only) ────
  function resetTranscriptState() {
    events = [];
    stepIdx = -1;
    flagPartial = false;
    flagTruncated = false;
    flagCapped = false;
    fetchedAt = null;
    loadingMore = false;
    detailCache.clear();
  }

  async function loadTranscript(agentId, sessionId) {
    abortCtl = new AbortController();
    resetTranscriptState();
    loadState = 'loading';
    mainEl.innerHTML = '';
    const waiting = document.createElement('div');
    waiting.className = 'sr-state';
    waiting.innerHTML = '<h3>Loading transcript…</h3><div data-sr="prog">fetching chunk 1…</div>';
    mainEl.appendChild(waiting);
    const prog = waiting.querySelector('[data-sr="prog"]');
    railEl.hidden = true;
    rightEl.hidden = true;
    footerEl.hidden = true;

    try {
      let afterLine = 0;
      let page = 0;
      for (;;) {
        if (!alive) return;
        page += 1;
        const data = await apiGet(
          `/api/oc/sessions/${encodeURIComponent(sessionId)}/events?agent=${encodeURIComponent(agentId)}&afterLine=${afterLine}&limit=${PAGE_LIMIT}`,
          { signal: abortCtl.signal }
        );
        if (data.notFound) { showNotFound(sessionId); return; }
        events = appendPage(events, data.events || []);
        flagPartial = flagPartial || !!data.partial;
        flagTruncated = flagTruncated || !!data.truncated;
        fetchedAt = Date.now();
        if (prog) prog.textContent = `loaded ${events.length.toLocaleString()} events…`;

        if (!data.hasMore || afterLine === data.nextAfterLine || events.length >= MAX_EVENTS) {
          if (events.length >= MAX_EVENTS && data.hasMore) flagCapped = true;
          break;
        }
        afterLine = data.nextAfterLine;
        loadingMore = true;
        if (loadState === 'ready') { renderBanner(); renderFooter(); renderCount(); }
        else {
          showReplayPane();
          if (!userMoved) stepIdx = Math.min(0, events.length - 1);
          renderAll();
        }
        // Yield to the event loop so paints land between chunks.
        await new Promise((r) => setTimeout(r, 0));
      }
      loadingMore = false;
      if (!events.length) { showEmpty(); return; }
      showReplayPane();
      if (!userMoved) stepIdx = events.length - 1; // land at newest like a chat app
      renderAll();
    } catch (err) {
      if (!alive || err?.name === 'AbortError') return;
      if (err?.status === 404) { showNotFound(sessionId); return; }
      showError(err?.message || 'transcript fetch failed');
    } finally {
      loadingMore = false;
    }
  }

  function openSession(sessionId) {
    if (!sessionId) return;
    selectedSessionId = sessionId;
    if (abortCtl) { try { abortCtl.abort(); } catch (_) {} }
    loadTranscript(selectedAgentId, sessionId);
  }

  // ── Pickers ────────────────────────────────────
  async function loadAgents() {
    try {
      const data = await apiGet('/api/oc/agents');
      agents = (data.agents || []).filter((a) => (a.sessionCount || 0) > 0);
    } catch (_) { agents = []; }
    agentSelect.replaceChildren();
    for (const a of agents) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.id} (${a.sessionCount})`;
      agentSelect.appendChild(opt);
    }
    if (agents.length && !agents.some((a) => a.id === selectedAgentId)) {
      selectedAgentId = agents[0].id;
    }
    if (agents.length) agentSelect.value = selectedAgentId;
  }

  async function loadSessions() {
    try {
      const data = await apiGet(`/api/oc/sessions?agent=${encodeURIComponent(selectedAgentId)}`);
      sessions = (data.sessions || []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (_) { sessions = []; }
    sessionSelect.replaceChildren();
    for (const s of sessions.slice(0, 200)) {
      const sid = s.sessionId || s.id;
      if (!sid) continue;
      const opt = document.createElement('option');
      opt.value = sid;
      opt.textContent = `${s.id || sid} · ${s.kind || 'session'} · ${relTime(s.updatedAt)}`;
      sessionSelect.appendChild(opt);
    }
  }

  // ── Keyboard (global; inputs handle their own arrows) ──
  function onKeyDown(e) {
    if (!alive || !events.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); setStep(stepIdx - 1); break;
      case 'ArrowRight': e.preventDefault(); setStep(stepIdx + 1); break;
      case 'Home': e.preventDefault(); setStep(0); break;
      case 'End': e.preventDefault(); setStep(events.length - 1); break;
      default: break;
    }
  }

  // ── Wiring ─────────────────────────────────────
  let railRaf = 0;
  railEl.addEventListener('scroll', () => {
    if (railRaf || loadState !== 'ready') return;
    railRaf = requestAnimationFrame(() => { railRaf = 0; try { renderRail(); } catch (_) {} });
  });

  scrubber.addEventListener('input', () => {
    const v = parseInt(scrubber.value, 10);
    if (Number.isFinite(v)) setStep(v);
  });

  agentSelect.addEventListener('change', async () => {
    selectedAgentId = agentSelect.value;
    await loadSessions();
  });

  sessionSelect.addEventListener('change', () => openSession(sessionSelect.value));

  reloadBtn.addEventListener('click', () => {
    if (selectedSessionId) openSession(selectedSessionId);
  });

  window.addEventListener('keydown', onKeyDown);

  // ── Boot ───────────────────────────────────────
  await loadAgents();
  await loadSessions();

  // Deep-link: /?view=session-replay&agent=X&session=Y opens the transcript.
  const wantSession = typeof params.session === 'string' ? params.session : null;
  if (wantSession && sessions.some((s) => (s.sessionId || s.id) === wantSession)) {
    sessionSelect.value = wantSession;
    openSession(wantSession);
  }

  // ── Teardown ───────────────────────────────────
  return function cleanup() {
    alive = false;
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
    if (railRaf) { cancelAnimationFrame(railRaf); railRaf = 0; }
    if (abortCtl) { try { abortCtl.abort(); } catch (_) {} }
    window.removeEventListener('keydown', onKeyDown);
    try { style.remove(); } catch (_) {}
    try { layout.remove(); } catch (_) {}
  };
}

export default renderSessionReplayView;
