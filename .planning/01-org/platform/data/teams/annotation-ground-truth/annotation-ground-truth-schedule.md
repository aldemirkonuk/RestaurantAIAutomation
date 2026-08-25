---
type: schedule
division: platform
department: data
team: annotation-ground-truth
status: provisional
metrics: [annotation.gold_set_freshness_days, annotation.gold_set_size, annotation.correction_to_rule_conversion_rate]
updated: 2026-08-24
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-directive]]", "[[data-schedule]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Annotation & Ground Truth — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Weekly | **Standing annotation quota**, per task type — small enough to survive a bad week | New gold examples; resets the freshness clock |
| Weekly | Freshness report: days-since-newest per task type, alarm at **30** | `annotation.gold_set_freshness_days` |
| Weekly | Correction → rule pass (`active_learning_service.py`) with **benchmark intersection asserted empty** | `annotation.correction_to_rule_conversion_rate` |
| Weekly | Intake triage from `datasets/annotation_inbox/{classified,html_snapshots,pdfs,screenshots}/` | Task files in `datasets/annotation_tasks/` |
| Monthly | Blind-subset run + median seconds-per-document | `annotation.rubber_stamp_rate` |
| Monthly | Double-label 5% (intra-annotator while n=1) | `annotation.inter_annotator_agreement` |
| Monthly | Guideline update from resolved disagreements | Labelling guideline, per task type |
| Monthly | Canary-set top-up for [[corpora-enrichment-charter]]'s 6 external sources | Canary sets |
| Quarterly | Training-set assembly for Research & Math (`build_finetune_dataset.py`) | Versioned training set + its provenance manifest |
| Quarterly | **Scope review** — are all four task types still funded? | `OPEN-DECISIONS.md` |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. **The at-risk entry is the weekly quota, and it is at risk in the
opposite direction from everything else in this vault** — not because it produces no action,
but because it is the one job here that cannot be delegated to an agent and will therefore
lose every prioritization contest ([[annotation-ground-truth-premortem]] M1). Its failure
mode is silent skipping, so the freshness report exists specifically to make the skip
visible the following week.

## Skills owned

**None today.** `.claude/skills/` does not exist in this repo; the only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). Proposals below, against the
§3.3 protocol — trigger, doneability criteria, real past instance, owning department.

| Skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `annotation-task-prep` | T3 Operational | New documents land in `datasets/annotation_inbox/` | A task file exists in `datasets/annotation_tasks/` with per-document provenance and no duplicates against existing gold | `scripts/prepare_annotation_tasks.py`; produced `pilot_test.json` and `pilot_test_v2.json` |
| `gold-set-freshness-report` | T2 Department | Weekly, and before any accuracy claim is published | Days-since-newest emitted per task type; freshness debt attached to any shipped model/prompt change | The `pilot_test_v2.json` situation — the newest gold artifact in the repo, which is exactly the state the report exists to surface |
| `training-set-assembly` | T1 Domain | Research & Math requests a versioned training set | Set emitted with a provenance manifest — `source_guarantee` counts per row class, benchmark members excluded by ID | `scripts/build_finetune_dataset.py`, `training_data_store.py`, `dataset_ingestion_service.py` |
| `correction-rule-merge` | T3 Operational | A correction batch is ready in the active-learning stream | Rules merged only after benchmark validation **and** an asserted-empty intersection with the correction stream | `active_learning_service.py:14-17` — the loop is already implemented; the skill adds the partition assertion it lacks |

**Not proposed, deliberately:** an `auto-label` skill. `datasets/scripts/auto_annotate_subfields.py`
already does machine pre-labelling, and packaging it as a fire-and-forget skill would make
[[annotation-ground-truth-premortem]] M2 one keystroke cheaper. Pre-labelling stays a step
inside a human workflow, not a skill an agent can invoke on its own.

**Anti-sprawl:** a skill unfired for 30 days is reviewed for deletion ([[README]] §3.3),
by [[skill-lifecycle-anti-sprawl-charter]], not by this team.
