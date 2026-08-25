---
layout: default
---

# Market Scan — 2026-08-25b (post-2.0 competitive refresh)

Third competitive pass, one day after `market-scan-2026-08-24.md` and the v2.0.0
release. Since scan #2 we shipped: live gateway streaming (validated, auth-hardened
SSE), budget governance with dispatcher enforcement + latched SSE breach fan-out,
session replay inspector, receipted one-click actions, MCP server exposure (13 tools,
receipt-minted mutations behind a flag), snapshot/restore with checkpoints, PWA
installability, theme engine, workflow chain graphs Stage 1, NL command bar, Memory
Browser 2.0, perf pass, docs site. The "10x" claim is materially real — this scan
asks what the market did about it.

Method: live fetches on 2026-08-25 — GitHub REST API (stars, pushed dates, releases,
commit logs since ~Aug 24), release notes read in full for every mover, project sites
for the SaaS entrant, plus a fresh-entrant sweep (GitHub search + web search). All
numbers observed 2026-08-25 06:00–06:40 UTC.

## Delta table vs 2026-08-24

| Competitor | Changed since ~Aug 24 | Threat delta |
|------------|----------------------|--------------|
| **Paperclip** (paperclipai/paperclip) | **79,320★** (+70), pushed today. Stable release **v2026.824.0** (Aug 25 04:23 UTC, 172 commits, 32 contributors): chat-style tasks graduate to the DEFAULT experience; Tailscale HTTPS previews for managed runtimes (least-privilege host broker, durable leases, fail-closed port mediator); in-product Claude/Codex sign-in; sandbox providers move to a VERIFIED capability contract (declared ∩ verified ∩ configured, fail-closed, operator flags deleted); chunked resumable company imports; transactional review-governance verdicts; large security-hardening batch (cross-tenant ID-oracle leak closed, webhook HMAC replay rejection). On main, UNRELEASED: **Paperclip Runner** — PRP v1 schemas + TypeScript replay contracts, durable transport/recovery, semantic action catalog, authorized semantic tool dispatch, Codex provider bridge. Budgets: README claim unchanged ("Monthly budgets per agent… they stop"), zero budget commits in window. | ▲▲ Still the pace-setter — moved execution substrate (Runner/PRP) + remote reach (tailnet) + provider trust model in ONE day |
| LoopX (huangruiteng/loopx) | **5,087★** (+38), pushed today. v0.5.0→v0.5.2 released Aug 19–22 (just before window): typed transaction boundaries with fail-closed recovery for Turn/Todo/quota/scheduler/delivery; Personal Workspace SSH-tunnel status sources; DeepSeek harness skill. Main since Aug 24: scheduler heartbeat transaction hardening, benchmark program RFC (StartupBench, LoopsBench, WideSearch reproducible runners), provider-credential isolation from agents (fail-closed), quota portfolio contract, visible goal continuation turns. | ▲ Steady durability engineering + a benchmarks program nobody else runs — different lane (Python CLI control plane), no dashboard/MCP overlap |
| Mission Control (builderz-labs/mission-control) | **6,085★** (+12). Only docs/sponsor commits since Aug 24 (#947, #948). No release since v2.3.0 (Jul 25). Description now leads with "control plane… dispatch tasks, review runs, track spend." | ► Flat functionally — our v2.0 sprint outran them again |
| FleetQ (escapeboy/agent-fleet-o) | **62★ flat. Zero commits since Aug 19**, no release since v1.27.0 (Jun 9). Notable: repo DESCRIPTION deflated its headline claim from "**675+ MCP tools**" to "**450+ MCP tools**" while the README still says 675+ across 45 domains. | ▼ Quiet, and their own metadata now contradicts their README — the tool-count arms race is losing credibility from the inside |
| ClawFleet (clawfleet/ClawFleet) | Nothing. 167★, last push Apr 27. | ▼ Dormant 4 months |
| openclaw-mission-control (abhi1693) | Nothing. 4,109★, last push Aug 6. | ► Quiet but established |
| openclaw-control-center (TianyiDataScience) | Nothing. 4,001★, dormant since Apr 13. | ▼ Stalled |
| ClawControl (clawcontrol.dev) | Site messaging now leads with "**Signed execution envelopes · Real-time task board with sign-off gates**" — governance-flavored repositioning; no visible changelog or product movement. | ► Flat, messaging converging on governance |

New-entrant sweep: nothing material. GitHub search for agent-fleet/control-plane
entrants returns only ≤5★ noise; an awesome-list mentions "LionClaw"/"NemoClaw"
control planes but no corresponding repositories could be located (list-only vapor).
The niche's entrant wave has consolidated around the names already on this radar.

## Headline answers (the two questions this round)

**1. Does Paperclip's budget hard-stop still outrank ours? No — the gap is closed at
the mechanism level; residuals are UX maturity and scale proof.** Paperclip's budget
story is byte-for-byte unchanged since scan #2 (same README claim, zero budget commits
in the window, nothing in v2026.824.0). Meanwhile we shipped slices 1–3: budget rows
over the cost schema (migration 023), dispatcher-enforced scope-chain evaluation with
idempotent breach events and documented fail-open, and latched SSE breach fan-out into
Mission Control bars + notification center — plus receipts integration and NL-bar
budget status queries. What they still hold: monthly-period semantics battle-tested at
79k★ scale, and a mature management UI — our slice 4 management window is exactly what
the concurrent build lane is shipping now. Verdict: parity of enforcement for the
single-operator reality we target; not yet parity of proof. Say "dispatcher-enforced,"
never "nobody else has it."

