---
type: scenario
id: S10
slug: stockout-risk-before-a-busy-night
class: problem
actors: [manager, inventory-ledger, forecast-engine, reorder-agent, vendor]
modules: ["[[inventory-ledger-charter|inventory-ledger]]", "[[analytics-engine-charter|analytics-engine]]", "[[procurement-vendor-network-charter|procurement-vendor-network]]"]
signals: [consumption-log, stock-live, lead-time, par-threshold, demand-forecast, nf_a]
insights_class: [stockout-risk, days-of-cover, reorder-point, dead-stock]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[inventory-ledger-charter]]", "[[analytics-engine-charter]]", "[[SCENARIO-MAP]]"]
---

# S10 — Stockout risk before a busy night

> A predictive problem scenario: the busy night is *coming*, the shelf is *not yet* empty,
> and the product's job is to see the gap early enough to close it with one tap. This is the
> strongest Plus/Pro payoff in the library — forecasting plus a one-tap reorder proposal —
> and it is honest only where the demand series is actually populated.

## 1. Trigger
A high-demand service is on the calendar (weekend, event, holiday) and one or more SKUs are
projected to run out before or during it. Bounded: from the daily risk sweep detecting the
projection to a human confirming (or declining) a reorder. The stock is *not* zero yet —
that is the whole point; S11 (waste) and a bare shelf are the failures this one prevents.

## 2. Actors
Manager/buyer (decides the order) · the inventory ledger (lots = source of truth;
`inventory-ledger-charter.md:19-22`) · the forecast/reorder math in the analytics engine ·
a reorder-reasoning agent (**Applied AI's**, not the ledger's — `inventory-ledger-charter.md:57`) ·
the vendor who fills the order (external).

## 3. Signals
- **Consumption log** — `wine_consumption_log` is the demand series behind essentially all
  consumption-side analytics: velocity, XYZ class, reorder point, safety stock, and the
  Holt-Winters forecast all SELECT from it (`pos-hub.service.ts:451-461`). **The honest
  gap:** until the `recordConsumption` writer was added, nothing ever INSERTed a row, so
  every restaurant read an empty series and reported zero demand forever
  (`pos-hub.service.ts:456-459`). The series is only as deep as POS sales flowing through
  that path — manual counts alone leave it thin.
- **`stock_live`** — the derived on-hand projection off the lots (never written directly;
  `inventory-ledger-charter.md:32`, guarded by `check_no_direct_stock_writes.sh`).
