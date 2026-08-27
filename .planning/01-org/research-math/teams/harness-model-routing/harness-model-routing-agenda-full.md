---
type: agenda-full
division: research-math
department: research-math
team: harness-model-routing
status: provisional
metrics: [nf_a.harness_overhead_ms, nf_a.cost_per_completed_task, share_of_model_calls_through_wrapper]
updated: 2026-08-24
links: ["[[harness-model-routing-charter]]", "[[harness-model-routing-premortem]]", "[[harness-model-routing-agenda-board]]", "[[harness-model-routing-directive]]", "[[harness-model-routing-loops]]", "[[harness-model-routing-schedule]]", "[[research-math-agenda-full]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[engineering-charter]]", "[[security-charter]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[harness-runtime-charter|aio-harness-runtime]]"]
---

# Harness & Model Routing (RM-1) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Replace **seven local conventions with one boundary**, and decide OD-03 on measurements
taken here rather than on reputation.

Three deliverables, in dependency order:

1. **An overhead instrument.** `nf_a.harness_overhead_ms` — wall-clock minus model time.
   Nothing measures it today, and it is the number that actually decides OD-03, because
   all three candidates can call an API. Without it the bake-off has no axis.
2. **One wrapper**, carrying retry, timeout, circuit-breaking, a per-caller budget check,
   and NF-A emission hooks (fields owned by [[neural-footprint-instrumentation-charter]],
   emitted here). Shipped **with a deprecation date for the seven raw-HTTP callsites in
   the same PR**.
3. **A routing policy** that replaces five conventions — two hardcoded literals
   (`photo-count.service.ts:60`, `scan-parser.service.ts:261`), one module constant
   (`inbound-responder.service.ts:21`), three env vars — and whose every change is
   justified by a verdict rather than a price.

## How

**Order matters more than speed here, and two orderings are non-negotiable.**

- **Cost instrumentation before retry, per callsite.** Three of the seven callsites answer
  a 429 with a user-visible failure, so retry is obviously right — but
  `analytics/consultants.service.ts` is reachable *without authentication* (OD-20) and
  calls Opus at `max_tokens: 4096`. Adding backoff there before it emits cost events
  multiplies an unauthenticated caller's spend and hides the result
  ([[harness-model-routing-premortem]] M4).
- **Instrument before decision.** The OD-03 session may not be scheduled until
  `harness_overhead_ms` has a first reading ([[harness-model-routing-directive]] rule 2).

Sequence:

| Phase | Work | Exit condition |
|---|---|---|
| **1** | Build the overhead probe; take a first reading on the Python path and on one NestJS callsite | `nf_a.harness_overhead_ms` is a number, not a blank |
| **2** | Wrapper v0 + deprecation date for 7 callsites; migrate `consultants.service.ts` **first** — hardest and most exposed | 1 of 7 migrated; SEC-3 gets its first `unauthenticated_inference_spend` reading |
| **3** | Migrate the remaining 6 with [[engineering-charter]]; publish adoption weekly | `share_of_model_calls_through_wrapper` trending, published even when flat |
| **4** | **The bake-off.** Three candidates on this repo's real workloads: extend `base_agent.py` · `NousResearch/hermes-agent` · `deepseek-ai/deepseek-harness` | A latency + cost table on our workloads; OD-03 ADR |
| **5** | Routing policy v0 replacing the five conventions; OD-04 roster scoped with RM-2's quality half | One policy, zero literals |

**Bake-off design, stated now so it cannot be shaped by an early result:** workloads are
chosen from real production task types (menu/wine extraction, vendor-reply drafting,
document extraction, analytic answer), the pass conditions come from
[[evaluation-doneability-charter]] and are committed **before** any candidate runs, and
**extending `base_agent.py` is a scored candidate** — 1,053 lines carrying retry (`:224`),
idempotency (`:704`), DLQ (`:791`) and sagas (`:823-905`) across 27 agent modules is a
real option, and dismissing the incumbent by default is a pick from repute inverted.

**On the seam:** until the founder rules on RM-1 vs `[[harness-model-routing-charter|aio-model-routing]]`, the wrapper
is built as **one artifact both units use**. Shared code resolves a boundary dispute
faster than a boundary document.

## Why now

- **Three of seven callsites turn an API 429 into a user-visible failure today.** That is
  a live reliability defect with an owner for the first time.
- **The majority of production model traffic is outside the harness OD-03 is about.**
  Fork INTEL-F5 (`intelligence.md:521`) asks whether those seven callsites are even in scope.
  If they are not, OD-03 governs a minority of calls and its title should say so.
- **OD-20 is closed, and the spend it drove was never measured**
  (OD-20, `OPEN-DECISIONS.md:111`): the unguarded route that drove paid Opus calls was
  shut by PR #31 on 2026-08-24. Security closed the route; only this team plus
  [[neural-footprint-instrumentation-charter]] can say what it cost while it was open.
- **`benchmark_haiku_vs_sonnet.py` already exists and was run once.** The evidence culture
  for this decision is present in the repo; what is missing is a cadence.

## Next steps

- [ ] Build the `harness_overhead_ms` probe; publish a first reading — blocks everything
- [ ] Draft wrapper v0 with retry, timeout, circuit-breaking, per-caller budget, NF-A hooks
- [ ] Write the deprecation plan naming all 7 files; land it in the wrapper's own PR
- [ ] Migrate `analytics/consultants.service.ts` first, with [[security-charter]] as reviewer
- [ ] Publish `share_of_model_calls_through_wrapper` weekly from day one — **0 of 7** today
- [ ] Commit bake-off workloads + pass conditions (authored by RM-2) **before** any candidate runs
- [ ] Inventory the five model-choice conventions into one config; no new env var in the meantime
- [ ] File the routing-seam question with [[decision-office-charter]]; propose the shared wrapper as the interim answer
- [ ] Re-run `scripts/benchmark_haiku_vs_sonnet.py` and put it on a quarterly cadence

## Questions for the founder

1. **Fork INTEL-F5 — are the seven NestJS callsites in scope for OD-03?** They are the majority
   of production model traffic. A harness decision that excludes them is a decision about
   the minority and should be titled that way.
2. **Who owns routing — this team or `[[harness-model-routing-charter|aio-model-routing]]`?** Same mandate, same primary
   metric, different divisions. We are not claiming it; we are asking for a ruling.
3. **Is there a per-tenant or per-caller inference budget, and what is it?** The wrapper
   can enforce a number; it cannot invent one. Without it, "denial of wallet" has a
   mechanism and no threshold.
4. **May the wrapper fail *closed* when the budget is exceeded?** Failing closed stops a
   runaway; it also means a legitimate restaurant loses a feature mid-service. That
   tradeoff is a product call, not an engineering one.
5. **Is quarterly the right bake-off cadence, given model releases arrive faster than
   that?** The alternative — re-run on every major model release — is more honest and more
   expensive.