**2. Does our MCP exposure counter FleetQ's 675+ tools claim? Yes — effectively, and
this week the market helped.** FleetQ shipped nothing since Aug 19 and its own repo
description cut the claim to 450+ while the README still advertises 675+ — a
self-inflicted credibility discount on tool-count marketing. Our position was already
depth-over-count (docs/briefs/mcp-exposure.md): 13 schema-validated OpenClaw-native
tools, hidden-not-refused mutation gating behind OPENCLAW_MCP_MUTATIONS=1, receipt-
minted writes through the same governed path the UI uses, loop-surviving error
contract. FleetQ exposes generic platform breadth any LLM client can reach; we expose
gateway-session/cron-health/budget-ledger/audit state no generic platform can see.
The count race is over and not worth re-entering; keep the comparison framed as
"deep native surface vs inflated breadth."

## Capability comparison — us post-v2.0 vs the top competitors

Honest scoring per dimension. ✅ = clear lead, 🟨 = competitive/parity, ❌ = behind.

| Dimension | Us (v2.0.0) | Paperclip (79.3k★) | Mission Control (6.1k★) | FleetQ (62★) | LoopX (5.1k★) |
|-----------|-------------|--------------------|--------------------------|--------------|---------------|
| Live streaming | 🟨 Validated bridge (1,583-event spike), auth-hardened SSE fan-out, live console w/ secret redaction | 🟨 Chat-first tasks w/ live runs; authenticated live-events WS (fixed for authed proxies this release) | ✅ Core identity — live replay is their flagship | 🟨 Laravel Reverb WS graphs | ❌ CLI-first, no live dashboard story |
| Governance / enforcement | ✅ Dispatcher-enforced budgets (scope-chain, idempotent, fail-open documented), approval tiers NONE/PREVIEW/HOLD, receipts on every write, governance rules per action kind | ✅ Approval + review gates, revisioned config rollback, immutable audit, monthly hard-stops at scale — broader org model | 🟨 Approvals + RBAC direction, security hardening trailing ours by ~a week | 🟨 Risk-tier policy (auto/ask/reject), versioned policies + replay | 🟨 Typed confirmations + receipts, governed delivery |
| Cost control | ✅ End-to-end: schema → backfill → rollups → enforced budgets → SSE breaches → NL queries | ✅ Tracking + monthly hard-stops (static this window); Grok adapter just fixed to report real token usage | 🟨 Per-agent cost display, spend tracking — no enforcement | 🟨 Credit ledger, pessimistic locking, auto-pause (unshipped since Jun) | 🟨 Quota contracts, prompt-budget preservation |
| Extensibility / MCP | ✅ 13 deep OpenClaw-native tools, gated mutations mint receipts, stdio JSON-RPC, registration docs | ❌ No MCP exposure; Runner/PRP semantic dispatch is their coming answer (unreleased) | ❌ None advertised | 🟨 Breadth claim (450+/675+?) self-deflating, zero shipment since Jun | ❌ None advertised |
| Security posture | ✅ Published 11-finding audit, all closed; npm-audit critical gate in CI; bearer auth hardened across 4 servers; secret redaction layered (deny-regex lookarounds) | 🟨 Big reactive batch this release (ID-oracle leak, HMAC replay) — healthy cadence, no published audit | 🟨 Host allowlist fails closed, cookie/token revocation (Aug 20) — same direction, behind | ❌ "Production-grade" claims, no published audit | 🟨 Credential isolation + attack-path probes in their benchmark program |
| Installability / form factor | ✅ PWA standalone install w/ auth-gated SW registration + Win11 shell environment (35 windows, 19 widgets) | 🟨 Web app + PWA-ish mobile story + Cloud offering; heavy server stack required | 🟨 Self-hosted web console (SQLite-backed) | 🟨 PHP/Laravel/Docker stack | 🟨 pip-installed CLI; TUI-adjacent |
| Offline-first | ✅ IndexedDB state + reconnect sync; static deploy, no bundler | ❌ Server stack must live | ❌ Same | ❌ Same | 🟨 Local-first services, browser clients not offline-degradable |
| Zero-deploy single-operator | ✅ Static files + optional Node servers | ❌ Node+React+Postgres(+sandbox providers) | 🟨 SQLite helps, still a service | ❌ Docker stack | 🟨 pip install, but operator learns CLI |

