## A line with no price is written as a price of 0 — OPEN — 2026-11-01

Filed by `fix/pos-lines-carry-unit-price`, found while answering PR #712's CI gate at `07cbda755` (comment 6552434159, correctness: what `price` means on a line).

**What is true.** Every adapter writes `price: … ?? 0` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`), and `CanonicalItem.price` is a `number` (`pos-types.ts:18`). So a line whose POS gave no price is stored as one that sold for nothing, and `public.pos_item_sales` (PR #712) adds it to sales as 0 rather than counting it unreadable. Measured on production 2026-11-01: 0 of 40,732 lines carry a zero or non-numeric price (`csv_import` 40,133, `generic_webhook` 599), so no figure is wrong today. Re-run: `select count(*) filter (where jsonb_typeof(l->'price') <> 'number' or l->'price' = '0'::jsonb) from pos_checks c, jsonb_array_elements(c.items) l`; a claims row cannot, since the claims runner is static and has no production read.

**What closes it.** `CanonicalItem.price` becomes `number | null`, the adapters write null for an absent price, and every reader of `pos_checks.items` is checked to treat null as unknown.

## A provider line's sale leaves out its modifiers and line discounts — OPEN — 2026-11-01

Filed with the entry above.

**What is true.** Square, Toast and Clover lines carry one unit's list price, before modifiers and discounts (`pos-adapters.ts`, the line convention in its header). So a priced modifier (a large pour) and a line discount are in neither `qty` nor `price`. ADR 0298 names check discounts as left out of sales (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md`, "Not in these figures"), but not modifiers or line discounts. No Square, Toast or Clover check is on production (2026-11-01, `select source, count(*) from pos_checks group by 1`: `csv_import` 4,052, `generic_webhook` 145, nothing else), so no figure is wrong today.

**What closes it.** The next PR that edits ADR 0298 names both in "Not in these figures", or the slice that settles 'net' (ADR 0295) prices them onto their lines.

## A Toast line without `receiptLinePrice` is stored on the net basis — OPEN — 2026-11-01

Filed from PR #713's CI gate at `8067695d0` (comment 6552812737: compliance, the blocking finding; correctness, note 3).

**What is true.** Toast's Selection schema does not require `receiptLinePrice`; it is "Populated based on the menu configuration". When a selection has none, `toastUnitPrice` (`apps/api-gateway/src/pos-hub/pos-adapters.ts`) stores `price` over the quantity: one unit's share of the net price, after modifiers and line discounts. Every other line carries one unit's list price, before both. `public.pos_item_sales` (PR #712) then sums the two bases together, and nothing on a stored line says which basis it used. Measured on production 2026-11-01 by the same query as the entry above: no Toast check exists, so no figure is wrong today.

**Why the fallback stays.** It is the executor's call under the founder's 2026-10-31T16:57:09Z goal. The net share is the selection's own amount; a 0 would drop the sale. Whether a sale is list or net is ADR 0295's 'net', which is still open.

**What closes it.** One of three things:
- ADR 0295 settles 'net', and every adapter writes that basis;
- each line records its basis, and `pos_item_sales` counts the net-basis lines apart;
- the fallback writes no price, once `CanonicalItem.price` may be null (the first entry above).
