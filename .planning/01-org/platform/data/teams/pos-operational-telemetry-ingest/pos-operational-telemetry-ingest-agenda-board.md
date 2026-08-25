---
type: agenda-board
division: platform
department: data
team: pos-operational-telemetry-ingest
status: provisional
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, sales.density]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-premortem]]", "[[pos-operational-telemetry-ingest-agenda-full]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[data-agenda-board]]", "[[integration-engineering-charter]]"]
---

# POS & Operational Telemetry Ingest — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## The seam — units on the other side of "delivered vs. usable"

```dataview
TABLE WITHOUT ID
  file.link AS Unit, department AS Dept, status AS Status
FROM "01-org"
WHERE type = "charter" AND (team = "integration-engineering" OR team = "catalogue-identity")
SORT file.name ASC
```

## Stale check — 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
```

## Fitness — per restaurant, never a mean

- [ ] `pos.line_resolution_rate` — **not published**, per restaurant or otherwise
- [ ] `pos.worst_restaurant_resolution_rate` — unmeasured (the number a mean is designed to hide)
- [ ] Acceptable-rate threshold — not set ([[pos-operational-telemetry-ingest-agenda-full]] Q1)
- [ ] Onboarding gate on first-week resolution rate — does not exist

## The unresolved queue

- [ ] `pos_unresolved_lines` — **exists in schema, has no named owner** ← M1's precondition
- [ ] `pos.unresolved_queue_depth` + trend — unmeasured
- [ ] `pos_catalog_match_proposals` — drain cadence undefined
- [ ] Weekly drain close-time — not in force

## Provider integrity — losses here are permanent

- [ ] `drift_findings` table exists (`…pos_unresolved_lines_and_review_queues.sql:82`); not fed by shape monitoring
- [ ] Daily distribution watch — line count · modifier rate · category mix · void rate · check value
- [ ] Raw-payload retention window — **unstated**; this is the only recovery path (re-fetch is impossible)
- [ ] Providers live: **Toast only**. `pos-provider.registry.ts` abstraction untested against a second real provider

## Sales corpus — one of the three mandatory L0 numbers

- [ ] `sales.density` — **absent; the absence is the signal** ([[data-loops]] loop 1)
- [ ] `demand_score` excludes below-threshold restaurants — **not implemented** (leaks into [[corpora-enrichment-charter]]'s primary metric)
- [ ] Density floor for published insights — not set

## Seam and dependencies

- [ ] Incident triage rule with [[integration-engineering-charter]] — not written (M5)
- [ ] `apps/api-gateway/src/analytics/` — 39 routes, all unguarded ([[security-charter]] owns the class; the dependency is ours to note)
- [ ] [[analytics-bi-charter]] declaring resolution rate behind published baselines — not required yet

## Built and healthy

- [x] `apps/api-gateway/src/pos-hub/` (10 routes; catalog matcher, provider registry, adapters + specs)
- [x] `apps/api-gateway/src/toast/` (10 routes; auth service, DTOs, specs)
- [x] `agents/pos_integration_agent.py`, `adapters/toast_adapter.py`
- [x] POS-agnostic `pos_checks`/`tables` schema
