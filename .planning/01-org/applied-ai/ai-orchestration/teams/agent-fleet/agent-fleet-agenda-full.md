---
type: agenda-full
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: provisional
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-charter]]", "[[agent-fleet-premortem]]", "[[agent-fleet-agenda-board]]", "[[agent-fleet-directive]]", "[[agent-fleet-loops]]", "[[agent-fleet-schedule]]", "[[ai-orchestration-agenda-full]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[reliability-sre-charter|reliability-charter]]"]
---

# Agent Fleet — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

26 modules. 25 subclass `BaseAgent`. 23 registered. **≈18 can receive a message.**
Zero emit `nf_a.task_success_rate`.

The agenda follows from that spread. Before this team can improve any agent's
behavior, it has to be able to state — defensibly, in a number — which agents are
doing anything at all. That is not a preamble to the real work; given
[[agent-fleet-premortem]] #1 and #2, it *is* the real work for the first month.

## How

### 1. Publish the four counts, and make the honest one primary

`fleet.live_agent_ratio` = modules that can receive a message ÷ modules on disk.
**≈18/26 today.** Computable now, no NF-A required. Alongside it,
`fleet.orphan_modules` (**3**) and the stub list (**5**), never merged into one figure.

Cheapest supporting change: a **`stub: true` flag in `DEFAULT_AGENT_SPECS`**
(`agent_registry.py:51`). Today the registry reads as a capability list — nineteen
entries with plausible names and real descriptions, five of which only log. The
warning exists as prose at `core/orchestrator.py:214-217`. Making it a field means the
registry cannot be misread by a human, a deck, or an agent summarising the codebase.

### 2. The topic-graph check — the highest-value CI gate this team can add

`core/orchestrator.py:198-206` records the exact failure: an agent registered, enabled,
and subscribed to `email.inbound.raw`, *which had zero publishers*. Green on every
dashboard, dead in reality.

The check is static and grep-shaped: **every subscription resolves to at least one
publisher; every publish resolves to at least one subscriber.** Both directions.
No platform work, no NF-A dependency. It closes
[[agent-fleet-premortem]] #2 outright, and the repo has already paid once for its
absence.

### 3. Decide on the three orphans

`book_scraper_agent.py`, `dataset_creator_agent.py`, `recurring_order_agent.py` —
referenced by nothing but their own tests. Three outcomes are acceptable: adopt,
delete, or document the exemption. Drift is not.

`recurring_order_agent` is the sharp one and needs a decision from two directions:
it is a plain class outside the harness contract ([[harness-runtime-charter]]) **and**
a scheduled purchaser whose own feature list says *"auto-execution with manager
approval"* ([[action-safety-the-human-gate-charter]]).

### 4. Per-agent doneability, once NF-A exists

`nf_a.task_success_rate` **per agent**, stubs listed separately and never averaged in.
The single rule that makes the number honest is a subtraction, not an addition:
a stub that logs and returns posts a **perfect** score, so including stubs does not
blur the fleet figure — it inflates it.

### 5. Prompts become versioned artifacts with attached verdicts

Prompt edits currently merge like any other code change, against no gold set.
[[agent-evaluation-gates-charter]] defines what a verdict is; this team owns refusing
to merge a prompt change that has none — the same gate shape
`.github/workflows/ci.yml:226-230` already uses for merge policies.

### 6. Guardian canaries — the test of whether OD-24 works

`state_invariant_enforcer`, `drift_agent`, `inequality_detector`: inject a known
violation on a cadence that must be caught. Without it, a detector whose recall has
degraded is indistinguishable from a clean system, from both sides of the seam
([[agent-fleet-premortem]] #5). **Whether either team will own the canary is the
concrete test of OD-24.** If neither will, the split has failed and guardians should
go to one team end to end.

## Why now

1. **The stub-as-capability failure is one sentence away at all times.** Five
   registered, described, healthy-looking agents that only log. The mitigation is a
   boolean field and a board number.
2. **The topic-graph failure has already happened once**, cost a dead inbound-email
   pipeline, and nothing currently prevents a recurrence.
3. **Orphans get harder to adopt with age**, and one of them buys wine.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 1 | Publish `fleet.live_agent_ratio`, `fleet.orphan_modules`, stub list | — |
| 2 | `stub: true` in `DEFAULT_AGENT_SPECS` | — |
| 3 | Topic-graph CI check, both directions | — |
| 4 | Orphan decision × 3 | founder input on `recurring_order_agent` |
| 5 | Guardian canaries | OD-24 ownership |
| 6 | `nf_a.task_success_rate` per agent | NF-A emission (dept Step 0) |
| 7 | Prompt versioning + verdict gate | [[agent-evaluation-gates-charter]] verdict definition |

Steps 1–3 are unblocked and are roughly a week of work between them.

## Questions for the founder

1. **The three orphans — adopt, delete, or document?** `recurring_order_agent` is the
   one that matters: a scheduled purchaser, outside the harness contract, registered
   nowhere, with passing tests.
2. **OD-24 — who owns a guardian canary?** This is the operational form of "does the
   code/findings split work". If the honest answer is "neither team wants it", the
   split has already failed and guardians should be owned end to end by one team.
3. **The five stubs — keep, or delete?** Keeping them is defensible (they are declared,
   gated off, and mark intent). But intent stored in a registry is intent that will be
   read as capability. If they stay, they need the `stub: true` field. If any of them
   has no near-term plan, deleting it is cheaper than guarding it forever.
4. **Where is the fleet count published externally?** We would like to know every place
   an agent count appears outside `services/agent-orchestrator/`, because that list is
   the actual attack surface for [[agent-fleet-premortem]] #1.
