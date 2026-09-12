---
type: charter
division: applied-ai
department: ai-orchestration
team: model-routing-inference-economics
status: partial
metrics: [nf_a.cost_per_task, routing.routed_client_share]
updated: 2026-08-24
links: ["[[model-routing-inference-economics-premortem]]", "[[model-routing-inference-economics-agenda-full]]", "[[model-routing-inference-economics-agenda-board]]", "[[model-routing-inference-economics-directive]]", "[[model-routing-inference-economics-loops]]", "[[model-routing-inference-economics-schedule]]", "[[ai-orchestration-charter]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[agent-evaluation-gates-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[technology]]", "[[README]]"]
---

# Model Routing & Inference Economics — Charter

Team of [[ai-orchestration-charter]] · Division: **Applied AI** · Alias in the team
corpus: `[[harness-model-routing-charter|aio-model-routing]]` (`technology.md:363`).

## Mandate

Which model runs which task at what cost: client construction, concurrency limits,
retry/timeout policy at the model boundary, token accounting, and the routing policy
itself.

**Distinct from siblings because cost and model choice are cross-cutting** — no
individual agent can own the decision, and [[harness-runtime-charter]] owns delivery
mechanics rather than economics (`technology.md:368-369`). This is also the team
[[README]] §0 finding 5 names: Anthropic and Gemini are called over **raw HTTP, not
their SDKs**, so retry, timeout and cost accounting are hand-rolled at every
independent call site.

## Boundaries

Owns outright:

- **The routed client** — `services/agent-orchestrator/services/model_clients.py`:
  `get_gemini_client` (`:52`), `get_haiku_client` (`:73`), `get_haiku_semaphore`
  (`:93`, `asyncio.Semaphore(5)` per `:46` — *"max 5 concurrent LLM calls"*).
- **Token and cost accounting** — `services/spend_logger.py`, the single insertion
  point into `api_spend`
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2231`);
  `jobs/spend_tasks.py`, `jobs/haiku_tasks.py`.
- **Model-substitution studies** — `scripts/benchmark_haiku_vs_sonnet.py`.
- **The routing policy**, which does not exist yet.
- **The model boundary in the gateway** — the seven TypeScript services that currently
  each speak to `api.anthropic.com` on their own.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **What "passes" means** — the quality bar a model must clear | [[agent-evaluation-gates-charter]] | Routing picks the cheapest model that **passes**; this team does not define passing (`technology.md:399-400`). This is the most important non-goal on the page |
| Agent behavior and prompts | [[agent-fleet-charter]] | A prompt is behavior; a model is a routing decision |
| Harness retry/DLQ/lifecycle | [[harness-runtime-charter]] | We own retry at the **model boundary**; they own it at the message boundary |
| NF-A metric definitions | [[research-math-charter|research-and-math-charter]] | We emit `cost_per_task`; they define what a task is |
| Pricing the product to customers | `[[unit-economics-pricing-charter|fin-unit-economics-pricing]]` | We produce cost-per-task; they turn it into a price |
| Whether a mutation may execute | [[action-safety-the-human-gate-charter]] | A cheap model is not a licence to skip a gate |

**The separation from [[agent-evaluation-gates-charter]] is load-bearing.** The team
that saves the money must not be the team that decides whether quality held. That is
the same principle [[ORG_STRUCTURE]] §3 uses for the advisory layer, applied inside one
department.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `nf_a.cost_per_task` by task type | The primary metric | **not emitted** |
| `routing.routed_client_share` | Share of model calls through a single routed client | **well under 100%** — see evidence. The team's first measurable target (`technology.md:381-383`) |
| `routing.metered_call_share` | Share of model calls that write to `api_spend` | **0 / 7** in the gateway, verified |
| `routing.distinct_model_pins` | Independent places a model ID is hard-coded | **≥7**, verified |
| `routing.substitutions_without_benchmark` | Model changes shipped with no eval run attached | target zero |

## Evidence today

**EXISTS, but fragmented — which is the point** (`technology.md:374`).

**The routed path, in Python:**
- `services/model_clients.py:52,73,93` — the one place a client is constructed with a
  shared concurrency limit.
- `services/spend_logger.py` — the single insertion point into `api_spend`. Called
  from `agents/visual_verification_agent.py:616` and `jobs/research_tasks.py:515,569,730`.
- `scripts/benchmark_haiku_vs_sonnet.py` — an existing model-substitution study.

**The unrouted path, in TypeScript — verified this session, and worse than the brief
states:**

`technology.md:379` reports 8 independent gateway call sites. On disk, **7 issue real
model calls**, each declaring its own `https://api.anthropic.com/v1/messages`
constant:

| File | URL const | Model pin |
|---|---|---|
| `analytics/consultants.service.ts` | `:28` | `:156` `claude-opus-4-8` |
| `common/orchestrator/inbound-responder.service.ts` | `:16` | `:21` `claude-haiku-4-5` |
| `inventory/photo-count.service.ts` | `:9` | `:60` `claude-haiku-4-5` |
| `menus/parsers/scan-parser.service.ts` | `:10` | `:261` `claude-haiku-4-5` |
| `procurement/documents/document-extractor.service.ts` | `:27` | `:75` `claude-haiku-4-5` |
| `ux-optimizer/ux-optimizer.service.ts` | `:44` | `:250` `claude-haiku-4-5-20251001` |
| `vendor-intel/vendor-page-extractor.service.ts` | `:13` | `:71` `claude-haiku-4-5` |

The eighth file, `common/orchestrator/health-proxy.controller.ts:48`, only reads the
key for a health readout — it is not a call site. **Correction to
`technology.md:379`: 7, not 8.**

**And the finding that matters most: `grep -c api_spend` returns 0 for all seven.**
`SpendLogger` is Python-only, so **not one gateway model call is metered**.
`nf_a.cost_per_task` is not merely unimplemented for these paths — it is structurally
uncomputable. Roughly a third of the product's model spend (analytics consultants on
`claude-opus-4-8`, invoice extraction, menu scanning, vendor pages, photo counts,
inbound vendor replies) is invisible.

**Two further symptoms of the same fragmentation:**
- Model IDs are pinned in seven places with **three different values**, including one
  pinned to a dated snapshot (`ux-optimizer.service.ts:250`).
- `inbound-responder.service.ts:18-20` carries a comment about a model *retired in
  February 2026* and an instruction about which alternative rejects `temperature`.
  That knowledge lives in a code comment in one of seven files, which is precisely the
  cost of having no routing layer.

**The exposure that is not this team's to fix, but is this team's to price.**
[[README]] §0 finding 1 records that `analytics.controller.ts` is unguarded, allowing
an anonymous caller to reach `consultants.service.ts:159` calling `claude-opus-4-8` at
`max_tokens: 4096` — *"unauthorized spend on the founder's key, reachable now."* The
guard is Security's and Engineering's. **The fact that nobody would see the spend is
ours.** *Corrected 2026-08-25: both halves have since closed — the guard landed
(`analytics.controller.ts:51`, OD-20 RESOLVED) and the spend is visible since P1.*

## Status

`partial` — a real routed client exists and a minority of traffic uses it.
