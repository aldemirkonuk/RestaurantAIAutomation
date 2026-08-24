---
type: loops
division: platform
department: engineering
team: catalogue-identity
status: provisional
metrics: [identity.false_merge_count, identity.false_split_count, identity.producer_collapse_ratio]
updated: 2026-08-24
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-premortem]]", "[[catalogue-identity-directive]]", "[[engineering-loops]]", "[[dat-annotation-ground-truth]]", "[[LOOP-MAP]]"]
---

# Catalogue & Identity — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-CI-1 — Merge policy scoring

```yaml
type: loop
id: ci-merge-policy-scoring
owner: catalogue-identity
measures: [identity.false_merge_count, identity.false_split_count]
changes: [matcher.thresholds, merge.policy, ci.merge_gate]
inputs_from: [dat-annotation-ground-truth, dat-corpora-enrichment]
outputs_to: [engineering, dat-substrate-quality, decision-office]
close_time: per-PR
status: proposed
```

Runs on every PR touching `services/agent-orchestrator/services/wine_matcher.py`, the
match-key migrations, or merge SQL. **Fails on any false-merge increase**, independent of
split improvement. Two columns; no aggregate. Until the labelled set exists this loop
reports `unreadable` — explicitly, never by omission.

---

## L-CI-2 — Labelled-set coverage

```yaml
type: loop
id: ci-labelled-set-coverage
owner: catalogue-identity
measures: [identity.labelled_set_size, identity.labelled_set_class_coverage, identity.disputed_pairs_open]
changes: [identity.labelled_set, annotation.priorities]
inputs_from: [dat-annotation-ground-truth, dat-corpora-enrichment]
outputs_to: [catalogue-identity, engineering]
close_time: weekly
status: proposed
```

Counters premortem M2 directly. Coverage is measured **per class** — beverages, producers,
and later dishes — because a set that is dense on wines and empty on producers scores M4
as green. Disputed pairs awaiting an adjudicator ruling are a first-class number: they are
the bottleneck the whole team runs on.

---

## L-CI-3 — Producer collapse watch

```yaml
type: loop
id: ci-producer-collapse-watch
owner: catalogue-identity
measures: [identity.producer_collapse_ratio, identity.producer_false_merge_count, identity.producer_region_span_anomalies]
changes: [producer_normalization.rules, ontology_normalization.rules]
inputs_from: [dat-corpora-enrichment]
outputs_to: [engineering, dat-substrate-quality]
close_time: weekly
status: proposed
```

Counters premortem M4. Watches the collapse ratio (input variants ÷ output entities) and
flags producer entities whose wines span implausible regions or appellations. The
producer-reputation corpus at 100% menu coverage is the fixture source.

---

## L-CI-4 — Un-merge attribution audit

```yaml
type: loop
id: ci-unmerge-attribution-audit
owner: catalogue-identity
measures: [identity.unmerge_count, identity.unreassignable_derived_rows, nf_b.guest_signal_attribution_accuracy]
changes: [merge.undo_procedure, identity.data_loss_register]
inputs_from: [inventory-ledger, messaging-delivery, agent-fleet]
outputs_to: [engineering, architecture-review, decision-office]
close_time: per-event
status: proposed
```

Counters premortem M3. Fires on **every** un-merge, not a sample — the population is small
and each instance is irreversible. Output feeds [[engineering-loops]] L-ENG-4. A month
with zero un-merges is a valid recorded outcome.

---

## L-CI-5 — Guest identity boundary check

```yaml
type: loop
id: ci-guest-identity-boundary
owner: catalogue-identity
measures: [identity.guest_clusters_formed_on_name_similarity, identity.guest_slice_column_count]
changes: [guest_identity.schema, ci.guard_set]
inputs_from: [schema-migrations, compliance]
outputs_to: [compliance, security, engineering]
close_time: weekly
status: proposed
```

Counters premortem M5 and [[engineering-premortem]] M4 together. The grep guard
`scripts/check_no_guest_name_matching.sh` is the syntax side; this loop is the **outcome**
side — sample the clusters and assert none formed on name similarity. Green guard plus a
name-formed cluster is the alarm state, and only this loop can see it.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-CI-1 merge policy scoring | per-PR | M1 |
| L-CI-2 labelled-set coverage | weekly | M2 |
| L-CI-3 producer collapse watch | weekly | M4 |
| L-CI-4 un-merge attribution audit | per-event | M3 |
| L-CI-5 guest identity boundary | weekly | M5 |
