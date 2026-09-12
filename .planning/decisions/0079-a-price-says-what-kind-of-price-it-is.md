# 0079 — A price says what kind of price it is, and a correction corrects

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cost provenance, invoice, estimated, lot, WAC, revaluation, revalue_lot, apply_stock_movement, inventory_transaction_source, receipt verification, landed cost, three-way match, inventory_lot_revaluations
- **Links:** `[[0059-receiving-preserves-the-pair]]` (a confirmation must not destroy the proposal it confirms), `[[0053-analytics-cost-unknown-not-invented]]` (`resolveUnitCost`, the consumer of everything decided here), `[[0051-rebuilt-pages-show-live-data-only]]` (absence is not agreement), `[[0057-receiving-write-path-integrity]]` (the door path that got the same enum right), PR for `fix/lot-cost-truth`

## Context

Three defects sat in the same six lines of arithmetic, and each one hid the next.

**A price with nothing said about it became an invoice.**
`supabase/migrations/20260805130000_extend_apply_stock_movement.sql:66-69`:

```sql
v_provenance := COALESCE(
  p_cost_provenance,
  CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END
);
```

Any caller passing a number without stating what *kind* of number it was got
`'invoice'` for free. `markDelivered` did exactly that with the purchase
order's own agreed price (`procurement.service.ts:1430,1451`) — a price nobody
had checked against a document, because `markDelivered` runs when the pallet
arrives and `verifyReceipt` is the step where a human reads the invoice. The
lot was stamped invoice-verified, `inventory_lot_rollup.has_invoice_cost` went
true, and `inventory-cost.ts:91-95` then labelled the number
`"invoiced lot WAC"` for analytics. Eight hundred lines away,
`receiving.service.ts:215-218` refuses to guess a cost for precisely this
reason and says so in a comment. The two paths disagreed and only one of them
knew it.

**A correction could not correct.** `apply_stock_movement` has exactly two
behaviours: a positive delta INSERTs a lot, a negative delta DELETEs lots FIFO
(`extend:85-103`). Nothing restates an existing lot. So when the verified
invoice finally arrived, a negative `ledgerDelta` deleted bottles and left the
real price on a ledger row no valuation reads; a positive one created a
**second** lot at invoice cost beside the estimated original, and
`inventory_lot_rollup.wac` (`baseline:3207`) blended the guess with the
correction permanently. And the commonest case of all — the count was right and
only the price was wrong, `ledgerDelta === 0` — was gated out entirely at
`procurement.service.ts:1754`, so the whole point of the three-way match wrote
nothing anywhere. FIFO deletion also discards `cost_provenance`, `vintage` and
`source_order_id`, so pouring the first bottle erases the provenance of the rest.

**And none of it could run.** `applyReceiptAdjustment` passed
`p_source: "receiving"` (`procurement.service.ts:1654`).
`inventory_transaction_source` is exactly
`(pos, manual, order, mobile_count, reconciliation, system, import, api)` —
read from production 2026-09-02. The RPC casts
`p_source::inventory_transaction_source`, so **every** receipt-verification
stock correction raised and `verifyReceipt` returned 422. This is the identical
enum bug already fixed and commented eight lines apart in
`receiving.service.ts:205-212`. `verify-receipt.spec.ts` stubs the RPC as
`async () => ({data: null, error: null})` — a stub that always succeeds cannot
fail an enum cast, which is why the suite was green.

Two smaller findings on the same path. `inventory_lot_rollup.wac` excludes
`cost_provenance='sample'` (`baseline:3207`) and
`inventory_location_breakdown.wac` does not (`baseline:3426`), and both are
returned by the same inventory endpoint — one wine with a free sample bottle
reported two different average costs for the same stock in one response. And
`has_invoice_cost` is `bool_or` over live lots while `wac` averages only lots
that have a cost, so one invoiced bottle in twenty-one was enough to label the
whole row "invoiced lot WAC": per-row *coverage* was tracked, per-row
*completeness* was not.

