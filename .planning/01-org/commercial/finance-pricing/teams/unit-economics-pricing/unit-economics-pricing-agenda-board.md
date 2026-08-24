---
type: agenda-board
division: commercial
department: finance-pricing
team: unit-economics-pricing
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[unit-economics-pricing-charter]]", "[[unit-economics-pricing-agenda-full]]", "[[unit-economics-pricing-premortem]]", "[[unit-economics-pricing-loops]]", "[[unit-economics-pricing-schedule]]", "[[unit-economics-pricing-directive]]", "[[finance-pricing-agenda-board]]", "[[inference-cost-charter]]", "[[OPEN-DECISIONS]]"]
---

# Unit Economics & Pricing — Board

> **PROVISIONAL — no work done yet.**

> ## ⏸ DORMANT — entry trigger unfired
>
> **Trigger:** the first restaurant that is not the design partner, **or** the founder
> un-deferring pricing (`commercial.md:313-316`).
>
> **`fin.non_design_partner_restaurant_count` = 0** · last checked 2026-08-24
>
> **This team proposes no price.** No tier, no rate, no unit — see
> [[unit-economics-pricing-directive]].

## Every Unit Economics & Pricing artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/finance-pricing/teams/unit-economics-pricing"
SORT type ASC
```

## Dormancy check — is this charter still `new`?

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  status AS Grade,
  updated AS "Last reviewed"
FROM "01-org/commercial/finance-pricing"
WHERE type = "charter" AND status = "new"
```

A row here means the trigger has **not** fired. An empty result means either the trigger
fired and the charter was re-graded, or somebody edited a status without waking the team —
[[unit-economics-pricing-loops]] L-UEP-1 is what tells the two apart.

## This team in sub-layer context

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— sub-layer —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/finance-pricing"
WHERE type = "charter"
SORT status ASC
```

## Stale — for a dormant team this is the likeliest failure in the vault

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/finance-pricing/teams/unit-economics-pricing"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/commercial/finance-pricing/teams/unit-economics-pricing"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the jobs exist)

- [ ] `fin.non_design_partner_restaurant_count` — **0**. Trigger unfired. Recorded weekly **even when zero**
- [ ] `fin.external_price_quotes_logged` — **no register exists**. Opening it is step one
- [ ] `fin.cost_to_serve_per_restaurant_month` — **BLOCKED** on [[inference-cost-charter]]'s callsite census. Would be a systematic undercount if published today
- [ ] `fin.gross_margin_per_restaurant_month` — **undefined** — `no revenue — pricing deferred (OD-23)`

## What exists, verified 2026-08-24

| Ingredient | State |
|---|---|
| Revenue | **none** |
| Payment processor | **none** among 50 runtime hosts ([[EXTERNAL_CONNECTIONS]]) |
| Billing code | **none** in the repo |
| `/pricing` route | **none** among 51 web pages ([[PAGE_MAP]]) |
| Restaurants | **1** — design partner, **not connected** (`DEP-06` unchecked, `PROJECT.md:101`) |
| Per-restaurant cost attribution | ✅ `api_spend.restaurant_id` (`baseline:2236`, indexed `:8555`) — the one real ingredient |

## Pre-trigger work — the three things that run today

- [ ] Price-quote register opened
- [ ] Entry-trigger query armed as a weekly scheduled check
- [ ] Written founder question added to each weekly cycle (for the non-database half of the trigger)
- [ ] `no-price-proposed-guard` proposed to CI
- [ ] Provenance of `$20–50/mo` requested from the founder

## Open decisions on this board

- [ ] **OD-23** — $20k MRR in 30 days vs $20–50/mo. **Open. This team supplies arithmetic, not a recommendation**
- [ ] **Premise of OD-23** — no ADR records the `$20–50` "lock"; cited source `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` **not present in repo**
- [ ] **Trigger definition** — is a signed-but-unbilled account a trigger? Ambiguity is how dormancy becomes disappearance
- [ ] **Cap-raise rule** — should a provider cap raise require this team's cost-to-serve figure? ([[inference-cost-loops]] L-IC-5)
- [ ] **CM-F4** — Growth as parent, when consumers are Strategy & Fundraising and Sales
