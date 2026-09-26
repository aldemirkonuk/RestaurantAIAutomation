---
type: adr
id: 0013
title: One commitment guardrail, generated into every runtime
status: proposed
updated: 2026-09-25
links: []
---

# 0013 — The UCC commitment guardrail has one canon; every other copy is generated and CI-checked

- **Status:** Proposed — resolves [OD-44](OPEN-DECISIONS.md) **[2026-09-25, PR #464: the guardrail is no longer the only thing between `_handle_scarcity_auto_reply` and a vendor. Founder ruling for #464, "gate, clear, then merge": the hold now also needs the house's `enable_ai_autonomous_send`, and no send runs from a message older than 24 hours. See "Addendum 2026-09-25" below. No ADR governed this agent's autonomy before; this is the record that named its auto-send path, so the bracket lives here.]**
- **Keywords:** UCC, contract formation, commitment language, guardrail, auto-send, drift, codegen
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — recorded by a session; not binding until locked
- **Links:** [OD-44](OPEN-DECISIONS.md), [0012](0012-reports-through-the-gateway.md)

## Context

`inbound-responder.service.ts:44-48` claimed its UCC contract-formation guardrail was
*"Ported verbatim"* from `provider_conversation_agent.py`, and that a matching draft
"must NEVER auto-send". Counted directly:

| Location | Patterns | Auto-sends? |
|---|---|---|
| `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts` | **19** | No — forces manager approval |
| `services/agent-orchestrator/agents/provider_conversation_agent.py` | **8** | **Yes** — `_scarcity_auto_reply` |
| `services/agent-orchestrator/services/constraint_engine.py` (C-02) | **3** | n/a — hard block |

**OD-44's "20" for TypeScript was off by one**: the array spans 21 lines, but one of
them is a `//` comment introducing the multilingual block. The real count is 19 —
10 English phrases and 9 French/Italian/Spanish/German ones. Python's 8 was correct.
The eleven TS-only patterns include `place the order`, `go ahead and ship`, and every
multilingual phrase.

The entry also understated the problem: there was a **third** list. `constraint_engine.py:19`
carried its own `COMMITMENT_PATTERNS` under the comment *"copied verbatim from
provider_conversation_agent.py"* — three broad co-occurrence regexes that are not a
phrase list at all. Two false parity claims, not one.

So the runtime that could actually bind the restaurant to a purchase ran the weakest
of three guardrails, and two code comments guaranteed nobody would notice.

## Options considered

1. **Shared JSON/YAML both runtimes read at runtime.** The obvious answer, and it
   does not ship. The services deploy as **separate containers**:
   `apps/api-gateway/Dockerfile` copies only `apps/api-gateway/dist` into the runtime
   image, and the orchestrator's Railway root directory is `services/agent-orchestrator`,
   so its build context cannot reach the repo root. No repo-root file exists in either
   image at runtime. A JSON file *inside* the gateway tree fails too — verified by
   building: `nest build` uses the swc builder, which emits `require("./x.json")` and
   **does not copy `.json` into `dist`**, so the gateway would crash on boot in
   production while passing every local test.
2. **Generate one runtime's list from the other's at build time.** Each container
   ships only its own tree, so both work unchanged. Costs a generator and a check.
3. **Keep two hand-maintained lists and add a test comparing them.** The test is the
   real deliverable either way, but two hand-written lists still invite a "quick fix"
   on the wrong side.
4. **Do nothing / just sync the numbers.** Fixes today; loses again in a month, which
   is exactly how the current 19-vs-8 gap opened under a "ported verbatim" comment.

## Decision

**Option 2.** Canon is `apps/api-gateway/src/common/orchestrator/commitment-patterns.ts`
(pure data: `readonly string[]` of pattern *sources*, JSON-escaped). `scripts/sync_commitment_patterns.py`
(stdlib only) parses it and writes `services/agent-orchestrator/core/commitment_patterns.py`,
marked GENERATED. The canon lives on the TypeScript side because that is where the
stronger list already was and where the guardrail is reviewed.

Patterns are stored as sources rather than `RegExp` literals so they stay in the
portable JS/Python intersection (`\b`, `\d`, `?`); case-insensitivity is applied per
runtime (`/i` ↔ `re.IGNORECASE`) and never encoded in the pattern. Python previously
lower-cased the text instead, which is not identical to `/i` for the accented
multilingual phrases.

**The anti-divergence test is the deliverable.** Three independent guards, so no
single runtime can move alone:

- `services/agent-orchestrator/tests/test_commitment_patterns_sync.py` — asserts the
  Python list equals the TS canon in order; re-runs the generator and requires byte
  equality (catches a hand-edit that still happens to agree); asserts the ten original
  English phrases are still present (a **floor** — the list may grow, never shrink);
  asserts portability; asserts the templated `_scarcity_auto_reply` hold message still
  clears the wider list, so raising 8 → 19 did not silently disable the auto-send path.
- `apps/api-gateway/src/common/orchestrator/commitment-patterns.spec.ts` — reads the
  generated Python module from disk and asserts set + order equality from the other side.
- CI job `commitment-guardrail-sync` — `sync_commitment_patterns.py --check`, blocking,
  no install step.

All three were confirmed to **fail** by deleting one pattern from the generated module,
then restored.

C-02 in `constraint_engine.py` was resolved as a **union, not a replacement**: it now
imports the shared list and keeps its three co-occurrence heuristics on top. Replacing
them would have stopped blocking things it blocks today (e.g. "we agree to buy 6 cases
at the offered price" matches no exact phrase) — a weakening disguised as a cleanup.

Nothing was dropped from the TypeScript list.

## Consequences

- Easier: the guardrail has one place to edit, and three ways to catch a divergence.
- Harder: changing it is now a two-file commit (edit canon, run generator). That
  friction is the point.
- Given up: the orchestrator container cannot regenerate its own module — it ships the
  generated file. The Python tests skip rather than fail if the sibling tree is absent.
- Revisit if: a third runtime needs the guardrail, or if the deployment topology changes
  such that both services share a filesystem — then option 1 becomes available and the
  generator can be retired.

## Addendum 2026-09-25 — the auto-send path also needs the house's switch, and a fresh message

**Why now.** `provider_conversation_agent` had never processed a message in production
(PR #464 fixes the boot failure that kept it off). Merging #464 turns it on. Two things
had to hold first, and the founder set the order on 2026-09-25: *"Gate, clear, then merge."*

1. **The hold obeys the house.** `_handle_scarcity_auto_reply` emails a vendor "please hold
   those for us" with no approval, and its fixed text clears this record's guardrail. It
   now also reads `restaurant_feature_flags.enable_ai_autonomous_send` on the house's
   `restaurant_settings` row, right before the send, with the gateway's rule
   (`inbound-responder.service.ts`, `isAutonomousSendEnabled`): only a stored literal
   `true` sends. No row, no restaurant, a read error or a thrown client send nothing, and
   the manager is told which of those it was.
2. **No send from an old message.** `conversation.approved`, `conversation.modified` and
   `conversation.auto_reply.urgency` are held when their publish time is more than 24 hours
   old, or cannot be proven. The window is `APPROVAL_MAX_AGE_SECONDS` in
   `services/plivo_voice_client.py`, reused rather than invented. A held approval goes back
   to `PENDING_APPROVAL` with `constraint_flags.reapproval_required.reason` set to a
   sentence the manager reads, a `conversation_reapproval_needed` notification carries the
   same sentence, and the hold is logged at WARNING. Keys that only draft are not held.
   The publish time is the Python envelope `timestamp`, or the AMQP `timestamp` property,
   which the gateway's `publishEvent` now stamps and `MessageBus.consume` forwards; the
   bus's retry re-publish keeps the original.

**Clear.** No broker purge was done. The queues were read on 2026-09-25 22:59 UTC through
the broker's management API, read-only: all 14 `queue.provider_conversation_agent.*` queues
held 0 messages, as did every other queue on the vhost (84). The code guard stays as the
standing rule rather than a one-off.

**Rejected.** A manual purge before merge (one-off, leaves nothing behind for the next
backlog, and deletes non-send messages too). Trusting a message with no publish time
(that is exactly the backlog case). Measuring age from the draft row (production's
`procurement_conversations` has no approval-time column; see `v3.0-TECH-DEBT.md`,
2026-09-25).

**Open.** Whether 24 hours is the right window for a vendor email, rather than the voice
call it was set for, is the founder's; it is reported as a candidate open decision, not filed.
**[2026-09-25, founder round 4 item 20 — answered, no longer open: "#464 stale-send limit
24 hours." The window stays at 24 hours for the vendor-email send path as built. It is still
borrowed from `APPROVAL_MAX_AGE_SECONDS` (`services/plivo_voice_client.py`), so a change to the
voice-call window would move this one too; `test_conversation_agent_send_gates.py` pins
`SEND_MESSAGE_MAX_AGE_SECONDS == APPROVAL_MAX_AGE_SECONDS == 24 * 3600`, which fails the build
if either moves without the other being decided. Source: founder answers recorded in session
6c6d8b93, memory `founder-answers-2026-09-25-web-rebuild.md` item 20.]**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | — | Created; counts re-verified (19/8/3, not 20/8) |
| 2026-09-25 | PR #464 lane | Addendum: autonomy switch + 24h send-age guard on the auto-send path |
| 2026-09-25 | W2-fix-cellar-team lane | Bracket: founder confirmed the 24-hour stale-send limit (round 4 item 20) |
