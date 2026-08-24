---
type: scenario
id: S11
slug: waste-or-spoilage-logged
class: problem
actors: [staff, manager, inventory-system, analytics-engine]
modules: ["[[inventory-ledger-charter|inventory-ledger]]", "[[analytics-engine-charter|analytics-engine]]"]
signals: [waste-event, quantity_change, reason, lot-depletion, nf_a]
insights_class: [waste-rate, waste-cost, margin-drag, par-adjustment]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[inventory-ledger-charter]]", "[[INVENTORY_SOTA_PLAN]]"]
---

# S11 — Waste / spoilage logged

## 1. Trigger
Stock is destroyed rather than sold: a bottle breaks, a wine is corked, a pour is spilled,
something expires. Bounded: from the staff member logging the event to on-hand decremented
and the cost impact recorded. The live path is real: DTO `WASTE = "waste"`
(`inventory-ledger.dto.ts:24`) → `createTransaction` (`inventory-ledger.service.ts:68`) →
the `apply_stock_movement` primitive with a negative delta and FIFO lot depletion
(`20260805130000_extend_apply_stock_movement.sql:85-100`).

## 2. Actors
Staff (logs the event, often mid-service) · manager (reviews patterns, adjusts pars) ·
inventory ledger (the single stock write) · analytics engine (turns events into the story).
No guest, no vendor.

## 3. Signals
- `quantity_change` (negative), `reason`, `notes`, `performed_by`, `transaction_type = waste`
  — written to `inventory_transactions` and mapped to a `remove` change type
  (`inventory-ledger.service.ts:570`).
- FIFO lot depletion: the movement consumes `inventory_lots` oldest-first
  (`20260805130000...:88-100`), each lot carrying `unit_cost` + `cost_provenance`.
- **Honest capture gap — the dollar value of waste is not recorded.** The transaction row
  stores `unit_cost = p_unit_cost`, the value the caller passed, which is **NULL for a
  manual waste log**. The depleted lots' actual cost is consumed but never snapshotted onto
  the transaction, so "what did we throw away in dollars" must be reconstructed from lots
  that are already gone. Waste-**rate** (units) is solid; waste-**cost** is only as good as
  whether cost was attached at log time.
- **Orphaned function to avoid:** the DB `log_waste()` (baseline `:1002`) still calls the
  dropped `record_inventory_transaction` (`20260805135000...`) and would 500 — the ledger
  service deliberately does **not** use it. Any new waste caller must go through
  `apply_stock_movement`, not `log_waste`.

## 4. Queries the product must answer
- "How much did we waste this period — units and dollars — and by what reason?"
- "Which SKUs waste most, and is it rising?"
- "What is waste as a share of what we sell?" — needs POS sales, so **partially** answerable.
- "Does today's waste change tonight's stockout risk?" — hands off to [[S10]].

## 5. Outputs (in the moment)
- One-tap waste log: SKU + quantity + reason picker (breakage / corked / expired / over-pour),
  one thumb free.
- Immediate confirmation of the new on-hand, and a low-stock re-check if the write crosses a par.
- On a repeat pattern, a **surfaced** (not applied) note: "3rd breakage of this SKU this month."

## 6. Insights the owner sees (the payoff)
- **Waste rate** by SKU and reason, and its trend — POS-free, satisfiable within the 25.1%
  band ([[analytics-bi-charter]]) because it is pure consumption.
- **Waste cost** — dollars thrown away — *when* cost was attached (see §3 gap); spoilage is
  already priced into carrying cost (`HOLDING_RATE = 0.26` includes spoilage,
  `analytics.service.ts:28`; `inventory-science.ts:90`).
- **Margin drag** — waste as % of COGS / lost margin — needs POS price and sales, so this
  class is **POS-gated**, outside the without-POS band. Promise it only where POS is connected.
- A ranked "what you throw away most" list — the payoff line the owner opens.

## 7. Decisions
Human: log the event, pick the reason, decide whether to change ordering. The system
**proposes** (ask→propose→confirm→execute): a par-level down-adjustment after repeated
spoilage, a smaller reorder quantity, "you over-order X." It **never** auto-adjusts a par or
places an order off a waste signal.

## 8. Failure modes
- Waste never logged → invisible shrink; on-hand overstates until a spot count corrects it
  (feeds `inventory.projection_divergence_rows`, ledger charter metric).
- Waste logged with no cost → the dollar impact is unknowable forever (the §3 gap made real).
- Free-text reasons → unclusterable, so §6 by-reason insight collapses.
- Same loss double-counted as both a waste and a sale → stock and COGS both wrong.
- A caller wired to the orphaned `log_waste()` → every waste log 500s silently.

## 9. Simulation & deploy gate
Synthetic engine generates spoilage variants — breakage · corked · expiry · over-pour — against
a synthetic lot book with known costs. Gate: waste changes ship only when the delta depletes the
correct lots FIFO, the reconstructed waste cost matches the seeded lot costs, and a follow-up
spot count reconciles to zero divergence.

## 10. Tier cut (proposed — OD-48)
Core: waste logging + on-hand adjust. Plus: waste scorecard by reason/SKU + trend. Pro:
par-level and order-quantity proposals to cut waste, plus cross-SKU spoilage forecasting.

## 11. Evolution feedback
The reason distribution and whether the owner accepts a proposed par cut tell the app which SKUs
are chronically over-ordered; logged waste diverging from spot counts is the direct signal on
`inventory.projection_divergence_rows`. Which SKUs the owner drills into names the §6 stories
worth keeping.

**Flex points:** reason taxonomy; who may log (any staff vs manager-only); whether a waste log
requires a photo; unit of measure (whole bottle vs pour — `waste_ml` exists at baseline `:3108`);
whether cost is captured at log time or left NULL.
