/**
 * Live Agent Console view — terminal-style window attached to a running agent
 * session (docs/briefs/live-console.md).
 *
 * Read-only and attach-only: pick an agent → pick a session → a scrolling
 * stream of command output lines, assistant text, and inline tool-call badges
 * as it happens. Fed by GET /api/console/stream (lib/gateway-console-feed.js).
 *
 * Rendering: plain DOM append with a capped 2000-line ring buffer, appends
 * coalesced to one flush per animation frame via DocumentFragment. No
 * virtualization on purpose — the cap keeps the DOM tiny and preserves native
 * Ctrl+F / text selection.
 *
 * Zero-throw surface: every event handler and DOM write is guarded; a bad
 * frame degrades into a skipped line, never an exception.
 */

import { ensureNativeRoot, escapeHtml } from './helpers.mjs';

const RING_CAP = 2000;
const PIN_THRESHOLD_PX = 24;
const REARM_POLL_MS = 30000;

// ── Pure helpers (unit-tested in tests/test-console-feed.js) ─────────────

/**
 * Bounded FIFO ring of rendered lines. Oldest entries are evicted (and
 * returned so the caller can drop their DOM nodes). Pure data structure —
 * no DOM access — so DB-free tests can exercise the cap directly.
 * @param {number} cap
 */
export function createLineRing(cap = RING_CAP) {
  const lines = [];
  return {
    cap,
    get size() { return lines.length; },
    get lines() { return lines; },
    /**
     * @param {*} line
     * @returns {*} the evicted oldest line, or null when under cap
     */
    push(line) {
      lines.push(line);
      if (lines.length > cap) return lines.shift();
      return null;
    },
    clear() { lines.length = 0; },
  };
}

/**
 * Coalesce many small appends into one flush per scheduled tick (rAF in the
 * browser). `schedule` is injectable so tests can drive ticks manually.
 * The flush callback receives the batch array (already drained); a throwing
 * flush is caught — coalescing must never throw.
 * @param {(batch: Array<*>) => void} flush
 * @param {(cb: () => void) => void} [schedule]
 */
export function coalesceAppends(flush, schedule) {
  const sched = schedule || (typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16));
  let pending = [];
  let scheduled = false;
  const run = () => {
    scheduled = false;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;
    try { flush(batch); } catch (_) { /* zero-throw: drop the bad batch */ }
  };
  return {
    push(item) {
      pending.push(item);
      if (!scheduled) {
        scheduled = true;
        sched(run);
      }
    },
    /** Flush whatever is queued right now (used on pause-resume + teardown). */
    flushNow() { run(); },
    get pendingCount() { return pending.length; },
  };
}

/**
 * Badge tone for a tool-end frame: exitCode 0 → good (green), non-zero → bad
 * (red), absent exitCode falls back to a gray status word.
 * @param {number|null} exitCode
 * @returns {'good'|'bad'|'neutral'}
 */
export function exitTone(exitCode) {
  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
    return exitCode === 0 ? 'good' : 'bad';
  }
  return 'neutral';
}

/**
 * Client-side per-session seq gate (brief §3.3): duplicates and regressions
 * are dropped, gaps are reported once. Missing/invalid seq fails open.
 * @param {number|null} lastSeq
 * @param {*} seq
 * @returns {{forward: boolean, gap: boolean}} gap=true exactly when seq jumps
 *   past lastSeq+1 (caller renders ONE skip marker, never a refetch)
 */
export function seqGate(lastSeq, seq) {
  const n = Number(seq);
  if (!Number.isFinite(n)) return { forward: true, gap: false };
  if (lastSeq === null || lastSeq === undefined) return { forward: true, gap: false };
  if (n <= lastSeq) return { forward: false, gap: false };
  return { forward: true, gap: n > lastSeq + 1 };
}

// ── View ──────────────────────────────────────────────────────────────────

