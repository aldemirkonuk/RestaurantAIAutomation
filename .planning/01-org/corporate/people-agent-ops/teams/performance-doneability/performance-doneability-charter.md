---
type: charter
division: corporate
department: people-agent-ops
team: performance-doneability
status: partial
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_task, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.agent_attributed_spend_pct, nf_a.emission_coverage]
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[performance-doneability-premortem]]", "[[performance-doneability-agenda-full]]", "[[performance-doneability-agenda-board]]", "[[performance-doneability-directive]]", "[[performance-doneability-loops]]", "[[performance-doneability-schedule]]", "[[roster-lifecycle-charter]]", "[[research-math-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[harness-model-routing-charter]]", "[[ai-orchestration-charter]]", "[[agent-evaluation-gates-charter]]", "[[model-routing-inference-economics-charter]]", "[[inference-cost-charter]]", "[[0006-neural-footprint-architecture]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Performance & Doneability — Charter

Division **Corporate** → Department [[people-agent-ops-charter]] → Team
`performance-doneability` (§4.2 of `.planning/foundation/teams/corporate.md:357-411`).

## Mandate

Own the question **"was the work any good, and what did it cost."** This team applies
**task-doneability criteria** — explicit success criteria per task type rather than a
vague sense of done — to the agent roster, reviews agent performance against them, and is
the **primary consumer of NF-A** ([[README]] §4.2,
[ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md)).

Doneability is the team's core product, and its significance is larger than review:
**it is what turns agent work into ML-readable training signal.** A task with an explicit
verdict is a labelled example; a task with `success = "did not raise"` is noise with a
timestamp. NF-A's stated purpose — *"stimulus → internal state → choice → outcome"*
([ADR 0006](../../../../decisions/0006-neural-footprint-architecture.md)) — has no
outcome without this team's output.

**Its opening position is 0%, and 0% is the honest number** for a team whose charter names
NF-A as its primary input.

## Boundaries

Owns outright:

- **Applying doneability criteria to the roster** — which criterion attaches to which task
  type, which agent is graded against it, and what the result means for the worker.
- **Agent performance review** — the periodic, evidence-backed judgement of a worker's
  output quality and cost.
- **The specification of what needs grading** — the written statement, handed to
  [[evaluation-doneability-charter]], of the task types this fleet actually runs and what
  "done" would have to mean for each.
- **Consumption of NF-A** — reading the spine, publishing coverage, and reporting when it
  cannot be read.
- **The blocked-dependency record** — `people.blocked_days`, and the escalation clock on it.

## Distinct from [[roster-lifecycle-charter]] because

4.1 asks *does this worker exist and is it wired in*; 4.2 asks *did the task actually get
done, and at what cost* (`corporate.md:357-360`). Today the first question has partial
answers and the second has **none** — which is precisely the split.

The deeper reason for the separation is a difference in kind, not scope: roster truth is
**checkable against the filesystem today**, doneability is **blocked on another division's
schema**. Under one team the checkable work wins every week
(`corporate.md:331-334`). The split is what keeps a blocked measurement from disappearing.

## Explicit non-goals

The boundary this team must state most carefully is with Research & Math, because both
departments touch the same data in opposite directions (`corporate.md:509-512`).

| Not ours | Whose it is | The line |
|---|---|---|
| **The methodology of doneability** — what a verdict means, how it is computed, golden sets, adversarial negatives | [[evaluation-doneability-charter]] *(Research & Math)* | They **define**; we **apply**. If both define, it is defined twice |
| **The NF-A spine** — event contract, schema, emission path, retention | [[neural-footprint-instrumentation-charter]] *(Research & Math)* | They emit; we consume. We may ask for a field, not design the table |
| **Running gates in CI and production** | [[agent-evaluation-gates-charter]] *(Applied AI)* | They fail a **build**; we fail a **review** |
| **The harness and routing runtime** | [[harness-runtime-charter]] / [[harness-model-routing-charter]] | They run the work; we grade the worker |
| **Choosing a cheaper model; inference-economics optimisation** | [[model-routing-inference-economics-charter]] *(Applied AI)*, [[inference-cost-charter]] *(Commercial)* | They reduce cost per call; we notice an **agent** is expensive per completed task |
| **Total company AI spend and its budget** | [[inference-cost-charter]] | Their unit is the invoice; ours is the worker |
| **Whether an agent exists, is registered, or has a spec** | [[roster-lifecycle-charter]] | An unregistered agent emits nothing — their defect, our floor |
| **Fixing an agent that fails its criterion** | [[ai-orchestration-charter]] | We produce the verdict and the consequence; they change the code |

Stated once more, plainly, because three departments touch agents and each owns a
different verb: **Research & Math defines · AI Orchestration runs · People & Agent Ops
employs.** This team is the *employ* verb applied to output quality.

## Metrics it moves

**Primary: `nf_a.doneability_verdict_coverage`** — the share of agent task completions
carrying **both** a doneability verdict and an agent-attributed cost. **Baseline: 0%.**

| Metric | Meaning | State today |
|---|---|---|
| `nf_a.doneability_verdict_coverage` | Completions with a verdict **and** attributed cost | **0%** — neither half exists |
| `nf_a.verified_task_success_rate` | Success meaning *correct* | **Unmeasurable** — no verdict anywhere |
| `nf_a.cost_per_task` | USD per task, per agent | **Not derivable** |
| `nf_a.cost_per_completed_task` | USD per task with a *passing* verdict — a retried failure is cost with no task | **Not derivable** |
| `nf_a.agent_attributed_spend_pct` | Share of logged spend naming a worker | **0%** |
| `nf_a.emission_coverage` | Agents emitting NF-A at all | Partial, and floored by roster truth |
| `people.blocked_days` | Age of the dependency blocking the above | Starts at 0 on the day OD-C5 is filed |

**`nf_a.task_success_rate` is not on this list as a success metric.** It exists, it is
measurable today, and in this team's artifacts it is named `nf_a.liveness_rate` — see
below.

## Evidence today

**PARTIAL — half of NF-A already emits; the decisive half does not.** Verified in this
session against the working tree.

### What emits today

- `core/base_agent.py:77` `AgentMetrics` — `messages_received/processed/failed/skipped`,
  min/max/total processing time, `errors`, `circuit_breaker_trips` (`:96`),
  `pause_count`/`restart_count` (`:101-102`), `success_rate` (`:144`), `get_health()`
  (`:985`, gating on `success_rate >= 0.9`).
- `core/observability.py:113-118` — Prometheus `agent_processing_duration_seconds`
  histogram labelled by `agent_name`, with a `NoopMetric` fallback (`:53`) so an absent
  Prometheus degrades silently rather than crashing.
- `core/base_agent.py:743` `log_decision()` → the `decision_log` table
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2687`), carrying
  `agent_name`, `decision_type`, `inputs`, `reasoning` (jsonb), `output`, `confidence`,
  `correlation_id`, `restaurant_id`, `created_at`.
- `services/agent-orchestrator/services/spend_logger.py` → the `api_spend` table
  (`…baseline_from_production.sql:2231`), carrying `provider`, `model`, `input_tokens`,
  `output_tokens`, `cost_usd`, `restaurant_id`, `timestamp`.

That is a genuine, working half: **reasoning is recorded, and cost is recorded.**

### The two gaps that define this team's first year

**1. `SpendLogger.log()` has no `agent` parameter.** Signature at
`services/agent-orchestrator/services/spend_logger.py:41-49`:

```python
def log(
    self,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    restaurant_id: Optional[str] = None,
) -> None:
```

Cost is attributed to a *provider*, a *model*, and a *restaurant* — **never to a worker**.
`api_spend` has no agent column to attribute it to even if the caller knew. So
`nf_a.cost_per_task`, a named field in [[README]] §4.2, is **not derivable from what is
logged today**.

**2. No doneability verdict exists anywhere.** `core/base_agent.py:602` records
`success=True` when `process_message()` did not raise inside the timeout. That is
**liveness, not correctness**. An agent that returns confidently wrong output scores 100%,
and `get_health()` (`:985`) reports it healthy at ≥0.9.

### The blocking defect, stated as the department's first dependency

**The Python telemetry is two unjoined halves, and neither half alone supports a review:**

| Table | Has | Lacks |
|---|---|---|
| `decision_log` (`:2687`) | `agent_name`, `reasoning`, `confidence`, `correlation_id` | **cost, tokens, verdict** |
| `api_spend` (`:2231`) | `provider`, `model`, tokens, `cost_usd` | **agent, verdict** |

There is **no key that joins them**. `correlation_id` exists on `decision_log` and on
nothing in `api_spend`. Therefore: **performance review of an agent is not currently
possible from what is logged.** Not "hard" — not possible.

**Two asks on Research & Math, in order:**

1. **`SpendLogger.log()` gains an `agent` parameter and `api_spend` gains the column.**
   Staged as **OD-C5** (`corporate.md:496`), flagged as belonging with OD-11.
2. **A join key between reasoning and cost.** `correlation_id` is the obvious candidate;
   the decision is [[neural-footprint-instrumentation-charter]]'s to make, not ours to
   invent.

Until both land, this team publishes **0% and a blocker age**. It does not substitute
`success_rate` because `success_rate` is available.

### Compounding factor

[[README]] §0 item 5 — Anthropic and Gemini are called over **raw HTTP, not their SDKs** —
so retry, timeout and cost accounting are hand-rolled at every call site. That multiplies
the number of places an `agent` argument has to be threaded once OD-C5 closes, and it is
the reason the ask should be made now rather than after another year of call sites.

### Correction to the evidence source

`corporate.md:389` gives the path as `services/spend_logger.py`; the file is at
`services/agent-orchestrator/services/spend_logger.py`, and the signature spans
lines **41-49** (the cited `41-48` covers the parameters, not the closing annotation).
