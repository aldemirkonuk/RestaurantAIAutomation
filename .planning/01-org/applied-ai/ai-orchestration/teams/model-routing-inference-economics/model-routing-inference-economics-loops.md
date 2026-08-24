---
type: loops
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: partial
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-premortem]]", "[[model-routing-inference-economics-directive]]", "[[model-routing-inference-economics-schedule]]", "[[ai-orchestration-loops]]", "[[agent-evaluation-gates-loops]]", "[[security-charter]]", "[[LOOP-MAP]]"]
---

# Model Routing & Inference Economics — Loops

Every loop names its close-time.

> Loop 1 is unblocked and is the precondition for the rest: **0 of 7 gateway model
> call sites write to `api_spend`**, so `nf_a.cost_per_task` is structurally
> uncomputable for them, not merely unimplemented.

---

## 1. Metering coverage — the precondition loop

```yaml
type: loop
id: loop-metering-coverage
owner: ai-orchestration
team: model-routing-inference-economics
measures: [routing.metered_call_share, routing.routed_client_share_by_spend, routing.routed_client_share_by_count]
changes: [call_site.spend_logging, call_site.client]
inputs_from: [engineering]
outputs_to: [model-routing-inference-economics, finance-pricing, security]
close_time: weekly during the migration, then monthly
status: proposed
blocked_by: nothing
today: "metered_call_share = 0/7 in the gateway. SpendLogger is Python-only; the seven TypeScript call sites each declare their own https://api.anthropic.com/v1/messages constant and none writes to api_spend."
order: "Spend-descending. consultants.service.ts first — most expensive (claude-opus-4-8, max_tokens 4096), most exposed (README §0 finding 1), zero cost visibility."
rule: "Both share numbers are published together. Divergence between by-count and by-spend is premortem #2 arriving, and it is visible from week one."
```

## 2. Cost per task — the primary loop

```yaml
type: loop
id: loop-cost-per-task
owner: ai-orchestration
team: model-routing-inference-economics
measures: [nf_a.cost_per_task, cost_per_restaurant_per_day]
changes: [routing.policy, routing.model_selection, routing.concurrency_limits]
inputs_from: [agent-evaluation-gates, harness-runtime]
outputs_to: [finance-pricing, ai-orchestration, product-and-vision]
close_time: weekly
status: proposed
blocked_by: "loop 1 + NF-A emission + a task correlation ID on every spend row"
constraint: "TWO KEYS. This loop may only lower cost through a verdict it does not own — routing picks the cheapest model that PASSES (technology.md:399-400). Where no verdict exists for a task family, the answer to 'can we go cheaper here' is NOT YET, and the escalation is the coverage gap."
naming_note: "cost_per_TASK, not per call. One invoice extraction is a call, a retry, possibly a fallback, and a validation pass. Per-call cost will look reassuring and be wrong by a multiple — premortem #3."
```

## 3. The substitution gate

```yaml
type: loop
id: loop-model-substitution-gate
owner: ai-orchestration
team: model-routing-inference-economics
measures: [routing.substitutions_without_benchmark, benchmark.quality_delta]
changes: [routing.model_selection]
inputs_from: [agent-evaluation-gates]
outputs_to: [model-routing-inference-economics, agent-fleet]
close_time: per-PR
status: proposed
blocked_by: "pass criteria from agent-evaluation-gates"
existing_asset: "scripts/benchmark_haiku_vs_sonnet.py — written to prevent exactly this, run essentially once."
model: ".github/workflows/ci.yml:226-230 — rebuild the labelled set, run the eval, exit non-zero on regression. Build in that shape."
target: "routing.substitutions_without_benchmark = 0. A commit-level signal, available long before any quality metric moves."
```

## 4. Model-pin drift

```yaml
type: loop
id: loop-model-pin-drift
owner: ai-orchestration
team: model-routing-inference-economics
measures: [routing.distinct_model_pins, routing.pins_referencing_retired_models]
changes: [call_site.model_id, routing.policy]
inputs_from: [engineering]
outputs_to: [model-routing-inference-economics]
close_time: monthly
status: proposed
blocked_by: nothing
today: "≥7 independent pins across 3 distinct model IDs. ux-optimizer.service.ts:250 pins a dated snapshot (claude-haiku-4-5-20251001) where six siblings use floating aliases. inbound-responder.service.ts:18-20 carries a comment about a model retired 2026-02-19 plus a note that its suggested replacement rejects `temperature` — operational knowledge living in a code comment in one of seven files."
resolution: "This loop should stop firing once consolidation completes, and should then be deleted rather than kept as decoration."
```

## 5. Spend anomaly — the abuse detector we cannot build yet

```yaml
type: loop
id: loop-spend-anomaly
owner: ai-orchestration
team: model-routing-inference-economics
measures: [cost_per_restaurant_per_day, spend.anonymous_attributable_share]
changes: [alert.threshold, rate_limit.policy]
inputs_from: [security, engineering]
outputs_to: [security, finance-pricing]
close_time: daily
status: proposed
blocked_by: "loop 1 — consultants.service.ts is unmetered, so the most exposed path produces no spend signal at all"
context: "README §0 finding 1 — analytics.controller.ts has zero @UseGuards and zero @Public. An anonymous caller can PUT /analytics/consultants/:restaurantId/toggle then POST /analytics/consult/:restaurantId, reaching consultants.service.ts:159 and claude-opus-4-8 at max_tokens 4096. The only brake is an in-memory, per-instance rate limiter."
ownership: "The GUARD is security + engineering. The BLINDNESS is ours: with no api_spend row there is no anomaly, no alert, and a provider invoice is the first notification (premortem #4)."
escalation: "A threshold crossing goes to security the same day, not to a weekly review."
```

---

## What this team hands to other loops

| To | Signal | Close-time |
|---|---|---|
| `[[fin-inference-cost]]` | `nf_a.cost_per_task` by task type | weekly |
| `[[fin-unit-economics-pricing]]` | `cost_per_restaurant_per_day` vs the $20–50/mo price point | monthly |
| [[security-charter]] | Spend anomalies attributable to unauthenticated paths | daily, on trigger |
| [[agent-evaluation-gates-loops]] | Task families where a cheaper model is wanted but no verdict exists | weekly — this is a coverage request, not a complaint |
| [[ai-orchestration-loops]] | `routed_client_share`, both weightings | weekly |
</content>
