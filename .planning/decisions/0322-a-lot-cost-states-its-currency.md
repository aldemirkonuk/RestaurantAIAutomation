# 0322 — A lot's cost states its currency, and margin and stock value never compare across currencies

- **Status:** Proposed. Decided by the coordinator under the founder delegation of 2026-10-07 (20:04:10Z, quoted in full in [[0317-only-an-owner-or-manager-rules-a-day-out]]). This is the coordinator's call, not the founder's pick; he can overrule any part of it, and a lock is his.
- **Date:** 2026-10-09
- **Decider:** the coordinator, under the delegation above. Built by sim wave 6 lane `lot-currency` (`fix/sim-lot-currency` 094990747) and wave 7 lane `revalue-currency` (`fix/sim-revalue-currency` 10d62a416, stacked on it). Both branches are **local only, not merged** at the date of this record.
- **Amends:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]], section "A house names its money, and a recorded price names its own (2026-09-05)" (Q25). That section points here.
- **Keywords:** currency, unit_cost, unit_cost_currency, inventory_lots, inventory_lot_rollup, wac, cost_currency, cost_currency_count, resolveUnitCost, other_currency, margin advice, stock value, menu engineering, apply_stock_movement, finalise_delivery_cost, revalue_lot, transfer_stock, verifyReceipt, invoiceCurrency, F-343
- **Links:** `supabase/migrations/20260905120000_a_house_names_its_money.sql` (rule 3: nothing converts); [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] Q25/Q31; F-339 (an order naming no currency is added in); sim ledger S44/S45 (`p4-scratch/sim-ledger.md`, outside the repo)

## Context

