---
layout: default
---

# OpenClaw Native Integration — Phase 0 Protocol Research Findings

Source: OpenClaw **2026.9.4** (installed at `/usr/lib/node_modules/openclaw`; `package.json` `"version": "2026.9.4"`). RESEARCH ONLY — no code written. All facts pinned to real source (file/function/route). Contract mismatches named at end.

## 1. Can a `surface:tab` descriptor host plugin-served static HTML (iframe/asset route) vs Lit-component-in-bundle?

**Answer: YES — a `surface:tab` descriptor can host plugin-served static HTML via the plugin Control UI asset route.** The plugin's browser bundle (Lit component) is served from the same hashed asset route; a tab surface mounts a Lit component that can itself embed an `<iframe>` pointing at any same-origin asset URL served by the plugin asset route.

### 1a. Plugin Control UI asset serving rule (the `dist/control-ui/<hash>/` route)

- **Route**: `GET|HEAD {basePath}/__openclaw__/plugins/control-ui/{pluginId}/{revision}/{file...}`
  - Source: `dist/route-match-lmCNif6v.mjs`:
    - `controlUiPluginAssetRoot(basePath)` → `${normalizeControlUiBasePath(basePath)}/__openclaw__/plugins/control-ui/` (line 37-38)
    - `controlUiPluginAssetPrefix(pluginId, basePath)` → `${root}${encodeURIComponent(pluginId)}/` (line 40-41)
- **Revision** = `sha256` digest of `JSON.stringify(declaration)` + every asset `name\0len\0body` (in sorted order). Source: `dist/control-ui-plugin-assets-BR1PXkvy.mjs` `snapshotBrowserBuild()` (lines ~44-49): `revision = digest.digest("hex")`.
- **Serving handler**: `dist/control-ui-plugin-assets-BR1PXkvy.mjs` `handleControlUiPluginAssetRequest()` (lines ~178-229):
  - Path segments: `[pluginId, revision, ...fileParts]`; `revision` must match `/^[a-f0-9]{64}$/u` (64-hex).
  - Auth: scoped plugin cookie OR `authorizeControlUiReadRequestOrReply` (see §2).
  - Serves only snapshot bytes from the in-memory browser catalog; `Cache-Control: private, no-cache`; `X-Content-Type-Options: nosniff`.
- **Asset discovery**: `dist/control-ui-assets-Chx5wPxj.mjs` `readPluginControlUiAssets(rootDir, declaration)`:
  - Walks the `dist/` subdir of the plugin root (max depth 8, max 128 entries, max 8 MiB build, 4 MiB/asset).
  - Only files matching `/^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:m?js|css)$/u` are served (JS + CSS only — **no arbitrary HTML/PNG** via this route).
  - `entryName = basename(declaration.entry)`; `styles` resolved relative to the entry's dir.
 `entry` + all `styles` must exist among discovered assets, else build fails.
- **Manifest contract** (`openclaw.plugin.json` `controlUi` field): `dist/manifest-BRq2TbZH.mjs` `normalizeManifestControlUi()` (lines ~818-833):
  - `controlUi` must be object with only `entry` + optional `styles`.
  - `entry` must match `/^dist\/(?:[\w-][\w.-]*\/)+[\w-][\w.-]*\.m?js$/u` (a JS file in a dedicated `dist/` subdir; ≤512 chars).
  - `styles` ≤16, each must start with the entry's asset dir prefix and match `*.css`.
- **Workboard's own serving**: `dist/extensions/workboard/openclaw.plugin.json` declares `controlUi.entry = "dist/control-ui/07dd4399832910b670491f3a772be3932650d46e664a0ea9cad4c2d0631ed4ca/index.js"` + `styles` = `.../index.css`. The `07dd...` dir is a **content-hash** baked into the manifest at build time (see `package.json` `openclaw.assetScripts.build` → `scripts/build-plugin-control-ui.mts`). The Gateway re-hashes the built assets at load and serves them under the **revision** digest (not necessarily the dir name). So the `dist/control-ui/<hash>/` path is the **plugin-local build output dir**, NOT the served URL; the served URL always uses the computed sha256 revision.

