---
type: agenda-board
division: platform
department: data
status: active
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate, substrate.rows_without_source_guarantee, nf_a.cost_per_task]
updated: 2026-08-28
links: ["[[data-charter]]", "[[data-premortem]]", "[[data-agenda-full]]", "[[data-loops]]", "[[data-schedule]]", "[[data-directive]]", "[[data-agent-stack]]", "[[0039-activation-plan-of-record]]"]
---

# Data — Board

> **ACTIVE — dated 2026-08-28.** 21 tasks in [[data-agenda-full]], five movements, five teams.
> Every unchecked box below is a task that has **not** moved. A checked box means the
> doneability in the full agenda was met — never that the work was started.

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

## Movement 1 — the report that runs (close: 2026-09-11 → 2026-09-25)

- [ ] **DAT-1** `substrate-auditor` implemented as a declared script; a single-scalar run fails its own assertion — *daily, first green run 2026-09-11*
- [ ] **DAT-2** zero state published on day one: `dish = 0`, `sales = not measured` — *2026-09-11*
- [ ] **DAT-3** `data-l0-rollup` reads DAT-1 instead of recomputing; no arithmetic spans two truth guarantees — *weekly from 2026-09-18*
- [ ] **DAT-4** six department loops under `watch_loops.py`; a breached close_time is a finding, not silence — *2026-09-25*

## Movement 2 — the corpus push on the true denominator (close: 2026-09-04 → 2026-09-25)

- [ ] **DAT-5** both coverage figures from one query, side by side, permanently — *baseline 2026-09-04, weekly*
- [ ] **DAT-6** four consecutive demand-ordered weeks; on divergence the **queue** is re-sorted, not the report — *review 2026-09-25*
- [ ] **DAT-7** cost-per-enriched-record printed with sample size, or INSUFFICIENT VOLUME — *2026-09-11, weekly*
- [ ] **DAT-8** `field_confidence_median` beside every coverage figure — *weekly from 2026-09-18*

## Movement 3 — the oracle (close: 2026-09-04 → 2026-09-18)

- [ ] **DAT-9** true gold-set size and freshness published per task type — **expected answer today: 0** — *2026-09-04, weekly*
- [ ] **DAT-10** register row: where the oracle lives, with owner and close-time — *2026-09-11*
- [ ] **DAT-11** one dated annotation sitting on the invoice family; freshness resets to 0 — *2026-09-18, monthly*

## Movement 4 — observed truth: POS fitness (close: 2026-09-11 → 2026-09-25)

- [ ] **DAT-12** `pos.line_resolution_rate` computed for the first time — per restaurant, with `n`, **no fleet mean** — *2026-09-11, weekly*
- [ ] **DAT-13** weekly drain split rule-change vs one-off; a zero week states why — *weekly from 2026-09-11*
- [ ] **DAT-14** `sales.density` defined in writing, then emitted — *definition 2026-09-11, first value 2026-09-18*
- [ ] **DAT-15** `drift_findings` read on a cadence; an empty read is still recorded — *from 2026-09-25*

## Movement 5 — constructed truth and the gate (close: 2026-09-11 → 2026-11-28)

- [ ] **DAT-16** `source_guarantee` spec written, DDL request filed with schema-migrations — *2026-09-11*
- [ ] **DAT-17** provenance audit as an absolute count; reads `BLOCKED-BY-DAT-16`, never `0` — *weekly once the column lands*
- [ ] **DAT-18** threshold-change protocol written before the first squeeze; 2026-08-14 rescale retro-filed — *2026-09-18*
- [ ] **DAT-19** gate efficacy: publishes actually blocked. A 0 quarter opens the merge reservation — *quarterly, first 2026-11-28*
- [ ] **DAT-20** first fidelity gap, naming gold-set size **and** sim `pack_version` — or the blocker — *first attempt 2026-10-02*
- [ ] **DAT-21** degrade-profile coverage against real damage, or the blocker named — *monthly from 2026-10-16*

## The three L0 numbers — never reported as one

- [ ] `wine.demand_weighted_coverage` — **denominator: wines on customer menus**, not library (DAT-5)
- [ ] `dish.coverage` — unmeasured; identity deferred (`b728d25`). Date or drop by **2026-09-30** (Q2)
- [ ] `sales.density` — PARTIAL; pipes exist, corpus does not (DAT-14)

## Producer metrics

- [ ] `corpora.demand_weighted_coverage` — baseline 144/1,448 is on the **wrong** denominator
- [ ] `corpora.field_confidence_median` — depth, not presence (DAT-8)
- [ ] `annotation.gold_set_size` / `_freshness_days` — **0 tracked documents measured 2026-08-28** (DAT-9)
- [ ] `synthetic.backtest_fidelity_gap` — no baseline ever taken (DAT-20)
- [ ] `pos.line_resolution_rate` — per restaurant, min and distribution, **never mean** (DAT-12)
- [ ] `nf_a.cost_per_task` for `wine_enrichment` — readable today, unread (DAT-7)

## Auditor metrics — always shown with the knob

- [ ] `substrate.quarantine_rate` — printed beside the threshold value that produced it (DAT-18)
- [ ] `substrate.rows_without_source_guarantee` — **absolute count**, and blocked until the column exists (DAT-16/17)
- [ ] `substrate.gate_efficacy` — publishes blocked per quarter; never measured (DAT-19)

## Findings — filed, not scheduled

- [ ] **F1** the oracle has no home (`.gitkeep`-only corpora; benchmark loads 0)
- [ ] **F2** `annotation.inbox_arrival` has no publisher
- [ ] **F3** `loop.close_time_breached` has no publisher
- [ ] **F4** `pos.restaurant_onboarded` has no publisher
- [ ] **F5** inter-annotator agreement unmeasurable at one annotator
- [ ] **F6** OD-66 / OD-67 corrupt the volume signal we compute on — not ours to fix
- [ ] **F7** `.claude/skills/` now exists (4 skills); Data owns **zero** of them
- [ ] **F8** two of four corpora are gitignored and not in the repo

## Open forks and locks

- [ ] TECH-F1 · TECH-F5 open against this department
- [ ] OD-46 — 31 of this department's loop rows read `proposed`; **0 run**
- [ ] 🔒 Pricing model deferred — DAT-7 publishes a cost **input**, never a price
- [ ] 🔒 Brand/landing visuals held — sketch 054 is a thinking canvas, not brand work
