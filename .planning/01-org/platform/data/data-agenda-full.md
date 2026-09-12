---
type: agenda-full
division: platform
department: data
status: active
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate, substrate.rows_without_source_guarantee, nf_a.cost_per_task]
updated: 2026-08-28
links: ["[[data-charter]]", "[[data-premortem]]", "[[data-agenda-board]]", "[[data-loops]]", "[[data-directive]]", "[[data-schedule]]", "[[data-agent-stack]]", "[[data-questions]]", "[[corpora-enrichment-agenda-full]]", "[[annotation-ground-truth-agenda-full]]", "[[synthetic-generation-simulation-agenda-full]]", "[[pos-operational-telemetry-ingest-agenda-full]]", "[[substrate-quality-coverage-agenda-full]]", "[[0039-activation-plan-of-record]]", "[[0038-cards-run-as-declared-scripts]]", "[[0035-wave2-seam-reconciliation]]", "[[schema-migrations-charter]]", "[[state-integrity-invariants-charter]]", "[[agent-evaluation-gates-charter]]", "[[decision-office-charter]]", "[[README]]"]
---

# Data — Full Agenda

> **ACTIVE — dated 2026-08-28.** Written by this department under
> [ADR 0039](../../../decisions/0039-activation-plan-of-record.md) Track B and
> [`GENERATION_BRIEF.md`](../../../foundation/GENERATION_BRIEF.md) §8. Every task below names
> its doneability, its close_time, and the card or loop that carries it. **Nothing here has
> run yet** — the agenda is a plan of record, not a progress report, and the department will
> not report a scheduled task as a moved number. Everything measured in this file was
> re-verified against the tree on **2026-08-28**; where a 2026-08-24 charter line is now
> stale it is corrected in §Findings, not by editing the charter.

## What

**The machinery is ahead of the substrate, and the reporting format hides which is which.**
That was true at founding and it is still true: four producing pipelines run, one auditor
exists on paper, and the department cannot state a single one of its five metrics from a
command. This agenda's spine is the seed ADR 0039 §8.3 set for us — *move the three-number
substrate report* — expanded into the three numbers that have never actually existed:

1. **A report that emits itself.** The 2026-08-24 charter session assembled the three L0
   numbers by hand. Nothing publishes them today (`data-agent-stack.md:109-113`).
2. **The demand-weighted coverage figure, published beside the library figure** — the true
   number next to the flattering one, permanently, never alone.
3. **A POS line-resolution rate.** The string `resolution_rate` occurs in **no file** under
   `supabase/ apps/ services/ scripts/ packages/` (grep, 2026-08-28). Rows land in
   `pos_unresolved_lines`; nothing has ever divided them.

Under those three sits the one invariant that makes the rest meaningful — `source_guarantee`
at intake — which is designed, load-bearing, and **absent from every file in the repo**
(grep, 2026-08-28).

## How

Six operating rules govern every task in this agenda. They are not preamble; a task that
breaks one is a failed task, not a partial one.

| Rule | Where it comes from | What it forbids |
|---|---|---|
| **Every number names its denominator** | [[data-charter]] §Metrics, [[data-premortem]] M1 | "wine coverage: N%" with nothing beside it |
| **Three numbers, never one** | [[data-loops]] loop 1, premortem M3 | Any scalar called "L0 progress" |
| **Fitness, not volume** | premortem M5 | Records enriched, rows ingested, documents generated as primary metrics |
| **The knob prints beside the dial** | premortem M4, [[data-directive]] | A quarantine rate published without its threshold value |
| **Author ≠ auditor** | `technology.md:32-34`, [[data-charter]] §Boundaries | A producing team grading its own output |
| **Provenance or rejection** | [[data-directive]] Rule 0 | A row admitted with no truth guarantee |

**Sequencing logic.** Movement 1 makes the department *legible* (a report that runs).
Movements 2–4 give the three producing corpora a true baseline each. Movement 5 builds the
gate that lets the auditor say no — deliberately last in build order and first in
consequence, because a gate written after the first milestone squeeze is a gate written
under pressure.

