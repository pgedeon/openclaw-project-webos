---
layout: default
---

# Design Brief — Budget Breach Alerts via Channels (WhatsApp/Zulip)

**Status:** Draft for review — improvement-loop candidate, surfaced by Review #3 ops rec ("surface breaches where the operator actually is") · **Builds on:** budget ledger slices 1–3 shipped (model+API `0a1ed9b`, enforcement `420758b`, surfacing `d276068`: SSE `budget:breach` frames + Mission Control budget bars + notification-center entries)
**Evidence base:** migration `023_add_budget_ledger.sql` (`budget_events` UNIQUE latch); `lib/budget-enforcement.js` (`collectBreachEventRows` returns inserted-only rows; `buildBudgetBreachFrame` shared frame builder); `gateway-workflow-dispatcher-v2.js` (`emitBudgetBreachFrames` fan-out, non-warn gating); `src/shell/notification-center.mjs` (`budget:breach` → blocker entry, deep-link to Mission Control); `lib/gateway-client.js` (persistent authenticated WS dashboard→gateway, token auth, in production use by chat-routes); OpenClaw gateway protocol `send` RPC ("direct outbound-delivery RPC for channel/account/thread-targeted sends outside the chat runner", verified against installed dist `message-CL9AKxEF.js` — params `{to, message, channel, accountId?, agentId?, idempotencyKey?, …}`); `openclaw agent --help` (`--deliver` runs a full agent turn); `openclaw cron add --help` (`--command` shell payload, no agent turn)
**Order:** docs only in this commit. Build touches `.js` files (`gateway-client.js`, dispatcher, new notifier) — **must be sequenced after the concurrent MCP-telemetry order merges** (coder owns `.js/.mjs` right now). CHANGELOG entry lands with the build commit per house pattern.

---

## 1. Purpose & Value Proposition

Slice 3 surfaces breaches **in-app only**: if the operator isn't staring at the dashboard, a `pause_new_runs` or `hard_stop` enforcement sits unseen until someone opens Mission Control. The whole point of auto-pause is protecting spend while the human is elsewhere — so the human must be paged where they already are. The OpenClaw gateway already has WhatsApp and Zulip connected (`openclaw status`: both ON/SETUP). This slice wires latched breach events to those channels using machinery we already own: the dispatcher's fan-out point and the dashboard's existing gateway connection.

Design constraints inherited from Review #3 and the ops rec:

1. **No new network surface.** No new inbound endpoints, no public webhooks, no extra listeners.
2. **Deterministic alert text.** An alert must arrive verbatim — not paraphrased by an LLM turn.
3. **No spam.** Repeated dispatcher ticks over the same breach must produce exactly one message per `(budget_id, period_key, event_kind)` — the DB latch already guarantees this upstream; the notifier inherits it.
4. **Surfacing never breaks dispatch.** Same contract as SSE emission: failures logged and swallowed.

## 2. KEY DESIGN QUESTION — Delivery Mechanism

Three candidate mechanisms were evaluated. **Recommendation: Option B — dispatcher-side notifier sending over the dashboard's existing gateway WebSocket via the `send` RPC.**

### Option A — dashboard shells out to `openclaw agent --channel <c> --deliver -m …` ❌

The CLI's `--deliver` flag delivers *the agent's reply* to a channel — i.e., every alert costs a full LLM agent turn: model latency (seconds–tens of seconds), token cost, provider dependency, and a non-deterministic reply that must be prompt-coerced into echoing our text. Precedent exists (`wakeAgent()` execs `openclaw system event`), but that call is fire-and-forget wake signaling, not content delivery. Wrong tool for verbatim paging.

### Option B — reuse `GatewayClient` WS → gateway `send` RPC ✅ RECOMMENDED

`task-server.js` already holds a persistent, token-authenticated WebSocket to the gateway (`lib/gateway-client.js`, used by chat-routes today). The gateway protocol exposes `send` — the same RPC the agent `message` tool uses internally — for direct outbound delivery without a chat runner:

```js
// thin wrapper in lib/gateway-client.js
async sendDelivery({ channel, to, message }) {
  return this._request('send', {
    channel, to, message,
    idempotencyKey: crypto.randomUUID(),
  });
}
```

Why it wins:

