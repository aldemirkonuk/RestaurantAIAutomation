---
type: agenda-board
division: product
department: product-vision
team: surface-portfolio
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-agenda-full]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-schedule]]", "[[product-vision-agenda-board]]", "[[ux-path-burn-down-charter]]", "[[client-surfaces-charter]]"]
---

# Surface Portfolio — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/surface-portfolio"
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

## The counterpart team — kills must be cross-referenced against their ledger

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/design/teams/ux-path-burn-down"
SORT type ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/product-vision/teams/surface-portfolio"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision/teams/surface-portfolio"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The metric, decomposed — never reported as one number

A drop driven entirely by the fourth row is reclassification, not progress
([[surface-portfolio-premortem]] M2).

| Bucket | This close-time | Cumulative |
|---|---|---|
| Routes **killed** | 0 | 0 |
| Routes **merged** | 0 | 0 |
| Routes **made reachable** | 0 | 0 |
| Newly declared **intentionally-cold** (with reason + re-check date) | 0 | 0 |
| **Still unowned** | 24 | 24 |

## Standing counters (hand-entered until the jobs exist)

- [ ] `surface.unowned_surface_count` — **24** cold-entry routes + **13** untraceable
      components, of **51** routes (route count re-verified against `apps/web/src/App.tsx`)
- [ ] ⚠️ **Overlap correction owed to [[PAGE_MAP]]** — 11 routes appear on **both** lists,
      so this is **26 distinct routes**, not 37
- [ ] Route verdict sheet — **0 of 51** routes have a verdict
- [ ] Live duplications awaiting a call — **3**: `/wine-agent`+`/wineagent`
      (`App.tsx:293-294`), `/inventory`+`/inventory-legacy`, `/calendar`+`/calendar-classic`
- [ ] `surface.routes_without_owning_module` — **unmeasured**; reconciliation against 448
      endpoints / 44 modules not started
- [ ] Modules with endpoints and no page — **unmeasured** (the other orphan direction)
- [ ] Untraceable components filed as a dated ask to [[client-surfaces-charter]] —
      **not filed**
- [ ] In-app navigation edges — **39**, and this is a **floor**: navigation out of the 13
      untraceable routes is unrepresented
- [ ] Committed target for `surface.unowned_surface_count` — **not set**. Zero is the wrong
      target; a stated number is the deliverable
- [ ] Mobile route inventory — **does not exist**; `apps/mobile` has no [[PAGE_MAP]]
      equivalent anywhere in the repo