Reading: after v2.0 we lead or tie on every dimension EXCEPT raw scale-proof and org-
model breadth, where only Paperclip operates — and Paperclip is structurally incapable
of retrofitting desktop-shell environment, offline-first, or zero-deploy cheaply. The
defensible line from scan #2 holds and widened.

## Updated steals list (picky — most things are no longer worth taking)

Already taken and shipped: cost analytics, six-panel command center, anomaly
thresholds, budget ledger + enforcement, session replay, receipts, MCP exposure,
memory graph/timeline, chain graphs, PWA, themes, NL command bar. Remaining, scored
Impact 1–10 / Effort 1–10:

| # | Feature | Stolen from | Impact | Effort | How it lands here |
|---|---------|-------------|--------|--------|-------------------|
| 1 | Remote-access recipe via tailnet HTTPS | Paperclip v2026.824.0 managed-runtime previews (least-privilege broker pattern) | 6 | 2 | Our loopback landmine (gateway `wss://127.0.0.1` inside WSL2) makes phone/remote ops painful. We do NOT need their broker complexity — a runbook + optional `tailscale serve` exposure of the dashboard staging slot gets signed HTTPS remote access with zero new network binds. Docs-first; code only if serve proves insufficient. |
| 2 | Task ↔ session conversation binding ("chat-style tasks") | Paperclip (chat tasks now their default) | 6 | 3 | Task detail gains a Conversation tab embedding the bound gateway session transcript via the ALREADY-SHIPPED session-reader routes + replay components. Read-only first; no new write path. Turns our replay machinery into the daily-driver view Paperclip bet their UX on. |
| 3 | Verified-capability snapshot pattern | Paperclip sandbox providers (declared ∩ verified ∩ configured, fail-closed) | 4 | 2 | Formalize how gateway-bridge/SSE/MCP features resolve effective capability (env flag ∝ declared, health probe ∝ verified, config ∝ configured) so surfacing states are provable rather than ad-hoc. Small refactor of existing checks + docs; strengthens the honesty contract we already market. |

Honorable mentions (not scheduled): LoopX-style reproducible ops-benchmark scenarios
(revisit IF the DAG telemetry GO lands ~2026-09-14 — a scenario suite would double as
Stage 2 regression coverage); goal ancestry chains on tasks (Paperclip — still nice,
still not daily-value for a single operator); LoopX typed transaction boundaries
(our migration 025 + dispatcher idempotency already cover the substance).

Explicit non-goals unchanged: no drag-drop editor breadth, no prompt IDE/RAG, no
multi-user RBAC, no tool-count arms race, no org-chart breadth against Paperclip.

## Positioning statement recommendation

> **OpenClaw Project WebOS is the self-hosted desktop environment for governing
> OpenClaw agents — live-streamed, budget-enforced, MCP-exposed, and deployable as
> static files.**

One-sentence short form for READMEs/launches: *"The self-hosted desktop environment
for governing OpenClaw agents."*

Rationale: "desktop environment" is the claim no competitor can copy without
abandoning their architecture (Paperclip = Node+React company plane, Mission Control =
web control plane, FleetQ = Laravel stack, LoopX = CLI); "governing" carries the v2.0
substance (enforced budgets, receipts, audit) where we now tie or lead; "OpenClaw
agents" keeps the native-depth moat explicit. Avoid "control plane" (contested by
Mission Control + LoopX + half the market) and avoid any governance-superiority claim
(Paperclip made governance table stakes at scale).

## Roadmap impact

Folded into `UPGRADE_ROADMAP.md` Post-2.0 Candidates (same commit):

1. Candidates 1 (workflow data normalization) and 2 (NL command bar `task.create`)
   are SHIPPED per CHANGELOG Unreleased (migration 025 CHECK widening + string-step
   lift; create-class verb mapping + task.create envelope) — boxes ticked with
   evidence pointers.
2. Candidate 3 (budget slice 4 management window) annotated as in-flight on the
   concurrent build lane.
3. New candidates added from steals #1 and #2 above (tailnet remote-access recipe;
   task-conversation binding).