## Why now

- **The org runs 5 of 485 loops** (OD-46, re-measured 2026-08-27). All **31** loop rows
  belonging to this department read `status: proposed` (`00-index/loops.json`). A department
  with 31 diagrams and 0 loops is a design, not an operation.
- **The card layer executes now.** `scripts/agents/run_card.py:333-341` runs eight declared
  mechanical cards. Three of this department's five team cards are declared
  `routing_class: mechanical` — `substrate-auditor`, `gold-set-steward`, `synth-forge` — and
  **none of the eight is ours**. The distance between designed and running is one script each.
- **The enrichment run is live** and the denominator is therefore being chosen implicitly
  every day by whatever query picks the next batch
  (`…enrichment_demand_priority.sql:28-31`, `:80-95`).
- **The oracle is empty.** Measured 2026-08-28: `active_learning_service.py:30` points
  `BENCHMARK_DIR` at `datasets/annotated/menus`, `:399` sets `BENCHMARK_SIZE_TARGET = 200`,
  and both `datasets/annotated/menus/` and `datasets/annotated/invoices/` contain **only
  `.gitkeep`**. The benchmark manager loads **zero** documents in this tree. Every fidelity
  and accuracy claim downstream of it is currently unfalsifiable.
- **Two of our four corpora are not in the repo at all** — `datasets/annotation_inbox/`
  (`.gitignore:87`) and `datasets/sim/documents/` (`.gitignore:88-91`).

---

## The agenda — 21 tasks, five movements

Owner column names the team that closes the task. Every row cites the card or loop that
carries it; a row no card or loop could carry was moved to §Findings instead.

### Movement 1 — Make the three-number report a thing that runs

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **DAT-1** | Implement `substrate-auditor` as a declared script under `scripts/agents/`, in the ADR 0038 form, so the daily substrate report is **produced, not assembled** | substrate-quality-coverage | `run_card.py --agent substrate-auditor` returns wine · dish · sales each with a `denominator` key, `quarantine_rate` printed beside `confidence_threshold_value`, and `rows_without_source_guarantee` as an integer. **The run fails its own assertion if it emits a single L0 scalar.** | first green run **2026-09-11**, daily thereafter |
| **DAT-2** | Publish the zero state on day one | substrate-quality-coverage | The first report ships with `dish = 0` and `sales = not measured` visible on the board, and no hand-edit raises either | same day as DAT-1 |
| **DAT-3** | `data-l0-rollup` **reads** DAT-1's output rather than recomputing it | Department | Board rows carry values *and* denominators sourced from DAT-1's JSON; the rollup contains no arithmetic spanning two truth guarantees, asserted in code | weekly from **2026-09-18**; monthly agenda sync |
| **DAT-4** | Put the department's loops under the staleness watcher | Department | `python3 scripts/watch_loops.py` names all six department loops with their last close date; a loop past its close_time surfaces as a finding rather than as silence | **2026-09-25**, then continuous |

**Evidence.** `scripts/agents/run_card.py:333-341` (eight implemented cards, none in this
department); `substrate-auditor` declared `routing_class: mechanical` in
[`cards.json`](../../../00-index/cards.json) via [[substrate-quality-coverage-agent-stack]];
loop `substrate-progress-report` (daily, `proposed`) and [[data-loops]] loop 1, whose
one-producer/one-consumer split was settled by [ADR 0035](../../../decisions/0035-wave2-seam-reconciliation.md)
and is recorded at `data-agent-stack.md:103`. DAT-2 stands on `data-agent-stack.md:112-113`
("one live row and four honest 'not measured' rows"). DAT-4 stands on
`scripts/watch_loops.py:1-25` — which names **2026-10-23** as the day all 198 agenda files
hit the 60-day staleness rule at once; this rewrite moves this department's date to
**2026-10-27**, and DAT-4 is what stops that date from passing silently.

