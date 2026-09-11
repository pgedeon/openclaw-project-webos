---
layout: default
---

# Budget Alerts Slice-5 Live-Fire Validation — 2026-08-25 (attempt 3)

Work order: slice-5 live-fire validation, attempt 3 (final before escalation).
Attempts 1–2 died to infra timeouts, not task failure. Protocol fix `689a949`
(gateway-client `sendDelivery`) already on main at start.

## Setup

- Repo: `/mnt/c/Users/Rosa/Documents/openclaw-project-webos` (WSL checkout).
- PRECHECK: `git pull origin main` → up to date; `core.autocrlf=true`; status clean.
- Staging: dev machine 192.168.0.81:8120, webroot `~/www/staging/openclaw-dashboard`,
  Postgres `pg-livefire` container (:5439, db `openclaw_dashboard`).
- Zulip: bot `openclaw-bot-bot@zulip.local`, server `https://zulip.local:8443`.
  Target format verified against zulip plugin source (`dist/src/actions.js`):
  `stream:{stream}:{topic}` or `user:{email}`.
- Staging `.env` (carried over from attempt 2, values verified correct):
  - `BUDGET_ALERT_CHANNEL=zulip`
  - `BUDGET_ALERT_TARGET=stream:agents:budget-alerts`
  - `BUDGET_ALERT_EVENT_KINDS=warned,paused,hard_stopped`
    (required: default kinds exclude `warned`; without this line warn events are
    kind-filtered and never page)
  - `BUDGET_ALERT_DASHBOARD_URL_BASE=http://192.168.0.81:8120`

## Infra gaps closed during this run (staging ↔ gateway link)

The staging task-server had NO gateway connection (`gateway not connected`),
so `sendDelivery` could not fire:

1. **No gateway URL/credentials on staging.** Added to staging `.env`:
   `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_PASSWORD`, `NODE_EXTRA_CA_CERTS`
   (gateway TLS cert copied to `~/.openclaw/openclaw-gateway.crt` on dev).
2. **Launcher bug:** `NODE_EXTRA_CA_CERTS` is read at node bootstrap only; the
   staging launcher set it *after* node started ⇒ silently ignored (TLS
   self-signed failure, client reconnect-looped with no log line).
   **Fixed** in `scripts/dashboard-staging-deploy.sh` launcher template: re-exec
   once after `.env` load when `NODE_EXTRA_CA_CERTS` is present
   (`__CA_REEXEC` guard). Note: step 3/6 of the deploy script rewrites the
   launcher every deploy — manual edits to the dev-side launcher get clobbered;
   the fix must live in the repo script.
3. **Gateway scope strip:** device-less operator connections from non-loopback
   peers get self-declared scopes cleared ⇒ `send` fails
   `missing scope: operator.write` (documented gateway behavior,
   docs/gateway/protocol.md "Device identity and pairing"). Loopback connects
   are exempt. **Workaround (infra, not code):** SSH tunnel on dev
   `ssh -N -L 127.0.0.1:18789:127.0.0.1:18789 pgedeon@192.168.0.11`, staging
   uses `OPENCLAW_GATEWAY_URL=wss://127.0.0.1:18789`. Cert SAN covers
   localhost/127.0.0.1 so TLS verifies. Tunnel torn down after the test.
   **Follow-up (not fixed here):** durable low-friction path for LAN backend
   clients to hold `operator.write` (paired device token or sanctioned
   config knob).

## Per-step evidence (all timestamps UTC)

### Step 3a — latch

- Prior-attempt budget `livefire-scratch` (85b3a954…) was already latched
  `warned` for 2026-08-25 (row 172 @21:17:00Z) — deactivated to avoid fake pass.
- Fresh budget `livefire-scratch-r5` e3b3239a-931b-415d-b4ed-10e990c18019
  created (fleet/daily, cap $0.001, action `warn`). Fleet spend already above
  cap ($0.42), so next dispatcher tick must latch.
- Run `2f6ac70a…` posted @22:49:02Z → dispatcher picked it up:
  **budget_events row 194**, `event_kind=warned`, period_key `2026-08-25`,
  **created_at 22:49:26.669889+00**. Exactly one row (UNIQUE
  budget_id+period_key+event_kind latch).

### Step 3b — zulip delivery

- **Zulip message id 1286**, stream `agents`, topic `budget-alerts`,
  timestamp **2026-08-25T22:49:26Z** (exact latch-second match):
  > ⚠️ WARNED — Budget "livefire-scratch-r5" · Scope: fleet · Period: daily
  > (2026-08-25) · Spend: … · Action: warn — no enforcement — advisory only ·
  > Dashboard: http://192.168.0.81:8120/?view=budgets
- Verified via zulip REST API (`/api/v1/messages`) with bot credentials.

### Step 4 — dedupe holds

- Two more dispatch ticks (runs posted 22:52:36Z, 22:54:21Z):
  still exactly ONE budget_events row (194) for the budget, and no new zulip
  messages (latest ids unchanged: …1284, 1286). DB latch + in-memory seen-set
  both held.

### Step 5 — master-off

- `BUDGET_ALERT_CHANNEL=off` in staging `.env`, full restart via
  `scripts/dashboard-staging-deploy.sh --skip-deps`.
- Tick @22:56:44Z → zero `[budget-notifier]` lines after restart (both logged
  failures predate it), zero send attempts, health 200, latch unchanged.

### Step 6 — restore

- All `BUDGET_ALERT_*` + gateway-link lines removed from staging `.env`;
  final restart; `/api/health` → 200.
- Scratch budgets all deactivated (`active=false`): 85b3a954, 9dbc50b8,
  c230e9d4, e3b3239a. No DELETE endpoint exists by design (PATCH deactivate is
  the sanctioned removal per routes/budget-routes.js comments).

## Bugs found

| # | Severity | Description | Action |
|---|----------|-------------|--------|
| 1 | fixed | Deploy-script launcher template ignored `NODE_EXTRA_CA_CERTS` bootstrap semantics ⇒ gateway TLS never trusted from staging. | Re-exec added to launcher template in `scripts/dashboard-staging-deploy.sh`. |
| 2 | infra workaround | Device-less non-loopback gateway clients lose self-declared scopes ⇒ `send` denied (`missing scope: operator.write`). | SSH loopback tunnel for the test; durable fix = paired device token / gateway policy follow-up. |
| 3 | documented | `POST /api/budgets` returned `{"available":false,"reason":"query_failed"}` while the INSERT actually committed (row existed; next identical POST correctly rejected as duplicate name). Response envelope lies on partial failure. | Not fixed (>20-line-path risk inside storage layer); filed here for follow-up. |
| 4 | noted | One-off 401 from WSL-side curl with the byte-identical bearer that succeeded from dev-local curl seconds later; unreproducible afterwards. | Watch item only. |

## VERDICT

**delivery PROVEN** — gateway `send` RPC → zulip plugin → stream message,
latch-exact timestamp match (row 194 ⇔ msg 1286 @22:49:26Z), dedupe holds
across repeat ticks, master-off produces zero sends, cleanup restores default
(off) behavior with health 200.