**Production, read-only, 2026-09-02.** No row currently carries a wrongly
promoted `invoice` provenance — there are **zero** `invoice` lots. But the
population is 2 lots (1 `estimated`/6 bottles unpriced, 1 `manual`/1 bottle
priced), 4 `inventory_transactions`, 2 orders, **0 delivered**, 0 ever
verified. That is "the bug has not fired yet", not "the bug is harmless": the
first real delivery with a price would have minted the first false invoice
assertion, and the first verification after it would have 422'd.

## Options considered

**For the inference (D1):**

1. **Delete it; default silence to `'estimated'`.** Never breaks a caller;
   fails in the safe direction (under-claims verification rather than
   over-claiming it). But silence stays legal, so the next `markDelivered`
   writes an unverified price and nothing objects.
2. **Delete it; RAISE whenever a price arrives mute.** Strongest. But
   `inventory-ledger.service.ts:107` passes `p_unit_cost: dto.unitCost || null`
   with no provenance, so a client that supplies `unitCost` would start getting
   422s — including on negative deltas, where the price never reaches a lot and
   no assertion is possible.
3. **RAISE only when the price would create a lot (`p_delta > 0`).** — chosen.
4. **Do nothing; fix only `markDelivered`.** Costs: the next caller to pass a
   price mutely re-creates the defect, and the RPC keeps a default that means
   "assert the strongest possible claim about a number you were told nothing
   about".

**For the correction (D2):**

1. **Let `verifyReceipt` write a second lot at invoice cost.** — status quo.
   Two lots for one delivery, a permanently blended WAC, and the blend
   labelled as invoiced.
2. **Overwrite `inventory_lots.unit_cost` in place.** Simple and correct in the
   number it produces, but it destroys the estimate at the instant the invoice
   proves the estimate wrong — the precise destruction ADR 0059 forbids.
3. **`revalue_lot`, targeting by `source_order_id`, with the prior cost
   preserved in an append-only table.** — chosen.
4. **`revalue_lot` targeting the FIFO-oldest matching lot.** Rejected: a
   restaurant can hold several deliveries of the same wine, and applying one
   invoice's price to another delivery's bottles is the same error as the
   blended WAC wearing a different hat.

**For where a revaluation is recorded:**

1. **A zero-quantity `inventory_transactions` row.** Rejected: that table's
   subject is `quantity_change` — `apply_stock_movement` returns NULL early on
   a zero delta, and the transaction-summary matview, drift arithmetic and
   movement counts all sum it, so every one of them would need a filter
   forever. It would also need a `'revaluation'` value added to the live
   `inventory_transaction_type` enum, reaching every switch on that type.
2. **`previous_unit_cost` / `revalued_at` columns on `inventory_lots`.**
   Rejected: the first correction is lost as soon as a second one happens, and
   the actor, reason and order need four more columns.
3. **An append-only `inventory_lot_revaluations` table.** — chosen.

## Decision

**Cost provenance is stated, never inferred; a verified invoice restates the
lots the delivery created rather than creating a rival; and no stock write
names an enum value that does not exist.**

`apply_stock_movement` keeps its exact 17-parameter signature — so
`CREATE OR REPLACE` swaps the body in place, creates no second overload,
preserves the ACL, and every named-argument call site keeps resolving — and
gains one rule: if a `p_unit_cost` would create a lot and no
`p_cost_provenance` was given, it raises. The scope is deliberate. The rule is
"a price crossing into a **lot** must state its provenance", and only a
positive delta makes a lot; on a negative delta the price lands on a ledger row
where it can never become a provenance claim. Every caller was enumerated
before the change (the list is in the migration header): the three in
`inventory.service.ts` already state provenance, the two in
`procurement.service.ts` are fixed here, and the one in
`inventory-ledger.service.ts` is unreachable from any client in this repo and
is exempted **by name** in the guard rather than hidden by a pattern.

