---
type: agenda-board
division: platform
department: data
status: provisional
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate]
updated: 2026-08-24
links: ["[[data-charter]]", "[[data-premortem]]", "[[data-agenda-full]]", "[[data-loops]]", "[[data-schedule]]", "[[data-directive]]"]
---

# Data — Board

> **PROVISIONAL — no work done yet.**

## Unit health — live query, not a hand-written list

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, team AS Team, status AS Status, updated AS Updated
FROM "01-org"
WHERE department = this.department
SORT team ASC, type ASC
```

## Charters and their evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Unit, status AS Evidence, updated AS Updated
FROM "01-org"
WHERE department = this.department AND type = "charter"
SORT status ASC
```

## Stale — anything untouched for 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE department = this.department AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The three L0 numbers — never reported as one

- [ ] `wine.demand_weighted_coverage` — **denominator: wines on customer menus**, not library
- [ ] `dish.coverage` — currently unmeasured; identity deferred (`b728d25`)
- [ ] `sales.density` — PARTIAL; pipes exist, corpus does not

## Producer metrics

- [ ] `corpora.demand_weighted_coverage` — baseline 144/1,448 on the **wrong** denominator
- [ ] `annotation.gold_set_freshness_days` — newest set is `pilot_test_v2.json`
- [ ] `synthetic.backtest_fidelity_gap` — no baseline taken yet
- [ ] `pos.line_resolution_rate` — per restaurant, **min and distribution**, never mean

## Auditor metrics — always shown with the knob

- [ ] `substrate.quarantine_rate` — reported beside the threshold value that produced it
- [ ] `substrate.rows_without_source_guarantee` — **absolute count**, not a rate

## Open

- [ ] Provenance field not yet in the intake contract ([[data-premortem]] M2)
- [ ] POS unresolved queue has no named owner ([[data-premortem]] M5)
- [ ] Dish-identity deferral has no date ([[data-premortem]] M3)
- [ ] Threshold-change protocol not written ([[data-premortem]] M4)
- [ ] Department owns **zero** skills; `.claude/skills/` does not exist ([[data-schedule]])
- [ ] TECH-F1 · TECH-F5 open against this department
