---
type: charter
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: partial
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.declared_stub_count, roster.maturity_level_evidenced_pct, roster.headcount_claim_variance]
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[roster-lifecycle-premortem]]", "[[roster-lifecycle-agenda-full]]", "[[roster-lifecycle-agenda-board]]", "[[roster-lifecycle-directive]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-schedule]]", "[[performance-doneability-charter]]", "[[agent-fleet-charter]]", "[[harness-runtime-charter]]", "[[ai-orchestration-charter]]", "[[reliability-sre-charter]]", "[[runtime-resilience-charter]]", "[[legal-charter]]", "[[decision-office-charter]]", "[[PROJECT]]"]
---

# Roster & Lifecycle — Charter

Division **Corporate** → Department [[people-agent-ops-charter]] → Team `roster-lifecycle`
(§4.1 of `.planning/foundation/teams/corporate.md:324-355`).

## Mandate

Own **who is on the roster**: which agents exist, at what maturity, and what an agent must
have before the orchestrator will start it. This team keeps the record of the workforce
matching the workforce. It owns the roster, the stub register, the declared-exclusion
register, the Level 0→4 maturity ladder, and the onboarding and retirement of agents.

Its single organizing claim: **a worker that no record names is worse than a worker that
does not exist**, because the second is visibly missing and the first is invisibly
missing. The repo already agrees with this — it is why `IS_STUB` exists.

## Boundaries

Owns outright:

- **The census** — the three-way diff between the filesystem
  (`services/agent-orchestrator/agents/`, 26 modules), the orchestrator's class map
  (`core/orchestrator.py:174-211`, 23 entries), and `DEFAULT_AGENT_SPECS`
  (`core/agent_registry.py`, 19 keys).
- **The onboarding gate** — the checklist an agent passes before registration: extends
  `BaseAgent`, has a declared spec (tier, dependencies, feature flag, idle timeout), has
  an owner, has a task type with a doneability criterion named (the criterion itself comes
  from elsewhere — see non-goals).
- **The stub register** — the five modules declaring `IS_STUB = True` and the boot-time
  refusal at `core/orchestrator.py:245`.
- **The declared-exclusion register** — modules that are deliberately not message-bus
  agents, recorded with a reason. `recurring_order_agent` is its founding entry.
- **The maturity ladder** — Level 0→4, and the requirement that each level be a
  machine-checkable predicate over the repo rather than a prose descriptor.
- **Retirement** — the decision to delete a worker and the durable record of why.
- **Human HR, in principle** — see the non-goal below; there is nobody to apply it to.

## Distinct from [[performance-doneability-charter]] because

4.1 asks *does this worker exist and is it wired in*; 4.2 asks *did the task get done and
at what cost* (`corporate.md:357-360`). The two fail independently and — decisively — they
fail at **different speeds and different costs**. Roster hygiene is cheap, visible and
structural: a census is a script, a fix is a line in a dict, and the result is checkable
the same day. Doneability instrumentation is expensive, invisible and statistical: it
needs a criterion definition owned by another division, a schema change, and a golden set.

Under one team the cheap visible work wins every week — *"which is a prediction the
current state already confirms"* (`corporate.md:333-334`). The split exists so that the
easy work cannot quietly become the department.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the work was any good; per-agent cost | [[performance-doneability-charter]] | We say the worker is on the roster; they say whether it should stay |
| Defining what a doneability criterion *means* | [[evaluation-doneability-charter]] *(Research & Math)* | The onboarding gate requires that a criterion **exists**; it does not author one |
| Deciding which agents the product needs | [[agent-fleet-charter]] *(Applied AI)* | They ask "should this agent exist"; we ask "does the record match reality" |
| `BaseAgent` itself — retry, circuit breaker, DLQ, backpressure | [[harness-runtime-charter]] *(Applied AI)* | We require an agent to use the harness; we do not build it |
| A running agent that crashes, alerts, or degrades | [[runtime-resilience-charter]] *(Platform)* | A crashed agent is an incident. A **dark** agent is a roster defect. Different failure, different owner |
| Writing or fixing an agent's business logic | [[ai-orchestration-charter]] / [[agent-fleet-charter]] | We open the defect; we do not implement the agent |
| **Human payroll, benefits, hiring pipeline** | Nobody, until the trigger fires | Below |

### Human Ops — the non-goal-until-triggered

A separate **Human Ops** team was proposed and **rejected** (`corporate.md:412-419`):
there is one person, and a team whose workforce is its own founder is symmetry, not
structure. Its scope sits here, dormant.

**Entry trigger: the second human on the payroll.** On that trigger this team acquires
human onboarding and the request into [[legal-charter]] for employment paper, and a
human-review rubric becomes a real gap rather than a theoretical one. Until then, nothing
in this charter describes a process with a human subject — and per premortem M5 of the
department, writing one would be the failure, not the preparation.

## Metrics it moves

**Primary: `roster.truth_pct`** — the share of the 26 agent modules whose registered state
matches reality on four predicates: extends `BaseAgent` · registered · declared spec
present · stub flag accurate.

