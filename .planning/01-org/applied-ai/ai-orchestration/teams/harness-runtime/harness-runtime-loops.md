---
type: loops
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-charter]]", "[[harness-runtime-premortem]]", "[[harness-runtime-directive]]", "[[harness-runtime-schedule]]", "[[ai-orchestration-loops]]", "[[agent-fleet-loops]]", "[[reliability-sre-charter|reliability-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_ids: ["loop-harness-health", "loop-dlq-triage", "loop-harness-coverage-census", "loop-od03-bakeoff"]
loop_close_times: ["daily", "daily", "monthly", "one-shot"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Harness & Runtime — Loops

Every loop names its close-time.

> **All four are `proposed`.** `nf_a.retries` and `nf_a.dlq_depth` are in the NF-A
> schema ([[README]] §4.2) and neither is emitted ([[README]] §1, L4). Loop 2 is the
> exception in practice — DLQ depth is readable from the bus without NF-A, so it can
> start before the others.

---

## 1. Harness health

```yaml
type: loop
id: loop-harness-health
owner: ai-orchestration
team: harness-runtime
measures: [nf_a.retries, nf_a.dlq_depth]
changes: [harness.retry_policy, harness.backoff, harness.circuit_breaker_thresholds]
inputs_from: [agent-fleet, reliability-sre]
outputs_to: [harness-runtime, agent-fleet]
close_time: daily
status: proposed
blocked_by: "NF-A not emitted"
evidence: "core/base_agent.py:543 _process_with_retry, :791 DLQ; core/message_bus.py:188 CircuitBreaker."
rule: "Measured PER AGENT, never as a fleet aggregate. One agent retrying constantly while the average looks healthy is invisible in a rolled-up number — premortem #5."
```

## 2. DLQ triage — the loop that turns a queue into a loop

```yaml
type: loop
id: loop-dlq-triage
owner: ai-orchestration
team: harness-runtime
measures: [nf_a.dlq_depth, dlq.entries_unassigned, dlq.oldest_entry_age]
changes: [dlq.assignment, harness.retry_policy, agent.defect_queue]
inputs_from: [message_bus]
outputs_to: [agent-fleet, reliability-sre, harness-runtime]
close_time: daily
status: proposed
blocked_by: nothing — DLQ depth is readable from the bus without NF-A
triage_rule: "Every entry is classified harness defect | agent defect | infrastructure, and ASSIGNED. An entry nobody can be assigned is itself the finding."
premortem_link: "technology.md:802-805 — 'the DLQ is a well-engineered place where problems go to be forgotten.' A daily read is the counter-pressure; dlq.oldest_entry_age is the proof it is actually being read."
```

## 3. The census — modules outside the contract

```yaml
type: loop
id: loop-harness-coverage-census
owner: ai-orchestration
team: harness-runtime
measures: [harness.agents_without_harness_guarantees, harness.single_caller_abstractions]
changes: [agent.base_class, core.abstraction_set]
inputs_from: [agent-fleet]
outputs_to: [agent-fleet, action-safety-the-human-gate]
close_time: monthly
status: proposed
blocked_by: nothing — both values are computable today
today: "agents_without_harness_guarantees = 1 (agents/recurring_order_agent.py:14, a plain class owning scheduled purchasing with no retry, no idempotency, no DLQ, no health check)"
rule: "1 is a documented exception. 2 is a pattern, and a pattern means the contract is being routed around rather than used — escalate (directive §4)."
```

## 4. OD-03 — a decision's age, not a cadence

```yaml
type: loop
id: loop-od03-bakeoff
owner: ai-orchestration
team: harness-runtime
measures: [od03.days_open, harness.core_lines_added_since_od03_opened]
changes: [harness.base_choice]
inputs_from: [research-and-math, model-routing-inference-economics, agent-evaluation-gates]
outputs_to: [decision-office, engineering, reliability-sre]
close_time: one-shot
close_time_note: "a dated bake-off"
status: proposed
method: "OD-03, OPEN-DECISIONS.md:25 — a scoped bake-off on this repo's actual workloads. No pick from repute."
inputs_required: "cost instrumentation (model-routing) + doneability verdicts (agent-evaluation-gates). Running earlier produces a preference, not evidence."
note: "core_lines_added_since_od03_opened is the sunk-cost meter — the size of the write-off if the fork resolves away from in-house. It is measured so that the diet (directive §The diet gate) has a number behind it rather than a principle."
escalation: "The date passing without the bake-off running is an escalation to decision-office, not a reschedule."
```

---

## What this team hands to other loops

| To | Signal | Why they need it |
|---|---|---|
| [[agent-fleet-loops]] | Per-agent retry rate; DLQ entries classified *agent defect* | A retry that succeeds is still a defect signal ([[harness-runtime-directive]] §The retry/defect boundary) |
| `[[runtime-resilience-charter|sre-resilience]]` | DLQ entries classified *infrastructure* | They operate; we author |
| [[ai-orchestration-loops]] | `nf_a.retries`, `nf_a.dlq_depth` | The department's harness-health metric pair |
| [[decision-office-charter]] | `od03.days_open` | A fork's age is the thing the Decision Office exists to watch |
