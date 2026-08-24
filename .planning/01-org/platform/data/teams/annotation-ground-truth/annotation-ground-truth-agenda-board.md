---
type: agenda-board
division: platform
department: data
team: annotation-ground-truth
status: provisional
metrics: [annotation.gold_set_freshness_days, annotation.gold_set_size, annotation.inter_annotator_agreement]
updated: 2026-08-24
links: ["[[annotation-ground-truth-charter]]", "[[annotation-ground-truth-premortem]]", "[[annotation-ground-truth-agenda-full]]", "[[annotation-ground-truth-loops]]", "[[annotation-ground-truth-schedule]]", "[[data-agenda-board]]"]
---

# Annotation & Ground Truth — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## Who consumes this team's oracle

```dataview
TABLE WITHOUT ID
  file.link AS Unit, type AS Artifact, updated AS Updated
FROM "01-org"
WHERE department = this.department AND type = "loops" AND team != this.team
SORT file.name ASC
```

## Stale check — 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
```

## Freshness — the primary metric, per task type

- [ ] **invoices** — days since newest: unmeasured
- [ ] **menus** — days since newest: unmeasured
- [ ] **pdfs** — days since newest: unmeasured
- [ ] **screenshots** — days since newest: unmeasured
- [ ] Newest task file in repo: **`pilot_test_v2.json`** ← M1's clock is already running
- [ ] Alarm threshold: **30 days**, not 90

## Size and agreement

- [ ] `annotation.gold_set_size` per task type — no published baseline
- [ ] Benchmark: **200 gold-standard documents** (`active_learning_service.py:9`) — not frozen
- [ ] `annotation.inter_annotator_agreement` — **undefined**, one annotator (M3)
- [ ] Labelling guideline — **does not exist** for any task type

## Correction loop health

- [ ] `annotation.correction_to_rule_conversion_rate` — unmeasured
- [ ] Benchmark ∩ correction stream — **not asserted empty** (M4)
- [ ] Watch for monotonic benchmark improvement with no regressions — that is the tell

## Contamination guards

- [ ] No `source_guarantee` on gold rows yet
- [ ] Synthetic-share cap for real-accuracy claims — **not set** (M5)
- [ ] [[corpora-enrichment-charter]] write access to gold sets — **not yet revoked**
- [ ] Blind subset — not implemented (M2)

## Open

- [ ] Weekly quota not set — the highest-value open item
- [ ] Canary sets owed to [[corpora-enrichment-charter]] for 6 external sources
- [ ] Founder hours per month: unknown ([[annotation-ground-truth-agenda-full]] Q1)
