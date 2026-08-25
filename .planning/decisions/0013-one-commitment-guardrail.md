---
type: adr
id: 0013
title: One commitment guardrail, generated into every runtime
status: proposed
updated: 2026-08-25
links: []
---

# 0013 — The UCC commitment guardrail has one canon; every other copy is generated and CI-checked

- **Status:** Proposed — resolves [OD-44](OPEN-DECISIONS.md)
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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | — | Created; counts re-verified (19/8/3, not 20/8) |
