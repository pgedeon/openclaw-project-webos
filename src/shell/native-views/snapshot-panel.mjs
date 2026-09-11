/**
 * Snapshots & Restore panel — settings-view slice 3
 * (docs/briefs/snapshot-restore.md §3; view-only over the five live endpoints).
 *
 * Mounted by src/shell/native-views/settings-view.mjs under its own sidebar
 * entry ("💾 Snapshots & Restore"). Owns ALL network/DOM/SSE work; pure
 * formatting/mapping decisions live in ./snapshot-panel-helpers.mjs (DB-free
 * tested in tests/test-snapshot-panel.js).
 *
 * Flow per brief:
 *   §3.1 create → POST /api/snapshots → refresh list (button disabled while
 *        generating; toast carries the total row count)
 *   §3.1 list   → newest-first rows: name/id, created_at, honest size_bytes,
 *        last-previewed schema-verdict badge, Download (fetch→blob→anchor,
 *        Bearer stays out of the URL) + Restore…
 *   §3.2 restore→ preview (upload w/ client-side size-cap mirror or
 *        server-side pick) → diff grid + warnings + verdict → Merge confirms
 *        plainly, Replace flips to HOLD_CONFIRM (press-and-hold ≥1.2 s ring,
 *        early release fires nothing, Enter-hold keyboard parity + typed-
 *        confirm fallback — AC12; replicated from action-client.mjs because
 *        its exported overlay is hard-wired to ACTION_CATALOG kinds and
 *        restore deliberately is NOT a catalog kind) → POST apply with a
 *        restoreId minted ONCE per confirmed intent → determinate progress
 *        from restore-progress SSE frames on /api/events/stream → completion
 *        summary distinguishing fresh / resumed / duplicate (§4.4, R5).
 *
 * Zero-throw degradation: every fetch failure lands in a named panel state;
 * without PostgreSQL the registry/download endpoints still serve (AC7), and
 * create/preview/apply surface the server's 503 {available:false} honestly.
 * Closing the panel never cancels an in-flight apply — the pending record in
 * localStorage lets the operator reattach by restoreId after a refresh.
 */

import {
  RESTORE_MAX_BYTES_DEFAULT,
  formatBytes,
  formatTimestamp,
  defaultSnapshotName,
  verdictToBadge,
  warningLines,
  previewGridRows,
  describeApplyResult,
  progressPercent,
} from './snapshot-panel-helpers.mjs';
import { escapeHtml } from './helpers.mjs';

const PENDING_KEY = 'openclaw.pendingRestore';

/** Last preview verdict per snapshot_id (in-memory; 'not checked' until then). */
const verdictCache = new Map();

/** UUID-shaped id (crypto.randomUUID with v4 fallback — non-secure contexts). */
function mintRestoreId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function readPending() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(PENDING_KEY);
    const rec = raw ? JSON.parse(raw) : null;
    return rec && rec.restoreId ? rec : null;
  } catch {
    return null;
  }
}

function writePending(rec) {
  try {
    if (rec) globalThis.localStorage.setItem(PENDING_KEY, JSON.stringify(rec));
    else globalThis.localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable → reattach degrades to absent */ }
}

/**
 * Subscribe to restore-progress frames for one restoreId on the existing
 * bridge-fed stream (§3.2 step 4). Returns a detach function. Progress is
 * convenience, not correctness (§4.5): any failure here degrades silently and
 * the final summary still arrives via the apply POST response.
 */
function listenRestoreProgress(restoreId, onFrame) {
  try {
    if (typeof EventSource === 'undefined') return () => {};
    const token = globalThis.__DASHBOARD_AUTH_TOKEN__;
    const es = new EventSource('/api/events/stream' + (token ? '?token=' + encodeURIComponent(token) : ''));
    const handler = (e) => {
      let frame = null;
      try { frame = JSON.parse(e.data); } catch { return; }
      if (frame && frame.restoreId === restoreId) onFrame(frame);
    };
    es.addEventListener('restore-progress', handler);
    return () => {
      try { es.removeEventListener('restore-progress', handler); es.close(); } catch { /* already gone */ }
    };
  } catch {
    return () => {};
  }
}

/**
 * Mount the panel into `container` (a .cp-group element provided by the
 * settings view). apiGet/apiPost/authHeaders/showToast are the settings
 * view's own helpers so auth stays consistent across the app.
 */