### 1b. `surface:tab` descriptor

- The Control UI plugin SDK defines `ControlUiSurface` = `keyof ControlUiSurfaceProps` where props include `"session-list"`, `"composer"`, `"workspace"`, `"transcript"`, `"tool-result"` — and the surface enum also includes **`"tab"`** and **`"widget"`**. Source: `dist/plugin-sdk/control-ui.d.ts` `ControlUiSurfaceProps` (lines ~94-125) + `ControlUiSurface` (line 125). The `"tab"` literal appears in the compiled core bundle `dist/control-ui/assets/control-ui-core-CgyBiPIN.js` (surface label map `surface:{"session-list":...,composer,workspace,transcript,"tool-result":...}` + `tab` literal).
- A plugin registers a tab via `host.ui.registerReplacement({ surface: "tab", id, label, mount })` (SDK `ControlUiReplacement` type, `registerReplacement` on `ControlUiHost.ui`). The `mount` is a `ControlUiView` = `(container: HTMLElement, context: ControlUiViewContext<T>) => { update?, focus?, dispose? }` — a **Lit-style DOM mount**, not a raw URL.

### 1c. Static HTML via iframe — supported pattern

- The Control UI board widget host already renders **iframe-hosted HTML widgets**: `dist/control-ui/assets/board-view-C2dlGfth.js` (`contentKind === "html"` / `frameUrl` → `this.frame.render(e)`; `fetchDocument` fetches the widget content URL with `cache:"no-store"`; 401 → `unauthorized`).
- The widget frame URL must be **same-origin** with the active Gateway (`a.origin !== i` → `invalid-url`; `widget content URL is outside the active Gateway`).
- **Mismatch / gap**: the plugin asset route serves **only `.js`/`.css`** (`control-ui-assets-Chx5wPxj.mjs` regex). A plugin cannot serve a raw `.html` file through `handleControlUiPluginAssetRequest`. To host static HTML, the plugin must either (a) serve HTML from a **separate registered plugin HTTP route** (`plugins.entries.*.http` / `registerPluginHttpRoute` — see `route-match-lmCNif6v.mjs` `findRegisteredPluginHttpRoute`), or (b) generate the HTML string in JS and inject via `srcdoc`/`Blob` inside the Lit component, or (c) embed an iframe pointing at a same-origin route the plugin registers. **This is the key contract mismatch to flag for Phase 1 design.**

## 2. Exact auth envelope for WS RPC from a tab (token propagation inside Control UI origin)

**Answer: the Control UI tab authenticates via the gateway-client WebSocket `connect` frame carrying `token`/`deviceToken`/`bootstrapToken`/`password`; the Gateway enforces connection **scopes** (not a per-plugin RPC allowlist).**

### 2a. Client-side connect auth (browser)

- `dist/client-ebDOtCHS.mjs` `selectGatewayConnectAuth()` (lines ~28-58) + `buildGatewayConnectAuth()` (lines ~60-75):
  - Auth envelope fields: `token`, `bootstrapToken`, `deviceToken`, `password`, `approvalRuntimeToken`, `agentRuntimeIdentityToken`, `signatureToken`.
  - Selection precedence: explicit `token` > resolved `deviceToken` (stored device token) > `bootstrapToken`; `signatureToken = selectedToken ?? authBootstrapToken`.
- **Control UI browser storage**: `dist/control-ui/assets/control-ui-core-CUhKaXUc.js`:
  - Device identity stored in `localStorage` key `openclaw-device-identity-v1` (`{version:1, deviceId, publicKey, privateKey, createdAtMs}`).
  - Device auth tokens stored per-gateway under `openclaw.device.auth.v1:<gatewayUrl>` (`{version:1, deviceId, tokens:{role:{token, role, scopes, updatedAtMs}}}}`).
  - On connect, the browser sends the stored device token for the `operator` role (requires `operator.read` scope) as `deviceToken`; a fresh `token` (paste from `openclaw gateway auth-token --show`) is sent as `token`.
