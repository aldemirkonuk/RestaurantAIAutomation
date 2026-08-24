---
type: loops
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: partial
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-charter]]", "[[agent-fleet-premortem]]", "[[agent-fleet-directive]]", "[[agent-fleet-schedule]]", "[[ai-orchestration-loops]]", "[[harness-runtime-loops]]", "[[agent-evaluation-gates-charter]]", "[[reliability-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["loop-fleet-liveness", "loop-subscription-coverage", "loop-agent-doneability", "loop-prompt-verdict", "loop-guardian-canary"]
loop_close_times: ["monthly", "per-commit (CI gate)", "weekly", "per-PR", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Agent Fleet — Loops

Every loop names its close-time.

> Loops 1 and 2 are **unblocked** — they measure registration state and topic graphs,
> both static. Loops 3 and 4 wait on NF-A ([[README]] §1, L4).

---

## 1. The liveness census

```yaml
type: loop
id: loop-fleet-liveness
owner: ai-orchestration
team: agent-fleet
measures: [fleet.live_agent_ratio, fleet.orphan_modules, fleet.stub_count]
changes: [agent.registration_state, agent.deletion, registry.stub_flag]
inputs_from: [harness-runtime]
outputs_to: [ai-orchestration, product-and-vision, harness-runtime]
close_time: monthly
status: proposed
blocked_by: nothing — all three values are computable today
today: "live_agent_ratio ≈ 18/26 · orphan_modules = 3 · stub_count = 5"
rule: "Four counts, published as four numbers: on disk (26) · subclass BaseAgent (25) · registered (23) · can receive a message (≈18). Never one number. A stub that logs and returns posts a perfect success rate, so folding stubs in inflates the figure rather than blurring it."
escalation: "An orphan deferred twice, or orphan_modules above 3."
```

## 2. The topic graph — the loop that closes the dead-pipeline failure

```yaml
type: loop
id: loop-subscription-coverage
owner: ai-orchestration
team: agent-fleet
measures: [fleet.subscription_coverage, fleet.topics_without_publisher, fleet.topics_without_subscriber]
changes: [agent.subscriptions, publisher.wiring]
inputs_from: [harness-runtime, engineering]
outputs_to: [agent-fleet, engineering]
close_time: per-commit (CI gate)
status: proposed
blocked_by: nothing — static analysis, no NF-A required
evidence: "core/orchestrator.py:198-206 — EmailIntelAgent subscribed to email.inbound.raw, which had zero publishers. 'Three defects, each of which alone would have made the pipeline dead, and the missing registration hid the other two.'"
rule: "Checked in BOTH directions. Every subscription resolves to ≥1 publisher; every publish resolves to ≥1 subscriber. A registered, enabled, healthy agent subscribed to a topic nobody publishes is green on every dashboard and doing nothing."
```

## 3. Per-agent doneability

```yaml
type: loop
id: loop-agent-doneability
owner: ai-orchestration
team: agent-fleet
measures: [nf_a.task_success_rate, agent.messages_processed_7d]
changes: [agent.prompt, agent.subscriptions, agent.defect_queue]
inputs_from: [agent-evaluation-gates, harness-runtime, research-and-math]
outputs_to: [ai-orchestration, agent-evaluation-gates]
close_time: weekly
status: proposed
blocked_by: "NF-A not emitted"
rule: "Per agent. Stubs listed separately and never averaged in. agent.messages_processed_7d is the idle detector — an enabled agent processing nothing is a state the ladder (directive) distinguishes from broken, and we currently cannot."
```

## 4. Prompt change → verdict

```yaml
type: loop
id: loop-prompt-verdict
owner: ai-orchestration
team: agent-fleet
measures: [prompt_changes_with_verdict_pct, nf_a.task_success_rate]
changes: [agent.prompt, agent.few_shot_examples]
inputs_from: [agent-evaluation-gates]
outputs_to: [agent-fleet, agent-evaluation-gates]
close_time: per-PR
status: proposed
blocked_by: "verdict definition — agent-evaluation-gates; gold sets exist only for extraction-shaped tasks"
model: ".github/workflows/ci.yml:226-230 already does exactly this for merge policies — rebuild the labelled set, run the eval, exit non-zero on regression. Build in that shape rather than inventing one."
premortem_link: "#3 — a year of individually-sensible prompt edits with no attributable quality signal, ending in a git bisect against a gold set built after the fact."
```

## 5. Guardian canaries — the OD-24 test

```yaml
type: loop
id: loop-guardian-canary
owner: ai-orchestration
team: agent-fleet
co_owner: sre-state-integrity
measures: [guardian.canary_catch_rate, guardian.finding_rate]
changes: [guardian.detection_logic, guardian.thresholds]
inputs_from: [sre-state-integrity]
outputs_to: [sre-state-integrity, reliability-sre]
close_time: weekly
status: proposed
depends_on_decision: "OD-24 — technology.md:848. We own the code, SRE owns the findings."
mechanism: "Inject a known violation on a cadence that must be caught. Without it, a detector whose recall has degraded is indistinguishable from a clean system — from BOTH sides of the seam."
note: "Whether either team will own this canary is the concrete test of whether OD-24's split works. If neither will, the split has failed and guardians should go to one team end to end. That is a finding, not a scheduling problem."
```

---

## Signals this team consumes

| From | Signal | What we do with it |
|---|---|---|
| [[harness-runtime-loops]] | DLQ entries classified *agent defect* | Enter the agent's defect queue |
| [[harness-runtime-loops]] | Sustained elevated per-agent retry | A retry that succeeds is still a defect signal |
| [[agent-evaluation-gates-charter]] | Doneability verdict per task family | Gate prompt changes; drive `loop-agent-doneability` |
| `[[sre-state-integrity]]` | Guardian finding quality and false-positive rate | Change detection logic — the code is ours |
