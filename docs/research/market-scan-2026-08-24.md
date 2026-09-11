---
layout: default
---

# Market Scan — 2026-08-24 (post-1.1.0 delta refresh)

Second competitive pass, 24h after `market-scan-2026-08-23.md`. Focus: what moved in
the market since ~Aug 20 vs what we shipped (v1.1.0 full security pass over all 4
servers, Playwright e2e in CI, Mission Control six-panel command center, gateway WS
bridge validated live, cost/token schema + summary API).

Method: live fetches on 2026-08-24 — GitHub REST API (stars, created/pushed dates),
releases.atom + commits.atom feeds, project sites/READMEs for the three named direct
competitors plus a fresh sweep for new entrants in the agent-ops dashboard space.

## Delta table vs 2026-08-23

| Competitor | Changed since ~Aug 20 | Threat delta |
|------------|----------------------|--------------|
| ClawFleet (clawfleet.io) | Nothing. Last commit Apr 27, last release v1.2.1 Apr 23. 167★ / 14 forks. Site now markets dual-runtime (OpenClaw + Hermes) but no shipped movement. | ▼ Dormant 4 months |
| FleetQ (escapeboy/agent-fleet-o) | No release since v1.27.0 (Jun 9); last main commit Aug 19 (retired-model circuit-breaker fix). README now advertises **675+ MCP tools across 45 domains**, Agentic AI Flywheel (self-growing evals + drift monitors), policy-governed autonomy (versioned per-agent policies + replay), 8 outbound chat channels. 62★. | ► Flat in window — but their MCP tool-count lead widened vs our planned read-only starter set |
| Mission Control (builderz-labs/mission-control) | 6,073★ (flat vs yesterday's ~6.1k). Last commit Aug 20: security hardening #939 — production host allowlist fails closed, logout revokes both session cookies + destroys tokens, `.env*` gitignore hardening. No release since v2.3.0 (Jul 25, dependency-security patch). | ► Flat — converging on the security posture we already shipped (our 11-finding audit closed Aug 23) |
| **NEW: Paperclip** (paperclipai/paperclip) | Not on yesterday's radar. **79,250★**, created Mar 2 2026, pushed today, daily canary releases (latest Aug 23 23:56, PR numbering past #12,000). Node.js + React. Positions as "If OpenClaw is an employee, Paperclip is the company": org charts for agents, approval gates + review gates, **per-agent monthly budgets with hard stop**, config changes revisioned + rollback, full tool-call tracing + immutable audit log, heartbeats/schedules, multi-company isolation, company templates export/import with secret scrubbing, phone-manageable dashboard. Explicitly OpenClaw-compatible. | ▲▲ New dominant threat — attacks our governance differentiator at 100× our traction |
| **NEW: LoopX** (huangruiteng/loopx) | Not on yesterday's radar. **5,049★** in <3 months (created May 31), pushed today, Trendshift badge. Provider-neutral local-first control plane over any harness (Codex, Claude Code, Cursor): durable goals/evidence/quota/handoffs, **protected-action preview with typed confirmation + receipts**, PWA dashboard + experimental Tauri desktop shell. | ▲ Watch — overlaps governance UX + "desktop" direction |
| NEW to radar: openclaw-mission-control (abhi1693) | Existed unscanned: 4,109★, created Feb 1, last push Aug 6. OpenClaw-Gateway-native orchestration dashboard. | ► Quiet but established — the "OpenClaw dashboard" niche is NOT empty |
| NEW to radar: openclaw-control-center (TianyiDataScience) | Existed unscanned: 4,001★, created Mar 11, **dormant since Apr 13**. "Turn OpenClaw from a black box into a local control center." | ▼ Stalled |
| NEW: ClawControl (clawcontrol.dev) | Commercial SaaS + BYOC mission board for OpenClaw agents: skill archetypes, auto-claim task board, @mention coordination, real-time WebSocket streaming. | ▲ Commercial entrant validating the niche |

Headline: the two named feature leaders (FleetQ, Mission Control) were **quiet** in the
window — our v1.1.0 security + streaming + command-center sprint outran both this week.
But the sweep found **Paperclip**: governance/budget/approval/audit features we call
differentiators, shipped at 79k★ scale with daily releases. "Governance nobody else
has" is no longer true as stated; the moat must narrow to what Paperclip structurally
lacks (desktop-shell environment, offline-first, zero-deploy single-operator,
content-publish pipeline depth).

## Top-5 features worth stealing (refreshed)

Dropped vs yesterday: cost analytics schema (shipped 88abe97), six-panel command
center (shipped 112b224/0a667ab), run-anomaly flagging v1 (thresholds shipped as named
constants + Mission Control panel). Scores: Impact 1–10, Effort 1–10 (lower = cheaper
in our vanilla-JS codebase).

| # | Feature | Stolen from | Impact | Effort | How it lands here |
|---|---------|-------------|--------|--------|-------------------|
| 1 | Budget ledger + auto-pause **hard stop** | FleetQ ledger; validated at scale by Paperclip ("monthly budgets per agent — when they hit the limit, they stop", atomic enforcement) | 9 | 3 | Migration `022_add_run_token_cost_tracking.sql` already accumulates per-run cost (Phase 0, shipped). Add per-agent/task budget rows, check at dispatch time, pause + notify on breach via existing approvals/pause machinery. **Pull forward from Phase 2 into Phase 1** — see roadmap edit in this commit. |
| 2 | Session replay inspector with time-travel stepper | AgentOps replay; Mission Control live replay | 8 | 4 | Already in-flight: design brief `docs/briefs/session-replay.md` written, rides shipped session-reader routes. Unchanged priority. |
| 3 | MCP server exposure — depth over count | FleetQ (675+ tools) | 8 | 4 | In-flight plan stands but reframed: do NOT chase tool count against FleetQ. Ship deep OpenClaw-native tools (sessions, cron health, memory proxy, handoffs, publish pipeline) that generic platforms cannot expose. Read-only first, writes behind approval gates. |
| 4 | Protected-action preview + receipts | LoopX | 7 | 2 | Typed preview before execution, explicit confirmation, receipt record appended to the audit trail. Small add on the existing Approvals window; strengthens the post-audit security story. Fold into the one-click-actions brief as mandatory UX. |
| 5 | Memory knowledge-graph view | Mission Control memory graph viz | 7 | 4 | Unchanged: Memory browser 2.0 graph-first reorder (semantic search backend exists). |

Honorable mentions (not scheduled): goal ancestry on tasks — every task carries its
goal chain so agents see the "why" (Paperclip); portable templates export/import with
secret scrubbing (Paperclip — adjacent to our planned snapshot/restore); mobile-responsive
ops dashboard (Paperclip); live team graph visualization (FleetQ, Cytoscape).

## Differentiator check — do competitors claim the same?

| Our claim (yesterday) | Market reality today | Verdict |
|----------------------|---------------------|---------|
| Desktop-shell UX unique | Still true — no competitor ships a windowed shell. LoopX's experimental Tauri wrapper + PWA narrows "desktop app feel" at the edges but is a single-window view, not an environment. | ✅ Hold, cite LoopX as nearest approach |
| Zero frameworks, no build step | Strengthened. Paperclip = Node+React+daily-canary churn; Mission Control = Next.js/pnpm; FleetQ = PHP/Laravel/Docker. We remain static-deploy, no bundler. | ✅ Stronger than yesterday |
| Native OpenClaw depth | **Weakened.** The niche now holds ≥5 OpenClaw-native consoles (us, ClawFleet, abhi1693/openclaw-mission-control 4.1k★, TianyiDataScience control-center 4k★, ClawControl SaaS). Depth still ours — cron health, memory proxy, handoffs, publish pipeline are not replicated by any of them — but "OpenClaw dashboard" is contested territory, not white space. | ⚠️ Narrow the claim to integration *depth*, not category ownership |
| Governance model nobody else has | **No longer true as stated.** Paperclip ships org charts, approval gates, revisioned config + rollback, immutable audit logs at 79k★. Our remaining distinction: governance over a *content publish pipeline* (departments → requests → approvals → publish) + runbooks, which Paperclip's generic org model does not implement. | ⚠️ Rephrase: publishing-pipeline governance, not governance itself |
| Offline-first | Still unique. LoopX is local-first (local services) but browser clients are not offline-degradable; Paperclip/MC/FleetQ all need their server stack live. | ✅ Hold |
| NEW: live gateway streaming + validated bridge | Table stakes, not a moat: ClawControl advertises WebSocket streaming, FleetQ ships Laravel Reverb WS live graphs, Mission Control's core is live replay. Our edge is narrower: bridge **validated against the live gateway** (1583 events, 0 dupes) behind an auth-hardened SSE surface. | ⚠️ Claim validation + security, not streaming itself |
| NEW: full security audit trail | Ahead in-niche today: our 11-finding audit closed with fixes + public doc; Mission Control's only recent security work is dependency patching + host-allowlist hardening (same direction, one week behind). FleetQ lists "production-grade" claims without a published audit. Advantage decays fast — keep `npm audit` CI gate moving. | ✅ Temporary lead, defend it |

## Recommendation — single highest-leverage next move

**Ship the budget ledger + auto-pause guardrail now, pulled forward into Phase 1.**

Rationale: Paperclip just made per-agent budgets with hard-stop enforcement table
stakes at 79k★ scale — it is the single feature where market expectation moved fastest
in this window. Everything required already exists on our side (cost/token schema
shipped and accumulating, approvals + pause machinery, Mission Control surface to
surface breaches), so effort ≈ 3 against impact ≈ 9. It also converts the fresh
security-audit credibility into a visible operator-facing guardrail before
expectations harden. Sequencing note: it depends on the still-open Phase 0 cost/token
history backfill landing first.

Explicit non-goals unchanged: no drag-drop editor breadth (n8n/Langflow/Flowise), no
prompt IDE/RAG (Dify), no multi-user RBAC. With Paperclip in the picture the defensible
line sharpens further: desktop-shell environment + offline-first + zero-deploy +
publish-pipeline governance — the four things a Node+React multi-company control plane
structurally cannot retrofit cheaply.
