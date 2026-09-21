---
type: directive
division: applied-ai
department: ai-orchestration
status: exists
metrics: [nf_a.doneability_verdict_coverage, nf_a.cost_per_task, safety.unconfirmed_mutation_count]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-premortem]]", "[[ai-orchestration-agenda-full]]", "[[ai-orchestration-loops]]", "[[harness-runtime-directive]]", "[[agent-fleet-directive]]", "[[model-routing-inference-economics-directive]]", "[[agent-evaluation-gates-directive]]", "[[action-safety-the-human-gate-directive]]", "[[decision-office-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[red-team-charter]]"]
---

# AI Orchestration — Directive

How *this* department decides. The shape here is driven by one fact: an agent action
can be **permitted, executed, cheap, and wrong**, and those are four independent
judgements with four owners. So the decision graph is a **series of gates**, not a
single approval.

## The gate order — and why it is this order

```mermaid
graph TD
  A[Proposed change to an agent, harness, model, or prompt] --> B{Does it mutate stock, money,<br/>or an outbound channel?}
  B -->|yes| C[[action-safety-the-human-gate-charter|action-safety gate]]
  B -->|no| D{Does it change which model<br/>runs a task?}
  C -->|no recorded human confirmation<br/>in the execution path| STOP1[BLOCK — reportable, not a bug]
  C -->|gate intact| D
  D -->|yes| E{Is a doneability verdict attached<br/>for this task family?}
  D -->|no| F{Does it add capability to core/ ?}
  E -->|no| STOP2[BLOCK — cost may not be traded<br/>against unmeasured quality]
  E -->|yes, and it passes| F
  F -->|yes, and OD-03 is open| G{Is it portable under<br/>all three harness outcomes?}
  F -->|no| H[Ship]
  G -->|no| STOP3[DEFER — log against OD-03,<br/>do not widen BaseAgent]
  G -->|yes: bug fix, instrumentation,<br/>or interface narrowing| H
  H --> I[Emit NF-A event]
  I --> J{Did a loop close?}
  J -->|no| K[Escalate to OPEN-DECISIONS]
  J -->|yes| L[Done]
```

**Safety first, then quality, then cost, then capability.** The ordering is not
taste. Each gate is cheap to pass and expensive to skip, and each one downstream is
only meaningful if the one above it held: a cost saving on an unmeasured task is not a
saving, and a quality measurement of an action nobody approved is not a defence.

## Decision rights

| Decision | Decided by | Constraint it cannot escape |
|---|---|---|
| Agent behavior, prompts, subscriptions | [[agent-fleet-charter]] | Stubs never counted as live; stub metrics never averaged in |
| Harness mechanics — lifecycle, retry, DLQ, sagas, registry | [[harness-runtime-charter]] | **The OD-03 diet, below** |
| Which model runs which task | [[model-routing-inference-economics-charter]] | Cheapest model that **passes**, never cheapest model |
| What "passes" means, operationally | [[agent-evaluation-gates-charter]] | Methodology belongs to [[research-math-charter|research-and-math-charter]] |
| What a doneability verdict *means*; NF-A definitions | [[research-math-charter|research-and-math-charter]] *(Intelligence)* | Not ours. Consumed, not authored |
| Whether an action may execute without a human tap | **Nobody in this department.** | The answer is no. It is not a tunable |
| Guardian-agent alert thresholds and findings | `[[state-integrity-invariants-charter|sre-state-integrity]]` | We own the code, they own the findings — TECH-F6 |

**One decision right this department explicitly does not have.** The
`ask → propose → confirm → execute` guarantee (`.planning/FUTURES.md` §8.1) is not a
parameter this department may relax for velocity, for a demo, or for a customer.
Changing it is a supersede-ADR, in the same way [[README]] §5 treats the
agent-native-UI verdict. [[action-safety-the-human-gate-charter]] enforces it and
cannot waive it — a team that could waive its own gate is not a gate.

## The harness fork — OD-03 stays open here

`OD-03 (OPEN-DECISIONS.md:29)` leaves the orchestration base open between
`NousResearch/hermes-agent`, `deepseek-ai/deepseek-harness`, and extending in-house
`services/agent-orchestrator/core/base_agent.py`, and names the resolution path:
*"A scoped bake-off on this repo's actual workloads. No pick from repute."*

**This directive does not pick, and neither does any artifact in this department.**
What it does instead is make the open fork survivable:

- **The diet.** While OD-03 is open, `core/` takes bug fixes, instrumentation, and
  interface *narrowing*. Adding a new capability to `BaseAgent` is a bet on one
  outcome; making its surface smaller pays under all three. Node `G` in the graph.
- **The bake-off is a scheduled job, not an aspiration.**
  [[ai-orchestration-schedule]] carries it with a date, because
  [[ai-orchestration-premortem]] #1 is a fork that stayed open by ordinary gravity,
  not by anyone's decision.
- **Its inputs are Steps 0–2 of [[ai-orchestration-agenda-full]].** Harness overhead
  cannot be compared without cost instrumentation; task outcomes cannot be compared
  without doneability verdicts. Running the bake-off before those exist produces a
  preference, not evidence — which is precisely the "pick from repute" the decision
  log forbids.

## Escalation trigger

Escalate to `OPEN-DECISIONS.md` — via [[decision-office-charter]] — when any of:

1. **A gate would have to be waived to ship.** Not "was waived". *Would have to be.*
   The proposal to waive is itself the escalation.
2. **Two teams in this department claim the same work**, and the seam is not already
   named in [[ai-orchestration-charter]] §Non-goals.
3. **The methodology/operations line with Research & Math produces duplicated work
   twice.** Twice, not once — once is a coordination miss, twice is the line failing.
   The escalation is *"merge [[agent-evaluation-gates-charter]] into Research &
   Math"*, per `technology.md:406`. **The escalation is never "build it in both
   places."**
4. **A loop in [[ai-orchestration-loops]] misses its close-time twice running.** A
   loop that does not close is a diagram ([[ORG_STRUCTURE]] §5), and a diagram
   masquerading as a control is worse than no control.
5. **OD-03 passes its scheduled bake-off date without the bake-off running.**

Findings from [[red-team-charter]] land in this department's agenda and, if they imply
a decision, in `OPEN-DECISIONS.md` — findings-only, no approve/block
([[ORG_STRUCTURE]] §3).
