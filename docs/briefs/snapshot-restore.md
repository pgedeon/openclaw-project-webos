---
layout: default
---

# Design Brief — Snapshot/Restore (Full-State Export + Restore)

**Status:** Draft for build review · **Roadmap:** Phase 2 (UPGRADE_ROADMAP.md "Snapshot/restore: one-click full-state export (tasks + runs + config) and restore, builds on export-routes" — Phase 2 opener per roadmap review #2)
**Evidence base:** existing machinery verified in-repo 2026-08-24: `routes/export-routes.js` (`GET /api/export` covers only `projects`, `tasks`, `workflows`, `audit_log` LIMIT 500 + raw settings; `POST /api/import/preview` counts rows only — no diff; `POST /api/import` merge/replace with per-row upserts in one transaction), `state_snapshots` table (migration `20260428_add_state_snapshots.sql`) = per-entity point-in-time rows for the Time Travel feature (`routes/history-routes.js`) — a *different* concept from full-state snapshots, `json_snapshot` storage mode (`storage/asana-json-snapshot.js`) = read-only fallback when PostgreSQL is down — also a different concept, both disambiguated in §1, `lib/settings-store.js` SCHEMA (typed settings incl. five `type:'password'` keys — see §5), `action_receipts` (migration 024, kind CHECK-constrained to the five action catalog kinds → NOT reusable for restore idempotency, §4.4), SSE fan-out (`routes/sse-routes.js` `/api/events/stream`), house degradation contract (`503 {available:false}` without PostgreSQL).
**Order:** docs only. No `.js/.mjs/.sql/.yml` changes in this commit. Concurrent-lane guard: coder is wiring actions slice 2 (`src/shell/native-views/tasks-view.mjs`, `agent-queue-view.mjs`, `approvals-view.mjs`, `src/shell/action-client.mjs`) — the build phase of THIS brief must not touch those files (§8 R3).

---

## 1. Purpose & Value Proposition

The dashboard's entire state lives in one PostgreSQL database plus a handful of config files, and today there is exactly one escape hatch: `GET /api/export`. It exports four tables and — worse — embeds `settingsStore.getAll()` **raw**, which includes live values for `DASHBOARD_AUTH_TOKEN`, `POSTGRES_PASSWORD`, `OPENCLAW_GATEWAY_PASSWORD`, `OPENCLAW_GATEWAY_TOKEN`, and `BING_WEBMASTER_API_KEY` (§5 R1). Its import side has no real preview (row counts only), no schema compatibility check, no idempotent replay, and no resume: a failed import mid-transaction rolls back everything and the operator starts over blind.

Snapshot/restore v1 replaces "export/import" with a **named, versioned, downloadable artifact** and a **governed restore path**:

1. **Create** — one click produces a full-state snapshot artifact: every dashboard table + non-secret settings, wrapped in a manifest carrying row counts and the exact set of applied migrations.
2. **Restore** — upload (or pick a server-side snapshot) → **dry-run diff preview** (rows added / updated / conflicted per table, computed before anything is written) → confirm → apply with progress, resumable after partial failure.

Why it matters: single-operator deployments upgrade schemas weekly (sequential migrations are a working rule), experiment with budgets/dispatcher behavior, and run long-lived content pipelines. Today a botched migration or a bad bulk edit is unrecoverable except by hand. Paperclip's revisioned rollback (79k★, market scan 2026-08-24) set the expectation; this is our scoped version of it — not per-entity undo (that's Time Travel + receipts' rollback hints), but whole-state insurance.

**Disambiguation (three things called "snapshot" in this repo):**

| Name | What it actually is | Relationship to this brief |
|---|---|---|
| `state_snapshots` table | Per-entity row history for Time Travel (`history-routes.js`), written on every mutation | Excluded from artifacts (§2); unaffected by restore |
| `json_snapshot` storage mode | Read-only fallback serving tasks/projects from a JSON file when PostgreSQL is unreachable | Unaffected; snapshots require DB to create/apply (§4.5) |
| **This feature** | Full-state export artifact + governed restore | — |

---

## 2. Scope Matrix v1

A snapshot is a **JSON artifact**, not database rows (decision in §6). Contents fixed at v1:

### 2.1 IN — captured per snapshot

Manifest always records `counts[table]` (exact row count at creation) and `schema_version` (the full list of applied migration names from `schema_migrations` + generator version).

| Tier | Tables | Why |
|---|---|---|
| A — core state | `workflows`, `projects`, `tasks`, `workspaces`, `saved_views`, `departments`, `agent_profiles` | The board an operator would need to reconstruct first |
| B — workflow engine | `workflow_runs`, `workflow_steps`, `workflow_approvals`, `workflow_templates`, `workflow_agent_routing`, `workflow_artifacts` (**rows only** — `uri` points at files on disk, files themselves OUT, §2.2) | Roadmap says "tasks + runs"; runs without steps/approvals is half a state |
| C — governance & money | `budgets`, `budget_events`, `action_receipts`, `audit_log` (complete — no LIMIT 500 truncation) | Budget rules and the audit trail are state; losing them defeats "full-state" |
| D — service & metrics | `service_catalog`, `service_requests`, `department_daily_metrics`, `task_runs`, `cron_job_runs`, `agent_heartbeats` | Small tables; completeness beats special-casing |
| E — settings | Non-secret UI/runtime preferences ONLY: every `settings-store.js` SCHEMA key with `source:'config'` (theme, accentColor, wallpaper, windowSnap, rememberWindowPositions, fontSizeBase, showClock, clock24h, showWidgets, taskbarOpacity, disabledApps, quickLaunchApps, CHAT_RATE_LIMIT, MAX_MESSAGE_LENGTH, SSE_MAX_CLIENTS, API_LOG_LEVEL, SSE_HEARTBEAT_INTERVAL, MESSAGE_PAGINATION_LIMIT) | Config per roadmap. Env-source keys excluded wholesale: machine-specific AND secret-adjacent (§5) |

### 2.2 OUT — explicitly excluded, with reasons

| Excluded | Reason |
|---|---|
| **Secrets of any kind** — all `type:'password'` settings keys, any key matching the deny-regex, nested secret-looking keys inside JSONB | Hard policy, §5. Never serialized, not even redacted placeholders for password-type settings keys (absence, not `[REDACTED]`, for settings; `[REDACTED]` only for incidental matches found in JSONB data) |
| `.env` and `dashboard-config.json` as files | Contain credentials; env keys are machine-specific anyway — restoring them cross-instance would be silent misconfiguration |
| Gateway session transcripts (`~/.openclaw/agents/<agent>/sessions/*.jsonl`) | Belong to OpenClaw, not the dashboard DB; huge; already have their own retention. Session replay reads them live — no backup claim |
| Files referenced by `workflow_artifacts.uri` | Binary/blob backup is a non-goal (§7); rows carry the metadata + pointer |
| `state_snapshots` rows | Internal time-travel machinery; regenerated by future mutations; porting them would corrupt as-of-t semantics and dominate artifact size |
| `schema_migrations` rows | Never restored — read at restore time for the compat check (§4.3); target owns its own migration state |

---

## 3. UX Flow

All operator surfaces live in a new **"Snapshots & Restore" panel inside the existing Settings app** — no new windowed app (app-registry count, README count, views-reference table stay frozen; same call one-click-actions made for its tray).

### 3.1 Create snapshot
1. Settings → Snapshots & Restore → name input (default `snapshot-YYYYMMDD-HHmm`) → **Create snapshot** button.
2. Button disabled while generating; server serializes all tiers in one pass, writes the artifact atomically (tmp + rename into `storage/snapshots/<snapshot_id>.json`), returns the manifest.
3. Panel lists server-side snapshots newest-first (name, created_at, total rows, size). Each row: **Download** (artifact JSON as attachment) and **Restore…** (pre-fills the upload flow with the server-side copy).
4. Toast on success shows total row count; failure keeps prior list untouched (zero-throw panel states: loading / empty / error-retry, house pattern).

### 3.2 Restore
1. **Upload**: file picker (or "use server-side snapshot"). Client enforces size cap pre-upload (§4.5); server re-checks pre-parse.
2. **Dry-run diff preview** (nothing written yet): manifest validation result, schema-compat verdict (§4.3), and a per-table grid — *added / updated / conflicts / unchanged* counts, expandable to sample PKs. Conflicts defined in §4.2. Mode selector: **Merge (default)** vs **Replace**.
3. Choosing **Replace** flips the modal to the **HOLD_CONFIRM pattern from the one-click-actions brief §3.2** (press-and-hold ≥1.2 s, progress ring, release early = nothing fires; keyboard hold parity + typed-confirm fallback pinned as AC12). Merge confirms with a plain PREVIEW_MODAL-style Confirm. The preview must also show the rollback move *before* confirming: "Re-create a snapshot of the current state first" — the create flow is one click away and is the honest rollback hint for a destructive restore.
4. **Apply with progress**: SSE `restore-progress` frames on the existing `/api/events/stream` channel (`{restoreId, table, doneRows, totalRows}` per completed table batch) drive a determinate progress bar; closing the panel does not cancel the apply. On completion: summary card (rows upserted/deleted/skipped per table) persisted with the restore record; on resume-after-refresh the client reattaches by `restoreId`.

---

## 4. Data Contract

### 4.1 Endpoints (new `routes/snapshot-routes.js`, registered in `task-server.js`)

| Endpoint | Does | Degradation (no PostgreSQL) |
|---|---|---|
| `POST /api/snapshots` `{name}` | Serialize all §2.1 tiers + redaction pass (§5) → atomic write → `201 {snapshot_id, manifest}` | `503 {available:false, reason:'no_database'}` |
| `GET /api/snapshots` | Disk index scan of `storage/snapshots/*.json`, manifests newest-first | **Works** — disk-only |
| `GET /api/snapshots/:id/download` | Artifact stream, `Content-Disposition: attachment`; `404` unknown id | **Works** — disk-only |
| `POST /api/restore/preview` `{artifact}` or `{snapshot_id}` | Validate manifest → version-compat check → diff vs live DB (read-only) → `{schema_compat, warnings, tables:{<name>:{added,updated,conflicts,unchanged}}, totals}` | `503 {available:false}` |
| `POST /api/restore/apply` `{artifact \| snapshot_id, mode:'merge'\|'replace', restoreId, confirm?}` | Latch + checkpoint (§4.4) → per-table transactional apply → summary | `503 {available:false}`, zero writes |

Plus additive SSE event `restore-progress` on the existing stream. No new REST surface beyond the five endpoints. Size cap: requests larger than `RESTORE_MAX_BYTES` (default 100 MB) rejected `413` **before** `JSON.parse` (AC9).

### 4.2 Artifact format (v1)

```jsonc
{
  "manifest": {
    "artifact_version": 1,
    "snapshot_id": "<uuid>",
    "name": "snapshot-20260824-1536",
    "created_at": "<ISO>",
    "actor": "dashboard-operator",
    "generator": "openclaw-project-webos <version>",
    "schema_version": { "migrations_applied": ["001_add_workflow_runs", "..."], },
    "counts": { "tasks": 123, "workflow_runs": 45, "...": 0 },
    "content_hash": "sha256(canonicalJSON(tables+settings))" // integrity check at preview
  },
  "tables": { "workflows": [ /* full rows */ ], "projects": [ /* ... */ ] },
  "settings": { "theme": "dark" /* config-source keys only, post-redaction */ }
}
```

Diff classification (pure function, §6): per table, keyed by PK column —
- **added**: PK absent from current DB;
- **updated**: PK present, canonical row hash differs, DB row `updated_at` ≤ artifact `created_at`;
- **conflict**: PK present, hash differs, DB row changed *after* the snapshot was taken (`updated_at` > `created_at`) — live divergence the operator must see;
- **unchanged**: identical hash.

Apply semantics: **merge** (default) upserts added+updated+conflict rows by PK, never deletes; **replace** additionally deletes rows absent from the artifact, per table, in FK-safe reverse order — destructive, gated (§3.2 step 3). Insert/update order follows the dependency chain `workflows → projects → tasks → workflow_runs → workflow_steps → workflow_approvals → workflow_artifacts → …` (fixture-pinned, AC10).

### 4.3 Schema-version compatibility

Rule: **refuse restore from newer, warn into older.**
- Artifact lists migration names absent from target `schema_migrations` → preview and apply return `409 {error:'schema_too_new', missing:[...]}`; apply refuses outright.
- Target ahead of artifact (applied migrations the artifact doesn't know) → allowed, preview sets `warnings:['target_newer']` — additive migrations are assumed safe; this assumption is documented here and asserted by AC2 fixtures.
- Content-hash mismatch between manifest and payload → `400 {error:'artifact_corrupt'}` before any diffing.

### 4.4 Idempotency + resume on partial failure

`action_receipts` was considered and rejected: its `kind` CHECK enumerates only the five catalog kinds; widening it needs a migration and couples two features. Instead, restore idempotency is **file-backed and therefore DB-free-testable**:

- Client mints `restoreId` (UUID) once per confirmed intent — same semantic as the actions envelope's `actionId`.
- Server checkpoint file `storage/snapshots/<restoreId>.resume.json`: `{restoreId, snapshotId, mode, completedTables:[...], startedAt, lastError?}` written after each fully-applied table.
- Re-POST with the same `restoreId`: if a completed-marker file exists → return the stored summary with `{duplicate:true}`, execute nothing; if a checkpoint exists → resume at the first incomplete table (completed tables skipped).
- **Half-applied table invariant (pinned, AC6):** checkpoints track *tables*, not rows; a crashed table re-applies from scratch — safe because every row write is a PK upsert (idempotent by construction, same property `POST /api/import` already relies on). Replace-mode deletes for a resumed table re-run identically.
- Crash between table transactions leaves prior tables committed — that is the resume point, not corruption.

### 4.5 Progress

Per-table batches (~500 rows) inside one transaction per table; after each table the checkpoint advances and one `restore-progress` SSE frame fans out. Clients that miss frames degrade to the final summary (progress bar is convenience, not correctness).

---

## 5. Secrets Policy (hard)

1. **Dynamic exclusion at the source:** settings section of an artifact is built from `settings-store.js` SCHEMA keys where `source === 'config'` ONLY. Every `type:'password'` key (`DASHBOARD_AUTH_TOKEN`, `POSTGRES_PASSWORD`, `OPENCLAW_GATEWAY_PASSWORD`, `OPENCLAW_GATEWAY_TOKEN`, `BING_WEBMASTER_API_KEY`) and every other env-source key is structurally absent — derived from the SCHEMA at runtime so future settings additions can't silently leak.
2. **Defense-in-depth deny-regex pass over the whole artifact** before serialization (`lib/snapshot-redact.js`, pure): recursive walk over every JSONB cell; any object key matching `\b(password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential)\b` (case-insensitive, word-boundary so `keyboard`/`monkey` don't trip — fixture-pinned, AC3) has its value replaced with `"[REDACTED]"`. Keys keep their names (structure stays restorable); values die.
3. **Import side:** restoring settings skips absent keys silently and never accepts a settings section containing password-type keys — if one appears (hand-edited artifact), the whole settings section is dropped and a warning surfaced, rather than partially trusting it.
4. **Invariant test (AC13):** generated fixture artifact containing known marker strings (`hunter2`, `sk-live-…`) greps clean.

**Found during study (R1):** the *existing* `GET /api/export` embeds `settingsStore.getAll()` raw — all five password values ship in plain text today. Fixing that route is a ~10-line retrofit of the same redaction helper; it belongs in this build's slice 1 but touches `routes/export-routes.js`, which the concurrent lane does not own — sequencing in §8 R1/R3.

---

## 6. File Plan & Migration Decision

**Migration needed: NONE.** Decision: snapshots are **artifacts, not rows** — a registry table would duplicate what the filesystem already provides, add a migration + schema-reference/docs burden, and create a second source of truth. Server-side registry = directory listing of `storage/snapshots/*.json` (inside the repo tree — same-volume tmp+rename stays atomic on Windows/WSL mounts, §8 R6). Restore idempotency rides the checkpoint files (§4.4), not a table.

| File | New/Existing | Role |
|---|---|---|
| `lib/snapshot-manifest.js` | New | Pure: `buildManifest(rowsByTable, settings, migrationsApplied)`, `validateManifest`, `compareSchemaVersions(artifactMigrations, targetMigrations)` → `{verdict:'ok'\|'too_new'\|'target_newer', missing[]}` |
| `lib/snapshot-diff.js` | New | Pure: `canonicalRowHash(row)`, `classifyRows(artifactRows, currentRows, pkColumn, createdAt)` → `{added, updated, conflicts, unchanged}` |
| `lib/snapshot-redact.js` | New | Pure: `redactSettings(getAllOutput)` (config-source filter), `redactDeep(obj)` (deny-regex walk) |
| `routes/snapshot-routes.js` | New | Five endpoints, degradation contract, size cap, checkpoint/resume orchestration, SSE emission |
| `task-server.js` | Existing, 1 line | Route registration (**shared-file risk**, §8 R3) |
| `src/shell/native-views/settings-view.mjs` | Existing | Snapshots & Restore panel (create/list/download/restore UX, §3) — **shared-file risk**, no overlap with coder's current four files |
| `tests/test-snapshot-lib.js` | New | DB-free suites for all three pure libs (AC1–AC4, AC13) |
| `tests/test-snapshot-routes.js` | New | Route fixtures in the `test-export-routes.js` response-capture style (AC5–AC12) |
| Docs | Existing | `docs/api-reference-complete.md` Snapshots API section + TOC; `docs/schema-reference.md` gains a note explaining why NO new tables exist; admin-guide backup/restore section |

Build sequence: slice 1 = three pure libs + tests (zero shared files, lands anywhere); slice 2 = routes + registration + route tests; slice 3 = settings-view panel + docs. QA gate: qa-auditor tests each slice against these ACs.

---

## 7. Explicit Non-Goals (v1)

- **No scheduled auto-snapshots.** Manual, operator-initiated only; cron-driven capture is a v2 decision needing retention policy work.
- **No cross-instance migration tooling claims.** Artifacts restore best-effort onto same-or-older schemas; we do not promise instance-to-instance moves (env keys, file paths, and gateway identity differ).
- **No binary/blob backup.** `workflow_artifacts.uri` targets, uploaded images, any filesystem payload outside PostgreSQL — out.
- **No gateway session transcript backup.**
- **No incremental/delta snapshots.** Every snapshot is full-state; dedupe/compression later if size demands.
- **No artifact encryption at rest.** Redaction makes artifacts secret-free; encryption is an open question (§8 Q1), not a v1 promise.
- **No new windowed app; no RBAC changes** (single-operator reality, unchanged).

---

## 8. Risks & Open Questions

- **R1 — Live secret leak in `GET /api/export` (found during study, highest priority).** `settingsStore.getAll()` returns password-type values and the export embeds them verbatim. Any operator who downloaded an export today has tokens on disk. Mitigation: slice 1 retrofits `redactSettings` into `routes/export-routes.js` (tiny diff, big blast radius) — sequenced behind the concurrent actions-slice-2 lane landing, since both touch `.js` under `routes/`. Until then, docs should not advertise the old endpoint.
- **R2 — Artifact growth.** Full `audit_log` + `workflow_runs` + `state_snapshots`-free but still historical-heavy tables grow unbounded; v1 ships sizes honestly in the list UI and documents the 100 MB restore cap; pruning high-volume telemetry (`agent_heartbeats`, `cron_job_runs`) from snapshots is a deliberate v2 lever if artifacts balloon.
- **R3 — Concurrent-lane collisions.** This commit is docs-only. Build phase shares exactly two files with other lanes: `task-server.js` registration line (actions slice 1 already landed theirs; coordinate landing order like budget slice 2 did) and `settings-view.mjs` (coder's current four files are disjoint — verified). No `.sql` at all.
- **R4 — Restore-vs-live-writer races.** Dispatcher, gateway sync, and cron mutate rows during a long apply; merge-mode upserts make the window benign (last-writer-wins per row), replace-mode deletes can race inserts. V1 mitigation: preview warns when dispatcher stats show active runs; enforcement (auto-pause around apply) is Q2.
- **R5 — Partial-failure ambiguity.** Pinned by the §4.4 half-applied-table invariant + AC6; receipt-style summary distinguishes `resumed` from fresh applies so operators never guess what ran.
- **R6 — Windows/WSL atomicity.** Repo lives on `/mnt/c` (DrvFs); atomic rename within one directory holds, but tmp files must never cross devices — artifacts dir is self-contained by design; fixture asserts tmp+rename path handling.
- **Q1 — Encrypt artifacts at rest?** They're secret-free by §5 but contain full business state. Default no (single-operator disk); CEO call.
- **Q2 — Enforce dispatcher pause during replace-apply** (server-side flag consulted by the dispatcher) vs document-only "pause first"? Enforcement is safer; adds coupling to budget-enforcement pause machinery.
- **Q3 — Retention:** propose keep-last-20 artifacts with housekeeping on create; owner + number needed.
- **Q4 — Fold R1's export-leak fix into this build or hotfix immediately?** Recommendation: hotfix-sized, but gated on the concurrent lane; either way it must land before this feature's announcement.

---

## 9. Acceptance Criteria

Consolidated from the pins in §3–§5. qa-auditor tests each build slice against these. AC1–AC4 + AC13 run in `tests/test-snapshot-lib.js` (DB-free); AC5–AC12 in `tests/test-snapshot-routes.js`.

- **AC1** — `buildManifest` emits `artifact_version`, `snapshot_id`, `name`, `created_at`, `actor`, `generator`, `schema_version.migrations_applied`, and `counts[table]` equal to exact row counts; `validateManifest` rejects artifacts missing any of these (§4.2).
- **AC2** — `compareSchemaVersions` returns `{verdict:'too_new', missing:[...]}` when the artifact names migrations absent from the target, and `{verdict:'target_newer'}` (preview surfaces `warnings:['target_newer']`) when the target is ahead (§4.3).
- **AC3** — `redactDeep` replaces values of keys matching `\b(password|passwd|secret|token|api[_-]?key|apikey|auth[_-]?token|credential)\b` case-insensitively with `"[REDACTED]"`, and leaves `keyboard`/`monkey` untouched (word-boundary fixture, §5.2).
- **AC4** — `classifyRows` buckets each row by PK + canonical hash + `updated_at` vs artifact `created_at` into exactly added / updated / conflict / unchanged per §4.2.
- **AC5** — `POST /api/snapshots` writes `storage/snapshots/<snapshot_id>.json` atomically (tmp+rename) and returns `201 {snapshot_id, manifest}`; `GET /api/snapshots` lists manifests newest-first; `/download` streams with `Content-Disposition: attachment`; unknown id → `404` (§3.1, §4.1).
- **AC6** — Resume invariant: re-POST with the same `restoreId` after partial apply resumes at the first incomplete table (completed tables skipped, crashed table re-applied from scratch); a completed restore returns the stored summary with `{duplicate:true}` executing nothing (§4.4).
- **AC7** — Degradation contract: without PostgreSQL, create/preview/apply return `503 {available:false}` with zero writes, while `GET /api/snapshots` and `/download` still serve from disk (§4.1).
- **AC8** — An artifact whose payload fails the manifest `content_hash` check is rejected `400 {error:'artifact_corrupt'}` before any diffing or writes (§4.3).
- **AC9** — Restore requests larger than `RESTORE_MAX_BYTES` (default 100 MB) are rejected `413` before `JSON.parse` (§4.1).
- **AC10** — Apply order follows the pinned dependency chain `workflows → projects → tasks → workflow_runs → workflow_steps → workflow_approvals → workflow_artifacts → …` (fixture asserts insertion order, §4.2).
- **AC11** — Merge mode upserts added+updated+conflict rows by PK and deletes nothing; Replace mode additionally deletes rows absent from the artifact, per table, in FK-safe reverse order (§4.2).
- **AC12** — Replace confirm uses HOLD_CONFIRM: press-and-hold ≥1.2 s with progress ring, early release fires nothing, keyboard hold parity and typed-confirm fallback both work (§3.2).
- **AC13** — A generated fixture artifact seeded with marker secrets (`hunter2`, `sk-live-…`) greps clean: no marker string appears anywhere in the serialized output (§5.4).

## Related

- [One-click actions brief](one-click-actions.md) — HOLD_CONFIRM pattern (§3.2) reused for destructive restore; envelope/idempotency semantics mirrored by `restoreId`
- [Budget ledger brief](budget-ledger.md) — degradation contract copied for the five endpoints
- [Roadmap](../../UPGRADE_ROADMAP.md) — Phase 2 "Snapshot/restore"
