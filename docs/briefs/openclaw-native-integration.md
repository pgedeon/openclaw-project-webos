---
layout: default
---

# Brief: OpenClaw-native integration of the WebOS desktop (owner request 2026-09-09)

**Status:** APPROVED — owner ruling 2026-09-19 15:40 CEST (chat); Phase 0 research authorized.
**Author:** CEO seat (ZCode), research against OpenClaw **2026.9.3** installed in WSL.
**Owner:** Rosa. **Target:** make the OpenClaw Project WebOS desktop feel native to OpenClaw's own web app (Control UI + Workboard), not a separate dashboard on a separate port with a separate token.

---

## 1. Why

The desktop (v2.2.0, staging :8120) and OpenClaw (2026.9.3) grew in parallel. OpenClaw now ships a Control UI with a Workboard tab, durable tasks, automations, session inspection, notify events, and a plugin economy. The desktop mirrors some of this (gateway bridge for console/budget alerts, session JSONL replay, its own PostgreSQL task store) and lives on its own origin with its own bearer token. The owner wants ONE web experience: open the OpenClaw web app, and the desktop is there — same login, same nav, same data.

## 2. Pinned facts (verified against installed 2026.9.3 source)

- **Gateway serves the Control UI**: `https://127.0.0.1:18789/openclaw/` (loopback bind; TLS self-signed, CA at `/root/.openclaw/certs/ca-bundle.pem`). Already exposed externally at `home.3dput.com/openclaw/` (that is where the Workboard is used today). Auth = gateway token (bootstrap-token URL flow, `openclaw dashboard --json`), profiles + scopes.
- **Plugins register Control UI surfaces**: `api.session.controls.registerControlUiDescriptor({ surface: "tab" | "widget", id, label, placement: "route:workboard", icon, group, requiredScopes: ["operator.read"] })` — Workboard is literally a tab descriptor with its Lit bundle under `dist/control-ui/`. A plugin can also ship static assets (`assets/`).
- **Workboard RPC** (gateway WS, from the plugin manifest): `workboard.cards.list`, `workboard.cards.stats`, `workboard.boards.list`, `workboard.cards.dispatch`; 35 agent tools (`workboard_list/create/claim/heartbeat/complete/proof/...`); **notify events** (`workboard_notify_subscribe/advance`) for live updates; CLI `openclaw workboard create|list|show|move|dispatch`.
- **Our existing bridge**: task-server already speaks gateway WS protocol 4 as a backend client (console feed, budget breach events) — the same transport the Control UI uses.
- **Our no-build constraint fits**: the desktop shell is vanilla ES modules; a plugin serving static assets needs zero build step.

## 3. Target picture

`https://<gateway>/openclaw/#desktop` (and `home.3dput.com/openclaw/desktop`) opens the full WebOS desktop as a **tab in the Control UI**, next to Workboard — same gateway token, same scopes, same origin. Inside the desktop, a Workboard app renders real cards (read via `workboard.cards.list` + notify subscribe), automations and durable tasks are first-class windows, and the desktop's own PPM store (projects/tasks/budgets) remains the governance layer — connected, not duplicated.

## 4. Phases (each = one workboard card, staging-verified)

### Phase 0 — Protocol spike (research card, product-planner or dashboard-manager)
Pin the remaining gateway facts by reading 2026.9.3 sources + live probing:
1. Can a `surface:"tab"` descriptor host **plugin-served static HTML** (iframe or asset route), or does tab content have to be a Lit component in the bundle? (Workboard ships `dist/control-ui/<hash>/` — find the serving rule.) This decides the embedding mechanics.
2. Exact auth envelope for WS RPC from a tab (token propagation inside Control UI origin).
3. `workboard.cards.list` row shape + notify event contract (subscribe payload, advance semantics).
4. Extension packaging: minimum `openclaw.plugin.json` for an asset-serving extension installed into `~/.openclaw/extensions/` (the `dashboard-bridge` local extension is our in-tree precedent).
**Deliverable:** `docs/briefs/openclaw-native-integration-phase0-findings.md` with pinned facts + any contract mismatches. **No code.**

