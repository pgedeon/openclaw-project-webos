/**
 * nl-parse.js — Natural-language command bar v1 deterministic grammar
 * (docs/briefs/nl-command-bar.md §4/§5; work order: lib/nl-parse.js).
 *
 * PURE function module: parseIntent(utterance, context) maps a plain-language
 * utterance onto either
 *   - a candidate ACTION ENVELOPE description ({kind, targetId?, params, slots})
 *     for one of the five gated catalog kinds, or
 *   - a QUERY-ONLY intent ({queryOnly:{type}}) answered inline from reads, or
 *   - an honest non-match ({unmatched:true, reason}).
 *
 * Hard properties (pinned by tests/test-nl-parse.js):
 *   - Query-verb precedence: an utterance starting with show/find/list/what/
 *     how/status/… NEVER maps to a mutating kind even when it contains one
 *     ("show me how to cancel runs" → find query). Brief §5 AC-SF4.
 *   - Query results structurally carry NO kind/targetId/params fields — the
 *     never-gate guarantee is a shape guarantee, not a runtime check (§6.1).
 *   - Batch ("cancel all failed runs") and temporal ("every day at 9…")
 *     utterances are REFUSED with named reasons (§6.6): one envelope = one
 *     target; scheduling belongs to the Cron view.
 *   - Flagship "spawn agent for X" parses to a real task.create envelope
 *     (title extracted from the utterance; roadmap review #3 candidate 2 /
 *     brief §9 Q1): creation is reversible (archive), so it rides the same
 *     LOW/NONE registry tier as task.assign. No extractable title → honest
 *     unmatched (degrades to search) — never a guessed envelope.
 *   - Unknown verbs/config-write verbs → unmatched. The parser never guesses
 *     an envelope; unmatched input degrades to normal palette search.
 *   - Zero I/O of any kind: no fetch, no timers, no DOM. A wrong interpretation
 *     can only ever render a preview the operator dismisses (misparse safety,
 *     §6.3) — execution authority lives entirely in action-client executeAction().
 *
 * Verb/synonym tables are DATA below. Every mutating row's kind is
 * cross-checked against lib/action-registry.js ACTION_KINDS at parse time when
 * running under node (browser builds skip the check; kind parity is pinned
 * DB-free in tests). Unknown kinds fall to unmatched rather than proposing an
 * action outside the registry.
 *
 * Dual-target loading without a build step (repo charter: no frameworks):
 * CommonJS `module.exports` under node (DB-free tests, server-side reuse),
 * `globalThis.NLParse` in the browser, where ES modules cannot import CJS and
 * the palette loads this file via dynamic import() of its served path.
 */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.NLParse = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // Registry cross-check (node only — browser has no require; parity is
  // pinned by tests so the browser path can trust the static table).
  let REGISTRY_KINDS = null;
  if (typeof module === 'object' && module !== null && module.exports && typeof require === 'function') {
    try {
      REGISTRY_KINDS = require('./action-registry').ACTION_KINDS || null;
    } catch (err) {
      REGISTRY_KINDS = null;
    }
  }

  // ── Verb/synonym tables (data, not code paths — brief §5) ──────

  const MUTATING_VERBS = Object.freeze({
    assign: Object.freeze(['assign', 'reassign', 'give']),
    dispatch: Object.freeze(['dispatch', 'run', 'start']),
    approve: Object.freeze(['approve']),
    reject: Object.freeze(['reject']),
    cancel: Object.freeze(['cancel', 'stop', 'kill', 'abort']),
    redispatch: Object.freeze(['retry', 'rerun', 'redispatch', 're-dispatch']),
    create: Object.freeze(['spawn', 'create', 'add', 'new']),
  });

  /** verb group → catalog kind (must exist in ACTION_CATALOG/ACTION_KINDS). */
  const VERB_KINDS = Object.freeze({
    assign: 'task.assign',
    dispatch: 'run.dispatch',
    approve: 'approval.decide',
    reject: 'approval.decide',
    cancel: 'run.cancel',
    redispatch: 'run.redispatch',
    create: 'task.create',
  });

  /**
   * Query-intent starters — PRECEDENCE RULE: an utterance beginning with one
   * of these never maps to a mutating kind (brief §5, pinned by AC-SF4).
   */
  const QUERY_STARTERS = Object.freeze([
    'show', 'find', 'list', 'what', 'whats', "what's", 'how', 'status',
    'search', 'which', 'count', 'am', 'is', 'are', 'display', 'any',
    // Noun-first query openers ("fleet status", "budget status",
    // "pending approvals", "failed runs") — none collide with a mutating
    // verb, so precedence stays intact.
    'fleet', 'budget', 'budgets', 'approval', 'approvals', 'pending',
    'failed', 'failures', 'errors',
  ]);

  // ── Refusal patterns (brief §6.6 named reasons) ────────────────

  /** Multi-target markers: one envelope = one target (one-click-actions §7). */
  const BATCH_RE = /\b(all|every|each|bulk|mass)\b/i;

  /** Temporal/scheduling markers → Cron view's job, refused with a pointer. */
  const TEMPORAL_RE = /\b(every\s+(day|week|month|hour|morning|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|schedule[d]?|recurring|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b)/i;

  // ── Small pure helpers ─────────────────────────────────────────

  function normalize(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function stripLead(text, ...prefixes) {
    let out = text;
    for (const p of prefixes) {
      const re = new RegExp(`^${p}\\s+`, 'i');
      if (re.test(out)) out = out.replace(re, '');
    }
    return out.trim();
  }

  function unquote(text) {
    const m = /^"([^"]*)"$/.exec(text.trim()) || /^'([^']*)'$/.exec(text.trim());
    if (m) return { text: m[1].trim(), quoted: true };
    return { text: text.trim(), quoted: false };
  }

  /**
   * Extract a run-id-looking token: run_<id> / run-<id> / UUID / short id
   * (≥4 id chars). Returns {targetId, rest} — targetId null when the text
   * holds only prose (resolution layer matches it against live runs).
   */
  function extractRunRef(text) {
    let m = /\brun[_-]([A-Za-z0-9][\w-]*)\b/.exec(text);
    if (m) return { targetId: `run_${m[1]}`, rest: text.replace(m[0], '').trim() };
    m = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i.exec(text);
    if (m) return { targetId: m[1], rest: text.replace(m[0], '').trim() };
    m = /^\s*#?([A-Za-z0-9][\w-]{3,})\s*$/.exec(text);
    if (m && !/\s/.test(m[1])) return { targetId: m[1], rest: '' };
    return { targetId: null, rest: text };
  }

  /** Task refs: "#<id>" prefix or quoted/prose title substring. */
  function extractTaskRef(text) {
    const idm = /#([\w-]+)/.exec(text);
    if (idm) {
      return {
        targetId: idm[1],
        taskRef: idm[0],
        quoted: false,
        rest: text.replace(idm[0], '').trim(),
      };
    }
    const u = unquote(text);
    return { targetId: null, taskRef: u.text, quoted: u.quoted, rest: u.text };
  }

  function unmatched(reason) {
    return { unmatched: true, reason };
  }

  function actionResult(kind, extra) {
    const res = Object.assign({ kind }, extra);
    if (REGISTRY_KINDS && !REGISTRY_KINDS.includes(kind)) {
      return unmatched('unknown_verb'); // registry cross-check at parse time (§5)
    }
    return res;
  }

  // ── Query classification (never gated — §5 query-only table) ───

  function classifyQuery(text) {
    if (/\bbudget\b|\bover\s+budget\b|\bspending?\b/.test(text)) {
      return { queryOnly: { type: 'budget_status' } };
    }
    if (/\bapprovals?\b/.test(text)) {
      return { queryOnly: { type: 'pending_approvals' } };
    }
    if (/\bfailed\b|\bfailures?\b|\bbroke[n]?\b|\berrors?\b/.test(text)) {
      return { queryOnly: { type: 'failed_runs' } };
    }
    if (/\brunning\b|\bfleet\b|\bactive\b|\bbusy\b|\bstatus\b/.test(text)) {
      return { queryOnly: { type: 'fleet_status' } };
    }
    // Generic find → degrades into the existing palette search pipeline.
    const q = stripLead(text, 'show(\\s+me)?', 'find', 'list', 'search(\\s+for)?', 'what', 'whats', "what's", 'which', 'any');
    return { queryOnly: { type: 'find' }, queryText: stripLead(q, 'is', 'are', 'to', 'status(\\s+of)?', 'how') };
  }

  // ── Mutating templates (brief §5 mapping table rows) ───────────

  function parseAssign(rest) {
    // "assign <task> to <agent>" / "give <task> to <agent>"
    const idx = rest.toLowerCase().lastIndexOf(' to ');
    if (idx === -1) return unmatched('missing_slot'); // no agent named
    const taskPart = unquote(rest.slice(0, idx).trim()).text;
    const agentName = rest.slice(idx + 4).trim();
    if (!taskPart || !agentName) return unmatched('missing_slot');
    const t = extractTaskRef(stripLead(taskPart, 'task'));
    return actionResult(VERB_KINDS.assign, {
      targetId: t.targetId || undefined,
      params: { owner: agentName },
      slots: { taskRef: t.taskRef, agentName, quoted: t.quoted },
      matchedVerb: 'assign',
    });
  }

  function parseDispatch(rest) {
    // "run <template> on <task>" / "dispatch <template> for <task>"
    const lower = rest.toLowerCase();
    const sepIdx = Math.max(
      lower.lastIndexOf(' on '),
      lower.lastIndexOf(' for ')
    );
    if (sepIdx === -1) return unmatched('missing_slot'); // no task target
    const templatePart = unquote(rest.slice(0, sepIdx).trim()).text;
    const taskPart = rest.slice(sepIdx + 4).trim();
    if (!templatePart || !taskPart) return unmatched('missing_slot');
    const template = stripLead(templatePart, 'the', 'workflow');
    const t = extractTaskRef(stripLead(taskPart, 'task'));
    if (!template) return unmatched('missing_slot');
    return actionResult(VERB_KINDS.dispatch, {
      targetId: t.targetId || undefined,
      params: { template },
      slots: { taskRef: t.taskRef, templateName: template, quoted: t.quoted },
      matchedVerb: 'dispatch',
    });
  }

  function parseApprovalDecide(verb, rest) {
    // "approve <approval>" / "reject <approval>"
    const ref = unquote(stripLead(rest, 'approval', 'the', 'request')).text;
    if (!ref) return unmatched('missing_slot');
    return actionResult(VERB_KINDS[verb], {
      params: { decision: verb === 'approve' ? 'approved' : 'rejected' },
      slots: { approvalRef: ref },
      matchedVerb: verb,
    });
  }

  function parseRunAction(kind, matchedVerb, rest) {
    // "cancel run <ref>" / "retry run <ref>" family
    const stripped = stripLead(rest, 'run', 'the', 'workflow run');
    if (!stripped) return unmatched('missing_target');
    const r = extractRunRef(stripped);
    const runRef = (r.rest || stripped).trim();
    if (!runRef && !r.targetId) return unmatched('missing_target');
    return actionResult(kind, {
      targetId: r.targetId || undefined,
      params: {},
      slots: { runRef: runRef || r.targetId },
      matchedVerb,
    });
  }

  /**
   * Flagship template (brief §5, Q1): "spawn agent for <X>", "create task
   * for <X>", "add agent for \"<X>\"", "new task <X>". The title is the
   * remainder after the noun — quoted titles win verbatim, trailing sentence
   * punctuation is trimmed, everything else is kept as spoken (no guessing).
   * Project routing is NOT parsed: the resolver picks the default project
   * exactly like storage.createTask's own fallback. No title → missing_slot
   * (degrades to search); no task/agent noun → null (unknown_verb path).
   */
  function parseTaskCreate(rest) {
    const m = /^(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(task|agent)\b\s*(.*)$/i.exec(rest);
    if (!m) return null;
    const noun = m[1].toLowerCase();
    const tail = m[2].trim();
    const sep = /^(?:for|to)\s+(.*)$/i.exec(tail) || /^[:—–-]\s*(.*)$/.exec(tail);
    const u = unquote(sep ? sep[1] : tail);
    const title = u.text.replace(/[.!?]+$/, '').trim();
    if (!title) return unmatched('missing_slot'); // honesty: never invent a title
    return actionResult(VERB_KINDS.create, {
      params: { title },
      slots: { title, noun },
      matchedVerb: 'create',
    });
  }

  // ── Entry point ────────────────────────────────────────────────

  /**
   * Parse one standalone utterance (no conversation memory — brief non-goal).
   *
   * @param {string} utterance raw input text
   * @param {object} [context] optional {view} — reserved for future slot
   *   hints; parsing stays standalone regardless.
   * @returns {object} one of
   *   - action:  {kind, targetId?, params, slots, matchedVerb}
   *              (envelope composition happens later, after target resolution;
   *               execution ONLY via action-client executeAction())
   *   - query:   {queryOnly:{type}, queryText?}
   *   - refusal: {unmatched:true, reason:'batch_not_supported'|'temporal_not_supported'}
   *   - miss:    {unmatched:true, reason:'empty'|'unknown_verb'|'missing_slot'|'missing_target'}
   */
  function parseIntent(utterance, context) {
    void context; // standalone parse; context reserved (no multi-turn state)
    const text = normalize(utterance);
    if (!text) return unmatched('empty');

    const lower = text.toLowerCase();
    const firstWord = lower.split(/\s+/)[0].replace(/[^a-z'-]/g, '');

    // 1. Query-verb precedence — checked BEFORE any mutating mapping so a
    //    query phrasing containing a mutating verb can never gate (AC-SF4).
    if (QUERY_STARTERS.includes(firstWord)) {
      return classifyQuery(lower);
    }

    // 2. Temporal/scheduling utterances refuse with a pointer at the Cron
    //    view regardless of the verb that follows (§6.6).
    if (TEMPORAL_RE.test(text)) return unmatched('temporal_not_supported');

    // 3. Mutating candidates: refuse batch classes with a named reason
    //    before composing anything — one envelope = one target (§6.6).
    const verbGroup = Object.keys(MUTATING_VERBS).find((g) => MUTATING_VERBS[g].includes(firstWord));
    if (verbGroup) {
      if (BATCH_RE.test(text)) return unmatched('batch_not_supported');

      const rest = text.slice(firstWord.length).trim();
      switch (verbGroup) {
        case 'assign':
          return parseAssign(rest);
        case 'dispatch':
          return parseDispatch(rest);
        case 'approve':
          return parseApprovalDecide('approve', rest);
        case 'reject':
          return parseApprovalDecide('reject', rest);
        case 'cancel':
          return parseRunAction(VERB_KINDS.cancel, 'cancel', rest);
        case 'redispatch':
          return parseRunAction(VERB_KINDS.redispatch, 'redispatch', rest);
        case 'create': {
          const created = parseTaskCreate(rest);
          if (created) return created;
          break; // not the flagship noun template → honest unknown_verb below
        }
        default:
          break;
      }
    }

    // 4. Honest miss — palette degrades this to normal search silently.
    return unmatched('unknown_verb');
  }

  /** Kinds the grammar can propose (for docs/tests parity assertions). */
  function grammarKinds() {
    return [...new Set(Object.values(VERB_KINDS))];
  }

  return {
    parseIntent,
    grammarKinds,
    MUTATING_VERBS,
    VERB_KINDS,
    QUERY_STARTERS,
    BATCH_RE,
    TEMPORAL_RE,
  };
});