- **Zero new network surface.** The authenticated connection already exists and already crosses the only loopback boundary involved. No new port, endpoint, or credential path. (Contrast `/tools/invoke` HTTP: same capability, but it would add a second auth path and treat the dashboard as a full operator HTTP client when it already has a first-class WS client.)
- **Deterministic, cheap, fast.** No LLM turn; text goes out byte-exact; sub-second under normal conditions.
- **Synchronous ack.** `_request` resolves/rejects — the notifier gets real delivery feedback for logging, unlike spawn-and-pray.
- **Loopback landmine avoided by construction.** The known hazard is assuming `127.0.0.1` reachability across host boundaries (WSL2 ↔ Windows ↔ containers). We make **no new loopback assumption**: whatever host runs task-server already reaches the gateway over this exact socket today. If the socket is down, the notifier degrades (§5) and in-app SSE surfacing continues unaffected.
- **Dedupe is inherited, not rebuilt.** The notifier consumes exactly the rows `collectBreachEventRows` returned (inserted-only via `ON CONFLICT DO NOTHING RETURNING`) at the same fan-out point as SSE frames. There is no polling cursor to drift.

### Option C — OpenClaw cron job polls `/api/budgets` ❌ (as primary)

A gateway cron with a `--command` shell payload (no agent turn — verified) could poll `GET /api/budgets` every N minutes and page on breaches. Rejected as primary because: (a) it adds a poller plus an out-of-DB "already alerted" cursor whose drift is a new spam/failure mode; (b) minutes of alert latency for no benefit — the dispatcher knows at the moment of latch; (c) it still needs a send primitive, which is Option B's mechanism anyway — so cron would just be a worse trigger bolted onto the same transport. **Where C is right:** as a *reconciliation sweep later* (v2) — a low-frequency cron that re-checks latched-but-unacked events after gateway restarts, using the same notifier. Deferred, not designed here.

**Decision:** B. Record any objection before build; this choice determines the file plan.

## 3. Alert Flow

```
dispatcher tick → enforceBudgets()
  → gate.collectBreachEventRows(breached, action)     ← INSERT … ON CONFLICT DO NOTHING RETURNING
      (UNIQUE (budget_id, period_key, event_kind) = the latch;
       returns ONLY newly-inserted rows)
  → emitBudgetBreachFrames(collected)                 ← existing SSE fan-out (unchanged)
        └─ per frame: budgetChannelNotifier.deliver(frame)   ← NEW, additive
              ├─ config off / kind filtered / budget muted → skip silently
              ├─ formatBudgetAlertMessage(frame, cfg)      ← pure formatter
              ├─ dedupeSeen.add(key)?already → skip        ← belt-and-braces vs latch
              └─ gatewayClient.sendDelivery({channel,to,message})
                    └─ failure → log-once, swallow; dispatch unaffected
```

Placement: inside `emitBudgetBreachFrames`'s loop, immediately after the SSE broadcast succeeds-or-fails for each frame — one traversal, one dedupe key space, identical gating. The notifier receives the same `buildBudgetBreachFrame()` output the notification center consumes, so all three surfaces (SSE, in-app, channel) render from one byte-compatible frame.

**Gating parity:** today `emitBudgetBreachFrames` fires only for `pause_new_runs` / `hard_stop` verdicts ("warn records its event but never pages"). Channel alerts v1 mirror that default. The config's `eventKinds` list (§5) defaults to `["paused","hard_stopped"]`; operators may opt into `warned`. Note `warned` frames exist only when a future change widens the SSE gate — widening it is out of scope here; until then `warned` opt-in is inert. `recovered` rollover markers are side-effect inserts invisible to `collected` — channel recovery notices need their own query and are a **non-goal v1**.

## 4. Message Shape

Compact plain text, one message per event, no threading, no rich cards (WhatsApp/Zulip both render it cleanly):

```
⏸ PAUSED — Budget "affiliate-editorial monthly cap"
Scope: agent/affiliate-editorial · Period: monthly (2026-08)
Spend: $123.45 of $100.00 cap (123%)
Action: pause_new_runs — new runs queue until cap raised or period rolls
Dashboard: <dashboardUrlBase> (#mission-control → Cost → Budgets)
```

Field rules (all sourced from the frame — nothing else):

