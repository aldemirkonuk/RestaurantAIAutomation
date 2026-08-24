---
type: schedule
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: partial
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-loops]]", "[[model-routing-inference-economics-directive]]", "[[model-routing-inference-economics-agenda-full]]", "[[ai-orchestration-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[agent-evaluation-gates-charter]]", "[[security-charter]]"]
---

# Model Routing & Inference Economics — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Per PR | **Substitution gate** — a model ID change requires an attached benchmark | `routing.substitutions_without_benchmark` | proposed · needs pass criteria |
| Daily | **Spend anomaly scan** — cost per restaurant per day against a threshold | `cost_per_restaurant_per_day` | proposed · **blocked**: the most exposed path is unmetered |
| Weekly | **Inference spend review** — cost by task type; routed-client share **by count and by spend** | `nf_a.cost_per_task`, `routing.routed_client_share` | proposed |
| Weekly (during migration) | Metering coverage report — which of the 7 call sites now write to `api_spend` | `routing.metered_call_share` | proposed · **unblocked** |
| Monthly | **Model-pin sweep** — distinct pins, dated snapshots, references to retired models | `routing.distinct_model_pins` | proposed · **unblocked** |
| Quarterly | Re-run `scripts/benchmark_haiku_vs_sonnet.py` across live task types | benchmark deltas | **PARTIAL** — the script exists, has run essentially once |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. Applied honestly here:

- **The model-pin sweep should die.** Once consolidation completes there is one pin,
  and this job has nothing to find. That is success, and it should be deleted rather
  than kept as decoration. Same for `loop-model-pin-drift`.
- **The spend anomaly scan is exempt**, on the same logic as a safety scan: zero
  findings is its success condition. Deleting an abuse detector for detecting no abuse
  is [[model-routing-inference-economics-premortem]] #4 with a process attached.
- **The substitution gate is a recurrence guard** and is exempt for the same reason.

## Skills owned

Skills live in `.claude/skills/`, **which does not exist yet** ([[skills-charter]]).
Candidates, with their [[README]] §3.3 rule-3 citations recorded now while the
instances are fresh.

| Candidate skill | Tier | Trigger | Real past instance |
|---|---|---|---|
| `model-substitution-check` | T3 operational | A commit changes a model ID or `max_tokens` | `scripts/benchmark_haiku_vs_sonnet.py` was written to prevent silent substitution and has been run essentially once. Seven call sites pin models independently: `consultants.service.ts:156`, `inbound-responder.service.ts:21`, `photo-count.service.ts:60`, `scan-parser.service.ts:261`, `document-extractor.service.ts:75`, `ux-optimizer.service.ts:250`, `vendor-page-extractor.service.ts:71` |
| `spend-instrumentation-check` | T3 operational | A PR adds or edits a model call site | All seven gateway call sites ship without `api_spend` writes. `grep -c api_spend` returns 0 for every one of them, so a third of the product's spend has never been recorded |
| `model-pin-sweep` | T3 operational | Monthly, or on a provider deprecation notice | `inbound-responder.service.ts:18-20` documents a model retired 2026-02-19 in a code comment, along with the fact that its suggested replacement rejects `temperature`. That is operational knowledge stranded in one of seven files |
| `inference-cost-report` | T2 department | Weekly | `api_spend` exists (`baseline_from_production.sql:2231`) and `SpendLogger` writes to it from `visual_verification_agent.py:616` and `jobs/research_tasks.py:515,569,730` — real data, no report, no consumer |

**Lifecycle.** [[skill-lifecycle-anti-sprawl-charter]] owns the 30-day staleness
review. `model-pin-sweep` is explicitly expected to become stale and be deleted once
consolidation lands — that should be written into its `SKILL.md`, not rediscovered at
review time.

## Handoffs on a cadence

| To | When | What |
|---|---|---|
| `[[fin-inference-cost]]` | Weekly | `nf_a.cost_per_task` by task type |
| `[[fin-unit-economics-pricing]]` | Monthly | `cost_per_restaurant_per_day` against the $20–50/mo price point |
| [[security-charter]] | On trigger, same day | Spend anomalies attributable to unauthenticated paths — [[README]] §0 finding 1 |
| [[agent-evaluation-gates-charter]] | Weekly | Task families where a cheaper model is wanted and **no verdict exists** — a coverage request, not a complaint |
| [[ai-orchestration-schedule]] | Weekly | Both routed-client-share weightings for the department board |