- **Connect frame shape** (worker protocol): `dist/server-ws-runtime-CIPLPfP4.mjs` + `dist/control-ui/assets/control-ui-core-*.js`:
  - Frame: `{ type:"req", id, method:"connect", params:{ minProtocol, maxProtocol, client:{id,version,platform,mode}, role:"worker", admission:{ environmentId, credential, ownerEpoch, rpcSetVersion, handshake } } }`.
  - `credential` carries the auth token/device token; `minProtocol/maxProtocol` must bracket `4` (`connect.minProtocol > 4 || connect.maxProtocol < 4` → reject).
  - Gateway replies `worker-hello-ok` with `{ environmentId, sessionId, ownerEpoch, rpcSetVersion, protocolFeatures, credentialExpiresAtMs, policy:{heartbeatIntervalMs, maxPayload} }` — the `credentialExpiresAtMs` drives token rotation.

### 2b. Gateway-side enforcement

- `dist/server-ws-runtime-CIPLPfP4.mjs` `handleConnect()` (lines ~556-651): `runWorkerAdmissionBoundary` → `admitWorker(connect.admission)` → `validateWorkerConnection(admission.identity)`; on success `advanceHandshakePhase("auth_validated")`.
- **Scopes, not per-plugin allowlist**: `dist/plugin-sdk/control-ui.d.ts` `ControlUiHost.request` doc: *"Native modules share the operator's authenticated Gateway authority. The Gateway enforces connection scopes, not a per-plugin RPC allowlist."* So a tab's RPC calls are authorized by the **connection's scopes** (`operator.read`/`operator.write`/`operator.admin`), not by plugin id.
- **Plugin asset HTTP auth**: `dist/control-ui-plugin-assets-BR1PXkvy.mjs` `handleControlUiPluginAssetRequest()`: either a scoped plugin cookie (`authorizeControlUiPluginCookieRequest` — requires `controlUiPluginGrants` entry with `operator.read` scope for that pluginId) or `authorizeControlUiReadRequestOrReply` (the standard Control UI read auth — device token / shared secret / trusted proxy).
- **Origin policy**: `dist/ws-origin-policy-C6ZioCp1.mjs` + Control UI login strings (`control-ui-core-*.js` `origin` failure: *"Add this browser origin to gateway.controlUi.allowedOrigins"*). A tab served from a non-allowed origin is rejected before connect.

### 2c. Implication for a `surface:tab`

A tab's Lit component gets `host.request(method, params)` (SDK `ControlUiHost.request`) which runs over the **already-authenticated** Gateway WS connection (the tab shares the operator's device-token-authenticated socket). No extra token propagation needed inside the Control UI origin — the plugin calls `host.request("workboard.cards.list", {...})` and the Gateway authorizes by the connection's scopes. **Mismatch to flag**: if the tab is served from a **different origin** (e.g. a separate webos host), it must either (a) be same-origin with the Gateway (allowedOrigins), or (b) do its own `connect` with a device token / shared secret — it cannot piggyback the Control UI socket.

## 3. `workboard.cards.list` row shape + notify event contract

### 3a. `workboard.cards.list` row shape

- Handler: `dist/runtime-api-U-wmyV9G.mjs` `listWorkboardCards(store, boardId, redactCard)` (line ~4005):
  - Returns `{ cards: cards.map(redactCard), boards, statuses: WORKBOARD_STATUSES }`.
  - `redactCard` = `redactClaimToken` (`dist/src-CMxcJXXp.mjs` line 2): replaces `card.metadata.claim.token` with `"[redacted]"`.