### Phase 1 — Gateway data layer + Workboard window (read-only, coder)
- New `src/shell/gateway-rpc.mjs` (browser-side, extends api-client): gateway WS RPC client calling `workboard.cards.list/stats`, `workboard.boards.list`, durable tasks, automations list; live refresh via notify subscribe.
- New **Workboard app** (`native-views/workboard-view.mjs`, registered in APP_REGISTRY): columns by status, card detail drawer (title/agent/labels/proof links/heartbeat age), board filter. Read-only; "open in Workboard" deep-links to the Control UI tab.
- DB-free degradation: window shows gateway-unavailable state when the bridge is down (house contract).
- Tests: fake-RPC harness (like tests/test-mcp-adapter.js) + docs/views-reference.md entry.

### Phase 2 — Native placement (the headline; coder + dashboard-manager QA)
- New repo-local OpenClaw extension `openclaw-webos/` (installed to `~/.openclaw/extensions/`): serves the desktop shell as static assets and registers `surface:"tab", placement:"route:desktop"` per Phase 0 findings (iframe of plugin-served index.html if static hosting is supported; otherwise a thin Lit wrapper component that mounts our ES modules — still no repo build step, the wrapper ships as a single hand-written module).
- task-server stays the data backend on dev (LAN) — the tab's fetches go to it via the existing staging URL (or same-host proxy if Phase 0 proves one is needed).
- Desktop's own token gate becomes optional when served from the gateway origin (gateway auth already happened) — controlled by env, default unchanged elsewhere.
- Acceptance: tab reachable at `home.3dput.com/openclaw/desktop`, full desktop boots, Workboard window live-updates, no second login.



**Phase 2 status (2026-11-20):** tab installed and rendering at `/openclaw/desktop` (card `6add2b28`/`610799d6`). Phase 2 acceptance item **"Workboard window live-updates"** closed by card `webos:openclaw-native-integration:phase2.5:tab-live-refresh:v1` — the tab now runs a bounded (8s) loop of `workboard.notifications.events` + separate `workboard.notifications.advance` (`subscriptionId`, 2026.11.3) plus a `workboard.cards.list` `sinceRevision` sentinel, with an honest `live updates unavailable` degrade chip. Proved live in headless Chrome: real heartbeat rendered with no Refresh click. **Remaining Phase 2 gap:** the tab mounts only the Workboard view, not the full desktop shell — tracked by card `webos:openclaw-native-integration:phase2.6:full-desktop-shell-tab:v1` (scope in §2.6 below).

### Phase 2.6 — Full desktop shell in the tab (coder; closes the Phase 2 acceptance gap)

- **Deliverable:** the Control UI tab at `/openclaw/desktop` boots the full desktop shell (window manager, taskbar, Workboard window plus at least one `:8120`-backed view), keeping the Phase 2.5 bounded live-refresh loop and its honest `live updates unavailable` degrade chip. Vanilla ES modules, no build step; staging-first.
- **Step 0 — first-hand transport proof decides the branch.** Enumerate every network/auth dependency of the shell (`task-server :8120`, `DASHBOARD_AUTH_TOKEN`, absolute URLs, EventSource) and prove from the gateway origin what the tab can do without new gateway config (CORS preflight on `:8120`, token without a second login, iframe/srcdoc/direct-mount mechanics). Attach raw `curl -i` / console evidence.
  - **(a)** Boot possible with existing approved surfaces → implement it.
  - **(b)** Boot needs a NEW gateway config change (plugin HTTP route, proxy unit, `:8120` CORS, token injection) → **stop before changing it** and deliver `docs/briefs/openclaw-native-integration-phase2.6-transport-findings.md`: the blocking fact with file:line or response headers, 1–2 candidate transports with blast radius, and a recommended minimal option. The gateway change becomes a separate owner-approval card.
