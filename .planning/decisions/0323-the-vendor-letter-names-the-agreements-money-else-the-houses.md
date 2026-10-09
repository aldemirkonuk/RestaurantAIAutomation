# 0323 — The vendor letter names the agreement's money, else the house's, and never a `$` by default

- **Status:** Proposed. Decided by the coordinator under the founder delegation of 2026-10-07 (20:04:10Z, quoted in full in [[0317-only-an-owner-or-manager-rules-a-day-out]]). This is the coordinator's call, not the founder's pick; he can overrule any part of it, and a lock is his.
- **Date:** 2026-10-09
- **Decider:** the coordinator, under the delegation above. Built by sim wave 6 lane `price-notes-currency` (`fix/sim-price-notes-currency` 4c51e069e, off `origin/main`), **local only, not merged** at the date of this record. No send path was touched: the letter's text changed, the call that sends it did not.
- **Keywords:** currency, vendor letter, confirmation letter, order confirmation, describeConfirmedOrderTerms, describeAgreedPrice, moneyIn, readHouseCurrency, agreed-price, procurement_order_items.currency, restaurants.currency, wording only, F-341
- **Links:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] Q25 (a house names its money; nothing converts), Q31 (the agreement line names its money, *"defaulted from the vendor's terms or the house"*), and the B2 narrowing in `apps/api-gateway/src/procurement/agreement-currency.ts:240-273` (the ORDER's field is never pre-filled from the house); [[0322-a-lot-cost-states-its-currency]]; sim ledger S44 (`p4-scratch/sim-ledger.md`, outside the repo)

## Context

Code cites are on `origin/main` c587469bf unless a branch is named.

The confirmation letter a house sends its vendor printed every price under a `$`: `describeConfirmedOrderTerms` wrote `` ` at $${…toFixed(2)} per ${unit}` `` and `agreed-price.ts` wrote a bare `$` into every working sentence (goods total, fees, per-bottle note, door comparison). A euro or lira agreement was worked, logged and mailed as dollars (F-341, gateway half; the web `/orders` half is `fix/sim-orders-currency`).

The fix gives every sentence the money of the line it describes. The letter then needs an answer for a line that names no money: `procurement_order_items.currency` is nullable with no default (Q31, `20260905200000_the_agreement_names_its_money.sql`), and every agreement written before that column says nothing.

## Options considered

1. **The agreement line's money, else the house's, else the bare figure.** The house's money is read only to word the letter (`readHouseCurrency`); nothing is stored from it.
2. **The agreement line's money, else the bare figure.** Never borrows the house's money; a letter for an older order says "at 12.00 per bottle".
3. **The agreement line's money, else refuse to send the letter.** Blocks a confirmation over wording.
4. **Keep `$`.** The defect.

## Decision

**The letter's price line names the agreement line's own money; when the line names none, the house's money (`restaurants.currency`), read for wording only; with neither, the bare figure. Never `$` by default, and never USD by inheritance.** Working notes (not mailed) say "currency not recorded" where the letter prints the bare figure.

What carried it: the letter is the house writing to its own vendor about a price the house itself entered, so stating it in the house's money says what the house means. Q31 already lets the house stand in as the agreement line's default (*"defaulted from the vendor's terms or the house"*). A bare figure is ambiguous to a vendor who bills in two currencies, and refusing to send blocks a confirmation over a sentence.

## Consequences

- A euro or lira agreement is confirmed in euros or lira; an older agreement is confirmed in the house's stated money.
- **The tension, stated.** B2 (founder, 2026-09-06) narrowed Q31 for the ORDER's own field: the house's money may be shown but never pre-filled, because a house-filled code would read as a person's choice. The letter is not a record: it writes nothing to `procurement_order_items.currency`, `procurement_orders.currency` or any sighting, and the confirm path's `currencyClaim` still says "not stated" rather than inheriting the house's (`procurement.service.ts`, the Q31 comment at the confirm write). But the letter does tell the vendor a money no paper of theirs names. If the founder reads B2 as covering outbound words too, option 2 is the change: drop the `readHouseCurrency` fallback at the letter call site.
- **Not consulted:** the order header's own currency (`procurement_orders.currency`, `vendor_usual` or `typed`) is not tried between the line and the house. `createOrder` writes both from the same request, so they normally agree; an order whose header names a currency and whose line does not would be worded in the house's money. Not measured on production.
- **Revisit when:** a vendor queries the money on a confirmation, or an invoice arrives in a currency other than the one its confirmation letter named.
- Still open from the same lane: `invoice-match.ts:296` keeps a local `$` `money()` (taken up by `fix/sim-invoice-match-currency`), and the agreed-versus-billed comparison across two currencies is its own decision.

### Rejected

- **2, bare figure only** — ambiguous to the vendor, and it drops a money the house has stated about itself. It is the fallback if the founder rules B2 covers the letter.
- **3, refuse to send** — a confirmation is not worth blocking over its wording.
- **4, `$`** — the defect.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-09 | sim wave 6 audit (wf_820f143f-0bf) | `fix/sim-price-notes-currency` 4c51e069e PASS first round; EUR/TRY/GBP/unknown specs fail on `origin/main` and pass there, including a `confirmDeal` test with the mail send stubbed out |
| 2026-10-09 | — | Created; the sim ledger S44 named this "ADR line owed" |
