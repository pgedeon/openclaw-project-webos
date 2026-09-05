---
layout: default
---

# Market Scan — 2026-09-05 (post-v2.1.0 delta refresh)

Fifth competitive pass, six days after `market-scan-2026-08-30` and one week after
the v2.1.0 release. Since the last scan we shipped the market-scan steal #2 pilot
to completion (capability resolver `lib/capability-status.js` + snapshot-routes and
Mission Control migration, CHANGELOG Unreleased) and mirrored the CHANGELOG onto the
docs site. This scan asks what the market did in those six days — and the answer is:
Paperclip kept its pace on a new axis (agent capability provisioning + hosted-operator
controls), LoopX shipped v0.5.4 with a correction owed to its dashboard story, and
Mission Control woke up in its PR queue if not on main.

Method: live fetches on 2026-09-05 19:22 – 19:55 UTC — GitHub REST API (stars, pushed
dates, releases with bodies read for Paperclip v2026.831.0/.1 and LoopX v0.5.4 + DSH
plugin beta.4, full commit logs since Aug 30 for Paperclip/FleetQ/Mission Control,
PR bodies read for Mission Control #956/#958 and FleetQ #150), README grep for
Paperclip's budget claim and LoopX's dashboard story, clawcontrol.dev re-fetched, and
a fresh-entrant GitHub search. Every number below is from today's fetch.

## Delta table vs 2026-08-30

| Competitor | Changed since ~Aug 30 | Threat delta |
|------------|----------------------|--------------|
| **Paperclip** (paperclipai/paperclip) | **80,061★** (+420), pushed today 19:03 UTC. Two releases: **v2026.831.0** (Sep 2, 175 commits) + **v2026.831.1** (Sep 2, onboarding patch). **225 commits on main since Aug 30.** Center of gravity moved again: (1) **skill library reaches agents at runtime** — deterministic skill manifest in every run's instructions, agents list skills over MCP, failure surfaced in run output instead of silent vanish; (2) **hosted-operator controls** (`PAPERCLIP_HIDDEN_SETTINGS`, `PAPERCLIP_SETTING_DEFAULTS`, managed-sandbox-only mode) — shaping what hosted tenants see; (3) sandbox callback bridge rebuilt on bounded HTTP/2 duplex (fail-closed mid-run death); (4) native Codex runner groundwork behind default-off flag; (5) Kimi Code first-class adapter; breaking: bad agent bearer tokens now 401 instead of anonymous fall-through, silent-run auto-recovery removed (surfaces as UI level only). Budget check, fourth consecutive scan: **zero budget commits in window; README claim byte-identical** ("Monthly budgets per agent. When they hit the limit, they stop."). | ▲ Pace intact, axis now agent-provisioning + multi-tenancy — further from our surface, not closer |
| FleetQ (escapeboy/agent-fleet-o) | **65★** (+0), pushed Sep 3. The protocol week is over — exactly one merge since: **PR #150**, a Bulgarian-locale memory-distill provider fix. No A2A follow-through, no elicitation follow-through. | ► Quiet again; interop posture parked, not extended |
| LoopX (huangruiteng/loopx) | **5,628★** (+342 — biggest relative mover again), pushed today. **v0.5.4** (Sep 2): typed control-plane transactions with durable receipts, governed periodic-report lifecycle (trigger→generate→review→approve→deliver→readback), **DSH plugin** (DeepSeek Harness integration, beta.3/beta.4 alongside). Post-release: dashboard sprint — sidebar Goal drag reorder, completed-Todo lazy browse, **multi-agent Goal Channels (#3969)**. **CORRECTION OWED**: the capability table has carried "CLI-first, no live dashboard story" for LoopX across scans — stale. `loopx dashboard` is a browser/PWA launch path with an experimental Tauri shell, and dashboard PRs predate Aug 30 (#3766, #3763). Table fixed below. | ▲ Durability + presentation lanes, star velocity highest again |
| Mission Control (builderz-labs/mission-control) | **6,172★** (+38). Main branch flat (only dependabot pushes Sep 4). BUT two substantive open PRs: **#956 structured handoff briefs** (Sep 2, +10k lines, `feat/handoff-briefs` branch) — cross-agent/device context handoff as a structured object (`from_agent`, `to_agent`, decisions, next_steps, `consumed_at`), REST + **MCP tools** (`mc_create_handoff`/`mc_get_handoff`/`mc_consume_handoff`) + SessionStart hook template; **#958 desktop-parity chat + local-mode fleet wiring** (Sep 3, +22k fork delta, unmerged). Plus installer fixes #959/#960. | ▲ Flat on main, real substance in queue — handoff briefs is the item to watch |
| ClawFleet (clawfleet/ClawFleet) | Nothing. 173★ (+1), last push Apr 27. | ▼ Dormant 4+ months |
| openclaw-mission-control (abhi1693) | Nothing. 4,109★ (+1), last push Aug 6. | ► Quiet but established |
| openclaw-control-center (TianyiDataScience) | Nothing. 3,995★ (−7), dormant since Apr 13. | ▼ Stalled |
| ClawControl (clawcontrol.dev) | Re-fetched today: identical messaging ("Signed execution envelopes · Real-time task board with sign-off gates"). No visible changelog or product movement. | ► Flat, governance-flavored messaging unchanged |

New-entrant sweep: nothing material. Agent-fleet search tops at 22★ (Resetnak/cooldeck,
Aug 4); openclaw-dashboard search returns only ≤1★ noise (a 1★ telemetry dashboard
created today is the newest). The entrant wave remains consolidated on the names
already on this radar.

## Headline answers

**1. Did Paperclip ship budgets yet? No — fourth consecutive scan with a static claim
and zero enforcement commits.**
225 commits in six days and not one touches budgets; the README sentence is
byte-identical across four scans. Our dispatcher-enforced budgets + management UI keep
the mechanism lead, and the asymmetry is now a four-scan talking point. What Paperclip
DID ship moves them further from our surface, not closer: skill provisioning into
agent runtimes, hosted-tenant settings controls, sandbox transport rebuilds. They are
building the multi-tenant hosted agent platform; we are the single-operator desktop
environment. The lanes diverge.

**2. Does Paperclip's skill-library-to-agents change the MCP read? Adjacent, not
colliding — but it names a discovery pattern worth stealing.**
Their move is client-side push (manifest injected into run instructions) plus MCP
listing. Our MCP surface is server-side exposure (agents pull our 13 tools). Same
protocol, opposite directions — no collision. The transferable bit is the *push*
half: a deterministic capability manifest carried into the run context instead of
relying on list-time discovery (see steals #3).

**3. Is Mission Control's handoff-briefs PR a threat to our conversation binding?
Not yet — unmerged — but it is the best-designed adjacent idea this window.**
Our task↔session Conversation tab is a read-only transcript view over an existing
binding. Their #956 is a write-path object: a structured handoff payload with
producer/consumer semantics (`consumed_at`), MCP tools, and a session-start hook that
consumes it. Different mechanism (handoff object vs transcript view), same job
(cross-session context continuity). Trigger condition is explicit: if #956 merges,
the parity move becomes a structured handoff object over our task binding (see
steals #2). Until then it is a watch item with a named PR number.

**4. Correction: does LoopX have a dashboard? Yes — the table was wrong.**
`loopx dashboard` (browser/PWA) plus an experimental Tauri shell predate the last
scan; this week's sprint (Goal reorder, lazy history, Goal Channels) extends it.
The honest revision: LoopX is a durability-first control plane WITH a presentation
layer, not a CLI without one. It does not change the threat read — still zero
MCP/budget overlap with us, still no OpenClaw-native surface — but the table now
says so truthfully.

**5. Any interop movement (A2A/SEP-2322 follow-through)? No.**
FleetQ's protocol week produced no sequel — one locale fix in six days. Nobody else
moved on A2A. Our SEP-2322 fit check stands CONDITIONAL, blocked on OpenClaw's MCP
client declaring elicitation support. No change, no new information.

**6. Is our v2.1.0 positioning still right? Yes — the lanes diverged further.**
Paperclip went multi-tenant hosting, LoopX went durability + presentation, Mission
Control (in queue) goes cross-agent handoff, FleetQ went quiet. Nobody moved toward
desktop environment, offline-first, or zero-deploy. Keep: *"The self-hosted desktop
environment for governing OpenClaw agents."*

## Capability comparison — us post-v2.1.0 vs the top competitors

Honest scoring per dimension. ✅ = clear lead, 🟨 = competitive/parity, ❌ = behind.
LoopX dashboard cell corrected this scan (was ❌ CLI-first).

| Dimension | Us (v2.1.0) | Paperclip (80.1k★) | Mission Control (6.2k★) | FleetQ (65★) | LoopX (5.6k★) |
|-----------|-------------|--------------------|--------------------------|--------------|---------------|
| Live streaming | 🟨 Validated bridge, auth-hardened SSE fan-out, live console w/ secret redaction | 🟨 Chat-first tasks w/ live runs; authenticated live-events WS | ✅ Core identity — live replay is their flagship | 🟨 Laravel Reverb WS graphs | 🟨 Browser/PWA dashboard + Goal views (corrected — was ❌) |
| Governance / enforcement | ✅ Dispatcher-enforced budgets + management UI, approval tiers, receipts on every write, capability resolver (fail-closed declared∩verified∩configured) | ✅ Approval + review gates, revisioned rollback, immutable audit, monthly hard-stops AT SCALE — enforcement commits invisible 4 scans running | 🟨 Approvals + RBAC direction | 🟨 Risk-tier policy, fail-open closure, MRTR elicitation | 🟨 Typed confirmations + receipts, durable settlement receipts (v0.5.4) |
| Cost control | ✅ End-to-end: schema → rollups → enforced budgets → SSE/chat breaches → management UI → NL queries | ✅ Tracking + monthly hard-stops (claim static 4th scan) | 🟨 Per-agent cost display, no enforcement | 🟨 Credit ledger, auto-pause (unshipped since Jun) | 🟨 Quota contracts, continuation-preserving settlement |
| Extensibility / MCP | ✅ 13 deep OpenClaw-native tools, gated mutations mint receipts, organically adopted | 🟨 Managed CLIENT hub + NEW: skill library pushed to agents at runtime w/ MCP listing | 🟨 None on main; #956 proposes handoff MCP trio (unmerged) | 🟨 Breadth (450+/675+?) + A2A server + SEP-2322 elicitation (parked) | ❌ None advertised |
| Security posture | ✅ Published 11-finding audit, all closed; npm-audit CI gate; schema-drift gate; capability resolver | 🟨 Reactive cadence; breaking 401 fix this window (was anonymous fall-through); no published audit | 🟨 Host allowlist fails closed | 🟨 Audited fail-open closure; no published audit | 🟨 Credential isolation, attack-path probes |
| Installability / form factor | ✅ PWA standalone install + Win11 shell environment; static deploy | 🟨 Web app + Cloud offering; heavy server stack (Node 24 floor now) | 🟨 Self-hosted web console (SQLite) | 🟨 PHP/Laravel/Docker stack | 🟨 pip install + browser/PWA dashboard + experimental Tauri shell |
| Offline-first | ✅ IndexedDB state + reconnect sync | ❌ Server stack must live | ❌ Same | ❌ Same | 🟨 Local-first services |
| Zero-deploy single-operator | ✅ Static files + optional Node servers | ❌ Node+React+Postgres(+sandbox providers) | 🟨 SQLite helps, still a service | ❌ Docker stack | 🟨 pip install, dashboard needs service |

Reading: shape unchanged — we lead or tie everywhere except scale-proof and org
breadth, where only Paperclip plays, and Paperclip's week made their architecture
MORE hosted-multi-tenant (settings gating, tenant session recovery), widening our
form-factor moat again. Two cells genuinely moved: LoopX live-streaming ❌→🟨
(correction, not new capability) and Mission Control extensibility (unmerged #956
noted, cell unchanged until merge).

## Updated steals list (max 3)

Closed since 08-30: **steal #2 (verified-capability snapshot pattern) — SHIPPED.**
`lib/capability-status.js` (declared ∩ verified ∩ configured, fail-closed) pilots
through budget-routes, snapshot-routes, and Mission Control panels with byte-identical
wire shapes. Remove from open list. Remaining + new, scored Impact 1–10 / Effort 1–10:

| # | Feature | Stolen from | Impact | Effort | How it lands here |
|---|---------|-------------|--------|--------|-------------------|
| 1 | Tailnet HTTPS rollout (complete the shipped recipe) | Paperclip managed-runtime previews | 6 | 2 | Unchanged, still owner-gated: docs done (docs/remote-access.md), tailscale not installed on dev machine. Highest value-per-minute the moment the owner orders it. |
| 2 | **NEW: Structured handoff briefs** | Mission Control PR #956 (unmerged — trigger: merge to main) | 5 | 4 | A `handoff_briefs`-shaped object over our EXISTING task↔session binding: from/to session, decisions made, key context, next steps, open questions, `consumed_at` semantics — written at session end, consumed at session start via the session-reader routes. Our Conversation tab shows the transcript; this adds the structured payload with producer/consumer lifecycle. Do NOT build before #956 merges (design may still churn); on merge, the MCP trio (`create/get/consume`) maps onto our MCP server slice pattern. |
| 3 | **NEW: Capability manifest pushed into run context** | Paperclip v2026.831.0 skill-manifest-to-agents | 3 | 3 | Paperclip injects a deterministic skill manifest into every agent run's instructions instead of relying on list-time discovery. Our analog: workflow-run dispatch context already assembles prompts — attach a compact manifest of dashboard capabilities (action registry kinds, MCP tool names, budget state) so dispatched agents act with knowledge of the governing surface instead of discovering it. Small, honest discovery polish; scored modestly because MCP `list_tools` already covers the pull half. |

Honorable mentions (not scheduled): Paperclip's silent-run UI levels without
auto-action (our anomaly flags already surface without auto-recovery — posture
parity, nothing to land); Paperclip's `agent.task_run` terminal-transition telemetry
(our DAG telemetry counter covers the earn-use question until the 09-14 decision);
LoopX multi-agent Goal Channels (federation surface — same non-goal as A2A);
LoopX DSH plugin pattern (harness-specific, no OpenClaw analog).

Explicit non-goals unchanged: no drag-drop editor breadth, no prompt IDE/RAG, no
multi-user RBAC, no tool-count arms race, no org-chart breadth, no A2A federation
surface until OpenClaw core speaks it, no hosted multi-tenancy controls (our
single-operator reality makes `HIDDEN_SETTINGS`-class work inapplicable).

## Positioning statement recommendation

> **OpenClaw Project WebOS is the self-hosted desktop environment for governing
> OpenClaw agents — live-streamed, budget-enforced, MCP-exposed, and deployable as
> static files.**

Unchanged from 08-30 and re-earned twice over: our steal #2 shipped (capability
resolver makes "governed" mechanically deeper), and every competitor moved further
from the desktop/single-operator lane. Avoid "control plane" (contested) and avoid
governance-superiority claims — state the mechanism and let Paperclip's four-scan-
static budget claim speak for itself.

## Roadmap impact

One new candidate for `UPGRADE_ROADMAP.md` Post-2.0 Candidates (same commit):
structured handoff briefs (steal #2, trigger-gated on Mission Control #956 merging).
SEP-2322 candidate stays PROPOSAL-ONLY (blocked on OpenClaw client support, unchanged).
Steal #3 (capability manifest in run context) is small enough to queue as scoped work
without a roadmap line — recorded here only.

## What we still don't know

- Mission Control #956/#958 may merge, stall, or be rewritten — the threat read on
  handoff briefs is provisional until main moves. Re-check on next scan.
- Paperclip's 225-commit window was sampled at 100-commit page granularity for
  subjects; the zero-budget-commit claim rests on subject grep, not full-diff review.
  A budget change hiding inside an unrelated subject line is unlikely but not excluded.
- FleetQ's A2A server has no visible adoption signal (no client repos, no interop
  traffic to observe) — "parked" is inferred from commit silence, not confirmed by
  the maintainer.
- ClawControl remains a marketing page with no public repo or changelog — its actual
  product velocity is unobservable from here.