export async function renderConsoleView({ mountNode, api, params = {} }) {
  ensureNativeRoot(mountNode, 'console-view-root');
  mountNode.innerHTML = '';

  // ── State ──────────────────────────────────────
  let agents = [];
  let sessions = [];
  let selectedAgentId = typeof params.agent === 'string' ? params.agent : 'main';
  let attachedKey = null;            // sessionKey currently streamed
  let es = null;                     // EventSource
  let alive = true;                  // teardown flag
  let paused = false;
  let pinned = true;                 // autoscroll pinned to bottom
  let hiddenCount = 0;               // lines appended while unpinned
  let lastSeq = null;                // client-side dedupe gate
  let lastRunId = null;
  let ended = false;                 // console:end received
  let idleBannerKind = null;         // 'idle' | 'bridge' | 'unsubscribed' | null
  let rearmTimer = null;
  let rearmAgentId = null;
  let idleAt = 0;
  let currentAssistantEl = null;     // growing assistant paragraph
  let attachedStamp = null;

  const ring = createLineRing(RING_CAP);
  const pausedBuffer = [];           // raw frames held while paused (capped)

  // ── Styles ─────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .cl-layout { display:flex; flex-direction:column; height:100%; background:#0d1117; color:#c9d1d9;
      font-family:'Cascadia Code','Consolas',monospace; font-size:0.8rem; position:relative; }
    .cl-header {
      display:flex; align-items:center; gap:8px; padding:8px 12px;
      background:var(--win11-surface-solid,#16213e); border-bottom:1px solid var(--win11-border);
      font-family:var(--win11-font,'Segoe UI',sans-serif); font-size:0.8rem; flex-wrap:wrap;
    }
    .cl-title { font-weight:600; display:flex; align-items:center; gap:6px; }
    .cl-select {
      padding:3px 8px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.75rem; max-width:220px;
    }
    .cl-btn {
      padding:3px 10px; border-radius:4px; border:1px solid var(--win11-border);
      background:var(--win11-surface); color:var(--win11-text); font-size:0.75rem; cursor:pointer;
    }
    .cl-btn:hover { background:var(--win11-surface-active,rgba(255,255,255,0.06)); }
    .cl-live { font-weight:600; white-space:nowrap; }
    .cl-live.on { color:#22c55e; }
    .cl-live.off { color:var(--win11-text-tertiary,#555); }
    .cl-banner {
      padding:6px 12px; font-family:var(--win11-font,'Segoe UI',sans-serif); font-size:0.78rem;
      display:none; align-items:center; gap:10px; border-bottom:1px solid transparent;
    }
    .cl-banner.show { display:flex; }
    .cl-banner.idle { background:rgba(234,179,8,0.12); color:#eab308; border-color:rgba(234,179,8,0.3); }
    .cl-banner.bridge { background:rgba(251,146,60,0.15); color:#fb923c; border-color:rgba(251,146,60,0.35); }
    .cl-banner.unsubscribed { background:rgba(148,163,184,0.12); color:#94a3b8; border-color:rgba(148,163,184,0.3); }
    .cl-pane { flex:1; overflow-y:auto; overflow-x:hidden; padding:8px 12px; position:relative; outline:none; }
    .cl-line { white-space:pre-wrap; word-break:break-word; line-height:1.45; min-height:1em; }
    .cl-assistant { color:#e6edf3; background:rgba(96,205,255,0.05); border-left:2px solid rgba(96,205,255,0.4);
      padding:2px 8px; margin:3px 0; border-radius:3px; }
    .cl-output { color:#8b949e; }
    .cl-divider { color:#55607080; font-size:0.72rem; margin:6px 0 2px; user-select:none; }
    .cl-gap { color:#eab308; font-style:italic; }
    .cl-badge { display:inline-block; border-radius:4px; padding:0 6px; margin:1px 0; font-size:0.74rem; }
    .cl-badge-start { background:rgba(139,148,158,0.15); color:#8b949e; }
    .cl-badge-good { background:rgba(34,197,94,0.15); color:#22c55e; }
    .cl-badge-bad { background:rgba(239,68,68,0.18); color:#ef4444; }
    .cl-badge-neutral { background:rgba(148,163,184,0.15); color:#94a3b8; }
    .cl-jump {
      position:absolute; right:18px; bottom:48px; display:none; align-items:center; gap:6px;
      background:var(--win11-accent,#60cdff); color:#102a43; border:none; border-radius:14px;
      padding:5px 12px; font-size:0.75rem; cursor:pointer; z-index:5;
      font-family:var(--win11-font,'Segoe UI',sans-serif); box-shadow:0 2px 8px rgba(0,0,0,0.4);
    }
    .cl-jump.show { display:flex; }
    .cl-footer {
      display:flex; justify-content:space-between; gap:10px; padding:5px 12px;
      background:var(--win11-surface-solid,#16213e); border-top:1px solid var(--win11-border);
      font-family:var(--win11-font,'Segoe UI',sans-serif); font-size:0.7rem; color:var(--win11-text-secondary);
    }
  `;
  mountNode.appendChild(style);

  // ── DOM skeleton ───────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'cl-layout';
  layout.innerHTML = `
    <div class="cl-header">
      <span class="cl-title">▶ Live Console</span>
      <select class="cl-select" data-cl="agent" title="Agent"></select>
      <select class="cl-select" data-cl="session" title="Session"></select>
      <span class="cl-live off" data-cl="live">○ idle</span>
      <button class="cl-btn" data-cl="pause" title="Freeze rendering; events keep buffering">⏸ Pause</button>
      <button class="cl-btn" data-cl="reconnect" title="Reattach to the selected session stream">⟳ Reconnect</button>
    </div>
    <div class="cl-banner" data-cl="banner"></div>
    <div class="cl-pane" data-cl="pane" tabindex="0"></div>
    <button class="cl-jump" data-cl="jump">↓ Jump now · 0</button>
    <div class="cl-footer">
      <span data-cl="foot-left">○ not attached</span>
      <span data-cl="foot-right">buffer 0/${RING_CAP} lines · scrollback drops oldest</span>
    </div>
  `;
  mountNode.appendChild(layout);

  const $ = (name) => layout.querySelector(`[data-cl="${name}"]`);
  const pane = $('pane');
  const liveEl = $('live');
  const bannerEl = $('banner');
  const jumpEl = $('jump');
  const agentSelect = $('agent');
  const sessionSelect = $('session');
  const pauseBtn = $('pause');
  const reconnectBtn = $('reconnect');
  const footLeft = $('foot-left');
  const footRight = $('foot-right');

  // ── Small utils ────────────────────────────────
  const nowClock = () => new Date().toTimeString().slice(0, 8);

  function setLive(text, on) {
    liveEl.textContent = text;
    liveEl.className = `cl-live ${on ? 'on' : 'off'}`;
  }

  function setFooter() {
    footRight.textContent = `buffer ${ring.size}/${RING_CAP} lines · scrollback drops oldest`;
    footLeft.textContent = ended
      ? `○ stream ended ${attachedStamp || ''}`.trim()
      : attachedKey
        ? `● attached ${attachedStamp || nowClock()}${paused ? ' · ⏸ paused' : ''}`
        : '○ not attached';
  }

  function showBanner(kind, html) {
    idleBannerKind = kind;
    bannerEl.className = `cl-banner show ${kind}`;
    bannerEl.innerHTML = html;
  }

  function clearBanner() {
    idleBannerKind = null;
    bannerEl.className = 'cl-banner';
    bannerEl.innerHTML = '';
  }

  // ── Ring + rendering ───────────────────────────
  const appendCoalescer = coalesceAppends((batch) => {
    if (!alive) return;
    const frag = document.createDocumentFragment();
    for (const el of batch) frag.appendChild(el);
    pane.appendChild(frag);
    if (pinned && !paused) pane.scrollTop = pane.scrollHeight;
  });

  function ringPush(el) {
    const evicted = ring.push(el);
    if (evicted && evicted.parentNode) evicted.remove();
    setFooter();
    if (!pinned) {
      hiddenCount += 1;
      jumpEl.textContent = `↓ Jump now · ${hiddenCount}`;
    }
  }

  function makeDivider(text) {
    const div = document.createElement('div');
    div.className = 'cl-line cl-divider';
    div.textContent = `── ${text} ${nowClock()} ──`;
    return div;
  }

  function closeAssistantBlock() { currentAssistantEl = null; }

  function buildLine(frame) {
    switch (frame.kind) {
      case 'divider': {
        closeAssistantBlock();
        return makeDivider(frame.text);
      }
      case 'text': {
        // Assistant deltas merge into one growing paragraph per turn.
        if (!currentAssistantEl || !currentAssistantEl.isConnected) {
          currentAssistantEl = document.createElement('div');
          currentAssistantEl.className = 'cl-line cl-assistant';
        }
        try { currentAssistantEl.appendChild(document.createTextNode(frame.delta)); } catch (_) {}
        return currentAssistantEl;
      }
      case 'tool-start': {
        closeAssistantBlock();
        const div = document.createElement('div');
        div.className = 'cl-line';
        const badge = document.createElement('span');
        badge.className = 'cl-badge cl-badge-start';
        const args = frame.argsPreview ? ` · ${frame.argsPreview}` : '';
        badge.innerHTML = `🔧 ${escapeHtml(frame.name || frame.title || 'tool')}${escapeHtml(args)}`;
        div.appendChild(badge);
        return div;
      }
      case 'tool-output': {
        closeAssistantBlock();
        const wrap = document.createDocumentFragment();
        const text = String(frame.chunk ?? '');
        const parts = text.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === '' && i === parts.length - 1) break;
          const div = document.createElement('div');
          div.className = 'cl-line cl-output';
          div.textContent = `${i === 0 ? '[stdout] ' : ''}${parts[i]}`;
          wrap.appendChild(div);
        }
        return wrap.childNodes.length === 1 ? wrap.firstChild : wrap;
      }
      case 'notice': {
        closeAssistantBlock();
        const div = document.createElement('div');
        div.className = 'cl-line cl-divider';
        div.textContent = String(frame.text ?? '');
        return div;
      }
      case 'tool-end': {
        closeAssistantBlock();
        const div = document.createElement('div');
        div.className = 'cl-line';
        const badge = document.createElement('span');
        const tone = exitTone(frame.exitCode);
        badge.className = `cl-badge cl-badge-${tone}`;
        const name = escapeHtml(frame.name || 'tool');
        const dur = Number.isFinite(frame.durationMs) ? ` · ${frame.durationMs}ms` : '';
        if (tone === 'neutral') {
          const statusWord = frame.status ? escapeHtml(String(frame.status)) : 'no result recorded';
          badge.innerHTML = `● ${name} · ${statusWord}${dur}`;
        } else {
          badge.innerHTML = `${tone === 'good' ? '✔' : '✖'} ${name} · exitCode ${frame.exitCode}${dur}`;
        }
        div.appendChild(badge);
        return div;
      }
      case 'gap': {
        closeAssistantBlock();
        const div = document.createElement('div');
        div.className = 'cl-line cl-gap';
        div.textContent = '⋯ skipped (gap)';
        return div;
      }
      default:
        return null;
    }
  }

  function renderFrame(frame) {
    const el = buildLine(frame);
    if (!el) return;
    ringPush(el);
    appendCoalescer.push(el);
  }

  // ── Pause / resume ─────────────────────────────
  function setPaused(next) {
    paused = next;
    pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (!paused) {
      // Flush ≤ cap frames in arrival order through the normal path.
      const buffered = pausedBuffer.splice(0, pausedBuffer.length);
      for (const frame of buffered) ingestFrame(frame, { bypassPause: true });
      appendCoalescer.flushNow();
    }
    setFooter();
  }

  // ── Frame ingestion (dedupe → render or park) ──
  function ingestFrame(frame, { bypassPause = false } = {}) {
    if (!alive) return;
    if ((paused && !bypassPause)) {
      // Cap the memory buffer too: drop-oldest, terminal semantics.
      pausedBuffer.push(frame);
      if (pausedBuffer.length > RING_CAP) pausedBuffer.shift();
      return;
    }
    renderFrame(frame);
  }

  function handleConsoleFrame(data, kind) {
    const gate = seqGate(lastSeq, data.seq);
    if (!gate.forward) return;
    if (gate.gap) {
      lastSeq = null; // resync: accept everything after the marker
      ingestFrame({ kind: 'gap' });
    }
    if (Number.isFinite(Number(data.seq))) lastSeq = Number(data.seq);
    if (data.runId) lastRunId = String(data.runId);
    updateLiveLabel();
    ingestFrame({ ...data, kind });
  }

  function updateLiveLabel() {
    if (ended) return;
    const runPrefix = lastRunId ? ` · run ${String(lastRunId).slice(0, 6)}…` : '';
    setLive(paused ? `⏸ paused${runPrefix}` : `● LIVE${runPrefix}`, !paused);
  }

  // ── Attach / detach ────────────────────────────
  function closeStream() {
    if (es) {
      try { es.close(); } catch (_) {}
      es = null;
    }
  }

  function attach(sessionKey, { dividerText = 'attached' } = {}) {
    if (!alive || !sessionKey) return;
    closeStream();
    stopRearm();
    attachedKey = sessionKey;
    ended = false;
    paused = false;
    pauseBtn.textContent = '⏸ Pause';
    lastSeq = null;
    lastRunId = null;
    hiddenCount = 0;
    jumpEl.classList.remove('show');
    attachedStamp = nowClock();
    clearBanner();
    ingestFrame({ kind: 'divider', text: dividerText });
    ingestFrame({ kind: 'notice', text: 'live-only from now — earlier output lives in Session Replay' });
    setFooter();

    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || '';
    try {
      es = new EventSource(`/api/console/stream?session=${encodeURIComponent(sessionKey)}&token=${encodeURIComponent(token)}`);
    } catch (err) {
      showBanner('bridge', `Console stream unavailable: ${escapeHtml(err?.message || 'unknown error')} — press ⟳ Reconnect`);
      return;
    }

    es.onopen = () => {
      if (!alive) return;
      ended = false;
      clearBanner();
      updateLiveLabel();
      setFooter();
    };

    es.onerror = () => {
      // EventSource retries automatically; surface state without throwing.
      if (!alive || ended) return;
      setLive('◌ reconnecting…', false);
    };

    const onText = (e) => { try { handleConsoleFrame(JSON.parse(e.data), 'text'); } catch (_) {} };
    const onToolStart = (e) => { try { handleConsoleFrame(JSON.parse(e.data), 'tool-start'); } catch (_) {} };
    const onToolOutput = (e) => { try { handleConsoleFrame(JSON.parse(e.data), 'tool-output'); } catch (_) {} };
    const onToolEnd = (e) => { try { handleConsoleFrame(JSON.parse(e.data), 'tool-end'); } catch (_) {} };
    const onResync = () => { try { ingestFrame({ kind: 'gap' }); } catch (_) {} };
    const onEnd = (e) => {
      try {
        const data = JSON.parse(e.data || '{}');
        endStream(data.reason || 'idle');
      } catch (_) { endStream('idle'); }
    };

    es.addEventListener('console:text', onText);
    es.addEventListener('console:tool-start', onToolStart);
    es.addEventListener('console:tool-output', onToolOutput);
    es.addEventListener('console:tool-end', onToolEnd);
    es.addEventListener('resync', onResync);
    es.addEventListener('console:end', onEnd);
    updateLiveLabel();
  }

  function endStream(reason) {
    ended = true;
    closeStream();
    setLive('○ idle — stream ended', false);
    setFooter();
    if (reason === 'bridge-disconnected') {
      showBanner('bridge',
        `⚠ dashboard lost the gateway feed — stream ended ${nowClock()}
         <button class="cl-btn" data-cl="reattach">⟳ Reattach</button>`);
    } else if (reason === 'unsubscribed') {
      showBanner('unsubscribed',
        `○ console feed disabled — no gateway configured (stream ended ${nowClock()})`);
    } else {
      idleAt = Date.now();
      showBanner('idle',
        `○ idle — stream ended ${nowClock()}
         <button class="cl-btn" data-cl="reattach">⟳ Reattach</button>`);
      startRearm();
    }
    const btn = bannerEl.querySelector('[data-cl="reattach"]');
    btn?.addEventListener('click', () => attach(attachedKey, { dividerText: 'reattached' }));
  }

  // ── Auto-rearm (idle only; bridge loss stays manual) ──
  function startRearm() {
    stopRearm();
    rearmAgentId = selectedAgentId;
    rearmTimer = setInterval(async () => {
      if (!alive || !attachedKey || !idleBannerKind || idleBannerKind !== 'idle') { stopRearm(); return; }
      try {
        const data = await apiGet(`/api/oc/sessions?agent=${encodeURIComponent(rearmAgentId)}`);
        const list = data.sessions || [];
        const match = list.find((s) => s.key === attachedKey || s.id === attachedKey);
        // Same session showed fresh activity since idle end → reattach.
        if (match && (match.updatedAt || 0) > idleAt) {
          attach(attachedKey, { dividerText: 'reattached' });
        }
      } catch (_) { /* polling failure keeps the banner up; retry next tick */ }
    }, REARM_POLL_MS);
    if (rearmTimer.unref) rearmTimer.unref();
  }

  function stopRearm() {
    if (rearmTimer) { clearInterval(rearmTimer); rearmTimer = null; }
  }

  // ── Picker data ────────────────────────────────
  async function apiGet(path) {
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__ || localStorage.getItem('dashboard_token') || '';
    const resp = await fetch(path, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async function loadAgents() {
    try {
      const data = await apiGet('/api/oc/agents');
      agents = (data.agents || []).filter((a) => (a.sessionCount || 0) > 0);
      agentSelect.innerHTML = '';
      for (const agent of agents) {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.textContent = `${agent.id} (${agent.sessionCount})`;
        if (agent.id === selectedAgentId) opt.selected = true;
        agentSelect.appendChild(opt);
      }
      if (!agents.some((a) => a.id === selectedAgentId) && agents.length > 0) {
        selectedAgentId = agents[0].id;
        agentSelect.value = selectedAgentId;
      }
    } catch (_) { /* picker stays empty; header still shows manual controls */ }
  }

  async function loadSessions() {
    try {
      const data = await apiGet(`/api/oc/sessions?agent=${encodeURIComponent(selectedAgentId)}`);
      sessions = data.sessions || [];
      // "Running now"-ish first: freshest sessions lead the list with ▶.
      const sorted = [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      sessionSelect.innerHTML = '';
      for (const s of sorted.slice(0, 50)) {
        const fresh = Date.now() - (s.updatedAt || 0) < 5 * 60 * 1000;
        const opt = document.createElement('option');
        opt.value = s.key || s.id;
        opt.textContent = `${fresh ? '▶ ' : ''}${s.id}${s.kind ? ` · ${s.kind}` : ''}`;
        sessionSelect.appendChild(opt);
      }
      // Deep-link params: auto-attach once.
      const want = params.session || null;
      if (want && !attachedKey) {
        const match = sorted.find((s) => s.key === want || s.id === want);
        if (match) {
          sessionSelect.value = match.key || match.id;
          attach(match.key || match.id);
          return;
        }
      }
      if (!attachedKey && sorted.length > 0) {
        sessionSelect.value = sorted[0].key || sorted[0].id;
      }
    } catch (_) { /* session list stays empty */ }
  }

  // ── Scroll pinning ─────────────────────────────
  function onScroll() {
    try {
      const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      const nowPinned = distance <= PIN_THRESHOLD_PX;
      if (nowPinned && !pinned) {
        pinned = true;
        hiddenCount = 0;
        jumpEl.classList.remove('show');
        pane.scrollTop = pane.scrollHeight;
      } else if (!nowPinned && pinned) {
        pinned = false;
      }
      // Show the pill only when there is something hidden behind it.
      if (!pinned && hiddenCount > 0) jumpEl.classList.add('show');
    } catch (_) {}
  }

  function jumpNow() {
    pinned = true;
    hiddenCount = 0;
    jumpEl.classList.remove('show');
    pane.scrollTop = pane.scrollHeight;
    pane.focus({ preventScroll: true });
  }

  function onKeyDown(e) {
    try {
      if (e.key === 'End') { e.preventDefault(); jumpNow(); }
      else if (e.key === 'Home') { e.preventDefault(); pane.scrollTop = 0; }
    } catch (_) {}
  }

  pane.addEventListener('scroll', onScroll);
  jumpEl.addEventListener('click', jumpNow);
  pane.addEventListener('keydown', onKeyDown);

  agentSelect.addEventListener('change', () => {
    selectedAgentId = agentSelect.value;
    loadSessions().catch(() => {});
  });
  sessionSelect.addEventListener('change', () => {
    attach(sessionSelect.value);
  });
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  reconnectBtn.addEventListener('click', () => {
    if (attachedKey) attach(attachedKey, { dividerText: 'reattached' });
  });

  // ── Boot ───────────────────────────────────────
  setFooter();
  await loadAgents();
  await loadSessions();

  // ── Teardown ───────────────────────────────────
  return function cleanup() {
    alive = false;
    closeStream();
    stopRearm();
    appendCoalescer.flushNow();
    pane.removeEventListener('scroll', onScroll);
    pane.removeEventListener('keydown', onKeyDown);
    try { style.remove(); } catch (_) {}
    try { layout.remove(); } catch (_) {}
    try { jumpEl.remove(); } catch (_) {}
  };
}

export default renderConsoleView;
