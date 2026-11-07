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

## An accepted proposal's price states no unit — CLOSED — 2026-11-07

QA round 10a (1), branch `fix/lot-cost-proposal-and-case-row`. `unit_price_proposed` posted raw as per bottle. Now it goes through `perBottleLotCost` with its line's `uom`, `pack_size` and price base; a refusal leaves the lot provisional by name. Claim `QA-R10A-PROPOSAL-AND-BOTTLE-ROW-PER-BOTTLE`. **Fork, the session's call:** a proposal is a counter to its line's printed price, so it is in that line's price base (documented on the DTO). Rejected: per bottle (silently 12x on a case line), refusing all proposals. A proposal on no line has no unit and is refused, no longer the one-item fallback.

QA round 12b (D1, C), same branch. A proposal keyed to the door count, which prints no price, was read per bottle (240 a case booked 240 a bottle). It is now read in the base of the item's invoice line, or of the delivery's only invoice line when that line names no item; none, or several that settle different bases, and it is refused by name. A proposal on a bottle row whose total bore out its printed price was refused, because the proposal path dropped the total; `proposalPerBottle` now takes the base the line's own facts settle. Claim `QA-R10A-PROPOSAL-AND-BOTTLE-ROW-PER-BOTTLE`, restated. Forks, the session's call:

1. A refused proposal still holds the lot provisional, and the countered invoice price is not booked in its place. Rejected: falling back to the invoice price (a price both sides set aside).
2. A proposal stays in its line's price base (D2: 20 typed per bottle on a case line books 1.67). Rejected for now: a separate per-bottle field; no caller sends the price yet.

## A case row read as bottles, with a total that agrees, books a case's price — OPEN — 2026-11-07

QA round 12b K. `2 bottle @ 264, pack 12, total 528` is self-consistent, so the total check passes and 264 is booked a bottle. No fact on the line can tell it from two real bottles. **Closes when** the door count's bottles are compared with the invoice line's (24 counted against 2 invoiced), or the founder declines it.

## Lots already finalised at a printed price stay wrong — OPEN — 2026-11-07

Production was not queried. A lot finalised wrong on `main` whose line is now refused keeps that cost: a refusal leaves a lot as it is (audit D4). Candidates: invoice lines with `uom in ('case','pack','split_case')` or `price_base_qty > 1` whose revaluation reason has no basis suffix. **Closes when** counted and revalued through `revalue_lot`.

## Landed cost is unwired; some per-case prices are invisible — OPEN — 2026-11-07

QA round 8a: nothing imports `landed-cost.ts` (#780/#812), so freight, fees and discounts never reach a lot and its tax stamp is null when a charge is present. A row stored as `bottle`, qty 24, 264, pack 12, with no printed base is now refused unless its `line_total` bears out the bottle reading (QA 10a (2), the session's call: pack > 1 on a bottle/each row makes a bare price ambiguous; rejected: dividing by the pack, guessing from the item's history). An unmapped unit (`kutu`, `ml`) stored as `each` is audit D1, on the stacked branch `fix/unknown-unit-is-refused`.

## Other readers of the printed `unit_price` were not audited — OPEN — 2026-11-07

The cellar ledger's `inv` CTE (`supabase/migrations/20261223060000_the_cellar_counts_the_door_checked_price.sql`). `procurement.service.ts` verify paths are #787's.