- **Card row shape** (from `createCard`/`captureSession` normalization, `dist/runtime-api-U-wmyV9G.mjs` lines ~2102-2145):
  - `id` (uuid), `title` (≤180), `status` (enum), `priority` (enum, default `"normal"`), `labels` (≤12, ≤40 each), `position` (number), `createdAt`, `updatedAt` (ms), `events[]` (`{id, kind, at, toStatus?, sessionKey?, runId?}`).
  - Optional: `notes` (≤4000), `agentId`, `sessionKey`, `runId`, `taskId`, `sourceUrl`, `execution`, `startedAt`, `completedAt`, `metadata` (incl. `claim`, `automation`, `notifications`, `stale`, `archivedAt`, `attempts`, `workerLogs`, `comments`, `proof`, `artifacts`, `links`, `attachments`).
- **Status enum** (`dist/src-CMxcJXXp.mjs` line 18): `["triage","backlog","todo","scheduled","ready","running","review","blocked","done"]`.
- **Board row shape** (`listBoards()`, `dist/runtime-api-U-wmyV9G.mjs` ~line 1926): `{ id, name?, description?, icon?, color?, automationJobId?, defaultWorkspace?, orchestration?, total, active, archived, byStatus:{}, updatedAt, archivedAt? }`.
- **Gateway method registration**: `workboard.cards.list` registered with `READ_SCOPE` (`registerWorkboardResultMethods` — `dist/runtime-api-U-wmyV9G.mjs` line ~4262). The workboard plugin's `openclaw.plugin.json` `dashboard.dataBindings` maps `cards.list` → `workboard.cards.list` (so the Control UI board can bind it directly).

### 3b. Notify event contract

- **Subscribe**: `workboard.notifications.subscribe` (`WRITE_SCOPE`; `dist/runtime-api-U-wmyV9G.mjs` line ~4431) → `store.subscribeNotifications(input)`.
  - `normalizeNotificationSubscription()` (line ~377): requires at least one of `cardId` / `sessionKey` / `runId` / `target`; optional `boardId` (default `"default"`), `eventKinds` (subset of `WORKBOARD_NOTIFICATION_KINDS` = `["completed","failed","stale"]`). Returns `{ id, boardId, cardId?, sessionKey?, runId?, target?, eventKinds?, createdAt, updatedAt }`.
- **Events**: `workboard.notifications.events` (`READ_SCOPE`; line ~4444) → `store.notificationEvents(input)` = `collectNotificationEvents()`:
  - Filters by `subscriptionId` / `boardId` / `cardId` / `sessionKey` / `runId` / `eventKinds` / `lastEventAt` cursor.

  - Event row shape: `{ id, kind, createdAt, sequence?, message?, sessionKey?, runId? }` (from `card.metadata.notifications[]` + synthesized `stale` events).
  - `sequence` = `createdAt * 1e3` (or monotonic counter); `compareNotifications` sorts by `createdAt`, then `sequence`, then `id`.
  - Default `limit` = 50, max 200 (`Math.max(1, Math.min(200, ...)))`).
- **Advance semantics**: `workboard.notifications.advance` (`WRITE_SCOPE`; line ~4454) → `store.advanceNotificationEvents(input)`:
  - Requires `subscriptionId`; collects events, then persists `lastEventAt = last.createdAt`, `lastEventId = last.id`, `lastEventSequence = last.sequence` on the subscription (cursor advance). Returns `{ subscription, events }`.
  - **Cursor rule**: `collectNotificationEvents` skips events where `compareNotifications(event, {id: lastEventId, kind, createdAt: lastEventAt, sequence: lastEventSequence}) <= 0` — i.e. **advance is inclusive-exclusive**: events at-or-before the cursor are dropped; only strictly-newer events are returned after an advance.
.

  - **Mismatch to flag**: `workboard.notifications.events` **rejects** `advance: true` (`assertNoCursorAdvance` — line ~4002: *"notification cursor advancement requires workboard.notifications.advance"*). So a client must call `events` (read-only, no cursor move) then `advance` (moves cursor) as two separate RPCs — there is no combined read-and-advance call.



## 4. Extension packaging: minimum `openclaw.plugin.json` for asset-serving extension into `~/.openclaw/extensions/`

