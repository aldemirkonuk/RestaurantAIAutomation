## A line with no price is written as a price of 0 — OPEN — 2026-11-01

Filed by `fix/pos-lines-carry-unit-price`, found while answering PR #712's CI gate at `07cbda755` (comment 6552434159, correctness: what `price` means on a line).

**What is true.** Every adapter writes `price: … ?? 0` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`), and `CanonicalItem.price` is a `number` (`pos-types.ts:18`). So a line whose POS gave no price is stored as one that sold for nothing, and `public.pos_item_sales` (PR #712) adds it to sales as 0 rather than counting it unreadable. Measured on production 2026-11-01: 0 of 40,732 lines carry a zero or non-numeric price (`csv_import` 40,133, `generic_webhook` 599), so no figure is wrong today. Re-run: `select count(*) filter (where jsonb_typeof(l->'price') <> 'number' or l->'price' = '0'::jsonb) from pos_checks c, jsonb_array_elements(c.items) l`; a claims row cannot, since the claims runner is static and has no production read.

**What closes it.** `CanonicalItem.price` becomes `number | null`, the adapters write null for an absent price, and every reader of `pos_checks.items` is checked to treat null as unknown. Claim `POS-LINE-PRICE-MAY-BE-UNKNOWN` (open) fails the build once the type allows null, so this entry is struck when it does.

## A provider line's sale leaves out its modifiers and line discounts — OPEN — 2026-11-01

Filed with the entry above.

**What is true.** Square, Toast and Clover lines carry one unit's list price, before modifiers and discounts (`pos-adapters.ts`, the line convention in its header; the Toast exception is the third entry). So a priced modifier (a large pour) and a line discount are in neither `qty` nor `price`. ADR 0298 named only check discounts as left out of sales; this PR adds these two to its "Not in these figures" (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md`). No Square, Toast or Clover check is on production (2026-11-01, `select source, count(*) from pos_checks group by 1`: `csv_import` 4,052, `generic_webhook` 145, nothing else), so no figure is wrong today.

**What closes it.** A slice prices them onto their lines. ADR 0295's 'net' bears on the line discounts.

## A Toast line without a list price is stored on the net basis — OPEN — 2026-11-01

Filed from PR #713's CI gate at `8067695d0` (comment 6552812737) and widened at `24a9fa622` (comment 6553047188), whose blocking case was a `receiptLinePrice` of 0. The fork is OD-244 (`../decisions/OPEN-DECISIONS.md`).

**What is true.** Toast's Selection schema does not require `receiptLinePrice` ("Populated based on the menu configuration"), and an item whose menu price is 0, with the money in its modifiers, reads 0. For either, `toastUnitPrice` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`) stores `price` over the quantity: one unit's share of the net amount, after modifiers and line discounts. Every other line carries one unit's list price, before both. `public.pos_item_sales` (PR #712) sums the two bases together, and nothing on a stored line says which basis it used. Measured on production 2026-11-01 by the second query above: no Toast check exists, so no figure is wrong today.

**Stated assumption (CLAUDE.md §5), pending OD-244.** Such a line keeps `main`'s reading of Toast's `price`, the net amount, divided by its quantity so that price × qty is the selection's own amount. On `main` every Toast line stores that amount undivided; this PR narrows the net basis to the lines Toast gives no list price. It is not an answer to OD-244.

**What closes it.** OD-244's answer, recorded in an ADR, and the adapter changed to match.
