---
type: agenda-board
division: platform
department: engineering
team: schema-migrations
status: provisional
metrics: [schema.days_since_hand_applied_ddl]
updated: 2026-08-24
links: ["[[schema-migrations-charter]]", "[[schema-migrations-agenda-full]]", "[[schema-migrations-loops]]", "[[engineering-agenda-board]]", "[[sre-state-integrity]]"]
---

# Schema & Migrations — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/platform/engineering"
WHERE team = this.team
SORT type ASC
```

## Teams whose invariants this team authors DDL for

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  metrics AS "Their metric"
FROM "01-org/platform/engineering"
WHERE type = "charter"
  AND contains(list("inventory-ledger", "catalogue-identity", "procurement-vendor-network", "platform-api"), team)
SORT team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## The streak

- [ ] `schema.days_since_hand_applied_ddl` — **readable today**; the only Engineering
      primary metric that is. Publish it.
- [ ] It is a **streak**, not a percentage. It resets to zero and rebuilds from nothing.
- [ ] Rule: a red gate is closed by a **file**, not a sentence.
- [ ] The **auditor** declares red — [[sre-state-integrity]], not this team.

## Counters

- [ ] Migrations — **62**; baseline `20260805000000_baseline_from_production.sql`
- [ ] Emergency DDL runbook — **unwritten**
- [ ] Function-body parity (not just names/signatures) — **no**
- [ ] Generated-types CI regeneration gate — **no**
- [ ] Irreversible-operations list published — **no**
- [ ] 2026-08-05 drift fully absorbed into migrations — **unconfirmed**

## The incident, for anyone who forgets why this team exists

- [ ] 27 tables created by no migration
- [ ] 403 columns created by no migration — 37 on `restaurant_inventory` alone
- [ ] 13 functions with no source in the repo
- [ ] `calculate_sales_velocity`, `resolve_sku_to_inventory` — business logic, no repo source
- [ ] Recorded verbatim at `scripts/check_schema_parity.sh:6-11`