### Movement 2 — The corpus push, on the denominator that is true

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **DAT-5** | Publish **both** coverage figures from one query, permanently side by side | corpora-enrichment | One dated query returns `demand_weighted_coverage` and `library_coverage` with both denominators named; the board renders them adjacently and **the library figure never appears alone** | baseline **2026-09-04**, weekly thereafter |
| **DAT-6** | Four consecutive weeks of strictly demand-ordered batches — the push itself | corpora-enrichment | Four weekly rows; demand-weighted coverage moves by a stated delta on the menu-appearing denominator. If the two figures diverge for three close-times, **the queue is re-sorted, not the report** | weekly; review **2026-09-25** |
| **DAT-7** | Put a measured price on the corpus plan | corpora-enrichment | `python3 scripts/nf_readout.py` prints cost-per-completed-task for `wine_enrichment` with its sample size and window, **or the words INSUFFICIENT VOLUME**; the migration header's two-year arithmetic is re-derived from that number and dated | **2026-09-11**, weekly thereafter |
| **DAT-8** | Depth, not just presence — `corpora.field_confidence_median` per batch | corpora-enrichment | A median field-confidence figure printed beside every coverage figure; a batch whose median falls below its predecessor is reported, not smoothed | weekly from **2026-09-18** |

**Evidence.** `supabase/migrations/20260813170000_enrichment_demand_priority.sql:28-31` states
the arithmetic this movement exists to falsify — *top 30% by demand = 90,000 records / 2.0
years; top 15% = 45,000 / 1.0 year* — and `:80-95` computes `demand_score` from live
restaurant inventory. Card `enrichment-runner` already declares the daily demand-drawn batch
and the weekly re-sort; loops `enrichment-demand-reprioritization` and `enrichment-depth-cost`
(both weekly, `proposed`) carry DAT-6 and DAT-7/8. The cost path is live and readable today:
`services/agent-orchestrator/services/haiku_enrichment_service.py:265` emits
`task_type="wine_enrichment"`, `supabase/migrations/20260824153600_nf_a_readout.sql:102,109`
slices on `context->>'task_type'`, and `scripts/nf_readout.py:1-30` is the reader. DAT-8 stands
on `services/agent-orchestrator/services/field_confidence.py` and `governance.py:107,227`.

### Movement 3 — The oracle

> This movement outranks the other four in consequence. [[data-premortem]] M2 is the only
> mechanism the department cannot survive, and loops 3 and 6 both terminate here.

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **DAT-9** | Audit and publish the **true** gold-set size and freshness, per task type | annotation-ground-truth | `gold-set-steward` prints `annotation.gold_set_size` and `gold_set_freshness_days` per task type from tracked paths. **Today's expected answer is 0 documents, and it is published as 0** — not as "pilot" and not by pointing at an untracked directory | **2026-09-04**, weekly thereafter |
| **DAT-10** | Decide where the oracle lives | Department → `OPEN-DECISIONS.md` | A register row with owner and close-time choosing between tracked-in-repo / object store / Label Studio export, plus the rule that **no gold row exists outside it** | **2026-09-11** |
| **DAT-11** | One dated annotation sitting on the invoice family | annotation-ground-truth | `gold_set_freshness_days` resets to 0 for at least one task type and the new documents are tracked wherever DAT-10 lands | **2026-09-18**, monthly thereafter |

