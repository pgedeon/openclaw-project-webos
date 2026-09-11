/**
 * Conversation tab pure helpers (roadmap candidate "Task ↔ session conversation
 * binding", docs/briefs/task-session-binding.md §UX + UPGRADE_ROADMAP.md).
 *
 * Maps normalized replay events from GET /api/oc/sessions/:sessionId/events
 * (lib/session-jsonl-reader.js shape) into compact chat items for the embedded
 * conversation view inside the task detail Sessions section.
 *
 * PURE module: no fs, no network, no DOM — DB-free unit-testable
 * (tests/test-task-conversation.js). Rendering lives in tasks-view.mjs.
 */

// Initial fetch cap (~200 events) before the operator asks for more via the
// cursor-paged "load more" control. The server's own hard cap is 2000/page;
// this client cap keeps the task-detail embed light by design.
export const CONVERSATION_INITIAL_CAP = 200;

/**
 * Map one normalized event to a chat item, or null for content-less ticks
 * (session_meta / model_change / compaction / other carry no chat body).
 * Pure; never throws on malformed input.
 *
 * @param {object|null} ev - normalized event ({line, ts, kind, text?, tool?})
 * @returns {object|null} chat item or null
 */
export function eventToChatItem(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const line = Number.isFinite(ev.line) ? ev.line : null;
  const ts = Number.isFinite(ev.ts) ? ev.ts : null;

  switch (ev.kind) {
    case 'user_message':
      return { type: 'user', line, ts, text: typeof ev.text === 'string' ? ev.text : '' };

    case 'assistant_text':
      return { type: 'assistant', line, ts, text: typeof ev.text === 'string' ? ev.text : '' };

    case 'assistant_thinking':
      // Compact view: thinking bodies stay behind the Replay deep-link.
      return null;

    case 'tool_call': {
      const tool = ev.tool || {};
      let args = '';
      if (typeof tool.argsPreview === 'string' && tool.argsPreview) {
        try {
          const parsed = JSON.parse(tool.argsPreview);
          args = summarizeArgs(parsed);
        } catch (_) {
          args = oneLine(tool.argsPreview, 60);
        }
      }
      return {
        type: 'tool',
        phase: 'call',
        line,
        ts,
        name: typeof tool.name === 'string' ? tool.name : 'tool',
        args,
        exitCode: null,
        resolved: false,
      };
    }

    case 'tool_result': {
      const tool = ev.tool || {};
      const code = tool.details?.exitCode;
      return {
        type: 'tool',
        phase: 'result',
        line,
        ts,
        name: typeof tool.name === 'string' ? tool.name : 'tool',
        args: '',
        exitCode: Number.isFinite(code) ? code : null,
        resolved: true,
      };
    }

    default:
      return null; // ticks / unknown kinds render nothing here
  }
}

/**
 * Fold a page of events into the accumulated chat-item list:
 *   - drops non-chat ticks via eventToChatItem
 *   - MERGES a result into its matching open call item (same name, still
 *     unresolved, last of its kind) so one badge shows call+exitCode instead
 *     of two rows — same-line fan-out means a call and its text siblings share
 *     a line, but two calls never do.
 *   - defensively drops any incoming prefix repeating lines already accepted
 *     (same overlap guard as session-replay-view appendPage).
 * Pure: returns a new array.
 *
 * @param {Array<object>} items - accumulated chat items
 * @param {Array<object>} incomingEvents - next page of normalized events
 * @returns {{items: Array<object>, appended: number}}
 */
export function foldChatPage(items, incomingEvents) {
  const base = Array.isArray(items) ? items : [];
  const events = Array.isArray(incomingEvents) ? incomingEvents : [];
  const lastLine = base.length ? (Number(base[base.length - 1].line) || 0) : 0;

  let cut = 0;
  while (cut < events.length) {
    const ln = Number(events[cut]?.line);
    if (Number.isFinite(ln) && ln > lastLine) break;
    cut++;
  }

  const out = base.slice();
  let appended = 0;
  for (let i = cut; i < events.length; i++) {
    const item = eventToChatItem(events[i]);
    if (!item) continue;
    if (item.type === 'tool' && item.phase === 'result') {
      let merged = false;
      for (let k = out.length - 1; k >= 0; k--) {
        const prev = out[k];
        if (prev.type === 'tool' && prev.phase === 'call' && !prev.resolved && prev.name === item.name) {
          out[k] = { ...prev, exitCode: item.exitCode, resolved: true };
          merged = true;
          break;
        }
      }
      if (merged) continue;
    }
    out.push(item);
    appended++;
  }
  return { items: out, appended };
}

/**
 * Enforce the ~200-event display cap on an accumulated item list.
 * Returns the visible slice plus how many older items are held back; the UI
 * exposes those through explicit "load earlier" paging only (cap enforcement
 * is required even though virtualization is not).
 *
 * @param {Array<object>} items
 * @param {number} cap
 * @returns {{visible: Array<object>, hiddenOlder: number}}
 */
export function capChatItems(items, cap = CONVERSATION_INITIAL_CAP) {
  const list = Array.isArray(items) ? items : [];
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : CONVERSATION_INITIAL_CAP;
  if (list.length <= limit) return { visible: list.slice(), hiddenOlder: 0 };
  return { visible: list.slice(list.length - limit), hiddenOlder: list.length - limit };
}

// ── internal ────────────────────────────────────────────────────────────────

function oneLine(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Compact arg summary: first string-ish field of a parsed args object. */
function summarizeArgs(parsed) {
  if (parsed == null) return '';
  if (typeof parsed === 'string') return oneLine(parsed, 60);
  if (Array.isArray(parsed)) return oneLine(JSON.stringify(parsed), 60);
  if (typeof parsed === 'object') {
    const preferred = ['command', 'file_path', 'path', 'url', 'query', 'pattern', 'name', 'id'];
    for (const key of preferred) {
      if (typeof parsed[key] === 'string' && parsed[key]) return oneLine(parsed[key], 60);
    }
    const firstKey = Object.keys(parsed)[0];
    if (firstKey != null) return oneLine(`${firstKey}:${JSON.stringify(parsed[firstKey])}`, 60);
    return '';
  }
  return oneLine(String(parsed), 60);
}
