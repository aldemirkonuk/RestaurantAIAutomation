---
type: agenda-board
division: platform
department: engineering
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[engineering-agenda-full]]", "[[engineering-loops]]", "[[engineering-schedule]]"]
---

# Engineering — Board

> **PROVISIONAL — no work done yet.**

## Every Engineering artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/platform/engineering"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/platform/engineering"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/platform/engineering"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `platform.endpoints_protected_by_default_pct` — **0%** of 448 routes
- [ ] `surfaces.reachable_route_ratio` — **24** orphan routes, **13** untraceable components
- [ ] `integration.verified_signature_coverage` — **unmeasured** of ≈51 public routes
- [ ] `identity.false_merge_count` — **no labelled set yet**
- [ ] `inventory.projection_divergence_rows` — **no daily sample yet**
- [ ] `messaging.duplicate_delivery_rate` — **no `notification_id` measurement yet**
- [ ] `procurement.order_to_delivery_reconciliation_rate` — **unmeasured**
- [ ] `schema.days_since_hand_applied_ddl` — readable today from the parity job