**Evidence.** Measured 2026-08-28: `services/agent-orchestrator/services/active_learning_service.py:30`
sets `BENCHMARK_DIR = datasets/annotated/menus`; `:399` sets `BENCHMARK_SIZE_TARGET = 200`;
`:405-419` loads `*.json` from that directory and both it and `datasets/annotated/invoices/`
hold **only `.gitkeep`**. The 200-document benchmark named in the service's own docstring
(`:9-10`) therefore loads zero documents, and `datasets/annotation_inbox/` — the four intake
channels the charter cites — is gitignored (`.gitignore:87`). The newest task file remains
`datasets/annotation_tasks/pilot_test_v2.json`, which the charter reads correctly as *one
round, run twice*. DAT-11 picks the invoice family because
`scripts/check_task_types_are_graded.py:84` exempts `invoice_extraction` with *"ground truth
exists but on a disjoint path that emits no NF row"* — an independent oracle is exactly the
thing this department can supply and nobody else can. Loop: `gold-set-freshness` (weekly).
**DAT-11 is founder-hours dependent** — see §Questions Q5.

### Movement 4 — Observed truth: the POS fitness baseline

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **DAT-12** | Compute `pos.line_resolution_rate` **for the first time** | pos-operational-telemetry-ingest | Per-restaurant rate plus `unresolved_queue_depth` with trend, printed **with `n`**; no fleet mean appears anywhere in the output; the worst restaurant is named. If `n` is small the report prints `n` and **refuses to call it a distribution** | **2026-09-11**, weekly thereafter |
| **DAT-13** | Drain the queue on a cadence and report what the drain **changed** | pos-operational-telemetry-ingest | Weekly drained count split rule-change vs. one-off fix; a week with 0 drained states why | weekly from **2026-09-11** |
| **DAT-14** | `sales.density` — the third L0 number gets a written definition and a first value | pos-operational-telemetry-ingest | Density defined once in writing (checks per open day × lines per check, per restaurant) and emitted weekly; analytics consumers receive it **beside** their baselines | definition **2026-09-11**, first value **2026-09-18**, weekly |
| **DAT-15** | Read `drift_findings` on a cadence — the one adapter we have is a third party's schema | pos-operational-telemetry-ingest | A provider step change produces a finding within one close-time; the weekly read is recorded even when it is empty | daily monitor / weekly read, from **2026-09-25** |

**Evidence.** Measured 2026-08-28: `resolution_rate` appears in **no** file under
`supabase/ apps/ services/ scripts/ packages/`. The write path exists —
`apps/api-gateway/src/toast/toast.service.ts:505` queues unresolved lines and
`apps/api-gateway/src/pos-hub/catalog-matcher.service.ts:57` documents the fall-through —
against tables created by
`supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`, whose
`drift_findings` (`:82`) is DAT-15's substrate. Nothing divides the two. Loops
`unresolved-queue-drain` and `sales-density-reporting` (weekly, `proposed`) carry these;
`apps/api-gateway/src/analytics/` (39 routes) is the consumer already fitting baselines on
the corpus DAT-14 measures. The POS charter's *"One provider. Toast is the only adapter
present"* is what makes DAT-15 a real risk rather than housekeeping.

### Movement 5 — Constructed truth, and a gate that can say no

| # | Task | Owner | Doneability | close_time |
|---|---|---|---|---|
| **DAT-16** | `source_guarantee` intake contract — **write the spec, file the DDL request** | Department → [[schema-migrations-charter]] | A merged spec naming the enum values, the tables, and the backfill rule for existing rows, plus a request row in schema-migrations' questions file. **Data authors no DDL** | **2026-09-11** |
| **DAT-17** | First provenance integrity audit, as an absolute count | substrate-quality-coverage | `substrate.rows_without_source_guarantee` printed as an integer the day the column exists; any value > 0 opens a register row the same day. Until then the row reads `BLOCKED-BY-DAT-16` — **never 0** | weekly from the column's landing |
| **DAT-18** | The threshold-change protocol, written **before** the first squeeze | substrate-quality-coverage | A one-page protocol (proposer / decider / recorder / where the value is published), the 2026-08-14 rescale retro-filed as its worked example, and every board line printing rate beside threshold | **2026-09-18**, monthly review |
| **DAT-19** | Gate efficacy — how many publishes did the gate **actually block**? | substrate-quality-coverage | A quarterly integer with the blocked rows attached. **If it is 0 for a full quarter, the charter's own merge reservation opens as a register row** rather than being argued | quarterly, first **2026-11-28** |
| **DAT-20** | First backtest fidelity number — or the blocker named in its place | synthetic-generation-simulation | A dated `synthetic.backtest_fidelity_gap` naming the gold-set size **and** the sim `pack_version` it was computed against. A run against an empty oracle **refuses and prints why** | monthly; first attempt **2026-10-02**, gated on DAT-9/DAT-11 |
| **DAT-21** | Degrade-profile coverage measured against real damage, not a list we wrote | synthetic-generation-simulation | `synthetic.degrade_profile_coverage` computed against real degraded documents; if none are available the number is **not computed** and the blocker is named | monthly from **2026-10-16** |