`revalue_lot(p_inventory_id, p_source_order_id, p_unit_cost, p_cost_provenance,
p_performed_by, p_reason, p_stock_state)` restates the lots **this delivery**
created. Requiring `p_source_order_id` is what makes "which lot?" a question
with no wrong answer: a delivery's lots all came from one invoice at one price,
so all of them are revalued and there is nothing to choose. Bottles already
poured are not restated — they sold against the estimate, and reopening closed
COGS is a decision about historical margin, not a receipt correction — so the
function returns a jsonb receipt carrying `lots_matched` and `bottles_revalued`
and the service logs a warning when a correction reached nothing. A function
that returned void here would be one more system reporting absence as health.

The prior `unit_cost` and `cost_provenance` are written to
`inventory_lot_revaluations` **before** being overwritten. ADR 0059's rule is
that a confirmation must not consume the proposal it confirms; applied to
money, "what we expected to pay" against "what the invoice actually said", per
vendor, per wine, per delivery, is the entire training signal for predicting a
vendor's real landed cost, and it is unreconstructable once overwritten.
`lot_id` is `ON DELETE SET NULL`, never CASCADE, so the record outlives the
bottles: FIFO consumption deletes lots, and cascading would destroy the history
of exactly the bottles that sold. `performed_by` references
`public.users(user_id)` — `auth.users` is a disjoint table and an FK to it
23503s on every write while CI stays green, because a fresh database has no
rows to violate.

`p_source` becomes `'order'`, matching what `receiving.service.ts` settled on
for the door path. The enum is not extended: a receipt correction really is
sourced from a procurement order.

Both smaller findings are **fixed, not filed**.
`inventory_location_breakdown.wac` now excludes sample lots, so the endpoint
returns one WAC rather than two that disagree. `inventory_lot_rollup` gains
`wac_qty`, `invoice_qty` and `unpriced_qty` — appended after `sample_qty`, so
existing `.select()` calls are untouched — and `resolveUnitCost` returns a new
`invoice_lot_wac_partial` basis when the WAC covers only part of the on-hand
quantity. The average is still a real measurement of the bottles it covers;
what was false was the scope it was quoted for. When those columns are not
selected the basis stays `invoice_lot_wac`: an unasked question is not a failed
one.

Separately, `inventory-cost.ts:74-77` justified its zero-WAC branch by citing
sample lots, but the view filters samples out, so the case it described could
not arise. The code was safe and the explanation was wrong; only the comment
changed.

## Consequences

- A price can no longer become an audit assertion by being silent. The failure
  mode inverts: a caller that forgets now gets an error, where before it got
  the strongest possible claim.
- A verified invoice reaches the books for the first time. In particular the
  price-only discrepancy — right count, wrong price, `ledgerDelta === 0` — now
  writes, where previously the entire three-way match changed a badge on a
  screen.
- The (estimated, verified) pair is retained per delivery. That corpus did not
  exist before and cannot be reconstructed from the current schema.
- Given up: a caller can no longer pass a price and let the database decide
  what it means. Every lot-creating call site must now carry one more key.
- Given up: revaluation is deliberately **not** in the quantity ledger, so
  anything auditing "all changes to inventory value" must read two tables
  rather than one. The alternative was polluting `inventory_transactions` with
  zero-quantity rows and extending a live enum.
- **Revisit when** a restaurant needs a correction that is not tied to one
  delivery (a bulk revaluation, a vendor-wide price restatement).
  `revalue_lot` refuses `p_source_order_id = NULL` today on purpose; that
  refusal is the signal, and it will raise rather than guess.
- **Revisit when** bottles from a corrected delivery have already been sold and
  someone needs restated COGS. The warning logged by `applyReceiptAdjustment`
  when `lots_matched = 0` is where that need will first become visible.
- **Not decided here:** OD-100 ("What price values inventory?") remains open
  and is the founder's call. This makes the recorded price *true*; it does not
  choose which true price a valuation should use.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
