---
type: charter
division: platform
department: data
team: annotation-ground-truth
status: exists
metrics: [annotation.gold_set_size, annotation.gold_set_freshness_days, annotation.inter_annotator_agreement, annotation.correction_to_rule_conversion_rate]
updated: 2026-08-24
links: ["[[annotation-ground-truth-premortem]]", "[[annotation-ground-truth-agenda-full]]", "[[annotation-ground-truth-agenda-board]]", "[[annotation-ground-truth-directive]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-schedule]]", "[[data-charter]]", "[[corpora-enrichment-charter]]", "[[synthetic-generation-simulation-charter]]", "[[substrate-quality-coverage-charter]]", "[[research-math-charter]]", "[[agent-evaluation-gates-charter]]", "[[technology]]", "[[README]]"]
---

# Annotation & Ground Truth — Charter

Parent: **Data** ([[data-charter]]), division **Platform**. Team §5.2 in
`.planning/foundation/teams/technology.md:591`.

## Mandate

This team owns **human-verified truth: labelling operations, inter-annotator agreement, the
gold sets, and the assembly of training sets from them** (`technology.md:593-594`). It is
the smallest producer in the department by volume and the most load-bearing by consequence:
every accuracy number the company will ever quote is measured against something this team
made.

## Why it is distinct from its siblings

It produces **the oracle**. [[corpora-enrichment-charter]] produces machine guesses at
scale; this team produces small, expensive, human-verified truth — *and the two must never
be mixed, because enrichment output used as its own eval set makes every accuracy number
meaningless* (`technology.md:596-599`).

That is not a stylistic preference, it is the reason the two teams exist separately. A gold
set contaminated by enrichment output does not fail loudly: **scores go up**. There is no
alarm for a quarter that looks good.

## Boundaries

Owns outright:

- **Labelling operations** — `scripts/prepare_annotation_tasks.py`,
  `scripts/start_label_studio.sh`, `scripts/test_label_studio.sh`,
  `docker/label-studio/docker-compose.yml`.
- **The task definitions and the annotated corpus** —
  `datasets/annotation_tasks/{pdfs,pilot_test,pilot_test_v2,screenshots}.json`;
  `datasets/annotated/{invoices,menus}/`;
  `datasets/annotation_inbox/{classified,html_snapshots,pdfs,screenshots}/`.
- **Semi-automated labelling** — `datasets/scripts/auto_annotate_subfields.py`,
  `datasets/scripts/convert_labels.py`. *Semi*: machine pre-labelling is allowed as a
  time-saver, and a pre-label a human never looked at is not gold. The distinction lives in
  [[annotation-ground-truth-directive]].
- **Training-set assembly** — `scripts/build_finetune_dataset.py`,
  `services/agent-orchestrator/services/training_data_store.py`,
  `services/agent-orchestrator/services/dataset_ingestion_service.py`.
- **The correction loop** — `services/agent-orchestrator/services/active_learning_service.py:14-17`:
  *dev review correction → accuracy tracker → rule learner proposes patterns → benchmark
  validates → if improvement, merged into parser*.
- **Gold-set membership** — exclusively. No sibling team may write here
  ([[data-directive]]).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| **Training the model** — `training/train_{invoice,label,menu}_scanner.py` | Research & Math *(Intelligence)* | We assemble training sets; they fit models. Stated explicitly at `technology.md:613-616` |
| Producing facts at volume | [[corpora-enrichment-charter]] | We verify; they guess |
| Generating labelled data cheaply | [[synthetic-generation-simulation-charter]] | Their labels are *constructed*; ours are *observed by a human*. Both are valid; neither substitutes |
| Grading data rows for publication | [[substrate-quality-coverage-charter]] | They gate the substrate; we supply the truth they gate against |
| Grading **agent tasks** | [[agent-evaluation-gates-charter]] | Task outcome ≠ document label (`technology.md:862`) |
| Deciding *what* a good extraction is, methodologically | Research & Math *(Intelligence)* | They define doneability; we operate the labelling |

## Metrics it moves

**Primary: `annotation.gold_set_size` and `annotation.gold_set_freshness_days`, per task
type** — annotated examples, and days since the newest one (`technology.md:617-619`).
*A gold set that stops growing stops detecting drift.* Freshness is the sharper of the two:
a large stale set is more dangerous than a small fresh one, because it inspires confidence
it has not earned.

Secondary:

- `annotation.inter_annotator_agreement` — currently unmeasurable; there is one annotator.
  Recorded as a known gap rather than a metric with a value.
- `annotation.correction_to_rule_conversion_rate` — corrections that became a learned rule
  via `active_learning_service.py`, versus corrections that were applied once and forgotten.
  A correction loop that does not convert is a data-entry job.
- `annotation.benchmark_size` — the 200-document gold-standard regression set named at
  `active_learning_service.py:9`.

**Neural-footprint tie.** This team is the **denominator of `nf_a`'s doneability verdict**
([[README]] §4.2). An agent's "success" is only meaningful against a set this team
produced. If freshness decays, NF-A keeps emitting confident verdicts against an oracle
that no longer describes the world — the metric spine stays green while it loses contact
with reality.

## Evidence today

**EXISTS.** Sources `technology.md:601-611`, re-verified 2026-08-24.

- Task definitions present: `datasets/annotation_tasks/pdfs.json`, `pilot_test.json`,
  `pilot_test_v2.json`, `screenshots.json`
- Annotated corpus present: `datasets/annotated/invoices/`, `datasets/annotated/menus/`
- Inbox present with four intake channels: `datasets/annotation_inbox/{classified,html_snapshots,pdfs,screenshots}/`
- Tooling present: `scripts/prepare_annotation_tasks.py`, `scripts/start_label_studio.sh`,
  `scripts/test_label_studio.sh`, `docker/label-studio/docker-compose.yml`
- Label utilities present: `datasets/scripts/auto_annotate_subfields.py`, `convert_labels.py`
- Assembly present: `scripts/build_finetune_dataset.py`,
  `services/agent-orchestrator/services/{training_data_store,dataset_ingestion_service}.py`
- Correction loop present and documented in its own header:
  `services/agent-orchestrator/services/active_learning_service.py:1-17`
- Benchmark corpus referenced: 200 gold-standard documents (`active_learning_service.py:9`)

**Where the evidence is thin — say it plainly.** The tooling is real; the *operation* is a
pilot. The newest task file in the repo is `pilot_test_v2.json`, and its name is the honest
summary of the state: **one round, run twice**. There is no annotation cadence, no second
annotator, and therefore no agreement measurement. This team is graded EXISTS on its
artifacts and would be graded PARTIAL on its practice — the distinction is
[[annotation-ground-truth-premortem]] M1 and is the single most important thing on this
page.
