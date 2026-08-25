---
type: loops
division: applied-ai
department: ai-orchestration
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth, nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-directive]]", "[[ai-orchestration-schedule]]", "[[harness-runtime-loops]]", "[[agent-fleet-loops]]", "[[model-routing-inference-economics-loops]]", "[[agent-evaluation-gates-loops]]", "[[action-safety-the-human-gate-loops]]", "[[research-math-charter|research-and-math-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[skills-charter]]", "[[LOOP-MAP]]"]
loop_count: 7
loop_ids: ["loop-eval-gate-ci", "loop-harness-health", "loop-fleet-doneability", "loop-routing-economics", "loop-eval-coverage", "loop-human-gate-integrity", "loop-od03-harness-fork"]
loop_close_times: ["per-pr", "daily", "weekly", "weekly", "weekly", "daily", "one-shot"]
loop_statuses: ["active", "proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# AI Orchestration — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop ([[ORG_STRUCTURE]] §5).

> **Honesty note on `status`.** Six of the seven below are `proposed`, and they are
> proposed for one reason: **L4 emits nothing yet** ([[README]] §1). A loop whose
> `measures` field names a metric that is not emitted is a *designed* loop, not a
> running one. Only `loop-eval-gate-ci` closes today.

---

## 1. The one that already closes

```yaml
type: loop
id: loop-eval-gate-ci
owner: ai-orchestration
team: agent-evaluation-gates
measures: [identity.false_merge_count]
changes: [merge_policy, ci.gate_result]
inputs_from: [engineering, data]
outputs_to: [engineering, research-and-math]
close_time: per-pr
close_time_note: "per commit (CI)"
status: active
evidence: ".github/workflows/ci.yml:226-230 rebuilds the labelled set then runs scripts/eval_merge_policies.py; exits 1 iff the proposed policy has any false merge (eval_merge_policies.py:9-16). schema-parity.yml:149 runs the guest variant."
note: "This is the template every other loop here should be built in the shape of — measurement, a hard verdict, and a close-time short enough to change behaviour."
```

---

## 2. Harness health

```yaml
type: loop
id: loop-harness-health
owner: ai-orchestration
team: harness-runtime
measures: [nf_a.retries, nf_a.dlq_depth, queue.dead_letters]
changes: [harness.retry_policy, harness.circuit_breaker_thresholds, harness.registry_tier]
inputs_from: [agent-fleet, reliability-sre]
outputs_to: [harness-runtime, reliability-sre]
close_time: daily
status: proposed
blocked_by: "NF-A not emitted (README §1, L4)"
evidence: "core/base_agent.py:543 _process_with_retry, :791 DLQ; core/message_bus.py:188 CircuitBreaker, :524 DLQ declaration."
premortem_link: "Nothing consumes queue.dead_letters — technology.md:802. A daily close-time is the counter-pressure: a DLQ read once a day cannot become a place problems go to be forgotten."
```

## 3. Fleet doneability

```yaml
type: loop
id: loop-fleet-doneability
owner: ai-orchestration
team: agent-fleet
measures: [nf_a.task_success_rate, fleet.live_agent_ratio]
changes: [agent.prompt, agent.subscriptions, agent.registration_state]
inputs_from: [agent-evaluation-gates, research-and-math]
outputs_to: [ai-orchestration, product-and-vision]
close_time: weekly
status: proposed
blocked_by: "NF-A not emitted"
rule: "Stub agents are reported separately and never averaged into the fleet figure (technology.md:348-350). fleet.live_agent_ratio is computable today and does not wait on NF-A."
```

## 4. Cost vs. quality — the two-key loop

```yaml
type: loop
id: loop-routing-economics
owner: ai-orchestration
team: model-routing-inference-economics
measures: [nf_a.cost_per_task, routing.routed_client_share, nf_a.doneability_verdict_coverage]
changes: [routing.policy, routing.model_selection, routing.concurrency_limits]
inputs_from: [agent-evaluation-gates, finance-pricing]
outputs_to: [finance-pricing, ai-orchestration]
close_time: weekly
status: proposed
blocked_by: "api_spend receives nothing from the 7 gateway model call sites; NF-A not emitted"
constraint: "This loop may only lower cost through a doneability verdict it does not own. Routing picks the cheapest model that PASSES (technology.md:399-400); agent-evaluation-gates defines passing. Two keys, two teams — the counter-pressure to premortem #4."
```

## 5. Evaluation coverage

```yaml
type: loop
id: loop-eval-coverage
owner: ai-orchestration
team: agent-evaluation-gates
measures: [nf_a.doneability_verdict_coverage]
changes: [eval.gold_sets, eval.rubrics, ci.gates]
inputs_from: [research-and-math, agent-fleet]
outputs_to: [ai-orchestration, research-and-math]
close_time: weekly
status: proposed
depends_on_decision: "The evaluation seam — methodology (research-and-math) vs operations (here). technology.md:845. If the line fails, merge; never duplicate."
rule: "Coverage is reported PER TASK FAMILY, never as one number. An aggregate hides the families with zero coverage, which are the commercially load-bearing ones (premortem #5)."
```

## 6. The human gate — the loop that measures a habit

```yaml
type: loop
id: loop-human-gate-integrity
owner: ai-orchestration
team: action-safety-the-human-gate
measures: [safety.unconfirmed_mutation_count, safety.median_time_to_confirm, safety.rejection_rate]
changes: [action.autonomy_tier, action.allowlist, action.friction_floor]
inputs_from: [product-and-vision, compliance-and-privacy]
outputs_to: [ai-orchestration, compliance-and-privacy, red-team]
close_time: daily
close_time_note: "daily for unconfirmed-mutation count, monthly for the behavioural signals"
status: proposed
evidence: "one-tap-actions.service.ts:230 executeAction, :245-246 executed_at/executed_by, :267 action_executed event — the timestamps needed for time-to-confirm already exist."
rule: "safety.unconfirmed_mutation_count is a reportable incident at any non-zero value, not a trend line. The two behavioural measures are trend lines and are the actual subject of this loop: a gate with a 100% confirmation rate and a two-second median is architecturally present and behaviourally absent (premortem #3)."
```

## 7. The fork that must close — OD-03

```yaml
type: loop
id: loop-od03-harness-fork
owner: ai-orchestration
team: harness-runtime
measures: [days_open, core_lines_added_since_fork_opened]
changes: [harness.base_choice]
inputs_from: [research-and-math, decision-office]
outputs_to: [decision-office, engineering, reliability-sre]
close_time: one-shot
close_time_note: "a dated bake-off, not a cadence"
status: proposed
note: "A decision is not a feedback loop, and this entry is deliberately the odd one out. It is here because the thing being measured is the DECISION'S AGE, and because premortem #1 is a fork that stayed open by ordinary gravity rather than by anyone's choice. core_lines_added_since_fork_opened is the sunk-cost meter: it is the size of the write-off if the fork resolves away from in-house."
```

---

## Loops this department feeds but does not own

| Loop | Owner | What we hand over |
|---|---|---|
| NF-A → harness/skill improvement ([[README]] §7) | [[research-math-charter|research-and-math-charter]] | The NF-A events themselves. We are the largest producer; they own the methodology |
| Skill firing / staleness | [[skills-charter]] | `skill_id` on the NF-A event — the cheapest firing signal available |
| Guardian findings → alerts | `[[state-integrity-invariants-charter|sre-state-integrity]]` | The code of `state_invariant_enforcer`, `drift_agent`, `inequality_detector`. They own the findings queue — TECH-F6 |
| Inference cost → unit economics | `[[inference-cost-charter|fin-inference-cost]]` | `nf_a.cost_per_task` by task type |

**The dependency stated plainly:** four of these six proposed loops close on numbers
this department must first cause to exist. Step 0 of [[ai-orchestration-agenda-full]]
is not one item among six — it is the precondition for four of them.