**Evidence.** `source_guarantee` appears in no file under `supabase/ services/ apps/ scripts/`
(grep, 2026-08-28); `data-agent-stack.md:102` names it the department's load-bearing invariant,
*designed and not built*, and [[data-charter]] §Boundaries puts DDL authorship outside this
department. DAT-18's worked example is in the tree:
`supabase/migrations/20260814000000_data_quality_rescale.sql:1-15` records a rule written
against a 195-row library flagging 104 rows at 2,443 — **a correct recalibration**, and a
complete in-repo rehearsal of the move that becomes premortem M4 the third or fourth time it
is made. DAT-19 exists because the `substrate-auditor` card's own `quality_bar` grades this
half **NONE (gap)** — no publish-block count has ever been measured — which is the precise
condition [[data-charter]] §"On five teams" says would justify merging the auditor away.
DAT-20 stands on `scripts/docgen/backtest.py` existing while no gap has ever been published,
and on `datasets/sim/manifest.json` (`pack_version 1.0.0`) with `datasets/sim/documents/`
gitignored (`.gitignore:88-91`) — the pack is derived data and must be regenerated from seed
before any number is quoted. Loops: `provenance-integrity-audit`, `threshold-change-review`,
`gate-efficacy-review`, `backtest-fidelity`, `degrade-profile-catalogue`.

---

## The three reaches — graded

ADR 0039 asked for ambition and for ambition to be graded. These are the department's reaches,
each with its honest grade.

**R1 — Zero to three running loops, and a 60% move in the org's activation metric.**
The org runs 5 of 485 loops (OD-46, re-measured 2026-08-27); this department contributes 31
rows, all `proposed`. Target: **three closing on cadence by 2026-10-02** — the substrate report
(daily), demand reprioritization (weekly), unresolved-queue drain (weekly). Three added to five
is the largest single-department move available anywhere in the corpus.
**Grade: achievable.** Its entire content is DAT-1, DAT-5 and DAT-12, and each is a script over
tables that already exist. No new decision is required to start.

**R2 — The provenance ledger: every L0 row provably carrying its truth guarantee, and every
eval filtering on it explicitly rather than by convention.**
This is the department's most valuable possible asset — a substrate that can *prove* what kind
of truth each row is, in a category where nobody else can.
**Grade: aspiration pending decisions we do not own.** The column is a request to
[[schema-migrations-charter]] (DAT-16); the eval-filter rule needs
[[agent-evaluation-gates-charter]] to adopt it. Scheduled here: the spec and the request.
Not scheduled here: the column, the backfill, or the eval rule — naming them as ours would be
the fiction this agenda is supposed to prevent.

**R3 — A measured corpus curve, replacing a two-year assumption.**
Coverage and cost-per-record published together, weekly, until the migration header's
*90,000 records / 2.0 years* becomes a curve with dated points instead of an estimate.
**Grade: achievable on the agent side today** — `nf_readout.py` already slices by `task_type`
and `wine_enrichment` is a live emitter. **Not scheduled here:** the joined spend view, which
is ADR 0039 **Track A2**'s deliverable (`api_spend` gains `task_type`). This department
consumes it the day it lands and schedules nothing that assumes its date.

