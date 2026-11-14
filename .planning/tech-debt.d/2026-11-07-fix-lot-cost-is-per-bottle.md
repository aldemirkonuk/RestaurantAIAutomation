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

## Lots already finalised at a printed price stay wrong until re-verified — OPEN — 2026-11-07

Production was not queried and nothing was backfilled. Since QA round 9a (2) (below), a lot is only corrected when someone re-verifies its delivery. **A one-off correction for the existing lots needs the founder's word.** Candidates are invoice lines with `uom in ('case','pack','split_case')` or `price_base_qty > 1` whose revaluation reason has no basis suffix. QA round 10a (7), branch `fix/cost-repair-job`: `repair-printed-cost.job.ts` walks every VERIFIED delivery through `repairPrintedCost`. It is a dry run unless `--apply` is passed, and reports each change (booked cost to per-bottle cost) and each flag as JSON. **It has not been run against production; running it is the founder's call.** **Closes when** the job is run with `--apply`, or declined on the record.

1. The repair job is a script, dry run by default. Rejected: an admin endpoint (a write path over every house, reachable from the web). The session's call under the 2026-11-07 /goal.

## A re-verify kept a lot finalised at the printed price — CLOSED — 2026-11-07

QA round 9a (2), branch `fix/reverify-repairs-printed-cost`. `verify()` on an already VERIFIED delivery (`delivery.service.ts`, the `verified_at` branch) now calls `DeliveryStockService.repairPrintedCost`. Claim `QA-R9A-2-REVERIFY-REPAIRS-PRINTED-COST`. Forks, the session's call under the 2026-11-07 /goal:

1. A lot is "booked at the printed price" when it is a final, live lot and its `unit_cost` equals a printed `unit_price` of its item, rounded to cents, and is not the per-bottle cost. Any other cost is taken as a person's revaluation and left alone. Rejected: re-posting every final lot, because `finalise_delivery_cost` would overwrite manual revaluations. A hand revaluation that happens to equal the printed price would be repaired too.
2. When the line now resolves, `finalise_delivery_cost` re-posts the per-bottle cost, with a reason naming the printed price.
3. When the line now refuses, the lot keeps its cost and the reason goes into `costNote` as `Item <id>: …`. Rejected: setting the lot back to provisional, which needs a new RPC and a migration. The web still renders `costNote` as one sentence.

Not covered: unattached lines, meaning the one-item fallback. Their price is not keyed by item, so they are neither repaired nor flagged.

QA round 10a (1)+(6), same branch. An accepted proposal's raw price now counts as printed, so a lot an earlier build booked at it is repaired. A final `invoice` lot whose cost is not a printed price and no longer matches its line is flagged `line_changed` with the current per-bottle cost; nothing is posted. Each flag carries a `kind`. Claim `QA-R10A-REVERIFY-PROPOSAL-AND-EDITED-LINE`. Forks, the session's call:

4. A lot whose line was edited after it was costed is FLAGGED, not revalued. Rejected: revaluing from the current line; the lot does not say whether its line changed or a person revalued it, and a re-verify is not a second verification (ADR 0103).

## A re-verify's correction was invisible on the page — CLOSED — 2026-11-07

QA round 10a (5), branch `fix/reverify-cost-notice`. `verify` now returns the repair itself (`repaired`, `flagged`); a VERIFIED delivery shows a "Check the cost again" button, and the page states the result in a `role="status"` notice: "Cost corrected", "Refused" with its reason, "Not corrected" for an edited line, or "nothing needed correcting". Turkish or English by the canonical-format fork. QA round 12b: a FIRST verify that leaves a lot provisional now shows each reason the same way (`costNoticeOf`); before, the page discarded the response. Claim `QA-R10A-REVERIFY-NOTICE`. Forks, the session's call:

1. The notice is built on the page from the structured repair; `costNote` keeps its sentence for other callers. Rejected: rendering `costNote` (English only, not structured).
2. A re-check button on a VERIFIED delivery, because the page had no way to re-verify one. Rejected: no button (the notice could never show).

## An unmapped unit, or a total that contradicts the price, reached the lot — CLOSED — 2026-11-07

Audit D1 and QA round 9a (1), branch `fix/unknown-unit-is-refused`. The extractor stores an unmapped unit (`kutu`, `ml`) as `each`, so `2 kutu @ 264, pack 12` booked 264; and `24 bottles @ 264` with a printed total of 528 booked 264. The extractor now keeps the unmapped glyph in the line's `printed` (`uom`, `priceBaseUom`) and `perBottleLotCost` refuses it; it also refuses a printed `line_total` that disagrees with per-bottle cost × `qty_bottles`. Claim `AUDIT-816-D1-UNMAPPED-UNIT-AND-TOTAL-REFUSED`. Forks, the session's call under the 2026-11-07 /goal:

1. The glyph goes in the existing `printed` jsonb, only where the model's own transcript left that key out. Rejected: a new column (a migration for one flag); refusing every line with a base and no base unit (no base unit means the line's own, per `lineNetFromPrice`).
2. An `each` line whose printed unit is not `each` is refused, even when the glyph might mean a piece. Rejected: refusing only listed words.
3. A contradicting total is refused, not divided by `qty_bottles`: a total can carry a deposit or an allowance. Tolerance max(0.05, 1% of the total). A line with free goods inside `qty_bottles` would be refused too.

Not covered: lines entered or corrected by a person (no `printed` glyph); the door count's unmapped unit becomes `bottle`, but it carries no money (D11).

QA round 10a (3)+(4), same branch. `normalizeUom` now maps the ordinary spellings of a piece and a bottle (`pcs`, `stk`, `btl.`, `şişe` and kin; the list is in the code); `kutu`, `box`, `carton`, `ml`, `cl` stay unmapped and refused. An `each` line whose printed glyph maps to `each` or `bottle` is costed, not refused. The `line_total` check now runs on credit-note rows by magnitude, and a zero total against a non-zero count is refused. Claim `QA-R10A-UNIT-SPELLINGS-AND-CREDIT-TOTAL`. Forks, the session's call under the 2026-11-07 /goal:

4. A credit note is compared by absolute value: per-bottle cost × |count| against |total|. Rejected: skipping signed rows (the 9a gap QA found) and requiring both signs to match (a supplier that prints the count positive and the total negative is common).
5. A glyph that means one piece counts as `each` and one that means a bottle counts as `bottle`; neither is a case. Rejected: mapping `kutu`/`box`/`carton` to `case` (their size is not on the line).

## Landed cost is unwired; some per-case prices are invisible — OPEN — 2026-11-07

QA round 8a: nothing imports `landed-cost.ts` (#780/#812), so freight, fees and discounts never reach a lot and its tax stamp is null when a charge is present. A row stored as `bottle`, qty 24, 264, pack 12, with no printed base is now refused unless its `line_total` bears out the bottle reading (QA 10a (2), the session's call: pack > 1 on a bottle/each row makes a bare price ambiguous; rejected: dividing by the pack, guessing from the item's history).

## Other readers of the printed `unit_price` were not audited — OPEN — 2026-11-07

The cellar ledger's `inv` CTE (`supabase/migrations/20261223060000_the_cellar_counts_the_door_checked_price.sql`) and `vendor-comparison.service.ts:902-913` (QA 9a). `procurement.service.ts` verify paths are #787's.