- **Lead time + its variance** — how long the vendor takes, and how *unreliably*
  (`safetyStock` uses King's formula with lead-time variance, `inventory-science.ts:144-169`).
- **Par / threshold** — `threshold_min ?? par_level` drives the low-stock engine
  (`low-stock-alerts.service.ts:555`).
- **Demand forecast** — `holtWintersAdditive` (level+trend+weekly seasonality) for the
  next horizon; classical, explainable, in-process, no Python (`forecasting.ts:1-20,95-147`).
- **NF-A** — the reorder *proposal* is an agent decision and should emit an NF-A row
  (cost, verdict). It does not: **NF-A emits nothing in the gateway today** — the known L4
  gap. The proposal is made; its footprint is unrecorded.

## 4. Queries the product must answer
- "Given this SKU's own demand variance, what is its probability of stocking out before the
  next replenishment cycle?" (`reorderList[].stockoutProbability`, `recommendations.service.ts:152`)
- "How many days of cover are left at current velocity?" (`days_of_cover`, `inventory.service.ts:179`)
- "What is the reorder point — expected lead-time demand + safety stock?"
  (`reorderPoint = leadTimeDemand + SS`, `inventory-science.ts:175-194`)
- "Is the forecast trustworthy?" — Holt-Winters returns **null** without ≥2 full seasonal
  cycles (`forecasting.ts:108-113`); a thin series must degrade to a naive baseline, not fake a curve.

## 5. Outputs (in the moment)
- A ranked **at-risk list** for the coming night: SKU, days of cover, stockout probability, on-hand.
- **One-tap reorder proposal.** The `stockout_imminent` rule fires when stockout
  probability > 0.4 and drafts: *"Place the order today — reorder point is N bottles. If the
  vendor is slow, split the order across two vendors."* (`recommendations.service.ts:149-162`).
- A durable low-stock notification with an email path for an offline manager
  (`low-stock-alerts.service.ts` → `GmailService`, `LowStockDigestWine` template).

## 6. Insights the owner sees (the payoff)
- **Stockout risk before the night**, per SKU, from that SKU's own variance — the leading,
  not lagging, number (`recommendations.service.ts:156-157`).
- **Days-of-cover trend** and **reorder-point vs on-hand** (`analytics.service.ts:275,304-308`).
- **Dead-stock capital** — the mirror problem, cash locked in slow movers
  (`recommendations.service.ts:164-178`) — so "order more" is balanced against "you over-ordered here."
- Satisfiability check: the `inventory` + `forecast` families are among the **25.1%**
  reachable without POS (`consumption+orders+inventory`, `analytics-engine-charter.md:71`) —
  but their *depth* still tracks how full `wine_consumption_log` is. This scenario is real at
  the shallow end and gets sharp only once POS feeds the series.

## 7. Decisions
Human: the manager confirms, edits, or declines the order; picks the vendor; sets par and
service level. System **proposes only** (ask→propose→confirm→execute): it ranks risk, drafts
the reorder quantity and the split-vendor hedge, and proposes a par adjustment after repeated
near-misses. It never places an order. Reorder *reasoning* is Applied AI's agent, the ledger
only owns the lot the order becomes (`inventory-ledger-charter.md:57`).

## 8. Failure modes
- **Empty/thin consumption series → zero demand → no risk flagged** while the shelf quietly
  empties (`pos-hub.service.ts:456-459`). The dangerous silent case.
- **Projection divergence** — `stock_live` ≠ sum of lots returns `200 OK` with a wrong
  integer the UI renders confidently; any non-zero is P1 and undetectable from the screen
  (`inventory-ledger-charter.md:41-46,62-64`).
- Lead-time variance ignored → safety stock too low → stockout despite a "healthy" reorder point.
- Over-reaction: a false spike inflates the forecast → over-order → dead-stock capital (§6 mirror).

## 9. Simulation & deploy gate
Harness: **synthetic engine**. Generate: steady demand · weekend spike · flat-then-event ·
slow-and-unreliable vendor (high lead-time variance) · thin series (< 2 cycles, forecast must
return null and fall back). Gate: no forecast/reorder change ships until each variant produces
the correct risk ranking and reorder point against a synthetic consumption book, and until the
thin-series case degrades honestly instead of fabricating a curve. `simulated` before `live`, locked.

## 10. Tier cut (proposed — OD-48)
- **Core (operate):** the low-stock/par alert and the at-risk list — reactive thresholds, one-tap.
- **Plus (understand):** days-of-cover and reorder-point scorecards; the drafted reorder proposal.
- **Pro (optimize):** the *predictive* layer — Holt-Winters demand forecast, service-level-tuned
  safety stock with lead-time variance, and the split-vendor hedge. This is the payoff that
  justifies Pro, and it needs the deepest signal set to earn its keep.

## 11. Evolution feedback
Which reorder proposals the manager edits before confirming teaches the reorder quantity its
real bias. Which forecasts miss the actual busy night (measured after) feeds the model-choice
question — where naive beats Holt-Winters, the honest benchmark should win (MASE, `forecasting.ts:268-284`).

**Flex points:** order cadence (daily vs weekly), service level (0.90 vs 0.99), counting unit
(bottle vs case), par philosophy (fixed vs dynamically recalculated), and single-vendor vs
split-vendor policy.
