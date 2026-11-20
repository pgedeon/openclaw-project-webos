# openclaw-webos — live proof (2026-11-20, dev gateway)

Card: 6add2b28-d307-40e2-b979-63e4043278a7
Commit: 6da8dfd (fix(webos): opt plugin into gateway startup so tab + assets register)
Note: an earlier draft of this file cited worker-local commit `74324b8`, which
was never pushed to the repo; the canonical landed commit for this fix is
`6da8dfd`. Repo and installed extension files are byte-identical modulo CRLF.
Gateway: openclaw-gateway.service PID 3089177, OpenClaw 2026.11.3 (847611d)

## Root cause of the 404 asset route (B5)

`openclaw.plugin.json` had no `activation` block. The gateway startup plan
(`resolveGatewayStartupPluginPlanFromRegistry` → `shouldConsiderForGatewayStartup`)
only loads plugins whose manifest sets `activation.onStartup === true` or that
own a configured slot (memory / contextEngine / provider / channel / tool /
hook). `openclaw-webos` owned none, so it was skipped at startup:

- no `surface:tab` descriptor registered → tab absent from `controlUiTabs`
- no active browser record → `plugins.controlUi.list` had no entry
- asset route `/openclaw/__openclaw__/plugins/control-ui/openclaw-webos/...` → 404

`openclaw plugins list` uses a separate full-load path, so it still reported
the plugin as "loaded" — that masked the gap.

## Fix

- `activation.onStartup: true`
- `uiCapabilities: ["page"]` (registrar warns when a registered UI capability
  is missing from the manifest)

Applied to repo `openclaw-webos/openclaw.plugin.json` and the installed copy at
`/root/.openclaw/extensions/openclaw-webos/openclaw.plugin.json` (identical).
Loaded into the running gateway with `openclaw plugins reload openclaw-webos`
(generation 3) — no gateway restart, no config change.

## Verification (live, post-reload)

Startup plan includes the plugin:

```
$ node -e '...loadPluginLookUpTable(config)...'
startup ids: [... 'whatsapp', 'openclaw-webos']
has webos: true
```

Tab descriptor registered:

```
$ openclaw gateway call plugins.uiDescriptors --json
generation 3
openclaw-webos tab desktop
controlUiTabs: [{pluginId: openclaw-webos, id: desktop, label: OpenClaw Desktop,
                 icon: layout, slug: desktop, group: control}, ...]
```

Browser catalog + revision:

```
$ openclaw gateway call plugins.controlUi.list --json
openclaw-webos b2ecf58617c9 /openclaw/__openclaw__/plugins/control-ui/openclaw-webos/b2ecf58617c970b5e7cf4f79637e6aa83d01bd7ec12edff9c8e4856718cd2110/index.js
diagnostics: []
```

Asset route (bearer auth; the route requires operator.read):

```
index.js                 200 2555 text/javascript; charset=utf-8
index.css                200 2628 text/css; charset=utf-8
webos-desktop-view.js    200 7480 text/javascript; charset=utf-8
```

Page routes (byte-equality expected):

```
/openclaw/           200 21825
/openclaw/desktop    200 21825
IDENTICAL (expected)
```

Headless Chrome render of `/openclaw/desktop` (system chrome, ignoreHTTPSErrors):

- `[data-webos-view-root]` count: 1
- plugin assets fetched: index.css 200, index.js 200, webos-desktop-view.js 200
- rendered text starts: "OpenClaw Workboard / Default / 3dput / compareaihardware /
  comparebabystuff / comparesauna / comparesmartdevice / sailboats / sailboats-fr /
  Refresh / Triage 0 No cards / Backlog 77 ..."
- screenshot: `desktop-tab.png` (this directory)

## Residual, out of scope

- `GET /openclaw/control-ui-config.json` → 401 and
  `GET /openclaw/.well-known/openclaw/browser-bootstrap` → 404 in the headless
  run. Both are core Control UI bootstrap paths, not plugin routes; the tab
  still mounts and renders. Not touched by this card.
- `openclaw plugins doctor` still reports the origin-verification warning
  (`reason=record-missing`, origin=global). That warning is shared by every
  hand-installed global extension here (dashboard-bridge, docs-brain) and is
  not a load failure. Clearing it needs an install record (npm/ClawHub), which
  is out of scope.
- `openclaw plugins validate --root ... --entry index.js` reports
  "plugin entry does not expose tool or feature authoring metadata". That
  validator targets tool/feature authoring plugins; this plugin only registers
  a Control UI descriptor, and the gateway loads it without error.
