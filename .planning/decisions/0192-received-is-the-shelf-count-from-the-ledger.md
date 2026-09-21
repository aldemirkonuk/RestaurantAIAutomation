# 0192 — What an order received is the shelf count from the ledger

- **Status:** Locked (founder, 2026-09-21) on the option he chose, *"Shelf count from ledger"*. Built on `r5/E-qty`. **Supersedes** the `quantityReceived` clause of [[0062-a-quantity-declares-its-unit]]'s "Given up for now" line (`0062:185-192`) and **closes** the 2026-09-02 fork in `.planning/v3.0-TECH-DEBT.md` ("`procurement_orders.quantity_received` has two units"). Also **supersedes** the 2026-09-05 (batch 40) decision that `quantityReceived` and its unit travel together on the order DTO — recorded in `v3.0-TECH-DEBT.md` "The orders wire" item 3, [[0119-an-agreed-price-states-its-unit]]'s status note and [[0125-an-order-changes-state-through-a-sealed-transition]]'s 409 body — each bracket-corrected in place. Applies the Locked [[0070-a-quantity-states-its-own-unit]] (the unit belongs to the item) to the one column 0070 never named.
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** quantity_received, received, shelf count, stock ledger, inventory_transactions, cases and bottles, part case, pack size, receiving desk, receiving door, verifyReceipt, markDelivered, updateOrder, guard, never rounded
- **Links:** [[0062-a-quantity-declares-its-unit]], [[0070-a-quantity-states-its-own-unit]], [[0011-pos-sale-volume-contract]], [[0016-ledgers-must-express-unknown]], [[0103-a-delivery-is-agreed-before-it-is-verified]] (A5, one booking path), [[0141-a-stock-write-names-the-house-it-is-for]]. Research: the q921 qty workflow (owner, two-branch owner and group-executive seats, a code census and a judge), in the orchestrating session's scratchpad, not in the tree.

## The founder's answer

The option he chose, in his words: *"Shelf count from ledger"*.

