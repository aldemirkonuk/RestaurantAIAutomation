## An invoice price reached a lot's cost as printed, not per bottle — CLOSED — 2026-11-07

Filed and closed by `fix/lot-cost-is-per-bottle`, from QA round 7c B1 (`~/Projects/p4-scratch/sw-walk/qa-report/round7-end-to-end-seams.md`, probe `round7-probes/price-base.spec.ts`).

**What was true.** `agreedPrices` (`canonical/delivery-stock.service.ts`) posted `unit_price`, stored as printed, as `finalise_delivery_cost(p_unit_cost)`. Measured at `origin/main` 259feea3f with the QA probe: `2 cases @ 264/case, pack 12` → 264 a bottle (22 is right); `142 @ base 12` → 142 (11.8333).

**What is true now.** It also reads `uom, pack_size, price_base_qty, price_base_uom` and converts each invoice line through `perBottleLotCost` (`canonical/lot-unit-cost.ts`, pure): `unit_price ÷ toBottles(price_base_qty ?? 1, price_base_uom ?? uom, pack_size)`. An unresolvable basis is refused by name; the lot stays provisional with that reason, never the printed number or 0. Claim `QA-R7C-B1-LOT-COST-IS-PER-BOTTLE`.

**Forks — the session's call under the 2026-11-07 /goal:**

1. No printed base = per one invoiced unit (`lineNetFromPrice`; PR #780 "Null means per one").
2. `pack_size` 1 on a case/pack/split-case price = not stated → refused. The column is `NOT NULL DEFAULT 1`, read so by `lineNetFromPrice`. Rejected: divide by 1, assume 12.
3. Keg per keg on a keg line passes through (`toBottles` keeps that count in kegs, as `main` did); keg/litre against another unit is refused. Rejected: refusing all opaque lines, which strands every keg lot.
4. The cost sent is rounded to cents at the seam, half away from zero: `unit_cost` is `numeric(10,2)`, and 11.8333 would defeat `finalise_delivery_cost`'s `IS NOT DISTINCT FROM` idempotency on every re-verify. A cost rounding to 0.00 is refused. Widening is QA H1, still open.
5. Several lines of one item: the last decides, as for prices; an unreadable later line unprices the item.
6. No `uom` (test doubles only; the column is `NOT NULL`) → refused.
7. An accepted proposal's price is unchanged (next entry).

## An accepted proposal's price states no unit — OPEN — 2026-11-07

`delivery_proposals.unit_price_proposed` and `unitPriceProposed` (`dto/deliveries.dto.ts`) carry no unit; `agreedPrices` still posts it as per bottle. No web or mobile caller sets it (`grep -rn unitPriceProposed apps/web/src apps/mobile/src` finds only the API type). **Closes when** the proposal states its unit and goes through the same conversion.

## Lots already finalised at a printed price are not measured — OPEN — 2026-11-07

Production was not queried. Candidates: lots finalised from an invoice line with `uom in ('case','pack','split_case')` or `price_base_qty > 1`, whose revaluation reason has no basis suffix. **Closes when** counted and revalued through `revalue_lot`.

## Landed cost is not wired, and a bottle-counted case price is invisible — OPEN — 2026-11-07

From QA round 8a (`round8-pr-retest-cost.md`). Nothing imports `landed-cost.ts` (#780/#812), so freight, fees and discounts still never reach a lot, and its tax stamp is null whenever a charge is present; both are follow-ups, not this PR. Also: a row stored as `uom 'bottle'`, qty 24, `unit_price` 264 whose paper meant "per case" with no base and no total carries nothing that says so, and still books 264. A `line_total` cross-check would catch it when a total is printed.

## Other readers of the printed `unit_price` were not audited — OPEN — 2026-11-07

The cellar ledger's `inv` CTE reads `l.unit_price` beside `qty_bottles` (`supabase/migrations/20261223060000_the_cellar_counts_the_door_checked_price.sql`) and was not checked for the same basis error. `procurement.service.ts` verify paths are PR #787's and were not touched.
