---
layout: default
---

# Remote Access

Reaching the Project Dashboard from outside its LAN — current topology, the Tailscale recipe, and the hard limits that stay by design.

## Status

**Verified-pattern-pending-rollout.** Recon on 2026-08-25 confirmed Tailscale is **not installed** on the dev machine (no `tailscale` binary in any standard path, no `tailscaled` systemd unit, nothing in snap or dpkg). The recipe below is the proven pattern for this exact shape of problem; it has not yet been executed on this deployment. When Tailscale lands, follow [Rollout](#rollout) and record the resulting URL at the top of this page.

## Current Topology (verified 2026-08-25)

| Piece | Binding | Reachable from |
|-------|---------|----------------|
| Dashboard (staging) | `0.0.0.0:8120` on the LAN dev machine (192.168.0.81) | Any LAN host — verified HTTP 200 from a second LAN vantage |
| OpenClaw gateway | `wss://127.0.0.1:18789`, loopback-only inside WSL2 | Only processes inside the same WSL2 network namespace |

What this means:

- **LAN use works today.** Open `http://192.168.0.81:8120/` from any device on the LAN. Every API route requires the bearer token (see [Auth Reference](auth-reference.md)).
- **Off-LAN does not.** Nothing is published to the internet, and production domains are irrelevant here: prod is written exclusively by the daily release batch via the OCI relay (workspace DEPLOY-POLICY), and the staging dashboard is never exposed through it.
- **The gateway landmine:** anything that needs a *direct* browser → gateway WebSocket breaks remotely, because the gateway binds loopback-only inside WSL2 and never leaves it. This is fine by architecture — see next section.

## Why the Gateway Constraint Is Harmless

The browser never talks to the gateway directly. Realtime flows:

```
browser  ←SSE—  dashboard (:8120)  ←WSS—  gateway bridge (server-side)  →  gateway (127.0.0.1:18789)
```

The bridge lives inside the server process (`lib/gateway-bridge.js`, `GATEWAY_BRIDGE_URL`, derived from `openclaw.json` — see [Configuration Reference](configuration-reference.md)); the browser consumes `GET /api/events/stream`. Because mediation is server-side, remote access only ever needs the dashboard port. See [Shell Architecture](shell-architecture.md) for the realtime pipeline.

## Why Tailscale Serve

A tailnet + reverse-serve pattern gives off-LAN access without opening any port to the internet:

- **Valid public TLS certificate**, auto-provisioned for `<host>.<tailnet>.ts.net` — no self-signed warnings, secure context intact.
- **MagicDNS name** — stable URL, no IP bookkeeping.
- **Tailnet ACLs** decide which devices can reach the served port; access control sits at the network layer instead of port-forwarding.
- **PWA install keeps working**: service worker registration and install prompts require a secure context, which the real `ts.net` certificate provides.

## Rollout (when Tailscale is installed)

On the dev machine:

```bash
# 1. Install + authenticate (once)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Enable HTTPS certificates for the tailnet (once, admin console):
#    https://login.tailscale.com/admin/dns -> HTTPS Certificates -> Enable

# 3. Serve the dashboard (the only service change)
tailscale serve --bg --https=443 http://127.0.0.1:8120
```

Result: `https://<dev-machine>.<tailnet>.ts.net/` proxies to the local dashboard. The shorthand `tailscale serve --bg 8120` is equivalent.

Verify from a **second** tailnet device (phone, another PC):

```bash
curl -sI https://<dev-machine>.<tailnet>.ts.net/ | head -5   # expect HTTP 200
```

Then open the URL in a browser, authenticate with the dashboard bearer token, and confirm the PWA install prompt appears.

Roll back / disable:

```bash
tailscale serve --https=443 off
```

## What Does Not Work (by design)

- **Direct browser → gateway WSS from outside.** The gateway binds loopback-only inside WSL2; nothing exposes `18789`, and nothing needs to — the server-side bridge already mediates all agent traffic. Do not add a second `tailscale serve` for the gateway; it would be redundant attack surface.
- **Internet-wide exposure.** `tailscale serve` listens on the tailnet only. No port-forward, no DMZ, no public endpoint.
- **Prod-domain shortcuts.** Production sites are unrelated to dashboard access; fetching them directly is prohibited by deploy policy regardless.

## Security Notes

- **Bearer token unchanged.** Every API route still requires the dashboard token; Tailscale adds a network-identity layer, it does not replace application auth ([Auth Reference](auth-reference.md)).
- **No new internet-facing ports.** Only the tailnet interface gains a listener; ACLs govern which devices can connect.
- **noindex stays set.** The staging deployment serves `X-Robots-Tag: noindex, nofollow` (verified 2026-08-25); the served URL must remain unindexed.
- **ACL hygiene:** keep the served port restricted to the owner's devices; do not open it tailnet-wide.
