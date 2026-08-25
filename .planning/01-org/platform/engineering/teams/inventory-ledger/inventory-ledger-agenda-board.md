---
type: agenda-board
division: platform
department: engineering
team: inventory-ledger
status: provisional
metrics: [inventory.projection_divergence_rows]
updated: 2026-08-24
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-agenda-full]]", "[[inventory-ledger-loops]]", "[[engineering-agenda-board]]"]
---

# Inventory & Ledger — Board

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

## Seam partners — teams this one is coupled to

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence
FROM "01-org/platform/engineering"
WHERE type = "charter"
  AND contains(list("procurement-vendor-network", "integration-engineering", "messaging-delivery", "schema-migrations"), team)
SORT team ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## Counters

- [ ] `inventory.projection_divergence_rows` — **never sampled**. Target zero, any non-zero is P1
- [ ] `inventory.direct_write_paths` — grep says 0; grep cannot see SQL functions
- [ ] `inventory.ledger_v1_callers` — **uncounted**; deprecation note has no removal date
- [ ] Alarm state to watch: **green CI + non-zero divergence**
- [ ] Movement records carrying originating-event id — **no**
- [ ] Count adjustments with a matching movement row — **unverified**

## Open

- [ ] Daily sampler — one query, blocks everything else
- [ ] Guard coverage into `supabase/migrations/**` function bodies
- [ ] Ledger v1 removal date
- [ ] Cross-hop idempotency seam with integration + messaging
