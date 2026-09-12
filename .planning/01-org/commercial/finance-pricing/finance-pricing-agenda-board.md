---
type: agenda-board
division: commercial
department: finance-pricing
sublayer_of: growth
status: active
metrics: []
updated: 2026-08-28
links: ["[[finance-pricing-charter]]", "[[finance-pricing-agenda-full]]", "[[finance-pricing-premortem]]", "[[finance-pricing-loops]]", "[[finance-pricing-schedule]]", "[[finance-pricing-agent-stack]]", "[[inference-cost-agenda-board]]", "[[unit-economics-pricing-agenda-board]]", "[[0039-activation-plan-of-record]]", "[[OPEN-DECISIONS]]"]
---

# Finance & Pricing — Board

> **Active — 2026-08-28.** Queries and bullets only; the reasoning lives in
> [[finance-pricing-agenda-full]].

> **The two teams are two rows and they do not sum.** Any figure combining a measured F1
> number with an unmeasured F2 number is [[finance-pricing-premortem]] D1 happening.

> **Locks in force:** pricing model **deferred**, brand/landing visuals **held** (founder,
> 2026-08-28). No row below may become a price.

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

## Anything still provisional in this sub-layer

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— sub-layer —") AS Unit,
  updated AS Updated
FROM "01-org/commercial/finance-pricing"
WHERE status = "provisional"
SORT type ASC
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

## Open questions and advisory findings against this unit

```dataview
TABLE WITHOUT ID
  file.link AS File,
  default(team, "— sub-layer —") AS Unit,
  open_questions AS Open,
  updated AS Updated
FROM "01-org/commercial/finance-pricing"
WHERE type = "questions"
SORT open_questions DESC
```

## Agenda — F1 · [[inference-cost-charter]] (the money view of the spine)

- [ ] **FIN-A1** reader for `nf_a_cost_per_verified_task` + `nf_a_verdict_coverage` — **2026-09-11**
- [ ] **FIN-A2** first cost-per-verified-task readout, graded, coverage attached — **2026-09-30**
- [ ] **FIN-A3** reconcile the two cap systems; define `fin.cap_breach_count` over both — **2026-09-30**
- [ ] **FIN-A4** extend `check_model_calls_logged.sh` to `scripts/`, shrink-only, exit 2 — **2026-09-18**
- [ ] **FIN-A5** first ledger ↔ invoice reconciliation, by hand — **2026-09-30**
- [ ] **FIN-A6** absence alarm + a non-test reader for `get_drop_counts()` — **2026-09-18**
- [ ] **FIN-A7** implement `spend-ledger-auditor` under `run_card.py` — **2026-10-15**
- [ ] **FIN-A8** Track A2 watch (**weekly from 2026-09-04**); on landing, fetch — never recompute

## Agenda — F2 · [[unit-economics-pricing-charter]] (dormant: research, registers, guards)

- [ ] **FIN-B1** payment-rails research → dated `05-library/` entries — **2026-10-02**
- [ ] **FIN-B2** the rails comparison artifact, `winner: null` — **2026-10-09**
- [ ] **FIN-B3** map the restaurant-B2B money flow already in the product — **2026-09-25**
- [ ] **FIN-B4** open the anchor register; seed it with the figures already in code — **2026-09-11**
- [ ] **FIN-B5** build `no-price-proposed-guard` (exit 2 when it cannot check) — **2026-09-18**
- [ ] **FIN-B6** tier-vocabulary census — three vocabularies, none a price — **2026-09-25**
- [ ] **FIN-B7** define the entry-trigger query, or declare it undefinable — **2026-09-11**, then weekly
- [ ] **FIN-B8** implement `pricing-trigger-warden` under `run_card.py` — **2026-10-23**

## Agenda — sub-layer

- [ ] **FIN-C1** the unlock case, prepared and not acted on — **2026-10-09**
- [ ] **FIN-C2** `two-number-separation-check` shipped and fired once — **2026-10-15**
- [ ] **FIN-C3** CM-F4 report computed from `loops.json`, not asserted — **2026-11-28**
- [ ] **FIN-C4** anti-sprawl applied to this unit first, publicly — **2026-11-28**
- [ ] **FIN-C5** file the four cross-unit asks in the receiving `questions` files — **2026-09-11**

## Standing counters (hand-entered until FIN-A7 / FIN-B8 make them card output)

**F1 · [[inference-cost-agenda-board]] — EXISTS**

- [ ] `nf_a.cost_per_completed_task` — **computable, unpublished**; verdict-joined views exist since 2026-08-25, **no reader** (FIN-A1)
- [ ] `nf_a.doneability_verdict_coverage` — **39 task types emit · 27 verdict · 12 exempt · 0 ungraded** (`check_task_types_are_graded.py`, 2026-08-28)
- [ ] `fin.metered_invocation_coverage_pct` — **gateway 0 unrouted · Python 18/18 logged · 0 debt**; `scripts/` **not covered by the guard** — 11 provider-referencing files, 0 write the ledger (FIN-A4)
- [ ] `fin.spend_attribution_coverage_pct` — **0%** on `api_spend` (still 8 columns); the grain lives on the NF row only (Track A2)
- [ ] `fin.spend_reconciliation_variance_pct` — **never measured** (FIN-A5)
- [ ] `fin.hours_since_last_spend_row` — **unmeasured**; no absence detector, drop counter is process-local (FIN-A6)
- [ ] `fin.monthly_provider_spend_vs_cap_pct` — **readable today** (`spend_tasks.py:23-27`, `$40` / `$16`, hourly)
- [ ] `fin.cap_breach_count` — **structurally partial**: a per-tier ceiling breach is a `logger.warn` nothing consumes (FIN-A3)

**F2 · [[unit-economics-pricing-agenda-board]] — NEW, dormant**

- [ ] `fin.cost_to_serve_per_restaurant_month` — computable but a **systematic undercount**; held until FIN-A4/A5
- [ ] `fin.gross_margin_per_restaurant_month` — **undefined** — `no revenue — pricing deferred (OD-23)`
- [ ] `fin.non_design_partner_restaurant_count` — **undefined**, not zero: no design-partner discriminator exists (FIN-B7)
- [ ] `fin.external_price_quotes_logged` — **no register exists**; **5 dollar figures already ship in code** unregistered (FIN-B4)

**Card layer — [[0038-cards-run-as-declared-scripts]]**

- [ ] `spend-ledger-auditor` — declared `mechanical`, **not implemented** (FIN-A7)
- [ ] `pricing-trigger-warden` — declared `mechanical`, **not implemented** (FIN-B8)
- [ ] `fin-orchestrator` — `routing_class: extraction`; **cannot** run under `run_card.py`, waits on OD-03 / Track A1

## Open decisions on this board

- [ ] **OD-23** — revenue target and pricing, both unverified. Central question in [[finance-pricing-agenda-full]] §8. **Open. Not ours to resolve.**
- [ ] **OD-04** — external model roster; needs the per-task-type cost FIN-A1/A2 make readable
- [ ] **OD-03** — harness choice; gates `fin-orchestrator` (Track A1)
- [ ] **CM-F4** — is Growth the right parent? **Corrected 2026-08-28: 2 of 5 loops have no Commercial consumer, not 4 of 5** — see [[finance-pricing-agenda-full]] §6 F-1
- [ ] ~~**OD-11**~~ — **resolved 2026-08-24** (Path C, [[0008-nf-column-contract]]); the charter still lists it open (§6 F-5)
