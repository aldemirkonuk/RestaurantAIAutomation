---
type: agenda-board
division: intelligence
department: analytics-bi
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[analytics-bi-charter]]", "[[analytics-bi-agenda-full]]", "[[analytics-bi-premortem]]", "[[analytics-bi-loops]]", "[[analytics-bi-schedule]]", "[[analytics-bi-directive]]"]
---

# Analytics & BI — Board

> **PROVISIONAL — no work done yet.**

## Every Analytics & BI artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/analytics-bi"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/analytics-bi"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Blocked loops — anything waiting on a unit we do not control

```dataview
LIST
FROM "01-org/intelligence/analytics-bi"
WHERE type = "loops" AND contains(file.content, "status: blocked")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/intelligence/analytics-bi"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Division-wide view — how we compare to our siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Department,
  default(team, "— dept —") AS Unit,
  status AS Evidence
FROM "01-org/intelligence"
WHERE type = "charter"
SORT department ASC, status ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `analytics.satisfiable_candidate_share` — **25.1%** (144 / 573 without POS; 6.6% consumption-only)
- [ ] `analytics.candidate_type_count` — **573** *(never publish without the line above)*
- [ ] `analytics.metric_claim_divergence_count` — **≥ 2** (insight types 375 vs 573; features 460 vs 360)
- [ ] `analytics.insight_acceptance_rate` — **unmeasured**; both tables exist, no join
- [ ] `analytics.top_rank_ignore_rate` — **unmeasured**; `position = 1` and never acted on
- [ ] `analytics.kpi_ground_truth_agreement` — **0%**, blocked on §44.7 SimPOS
- [ ] `analytics.engine_service_test_ratio` — **149 cases / 3,679 engine lines · 0 cases / ~5,600 service lines**
- [ ] `analytics.registry_coverage_share` — **33 registry keys** vs 460 catalogued features
- [ ] `analytics.consultant_enabled_restaurants` — **unlisted**; no expiry mechanism exists
- [ ] `analytics.claims_without_provenance` — **unmeasured**; register does not exist yet

## Live exposures we do not own but refuse to stand on

- [x] ~~**OD-20** — 39 routes on `analytics.controller.ts`, zero `@UseGuards`, zero
      `@Public`. Includes the consultant toggle (`:516`) and the Opus consult call
      (`:531`).~~ **RESOLVED 2026-08-25** — class-level `@UseGuards(JwtAuthGuard)` at
      `analytics.controller.ts:51`. Owner: [[security-charter]] / [[platform-api-charter]]
- [ ] **§44.7 SimPOS** — blocks `analytics.kpi_ground_truth_agreement`. Owner:
      [[engineering-charter]]
- [ ] **INTEL-F3** — no `subject_type` for the restaurant operator; blocks
      `analytics.insight_acceptance_rate` from the neural footprint. Owner:
      [[decision-office-charter]] / OD-11