**Answer: YES — a minimal `openclaw.plugin.json` in a dir under `~/.openclaw/extensions/` is sufficient to register a Control UI asset-serving plugin.** The in-tree `dashboard-bridge` precedent confirms the layout.

### 4a. Extensions dir resolution

- `dist/install-paths-Dp6CCE8t.mjs` `resolveDefaultPluginExtensionsDir()` → `resolveActivePluginInstallRoots(env, homedir).extensionsDir`.
- `dist/install-root-context-apHVqZei.mjs` `resolvePluginInstallRoots()`: `extensionsDir = path.join(configDir, "extensions")` where `configDir` = `~/.openclaw` (state dir). So the default is **`~/.openclaw/extensions/`**.
- Confirmed live: `/root/.openclaw/extensions/` contains `dashboard-bridge/`, `codebase-brain/`, `docs-brain/`, `exec-guard/`.

### 4b. In-tree `dashboard-bridge` precedent

- `/root/.openclaw/extensions/dashboard-bridge/` contains exactly: `openclaw.plugin.json`, `package.json`, `index.js`.
- `openclaw.plugin.json`: `{ "id": "dashboard-bridge", "name", "description", "configSchema": {...} }` — **no `controlUi` field** (it's a backend extension, not a UI plugin).
- `package.json` `openclaw` block: `{ "extensions": ["./index.js"], "pluginType": "extension", "hooks": ["init","cleanup"], "provides": ["dashboard-bridge"], "configSchema": {...} }`.
- `index.js` exports `{ register, activate, deactivate, init, cleanup }` — a backend extension hooking the plugin lifecycle (syncs sessions to a dashboard API over HTTP).

### 4c. Minimal asset-serving extension manifest

To serve Control UI assets, the plugin must declare `controlUi` (in either `openclaw.plugin.json` or `package.json` `openclaw.controlUi`). Per `normalizeManifestControlUi()` (§1a), the minimum is:

```json
{
  "id": "webos-bridge",
  "name": "WebOS Bridge",
  "controlUi": {
    "entry": "dist/control-ui/<hash>/index.js",
    "styles": ["dist/control-ui/<hash>/index.css"]
  }
}
```

- The `entry` must be a JS file under a `dist/` subdir; the `dist/control-ui/<hash>/` dir is the **build output** (content-hashed at build time, per workboard precedent). The Gateway re-hashes and serves under the computed sha256 revision (§1a).
- **Mismatch to flag**: `dashboard-bridge` is a **backend-only** extension (no `controlUi`); it is NOT a Control UI asset-serving precedent. The actual Control UI asset-serving precedent is the **in-tree `workboard` plugin** (`dist/extensions/workboard/`), which declares `controlUi.entry = "dist/control-ui/<hash>/index.js"` + `styles` and ships `dist/control-ui/<hash>/index.js` + `index.css` + `assets/` (built via `scripts/build-plugin-control-ui.mts`). A new webos extension must mirror **workboard's** packaging (controlUi + built dist), not dashboard-bridge's.

## 5. Contract mismatches / gaps to flag for Phase 1

1. **Plugin asset route serves only `.js`/`.css`** — no raw `.html`/`.png`/`.svg` via `handleControlUiPluginAssetRequest` (`control-ui-assets-Chx5wPxj.mjs` regex `/\.(?:m?js|css)$/u`). Static HTML must come from a separate registered plugin HTTP route, or be generated in-JS (srcdoc/Blob), or embedded via iframe to a same-origin route.
.
2. **`surface:tab` mounts a Lit component, not a URL** — a tab descriptor's `mount` is a DOM-mount function (`ControlUiView`), not an `href`. To show static HTML, the component must itself render an iframe/srcdoc to a same-origin asset/route.
.

3. **`workboard.notifications.events` rejects `advance: true`** — read-and-advance are two separate RPCs (`events` then `advance`); no combined call exists (`assertNoCursorAdvance`).

4. **Advance cursor is inclusive-exclusive** — after `advance`, events at-or-before `lastEventAt/lastEventId/lastEventSequence` are dropped; only strictly-newer events return. Clients must track `lastEventId`/`lastEventSequence` exactly.

.

5. **`dashboard-bridge` is backend-only** — it is NOT a Control UI asset-serving precedent. Use **workboard** (`dist/extensions/workboard/`) as the packaging template for a Control UI asset-serving extension into `~/.openclaw/extensions/`.

6. **Cross-origin tab cannot piggyback the Control UI socket** — a tab on a different origin must do its own `connect` (device token / shared secret / allowedOrigins); it cannot reuse the Control UI's authenticated WS connection (`ControlUiHost.request` shares the operator's connection scopes, same-origin only).

