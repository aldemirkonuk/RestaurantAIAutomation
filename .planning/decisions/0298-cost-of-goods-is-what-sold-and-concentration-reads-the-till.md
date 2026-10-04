# 0298 — Cost of goods is what sold, and concentration reads the till

- **Status:** Proposed for the method. Two founder rulings bind parts of it and are quoted verbatim. **Cost gaps** (AskUserQuestion, 2026-10-04 ~20:50Z): *"Withhold, say N of M (Recommended)"*. The figure is a dash plus "N of M items that sold carry a recorded cost" (ADR 0051 precedent), and exact per-sale cost is the drinks program's follow-up (ADR 0115 D3). **The 'net' label** (AW17, AskUserQuestion, 2026-10-04 ~00:15Z): *"Net sales (Recommended)"*, with the option text *'Use the subtotal before tax and surcharge, as /team already does and as restaurant P&Ls do. The tip rate is on net. Every figure is labelled net.'* Everything else below is lane `proxies`' proposal, built for his review.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cost of goods, COGS, cogsRatio, gross margin, GMROI, inventory turnover, DIO, days of inventory, revenue concentration, Gini, HHI, metric registry, computed, pos_item_sales, pos_checks, inventory_transactions, deliveredPurchases, shelfValueAtMenuPrice, cogsCoverage, salesCoverage, net sales, A-046, A-018, AW16, AW17, Tuzlu Rüzgar
- **Links:** migration `cost_of_goods_reads_what_sold` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-cost-of-goods-reads-what-sold.jsonl`; [[0051-rebuilt-pages-show-live-data-only]] (unknown is the em dash); [[0053-analytics-cost-unknown-not-invented]] (a total is null, not a partial sum; coverage is reported); [[0067-a-failed-read-is-never-an-empty-one]]; [[0115-the-house-item-is-the-ledgers-key]] (D3, R6; PR #589, unmerged); [[0120-a-goal-comes-from-a-book-a-model-comes-from-the-task]]:61-66; [[0124-a-bottle-has-one-identity-and-every-price-names-it]]; [[0285-a-short-pour-opens-the-next-bottle]]; ADR 0292 (lane `cap`, the PostgREST row cap); the lane brief and plan `p4-scratch/sim-run/fixes/briefs/proxies.md`, `.../cont/proxies-plan.json` (outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found three figures standing in for measures the POS feed can already give. Every cite is at `e2cbe426a`.

- **A-046.** `AnalyticsService.getFinancialSummary` called the sum of DELIVERED `procurement_orders` over 365 days `cogs` (`apps/api-gateway/src/analytics/analytics.service.ts:428`). It called menu price × bottles on hand `revenue`, with the basis "POS-revenue proxy" (`:434`, `:538-539`). /reports printed the first as "Cost of goods (365d)" and the second as "Sell-price valuation" (`apps/web/src/pages/reports/next/rp-registers-house.tsx:202-209`, `apps/api-gateway/src/reports/exports/report-export-cuttings.ts:547-548`). Gross margin took the on-hand value at cost as its cost (`analytics.service.ts:458`), so no ratio described a sale. Tuzlu was shown $39,302.50 of purchases as cost of goods. The ledger's count-based cost for July and August is about $47,914 (procure-summary B17), and the shelf value was shown as $28,889.
- **A-018.** `getRiskProfile` computed the revenue Gini and SKU HHI over `unitPrice * qty` (`:725-726`), which measures where the shelf value sits. It gave 0.7775 for Tuzlu. The rule `revenue_concentration` fires above 0.6 with "Revenue rides on very few wines… raise their service level to 98%" (`recommendations.service.ts:536`). POS line sales per item, with zero-sale rows included, give 0.5651 over all 116 rows and 0.5091 over wine. Both are below the line, so the advice was produced by the stand-in.
- **AW16.** `METRIC_REGISTRY` (`metric-registry.ts`, served at `GET /analytics/metrics`) marked all 33 entries `computed: true`. Seven have no served field at all: year-on-year growth, an early-payment APR, a newsvendor order, price elasticity, an optimal markup, a CUSUM break, and a drawdown that is 0 by construction (`v3.0-TECH-DEBT.md` defect 4). Others described inputs they do not read: the Gini as "per-SKU revenue", the COGS ratio as "Beverage cost as a share of wine revenue", and turnover, DIO and GMROI as if they used an average inventory and a year of cost.

The till already holds both halves of the truth. `pos_checks.items` carries each line's price and quantity, with `inventory_id` stamped at ingest. The POS writes the stock it moves to `inventory_transactions` as source `pos`: a `sale` of −qty for a whole bottle, a `return` of +qty for a void, and one `sale` of −bottles_opened for glass pours (ADR 0285).

## Options considered

For **cost of goods**:

1. **POS bottles out × the recorded unit cost (chosen).** This is theoretical, sales-only cost of goods. It uses POS `sale` rows net of POS void `return` rows, with glass pours counted as the bottles they opened, times `resolveUnitCost`'s answer (`inventory-cost.ts` stays the only place a cost is decided; OD-100 is untouched). It reads only what is recorded today and needs no counts.
2. **Delivered purchases (the status quo).** What was bought is not what sold. A month of heavy buying would read as a month of heavy selling. Rejected.
3. **Opening + purchases − closing, from counts.** This is the accountant's figure and the one the truth used. Counts exist on three dates, and C02's back-dating is still in build, so for now it would be a number only on those dates. Rejected for now. It is the right cross-check once counts are regular.
4. **`wine_consumption_log` units × cost.** A glass is not a bottle (AW02), and turning glasses into bottles needs a bottle size that ADR 0124 measured as known on 51 of 206 inventory rows. Rejected.
5. **Write-time FIFO cost on each depletion row** (`lot_id` and cost on the ledger row). This is the long-term answer. It is ADR 0115 D3/R6's ledger design (PR #589, unmerged), and it would collide with lane glasspour's `record_glass_pour` rewrite. It is named as the follow-up, not built here.

For **an item that sold without a recorded cost** (the founder's fork): (a) withhold, as ADR 0051 does for the cellar value, and say N of M (**his pick**); (b) cost a sold-out item at its last lot cost, which adds a valuation branch that OD-100 has not decided; (c) show the costed part as a labelled floor, against ADR 0053's "a total is null, not a partial sum"; (d) record FIFO cost at write time, which is option 5.

For **sales**:

1. **POS line price × qty for lines naming a stock item, on closed, non-voided checks (chosen).** This is net of tax and surcharge, as AW17 rules. Check-level discounts are not apportioned, and the basis says so.
2. **Menu price × units sold.** It ignores the price the line actually carried (happy hour, a comp priced at 0). Rejected.
3. **Check totals.** These are gross, and they include food and lines naming no stock item, so they could not sit over a cost of stock items. Rejected.

For **where the aggregation runs**:

1. **One SECURITY INVOKER SQL function returning one jsonb value (chosen).** PostgREST's `max_rows` cuts rows, not values (ADR 0292), so a year of checks cannot be truncated. The output is bounded by the house's item count, and a new partial index covers the `closed_at` window.
2. **`.from('pos_checks')` in the gateway.** It is capped at 1,000 rows and ships every check over the wire. Rejected.

**Relabel only** (rename the two figures and change nothing else) was rejected. The scope asks for the real measure where the feed is connected, and the walk showed the feed is connected.

## Decision

The till's figures replace the stand-ins, and the stand-ins keep their own names.

1. **`cogs`** = POS bottles out × recorded unit cost over the trailing 365 days. It is null when the till read fails, when the window holds no closed check and no POS stock move, or when **any** item that sold carries no recorded cost (the founder's fork). `cogsCoverage` says how many of the items that sold are costed (the founder's "N of M"), how many bottles went out, how many are costed, and how many items net-returned (B19 void artefacts). An item that sold but is no longer active counts as uncosted.
2. **`revenue`** = POS line sales for stock items, net, over the same window. It is null when the read fails, when there is no closed check, or when a line names a stock item but cannot be read (a total would be a floor). `salesCoverage` gives the counts of checks, lines, lines naming no stock item and their sales, unreadable lines, and items that sold without moving stock (a glass from a bottle already open).
3. **The margin ratios** (`grossMarginDollars`, `grossMargin`, `cogsRatio`, `primeCostRatio`) divide that cost by those sales. They no longer depend on the on-hand valuation. `primeCostRatio` still adds only the labour the caller passes (`?labor=`, the MCP `labor` argument), and the registry says so.
4. **Turnover, DIO and GMROI** annualise the cost of the observed span (from the first POS sale in the window, at most 365 days) against today's inventory at cost. They are null under 28 days of POS history and null unless every on-hand row is costed (ADR 0053). `cogsWindow` gives the span. The value is today's, not an average, and the text says so.
5. **Revenue concentration** (`gini`, `hhi`) uses POS sales per stock item over 90 days. Every active item is a weight, and one that sold nothing weighs 0. An item that sold but is no longer active still counts. It is null, never "well-distributed", when the read fails, when there is no closed check, or when no line sold a stock item. `itemsWithSales` and `basis` say what was weighed.
6. **The old figures keep their true names**: `deliveredPurchases` and `shelfValueAtMenuPrice`. They feed no ratio. /reports and the export print "Sales of stocked items, net (365d)" and the sell-price valuation under its own name.
7. **A registry entry is `computed: true` only where a served field computes it.** Seven entries go to false. The descriptions of the rest say what they read. A test maps every `true` to a field on a real service call, or to the source line for the three lenses that need a whole service stood up.
8. **`public.pos_item_sales(house, since)`** does the aggregation: one jsonb value, SECURITY INVOKER, STABLE, executable by `service_role` only. Every malformed line is counted and none raises. A second per-item reader of the till should call it rather than aggregate `pos_checks.items` again.

**Not in these figures, and named in their bases:** waste, breakage, count corrections and sales outside the till (theoretical cost, not actual); check discounts (not apportioned); and food lines (no recipe cost, so a dish is in neither side).

What carried it: every number on the page should describe the event its label names. The till records sales and the stock they moved, so the honest figure was always available. Where part of it is not (a cost nobody recorded), the founder's ruling is the ADR 0051/0053 one: say how much is missing rather than print a smaller number under the same label.

## Consequences

- /reports, the export, the MCP financial tool, the consultant evidence and the `days_of_inventory` goal now read cost and sales of what sold. Recommendations' `revenue_concentration` rule fires on the till's Gini (Tuzlu's 0.5651 would not fire it).
- **Tuzlu will likely see dashes** for cost of goods and the ratios until its uncosted rows, including the sold-out ones, carry a cost. That is the fork's stated cost: a dash where a wrong $39,302 stood.
- A glass sold from a bottle opened before the window adds sales and no cost, so a short window can understate cost. `itemsSoldWithoutStockMove` discloses it, and the 28-day rule keeps the annualised ratios away from the shortest windows.
- **Owed, outside this PR (each named, none silent):**
  - `goal-scenarios.ts` `food-cost-ratio` still says `cogsRatio` runs "over a sell-price valuation of purchased stock". That text is false after this ADR. The corrected prose is a one-file follow-up, held at 15 files (`p4-scratch/sim-run/fixes/proxies-followup/`).
  - The `days_of_inventory` goal's refusal message names only the on-hand cost gap, not the 28-day or sold-cost gaps (`goals.service.ts`).
  - The vendor scorecard's note says `leadTimeStdev` feeds `/inventory-science`. No such parameter exists.
  - The rule copy "Revenue rides on very few wines" (A-063/C04, lane rec).
  - `maxDrawdown` (TECH-DEBT defect 4).
  - Comments in `Cutting.tsx` and `rp-catalogue.tsx` still say "eight figures".
  - The export-render spec's fixture still carries the old cogs reason (a renderer test with its own document, not the writer).
- **Revisit when:**
  - ADR 0115 D3 records cost per depletion row. Cost of goods should then read that cost, and the fork's dash goes away for sold-out items.
  - Counts become regular. Opening + purchases − closing should then be shown beside this figure as its check.
  - The founder rules on discount apportioning.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | lane `proxies` (build) | Created, Proposed. Gateway jest: 21 of the new pins fail at `e2cbe426a` and pass here. The SQL test is proved by `pgtest.sh lane` ([fix] PASS, [ctl] FAIL), with output in `p4-scratch/sim-run/fixes/audits/proxies-local-pg.txt` |