export function mountSnapshotsPanel({ container, apiGet, apiPost, authHeaders, showToast }) {
  let listState = 'loading'; // loading | ready | empty | unavailable | error
  let listError = null;
  let snapshots = [];
  let creating = false;

  const root = document.createElement('div');
  root.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">💾 Snapshots &amp; Restore</span>
      <button class="cp-btn cp-btn-secondary" id="cp-snap-refresh">↻ Refresh</button>
    </div>
    <div class="cp-group">
      <div class="cp-group-title">Create snapshot</div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input class="cp-input" id="cp-snap-name" style="max-width:320px;"
               placeholder="snapshot name" aria-label="Snapshot name" />
        <button class="cp-btn cp-btn-primary" id="cp-snap-create">📦 Create snapshot</button>
      </div>
      <div style="font-size:0.72rem; color:var(--win11-text-tertiary); margin-top:6px;">
        Full-state capture: every dashboard table + non-secret settings, redacted, written atomically.
      </div>
    </div>
    <div class="cp-group">
      <div class="cp-group-title">Server-side snapshots</div>
      <div id="cp-snap-list"><span class="cp-spinner"></span> Loading…</div>
    </div>
    <div id="cp-snap-pending"></div>
  `;
  container.appendChild(root);

  const listEl = () => root.querySelector('#cp-snap-list');
  const pendingEl = () => root.querySelector('#cp-snap-pending');

  // ── List rendering ─────────────────────────────────────────────

  function renderList() {
    const el = listEl();
    if (!el) return;

    if (listState === 'loading') {
      el.innerHTML = '<span class="cp-spinner"></span> Loading…';
      return;
    }
    if (listState === 'unavailable') {
      el.innerHTML = `
        <div style="color:var(--win11-text-secondary); font-size:0.8rem;">
          ⚠ Snapshot registry unavailable (${escapeHtml(listError || 'endpoint unreachable')}).
          The dashboard API may be restarting.
        </div>`;
      return;
    }
    if (listState === 'error') {
      el.innerHTML = `
        <div style="color:#ef4444; font-size:0.8rem;">
          ✗ Failed to load snapshots: ${escapeHtml(listError || 'unknown error')}
          <button class="cp-btn cp-btn-secondary" id="cp-snap-retry" style="margin-left:8px;">Retry</button>
        </div>`;
      el.querySelector('#cp-snap-retry')?.addEventListener('click', loadList);
      return;
    }
    if (listState === 'empty') {
      el.innerHTML = '<div style="font-style:italic; color:var(--win11-text-tertiary); font-size:0.8rem;">No snapshots yet — create the first one above.</div>';
      return;
    }

    const rows = snapshots.map((s) => {
      const badge = verdictToBadge(verdictCache.get(s.snapshot_id));
      return `
        <tr>
          <td style="padding:6px 8px;">
            <div style="font-weight:600;">${escapeHtml(s.name)}</div>
            <div style="font-family:monospace; font-size:0.68rem; color:var(--win11-text-tertiary);" title="${escapeHtml(s.snapshot_id)}">${escapeHtml(String(s.snapshot_id).slice(0, 13))}…</div>
          </td>
          <td style="padding:6px 8px; white-space:nowrap;">${escapeHtml(formatTimestamp(s.created_at))}</td>
          <td style="padding:6px 8px; text-align:right; white-space:nowrap;" title="${Number(s.size_bytes) || 0} bytes">${escapeHtml(formatBytes(s.size_bytes))}</td>
          <td style="padding:6px 8px; text-align:right; white-space:nowrap;">${Number(s.total_rows) || 0}</td>
          <td style="padding:6px 8px;"><span class="cp-badge ${badge.css}">${escapeHtml(badge.label)}</span></td>
          <td style="padding:6px 8px; white-space:nowrap;">
            <button class="cp-btn cp-btn-secondary cp-snap-dl" data-id="${escapeHtml(s.snapshot_id)}">⬇ Download</button>
            <button class="cp-btn cp-btn-warn cp-snap-restore" data-id="${escapeHtml(s.snapshot_id)}" data-name="${escapeHtml(s.name)}">↻ Restore…</button>
          </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
        <thead>
          <tr style="color:var(--win11-text-secondary); text-align:left; border-bottom:1px solid var(--win11-border);">
            <th style="padding:6px 8px;">Snapshot</th>
            <th style="padding:6px 8px;">Created</th>
            <th style="padding:6px 8px; text-align:right;">Size</th>
            <th style="padding:6px 8px; text-align:right;">Rows</th>
            <th style="padding:6px 8px;">Schema verdict</th>
            <th style="padding:6px 8px;"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    el.querySelectorAll('.cp-snap-dl').forEach((btn) => {
      btn.addEventListener('click', () => downloadSnapshot(btn.dataset.id, btn));
    });
    el.querySelectorAll('.cp-snap-restore').forEach((btn) => {
      btn.addEventListener('click', () => openRestoreModal({ snapshotId: btn.dataset.id, name: btn.dataset.name }));
    });
  }

  async function loadList() {
    listState = 'loading';
    renderList();
    try {
      const payload = await apiGet('/api/snapshots');
      snapshots = Array.isArray(payload && payload.snapshots) ? payload.snapshots : [];
      listState = snapshots.length === 0 ? 'empty' : 'ready';
    } catch (err) {
      // House degradation: named states, prior data untouched on refresh fails.
      listError = err && err.message ? err.message : 'unreachable';
      listState = /503|unavailable/i.test(listError) ? 'unavailable' : 'error';
    }
    renderList();
    renderPending();
  }

  async function createSnapshot() {
    if (creating) return;
    creating = true;
    const btn = root.querySelector('#cp-snap-create');
    const nameInput = root.querySelector('#cp-snap-name');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    try {
      const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : undefined;
      const payload = await apiPost('/api/snapshots', name ? { name } : {});
      if (payload && payload.available === false) {
        showToast(`Snapshot unavailable: ${payload.reason || 'no_database'}`, 'err');
      } else if (payload && payload.manifest) {
        const totalRows = Object.values(payload.manifest.counts || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
        showToast(`Snapshot created — ${totalRows} rows captured.`, 'ok');
        if (nameInput) nameInput.value = '';
        await loadList();
      } else {
        showToast(`Snapshot failed: ${(payload && payload.error) || 'unknown error'}`, 'err');
      }
    } catch (err) {
      showToast(`Snapshot failed: ${err.message}`, 'err');
    } finally {
      creating = false;
      if (btn) { btn.disabled = false; btn.textContent = '📦 Create snapshot'; }
    }
  }

  async function downloadSnapshot(id, btn) {
    const prev = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const resp = await fetch(`/api/snapshots/${encodeURIComponent(id)}/download`, {
        headers: { Authorization: (authHeaders && authHeaders()['Authorization']) || '' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      let filename = `${id}.json`;
      const cd = resp.headers && resp.headers.get && resp.headers.get('content-disposition');
      const m = cd && cd.match(/filename="([^"]+)"/);
      if (m) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Snapshot downloaded.', 'ok');
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prev || '⬇ Download'; }
    }
  }

  // ── Pending-restore reattach (resume-after-refresh, §3.2 step 4) ──

  function renderPending() {
    const el = pendingEl();
    if (!el) return;
    const rec = readPending();
    if (!rec) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="cp-group" style="border-color:rgba(234,179,8,0.45);">
        <div class="cp-group-title">♻ Restore in flight</div>
        <div style="font-size:0.8rem;">
          “${escapeHtml(rec.name || rec.snapshotId || '')}” (${escapeHtml(rec.mode || 'merge')}) started
          ${escapeHtml(formatTimestamp(rec.startedAt))}. Closing the page did not cancel it.
        </div>
        <div class="cp-btn-row">
          <button class="cp-btn cp-btn-primary" id="cp-snap-reattach">Reattach progress</button>
          <button class="cp-btn cp-btn-secondary" id="cp-snap-discard">Dismiss record</button>
        </div>
      </div>`;
    el.querySelector('#cp-snap-reattach')?.addEventListener('click', () => {
      openProgressModal({
        restoreId: rec.restoreId,
        expectedTables: rec.expectedTables,
        source: { snapshot_id: rec.snapshotId },
        mode: rec.mode || 'merge',
        artifact: null,
        name: rec.name,
        resumable: true,
      });
    });
    el.querySelector('#cp-snap-discard')?.addEventListener('click', () => {
      writePending(null);
      renderPending();
    });
  }

  // ── Restore modal (§3.2) ───────────────────────────────────────

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'cp-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    return overlay;
  }

  function buildCard(width = 560) {
    const card = document.createElement('div');
    card.className = 'cp-confirm-dialog';
    card.style.cssText = `max-width:${width}px; text-align:left; max-height:86vh; overflow-y:auto;`;
    return card;
  }

  /**
   * Open the restore flow for a server-side snapshot or an uploaded artifact.
   * Stages: preview → confirm (mode-dependent) → progress → summary.
   */
  function openRestoreModal({ snapshotId = null, name = null, file = null }) {
    const overlay = buildOverlay();
    const card = buildCard();
    card.innerHTML = '<span class="cp-spinner"></span> Running dry-run diff preview…';
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const closeOverlay = () => { try { overlay.remove(); } catch { /* gone */ } };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

    const requestBody = file ? { artifact: file.artifact } : { snapshot_id: snapshotId };

    (async () => {
      let preview;
      try {
        preview = await apiPost('/api/restore/preview', requestBody);
      } catch (err) {
        card.innerHTML = `
          <h3>Restore preview failed</h3>
          <p>${escapeHtml(err.message)}</p>
          <div class="cp-btn-row"><button class="cp-btn cp-btn-secondary" id="cp-rp-close">Close</button></div>`;
        card.querySelector('#cp-rp-close').addEventListener('click', closeOverlay);
        return;
      }
      if (preview && preview.available === false) {
        card.innerHTML = `
          <h3>Restore unavailable</h3>
          <p>The restore service reports: ${escapeHtml(preview.reason || 'no_database')}.
           A database connection is required to diff against live state.</p>
          <div class="cp-btn-row"><button class="cp-btn cp-btn-secondary" id="cp-rp-close">Close</button></div>`;
        card.querySelector('#cp-rp-close').addEventListener('click', closeOverlay);
        return;
      }
      if (preview && preview.error) {
        const tooNew = preview.error === 'schema_too_new';
        card.innerHTML = `
          <h3>${tooNew ? 'Artifact too new for this target' : 'Preview refused'}</h3>
          <p>${escapeHtml(tooNew ? `Missing migrations: ${(preview.missing || []).join(', ')}` : String(preview.error))}</p>
          <div class="cp-btn-row"><button class="cp-btn cp-btn-secondary" id="cp-rp-close">Close</button></div>`;
        card.querySelector('#cp-rp-close').addEventListener('click', closeOverlay);
        return;
      }
      renderConfirmStage({ overlay, card, closeOverlay, preview, requestBody, file, snapshotId, name });
    })();
  }

  function renderConfirmStage({ overlay, card, closeOverlay, preview, requestBody, file, snapshotId, name }) {
    if (snapshotId && preview.snapshot_id) verdictCache.set(preview.snapshot_id, preview.schema_compat);

    const expectedTables = preview.tables && typeof preview.tables === 'object'
      ? Object.keys(preview.tables).length : 0;
    const badge = verdictToBadge(preview.schema_compat);
    const warns = warningLines(preview.warnings);
    const gridRows = previewGridRows(preview);
    const displayName = name || (preview.snapshot_id ? String(preview.snapshot_id).slice(0, 13) + '…' : 'uploaded artifact');

    card.innerHTML = '';

    const title = document.createElement('h3');
    title.style.cssText = 'margin-bottom:4px;';
    title.textContent = `Restore “${displayName}”`;

    const metaLine = document.createElement('div');
    metaLine.style.cssText = 'font-size:0.76rem; color:var(--win11-text-secondary); margin-bottom:10px;';
    metaLine.innerHTML = `Snapshot of ${escapeHtml(formatTimestamp(preview.created_at))} ·
      <span class="cp-badge ${badge.css}">${escapeHtml(badge.label)}</span> ·
      nothing is written until you confirm.`;

    // Warnings (target_newer / active_runs / settings_section_dropped …)
    let warnBox = null;
    if (warns.length > 0) {
      warnBox = document.createElement('div');
      warnBox.style.cssText = [
        'background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.35);',
        'border-radius:6px; padding:8px 12px; margin-bottom:12px; font-size:0.76rem; color:#eab308;',
      ].join(';');
      warnBox.innerHTML = warns.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('');
    }

    // Diff grid — busiest tables first, PK samples expandable.
    const grid = document.createElement('div');
    grid.style.cssText = 'margin-bottom:12px; overflow-x:auto;';
    grid.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.74rem;">
        <thead>
          <tr style="color:var(--win11-text-secondary); text-align:left; border-bottom:1px solid var(--win11-border);">
            <th style="padding:4px 6px;">Table</th>
            <th style="padding:4px 6px; text-align:right;">Added</th>
            <th style="padding:4px 6px; text-align:right;">Updated</th>
            <th style="padding:4px 6px; text-align:right;">Conflicts</th>
            <th style="padding:4px 6px; text-align:right;">Unchanged</th>
          </tr>
        </thead>
        <tbody>
          ${gridRows.map((r) => `
            <tr style="border-bottom:1px solid var(--win11-border);">
              <td style="padding:4px 6px; font-family:monospace;">${escapeHtml(r.name)}${r.error ? ` <span class="cp-badge cp-badge-err">query failed</span>` : ''}</td>
              <td style="padding:4px 6px; text-align:right; color:${r.added ? '#22c55e' : 'inherit'};">${r.added}</td>
              <td style="padding:4px 6px; text-align:right; color:${r.updated ? '#60cdff' : 'inherit'};">${r.updated}</td>
              <td style="padding:4px 6px; text-align:right; color:${r.conflicts ? '#ef4444' : 'inherit'};">${r.conflicts}</td>
              <td style="padding:4px 6px; text-align:right; color:var(--win11-text-tertiary);">${r.unchanged}</td>
            </tr>
            ${(r.added_pks.length > 0 || r.conflict_pks.length > 0) ? `
            <tr><td colspan="5" style="padding:0 6px 6px;">
              <details style="font-size:0.7rem; color:var(--win11-text-tertiary);">
                <summary style="cursor:pointer;">PK samples</summary>
                ${r.added_pks.length ? `<div>+ ${escapeHtml(r.added_pks.join(', '))}</div>` : ''}
                ${r.conflict_pks.length ? `<div style="color:#ef4444;">⚠ ${escapeHtml(r.conflict_pks.join(', '))}</div>` : ''}
              </details>
            </td></tr>` : ''}
          `).join('')}
        </tbody>
      </table>`;

    // Mode selector — Merge default; Replace flips the confirm gate (§3.2 step 3).
    const modeBox = document.createElement('div');
    modeBox.style.cssText = 'margin-bottom:10px; font-size:0.8rem;';
    modeBox.innerHTML = `
      <label style="display:block; margin-bottom:4px; cursor:pointer;">
        <input type="radio" name="cp-restore-mode" value="merge" checked /> Merge — upsert artifact rows, delete nothing (safe)
      </label>
      <label style="display:block; cursor:pointer;">
        <input type="radio" name="cp-restore-mode" value="replace" /> Replace — ALSO delete live rows absent from the artifact (destructive)
      </label>`;

    // Rollback hint BEFORE confirming (§3.2 step 3) — create flow is one click away.
    const rollbackHint = document.createElement('div');
    rollbackHint.style.cssText = [
      'background:var(--win11-surface-active); border:1px solid var(--win11-border);',
      'border-radius:6px; padding:8px 12px; margin-bottom:14px; font-size:0.75rem;',
      'color:var(--win11-text-secondary);',
    ].join(';');
    rollbackHint.innerHTML = `🛟 Rollback move: <strong>re-create a snapshot of the current state first</strong> —
      the Create snapshot field above is one click away and is the honest undo for a destructive restore.`;

    const btnRow = document.createElement('div');
    btnRow.className = 'cp-btn-row';
    btnRow.style.marginTop = '0';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cp-btn cp-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    const confirmSlot = document.createElement('div');
    confirmSlot.style.cssText = 'flex:1; display:flex; justify-content:flex-end; align-items:center; gap:8px;';
    btnRow.append(cancelBtn, confirmSlot);

    card.append(title, metaLine);
    if (warnBox) card.appendChild(warnBox);
    card.append(grid, modeBox, rollbackHint, btnRow);

    let holdControls = null; // { teardown } while Replace gate mounted

    const currentMode = () => {
      const checked = card.querySelector('input[name="cp-restore-mode"]:checked');
      return checked ? checked.value : 'merge';
    };

    const mountGate = () => {
      if (holdControls) { holdControls.teardown(); holdControls = null; }
      confirmSlot.innerHTML = '';
      if (currentMode() === 'merge') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'cp-btn cp-btn-primary';
        confirmBtn.id = 'cp-restore-confirm';
        confirmBtn.textContent = 'Confirm merge';
        confirmBtn.addEventListener('click', () => beginApply());
        confirmSlot.appendChild(confirmBtn);
      } else {
        holdControls = mountHoldGate(confirmSlot, () => beginApply());
      }
    };
    modeBox.querySelectorAll('input[name="cp-restore-mode"]').forEach((radio) => {
      radio.addEventListener('change', mountGate);
    });

    cancelBtn.addEventListener('click', () => {
      if (holdControls) holdControls.teardown();
      closeOverlay();
    });

    function beginApply() {
      if (holdControls) { holdControls.teardown(); holdControls = null; }
      const mode = currentMode();
      openProgressModal({
        restoreId: mintRestoreId(),
        expectedTables,
        source: requestBody,
        mode,
        artifact: file, // kept in memory so a failed apply can retry identically
        name: displayName,
        resumable: false,
        adoptOverlay: { overlay, card, closeOverlay },
      });
    }

    mountGate();
  }

  /**
   * HOLD_CONFIRM gate for Replace (AC12): press-and-hold ≥1.2 s conic-gradient
   * ring — pointer AND Enter-key hold drive the identical start/cancel/
   * complete path (pattern replicated from action-client.mjs openHoldConfirm,
   * whose exported overlay is bound to ACTION_CATALOG kinds) — plus the
   * typed-confirm fallback (type REPLACE, press Confirm). Early release and
   * Escape fire nothing.
   */
  function mountHoldGate(slot, onConfirmed) {
    const HOLD_MS = 1200;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-direction:column; align-items:flex-end; gap:8px;';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px;';

    const ring = document.createElement('button');
    ring.type = 'button';
    ring.setAttribute('aria-label', 'Hold to confirm replace restore');
    ring.style.cssText = [
      'position:relative', 'width:72px', 'height:72px', 'border-radius:50%',
      'border:none', 'cursor:pointer',
      'background:conic-gradient(#ef4444 0deg, var(--win11-border) 0deg)',
      'color:var(--win11-text)', 'font-weight:600', 'font-size:0.72rem',
      'user-select:none', '-webkit-user-select:none', 'touch-action:none',
      'outline-offset:3px',
    ].join(';');
    const ringLabel = document.createElement('span');
    ringLabel.style.cssText = [
      'position:absolute', 'inset:6px', 'border-radius:50%',
      'background:var(--win11-surface-solid, #16213e)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    ringLabel.textContent = 'HOLD';
    ring.appendChild(ringLabel);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.7rem; color:var(--win11-text-tertiary); max-width:220px; text-align:right;';
    hint.textContent = `Hold ≥${(HOLD_MS / 1000).toFixed(1)} s (or hold Enter on it) to REPLACE. Release early = nothing fires.`;

    row.append(hint, ring);

    // Typed-confirm fallback (AC12): type REPLACE → plain Confirm unlocks.
    const fallback = document.createElement('div');
    fallback.style.cssText = 'display:flex; gap:6px; align-items:center;';
    const typed = document.createElement('input');
    typed.type = 'text';
    typed.placeholder = 'type REPLACE';
    typed.setAttribute('aria-label', 'Type REPLACE to confirm');
    typed.style.cssText = 'width:130px; padding:4px 8px; font-size:0.74rem;';
    const typedBtn = document.createElement('button');
    typedBtn.className = 'cp-btn cp-btn-danger';
    typedBtn.textContent = 'Confirm replace';
    typedBtn.disabled = true;
    typed.addEventListener('input', () => { typedBtn.disabled = typed.value.trim().toUpperCase() !== 'REPLACE'; });
    fallback.append(typed, typedBtn);

    wrap.append(row, fallback);
    slot.appendChild(wrap);

    let raf = null;
    let startTs = 0;
    let holding = false;
    let fired = false;

    const paint = () => {
      const pct = Math.min(1, (performance.now() - startTs) / HOLD_MS);
      const deg = Math.round(pct * 360);
      ring.style.background = `conic-gradient(#ef4444 ${deg}deg, var(--win11-border) ${deg}deg)`;
      ringLabel.textContent = pct >= 1 ? '✓' : `${Math.round(pct * 100)}%`;
      if (pct >= 1) { finish(true); return; }
      if (holding) raf = requestAnimationFrame(paint);
    };
    const startHold = () => {
      if (holding || fired) return;
      holding = true;
      startTs = performance.now();
      raf = requestAnimationFrame(paint);
    };
    const cancelHold = () => {
      if (!holding) return;
      holding = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      ring.style.background = 'conic-gradient(#ef4444 0deg, var(--win11-border) 0deg)';
      ringLabel.textContent = 'HOLD';
    };
    const finish = (confirmed) => {
      if (fired) return;
      fired = true;
      cancelHold();
      document.removeEventListener('keydown', onDocKey, true);
      typedBtn.removeEventListener('click', onTypedConfirm);
      if (confirmed) onConfirmed();
    };
    const onDocKey = (e) => { if (e.key === 'Escape') finish(false); };
    const onTypedConfirm = () => { if (!typedBtn.disabled) finish(true); };

    ring.addEventListener('pointerdown', (e) => { e.preventDefault(); ring.focus(); startHold(); });
    ring.addEventListener('pointerup', cancelHold);
    ring.addEventListener('pointerleave', cancelHold);
    ring.addEventListener('pointercancel', cancelHold);
    // Keyboard parity (AC12): Enter keydown starts, keyup cancels early /
    // completes through the same paint loop; e.repeat guards OS key-repeat.
    ring.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); startHold(); }
    });
    ring.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cancelHold(); }
    });
    document.addEventListener('keydown', onDocKey, true);
    typedBtn.addEventListener('click', onTypedConfirm);

    return {
      teardown() {
        fired = true; // teardown without firing (Cancel/Esc path)
        cancelHold();
        document.removeEventListener('keydown', onDocKey, true);
        typedBtn.removeEventListener('click', onTypedConfirm);
      },
    };
  }

  // ── Apply + progress + summary (§3.2 step 4) ───────────────────

  /**
   * Runs the apply loop UI. `source` is the preview request body
   * ({snapshot_id} or {artifact}); `artifact` (uploaded file handle) is kept
   * alongside so a failed attempt can retry byte-identically with the SAME
   * restoreId (§4.4 resume semantics).
   */
  function openProgressModal({ restoreId, expectedTables, source, mode, artifact, name, resumable, adoptOverlay }) {
    let overlay; let card; let closeOverlay;
    if (adoptOverlay) {
      ({ overlay, card, closeOverlay } = adoptOverlay);
    } else {
      overlay = buildOverlay();
      card = buildCard(480);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      closeOverlay = () => { try { overlay.remove(); } catch { /* gone */ } };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
    }

    const completedTables = new Set();
    let detachStream = () => {};

    const paint = (percent, currentTable) => {
      const pctLabel = percent == null ? 'indeterminate' : `${percent}%`;
      card.innerHTML = `
        <h3>${resumable ? 'Reattached:' : 'Restoring:'} “${escapeHtml(name || '')}”</h3>
        <p style="margin-bottom:10px;">Mode: <strong>${escapeHtml(mode)}</strong> · restoreId
          <code style="font-size:0.7rem;">${escapeHtml(String(restoreId).slice(0, 13))}…</code></p>
        <div style="background:var(--win11-surface-active); border-radius:6px; height:18px; overflow:hidden; margin-bottom:6px;">
          <div id="cp-restore-bar" style="height:100%; width:${percent == null ? '100%' : `${percent}%`};
            background:var(--win11-accent); opacity:${percent == null ? 0.4 : 1};
            ${percent == null ? 'animation:cp-spin 1.2s linear infinite;' : 'transition:width 0.3s;'}"></div>
        </div>
        <div style="font-size:0.76rem; color:var(--win11-text-secondary);">
          ${percent == null ? 'Waiting for progress frames…' : `${pctLabel} — tables completed ${completedTables.size}/${expectedTables}`}
          ${currentTable ? ` · applying <code>${escapeHtml(currentTable)}</code>` : ''}
        </div>
        <div style="font-size:0.72rem; color:var(--win11-text-tertiary); margin-top:8px;">
          You can close this panel or the window — the restore keeps running server-side.
        </div>
        <div class="cp-btn-row"><button class="cp-btn cp-btn-secondary" id="cp-restore-hide">Hide</button></div>`;
      card.querySelector('#cp-restore-hide')?.addEventListener('click', () => {
        detachStream();
        closeOverlay();
      });
    };

    const onFrame = (frame) => {
      completedTables.add(frame.table);
      paint(progressPercent(completedTables.size, expectedTables), frame.table);
    };

    async function attempt() {
      writePending({ restoreId, snapshotId: (source && source.snapshot_id) || (artifact && artifact.snapshotId) || null, name, mode, expectedTables, startedAt: readPending()?.startedAt || new Date().toISOString() });
      paint(progressPercent(0, expectedTables) ?? null, null);
      detachStream = listenRestoreProgress(restoreId, onFrame);

      const body = { ...source, mode, restoreId };
      let payload = null; let httpErr = null;
      try {
        payload = await apiPost('/api/restore/apply', body);
      } catch (err) {
        httpErr = err;
      }
      detachStream();

      // Transport-level failure (network/HTTP layer threw).
      if (httpErr) {
        renderFailure(httpErr.message);
        return;
      }
      if (payload && payload.available === false) {
        renderFailure(`unavailable: ${payload.reason || 'no_database'} — zero writes performed`);
        return;
      }
      if (payload && payload.error) {
        renderFailure(`${payload.error}${payload.details ? ` — ${payload.details}` : ''}`);
        return;
      }

      writePending(null); // terminal outcome — reattach record no longer needed
      renderSummary(describeApplyResult(payload || {}));
    }

    function renderFailure(message) {
      card.innerHTML = `
        <h3>Restore failed</h3>
        <p style="color:#ef4444; font-size:0.82rem;">${escapeHtml(message)}</p>
        <p style="font-size:0.76rem; color:var(--win11-text-secondary);">
          Tables committed before the failure stay committed (that is the resume point, not corruption).
          Retrying reuses the same restoreId and resumes at the first incomplete table.</p>
        <div class="cp-btn-row">
          <button class="cp-btn cp-btn-secondary" id="cp-restore-close">Close</button>
          <button class="cp-btn cp-btn-primary" id="cp-restore-retry">Retry resume</button>
        </div>`;
      card.querySelector('#cp-restore-close').addEventListener('click', () => { closeOverlay(); renderPending(); });
      card.querySelector('#cp-restore-retry').addEventListener('click', () => { attempt(); });
    }

    function renderSummary(outcome) {
      card.innerHTML = `
        <h3>${escapeHtml(outcome.headline)}</h3>
        ${outcome.lines.map((l) => `<p style="font-size:0.8rem; margin:4px 0;">${escapeHtml(l)}</p>`).join('')}
        <div class="cp-btn-row">
          <button class="cp-btn cp-btn-primary" id="cp-restore-done">Done</button>
        </div>`;
      card.querySelector('#cp-restore-done').addEventListener('click', () => {
        closeOverlay();
        loadList();
        renderPending();
      });
    }

    attempt();
  }

  // ── Upload entry point (§3.2 step 1) ───────────────────────────

  function pickArtifactFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      // Client-side cap mirror (§3.2 step 1); the server re-checks pre-parse (AC9).
      if (file.size > RESTORE_MAX_BYTES_DEFAULT) {
        showToast(`File too large: ${formatBytes(file.size)} exceeds the ${formatBytes(RESTORE_MAX_BYTES_DEFAULT)} restore cap.`, 'err');
        return;
      }
      let artifact;
      try {
        artifact = JSON.parse(await file.text());
      } catch {
        showToast('Not valid JSON — not an artifact?', 'err');
        return;
      }
      openRestoreModal({ file: { artifact, snapshotId: artifact && artifact.manifest && artifact.manifest.snapshot_id }, name: file.name });
    });
    input.click();
  }

  // ── Wire static controls + boot ────────────────────────────────

  root.querySelector('#cp-snap-refresh')?.addEventListener('click', loadList);
  root.querySelector('#cp-snap-create')?.addEventListener('click', createSnapshot);

  // Upload entry lives next to the list title.
  const listGroup = root.querySelectorAll('.cp-group')[1];
  if (listGroup) {
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'cp-btn cp-btn-secondary';
    uploadBtn.textContent = '📥 Restore from file…';
    uploadBtn.style.cssText = 'float:right; margin-top:-2px;';
    uploadBtn.addEventListener('click', pickArtifactFile);
    const gt = listGroup.querySelector('.cp-group-title');
    if (gt) gt.appendChild(uploadBtn);
  }

  const nameInput = root.querySelector('#cp-snap-name');
  if (nameInput && !nameInput.value) nameInput.value = defaultSnapshotName();

  loadList();
}