---

## Findings — things no card and no loop can carry

Per §8.2: a task that no card or loop can carry is a finding, not a task. These are filed
rather than scheduled, and the ones implying a decision also belong in `OPEN-DECISIONS.md`.

| # | Finding | Why it is not a task |
|---|---|---|
| **F1** | **The oracle has no home.** `datasets/annotated/{invoices,menus}/` are tracked and hold only `.gitkeep`; `datasets/annotation_inbox/` is gitignored (`.gitignore:87`). The 200-document benchmark (`active_learning_service.py:9,399`) loads zero documents | Where the gold set lives is a decision with a cost, not an execution step — DAT-10 raises it; it cannot close it |
| **F2** | **`annotation.inbox_arrival` has no publisher** — no unit owns filling the inbox (card gap row, [[annotation-ground-truth-agent-stack]]) | A trigger with no publisher is not a loop; naming an owner is a founder allocation |
| **F3** | **`loop.close_time_breached` has no publisher.** `watch_loops.py` reports staleness; it emits no event (dept card §5 gap) | The department card declares the trigger; nothing can fire it. Bounded, not closed, by DAT-4 |
| **F4** | **`pos.restaurant_onboarded` has no publisher** — the first-week resolution gate is manual (POS card gap) | Onboarding events are not this department's surface |
| **F5** | **`annotation.inter_annotator_agreement` is unmeasurable at one annotator.** Recorded as a gap, never as a value | A second annotator is a hiring/allocation decision |
| **F6** | **OD-66 and OD-67 corrupt the volume signal this department computes on.** `toast.service.ts:520` still carries `?? "bottle"` and a voided glass returns a whole bottle — both feed `sales.density` and the demand queue | The code is [[integration-engineering-charter]]'s and the POS bridge's. Ours to depend on, not to fix — see §Seams |
| **F7** | **Stale-baseline correction.** `.claude/skills/` **now exists** with four skills (`fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`); the 2026-08-24 line in [[data-schedule]] and [[data-charter]] saying it does not exist is stale on that half. **Data still owns zero of the four** | Wave-3 rule: charters are not edited here. Recorded for the next charter pass |
| **F8** | **Two of the four corpora are not in the repo.** `datasets/annotation_inbox/` and `datasets/sim/documents/` are both gitignored. Any count over them is a count over one machine, not over the project | Changes to what is tracked are a repo-policy decision |

## Seams — cross-unit asks, addressed to their questions files

Per §8.4 a cross-unit need is an agenda task addressed to that unit's `questions.md`, never
an edit to their files. Five asks, each with what we owe them in return.

| Ask | Unit | The ask, precisely | We supply |
|---|---|---|---|
| `source_guarantee` DDL | [[schema-migrations-charter]] | The enum column and its backfill, per DAT-16's spec | The spec, the value set, the backfill rule, and the audit that uses it |
| Volume-contract defects | POS bridge · [[integration-engineering-charter]] | OD-66 / OD-67 corrupt sale volume, which is our demand-queue and `sales.density` input (F6) | The per-restaurant fitness report that would have surfaced them |
| `sim-namespace-integrity` | [[state-integrity-invariants-charter]] | The daily namespace assertion is theirs; synthetic's leak count is graded there, **never here** | Sim write sets and teardown references |
| `api_spend.task_type` | Track A2 — schema-migrations + aio-model-routing | The day it lands, DAT-7's number joins end to end | The agent-side cost slice, already readable |
| Judgment rubric #1 | Track A5 — research-math + [[agent-evaluation-gates-charter]] | The vendor-reply rubric is theirs | An independent oracle for the invoice family (DAT-11), which `check_task_types_are_graded.py:84` says does not exist today |