Code cites are on `fix/sim-money` 421772b91 (the lane's base), where the defect was re-verified.

Rule 3 of `20260905120000_a_house_names_its_money.sql` — *nothing converts; a reader that would compare figures in different currencies refuses in words* — never reached stock.

- `inventory_lots.unit_cost numeric(10,2)` carries no currency (baseline `:3180`).
- Delivery books the order's per-bottle price, in the ORDER's currency, through `apply_stock_movement` (`procurement.service.ts:5389` builds it, `:5427` passes `p_unit_cost`). Verify overwrites it with the invoice's price through `finalise_delivery_cost` (`delivery-stock.service.ts:418`), in the INVOICE's currency. Receipt verification restates it again through `revalue_lot`.
- `inventory_lot_rollup.wac` averages every costed live lot of an item whatever its money. `resolveUnitCost` (`analytics/inventory-cost.ts:124`) hands that average to margin advice (`margin-advice.service.ts:253`, "raise to X" against `menu_price_current`, which is in the house's money), to stock value (`analytics.service.ts:167`, `:185`) and to menu-engineering margin (`advanced-analytics.service.ts:102`).

So a house buying from a vendor that bills in EUR and selling in TRY got margin advice worked from euros read as lira.

## Options considered

1. **A currency column on the lot.** Nullable `inventory_lots.unit_cost_currency`, ISO-checked; every writer states it; readers refuse a mismatch.
2. **Convert at delivery into the house's money.** There is no exchange rate anywhere in this system (rule 3); inventing one invents the answer. (The auction-lot form converts with a rate a PERSON types, a stated fact; a delivery has no such person.)
3. **Infer the currency at read time** from `source_order_id`. A lot priced by an invoice in another money, or a lot with no order, has nothing to infer from; every reader would re-join orders and documents, and the answer would differ by reader.
4. **Refuse to book a foreign-money delivery.** Stock is a physical fact; refusing the bottles because of their price's currency breaks the door count.
5. *(Doing nothing:* margin advice keeps telling an owner to price a wine from a cost in the wrong money.)*

## Decision

**Every place that writes or restates a lot's `unit_cost` also states the money it is in (option 1). Nothing converts; a reader that would set a cost against a figure in another money refuses.**

Where the money comes from:

1. **Booking** (delivery, `apply_stock_movement` with an order): the order's currency, copied by the trigger `a_lot_cost_takes_its_order_currency` on insert or on a change of `unit_cost` / `source_order_id`, only when the lot names none, only from an order of the same house. It is atomic with the ledger write, and it survives `transfer_stock`, which re-inserts a moved lot keeping `source_order_id` and no other column.
2. **Cost settled at verified** (`finalise_delivery_cost`, the canonical delivery path): the invoice's stated currency, one code across the delivery's invoices, else the order's. Two invoices naming two codes stamp nothing and log it; the lots keep the order's code.
3. **Cost restated at receipt verification** (`revalue_lot` from `verifyReceipt`): the invoice's stated code (`invoiceCurrency`), else the order's, stamped on every live lot of that order for that item. `revalue_lot` is unchanged and the trigger only fills a missing code, so without this step a TRY-booked lot restated at a EUR price kept saying TRY.
4. **Everything else:** NULL. Nothing is guessed. The backfill only copies `procurement_orders.currency` onto costed lots whose `source_order_id` names an order of the same house.

Readers: `inventory_lot_rollup` gains `cost_currency` (the one code among the lots the WAC averages) and `cost_currency_count`. `resolveUnitCost(row, lot, houseCurrency)` returns no cost, basis `other_currency`, when the WAC mixes codes or its one code is not the house's. Margin advice then says the wine was bought in a different currency from the menu prices instead of "raise to X"; stock value goes empty with the coverage sentence naming why.

Migration `a_lot_cost_states_its_currency` (cited by slug: the version is assigned at merge) is additive: one nullable column, an ISO 4217 CHECK, the trigger, the same-house backfill, and two columns appended to the rollup view.

What carried it: it is the only option that keeps rule 3 (no rate) and still lets every reader answer from the row in front of it.

## Consequences

**Two leniencies, stated rather than hidden:**

- **A lot with NULL currency reads as comparable.** Every lot booked before the column is NULL; refusing them would blank every house's margin advice overnight. Same rule as F-339's order sum ("an order naming no currency is added in").
- **A house with no stated currency (`restaurants.currency` NULL) and one lot code reads as comparable.** The menu price's money is then unknown too; refusing would blank advice for every house that has not answered the currency question. A MIX of lot codes still refuses. The strict reading is one line in `resolveUnitCost`.

**A failed stamp at 2 or 3 is logged, not a refused verification.** The price is already written and the lot keeps the order's code. Making it atomic means changing `finalise_delivery_cost` / `revalue_lot` to take a currency; not done, because the gateway already holds the code and those RPCs are shared ledger primitives.

**Not covered:** `last_purchase_price` carries no currency and has no write site (`inventory-cost.ts` header). The inventory page's WAC (`inventory.service.ts:178`) and `price-locks.service.ts:234` read the rollup without the new columns; the inventory page compares with no menu price, and price-locks reaches `adviseWine`, which gets the house's money through `HouseTerms`.

**Revisit when:** a house needs a value in its own money for stock bought in another (that needs a rate a person states, as the auction form does), or when the founder wants the strict reading of either leniency.

### Rejected

- **Convert at delivery** — no rate exists; inventing one invents the answer.
- **Infer at read time** — nothing to infer from for an invoice-priced or order-less lot.
- **Refuse the delivery** — stock is physical fact.
- **A follow-up UPDATE from the gateway after `apply_stock_movement`** for booking — not atomic; a failed second write leaves NULL, which readers treat as legacy, i.e. silently.
- **A new `p_unit_cost_currency` on `apply_stock_movement`** — redefines a 17-argument ledger RPC for one column, and `transfer_stock` would still drop it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-09 | sim wave 6 audit (wf_820f143f-0bf) | `fix/sim-lot-currency` 094990747 PASS first round; `supabase/tests/…_a_lot_cost_states_its_currency_test.sql` fix PASS / control FAIL (pgtest2 lane, main c587469bf) |
| 2026-10-09 | sim wave 7 audit (wf_cfea932c-1c8) | `fix/sim-revalue-currency` 10d62a416 PASS first round; `lot-cost-truth.spec.ts` "the restated lots take the invoice's currency" fails on 094990747 and passes there |
| 2026-10-09 | — | Created from the coordinator's decision note `p4-scratch/sim-run/bulletproof/wave6/lot-currency-decision.md` and the draft `adr-0117-q25-amendment.md` (both outside the repo) |