## Appendix: Key source files (OpenClaw 2026.9.4)

| Fact | Source |
|---|---|
| Version | `/usr/lib/node_modules/openclaw/package.json` `"version":"2026.9.4"` |
| Plugin asset route root/prefix | `dist/route-match-lmCNif6v.mjs` `controlUiPluginAssetRoot`/`controlUiPluginAssetPrefix` |
| Asset serving handler + revision digest | `dist/control-ui-plugin-assets-BR1PXkvy.mjs` `snapshotBrowserBuild`/`handleControlUiPluginAssetRequest` |
| Asset discovery (js/css only) | `dist/control-ui-assets-Chx5wPxj.mjs` `readPluginControlUiAssets` |
| Manifest `controlUi` contract | `dist/manifest-BRq2TbZH.mjs` `normalizeManifestControlUi`; `PLUGIN_MANIFEST_FILENAME="openclaw.plugin.json"` |
| Workboard plugin manifest (controlUi entry) | `dist/extensions/workboard/openclaw.plugin.json` |
| Workboard package build script | `dist/extensions/workboard/package.json` `openclaw.assetScripts` |
| Surface enum incl. `tab` | `dist/plugin-sdk/control-ui.d.ts` `ControlUiSurfaceProps`/`ControlUiSurface`; `dist/control-ui/assets/control-ui-core-CgyBiPIN.js` |
| iframe HTML widget host | `dist/control-ui/assets/board-view-C2dlGfth.js` (`contentKind==="html"`/`frameUrl`/`fetchDocument`) |
| WS connect auth envelope | `dist/client-ebDOtCHS.mjs` `selectGatewayConnectAuth`/`buildGatewayConnectAuth` |
| Control UI device token storage | `dist/control-ui/assets/control-ui-core-CUhKaXUc.js` (`openclaw-device-identity-v1`, `openclaw.device.auth.v1:<url>`) |
| WS connect frame + admission | `dist/server-ws-runtime-CIPLPfP4.mjs` `handleConnect`/`runWorkerAdmissionBoundary` |
| Scopes-not-allowlist | `dist/plugin-sdk/control-ui.d.ts` `ControlUiHost.request` doc |
| `workboard.cards.list` handler | `dist/runtime-api-U-wmyV9G.mjs` `listWorkboardCards` |
| Card row shape | `dist/runtime-api-U-wmyV9G.mjs` `createCard`/`captureSession` |
| Status/priority/notification enums | `dist/src-CMxcJXXp.mjs` `WORKBOARD_STATUSES`/`WORKBOARD_NOTIFICATION_KINDS` |
| Notify subscribe/events/advance | `dist/runtime-api-U-wmyV9G.mjs` `normalizeNotificationSubscription`/`collectNotificationEvents`/`advanceNotificationEvents`; `assertNoCursorAdvance` |
| Extensions dir resolution | `dist/install-paths-Dp6CCE8t.mjs` `resolveDefaultPluginExtensionsDir`; `dist/install-root-context-apHVqZei.mjs` `resolvePluginInstallRoots` |
| dashboard-bridge precedent | `/root/.openclaw/extensions/dashboard-bridge/{openclaw.plugin.json,package.json,index.js}` |

*Prepared 2026-09-19 by product-planner (Phase 0 protocol research; card eae41fc8-55ba-486f-959c-76272ba43111).*