**One question, not an ask.** `scripts/check_task_types_are_graded.py:80-83` exempts
`field_extraction`, `vision_extraction`, `text_extraction` and `crawl_extraction` on
**causality** — the wine is the call's output, so there is no `wine_id` at call time. But
`services/agent-orchestrator/services/ontology_verdict.py:91-99` (`grade_wine_extractions`)
attaches a verdict to every gradable NF row for a wine **after** it exists. Is the exemption
still causally forced, or is it now a wiring question? Data owns the ontology
(`ontology_validation_service.py`); the verdict is [[agent-evaluation-gates-charter]]'s.
Filed to their questions file as a question, not a claim.

## Locks — what this agenda deliberately does not do

- **The pricing model is deferred (founder, re-confirmed 2026-08-28).** DAT-7 publishes
  cost-per-enriched-record. That is a **unit-economics input**, and nothing in this agenda
  proposes, implies, or assumes a price. No task here becomes correct only after an unlock.
- **Brand and landing visuals are held.** Not this department's surface. Sketch
  [054](../../../sketches/054-data-agenda-canvas/) is a throwaway thinking canvas under the
  sketch conventions — not a product visual, not brand work.
- **No open fork is resolved here.** TECH-F1, TECH-F5, OD-03/OD-52, OD-26, OD-46, OD-64,
  OD-66, OD-67 are referenced and left exactly as open as they were.

## Questions for the founder

Six carried from the founding agenda, updated with what has since been measured, plus one new
one that outranks them.

1. **NEW — where does the oracle live, and is it worth what it costs?** The gold set is
   **empty in this repo** (F1). Every accuracy and fidelity claim in the department is
   currently unfalsifiable. Three options: track it in-repo (cheap, small, visible in diffs),
   put it in an object store (scales, invisible to CI), or accept that the pilot is the
   practice and stop reporting anything that depends on an oracle. The third is an honourable
   answer; carrying the first two as intent is not.
2. **The dish corpus.** Is food genuinely in scope this cycle, or is the honest answer that
   Mudavym is a wine company first and dish identity is a v2 concern? Both are fine.
   *Carrying it as scope while never funding it is not.* `datasets/menu_corpus/` holds three
   entries (`README.md`, `enriched/`, `extracted/`) as of 2026-08-28. **A date, or a drop —
   by 2026-09-30**, per [[data-directive]] escalation trigger 6.
3. **The demand denominator.** Demand-weighted coverage will look **worse** than library
   coverage for a long time, possibly a year. Is that the number you want in front of an
   investor, given it is the true one? DAT-5 makes the choice permanent either way.
4. **Sales density.** The analytics engine is live on thin sales data today. Do we (a) keep
   shipping insights and label their confidence, (b) gate insights below a density threshold,
   or (c) accept the risk silently? **Option (c) is still in force by default.** DAT-14 gives
   (b) a number to gate on for the first time.
5. **Annotation is your time, and it is the binding constraint.** DAT-11 and therefore DAT-20
   both stall without it. How many hours per month is real? A number below 2 is an answer, and
   changes DAT-20's plan to "publish the blocker, permanently".
6. **The auditor's independence.** Can [[substrate-quality-coverage-charter]]'s quarantine gate
   actually block a publish, or is it advisory? DAT-19 turns this from an argument into a
   quarterly integer — and if that integer is 0, the charter says the team should be merged.
7. **TECH-F5** — 7 artifacts per team, or 3? This department alone is 45 documents under the
   current answer.

## How this agenda is checked

- **Board drift** — [[data-agenda-board]] is generated from the same rows; the monthly agenda
  sync in [[data-schedule]] compares them and states "no delta" out loud rather than silently.
- **Staleness** — `scripts/watch_loops.py` carries the 60-day rule. This file's date moves the
  department's staleness trip to **2026-10-27**; DAT-4 makes that a finding rather than a
  silent pass.
- **Anti-sprawl** — a scheduled job producing no action for three consecutive runs is
  downgraded or deleted ([[README]] §6). The daily substrate report is the most at-risk entry
  in the department and its downgrade path (daily → weekly → deleted) is automatic.
