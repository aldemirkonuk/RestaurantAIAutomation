---
type: agenda-board
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate]
updated: 2026-09-01
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

- [x] `procurement.unguarded_money_moving_routes` — **0 across the `recurring-orders`
  cluster**, closed 2026-08-25. A class-level `@UseGuards(JwtAuthGuard)` covers all six
  (`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
  OD-20); no `@Public()` in the file; [[ENDPOINTS]]:464-473 marks all six ✅. The
  **team-wide** value now comes from the E0 auth census, merged 2026-09-01
  (`ECOSYSTEM-PLAN.md:83`): 468 route handlers, 444 authenticated, 23 deliberately public
  with evidence, **0 unauthenticated by omission**, 1 unclear — so this team's other ~91
  routes contribute **zero**. Read the counter as a regression watch, not a backlog:
  **the defect count is zero while the defect generator is fully intact** — `JwtAuthGuard`
  is per-controller, not a global `APP_GUARD` (`app.module.ts:130-137` registers only
  `RateLimitGuard` and `TenantGuard`), so the next money-moving route — endpoint 469 — is
  unguarded until someone remembers the decorator.
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