| Field | Source | Rule |
|---|---|---|
| Kind label | `event_kind` | `paused→⏸ PAUSED`, `hard_stopped→🛑 HARD STOP`, `warned→⚠️ WARNED`; unknown kind falls back to raw kind |
| Name | `budget_name` | truncate 80 chars; strip control chars/newlines |
| Scope | `scope` + `scope_id` | `fleet` renders bare; others `scope/scope_id` |
| Period | `period` + `period_key` | as-is from frame |
| Spend/cap/% | `spend_usd`/`cap_usd` XOR `spend_tokens`/`cap_tokens` | USD: `$X.YY`; tokens: `toLocaleString('en-US')`; `% = round(spend/cap*100)`; missing cap → `unlimited` (defensive; latch implies cap existed) |
| Action | `action` | raw enum + fixed human clause per action |
| Link | config `dashboardUrlBase` | omitted entirely when unset |

**Rate-limit / dedupe rules:**

1. **Primary:** consume only `collectBreachEventRows` output — the UNIQUE latch makes duplicates impossible at the source.
2. **Belt-and-braces:** in-process `Set` of `${budget_id}:${period_key}:${event_kind}`, mirroring the existing `seen` set in `emitBudgetBreachFrames` — protects against double-invocation within a tick.
3. That's all. One message per budget+period+kind forever (until period rolls → new `period_key`). No time-window throttling needed; volume is structurally bounded by the latch.

## 5. Configuration

Settings-store SCHEMA keys (`source: 'config'`, hot-reloadable, editable via existing settings UI/routes):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `budgetAlerts.enabled` | toggle | `false` | master switch; off ⇒ zero overhead, zero sends |
| `budgetAlerts.channels` | json | `[]` | e.g. `[{"channel":"whatsapp","target":"+49…"}, {"channel":"zulip","target":"<chat-id>"}]` |
| `budgetAlerts.eventKinds` | csv | `paused,hard_stopped` | which latched kinds page |
| `budgetAlerts.mutedBudgets` | csv | `` | budget ids/names excluded from paging |
| `budgetAlerts.dashboardUrlBase` | text | `` | staging URL base for the link line; empty ⇒ line omitted |

Secrets: none new. `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD` already feed `GatewayClient` from `.env.secrets` (chmod 600, gitignored) — reused as-is.

Per-budget enable/disable: `mutedBudgets` deny-list v1 (cheapest correct primitive; budgets are few). A per-budget `alerts_enabled` column is a schema change reserved for v2 if deny-listing proves annoying.

**Graceful degrade:** channel unconfigured / disabled / gateway socket down / send rejected ⇒ skip silently, **log once per channel per 10-minute window** (repeat failures suppressed; next success resets). Enforcement, SSE, and in-app surfacing are untouched by any notifier outcome. The notifier function never throws — same contract as `emitBudgetBreachFrames`.

## 6. Security

1. **Whitelist content only.** Messages contain exactly §4's fields: budget name, scope, period, spend/cap numbers, action label, dashboard URL. No error payloads, no run ids/payloads, no internal hostnames beyond the configured URL base, no config dumps.
2. **No secrets in messages or logs — tested.** Acceptance test asserts the gateway token value appears nowhere in formatted output (guards against future field creep).
3. **Name sanitization.** `budget_name` is operator-authored but still truncated (80) and control-char-stripped before interpolation — prevents line-break injection into the fixed message skeleton.
4. **Fixed recipient binding.** Sends go only to explicitly configured `target`s. No dynamic target resolution, no reply-driven behavior, no group discovery v1.
5. **Staging URL exposure.** During dev/QA the link points at the LAN staging webroot (X-Robots-Tag noindex, not publicly indexed). Recipients are operator-owned chats the operator configured — acceptable exposure by definition. Do **not** set `dashboardUrlBase` to any publicly reachable URL until this ships past staging; leaving it empty omits the link entirely.
6. **Operator credential boundary unchanged.** We reuse the existing WS auth; we do not introduce `/tools/invoke` bearer handling or store any additional credential.

## 7. File Plan

Sequenced **after** the concurrent MCP-telemetry order merges (all `.js` below are touched there or adjacent):

| File | Change |
|---|---|
| `lib/budget-channel-notifier.js` | **NEW** — pure `formatBudgetAlertMessage(frame, cfg)`; `createBudgetChannelNotifier({ gatewayClient, settings, log, now })` returning `deliverFrame(frame)`; injected sender for tests; log-once window state |
| `lib/gateway-client.js` | **EDIT** — add `sendDelivery({channel, to, message})` wrapping `_request('send', …)` with UUID idempotency key (~8 lines) |
| `gateway-workflow-dispatcher-v2.js` | **EDIT** — instantiate notifier lazily beside `getBudgetBroadcaster()`; call `deliverFrame(frame)` inside `emitBudgetBreachFrames` loop after SSE emit |
| `tests/test-budget-channel-notifier.js` | **NEW** — DB-free tests (§8) |
| `docs/briefs/budget-channel-alerts.md` | this brief |