The option as it was put to him, and as the orchestrating session relayed it to this
lane (quoted as relayed; the question's full text is in that session, not in the tree):

> "received" for an order line means the bottles the stock ledger booked onto the
> shelf for that line: sum of inventory_transactions.quantity_change for (order, the
> order's item, live stock), in the item's stock unit, never rounded; shown as "5 cases
> + 5 bottles" from the order's pack size (bottles only when pack size is unknown);
> rejected and counted-but-not-booked shown beside it. The app stops reading and
> writing procurement_orders.quantity_received (no migration now; dropping the column
> is a later ADR).

## Context

`procurement_orders.quantity_received` is one `integer` column that was ambiguous on
three axes, measured on `r5/E` before this change:

1. **Unit.** Three writers stored the order's own unit — `markDelivered`
   (`procurement.service.ts:4485` at the base commit), `updateOrder` (`:2927-2933`),
   `verifyReceipt` (`:5466`) — and the door stored bottles (`receiving.service.ts:528`).
2. **Gross or net.** The door stored accepted bottles; `verifyReceipt` stored accepted +
   rejected; `markDelivered` stored the ordered quantity.
3. **Completeness.** The canonical delivery path booked stock and never wrote the
   column; `markDelivered` wrote it even when its own stock movement had failed (its
   live `apply_stock_movement` result was never read); `updateOrder` let any caller
   write it with no stock movement at all.

And one live screen read it wrong: the desk (`ReceivingWorkspace.tsx:177`) seeded its
"accepted" count from `order.quantityReceived` and treated every number as the order's
unit. A 5-case order (12 a case) the door had counted pre-filled **60**; submitted
unedited that is 60 cases = 720 bottles against a ledger holding 60 — a **+660** bottle
correction, the TECH-DEBT entry's −660 with the sign flipped.

The ledger is the one record every booking path writes with the order id: the door
(`door-receipt:{eventId}`), the one-tap delivery (`order-delivered-live:{orderId}`), the
canonical delivery paperwork, and the desk's corrections (`receipt-verify:{order}:{item}`).
Receipt rows stay after the wine is sold.

## Options considered

1. **Shelf count from the ledger** (chosen). "Received" is the ledger's sum in the
   item's unit, shown as cases + bottles; the column goes dark. Cost: one gateway read,
   three screens, a guard.
2. **Keep the column, labelled.** Today's state plus a desk fix. Rejected by the
   adversarial pass: the gateway already served the raw number next to its own
   refusal to state a unit, so "display only" was not display only, and case orders
   never showed a received count anywhere but the door.
3. **Every writer stores bottles.** Still a second copy that drifts from the ledger
   (`updateOrder` with no movement, the canonical path that skips it, a failed
   booking), and the widest screen change.
4. **The door writes cases.** A part case rounds away or is refused; case size varies
   per order line, so "5 cases" does not compare across orders; contradicts 0070.
5. **Widen the column to numeric cases** (ADR 0190's third option, filed there as
   0168). Killed by 0070's own argument: 1/12 has no finite decimal, so 65 bottles
   becomes 5.4167 cases forever.

## Decision

**What an order line received is the sum of `inventory_transactions.quantity_change`
for (the order, the order's item, `stock_type = 'live'`), in `restaurant_inventory.uom`
(bottles for wine), never rounded. The app does not read or write
`procurement_orders.quantity_received`.**

What was built (`r5/E-qty`):

- **Gateway reading** — `apps/api-gateway/src/procurement/shelf-received.ts`.
  `readShelfReceived` reads four tables once per 100 orders (ledger, the door's
  `case_count` events, the items' `uom`, the order lines), every read filtered by the
  token's house. `composeShelfReceived` sums the ledger, takes the pack from the ONE
  line that states `bottles_per_unit` or an exact `bottles_total / quantity` (never a
  rounded ratio), and splits with `Math.floor` into packs + loose bottles. Beside the
  count: `rejectedAtDoorBottles` (the door's events) and `countedNotBookedBottles`
  (door-accepted bottles the ledger does not hold, the desk's `receipt-verify:`
  corrections excluded so a desk recount is not "pending"). A failed read, an item with
  no unit, a non-integer or negative ledger are `readable: false` with a sentence —
  never a zero.
- **Wire** — `OrderResponseDto.received` (`ShelfReceivedDto`) on `getOrder`,
  `listOrders` (batched) and `markDelivered` (read back AFTER the booking). Key absent on
  routes that did not read the ledger. `quantityReceived` / `quantityReceivedUom` are
  gone from the response; `quantity-received-unit.ts`, the column's reader, is deleted.
- **409 "already delivered"** — `earlierDelivery.received` replaces
  `quantityReceived`/`unitType`/`quantityUnitWhy`; the summary reads "…, 5 cases + 5
  bottles on the shelf." (from `markDelivered`, the race loser and the one-tap rail),
  with the door's rejections and any counted-not-booked bottles in brackets beside the
  count when either is above zero (`besideTheShelf`).
- **The four writes stop.** `markDelivered` and `verifyReceipt` no longer write it; the
  door no longer writes it; `updateOrder` refuses `quantityReceivedInOrderUom` and its
  alias with a 400 (`reason: received_is_the_ledger`) before anything is read or
  written. The two DTO fields stay declared so the refusal can name them (the gateway
  runs `forbidNonWhitelisted`). The demo scenario and the seed script's inert writes are
  removed too.
- **Adjacent fix the truth depends on.** `markDelivered` reads its live
  `apply_stock_movement` result. A refusal is logged as an error, writes no
  `order_delivered` event, and the verify notification says the stock did not move; the
  response's `received` reads the real (empty) shelf. The one-tap record's
  `bottlesBooked` is now that ledger count, not the order's `bottles_total`.
- **Desk** — `ReceivingWorkspace` seeds its count from `received`: a whole number of
  packs counts in the order's unit (5 cases → 5); a part pack counts in **bottles**
  (5 cases + 5 bottles → 65, `countedUom: 'bottle'`, with the ordered figure and a
  stated per-bottle price restated so the screen holds one unit), so it verifies instead
  of being refused as 4.9167 cases. No block, or an unreadable one, starts from the
  ordered quantity and says so.
- **Door** — `doorReceivedSoFar` returns whole boxes + loose bottles, never
  `Math.round`. Its running total stays the door's own `procurement_receipt_events`
  (ADR 0062 D3, founder-decided — the model the door books by: its first count
  reconciles against a one-tap booking as the same truck, and it books nothing when a
  delivery owns the stock), with the ledger's count, counted-not-booked and the exact
  pack beside it. *(Corrected at last call: the build had switched the total to the
  ledger, which silently overrode D3 and would have read a one-tap booking, or a
  delivery's, as an earlier truck.)* `DoorModel` states "11 boxes + 7 bottles
  of 16 with the earlier 5 boxes + 7 bottles — 4 boxes + 5 bottles short", and the
  vendor credit letter uses the same arithmetic. A failed read is `'unread'` and claims
  no shortfall, instead of the old `?? 0` that compared truck two against the whole
  order.
- **Phone** — `receivingCountBasis` pre-fills the ledger's bottles and states the
  words, with the door's rejections and counted-not-booked bottles said beside them;
  the 409 parser reads the new block.
- **Guard** — `scripts/check_no_quantity_received_column.py`, blocking in `ci.yml` with
  `--self-test`: the identifier `quantity_received` in app code (comments stripped,
  strings kept) under `apps/*/src`, `apps/mobile/app`, `services/`, `packages/`, and
  `quantityReceived` / `quantityReceivedUom` on the clients. Tests are excluded by
  design; the allow-list is empty and an entry that excuses nothing is exit 2.
  CLAIMS row `ADR-0192-RECEIVED-IS-THE-LEDGER`.

**Older phones, deliberately.** The response no longer carries `quantityReceived`. A
phone on an older build therefore reads no received count and falls back to the
ordered bottles with its own sentence ("Pre-filled from the ordered bottle quantity…
this is not proof of receipt"). The alternative — keep sending `quantityReceived` as
the ledger's bottles — was rejected: a stale desk tab reads that key as the order's unit
and would pre-fill the +660 default this ADR exists to end.

## Consequences

- One number means "received" everywhere, and it is the one the stock correction is
  measured against, so a desk verification of an unedited pre-fill is a zero correction.
- A second truck adds to the first (it is a sum of rows); a booking that failed shows
  as counted-not-booked, not as received.
- Every received bottle traces to an append-only ledger row with who, when and which
  idempotency key.
- **Given up:** a received count on a route that does not read the ledger
  (`listPendingOrders`, `createOrder`, `updateOrder`, `approveOrder`, `verifyReceipt`'s
  own response) — the key is absent there, honestly.
- **Not covered by the guard:** `select("*")` returns the column without naming it;
  `mapOrderRow` builds its response from explicit keys and the spec proves a row holding
  36 in the column reads as 0 received.

### Forks recorded here (not filed as OD rows — a new row shifts ~180 citations)

1. **The sibling columns.** `accepted_quantity`, `rejected_quantity`,
   `backorder_quantity` and `invoice_quantity` have the same mixed-unit problem
   (`accepted`/`rejected` in the counted unit, which the order row does not record;
   `backorder` in bottles; `invoice` in the invoice unit). `managerQueue` shows a bottle
   `backorderQty` with no unit (`receiving.service.ts`, `managerQueue`). The same rule
   probably applies; it is the founder's call. Until it is answered, `received`'s
   "rejected" figure is the **door's** only — a desk rejection lives in
   `rejected_quantity`, whose unit is exactly this fork. **[Answered 2026-09-21: the
   rule applies — see the amendment below.]**
2. **A refused booking and the DELIVERED status.** `markDelivered` still writes
   DELIVERED before it books (the conditional UPDATE is the race guard, ADR 0103 A5 /
   the delivered-once work). A refused movement now says so and the shelf reads true,
   but the order still reads DELIVERED, and a retry is refused as already delivered.
   Booking first, or reverting the status, changes the race design and is the founder's
   call. **[Answered 2026-09-21: revert the status, keep the race guard — see the
   amendment below.]**
3. **Dropping the column** — a later ADR, as he said.

### Residual risks

- **Ledger immutability is asserted, not proven.** Whether the gateway's service
  credential can UPDATE or DELETE `inventory_transactions` is unmeasured here.
- **An item whose stock unit is not a bottle.** The one-tap record's `bottlesBooked`
  carries the ledger's count under a bottle name; for a keg or litre item that is kegs
  or litres. No wine order is affected; the ledger block itself states `stockUom`.
- **The cellar lane (`r5/cellar`) predates the ledger read.** Its copies of
  `receiving.service.ts` and `procurement.service.ts` still read the column as stock
  input and have no `booked-order-quantity.ts`; this guard will fail it, which is the
  point — it must rebase past this before it merges.
- **Found, not fixed (one operation per lane):** the desk pre-fills its invoice and
  shipped quantities from the documents' `qtyBottles` while stating no unit, which is
  the order's unit — on a case order in the order's unit that is bottles read as cases.
  In the new bottle mode those two fields declare `bottle` and are correct. The door's
  `resolvePackSize` still rounds a non-integer `bottles_total / quantity`. The legacy
  delivery e-mail template labels its data parameter "bottles" (it does not read the
  column; it is re-exported by `email-templates/index.ts`, so retiring it is the comms
  lane's).

- **Revisit when:** the founder answers fork 1 or 2, or the column-drop ADR is written;
  or a list screen measurably needs a faster read, at which point a database-maintained
  copy refreshed inside `apply_stock_movement` is the option the judge left alive.

**Retire-to-write:** this record supersedes 0062's "Given up for now" `quantityReceived`
clause and closes the v3.0-TECH-DEBT 2026-09-02 entry; it adds no other document.

## Amendment 2026-09-21 — the founder's answers on forks 1 and 2, built

**Source.** The founder's answers (8) and (9) of 2026-09-21, relayed in the lane
brief (round 2); the wording below is the relay's, not a verbatim quotation.

**(8) ADR 0192 applies to the sibling columns.** *Accepted, rejected, backorder and
invoice quantities are answered from the ledger / receipt event rows in one stated
unit, and the app stops reading and writing those columns; the guard is extended.*
Built:

- `verifyReceipt` records each verification as one `reconciled` receipt event
  (the stage `procurement_receipt_events` has admitted since the baseline and no
  code wrote), in **bottles**: `counted_qty_bottles` (accepted), `rejected_qty_bottles`,
  and the new `invoice_qty_bottles` (NULL when no invoice was verified; a CHECK keeps
  it on `reconciled` rows only, `20260921114960`). The event is written **before**
  anything else moves; if it cannot be written the verification changes nothing. It
  no longer writes `accepted_quantity`, `rejected_quantity`, `invoice_quantity` or
  `backorder_quantity`. The latest `reconciled` event is the verification of record (a
  re-verification restates the delivery; runs are not added up). The existing
  `listUnverified` already counted a `reconciled` event as closing the loop.
- The shelf reading (`shelf-received.ts`) adds `rejectedAtDeskBottles`,
  `invoicedBottles`, `verifiedAt`, `orderedBottles` and `backorderBottles`:
  **accepted** is the ledger's own count (the verification's correction is what moves
  it — there is no second "accepted" number), **rejected** is the door's plus the
  latest verification's, **invoiced** is the latest verification's, **backorder** is the
  order's bottles less the ledger's count, never below zero, and null when the order's
  bottles are not known exactly (never a rounded pack). A later truck moves the
  backorder; the old column never could. The 409 summary names desk rejections and
  backorder beside the count.
- The receiving queue (`managerQueue`) reads backorder from the ledger in bottles
  (`backorderBottles`, with `backorderWhy` when it cannot be stated) and its two reads
  now fail as errors instead of reading as an empty queue; `/receiving` and the legacy
  receiving home say "N bottles still on backorder". The desk's shelf note shows the
  earlier verification's rejections and what is still owed.
- `scripts/check_no_quantity_received_column.py` covers all five column names
  (self-test extended; `prefilled_invoice_quantity`, the extraction's proposal under
  ADR 0059, is a different column and not covered). Run against the lane's pre-build
  tree it fails on the verification's writes and the queue's read.
- **Kept, stated:** the refusal of a non-whole back-derived accepted count in
  `verifyReceipt` was motivated by `accepted_quantity`'s integer type; the column is no
  longer written, so the refusal has lost that reason. It is kept unchanged in
  behaviour; whether a part pack should now verify is a follow-up, not decided here.

**(9) When mark-delivered's stock booking is refused, revert the order's status so
it can be retried, keeping the conditional-update race guard.** Built: `markDelivered`
copies the prior `status`, `delivered_at` and `received_by` before its write, and
when the live `apply_stock_movement` is refused it puts exactly those back with an
update conditional on its own write (DELIVERED, this `delivered_at`, this person), so
it can never undo a different delivery; the race guard on the delivery write itself
(`status NOT IN arrived`) is unchanged. It answers 422, reason
`delivery_stock_not_booked`, saying the order is back to its status (or, if the
put-back itself did not land, that it reads delivered with nothing on the shelf). No
`order_delivered` event, verify task, calendar change or in-transit change is written
for a refused booking. The shadow release that runs before the live booking is
idempotent on its own key, so a later delivery does not release it twice; between the
refusal and the retry the shadow figure reads as already released — stated, not
fixed. **[Last call, 2026-09-21: a second residual, older than this answer (it is on
`main`): when the order's item has no `master_wine_id`, or its row could not be read,
`markDelivered` attempts no movement at all, so nothing is refused and nothing is put
back; the order reads delivered, an `order_delivered` event is written for bottles that
never moved, and the manager is told they were stocked in. The put-back covers a
refused movement only; this path needs its own decision on whether such an item is
booked or refused.]**

**Evidence.** `verify-receipt.spec.ts` (the event row, no sibling column, a failed
event changes nothing), `shelf-received.spec.ts` (six sibling cases),
`receiving-queue-backorder.spec.ts`, `delivered-once.spec.ts` (put back, retry,
race), web receiving tests; PGlite probe for the new column and CHECK. CLAIMS rows
`ADR-0192-SIBLINGS-ARE-THE-LEDGER` and `ADR-0192-REFUSED-BOOKING-REVERTS`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Founder | Chose *"Shelf count from ledger"* |
| 2026-09-21 | lane E-qty | Built; guard and CLAIMS row mutation-tested (see the lane report) |
| 2026-09-21 | lane E-qty last call | Rejected and counted-not-booked put beside the count on the phone and in the 409 summary (the founder's "shown beside it"); the records that still described the retired pair (0119, 0125, TECH-DEBT item 3, the orders and receiving dossiers) bracket-corrected; the door's running total restored to ADR 0062 D3's events (the build had moved it to the ledger); one residual added |
| 2026-09-21 | Aldemir (founder), answers 8 and 9 (relayed in the round-2 lane brief) | The rule applies to the four sibling columns, in one stated unit, the guard extended; a refused booking reverts the order's status, the race guard kept |
| 2026-09-21 | Claude (Opus 5), lane E round 2 | Built both (amendment above): the verification is a `reconciled` event in bottles, the shelf reading answers the siblings, the queue reads backorder from the ledger, the guard covers five names; markDelivered puts the order back on a refused booking |
| 2026-09-21 | Claude (Opus 5), lane E round 2 last call | A residual stated under (9): an item with no `master_wine_id` (or an unreadable item row) is not booked by `markDelivered` and not put back either (pre-existing on `main`) |
