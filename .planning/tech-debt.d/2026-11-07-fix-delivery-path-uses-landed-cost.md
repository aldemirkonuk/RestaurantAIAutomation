## The delivery path posts the landed cost; seven things stay open — OPEN — 2026-11-07

Filed by `fix/delivery-path-uses-landed-cost` (cost-math proposal lane 1.4; each fork below is the session's call under the founder's /goal of 2026-11-07). Its fixtures are synthetic, not real TR papers.

**What is true.** At VERIFIED, `DeliveryStockService.agreedPrices` reads each invoice's header money columns and line kinds and hands every line to `landDelivery` (`canonical/paper-landed-cost.ts`). That function runs `landedCost` (`procurement/landed-cost.ts`, unedited) once per paper and pools each item as Σ accepted landed value ÷ Σ accepted bottles, with accepted bottles taken from what the door booked. Pinned by `claims.d/fix-delivery-path-uses-landed-cost.jsonl` and by the "VERIFIED posts the landed cost (lane 1.4)" block in `delivery-stock.service.spec.ts`.

This closes the freight/fee/discount half of "Landed cost is unwired" (`2026-11-07-fix-lot-cost-is-per-bottle.md:43`) **for the delivery path only**. The other half — a per-case price stored as `bottle` with no base and no total — is unchanged. It also wires "The landed-cost rule is unwired" (`2026-11-07-feat-landed-cost-one-rule.md:1`) into the delivery path; `verifyReceipt` still costs its own way.

Still open:

- **The cost is not posted in one transaction.** `finalise_delivery_cost` is called once per item. A failure partway leaves some lots final and the rest provisional. A retry posts the same cent-rounded values, so the RPC's `IS NOT DISTINCT FROM` skip keeps it idempotent. A delivery-wide RPC needs a migration, and this lane had none.
- **No tax column.** Every lot is costed as printed. `houseTaxForLotCost()` returns `unset` (ADR 0359 C2, Proposed in #784; lane 3.5a builds the columns). The null `cost_tax_basis` and the tax sentence live only in `FinalisedItem.landed` and in the revaluation's `reason` text; no column stores them.
- **The order path is untouched.** `procurement.service.ts` `verifyReceipt` (#787) and the order-side cost (lane 1.3) do not land cost.
- **A narrow re-verify regression against #838.** `repairPrintedCost` revalues a lot booked at a printed, non-per-bottle price to its landed cost. When that item's paper is held, it flags the item instead of posting the plain per-bottle price #838 would have posted. Papers are held by a refused line with charges, a short count over two lines, a missing header, or an unpriced line with bottles. Lots already final at a true per-bottle price are never re-landed.
- **A fee printed as a line is not shared.** Only the header's charge totals (freight, fuel, split-case, delivery, other) are shared; a `fee` or `deposit` line is named in the paper's left-out sentence. Whether intake ever files one fee as both a line and a header total is untraced.
- **An unpriced line with bottles now holds.** #838 skipped it. With charges on the paper, every item on that paper stays provisional, because the charge cannot be shared without that line's value.
- **Two unattached lines are not paired.** One booked item and two lines with no `inventory_id` (say, paid + free) stay unpriced, unless a proposal settles them.