No schema migration. No new routes. No frontend changes (notification center untouched).

**TODO-verify at build time** (named, per defensible-content rule): exact `send` RPC params against the installed gateway version (verified today against dist `{to, message, channel, accountId?, idempotencyKey?}` — re-confirm); Zulip target format accepted by the gateway (`openclaw directory` lookup); exact deep-link fragment for the Mission Control budgets panel.

## 8. Acceptance Criteria (DB-free)

All in `tests/test-budget-channel-notifier.js` — pure functions + injected fake sender; no DB, no network, no gateway:

1. **Formatting — USD:** frame with `cap_usd` renders `$123.45 of $100.00 cap (123%)`; percent rounds half-up; spend/cap labels match frame values exactly.
2. **Formatting — tokens:** `cap_tokens` frame renders locale-grouped token counts, no `$`.
3. **Formatting — fleet scope:** `scope_id: null` renders bare `fleet`; agent scope renders `agent/<id>`.
4. **Formatting — hostile name:** 200-char name with `\n` and control chars truncates to 80 sanitized chars; skeleton line count unchanged.
5. **Dedupe:** same `(budget_id, period_key, event_kind)` twice ⇒ one send; different `period_key` or `event_kind` ⇒ sends.
6. **Kind filter:** kind outside `eventKinds` ⇒ zero sender invocations.
7. **Mute:** budget in `mutedBudgets` ⇒ zero invocations.
8. **Disabled / empty channels:** master off or `channels: []` ⇒ zero invocations, zero logs.
9. **Failure isolation:** fake sender throwing sync AND rejecting async ⇒ `deliverFrame` resolves `{sent:false}`, dispatcher-path caller sees no exception; second failure inside window produces no repeat error log; success resets suppression.
10. **Secret absence:** formatted message for every kind contains no substring of a canary `OPENCLAW_GATEWAY_TOKEN` value.
11. **Link omission:** empty `dashboardUrlBase` ⇒ no `Dashboard:` line.
12. **Contract:** `sendDelivery` passes `{channel, to, message, idempotencyKey}` through to `_request('send', …)` (spy assertion).

QA-auditor staging checks (post-build): breach a scratch budget on staging ⇒ WhatsApp/Zulip receive exactly one message; re-tick dispatcher ×3 ⇒ still exactly one; disable master switch ⇒ silence; stop gateway ⇒ dispatch pipeline completes, single log line, no error storm.

## 9. Explicit Non-Goals (v1)

- **No interactive replies** — no buttons, no ack-from-chat, no commands back.
- **No digest batching** — one message per latched event; batching adds state and dulls urgency.
- **No other alert types** — approvals, blockers, workflow status stay in-app; this slice is budget breaches only.
- **No `recovered` notifications** — rollover markers aren't in the fan-out stream; separate query, later slice.
- **No retry/outbox queue** — a crash between latch and send forfeits that channel alert (in-app SSE is equally lost); accepted asymmetry, revisit with Option-C-style reconciliation sweep in v2.
- **No per-user/multi-recipient routing** — one configured target list, operator-owned.
- **No Slack/Discord/Telegram** — despite CLI support, only the two configured channels ship; adding a channel is a config entry, not code, once the transport exists.

## 10. Risks & Open Questions

1. **RPC drift:** `send` param names verified against today's installed dist; a gateway upgrade could rename fields — acceptance test 12 pins the contract; builder re-verifies (TODO-verify).
2. **WhatsApp session health:** logged-out WA account ⇒ sends fail into the degrade path silently-ish. Acceptable v1; a periodic `channels status` probe is a candidate for the v2 reconciliation sweep.
3. **Zulip target semantics:** stream-vs-user targeting format unverified — resolve via `openclaw directory` before wiring config examples into the settings UI.
4. **Warn-gating coupling:** `warned` paging is inert until the SSE gate widens to include warn verdicts; decide deliberately then (paging on every warn may be noisy — default should stay off).
5. **Concurrency sequencing:** every touched `.js` file overlaps the coder's active order; building before that merges invites conflict churn. Hard sequence, don't parallelize.
