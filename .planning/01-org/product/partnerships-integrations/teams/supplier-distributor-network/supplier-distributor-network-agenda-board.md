---
type: agenda-board
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: provisional
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[supplier-distributor-network-charter]]"
  - "[[supplier-distributor-network-agenda-full]]"
  - "[[supplier-distributor-network-loops]]"
  - "[[partnerships-integrations-agenda-board]]"
---

# Supplier & Distributor Network — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations/teams/supplier-distributor-network"
SORT type ASC
```

## Department charters — who owns which half of a contested boundary

```dataview
TABLE WITHOUT ID
  file.link AS Unit, team AS Team, status AS Grade
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter"
SORT team ASC
```

## Drift watch — feeds the day-90 clause

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations/teams/supplier-distributor-network"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

| | Today |
|---|---|
| `pi.live_counterparties` | **0** |
| `procurement_orders` in the system | **1** (`AGENT_NATIVE_UI_DECISION.md:59`) |
| Portal logins, ever | **0** |
| `provider_promotions` reads in code | **6** (`:135, :159, :179, :197, :222, :414`) |
| `provider_promotions` rows | **dormant** — the table is empty, the code is not |
| Open boundary forks crossing this team | **2** — CM-F3, OD-21 |

## Contested — stated, not claimed

- [ ] **CM-F3** — distributor connectivity: Sales or here? `commercial.md:631` ← `YC_WEDGE_PLAN.md:41`
  - Proposed seam: **signed intent to send data.** Before it Sales, after it us.
- [ ] **OD-21** — Vendor Finder boundary vs [[supply-discovery-charter]]
  - `distributor-discovery/` is cited by both, owned cleanly by neither

## Next

- [ ] CM-F3 boundary memo, co-written with [[design-partner-operations-charter]]
- [ ] Feed freshness signal — make *dormant*, *empty* and *stale* three different states
- [ ] Publish-state gate on vendor pages + non-enumerable slugs
- [ ] Counterparty state model: prospective / agreed / live / stale / lapsed
- [ ] One live feed, in whatever format the distributor already sends
- [ ] Corrections upstream: vendor-portal already classified; 6 reads not 5
- [ ] **Day-90 review** — propose own merge if both forks open and metric still 0

## Rules in force

- [ ] **No portal feature while `pi.live_counterparties` == 0** — except features that make becoming the first one easier
- [ ] **Build no VAN or AS2 transport** (`YC_WEDGE_PLAN.md:40-41`)
- [ ] **Four intake channels, one document model** — downstream never learns the channel
- [ ] **Publish-state is a relationship property**, not a route property
- [ ] **Freshness before features** — a feed past cadence must be loud

## Closed, and worth knowing

- [x] *"Classify vendor-portal's 2 unguarded routes"* — **already done.** `ENDPOINTS.md:656`: explicit `@Public()`, intentionally public, not a gap. Residual risk is slug enumeration + unpublished-page leakage, which is ours.