- **Owner gate:** the 2026-09-19 Phase 2 approval covers updating the already-installed extension in place; any new gateway config/route/credential change is owner-reserved. Phase 4 de-dup stays a separate owner checkpoint and is out of scope here.
- **Acceptance:** first-hand boot proof from the gateway origin (headless Chrome: shell + taskbar + ≥2 windows, one `:8120`-backed), honest unavailable state when `:8120` is down, `node scripts/ci-db-free-tests.js` and `node scripts/docs-drift-check.js` green, CHANGELOG + this brief + `openclaw-webos/README.md` updated in the same commit, served md5 of changed assets equals the dev checkout after an honest staging restart.
- **Tracker card:** `webos:openclaw-native-integration:phase2.6:full-desktop-shell-tab:v1` (card `cef78f32`); independent QA follows as `webos:openclaw-native-integration:phase2.6:qa:v1` (card `ade4b11c`, todo until the impl has proof).

**Phase 2.6 status (2026-11-22):** full-shell boot in the gateway tab investigated first-hand and **stopped at Branch B** (card `cef78f32-40c7-4493-837f-c600bf63dddb`). Findings: `docs/briefs/openclaw-native-integration-phase2.6-transport-findings.md`. The tab cannot boot the shell without a transport/security change: (1) `:8120` returns `Access-Control-Allow-Origin: http://localhost:8120` for every origin (no `Vary: Origin`), so the Control UI origin is blocked; (2) the desktop token is env-only and the page gates boot on a manual token prompt (`localStorage` `openclaw.dashboardToken`) — there is no gateway→task-server token exchange, and the gateway process does not carry `DASHBOARD_AUTH_TOKEN`; (3) the gateway is HTTPS-only while `:8120` is plain HTTP (mixed content), and the plugin asset route serves only `.js`/`.css` (2026.11.3 `dist/control-ui-assets-DErxGcit.mjs:25`), not HTML or `/api` proxies. The Workboard-only tab and `:8120` link remain the honest fallback. A plugin `registerHttpRoute` seam exists but still needs the task-server token server-side and path rewriting for `/src/*` and `/api/*`; those are owner-gated changes. Follow-up Branch A requires an owner-approved card deciding transport (same-origin proxy vs TLS/CORS), token (gateway identity vs server-side injection), and shell base-path strategy. No code or config changed.

### Phase 3 — Write-back through governed paths (coder, after Phase 2 soak)
- Card actions from the desktop (create/move/dispatch) via `workboard.cards.dispatch` + CLI-equivalent RPC where the contract allows; every mutation keeps ONE registry (workboard) — the desktop stops maintaining a parallel agent-queue mirror.
- MCP alignment: `get_mission_control_summary` gains workboard section; the flagship tool reflects the same board the tab shows.

**Phase 3a status (2026-11-20):** governed card move shipped in the native window (`webos:openclaw-native-integration:phase3a:governed-card-move:v1`). ONE mutation only — `workboard.cards.move` via `allowedMoveTargets(fromStatus)` (`todo`/`ready`/`blocked`/`review`) behind an inline confirm, with `done`, `running`/claim transitions, and unknown statuses refused client-side (`move-refused`) and scope/auth rejections degraded to `gateway-scope-rejected`. No dispatch, start, complete, delete, local task-store writes, or parallel queue mirror. Remaining Phase 3 scope: dispatch/start/create actions once each has its own governance card.

**Phase 3b status (2026-11-20):** governed card dispatch shipped in the native window (`webos:openclaw-native-integration:phase3b:governed-dispatch:v1`). ONE mutation only — `workboard.cards.dispatch` via `allowedDispatchSources(status)` (`ready` only, card must be unclaimed) behind an inline confirm, with every non-ready source, unknown status, and claimed card refused client-side (`dispatch-refused`) and scope/auth rejections degraded to `gateway-scope-rejected`. Single registry kept: no local task-store writes, no parallel queue mirror, no `openclaw-webos/` bundle change. Remaining Phase 3 scope: start/create actions once each has its own governance card.