| Metric | Baseline today |
|---|---|
| `roster.truth_pct` | **≤ 73%** — at least 7 defects across 26 modules |
| `roster.unregistered_module_count` | **3** |
| `roster.silent_default_spec_count` | **4** |
| `roster.declared_stub_count` | **5** — accurate, and correctly enforced at boot |
| `roster.headcount_claim_variance` | **4 distinct live numbers** — 19 · 23 · 24 · 26 |
| `roster.maturity_level_evidenced_pct` | **0%** — the ladder is prose only |

Neural-footprint tie: indirect but load-bearing. An unregistered agent emits **no** NF-A
at all — no metrics, no health check, no `decision_log` row. Roster truth is therefore the
floor under `nf_a.emission_coverage`: a fleet the record cannot name cannot be measured
by [[performance-doneability-charter]] no matter how good the instrumentation gets.

## Evidence today

**PARTIAL — the infrastructure is real and unusually thoughtful; the record over it is
not.** All counts verified in this session against the working tree.

### Real roster infrastructure that already exists

- `core/agent_registry.py` — 491 lines. `AgentTier` (`:27`: `CORE` / `ON_DEMAND` /
  `OPTIONAL`), `AgentSpec` (`:36`: name, class, tier, dependencies, feature flag, idle
  timeout, description), `LazyAgentProxy` (`:162`) with suspend/resume/idle tracking,
  `AgentRegistry` (`:299`) with dependency-ordered startup (`get_startup_order`, `:401`).
- `core/orchestrator.py:245` — **refuses to start a stub even when its feature flag is
  set**, with the reasoning in the code (`:239-244`): an enabled no-op *"subscribes to
  real events and silently discards them — which looks healthy from every dashboard.
  Failing loudly at boot is the only version of this that cannot be mistaken for
  working."* This is the team's model finding and it predates the team.

**Note the gap this exposes: `AgentTier` is a *startup-behaviour* tier, not a maturity
level.** The repo has no maturity ladder in code at all. Conflating the two would be an
easy and wrong first move.

### The defects — this team's opening backlog

**1. Three modules are registered nowhere.**

| Module | Extends `BaseAgent`? | Referenced outside its own file? |
|---|---|---|
| `agents/book_scraper_agent.py:17` `class BookScraperAgent(BaseAgent)` | yes | **no** |
| `agents/dataset_creator_agent.py:26` `class DatasetCreatorAgent(BaseAgent)` | yes | **no** |
| `agents/recurring_order_agent.py:14` `class RecurringOrderAgent:` | **no** — plain class | only its own test and factory |

The first two are the sharper finding: **full `BaseAgent` machinery, zero call sites.**
The third is the one the division agent flagged, and it is a *decision* rather than a bug
— its docstring (`:17-21`) states the exclusion deliberately: *"Standalone scheduler — not
a message-bus agent. Lifecycle is managed through the explicit start() / stop() methods
rather than the BaseAgent subscribe-and-process loop."* It has a factory
(`:387-391 get_recurring_order_agent`) and a test suite
(`tests/test_recurring_order_agent.py`). It still has no `AgentMetrics`, no health check,
no retry, no DLQ, and appears on no roster.

**2. Four registered agents have no declared spec.** `provider_conversation_agent`,
`email_intel_agent`, `email_parsing_agent`, `provider_communication_agent` are in the
orchestrator's class map but absent from `DEFAULT_AGENT_SPECS`. At
`core/agent_registry.py:337`, `DEFAULT_AGENT_SPECS.get(name, {})` returns `{}`
**silently**, so tier, dependencies, feature flag and idle timeout are undeclared defaults
that are indistinguishable from declared ones. This is `IS_STUB`'s exact lesson — absent
and correctly-absent must not look alike — occurring in the registry that enforces it.

**3. The defect class already cost the repo once, and the code says so.**
`core/orchestrator.py:198-206`, verbatim: *"Both were fully implemented and absent from
this registry, so nothing consumed inbound vendor email at all… Three defects, each of
which alone would have made the pipeline dead, and the missing registration hid the other
two."* It was found reactively, fixed, and **no check was built**. Building it is this
team's first assignment.

**4. Four headcounts, none reconciled.** 19 declared specs · 23 registered classes ·
**24** claimed in [`.planning/PROJECT.md`](../../../../PROJECT.md):33 and :121 · 26 modules
on disk. `PROJECT.md:117` states *"24 agents exist but all are Level 0-1 (prototype
quality)"* — a per-agent claim with no per-agent evidence anywhere.

**5. Five stubs, correctly declared.** `auto_pilot`, `compliance`, `ghost_inventory`,
`negotiation_playbook`, `shrinkage_detective`. This one is a **pass**, and it is recorded
as a pass so the roster shows what right looks like.

### Corrections to the evidence source

- `corporate.md:474` baselines this team at **"≥2 defects / 26"**. Verified: **at least
  7** — 3 unregistered plus 4 silent-default specs.
- `corporate.md:348` says `recurring_order_agent` *"is not exported from
  `agents/__init__.py`"*. True but non-distinguishing: `agents/__init__.py` is three lines
  and exports nothing — *"# Agents will be imported by orchestrator"*. No agent is
  exported from it. The load-bearing facts are the missing orchestrator entry and the
  missing base class.
- `corporate.md:346-351` calls the module *"the one that does not"* extend `BaseAgent` —
  correct (25 of 26 do) — but it is **not** the only unregistered one. Two `BaseAgent`
  subclasses are equally dark.
