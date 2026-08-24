---
type: agenda-board
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate]
updated: 2026-08-24
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-agenda-full]]", "[[procurement-vendor-network-loops]]", "[[engineering-agenda-board]]"]
---

# Procurement & Vendor Network — Board

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

## Exposure partners — who else touches the money path

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type
FROM "01-org/platform/engineering"
WHERE contains(list("platform-api", "integration-engineering", "inventory-ledger"), team)
  AND contains(list("charter", "premortem"), type)
SORT team ASC, type ASC
```

## Stale here (60-day rule)

```dataview
LIST rows.file.link
FROM "01-org/platform/engineering"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
GROUP BY type
```

## Counters

- [ ] `procurement.unguarded_money_moving_routes` — **≥6** (`recurring-orders`, [[ENDPOINTS]]:428)
- [ ] Alert on unauthenticated writes to `procurement/**` — **not built**
- [ ] `procurement.order_to_delivery_reconciliation_rate` — **unmeasured**
- [ ] `procurement.no_touch_reconciliation_rate` — **unmeasured**; the clause that matters
- [ ] Price-at-order snapshot on order lines — **not present**
- [ ] Spend-capable code paths enumerated — **no**
- [ ] Auto-commit thresholds in code — **unknown**, and that is the finding

## Open

- [ ] Money-moving routes excluded from any `@Public()` allowlist — seam with [[platform-api-charter]]
- [ ] Spend gate handed to [[action-safety-the-human-gate-charter|action-safety-the-human-gate]]
- [ ] `vendor-portal` correctness criterion re-classified
