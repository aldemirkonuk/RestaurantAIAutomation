## An invoice price reached a lot's cost as printed, not per bottle — CLOSED — 2026-11-07

QA round 7c B1 (`~/Projects/p4-scratch/sw-walk/qa-report/round7-end-to-end-seams.md`). `agreedPrices` (`canonical/delivery-stock.service.ts`) posted the printed `unit_price` as `finalise_delivery_cost(p_unit_cost)`: at `origin/main` 259feea3f, `2 cases @ 264/case, pack 12` booked 264 a bottle (22) and `142 @ base 12` booked 142 (11.8333). Now each invoice line goes through `perBottleLotCost` (`canonical/lot-unit-cost.ts`); an unresolvable basis is refused by name and the lot stays provisional, never the printed number or 0. Claim `QA-R7C-B1-LOT-COST-IS-PER-BOTTLE`.

**Forks — the session's call under the 2026-11-07 /goal:**

1. No printed base = per one invoiced unit (`lineNetFromPrice`; #780).
2. `pack_size` 1 on a case/pack/split-case price = not stated → refused (the column is `NOT NULL DEFAULT 1`). Rejected: divide by 1, assume 12.
3. Keg per keg on a keg line passes through, as on `main`; keg/litre against another unit is refused.
4. The posted cost is rounded to cents, half away from zero: `unit_cost` is `numeric(10,2)` and 11.8333 would defeat `finalise_delivery_cost`'s idempotency. A cost rounding to 0.00 is refused. Widening is QA H1.
5. Several lines of one item, read by `document_id, line_no` (audit D5): a refusal on any line holds; lines that disagree per bottle are refused, naming both. Rejected: last line wins.
6. No `uom` (test doubles only; the column is `NOT NULL`) → refused.
7. The manager's `costNote` gives each provisional item's own reason (audit D3). The web still renders it as one sentence; not changed here.

## An accepted proposal's price states no unit — OPEN — 2026-11-07

`unit_price_proposed` (`dto/deliveries.dto.ts`) carries no unit, is posted raw as per bottle, and wins over a refused invoice line. No web or mobile caller sets it (`grep -rn unitPriceProposed apps/web/src apps/mobile/src`). QA round 9a (3) re-raised it; not fixed, because `delivery_proposals` holds no unit to convert from. **Closes when** it states its unit and is converted the same way.

## Lots already finalised at a printed price stay wrong — OPEN — 2026-11-07

Production was not queried. A lot finalised wrong on `main` whose line is now refused keeps that cost: a refusal leaves a lot as it is (audit D4). Candidates: invoice lines with `uom in ('case','pack','split_case')` or `price_base_qty > 1` whose revaluation reason has no basis suffix. **Closes when** counted and revalued through `revalue_lot`.

## An unmapped unit, or a total that contradicts the price, reached the lot — CLOSED — 2026-11-07

Audit D1 and QA round 9a (1), branch `fix/unknown-unit-is-refused`. The extractor stores an unmapped unit (`kutu`, `ml`) as `each`, so `2 kutu @ 264, pack 12` booked 264; and `24 bottles @ 264` with a printed total of 528 booked 264. The extractor now keeps the unmapped glyph in the line's `printed` (`uom`, `priceBaseUom`) and `perBottleLotCost` refuses it; it also refuses a printed `line_total` that disagrees with per-bottle cost × `qty_bottles`. Claim `AUDIT-816-D1-UNMAPPED-UNIT-AND-TOTAL-REFUSED`. Forks, the session's call under the 2026-11-07 /goal:

1. The glyph goes in the existing `printed` jsonb, only where the model's own transcript left that key out. Rejected: a new column (a migration for one flag); refusing every line with a base and no base unit (no base unit means the line's own, per `lineNetFromPrice`).
2. An `each` line whose printed unit is not `each` is refused, even when the glyph might mean a piece. Rejected: refusing only listed words.
3. A contradicting total is refused, not divided by `qty_bottles`: a total can carry a deposit or an allowance. Tolerance max(0.05, 1% of the total). A line with free goods inside `qty_bottles` would be refused too.

Not covered: lines entered or corrected by a person (no `printed` glyph); the door count's unmapped unit becomes `bottle`, but it carries no money (D11).

## Landed cost is unwired; some per-case prices are invisible — OPEN — 2026-11-07

QA round 8a: nothing imports `landed-cost.ts` (#780/#812), so freight, fees and discounts never reach a lot and its tax stamp is null when a charge is present. A row stored as `bottle`, qty 24, 264, whose paper meant per case and printed no base and no total, still books 264: nothing on the row says otherwise.

## Other readers of the printed `unit_price` were not audited — OPEN — 2026-11-07

The cellar ledger's `inv` CTE (`supabase/migrations/20261223060000_the_cellar_counts_the_door_checked_price.sql`) and `vendor-comparison.service.ts:902-913` (QA 9a). `procurement.service.ts` verify paths are #787's.
