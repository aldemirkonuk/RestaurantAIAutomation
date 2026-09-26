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
  it on `reconciled` rows only, `20260926140900`). The event is written **before**
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
  **[Decided 2026-09-25 by the founder (round 5): a part pack verifies, in base units — see
  the fourth amendment below. The refusal is gone.]**

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
booked or refused.]** **[Answered 2026-09-21 by the founder: book it, and send the
wine for research — see the second amendment below.]**

**Evidence.** `verify-receipt.spec.ts` (the event row, no sibling column, a failed
event changes nothing), `shelf-received.spec.ts` (six sibling cases),
`receiving-queue-backorder.spec.ts`, `delivered-once.spec.ts` (put back, retry,
race), web receiving tests; PGlite probe for the new column and CHECK. CLAIMS rows
`ADR-0192-SIBLINGS-ARE-THE-LEDGER` and `ADR-0192-REFUSED-BOOKING-REVERTS`.

## Second amendment 2026-09-21 — an item with no master wine is booked, and researched by its id

**Source.** The founder, 2026-09-21, on the residual under (9), verbatim (typing kept):

> "book the stock anyway, and if it's not on the maser wine that means that wine needs
> research treatment with fully in depth analysis to add to the master wine. If its
> found that it s nowhere to be found, like wine 1 and wine 2 and such, then we skip it
> and flag it. (then we create a little flag in users Ui saying if you were to specify
> this wine, we could help you build better menus or such marketing move. Users are also
> have features that they can edit their part of the menu and wine names. When making a
> search in the db tho, while not the name but the UUID or the deeper id is being
> searched(bith better for lookup times) not the name."

**Built (lane E round 3):**

1. **The stock is booked.** `markDelivered` books a house-declared item like any other,
   keyed by the house item's id: `apply_stock_movement` books by `p_inventory_id`, and a
   lot or ledger row carries a NULL master wine (20260903171000). PGlite probe
   `E3-migrations.mjs` books one and reads it back: lot, ledger row and `stock_live`.
2. **Delivered only when the booking succeeded.** The item row is read strictly before anything
   is booked. A failed
   or missing item row, anything the booking throws, a failed read of "did the door
   already book this" (it used to throw a 503 *after* the delivered write) and a failed
   read of "was this order booked before" are all refused bookings: the order is put back
   exactly as answer (9) puts back a refused movement (422 `delivery_stock_not_booked`).
3. **The notice says what happened.** `delivered-notice.ts` words the "Verify delivery"
   notice from what this call did. "N bottles stocked in" is said only when bottles moved.
   The other outcomes are the door's booking, an earlier booking, and "No stock was
   booked: <why>". For an item the wine library lacks it adds the research sentence.
4. **Research, by the item's id.** No existing queue can hold such an item:
   - `enrichment_queue.wine_id` is NOT NULL.
   - The research agent reads submissions only through `research_eligible_submissions()`,
     which JOINs a library row (20260813170000:82).
   - The submission chain (`haiku_enrich_task` then `web_verify_task`) is dispatched only
     from onboarding imports, and it keys a submission by its payload, which is a name.

   So `house_item_research` (20260926141000) holds one row per house item, keyed by
   `restaurant_inventory.id`, with RLS on (service_role only) and a trigger that refuses an
   item from another house. Its fields are `status` (`queued` | `matched` | `not_findable`),
   `reason`, `queued_from` (`delivery` | `rename`), the source order, and `queued_by` on
   `public.users(user_id)`. The name is read off the item, by id, only to classify it.
   **[E4, 2026-09-22: the classified name is now also kept on the row (`classified_name`,
   20260926141200) as the only name research is ever given, so a name changed after the
   decision is never researched in its place. It is never a lookup key; every read and
   write is still by the item's id.]**
5. **A name that cannot identify a wine is skipped and flagged.** `classifyHouseItemName`
   (`house-item-research.ts`) is a narrow classifier, tested in
   `house-item-research.spec.ts`. It treats these as placeholders: a blank; a generic noun
   with at most a counter ("wine 1", "Wine #2", "item 14", "şarap 3"); a style with at most
   "house" and a counter or year ("house red", "ev şarabı", "rosé 2021"). Such an item is
   `not_findable` at once and never queued. Anything else is researchable. A false "not
   findable" hides a real wine, so the rule stays narrow. **[Last call, 2026-09-21: a
   counter glued to the noun ("Wine1", "wine01", "house red2") was researched as a wine;
   it is now a placeholder. And a name in a script the fold does not read (Greek
   "Ξινόμαυρο", Cyrillic "Саперави", Georgian, Japanese) read as "no words in it" and was
   flagged; it is now always researchable.]**
6. **The flag and the edit path.** `/inventory` shows, under the wine's name and in its
   expansion: *"Tell us which wine this is and we can help you build better menus and
   promotions"*. The expansion offers "Name this wine". It saves through the ordinary item
   edit (`PATCH /inventory/:restaurantId/item/:itemId`, `wineName`, ADR 0124's one alias),
   under the same gate that edit has today. A new name re-decides the row by the item's
   id. A placeholder stays flagged, a real name is queued, and a `matched` row is never
   moved back. A failed read of the list is said on the page. It is never shown as
   "nothing to name".

**Not built, stated.**
- **Nothing consumes `queued` rows yet.** The table is the durable hand-off. Which research
  consumer reads it is the founder's call (lane report, round 3). **[E4, 2026-09-22: the
  founder chose the existing enrich chain; built, dark behind a flag (third amendment,
  item 1).]**
- **Orders with nothing to book.** An order that names no house item, or resolves to zero
  bottles, still reads delivered with nothing booked. The notice now says so in words; it
  no longer says "stocked in". **[E4, 2026-09-22: it now also asks an owner or a manager to
  name the item, and naming it books the stock once (third amendment, item 2).]**
- **[Last call, 2026-09-21] Stock the receiving door booked is not queued.** When the door
  already booked the order (ADR 0103 A5), `markDelivered` books nothing and queues nothing;
  the door's own booking (`canonical/delivery-stock.service.ts`) does not write
  `house_item_research` either. Such an item reaches the queue only when the house renames
  it. **[E4, 2026-09-22: both door paths now queue it (third amendment, item 4).]**
- **Unverified here.** No browser check and no production read. A failed shadow release is
  logged, and the live booking does not depend on it.

**Evidence.** `delivered-once.spec.ts` (booked with no master wine, placeholder flagged, one
row per item, library wine not queued, the order put back when the item cannot be read, is
not this house's, the booking throws, or the door's or an earlier booking cannot be read, queue-write failure said in
the notice, no-item and door-booked wording), `house-item-research.spec.ts` (classifier,
queue row, rename, the list), `NameThisWine.test.tsx`, the PGlite probe `E3-migrations.mjs`.
CLAIMS rows `ADR-0192-UNMATCHED-ITEM-IS-BOOKED` and `ADR-0192-PLACEHOLDER-NAMES-ARE-FLAGGED`.

## Third amendment 2026-09-22 — the queue is worked, a delivery with nothing booked asks for its item, and every booking path queues research

**Source.** The founder's answers to the round-3 lane report, relayed in the round-6u lane
brief and dated there 2026-09-22. His picks, verbatim:

> (1) "Existing enrich chain (Recommended)"
> (2) "Deliver, flag to name it (Recommended)"
> (4) "Yes, same rule (Recommended)"

(His (3), "Back to waiting (Recommended)", is ADR 0175's fourth amendment.) What each pick
chose, as the brief states it: (1) queued rows are worked by the existing submission chain
(`haiku_enrich_task` -> `web_verify_task`), linked by id, never by name; a row flips to
`matched` when its submission gets `matched_master_id`; placeholders are skipped and flagged,
never researched. (2) A delivery whose order names no house item or resolves to zero bottles
stays "delivered, nothing booked" with its truthful notice AND raises a flag asking an owner
or a manager to name the item; naming it books the stock then, once, audited. (4) Every path
that books stock for a wine the library lacks (markDelivered, the receiving door, a rename)
queues research once per item id, idempotently.

**Built (lane E round 4):**

1. **The enrich chain works the queue, by id** (20260926141200).
   - `claim_house_item_research()` (service_role only; anon and authenticated revoked)
     takes the oldest `queued` rows not yet handed off, under a 30-minute lease and
     `FOR UPDATE SKIP LOCKED`. It files ONE `master_wine_library_submissions` row per item,
     only when the row has none, and keeps its id on the row (`submission_id`, unique). A
     retry after the lease re-hands the same submission; it never files a second.
   - It hands back only `classified_name`: the name the gateway classifier judged
     researchable when it decided the row. A queued row must carry it (CHECK). A placeholder
     (`not_findable`) is never claimed, and a name edited later by a path that does not
     re-decide is never researched in its place.
   - An item that meanwhile gained a library wine is matched to that wine by id, not filed.
   - The orchestrator sweep `house_item_research.dispatch`
     (`services/agent-orchestrator/jobs/house_item_research_tasks.py`, Celery beat hourly
     at :45) hands each submission id to `haiku_enrich_task`, which queues `web_verify_task`
     itself. It stamps `dispatched_at` after a hand-off, or `last_dispatch_error` when the
     broker refuses (claimed again after the lease, at most five times). A claim that cannot
     be read raises; it is never "nothing to do".
   - **The flip.** A SECURITY DEFINER trigger on `master_wine_library_submissions` sets the
     row `matched`, with the wine's id, by the submission's id and only while `queued`, when
     the submission is settled `merged` or `accepted` with a `matched_master_id`.
   - **A rename to a new name** clears the hand-off so the new name is researched; the older
     submission stays in the library's queue, unlinked.
   - **Off by default.** The sweep does nothing unless `HOUSE_ITEM_RESEARCH_DISPATCH_ENABLED=true`,
     the same pattern as `research.dispatch_batch`, because the chain spends money on model
     calls and web searches. Switching it on is the founder's keystroke.
2. **A delivery with nothing booked asks for its item** (20260926141300).
   - `markDelivered` keeps the order delivered with nothing booked and the notice's words,
     and raises one `delivery_item_to_name` row per order (why: `no_item` | `zero_bottles`,
     the bottles it resolved to, who marked it delivered). The notice adds: "An owner or a
     manager is asked to name the item on Inventory; naming it books the stock then, once."
     The owners and managers are told on the bell (`delivery_item_to_name`, linking to
     `/inventory?name-delivery=<order>`). A failed ask is said in the notice, never dropped.
   - **Naming** (`POST /procurement/orders/:id/name-item`, the house from the token, the item
     by its id; `GET /procurement/items-to-name` lists them): owner or manager only, the
     role read strictly before any write. A zero-bottle delivery must state its count; a
     delivery that resolved to bottles books that number. The ask is claimed open -> named
     conditionally, so a second or concurrent naming books nothing. The booking uses
     markDelivered's own ledger key (`order-delivered-live:<order>`). Stock the door booked
     since (either door) or an earlier booking refuses. A refused booking puts the ask back to
     open and unlinks a no-item order. The naming writes a `delivery_item_named` row to
     `system_audit_log`; the ask row itself records who, when, which item and how many.
   - **What a house meets, stated:** `procurement_orders.inventory_id` is NOT NULL in every
     migration, so no stored order names no item. The `no_item` branch is kept and flags;
     the case that happens is zero bottles. For it the order already names its item, so
     naming it means confirming that item and saying how many bottles came in.
   - `/inventory` shows "Deliveries waiting for their item" (`DeliveriesToName.tsx`): the
     order, what happened, and for an owner or a manager the item (chosen by id) and the
     count; anyone else is told who can. A failed read is said on the page.
3. **(Round-3 item 5, unchanged.)** Placeholders stay `not_findable` and flagged; the claim
   above never takes them.
4. **Every booking path queues research, once per item id.** `queueResearchIfLibraryLacks`
   (`house-item-research.ts`) reads the item by id and house, strictly, and queues only an
   item with no `master_wine_id`. It now runs after the door's case count booked bottles in
   (`recordDoorReceipt`, `queued_from = 'receiving'`), after `DeliveryStockService.bookAtTheDoor`
   for each item a count booked stock into, and after a delivery's item is named.
   `markDelivered` and the rename already queued. The one-row-per-item index is the "once",
   and a second booking with the same name changes nothing. An unreadable or foreign item is
   said in the door's answer, never "nothing to queue"; the stock stands.
   **[Last call, 2026-09-22: the build missed one path that receives stock. A verification
   correction that books bottles in (`applyReceiptAdjustment`, after its `receipt-verify:`
   movement, delta > 0) did not queue. A zero-bottle delivery verified at its real count
   therefore booked the wine and never queued it. It now queues (`queued_from = 'receiving'`),
   with a failure logged; `verify-receipt.spec.ts`. Paths that change stock without receiving
   it (count corrections, POS sales) are not wired. Every path that adds a new item with
   stock (add-to-inventory, bulk receive) carries a library wine by construction.]**
   **[Last call 2, 2026-09-22: one more path is not wired. `POST /inventory-ledger/transactions`
   (and its `/bulk`) books whatever transaction type its caller names, a `purchase` included,
   and does not queue. It is API-only: no web page calls it (grep of `apps/web/src`).]**

**Not built, stated.**
- **The chain's first step cannot persist, measured from the migrations.** `haiku_enrich_task`
  (`jobs/haiku_tasks.py`) writes `ai_enriched`, `enrichment_source` and seven JSONB keys
  (`grape_family`, `wine_structure`, ...) onto `master_wine_library_submissions`. None of
  those nine columns exists in any migration (grep: 0 files for `ai_enriched` and
  `enrichment_source`; the JSONB keys exist only on other tables). Against a database built
  from `supabase/migrations/`, that update fails, the task retries (a model call each time),
  and `web_verify_task` is never queued. This predates the lane. It is one reason the sweep
  ships off: switched on as is, it would spend on calls whose results are not kept.
- **Nothing in the chain sets `matched_master_id`.** Only
  `WineSubmissionsService.processPendingSubmissions` does (`merged`, `accepted`, or a near
  miss), and it runs only when someone POSTs `/wines/submissions/process`; no scheduler calls
  it. So a queued item flips to `matched` only after such a run.
- **A near miss does not flip the row.** processPendingSubmissions writes `pending_review`
  WITH the candidate's id in `matched_master_id`. The brief says the row flips "when its
  submission gets matched_master_id"; the build flips only a settled `merged`/`accepted` link,
  because a candidate nobody confirmed is not a match. Put to the founder as a question.
- **"Research found nothing" does not flag.** The chain has no "nowhere to be found" outcome,
  so a researched row that finds nothing stays `queued`.
- **A matched row does not link the house item** (`restaurant_inventory.master_wine_id` stays
  NULL). Not asked for; stated.
- **Naming leaves no unit cost** on the lot (nobody has read an invoice there); verification
  settles it, as at the door.
- **A crash between the ask's claim and the booking** leaves the ask `named` with nothing
  booked. The window is one request; it is stated, not handled.
- **[Last call, 2026-09-22] An ask outlives a booking made elsewhere.** When the door or a
  verification books the order after the ask was raised, nothing closes the ask. Naming it
  then refuses with a 409 ("booked since it was delivered") and books nothing twice, but
  `/inventory` keeps listing the delivery as waiting. Closing it needs a third status, which
  is a founder question (lane report).
- **[Last call, 2026-09-22] A handed-off row holds its submission.** `submission_id` is
  `ON DELETE SET NULL`, and a dispatched row must keep its submission (CHECK). So deleting a
  submission the chain was handed fails with a check violation, rather than leaving the row
  dispatched with nothing to follow. No path deletes submissions except test teardown.
- **[Last call 2, 2026-09-22] The /inventory card is not in Mudavym components.**
  `DeliveriesToName.tsx` uses the host page's own Tailwind styling. `components/mudavym` has no
  select or count input, and the card has no ADR 0134 motion.
- **Unverified here:** no browser check, no production read, and no Celery worker or beat was
  run (the orchestrator's Dockerfile starts uvicorn only; whether a worker and beat run in
  production is not known from the repo).

**Evidence.** PGlite `p4-scratch/pglite-probe/E4-migrations.mjs` (51 checks: the claim, the
lease, one submission per item, placeholders never claimed, the flip on merged/accepted and
not on a near miss, the ask's constraints, one ask per order, the conditional naming, the
failed-send columns, re-runs are no-ops); `delivery-item-to-name.spec.ts`,
`delivered-once.spec.ts` (the ask block), `house-item-research.spec.ts` (the same-rule
block), `receiving.spec.ts`, `delivery-stock.service.spec.ts`,
`test_house_item_research_tasks.py`, `DeliveriesToName.test.tsx`. CLAIMS rows
`ADR-0192-QUEUED-ITEMS-WORKED-BY-ENRICH-CHAIN`, `ADR-0192-DELIVERY-ASKS-FOR-ITS-ITEM`,
`ADR-0192-EVERY-BOOKING-PATH-QUEUES-RESEARCH`; `ADR-0192-UNMATCHED-ITEM-IS-BOOKED` re-pinned
with a dated bracket.

## Fourth amendment 2026-09-25 — a part pack verifies in base units

**Source.** The founder, 2026-09-25, round 5, asked via AskUserQuestion: *"Receiving
(#436/#480): verifyReceipt no longer writes accepted_quantity. Should it accept a part-pack
count (e.g. 7 of a case of 12) as the accepted amount? Today a part-pack verification writes
no history entry."* **[founder, 2026-09-25, round 5]** chose, verbatim: *"Yes, in base units
(Recommended) — Accept any count in the item's base unit (ADR 0070 integer qty + uom), so every
verification leaves a history line."* Rejected: *"Whole packs only — Part-packs are refused at
the door; the count must be whole cases."*

**Built.** The one place a part pack was refused is the back-derivation in `verifyReceipt`: a
caller that states no accepted count has it derived from the ledger's booked bottles, and 59
bottles on a 12-pack case order derives 4.9167 cases, which answered 400 (*"does not divide
evenly"*) and wrote no `reconciled` event. It now re-reads that verification's whole physical
count in **bottles** (`countedUom: "bottle"`): accepted = the ledger's booked bottles, and the
stated rejection and free goods are multiplied by the pack size with it (converting only one of
a counted trio is the defect ADR 0062 records). Every operand stays an integer in a stated unit
(ADR 0070); nothing is rounded; a whole number of packs is unchanged; the reading is settled
before `openCreditClaim` and the event, as before. A caller that STATES a part pack already
could: the DTO takes integer counts with a unit, the web desk sends a part case as
`countedUom: 'bottle'` (`ReceivingWorkspace.tsx`), and the mobile receive screen counts bottles.

**What "every verification" does not yet cover, said plainly.** A verification that carries
**no count at all** — the mobile Today card's one-tap *"Counts match"*, which posts
`{ adjustments: [] }` (`apps/mobile/src/components/today/DecisionCard.tsx`) — takes no match
path (`hasMatchFields` is false), so it completes the order and writes no `reconciled` event.
Writing one would make it the verification of record and blank an earlier verification's
invoice quantity (the latest `reconciled` row answers "invoiced", 2026-09-21 amendment), so it
is not built here; it is a fork for the founder, reported by the W3-receiving lane.

**Also in this round (a code fix, not a ruling).** CodeQL alert #1505
(`js/user-controlled-bypass`) flagged `markDelivered`'s put-back guard `if (stockNotMoved)`.
The alert's own path (SARIF of analysis 1842981122) starts at the ORDER ID path parameter,
not the quantity: the id is interpolated into `deliveryHasBookedOrder`'s error sentence, which
became `stockNotMoved`, which decided the condition over the put-back write. Whether the
booking was refused is now its own boolean, set only to a literal `true` beside each reason;
the reason is only said. Behaviour is unchanged (`delivered-once.spec.ts`, 44 tests; removing
the `true` on the delivery-read branch turns its "cannot be read … put back" case red).

**Evidence.** `verify-receipt.spec.ts`, block *"a part-pack derived count verifies in bottles"*
(3 tests; both part-pack cases go red when the refusal is put back).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Founder | Chose *"Shelf count from ledger"* |
| 2026-09-21 | lane E-qty | Built; guard and CLAIMS row mutation-tested (see the lane report) |
| 2026-09-21 | lane E-qty last call | Rejected and counted-not-booked put beside the count on the phone and in the 409 summary (the founder's "shown beside it"); the records that still described the retired pair (0119, 0125, TECH-DEBT item 3, the orders and receiving dossiers) bracket-corrected; the door's running total restored to ADR 0062 D3's events (the build had moved it to the ledger); one residual added |
| 2026-09-21 | Aldemir (founder), answers 8 and 9 (relayed in the round-2 lane brief) | The rule applies to the four sibling columns, in one stated unit, the guard extended; a refused booking reverts the order's status, the race guard kept |
| 2026-09-21 | Claude (Opus 5), lane E round 2 | Built both (amendment above): the verification is a `reconciled` event in bottles, the shelf reading answers the siblings, the queue reads backorder from the ledger, the guard covers five names; markDelivered puts the order back on a refused booking |
| 2026-09-21 | Claude (Opus 5), lane E round 2 last call | A residual stated under (9): an item with no `master_wine_id` (or an unreadable item row) is not booked by `markDelivered` and not put back either (pre-existing on `main`) |
| 2026-09-21 | Aldemir (founder), on the residual under (9) | *"book the stock anyway"*; research an item the library lacks, by its id; skip and flag a placeholder name (second amendment, verbatim) |
| 2026-09-21 | Claude (Opus 5), lane E round 3 | Built (second amendment): booked by the house item id, more refusals that put the order back, a true notice, `house_item_research` + the classifier + the /inventory flag and rename path; the consumer is a founder question |
| 2026-09-21 | Claude (Opus 5), lane E round 3 last call | Classifier fixed both ways (a glued counter is a placeholder; an unread script is researchable), tests and mutants; the door-booked gap stated under "Not built" |
| 2026-09-22 | Aldemir (founder), answers (1), (2), (4) (relayed in the round-6u lane brief) | *"Existing enrich chain (Recommended)"*; *"Deliver, flag to name it (Recommended)"*; *"Yes, same rule (Recommended)"* (third amendment, verbatim) |
| 2026-09-22 | Claude (Opus 5), lane E round 4 | Built the three (third amendment): the claim, the sweep (off by default) and the flip; the ask, the naming act and the /inventory card; research from both doors and the naming; the enrich chain's persist defect, the unscheduled promotion and the near-miss reading stated |
| 2026-09-22 | Claude (Opus 5), lane E round 4 last call | A verification correction that booked bottles in did not queue research; it now does, with tests and mutants (item 4). The /inventory card lost the gateway's sentence when the refetch dropped the named delivery; the card now holds it. Two residuals stated: an ask outlives a booking made elsewhere, and a handed-off row holds its submission |
| 2026-09-22 | Claude (Opus 5), lane E round 4 last call 2 | Record narrowed to the code: the API-only ledger endpoint does not queue research (item 4 bracket, the CLAIMS row text, the module comment), and the /inventory card is not in Mudavym components (Not built). No behaviour changed |
| 2026-09-25 | Aldemir (founder), round 5 | *"Yes, in base units (Recommended)"* on the part pack (fourth amendment, verbatim with the rejected option) |
| 2026-09-25 | Claude (Opus 5), lane W3-receiving | Built (fourth amendment): the derived part pack verifies in bottles and writes its event; the no-count one-tap verification stated as not covered; CodeQL #1505 restructured (flag split from reason) |
