/**
 * Pure helpers for the settings-view "Snapshots & Restore" panel
 * (docs/briefs/snapshot-restore.md §3, slice 3).
 *
 * Everything here is DOM-free and network-free so the panel's formatting /
 * mapping decisions stay DB-free-testable (tests/test-snapshot-panel.js).
 * The view owns all fetch/DOM/SSE work; these functions only shape data.
 */

/** Client-side pre-upload cap mirror (brief §3.2 step 1; server re-checks, AC9). */
export const RESTORE_MAX_BYTES_DEFAULT = 100 * 1024 * 1024;

/**
 * Honest byte formatting (R2: sizes ship honestly, never "≈").
 * Null/undefined/non-finite/negative → '—' (unknown, not zero).
 * @returns {string} e.g. '512 B' | '1.5 KB' | '3.3 MB' | '1.0 GB'
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (bytes == null || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Local-time 'YYYY-MM-DD HH:mm' for created_at columns.
 * Falsy → '—'; unparseable strings echo back unchanged (honest, never invented).
 */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Brief §3.1 step 1 default name: snapshot-YYYYMMDD-HHmm (local time). */
export function defaultSnapshotName(now = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `snapshot-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/**
 * Schema-compat verdict → badge descriptor (§4.3 refuse-newer/warn-older).
 * Unknown/absent verdicts render as an explicit "not checked" neutral badge —
 * the list never invents a verdict before a preview ran.
 */
export function verdictToBadge(verdict) {
  switch (verdict) {
    case 'ok':
      return { tone: 'ok', css: 'cp-badge-ok', label: 'schema compatible' };
    case 'target_newer':
      return { tone: 'warn', css: 'cp-badge-warn', label: 'target newer (additive)' };
    case 'too_new':
      return { tone: 'error', css: 'cp-badge-err', label: 'too new — refused' };
    default:
      return { tone: 'neutral', css: '', label: 'not checked' };
  }
}

/** Warning codes (preview payload) → human lines; unknown codes pass through. */
const WARNING_LINES = {
  target_newer: 'Target database is newer than the artifact — additive migrations are assumed safe.',
  active_runs: 'Active workflow runs detected — pause the dispatcher before a destructive replace.',
  settings_section_dropped: 'Settings section dropped: it contained secret-looking keys.',
};

export function warningLines(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => WARNING_LINES[w] || String(w));
}

const numOf = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arrOf = (v) => (Array.isArray(v) ? v.map(String) : []);

/**
 * Normalize the preview diff payload into sorted grid rows:
 * busiest tables first (added+updated+conflicts), ties alphabetical;
 * per-table query errors ride along honestly instead of vanishing.
 */
export function previewGridRows(preview) {
  const tables = preview && preview.tables && typeof preview.tables === 'object' ? preview.tables : {};
  return Object.entries(tables)
    .map(([name, t]) => {
      const added = numOf(t && t.added);
      const updated = numOf(t && t.updated);
      const conflicts = numOf(t && t.conflicts);
      const unchanged = numOf(t && t.unchanged);
      return {
        name,
        added,
        updated,
        conflicts,
        unchanged,
        added_pks: arrOf(t && t.added_pks),
        conflict_pks: arrOf(t && t.conflict_pks),
        error: t && t.error ? String(t.error) : null,
        activity: added + updated + conflicts,
      };
    })
    .sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name));
}

/**
 * Apply response → completion-summary descriptor. Distinguishes the three
 * endings operators must never have to guess between (§4.4 / R5):
 *   duplicate — this restoreId already completed; stored summary replayed,
 *               nothing executed
 *   resumed   — checkpoint resume; previously completed tables were skipped
 *   fresh     — first-pass completion
 */
export function describeApplyResult(payload = {}) {
  const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
  const totals = summary.totals && typeof summary.totals === 'object' ? summary.totals : {};
  const settings = summary.settings && typeof summary.settings === 'object' ? summary.settings : {};

  const kind = payload.duplicate ? 'duplicate' : (payload.resumed || summary.resumed) ? 'resumed' : 'fresh';
  const headlines = {
    duplicate: 'Already completed',
    resumed: 'Restore resumed — completed',
    fresh: 'Restore complete',
  };

  const lines = [];
  if (kind === 'duplicate') {
    lines.push('This restoreId already completed earlier — replaying the stored summary; nothing was executed.');
  }
  lines.push(`Mode: ${summary.mode || '?'} — rows upserted ${numOf(totals.upserted)}, deleted ${numOf(totals.deleted)}.`);
  if (settings.dropped_section) {
    lines.push(`Settings section dropped (${settings.skipped_keys != null ? settings.skipped_keys : '?'} keys looked secret-bearing).`);
  } else if (typeof settings.applied === 'number') {
    lines.push(`Settings applied: ${settings.applied}.`);
  }
  if (kind === 'resumed') {
    lines.push('Resumed from checkpoint — previously completed tables were skipped.');
  }

  return { kind, headline: headlines[kind], lines };
}

/**
 * Determinate progress percent from completed-table count vs the expected
 * table count taken from the preview diff. No preview (resume-after-refresh
 * reattach) → null → the view shows an indeterminate state instead of a lie.
 */
export function progressPercent(completedTables, expectedTables) {
  const expected = Number(expectedTables);
  if (!Number.isFinite(expected) || expected <= 0) return null;
  const done = Math.max(0, Math.min(numOf(completedTables), expected));
  return Math.round((done / expected) * 100);
}
