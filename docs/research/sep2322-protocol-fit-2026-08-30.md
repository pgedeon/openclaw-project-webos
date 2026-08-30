---
layout: default
---

# SEP-2322 MCP Elicitation — Protocol-Fit Check

**Date:** 2026-08-30 · **Scope:** research-only fit check (no code changes) for the
UPGRADE_ROADMAP Post-2.0 candidate "MCP approval elicitation via SEP-2322" (market
scan 2026-08-30 steal #3, FleetQ #148). Question: can our stdio JSON-RPC MCP server
surface approval prompts through elicitation without breaking the hidden-not-refused
contract — and would anyone see them?

**Sources:** repo code/tests/docs at 5c62721; installed OpenClaw gateway 2026.7.1-2
(0790d9f) at `/usr/lib/node_modules/openclaw` (dist + bundled
`@modelcontextprotocol/sdk` 1.29.0); local client config `/root/.openclaw/openclaw.json`.
Competitor repos were NOT re-fetched — FleetQ's migration is taken as reported by the
2026-08-30 scan.

## Background: what elicitation is

SEP-2322 landed in the MCP spec revision **2025-06-18**: a server may send
`elicitation/create` requests mid-session; the client declares an `elicitation`
capability in initialize and renders the request (form/url mode) to the human, returning
approve/decline. It is a client-capability feature — a server must not send it unless
the client declared support during the handshake.

## Q1 — Spec baseline: what does our MCP client support TODAY?

**Server side (ours):** pins `2024-11-05` (`lib/mcp-server.js:53`, returned in the
initialize reply at `:1044-1048`). Elicitation is outside that negotiated version.

**Client side (OpenClaw bundle-mcp, the client that spawns our server):** verified from
the installed gateway dist, not assumed:

- The client constructs the SDK `Client` with **no capabilities** —
  `new Client({name:"openclaw-bundle-mcp", version:"0.0.0"}, {jsonSchemaValidator, listChanged:{tools}})`
  (`dist/agent-bundle-mcp-runtime--G82BMQs.js`, Client construction; zero
  `setRequestHandler` calls in the whole runtime). It therefore declares **no
  elicitation capability** and registers **no elicitation handler**.
- If a server sends `elicitation/create` anyway, the SDK's protocol layer auto-replies
  **JSON-RPC error `-32601 "Method not found"`** for unregistered server-initiated
  methods (`@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`, `_onrequest`). So
  the client neither answers nor gracefully declines (no `ElicitResult` with
  `action:"decline"`) — it errors, and the session/connection survives.
- Version negotiation is not the blocker by itself: the SDK client offers
  `2025-11-25` and accepts our `2024-11-05` (it is in the SDK's
  `SUPPORTED_PROTOCOL_VERSIONS`). The blocker is capability + handler + UI, all absent.
- Posture corroboration: OpenClaw's Codex harness documents that "Other MCP elicitation
  requests fail closed" (`docs/plugins/codex-harness-runtime.md`), and its Codex
  app-server bridge auto-answers `mcpServer/elicitation/request` with
  `{action:"decline"}` (`dist/shared-client-DvwsvGGC.js`). OpenClaw's house style is
  decline/fail-closed, never operator-rendered, today.

**Config side:** `mcp.servers["webos-dashboard"]` in `/root/.openclaw/openclaw.json` is
stdio with a `toolFilter.include` of the 10 read-only tools — consistent with the
server's own gating; no elicitation-related client settings exist.

**Verdict Q1: NOT SUPPORTED.** The client does not answer elicitation requests; unsent-
per-spec they are impossible, sent-anyway they get `-32601`. Nothing breaks, but nothing
approves either. Client behavior is verified from the installed dist; whether a future
OpenClaw release adds elicitation rendering is **unverifiable from here**.

## Q2 — Contract conflict with hidden-not-refused

The invariant (brief AC6, `docs/briefs/mcp-exposure.md:229`; `docs/mcp-server.md`
"Flag semantics"): with `OPENCLAW_MCP_MUTATIONS` unset, the mutating trio is ABSENT from
`tools/list` (`lib/mcp-server.js:1009-1013`) and `tools/call` on them answers `-32601`
indistinguishable from any absent method (`:1066-1071`), with zero HTTP fetches — pinned
by `tests/test-mcp-server.js:444,462-472,734`. Rationale: a read-only client never sees
a write affordance to refuse.

Concrete tensions if elicitation were added as imagined:

1. **Visibility leak.** An approval round-trip presumes the tool is listed so a client
   can call it and get prompted. Listing the trio for all clients leaks the mutation
   surface's existence and directly violates the documented invariant + its tests.
2. **No HOLD-tier subject.** The steal's premise ("HOLD-tier MCP mutation requests")
   does not match our registry: the MCP-reachable kinds are `task.create` (LOW,
   confirm NONE), `task.update` (MEDIUM, PREVIEW_MODAL), `snapshot.create` (LOW, NONE)
   (`lib/action-registry.js`). `HOLD_CONFIRM` exists only for `run.cancel`, which is
   UI-only and deliberately NOT tool-exposed. There is nothing HOLD-tier to elicit.
3. **Redundancy when flag-on.** Gating elicitation behind `OPENCLAW_MCP_MUTATIONS=1`
   (the only leak-free variant) adds a prompt to sessions the operator already
   explicitly opted into writes for — governance pre-check + receipts already cover
   the audit need. Prompt-after-opt-in is ceremony, not control.

Compatible designs exist but all weaken or duplicate the current gate: (a) a single
always-visible "request mutation" tool that elicits per call — keeps the trio hidden
but still leaks that mutations exist, a deliberate posture change requiring owner
sign-off; (b) elicitation-behind-flag — leak-free but valueless (see 3).

**Verdict Q2: DIRECT CONFLICT.** No as-specced design preserves hidden-not-refused;
every compatible reshape trades away part of the invariant's value.

## Q3 — Round-trip reality: can our stdio loop do server-initiated requests?

No. `runStdio` (`lib/mcp-server.js:1137-1147`) is a sequential
`for await (const line of rl)` → `handleLine` → write loop. There is no outbound
request machinery: no server→client id allocation, no pending-response correlation, no
timeouts, no concurrent stdin reads while a tool call is in flight. A `tools/call`
handler that blocked on an elicitation response would **deadlock**: the client's answer
arrives on stdin while the async iterator is still awaiting the current `handleLine`,
and nothing in `handleLine` can route an inbound result to a waiting outbound request.
Supporting elicitation means a dispatch-model change (concurrent read pump + outbound
request manager) in a hand-rolled no-SDK server — the largest single cost item here.

**Verdict Q3: NOT SUPPORTED TODAY.** Structural change required before any round-trip.

## Q4 — Value honesty: who would actually see the prompt?

- Primary consumer: OpenClaw agents over stdio (`webos-dashboard` registration; pilot
  evidence in `docs/mcp-server.md`). That client has no elicitation handler and no
  rendering path — prompts would be swallowed as `-32601`. **Nobody sees anything.**
- Secondary consumer: Claude Desktop (documented client shape in `docs/mcp-server.md`).
  Whether current Claude Desktop renders form-mode elicitation is **unverifiable from
  here** — and even if it does, Q2's contract conflict still blocks listing the trio.
- FleetQ's migration proves the shape on a Laravel/HTTP stack with a web UI that owns
  the prompt surface. Our consumers are agents over stdio; the operator-facing approval
  UX already exists where the operator actually is (dashboard PREVIEW_MODAL /
  HOLD_CONFIRM), and per-spawn env consent is the coarse gate.

**Verdict Q4: NO CONSUMER TODAY.** Value is near-zero regardless of protocol fit until
OpenClaw's MCP client renders elicitation to the operator.

## Overall verdict

**CONDITIONAL — do not build before the condition holds, and only with a reshape.**

Condition (all three, checkable): (1) OpenClaw's bundle-mcp client declares the
`elicitation` capability and renders prompts to the operator (watch gateway release
notes; re-verify by inspecting the installed dist for a `setRequestHandler` on
`elicitation/create`); (2) an owner-approved posture change defines what may be
surfaced (visible-but-gated "request mutation" tool or equivalent) that explicitly
revises hidden-not-refused rather than violating it; (3) a real HOLD-tier MCP kind
exists to gate. Until then the candidate stays shelved: no client support (Q1), direct
contract conflict (Q2), missing transport machinery (Q3), zero consumers (Q4).
