---
type: agenda-board
division: product
department: product-vision
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[product-vision-charter]]", "[[product-vision-agenda-full]]", "[[product-vision-loops]]", "[[product-vision-schedule]]", "[[product-vision-premortem]]"]
---

# Product & Vision — Board

> **PROVISIONAL — no work done yet.**

## Every Product & Vision artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/product-vision"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/product/product-vision"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Teams still provisional across every artifact — nothing real has started

```dataview
TABLE WITHOUT ID
  team AS Team,
  length(rows) AS "Provisional artifacts"
FROM "01-org/product/product-vision/teams"
WHERE status = "provisional"
GROUP BY team
SORT length(rows) DESC
```

## Sibling units this department's boundaries depend on

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Department,
  status AS Evidence
FROM "01-org/product"
WHERE type = "charter" AND department != "product-vision"
SORT department ASC, team ASC
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `surface.unowned_surface_count` — **24** routes with no inbound link + **13**
      untraceable route components, of **51** routes
- [ ] Live route duplications awaiting a verdict — **3**: `/wine-agent`+`/wineagent`
      (`App.tsx:293-294`), `/inventory`+`/inventory-legacy`, `/calendar`+`/calendar-classic`
- [ ] `askai.confirm_without_edit_rate` — **no composer exists**; 0 of 44 api-gateway
      modules is an ask/action module
- [ ] Ask AI divergent entry points — **4** (+1 adjacent deterministic palette); target **1**
- [ ] `askai.refusal_correctness` — **no refusal test set yet**; `NEW-906` unimplemented
- [ ] `inbound.proposal_accept_without_edit_rate` — **unmeasured** across all 3 modules
- [ ] `inbound.false_accept_count` — **no correction-tracking exists**; this is the number
      that makes acceptance honest
- [ ] `supply.sku_dual_price_coverage_pct` — **no denominator**; "needed SKU" undefined
- [ ] `floor.kitchen_ready_to_waiter_p95_seconds` — **unmeasurable**; `server_name`,
      `covers`, `table_id`, `total` are **0 of 47 rows**
- [ ] `floor.misroute_rate` — target **0**, no measurement path
- [ ] Demand reality check, department-wide — `pos_checks` **0** real rows,
      `procurement_orders` **1**, `recommendation_actions` **0**
      ([[AGENT_NATIVE_UI_DECISION]] §2)
