---
layout: default
---

# Market Scan — 2026-08-30 (post-v2.1.0 delta refresh)

Fourth competitive pass, five days after `market-scan-2026-08-25b` and one day after
the v2.1.0 release (adoption/assurance/accessibility: MCP server registered with
OpenClaw itself and organically used by live agents, DB-free end-to-end coverage on
the snapshot/restore and MCP adapter seams, schema-drift CI gate, budget management
window, chat-channel breach delivery, NL bar task creation, task↔session Conversation
tab, keyboard/touch widget reorder). This scan asks what the market did while we
shipped v2.1.0 — and the answer is: two competitors moved, one of them onto a new axis.

Method: live fetches on 2026-08-29 23:57 – 2026-08-30 00:05 UTC — GitHub REST API
(stars, pushed dates, releases, full commit logs since Aug 26 for Paperclip and since
Aug 19 for FleetQ), PR bodies read for the two pivotal merges (#12346 Paperclip
connections, #149 FleetQ A2A), README grep for Paperclip's budget claim, roadmap +
CHANGELOG cross-check for our own steal-list status, clawcontrol.dev re-fetched, and
a fresh-entrant GitHub search. Every number below is from today's fetch.

## Delta table vs 2026-08-25b

| Competitor | Changed since ~Aug 25 | Threat delta |
|------------|----------------------|--------------|
| **Paperclip** (paperclipai/paperclip) | **79,641★** (+321), pushed tonight. One release since the scan: **v2026.824.1** (Aug 25 21:04 UTC) — a patch repairing the onboarding background-service leg (service crash-looped on a missing shim binary after `npx` onboard). 99 commits on main since Aug 26. The burst's center of gravity MOVED: not Runner/PRP (zero visible commits — every "runner" hit is CI plumbing) and not budgets (zero budget commits; README claim byte-identical: "Monthly budgets per agent. When they hit the limit, they stop."), but a **connections/credentials mega-stack** (stack 8 of 11 merged): managed external MCP connectors (#12346 — brokered OAuth, tokens kept out of durable state, fail-closed refresh), self-serve connection intents, Composio + Gmail connectors, connection grants + delegated identities, secure remote MCP setup. Also confirmed from the brief: task-drain admission hold on the instance API (#12485), Grok device login in the sandbox login panel (#12469), a ~30-commit stacked-PR CI optimization campaign, route-local byte bounds replacing the process-wide byte ledger in adapter-utils (#12465 — memory accounting, not agent budgets). | ▲▲ Momentum intact, but the axis shifted from execution substrate to **connection fabric** — they are claiming the MCP-hub position from the CLIENT side |
| FleetQ (escapeboy/agent-fleet-o) | **65★** (+3), pushed Aug 29. The Aug-19 silence is definitively broken — five active days: Modal Sandboxes driver (Aug 25); MCP coverage-gap closure — 13 new tools, 31 compact actions, self-approval-guard fix (Aug 27); `pr.require_approval` enforced at merge, closing an audited fail-open (Aug 28); approval gate migrated to **MRTR elicitation (SEP-2322)** (Aug 29); and **PR #149: an A2A server** — `A2aServer` answers `message/send` + `tasks/get`, a protocol facade funneling into the same `ProtocolReceiver` as the REST chat endpoint, so external A2A peers can now call FleetQ agents, not just be called by them. Repo description still says 450+ MCP tools (README still 675+). | ▲ Re-awake with a protocol-first week — A2A serving + SEP-2322 elicitation is a real interop posture, not noise |
| LoopX (huangruiteng/loopx) | **5,286★** (+199 — biggest relative mover), pushed Aug 29. v0.5.3 (Aug 27): Todo identity + continuation causality kept intact across quota, scheduler, capability re-entry, external waits, and visible Goal replans; bounded host and research workflows. | ▲ Durability lane, accelerating stars — still zero dashboard/MCP overlap with us |
| Mission Control (builderz-labs/mission-control) | **6,134★** (+49), last push Aug 25 06:00 UTC — the exact moment of the last scan's fetch. Nothing since. | ► Flat functionally; star drift only |
| ClawFleet (clawfleet/ClawFleet) | Nothing. 172★, last push Apr 27. | ▼ Dormant 4 months |
| openclaw-mission-control (abhi1693) | Nothing. 4,108★ (−1), last push Aug 6. | ► Quiet but established |
| openclaw-control-center (TianyiDataScience) | Nothing. 4,002★, dormant since Apr 13. | ▼ Stalled |
| ClawControl (clawcontrol.dev) | Re-fetched tonight: identical messaging ("Signed execution envelopes · Real-time task board with sign-off gates"). No visible changelog or product movement. | ► Flat, governance-flavored messaging unchanged |

New-entrant sweep: nothing material. GitHub search for agent-fleet/control-plane
entrants returns only ≤4★ noise (opsflowsh/agentfleet at 4★ is the oldest and largest);
everything else created within the last month sits at 0★. The entrant wave remains
consolidated on the names already on this radar.

## Headline answers

**1. Does Paperclip's 5-day burst change the competitive read? The burst is real but
aimed elsewhere — our surface is grazed, not hit; the budget question stays open.**
99 commits in 5 days at 79.6k★ is pace nobody else matches, but the two brief-flagged
items are minor for us: the task-drain admission hold (#12485) is instance-API
lifecycle hygiene (refuse new work while draining — we already degrade honestly via
snapshot checkpoints and budget_blocked surfacing), and Grok device login is provider
onboarding breadth. The budget story is now unchanged across THREE consecutive scans:
same README claim, zero budget commits in window — the 08-25b open question ("claim
without visible enforcement commits") remains open, and our dispatcher-enforced
budgets + slice-4 management UI (shipped in v2.1.0) keep the mechanism lead. The
genuinely new thing is the connections stack: Paperclip is becoming a managed CLIENT
hub for external MCP servers with brokered OAuth, delegated identities, and fail-closed
token lifecycles. That does not collide with our MCP surface (we are a server exposing
OpenClaw-native state; they ingest third-party servers), but it means the phrase "MCP"
now anchors both ends of the market — and their credential-governance rigor is
mechanism-level work in the trust territory we market. Watch it; don't fear it yet.

**2. Does FleetQ's A2A serving create an interop expectation for OpenClaw dashboards?
Not yet — orthogonal today, with a named trigger condition.** A2A is agent-to-agent
federation; our MCP exposure is agent-to-client governance. A single-operator desktop
governing their own OpenClaw agents through one gateway has no fleet peer to federate
with — FleetQ's `A2aServer` answers a multi-org problem we don't have. The honest
mechanism check: a dashboard can only surface A2A traffic if the underlying runtime
speaks A2A, and OpenClaw core does not — so there is nothing for our MCP surface to
expose and nothing for a dashboard to show. This is a WATCH item, not a steal: if
OpenClaw core ever grows A2A support, the parity move becomes gateway-level, and the
dashboard follow-on (A2A peer traffic in the audit/ledger views) would be a small
read-time join. Separately, FleetQ's SEP-2322 elicitation migration IS relevant to our
MCP surface (see steals #3) — that, not A2A, is the week's transferable idea.

**3. Is our v2.1.0 positioning still right? Yes — the delta sharpened it.** Every
mover this week went further INTO the networked plane: Paperclip built connection
fabric and delegated identities, FleetQ built interop protocol serving, LoopX built
bounded host workflows. Nobody moved toward desktop environment, offline-first, or
zero-deploy — those remain structurally hard for them and free for us. v2.1.0's
substance (organic MCP adoption by live agents, budget management UI, conversation
binding, assurance coverage) deepens exactly the claim the positioning carries.
Keep: *"The self-hosted desktop environment for governing OpenClaw agents."* One
refinement in emphasis, not wording: "governing" now has three scans of evidence
behind it (enforced budgets, receipts, audit, management UI) while Paperclip's budget
claim enters its third scan without a visible enforcement commit — the asymmetry is
now a talking point, not just a private comfort.

## Capability comparison — us post-v2.1.0 vs the top competitors

Honest scoring per dimension. ✅ = clear lead, 🟨 = competitive/parity, ❌ = behind.

| Dimension | Us (v2.1.0) | Paperclip (79.6k★) | Mission Control (6.1k★) | FleetQ (65★) | LoopX (5.3k★) |
|-----------|-------------|--------------------|--------------------------|--------------|---------------|
| Live streaming | 🟨 Validated bridge, auth-hardened SSE fan-out, live console w/ secret redaction | 🟨 Chat-first tasks w/ live runs; authenticated live-events WS | ✅ Core identity — live replay is their flagship | 🟨 Laravel Reverb WS graphs | ❌ CLI-first, no live dashboard story |
| Governance / enforcement | ✅ Dispatcher-enforced budgets + slice-4 management UI (v2.1.0), approval tiers, receipts on every write, governance rules per action kind | ✅ Approval + review gates, revisioned rollback, immutable audit, monthly hard-stops AT SCALE — but enforcement commits invisible 3 scans running | 🟨 Approvals + RBAC direction | 🟨 Risk-tier policy + NEW: fail-open approval bypass closed, MRTR elicitation | 🟨 Typed confirmations + receipts, governed delivery |
| Cost control | ✅ End-to-end: schema → rollups → enforced budgets → SSE/chat breaches → management UI → NL queries | ✅ Tracking + monthly hard-stops (claim static; Grok adapter token-usage fix was last window) | 🟨 Per-agent cost display, no enforcement | 🟨 Credit ledger, auto-pause (unshipped since Jun) | 🟨 Quota contracts, continuation-preserving settlement (v0.5.3) |
| Extensibility / MCP | ✅ 13 deep OpenClaw-native tools, gated mutations mint receipts, registered with OpenClaw itself and organically adopted (v2.1.0 telemetry) | 🟨 Still no server-side MCP exposure — but now a managed CLIENT hub for external MCP connectors w/ brokered credentials (new this window) | ❌ None advertised | 🟨 Breadth (450+/675+?) + protocol-first week: A2A server + SEP-2322 elicitation | ❌ None advertised |
| Security posture | ✅ Published 11-finding audit, all closed; npm-audit CI gate; schema-drift gate (v2.1.0); bearer auth hardened; secret redaction layered | 🟨 Healthy reactive cadence (this window: CI/test hardening batch); no published audit | 🟨 Host allowlist fails closed | 🟨 Audited fail-open closure + bypass analysis doc (Aug 28) — good instinct, no published audit | 🟨 Credential isolation, attack-path probes |
| Installability / form factor | ✅ PWA standalone install + Win11 shell environment; static deploy | 🟨 Web app + Cloud offering; heavy server stack | 🟨 Self-hosted web console (SQLite) | 🟨 PHP/Laravel/Docker stack | 🟨 pip-installed CLI |
| Offline-first | ✅ IndexedDB state + reconnect sync | ❌ Server stack must live | ❌ Same | ❌ Same | 🟨 Local-first services |
| Zero-deploy single-operator | ✅ Static files + optional Node servers | ❌ Node+React+Postgres(+sandbox providers) | 🟨 SQLite helps, still a service | ❌ Docker stack | 🟨 pip install, but CLI-native |

Reading: unchanged in shape from 08-25b — we lead or tie everywhere except scale-proof
and org breadth, where only Paperclip plays, and Paperclip's week made their
architecture MORE server-bound (connection brokers, managed connectors), widening our
form-factor moat. The one cell that genuinely moved is FleetQ's extensibility: from
self-deflating breadth claim to actual protocol work (A2A + elicitation). Small repo,
real direction.

## Updated steals list (max 3)

Already shipped since 08-25b: task↔session conversation binding (v2.1.0, 4805e3e —
Conversation tab over bound sessions, read-only, zero new write paths). Tailnet
remote-access recipe: docs half shipped (docs/remote-access.md, verified-pattern-
pending-rollout), rollout owner-gated — stays on the list as an ops action, not a
build. Remaining, scored Impact 1–10 / Effort 1–10:

| # | Feature | Stolen from | Impact | Effort | How it lands here |
|---|---------|-------------|--------|--------|-------------------|
| 1 | Tailnet HTTPS rollout (complete the shipped recipe) | Paperclip v2026.824.0 managed-runtime previews | 6 | 2 | Docs are done and verified-pattern; the only remaining work is `tailscale serve` install + exposure on the dev machine — owner-gated. Nothing new to build; highest value-per-minute on this list the moment the owner orders it. |
| 2 | Verified-capability snapshot pattern | Paperclip sandbox providers (declared ∩ verified ∩ configured, fail-closed) — STILL OPEN from 08-25b, never scheduled | 4 | 2 | Formalize how gateway-bridge/SSE/MCP features resolve effective capability (env flag ∝ declared, health probe ∝ verified, config ∝ configured) so surfacing states are provable. v2.1.0's DB-free seam coverage makes the refactor cheaper than when first proposed. |
| 3 | **NEW: MCP approval elicitation (SEP-2322)** | FleetQ #148 — approval gate migrated to MRTR elicitation (Aug 29) | 5 | 3 | Our MCP mutation gate is hidden-not-refused behind `OPENCLAW_MCP_MUTATIONS=1` with receipt-minted writes. SEP-2322 elicitation would let HOLD-tier mutation requests surface a native approval prompt in the MCP client (round-trip) instead of a hidden refusal — turning the gating tiers into a protocol-native experience for external clients while receipts and the envelope path stay unchanged. FleetQ proved the migration shape on a Laravel stack; our stdio JSON-RPC server is a smaller surface. |

Honorable mentions (not scheduled): Paperclip's task-drain admission hold (our analog
— an explicit dispatcher admission-hold flag during snapshot/restore — is nice-to-have;
budget_blocked + checkpoint degradation already cover the substance); Paperclip's
connection-grants/delegated-identity pattern (governed credential lifecycle — no
external-connector surface on our side to govern, so nothing to land it on); LoopX
reproducible ops-benchmark scenarios (still gated on the DAG telemetry GO ~2026-09-14).

Explicit non-goals unchanged: no drag-drop editor breadth, no prompt IDE/RAG, no
multi-user RBAC, no tool-count arms race, no org-chart breadth, no A2A federation
surface until OpenClaw core speaks it.

## Positioning statement recommendation

> **OpenClaw Project WebOS is the self-hosted desktop environment for governing
> OpenClaw agents — live-streamed, budget-enforced, MCP-exposed, and deployable as
> static files.**

Unchanged from 08-25b and re-earned by v2.1.0. The week's delta moved every competitor
deeper into hosted/federated/connection-fabric territory; "desktop environment" and
"zero-deploy" got MORE distinctive, not less. Avoid "control plane" (now contested by
Mission Control, LoopX, ClawControl, and half the entrant noise) and avoid governance-
superiority claims — state the mechanism (dispatcher-enforced, receipted, audited) and
let Paperclip's three-scan-static budget claim speak for itself.

## Roadmap impact

One new candidate added to `UPGRADE_ROADMAP.md` Post-2.0 Candidates (same commit):
MCP approval elicitation via SEP-2322 (steal #3) — the only genuinely new, mechanism-
level transferable idea this window. A2A interop recorded as a watch item with an
explicit trigger condition (OpenClaw core A2A support), deliberately NOT a candidate.
