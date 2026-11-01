## A line with no price is written as a price of 0 — OPEN — 2026-11-01

Filed by `fix/pos-lines-carry-unit-price`, found while answering PR #712's CI gate at `07cbda755` (comment 6552434159, correctness: what `price` means on a line).

**What is true.** Every adapter writes `price: … ?? 0` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`), and `CanonicalItem.price` is a `number` (`pos-types.ts:18`). So a line whose POS gave no price is stored as one that sold for nothing, and `public.pos_item_sales` (PR #712) adds it to sales as 0 rather than counting it unreadable. Measured on production 2026-11-01: 0 of 40,732 lines carry a zero or non-numeric price (`csv_import` 40,133, `generic_webhook` 599), so no figure is wrong today. Re-run: `select count(*) filter (where jsonb_typeof(l->'price') <> 'number' or l->'price' = '0'::jsonb) from pos_checks c, jsonb_array_elements(c.items) l`; a claims row cannot, since the claims runner is static and has no production read.

**What closes it.** `CanonicalItem.price` becomes `number | null`, the adapters write null for an absent price, and every reader of `pos_checks.items` is checked to treat null as unknown. Claim `POS-LINE-PRICE-MAY-BE-UNKNOWN` (open) fails the build once the type allows null, so this entry is struck when it does.

## A Square or Clover line's sale leaves out its modifiers and line discounts — OPEN — 2026-11-01

Filed with the entry above.

**What is true.** Square and Clover lines carry one unit's list price, before modifiers and discounts (`pos-adapters.ts`, the line convention in its header), so a priced modifier (a large pour) and a line discount are in neither `qty` nor `price`. A Toast line carries its net amount instead (third entry). ADR 0298 named only check discounts as left out of sales; this PR adds these to its "Not in these figures" (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md`). No Square, Toast or Clover check is on production (2026-11-01, `select source, count(*) from pos_checks group by 1`: `csv_import` 4,052, `generic_webhook` 145, nothing else), so no figure is wrong today.

**What closes it.** OD-244's answer, then a slice that prices modifiers and discounts onto lines on the basis it picks. ADR 0295's 'net' bears on the discounts.

## A Toast line carries its net amount, every other line its list price — OPEN — 2026-11-01

Filed from PR #713's CI gate at `8067695d0` (comment 6552812737), `24a9fa622` (comment 6553047188) and `c84b11ed2` (comment 6553844563, its correctness report cut off at the `receiptLinePrice` preference). Each found Toast selections the list reading got wrong: one without `receiptLinePrice`, one whose `receiptLinePrice` is 0 with the money in its modifiers, then which selections the preference applied to at all. The fork is OD-244 (`../decisions/OPEN-DECISIONS.md`).

**What is true.** Toast's only amount on a selection with its modifiers in it is `price`, net of its own discounts and the check's (Selection schema: "including discounts at the check level"). `receiptLinePrice` leaves modifiers out, and `preDiscountPrice` is documented as receiptLinePrice × quantity (Toast's Order object summary). So `toastUnitPrice` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`) stores `price` over the quantity for every selection, while Square and Clover lines carry list price. `public.pos_item_sales` (PR #712) sums both bases, nothing on a stored line says which, and a Toast house's sales are after the check discounts ADR 0298 keeps out of them. No Toast check is on production (the query above), so no figure is wrong today.

**Stated assumption (CLAUDE.md §5), pending OD-244.** Every Toast line keeps `main`'s reading of `price`, divided by its quantity so that price × qty is the selection's own amount. This PR changes Toast's arithmetic, not its basis. It is not an answer to OD-244.

**What closes it.** OD-244's answer, recorded in an ADR, and the adapters changed to match.
