---
type: agenda-full
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: provisional
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-charter]]", "[[model-routing-inference-economics-premortem]]", "[[model-routing-inference-economics-agenda-board]]", "[[model-routing-inference-economics-directive]]", "[[model-routing-inference-economics-loops]]", "[[model-routing-inference-economics-schedule]]", "[[ai-orchestration-agenda-full]]", "[[agent-evaluation-gates-charter]]", "[[security-charter]]", "[[research-math-charter|research-and-math-charter]]"]
---

# Model Routing & Inference Economics — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

One routed client in Python that a minority of traffic uses. Seven TypeScript services
each speaking to `api.anthropic.com` on their own. **Zero of the seven write to
`api_spend`.** A `cost_per_task` metric that is not merely unimplemented but
structurally uncomputable for a large share of the product's spend.

The agenda is short and it is almost entirely one thing: **make the bill visible,
starting with the most expensive and most exposed call site.** Routing policy is the
interesting work; metering is the work that has to happen first, because a routing
policy optimizing an invisible cost is [[model-routing-inference-economics-premortem]]
#1 with extra steps.

## How

### 1. Meter `analytics/consultants.service.ts` first

Not the easiest file. The **right** file, for three reasons that all point at it:

- It is the most expensive call in the product — `claude-opus-4-8` at
  `max_tokens: 4096` (`:156`, `:159`).
- It is the most exposed — [[README]] §0 finding 1: `analytics.controller.ts` has zero
  `@UseGuards` and zero `@Public`, so an anonymous caller can toggle the consultant
  layer on and then invoke it. *"Unauthorized spend on the founder's key, reachable
  now."* *Corrected 2026-08-25: closed — `analytics.controller.ts:51` now carries a
  class-level `@UseGuards(JwtAuthGuard)`; OD-20 is RESOLVED.*
- It has **no cost visibility at all**, so if that exposure were being exploited
  today, the first alert would be a provider invoice
  ([[model-routing-inference-economics-premortem]] #4).

The guard itself belongs to [[security-charter]] and Engineering, and this agenda does
not claim it. **The blindness is ours.**

### 2. A task correlation ID on every spend row, from the first row

`nf_a.cost_per_task` is named for a *task*, not a call. One invoice extraction is a
call, a retry, possibly a fallback, and a validation pass. Per-call cost is a number
that will look reassuring and be wrong by a multiple
([[model-routing-inference-economics-premortem]] #3).

Adding the correlation ID at the start costs nothing. Adding it later is a migration
over exactly the data that would have warned us.

### 3. Consolidate the seven, ordered by spend descending

`routing.routed_client_share` must be reported **weighted by spend**, not by call-site
count. Consolidating the three cheap, simple services first produces a good-looking
number and leaves the expensive ones — which is
[[model-routing-inference-economics-premortem]] #2 exactly.

Working order: `consultants.service.ts` → `inbound-responder.service.ts` (highest
volume, most tangled) → `document-extractor.service.ts` → the rest.

A cheap by-product: today the seven pin **three different model IDs** in seven places,
one of them a dated snapshot (`ux-optimizer.service.ts:250`), and
`inbound-responder.service.ts:18-20` carries a comment about a model retired in
February 2026 plus a note that its suggested replacement rejects `temperature`. That
operational knowledge currently lives in a code comment in one of seven files.

### 4. The substitution gate

No model ID change merges without an attached benchmark run.
`scripts/benchmark_haiku_vs_sonnet.py` already exists and has been run essentially
once. Wire it into CI in the shape `.github/workflows/ci.yml:226-230` uses for merge
policies. **What the benchmark must clear is [[agent-evaluation-gates-charter]]'s to
define — not ours.**

### 5. A declarative routing policy, with an explain endpoint

Only after 1–4. The policy answers *"which model runs this task"* as a table, and
there is an endpoint that answers *"which model would run this task right now, and
why."* Built together, because a policy that cannot explain itself produces a
`cost_per_task` number nobody can act on.

## Why now

1. **The exposed, expensive, unmetered call site is one file.** That coincidence is
   temporary; every week it stays unmetered is a week where abuse is invoice-detected.
2. **Metering retrofits are strictly more expensive than metering at the start** — the
   task-correlation-ID point.
3. **Model pins are already drifting.** Three IDs, seven places, one dated snapshot,
   one comment about a model retired six months ago. This is the state *before* anyone
   tries to optimize anything.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 1 | Meter `consultants.service.ts` → `api_spend` | — |
| 2 | Task correlation ID on every spend row | NF-A task identity ([[research-math-charter|research-and-math-charter]]) |
| 3 | Report `routing.routed_client_share` **weighted by spend** | step 1 |
| 4 | Consolidate the 7, spend-descending | — |
| 5 | Substitution gate in CI | pass criteria from [[agent-evaluation-gates-charter]] |
| 6 | Declarative policy + explain endpoint | steps 1–5 |

Step 1 is a day of work and closes the largest blind spot in the department.

## Questions for the founder

1. **Is anyone watching the provider bill today?** If the answer is "monthly, by
   eye", then the exposure in [[README]] §0 finding 1 has no detection at all and step
   1 is urgent rather than merely first.
2. **What is the cost ceiling per restaurant per month?** Cost-per-task is only
   actionable against a target, and `[[unit-economics-pricing-charter|fin-unit-economics-pricing]]` needs the same
   number from the other direction. Pricing is **not** locked — $20–50/mo is assumed and
   no ADR records it (OD-23, `OPEN-DECISIONS.md:32`) — what share of that may be inference?
3. **OD-04 — the external model roster** (Kimi/Moonshot, DeepSeek, etc.) was filed as
   downstream of OD-03, but the row no longer says so: its unblocker is now a **job →
   model registry** (OD-04, `OPEN-DECISIONS.md:27`). Confirm we should still not evaluate
   non-Anthropic models until the harness fork closes. We think that ordering is right
   and want it stated, not assumed.
4. **`ux-optimizer.service.ts:250` pins a dated model snapshot** while six siblings pin
   floating aliases. Deliberate — pinned for reproducibility — or drift? The answer
   changes whether the routing policy should support pinning at all.
