---
type: charter
division: corporate
department: people-agent-ops
status: partial
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.maturity_level_evidenced_pct, nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate]
updated: 2026-08-24
links: ["[[people-agent-ops-premortem]]", "[[people-agent-ops-agenda-full]]", "[[people-agent-ops-agenda-board]]", "[[people-agent-ops-directive]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-schedule]]", "[[roster-lifecycle-charter]]", "[[performance-doneability-charter]]", "[[ORG_STRUCTURE]]", "[[corporate]]", "[[0006-neural-footprint-architecture]]", "[[research-math-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[ai-orchestration-charter]]", "[[agent-fleet-charter]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[model-routing-inference-economics-charter]]", "[[reliability-sre-charter]]", "[[legal-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# People & Agent Ops — Charter

Parent division: **Corporate** ([[ORG_STRUCTURE]] §2). Siblings in-division: Legal,
Knowledge & Documentation, Compliance & Privacy, Strategy & Fundraising.

## Mandate

People & Agent Ops is **the HR function of a company whose workforce is agents**. It is
accountable for one question asked in two halves: *who is on the roster, and are they any
good.* It owns the register of who exists at what maturity, the gate an agent must pass
before the orchestrator will start it, the review that says whether a worker's output was
actually *done* rather than merely non-crashing, and the cost that work carried. It is
the **primary consumer of NF-A** ([ADR 0006](../../../decisions/0006-neural-footprint-architecture.md),
[[README]] §4.2) — the department that reads the trace rather than the one that emits it.

Human HR is in scope in principle and empty in practice: there are **no employees today**.
See "Human Ops" below — considered, and deliberately not made a team.

## Boundaries

Owns outright:

- **The roster** — which agent modules exist, which are registered, which are stubs, which
  are dark. Today: `services/agent-orchestrator/agents/` (26 modules) against
  `services/agent-orchestrator/core/orchestrator.py:174-211` (23 registered) against
  `core/agent_registry.py` `DEFAULT_AGENT_SPECS` (19 declared).
- **The onboarding gate** — what an agent must have *before* it may be registered:
  extends `BaseAgent`, has a declared spec, has a tier and dependencies, has a doneability
  criterion for its task type, and has an owner.
- **The maturity ladder** — Level 0→4, which exists today only as prose in
  [`.planning/PROJECT.md`](../../../PROJECT.md):33.
- **Retirement** — the decision to delete a worker, and the record of why.
- **Performance review of an agent** — applying doneability criteria and agent-attributed
  cost to the fleet, per task type.
- **The stub register** — the five modules that declare `IS_STUB = True` and the boot-time
  refusal that keeps them from running.

Structured as **two teams, because "who is on the roster" and "is the roster any good"
fail independently — and the evidence shows both are already failing, in different
directions** (`.planning/foundation/teams/corporate.md:320-323`):

| Team | The question it owns | Evidence | Primary metric |
|---|---|---|---|
| [[roster-lifecycle-charter]] | *Does this worker exist and is it wired in?* | PARTIAL | `roster.truth_pct` |
| [[performance-doneability-charter]] | *Did the task get done, and what did it cost?* | PARTIAL | `nf_a.doneability_verdict_coverage` — **0%** |

## Explicit non-goals

Three departments touch agents. **Each owns a different verb**, and the verbs are the
boundary:

| Verb | Department | What that means |
|---|---|---|
| **Define** | [[research-math-charter]] *(Intelligence)* | Owns the *methodology* — what a doneability verdict means, how it is computed, and the NF-A event spine. |
| **Run** | [[ai-orchestration-charter]] *(Applied AI)* | Owns the *runtime* — the harness, routing, retries, DLQ, the gates in CI and prod. |
| **Employ** | **People & Agent Ops** *(this department)* | Owns *applying* it to the roster — hiring (registering), onboarding, review, retirement. |

Stated as non-goals, explicitly:

| Not ours | Whose it is | The line |
|---|---|---|
| The **definition** of a doneability criterion, and the statistics behind a verdict | [[evaluation-doneability-charter]] *(Research & Math)* | They decide what "done" means for a task type; we decide what happens to the worker whose tasks keep failing it |
| The **NF-A event contract, schema, and emission** | [[neural-footprint-instrumentation-charter]] *(Research & Math)* | They emit; we consume. If both own the metric definition it will be defined twice (`corporate.md:509-512`) |
| **Model routing, cost-optimal model choice, inference economics** | [[model-routing-inference-economics-charter]] *(Applied AI)* | They choose the cheaper model; we notice the agent is expensive |
| **The harness itself** — `BaseAgent`, retry, circuit breaker, DLQ, backpressure | [[harness-runtime-charter]] *(Applied AI)* | We require an agent to *use* it; we do not build it |
| **Running the gates** in CI and production | [[agent-evaluation-gates-charter]] *(Applied AI)* | They fail a build; we fail a review |
| **What an agent should be built to do** — fleet composition by product need | [[agent-fleet-charter]] *(Applied AI)* | They ask "should this agent exist"; we ask "does the record say it exists, and does the record match reality" |
| **Uptime, alerting, incident response** for running agents | [[reliability-sre-charter]] *(Platform)* | A crashed agent is an incident; a *dark* agent is a roster defect |
| **Employment paper** — contracts, IP assignment, contractor agreements | [[legal-charter]] *(Corporate)* | When there is a second human, we request; Legal drafts |
| **Human payroll, benefits, hiring pipeline** | Nobody, deliberately — see below | Zero employees. Naming it a team would be pure symmetry |

### Human Ops — considered and rejected

A third team, **Human Ops** (real employees, payroll, human reviews), was proposed and
**rejected** (`corporate.md:412-419`). There is one person today; a team whose entire
workforce is its own founder is a box on a chart, not a unit. Its scope sits inside
[[roster-lifecycle-charter]] as an explicit non-goal-until-triggered.

**Split trigger: the second human on the payroll.** Note the ordering consequence, stated
plainly rather than discovered later: the AI-native HR function will have a mature
**agent**-review rubric before it has a **human**-review one. That is correct here, not an
oversight.

## Metrics it moves

No roll-up number. Roster truth and doneability coverage measure different failures and
are not commensurable — a roster that is 100% accurate about agents that produce
confidently wrong output is not a good outcome, and averaging the two would hide exactly
that.

| Metric | Meaning | Baseline today |
|---|---|---|
| `roster.truth_pct` | % of the 26 modules whose registered state matches reality | **≤ 73%** — 7 known defects (see below) |
| `roster.unregistered_module_count` | Modules with no entry in the orchestrator's class map | **3** |
| `roster.silent_default_spec_count` | Registered agents whose tier/deps/flags come from an empty `{}` fallback | **4** |
| `roster.maturity_level_evidenced_pct` | Agents whose declared Level is backed by evidence rather than prose | **0%** |
| `nf_a.doneability_verdict_coverage` | % of task completions carrying a machine-checkable verdict | **0%** |
| `nf_a.cost_per_task` / `nf_a.cost_per_completed_task` | USD per task, per agent | **Not derivable** — see blocking defect |
| `nf_a.verified_task_success_rate` | Success meaning *correct*, not *did not raise* | **Unmeasurable** |
| `nf_a.task_success_rate` | What `AgentMetrics` records today | Measurable — and **measures liveness, not correctness** |

Neural-footprint tie: this department is the **consumer** side of NF-A. `nf_b.*` is not
ours at all — a guest is not a worker.

## Evidence today

**PARTIAL — the infrastructure is real; the record over it is not, and the decisive half
of the telemetry does not exist.**

Verified in this session against the working tree (branch
`feat/beverage-catalogue-wine-identity`).

### The fleet, counted

| Count | Source |
|---|---|
| **27** `.py` files in `services/agent-orchestrator/agents/` | `ls -1 *.py` |
| **26** agent modules — the 27th is `__init__.py` | `ls -1 *.py | grep -v __init__` |
| **25** extend `BaseAgent` | `grep -l "BaseAgent)" agents/*.py` |
| **1** does not: `services/agent-orchestrator/agents/recurring_order_agent.py:14` — `class RecurringOrderAgent:` | plain class |
| **5** declare `IS_STUB = True` | `auto_pilot`, `compliance`, `ghost_inventory`, `negotiation_playbook`, `shrinkage_detective` |
| **23** registered | `core/orchestrator.py:174-211` |
| **19** have a declared spec | `core/agent_registry.py` `DEFAULT_AGENT_SPECS` |
| **24** claimed | [`.planning/PROJECT.md`](../../../PROJECT.md):33 and :121 |

**Four different headcounts — 19, 23, 24, 26 — and no artifact in the repo reconciles
them.** That sentence is the department's founding condition.

### What exists and is genuinely good

- `core/agent_registry.py` (491 lines) — real roster infrastructure: `AgentTier`
  (`:27`), `AgentSpec` (`:36`), `LazyAgentProxy` (`:162`), `AgentRegistry` (`:299`).
- `core/orchestrator.py:245` — **refuses to start a stub even when its feature flag is
  on**, with the reasoning written into the code: an event-consuming no-op *"looks healthy
  from every dashboard"* (`:242-243`). This is the department's model finding and it
  predates the department.
- `core/base_agent.py:77` `AgentMetrics` — messages received/processed/failed/skipped,
  processing time, `circuit_breaker_trips` (`:96`), `pause_count`/`restart_count`
  (`:101-102`), `success_rate` (`:144`), `get_health()` (`:985`).
- `core/observability.py:113-118` — Prometheus `agent_processing_duration_seconds`
  histogram labelled by `agent_name`, with a `NoopMetric` fallback (`:53`).
- `core/base_agent.py:743` `log_decision()` — writes `agent_name`, `decision_type`,
  `inputs`, `reasoning`, `output`, `confidence`, `correlation_id` to `decision_log`
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2687`).

### The defects that define the first year

1. **Three modules are registered nowhere** — `book_scraper_agent`,
   `dataset_creator_agent`, `recurring_order_agent`. The first two **extend `BaseAgent`**
   and are referenced from no other file in the repo: full worker machinery, zero call
   sites. The third is the plain class at `:14`.
2. **Four registered agents have no declared spec** — `provider_conversation_agent`,
   `email_intel_agent`, `email_parsing_agent`, `provider_communication_agent`. At
   `core/agent_registry.py:337`, `DEFAULT_AGENT_SPECS.get(name, {})` returns an empty dict
   **silently**, so their tier, dependencies, feature flag and idle timeout are undeclared
   defaults that read identically to declared ones.
3. **This exact defect class has already cost the repo once**, and the code says so.
   `core/orchestrator.py:200-205`: *"Both were fully implemented and absent from this
   registry, so nothing consumed inbound vendor email at all… the missing registration
   hid the other two."* It was found reactively. Making that check scheduled instead of
   accidental is [[roster-lifecycle-charter]]'s first assignment.
4. **`SpendLogger.log()` has no `agent` parameter** —
   `services/agent-orchestrator/services/spend_logger.py:41-49`. Cost is attributed to a
   *provider*, a *model*, and a *restaurant*; never to a **worker**.
5. **The Python telemetry is two unjoined halves.** `decision_log` (`:2687`) carries
   `agent_name`, `reasoning`, `confidence` — and **no cost**. `api_spend` (`:2231`)
   carries `provider`, `model`, tokens, `cost_usd`, `restaurant_id` — and **no agent, no
   verdict**. There is no key that joins them. **Performance review of an agent is not
   currently possible from what is logged.**
6. **No doneability verdict exists anywhere.** `core/base_agent.py:602` records
   `success=True` when `process_message()` did not raise. An agent that returns
   confidently wrong output scores 100%.
7. **The maturity ladder has no owner and no evidence.** `.planning/PROJECT.md:117` —
   *"24 agents exist but all are Level 0-1"* — is prose against 26 modules.

### Corrections to the evidence source

Recorded rather than quietly fixed, per [`CLAUDE.md`](../../../../CLAUDE.md) §0.4:

- `corporate.md:474` gives the roster baseline as **"≥2 defects / 26"**. Verified, it is
  **at least 7**: 3 unregistered + 4 silent-default specs. The team doc's "≥" was doing
  real work.
- `corporate.md:348` says `recurring_order_agent` *"is not exported from
  `agents/__init__.py`"*. True, but non-distinguishing — `agents/__init__.py` is three
  lines and exports **nothing at all** (`"# Agents will be imported by orchestrator"`).
  No agent is exported from it. The load-bearing facts are the missing orchestrator entry
  and the missing `BaseAgent` base.
- `recurring_order_agent.py:17-21` documents its own exclusion: *"Standalone scheduler —
  not a message-bus agent."* The exclusion is **deliberate and declared**, which changes
  the fix (decide and record its class) but not the finding (it has no metrics, no health
  check, no retry, no DLQ, and appears on no roster).
- The path in `corporate.md:389` is `services/spend_logger.py`; the file is at
  `services/agent-orchestrator/services/spend_logger.py`.

## First dependency on Research & Math

**The department cannot do its second job until NF-A can name a worker.** Two asks,
in order:

1. **`SpendLogger.log()` gains an `agent` parameter**, and `api_spend` gains the column —
   staged as **CORP-F5** (`corporate.md:496`), which the corporate division session flagged
   as belonging with OD-11. Without it, `nf_a.cost_per_task` is a named field in
   [[README]] §4.2 that no query can return.
2. **A join key between reasoning and cost.** `decision_log` and `api_spend` currently
   share nothing. `correlation_id` already exists on `decision_log` and is the obvious
   candidate; the decision is [[neural-footprint-instrumentation-charter]]'s to make, not
   ours to invent.

Until both land, [[performance-doneability-charter]] measures **its own blockedness** and
publishes 0% honestly, rather than substituting `success_rate` because it is available.

## Open forks touching this department

- **CORP-F5** — does `SpendLogger.log()` gain an `agent` parameter? Schema + call-site
  change (`corporate.md:496`). **Blocking for this department.**
- **OD-11** — NF-A production column set and retention. Our two asks above are inputs to
  it, not separate decisions.
- **CORP-F1 / OD-17 / TECH-F5** — does a *team* get all 7 artifacts? This vault answers "7";
  the fork is not closed.
- **Human Ops split trigger** — second human on the payroll (`corporate.md:418`).
