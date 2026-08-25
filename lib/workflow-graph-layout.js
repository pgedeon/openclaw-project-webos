/**
 * workflow-graph-layout.js — Workflow visual editor Stage 1 pure layout helpers
 * (docs/briefs/workflow-visual-editor-stage1.md §3/§4; work order: lib/workflow-graph-layout.js).
 *
 * PURE function module: no DOM, no fetch, no fs, no timers. Everything here is
 * exported for DB-free tests (tests/test-workflow-graph.js) exactly like
 * session-replay's exported helpers.
 *
 * Data reality (brief §1, verified against live mission_control 2026-08-25):
 * all 29 active templates are LINEAR chains of 3–10 steps; 14/29 store steps
 * as plain strings. layoutLayered() is a longest-path layering whose output on
 * linear input IS the vertical single-column list — there is no separate
 * "linear fallback" code path.
 *
 * Cycle contract (work order): cycle-guarded — layoutLayered THROWS on cyclic
 * depends_on input (tested). This deliberately tightens the brief's §3
 * "ignore + flag" sketch: every real template is linear, so a cycle can only
 * be authoring corruption and must fail loudly in the pure layer instead of
 * silently rendering a lie. The view catches the throw and renders its named
 * error state (zero-throw house rule applies at the VIEW boundary, not the
 * pure math).
 *
 * Dual-target loading without a build step (repo charter: no frameworks),
 * same pattern as lib/nl-parse.js: CommonJS `module.exports` under node,
 * `globalThis.WorkflowGraphLayout` in the browser via dynamic import() of the
 * served path.
 */

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.WorkflowGraphLayout = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Fixed node geometry (brief §3): closed-form math, mirrors session-replay's
  // fixed-row-height discipline.
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 44;
  const RANK_GAP = 28;      // vertical gap between ranks (the edge channel)
  const COLUMN_GAP = 24;    // horizontal gap between same-rank nodes

  // Render cap (brief §4): largest real template is 10 steps; cap is ~3× headroom.
  const GRAPH_MAX_NODES = 32;

  // Template name regex mirrored from workflow-runs-api.js (`[a-z0-9-]+`).
  const TEMPLATE_NAME_RE = /^[a-z0-9-]+$/;

  // Status → visual tone. Reuses workflows-view's badge palette semantics:
  // green completed, blue running/in_progress, red failed, amber queued-ish,
  // gray pending/skipped/blocked/cancelled, and UNKNOWN strings stay neutral
  // with the raw text preserved verbatim (observed `timed_out` violates the
  // table's own CHECK constraint — brief §1; never guessed into a legal bucket).
  const STATUS_TONES = {
    completed: 'success',
    done: 'success',
    in_progress: 'info',
    running: 'info',
    active: 'info',
    failed: 'danger',
    error: 'danger',
    queued: 'warning',
    retrying: 'warning',
    pending: 'neutral',
    skipped: 'neutral',
    blocked: 'neutral',
    cancelled: 'neutral',
    canceled: 'neutral'
  };

  // Step-type icon keyword table (brief §5.4). Mapping is honest decoration:
  // an icon implies nothing the schema does not carry. Unmatched → generic ◇.
  const ICON_KEYWORDS = [
    [/(publish|post|article)/i, '🚀'],
    [/(review|qa|approve|proof)/i, '🔍'],
    [/(image|photo|screenshot|cover)/i, '🖼'],
    [/(test|verify|check|validate)/i, '✅'],
    [/(fetch|download|crawl|scrape|import)/i, '⬇'],
    [/(fix|deploy|repair|migrate|patch)/i, '🔧'],
    [/(analy|research|discover|topic|gap)/i, '🧭'],
    [/(write|draft|compose|generate)/i, '✍️'],
    [/(audit|report|metric|cost)/i, '📊']
  ];

  /**
   * Normalize one raw template step entry into {name, display_name, required}.
   * Accepts plain strings (14/29 real templates), object entries
   * {name, display_name?, required?}, and unknown shapes — unknown becomes an
   * `(unnamed step N)` node rather than an exception (brief §4 AC1 totality).
   */
  function normalizeStep(entry, index) {
    const fallbackName = `(unnamed step ${index + 1})`;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      const name = trimmed || fallbackName;
      return { name, display_name: name, required: true };
    }
    if (entry && typeof entry === 'object') {
      const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
      const name = rawName || fallbackName;
      const rawDisplay = typeof entry.display_name === 'string' ? entry.display_name.trim() : '';
      return {
        name,
        display_name: rawDisplay || name,
        required: entry.required !== false
      };
    }
    return { name: fallbackName, display_name: fallbackName, required: true };
  }

  /**
   * buildGraph(steps, opts?) — normalize steps + derive edges (brief §4).
   *
   * Edges: consecutive pairs i → i+1 by default. A step carrying a non-empty
   * `depends_on` array prefers explicit deps over the consecutive order (the
   * one-`if` future-proofing specified now so Stage 2 does not redesign the
   * contract); depends_on entries naming unknown steps are ignored honestly.
   *
   * Returns { nodes, edges, total, truncated }:
   *   nodes  [{id, index, name, display_name, required}]
   *   edges  [{from: nodeId, to: nodeId}]
   *   total  original step count (true total for the truncation banner)
   *   truncated true when total > cap
   * Never throws on any input (null / non-array / empty → empty graph).
   */
  function buildGraph(steps, opts) {
    const maxNodes = (opts && Number.isInteger(opts.maxNodes) && opts.maxNodes > 0)
      ? opts.maxNodes
      : GRAPH_MAX_NODES;
    const list = Array.isArray(steps) ? steps : [];
    const total = list.length;
    const kept = list.slice(0, maxNodes);

    const nodes = kept.map((entry, index) => {
      const norm = normalizeStep(entry, index);
      return {
        id: `step-${index}`,
        index,
        name: norm.name,
        display_name: norm.display_name,
        required: norm.required,
        depends_on: Array.isArray(entry && entry.depends_on)
          ? entry.depends_on.filter((d) => typeof d === 'string')
          : null
      };
    });

    const nameToId = new Map();
    for (const n of nodes) {
      if (!nameToId.has(n.name)) nameToId.set(n.name, n.id);
    }

    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.depends_on && node.depends_on.length > 0) {
        // Explicit deps win over consecutive order for this step.
        for (const dep of node.depends_on) {
          const fromId = nameToId.get(dep);
          if (fromId && fromId !== node.id) edges.push({ from: fromId, to: node.id });
        }
      } else if (i > 0) {
        edges.push({ from: nodes[i - 1].id, to: node.id });
      }
    }

    return {
      nodes: nodes.map(({ depends_on, ...rest }) => rest),
      edges,
      total,
      truncated: total > maxNodes
    };
  }

  /**
   * layoutLayered(steps, opts?) — longest-path layering over buildGraph output
   * (brief §3). rank(n) = 0 for sources, else 1 + max(rank(pred)). A linear
   * chain degenerates to one node per rank = the plain vertical list that ALL
   * real data is. Same-rank nodes spread horizontally, centered per rank.
   *
   * THROWS Error(/cycle/) when depends_on edges form a cycle (work order:
   * fail loudly on corrupt authoring; tested). Consecutive-only input can
   * never cycle.
   *
   * Returns {...buildGraph result, laidOut:[{...node, rank, x, y, width, height}], width, height}.
   */
  function layoutLayered(steps, opts) {
    const graph = buildGraph(steps, opts);

    // Adjacency: nodeId → predecessor nodeIds (deduped).
    const preds = new Map();
    for (const n of graph.nodes) preds.set(n.id, []);
    for (const e of graph.edges) {
      const list = preds.get(e.to);
      if (!list.includes(e.from)) list.push(e.from);
    }

    // Cycle guard + longest-path ranks via DFS with a visiting set.
    const rankById = new Map();
    const visiting = new Set();

    function rankOf(nodeId, rootName) {
      if (rankById.has(nodeId)) return rankById.get(nodeId);
      if (visiting.has(nodeId)) {
        throw new Error(`workflow-graph: cycle detected involving "${rootName}"`);
      }
      visiting.add(nodeId);
      const predList = preds.get(nodeId);
      let rank = 0;
      if (predList.length > 0) {
        rank = -1;
        for (const p of predList) {
          const r = rankOf(p, rootName);
          if (r + 1 > rank) rank = r + 1;
        }
      }
      visiting.delete(nodeId);
      rankById.set(nodeId, rank);
      return rank;
    }

    for (const n of graph.nodes) rankOf(n.id, n.name);

    // Group ranks → columns; geometry closed-form.
    const byRank = new Map();
    for (const n of graph.nodes) {
      const rank = rankById.get(n.id);
      if (!byRank.has(rank)) byRank.set(rank, []);
      byRank.get(rank).push(n);
    }

    const maxColumns = Math.max(1, ...[...byRank.values()].map((col) => col.length));
    const canvasWidth = maxColumns * NODE_WIDTH + Math.max(0, maxColumns - 1) * COLUMN_GAP;
    const rankCount = byRank.size;
    const canvasHeight = rankCount * NODE_HEIGHT + Math.max(0, rankCount - 1) * RANK_GAP;

    const laidOut = graph.nodes.map((n) => {
      const rank = rankById.get(n.id);
      const col = byRank.get(rank);
      const colIndex = col.indexOf(n);
      const colWidth = col.length * NODE_WIDTH + (col.length - 1) * COLUMN_GAP;
      const xOffset = Math.round((canvasWidth - colWidth) / 2);
      return {
        ...n,
        rank,
        x: xOffset + colIndex * (NODE_WIDTH + COLUMN_GAP),
        y: rank * (NODE_HEIGHT + RANK_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT
      };
    });

    return {
      ...graph,
      laidOut,
      width: canvasWidth,
      height: canvasHeight
    };
  }

  /**
   * mergeRunStatus(nodes, runSteps) — key run workflow_steps rows by
   * step_name onto the template node order (brief §4). Missing rows →
   * `pending`; duplicate names → latest row wins (last occurrence); unknown
   * status strings pass through VERBATIM with tone 'unknown' (neutral badge,
   * raw label shown — never guessed into a legal bucket).
   */
  function mergeRunStatus(nodes, runSteps) {
    const rows = Array.isArray(runSteps) ? runSteps : [];
    const byName = new Map();
    for (const row of rows) {
      if (row && typeof row.step_name === 'string') byName.set(row.step_name, row);
    }

    return (Array.isArray(nodes) ? nodes : []).map((node) => {
      const row = byName.get(node.name) || null;
      const status = row && typeof row.status === 'string' && row.status.trim()
        ? row.status.trim()
        : 'pending';
      const tone = STATUS_TONES[status] || 'unknown';
      return {
        ...node,
        status,
        tone,
        started_at: row?.started_at ?? null,
        finished_at: row?.finished_at ?? null,
        error_message: row?.error_message ?? null,
        output: row?.output ?? null
      };
    });
  }

  /** stepIcon(name) — keyword-table icon (brief §5.4); unmatched → ◇. */
  function stepIcon(name) {
    const s = typeof name === 'string' ? name : '';
    for (const [re, icon] of ICON_KEYWORDS) {
      if (re.test(s)) return icon;
    }
    return '◇';
  }

  return {
    buildGraph,
    layoutLayered,
    mergeRunStatus,
    normalizeStep,
    stepIcon,
    STATUS_TONES,
    GRAPH_MAX_NODES,
    NODE_WIDTH,
    NODE_HEIGHT,
    RANK_GAP,
    COLUMN_GAP,
    TEMPLATE_NAME_RE
  };
});