**Phase 3c status (2026-11-21):** governed card start shipped in the native window (`webos:openclaw-native-integration:phase3c:governed-start:v1`). ONE mutation only — `workboard.cards.start` (`{id, boardId?}`) via `allowedStartSources(status)` (`backlog`/`todo`/`ready`, card must be unclaimed) behind an inline confirm, with every non-startable source, unknown status, and claimed card refused client-side (`start-refused`) and scope/auth rejections degraded to `gateway-scope-rejected`. Contract pinned first-hand to the installed gateway plugin runtime registration (`runtime-api-DMwKfCWV.mjs:3459`, `operator.write`; `selectStartableCards` mode `exact` at :2888). Single registry kept: no local task-store writes, no parallel queue mirror, no `openclaw-webos/` bundle change, no agent launch outside the gateway RPC. Remaining Phase 3 scope: create action once it has its own governance card.

**Phase 3d status (2026-11-21):** governed card create shipped in the native window (`webos:openclaw-native-integration:phase3d:governed-create:v1`). ONE mutation only — `workboard.cards.create` via the pure `normalizeCreateInput` whitelist (`title` required, optional `notes`/`priority`/`labels`/`status`) behind an inline confirm, with a missing title, an unknown field (including a top-level `boardId`, which the gateway ignores on create), an over-limit field, or a status outside `CREATABLE_STATUSES` (`triage`/`backlog`/`todo`/`ready`) refused client-side (`create-refused`) and scope/auth rejections degraded to `gateway-scope-rejected`. Contract pinned first-hand to the installed gateway plugin runtime registration (`runtime-api-DMwKfCWV.mjs:3450`, `WRITE_SCOPE`/`operator.write` at :3315-3316; `createDirect` at :1442-1500; reply `{card}` at :3371-3373). The `.owner` variant is CLI-owner-only and is never called. Single registry kept: no local task-store writes, no parallel queue mirror, no `openclaw-webos/` bundle change, no agent launch outside the gateway RPC; the created card is not auto-started or dispatched. Phase 3 write-back scope is now complete (move/dispatch/start/create).

### Phase 4 — De-duplication review (product-planner, owner checkpoint)
- Map desktop tasks/projects vs workboard cards vs durable tasks; propose which stores remain (owner decides). Retire mirrors that lost their reason. Update positioning docs.

## 5. Constraints (binding)

- Repo stays vanilla JS ES modules, no build step; the extension wrapper (if needed) is one hand-written Lit module — Lit ships with the gateway, not added to our build.
- Migrations sequential/immutable; DB-free degradation everywhere.
- Staging-first (:8120 + gateway on dev/WSL); no production writes; owner gates preserved (Amendment 10; tailnet/NL-bar items untouched).
- Work executes as workboard cards under the 2026-09-09 automation contract (max queue ceilings, proof, heartbeat); this brief is the scope source.
- Gateway plugin installation on the WSL gateway is an infra change → owner approval note in Phase 2 card.

## 6. Risks / open questions

- **Tab content mechanics** (static vs Lit-bundle) — resolved in Phase 0; it is the only structural unknown.
- Control UI bundle updates across OpenClaw upgrades may change the descriptor API — pin version checks in the extension (fail loud, degrade to :8120 link).
- home.3dput.com exposure already exists for the Control UI; desktop tab inherits it — confirm with owner that the desktop should be internet-reachable there (today :8120 is LAN-only).
- Workboard RPC scope requirements (`operator.read/write`) map cleanly to the single-operator model — verify against the bootstrap profile.

## 7. Next step

Owner approves (or edits) this plan → Phase 0 card queued on the workboard (agent: product-planner or dashboard-manager), Phase 1 prepared behind it. No work starts before approval.
