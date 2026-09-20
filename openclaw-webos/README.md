# openclaw-webos — Control UI tab extension (Phase 2)

In-repo OpenClaw extension that **would** register an OpenClaw Desktop tab at
`route:desktop` (`/openclaw/desktop`) once installed under
`~/.openclaw/extensions/`.

**This card does not install or restart the Gateway.** Installing into
`~/.openclaw/extensions/` is an infra change and waits on a separate
owner-approved install note (Phase 2 QA / follow-on).

## Packaging (workboard, not dashboard-bridge)

Mirrors the in-tree workboard plugin (Phase 0 mismatch #5):

| File | Role |
|---|---|
| `openclaw.plugin.json` | `controlUi.entry` + `styles` under `dist/control-ui/<hash>/` |
| `index.js` | Runtime: `registerControlUiDescriptor({ surface: "tab", placement: "route:desktop" })` |
| `dist/control-ui/<hash>/index.js` | Thin Lit wrapper (`defineControlUiPlugin` shape: `{ id, activate }`) |
| `dist/control-ui/<hash>/webos-desktop-view.js` | Vanilla ES view module the wrapper mounts |
| `dist/control-ui/<hash>/index.css` | Styles (plugin asset route serves **only** `.js`/`.css`) |

No `index.html`. No bundler. No repo build step. Lit ships with the Gateway.

## Contract (Phase 0 findings §5)

1. Plugin asset route serves only `.js`/`.css` — no raw HTML via `handleControlUiPluginAssetRequest`.
2. `surface:tab` mounts a Lit `ControlUiView` (DOM mount), not a URL.
5. Packaging template is workboard, not dashboard-bridge.

## Data path

The tab is served from the Gateway origin, so it shares the operator's
authenticated Control UI socket (`host.request("workboard.cards.list", …)`).
No extra token gate. Staging task-server `:8120` remains the dashboard data
backend for the standalone WebOS origin. `desktopTokenGate` in the plugin
config defaults **off** so other origins stay unchanged.

## Owner-approval install (NOT this card)

```text
# After owner approval only — do not run from this card.
cp -a openclaw-webos ~/.openclaw/extensions/openclaw-webos
# then restart the Gateway via the Control UI / owner runbook
```

Acceptance of "tab reachable at home.3dput.com/openclaw/desktop" waits on that
install note.

## Out of scope

Write-back (Phase 3), de-dup (Phase 4), gateway install, production.
