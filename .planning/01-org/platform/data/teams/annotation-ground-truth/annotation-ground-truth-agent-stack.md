---
type: agent-stack
division: platform
department: data
team: annotation-ground-truth
status: designed
updated: 2026-08-27
metrics: [annotation.gold_set_size, annotation.gold_set_freshness_days, annotation.inter_annotator_agreement, annotation.correction_to_rule_conversion_rate]
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-schedule]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-directive]]", "[[annotation-ground-truth-premortem]]", "[[0034-agent-stack-artifact]]", "[[data-agent-stack]]", "[[synthetic-generation-simulation-agent-stack]]", "[[skills-charter]]"]
---

# Annotation & Ground Truth — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The most constrained card in this department, for a structural reason: **the work this team
> exists to do cannot be delegated to an agent.** A human looking at a document *is* the
> product. Everything an agent may do here is preparation, bookkeeping and alarm-raising —
> and the boundary is load-bearing, because an agent that helps a little too much turns the
> oracle into a mirror ([[annotation-ground-truth-premortem]] M2).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `gold-set-steward` | Prepare labelling tasks, assert every candidate against existing gold, and keep the freshness clock visible — without ever deciding what a label says | NEW |

One row, and the roster is capped at one on purpose: a second agent here would inevitably be a
labeller. Machine pre-labelling stays a step **inside** a human workflow
([[annotation-ground-truth-directive]]), not a role with a card.

## 2. Agent cards

