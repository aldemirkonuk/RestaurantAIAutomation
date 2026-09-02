---
type: charter
division: research-math
department: research-math
status: partial
metrics: [nf_a.cost_per_completed_task, nf_a.harness_overhead_ms, nf_a.verified_task_success_rate, nf_a.event_completeness]
updated: 2026-08-24
links: ["[[research-math-premortem]]", "[[research-math-agenda-full]]", "[[research-math-agenda-board]]", "[[research-math-directive]]", "[[research-math-loops]]", "[[research-math-schedule]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[ORG_STRUCTURE]]", "[[intelligence]]", "[[0001-mudavym-single-entity]]", "[[0006-neural-footprint-architecture]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[data-charter]]", "[[engineering-charter]]", "[[ai-orchestration-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[harness-runtime-charter|aio-harness-runtime]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Research & Math — Charter

Parent division: **Intelligence** ([[ORG_STRUCTURE]] §2). Siblings in-division:
[[security-charter]], [[analytics-bi-charter]].

## Mandate

Research & Math is accountable for **how well this system thinks, what that thinking
costs, and whether we can prove either claim**. Concretely it owns three things that are
one thing: the single boundary through which the codebase talks to a model (harness,
routing, retry, cost), the independent verdict on whether a model's output was actually
done (doneability criteria, golden sets, CI gates), and the event contract that records
both (NF-A). It is the department that turns "the agent worked" from an assertion into a
number — and it is the only department chartered to say that number is worse than someone
claimed.

## Why this department is structurally protected — read this before anything else

This department exists **in this shape** because a specific argument was had and settled.

The founder proposed splitting the company in two: a research lab, plus an app that
"endpoints the results we find at research." That was argued and **declined** — see the
review trail of [[0001-mudavym-single-entity]] (`.planning/decisions/0001-mudavym-single-entity.md:50`).
The argument against was not that research matters less: it was that a research lab with
no product has no data, that the vision's own named blocker is data, and that a contract
boundary through the guest-signal flywheel costs more than it buys.

**The concern underneath that proposal was legitimate and was granted, not dismissed.**
Research being subordinated to shipping deadlines is a real failure mode, and the ADR
records four specific compensations in place of a corporate split. They are this
department's operating terms, not aspirations:

| Compensation | What it means operationally | Where it is written |
|---|---|---|
| **Its own division-level standing** | Research is not a function inside Engineering or Applied AI, where its budget would be the residue of a sprint. | [[0001-mudavym-single-entity]] review trail; [[ORG_STRUCTURE]] §2 |
| **Metrics that are not shipping velocity** | Every metric below is a *ratio or a cost per unit of verified quality*. This department may not be measured by features delivered, tickets closed, PRs merged, or teams unblocked. A quarter in which it ships nothing and produces a defensible bake-off table is a good quarter. | This charter, §"Metrics it moves" |
| **A long-horizon schedule product deadlines cannot preempt** | The OD-03 bake-off, the golden sets, and the NF-A backfill are multi-week, and none of them may be truncated because a launch date moved. [[research-math-schedule]] carries a long-horizon lane that is explicitly non-preemptible. | [[research-math-schedule]] |
| **Advisory independence** | [[evaluation-doneability-charter]] can fail [[harness-model-routing-charter]] — inside the same department, by design — and the department's findings route the same way advisory findings do: written, against a named unit, findings-only ([[ORG_STRUCTURE]] §3). | This charter, §"The independence rule" |

There is a fifth compensation, and it is the strongest one: **the separation the founder
asked for was granted where it is cheap — in the data model.**
[[0006-neural-footprint-architecture]] splits the neural footprint into a narrow
production store and a wide, append-only research store, and says so explicitly
(`0006-neural-footprint-architecture.md:68-70`): *the separation belongs in the data
model, where it is cheap, not in corporate structure, where it is expensive.* This
department owns that research store. The artifact that answered the separate-company
question is the artifact this department is chartered to build.

> **⬦ Fork this charter must raise.** [[0001-mudavym-single-entity]]'s review trail says
> "Research & Math holds its own **division**". [[ORG_STRUCTURE]] §2 — locked the same
> day — places Research & Math as a **department** inside the Intelligence division,
> alongside Security and Analytics & BI. Either the compensation was satisfied in
> substance (division-level separation from Platform and Product, which Intelligence
> does provide) or the ADR's wording is now inaccurate. Both readings are defensible;
> only one can be written down. Raised in [[research-math-agenda-full]] as a founder
> question and pushed to [[decision-office-charter]].

## Boundaries

Owns outright — **three teams, which are the three verbs the mandate implies**
(`intelligence.md:44-51`): build the runner, grade the runner, record what the runner did.

| Team | Owns | Primary metric | Evidence |
|---|---|---|---|
| [[harness-model-routing-charter]] | How a model call is made and what it costs — harness (OD-03), wrapper, retry/timeout/circuit-breaking, cheapest-capable routing (OD-04) | `nf_a.cost_per_completed_task` | PARTIAL |
| [[evaluation-doneability-charter]] | Whether the output was good enough — doneability criteria, golden sets, adversarial negatives, CI gates, skill-layer anti-sprawl audit | `nf_a.verified_task_success_rate` | PARTIAL |
| [[neural-footprint-instrumentation-charter]] | The NF event contract end to end — schema, emission, join keys, retention, every `subject_type` | `nf_a.event_completeness` | PARTIAL |

Also owned at department level:

- **NF-A in full** — the agent track of the neural footprint ([[README]] §4.2), including
  the **research store** and the **gated NF-C track** whose entry trigger
  ([[0006-neural-footprint-architecture]]: *a funded study partner or a consumer-grade
  biosignal device with an API*) this department is the one to declare met.
- **T4 meta-skills** — `skill-create`, `skill-review`, `department-agenda-sync`
  ([[README]] §3.2) and the §3.3 anti-sprawl rule, folded into
  [[evaluation-doneability-charter]] rather than given a fourth team
  (`intelligence.md:504`).
- **The weekly skill-health job** ([[README]] §6).

## The independence rule — author ≠ auditor, inside this department

[[evaluation-doneability-charter]] **must be able to fail** [[harness-model-routing-charter]].
This is stated as a rule rather than a hope because the two teams report to the same
department head, and a department that grades its own harness grades its own homework —
the same argument [[ORG_STRUCTURE]] §3 uses to place Red Team outside the line.

The rule, concretely:

1. RM-2 writes the pass condition **before** RM-1 runs the bake-off, and the pass
   condition is committed to the repo before any candidate result is known.
2. RM-1 may not modify a golden set, a threshold, or a pass condition. It may file a
   dispute in `questions.md`; the dispute is resolved by the founder or
   [[decision-office-charter]], never by the author.
3. A doneability verdict that RM-1 disagrees with **still publishes**. The disagreement
   publishes next to it.
4. `nf_a.verified_task_success_rate` is always reported **beside** `base_agent`'s
   self-reported `success_rate` (`services/agent-orchestrator/core/base_agent.py:144`).
   The gap between the two is RM-2's actual product, and it is a department-level number.

If this rule is ever quietly suspended for a deadline, the compensation clause above has
been revoked in practice whatever the org chart says. That is the tell in
[[research-math-premortem]] M1.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Running the eval gates in CI and production | [[agent-evaluation-gates-charter|aio-evaluation-gates]] *(Applied AI)* | **We define what passing means; they enforce it.** Methodology vs. operations — the sharpest seam in the org, and it is an open fork (see below) |
| `BaseAgent` lifecycle, registry, message bus, sagas | [[harness-runtime-charter|aio-harness-runtime]] *(Applied AI)* | They own the Python agent substrate as running code; we own the decision about what substrate we should be on (OD-03) and what it costs |
| Agent behavior and prompts | `[[agent-fleet-charter|aio-agent-fleet]]` *(Applied AI)* | We measure the fleet; we do not staff it |
| Adopting the model wrapper in the seven NestJS callsites | [[engineering-charter]] *(Platform)* | We own the wrapper and the deprecation date; Engineering owns the migration |
| The physical NF tables and migrations | [[data-charter]] *(Platform)* | We own the **schema contract**; Data owns the DDL and the pipeline (`intelligence.md:486`) |
| Grading deterministic arithmetic against a ledger | [[analytics-bi-charter]] AB-3 | RM-2 grades **nondeterministic** model output with judges and thresholds; AB-3 grades exact equality. Shared vocabulary, different work (`intelligence.md:460-464`) |
| Whether an attacker *can* abuse a model surface | [[security-charter]] SEC-3 | We instrument the spend; they own the exposure. SEC-3's primary metric is unmeasurable until we emit (`intelligence.md:488`) |
| Training first-party models | Parked under [[harness-model-routing-charter]] | `services/agent-orchestrator/training/` holds three scripts, no live loop, no served checkpoint. Entry trigger: a first-party model beats the API baseline on an RM-2 golden set *and* the cost delta justifies serving it (`intelligence.md:502`) |

### ⚠️ The evaluation seam, stated plainly

`.planning/foundation/teams/technology.md:392-406` charters `[[agent-evaluation-gates-charter|aio-evaluation-gates]]`
to **run and enforce** doneability, and states the boundary in the same words this
charter does: *methodology here, operations there*. It also states the remedy if the line
fails: **"the fix is to merge this team into Research & Math — not to duplicate it."**
This charter accepts that remedy in advance. If within two close-times either unit is
maintaining a golden set the other also maintains, [[evaluation-doneability-charter]]
files the merge proposal itself rather than defending its scope.

**A second, unnamed seam exists and this charter raises it.** The published boundary
covers *evaluation* only. It does not cover harness or routing — and
`[[harness-model-routing-charter|aio-model-routing]]` (`technology.md:363-388`) carries the mandate *"which model runs
which task at what cost: client construction, concurrency limits, retry/timeout policy,
token accounting, and the routing policy itself"* with primary metric **"NF-A
`cost_per_task` by task type"**. That is [[harness-model-routing-charter]]'s mandate and
[[harness-model-routing-charter]]'s metric, in a different division. Two teams cannot
both own the routing policy. See [[research-math-agenda-full]] §Questions.

**ID note (collision resolved):** `technology.md` originally numbered the evaluation
seam "OD-21", but `OPEN-DECISIONS.md:144` already assigns OD-21 to the Obsidian
structural workflow. [[decision-office-charter]] reconciled the local numbering; the
seam is **TECH-F3** ([[FORK-REGISTRY]]) and should be cited by that ID.

## Metrics it moves

None of these is a velocity number. That is deliberate and it is the compensation clause
in force.

| Metric | Definition | Honest baseline today |
|---|---|---|
| `nf_a.cost_per_completed_task` | USD per task carrying a **passing** doneability verdict — not per API call. A retried failure is cost with no task. | *Corrected 2026-08-25:* cost telemetry shipped on the NestJS surface (P1) and one verdict basis exists (`reconciliation_v1`, invoices — ADR 0017). **Still effectively unmeasurable**: coverage ~0%, every other task type ungraded |
| `nf_a.harness_overhead_ms` | Wall-clock minus model time. The number that actually decides OD-03, since all three candidates can call an API | Not measured |
| `nf_a.verified_task_success_rate` | Success as scored by an independent verdict, published beside `base_agent.py:144`'s self-reported rate | Near zero outside the merge-policy gate |
| `nf_a.event_completeness` | Share of model invocations emitting one joinable event carrying all eight NF-A fields | **0% for the NestJS surface**; partial for Python across two unjoined tables |
| *(inherited hard gate)* `identity.false_merge_count` | From `scripts/eval_merge_policies.py` — never summed with false splits | 0, and it must stay 0 |

**The department metric is the set, and the first target is the same for all four: move
them from *unmeasurable* to *measured*.** A department that reports an improvement in a
number it has never read is the failure mode in [[research-math-premortem]] M2.

## Evidence today

**PARTIAL.** Real assets exist; they do not meet.

**EXISTS — the Python harness.** `services/agent-orchestrator/core/base_agent.py`
(1,053 lines) carries retry with exponential backoff (`:224-225`), `_process_with_retry`
(`:543`), idempotency (`:704`), DLQ (`:791`) and saga compensation (`:823-905`) across
27 agent modules in `services/agent-orchestrator/agents/`.

**EXISTS — the strongest culture artifact in the codebase.**
`scripts/eval_merge_policies.py` + `datasets/merge_eval/` is a working falsification
harness: per `scripts/eval_guest_merge_policies.py:1-30`, the beverage identity key was
tested against **732,874 free known-distinct pairs**, and that test **killed three
earlier designs, one of which committed 212 false merges**. Its guest twin ships
*before* the data exists, with a pass condition of exactly zero.

**PARTIAL — the two halves of NF-A do not meet.** `base_agent.py:743-784` `log_decision()`
writes reasoning to `decision_log` with no cost;
`services/agent-orchestrator/services/spend_logger.py:41-77` writes cost to `api_spend`
with no verdict. Of the eight NF-A fields ([[README]] §4.2), no single row anywhere holds
more than four. *Corrected 2026-08-25: superseded by P1 — `neural_footprint_event` is
one row carrying the full ADR 0008 shape, and the verdict arrives as a sidecar claim
([[0017-doneability-verdicts-are-sidecar-claims]]).*

**NEW / zero — the NestJS surface emitted nothing as of 2026-08-24.** *Corrected
2026-08-25: superseded by P1 — all 7 gateway callsites now route through
`common/model-client` and write `neural_footprint_event`
(`model-client.service.ts:413`). See `.planning/STATE.md`.* Grepping `apps/api-gateway/src` for
`api_spend`, `cost_usd` or `input_tokens` returns **0 hits** (verified 2026-08-24), across
**seven** raw-HTTP model callsites: `analytics/consultants.service.ts:28`,
`common/orchestrator/inbound-responder.service.ts:16`,
`procurement/documents/document-extractor.service.ts:27`,
`menus/parsers/scan-parser.service.ts:10`, `inventory/photo-count.service.ts:9`,
`vendor-intel/vendor-page-extractor.service.ts:13`, `ux-optimizer/ux-optimizer.service.ts:44`.
**Only `scan-parser.service.ts` has any retry at all** (`:136`, `:343`). Model choice is
scattered across five conventions: two hardcoded literals (`photo-count.service.ts:60`,
`scan-parser.service.ts:261`), one module constant (`inbound-responder.service.ts:21`),
three env vars.

**The department's first concrete assignment falls out of one line of code.**
`SpendLogger.log()` (`services/agent-orchestrator/services/spend_logger.py:41-48`) takes
`provider, model, input_tokens, output_tokens, cost_usd, restaurant_id` — **and no
`agent` parameter**. So even on the Python side, where cost *is* logged, *"cost per task
per agent"* is not derivable from what is written today. Not a design debate; a missing
column and a missing argument. It is assignment #1 for
[[neural-footprint-instrumentation-charter]] and the cheapest true statement this
department can make in week one.

**NEW — the team layer itself.** All three teams are new as organizational units. The
work they inherit is not new; its ownership is.

## Where the evidence is thin, said plainly

- **`nf_a.harness_overhead_ms` has no instrument.** Nothing in the repo measures
  wall-clock-minus-model-time today. OD-03 cannot be decided on evidence until one exists,
  and building it is a prerequisite to the bake-off, not part of it.
- **Doneability criteria are asserted nowhere.** `base_agent.py:144` computes a
  `success_rate` whose "success" means *the handler did not raise* — a definition under
  which a confidently wrong extraction is a success. There is no artifact to expand;
  RM-2's first deliverable is a first draft, not a revision.
- **T4 governs nothing yet.** The repo has exactly **one** project skill
  (`.agents/skills/railway-config/SKILL.md`, [[README]] §3.1). A skill registry built now
  would be scaffolding around an empty room. The entry trigger for treating T4 as real
  work is ~15 skills or two overlapping skills in production (`intelligence.md:504`).

## Open forks touching this department

| Ref | Fork |
|---|---|
| **OD-03** | Orchestration base — must be decided by a bake-off on this repo's own workloads. `OPEN-DECISIONS.md:27` already says *"No pick from repute."* [[harness-model-routing-charter]] owns executing that |
| **OD-04** | External model roster — blocked on OD-03 |
| **OD-11** | NF production schema detail — columns, partial indexes, retention. Gates every NF implementation; owner split with [[data-charter]] must be named or it gets built twice |
| **INTEL-F3** (`intelligence.md:519`) | NF has no `subject_type` for the restaurant **operator** — the strongest human-preference signal already collected has no home. Interacts directly with OD-11 |
| **INTEL-F5** (`intelligence.md:521`) | Are the seven raw-HTTP NestJS callsites in scope for OD-03? They are the majority of production model traffic. If not, OD-03 governs a minority of calls |
| *(new)* | **The division-vs-department wording of [[0001-mudavym-single-entity]]'s compensation.** See the fork box above |
| *(new)* | **The routing seam** — [[harness-model-routing-charter]] and `[[harness-model-routing-charter|aio-model-routing]]` share a mandate and a metric. The published boundary covers evaluation only |
