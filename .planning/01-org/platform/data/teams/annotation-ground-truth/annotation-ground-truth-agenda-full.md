---
type: agenda-full
division: platform
department: data
team: annotation-ground-truth
status: provisional
metrics: [annotation.gold_set_freshness_days, annotation.gold_set_size, annotation.inter_annotator_agreement]
updated: 2026-08-24
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-premortem]]", "[[annotation-ground-truth-agenda-board]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-directive]]", "[[annotation-ground-truth-schedule]]", "[[data-agenda-full]]", "[[corpora-enrichment-charter]]", "[[synthetic-generation-simulation-charter]]", "[[research-math-charter]]"]
---

# Annotation & Ground Truth — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The tooling is stood up;
> the *operation* is a pilot. Nothing below is decided.

## What

Produce and maintain the **oracle** — small, expensive, human-verified truth, per task type,
kept **fresh**.

Four task types are visible in the repo today: invoices, menus, PDFs, screenshots
(`datasets/annotation_tasks/`, `datasets/annotated/`). Each needs its own gold set, its own
freshness clock, and its own labelling guideline. Only the first of those three exists.

## How

**Freshness over size.** The primary metric is days-since-newest, per task type
([[annotation-ground-truth-charter]]). A large stale set is more dangerous than a small
fresh one because it inspires unearned confidence. This ordering is the counter to
[[annotation-ground-truth-premortem]] M1 and it is deliberately uncomfortable — it means a
big historical corpus does not let you stop.

**A small standing quota, not heroic batches.** A quarterly labelling session is a session
that gets cancelled. N documents per week that survive a busy week is worth more than 10N
that happen twice.

**Pre-label, then verify — with a blind subset to prove verification is happening.**
`auto_annotate_subfields.py` is a legitimate accelerator. The blind subset is what stops it
becoming a rubber stamp (M2).

**Hard-partition the benchmark.** The 200-document regression set
(`active_learning_service.py:9`) is frozen and excluded from the correction stream by ID,
with the intersection asserted empty on every run. Asserted, not reviewed (M4).

**Never mix guarantees.** Synthetic labels are free and perfect and are not gold
(M5). Enriched rows are confident and are not gold (M3 of
[[corpora-enrichment-premortem]]). Both are enforced as write permissions, not norms
([[data-directive]]).

## Why now

- **`pilot_test_v2.json` is the newest task file in the repo.** The clock on M1 is already
  running; this is not a hypothetical.
- **Two other teams depend on a live gold set to detect their own failures** —
  [[corpora-enrichment-loops]] canaries and
  [[synthetic-generation-simulation-loops]] backtest fidelity. Stalling here blinds them
  silently.
- **The correction loop is already built** (`active_learning_service.py`). A built loop with
  no partition discipline is more dangerous than no loop, because it produces monotone
  improvement charts.
- **Model training is happening elsewhere** (`training/train_*_scanner.py`, Research & Math).
  Those trainings consume sets this team assembles. Assembly discipline is upstream of
  someone else's model quality.

## Next steps

| # | Move | Blocks | Notes |
|---|---|---|---|
| 1 | Set a weekly quota per task type — small enough to survive a bad week | M1 | The single highest-value item on this page |
| 2 | Start the freshness clock: publish days-since-newest per task type | M1 | Reporting change; costs an hour |
| 3 | Write the labelling guideline, one per task type | M3 | Writing it *is* how the judgement calls surface |
| 4 | Introduce a blind subset and log per-document time | M2 | Detects rubber-stamping from the inside |
| 5 | Freeze the 200-doc benchmark; assert empty intersection with corrections every run | M4 | Assertion, not review |
| 6 | Set the synthetic-share cap for any set used to claim real accuracy | M5 | The cap must exist **before** the pressure |
| 7 | Double-label 5% (intra-annotator if there is one person) to get a real agreement number | M3 | Turns an undefined metric into a measured one |
| 8 | Supply canary sets to [[corpora-enrichment-charter]] for its 6 external sources | Their M4 | Small, high-leverage, mostly reuses existing gold |

## Questions for the founder

1. **How many hours per month are real?** This is the only question on this page that
   matters. Annotation is the one task in this department no agent can do for you, and
   [[annotation-ground-truth-premortem]] M1 is a resource decision, not a discipline problem.
   A truthful "two hours" produces a better plan than an aspirational "a day a week".
2. **Which task types are actually in scope?** Four exist in the repo. Four gold sets, four
   guidelines and four freshness clocks is four times the cost. Two well-maintained beats
   four stale.
3. **Second annotator: hire, contract, or accept n=1?** Accepting n=1 is legitimate at this
   stage *if it is a decision* — M3 is what happens when it is merely a circumstance.
4. **Is there an existing labelling guideline anywhere**, even informal? If the conventions
   live only in your head, that is the finding, and writing them down is step one.
