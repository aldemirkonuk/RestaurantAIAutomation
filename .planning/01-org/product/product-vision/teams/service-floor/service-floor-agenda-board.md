---
type: agenda-board
division: product
department: product-vision
team: service-floor
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[service-floor-charter]]", "[[service-floor-agenda-full]]", "[[service-floor-loops]]", "[[service-floor-schedule]]", "[[product-vision-agenda-board]]", "[[pos-bridge-charter]]"]
---

# Service Floor (Floor Checker) — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/service-floor"
SORT type ASC
```

## Blocked loops and their named unblockers

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/service-floor"
WHERE type = "loops"
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

## Upstream units this team cannot proceed without

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Department,
  status AS Evidence
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter" AND (team = "pos-bridge" OR team = "partner-alliance-development")
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/product-vision/teams/service-floor"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Standing counters (hand-entered until the jobs exist)

**Stage gate: 0 → 1 → 2. Nothing below Stage 0 has a reading, and that is the honest state.**

- [ ] **Stage 0** — input audit table · **not started** (unblocked; this is the only
      currently actionable item on this board)
- [ ] `floor.providers_emitting_table_and_server` — **0 verified** of 30 registry providers
- [ ] `floor.providers_emitting_kitchen_ready` — **0 verified**; the event is **unmodelled**
      in `apps/api-gateway/src/pos-hub/pos-types.ts`
- [ ] POS corpus field coverage — `server_name`, `covers`, `table_id`, `total` = **0 of 47
      rows** (`20260819000000_guest_identity_minimal_slice.sql:11-14`); all 47 are simulator
      output from one 43-minute window
- [ ] `floor.kitchen_ready_to_waiter_p95_seconds` — **unmeasurable**; no event, no boundary
      defined
- [ ] `floor.misroute_rate` — target **0**; **no measurement path**
- [ ] Providers at status `available` in the registry — **2** (`generic_webhook`,
      `csv_import`), **0 with a real merchant** behind them
- [ ] Registry providers needing a partner agreement — **9**
      (`pos-provider.registry.ts:119,171,192,222,232,242,254,264,298`)
- [ ] Change request to [[pos-bridge-charter]] (model kitchen-ready) — **not filed**
- [ ] Outreach ask to [[partner-alliance-development-charter]] — **not filed**
- [ ] Lines of Floor Checker product code written — **0, and correct.** Any non-zero value
      here before Stage 1's trigger is [[service-floor-premortem]] M1 in progress
