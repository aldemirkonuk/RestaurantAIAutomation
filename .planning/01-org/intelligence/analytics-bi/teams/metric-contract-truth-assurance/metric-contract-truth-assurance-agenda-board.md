---
type: agenda-board
division: intelligence
department: analytics-bi
team: metric-contract-truth-assurance
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[metric-contract-truth-assurance-charter]]", "[[metric-contract-truth-assurance-agenda-full]]", "[[metric-contract-truth-assurance-premortem]]", "[[metric-contract-truth-assurance-loops]]", "[[metric-contract-truth-assurance-schedule]]", "[[analytics-bi-agenda-board]]"]
---

# Metric Contract & Truth Assurance — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance"
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

## Blocked loops — anything waiting on a unit we do not control

```dataview
LIST
FROM "01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance"
WHERE type = "loops" AND contains(file.content, "status: blocked")
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  updated AS "Last touched"
FROM "01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `analytics.metric_claim_divergence_count` — **≥ 2**, both live and public
- [ ] `analytics.divergences_closed_structurally` — **0** *(an edit is not a close)*
- [ ] `analytics.registry_binding_share` — **0%** of 33 keys, all declaring `computed: true`
- [ ] `analytics.silent_zero_paths` — **8** `allSettled` sites across 5 files
- [ ] `analytics.claims_without_provenance` — **unmeasured**; register does not exist
- [ ] `analytics.register_entries_added` — **0** *(zero entries in a month = failure to audit)*
- [ ] `analytics.kpi_ground_truth_agreement` — **0%**, blocked on §44.7 · restated monthly, dated

## The divergence register — open items

| # | Quantity | Values in circulation | Truth | Customer-reachable? |
|---|---|---|---|---|
| D1 | Insight types | **375** · **348** · **573** | **573** | ✅ `InsightCatalog.tsx:2`, `commands.ts:78,99`, `analytics.controller.ts:219` all say 375 |
| D2 | Catalogue features | **460** · **360** | 460 total, 360 tiered | ❌ internal (`metric-registry.ts:8` vs `ANALYTICS_FEATURE_CATALOG.md:5`) |
| D3 | Catalogue build status | "PARTLY BUILT" (`.md:5`) vs `"status": "planned"` (`.json` meta) | partly built | ❌ internal |

## Red today

- [ ] `insight-catalog.spec.ts:9-10` asserts only `>= 200` — nothing pins the count
- [ ] `InsightCatalog.tsx` hardcodes a count while `GET /analytics/insight-catalog` derives it at runtime
- [ ] `METRIC_BY_KEY` exported and used by nothing; no `compute(metricKey)` dispatch exists
- [ ] No way to distinguish "computed zero" from "query failed" anywhere in the module
- [ ] No claim register, and no claim has ever been vetoed
- [ ] §44.7 SimPOS unscheduled → §44.10, the *"stated #1 eval priority"*, is unstartable

## Precedents this team was founded on

- **Two weeks with a wrong header** — `ANALYTICS_FEATURE_CATALOG.md:5-13`: *"a shipped
  engine sat behind a 'not built' label."*
- **Every inventory metric silently zero** — `analytics.service.ts:57-66`: a column
  mismatch, one 42703, and *"every metric downstream … silently reported 0/null for every
  restaurant."*
