---
type: directive
division: research-math
department: research-math
team: harness-model-routing
status: provisional
metrics: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-premortem]]", "[[harness-model-routing-loops]]", "[[research-math-directive]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[engineering-charter]]", "[[security-charter]]", "[[decision-office-charter]]", "[[OPEN-DECISIONS]]"]
---

# Harness & Model Routing (RM-1) — Directive

Inherits the department's three rules ([[research-math-directive]]): *no pick from
repute* · *the instrument precedes the decision* · *author ≠ auditor*. This team's own
shape adds two, because both of its failure modes are ordering failures rather than
judgement failures.

## The two local rules

1. **A callsite gets cost instrumentation before it gets retry.** Never the reverse.
   Retry multiplies spend; on an unguarded route (`analytics/consultants.service.ts`,
   OD-20) it multiplies *unauthenticated* spend, and an uninstrumented callsite cannot
   show that it happened ([[harness-model-routing-premortem]] M4).
2. **A routing change is justified by a verdict, never by a price.** The verdict is
   authored by [[evaluation-doneability-charter]] and this team cannot edit it. A change
   that lowers cost and lowers the verified success rate is a regression presented as a
   win (premortem M3).

## Decision graph

```mermaid
graph TD
  A[Change to a model call path] --> B{Which kind?}

  B -->|new callsite| C{Does it go through the wrapper?}
  C -->|no| D[Reject — no eighth convention]
  C -->|yes| E{Emits NF-A event with task id, cost, latency?}
  E -->|no| F[Block until RM-3 contract fields are wired]
  E -->|yes| G[Ship]

  B -->|add retry / backoff| H{Does this callsite emit cost events yet?}
  H -->|no| I[Instrument first. Local rule 1]
  I --> H
  H -->|yes| J{Is the route authenticated?}
  J -->|no| K[Per-caller budget check ships in the same change; SEC-3 reviews]
  J -->|yes| L[Ship]
  K --> L

  B -->|route a task to a different model| M{Is there a verdict for this task type?}
  M -->|no| N[Reject. Ask RM-2 for criteria first]
  M -->|yes| O{Verdict holds at the new model?}
  O -->|no| P[Reject — cheapness is not the objective]
  O -->|yes| Q[Ship. Publish cost AND verdict together]

  B -->|choose a harness OD-03| R{Has harness_overhead_ms a first reading?}
  R -->|no| S[Build the instrument. Do not hold the meeting]
  S --> R
  R -->|yes| T{Evidence from THIS repo's workloads?}
  T -->|no| U[Reject. Scope the bake-off]
  T -->|yes| V[ADR to OPEN-DECISIONS via Decision Office]
```

## Decision rights

**Decides alone:**

- Wrapper internals: retry strategy, timeout values, circuit-breaker thresholds, the shape
  of the budget check.
- Which callsite migrates in which order (the first is fixed by rule: the most exposed
  one).
- The bake-off's candidate list and workload selection — **subject to** RM-2 owning the
  pass conditions and Red Team reviewing the design.
- Rejecting a new raw `fetch` to a model endpoint anywhere in the repo. That is a hard no,
  not a preference, and it is this team's only veto.

**Decides with a counterpart:**

| Decision | Counterpart | Form |
|---|---|---|
| Migration of the 7 callsites | [[engineering-charter]] | Deprecation date in the wrapper's own PR; adoption published weekly |
| Pass conditions for any bake-off or routing change | [[evaluation-doneability-charter]] | Committed before results exist; not editable here |
| Fields the wrapper emits | [[neural-footprint-instrumentation-charter]] | We emit into their contract |
| Budget enforcement on unauthenticated paths | [[security-charter]] SEC-3 | Named reviewer on the first three migrations |

**Cannot decide — escalates:**

- **OD-03 and OD-04.** Founder forks. This team supplies the table, not the verdict.
- **The routing seam** with `[[harness-model-routing-charter|aio-model-routing]]`. Not ours to settle; the interim
  answer is one shared wrapper.
- **The per-caller budget number**, and whether the wrapper fails open or closed when it
  is exceeded. Failing closed stops a runaway and also removes a feature mid-service from
  a paying restaurant — a product call.
- **Fork F-5** — whether the seven callsites are in OD-03's scope at all.

## Escalation trigger

Same day, into `questions.md` and `OPEN-DECISIONS.md` where a decision is implied:

1. **An OD-03 conversation starts while `harness_overhead_ms` reads unmeasured.**
2. **`share_of_model_calls_through_wrapper` is omitted from the board for one close-time.**
   The metric disappearing is the signal, not the number being low (premortem M2).
3. **A new raw `fetch` to a model endpoint lands.** Count is 7; 8 is an escalation.
4. **Cost falls and verified success falls in the same close-time.**
5. **A second client-construction module appears** — the routing-seam tell (premortem M5).
6. **Retry is proposed for an unguarded callsite that emits no cost events.** Local rule 1.

## How this team handles being failed by RM-2

[[evaluation-doneability-charter]] can fail this team, by charter. When it does, the
response is one of exactly three, in writing, within the same close-time: *accepted and
reverted*, *accepted and scheduled*, or *disputed with the measurement that disputes it* —
filed to the founder or [[decision-office-charter]], never resolved here. Editing a golden
set, a threshold, or a pass condition in response to a failure is the single act this team
is structurally forbidden to perform.
