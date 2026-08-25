---
type: agenda-board
division: intelligence
department: analytics-bi
team: analytics-engine
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[analytics-engine-charter]]", "[[analytics-engine-agenda-full]]", "[[analytics-engine-premortem]]", "[[analytics-engine-loops]]", "[[analytics-engine-schedule]]", "[[analytics-bi-agenda-board]]"]
---

# Analytics Engine — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi/teams/analytics-engine"
SORT type ASC
```

## Where we sit against our siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/analytics-bi"
WHERE type = "charter"
SORT team ASC
```

## Our loops, and whether any lost its close-time

```dataview
LIST
FROM "01-org/intelligence/analytics-bi/teams/analytics-engine"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  updated AS "Last touched"
FROM "01-org/intelligence/analytics-bi/teams/analytics-engine"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `analytics.satisfiable_candidate_share` — **25.1%** (144 / 573, no POS) · 6.6% consumption-only
- [ ] `analytics.candidate_type_count` — **573** *(never publish alone)*
- [ ] `analytics.unclaimed_data_requirements` — **1** (`goals`, declared and claimed by nothing)
- [ ] `analytics.engine_service_test_ratio` — 149 cases / 3,679 engine lines · **0** spec files / ~5,600 service lines
- [ ] `analytics.false_discovery_estimate` — **unmeasured**; no multiple-comparison correction exists
- [ ] `analytics.engine_foreign_imports` — **0** (clean; guard not yet in CI)

## Reach ranked by unlock size — the data roadmap, as a number

| Blocking `DataRequirement` | Candidates it gates | Share of 573 |
|---|---|---|
| `checks` | 429 | **74.9%** |
| `tables` | 241 | 42.1% |
| `consumption` | 127 | 22.2% |
| `inventory` | 78 | 13.6% |
| `orders` | 33 | 5.8% |
| `venue` | 27 | 4.7% |
| `goals` | **0** | 0.0% ⚠️ declared, claimed by nothing |

## Red today

- [ ] `goals` `DataRequirement` unused → 22 goal-pace types over-report as satisfiable
- [ ] `pValue` / `chi2` asserted **nowhere**, while `pValue < 0.1` gates a published claim
- [ ] Five threshold literals unnamed and untested (`:200`, `:550`, `:867`, `:1017`, `:1107`)
- [ ] `insight-generator.service.ts` — 1,200 lines, no spec file
