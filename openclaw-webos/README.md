# openclaw-webos — Control UI tab extension

In-repo OpenClaw extension that registers an **OpenClaw Desktop** tab in the
Control UI. The tab mounts the WebOS shell (Workboard read-only view) over the
operator's authenticated Control UI socket.

Target: installed OpenClaw **2026.11.3**.

## What changed for 2026.11.3

| Blocker | Fix |
|---|---|
| B1 — `openclaw/plugin-sdk` has no bare export | `index.js` imports `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry` |
| B2 — `placement: "route:desktop"` is not in the route allowlist | descriptor uses `slug: "desktop"`; address is `/openclaw/desktop`. No HTTP route is registered |
| B3 — global extensions are denied native Control UI JS | dev gateway config: `gateway.controlUi.experimental.customPlugins=true`, `plugins.allow` includes `openclaw-webos`, `plugins.entries.openclaw-webos.enabled=true` |
| B4 — served Control UI has no importmap, no bare `lit` | `dist/control-ui/<hash>/index.js` uses the documented plain-DOM `ControlUiView` mount and imports only the sibling view module relatively. No bundler, no bare imports |
| B5 — plugin loads for `plugins list` but never registers its tab, and its asset route 404s | `openclaw.plugin.json` sets `activation.onStartup: true` and `uiCapabilities: ["page"]`. The Gateway startup plan only loads plugins whose manifest opts in via `activation.onStartup` (or that own a configured slot); without it the plugin is skipped at startup, so no descriptor and no asset route exist |

`/openclaw/` and `/openclaw/desktop` serving the same Control UI shell is
**expected** — the slug is a Control UI address, not a separate HTTP route.

## Packaging (mirrors the in-tree workboard plugin)

| File | Role |
|---|---|
| `openclaw.plugin.json` | `controlUi.entry` + `styles` under `dist/control-ui/<hash>/` |
| `index.js` | Gateway runtime: `registerControlUiDescriptor({ surface: "tab", id: "desktop", slug: "desktop" })` |
| `dist/control-ui/<hash>/index.js` | `{ id, activate(host) }`; registers page id `desktop` (must match descriptor id) |
| `dist/control-ui/<hash>/webos-desktop-view.js` | Vanilla ES view module mounted by the page (`render(container, context) -> cleanup`); owns the live-refresh loop |
| `dist/control-ui/<hash>/index.css` | Styles (plugin asset route serves **only** `.js`/`.css`) |

No `index.html`. No bundler. No repo build step.

## Install (dev gateway)

The extension must be copied as a **global** extension. Native Control UI JS
from a global extension is gated, so the config keys below are required.

```text
# 1. Copy the package
cp -a /root/.openclaw/workspace/dashboard/openclaw-webos \
      /root/.openclaw/extensions/openclaw-webos

# 2. Patch /root/.openclaw/openclaw.json (merge; do not replace the file)
#    gateway.controlUi.experimental.customPlugins = true
#    plugins.allow += "openclaw-webos"
#    plugins.entries.openclaw-webos = { "enabled": true }

# 3. Restart the Gateway once
systemctl restart openclaw-gateway.service

# 4. Open Control UI, then /openclaw/desktop
```

Expected after restart:

- Gateway plugin load log lists `openclaw-webos` as loaded (no
  `ERR_MODULE_NOT_FOUND`).
- `openclaw gateway call plugins.uiDescriptors --json` includes
  `openclaw-webos tab desktop` with `slug: "desktop"`.
- `openclaw gateway call plugins.controlUi.list --json` lists
  `openclaw-webos` with a `revision` and an `entryUrl` under
  `/openclaw/__openclaw__/plugins/control-ui/openclaw-webos/<revision>/`.
- Control UI sidebar shows **OpenClaw Desktop**.
- `/openclaw/desktop` renders the WebOS shell (Workboard columns from the
  authenticated Gateway RPC `workboard.cards.list`).

### Config diff (reversible)

```json
{
  "gateway": {
    "controlUi": {
      "experimental": {
        "customPlugins": true
      }
    }
  },
  "plugins": {
    "allow": ["...existing entries...", "openclaw-webos"],
    "entries": {
      "openclaw-webos": { "enabled": true }
    }
  }
}
```

Rollback:

```text
rm -rf ~/.openclaw/extensions/openclaw-webos
# remove gateway.controlUi.experimental.customPlugins, the plugins.allow entry,
# and plugins.entries.openclaw-webos
systemctl restart openclaw-gateway.service
```

## Live updates (Phase 2.5)

The tab is not a one-shot snapshot. After the initial `workboard.cards.list`
the view runs a bounded refresh loop through the same authenticated
`host.request`:

| Step | RPC | Why |
|---|---|---|
| 1 | `workboard.notifications.events` (`boardId`, `limit`) | new `completed` / `failed` / `stale` notifications |
| 2 | `workboard.notifications.advance` (`subscriptionId`) | moves the server cursor — **separate RPC**; the gateway rejects `advance: true` on `events` (`notification cursor advancement requires workboard.notifications.advance`) |
| 3 | `workboard.cards.list` (`boardId`, `sinceRevision`) | cheap `{ unchanged: true }` sentinel; catches status / title / `updatedAt` / heartbeat edits, which never produce a notification event |

- Interval is **8s** (floor 5s), one request in flight at a time, no
  `setInterval`. The loop is scheduled with `setTimeout` and stops on
  `context.signal` abort or view cleanup.
- The first `events` read is treated as **history**: it seeds the cursor and
  does not trigger a refresh, so opening the tab never fakes a change.
- `advance` needs a cursor record. One board-scoped subscription
  (`workboard.notifications.subscribe`, `target: "openclaw-webos-tab"`) is
  **reused across mounts** — `workboard.notifications.list` finds it, extra
  duplicates are pruned, and only a missing record is created. Keeping it means
  a reload resumes at the right cursor instead of replaying history. Read-only
  operators skip the record entirely and keep the cursor client-side; nothing
  is written to the gateway.
- The toolbar shows a small **live** chip while the loop is healthy.

### Failure mode (honest, never fake)

If either notify RPC reports an unsupported/unknown method, the view stops the
loop, keeps the manual **Refresh** button, and shows a
**`live updates unavailable`** chip (amber) with the error in its tooltip. It
does **not** fall back to fast polling and never claims freshness it cannot
prove. Transient errors (scope, socket) keep the loop but leave the chip
unset — the view only renders what the gateway returned.

## Data path

The tab is served from the Gateway origin, so it shares the operator's
authenticated Control UI socket (`host.request("workboard.cards.list", …)`).
No extra token gate. Staging task-server `:8120` remains the dashboard data
backend for the standalone WebOS origin. `desktopTokenGate` in the plugin
config defaults **off** so other origins stay unchanged.

## Out of scope

Write-back (Phase 3), de-dup (Phase 4), production. The tab still mounts only
the Workboard view, not the full desktop shell.
