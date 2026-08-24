---
type: charter
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: partial
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-premortem]]", "[[agent-fleet-agenda-full]]", "[[agent-fleet-agenda-board]]", "[[agent-fleet-directive]]", "[[agent-fleet-loops]]", "[[agent-fleet-schedule]]", "[[ai-orchestration-charter]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]", "[[reliability-charter]]", "[[technology]]", "[[README]]"]
---

# Agent Fleet — Charter

Team of [[ai-orchestration-charter]] · Division: **Applied AI** · Alias in the team
corpus: `[[aio-agent-fleet]]` (`technology.md:336`).

## Mandate

The agents themselves — behavior, prompts, subscriptions, per-agent doneability. Owns
whether `email_parsing_agent` actually parses email.

**Distinct from [[harness-runtime-charter]] because it owns *behavior* where Harness
owns *mechanism*.** Concretely: Harness cares that a retry happened; Fleet cares that
the retry was needed (`technology.md:341-342`).

## Boundaries

Owns `services/agent-orchestrator/agents/` — **26 modules**, and the registration map
at `core/orchestrator.py:174-211` that decides which of them exist as far as the
system is concerned.

**The fleet, counted four ways — and the four numbers are different:**

| Count | Value | Meaning |
|---|---|---|
| Modules on disk | **26** | `agents/*.py`, excluding `__init__.py` |
| Subclass `BaseAgent` | **25** | `recurring_order_agent.py:14` is a plain class |
| Registered | **23** | `core/orchestrator.py:174-211` |
| **Can receive a message** | **≈18** | 23 registered − 5 stubs gated off |

That spread is the team's founding fact. Every artifact here treats "how many agents
do we have?" as a question with four answers and one honest one.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| Lifecycle, retry, DLQ, sagas, registry mechanics | [[harness-runtime-charter]] | They own the contract; we own what runs inside it |
| Which model an agent uses, and its cost | [[model-routing-inference-economics-charter]] | No individual agent owns the routing decision (`technology.md:368-369`) |
| Whether an agent's output was *good enough* | [[agent-evaluation-gates-charter]] | An agent team that grades its own agents is the arrangement [[ORG_STRUCTURE]] §3 rejects for Red Team |
| Whether an action was permitted to execute | [[action-safety-the-human-gate-charter]] | We own what the agent proposes; they own whether it may run |
| **Guardian-agent findings and alert thresholds** | `[[sre-state-integrity]]` | **Co-ownership, stated deliberately** — see below |
| That a message arrived exactly once | `[[eng-messaging-delivery]]` | Draft vs. deliver (`technology.md:861`) |

### Guardian-agent co-ownership — OD-24, open

`state_invariant_enforcer.py`, `drift_agent.py`, `inequality_detector.py`, and the
`ghost_inventory_agent` / `shrinkage_detective_agent` stubs are **guardian** agents.
This team owns their **code**; `[[sre-state-integrity]]` owns their **findings** and
alert thresholds (`technology.md:356-359`). That is a real seam, not a formality: a
guardian whose findings nobody reads is `[[sre-state-integrity]]`'s premortem
(`technology.md:829-832`), and a guardian that does not detect is ours.

`technology.md:848` opens **OD-24** on whether this split is workable or whether one
team should own guardians end to end. This charter carries it forward as open.

## Metrics it moves

- **`nf_a.task_success_rate` per agent, with stub agents reported separately and never
  averaged into the fleet figure** (`technology.md:348-350`). The reason is mechanical:
  a stub that logs and returns posts a **perfect** success rate. Averaging stubs in
  does not merely blur the number — it moves it in the wrong direction.
- **`fleet.live_agent_ratio`** — modules that can receive a message ÷ modules on disk.
  **Today: ≈18/26.** Computable now, without NF-A. This is the number this team can
  publish this week.
- `fleet.orphan_modules` — modules referenced by nothing but their own tests.
  **Today: 3.**
- `fleet.subscription_coverage` — registered agents whose subscribed topics have at
  least one publisher. Today unmeasured, and the reason it matters is in the evidence.

## Evidence today

**EXISTS (21 by the team doc's count) / PARTIAL (5 stubs)** — with a correction that
lowers the live number.

**Live agents** (`technology.md:345`): `email_intel_agent`, `email_parsing_agent`,
`procurement_agent`, `provider_conversation_agent`, `rfq_agent`,
`recurring_order_agent`, `menu_analyzer_agent`, `sommelier_agent`,
`pos_integration_agent`, `inventory_engine`, `notification_agent`, `reporting_agent`,
`calendar_agent`, `book_scraper_agent`, `dataset_creator_agent`,
`visual_verification_agent`, `drift_agent`, `inequality_detector`,
`state_invariant_enforcer`, `buffer_manager`, `provider_communication_agent`.

**Declared stubs whose `process_message()` only logs** (`technology.md:346`):
`auto_pilot_agent.py`, `compliance_agent.py`, `ghost_inventory_agent.py`,
`negotiation_playbook_agent.py`, `shrinkage_detective_agent.py`. All five are
**registered** (`agent_registry.py:123-147`) and all five are gated off as `OPTIONAL`.

### Corrections verified this session

1. **Three modules are registered nowhere.** `book_scraper_agent.py`,
   `dataset_creator_agent.py`, and `recurring_order_agent.py` do not appear in
   `core/orchestrator.py:174-211`, and a repo-wide grep finds no reference to any of
   them outside their own module and their own tests. The team doc lists all three
   among the 21 "live". They are **PARTIAL at best** — code that runs in a test and
   nowhere else.
2. **`recurring_order_agent.py:14` is a plain class**, not a `BaseAgent` subclass, so
   it also carries no retry, idempotency, DLQ or health check
   ([[harness-runtime-charter]] §Evidence).
3. **The repo already documented this trap, in its own words.**
   `core/orchestrator.py:214-217`:
   > *"Registered is not the same as running, and reporting only the former overstates
   > the system. Five of these are OPTIONAL, unimplemented stubs that get no proxy and
   > never subscribe — a count of 20 read as 20 working agents, which is how
   > 'registered' came to be mistaken for 'live.'"*
4. **Registration alone is not sufficiency, also documented.**
   `core/orchestrator.py:198-206` records that `EmailIntelAgent` and
   `EmailParsingAgent` were *"fully implemented and absent from this registry, so
   nothing consumed inbound vendor email at all"* — and that registering them exposed
   two further defects: `EmailIntelAgent` subscribed to `email.inbound.raw`, **which
   has zero publishers**, and `EmailParsingAgent.process_message` took two arguments
   where `BaseAgent` passes one. *"Three defects, each of which alone would have made
   the pipeline dead, and the missing registration hid the other two."*

That last one is why `fleet.subscription_coverage` is on this charter. **Registered,
enabled, subscribed, and reachable are four different states**, and the repo has
already been burned by the gap between the last two.

## Status

`partial` — 26 modules, ≈18 that can receive a message, 5 stubs, 3 orphans, and no
`nf_a.task_success_rate` emitted for any of them.
