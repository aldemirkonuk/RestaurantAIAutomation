---
type: agenda-board
division: commercial
department: finance-pricing
sublayer_of: growth
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[finance-pricing-charter]]", "[[finance-pricing-agenda-full]]", "[[finance-pricing-premortem]]", "[[finance-pricing-loops]]", "[[finance-pricing-schedule]]", "[[inference-cost-agenda-board]]", "[[unit-economics-pricing-agenda-board]]", "[[OPEN-DECISIONS]]"]
---

# Finance & Pricing — Board

> **PROVISIONAL — no work done yet.**

> **The two teams are two rows and they do not sum.** Any figure combining a measured F1
> number with an unmeasured F2 number is [[finance-pricing-premortem]] D1 happening.

## Every Finance & Pricing artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— sub-layer —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/finance-pricing"
SORT default(team, "") ASC, type ASC
```

## Charters by evidence grade

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

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— sub-layer —") AS Unit,
  updated AS "Last touched"
FROM "01-org/commercial/finance-pricing"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/commercial/finance-pricing"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Dormant units — is the entry trigger still unfired?

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Grade,
  updated AS "Last reviewed"
FROM "01-org/commercial/finance-pricing"
WHERE type = "charter" AND status = "new"
```

## Standing counters (hand-entered until the jobs exist)

**F1 · [[inference-cost-agenda-board]] — EXISTS**

- [ ] `nf_a.cost_per_task_per_agent` — **not derivable**; no `agent` in `SpendLogger.log()` (`spend_logger.py:41-48`)
- [ ] `fin.spend_attribution_coverage_pct` — **0%** at agent grain; no `agent` column in `api_spend`
- [ ] `fin.metered_invocation_coverage_pct` — **unknown**; 16 metered Python callsites · **0** in `apps/api-gateway/src` · 2 scripts self-metering and discarding
- [ ] `fin.spend_reconciliation_variance_pct` — **never measured**
- [ ] `fin.hours_since_last_spend_row` — **unmeasured**; no absence detector
- [ ] `fin.monthly_provider_spend_vs_cap_pct` — **readable today** (`spend_tasks.py:24-27`, `$40` / `$16`)

**F2 · [[unit-economics-pricing-agenda-board]] — NEW, dormant**

- [ ] `fin.cost_to_serve_per_restaurant_month` — computable but a **systematic undercount**
- [ ] `fin.gross_margin_per_restaurant_month` — **undefined** — `no revenue — pricing deferred (OD-23)`
- [ ] `fin.non_design_partner_restaurant_count` — **0**; entry trigger unfired
- [ ] `fin.external_price_quotes_logged` — **no register exists**

## Open decisions on this board

- [ ] **OD-23** — $20k MRR in 30 days vs $20–50/mo. Central question in
      [[finance-pricing-agenda-full]]. **Open. Not ours to resolve.**
- [ ] **Premise of OD-23** — no ADR records the `$20–50/mo` "lock"; source document
      `MASTER-PLAN-30-DAY-SPRINT-2026-08-24.md` not present in repo
- [ ] **OD-11** — NF column contract; gates F1's bridge column
- [ ] **OD-04** — external model roster; blocked on a per-task-type cost F1 cannot yet produce
- [ ] **CM-F4** — is Growth the right parent? Locked; instrumented, not argued
