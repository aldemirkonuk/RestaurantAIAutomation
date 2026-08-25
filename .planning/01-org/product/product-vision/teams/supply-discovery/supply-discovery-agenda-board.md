---
type: agenda-board
division: product
department: product-vision
team: supply-discovery
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[supply-discovery-charter]]", "[[supply-discovery-agenda-full]]", "[[supply-discovery-loops]]", "[[supply-discovery-schedule]]", "[[product-vision-agenda-board]]", "[[supplier-distributor-network-charter]]"]
---

# Supply Discovery (Vendor Finder) — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/supply-discovery"
SORT type ASC
```

## Where this team sits among its siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/product-vision"
WHERE type = "charter"
SORT status ASC, team ASC
```

## The duplication counterpart — this boundary is the division's highest-risk seam

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/partnerships-integrations/teams/supplier-distributor-network"
SORT type ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/product-vision/teams/supply-discovery"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision/teams/supply-discovery"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the jobs exist)

**The publishing rule: coverage, denominator, and freshness are one triple or nothing.**

- [ ] `supply.needed_sku_denominator_size` — **0**. No restaurant has a needed-SKU list
- [ ] `supply.sku_dual_price_coverage_pct` — **undefined, not zero** (no denominator).
      Publishing a percentage here before the line above is non-zero is
      [[supply-discovery-premortem]] M2 in progress
- [ ] `supply.price_freshness_p50_days` — **unmeasured**; no price carries a displayed age
- [ ] Freshness policy (stale / hide / refetch thresholds) — **does not exist**
- [ ] Distributor state list — **does not exist**; no distributor has one owning team
      per stage
- [ ] Crawl permission register — **does not exist**; **0** targets carry a recorded
      terms check
- [ ] Demand pulling on this graph — `procurement_orders` = **1**
      ([[AGENT_NATIVE_UI_DECISION]] §2)
- [ ] Comparison surfaces reachable by clicking — **0 of 2**: `/distributors`
      ([[PAGE_MAP]]:116) and `/vendor-prices` (:130) are both cold-entry
- [ ] Match-confidence definition (vendor line → our SKU) — **not written**
- [ ] Wine enrichment feeding identity matching — **144 of 1,448** wines
      (commits `f7e0ea1`, `ef19b81`)
- [ ] Vendor Finder boundary fork — **filed with a colliding OD id**, not yet renumbered or
      closed
