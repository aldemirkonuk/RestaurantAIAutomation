---
type: agenda-board
division: intelligence
department: analytics-bi
team: insight-narrative-generation
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[insight-narrative-generation-charter]]", "[[insight-narrative-generation-agenda-full]]", "[[insight-narrative-generation-premortem]]", "[[insight-narrative-generation-loops]]", "[[insight-narrative-generation-schedule]]", "[[analytics-bi-agenda-board]]"]
---

# Insight & Narrative Generation — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi/teams/insight-narrative-generation"
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
FROM "01-org/intelligence/analytics-bi/teams/insight-narrative-generation"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  updated AS "Last touched"
FROM "01-org/intelligence/analytics-bi/teams/insight-narrative-generation"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `analytics.insight_acceptance_rate` — **unmeasured**; join not yet defined
- [ ] `analytics.insight_feedback_coverage` — **8 of 581** (8 rules dispositionable · 573 insight types not)
- [ ] `analytics.top_rank_ignore_rate` — **unmeasured**; `position` + `request_id` already stored
- [ ] `analytics.served_rule_concentration` — **unmeasured**; 8 rules exist
- [ ] `analytics.unnamed_threshold_count` — **9** (5 floors + 4 `scoreOf` constants)
- [ ] `analytics.insufficient_data_render_rate` — **unmeasured**; no empty-state screen exists
- [ ] `analytics.consultant_enabled_restaurants` — **unlisted**; no expiry mechanism
- [ ] Spec files covering this team's 2,325 service lines — **0**

## The denominator problem, stated on the board so it cannot be forgotten

| Surface | Objects | Can receive a disposition? |
|---|---|---|
| `recommendations.service.ts` rules | **8** | ✅ act / dismiss / snooze / done / pin / assign / feedback |
| `INSIGHT_CANDIDATES` types | **573** | ❌ `analytics_insights` has no disposition column |

**Any acceptance rate published without this table beside it is the failure, not a metric.**

## Red today

- [ ] No expiry on consultant enablement, and the toggle route is unguarded (**OD-20**)
- [ ] No disposition path for the 573-type surface
- [ ] Nine threshold constants unnamed and untested
- [ ] No empty-state screen for `insufficient_data`
- [ ] `recommendation_impressions` written on every request, read by nothing
- [ ] **INTEL-F3** — operator has no `subject_type`; this team's primary signal is outside NF
