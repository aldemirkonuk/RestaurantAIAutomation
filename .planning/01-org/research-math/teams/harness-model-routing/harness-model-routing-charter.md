---
type: charter
division: research-math
department: research-math
team: harness-model-routing
status: partial
metrics: [nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-premortem]]", "[[harness-model-routing-agenda-full]]", "[[harness-model-routing-agenda-board]]", "[[harness-model-routing-directive]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-schedule]]", "[[research-math-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[engineering-charter]]", "[[harness-runtime-charter|aio-harness-runtime]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[intelligence]]", "[[OPEN-DECISIONS]]"]
---

# Harness & Model Routing (RM-1) — Charter

Parent: [[research-math-charter]] · Division: **Intelligence** · Siblings:
[[evaluation-doneability-charter]], [[neural-footprint-instrumentation-charter]].

## Mandate

Own the **single boundary through which this codebase talks to a model**: the harness
choice (OD-03), the call wrapper, retry / timeout / circuit-breaking, and
cheapest-capable-model routing (OD-04). RM-1 decides *how an output was produced and what
it cost to produce*. It does not decide whether the output was good — that is a different
team on purpose.

## Why distinct from its siblings

[[evaluation-doneability-charter]] decides *whether an output was good enough*. If it
absorbed this scope it would optimise its own scorecard by spending more — the exact
failure the cost-efficiency mandate exists to prevent (`intelligence.md:60-62`).
[[neural-footprint-instrumentation-charter]] records what happened; RM-1 is a *client* of
that record, and a client cannot own the contract without bending it toward its own query
pattern.

## Boundaries

Owns outright:

- **The wrapper** — one call path for every model invocation in the repo, carrying retry,
  timeout, circuit-breaking, budget checks, and NF-A emission hooks (fields defined by
  RM-3, emitted here).
- **The routing policy** — which model for which task tier, and the rule that a routing
  change is justified by a **verdict**, never by price alone.
- **OD-03 and OD-04** — running the bake-off that decides them, on this repo's own
  workloads.
- **The deprecation schedule** for the five existing model-choice conventions and the
  seven raw-HTTP callsites.
- **First-party model training, parked.** `services/agent-orchestrator/training/` holds
  three scripts (`train_invoice_scanner.py`, `train_label_scanner.py`,
  `train_menu_scanner.py`) with no live loop, no eval set, no served checkpoint. Parked
  here rather than given a team. Entry trigger: **a first-party model beats the API
  baseline on an RM-2 golden set *and* the cost delta justifies serving it**
  (`intelligence.md:502`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether the output was correct | [[evaluation-doneability-charter]] | We produce; they grade. We may dispute a verdict, never edit one |
| The NF-A field list and join keys | [[neural-footprint-instrumentation-charter]] | We emit into their contract; we do not define it |
| Migrating the 7 NestJS callsites onto the wrapper | [[engineering-charter]] | We own the wrapper and the deprecation date; they own adoption (`intelligence.md:487`) |
| `BaseAgent` lifecycle, registry, message bus, sagas as running code | [[harness-runtime-charter|aio-harness-runtime]] | They operate the Python substrate; we decide what substrate we should be on and what it costs |
| Cost & efficiency as a separate function | — | Rejected as a team: routing *is* cost. Splitting them creates a unit that files tickets against this one (`intelligence.md:503`) |

### ⚠️ Unresolved boundary — the routing seam

`[[harness-model-routing-charter|aio-model-routing]]` (Applied AI, `technology.md:363-388`) carries the mandate *"which
model runs which task at what cost: client construction, concurrency limits, retry/timeout
policy, token accounting, and the routing policy itself"*, with primary metric **"NF-A
`cost_per_task` by task type"**. That is this charter's mandate and this charter's metric.
The published Intelligence/Applied-AI boundary (`technology.md:845`) covers **evaluation
only** and does not address routing.

**This charter does not claim the seam; it names it.** Two teams cannot both own the
routing policy, and the resolution is a founder call, not a land-grab. Until it is
resolved this team's first artifact is a joint one: a single wrapper both units use.
Pattern precedent, stated in the sibling division's own words: *"if that line proves
unworkable, the fix is to merge — not to duplicate"* (`technology.md:406`).

## Metrics it moves

| Metric | Definition | Baseline |
|---|---|---|
| `nf_a.cost_per_completed_task` *(corrected 2026-08-25: cost events ship since P1; one verdict basis exists — `reconciliation_v1`, invoices, ADR 0017; coverage still ~0%)* | USD per task carrying a **passing** doneability verdict — not per API call. A retried failure is cost with no task | **Unmeasurable**: no cost events on NestJS, no verdict anywhere |
| `nf_a.harness_overhead_ms` | Wall-clock minus model time. **The number that actually decides OD-03**, since all three candidates can call an API | Not measured; **no instrument exists** |
| `share_of_model_calls_through_wrapper` | Adoption, published weekly from the day the wrapper ships | **0 of 7** NestJS callsites; Python routed via `model_clients.py` but not uniformly |

The first metric is defined against a *task*, not a *call*, deliberately: a team measured
on cost per call is rewarded for retrying less and for shipping a cheap wrong answer.
Neither is progress.

## Evidence today

**PARTIAL.**

**EXISTS — the in-house candidate is real and non-trivial.**
`services/agent-orchestrator/core/base_agent.py` (1,053 lines) already carries retry with
exponential backoff (`:224-225`), `_process_with_retry` (`:543`), idempotency (`:704`),
DLQ (`:791`) and saga compensation (`:823-905`), across **27 agent modules** in
`services/agent-orchestrator/agents/`. Extending it is a genuine OD-03 candidate, not a
straw man.

**PARTIAL — that harness governs the Python side only.** The **seven production model
callsites in NestJS bypass it entirely**, each hand-rolling `fetch` to
`https://api.anthropic.com/v1/messages`:

| Callsite | Retry? |
|---|---|
| `apps/api-gateway/src/analytics/consultants.service.ts:28` | none |
| `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:16` | none |
| `apps/api-gateway/src/procurement/documents/document-extractor.service.ts:27` | none |
| `apps/api-gateway/src/menus/parsers/scan-parser.service.ts:10` | **yes** (`:136`, `:343`) |
| `apps/api-gateway/src/inventory/photo-count.service.ts:9` | none |
| `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:13` | none |
| `apps/api-gateway/src/ux-optimizer/ux-optimizer.service.ts:44` | none |

Plus `scripts/enrich_wines.py:52` and `scripts/extract_menu_corpus.py:47`.
**Only `scan-parser` retries.** For `consultants`, `document-extractor` and
`inbound-responder`, a 429 or 529 from the API surfaces to the user as a failed
extraction.

**PARTIAL — five model-choice conventions, no policy.** Two hardcoded literals
(`photo-count.service.ts:60`, `scan-parser.service.ts:261`), one module constant
(`inbound-responder.service.ts:21`), three env vars (`ANALYTICS_CONSULTANT_MODEL`,
`DOCUMENT_EXTRACTION_MODEL`, `ANTHROPIC_EXTRACTION_MODEL`). There is no routing policy;
there are seven local ones.

**EXISTS — one prior substitution study.** `scripts/benchmark_haiku_vs_sonnet.py` is a
model-substitution benchmark that was written and, per the sibling division's own
premortem, *"run once and never again"* (`technology.md:387-390`). It is the shape the
bake-off should take and the cautionary tale about running it once.

**NEW — everything about measurement.** No `harness_overhead_ms` instrument. No cost
telemetry on the NestJS surface at all (0 grep hits, verified 2026-08-24). This is the
surface [[README]]:60-62 already assigned to this department.

## Where the evidence is thin, said plainly

The two competing OD-03 candidates (`NousResearch/hermes-agent`,
`deepseek-ai/deepseek-harness`) have **no presence in this repo** — no spike, no branch,
no import. Their evidence is entirely external, which is exactly the condition under which
`OD-03 (OPEN-DECISIONS.md:25)`'s *"no pick from repute"* rule matters most. This charter cannot
grade them; it can only refuse to let them be graded by reputation.

## Entry triggers this team owns

| Track | Trigger |
|---|---|
| Applied ML / first-party model serving | A first-party model beats the API baseline on an RM-2 golden set **and** the cost delta justifies serving it |
| OD-04 external model roster (Kimi, DeepSeek, …) | OD-03 decided, plus a cost/quality eval per task type — RM-2 supplies the quality half |
