# 0324 — An invoice in another money than its order is held for the owner: not compared, not refused

- **Status:** Proposed. Decided by the coordinator under the founder delegation of 2026-10-07 (20:04:10Z, quoted in full in [[0317-only-an-owner-or-manager-rules-a-day-out]]). This is the coordinator's call, not the founder's pick; he can overrule any part of it, and a lock is his.
- **Date:** 2026-10-09
- **Decider:** the coordinator, under the delegation above. Built by sim lane `cross-currency-compare` (`fix/sim-cross-currency-compare` fc3a8cb1d, stacked on `fix/sim-invoice-match-currency` a220bd031). Both branches are **local only, not merged** at the date of this record.
- **Applies:** rule 3 of `supabase/migrations/20260905120000_a_house_names_its_money.sql` (*nothing converts; a reader that would compare figures in different currencies refuses in words*) to the receiving price check, as [[0322-a-lot-cost-states-its-currency]] applied it to stock.
- **Keywords:** currency, invoice match, computeMatch, priceEquals, poCurrency, invoiceCurrency, differentMoney, currency_differs, price_verified, price_variance, requiresOverride, verifyReceipt, vendor scorecard, ReceivingWorkspace, priceDiffers, discrepancy queue, match_status, F-341
- **Links:** [[0104-every-incoming-document-renders-as-one-canonical-mudavym-document]] (amendment of 2026-09-06, batch 64: a held invoice refuses the price at the door, stock proceeds); [[0322-a-lot-cost-states-its-currency]]; [[0323-the-vendor-letter-names-the-agreements-money-else-the-houses]]; [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] Q25; sim ledger S45 (`p4-scratch/sim-ledger.md`, outside the repo)

## Context

Code cites are on `fix/sim-invoice-match-currency` a220bd031, where the defect was re-verified.

`computeMatch` (`apps/api-gateway/src/procurement/invoice-match.ts:627`) decides the price check with `priceEquals(poUnitPrice, invoiceUnitPrice)`, whatever money each number is in. `poCurrency` and `invoiceCurrency` (`:147`, `:179-180`) were added for the words only. So:

- An order agreed at 20.00 EUR and billed 20.00 TRY reads `price_verified = true` and the summary says *"All N accepted at the agreed price"* (`:820`). That is false.
- Agreed 20.00 EUR and billed 700.00 TRY reads `price_variance`, and `verifyReceipt` asks the desk to accept a price difference with a reason (422). The difference is between two moneys and means nothing.
- `price_verified = false` then feeds the vendor scorecard (`apps/api-gateway/src/providers/scorecard/vendor-scorecard.ts:887`), which prints a percent *"off the agreed price"* worked across the two currencies. A NULL is already read there as "not checked" (`:850`).
- The web mirror (`apps/web/src/lib/invoiceMatch.ts`), `ReceivingWorkspace.tsx` `priceDiffers`, and the mobile mirror (`apps/mobile/src/lib/invoiceMatch.ts`) do the same.

## Options considered

1. **Refuse the verification (400/422) when the two moneys differ.**
2. **Hold the price check as "not compared", and let the owner decide.**
3. **Convert with a rate.**
4. **Treat it as a price variance that needs an override reason** (today's 422 with a reason box).
5. *(Doing nothing:* a delivery billed in another money reads as "at the agreed price" or as a vendor overcharging, depending on the numbers.)*

## Decision

**When the order and the invoice each state a money and the two differ, the price is not compared and the receipt is not refused. The price check is held, and the owner decides (option 2).**

1. **When it applies.** Both codes are stated and differ, trimmed and case-insensitive (`differentMoney`). A missing code is legacy or unknown and compares as before: the same leniency as F-339 and ADR 0322 ("NULL reads as before").
2. **The price check** is `ok: null` and says, in words: *"The price was not compared: the agreement is in EUR and the invoice is in TRY, and nothing here converts one into the other. You decide whether this price is right."*
3. **No refusal.** `requiresOverride` is false, so there is no 422 and no reason box. `verifyReceipt` writes `price_verified = NULL` ("nobody checked"), which the scorecard already leaves out as not checked.
4. **A new verdict `currency_differs`.** It ranks after the verdicts that can be claimed (last of them `rejected`) and before `partial` (`invoice-match.ts:759` at fc3a8cb1d). A delivery that is otherwise clean must not read `matched`, because that is the false "at the agreed price". It lands in the discrepancy queue (`match_status <> 'matched'`), so the owner sees it. It cannot be claimed, because no money is proven owed. Lane: "accepted — paper disagrees"; chip: "Different money".
5. **Never dropped.** When another verdict headlines (for example `qty_short`), the summary still carries the "not compared" sentence.
6. **Every mirror says the same.** The web mirror and `ReceivingWorkspace` `priceDiffers` (no override box for a price in another money) follow the gateway, and the parity test pins web to gateway. The mobile mirror owes the same change (see Consequences).

What carried it: the count at the door is a physical fact and the price question is not, so the price is the only thing held. This is the shape the founder gave for an invoice whose money is unknown (ADR 0104, batch 64: *"stock proceeds refuse the price at receving, and let them approve if otherwise"*), and it keeps rule 3: nothing converts.

**How this sits with ADR 0104's refusal.** ADR 0104's 409 fires when an attached invoice's money is **not filed** (unknown). That gate runs first in `verifyReceipt`, before the match is computed, and this record does not change it. This record covers the next case: both moneys are **known** and **differ**. A filed invoice may lawfully be in another money from its order; batch 65 lets *"the user or the manager … change the invoice if needed"*, so a person may have confirmed it. Refusing it again would ask the desk to "correct" a currency that is right. The approval batch 64 asks for is here the owner's decision on the discrepancy queue, not a reason typed at the door.

`procurement_orders.match_status` is `varchar(30)` with no CHECK (`supabase/migrations/20260805000000_baseline_from_production.sql:4564`), so the new verdict needs no migration.

## Consequences

**One leniency, stated rather than hidden:** a missing code on either side compares as before. Refusing it would hold every delivery booked before currencies were stated.

**Not covered, owed:**

- **The mobile mirror** (`apps/mobile/src/lib/invoiceMatch.ts`) still compares the two numbers and still prints `$`. Measured: `currency_differs` appears 0 times in that file at fc3a8cb1d.
- **Price history and `effectiveUnitCost`** still read a price across currencies (sim ledger S45, `fix/sim-cross-currency-compare` row).
- **No rate field anywhere.** If the founder wants a conversion, that is a new design: a rate a person states, as the auction-lot form does.

**Revisit when:** a house needs the two prices compared in one money, or the founder wants a different-money price refused at the door rather than held.

### Rejected

- **Refuse the verification (option 1).** The count is physical fact (batch 64: *"stock proceeds"*); refusing the whole verification blocks the quantity, damage and credit checks over a price question. It also forces the desk to "correct" a currency that may be right, since a vendor can bill in TRY for a deal written in EUR.
- **Convert with a rate (option 3).** There is no rate anywhere in this system; inventing one invents the answer (rule 3; ADR 0322's option 2). The receiving flow has no field for a rate a person types, and adding one is a separate design.
- **A price variance with an override reason (option 4).** This is today's 422 with a reason box. It asks the owner to "accept a difference" that was never measured, and it records `price_verified = false`, which the scorecard reads as the vendor billing off the agreed price.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-09 | — | Created from the coordinator's decision note `p4-scratch/sim-run/bulletproof/wave8/cross-currency-compare-decision.md` (outside the repo). Code cites re-checked at a220bd031 (defect) and fc3a8cb1d (built shape) |
