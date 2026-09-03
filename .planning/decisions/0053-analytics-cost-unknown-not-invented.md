# 0053 — An unmeasured bottle cost is unknown, not 0.6 × the menu price

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — this ADR applies [[0051-rebuilt-pages-show-live-data-only]] to the analytics API; it does **not** decide OD-100
- **Keywords:** analytics, unit cost, WAC, last_purchase_price, magic number, basis, honesty, null, em dash, inventory value, margin, ABC, EOQ, menu engineering, guard
- **Links:** [[0051-rebuilt-pages-show-live-data-only]], [[0020-no-fabricated-answers]], `OPEN-DECISIONS.md` OD-100, `scripts/check_analytics_cost_honesty.py`, PR — analytics cost honesty

## Context

Two analytics loaders resolved a bottle's unit cost with the same inline
expression, the second copied from the first
(`apps/api-gateway/src/analytics/analytics.service.ts:117` and
`advanced-analytics.service.ts:72`, both at `origin/main`):

```ts
lot?.has_invoice_cost && lot?.wac
  ? lot.wac
  : Number(i.last_purchase_price) || (unitPrice ? unitPrice * 0.6 : 0);
```

The first branch is a real measurement — `inventory_lot_rollup.wac` is written
by receiving, from invoices. The third was invented. `0.6` carried no comment,
no ADR and no doc anywhere in the repo.

It was also not the rare branch. `restaurant_inventory.last_purchase_price` has
**no write site in this codebase** — every occurrence across `apps/`,
`services/`, `packages/` and `supabase/migrations/` is a read — and in
production it is NULL on all 72 inventory rows, while `inventory_lots` holds 2.
So the measured path covered ~2 rows and the invented one covered ~70.

Worse than unlabelled: two endpoints then asserted a provenance the number did
not have.

- `getFinancialSummary` → `basis.inventoryValue: "on-hand qty × WAC (lot rollup)"`
- `getMenuEngineering` → `basis.margin: "unit_price − WAC (lot rollup)"`

`getInventoryScience` and `getWine360` carried no `basis` at all, so their
cost-derived columns arrived with no way to tell measured from invented.

ADR 0051, locked the same week, is explicit: a surface shows live data or says
it does not know, and unknown is null — never a fabricated number, never zero.
A wrong `basis` label is the worst form of that defect, because it is the thing
a reviewer checks the number against. The same file already applied the
principle correctly one method away:
`analytics.service.ts:46` — *"null blocks margin honestly."*

## Options considered

1. **Leave the fallback, document the 0.6.** Cheapest. Keeps every dashboard
   populated. But it makes a made-up number official, and OD-100 ("what price
   values inventory?") is the founder's open question — writing 0.6 into a doc
   answers it by accident.
2. **Pick a better estimate** (industry beverage-cost ratio, category medians,
   vendor list price × a discount). More defensible arithmetic, same category
   of lie: the page still states a cost nobody recorded, and now with enough
   sophistication to survive scrutiny.
3. **Return null and propagate it.** Costs the most: several headline figures
   go dark for ~70 of 72 production SKUs, and every derived field has to be
   audited so a null does not become 0 through arithmetic.
4. **Do nothing.** The expression already existed twice because the second copy
   was written from the first; a third loader is one PR away and would not look
   wrong in a diff.

## Decision

**Option 3.** Where no invoiced lot cost and no recorded purchase price exists,
the cost is unknown: `resolveUnitCost()` returns `null`, and every field derived
from it returns `null` rather than a substituted value or a zero.

Cost now resolves in exactly one place —
`apps/api-gateway/src/analytics/inventory-cost.ts` — which also emits a
per-row `costBasis` (`invoice_lot_wac` | `last_purchase_price` | `unknown`) and
a `costCoverage` summary. Both `basis` lies are replaced by strings **built from
the coverage**, so a label cannot drift from the number the way it already did
twice, and the two endpoints with no `basis` now have one.

Per-field propagation, decided individually rather than by blanket rule:

| Endpoint | Field | Behaviour |
|---|---|---|
| `getFinancialSummary` | `inventoryValue`, `grossMarginDollars`, `grossMargin`, `cogsRatio`, `primeCostRatio`, `inventoryTurnover`, `daysInventoryOutstanding`, `gmroi` | null unless **every on-hand row** is costed |
| | `deadStockCapital`, `deadStockTop[].value` | null when any idle row is uncosted (still null with no movement signal) |
| | `revenue`, `cogs` | unchanged — neither depends on unit cost |
| `getInventoryScience` | `skus[].inventoryValue`, `skus[].unitCost`, `skus[].eoq` | null per row |
| | `skus[].abcClass` | null for **every** row unless the whole cellar is costed |
| | demand, reorder point, safety stock, stockout probability | unchanged |
| `getMenuEngineering` | `items[].marginPerBottle`, `marginPct`, `quadrant`, `action` | null per row; row counted under `counts.unclassified` |
| | `medians.marginPerBottle` | median over costed rows only; null when none |
| `getWine360` | `unitCost`, `marginPerBottle` | null; new `basis.unitCost` names the source |

Four judgement calls inside that, each narrower than it looks:

- **A total is null, not a partial sum.** Summing the 2 priced rows of 72 and
  labelling it "inventory value" is a different, much smaller number wearing
  that name. `costCoverage` reports the gap so a page can state it.
- **ABC goes dark wholesale.** Its cuts are on cumulative *share of a total*, so
  one unpriced row moves every other row's class. A Pareto over an unknown total
  is not a Pareto.
- **An invoiced WAC of `0` is measured.** `inventory.service.ts:701` records
  sample bottles as `unitCost: 0, provenance: "sample"`. The old expression read
  that 0 as falsy and fabricated a cost for a bottle that provably cost nothing.
  A `last_purchase_price` of `0` stays unknown — no write site could have meant
  "free", and reading it as one hands the wine a 100% margin.
- **An empty on-hand set reports null, not $0.** `loadInventory` degrades a
  failed PostgREST query to `[]` (its own comment says so), so `[]` means "no
  rows *or* no answer" — and $0 for a dead query is the silent zero this
  endpoint has been burned by before.

Held by `scripts/check_analytics_cost_honesty.py`, blocking in CI as
`analytics-cost-honesty`: it fails on a magic-number cost fallback, on a cost
derived outside the resolver, and on a cost-shaped `basis` entry that names a
source without deriving it. Exit 2 (cannot check) blocks like exit 1.

**This ADR does not resolve OD-100.** Which price *should* value inventory
remains the founder's call; `resolveUnitCost` is the single function to change
when it lands. No OPEN-DECISIONS row was added, per ADR 0025 — a new row
re-anchors every citation below it.

## Consequences

- **Easier:** cost lives in one function with one test file, and the label is
  generated from the rows it covered, so the two failure modes that produced
  this (a copied expression, a stale label) are both closed structurally.
- **Harder / given up:** several headline figures on the analytics endpoints go
  dark for the current production tenant until costs are actually recorded —
  inventory value, GMROI, turnover, DIO, dead-stock capital, ABC, and menu
  quadrants for uncosted wines. That is the intended trade under ADR 0051 and
  should not be argued back. The `dead_stock_capital` recommendation stops
  firing for the same reason: it advised discounting to a cost nobody knew.
- **Given up:** the `0.6` figure itself, which was the only thing standing
  between these endpoints and an empty state. Nothing replaces it.
- **Revisit when:** OD-100 lands, or receiving starts writing
  `last_purchase_price` / creating lots for the existing 70 SKUs — at which
  point the fields repopulate with measured numbers and no code changes.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created; guard proven exit 1 against the pre-fix tree, exit 0 after |
