---
type: agenda-full
division: research-math
department: research-math
status: provisional
metrics: [nf_a.event_completeness, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.harness_overhead_ms]
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[research-math-premortem]]", "[[research-math-agenda-board]]", "[[research-math-directive]]", "[[research-math-loops]]", "[[research-math-schedule]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[intelligence]]", "[[ORG_STRUCTURE]]", "[[0001-mudavym-single-entity]]", "[[0006-neural-footprint-architecture]]", "[[data-charter]]", "[[engineering-charter]]", "[[security-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[decision-office-charter]]"]
---

# Research & Math — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Get four metrics from **unmeasurable** to **measured**, in that order, before attempting
to move any of them — and protect the department's ability to say the resulting numbers
are bad.

| Metric | State today | What a first reading requires |
|---|---|---|
| `nf_a.event_completeness` | **0%** on the NestJS surface (0 hits for `api_spend`/`cost_usd`/`input_tokens` in `apps/api-gateway/src`); partial on Python across two unjoined tables | An event contract with a join key, and one emitting callsite |
| `nf_a.cost_per_completed_task` | Unmeasurable — corrected 2026-08-25: cost events ship on NestJS (P1) and one verdict basis exists (`reconciliation_v1`, invoices — ADR 0017); the gap is now coverage, not existence | Cost events **and** verdicts sharing one key |
| `nf_a.harness_overhead_ms` | Not measured; **no instrument exists** | A wall-clock-minus-model-time probe. This blocks OD-03 |
| `nf_a.verified_task_success_rate` | Near zero outside the merge-policy gate; doneability criteria asserted nowhere | Written criteria per task type + one golden set with real negatives |

Three of the four are blocked on the same missing thing: **an event that carries a task
identity, a cost, and a verdict at once.** That is why the sequencing below is not
symmetric across the three teams.

## How

**Sequence: contract → emit → baseline → decide → move.**

1. **Week 1 — the cheapest true thing.** `SpendLogger.log()` gains an `agent`
   parameter and `api_spend` gains the column
   (`services/agent-orchestrator/services/spend_logger.py:41-48` takes
   `provider, model, input_tokens, output_tokens, cost_usd, restaurant_id` and **no
   agent**). Until that lands, "cost per task per agent" is not derivable from anything
   this system writes — on either side. This is one argument and one column, and it is
   [[neural-footprint-instrumentation-charter]]'s assignment #1 precisely because it is
   too small to defer and too load-bearing to skip.
2. **Week 1–2 — the join key before the schema.** `correlation_id` already exists in
   `decision_log` (`base_agent.py:743-784`). Ship it into `api_spend` and the two Python
   halves become one footprint with a bad shape rather than two footprints. Do not wait
   for OD-11 to close; two tables that can be joined are recoverable, two that cannot are
   the M5 failure in [[research-math-premortem]].
3. **Weeks 2–4 — one NestJS callsite, end to end.** Not seven. One, chosen because it is
   the most exposed: `analytics/consultants.service.ts:28`, which is reached by an
   **unguarded** route (OD-20) invoking an Opus call. Instrumenting it first gives
   [[security-charter]] SEC-3 its first reading of
   `nf_a.unauthenticated_inference_spend`, which is today unmeasurable *because of us*
   (`intelligence.md:488` — hard dependency, not a nice-to-have).
4. **Weeks 2–6 — doneability criteria for three task types, written before any harness
   is chosen.** Wine/menu extraction, vendor-reply drafting, analytic answer. Written by
   [[evaluation-doneability-charter]], committed **before** RM-1's bake-off produces any
   result, per the author≠auditor rule.
5. **Weeks 4–8 — build the overhead instrument, then run the bake-off.** OD-03 may not be
   scheduled before `harness_overhead_ms` has a first reading. `OD-03 (OPEN-DECISIONS.md:26)`
   already forbids a pick from repute; this makes the prohibition mechanical.
6. **Continuous — publish the gap.** `nf_a.verified_task_success_rate` beside
   `base_agent.py:144`'s self-reported rate, every close-time. The gap is the
   department's product.

**What we deliberately do not do first:** build a skill registry. The repo has exactly
one project skill (`.agents/skills/railway-config/SKILL.md`). T4 is real work at ~15
skills or the first overlap, not before (`intelligence.md:504`).

## Why now

- **The instrumentation gap is blocking two other departments.** SEC-3's primary metric
  and AB-2's operator-signal question both terminate here. NF-A is the only L4 artifact,
  and L4 sits under L5 because departments are evaluated *by* metrics ([[README]] §1). A
  department layer standing on an unemitting metric spine is the sequencing claim in
  [[README]] §8 failing in practice.
- **Two forks are aging in a way that gets more expensive, not less.** OD-03 governs a
  minority of production model traffic until fork INTEL-F5 is answered
  (`intelligence.md:521`); OD-11 gates every NF implementation and each week of delay
  adds a private table (premortem M5).
- **There is live unauthorized spend on the founder's key**
  (`OD-20, OPEN-DECISIONS.md:110`) and **nobody can say how much**, because the callsite emits
  nothing. *Corrected 2026-08-25: both halves are closed — OD-20 is RESOLVED
  (`analytics.controller.ts:51` now carries a class-level `@UseGuards(JwtAuthGuard)`)
  and the callsite emits since P1.* That is not a security finding this department owns — it is an
  instrumentation gap this department owns, discovered by Security.
- **The protection clause is easiest to honour at founding.** A long-horizon lane
  declared in week one costs nothing; declared after the first slip it reads as an
  excuse.

## Next steps

- [ ] Add `agent` to `SpendLogger.log()` and to `api_spend` — [[neural-footprint-instrumentation-charter]]
- [ ] Propagate `correlation_id` into `api_spend`; publish the first joined row — [[neural-footprint-instrumentation-charter]]
- [ ] Instrument `analytics/consultants.service.ts` end to end; hand SEC-3 its first reading — [[neural-footprint-instrumentation-charter]] + [[security-charter]]
- [ ] Write doneability criteria for three task types and commit them **before** the bake-off — [[evaluation-doneability-charter]]
- [ ] Audit every existing eval set for provenance; mark any set with no free negatives `imagination-only` — [[evaluation-doneability-charter]]
- [ ] Build the `harness_overhead_ms` probe; publish a first reading; only then schedule OD-03 — [[harness-model-routing-charter]]
- [ ] Ship the model wrapper **with a deprecation date for the seven callsites in the same PR**; publish `share_of_model_calls_through_wrapper` weekly — [[harness-model-routing-charter]] + [[engineering-charter]]
- [ ] Name both owners on OD-11 (schema contract vs. physical table) before any DDL — with [[data-charter]]
- [ ] Fold fork INTEL-F3 (`operator` as a fourth `subject_type`) into the OD-11 session, not after it
- [ ] Declare the long-horizon lane non-preemptible in [[research-math-schedule]] and register it with [[decision-office-charter]]
- [ ] Push the two new forks below into `OPEN-DECISIONS.md` — [[decision-office-charter]]

## Questions for the founder

1. **Is the compensation clause satisfied by a department, or does it require a
   division?** [[0001-mudavym-single-entity]]'s review trail says Research & Math "holds
   its own **division**"; [[ORG_STRUCTURE]] §2 — locked the same day — makes it a
   **department** inside Intelligence. Intelligence does provide separation from Platform
   and Product, so the substance may be intact. But the ADR and the org chart currently
   say different words, and this department's founding argument rests on that sentence.
   Confirm which is canonical, and amend the other.
2. **Who owns the routing policy?** [[harness-model-routing-charter]] (here) and
   `[[harness-model-routing-charter|aio-model-routing]]` (Applied AI, `technology.md:363-388`) have the same mandate —
   *which model runs which task at what cost* — and the same primary metric, NF-A cost per
   task. The published boundary between the divisions covers **evaluation** only
   (`technology.md:845`). Two teams cannot both own routing. Merge, or draw the line
   explicitly?
3. **Fork INTEL-F5 — are the seven NestJS callsites in scope for OD-03?** They are the majority
   of production model traffic. If they are out of scope, OD-03 is a decision about a
   minority of calls and should say so in its title.
4. **Is `nf_a.verified_task_success_rate` allowed to block a release?** RM-2 must be able
   to fail RM-1 (charter rule). Failing a *sibling* is cheap; the real test is whether a
   verdict can stop a **product** ship. If it cannot, the department is advisory in fact,
   and the charter should say advisory rather than implying a gate.
5. **What is the entry trigger for NF-C, in your words?**
   [[0006-neural-footprint-architecture]] reserves the slot and requires the trigger to be
   explicit — *a funded study partner, or a consumer biosignal device with an API*. This
   department declares it met. Confirm those two, or replace them, so the declaration is
   not ours to invent later.
6. **How much may a weekly CI eval cost per month before it is switched off?**
   `v3.0-TECH-DEBT.md:326-330` specifies weekly evals *with cost caps* and does not name
   the cap. An unnamed cap is the second-order failure in
   [[evaluation-doneability-premortem]]: the suite gets disabled the first month it costs
   more than it visibly caught.
