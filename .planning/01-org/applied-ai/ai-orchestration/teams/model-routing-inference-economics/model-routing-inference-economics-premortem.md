---
type: premortem
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: partial
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-loops]]", "[[model-routing-inference-economics-directive]]", "[[ai-orchestration-premortem]]", "[[agent-evaluation-gates-charter]]", "[[security-charter]]", "[[technology]]", "[[README]]"]
---

# Model Routing & Inference Economics — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this team has failed. What happened?

### 1. Routing was optimized on price alone, and the savings were repaid with interest

The seed premortem, `technology.md:385-388`: *"Routing is optimized on price alone, a
cheaper model is silently substituted for invoice extraction, quality degrades below
the threshold nobody was measuring, and the savings are wiped out by the repair
work — the exact scenario `benchmark_haiku_vs_sonnet.py` was written to prevent, run
once and never again."*

Expanded. The mechanism is not greed; it is **asymmetric visibility**.
`nf_a.cost_per_task` finally started emitting and became the first NF-A number anyone
could see. Being visible, it got a chart, and the chart had a trend line. Quality had
no number at all — `doneability_verdict_coverage` was near zero — so in every
conversation about the substitution, cost had evidence and quality had an opinion.
`document-extractor.service.ts:75` changed one string. Field-level errors leaked into
procurement for two months. Reconciliation cost more than a year of the price
difference.

**Earliest observable signal.** A commit that changes a model ID and cites cost,
with no eval run attached. `routing.substitutions_without_benchmark` — target zero,
and it is a *commit-level* signal, available long before the quality metric moves.

**What would have prevented it.** The two-key rule, which is why this team and
[[agent-evaluation-gates-charter]] are separate teams: **routing picks the cheapest
model that passes, and this team does not define passing** (`technology.md:399-400`).
Mechanically, a model substitution does not merge without an attached benchmark, gated
in the shape `.github/workflows/ci.yml:226-230` already uses for merge policies. The
team that saves the money must not be the team that certifies quality held.

---

### 2. Consolidation stalled at 60%, and the unrouted 40% was the expensive part

The seven gateway call sites got consolidated in the order they were easy. Photo
count, menu scan, vendor page — small, well-understood, low-risk. The routed-client
share climbed to a respectable number and the project was declared substantially done.

The two that were left were `analytics/consultants.service.ts` (which runs
`claude-opus-4-8` at `max_tokens: 4096` and is the single most expensive call in the
product) and `common/orchestrator/inbound-responder.service.ts` (which is the highest
*volume*, and the most tangled, because it carries negotiation logic and a comment
about a retired model). The remaining 40% of call sites was well over 80% of the
spend, and `nf_a.cost_per_task` was a confident number describing the cheap part of
the bill.

**Earliest observable signal.** `routing.routed_client_share` **weighted by estimated
spend, not by call-site count.** Those two numbers diverging is the whole failure, and
it is visible from the first week of the migration.

**What would have prevented it.** Sequencing the migration by **spend, descending** —
hardest and most expensive first, while the work still has momentum and attention.
`consultants.service.ts` is the first file to route, not the last.

---

### 3. Cost was measured, and it was the wrong cost

`api_spend` filled up. Every call had a provider, a model, input and output tokens, a
dollar figure, and a `restaurant_id`. And the question that actually mattered — *what
does it cost us to serve one restaurant for one month, and is that under the price* —
still could not be answered, because spend was recorded per **call**, not per **task**,
and a single invoice extraction is a retry, a fallback, a re-prompt, and a validation
pass. Per-call cost looked fine. Per-task cost was four times higher and nobody had
the join.

**Earliest observable signal.** `api_spend` rows with no task correlation ID. Visible
on the first row written from the gateway.

**What would have prevented it.** `nf_a.cost_per_task` is named
**cost_per_task** in [[README]] §4.2 for a reason, and this team should treat that name
as a specification rather than a label. A task identifier on every spend row, from the
first row — retrofitting the join later is a migration over the exact data that would
have told us we needed it.

---

### 4. The unguarded analytics endpoint was exploited, and the bill was the first alert

[[README]] §0 finding 1: `analytics.controller.ts` carries zero `@UseGuards` and zero
`@Public`. An anonymous caller can `PUT /analytics/consultants/:restaurantId/toggle`
then `POST /analytics/consult/:restaurantId`, reaching `consultants.service.ts:159`
calling `claude-opus-4-8` at `max_tokens: 4096`. The only brake is an in-memory,
per-instance rate limiter. *"Unauthorized spend on the founder's key, reachable now."*

The guard is [[security-charter]]'s to add and Engineering's to build. **The reason
this appears in *our* premortem** is that when it happened, nothing on our side
noticed: `consultants.service.ts` does not write to `api_spend`, so the abuse produced
no spend signal, no anomaly, no alert. The first notification was a provider invoice.

**Earliest observable signal.** Cost per restaurant, per day, with an anomaly
threshold. Currently unbuildable for this exact path — which is the finding.

**What would have prevented it.** Metering `consultants.service.ts` **first**, before
any other consolidation work. It is simultaneously the most expensive call site, the
most exposed one, and the one with no cost visibility. Those three facts about the
same file are what make it the first thing this team should touch.

---

### 5. The routing policy became a config file nobody could reason about

Consolidation succeeded. One client, one place, full metering. Then the policy grew:
per-task-type model selection, per-tenant overrides, a fallback chain, a cost ceiling,
a latency ceiling, an A/B split for a migration that never finished. Eighteen months
in, nobody could answer *"which model will run this task, and why"* without reading
the code — and the answer changed depending on load.

**Earliest observable signal.** The first per-tenant or per-restaurant routing
override. Not because overrides are wrong, but because the first one is where a policy
stops being a table and starts being a program.

**What would have prevented it.** The policy is **declarative and inspectable**, and
there is an endpoint that answers *"which model would run this task right now, and
why"* — built with the policy, not after it. A routing decision that cannot explain
itself is a `cost_per_task` number nobody can act on, and this team's entire output is
that number.