```yaml
agent: gold-set-steward
unit: annotation-ground-truth
triggers:
  - schedule: "weekly — intake triage, freshness report, quota reminder"   # mirrored in [[annotation-ground-truth-schedule]]
  - schedule: "monthly — blind-subset draw, 5% double-label draw, canary top-up"
  - topic: annotation.inbox_arrival        # publisher: NONE (gap — no unit owns filling the inbox)
consumes:
  - "`datasets/annotation_inbox/{classified,html_snapshots,pdfs,screenshots}/` — publisher: NONE (gap, see §5)"
  - "existing gold — `datasets/annotated/{invoices,menus}/`, `datasets/annotation_tasks/*.json` (self-published)"
  - "the 200-document benchmark set referenced at `active_learning_service.py:9`"
emits:
  - "task files in `datasets/annotation_tasks/` — consumer: the human annotator (no agent, deliberately)"
  - "`annotation.gold_set_freshness_days` per task type — consumers: [[data-agent-stack|data-l0-rollup]] and [[synthetic-generation-simulation-agent-stack|synth-forge]], whose fidelity number is void against a stale oracle"
  - "canary sets — consumer: [[corpora-enrichment-charter]] (designed; the consuming skill is dropped as speculative)"
  - "versioned training sets + provenance manifest — consumer: Research & Math (`technology.md:613-616`)"
  - nf_a events (task_type: annotation_task_prep)
routing_class: mechanical        # dedupe, draw, count days — every judgment call in this unit belongs to a human
quality_bar: "two mechanical assertions: no candidate intersects existing gold by ID, and days-since-newest is emitted per task type with the 30-day alarm. Label quality itself: NONE (gap) — `annotation.inter_annotator_agreement` is unmeasurable at n=1 annotator ([[annotation-ground-truth-charter]] §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: annotation-ground-truth
escalates_to: "[[data-charter]]"
```

**The card's own hard rule:** `gold-set-steward` never writes a label and never marks a
pre-label reviewed. Gold-set membership is this team's exclusively ([[data-directive]]), and the
one path that must stay expensive is the one where a machine-generated row becomes an oracle row
([[annotation-ground-truth-premortem]] M5).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `annotation-task-prep` | T3 | New documents land in `datasets/annotation_inbox/` | A task file exists in `datasets/annotation_tasks/` with per-document provenance and **no duplicates against existing gold**, asserted by ID | `scripts/prepare_annotation_tasks.py` produced `datasets/annotation_tasks/pilot_test.json` and `pilot_test_v2.json` — both in the repo | NEW |
| `gold-set-freshness-report` | T2 | Weekly, and before any accuracy claim is published | Days-since-newest emitted per task type; freshness debt attached to any shipped model or prompt change | The 2026-08-24 charter session established freshness by hand and found the newest gold artifact in the repo is `pilot_test_v2.json` — *one round, run twice* ([[annotation-ground-truth-charter]] §Evidence) | NEW |

**Two rows from [[annotation-ground-truth-schedule]] are held back, not forgotten.**
`training-set-assembly` and `correction-rule-merge` cite *tooling that exists*
(`scripts/build_finetune_dataset.py`, `training_data_store.py`, `dataset_ingestion_service.py`;
`active_learning_service.py:14-17`) rather than a procedure this team has completed — no
versioned training set and no converted correction batch is recorded in the vault. Under §3.3
rule 3 that is not a row yet; the qualifying event is one completed run, not a decision.

**Deliberately never proposed: `auto-label`.** `datasets/scripts/auto_annotate_subfields.py`
already does machine pre-labelling; packaging it as a skill an agent can fire makes
[[annotation-ground-truth-premortem]] M2 one keystroke cheaper.

Consumed, owned elsewhere: [[skills-charter]]; doneability methodology → Research & Math.

## 4. Memory

- **Procedural** — the two §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: annotation_task_prep`. Needs `context.task_type_name`
  (pdfs · screenshots · invoices · menus) and `context.gold_intersection_asserted` as jsonb
  keys: the second is the only machine-checkable trace that contamination was tested for.
  Human labelling itself emits nothing to NF-A and should not — a human hour is not an agent task.
- **Semantic** — `memory/` beside this file, `annotation-ground-truth-MEMORY.md` as index.
  Founding facts: the pilot-vs-practice split (EXISTS on artifacts, PARTIAL on operation), the
  n=1 annotator gap, and per-task-type labelling conventions as disagreements resolve them.
  Provenance frontmatter per ADR 0034; every write a PR — which matters more here than anywhere
  else in the department, because a labelling convention that changes silently retroactively
  redefines every score ever measured against it.
- **Working** — this card, the MEMORY index, charter §Mandate, and the current task type's
  guideline. The annotated corpus is a retrieval target by ID, never preloaded.

**Consolidation** — monthly, mirrored in [[annotation-ground-truth-schedule]]'s guideline-update
slot: read the month's prep runs and resolved disagreements; **failures first** — a skipped
weekly quota becomes a fact naming *why it lost the prioritization contest*, since silent
skipping is M1's mechanism; expire facts unverified for 90 days; propose skill candidates. One
PR; "no delta" stated when true.

## 5. Async contract

Loops ([[annotation-ground-truth-loops]]: `gold-set-freshness`, `active-learning-correction`,
`blind-subset-agreement`, `annotator-agreement`, `canary-set-supply`), NF-A events, vault PRs.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `datasets/annotation_inbox/` has no named publisher | Two teams consume it — this one and [[corpora-enrichment-charter]]'s menu extraction — and no unit in the vault owns filling it. The weekly triage bounds the delay, not the emptiness |
| `annotation.inter_annotator_agreement` has no second annotator | The metric is declared and structurally unmeasurable; the monthly 5% double-label is an intra-annotator proxy, and calling it agreement would be [[annotation-ground-truth-premortem]] M3 |
| The canary-set consumer is designed only | This team commits to the monthly top-up; [[corpora-enrichment-agent-stack]] drops the consuming skill as speculative. Supply exists, demand is on paper |
| Downstream verdict coverage depends on this unit and nothing enforces it | This team is the denominator of NF-A's doneability verdict ([[README]] §4.2); if freshness decays, verdicts stay green against an oracle that stopped describing the world |

## 6. Evidence today

- **EXISTS — the tooling and the corpus.** `scripts/{prepare_annotation_tasks,start_label_studio,test_label_studio}.sh|.py`,
  `docker/label-studio/docker-compose.yml`, `datasets/annotated/{invoices,menus}/`,
  `datasets/annotation_tasks/{pdfs,pilot_test,pilot_test_v2,screenshots}.json`,
  `datasets/scripts/{auto_annotate_subfields,convert_labels}.py`, `active_learning_service.py:1-17`
  with its 200-document benchmark at `:9`.
- **PARTIAL — the practice.** The charter grades this team EXISTS on artifacts and PARTIAL on
  operation: no cadence, no second annotator, no agreement measurement.
- **NEW — the steward, both skills, and all four memory layers.** Nothing here runs today.
